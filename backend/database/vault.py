"""
Content OS Vault Storage Manager
Handles Knowledge Vault (database/knowledge_vault/) & Project Vault (database/project_vault/)
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from backend.database.core import (
    KNOWLEDGE_VAULT_DIR,
    PROJECT_VAULT_DIR,
    get_db_connection,
    index_text_for_search,
    now_iso
)


def list_knowledge_vault_tree() -> List[Dict[str, Any]]:
    """
    Scans database/knowledge_vault/ and returns full directory tree.
    """
    def scan_dir(p: Path) -> List[Dict[str, Any]]:
        nodes = []
        if not p.exists():
            return nodes
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            rel = str(item.relative_to(KNOWLEDGE_VAULT_DIR)).replace("\\", "/")
            if item.is_dir():
                children = scan_dir(item)
                nodes.append({
                    "name": item.name,
                    "path": rel,
                    "type": "folder",
                    "children": children
                })
            elif item.is_file() and item.suffix in [".md", ".txt", ".json"]:
                nodes.append({
                    "name": item.name,
                    "path": rel,
                    "type": "file",
                    "size": item.stat().st_size
                })
        return nodes

    return scan_dir(KNOWLEDGE_VAULT_DIR)


def read_vault_file(rel_path: str) -> Optional[str]:
    clean_path = rel_path.lstrip("/\\")
    file_path = KNOWLEDGE_VAULT_DIR / clean_path
    if file_path.exists() and file_path.is_file():
        try:
            return file_path.read_text(encoding="utf-8")
        except Exception:
            pass
    return None


def write_vault_file(rel_path: str, title: str, content: str) -> Dict[str, Any]:
    clean_path = rel_path.lstrip("/\\")
    if not clean_path.endswith(".md") and not clean_path.endswith(".txt"):
        clean_path += ".md"

    file_path = KNOWLEDGE_VAULT_DIR / clean_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")

    # Index in SQLite & FTS search engine
    node_id = f"vault_{clean_path.replace('/', '_')}"
    category = clean_path.split("/")[0] if "/" in clean_path else "general"
    updated_at = now_iso()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO knowledge_nodes (id, rel_path, category, title, summary, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title, summary=excluded.summary, updated_at=excluded.updated_at
        """, (node_id, clean_path, category, title, content[:200], updated_at))
        conn.commit()

    index_text_for_search(title, content, "knowledge_vault", node_id, f"knowledge_vault/{clean_path}")

    return {
        "status": "success",
        "path": clean_path,
        "title": title,
        "updated_at": updated_at
    }


def list_projects() -> List[Dict[str, Any]]:
    projects = []
    if not PROJECT_VAULT_DIR.exists():
        return projects

    for p_dir in sorted(PROJECT_VAULT_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if p_dir.is_dir():
            meta_file = p_dir / "project.json"
            if meta_file.exists():
                try:
                    data = json.loads(meta_file.read_text(encoding="utf-8"))
                    projects.append(data)
                except Exception:
                    pass
    return projects
