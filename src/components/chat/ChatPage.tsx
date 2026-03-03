import { useEffect, useRef, useState } from 'react';
import { X, MessageSquare, Globe, FileText, MapPin, Bot as BotIcon, Menu, History, Workflow } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useOrchestratorStore } from '../../stores/orchestrator-store.js';
import { MessageList } from './MessageList.js';
import { ChatInput } from './ChatInput.js';
import { TypingIndicator } from './TypingIndicator.js';
import { ToolActivity } from './ToolActivity.js';
import { ActivityLog } from './ActivityLog.js';
import { ContextBar } from './ContextBar.js';
import { ChatActions } from './ChatActions.js';
import { ChatHistory } from './ChatHistory.js';
import { getBot, getChatSession, saveChatSession, getSessionMessages } from '../../db.js';
import type { BotConfig, ChatSession } from '../../types.js';
import { ulid } from '../../ulid.js';
import { DEFAULT_GROUP_ID } from '../../config.js';

const LineGraphIcon = ({ className }: { className?: string }) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 3 5-7" />
    </svg>
);

const PROMPT_STARTERS = [
    {
        icon: Globe,
        title: 'Latest news',
        prompt: 'Get me the top trending posts from HackerNews.',
    },
    {
        icon: LineGraphIcon,
        title: 'Generate a report',
        prompt: 'Show me a graph with the Ethereum price over the last 6 months.',
    },
    {
        icon: MapPin,
        title: 'Map viewer',
        prompt: 'Generate an interactive map viewer with the top locations to visit in Seattle.',
    },
];

export function ChatPage() {
  const [searchParams] = useSearchParams();
  const botIdFromUrl = searchParams.get('bot');
  const sessionIdFromUrl = searchParams.get('session');
  const workflowIdFromUrl = searchParams.get('workflow');
  
  const messages = useOrchestratorStore((s) => s.messages);
  const isTyping = useOrchestratorStore((s) => s.isTyping);
  const toolActivity = useOrchestratorStore((s) => s.toolActivity);
  const activityLog = useOrchestratorStore((s) => s.activityLog);
  const orchState = useOrchestratorStore((s) => s.state);
  const tokenUsage = useOrchestratorStore((s) => s.tokenUsage);
  const error = useOrchestratorStore((s) => s.error);
  const sendMessage = useOrchestratorStore((s) => s.sendMessage);
  const loadHistory = useOrchestratorStore((s) => s.loadHistory);
  const selectBot = useOrchestratorStore((s) => s.selectBot);
  const executeWorkflow = useOrchestratorStore((s) => s.executeWorkflow);
  const setCurrentSession = useOrchestratorStore((s) => s.setCurrentSession);
  const currentSessionId = useOrchestratorStore((s) => s.currentSessionId);

  const [currentBot, setCurrentBot] = useState<BotConfig | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [currentWorkflow, setCurrentWorkflow] = useState<import('../../types.js').BotWorkflow | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Initialize or load session
  useEffect(() => {
    async function initSession() {
      let session: ChatSession | undefined;

      if (sessionIdFromUrl) {
        // Try to load existing session
        session = await getChatSession(sessionIdFromUrl);
        if (session) {
          // Existing session found - load it
          setCurrentSession(session.id);
          // Also set the bot if session has one
          if (session.botId) {
            selectBot(session.botId);
            const bot = await getBot(session.botId);
            if (bot) setCurrentBot(bot);
          }
          return;
        } else {
          // Session ID in URL but doesn't exist - create new session with this ID
          if (botIdFromUrl || workflowIdFromUrl) {
            const bot = botIdFromUrl ? await getBot(botIdFromUrl) : null;
            const workflow = workflowIdFromUrl ? await import('../../db.js').then(({ getWorkflow }) => getWorkflow(workflowIdFromUrl)) : null;
            
            let title = 'Chat';
            if (workflow) {
              title = `Chat - ${workflow.name}`;
            } else if (bot) {
              title = `Chat with ${bot.name}`;
            }
            
            session = {
              id: sessionIdFromUrl, // Use the ID from URL
              title,
              botId: botIdFromUrl || null,
              groupId: DEFAULT_GROUP_ID,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messageCount: 0,
            };
            await saveChatSession(session);
            setCurrentSession(session.id);
            if (bot) setCurrentBot(bot);
            if (workflow) setCurrentWorkflow(workflow);
            return;
          }
        }
      }

      // No session ID in URL - create a new one for main assistant, bot, or workflow
      const bot = botIdFromUrl ? await getBot(botIdFromUrl) : null;
      const workflow = workflowIdFromUrl ? await import('../../db.js').then(({ getWorkflow }) => getWorkflow(workflowIdFromUrl)) : null;
      
      let title = 'Chat';
      if (workflow) {
        title = `Chat - ${workflow.name}`;
      } else if (bot) {
        title = `Chat with ${bot.name}`;
      }
      
      session = {
        id: ulid(),
        title,
        botId: botIdFromUrl || null,
        groupId: DEFAULT_GROUP_ID,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      };
      await saveChatSession(session);
      setCurrentSession(session.id);
      if (bot) setCurrentBot(bot);
      if (workflow) setCurrentWorkflow(workflow);
    }

    initSession();
  }, [sessionIdFromUrl, botIdFromUrl, workflowIdFromUrl, selectBot, setCurrentSession]);

  // Load bot config when URL changes
  useEffect(() => {
    if (botIdFromUrl) {
      selectBot(botIdFromUrl);
      getBot(botIdFromUrl).then((bot) => {
        if (bot) setCurrentBot(bot);
      });
    } else {
      selectBot(null);
      setCurrentBot(null);
    }
  }, [botIdFromUrl, selectBot]);

  // Load workflow config when URL changes
  useEffect(() => {
    if (workflowIdFromUrl) {
      import('../../db.js').then(({ getWorkflow }) => {
        getWorkflow(workflowIdFromUrl).then((workflow) => {
          if (workflow) setCurrentWorkflow(workflow);
        });
      });
    } else {
      setCurrentWorkflow(null);
    }
  }, [workflowIdFromUrl]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <div className="flex h-full">
      {/* History Sidebar - Desktop */}
      {showHistory && (
        <div className="hidden md:block w-64 shrink-0">
          <ChatHistory
            currentSessionId={currentSessionId}
            onClose={() => setShowHistory(false)}
          />
        </div>
      )}

      {/* History Sidebar - Mobile (Overlay) */}
      {showHistory && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/50" onClick={() => setShowHistory(false)}>
          <div className="w-64 h-full" onClick={(e) => e.stopPropagation()}>
            <ChatHistory
              currentSessionId={currentSessionId}
              onClose={() => setShowHistory(false)}
            />
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Workflow Header - Show when executing a workflow */}
        {currentWorkflow && !currentBot && (
          <div className="px-4 py-3 border-b border-base-300 bg-base-200">
            <div className="flex items-center gap-3">
              <button
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setShowHistory(!showHistory)}
                title="Toggle History"
              >
                <History className="w-5 h-5" />
              </button>
              <Workflow className="w-5 h-5 text-secondary" />
              <div className="flex-1 min-w-0">
                <h2 className="font-bold truncate">🔄 {currentWorkflow.name}</h2>
                {currentWorkflow.description && (
                  <p className="text-xs opacity-60 truncate">{currentWorkflow.description}</p>
                )}
              </div>
              <div className="flex gap-1">
                <div className="badge badge-sm badge-secondary">
                  {currentWorkflow.steps.length} steps
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bot Header - Show when chatting with a custom bot */}
        {currentBot && (
          <div className="px-4 py-3 border-b border-base-300 bg-base-200">
            <div className="flex items-center gap-3">
              <button
                className="btn btn-ghost btn-sm btn-circle md:hidden"
                onClick={() => setShowHistory(!showHistory)}
                title="Chat History"
              >
                <History className="w-5 h-5" />
              </button>
              <button
                className="hidden md:block btn btn-ghost btn-sm btn-circle"
                onClick={() => setShowHistory(!showHistory)}
                title="Toggle History"
              >
                <History className="w-5 h-5" />
              </button>
              <BotIcon className="w-5 h-5 text-primary" />
              <div className="flex-1 min-w-0">
                <h2 className="font-bold truncate">{currentBot.name}</h2>
                {currentBot.description && (
                  <p className="text-xs opacity-60 truncate">{currentBot.description}</p>
                )}
              </div>
              <div className="flex gap-1">
                <div className="badge badge-sm">{currentBot.model}</div>
                {currentBot.knowledgeBase.length > 0 && (
                  <div className="badge badge-sm badge-primary">
                    {currentBot.knowledgeBase.length} docs
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Default Header - Show when no bot selected */}
        {!currentBot && (
          <div className="px-4 py-3 border-b border-base-300 bg-base-200">
            <div className="flex items-center gap-3">
              <button
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setShowHistory(!showHistory)}
                title="Toggle History"
              >
                <History className="w-5 h-5" />
              </button>
              <h2 className="font-bold">Chat</h2>
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.length === 0 && !isTyping && (
          <div className="hero min-h-full">
            <div className="hero-content text-center">
              <div className="max-w-md">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <h2 className="text-2xl font-bold">Start a conversation</h2>
                <p className="mt-2 opacity-60 mb-6">Try one of these to get started</p>
                <div className="grid gap-3">
                  {PROMPT_STARTERS.map(({ icon: Icon, title, prompt }) => (
                    <button
                      key={title}
                      className="card card-bordered bg-base-200 hover:bg-base-300 transition-colors cursor-pointer text-left"
                      onClick={() => sendMessage(prompt)}
                    >
                      <div className="card-body p-4 flex-row items-center gap-3">
                        <Icon className="w-5 h-5 opacity-60 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{title}</div>
                          <div className="text-xs opacity-50 truncate">{prompt}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <MessageList messages={messages} />

        {isTyping && <TypingIndicator />}
        {toolActivity && (
          <ToolActivity tool={toolActivity.tool} status={toolActivity.status} />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Bottom bar */}
      <div className="border-t border-base-300 bg-base-100">
        {/* Activity log (collapsible) */}
        {activityLog.length > 0 && <ActivityLog entries={activityLog} />}

        {/* Context / token usage bar */}
        {tokenUsage && <ContextBar usage={tokenUsage} />}

        {/* Compact / New Session actions */}
        <ChatActions disabled={orchState !== 'idle'} />

        {/* Error display */}
        {error && (
          <div className="px-4 pb-2">
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => useOrchestratorStore.getState().clearError()}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <ChatInput
          onSend={(text, files) => {
            if (currentWorkflow) {
              executeWorkflow(currentWorkflow.id, text);
            } else {
              sendMessage(text, files);
            }
          }}
          disabled={orchState !== 'idle'}
        />
      </div>
    </div>
    </div>
  );
}
