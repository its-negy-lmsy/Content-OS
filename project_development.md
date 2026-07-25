# Content OS — Technical Architecture & Development Documentation

Welcome to the comprehensive technical documentation for **Content OS**, a local-first, privacy-focused, professional content engineering & AI control room.

---

## 1. Executive Summary & Core Philosophy

**Content OS** is designed for creators, developers, and media engineers who require an all-in-one local command center to manage content strategy, production pipelines, knowledge bases, and multi-agent AI execution without relying on cloud lock-in.

### Key Pillars:
- **Local-First & Private**: Powered by local Python FastAPI services, 9router OpenAI endpoints (`http://localhost:20128/v1`), Hermes CLI subprocesses, and local Markdown (`.md`) / JSON data storage.
- **Sleek Charcoal & Electric Orange Aesthetics**: High-contrast dark charcoal interface (`#090a0f`, `#18181b`) with energetic electric orange accents (`#ff5500`, `#ff7700`).
- **End-to-End Media Pipeline**: Seamlessly bridges the gap between raw topic discovery, research aggregation, scriptwriting, visual prompt generation, voice synthesis, and publishing.

---

## 2. System Architecture

Content OS is built using a decoupled **Client-Server Architecture**:

```
+-----------------------------------------------------------------------------------+
|                                 FRONTEND WORKSPACE                                 |
|                       Astro 4 + TypeScript + LiteGraph.js                         |
|                               (http://localhost:4321)                             |
|                                                                                   |
|  [Sidebar Nav] [Dashboard] [Projects Vault] [Knowledge Vault] [Workflow Canvas]  |
|  [AI Agent Studio] [Media Studios] [Integrations] [System Logs]                   |
+------------------------------------------+----------------------------------------+
                                           | HTTP / REST API (JSON)
                                           v
+-----------------------------------------------------------------------------------+
|                                  BACKEND ENGINE                                   |
|                             FastAPI + Python 3.11+                                |
|                               (http://localhost:8000)                             |
|                                                                                   |
|  - Agent Execution Engine (9router API, Hermes CLI, Ollama REST)                  |
|  - Workflow Pipeline Graph Executor                                              |
|  - Vault File System Manager (Markdown Tree & Wiki Parsing)                      |
|  - Live Tech News / Web RSS Aggregator                                           |
+------------------------------------------+----------------------------------------+
                                           | Local Filesystem Read / Write
                                           v
+-----------------------------------------------------------------------------------+
|                                LOCAL STORAGE LAYER                                |
|  data/                                                                            |
|  ├── projects/ (project_manifest.json)                                            |
|  ├── wiki/research/ (*.md notes & subfolders)                                     |
|  ├── agent_memory/ (session-*.json conversation files)                           |
|  ├── activity.json & schedule.json                                                |
+-----------------------------------------------------------------------------------+
```

---

## 3. Core Feature Systems

### 3.1 Dashboard & Command Room (`#v-dashboard`)
- **Header & Control Bar**: Displays user greeting (`Good evening, Negy`) and real-time backend connection status (`System Operational`).
- **Quick Topic Generation Bar**: Type a topic (e.g., `"Building an AI Content Engine"`) to generate an instant production pack.
- **Metrics Summary Grid**: Active projects count, total research notes, generated scripts, and published assets.
- **Active Projects & Activity Log**: Live cards linked to Kanban stages and real-time audit logs of backend operations.

### 3.2 Projects Vault (`#v-projects`)
- **Dual View Modes**:
  - **Kanban Board View**: Drag and drop cards across 5 production stages (`Idea / Backlog`, `Scripting`, `Production`, `Editing & Review`, `Published`).
  - **Grid View**: Clean card layout displaying project priority badges (`Low`, `Medium`, `High`), target platform tags (`YouTube`, `Shorts`, `Blog`, `Podcast`), and release dates.
- **Project Detail Drawer**: Slide-over panel for editing title, stage, priority, description notes, and linked assets.

### 3.3 Knowledge Vault — Obsidian Studio (`#v-research`)
- **Left Ribbon**: File Explorer, Graph View, Search, Canvas, Bookmarks.
- **Vault Tree Explorer**: Full recursive file and folder tree rendering with custom context menus (`New note`, `New folder`, `Copy path`, `Rename`, `Delete`).
- **Dual-Mode Editor**:
  - **Live Code Editor**: Markdown editing with auto-save.
  - **Rendered Preview Mode**: GitHub-flavored markdown preview with syntax highlighting and interactive `[[WikiLinks]]`.
- **Canvas Graph View**: Interactive LiteGraph / HTML Canvas network visualizer mapping links between notes.

### 3.4 Workflow Canvas Engine (`#v-canvas`)
- **Custom Visual Node Graph**:
  - 6 pipeline node modules: `Topic Input`, `Research Ingestion`, `Script Generator`, `Visual Prompts`, `Voice Synthesizer`, and `Publish Gate`.
  - SVG Bezier curve connection wires with glowing electric orange stroke gradients (`#ff5500`).
- **Node Inspector Drawer**: Live inspection of node status (`WAITING`, `RUNNING`, `DONE`), parameters, and output text previews.
- **Full Pipeline Execution (`▶ Run Full Pipeline`)**: Sequential execution engine triggering backend `/api/pipeline/execute` to generate complete production packs saved directly to Projects Vault.

### 3.5 AI Agent Studio (`#v-agents`)
- **5 Specialized Agent Personas**:
  - 🎯 **Content OS Master**: Master orchestrator for strategy & Vault synthesis.
  - ✍️ **Scriptwriter Agent**: Video hooks, narrative arcs, and CTAs.
  - 🔍 **Research Analyst**: Knowledge Vault reference ingest & trend extraction.
  - 🎨 **Visual Prompt Crafter**: Flux & Midjourney prompts.
  - 📈 **SEO & Packaging Agent**: High-CTR video titles, descriptions, and tag sets.
- **Multi-Runner Execution Cascade**:
  1. **9router Endpoint (`http://localhost:20128/v1/chat/completions`)**: OpenAI-compatible local model router.
  2. **Hermes CLI Subprocess (`hermes -z "<prompt>"`)**: Direct background execution of local Hermes CLI tool.
  3. **Ollama Local REST (`http://localhost:11434/api/generate`)**: Local Llama 3 connection.
  4. **Live Web Scraper**: Fetches real live headlines from HackerNews RSS when requested.
- **Persistent Multi-Turn Session Memory**:
  - Saved chat sessions (`data/agent_memory/<session_id>.json`).
  - Session history sidebar (`+ New Conversation`, saved threads list, session deletion).
- **Interactive Output Action Buttons**:
  - 📥 **Save to Knowledge Vault**: One-click creation of `.md` notes in `data/wiki/research/agent-outputs/`.
  - 🚀 **Create Project**: One-click creation of Kanban cards in Projects Vault.

---

## 4. Technology Stack & Directory Structure

### Technology Stack:
- **Frontend**: Astro 4.x, TypeScript, Vanilla CSS (Design Tokens & CSS Variables), Phosphor Icons, LiteGraph.js.
- **Backend Engine**: FastAPI, Uvicorn, Python 3.11+, Pydantic.
- **AI / Model Adapters**: 9router (`http://localhost:20128/v1`), Hermes CLI (`hermes -z`), Ollama REST API.

### Directory Structure:
```
Content OS/
├── backend/
│   ├── main.py              # Main FastAPI application & API endpoints
│   └── requirements.txt     # Python backend dependencies
├── data/
│   ├── projects/            # Project manifests & JSON records
│   ├── wiki/research/       # Markdown notes & Knowledge Vault tree
│   └── agent_memory/        # Multi-turn chat session memory JSON files
├── src/
│   ├── layouts/
│   │   └── BaseLayout.astro # Base HTML layout & font imports
│   ├── pages/
│   │   └── index.astro      # Main single-page application views
│   ├── scripts/
│   │   └── dashboard.ts     # Core frontend UI & API interaction logic
│   └── styles/
│       └── global.css       # Complete dark charcoal design system & utility classes
├── astro.config.mjs         # Astro framework configuration
├── package.json             # Node.js dependencies & scripts
└── project_development.md   # System documentation (this file)
```

---

## 5. API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health check endpoint returning backend status |
| `GET` | `/api/dashboard/stats` | Summary statistics for projects, notes, and activity |
| `GET` | `/api/projects` | List all projects in Projects Vault |
| `POST` | `/api/projects` | Create a new project |
| `PUT` | `/api/projects/{id}` | Update project stage, priority, or details |
| `DELETE` | `/api/projects/{id}` | Delete a project card |
| `GET` | `/api/wiki/tree` | Fetch recursive directory tree of Knowledge Vault notes |
| `GET` | `/api/wiki/file` | Read raw Markdown file content |
| `POST` | `/api/wiki/file` | Create or update a Markdown note |
| `DELETE` | `/api/wiki/file` | Delete a note or directory from Knowledge Vault |
| `GET` | `/api/agents/roles` | List available AI agent personas |
| `GET` | `/api/agents/sessions` | List saved conversation sessions |
| `GET` | `/api/agents/sessions/{id}` | Read conversation session history |
| `DELETE` | `/api/agents/sessions/{id}` | Delete a conversation session |
| `POST` | `/api/agents/chat` | Execute prompt via 9router / Hermes CLI with memory |
| `POST` | `/api/pipeline/execute` | Run full workflow canvas node execution |

---

## 6. Setup & Verification Guide

### 1. Backend Setup:
```bash
# Create virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install backend dependencies
pip install -r backend/requirements.txt

# Start FastAPI server (Port 8000)
python -m uvicorn backend.main:app --reload --port 8000
```

### 2. Frontend Setup:
```bash
# Install node dependencies
npm install

# Start Astro dev server (Port 4321)
npm run dev

# Run TypeScript type check
npm run check

# Build production bundle
npm run build
```

---
*Documentation updated as of July 2026 for Content OS v0.1.0.*
