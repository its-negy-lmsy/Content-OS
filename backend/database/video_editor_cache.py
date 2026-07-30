"""Isolated cache management and storage analytics for Content OS Video Editor.

Ensures strict separation between project assets and temporary render/proxy/waveform/thumbnail caches.
All cache directories are safely deletable without damaging project state or original assets.
"""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List

from backend.database.assets_vault import ASSETS_VAULT_DIR
from backend.database.core import DB_DIR
from backend.logger import push_log

VIDEO_CACHE_DIR = DB_DIR / "cache" / "video_editor"

FRAME_CACHE_DIR = VIDEO_CACHE_DIR / "FrameCache"
THUMBNAIL_CACHE_DIR = VIDEO_CACHE_DIR / "ThumbnailCache"
PROXY_CACHE_DIR = VIDEO_CACHE_DIR / "ProxyCache"
WAVEFORM_CACHE_DIR = VIDEO_CACHE_DIR / "WaveformCache"
SHADER_CACHE_DIR = VIDEO_CACHE_DIR / "ShaderCache"
PREVIEW_CACHE_DIR = VIDEO_CACHE_DIR / "PreviewCache"
EXPORT_CACHE_DIR = ASSETS_VAULT_DIR / "videos"
TEMP_CACHE_DIR = VIDEO_CACHE_DIR / "Temp"

ALL_CACHE_DIRS = [
    FRAME_CACHE_DIR,
    THUMBNAIL_CACHE_DIR,
    PROXY_CACHE_DIR,
    WAVEFORM_CACHE_DIR,
    SHADER_CACHE_DIR,
    PREVIEW_CACHE_DIR,
    EXPORT_CACHE_DIR,
    TEMP_CACHE_DIR,
]


def init_video_cache_structure() -> None:
    """Ensure all dedicated cache subdirectories exist."""
    for directory in ALL_CACHE_DIRS:
        directory.mkdir(parents=True, exist_ok=True)


init_video_cache_structure()


def _dir_size(path: Path) -> int:
    """Calculate total size of all files inside directory in bytes."""
    if not path.exists():
        return 0
    total = 0
    for file_item in path.rglob("*"):
        if file_item.is_file():
            try:
                total += file_item.stat().st_size
            except OSError:
                pass
    return total


def get_storage_analytics(timeline_clips: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    """Return comprehensive storage size breakdown across original assets, proxies, and caches."""
    init_video_cache_structure()

    originals_dir = ASSETS_VAULT_DIR / "imports"
    original_size = _dir_size(originals_dir)
    thumbnail_size = _dir_size(THUMBNAIL_CACHE_DIR)
    proxy_size = _dir_size(PROXY_CACHE_DIR)
    waveform_size = _dir_size(WAVEFORM_CACHE_DIR)
    preview_size = _dir_size(PREVIEW_CACHE_DIR) + _dir_size(FRAME_CACHE_DIR)
    export_size = _dir_size(EXPORT_CACHE_DIR)

    # Detect unused assets in imports directory
    referenced_sources = set()
    if timeline_clips:
        for clip in timeline_clips:
            src = clip.get("src") or clip.get("source_path") or ""
            if src:
                referenced_sources.add(Path(src).name)

    unused_count = 0
    unused_size = 0
    if originals_dir.exists():
        for file_item in originals_dir.iterdir():
            if file_item.is_file():
                if file_item.name not in referenced_sources:
                    unused_count += 1
                    try:
                        unused_size += file_item.stat().st_size
                    except OSError:
                        pass

    total_cache_size = (
        thumbnail_size + proxy_size + waveform_size + preview_size + _dir_size(TEMP_CACHE_DIR) + _dir_size(SHADER_CACHE_DIR)
    )

    return {
        "original_size": original_size,
        "proxy_size": proxy_size,
        "cache_size": total_cache_size,
        "preview_cache": preview_size,
        "thumbnail_cache": thumbnail_size,
        "waveform_cache": waveform_size,
        "export_size": export_size,
        "unused_assets_count": unused_count,
        "unused_assets_size": unused_size,
        "formatted": {
            "original": _format_bytes(original_size),
            "proxy": _format_bytes(proxy_size),
            "cache": _format_bytes(total_cache_size),
            "preview": _format_bytes(preview_size),
            "thumbnail": _format_bytes(thumbnail_size),
            "waveform": _format_bytes(waveform_size),
            "export": _format_bytes(export_size),
            "unused": _format_bytes(unused_size),
        },
    }


def clean_cache(target: str = "all") -> Dict[str, Any]:
    """Safely clear specified cache folder without destroying original project files."""
    init_video_cache_structure()
    cleared_bytes = 0
    target_low = target.lower()

    dirs_to_clean: List[Path] = []
    if target_low == "all":
        dirs_to_clean = [
            FRAME_CACHE_DIR,
            THUMBNAIL_CACHE_DIR,
            PROXY_CACHE_DIR,
            WAVEFORM_CACHE_DIR,
            SHADER_CACHE_DIR,
            PREVIEW_CACHE_DIR,
            TEMP_CACHE_DIR,
        ]
    elif target_low == "proxy":
        dirs_to_clean = [PROXY_CACHE_DIR]
    elif target_low == "preview":
        dirs_to_clean = [PREVIEW_CACHE_DIR, FRAME_CACHE_DIR]
    elif target_low == "thumbnail":
        dirs_to_clean = [THUMBNAIL_CACHE_DIR]
    elif target_low == "waveform":
        dirs_to_clean = [WAVEFORM_CACHE_DIR]

    for directory in dirs_to_clean:
        cleared_bytes += _dir_size(directory)
        for item in directory.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                elif item.is_dir():
                    shutil.rmtree(item)
            except Exception as err:
                push_log("WARN", "VIDEO_CACHE", f"Could not delete cache item {item}: {err}")

    push_log("INFO", "VIDEO_CACHE", f"Cleaned '{target}' video cache ({_format_bytes(cleared_bytes)} freed)")
    return {
        "status": "success",
        "target": target,
        "freed_bytes": cleared_bytes,
        "freed_formatted": _format_bytes(cleared_bytes),
    }


def _format_bytes(size: int) -> str:
    """Format byte count into human readable units."""
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    else:
        return f"{size / (1024 * 1024 * 1024):.2f} GB"
