import os
import subprocess
import shutil
import json
import time
import urllib.request
from pathlib import Path

from backend.database.core import save_fts_document

DB_ROOT = Path(r"d:\Content OS\database")
ASSETS_VAULT_VIDEOS = DB_ROOT / "assets_vault" / "videos"
ASSETS_VAULT_HYPERFRAMES = DB_ROOT / "assets_vault" / "hyperframes"
ASSETS_HYPERFRAMES_DIR = ASSETS_VAULT_HYPERFRAMES
PROJECT_VAULT_ASSETS = DB_ROOT / "project_vault" / "assets"

ASSETS_VAULT_VIDEOS.mkdir(parents=True, exist_ok=True)
ASSETS_VAULT_HYPERFRAMES.mkdir(parents=True, exist_ok=True)
PROJECT_VAULT_ASSETS.mkdir(parents=True, exist_ok=True)

HYPERFRAMES_PORT = 3002
STUDIO_PROJECT_DIR = DB_ROOT / "hyperframes_studio"
STUDIO_PROJECT_DIR.mkdir(parents=True, exist_ok=True)
SERVER_PROCESS = None


def check_hyperframes_server_status() -> dict:
    """Checks if the local npx hyperframes preview server is active on port 3002."""
    try:
        req = urllib.request.urlopen(f"http://localhost:{HYPERFRAMES_PORT}", timeout=2)
        if req.status == 200:
            return {"status": "online", "port": HYPERFRAMES_PORT, "url": f"http://localhost:{HYPERFRAMES_PORT}"}
    except Exception:
        pass
    return {"status": "offline", "port": HYPERFRAMES_PORT, "url": f"http://localhost:{HYPERFRAMES_PORT}"}


def start_hyperframe_studio_server() -> dict:
    """Launches npx hyperframes preview in background on port 3002."""
    global SERVER_PROCESS
    status = check_hyperframes_server_status()
    if status["status"] == "online":
        return {"status": "already_running", "port": HYPERFRAMES_PORT, "url": f"http://localhost:{HYPERFRAMES_PORT}"}

    try:
        root_dir = Path(__file__).resolve().parent.parent.parent
        local_bin = root_dir / "node_modules" / ".bin" / ("hyperframes.cmd" if os.name == "nt" else "hyperframes")
        
        if local_bin.exists():
            cmd = [str(local_bin), "preview", f"--port={HYPERFRAMES_PORT}", "--no-open"]
        else:
            cmd = [
                "npx.cmd" if os.name == "nt" else "npx",
                "hyperframes",
                "preview",
                f"--port={HYPERFRAMES_PORT}",
                "--no-open"
            ]

        SERVER_PROCESS = subprocess.Popen(
            cmd,
            cwd=str(STUDIO_PROJECT_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        )
        return {"status": "started", "port": HYPERFRAMES_PORT, "url": f"http://localhost:{HYPERFRAMES_PORT}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}



def save_hyperframe_render(title: str, template_type: str, aspect_ratio: str, html_content: str, config: dict = None) -> dict:
    """Legacy helper for saving hyperframe metadata cards."""
    render_id = f"hf_{int(time.time())}"
    filename = f"{render_id}.json"
    filepath = ASSETS_HYPERFRAMES_DIR / filename
    
    data = {
        "id": render_id,
        "title": title,
        "template_type": template_type,
        "aspect_ratio": aspect_ratio,
        "html_content": html_content,
        "config": config or {},
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        
    save_fts_document(
        doc_id=f"hyperframe_{render_id}",
        category="hyperframes",
        title=f"Hyperframe Asset: {title}",
        content=f"Template: {template_type}, Ratio: {aspect_ratio}. {html_content[:300]}",
        filepath=str(filepath)
    )
    return data


def delete_hyperframe_render(render_id: str) -> bool:
    """Legacy helper for deleting hyperframe metadata card."""
    filepath = ASSETS_HYPERFRAMES_DIR / f"{render_id}.json"
    if filepath.exists():
        filepath.unlink()
        return True
    return False


def render_hyperframe_mp4(project_name: str, composition: str = "index.html") -> dict:
    """Invokes npx hyperframes render to compile HTML composition into real MP4 video in Assets Vault."""
    render_id = f"render_{int(time.time())}"
    output_filename = f"{project_name}_{render_id}.mp4"
    output_path = ASSETS_VAULT_VIDEOS / output_filename
    project_vault_target = PROJECT_VAULT_ASSETS / output_filename
    studio_dir = DB_ROOT / "hyperframes_studio"

    cmd = [
        "npx.cmd" if os.name == "nt" else "npx",
        "hyperframes",
        "render",
        "-o",
        str(output_path)
    ]

    try:
        result = subprocess.run(
            cmd,
            cwd=str(Path(r"d:\Content OS")),
            capture_output=True,
            text=True,
            timeout=120
        )
        
        # Backup render metadata file
        meta = {
            "id": render_id,
            "project_name": project_name,
            "filename": output_filename,
            "path": str(output_path),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stdout": result.stdout,
            "stderr": result.stderr
        }

        meta_path = ASSETS_HYPERFRAMES_DIR / f"{render_id}.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        # Index in FTS5 Search Database
        save_fts_document(
            doc_id=f"hyperframe_{render_id}",
            category="hyperframes",
            title=f"Hyperframe Video Render: {project_name}",
            content=f"Rendered HeyGen Hyperframe MP4 video {output_filename}. Standard 1080p composition.",
            filepath=str(output_path)
        )

        # Mirror copy to Project Vault Assets
        if output_path.exists():
            shutil.copy(output_path, project_vault_target)

        return {
            "status": "success",
            "render_id": render_id,
            "output_path": str(output_path),
            "filename": output_filename
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


def list_hyperframe_renders() -> list:
    """Returns list of rendered hyperframes stored in database/assets/hyperframes/."""
    renders = []
    if ASSETS_HYPERFRAMES_DIR.exists():
        for p in ASSETS_HYPERFRAMES_DIR.glob("*.json"):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    renders.append(meta)
            except Exception:
                pass
    renders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return renders
