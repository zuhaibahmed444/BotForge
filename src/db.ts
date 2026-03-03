import { DB_NAME, DB_VERSION } from './config.js';
import type { StoredMessage, Task, ConfigEntry, Session, ConversationMessage, BotConfig, ChatSession, BotWorkflow } from './types.js';

let db: IDBDatabase | null = null;

/**
 * Close the current database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Open (or create) the IndexedDB database.
 */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      // Messages store
      if (!database.objectStoreNames.contains('messages')) {
        const msgStore = database.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-group-time', ['groupId', 'timestamp']);
        msgStore.createIndex('by-group', 'groupId');
      }

      // Sessions store (conversation state per group)
      if (!database.objectStoreNames.contains('sessions')) {
        database.createObjectStore('sessions', { keyPath: 'groupId' });
      }

      // Tasks store (scheduled tasks)
      if (!database.objectStoreNames.contains('tasks')) {
        const taskStore = database.createObjectStore('tasks', { keyPath: 'id' });
        taskStore.createIndex('by-group', 'groupId');
        taskStore.createIndex('by-enabled', 'enabled');
      }

      // Config store (key-value)
      if (!database.objectStoreNames.contains('config')) {
        database.createObjectStore('config', { keyPath: 'key' });
      }

      // Bots store (custom bot configurations)
      if (!database.objectStoreNames.contains('bots')) {
        const botStore = database.createObjectStore('bots', { keyPath: 'id' });
        botStore.createIndex('by-enabled', 'enabled');
        botStore.createIndex('by-created', 'createdAt');
      }

      // Chat sessions store (multi-chat support)
      if (!database.objectStoreNames.contains('chat_sessions')) {
        const sessionStore = database.createObjectStore('chat_sessions', { keyPath: 'id' });
        sessionStore.createIndex('by-updated', 'updatedAt');
        sessionStore.createIndex('by-bot', 'botId');
        sessionStore.createIndex('by-group', 'groupId');
      }

      // Bot workflows store (bot orchestration)
      if (!database.objectStoreNames.contains('bot_workflows')) {
        const workflowStore = database.createObjectStore('bot_workflows', { keyPath: 'id' });
        workflowStore.createIndex('by-enabled', 'enabled');
        workflowStore.createIndex('by-created', 'createdAt');
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
  });
}

function getDb(): IDBDatabase {
  if (!db) throw new Error('Database not initialized. Call openDatabase() first.');
  return db;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function txPromise<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txPromiseAll<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>[],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const requests = fn(store);
    const results: T[] = new Array(requests.length);
    let completed = 0;
    for (let i = 0; i < requests.length; i++) {
      requests[i].onsuccess = () => {
        results[i] = requests[i].result;
        if (++completed === requests.length) resolve(results);
      };
      requests[i].onerror = () => reject(requests[i].error);
    }
    if (requests.length === 0) resolve([]);
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export function saveMessage(msg: StoredMessage): Promise<void> {
  return txPromise('messages', 'readwrite', (store) =>
    store.put(msg),
  ).then(() => undefined);
}

export function getRecentMessages(
  groupId: string,
  limit: number,
): Promise<StoredMessage[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('by-group-time');
    const range = IDBKeyRange.bound([groupId, 0], [groupId, Infinity]);
    const request = index.openCursor(range, 'prev');
    const results: StoredMessage[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        // Reverse so oldest first
        resolve(results.reverse());
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export function getMessageCount(groupId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('by-group');
    const request = index.count(groupId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getAllGroupIds(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('by-group');
    const request = index.openKeyCursor(null, 'nextunique');
    const ids: string[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        ids.push(cursor.key as string);
        cursor.continue();
      } else {
        resolve(ids);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function getSession(groupId: string): Promise<Session | undefined> {
  return txPromise('sessions', 'readonly', (store) =>
    store.get(groupId),
  );
}

export function saveSession(session: Session): Promise<void> {
  return txPromise('sessions', 'readwrite', (store) =>
    store.put(session),
  ).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function saveTask(task: Task): Promise<void> {
  // Store `enabled` as 0/1 so the IndexedDB 'by-enabled' index works
  // (IDB exact-match key queries don't equate boolean true with number 1).
  const record = { ...task, enabled: task.enabled ? 1 : 0 };
  return txPromise('tasks', 'readwrite', (store) =>
    store.put(record),
  ).then(() => undefined);
}

export function deleteTask(id: string): Promise<void> {
  return txPromise('tasks', 'readwrite', (store) =>
    store.delete(id),
  ).then(() => undefined);
}

export function getEnabledTasks(): Promise<Task[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('tasks', 'readonly');
    const store = tx.objectStore('tasks');
    const index = store.index('by-enabled');
    const request = index.getAll(1); // enabled = true (stored as 1 via saveTask)
    request.onsuccess = () => {
      // Convert numeric `enabled` back to boolean for the rest of the app
      const tasks = (request.result as any[]).map((t) => ({ ...t, enabled: true }));
      resolve(tasks);
    };
    request.onerror = () => reject(request.error);
  });
}

export function getAllTasks(): Promise<Task[]> {
  return txPromise('tasks', 'readonly', (store) =>
    store.getAll(),
  ).then((tasks: any[]) =>
    tasks.map((t) => ({ ...t, enabled: !!t.enabled })),
  );
}

export function updateTaskLastRun(id: string, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const task = getReq.result as Task | undefined;
      if (!task) { resolve(); return; }
      task.lastRun = timestamp;
      const putReq = store.put(task);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getConfig(key: string): Promise<string | undefined> {
  return txPromise('config', 'readonly', (store) =>
    store.get(key),
  ).then((entry: ConfigEntry | undefined) => entry?.value);
}

export function setConfig(key: string, value: string): Promise<void> {
  return txPromise('config', 'readwrite', (store) =>
    store.put({ key, value } as ConfigEntry),
  ).then(() => undefined);
}

export function deleteConfig(key: string): Promise<void> {
  return txPromise('config', 'readwrite', (store) =>
    store.delete(key),
  ).then(() => undefined);
}

export function getAllConfig(): Promise<ConfigEntry[]> {
  return txPromise('config', 'readonly', (store) =>
    store.getAll(),
  );
}

/**
 * Delete all messages for a given group.
 */
export function clearGroupMessages(groupId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    const index = store.index('by-group');
    const request = index.openCursor(groupId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Build conversation messages for Claude API from stored messages
// ---------------------------------------------------------------------------

export async function buildConversationMessages(
  groupId: string,
  limit: number,
  sessionId?: string,
): Promise<ConversationMessage[]> {
  let messages: StoredMessage[];
  
  if (sessionId) {
    // Get messages for specific session
    messages = await getSessionMessages(sessionId);
    // Apply limit if needed
    if (messages.length > limit) {
      messages = messages.slice(-limit);
    }
  } else {
    // Legacy: get recent messages by groupId
    messages = await getRecentMessages(groupId, limit);
  }
  
  return messages.map((m) => ({
    role: m.isFromMe ? ('assistant' as const) : ('user' as const),
    content: m.isFromMe ? m.content : `${m.sender}: ${m.content}`,
  }));
}

// ---------------------------------------------------------------------------
// Bot operations
// ---------------------------------------------------------------------------

export async function saveBot(bot: BotConfig): Promise<void> {
  await txPromise('bots', 'readwrite', (store) => store.put(bot));
}

export function getBot(id: string): Promise<BotConfig | undefined> {
  return txPromise('bots', 'readonly', (store) => store.get(id));
}

export async function getAllBots(): Promise<BotConfig[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('bots', 'readonly');
    const store = tx.objectStore('bots');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getEnabledBots(): Promise<BotConfig[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('bots', 'readonly');
    const store = tx.objectStore('bots');
    const index = store.index('by-enabled');
    const request = index.getAll(IDBKeyRange.only(true));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBot(id: string): Promise<void> {
  await txPromise('bots', 'readwrite', (store) => store.delete(id));
}

// ---------------------------------------------------------------------------
// Chat session operations
// ---------------------------------------------------------------------------

export async function saveChatSession(session: ChatSession): Promise<void> {
  await txPromise('chat_sessions', 'readwrite', (store) => store.put(session));
}

export function getChatSession(id: string): Promise<ChatSession | undefined> {
  return txPromise('chat_sessions', 'readonly', (store) => store.get(id));
}

export async function getAllChatSessions(): Promise<ChatSession[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('chat_sessions', 'readonly');
    const store = tx.objectStore('chat_sessions');
    const index = store.index('by-updated');
    const request = index.getAll();
    request.onsuccess = () => {
      // Sort by updatedAt descending (most recent first)
      const sessions = request.result.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteChatSession(id: string): Promise<void> {
  await txPromise('chat_sessions', 'readwrite', (store) => store.delete(id));
}

export async function getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const request = store.getAll();
    request.onsuccess = () => {
      const messages = request.result.filter((msg: StoredMessage) => msg.sessionId === sessionId);
      messages.sort((a, b) => a.timestamp - b.timestamp);
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateSessionTimestamp(sessionId: string): Promise<void> {
  const session = await getChatSession(sessionId);
  if (session) {
    session.updatedAt = Date.now();
    await saveChatSession(session);
  }
}

// ---------------------------------------------------------------------------
// Bot workflow operations
// ---------------------------------------------------------------------------

export async function saveWorkflow(workflow: BotWorkflow): Promise<void> {
  await txPromise('bot_workflows', 'readwrite', (store) => store.put(workflow));
}

export function getWorkflow(id: string): Promise<BotWorkflow | undefined> {
  return txPromise('bot_workflows', 'readonly', (store) => store.get(id));
}

export async function getAllWorkflows(): Promise<BotWorkflow[]> {
  return new Promise((resolve, reject) => {
    const tx = getDb().transaction('bot_workflows', 'readonly');
    const store = tx.objectStore('bot_workflows');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  await txPromise('bot_workflows', 'readwrite', (store) => store.delete(id));
}


// ---------------------------------------------------------------------------
// Database management
// ---------------------------------------------------------------------------

/**
 * Delete the entire database and reload the page.
 * Use this to force a clean database upgrade.
 */
export async function resetDatabase(): Promise<void> {
  closeDatabase();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      console.log('Database deleted successfully');
      resolve();
    };
    request.onerror = () => {
      console.error('Failed to delete database:', request.error);
      reject(request.error);
    };
    request.onblocked = () => {
      console.warn('Database deletion blocked - close all tabs');
      reject(new Error('Database deletion blocked'));
    };
  });
}
