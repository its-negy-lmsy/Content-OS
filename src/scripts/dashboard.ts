/**
 * Content OS — Main Dashboard Entry Router & Shell
 * Manages shared navigation, Dashboard stats, Settings, Integrations, System Logs,
 * and delegates tool features to specialized module scripts.
 */

import { initVideoStudioModule } from './modules/video_studio';
import { initAudioStudioModule } from './modules/audio_studio';
import { initImageStudioModule } from './modules/image_studio';
import { initHyperframesStudioModule } from './modules/hyperframes_studio';
import { initProjectVaultModule } from './modules/project_vault';
import { initAgentsStudioModule } from './modules/agents_studio';
import { initAssetVaultModule } from './modules/asset_vault';
import { initResearchHubModule } from './modules/research_hub';
import { initKnowledgeVaultModule } from './modules/knowledge_vault';
import { initStorageCacheModule } from './modules/storage_cache';

const API_BASE = 'http://localhost:8000';

function $<T extends Element = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function $$<T extends Element = HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.detail || `API error: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

// System Stats & Settings Router
async function refreshDashboardStats() {
  try {
    const stats = await apiRequest<any>('/api/dashboard/stats');
    const elProjects = $('#stat-projects-val');
    const elInProgress = $('#stat-inprogress-val');
    const elAssets = $('#stat-assets-val');
    const elResearch = $('#stat-research-val');

    if (elProjects) elProjects.textContent = String(stats.active_projects || 0);
    if (elInProgress) elInProgress.textContent = String(stats.in_progress || 0);
    if (elAssets) elAssets.textContent = (stats.assets_generated || 0).toLocaleString();
    if (elResearch) elResearch.textContent = String(stats.knowledge_notes || 0);
  } catch (err) {
    console.warn('Dashboard stats error:', err);
  }
}

function initNavigationRouter() {
  const navItems = $$('.nav-item');
  const viewPanels = $$('.view-panel');

  function switchView(targetViewId: string) {
    if (!targetViewId) return;

    // Normalize target ID to include 'v-' prefix
    const canonicalId = targetViewId.startsWith('v-') ? targetViewId : `v-${targetViewId}`;

    navItems.forEach((nav) => {
      const target = nav.getAttribute('data-target') || nav.getAttribute('href')?.replace('#', '');
      const navCanonical = target ? (target.startsWith('v-') ? target : `v-${target}`) : '';
      if (navCanonical === canonicalId) {
        nav.classList.add('active');
      } else {
        nav.classList.remove('active');
      }
    });

    viewPanels.forEach((view) => {
      const el = view as HTMLElement;
      if (view.id === canonicalId) {
        view.classList.add('active');
        if (view.id === 'v-video' || view.id === 'v-assets' || view.id === 'v-research' || view.id === 'v-voice') {
          el.style.cssText = 'display: flex !important; flex-direction: column !important; width: 100% !important; height: 100vh !important; padding: 0 !important; margin: 0 !important; overflow: hidden !important;';
        } else {
          el.style.cssText = 'display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 32px !important; margin: 0 !important;';
        }
      } else {
        view.classList.remove('active');
        el.style.cssText = 'display: none !important;';
      }
    });

    if (canonicalId === 'v-assets') {
      const iframe = $<HTMLIFrameElement>('#hf-studio-iframe');
      if (iframe) {
        const dataSrc = iframe.getAttribute('data-src') || 'http://localhost:3002';
        if (!iframe.src || iframe.src === 'about:blank') {
          iframe.src = dataSrc;
        }
      }
    }

    if (canonicalId === 'v-voice') {
      const iframe = $<HTMLIFrameElement>('#tts-studio-iframe');
      if (iframe) {
        const dataSrc = iframe.getAttribute('data-src') || 'http://localhost:8001';
        if (!iframe.src || iframe.src === 'about:blank') {
          iframe.src = dataSrc;
        }
      }
    }

    const resetScroll = () => {
      const mainEl = $('.app-main');
      if (mainEl) mainEl.scrollTop = 0;
      const sidebarEl = $('.app-sidebar');
      if (sidebarEl) sidebarEl.scrollTop = 0;
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
    };

    resetScroll();
    requestAnimationFrame(resetScroll);
    setTimeout(resetScroll, 30);

    if (canonicalId === 'v-dashboard') {
      refreshDashboardStats();
    }
  }

  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-target');
      if (target) {
        switchView(target);
        history.replaceState(null, '', '#' + target);
      }
    });
  });

  function handleHashChange() {
    const rawHash = window.location.hash.replace('#', '').trim();
    if (!rawHash) return;

    const hashMap: Record<string, string> = {
      'dashboard': 'v-dashboard',
      'projects': 'v-projects',
      'research': 'v-research',
      'canvas': 'v-canvas',
      'agents': 'v-agents',
      'assets': 'v-assets',
      'templates': 'v-templates',
      'voice': 'v-voice',
      'video': 'v-video',
      'audio': 'v-audio',
      'image-studio': 'v-image',
      'image': 'v-image',
      'research-hub': 'v-research-hub',
      'settings': 'v-settings',
      'integrations': 'v-integrations',
      'logs': 'v-logs',
    };

    const targetViewId = hashMap[rawHash] || (rawHash.startsWith('v-') ? rawHash : `v-${rawHash}`);
    if (targetViewId) {
      switchView(targetViewId);
    }
  }

  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();
}

function initSettingsAndLogs() {
  const logConsole = $('#sys-log-console');
  const btnCopy = $('#log-copy-btn');
  const btnClear = $('#log-clear-btn');
  const chkAutoScroll = $<HTMLInputElement>('#log-autoscroll-chk');
  const filterBtns = $$('#log-filter-bar .log-filter-btn');

  let activeFilter = 'ALL';

  function appendLogEntry(log: any) {
    if (!logConsole) return;

    const category = (log.category || log.tag || 'API').toUpperCase();
    const level = (log.level || 'INFO').toUpperCase();

    // Filter check
    if (activeFilter !== 'ALL') {
      if (activeFilter === 'ERROR' && level !== 'ERROR') return;
      if (activeFilter !== 'ERROR' && !category.includes(activeFilter)) return;
    }

    const timestamp = log.time || log.timestamp || new Date().toLocaleTimeString();
    const message = log.message || log.text || JSON.stringify(log);

    let tagColor = 'rgba(16,185,129,0.2)';
    let textColor = '#d4d4d8';
    if (level === 'ERROR') { tagColor = 'rgba(239,68,68,0.25)'; textColor = '#ef4444'; }
    else if (category.includes('AGENT')) { tagColor = 'rgba(168,85,247,0.2)'; textColor = '#c084fc'; }
    else if (category.includes('PIPELINE')) { tagColor = 'rgba(0,180,216,0.2)'; textColor = '#00b4d8'; }

    const item = document.createElement('div');
    item.className = `log-entry log-entry-${level.toLowerCase()}`;
    item.style.cssText = `color: ${textColor}; padding: 3px 0; font-family: monospace; font-size: 0.8rem; border-bottom: 1px dashed rgba(255,255,255,0.04);`;
    item.innerHTML = `
      <span style="color: #71717a; margin-right: 6px;">[${timestamp}]</span>
      <span style="background: ${tagColor}; color: #fff; padding: 1px 6px; border-radius: 3px; font-weight: 700; font-size: 0.72rem; margin-right: 8px;">${category}</span>
      <span>${message}</span>
    `;

    logConsole.appendChild(item);

    if (!chkAutoScroll || chkAutoScroll.checked) {
      logConsole.scrollTop = logConsole.scrollHeight;
    }
  }

  // Filter switching
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter') || 'ALL';
    });
  });

  // Controls: Copy & Clear
  if (btnCopy && logConsole) {
    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(logConsole.innerText || '');
      btnCopy.textContent = 'Copied!';
      setTimeout(() => { btnCopy.innerHTML = '<i class="ph-bold ph-copy"></i> Copy'; }, 1500);
    });
  }

  if (btnClear && logConsole) {
    btnClear.addEventListener('click', () => {
      logConsole.innerHTML = `
        <div class="log-entry log-entry-info" style="color: #10b981; padding: 4px 0;">
          <span style="color: #71717a;">[SYSTEM OK]</span>
          <span style="background: rgba(16,185,129,0.2); color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin: 0 8px;">FASTAPI</span>
          <span>Log buffer cleared cleanly. Listening for live system events...</span>
        </div>
      `;
      fetch(`${API_BASE}/api/system/logs`, { method: 'DELETE' }).catch(() => {});
    });
  }

  // Connect live SSE log stream from FastAPI backend
  try {
    const eventSource = new EventSource(`${API_BASE}/api/system/logs/stream`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'backlog' && Array.isArray(data.logs)) {
          data.logs.forEach(appendLogEntry);
        } else {
          appendLogEntry(data);
        }
      } catch (e) {}
    };

    eventSource.onerror = () => {
      eventSource.close();
      // Fallback polling every 4 seconds if SSE drops
      setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/system/logs?limit=30`);
          if (res.ok) {
            const data = await res.json();
            const logs = data.logs || [];
            logs.forEach(appendLogEntry);
          }
        } catch (e) {}
      }, 4000);
    };
  } catch (err) {
    console.warn('System logs SSE connection error:', err);
  }
}

function startContentOSApp() {
  console.log('🚀 Initializing Content OS Modular Application Router...');

  // Initialize shared router shell
  initNavigationRouter();
  initSettingsAndLogs();
  refreshDashboardStats();

  // Initialize dedicated studio modules
  initVideoStudioModule();
  initAudioStudioModule();
  initImageStudioModule();
  initHyperframesStudioModule();
  initProjectVaultModule();
  initAgentsStudioModule();
  initAssetVaultModule();
  initResearchHubModule();
  initKnowledgeVaultModule();
  initStorageCacheModule();

  console.log('✨ All 10 Content OS Studio Modules Initialized Cleanly!');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startContentOSApp);
} else {
  startContentOSApp();
}
