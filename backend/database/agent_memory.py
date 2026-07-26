"""
Content OS Categorized Agent Memory Manager
Stores agent threads in specialized subfolders under database/agent_memory/
- database/agent_memory/master_memory/
- database/agent_memory/research_memory/
- database/agent_memory/script_memory/
- database/agent_memory/visual_memory/
- database/agent_memory/seo_memory/
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from backend.database.core import (
    AGENT_MEMORY_DIR,
    AGENT_SUBFOLDERS,
    get_db_connection,
    index_text_for_search,
    now_iso
)


def get_agent_category_dir(category: str) -> Path:
    cat = category.lower().strip()
    target_dir = AGENT_SUBFOLDERS.get(cat, AGENT_MEMORY_DIR / f"{cat}_memory")
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir


def save_agent_session_memory(category: str, session_id: str, title: str, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Saves session memory JSON file to database/agent_memory/{category}_memory/{session_id}.json
    and indexes messages in SQLite system.db and FTS search index.
    """
    cat_dir = get_agent_category_dir(category)
    file_path = cat_dir / f"{session_id}.json"

    updated_at = now_iso()
    session_payload = {
        "id": session_id,
        "category": category,
        "title": title or "Untitled Session",
        "updated_at": updated_at,
        "messages": messages
    }

    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(session_payload, f, indent=2, ensure_ascii=False)

    # Update SQLite database records
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO conversations (id, category, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at
        """, (session_id, category, title, updated_at, updated_at))

        # Refresh messages table
        cursor.execute("DELETE FROM messages WHERE conversation_id = ?", (session_id,))
        for msg in messages:
            cursor.execute("""
                INSERT INTO messages (conversation_id, sender, content, runner, timestamp)
                VALUES (?, ?, ?, ?, ?)
            """, (session_id, msg.get("role", "user"), msg.get("content", ""), msg.get("runner", "studio"), msg.get("timestamp", updated_at)))
        
        conn.commit()

    # Index combined text into Universal FTS Search Index
    combined_text = "\n".join([m.get("content", "") for m in messages])
    rel_path = f"agent_memory/{category}_memory/{session_id}.json"
    index_text_for_search(title, combined_text, f"agent_memory_{category}", session_id, rel_path)

    return session_payload


def get_agent_session_memory(category: str, session_id: str) -> Optional[Dict[str, Any]]:
    cat_dir = get_agent_category_dir(category)
    file_path = cat_dir / f"{session_id}.json"
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def list_agent_sessions(category: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Lists saved session memories across categories from database/agent_memory/
    """
    sessions = []
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if category:
            cursor.execute("SELECT * FROM conversations WHERE category = ? ORDER BY updated_at DESC", (category,))
        else:
            cursor.execute("SELECT * FROM conversations ORDER BY updated_at DESC")
            
        for row in cursor.fetchall():
            sessions.append({
                "id": row["id"],
                "category": row["category"],
                "title": row["title"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"]
            })
    return sessions
