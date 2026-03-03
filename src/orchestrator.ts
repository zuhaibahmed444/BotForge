import type {
  InboundMessage,
  StoredMessage,
  WorkerOutbound,
  OrchestratorState,
  Task,
  ConversationMessage,
  ThinkingLogEntry,
} from './types.js';
import {
  ASSISTANT_NAME,
  CONFIG_KEYS,
  CONTEXT_WINDOW_SIZE,
  DEFAULT_GROUP_ID,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  buildTriggerPattern,
} from './config.js';
import {
  openDatabase,
  saveMessage,
  getRecentMessages,
  buildConversationMessages,
  getConfig,
  setConfig,
  saveTask,
  clearGroupMessages,
  getBot,
  updateSessionTimestamp,
} from './db.js';
import { readGroupFile, writeGroupFile } from './storage.js';
import { encryptValue, decryptValue } from './crypto.js';
import { BrowserChatChannel } from './channels/browser-chat.js';
import { Router } from './router.js';
import { TaskScheduler } from './task-scheduler.js';
import { ulid } from './ulid.js';

type EventMap = {
  'state-change': OrchestratorState;
  'message': StoredMessage;
  'typing': { groupId: string; typing: boolean };
  'tool-activity': { groupId: string; tool: string; status: string };
  'thinking-log': ThinkingLogEntry;
  'error': { groupId: string; error: string };
  'ready': void;
  'session-reset': { groupId: string };
  'context-compacted': { groupId: string; summary: string };
  'token-usage': import('./types.js').TokenUsage;
};

type EventCallback<T> = (data: T) => void;

class EventBus {
  private listeners = new Map<string, Set<EventCallback<any>>>();

  on<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off<K extends keyof EventMap>(event: K, callback: EventCallback<EventMap[K]>): void {
    this.listeners.get(event)?.delete(callback);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }
}

export class Orchestrator {
  readonly events = new EventBus();
  readonly browserChat = new BrowserChatChannel();

  private router!: Router;
  private scheduler!: TaskScheduler;
  private agentWorker!: Worker;
  private state: OrchestratorState = 'idle';
  private triggerPattern!: RegExp;
  private assistantName: string = ASSISTANT_NAME;
  private apiKey: string = '';
  private model: string = DEFAULT_MODEL;
  private maxTokens: number = DEFAULT_MAX_TOKENS;
  private messageQueue: InboundMessage[] = [];
  private processing = false;
  private pendingScheduledTasks = new Set<string>();
  private currentBotId: string | null = null; // Track current bot for responses

  /**
   * Initialize the orchestrator. Must be called before anything else.
   */
  async init(): Promise<void> {
    // Open database
    await openDatabase();

    // Load config
    this.assistantName = (await getConfig(CONFIG_KEYS.ASSISTANT_NAME)) || ASSISTANT_NAME;
    this.triggerPattern = buildTriggerPattern(this.assistantName);
    const storedKey = await getConfig(CONFIG_KEYS.ANTHROPIC_API_KEY);
    if (storedKey) {
      try {
        this.apiKey = await decryptValue(storedKey);
      } catch {
        // Stored as plaintext from before encryption — clear it
        this.apiKey = '';
        await setConfig(CONFIG_KEYS.ANTHROPIC_API_KEY, '');
      }
    }
    this.model = (await getConfig(CONFIG_KEYS.MODEL)) || DEFAULT_MODEL;
    this.maxTokens = parseInt(
      (await getConfig(CONFIG_KEYS.MAX_TOKENS)) || String(DEFAULT_MAX_TOKENS),
      10,
    );

    // Set up router
    this.router = new Router(this.browserChat);

    // Set up channels
    this.browserChat.onMessage((msg) => this.enqueue(msg));

    // Set up agent worker
    this.agentWorker = new Worker(
      new URL('./agent-worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.agentWorker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      this.handleWorkerMessage(event.data);
    };
    this.agentWorker.onerror = (err) => {
      console.error('Agent worker error:', err);
    };

    // Set up task scheduler
    this.scheduler = new TaskScheduler((groupId, prompt) =>
      this.invokeAgent(groupId, prompt),
    );
    this.scheduler.start();

    // Wire up browser chat display callback
    this.browserChat.onDisplay((groupId, text, isFromMe) => {
      // Display handled via events.emit('message', ...)
    });

    this.events.emit('ready', undefined);
  }

  /**
   * Get the current state.
   */
  getState(): OrchestratorState {
    return this.state;
  }

  /**
   * Check if the API key is configured.
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Update the API key.
   */
  async setApiKey(key: string): Promise<void> {
    this.apiKey = key;
    const encrypted = await encryptValue(key);
    await setConfig(CONFIG_KEYS.ANTHROPIC_API_KEY, encrypted);
  }

  /**
   * Get current model.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Update the model.
   */
  async setModel(model: string): Promise<void> {
    this.model = model;
    await setConfig(CONFIG_KEYS.MODEL, model);
  }

  /**
   * Get assistant name.
   */
  getAssistantName(): string {
    return this.assistantName;
  }

  /**
   * Update assistant name and trigger pattern.
   */
  async setAssistantName(name: string): Promise<void> {
    this.assistantName = name;
    this.triggerPattern = buildTriggerPattern(name);
    await setConfig(CONFIG_KEYS.ASSISTANT_NAME, name);
  }

  /**
   * Configure Telegram.
   */
  async configureTelegram(token: string, chatIds: string[]): Promise<void> {
    // Telegram support removed
    console.warn('Telegram support has been removed');
  }

  /**
   * Execute a bot workflow - chain multiple bots together.
   */
  async executeWorkflow(workflowId: string, input: string, groupId: string = DEFAULT_GROUP_ID): Promise<void> {
    const { getWorkflow, getBot } = await import('./db.js');
    
    try {
      const workflow = await getWorkflow(workflowId);
      if (!workflow) {
        this.events.emit('error', { groupId, error: 'Workflow not found' });
        return;
      }

      if (!workflow.enabled) {
        this.events.emit('error', { groupId, error: 'Workflow is disabled' });
        return;
      }

      if (workflow.steps.length === 0) {
        this.events.emit('error', { groupId, error: 'Workflow has no steps' });
        return;
      }

      this.setState('thinking');
      this.router.setTyping(groupId, true);
      this.events.emit('typing', { groupId, typing: true });

      let currentInput = input;
      const stepResults: Array<{ step: number; botName: string; output: string }> = [];

      // Execute each step in sequence
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        const bot = await getBot(step.botId);
        
        if (!bot) {
          throw new Error(`Bot not found for step ${i + 1}`);
        }

        // Prepare the prompt for this step
        let stepPrompt = currentInput;
        if (step.prompt) {
          // Replace {input} placeholder with current input
          stepPrompt = step.prompt.replace(/\{input\}/g, currentInput);
        }

        // Show progress
        this.events.emit('tool-activity', {
          groupId,
          tool: `Step ${i + 1}: ${bot.name}`,
          status: 'running',
        });

        // Execute this step
        const stepOutput = await this.executeWorkflowStep(groupId, bot, stepPrompt);
        
        stepResults.push({
          step: i + 1,
          botName: bot.name,
          output: stepOutput,
        });

        // Output becomes input for next step
        currentInput = stepOutput;
      }

      // Build final response with all step results
      const finalResponse = this.buildWorkflowResponse(workflow.name, stepResults);
      
      // Clear typing and tool activity
      this.events.emit('tool-activity', { groupId, tool: '', status: 'done' });
      
      await this.deliverResponse(groupId, finalResponse);

    } catch (err) {
      console.error('Workflow execution failed:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      // Clear typing and tool activity on error
      this.events.emit('tool-activity', { groupId, tool: '', status: 'done' });
      this.events.emit('typing', { groupId, typing: false });
      this.setState('idle');
      this.router.setTyping(groupId, false);
      
      await this.deliverResponse(groupId, `⚠️ Workflow execution failed: ${errorMsg}`);
    }
  }

  /**
   * Execute a single workflow step.
   */
  private async executeWorkflowStep(groupId: string, bot: import('./types.js').BotConfig, prompt: string): Promise<string> {
    const { readGroupFile } = await import('./storage.js');

    // Load group memory
    let memory = '';
    try {
      memory = await readGroupFile(groupId, 'CLAUDE.md');
    } catch {
      // No memory file
    }

    // Load bot knowledge base
    let knowledgeBase = '';
    if (bot.knowledgeBase.length > 0) {
      const knowledgeParts: string[] = [];
      for (const filename of bot.knowledgeBase) {
        try {
          const content = await readGroupFile(groupId, filename);
          knowledgeParts.push(`\n## ${filename}\n\n${content}`);
        } catch (err) {
          console.error(`Failed to load knowledge file ${filename}:`, err);
        }
      }
      if (knowledgeParts.length > 0) {
        knowledgeBase = '\n\n# Knowledge Base\n' + knowledgeParts.join('\n');
      }
    }

    // Build system prompt
    const systemPrompt = buildBotSystemPrompt(bot, memory, knowledgeBase);

    // Create a simple conversation with just the prompt
    const messages: import('./types.js').ConversationMessage[] = [
      { role: 'user', content: prompt },
    ];

    // Call the agent worker and wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.agentWorker.removeEventListener('message', messageHandler);
        reject(new Error('Workflow step timeout'));
      }, 120000); // 2 minute timeout

      const messageHandler = (event: MessageEvent<import('./types.js').WorkerOutbound>) => {
        const msg = event.data;
        
        // Only handle messages for this group
        if (msg.type === 'response' && msg.payload.groupId === groupId) {
          clearTimeout(timeout);
          this.agentWorker.removeEventListener('message', messageHandler);
          resolve(msg.payload.text);
        } else if (msg.type === 'error' && msg.payload.groupId === groupId) {
          clearTimeout(timeout);
          this.agentWorker.removeEventListener('message', messageHandler);
          reject(new Error(msg.payload.error));
        }
        // Ignore other message types (typing, tool-activity, etc.)
      };

      this.agentWorker.addEventListener('message', messageHandler);

      this.agentWorker.postMessage({
        type: 'invoke',
        payload: {
          groupId,
          messages,
          systemPrompt,
          apiKey: this.apiKey,
          model: bot.model,
          maxTokens: bot.maxTokens,
          temperature: bot.temperature,
          topK: bot.topK,
        },
      });
    });
  }

  /**
   * Build the final workflow response showing all steps.
   */
  private buildWorkflowResponse(workflowName: string, stepResults: Array<{ step: number; botName: string; output: string }>): string {
    const parts = [
      `# 🔄 Workflow: ${workflowName}`,
      '',
      `Executed ${stepResults.length} step(s):`,
      '',
    ];

    for (const result of stepResults) {
      parts.push(`## Step ${result.step}: ${result.botName}`);
      parts.push('');
      parts.push(result.output);
      parts.push('');
      parts.push('---');
      parts.push('');
    }

    parts.push(`## ✅ Final Result`);
    parts.push('');
    parts.push(stepResults[stepResults.length - 1].output);

    return parts.join('\n');
  }

  /**
   * Submit a message from the browser chat UI.
   */
  async submitMessage(text: string, groupId?: string, files?: File[], botId?: string | null): Promise<void> {
    // If files are attached, upload them first
    if (files && files.length > 0) {
      const gid = groupId || DEFAULT_GROUP_ID;
      const uploadedFiles: string[] = [];
      
      for (const file of files) {
        try {
          const content = await file.text();
          const filename = file.name;
          await writeGroupFile(gid, filename, content);
          uploadedFiles.push(filename);
        } catch (err) {
          console.error('Failed to upload file:', file.name, err);
        }
      }
      
      // Append file list to message
      if (uploadedFiles.length > 0) {
        const fileList = uploadedFiles.map(f => `- ${f}`).join('\n');
        text = `${text}\n\nUploaded files:\n${fileList}`;
      }
    }
    
    this.browserChat.submit(text, groupId, botId);
  }

  /**
   * Start a completely new session — clears message history for the group.
   */
  async newSession(groupId: string = DEFAULT_GROUP_ID): Promise<void> {
    // Clear messages from DB
    await clearGroupMessages(groupId);
    this.events.emit('session-reset', { groupId });
  }

  /**
   * Compact (summarize) the current context to reduce token usage.
   * Asks Claude to produce a summary, then replaces the history with it.
   */
  async compactContext(groupId: string = DEFAULT_GROUP_ID): Promise<void> {
    if (!this.apiKey) {
      this.events.emit('error', {
        groupId,
        error: 'API key not configured. Cannot compact context.',
      });
      return;
    }

    if (this.state !== 'idle') {
      this.events.emit('error', {
        groupId,
        error: 'Cannot compact while processing. Wait for the current response to finish.',
      });
      return;
    }

    this.setState('thinking');
    this.events.emit('typing', { groupId, typing: true });

    // Load group memory
    let memory = '';
    try {
      memory = await readGroupFile(groupId, 'CLAUDE.md');
    } catch {
      // No memory file yet
    }

    // Get current session ID
    const currentSessionId = (globalThis as any).__currentSessionId || null;

    const messages = await buildConversationMessages(groupId, CONTEXT_WINDOW_SIZE, currentSessionId);
    const systemPrompt = buildSystemPrompt(this.assistantName, memory);

    this.agentWorker.postMessage({
      type: 'compact',
      payload: {
        groupId,
        messages,
        systemPrompt,
        apiKey: this.apiKey,
        model: this.model,
        maxTokens: this.maxTokens,
      },
    });
  }

  /**
   * Shut down everything.
   */
  shutdown(): void {
    this.scheduler.stop();
    this.agentWorker.terminate();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private setState(state: OrchestratorState): void {
    this.state = state;
    this.events.emit('state-change', state);
  }

  private async enqueue(msg: InboundMessage): Promise<void> {
    // Get current session ID from store
    const currentSessionId = (globalThis as any).__currentSessionId || null;
    
    // Save to DB
    const stored: StoredMessage = {
      ...msg,
      isFromMe: false,
      isTrigger: false,
      sessionId: currentSessionId,
    };

    // Check trigger
    const isBrowserMain = msg.groupId === DEFAULT_GROUP_ID;
    const hasTrigger = this.triggerPattern.test(msg.content.trim());

    // Browser main group always triggers; other groups need the trigger pattern
    if (isBrowserMain || hasTrigger) {
      stored.isTrigger = true;
      this.messageQueue.push(msg);
    }

    await saveMessage(stored);
    this.events.emit('message', stored);

    // Update session timestamp
    if (currentSessionId) {
      await updateSessionTimestamp(currentSessionId);
    }

    // Process queue
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    if (this.messageQueue.length === 0) return;
    if (!this.apiKey) {
      // Can't process without API key
      const msg = this.messageQueue.shift()!;
      this.events.emit('error', {
        groupId: msg.groupId,
        error: 'API key not configured. Go to Settings to add your Anthropic API key.',
      });
      return;
    }

    this.processing = true;
    const msg = this.messageQueue.shift()!;

    try {
      await this.invokeAgent(msg.groupId, msg.content, msg.botId);
    } catch (err) {
      console.error('Failed to invoke agent:', err);
    } finally {
      this.processing = false;
      // Process next in queue
      if (this.messageQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  private async invokeAgent(groupId: string, triggerContent: string, botId?: string): Promise<void> {
    // Store the current botId for use in deliverResponse
    this.currentBotId = botId || null;
    
    this.setState('thinking');
    this.router.setTyping(groupId, true);
    this.events.emit('typing', { groupId, typing: true });

    // If this is a scheduled task, save the prompt as a user message so
    // it appears in conversation context and in the chat UI.
    if (triggerContent.startsWith('[SCHEDULED TASK]')) {
      this.pendingScheduledTasks.add(groupId);
      const currentSessionId = (globalThis as any).__currentSessionId || null;
      const stored: StoredMessage = {
        id: ulid(),
        groupId,
        sender: 'Scheduler',
        content: triggerContent,
        timestamp: Date.now(),
        channel: groupId.startsWith('tg:') ? 'telegram' : 'browser',
        isFromMe: false,
        isTrigger: true,
        sessionId: currentSessionId,
      };
      await saveMessage(stored);
      this.events.emit('message', stored);
    }

    // Load bot configuration if specified
    let botConfig = null;
    if (botId) {
      try {
        botConfig = await getBot(botId);
      } catch (err) {
        console.error('Failed to load bot config:', err);
      }
    }

    // Load group memory
    let memory = '';
    try {
      memory = await readGroupFile(groupId, 'CLAUDE.md');
    } catch {
      // No memory file yet — that's fine
    }

    // Load bot knowledge base if available
    let knowledgeBase = '';
    if (botConfig && botConfig.knowledgeBase.length > 0) {
      const knowledgeParts: string[] = [];
      for (const filename of botConfig.knowledgeBase) {
        try {
          const content = await readGroupFile(groupId, filename);
          knowledgeParts.push(`\n## ${filename}\n\n${content}`);
        } catch (err) {
          console.error(`Failed to load knowledge file ${filename}:`, err);
        }
      }
      if (knowledgeParts.length > 0) {
        knowledgeBase = '\n\n# Knowledge Base\n' + knowledgeParts.join('\n');
      }
    }

    // Get current session ID
    const currentSessionId = (globalThis as any).__currentSessionId || null;

    // Build conversation context with session filtering
    const messages = await buildConversationMessages(groupId, CONTEXT_WINDOW_SIZE, currentSessionId);

    // Use bot's system prompt or default
    const systemPrompt = botConfig
      ? buildBotSystemPrompt(botConfig, memory, knowledgeBase)
      : buildSystemPrompt(this.assistantName, memory);

    // Send to agent worker with bot-specific settings
    this.agentWorker.postMessage({
      type: 'invoke',
      payload: {
        groupId,
        messages,
        systemPrompt,
        apiKey: this.apiKey,
        model: botConfig?.model || this.model,
        maxTokens: botConfig?.maxTokens || this.maxTokens,
        temperature: botConfig?.temperature,
        topP: botConfig?.topP,
        topK: botConfig?.topK,
      },
    });
  }

  private async handleWorkerMessage(msg: WorkerOutbound): Promise<void> {
    switch (msg.type) {
      case 'response': {
        const { groupId, text } = msg.payload;
        await this.deliverResponse(groupId, text);
        break;
      }

      case 'task-created': {
        const { task } = msg.payload;
        try {
          await saveTask(task);
        } catch (err) {
          console.error('Failed to save task from agent:', err);
        }
        break;
      }

      case 'error': {
        const { groupId, error } = msg.payload;
        await this.deliverResponse(groupId, `⚠️ Error: ${error}`);
        break;
      }

      case 'typing': {
        const { groupId } = msg.payload;
        this.router.setTyping(groupId, true);
        this.events.emit('typing', { groupId, typing: true });
        break;
      }

      case 'tool-activity': {
        this.events.emit('tool-activity', msg.payload);
        break;
      }

      case 'thinking-log': {
        this.events.emit('thinking-log', msg.payload);
        break;
      }

      case 'compact-done': {
        await this.handleCompactDone(msg.payload.groupId, msg.payload.summary);
        break;
      }

      case 'token-usage': {
        this.events.emit('token-usage', msg.payload);
        break;
      }
    }
  }

  private async handleCompactDone(groupId: string, summary: string): Promise<void> {
    // Clear old messages
    await clearGroupMessages(groupId);

    // Save the summary as a system-style message from the assistant
    const stored: StoredMessage = {
      id: ulid(),
      groupId,
      sender: this.assistantName,
      content: `📝 **Context Compacted**\n\n${summary}`,
      timestamp: Date.now(),
      channel: groupId.startsWith('tg:') ? 'telegram' : 'browser',
      isFromMe: true,
      isTrigger: false,
    };
    await saveMessage(stored);

    this.events.emit('context-compacted', { groupId, summary });
    this.events.emit('typing', { groupId, typing: false });
    this.setState('idle');
  }

  private async deliverResponse(groupId: string, text: string): Promise<void> {
    // Get current session ID from store
    const currentSessionId = (globalThis as any).__currentSessionId || null;
    
    // Get bot name if available
    let senderName = this.assistantName;
    if (this.currentBotId) {
      try {
        const bot = await getBot(this.currentBotId);
        if (bot) {
          senderName = bot.name;
        }
      } catch (err) {
        console.error('Failed to load bot for sender name:', err);
      }
    }
    
    // Save to DB with sessionId and bot name
    const stored: StoredMessage = {
      id: ulid(),
      groupId,
      sender: senderName,
      content: text,
      timestamp: Date.now(),
      channel: groupId.startsWith('tg:') ? 'telegram' : 'browser',
      isFromMe: true,
      isTrigger: false,
      sessionId: currentSessionId,
      botId: this.currentBotId || undefined,
    };
    await saveMessage(stored);

    // Route to channel
    await this.router.send(groupId, text);

    // Play notification chime for scheduled task responses
    if (this.pendingScheduledTasks.has(groupId)) {
      this.pendingScheduledTasks.delete(groupId);
      playNotificationChime();
    }

    // Emit for UI
    this.events.emit('message', stored);
    this.events.emit('typing', { groupId, typing: false });
    
    // Update session timestamp
    if (currentSessionId) {
      await updateSessionTimestamp(currentSessionId);
    }

    this.setState('idle');
    this.router.setTyping(groupId, false);
    
    // Clear current bot after response is delivered
    this.currentBotId = null;
  }
}

function buildSystemPrompt(assistantName: string, memory: string): string {
  const parts = [
    `You are ${assistantName}, a personal AI assistant running in the user's browser.`,
    '',
    'You have access to the following tools:',
    '- **bash**: Execute commands in a sandboxed Linux VM (Alpine). Use for scripts, text processing, package installation.',
    '- **javascript**: Execute JavaScript code. Lighter than bash — no VM boot needed. Use for calculations, data transforms.',
    '- **read_file** / **write_file** / **list_files**: Manage files in the group workspace (persisted in browser storage).',
    '- **fetch_url**: Make HTTP requests (subject to CORS).',
    '- **update_memory**: Persist important context to CLAUDE.md — loaded on every conversation.',
    '- **create_task**: Schedule recurring tasks with cron expressions.',
    '',
    'Guidelines:',
    '- Be concise and direct.',
    '- Use tools proactively when they help answer the question.',
    '- Update memory when you learn important preferences or context.',
    '- For scheduled tasks, confirm the schedule with the user.',
    '- Strip <internal> tags from your responses — they are for your internal reasoning only.',
  ];

  if (memory) {
    parts.push('', '## Persistent Memory', '', memory);
  }

  return parts.join('\n');
}

function buildBotSystemPrompt(bot: import('./types.js').BotConfig, memory: string, knowledgeBase: string): string {
  const parts = [
    bot.systemPrompt,
    '',
  ];

  // Add knowledge base FIRST so it's prominent
  if (knowledgeBase) {
    parts.push('# Your Knowledge Base', '');
    parts.push('The following documents have been provided to you as your knowledge base. Use this information to answer questions:');
    parts.push('', knowledgeBase, '');
    parts.push('**IMPORTANT**: All the information you need is provided above in your knowledge base. You do NOT need to use file tools to access it.');
    parts.push('');
  }

  parts.push(
    'You have access to the following tools:',
    '- **bash**: Execute commands in a sandboxed Linux VM (Alpine). Use for scripts, text processing, package installation.',
    '- **javascript**: Execute JavaScript code. Lighter than bash — no VM boot needed. Use for calculations, data transforms.',
    '- **read_file** / **write_file** / **list_files**: Manage files in the group workspace (persisted in browser storage).',
    '- **fetch_url**: Make HTTP requests (subject to CORS).',
    '- **update_memory**: Persist important context to CLAUDE.md — loaded on every conversation.',
    '- **create_task**: Schedule recurring tasks with cron expressions.',
    '',
    '**File Access Guidelines**:',
    '- Your knowledge base is already loaded above - do NOT use read_file to access it',
    '- Only use file tools if the user explicitly asks you to read/write/list files',
    '- Do NOT explore the workspace unless specifically requested',
  );

  if (memory) {
    parts.push('', '## Persistent Memory', '', memory);
  }

  return parts.join('\n');
}

function playNotificationChime(): void {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Two-tone chime: C5 → E5
    const frequencies = [523.25, 659.25];
    for (let i = 0; i < frequencies.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = frequencies[i];

      gain.gain.setValueAtTime(0.3, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.4);
    }

    // Clean up context after sounds finish
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // AudioContext may not be available — fail silently
  }
}
