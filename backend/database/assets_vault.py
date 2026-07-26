"""
Content OS Assets Vault Storage Manager
Handles media asset files and subfolders in database/assets_vault/
"""

import shutil
from pathlib import Path
from typing import Any, Dict, List
from backend.database.core import DB_DIR

ASSETS_VAULT_DIR = DB_DIR / "assets_vault"
ASSETS_VAULT_DIR.mkdir(parents=True, exist_ok=True)

# Ensure essential default asset subdirectories exist
for default_sub in ["audio", "videos", "images", "hyperframes", "documents"]:
    (ASSETS_VAULT_DIR / default_sub).mkdir(parents=True, exist_ok=True)


def list_assets_vault_contents() -> List[Dict[str, Any]]:
    """
    Scans database/assets_vault/ recursively and returns structured directory tree.
    """
    def scan_dir(p: Path) -> List[Dict[str, Any]]:
        nodes = []
        if not p.exists():
            return nodes
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            rel = str(item.relative_to(ASSETS_VAULT_DIR)).replace("\\", "/")
            if item.is_dir():
                children = scan_dir(item)
                nodes.append({
                    "name": item.name,
                    "path": rel,
                    "type": "folder",
                    "children": children
                })
            elif item.is_file():
                ext = item.suffix.lower().lstrip(".")
                media_type = "document"
                if ext in ["mp3", "wav", "flac", "m4a", "ogg", "aac"]:
                    media_type = "audio"
                elif ext in ["mp4", "webm", "mov", "avi", "mkv"]:
                    media_type = "video"
                elif ext in ["png", "jpg", "jpeg", "webp", "gif", "svg"]:
                    media_type = "image"

                nodes.append({
                    "name": item.name,
                    "path": rel,
                    "type": "file",
                    "media_type": media_type,
                    "extension": ext,
                    "size": item.stat().st_size
                })
        return nodes

    return scan_dir(ASSETS_VAULT_DIR)


def create_custom_assets_folder(folder_path: str) -> Dict[str, Any]:
    """
    Creates a new custom folder inside assets_vault.
    """
    clean_path = folder_path.lstrip("/\\")
    target_dir = ASSETS_VAULT_DIR / clean_path
    target_dir.mkdir(parents=True, exist_ok=True)
    return {
        "status": "success",
        "path": str(target_dir.relative_to(ASSETS_VAULT_DIR)).replace("\\", "/"),
        "name": target_dir.name
    }


def save_imported_asset_file(rel_path: str, content_bytes: bytes) -> Dict[str, Any]:
    """
    Saves binary bytes or file content into assets_vault.
    """
    clean_path = rel_path.lstrip("/\\")
    file_path = ASSETS_VAULT_DIR / clean_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(content_bytes)
    return {
        "status": "success",
        "path": clean_path,
        "size": len(content_bytes)
    }


def delete_vault_asset_file(rel_path: str) -> Dict[str, Any]:
    """
    Deletes a file or directory inside assets_vault.
    """
    clean_path = rel_path.lstrip("/\\")
    target = ASSETS_VAULT_DIR / clean_path
    if not target.exists():
        return {"status": "error", "message": "File or folder not found"}
    
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
        
    return {"status": "success", "deleted": clean_path}
