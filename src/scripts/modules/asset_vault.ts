/**
 * Content OS — Asset Vault Explorer Module
 * Manages media assets, folder filters, file uploads, stream previews, and clean empty state rendering.
 */

const API_BASE = 'http://localhost:8000';

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

let allAssets: any[] = [];
let activeFolder = 'all';

async function fetchVaultTree() {
  const gridEl = $('#av-assets-grid');
  if (!gridEl) return;

  try {
    const res = await fetch(`${API_BASE}/api/assets-vault/tree`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    // Normalize assets list (support array or nested structure)
    allAssets = Array.isArray(data) ? data : (data.files || data.assets || []);
    renderAssetsGrid();
  } catch (err) {
    console.warn('Failed to load asset vault tree:', err);
    renderAssetsGrid();
  }
}

function renderAssetsGrid() {
  const gridEl = $('#av-assets-grid');
  if (!gridEl) return;

  // Filter assets by selected folder tab
  const filtered = allAssets.filter((item) => {
    if (activeFolder === 'all') return true;
    const pathLower = (item.path || item.name || '').toLowerCase();
    const typeLower = (item.type || item.media_type || '').toLowerCase();
    
    if (activeFolder === 'videos') return typeLower.includes('video') || pathLower.match(/\.(mp4|webm|mov|mkv)$/);
    if (activeFolder === 'images') return typeLower.includes('image') || pathLower.match(/\.(png|jpg|jpeg|webp|gif|svg)$/);
    if (activeFolder === 'audio') return typeLower.includes('audio') || pathLower.match(/\.(mp3|wav|ogg|flac|aac)$/);
    if (activeFolder === 'hyperframes') return pathLower.includes('hyperframe') || pathLower.endsWith('.json');
    if (activeFolder === 'imports') return pathLower.includes('import') || item.is_import;
    return true;
  });

  if (filtered.length === 0) {
    gridEl.innerHTML = `
      <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; background: rgba(24,24,27,0.4); border: 1px dashed rgba(255,255,255,0.12); border-radius: 12px;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(255,85,0,0.1); border: 1px solid rgba(255,85,0,0.25); display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <i class="ph-bold ph-folder-open" style="font-size: 1.8rem; color: var(--accent-orange);"></i>
        </div>
        <h3 style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-bottom: 4px;">Vault Storage Empty</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 420px; margin-bottom: 20px;">No media assets found matching "${activeFolder}". Import media files or generate audio/video content to populate the vault.</p>
        <button id="av-empty-import-btn" class="btn btn-primary btn-sm" style="padding: 8px 18px; font-weight: 700;">
          <i class="ph-bold ph-upload-simple"></i> Import First Media Asset
        </button>
      </div>
    `;

    const emptyBtn = $('#av-empty-import-btn');
    if (emptyBtn) {
      emptyBtn.addEventListener('click', () => {
        const fileInput = $<HTMLInputElement>('#av-file-input');
        if (fileInput) fileInput.click();
      });
    }
    return;
  }

  gridEl.innerHTML = filtered.map((item) => {
    const filename = item.name || item.path?.split('/').pop() || 'Untitled Asset';
    const sizeStr = item.size ? formatBytes(item.size) : 'Media Asset';
    const path = item.rel_path || item.path || filename;

    // Safely encode each path segment for valid stream URL
    const encodedPath = path.split('/').map((s: string) => encodeURIComponent(s)).join('/');
    const streamUrl = item.stream_url ? `${API_BASE}${item.stream_url}` : `${API_BASE}/api/assets-vault/stream/${encodedPath}`;

    let icon = 'ph-file';
    let iconColor = '#a1a1aa';
    if (filename.match(/\.(mp4|webm|mov)$/i)) { icon = 'ph-video-camera'; iconColor = '#00b4d8'; }
    else if (filename.match(/\.(png|jpg|jpeg|webp|gif)$/i)) { icon = 'ph-image'; iconColor = '#ec4899'; }
    else if (filename.match(/\.(mp3|wav|ogg)$/i)) { icon = 'ph-waveform'; iconColor = '#10b981'; }

    let mediaPreviewHTML = '';
    if (filename.match(/\.(mp4|webm|mov)$/i)) {
      mediaPreviewHTML = `
        <div style="width: 100%; aspect-ratio: 16/9; background: #000000; border-radius: 6px; overflow: hidden; position: relative; border: 1px solid rgba(255,255,255,0.08);">
          <video src="${streamUrl}" controls preload="metadata" style="width: 100%; height: 100%; object-fit: contain;"></video>
        </div>
      `;
    } else if (filename.match(/\.(mp3|wav|ogg|flac)$/i)) {
      mediaPreviewHTML = `
        <div style="width: 100%; background: #121215; border-radius: 6px; padding: 10px; border: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; color: #10b981; font-size: 0.76rem; font-weight: 600;">
            <i class="ph-bold ph-waveform"></i> Audio Player & Playbar
          </div>
          <audio src="${streamUrl}" controls style="width: 100%; height: 36px; outline: none;"></audio>
        </div>
      `;
    } else if (filename.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i)) {
      mediaPreviewHTML = `
        <div style="width: 100%; aspect-ratio: 16/9; background: #000000; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08);">
          <img src="${streamUrl}" alt="${filename}" style="width: 100%; height: 100%; object-fit: cover;" />
        </div>
      `;
    } else {
      mediaPreviewHTML = `
        <div style="width: 100%; height: 80px; background: #121215; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; color: #a1a1aa; font-size: 0.8rem; gap: 6px;">
          <i class="ph-bold ph-file-code" style="font-size: 1.2rem;"></i> Data Asset Container
        </div>
      `;
    }

    return `
      <div class="panel-card" style="padding: 16px; display: flex; flex-direction: column; gap: 12px; position: relative;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
            <i class="ph-bold ${icon}" style="color: ${iconColor}; font-size: 1.2rem; flex-shrink: 0;"></i>
            <span style="font-weight: 700; font-size: 0.88rem; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${filename}">${filename}</span>
          </div>
          <button class="av-btn-delete" data-path="${path}" style="background: transparent; border: none; color: #ef4444; cursor: pointer; padding: 4px; opacity: 0.7;" title="Delete Asset">
            <i class="ph-bold ph-trash"></i>
          </button>
        </div>

        ${mediaPreviewHTML}

        <div style="font-size: 0.76rem; color: var(--text-muted); display: flex; justify-content: space-between; align-items: center;">
          <span>${sizeStr}</span>
          <a href="${streamUrl}" target="_blank" style="color: var(--accent-orange); text-decoration: none; font-weight: 600;">Open Direct Stream →</a>
        </div>
      </div>
    `;
  }).join('');

  // Attach delete handlers
  gridEl.querySelectorAll('.av-btn-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = btn.getAttribute('data-path');
      if (!path) return;
      if (confirm(`Are you sure you want to delete "${path}" from Asset Vault?`)) {
        try {
          const encPath = encodeURIComponent(path);
          let res = await fetch(`${API_BASE}/api/assets-vault/file?path=${encPath}`, { method: 'DELETE' });
          if (!res.ok) {
            const pathUrl = path.split('/').map((s: string) => encodeURIComponent(s)).join('/');
            await fetch(`${API_BASE}/api/assets-vault/files/${pathUrl}`, { method: 'DELETE' });
          }
          await fetchVaultTree();
        } catch (err) {
          console.warn('Failed to delete file:', err);
        }
      }
    });
  });
}

export function initAssetVaultModule() {
  // Folder tabs filtering
  const folderBtns = $$('#av-folder-filters button');
  folderBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      folderBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFolder = btn.getAttribute('data-folder') || 'all';
      renderAssetsGrid();
    });
  });

  // Import file button handler
  const btnImport = $('#av-btn-import-file');
  const fileInput = $<HTMLInputElement>('#av-file-input');

  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      try {
        await fetch(`${API_BASE}/api/assets-vault/upload`, {
          method: 'POST',
          body: formData,
        });
        fileInput.value = '';
        await fetchVaultTree();
      } catch (err) {
        console.warn('Failed to upload file:', err);
      }
    });
  }

  // Load tree initially
  fetchVaultTree();
}
