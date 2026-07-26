import os
import sys
import time
from pathlib import Path

# Add project root and venv site-packages to sys.path
ROOT = Path(__file__).resolve().parent.parent
VENV_SITE = ROOT / ".venv" / "Lib" / "site-packages"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if VENV_SITE.exists() and str(VENV_SITE) not in sys.path:
    sys.path.insert(0, str(VENV_SITE))

# Patch resemblance-perth for Chatterbox compatibility
import perth  # type: ignore
if not hasattr(perth, "PerthImplicitWatermarker") or getattr(perth, "PerthImplicitWatermarker", None) is None:
    perth.PerthImplicitWatermarker = perth.DummyWatermarker

import torch  # type: ignore
import torchaudio  # type: ignore
import gradio as gr  # type: ignore
from chatterbox import ChatterboxTTS  # type: ignore

AUDIO_DIR = ROOT / "database" / "assets_vault" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

print("[Chatterbox Server] Loading PyTorch Chatterbox TTS Neural Network...")
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[Chatterbox Server] Running on device: {device}")

model = ChatterboxTTS.from_pretrained(device)
print("[Chatterbox Server] Model loaded successfully! Launching Gradio Web UI on http://127.0.0.1:8001")


def generate_speech(text: str, exaggeration: float = 0.5, temperature: float = 0.8):
    if not text or not text.strip():
        text = "Welcome to Content OS Chatterbox Text to Speech Studio."
    
    print(f"[Chatterbox Server] Synthesizing speech for: '{text[:60]}...'")
    wav_tensor = model.generate(
        text=text,
        exaggeration=exaggeration,
        temperature=temperature
    )
    
    timestamp = int(time.time())
    out_filename = f"tts_chatterbox_{timestamp}.wav"
    out_path = AUDIO_DIR / out_filename
    
    torchaudio.save(str(out_path), wav_tensor.cpu(), model.sr)
    print(f"[Chatterbox Server] Audio generated and saved to: {out_path} ({out_path.stat().st_size} bytes)")
    
    return str(out_path)


app = gr.Interface(
    fn=generate_speech,
    inputs=[
        gr.Textbox(
            lines=6,
            label="Script / Text Prompt",
            placeholder="Type or paste your video script here...",
            value="Welcome to Content OS Text-to-Speech Studio. Chatterbox neural speech synthesis model is live."
        ),
        gr.Slider(minimum=0.0, maximum=1.0, value=0.5, step=0.05, label="Expressiveness / Exaggeration"),
        gr.Slider(minimum=0.1, maximum=1.5, value=0.8, step=0.05, label="Creativity / Temperature"),
    ],
    outputs=gr.Audio(label="Synthesized Chatterbox Speech WAV", type="filepath"),
    title=None,
    description=None
)

if __name__ == "__main__":
    try:
        app.launch(server_name="127.0.0.1", server_port=8001, share=False)
    except OSError:
        print("[Chatterbox Server] Port 8001 is already active and serving Chatterbox TTS Studio.")
