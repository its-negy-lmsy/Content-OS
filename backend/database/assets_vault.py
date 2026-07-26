import os
import shutil
import json
import time
from pathlib import Path

DB_ROOT = Path(r"d:\Content OS\database")
ASSETS_VAULT_DIR = DB_ROOT / "assets_vault"

CATEGORIES = ["videos", "images", "audio", "hyperframes", "imports"]

# Ensure default directory structure exists
for category in CATEGORIES:
    (ASSETS_VAULT_DIR / category).mkdir(parents=True, exist_ok=True)


def list_assets_vault_contents() -> dict:
    """Scans database/assets_vault/ and returns categorized asset files and custom folders."""
    structure = {
        "categories": CATEGORIES,
        "folders": [],
        "files": []
    }

    if not ASSETS_VAULT_DIR.exists():
        ASSETS_VAULT_DIR.mkdir(parents=True, exist_ok=True)

    # Auto-sync rendered files from hyperframes_studio/renders into assets_vault/hyperframes/
    renders_dir = DB_ROOT / "hyperframes_studio" / "renders"
    if renders_dir.exists():
        dest_hf_dir = ASSETS_VAULT_DIR / "hyperframes"
        dest_hf_dir.mkdir(parents=True, exist_ok=True)
        for r_file in renders_dir.glob("*.mp4"):
            target = dest_hf_dir / r_file.name
            if not target.exists() or target.stat().st_size != r_file.stat().st_size:
                try:
                    shutil.copy2(r_file, target)
                except Exception:
                    pass

    # Collect subfolders
    for p in ASSETS_VAULT_DIR.glob("*"):
        if p.is_dir():
            rel_path = p.relative_to(ASSETS_VAULT_DIR).as_posix()
            structure["folders"].append({
                "name": p.name,
                "rel_path": rel_path,
                "is_category": p.name in CATEGORIES
            })

    # Collect files
    for p in ASSETS_VAULT_DIR.glob("**/*"):
        if p.is_file():
            rel_path = p.relative_to(ASSETS_VAULT_DIR).as_posix()
            parent_folder = p.parent.name if p.parent != ASSETS_VAULT_DIR else "root"
            stat = p.stat()
            ext = p.suffix.lower().strip(".")
            
            # Determine asset category type
            media_type = "unknown"
            if ext in ["mp4", "webm", "mov", "avi", "mkv"]:
                media_type = "video"
            elif ext in ["png", "jpg", "jpeg", "webp", "gif", "svg"]:
                media_type = "image"
            elif ext in ["mp3", "wav", "m4a", "ogg", "flac"]:
                media_type = "audio"
            elif ext in ["html", "json", "js", "css"]:
                media_type = "hyperframe"

            file_info = {
                "name": p.name,
                "rel_path": rel_path,
                "abs_path": str(p),
                "folder": parent_folder,
                "size_bytes": stat.st_size,
                "size_formatted": format_bytes(stat.st_size),
                "media_type": media_type,
                "ext": ext,
                "modified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.localtime(stat.st_mtime))
            }
            structure["files"].append(file_info)

    structure["files"].sort(key=lambda x: x["modified_at"], reverse=True)
    return structure


def create_custom_assets_folder(folder_name: str) -> dict:
    """Creates a custom subfolder under database/assets_vault/."""
    clean_name = "".join(c for c in folder_name if c.isalnum() or c in ("-", "_", " ")).strip()
    if not clean_name:
        return {"status": "error", "message": "Invalid folder name"}

    folder_path = ASSETS_VAULT_DIR / clean_name
    folder_path.mkdir(parents=True, exist_ok=True)
    return {
        "status": "success",
        "name": clean_name,
        "rel_path": clean_name
    }


def save_imported_asset_file(file_name: str, file_bytes: bytes, target_category: str = "imports") -> dict:
    """Saves imported or uploaded file to database/assets_vault/<target_category>/."""
    clean_category = target_category if target_category in CATEGORIES else "imports"
    dest_dir = ASSETS_VAULT_DIR / clean_category
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    dest_file = dest_dir / file_name
    with open(dest_file, "wb") as f:
        f.write(file_bytes)

    return {
        "status": "success",
        "name": file_name,
        "rel_path": (Path(clean_category) / file_name).as_posix(),
        "abs_path": str(dest_file)
    }


def delete_vault_asset_file(rel_path: str) -> bool:
    """Deletes an asset file or folder from database/assets_vault/ and renders/."""
    target = ASSETS_VAULT_DIR / rel_path
    deleted = False

    if target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        deleted = True

    # Also remove from hyperframes_studio/renders/ if mirrored
    filename = Path(rel_path).name
    render_target = DB_ROOT / "hyperframes_studio" / "renders" / filename
    if render_target.exists():
        render_target.unlink()
        deleted = True

    return deleted


def format_bytes(size: int) -> str:
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"
