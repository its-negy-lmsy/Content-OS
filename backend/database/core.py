"""
Content OS Universal Database Core Engine (SQLite3 + FTS5)
Master storage directory: d:/Content OS/database
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Root directory layout
ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = ROOT / "database"
SYSTEM_DB_PATH = DB_DIR / "system.db"

# Subfolders layout
AGENT_MEMORY_DIR = DB_DIR / "agent_memory"
PROJECT_VAULT_DIR = DB_DIR / "project_vault"
KNOWLEDGE_VAULT_DIR = DB_DIR / "knowledge_vault"
SETTINGS_DIR = DB_DIR / "settings"

AGENT_SUBFOLDERS = {
    "master": AGENT_MEMORY_DIR / "master_memory",
    "research": AGENT_MEMORY_DIR / "research_memory",
    "script": AGENT_MEMORY_DIR / "script_memory",
    "visual": AGENT_MEMORY_DIR / "visual_memory",
    "seo": AGENT_MEMORY_DIR / "seo_memory",
}

KNOWLEDGE_SUBFOLDERS = {
    "concepts": KNOWLEDGE_VAULT_DIR / "concepts",
    "workflows": KNOWLEDGE_VAULT_DIR / "workflows",
    "research": KNOWLEDGE_VAULT_DIR / "research",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_database_structure() -> None:
    """
    Creates all subdirectories under database/ and initializes system.db schema.
    """
    # 1. Create main database directory and subfolders
    DB_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    PROJECT_VAULT_DIR.mkdir(parents=True, exist_ok=True)
    KNOWLEDGE_VAULT_DIR.mkdir(parents=True, exist_ok=True)

    for sub_path in AGENT_SUBFOLDERS.values():
        sub_path.mkdir(parents=True, exist_ok=True)

    for sub_path in KNOWLEDGE_SUBFOLDERS.values():
        sub_path.mkdir(parents=True, exist_ok=True)

    # 2. Migrate existing data directory if present
    old_data_dir = ROOT / "data"
    if old_data_dir.exists():
        _migrate_old_data(old_data_dir)

    # 3. Initialize SQLite system.db
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # Conversations Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Messages Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                content TEXT NOT NULL,
                runner TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
            )
        """)

        # Knowledge Nodes Index Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS knowledge_nodes (
                id TEXT PRIMARY KEY,
                rel_path TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                updated_at TEXT NOT NULL
            )
        """)

        # Projects Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                platform TEXT NOT NULL,
                stage TEXT NOT NULL,
                priority TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL
            )
        """)

        # Universal FTS5 Full-Text Search Table
        cursor.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS universal_fts USING fts5(
                title,
                content,
                entity_type,
                entity_id,
                rel_path
            )
        """)

        conn.commit()
    print("[DATABASE CORE] Universal database structure initialized successfully at database/")


def _migrate_old_data(old_data_dir: Path) -> None:
    """Migrates existing data/ folder contents into database/ if not already present."""
    import shutil
    try:
        # Migrate Wiki -> database/knowledge_vault
        old_wiki = old_data_dir / "wiki"
        if old_wiki.exists():
            for item in old_wiki.rglob("*"):
                if item.is_file():
                    rel = item.relative_to(old_wiki)
                    target = KNOWLEDGE_VAULT_DIR / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        shutil.copy2(item, target)

        # Migrate Projects -> database/project_vault
        old_projects = old_data_dir / "projects"
        if old_projects.exists():
            for item in old_projects.rglob("*"):
                if item.is_file():
                    rel = item.relative_to(old_projects)
                    target = PROJECT_VAULT_DIR / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        shutil.copy2(item, target)

        # Migrate Settings & Activities -> database/settings
        for f_name in ["activity.json", "settings.json"]:
            old_f = old_data_dir / f_name
            if old_f.exists():
                target_f = SETTINGS_DIR / f_name
                if not target_f.exists():
                    shutil.copy2(old_f, target_f)

        print("[DATABASE CORE] Migration from data/ to database/ completed successfully.")
    except Exception as err:
        print(f"[DATABASE CORE] Migration notice: {err}")


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(SYSTEM_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def index_text_for_search(title: str, content: str, entity_type: str, entity_id: str, rel_path: str = "") -> None:
    """
    Inserts or updates an entry in the universal FTS5 search index.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Delete existing index entry for entity_id
        cursor.execute("DELETE FROM universal_fts WHERE entity_id = ?", (entity_id,))
        cursor.execute("""
            INSERT INTO universal_fts (title, content, entity_type, entity_id, rel_path)
            VALUES (?, ?, ?, ?, ?)
        """, (title, content, entity_type, entity_id, rel_path))
        conn.commit()


def search_universal_index(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Full-text search across all agent memories, knowledge notes, and projects.
    """
    results = []
    if not query.strip():
        return results

    clean_query = query.replace("'", "''").strip()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("""
                SELECT title, content, entity_type, entity_id, rel_path, snippet(universal_fts, 1, '<b>', '</b>', '...', 30) as snippet
                FROM universal_fts
                WHERE universal_fts MATCH ?
                LIMIT ?
            """, (f"{clean_query}*", limit))
            for row in cursor.fetchall():
                results.append({
                    "title": row["title"],
                    "content": row["content"],
                    "entity_type": row["entity_type"],
                    "entity_id": row["entity_id"],
                    "rel_path": row["rel_path"],
                    "snippet": row["snippet"]
                })
        except Exception as err:
            print(f"[DATABASE SEARCH] FTS search query notice: {err}")
    return results


if __name__ == "__main__":
    init_database_structure()
