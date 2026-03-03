import { useEffect, useState } from 'react';
import { Bot, Plus, Edit, Trash2, Copy, Power, PowerOff, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { BotConfig } from '../../types.js';
import { getAllBots, saveBot, deleteBot } from '../../db.js';
import { ulid } from '../../ulid.js';
import { BotEditor } from './BotEditor';

export function BotsPage() {
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBot, setEditingBot] = useState<BotConfig | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadBots();
  }, []);

  async function loadBots() {
    setLoading(true);
    try {
      const allBots = await getAllBots();
      setBots(allBots);
    } catch (err) {
      console.error('Failed to load bots:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleCreateNew() {
    setCreatingNew(true);
    setEditingBot({
      id: ulid(),
      name: 'New Bot',
      description: '',
      systemPrompt: 'You are a helpful AI assistant.',
      knowledgeBase: [],
      model: 'claude-sonnet-4-6',
      temperature: 1.0,
      topP: 1.0,
      topK: 0,
      maxTokens: 8096,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function handleSave(bot: BotConfig) {
    try {
      await saveBot(bot);
      setEditingBot(null);
      setCreatingNew(false);
      loadBots();
    } catch (err) {
      console.error('Failed to save bot:', err);
      alert('Failed to save bot');
    }
  }

  async function handleToggleEnabled(bot: BotConfig) {
    try {
      await saveBot({ ...bot, enabled: !bot.enabled, updatedAt: Date.now() });
      loadBots();
    } catch (err) {
      console.error('Failed to toggle bot:', err);
    }
  }

  async function handleDuplicate(bot: BotConfig) {
    const newBot: BotConfig = {
      ...bot,
      id: ulid(),
      name: `${bot.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await saveBot(newBot);
      loadBots();
    } catch (err) {
      console.error('Failed to duplicate bot:', err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteBot(id);
      setDeleteConfirm(null);
      loadBots();
    } catch (err) {
      console.error('Failed to delete bot:', err);
    }
  }

  if (editingBot) {
    return (
      <BotEditor
        bot={editingBot}
        isNew={creatingNew}
        onSave={handleSave}
        onCancel={() => {
          setEditingBot(null);
          setCreatingNew(false);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-300 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Custom Bots</h1>
          <p className="text-sm opacity-60">Create specialized bots with custom knowledge and settings</p>
        </div>
        <button className="btn btn-primary gap-2" onClick={handleCreateNew}>
          <Plus className="w-4 h-4" />
          New Bot
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : bots.length === 0 ? (
          <div className="hero py-12">
            <div className="hero-content text-center">
              <div>
                <Bot className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <h2 className="text-2xl font-bold">No bots yet</h2>
                <p className="mt-2 opacity-60 mb-6">
                  Create custom bots with specialized knowledge and behavior
                </p>
                <button className="btn btn-primary gap-2" onClick={handleCreateNew}>
                  <Plus className="w-4 h-4" />
                  Create Your First Bot
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bots.map((bot) => (
              <div
                key={bot.id}
                className={`card bg-base-200 shadow-sm ${
                  !bot.enabled ? 'opacity-60' : ''
                }`}
              >
                <div className="card-body p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Bot className="w-5 h-5 shrink-0" />
                      <h3 className="font-bold truncate">{bot.name}</h3>
                    </div>
                    <button
                      className={`btn btn-ghost btn-xs btn-circle ${
                        bot.enabled ? 'text-success' : 'text-error'
                      }`}
                      onClick={() => handleToggleEnabled(bot)}
                      title={bot.enabled ? 'Disable' : 'Enable'}
                    >
                      {bot.enabled ? (
                        <Power className="w-4 h-4" />
                      ) : (
                        <PowerOff className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {bot.description && (
                    <p className="text-sm opacity-70 line-clamp-2">{bot.description}</p>
                  )}

                  <div className="flex flex-wrap gap-1 mt-2">
                    <div className="badge badge-sm">{bot.model}</div>
                    <div className="badge badge-sm">Temp: {bot.temperature}</div>
                    {bot.knowledgeBase.length > 0 && (
                      <div className="badge badge-sm badge-primary">
                        {bot.knowledgeBase.length} docs
                      </div>
                    )}
                  </div>

                  {/* Primary Chat Button */}
                  <button
                    className="btn btn-primary btn-sm w-full gap-2 mt-3"
                    onClick={() => {
                      // Create a new session ID for fresh chat
                      const newSessionId = ulid();
                      navigate(`/chat?bot=${bot.id}&session=${newSessionId}`);
                    }}
                    disabled={!bot.enabled}
                  >
                    <MessageSquare className="w-4 h-4" />
                    Chat with {bot.name}
                  </button>

                  <div className="card-actions justify-end mt-2">
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={() => setEditingBot(bot)}
                    >
                      <Edit className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      onClick={() => handleDuplicate(bot)}
                    >
                      <Copy className="w-3 h-3" />
                      Duplicate
                    </button>
                    <button
                      className="btn btn-ghost btn-xs gap-1 text-error"
                      onClick={() => setDeleteConfirm(bot.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-sm">
            <h3 className="font-bold text-lg">Delete Bot?</h3>
            <p className="py-4">
              Are you sure you want to delete this bot? This action cannot be undone.
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
