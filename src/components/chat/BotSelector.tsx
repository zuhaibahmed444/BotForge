import { useState, useEffect } from 'react';
import { Bot, ChevronDown, Check } from 'lucide-react';
import type { BotConfig } from '../../types.js';
import { getEnabledBots } from '../../db.js';

interface Props {
  selectedBotId: string | null;
  onSelectBot: (botId: string | null) => void;
}

export function BotSelector({ selectedBotId, onSelectBot }: Props) {
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBots();
  }, []);

  async function loadBots() {
    try {
      const enabledBots = await getEnabledBots();
      setBots(enabledBots);
    } catch (err) {
      console.error('Failed to load bots:', err);
    } finally {
      setLoading(false);
    }
  }

  const selectedBot = bots.find((b) => b.id === selectedBotId);

  if (loading) {
    return (
      <div className="px-4 py-2 border-b border-base-300 bg-base-200">
        <div className="flex items-center gap-2">
          <span className="loading loading-spinner loading-xs" />
          <span className="text-sm opacity-60">Loading bots...</span>
        </div>
      </div>
    );
  }

  if (bots.length === 0) {
    return null; // No bots available, use default
  }

  return (
    <div className="px-4 py-2 border-b border-base-300 bg-base-200">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 opacity-60" />
        <span className="text-sm opacity-60">Bot:</span>
        <div className="dropdown dropdown-hover">
          <label
            tabIndex={0}
            className="btn btn-sm btn-ghost gap-2 normal-case font-normal"
          >
            <span className="font-medium">
              {selectedBot ? selectedBot.name : 'Default Assistant'}
            </span>
            <ChevronDown className="w-3 h-3" />
          </label>
          <ul
            tabIndex={0}
            className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-64 z-[100] max-h-96 overflow-y-auto mt-1"
          >
            <li>
              <a
                onClick={(e) => {
                  e.preventDefault();
                  onSelectBot(null);
                  // Close dropdown
                  (document.activeElement as HTMLElement)?.blur();
                }}
                className={selectedBotId === null ? 'active' : ''}
              >
                <div className="flex items-center justify-between flex-1">
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4" />
                    <div>
                      <div className="font-medium">Default Assistant</div>
                      <div className="text-xs opacity-60">Standard BotForge Assistant</div>
                    </div>
                  </div>
                  {selectedBotId === null && <Check className="w-4 h-4" />}
                </div>
              </a>
            </li>
            <li className="menu-title">
              <span>Custom Bots</span>
            </li>
            {bots.map((bot) => (
              <li key={bot.id}>
                <a
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectBot(bot.id);
                    // Close dropdown
                    (document.activeElement as HTMLElement)?.blur();
                  }}
                  className={selectedBotId === bot.id ? 'active' : ''}
                >
                  <div className="flex items-center justify-between flex-1">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      <div>
                        <div className="font-medium">{bot.name}</div>
                        {bot.description && (
                          <div className="text-xs opacity-60 line-clamp-1">
                            {bot.description}
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedBotId === bot.id && <Check className="w-4 h-4" />}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
