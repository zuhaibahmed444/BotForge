import { useState, useEffect } from 'react';
import { MessageSquare, Plus, Trash2, Bot, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import type { ChatSession, BotConfig } from '../../types.js';
import { getAllChatSessions, deleteChatSession, getBot } from '../../db.js';

interface Props {
  currentSessionId: string | null;
  onClose?: () => void;
}

export function ChatHistory({ currentSessionId, onClose }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [bots, setBots] = useState<Map<string, BotConfig>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    loadSessions();
  }, [currentSessionId]);

  async function loadSessions() {
    setLoading(true);
    try {
      const allSessions = await getAllChatSessions();
      setSessions(allSessions);

      // Load bot info for each session
      const botMap = new Map<string, BotConfig>();
      for (const session of allSessions) {
        if (session.botId && !botMap.has(session.botId)) {
          const bot = await getBot(session.botId);
          if (bot) botMap.set(session.botId, bot);
        }
      }
      setBots(botMap);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(sessionId: string) {
    try {
      await deleteChatSession(sessionId);
      setDeleteConfirm(null);
      loadSessions();
      
      // If deleting current session, redirect to new chat
      if (sessionId === currentSessionId) {
        navigate('/chat');
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }

  function handleNewChat() {
    navigate('/chat');
    onClose?.();
  }

  function handleSelectSession(session: ChatSession) {
    if (session.botId) {
      navigate(`/chat?bot=${session.botId}&session=${session.id}`);
    } else {
      navigate(`/chat?session=${session.id}`);
    }
    onClose?.();
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <div className="flex flex-col h-full bg-base-200 border-r border-base-300">
      {/* Header */}
      <div className="p-4 border-b border-base-300 flex items-center justify-between">
        <h2 className="font-bold">Chat History</h2>
        {onClose && (
          <button className="btn btn-ghost btn-sm btn-circle" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* New Chat Button */}
      <div className="p-2">
        <button
          className="btn btn-primary btn-sm w-full gap-2"
          onClick={handleNewChat}
        >
          <Plus className="w-4 h-4" />
          New Chat
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="loading loading-spinner loading-sm" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 opacity-60">
            <MessageSquare className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">No chat history yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => {
              const bot = session.botId ? bots.get(session.botId) : null;
              const isActive = session.id === currentSessionId;

              return (
                <div
                  key={session.id}
                  className={`card card-compact bg-base-100 hover:bg-base-300 cursor-pointer transition-colors ${
                    isActive ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => handleSelectSession(session)}
                >
                  <div className="card-body p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {bot ? (
                            <Bot className="w-3 h-3 text-primary shrink-0" />
                          ) : (
                            <MessageSquare className="w-3 h-3 shrink-0" />
                          )}
                          <h3 className="font-medium text-sm truncate">
                            {session.title}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 text-xs opacity-60">
                          <span>{formatDate(session.updatedAt)}</span>
                          {session.messageCount > 0 && (
                            <>
                              <span>•</span>
                              <span>{session.messageCount} msgs</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(session.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg">Delete Chat?</h3>
            <p className="py-4">
              Are you sure you want to delete this chat? All messages will be permanently removed.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-error"
                onClick={() => handleDelete(deleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setDeleteConfirm(null)}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
