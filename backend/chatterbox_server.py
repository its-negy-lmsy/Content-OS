import os
import sys
import gc
import time
from pathlib import Path

# Restrict PyTorch CPU threads to prevent CPU/RAM OOM thrashing
os.environ["OMP_NUM_THREADS"] = "2"
os.environ["MKL_NUM_THREADS"] = "2"
os.environ["OPENBLAS_NUM_THREADS"] = "2"

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

# Enable PyTorch inference mode memory savings
torch.set_grad_enabled(False)

AUDIO_DIR = ROOT / "database" / "assets_vault" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

PRESET_DIR = ROOT / "database" / "tts_presets"
PRESET_DIR.mkdir(parents=True, exist_ok=True)

print("[Chatterbox Server] Loading PyTorch Chatterbox Multilingual Neural Speech Model...")
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[Chatterbox Server] Running on device: {device}")

from chatterbox import ChatterboxMultilingualTTS  # type: ignore
model = ChatterboxMultilingualTTS.from_pretrained(device)
print("[Chatterbox Server] Multilingual model loaded cleanly! (English, Hindi, Japanese active)")

VOICE_PRESETS = [
    "Studio Female (Natural)",
    "Narrative Male (Executive)",
    "Expressive Storyteller",
    "Warm Podcast Host"
]

PRESET_TIMBRE_MAP = {
    "Studio Female (Natural)": PRESET_DIR / "female_natural.wav",
    "Narrative Male (Executive)": PRESET_DIR / "male_executive.wav",
    "Expressive Storyteller": PRESET_DIR / "storyteller.wav",
    "Warm Podcast Host": PRESET_DIR / "warm_host.wav"
}

LANGUAGES = [
    "English",
    "Hindi (हिंदी)",
    "Japanese (日本語)"
]

LANG_MAP = {
    "English": "en",
    "Hindi (हिंदी)": "hi",
    "Japanese (日本語)": "ja"
}


def generate_speech(
    text: str,
    voice_preset: str = "Studio Female (Natural)",
    language: str = "English",
    audio_prompt=None,
    exaggeration: float = 0.5,
    temperature: float = 0.8,
    cfg_weight: float = 0.5
):
    if not text or not text.strip():
        text = "Welcome to Content OS Text to Speech Studio powered by Chatterbox."

    lang_code = LANG_MAP.get(language, "en")
    
    safe_text_preview = text[:50].encode('ascii', errors='replace').decode('ascii')
    print(f"[Chatterbox Server] Synthesizing [{language} ({lang_code})] speech: '{safe_text_preview}' [Preset: {voice_preset}]")

    # Select speaker timbre reference prompt
    ref_wav_path = None
    if audio_prompt:
        ref_wav_path = str(audio_prompt)
    elif voice_preset in PRESET_TIMBRE_MAP and PRESET_TIMBRE_MAP[voice_preset].exists():
        ref_wav_path = str(PRESET_TIMBRE_MAP[voice_preset])

    # Preset hyper-parameters
    if voice_preset == "Expressive Storyteller":
        exaggeration = max(0.65, exaggeration)
    elif voice_preset == "Narrative Male (Executive)":
        temperature = min(0.6, temperature)

    with torch.no_grad():
        wav_tensor = model.generate(
            text=text,
            language_id=lang_code,
            audio_prompt_path=ref_wav_path,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature
        )

    timestamp = int(time.time())
    out_filename = f"tts_chatterbox_{lang_code}_{timestamp}.wav"
    out_path = AUDIO_DIR / out_filename

    torchaudio.save(str(out_path), wav_tensor.cpu(), model.sr)
    
    # Free memory immediately after synthesis
    del wav_tensor
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    print(f"[Chatterbox Server] Audio generated and saved: {out_path} ({out_path.stat().st_size} bytes)")
    return str(out_path)


custom_css = """
textarea {
    min-height: 90px !important;
    max-height: 110px !important;
    font-size: 0.92rem !important;
    line-height: 1.35 !important;
}
.gradio-container {
    background-color: #09090b !important;
}
"""

app = gr.Interface(
    fn=generate_speech,
    inputs=[
        gr.Textbox(
            lines=3,
            max_lines=3,
            label="Script / Text Prompt",
            placeholder="Type your script here in English, Hindi, or Japanese...",
            value="Welcome to Content OS Text-to-Speech Studio. Select your voice and language below."
        ),
        gr.Dropdown(
            choices=VOICE_PRESETS,
            value="Studio Female (Natural)",
            label="Voice Preset / Speaker Timbre"
        ),
        gr.Dropdown(
            choices=LANGUAGES,
            value="English",
            label="Language Selection (English / Hindi / Japanese)"
        ),
        gr.Audio(
            sources=["upload"],
            type="filepath",
            label="Voice Cloning Reference Audio (Optional)"
        ),
        gr.Slider(minimum=0.0, maximum=1.0, value=0.5, step=0.05, label="Expressiveness / Exaggeration"),
        gr.Slider(minimum=0.1, maximum=1.5, value=0.8, step=0.05, label="Creativity / Temperature"),
        gr.Slider(minimum=0.0, maximum=1.0, value=0.5, step=0.05, label="Guidance Weight (CFG)")
    ],
    outputs=gr.Audio(label="Synthesized Chatterbox Speech WAV", type="filepath"),
    title=None,
    description=None
)

if __name__ == "__main__":
    try:
        app.launch(server_name="127.0.0.1", server_port=8001, share=False, css=custom_css)
    except OSError:
        print("[Chatterbox Server] Port 8001 is already active and serving Chatterbox TTS Studio.")
