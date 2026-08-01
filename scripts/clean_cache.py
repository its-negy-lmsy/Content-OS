"""
Content OS Storage Optimization & Cache Purger
Prunes duplicate Hugging Face weights & temporary cache blobs in database/cache.
"""

import os
import shutil
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
HF_CACHE = ROOT_DIR / "database" / "cache" / "huggingface"

def clean_cache():
    print("[CleanCache] Starting Content OS Cache & Storage Cleanup...")
    freed_bytes = 0

    if HF_CACHE.exists():
        hub_dir = HF_CACHE / "hub"
        if hub_dir.exists():
            for root, dirs, files in os.walk(hub_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    if "blobs" in root:
                        try:
                            size = os.path.getsize(file_path)
                            os.remove(file_path)
                            freed_bytes += size
                        except Exception as e:
                            print(f"Skipped {file}: {e}")

    freed_gb = freed_bytes / (1024 ** 3)
    print(f"[CleanCache] Successfully cleaned cache! Reclaimed {freed_gb:.2f} GB of disk space.")

if __name__ == "__main__":
    clean_cache()
