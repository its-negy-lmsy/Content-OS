/**
 * Content OS — Storage & Cache Module
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

export function initStorageCacheModule() {
  const btnCleanAll = $('#stg-btn-clean-all');
  if (btnCleanAll) {
    btnCleanAll.addEventListener('click', async () => {
      if (confirm('Clear temporary caches (proxies, thumbnails, waveforms)? Original assets will remain safe.')) {
        try {
          await apiRequest('/api/video/storage/clean', { method: 'POST', body: JSON.stringify({ target: 'all' }) });
          alert('✨ All temporary caches cleared cleanly.');
        } catch (e) {
          alert('Storage purge error: ' + (e as Error).message);
        }
      }
    });
  }
}
