# Content OS

Local-first command center for research, content projects, AI-runner discovery, and transparent production workflows.

## Quick Start (Single Command)

Run the entire application (FastAPI backend + Astro frontend + HyperFrames Studio) with a single command:

```powershell
.\content os
# OR
npm start
```

This automatically spins up the backend (port 8000), frontend (port 4321), background services, and opens `http://localhost:4321` in your browser.

### Manual / Developer Setup

1. Create and activate virtual environment & install requirements:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   ```
2. Install frontend dependencies:
   ```powershell
   npm install
   ```
3. Run single command launcher:
   ```powershell
   .\content os
   ```

All generated research and project documents live under `data/` as Markdown and JSON. The folder is intentionally ignored by Git: your ideas stay local by default.

## v0 boundaries

- The workflow only runs after you press **Build project pack**.
- It creates structured briefs and folders; it does not pretend to publish or create a finished video automatically.
- Competitor collection is for public/authorized sources. Connectors for captions and metadata can be added next, with rate limits and source attribution.
