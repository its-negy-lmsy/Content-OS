import os
import sys
import gc
import time
from pathlib import Path

# Restrict PyTorch CPU threads to prevent OOM
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"

ROOT = Path(__file__).resolve().parent.parent
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

print("[Chatterbox Server] Loading Chatterbox TTS model...")
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[Chatterbox Server] Running on device: {device}")

from chatterbox import ChatterboxTTS  # type: ignore
model = ChatterboxTTS.from_pretrained(device)
print(f"[Chatterbox Server] Model loaded on {device}. Ready to generate speech.")


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

    with torch.no_grad():
        wav = model.generate(
            text=text,
            audio_prompt_path=ref_path,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature
        )

    out_path = AUDIO_DIR / f"tts_{int(time.time())}.wav"
    torchaudio.save(str(out_path), wav.cpu(), model.sr)

    del wav
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
