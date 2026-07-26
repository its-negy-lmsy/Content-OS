import os
import sys
import gc
import time
import threading
from pathlib import Path

# Redirect all HuggingFace, PyTorch, and pip caches to local project folder (D:\Content OS\database\cache)
ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "database" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

os.environ["HF_HOME"] = str(CACHE_DIR / "huggingface")
os.environ["TORCH_HOME"] = str(CACHE_DIR / "torch")
os.environ["PIP_CACHE_DIR"] = str(CACHE_DIR / "pip")
os.environ["TRANSFORMERS_CACHE"] = str(CACHE_DIR / "huggingface")

# Restrict PyTorch CPU threads to prevent OOM thrashing
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"

VENV_SITE = ROOT / ".venv" / "Lib" / "site-packages"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if VENV_SITE.exists() and str(VENV_SITE) not in sys.path:
    sys.path.insert(0, str(VENV_SITE))

import perth  # type: ignore
if not hasattr(perth, "PerthImplicitWatermarker") or getattr(perth, "PerthImplicitWatermarker", None) is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

import torch  # type: ignore
import torchaudio  # type: ignore
import gradio as gr  # type: ignore

torch.set_grad_enabled(False)

AUDIO_DIR = ROOT / "database" / "assets_vault" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

_model = None
_model_lock = threading.Lock()
_last_used_time = 0
IDLE_TIMEOUT_SECONDS = 15


def get_model():
    global _model, _last_used_time
    _last_used_time = time.time()
    with _model_lock:
        if _model is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[Chatterbox Server] Dynamic Load: Loading Chatterbox TTS into {device}...")
            from chatterbox import ChatterboxTTS  # type: ignore
            _model = ChatterboxTTS.from_pretrained(device)
            print(f"[Chatterbox Server] Model loaded on {device}. Ready for synthesis.")
        return _model


def unload_idle_model_worker():
    global _model
    while True:
        time.sleep(5)
        if _model is not None and (time.time() - _last_used_time) > IDLE_TIMEOUT_SECONDS:
            with _model_lock:
                if _model is not None and (time.time() - _last_used_time) > IDLE_TIMEOUT_SECONDS:
                    print("[Chatterbox Server] Idle Timeout: Purging model weights to free RAM/VRAM...")
                    del _model
                    _model = None
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    gc.collect()
                    print("[Chatterbox Server] Memory successfully purged.")


# Launch background idle monitor thread
threading.Thread(target=unload_idle_model_worker, daemon=True).start()


def generate_speech(
    text: str,
    audio_prompt=None,
    exaggeration: float = 0.5,
    temperature: float = 0.8,
    cfg_weight: float = 0.5
):
    if not text or not text.strip():
        text = "Welcome to Content OS Text to Speech Studio."

    print(f"[Chatterbox Server] Generating: '{text[:60]}...'")

    ref_path = str(audio_prompt) if audio_prompt else None
    model_inst = get_model()

    with torch.no_grad():
        wav = model_inst.generate(
            text=text,
            audio_prompt_path=ref_path,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature
        )

    out_path = AUDIO_DIR / f"tts_{int(time.time())}.wav"
    torchaudio.save(str(out_path), wav.cpu(), model_inst.sr)

    del wav
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    gc.collect()

    print(f"[Chatterbox Server] Saved: {out_path.name} ({out_path.stat().st_size} bytes)")
    return str(out_path)


custom_css = """
textarea {
    min-height: 120px !important;
    font-size: 0.95rem !important;
    line-height: 1.5 !important;
    padding: 12px !important;
    background-color: #121215 !important;
    color: #f4f4f5 !important;
    border-color: #27272a !important;
}
.gradio-container {
    background-color: #09090b !important;
}
"""

app = gr.Interface(
    fn=generate_speech,
    inputs=[
        gr.Textbox(lines=4, max_lines=6, label="Text / Script Prompt", placeholder="Type your script here...",
                   value="Welcome to Content OS Text-to-Speech Studio."),
        gr.Audio(sources=["upload"], type="filepath", label="Voice Clone Reference (Optional)"),
        gr.Slider(0.0, 1.0, 0.5, step=0.05, label="Expressiveness"),
        gr.Slider(0.1, 1.5, 0.8, step=0.05, label="Temperature"),
        gr.Slider(0.0, 1.0, 0.5, step=0.05, label="CFG Weight"),
    ],
    outputs=gr.Audio(label="Generated Speech", type="filepath"),
    title=None,
    description=None,
)

if __name__ == "__main__":
    try:
        app.launch(server_name="127.0.0.1", server_port=8001, share=False, css=custom_css)
    except OSError:
        print("[Chatterbox Server] Port 8001 already in use.")
