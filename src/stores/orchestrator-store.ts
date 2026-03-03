import { create } from 'zustand';
import type {
  StoredMessage,
  OrchestratorState,
  TokenUsage,
  ThinkingLogEntry,
} from '../types.js';
import type { Orchestrator } from '../orchestrator.js';
import { DEFAULT_GROUP_ID } from '../config.js';
import { getRecentMessages, getSessionMessages } from '../db.js';

interface OrchestratorStoreState {
  // --- reactive state ---
  messages: StoredMessage[];
  isTyping: boolean;
  toolActivity: { tool: string; status: string } | null;
  activityLog: ThinkingLogEntry[];
  state: OrchestratorState;
  tokenUsage: TokenUsage | null;
  error: string | null;
  activeGroupId: string;
  ready: boolean;
  selectedBotId: string | null;
  currentSessionId: string | null;

  // --- actions ---
  sendMessage: (text: string, files?: File[]) => void;
  executeWorkflow: (workflowId: string, input: string) => Promise<void>;
  newSession: () => Promise<void>;
  compactContext: () => Promise<void>;
  clearError: () => void;
  loadHistory: () => Promise<void>;
  selectBot: (botId: string | null) => void;
  setCurrentSession: (sessionId: string | null) => void;
}

let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
  if (!orchestratorInstance) throw new Error('Orchestrator not initialized');
  return orchestratorInstance;
}

export const useOrchestratorStore = create<OrchestratorStoreState>((set, get) => ({
  messages: [],
  isTyping: false,
  toolActivity: null,
  activityLog: [],
  state: 'idle',
  tokenUsage: null,
  error: null,
  activeGroupId: DEFAULT_GROUP_ID,
  ready: false,
  selectedBotId: null,
  currentSessionId: null,

  sendMessage: (text, files) => {
    const orch = getOrchestrator();
    const botId = get().selectedBotId;
    // Store bot ID globally for orchestrator access
    (globalThis as any).__currentBotId = botId;
    orch.submitMessage(text, get().activeGroupId, files, botId);
  },

  executeWorkflow: async (workflowId, input) => {
    const orch = getOrchestrator();
    await orch.executeWorkflow(workflowId, input, get().activeGroupId);
  },

  newSession: async () => {
    const orch = getOrchestrator();
    await orch.newSession(get().activeGroupId);
  },

  compactContext: async () => {
    const orch = getOrchestrator();
    await orch.compactContext(get().activeGroupId);
  },

  clearError: () => set({ error: null }),

  loadHistory: async () => {
    const sessionId = get().currentSessionId;
    if (sessionId) {
      // Load messages for specific session
      const msgs = await getSessionMessages(sessionId);
      set({ messages: msgs });
    } else {
      // Load recent messages (legacy behavior)
      const msgs = await getRecentMessages(get().activeGroupId, 200);
      set({ messages: msgs });
    }
  },

  selectBot: (botId) => {
    set({ selectedBotId: botId });
    // Store bot ID globally for orchestrator access
    (globalThis as any).__currentBotId = botId;
  },

  setCurrentSession: (sessionId) => {
    set({ currentSessionId: sessionId, messages: [] });
    // Store globally for orchestrator access
    (globalThis as any).__currentSessionId = sessionId;
    // Load messages for this session
    if (sessionId) {
      getSessionMessages(sessionId).then((msgs) => {
        set({ messages: msgs });
      });
    }
  },
}));

/**
 * Initialize the store with an Orchestrator instance.
 * Subscribes to all EventBus events and bridges them to Zustand state.
 */
export async function initOrchestratorStore(orch: Orchestrator): Promise<void> {
  orchestratorInstance = orch;
  const store = useOrchestratorStore;

  // Subscribe to events
  orch.events.on('message', (msg) => {
    // Only add message if it belongs to current session or no session is active
    const currentSessionId = store.getState().currentSessionId;
    if (!currentSessionId || msg.sessionId === currentSessionId) {
      store.setState((s) => ({ messages: [...s.messages, msg] }));
    }
  });

  orch.events.on('typing', ({ typing }) => {
    store.setState({ isTyping: typing });
  });

  orch.events.on('tool-activity', ({ tool, status }) => {
    store.setState({
      toolActivity: status === 'running' ? { tool, status } : null,
    });
  });

  orch.events.on('thinking-log', (entry) => {
    store.setState((s) => {
      // Reset log when a new invocation starts
      if (entry.kind === 'info' && entry.label === 'Starting') {
        return { activityLog: [entry] };
      }
      return { activityLog: [...s.activityLog, entry] };
    });
  });

  orch.events.on('state-change', (state) => {
    store.setState({ state });
    if (state === 'idle') {
      store.setState({ toolActivity: null });
    }
  });

  orch.events.on('error', ({ error }) => {
    store.setState({ error });
  });

  orch.events.on('session-reset', () => {
    store.setState({
      messages: [],
      activityLog: [],
      tokenUsage: null,
      toolActivity: null,
      isTyping: false,
    });
  });

  orch.events.on('context-compacted', () => {
    // Reload history after compaction
    store.getState().loadHistory();
  });

  orch.events.on('token-usage', (usage) => {
    store.setState({ tokenUsage: usage });
  });

  orch.events.on('ready', () => {
    store.setState({ ready: true });
  });

  // Load initial history
  await store.getState().loadHistory();
}
