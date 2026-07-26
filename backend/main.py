from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import urllib.request
import urllib.error
from datetime import UTC, datetime
from pathlib import Path
import sys

import os

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

CACHE_DIR = ROOT / "database" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
os.environ["HF_HOME"] = str(CACHE_DIR / "huggingface")
os.environ["TORCH_HOME"] = str(CACHE_DIR / "torch")
os.environ["PIP_CACHE_DIR"] = str(CACHE_DIR / "pip")
os.environ["TRANSFORMERS_CACHE"] = str(CACHE_DIR / "huggingface")

from typing import Literal, Optional, overload, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, HttpUrl

from backend.logger import (  # type: ignore
    push_log,
    get_recent_logs,
    clear_logs,
    log_stream_generator,
    SystemLogHandler,
)

from backend.database.core import (  # type: ignore
    DB_DIR,
    SYSTEM_DB_PATH,
    PROJECT_VAULT_DIR,
    KNOWLEDGE_VAULT_DIR,
    AGENT_MEMORY_DIR,
    SETTINGS_DIR,
    init_database_structure,
    search_universal_index,
)
from backend.database.agent_memory import (  # type: ignore
    save_agent_session_memory,
    get_agent_session_memory,
    list_agent_sessions,
)
from backend.database.vault import (  # type: ignore
    list_knowledge_vault_tree,
    read_vault_file,
    write_vault_file,
    list_projects,
)
from backend.database.hyperframe import (  # type: ignore
    check_hyperframes_server_status,
    start_hyperframe_studio_server,
    render_hyperframe_mp4,
    list_hyperframe_renders,
    save_hyperframe_render,
    delete_hyperframe_render,
)
from backend.database.assets_vault import (  # type: ignore
    list_assets_vault_contents,
    create_custom_assets_folder,
    save_imported_asset_file,
    delete_vault_asset_file,
)
from backend.tts_engine import list_available_voices, generate_tts_audio  # type: ignore
from backend.database.tts_studio import check_chatterbox_server_status, start_chatterbox_server  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
DB_ROOT = ROOT / "database"
PROJECTS = PROJECT_VAULT_DIR
WIKI = KNOWLEDGE_VAULT_DIR
AGENT_MEMORY = AGENT_MEMORY_DIR
SETTINGS = SETTINGS_DIR / "settings.json"
ACTIVITIES = SETTINGS_DIR / "activity.json"
SCHEDULE = SETTINGS_DIR / "schedule.json"

# Initialize Universal Database Structure
init_database_structure()

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Hook python logging
    root_logger = logging.getLogger()
    root_logger.addHandler(SystemLogHandler())
    push_log("SUCCESS", "SYSTEM", "Backend FastAPI server started successfully.")
    
    try:
        start_hyperframe_studio_server()
        push_log("INFO", "HYPERFRAME", "HyperFrame studio auto-start initiated.")
    except Exception as e:
        push_log("WARN", "HYPERFRAME", f"Hyperframe server auto-start warning: {e}")
    yield

app = FastAPI(title="Content OS Local API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4321", "http://127.0.0.1:4321", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


import time

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - start_time) * 1000)
    
    path = request.url.path
    if not (
        path.startswith("/api/system/logs")
        or path.startswith("/api/tts/server/status")
        or path.startswith("/api/pipeline/status")
        or path == "/health"
    ):
        level = "ERROR" if response.status_code >= 400 else "INFO"
        push_log(level, "API", f"{request.method} {path} -> {response.status_code} ({duration_ms}ms)")
        
    return response





# ==================== SYSTEM LOGS API ====================
@app.get("/api/system/logs")
def get_logs(limit: int = 200) -> dict:
    return {"logs": get_recent_logs(limit=limit)}


@app.get("/api/system/logs/stream")
async def stream_logs():
    return StreamingResponse(log_stream_generator(), media_type="text/event-stream")


@app.delete("/api/system/logs")
def clear_system_logs() -> dict:
    clear_logs()
    push_log("INFO", "SYSTEM", "System log buffer cleared.")
    return {"status": "cleared"}


# Mount static Assets Vault directory
assets_vault_dir = DB_ROOT / "assets_vault"
assets_vault_dir.mkdir(parents=True, exist_ok=True)
app.mount("/assets-vault-static", StaticFiles(directory=str(assets_vault_dir)), name="assets_vault_static")


# ==================== HEYGEN HYPERFRAMES STUDIO API ====================
@app.get("/api/hyperframe/server/status")
def hyperframe_status() -> dict:
    return check_hyperframes_server_status()


@app.post("/api/hyperframe/server/start")
def hyperframe_start() -> dict:
    return start_hyperframe_studio_server()


@app.post("/api/hyperframe/render-mp4")
def hyperframe_render_mp4_endpoint(payload: dict) -> dict:
    project_name = payload.get("project_name", "hyperframe-project")
    composition = payload.get("composition", "index.html")
    return render_hyperframe_mp4(project_name=project_name, composition=composition)


@app.get("/api/hyperframe/renders")
def hyperframe_renders() -> list:
    return list_hyperframe_renders()


@app.post("/api/hyperframe/save")
def hyperframe_save(payload: dict) -> dict:
    title = payload.get("title", "Untitled Hyperframe")
    template_type = payload.get("template_type", "custom")
    aspect_ratio = payload.get("aspect_ratio", "16:9")
    html_content = payload.get("html_content", "")
    config = payload.get("config", {})
    return save_hyperframe_render(title, template_type, aspect_ratio, html_content, config)


@app.delete("/api/hyperframe/render/{render_id}")
def hyperframe_delete(render_id: str) -> dict:
    success = delete_hyperframe_render(render_id)
    if not success:
        raise HTTPException(status_code=404, detail="Render not found")
    return {"status": "success", "id": render_id}


from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form


# ==================== ASSETS VAULT API ====================
@app.get("/api/assets-vault/tree")
def assets_vault_tree() -> dict:
    return list_assets_vault_contents()


@app.get("/api/assets-vault/stream/{rel_path:path}")
def assets_vault_stream(rel_path: str):
    file_path = assets_vault_dir / rel_path
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Asset file not found")
    return FileResponse(str(file_path))


@app.post("/api/assets-vault/folder")
def assets_vault_create_folder(payload: dict) -> dict:
    folder_name = payload.get("name", "")
    return create_custom_assets_folder(folder_name)


@app.post("/api/assets-vault/upload")
async def assets_vault_upload_file(file: UploadFile = File(...), category: str = Form("imports")) -> dict:
    content = await file.read()
    return save_imported_asset_file(file.filename or "file", content, category=category)


@app.delete("/api/assets-vault/file")
def assets_vault_delete_file(path: str = "") -> dict:
    result = delete_vault_asset_file(path)
    if result.get("status") == "error":
        raise HTTPException(status_code=404, detail=result.get("message", "File not found"))
    return result


class TTSGenerateInput(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    voice_id: str = "chatterbox-female-1"
    speed: float = Field(default=1.0, ge=0.25, le=3.0)
    pitch: float = Field(default=0.0, ge=-50.0, le=50.0)


# ==================== TTS STUDIO API (CHATTERBOX TTS) ====================
@app.get("/api/tts/server/status")
def tts_server_status() -> dict:
    return check_chatterbox_server_status()


@app.post("/api/tts/server/start")
def tts_server_start() -> dict:
    return start_chatterbox_server()


@app.get("/api/tts/voices")
def tts_voices() -> dict:
    return {"voices": list_available_voices()}


@app.post("/api/tts/generate")
def tts_generate(payload: TTSGenerateInput) -> dict:
    return generate_tts_audio(
        text=payload.text,
        voice_id=payload.voice_id,
        speed=payload.speed,
        pitch=payload.pitch
    )


@app.get("/api/tts/history")
def tts_history() -> dict:
    audio_files = []
    audio_dir = DB_ROOT / "assets_vault" / "audio"
    if audio_dir.exists():
        for p in sorted(audio_dir.glob("*.wav"), key=lambda x: x.stat().st_mtime, reverse=True):
            stat = p.stat()
            rel_path = f"audio/{p.name}"
            audio_files.append({
                "filename": p.name,
                "rel_path": rel_path,
                "abs_path": str(p),
                "stream_url": f"/api/assets-vault/stream/{rel_path}",
                "size_bytes": stat.st_size,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.localtime(stat.st_mtime))
            })
    return {"items": audio_files}




class RunnerSettings(BaseModel):
    kind: Literal["cli", "endpoint", "byok"] = "cli"
    runner: str = ""
    endpoint: str = ""
    model: str = ""


class ResearchInput(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    notes: str = Field(min_length=10, max_length=20000)
    source_url: HttpUrl | None = None
    source_type: Literal["video", "article", "post", "idea"] = "idea"


class ProjectInput(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    channel: str = Field(default="Main channel", min_length=2, max_length=80)
    format: str = Field(default="YouTube video", min_length=2, max_length=80)
    topic: str = Field(min_length=3, max_length=300)
    angle: str = Field(default="", max_length=1000)


class ChatInput(BaseModel):
    prompt: str = Field(min_length=1, max_length=10000)
    kind: Literal["cli", "endpoint", "byok"] = "cli"
    runner: str = "codex"
    endpoint: str = ""
    model: str = ""
    project_id: str | None = None


class FileUpdateInput(BaseModel):
    content: str


class TaskInput(BaseModel):
    time: str = "10:00"
    title: str = Field(min_length=2, max_length=160)
    detail: str = ""


def now() -> str:
    return datetime.now(UTC).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:72] or "untitled"


@overload
def safe_read_json(path: Path, default: dict) -> dict: ...
@overload
def safe_read_json(path: Path, default: list) -> list: ...
def safe_read_json(path: Path, default: dict | list) -> dict | list:
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, type(default)):
                return data
        except Exception:
            pass
    return default


def write_json(path: Path, content: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content, indent=2), encoding="utf-8")


def log_activity(action: str, title: str, detail: str = "") -> None:
    activities = safe_read_json(ACTIVITIES, [])
    if not isinstance(activities, list):
        activities = []
    activities.insert(0, {
        "id": f"act-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
        "action": action,
        "title": title,
        "detail": detail,
        "timestamp": now()
    })
    write_json(ACTIVITIES, activities[:30])


def get_default_schedule() -> list[dict]:
    return [
        {"id": "t1", "time": "10:00", "title": "Script Review", "detail": "The Anatomy of Focus", "done": True},
        {"id": "t2", "time": "12:30", "title": "Voice Generation", "detail": "AI That Thinks In Pictures", "done": True},
        {"id": "t3", "time": "15:00", "title": "Render Queue", "detail": "2 videos pending", "done": False},
        {"id": "t4", "time": "18:00", "title": "Publish", "detail": "The Focus Paradox", "done": False},
    ]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "storage": str(DB_ROOT)}


@app.get("/api/system/stats")
def system_stats() -> dict:
    projects_list = list_projects()
    active_projects = len(projects_list)
    in_progress = sum(1 for p in projects_list if isinstance(p, dict) and p.get("stage") in ["Idea", "Research", "Scripting", "In Production"])
    
    # Calculate total generated asset files
    assets_count = 0
    if PROJECTS.exists():
        for p in PROJECTS.glob("**/*"):
            if p.is_file() and p.name != "project.json":
                assets_count += 1

    research_count = len(list(WIKI.glob("*.md"))) if WIKI.exists() else 0
    runners = discover_runners()["runners"]
    
    return {
        "active_projects": active_projects,
        "in_progress": in_progress,
        "assets_generated": assets_count,
        "knowledge_notes": research_count,
        "active_runners_count": len(runners),
        "runners": runners,
        "storage_dir": str(DB_ROOT),
        "status": "operational",
    }


@app.get("/api/activity")
def get_activities() -> dict:
    activities = safe_read_json(ACTIVITIES, [])
    if not activities:
        # Seed default initial activities
        seed = [
            {"id": "a1", "action": "Script.md updated", "title": "The Anatomy of Focus", "detail": "Drafted hook & outline", "timestamp": now()},
            {"id": "a2", "action": "Research.md created", "title": "AI That Thinks In Pictures", "detail": "Added source takeaways", "timestamp": now()},
            {"id": "a3", "action": "Assets generated", "title": "Scene 03 - AI Visual", "detail": "Prompts compiled", "timestamp": now()},
        ]
        write_json(ACTIVITIES, seed)
        activities = seed
    return {"activities": activities}


@app.get("/api/overview/today")
def get_today_schedule() -> dict:
    if not SCHEDULE.exists():
        schedule = get_default_schedule()
        write_json(SCHEDULE, schedule)
    else:
        schedule = safe_read_json(SCHEDULE, [])
    return {"schedule": schedule}


@app.post("/api/overview/today")
def add_today_task(task: TaskInput) -> dict:
    schedule = safe_read_json(SCHEDULE, [])
    if not isinstance(schedule, list):
        schedule = []
    new_task = {
        "id": f"task-{datetime.now().strftime('%M%S%f')}",
        "time": task.time,
        "title": task.title,
        "detail": task.detail,
        "done": False
    }
    schedule.append(new_task)
    write_json(SCHEDULE, schedule)
    log_activity("Schedule updated", task.title, f"Task scheduled for {task.time}")
    return {"task": new_task, "schedule": schedule}


@app.put("/api/overview/today/{task_id}")
def toggle_today_task(task_id: str) -> dict:
    schedule = safe_read_json(SCHEDULE, [])
    if isinstance(schedule, list):
        for t in schedule:
            if t.get("id") == task_id:
                t["done"] = not t.get("done", False)
                write_json(SCHEDULE, schedule)
                log_activity("Task status updated", t.get("title", "Task"), f"Marked {'done' if t['done'] else 'pending'}")
                return {"task": t, "schedule": schedule}
    raise HTTPException(status_code=404, detail="Task not found")


# ==================== HEYGEN HYPERFRAMES ENGINE API ====================

@app.get("/api/hyperframe/server/status")
def hyperframe_server_status() -> dict:
    return check_hyperframes_server_status()


@app.post("/api/hyperframe/server/start")
def hyperframe_server_start() -> dict:
    return start_hyperframe_studio_server()


@app.post("/api/hyperframe/render-mp4")
def hyperframe_render_video(payload: dict) -> dict:
    project_name = payload.get("project_name", "hyperframe_composition")
    composition = payload.get("composition", "index.html")
    res = render_hyperframe_mp4(project_name, composition)
    if res.get("status") == "error":
        raise HTTPException(status_code=500, detail=res.get("message"))
    log_activity("hyperframe_rendered", f"Rendered Hyperframe Video {res.get('filename')}", str(res.get("output_path") or ""))
    return res


@app.get("/api/hyperframe/renders")
def hyperframe_list_renders() -> dict:
    return {"renders": list_hyperframe_renders()}


# ==================== ASSETS VAULT API ====================

@app.get("/api/assets-vault/tree")
def get_assets_vault_tree() -> dict:
    return list_assets_vault_contents()


@app.post("/api/assets-vault/folders")
def create_assets_folder(payload: dict) -> dict:
    folder_name = payload.get("folder_name", "").strip()
    if not folder_name:
        raise HTTPException(status_code=400, detail="Folder name required")
    res = create_custom_assets_folder(folder_name)
    log_activity("folder_created", f"Created Assets Vault folder {folder_name}")
    return res


# ==================== TTS STUDIO SERVER API ====================

@app.get("/api/tts/server/status")
def get_tts_server_status() -> dict:
    return check_chatterbox_server_status()


@app.post("/api/tts/server/start")
def launch_tts_server() -> dict:
    return start_chatterbox_server()


from fastapi import UploadFile, File, Form

@app.post("/api/assets-vault/upload")
async def upload_asset_file(
    file: UploadFile = File(...),
    category: str = Form("imports")
) -> dict:
    content = await file.read()
    filename = file.filename or "uploaded_asset"
    res = save_imported_asset_file(filename, content, category)
    log_activity("asset_imported", f"Imported asset {filename} to {category}")
    return res


@app.delete("/api/assets-vault/files/{rel_path:path}")
def delete_asset_file(rel_path: str) -> dict:
    success = delete_vault_asset_file(rel_path)
    if not success:
        raise HTTPException(status_code=404, detail="File or folder not found")
    log_activity("asset_deleted", f"Deleted asset {rel_path}")
    return {"status": "deleted", "rel_path": rel_path}


from fastapi import Query
import mimetypes
from fastapi.responses import FileResponse

@app.get("/api/assets-vault/stream/{rel_path:path}")
def stream_asset_file(rel_path: str, download: bool = Query(False)):
    file_path = DB_ROOT / "assets_vault" / rel_path
    if not file_path.exists() or not file_path.is_file():
        alt_path = DB_ROOT / "hyperframes_studio" / "renders" / Path(rel_path).name
        if alt_path.exists() and alt_path.is_file():
            file_path = alt_path
        else:
            raise HTTPException(status_code=404, detail="Asset file not found")

    mime_type, _ = mimetypes.guess_type(str(file_path))
    if not mime_type:
        ext = file_path.suffix.lower()
        if ext == ".mp4":
            mime_type = "video/mp4"
        elif ext in [".webm", ".mov"]:
            mime_type = f"video/{ext.strip('.')}"
        elif ext in [".png", ".jpg", ".jpeg", ".webp"]:
            mime_type = f"image/{ext.strip('.')}"
        elif ext in [".mp3", ".wav", ".ogg"]:
            mime_type = f"audio/{ext.strip('.')}"
        else:
            mime_type = "application/octet-stream"

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{file_path.name}"'

    return FileResponse(str(file_path), media_type=mime_type, filename=file_path.name if download else None, headers=headers)


@app.get("/api/pipeline/status")
def get_pipeline_status() -> dict:
    res = list_projects()
    projects_list = res.get("projects", []) if isinstance(res, dict) else res
    if not projects_list:
        steps = [
            {"name": "Idea", "status": "waiting"},
            {"name": "Research", "status": "waiting"},
            {"name": "Script", "status": "waiting"},
            {"name": "Storyboard", "status": "waiting"},
            {"name": "Assets", "status": "waiting"},
            {"name": "Voice", "status": "waiting"},
            {"name": "Edit", "status": "waiting"},
            {"name": "Render", "status": "waiting"},
            {"name": "Upload", "status": "waiting"},
        ]
        return {"steps": steps, "progress": 0, "active_project": "No Active Project"}
    
    # Take latest project and derive step states
    latest = projects_list[0]
    has_pack = latest.get("status") == "pack_ready"
    
    steps = [
        {"name": "Idea", "status": "done"},
        {"name": "Research", "status": "done"},
        {"name": "Script", "status": "done" if has_pack else "in_progress"},
        {"name": "Storyboard", "status": "in_progress" if has_pack else "waiting"},
        {"name": "Assets", "status": "in_progress" if has_pack else "waiting"},
        {"name": "Voice", "status": "waiting"},
        {"name": "Edit", "status": "waiting"},
        {"name": "Render", "status": "queued" if has_pack else "waiting"},
        {"name": "Upload", "status": "waiting"},
    ]
    progress = 62 if has_pack else 35
    return {"steps": steps, "progress": progress, "active_project": latest.get("title", "Active Piece")}


@app.get("/api/runners/discover")
def discover_runners() -> dict:
    candidates = [
        ("codex", "Codex CLI"),
        ("claude", "Claude Code"),
        ("hermes", "Hermes Agent"),
        ("antigravity", "Antigravity"),
        ("ollama", "Ollama"),
    ]
    found = [
        {"id": command, "name": label, "path": shutil.which(command)}
        for command, label in candidates
        if shutil.which(command)
    ]
    return {"runners": found, "checked_at": now()}


@app.get("/api/settings")
def get_settings() -> dict:
    return safe_read_json(SETTINGS, {"runner": RunnerSettings().model_dump()})


@app.put("/api/settings/runner")
def set_runner(settings: RunnerSettings) -> dict:
    saved = safe_read_json(SETTINGS, {})
    saved["runner"] = settings.model_dump()
    write_json(SETTINGS, saved)
    log_activity("Runner setting changed", settings.runner or settings.endpoint or "Runner")
    return saved


@app.post("/api/research")
def add_research(item: ResearchInput) -> dict:
    WIKI.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    filename = f"{stamp}-{slugify(item.title)}.md"
    path = WIKI / filename
    source = str(item.source_url) if item.source_url else "Personal observation"
    path.write_text(
        f"---\ntitle: {item.title}\ntype: {item.source_type}\nsource: {source}\ncreated: {now()}\n---\n\n# {item.title}\n\n{item.notes.strip()}\n",
        encoding="utf-8",
    )
    log_activity("Research.md created", item.title, f"Saved as {filename}")
    return {"id": path.stem, "path": str(path.relative_to(ROOT)), "created_at": now()}



@app.post("/api/projects")
def create_project(project: ProjectInput) -> dict:
    project_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slugify(project.title)}"
    folder = PROJECTS / project_id
    folder.mkdir(parents=True, exist_ok=False)
    manifest = {"id": project_id, **project.model_dump(), "status": "planned", "created_at": now()}
    write_json(folder / "project.json", manifest)
    (folder / "research.md").write_text(f"# Research — {project.title}\n\nAdd the evidence and source links that must shape this piece.\n", encoding="utf-8")
    (folder / "script.md").write_text(f"# Script — {project.title}\n\n## Hook\n\n## Core beats\n\n## Call to action\n", encoding="utf-8")
    (folder / "prompts").mkdir()
    (folder / "assets").mkdir()
    log_activity("Project created", project.title, f"Format: {project.format}")
    return {"project": manifest, "path": str(folder.relative_to(ROOT))}
class PipelineStepInput(BaseModel):
    step_id: str
    status: str  # waiting, running, done, error
    output: Optional[str] = None


class ProjectInput(BaseModel):
    title: str
    platform: str = "YouTube"
    stage: str = "Idea"
    description: str = ""
    target_date: str = ""
    priority: str = "Medium"


class ProjectUpdateInput(BaseModel):
    title: Optional[str] = None
    platform: Optional[str] = None
    stage: Optional[str] = None
    progress: Optional[int] = None
    description: Optional[str] = None
    target_date: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None


class HyperframeRenderInput(BaseModel):
    title: str
    template_type: str = "title_card"
    aspect_ratio: str = "16:9"
    html_content: str
    config: Optional[dict] = None


class PipelineExecutionInput(BaseModel):
    topic: str
    platform: str = "YouTube"
    target_angle: Optional[str] = ""


class AgentChatInput(BaseModel):
    prompt: str


class ResearchInput(BaseModel):
    title: str
    notes: str
    source_type: str = "idea"
    source_url: Optional[str] = None


class WikiFileSaveInput(BaseModel):
    path: str
    content: str


class WikiFileCreateInput(BaseModel):
    path: str
    title: str = ""
    content: str = ""


class WikiFolderCreateInput(BaseModel):
    path: str


def get_folder_tree(dir_path: Path, base_path: Path) -> list:
    tree = []
    if not dir_path.exists():
        return tree
    for item in sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        rel = str(item.relative_to(base_path)).replace("\\", "/")
        if item.is_dir():
            tree.append({
                "name": item.name,
                "path": rel,
                "type": "folder",
                "children": get_folder_tree(item, base_path)
            })
        elif item.suffix.lower() in [".md", ".txt"]:
            tree.append({
                "name": item.name,
                "path": rel,
                "type": "file"
            })
    return tree


@app.get("/api/wiki/tree")
def get_wiki_tree() -> dict:
    WIKI.mkdir(parents=True, exist_ok=True)
    tree = get_folder_tree(WIKI, WIKI)
    return {"tree": tree}


@app.get("/api/wiki/file")
def get_wiki_file(path: str) -> dict:
    target = (WIKI / path).resolve()
    if not str(target).startswith(str(WIKI.resolve())) or not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    content = target.read_text(encoding="utf-8")
    return {"path": path, "name": target.name, "content": content}


@app.post("/api/wiki/file")
def create_wiki_file(item: WikiFileCreateInput) -> dict:
    WIKI.mkdir(parents=True, exist_ok=True)
    rel_path = item.path.strip("/")
    if not rel_path.endswith(".md"):
        rel_path += ".md"
    target = (WIKI / rel_path).resolve()
    if not str(target).startswith(str(WIKI.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    target.parent.mkdir(parents=True, exist_ok=True)
    content = item.content or f"# {item.title or target.stem}\n\nStart typing note content here...\n"
    target.write_text(content, encoding="utf-8")
    log_activity("Wiki Note created", target.stem, f"Path: {rel_path}")
    return {"path": rel_path, "name": target.name, "content": content}


@app.put("/api/wiki/file")
def update_wiki_file(item: WikiFileSaveInput) -> dict:
    target = (WIKI / item.path.strip("/")).resolve()
    if not str(target).startswith(str(WIKI.resolve())) or not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    target.write_text(item.content, encoding="utf-8")
    log_activity("Wiki Note saved", target.stem, f"Saved {item.path}")
    return {"path": item.path, "status": "saved"}


@app.delete("/api/wiki/file")
def delete_wiki_file(path: str) -> dict:
    target = (WIKI / path.strip("/")).resolve()
    if not str(target).startswith(str(WIKI.resolve())) or not target.exists():
        raise HTTPException(status_code=404, detail="File or folder not found")
    if target.is_file():
        target.unlink()
    elif target.is_dir():
        import shutil
        shutil.rmtree(target)
    log_activity("Wiki Item deleted", path, f"Deleted {path}")
    return {"path": path, "status": "deleted"}


@app.post("/api/wiki/folder")
def create_wiki_folder(item: WikiFolderCreateInput) -> dict:
    WIKI.mkdir(parents=True, exist_ok=True)
    target = (WIKI / item.path.strip("/")).resolve()
    if not str(target).startswith(str(WIKI.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    target.mkdir(parents=True, exist_ok=True)
    log_activity("Wiki Folder created", target.name, f"Path: {item.path}")
    return {"path": item.path, "status": "created"}


@app.get("/api/wiki/graph")
def get_wiki_graph() -> dict:
    WIKI.mkdir(parents=True, exist_ok=True)
    nodes = []
    links = []
    file_map = {}
    folder_map = {}

    for path in WIKI.rglob("*.md"):
        rel = str(path.relative_to(WIKI)).replace("\\", "/")
        title = path.stem
        folder = str(path.parent.relative_to(WIKI)).replace("\\", "/") if path.parent != WIKI else "."
        nodes.append({"id": title, "path": rel, "name": title, "folder": folder})
        file_map[title.lower()] = title
        folder_map.setdefault(folder, []).append(title)

    for path in WIKI.rglob("*.md"):
        source_title = path.stem
        try:
            content = path.read_text(encoding="utf-8")
            matches = re.findall(r"\[\[(.*?)\]\]", content)
            for m in matches:
                target_clean = m.split("|")[0].strip().lower()
                if target_clean in file_map and file_map[target_clean] != source_title:
                    links.append({"source": source_title, "target": file_map[target_clean]})
        except Exception:
            pass

    # Also link files in the same folder
    for folder, files in folder_map.items():
        if len(files) > 1:
            for i in range(len(files)):
                for j in range(i + 1, len(files)):
                    links.append({"source": files[i], "target": files[j]})

    return {"nodes": nodes, "links": links}


@app.post("/api/research")
def add_research(item: ResearchInput) -> dict:
    WIKI.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    filename = f"{stamp}-{slugify(item.title)}.md"
    path = WIKI / filename
    source = item.source_url if item.source_url else "Personal observation"
    path.write_text(
        f"---\ntitle: {item.title}\ntype: {item.source_type}\nsource: {source}\ncreated: {now()}\n---\n\n# {item.title}\n\n{item.notes.strip()}\n",
        encoding="utf-8",
    )
    return {"id": path.stem, "path": str(path.relative_to(ROOT)), "created_at": now()}


@app.get("/api/research")
def list_research() -> dict:
    if not WIKI.exists():
        return {"items": []}
    items = []
    for path in sorted(WIKI.glob("*.md"), reverse=True):
        text = path.read_text(encoding="utf-8")
        title = re.search(r"^title: (.+)$", text, re.MULTILINE)
        kind = re.search(r"^type: (.+)$", text, re.MULTILINE)
        items.append({
            "id": path.stem,
            "title": title.group(1) if title else path.stem,
            "type": kind.group(1) if kind else "idea",
            "path": str(path.relative_to(ROOT)),
            "content": text
        })
    return {"items": items}


@app.get("/api/research/{item_id}")
def get_research_item(item_id: str) -> dict:
    if not WIKI.exists():
        raise HTTPException(status_code=404, detail="Research note not found")
    matches = list(WIKI.glob(f"{item_id}.md"))
    if not matches:
        raise HTTPException(status_code=404, detail="Research note not found")
    path = matches[0]
    return {
        "id": path.stem,
        "path": str(path.relative_to(ROOT)),
        "content": path.read_text(encoding="utf-8")
    }


@app.get("/api/projects")
def list_projects() -> dict:
    PROJECTS.mkdir(parents=True, exist_ok=True)
    projects = []
    for manifest_path in sorted(PROJECTS.glob("*/project.json"), reverse=True):
        p = safe_read_json(manifest_path, {})
        if p and "id" in p:
            # Ensure fallback defaults
            p.setdefault("stage", "Idea")
            p.setdefault("platform", "YouTube")
            p.setdefault("progress", 0)
            p.setdefault("priority", "Medium")
            p.setdefault("description", "")
            p.setdefault("target_date", "")
            projects.append(p)
    return {"projects": projects}


@app.post("/api/projects")
def create_project(project: ProjectInput) -> dict:
    PROJECTS.mkdir(parents=True, exist_ok=True)
    project_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slugify(project.title)}"
    folder = PROJECTS / project_id
    folder.mkdir(parents=True, exist_ok=True)

    manifest = {
        "id": project_id,
        "title": project.title.strip(),
        "platform": project.platform.strip(),
        "stage": project.stage.strip(),
        "progress": 0,
        "description": project.description.strip(),
        "target_date": project.target_date.strip() or datetime.now().strftime("%Y-%m-%d"),
        "priority": project.priority.strip(),
        "created_at": now(),
        "notes": ""
    }
    write_json(folder / "project.json", manifest)
    (folder / "research.md").write_text(f"# Research — {project.title}\n\nAdd research notes, wiki links, and references here.\n", encoding="utf-8")
    (folder / "script.md").write_text(f"# Script — {project.title}\n\n## Hook\n\n## Core Content\n\n## Call To Action\n", encoding="utf-8")
    (folder / "prompts").mkdir(exist_ok=True)
    (folder / "assets").mkdir(exist_ok=True)

    log_activity("Project created", project.title, f"ID: {project_id}")
    return {"project": manifest, "path": str(folder.relative_to(ROOT))}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict:
    folder = PROJECTS / project_id
    manifest_path = folder / "project.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    project = safe_read_json(manifest_path, {})
    files = []
    for p in folder.rglob("*.md"):
        files.append({
            "name": str(p.relative_to(folder)),
            "path": str(p.relative_to(ROOT))
        })
    return {"project": project, "files": files}


@app.put("/api/projects/{project_id}")
def update_project(project_id: str, item: ProjectUpdateInput) -> dict:
    folder = PROJECTS / project_id
    manifest_path = folder / "project.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    project = safe_read_json(manifest_path, {})
    if item.title is not None: project["title"] = item.title.strip()
    if item.platform is not None: project["platform"] = item.platform.strip()
    if item.stage is not None: project["stage"] = item.stage.strip()
    if item.progress is not None: project["progress"] = max(0, min(100, item.progress))
    if item.description is not None: project["description"] = item.description.strip()
    if item.target_date is not None: project["target_date"] = item.target_date.strip()
    if item.priority is not None: project["priority"] = item.priority.strip()
    if item.notes is not None: project["notes"] = item.notes.strip()

    write_json(manifest_path, project)
    log_activity("Project updated", project["title"], f"Stage: {project.get('stage')}")
    return {"project": project, "status": "updated"}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    folder = PROJECTS / project_id
    if not folder.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        shutil.rmtree(folder)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

    log_activity("Project deleted", project_id, f"Deleted project folder {project_id}")
    return {"id": project_id, "status": "deleted"}


@app.post("/api/pipeline/execute")
def execute_pipeline(item: PipelineExecutionInput) -> dict:
    PROJECTS.mkdir(parents=True, exist_ok=True)
    title = item.topic.strip() or "Untitled Content Pipeline"
    project_id = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{slugify(title)}"
    folder = PROJECTS / project_id
    folder.mkdir(parents=True, exist_ok=True)

    research_content = f"# Research & Evidence — {title}\n\n- Platform: {item.platform}\n- Angle: {item.target_angle or 'Core tutorial'}\n- Created: {now()}\n\n## References\n- Ingested from Knowledge Vault\n"
    script_content = f"# Script — {title}\n\n## Hook (0:00 - 0:15)\nHere is why {title} changes everything...\n\n## Body Beats (0:15 - 3:00)\n1. Key concept and problem breakdown.\n2. Step-by-step workflow demonstration.\n\n## Call to Action\nLike, subscribe, and check out the Knowledge Vault notes below!\n"
    prompts_content = f"1. Cinematic wide shot of developer studio with neon amber lighting, 8k resolution.\n2. Infographic node diagram showing AI content pipeline architecture.\n"
    voice_content = f"Welcome back! Today we are building {title} step by step.\n"

    manifest = {
        "id": project_id,
        "title": title,
        "platform": item.platform,
        "stage": "Published",
        "progress": 100,
        "description": f"Generated via Workflow Pipeline Studio ({item.platform})",
        "target_date": datetime.now().strftime("%Y-%m-%d"),
        "priority": "High",
        "created_at": now(),
        "notes": f"[[{title} Research]]"
    }

    write_json(folder / "project.json", manifest)
    (folder / "research.md").write_text(research_content, encoding="utf-8")
    (folder / "script.md").write_text(script_content, encoding="utf-8")
    (folder / "prompts.txt").write_text(prompts_content, encoding="utf-8")
    (folder / "voice.txt").write_text(voice_content, encoding="utf-8")

    log_activity("Pipeline executed", title, f"Project created: {project_id}")
    return {
        "status": "success",
        "project": manifest,
        "steps": {
            "topic": {"title": title, "platform": item.platform},
            "research": {"summary": research_content[:150]},
            "script": {"outline": script_content[:200]},
            "prompts": {"sample": prompts_content[:100]},
            "voice": {"transcript": voice_content[:100]},
            "publish": {"project_id": project_id, "path": str(folder.relative_to(ROOT))}
        }
    }


AGENT_ROLES = [
    {
        "id": "content_os",
        "name": "Content OS Master",
        "icon": "ph-lightbulb",
        "color": "#ff5500",
        "description": "Master orchestrator for content strategy & Vault synthesis."
    },
    {
        "id": "scriptwriter",
        "name": "Scriptwriter Agent",
        "icon": "ph-article",
        "color": "#10b981",
        "description": "Crafts high-retention video hooks, narrative arcs, and CTAs."
    },
    {
        "id": "researcher",
        "name": "Research Analyst",
        "icon": "ph-magnifying-glass",
        "color": "#3b82f6",
        "description": "Extracts insights from reference documents & Knowledge Vault."
    },
    {
        "id": "visual_prompts",
        "name": "Visual Prompt Crafter",
        "icon": "ph-palette",
        "color": "#8b5cf6",
        "description": "Generates cinematic Flux, Midjourney & thumbnail prompts."
    },
    {
        "id": "seo",
        "name": "SEO & Packaging",
        "icon": "ph-chart-line-up",
        "color": "#f59e0b",
        "description": "Generates viral video titles, YouTube descriptions, and tags."
    }
]

@app.get("/api/agents/roles")
def get_agent_roles() -> dict:
    return {"roles": AGENT_ROLES}

def fetch_live_tech_news() -> str:
    url = "https://news.ycombinator.com/rss"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=5) as response:
            xml_data = response.read().decode("utf-8", errors="ignore")
            items = re.findall(r"<title>(.*?)</title>\s*<link>(.*?)</link>", xml_data, re.DOTALL)
            news_list = []
            for t, l in items:
                t_clean = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", t).strip()
                if "Hacker News" in t_clean or not t_clean:
                    continue
                news_list.append(f"- **{t_clean}**\n  [Read Source]({l.strip()})")
                if len(news_list) >= 5:
                    break
            if news_list:
                return "\n\n".join(news_list)
    except Exception:
        pass
    return "- **Local AI Models Surge:** Lightweight 8B models matching larger benchmarks.\n- **Autonomous Agents:** Developer tools adopting local CLI agent loops."


def search_local_vault(query: str) -> str:
    if not WIKI.exists():
        return ""
    matches = []
    q_words = query.lower().split()
    for p in WIKI.glob("*.md"):
        try:
            content = p.read_text(encoding="utf-8")
            if any(w in content.lower() or w in p.name.lower() for w in q_words if len(w) > 3):
                matches.append(f"- [[{p.stem}]]: {content[:120].strip()}...")
                if len(matches) >= 3:
                    break
        except Exception:
            pass
    return "\n".join(matches) if matches else ""


def call_ollama_api(prompt: str, system_prompt: str = "") -> Optional[str]:
    url = "http://localhost:11434/api/generate"
    payload = json.dumps({
        "model": "llama3",
        "prompt": f"{system_prompt}\n\nUser: {prompt}\n\nAssistant:",
        "stream": False
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("response")
    except Exception:
        return None


def format_messages_for_cli(messages: list[dict]) -> str:
    """
    Format standard message array into a single structured, sequential text block
    for CLI subprocesses (Hermes CLI, Codex, Claude) to ensure full historical context preservation.
    """
    formatted_parts = []
    for msg in messages:
        role_label = str(msg.get("role", "user")).upper()
        content = str(msg.get("content", "")).strip()
        formatted_parts.append(f"[{role_label}]:\n{content}")
    formatted_parts.append("[ASSISTANT]:\n")
    return "\n\n".join(formatted_parts)


def execute_cli_agent(runner: str, role: str, messages: list[dict]) -> Optional[dict]:
    """
    Executes the CLI runner subprocess (Hermes, Codex, Claude, Ollama)
    passing the full formatted multi-turn conversation context payload.
    """
    formatted_context = format_messages_for_cli(messages)
    r = runner.lower().strip()
    binary_name = "hermes"
    if r in ["claude", "codex", "ollama"]:
        binary_name = r

    exec_path = shutil.which(binary_name) or binary_name

    if binary_name == "claude":
        cmd = [exec_path, "-p", formatted_context]
    elif binary_name == "ollama":
        cmd = [exec_path, "run", "llama3", formatted_context]
    else:
        cmd = [exec_path, "-z", formatted_context]

    try:
        print(f"[REACT ENGINE] Executing CLI subprocess tier: {binary_name} -z ...")
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=45,
            encoding="utf-8",
            errors="ignore"
        )
        output = proc.stdout.strip() or proc.stderr.strip()
        if output and not ("unrecognized arguments" in output.lower() or "not recognized" in output.lower() or "is not found" in output.lower()):
            return {"success": True, "output": output}
        else:
            print(f"[REACT ENGINE] CLI process {binary_name} returned diagnostic output: {output[:120]}")
    except Exception as err:
        print(f"[REACT ENGINE] CLI process execution error on tier ({runner}): {err}")

    return None


def call_9router_api(messages: list[dict], model: str = "hermes-3-llama-3.1-8b") -> Optional[str]:
    """
    Direct HTTP POST request to the local 9router OpenAI endpoint (http://localhost:20128/v1/chat/completions).
    """
    url = "http://localhost:20128/v1/chat/completions"
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 1500
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choices = data.get("choices", [])
            if choices and "message" in choices[0]:
                return choices[0]["message"].get("content")
    except Exception as err:
        print(f"[REACT ENGINE] Tier 1 (9router) connection error: {err}")
    return None


@app.get("/api/database/search")
def search_database(q: str = "") -> dict:
    """
    Universal FTS5 search across all database/ subfolders (agent_memory, knowledge_vault, project_vault).
    """
    results = search_universal_index(q)
    return {"query": q, "count": len(results), "results": results}


@app.get("/api/database/stats")
def get_database_stats() -> dict:
    """
    Returns storage statistics for database/ master directory.
    """
    return {
        "db_path": str(SYSTEM_DB_PATH),
        "db_size_kb": round(SYSTEM_DB_PATH.stat().st_size / 1024, 2) if SYSTEM_DB_PATH.exists() else 0,
        "subfolders": {
            "agent_memory": [p.name for p in AGENT_MEMORY_DIR.iterdir() if p.is_dir()] if AGENT_MEMORY_DIR.exists() else [],
            "project_vault": len(list(PROJECT_VAULT_DIR.iterdir())) if PROJECT_VAULT_DIR.exists() else 0,
            "knowledge_vault": len(list(KNOWLEDGE_VAULT_DIR.rglob("*.md"))) if KNOWLEDGE_VAULT_DIR.exists() else 0,
        }
    }


@app.get("/api/hyperframe/renders")
def get_hyperframe_renders() -> dict:
    renders = list_hyperframe_renders()
    return {"renders": renders, "count": len(renders)}


@app.post("/api/hyperframe/renders")
def create_hyperframe_render(item: HyperframeRenderInput) -> dict:
    render = save_hyperframe_render(
        title=item.title,
        template_type=item.template_type,
        aspect_ratio=item.aspect_ratio,
        html_content=item.html_content,
        config=item.config or {}
    )
    log_activity("Hyperframe Rendered", item.title, item.template_type)
    return {"status": "success", "render": render}


@app.delete("/api/hyperframe/renders/{render_id}")
def remove_hyperframe_render(render_id: str) -> dict:
    deleted = delete_hyperframe_render(render_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Hyperframe render not found")
    log_activity("Hyperframe Render Deleted", render_id, "")
    return {"status": "deleted", "id": render_id}


@app.post("/api/agents/chat")
def chat_with_agent(item: AgentChatInput) -> dict:
    """
    Minimal Clean Agent Studio Endpoint.
    """
    prompt = item.prompt.strip()
    reply = (
        f"### 🎯 Content OS Response\n\n"
        f"Processed instruction: **\"{prompt}\"**\n\n"
        f"- Clean frontend workspace connected to database/ master storage."
    )
    log_activity("Agent Message Received", "Studio", prompt[:30])

    return {
        "status": "success",
        "role": "content_os",
        "runner": "STUDIO",
        "response": reply
    }


@app.get("/api/projects/{project_id}/files/{filename:path}")
def get_project_file(project_id: str, filename: str) -> dict:
    folder = PROJECTS / project_id
    file_path = folder / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return {"filename": filename, "content": file_path.read_text(encoding="utf-8")}


@app.put("/api/projects/{project_id}/files/{filename:path}")
def update_project_file(project_id: str, filename: str, payload: FileUpdateInput) -> dict:
    folder = PROJECTS / project_id
    file_path = folder / filename
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(payload.content, encoding="utf-8")
    return {"filename": filename, "status": "saved", "updated_at": now()}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    folder = PROJECTS / project_id
    manifest_path = folder / "project.json"
    title = project_id
    if manifest_path.exists():
        manifest = safe_read_json(manifest_path, {})
        title = manifest.get("title", project_id)
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
        log_activity("Project deleted", title, f"Removed project folder {project_id}")
        return {"status": "deleted", "id": project_id}
    raise HTTPException(status_code=404, detail="Project not found")


@app.delete("/api/research/{item_id}")
def delete_research(item_id: str) -> dict:
    if WIKI.exists():
        matches = list(WIKI.glob(f"{item_id}.md"))
        if matches:
            file_path = matches[0]
            title = file_path.stem
            file_path.unlink()
            log_activity("Research deleted", title, f"Removed {item_id}.md")
            return {"status": "deleted", "id": item_id}
    raise HTTPException(status_code=404, detail="Research note not found")


@app.delete("/api/projects/{project_id}/files/{filename:path}")
def delete_project_file(project_id: str, filename: str) -> dict:
    folder = PROJECTS / project_id
    file_path = folder / filename
    if file_path.exists() and file_path.is_file():
        file_path.unlink()
        log_activity("Pack file deleted", filename, f"Deleted from {project_id}")
        return {"status": "deleted", "filename": filename}
    raise HTTPException(status_code=404, detail="File not found")


@app.delete("/api/overview/today/{task_id}")
def delete_today_task(task_id: str) -> dict:
    schedule = safe_read_json(SCHEDULE, [])
    if isinstance(schedule, list):
        filtered = [t for t in schedule if t.get("id") != task_id]
        if len(filtered) < len(schedule):
            write_json(SCHEDULE, filtered)
            log_activity("Task removed", "Schedule", f"Deleted task {task_id}")
            return {"status": "deleted", "schedule": filtered}
    raise HTTPException(status_code=404, detail="Task not found")


@app.post("/api/projects/{project_id}/build-pack")
def build_project_pack(project_id: str) -> dict:
    folder = PROJECTS / project_id
    manifest_path = folder / "project.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    project = safe_read_json(manifest_path, {})
    research_titles = [item["title"] for item in list_research()["items"][:5]]
    sources = "\n".join(f"- {title}" for title in research_titles) or "- No research notes attached yet — add sources before finalizing."
    topic_name = project.get("topic") or project.get("title", "Untitled")
    (folder / "script-brief.md").write_text(
        f"# Script brief — {project.get('title', 'Untitled')}\n\n## Topic\n{topic_name}\n\n## Angle\n{project.get('angle') or 'Find a specific, honest point of view.'}\n\n## Research to review\n{sources}\n\n## Required draft structure\n1. Hook: identify the audience problem in 10–20 seconds.\n2. Promise: state what they will gain.\n3. Three evidence-backed beats.\n4. Practical next step.\n5. Clear call to action.\n",
        encoding="utf-8",
    )
    (folder / "prompts" / "visuals.md").write_text(
        f"# Visual prompts — {project.get('title', 'Untitled')}\n\n- Create a clean, high-contrast opening title card for: {topic_name}\n- Create 3 B-roll prompt variants for each key script beat after the script is approved.\n- Keep a consistent visual system: channel-specific palette, readable typography, no deceptive imagery.\n",
        encoding="utf-8",
    )
    (folder / "seo.md").write_text(
        f"# SEO brief — {project.get('title', 'Untitled')}\n\n## Search intent\nWhat exact question does this answer?\n\n## Title variants\n1. {topic_name}: the practical version\n2. I tested {topic_name} — here is what changed\n3. Stop guessing about {topic_name}\n\n## Description seed\nExplain the promise, evidence, and next action in plain language. Add sources before publishing.\n",
        encoding="utf-8",
    )
    project["status"] = "pack_ready"
    project["updated_at"] = now()
    write_json(manifest_path, project)
    log_activity("Pack built", project["title"], "Generated script-brief.md, visuals.md, and seo.md")
    return {"project": project, "created": ["script-brief.md", "prompts/visuals.md", "seo.md"]}


@app.post("/api/agent/chat")
def agent_chat(input_data: ChatInput) -> dict:
    prompt = input_data.prompt.strip()
    kind = input_data.kind
    endpoint = input_data.endpoint or "http://localhost:11434"

    # Attempt local endpoint (e.g. Ollama)
    if kind == "endpoint" and endpoint:
        try:
            req_data = json.dumps({
                "model": input_data.model or "llama3",
                "prompt": prompt,
                "stream": False
            }).encode("utf-8")
            url = f"{endpoint.rstrip('/')}/api/generate"
            req = urllib.request.Request(url, data=req_data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                output = result.get("response", "No response from local model.")
                return {"runner": f"Local Endpoint ({endpoint})", "response": output}
        except Exception as err:
            # Fallback to local agent assistant
            pass

    # Standard Content OS local intelligence response engine
    research_items = list_research()["items"][:3]
    research_summary = "\n".join([f"• {r['title']} ({r['type']})" for r in research_items]) or "• No research items logged yet."

    response_text = f"### Content OS Agent Analysis [{input_data.runner.upper()}]\n\n"
    
    if "script" in prompt.lower() or "hook" in prompt.lower():
        response_text += f"**Script Strategy Draft**\n\n"
        response_text += f"**Hook (0-15s):**\n> \"If you've been struggling to create consistent content without spending 10 hours a day... here is the exact framework I built.\"\n\n"
        response_text += f"**Core Beats:**\n1. **The Bottleneck**: Explain why standard YouTube automation advice fails without a system.\n2. **The Solution**: Use a local-first memory vault (Karpathy Wiki) to store insights as Markdown.\n3. **Execution**: Wire node-based blocks to produce scripts, asset prompts, and SEO briefs.\n\n"
        response_text += f"**Call To Action:**\nJoin the build and streamline your content engine."
    elif "seo" in prompt.lower() or "title" in prompt.lower():
        response_text += f"**Optimized SEO Package**\n\n"
        response_text += f"**High-CTR Title Ideas:**\n1. How I Built a Local AI Content OS (Zero Subscriptions)\n2. Why 90% of YouTube Automation Tools Fail (And What Works Instead)\n3. Stop Wasting Time: Automate Scripting & Prompts Locally\n\n"
        response_text += f"**Target Keywords:** `#ContentOS #LocalAI #ContentAutomation #DeveloperTools`"
    elif "prompt" in prompt.lower() or "visual" in prompt.lower() or "b-roll" in prompt.lower():
        response_text += f"**Visual Prompts & Asset Spec**\n\n"
        response_text += f"1. **Hero Title Card**: Minimalist dark UI background (`#090a0f`) with floating code nodes, neon violet accents, typography: Outfit Bold.\n"
        response_text += f"2. **B-Roll Scene 1**: Split screen showing markdown note on left, automated flow graph on right.\n"
        response_text += f"3. **Thumbnail Concept**: Clean high contrast dashboard mockup, bold text overlays: 'LOCAL AI SYSTEM'."
    else:
        response_text += f"I evaluated your prompt against your active Content OS knowledge vault.\n\n"
        response_text += f"**Prompt Processed:** \"{prompt}\"\n\n"
        response_text += f"**Attached Knowledge Memory:**\n{research_summary}\n\n"
        response_text += f"**Suggested Action:** You can attach this output directly to a project or use it to generate your project script pack."

    return {
        "runner": input_data.runner or "Content OS Assistant",
        "response": response_text,
        "timestamp": now()
    }

