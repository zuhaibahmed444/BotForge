# BotForge

Browser-native AI assistant powered by the Anthropic Claude API. Runs entirely in your browser — no backend server required. Your data stays local using IndexedDB and the Origin Private File System (OPFS).

## Features

- **Chat with Claude** — conversational AI with full markdown rendering, code highlighting, and multi-session support
- **Custom Bots** — create specialized bots with custom system prompts, knowledge bases, and tunable model parameters (temperature, top-p, top-k)
- **Bot Workflows** — chain multiple bots together in sequential pipelines, passing output from one step as input to the next
- **Tool Use** — Claude can use built-in tools:
  - `bash` — sandboxed shell emulator (grep, sed, awk, jq, and 30+ commands) running against OPFS
  - `javascript` — execute JS in a sandboxed context
  - `read_file` / `write_file` / `list_files` — manage files in the browser workspace
  - `fetch_url` — make HTTP requests (subject to CORS)
  - `update_memory` — persistent memory via CLAUDE.md loaded on every conversation
  - `create_task` — schedule recurring tasks with cron expressions
- **File Management** — upload, browse, and manage workspace files stored in OPFS
- **Scheduled Tasks** — cron-based task scheduler that runs prompts on a schedule with notification chimes
- **Context Compaction** — summarize long conversations to reduce token usage while preserving context
- **Document Export** — export chat messages as DOCX or PDF with full markdown formatting (headings, tables, code blocks, lists)
- **Encrypted API Key Storage** — API keys are encrypted with a non-extractable AES-256-GCM key stored in IndexedDB
- **PWA Support** — installable as a Progressive Web App with offline caching and standalone mode
- **Dark/Light Themes** — via DaisyUI theme system

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 |
| Language | TypeScript (strict mode) |
| Build Tool | Vite 6 |
| Styling | Tailwind CSS 4 + DaisyUI 5 |
| State Management | Zustand |
| Routing | React Router 7 |
| Markdown | react-markdown, remark-gfm, rehype-highlight, rehype-sanitize |
| Document Export | docx (DOCX generation), jsPDF (PDF generation) |
| File Import | mammoth (DOCX reading), pdfjs-dist (PDF reading) |
| Icons | Lucide React |
| Storage | IndexedDB + Origin Private File System (OPFS) |
| AI | Anthropic Claude API (called directly from the browser via Web Worker) |
| PWA | vite-plugin-pwa + Workbox |

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, go to Settings, and add your Anthropic API key.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript type checking |

## Architecture

- **Orchestrator** (`src/orchestrator.ts`) — central event-driven coordinator that manages message routing, agent invocation, and workflow execution
- **Agent Worker** (`src/agent-worker.ts`) — Web Worker that handles Claude API calls off the main thread
- **Shell Emulator** (`src/shell.ts`) — in-browser bash emulator with 30+ commands operating on OPFS
- **Storage** (`src/storage.ts`) — OPFS-based file system for per-group workspaces
- **Database** (`src/db.ts`) — IndexedDB layer for messages, sessions, bots, workflows, tasks, and config
- **Router** (`src/router.ts`) — routes outbound messages to the correct channel based on group ID prefix

## License

Private
