from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
LOG_FILE = ROOT / "database" / "settings" / "system.log"

MAX_LOGS = 500
_log_buffer: deque[dict[str, Any]] = deque(maxlen=MAX_LOGS)
_listeners: set[asyncio.Queue] = set()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3]


def push_log(level: str, source: str, message: str, detail: str = "") -> dict[str, Any]:
    entry = {
        "id": f"log-{int(time.time() * 1000)}-{len(_log_buffer)}",
        "timestamp": now_iso(),
        "level": level.upper(),
        "source": source.upper(),
        "message": message,
        "detail": detail
    }
    _log_buffer.append(entry)

    # Persist asynchronously / safely to disk
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass

    # Push to live listeners
    dead_listeners = set()
    for q in list(_listeners):
        try:
            q.put_nowait(entry)
        except Exception:
            dead_listeners.add(q)
    for q in dead_listeners:
        _listeners.discard(q)

    return entry


def get_recent_logs(limit: int = 200) -> list[dict[str, Any]]:
    return list(_log_buffer)[-limit:]


def clear_logs() -> bool:
    _log_buffer.clear()
    if LOG_FILE.exists():
        try:
            LOG_FILE.write_text("", encoding="utf-8")
        except Exception:
            pass
    return True


async def log_stream_generator() -> AsyncGenerator[str, None]:
    q: asyncio.Queue = asyncio.Queue()
    _listeners.add(q)
    try:
        # Send initial recent logs backlog
        recent = get_recent_logs(50)
        yield f"data: {json.dumps({'type': 'backlog', 'logs': recent})}\n\n"

        while True:
            try:
                entry = await asyncio.wait_for(q.get(), timeout=15.0)
                yield f"data: {json.dumps({'type': 'log', 'log': entry})}\n\n"
            except asyncio.TimeoutError:
                # Heartbeat
                yield f": ping\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        _listeners.discard(q)


class SystemLogHandler(logging.Handler):
    """Hooks Python standard logging into Content OS System Log Stream."""
    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            level = record.levelname
            name = record.name
            
            source = "API"
            if "uvicorn" in name:
                source = "UVICORN"
            elif "fastapi" in name:
                source = "API"
            elif "hyperframe" in name:
                source = "HYPERFRAME"
            elif "agent" in name:
                source = "AGENT"
            elif "pipeline" in name or "canvas" in name:
                source = "PIPELINE"
                
            push_log(level=level, source=source, message=msg)
        except Exception:
            self.handleError(record)


# Pre-populate initial system start log
push_log("INFO", "SYSTEM", "Content OS System Log Stream Initialized.")
