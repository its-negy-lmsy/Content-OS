/**
 * Content OS — Video Studio Module (CapCut Desktop Layout Engine)
 * Manages timeline tracks, clips, canvas composition, playback loop, context menu, and undo/redo engine.
 */

// Helper utility query selectors
function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}



function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

let activeTimeline: {
  project_name: string;
  fps: number;
  width: number;
  height: number;
  duration: number;
  playhead: number;
  tracks: any[];
  clips: any[];
} = {
  project_name: 'IntroExercise',
  fps: 30,
  width: 1920,
  height: 1080,
  duration: 30.0,
  playhead: 0.0,
  tracks: [
    { id: 1, name: 'V1 · Main Video Footage', type: 'video', muted: false, solo: false, locked: false },
    { id: 2, name: 'A1 · Dialogue & Audio', type: 'audio', muted: false, solo: false, locked: false },
  ],
  clips: [],
};

// State variables
let pxPerSec = 15;
let isPlaying = false;
let playheadTime = 0.0;
let timelineDuration = 30.0;
let animationFrameId: number | null = null;
let selectedClipId: string | null = null;

// Undo / Redo History Stack Engine
const undoStack: string[] = [];
const redoStack: string[] = [];

function pushUndoState() {
  const stateCopy = JSON.parse(JSON.stringify(activeTimeline));
  undoStack.push(JSON.stringify(stateCopy));
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}

function undoAction() {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify(activeTimeline));
  const prevState = undoStack.pop();
  if (prevState) {
    activeTimeline = JSON.parse(prevState);
    persistTimelineState();
    renderTimeline();
    updateInspectorForSelectedClip();
    drawCompositionGuide();
  }
}

function redoAction() {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify(activeTimeline));
  const nextState = redoStack.pop();
  if (nextState) {
    activeTimeline = JSON.parse(nextState);
    persistTimelineState();
    renderTimeline();
    updateInspectorForSelectedClip();
    drawCompositionGuide();
  }
}

// Media Element Caches
const videoMediaCache = new Map<string, HTMLVideoElement>();
const audioMediaCache = new Map<string, HTMLAudioElement>();
const offscreenCacheMap = new Map<string, HTMLCanvasElement>();

function getOrCreateVideoOffscreenCanvas(src: string): HTMLCanvasElement {
  let offCanvas = offscreenCacheMap.get(src);
  if (!offCanvas) {
    offCanvas = document.createElement('canvas');
    offCanvas.width = 1920;
    offCanvas.height = 1080;
    offscreenCacheMap.set(src, offCanvas);
  }
  return offCanvas;
}

function getOrCreateVideoElement(src: string): HTMLVideoElement {
  let video = videoMediaCache.get(src);
  if (!video) {
    video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.playsInline = true;
    video.src = src.startsWith('http') || src.startsWith('blob:') ? src : `http://localhost:8000/api/assets-vault/stream/${src.replace('database/assets_vault/', '')}`;

    const vEl = video;
    vEl.addEventListener('seeked', () => {
      const offCanvas = getOrCreateVideoOffscreenCanvas(src);
      const offCtx = offCanvas.getContext('2d');
      if (offCtx && vEl.readyState >= 2) {
        try {
          offCtx.drawImage(vEl, 0, 0, 1920, 1080);
        } catch (e) {}
      }
      if (!isPlaying) {
        requestAnimationFrame(drawCompositionGuide);
      }
    });

    videoMediaCache.set(src, video);
  }
  return video;
}

function getOrCreateAudioElement(src: string): HTMLAudioElement {
  let audio = audioMediaCache.get(src);
  if (!audio) {
    audio = document.createElement('audio');
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = src.startsWith('http') || src.startsWith('blob:') ? src : `http://localhost:8000/api/assets-vault/stream/${src.replace('database/assets_vault/', '')}`;
    audioMediaCache.set(src, audio);
  }
  return audio;
}

async function syncTimelineFromBackend() {
  try {
    const state = await apiRequest<any>('/api/video/project');
    if (state && Array.isArray(state.clips) && Array.isArray(state.tracks)) {
      activeTimeline = state;
      timelineDuration = activeTimeline.duration || 30.0;
    }
  } catch (e) {
    console.error('The editor project could not be loaded:', e);
  }
  renderTimeline();
  drawCompositionGuide();
}

let persistTimer: any = null;
function persistTimelineState() {
  try {
    localStorage.setItem('capcut_active_timeline', JSON.stringify(activeTimeline));
  } catch (e) {}

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const snapshot = JSON.parse(JSON.stringify(activeTimeline));
    apiRequest<{ timeline: typeof activeTimeline }>('/api/video/engine/event', {
      method: 'POST',
      body: JSON.stringify({ op: 'replace_timeline', payload: snapshot }),
    }).catch((e) => {
      console.warn('Backend sync saved locally:', e);
    });
  }, 200);
}

function updatePlayheadUI() {
  const pinEl = $<HTMLElement>('#ae-playhead-pin');
  const lineEl = $<HTMLElement>('#ae-playhead-line');
  const tcEl = $('#ae-timecode-display');
  const TRACK_HEADER_WIDTH = 36;
  const pinLeftPx = TRACK_HEADER_WIDTH + playheadTime * pxPerSec;

  if (pinEl) pinEl.style.left = `${pinLeftPx}px`;
  if (lineEl) lineEl.style.left = `${pinLeftPx}px`;
  if (tcEl) tcEl.textContent = formatFullTimecode(playheadTime);
}

function formatFullTimecode(seconds: number): string {
  const totalMs = Math.floor(seconds * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const frames = Math.floor(((totalMs % 1000) / 1000) * 30);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

function deleteClipById(clipId: string) {
  pushUndoState();
  const clipToDelete = activeTimeline.clips.find((c: any) => c.id === clipId);
  if (clipToDelete && clipToDelete.media_type === 'audio' && clipToDelete.name.includes('(Extracted Audio)')) {
    const origVideoName = clipToDelete.name.replace(' (Extracted Audio)', '');
    const origVideo = activeTimeline.clips.find((c: any) => c.name === origVideoName && c.media_type === 'video');
    if (origVideo) {
      origVideo.is_muted = false;
    }
  }

  activeTimeline.clips = activeTimeline.clips.filter((c: any) => c.id !== clipId);
  if (selectedClipId === clipId) selectedClipId = activeTimeline.clips[0]?.id || null;
  persistTimelineState();
  renderTimeline();
  drawCompositionGuide();
}

function renderTimeline() {
  // Sanitize & Enforce Track Hierarchy
  if (!activeTimeline.tracks || activeTimeline.tracks.length === 0) {
    activeTimeline.tracks = [
      { id: 1, name: 'V1 · Main Video Footage', type: 'video', muted: false, solo: false, locked: false },
      { id: 2, name: 'A1 · Dialogue & Audio', type: 'audio', muted: false, solo: false, locked: false },
    ];
  } else {
    const vTracks = activeTimeline.tracks.filter((t: any) => t.type === 'video');
    const aTracks = activeTimeline.tracks.filter((t: any) => t.type === 'audio');
    if (vTracks.length === 0) vTracks.push({ id: 1, name: 'V1 · Main Video Footage', type: 'video', muted: false, solo: false, locked: false });
    if (aTracks.length === 0) aTracks.push({ id: 2, name: 'A1 · Dialogue & Audio', type: 'audio', muted: false, solo: false, locked: false });

    vTracks.forEach((vt: any, i: number) => { vt.name = `V${i + 1} · Video Track`; });
    aTracks.forEach((at: any, i: number) => { at.name = `A${i + 1} · Audio Track`; });
    activeTimeline.tracks = [...vTracks, ...aTracks];
  }

  let maxClipEnd = 30.0;
  (activeTimeline.clips || []).forEach((c: any) => {
    const end = (c.start_time || 0) + (c.duration || 0);
    if (end > maxClipEnd) maxClipEnd = end;
  });
  timelineDuration = Math.max(60.0, Math.ceil(maxClipEnd + 30.0));

  const layerListEl = $('#ae-layer-list');
  const rulerEl = $('#ae-time-ruler');
  const trackCanvasEl = $('#ae-track-canvas');
  if (!layerListEl || !rulerEl || !trackCanvasEl) return;

  const TRACK_HEADER_WIDTH = 36;
  const pinLeftPx = TRACK_HEADER_WIDTH + playheadTime * pxPerSec;

  // Render Time Ruler Ticks
  let rulerHTML = `<div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${TRACK_HEADER_WIDTH}px; background: #121215; border-right: 1px solid #1e1e24; z-index: 10;"></div>`;
  const minLabelPx = 90;
  let step = Math.max(2, Math.ceil(minLabelPx / pxPerSec));
  if (step % 2 !== 0 && step > 1) step += 1;

  const totalSecs = Math.ceil(timelineDuration);
  for (let s = 0; s <= totalSecs; s += 1) {
    const leftPx = TRACK_HEADER_WIDTH + s * pxPerSec;
    const isLabeled = s % step === 0;

    if (isLabeled) {
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      const label = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      rulerHTML += `<span style="position: absolute; left: ${leftPx}px; border-left: 1px solid #4a4a58; padding-left: 4px; height: 100%; font-family: monospace; font-size: 0.62rem; color: #a1a1aa; line-height: 22px; pointer-events: none; white-space: nowrap;">${label}</span>`;
    } else {
      rulerHTML += `<span style="position: absolute; left: ${leftPx}px; border-left: 1px solid #272730; height: 35%; bottom: 0; pointer-events: none;"></span>`;
    }
  }

  rulerHTML += `
    <div id="ae-playhead-pin" style="position: absolute; left: ${pinLeftPx - 7}px; top: 2px; width: 14px; height: 16px; cursor: pointer; z-index: 30;" title="CapCut Playhead (${playheadTime.toFixed(2)}s)">
      <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
        <path d="M0 0 H14 V10 L7 16 L0 10 Z" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
      </svg>
    </div>
  `;
  rulerEl.innerHTML = rulerHTML;

  // Render Left Layer List
  let layerHTML = `
    <div style="height: 24px; background: #121215; border-bottom: 1px solid #1e1e24; display: flex; align-items: center; justify-content: space-between; padding: 0 8px;">
      <span style="font-size: 0.62rem; color: #a1a1aa; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Timeline Tracks</span>
      <button id="ae-btn-add-track-header" style="background: transparent; border: none; color: #3b82f6; cursor: pointer; font-size: 0.9rem;" title="Add Video / Audio Track">+</button>
    </div>
  `;

  activeTimeline.clips.forEach((clip) => {
    const isSelected = clip.id === selectedClipId;
    const icon = clip.media_type === 'video' ? 'ph-film-strip' : clip.media_type === 'audio' ? 'ph-waveform' : clip.media_type === 'text' ? 'ph-text-t' : 'ph-image';
    const typeColor = clip.media_type === 'video' ? '#00b4d8' : clip.media_type === 'audio' ? '#10b981' : clip.media_type === 'text' ? '#8b5cf6' : '#f59e0b';
    layerHTML += `
      <div class="ae-layer-row ${isSelected ? 'selected' : ''}" data-clip-id="${clip.id}" style="height: 36px; border-bottom: 1px solid #1a1a20; background: ${isSelected ? '#1e1e24' : 'transparent'}; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; cursor: pointer;">
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
          <i class="ph-bold ${icon}" style="color: ${typeColor}; font-size: 0.85rem;"></i>
          <span style="font-size: 0.72rem; color: #e4e4e7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(clip.name)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button class="delete-clip" style="background: transparent; border: none; color: #71717a; cursor: pointer; font-size: 0.75rem;" title="Delete Clip">✕</button>
        </div>
      </div>
    `;
  });

  layerListEl.innerHTML = layerHTML;

  layerListEl.querySelectorAll('.ae-layer-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const clipId = row.getAttribute('data-clip-id');
      if (!clipId) return;

      if (target.classList.contains('delete-clip') || target.closest('.delete-clip')) {
        deleteClipById(clipId);
        return;
      }

      selectedClipId = clipId;
      renderTimeline();
      updateInspectorForSelectedClip();
    });
  });

  // Render Right Track Canvas Lanes
  let tracksHTML = `
    <div id="ae-work-area-bar" style="position: absolute; top: 0; left: ${TRACK_HEADER_WIDTH}px; width: ${timelineDuration * pxPerSec}px; height: 4px; background: #00b4d8; border-radius: 2px; z-index: 2;"></div>
    <div id="ae-playhead-line" style="position: absolute; top: 0; bottom: 0; left: ${pinLeftPx}px; width: 1.5px; background: #ffffff; z-index: 25; pointer-events: none; box-shadow: 0 0 6px rgba(255,255,255,0.9);"></div>
  `;

  const currentTracks = (activeTimeline.tracks && activeTimeline.tracks.length > 0)
    ? activeTimeline.tracks
    : [
        { id: 1, name: 'V1 · Video Track', type: 'video' },
        { id: 2, name: 'A1 · Audio Track', type: 'audio' },
      ];

  currentTracks.forEach((track, idx) => {
    const bg = idx % 2 === 0 ? '#101014' : '#141418';
    const trackColor = track.type === 'video' ? '#00b4d8' : track.type === 'audio' ? '#10b981' : track.type === 'text' ? '#8b5cf6' : '#f59e0b';
    const trackLabel = track.name ? track.name.split(' ')[0] : (track.type === 'video' ? `V${idx+1}` : `A${idx+1}`);

    tracksHTML += `
      <div style="position: absolute; top: ${idx * 36}px; left: 0; right: 0; height: 36px; background: ${bg}; border-bottom: 1px solid #1a1a20; pointer-events: none;">
        <div style="position: absolute; left: 3px; top: 0; height: 36px; width: 30px; display: flex; align-items: center; justify-content: center; z-index: 10; pointer-events: auto;" title="${escapeHtml(track.name || '')}">
          <span style="font-size: 0.58rem; font-weight: 700; color: ${trackColor}; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;">${escapeHtml(trackLabel)}</span>
        </div>
      </div>
    `;
  });

  activeTimeline.clips.forEach((clip) => {
    const isSelected = clip.id === selectedClipId;
    let trackIdx = currentTracks.findIndex((t) => String(t.id) === String(clip.track_id));
    if (trackIdx < 0) {
      trackIdx = currentTracks.findIndex((t) => clip.media_type === 'audio' ? t.type === 'audio' : (t.type === 'video' || t.type === 'text'));
      if (trackIdx < 0) trackIdx = 0;
    }

    const targetTrack = currentTracks[trackIdx];
    const clipBg = targetTrack?.type === 'video' ? '#0d5c63' : targetTrack?.type === 'audio' ? '#0b4d3c' : targetTrack?.type === 'text' ? '#5b21b6' : '#92400e';
    const borderColor = isSelected ? '#ffffff' : '#00b4d8';

    const leftPx = TRACK_HEADER_WIDTH + clip.start_time * pxPerSec;
    const widthPx = Math.max(20, clip.duration * pxPerSec);
    const topPx = trackIdx * 36 + 4;

    let waveSVG = '';
    if (clip.media_type === 'audio') {
      waveSVG = `
        <svg style="position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.6; pointer-events: none;" preserveAspectRatio="none" viewBox="0 0 100 28">
          <path d="M 0 14 Q 5 4, 10 14 T 20 14 T 30 4 T 40 24 T 50 14 T 60 4 T 70 24 T 80 14 T 90 4 T 100 14 L 100 28 L 0 28 Z" fill="#10b981" />
        </svg>
      `;
    }

    let filmstripHTML = '';
    if (clip.media_type === 'video') {
      filmstripHTML = `
        <div style="position: absolute; inset: 0; opacity: 0.35; background-image: linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px); background-size: 24px 100%; pointer-events: none;"></div>
      `;
    }

    tracksHTML += `
      <div class="ae-clip-bar ${isSelected ? 'selected' : ''}" data-clip-id="${clip.id}" style="position: absolute; top: ${topPx}px; left: ${leftPx}px; width: ${widthPx}px; height: 28px; background: ${clipBg}; border: 1px solid ${borderColor}; border-radius: 3px; display: flex; align-items: center; justify-content: space-between; padding: 0 6px; color: #ffffff; font-size: 0.68rem; font-weight: 600; cursor: move; user-select: none; z-index: 3; overflow: hidden;">
        ${filmstripHTML}
        ${waveSVG}
        <div class="ae-trim-handle-left" style="position: absolute; left: 0; top: 0; bottom: 0; width: 5px; cursor: w-resize; background: rgba(255,255,255,0.5); z-index: 6;"></div>
        <span style="pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 4px; z-index: 4; position: relative; font-family: monospace;">${escapeHtml(clip.name)}</span>
        <div class="ae-trim-handle-right" style="position: absolute; right: 0; top: 0; bottom: 0; width: 5px; cursor: e-resize; background: rgba(255,255,255,0.5); z-index: 6;"></div>
      </div>
    `;
  });

  trackCanvasEl.innerHTML = tracksHTML;
  attachClipDragListeners();
}

function updateInspectorForSelectedClip() {
  const clip = activeTimeline.clips.find((c) => c.id === selectedClipId);
  if (!clip) return;

  const clipNameEl = $('#ae-inspect-clip-name');
  if (clipNameEl) clipNameEl.textContent = clip.name;

  const inpPosX = $<HTMLInputElement>('#ae-inp-pos-x');
  const inpPosY = $<HTMLInputElement>('#ae-inp-pos-y');
  const inpScale = $<HTMLInputElement>('#ae-inp-scale');
  const inpRotation = $<HTMLInputElement>('#ae-inp-rotation');
  const inpOpacity = $<HTMLInputElement>('#ae-inp-opacity');

  if (inpPosX && clip.transform) inpPosX.value = String(clip.transform.position_x || 0);
  if (inpPosY && clip.transform) inpPosY.value = String(clip.transform.position_y || 0);
  if (inpScale && clip.transform) inpScale.value = String(clip.transform.scale_x || 100);
  if (inpRotation && clip.transform) inpRotation.value = String(clip.transform.rotation || 0);
  if (inpOpacity && clip.transform) inpOpacity.value = String(clip.transform.opacity || 100);
}

function attachClipDragListeners() {
  const trackCanvas = $('#ae-track-canvas');
  if (!trackCanvas) return;

  trackCanvas.querySelectorAll<HTMLElement>('.ae-clip-bar').forEach((bar) => {
    const clipId = bar.getAttribute('data-clip-id');
    const clip = activeTimeline.clips.find((c) => c.id === clipId);
    if (!clip) return;

    bar.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;

      selectedClipId = clip.id;
      updateInspectorForSelectedClip();

      const TRACK_HEADER_WIDTH = 36;

      if (target.classList.contains('ae-trim-handle-left')) {
        e.stopPropagation();
        let initialX = e.clientX;
        let initialStart = clip.start_time;
        let initialDuration = clip.duration;

        pushUndoState();

        const onMove = (mEvt: MouseEvent) => {
          const deltaSec = (mEvt.clientX - initialX) / pxPerSec;
          const newStart = Math.max(0, initialStart + deltaSec);
          const newDuration = Math.max(0.5, initialDuration - (newStart - initialStart));

          clip.start_time = newStart;
          clip.duration = newDuration;

          bar.style.left = `${TRACK_HEADER_WIDTH + newStart * pxPerSec}px`;
          bar.style.width = `${newDuration * pxPerSec}px`;
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          persistTimelineState();
          renderTimeline();
          drawCompositionGuide();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }

      if (target.classList.contains('ae-trim-handle-right')) {
        e.stopPropagation();
        let initialX = e.clientX;
        let initialDuration = clip.duration;

        pushUndoState();

        const onMove = (mEvt: MouseEvent) => {
          const deltaSec = (mEvt.clientX - initialX) / pxPerSec;
          const newDuration = Math.max(0.5, initialDuration + deltaSec);
          clip.duration = newDuration;
          bar.style.width = `${newDuration * pxPerSec}px`;
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          persistTimelineState();
          renderTimeline();
          drawCompositionGuide();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return;
      }

      let initialX = e.clientX;
      let initialStart = clip.start_time;

      pushUndoState();

      const onMove = (mEvt: MouseEvent) => {
        const deltaSec = (mEvt.clientX - initialX) / pxPerSec;
        let newStart = Math.max(0, initialStart + deltaSec);
        if (newStart < 0.15) newStart = 0.0;

        const rect = trackCanvas.getBoundingClientRect();
        const mouseY = mEvt.clientY - rect.top;
        const trackIdx = Math.max(0, Math.min(Math.floor(mouseY / 36), activeTimeline.tracks.length - 1));
        const targetTrack = activeTimeline.tracks[trackIdx];

        if (targetTrack) {
          const isAudio = clip.media_type === 'audio';
          if ((isAudio && targetTrack.type === 'audio') || (!isAudio && targetTrack.type === 'video')) {
            clip.track_id = targetTrack.id;
          }
        }

        clip.start_time = newStart;
        const currentTrackIdx = activeTimeline.tracks.findIndex((t: any) => String(t.id) === String(clip.track_id));
        const topPx = (currentTrackIdx >= 0 ? currentTrackIdx : 0) * 36 + 4;

        bar.style.left = `${TRACK_HEADER_WIDTH + newStart * pxPerSec}px`;
        bar.style.top = `${topPx}px`;
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        persistTimelineState();
        renderTimeline();
        drawCompositionGuide();
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}

function drawCompositionGuide() {
  const previewCanvas = $<HTMLCanvasElement>('#ae-preview-canvas');
  if (!previewCanvas) return;
  const ctx = previewCanvas.getContext('2d');
  if (!ctx) return;
  const w = previewCanvas.width;
  const h = previewCanvas.height;

  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, w, h);

  const activeClips = activeTimeline.clips || [];
  if (activeClips.length > 0) {
    activeClips.forEach((clip: any) => {
      const isClipActive = playheadTime >= clip.start_time && playheadTime <= (clip.start_time + clip.duration);

      if (clip.media_type === 'video') {
        const video = getOrCreateVideoElement(clip.src);
        if (!isClipActive) {
          if (!video.paused) video.pause();
          return;
        }

        const clipTransform = clip.transform || {};
        const posXVal = clipTransform.position_x || 0;
        const posYVal = clipTransform.position_y || 0;
        const scaleVal = clipTransform.scale_x || 100;
        const rotVal = clipTransform.rotation || 0;

        const posX = (w / 2) + posXVal;
        const posY = (h / 2) + posYVal;
        const clipScale = scaleVal / 100;

        const mediaTime = (playheadTime - clip.start_time) + (clip.in_point || 0);

        ctx.save();
        ctx.translate(posX, posY);
        ctx.rotate((rotVal * Math.PI) / 180);
        ctx.scale(clipScale, clipScale);

        if (isPlaying) {
          video.muted = Boolean(clip.is_muted || clip.muted);
          if (video.paused) {
            if (Math.abs(video.currentTime - mediaTime) > 0.1) {
              video.currentTime = mediaTime;
            }
            video.play().catch(() => {});
          }
        } else {
          if (!video.paused) video.pause();
          if (Math.abs(video.currentTime - mediaTime) > 0.03 && !video.seeking) {
            video.currentTime = mediaTime;
          }
        }

        const offCanvas = getOrCreateVideoOffscreenCanvas(clip.src);
        const offCtx = offCanvas.getContext('2d');

        if (isPlaying && video.readyState >= 2 && !video.seeking) {
          try {
            if (offCtx) offCtx.drawImage(video, 0, 0, 1920, 1080);
          } catch (e) {}
        }

        try {
          ctx.drawImage(offCanvas, -w / 2, -h / 2, w, h);
        } catch (e) {}

        if (clip.id === selectedClipId) {
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2;
          ctx.strokeRect(-w / 2, -h / 2, w, h);
        }

        ctx.restore();
      }
    });
  }
}

function pausePlayback() {
  isPlaying = false;
  const playIcon = $('#ae-play-icon');
  if (playIcon) playIcon.className = 'ph-bold ph-play';
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  videoMediaCache.forEach((video) => { if (!video.paused) video.pause(); });
  audioMediaCache.forEach((audio) => { if (!audio.paused) audio.pause(); });
}

function togglePlayPause() {
  const playIcon = $('#ae-play-icon');
  if (isPlaying) {
    pausePlayback();
  } else {
    isPlaying = true;
    if (playIcon) playIcon.className = 'ph-bold ph-pause';
    let lastTimestamp = performance.now();

    const loop = (now: number) => {
      if (!isPlaying) return;
      const deltaSec = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      playheadTime += deltaSec;
      if (playheadTime >= timelineDuration) {
        playheadTime = timelineDuration;
        updatePlayheadUI();
        drawCompositionGuide();
        pausePlayback();
        return;
      }

      updatePlayheadUI();
      drawCompositionGuide();
      animationFrameId = requestAnimationFrame(loop);
    };
    animationFrameId = requestAnimationFrame(loop);
  }
}

function scrubPlayheadToMouse(e: MouseEvent, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const scrollLeft = container.scrollLeft || 0;
  const mouseX = e.clientX - rect.left + scrollLeft - 36;
  playheadTime = Math.max(0, Math.min(mouseX / pxPerSec, timelineDuration));

  (activeTimeline.clips || []).forEach((clip: any) => {
    if (playheadTime >= clip.start_time && playheadTime <= clip.start_time + clip.duration) {
      if (clip.media_type === 'video') {
        const video = videoMediaCache.get(clip.src);
        if (video) {
          const mediaTime = (playheadTime - clip.start_time) + (clip.in_point || 0);
          if (Math.abs(video.currentTime - mediaTime) > 0.05) {
            video.currentTime = mediaTime;
          }
        }
      } else if (clip.media_type === 'audio') {
        const audio = getOrCreateAudioElement(clip.src);
        if (audio) {
          const mediaTime = (playheadTime - clip.start_time) + (clip.in_point || 0);
          if (Math.abs(audio.currentTime - mediaTime) > 0.05) {
            audio.currentTime = mediaTime;
          }
        }
      }
    }
  });

  updatePlayheadUI();
  drawCompositionGuide();
}

export function initVideoStudioModule() {
  syncTimelineFromBackend();

  const playBtn = $('#ae-btn-play');
  if (playBtn) playBtn.addEventListener('click', togglePlayPause);

  const timeRuler = $<HTMLElement>('#ae-time-ruler');
  if (timeRuler) {
    let isScrubbing = false;
    timeRuler.addEventListener('mousedown', (e: MouseEvent) => {
      isScrubbing = true;
      let wasPlaying = isPlaying;
      if (isPlaying) pausePlayback();
      scrubPlayheadToMouse(e, timeRuler);

      const onMove = (mEvt: MouseEvent) => {
        if (isScrubbing) scrubPlayheadToMouse(mEvt, timeRuler);
      };
      const onUp = () => {
        isScrubbing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (wasPlaying) togglePlayPause();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  $('#ae-capcut-btn-undo')?.addEventListener('click', undoAction);
  $('#ae-capcut-btn-redo')?.addEventListener('click', redoAction);
}
