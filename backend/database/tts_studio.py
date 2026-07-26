import sys
import socket
import subprocess
from pathlib import Path
from backend.logger import push_log

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
PYTHON_EXE = ROOT_DIR / ".venv" / "Scripts" / "python.exe"
CHATTERBOX_SCRIPT = ROOT_DIR / "backend" / "chatterbox_server.py"
LOG_FILE = ROOT_DIR / "database" / "settings" / "chatterbox.log"

LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

_chatterbox_process = None


def is_chatterbox_server_running(port: int = 8001) -> bool:
    """Checks if port 8001 is accepting socket connections."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", port))
        s.close()
        return True
    except Exception:
        return False


def check_chatterbox_server_status() -> dict:
    running = is_chatterbox_server_running(8001)
    return {
        "status": "online" if running else "offline",
        "port": 8001,
        "url": "http://localhost:8001",
        "message": "Chatterbox TTS Local Web Studio server is running" if running else "Chatterbox TTS server is offline"
    }


def start_chatterbox_server() -> dict:
    global _chatterbox_process
    if is_chatterbox_server_running(8001):
        return {
            "status": "already_running",
            "port": 8001,
            "url": "http://localhost:8001",
            "message": "Chatterbox TTS Local Web Studio is already active on http://localhost:8001"
        }

    push_log("INFO", "TTS", "Starting Chatterbox TTS Local Web Studio on port 8001...")
    
    python_cmd = str(PYTHON_EXE) if PYTHON_EXE.exists() else sys.executable

    try:
        log_f = open(LOG_FILE, "a", encoding="utf-8")
        _chatterbox_process = subprocess.Popen(
            [python_cmd, str(CHATTERBOX_SCRIPT)],
            cwd=str(ROOT_DIR),
            stdout=log_f,
            stderr=log_f
        )
        
        return {
            "status": "starting",
            "port": 8001,
            "url": "http://localhost:8001",
            "message": "Chatterbox TTS Local Web Studio server process launched on port 8001"
        }
    except Exception as err:
        push_log("ERROR", "TTS", f"Failed to start Chatterbox server: {err}")
        return {
            "status": "error",
            "message": f"Failed to start Chatterbox server: {err}"
        }
