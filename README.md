# Content OS

Local-first command center for research, content projects, AI-runner discovery, and transparent production workflows.

## Start it

1. Create and activate a Python virtual environment, then install the backend:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r backend\requirements.txt
   uvicorn backend.main:app --reload --port 8000
   ```
2. In another terminal, install and run the Astro shell:
   ```powershell
   npm install
   npm run dev
   ```
3. Open `http://localhost:4321`.

All generated research and project documents live under `data/` as Markdown and JSON. The folder is intentionally ignored by Git: your ideas stay local by default.

## v0 boundaries

- The workflow only runs after you press **Build project pack**.
- It creates structured briefs and folders; it does not pretend to publish or create a finished video automatically.
- Competitor collection is for public/authorized sources. Connectors for captions and metadata can be added next, with rate limits and source attribution.
