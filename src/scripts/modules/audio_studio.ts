/**
 * Content OS — Audio Studio & Voice Generator Module
 */

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  const config = {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
  };
  const response = await fetch(`http://localhost:8000${endpoint}`, config);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API Error ${response.status}: ${errorBody}`);
  }
  return response.json();
}

export function initAudioStudioModule() {
  const iframe = $<HTMLIFrameElement>('#tts-studio-iframe');
  const offlineNotice = $('#tts-offline-notice');
  const btnStartServer = $('#tts-btn-start-server');
  const btnLaunchOffline = $('#tts-btn-launch-offline');

  async function checkTTSStatus() {
    try {
      await fetch('http://localhost:8001/', { mode: 'no-cors' });
      if (iframe) {
        if (!iframe.src || iframe.src === 'about:blank' || iframe.style.display === 'none') {
          iframe.src = 'http://localhost:8001';
          iframe.style.display = 'block';
        }
      }
      if (offlineNotice) offlineNotice.style.display = 'none';
    } catch (e) {
      if (offlineNotice) offlineNotice.style.display = 'block';
      if (iframe) iframe.style.display = 'none';
    }
  }

  btnStartServer?.addEventListener('click', checkTTSStatus);
  btnLaunchOffline?.addEventListener('click', checkTTSStatus);
  checkTTSStatus();

  const btnGenerate = $('#ae-btn-generate-tts');
  const ttsInput = $<HTMLTextAreaElement>('#ae-tts-input');
  const ttsVoice = $<HTMLSelectElement>('#ae-tts-voice');

  if (btnGenerate && ttsInput) {
    btnGenerate.addEventListener('click', async () => {
      const text = ttsInput.value.trim();
      if (!text) {
        alert('Please enter text for voice synthesis.');
        return;
      }

      btnGenerate.setAttribute('disabled', 'true');
      btnGenerate.textContent = 'Generating Voice...';

      try {
        const voice = ttsVoice ? ttsVoice.value : 'af_heart';
        const res = await apiRequest<{ status: string; audio_url?: string; message?: string }>('/api/audio/tts/generate', {
          method: 'POST',
          body: JSON.stringify({ text, voice }),
        });

        if (res.status === 'success' && res.audio_url) {
          const audio = new Audio(res.audio_url);
          audio.play();
          alert('🎉 Voice synthesis generated successfully!');
        } else {
          alert(`TTS Error: ${res.message || 'Generation failed'}`);
        }
      } catch (err) {
        alert(`TTS API Connection Error: ${(err as Error).message}`);
      } finally {
        btnGenerate.removeAttribute('disabled');
        btnGenerate.textContent = 'Generate Speech Audio';
      }
    });
  }
}
