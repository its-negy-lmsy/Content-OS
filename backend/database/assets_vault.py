"""
Content OS Assets Vault Storage Manager
Handles media asset files and subfolders in database/assets_vault/
"""

import shutil
import time
from pathlib import Path
from typing import Any, Dict, List
from backend.database.core import DB_DIR

ASSETS_VAULT_DIR = DB_DIR / "assets_vault"
ASSETS_VAULT_DIR.mkdir(parents=True, exist_ok=True)

# Ensure essential default asset subdirectories exist
DEFAULT_FOLDERS = ["videos", "images", "audio", "hyperframes", "imports", "documents"]
for default_sub in DEFAULT_FOLDERS:
    (ASSETS_VAULT_DIR / default_sub).mkdir(parents=True, exist_ok=True)


def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    else:
        return f"{size / (1024 * 1024):.1f} MB"


def list_assets_vault_contents() -> Dict[str, Any]:
    """
    Scans database/assets_vault/ and returns categories, folders, and flat file list formatted for dashboard.ts.
    """
    folders: List[Dict[str, Any]] = []
    files: List[Dict[str, Any]] = []

    if ASSETS_VAULT_DIR.exists():
        for item in sorted(ASSETS_VAULT_DIR.rglob("*")):
            rel = str(item.relative_to(ASSETS_VAULT_DIR)).replace("\\", "/")
            folder_name = rel.split("/")[0] if "/" in rel else rel

            if item.is_dir():
                folders.append({
                    "name": item.name,
                    "rel_path": rel,
                    "is_category": item.parent == ASSETS_VAULT_DIR
                })
            elif item.is_file():
                ext = item.suffix.lower().lstrip(".")
                media_type = "unknown"
                if ext in ["mp3", "wav", "flac", "m4a", "ogg", "aac"]:
                    media_type = "audio"
                elif ext in ["mp4", "webm", "mov", "avi", "mkv"]:
                    media_type = "video"
                elif ext in ["png", "jpg", "jpeg", "webp", "gif", "svg"]:
                    media_type = "image"
                elif folder_name == "hyperframes":
                    media_type = "hyperframe"
                elif ext in ["pdf", "txt", "doc", "docx", "md"]:
                    media_type = "document"

                mtime = item.stat().st_mtime
                mod_str = time.strftime("%Y-%m-%d %H:%M", time.localtime(mtime))

                files.append({
                    "name": item.name,
                    "rel_path": rel,
                    "folder": folder_name,
                    "size_bytes": item.stat().st_size,
                    "size_formatted": format_bytes(item.stat().st_size),
                    "media_type": media_type,
                    "ext": ext,
                    "modified_at": mod_str
                })

    return {
        "categories": DEFAULT_FOLDERS,
        "folders": folders,
        "files": files
    }


def create_custom_assets_folder(folder_path: str) -> Dict[str, Any]:
    clean_path = folder_path.lstrip("/\\")
    target_dir = ASSETS_VAULT_DIR / clean_path
    target_dir.mkdir(parents=True, exist_ok=True)
    return {
        "status": "success",
        "path": str(target_dir.relative_to(ASSETS_VAULT_DIR)).replace("\\", "/"),
        "name": target_dir.name
    }


def save_imported_asset_file(rel_path: str, content_bytes: bytes, category: str = "imports") -> Dict[str, Any]:
    filename = Path(rel_path).name if rel_path else "file"
    clean_path = f"{category}/{filename}" if category and not rel_path.startswith(category) else rel_path.lstrip("/\\")
    file_path = ASSETS_VAULT_DIR / clean_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content_bytes)
    return {
        "status": "success",
        "path": clean_path,
        "size": len(content_bytes)
    }


def delete_vault_asset_file(rel_path: str) -> Dict[str, Any]:
    clean_path = rel_path.lstrip("/\\")
    target = ASSETS_VAULT_DIR / clean_path
    if not target.exists():
        return {"status": "error", "message": "File or folder not found"}
    
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
        
    return {"status": "success", "deleted": clean_path}
