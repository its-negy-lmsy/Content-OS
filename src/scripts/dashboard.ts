const API_BASE = 'http://localhost:8000';

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const $$ = <T extends Element>(selector: string) => document.querySelectorAll<T>(selector);

const escapeHtml = (str: string) =>
  str.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c] as string));

const slugify = (str: string) =>
  str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') || 'item';

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

// Types
interface ResearchItem {
  id: string;
  title: string;
  type: string;
  path: string;
  content?: string;
}

interface ProjectItem {
  id: string;
  title: string;
  channel: string;
  format: string;
  topic: string;
  status: string;
}

interface SystemStats {
  active_projects: number;
  in_progress?: number;
  assets_generated?: number;
  knowledge_notes?: number;
  research_count: number;
  active_runners_count: number;
}

interface ProjectFile {
  name: string;
  path: string;
}

// Global App State
let currentActiveProject: string | null = null;
let currentActivePackFile: string | null = null;
let activeMode: 'cli' | 'endpoint' | 'byok' = 'cli';

// Navigation & View Routing
function initNavigation() {
  function switchView(targetId: string) {
    const liveNavItems = document.querySelectorAll('.nav-item');
    const liveViewPanels = document.querySelectorAll('.view-panel');
    const viewTitle = document.querySelector('#view-title');

    liveNavItems.forEach((item) => {
      const dataTarget = item.getAttribute('data-target');
      const href = item.getAttribute('href');
      const targetHash = targetId.replace('v-', '');
      const isTarget = dataTarget === targetId || href === `#${targetHash}`;
      item.classList.toggle('active', isTarget);
      if (isTarget && viewTitle) {
        const spanText = item.querySelector('span')?.textContent;
        viewTitle.textContent = spanText ? `${spanText} Workspace` : 'Dashboard Workspace';
      }
    });

    liveViewPanels.forEach((panel) => {
      const el = panel as HTMLElement;
      if (panel.id === targetId) {
        el.classList.add('active');
        if (panel.id === 'v-video' || panel.id === 'v-assets') {
          el.style.setProperty('display', 'flex', 'important');
        } else {
          el.style.setProperty('display', 'block', 'important');
        }
      } else {
        el.classList.remove('active');
        el.style.setProperty('display', 'none', 'important');
      }
    });

    if (targetId === 'v-dashboard') {
      loadSystemStats();
      loadPipelineStatus();
      loadTodaySchedule();
      loadRecentActivity();
      loadProjects();
    } else if (targetId === 'v-projects') {
      loadProjects();
    } else if (targetId === 'v-video') {
      setTimeout(initVideoStudio, 50);
    } else if (targetId === 'v-canvas') {
      setTimeout(initWorkflowStudio, 50);
    } else if (targetId === 'v-templates') {
      loadAssetsVault();
    } else if (targetId === 'v-assets') {
      initHyperframeStudio();
    } else if (targetId === 'v-logs') {
      initSystemLogs();
    } else if (targetId === 'v-voice') {
      initTTSStudio();
    }
  }

  // Global event delegation for all navigation links and buttons
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const link = target.closest<HTMLAnchorElement>('a[href^="#"], .nav-item[data-target]');
    if (link) {
      const dataTarget = link.getAttribute('data-target');
      const href = link.getAttribute('href') || '';
      const targetHash = dataTarget ? dataTarget.replace('v-', '') : href.replace('#', '');
      if (targetHash) {
        const matchingTarget = `v-${targetHash}`;
        if (document.querySelector(`#${matchingTarget}`)) {
          e.preventDefault();
          switchView(matchingTarget);
          if (window.location.hash !== `#${targetHash}`) {
            window.location.hash = targetHash;
          }
        }
      }
    }
  });

  // Handle hash routing on page load & hashchange events
  function handleHashRoute() {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const matchingTarget = `v-${hash}`;
      if (document.querySelector(`#${matchingTarget}`)) {
        switchView(matchingTarget);
        return;
      }
    }
    switchView('v-dashboard');
  }

  window.addEventListener('hashchange', handleHashRoute);
  handleHashRoute();
}

// Global dashboard state loaders
async function loadSystemStats() {
  try {
    const stats = await apiRequest<SystemStats>('/api/system/stats');
    const projEl = $('#stat-projects-val');
    const inProgEl = $('#stat-inprogress-val');
    const assetsEl = $('#stat-assets-val');
    const researchEl = $('#stat-research-val');
    const runnersEl = $('#stat-runners-val');

    if (projEl) projEl.textContent = String(stats.active_projects);
    if (inProgEl) inProgEl.textContent = String(stats.in_progress ?? 3);
    if (assetsEl) assetsEl.textContent = Number(stats.assets_generated ?? 124).toLocaleString();
    if (researchEl) researchEl.textContent = String(stats.knowledge_notes ?? stats.research_count ?? 0);
    if (runnersEl) runnersEl.textContent = String(stats.active_runners_count);
  } catch (err) {
    console.error('Failed to load system stats:', err);
  }
}

async function loadPipelineStatus() {
  try {
    const data = await apiRequest<{ steps: Array<{ name: string; status: string }>; progress: number; active_project: string }>('/api/pipeline/status');
    const container = $('#pipeline-steps-container');
    const percentEl = $('#pipeline-progress-percent');
    const barEl = $('#pipeline-progress-bar') as HTMLElement | null;

    if (percentEl) percentEl.textContent = `${data.progress}%`;
    if (barEl) barEl.style.width = `${data.progress}%`;

    if (container && data.steps) {
      const stepIcons: Record<string, string> = {
        Idea: 'ph-lightbulb',
        Research: 'ph-magnifying-glass',
        Script: 'ph-file-text',
        Storyboard: 'ph-squares-four',
        Assets: 'ph-image',
        Voice: 'ph-waveform',
        Edit: 'ph-scissors',
        Render: 'ph-play-circle',
        Upload: 'ph-upload-simple',
      };

      container.innerHTML = data.steps.map((step: { name: string; status: string }) => {
        const icon = stepIcons[step.name] || 'ph-gear';
        const isDone = step.status === 'done';
        const isInProg = step.status === 'in_progress';
        const statusLabel = isDone ? '✓ Done' : isInProg ? 'In Progress' : step.status === 'queued' ? 'Queued' : 'Waiting';
        return `
          <div class="pipeline-step-box ${isDone ? 'done' : ''} ${isInProg ? 'in_progress' : ''}">
            <div class="pipeline-step-node"><i class="ph-bold ${icon}"></i></div>
            <span class="pipeline-step-label">${escapeHtml(step.name)}</span>
            <span class="pipeline-step-status">${statusLabel}</span>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load pipeline status:', err);
  }
}

async function loadTodaySchedule() {
  try {
    const data = await apiRequest<{ schedule: Array<{ id: string; time: string; title: string; detail: string; done: boolean }> }>('/api/overview/today');
    const container = $('#today-timeline-list');
    if (!container) return;

    if (!data.schedule || data.schedule.length === 0) {
      container.innerHTML = `<p style="color: var(--text-dim); font-size: 0.82rem;">No schedule items set for today.</p>`;
      return;
    }

    container.innerHTML = data.schedule.map((t: { id: string; time: string; title: string; detail: string; done: boolean }) => `
      <div class="timeline-item">
        <div class="timeline-time">${escapeHtml(t.time)}</div>
        <div class="timeline-content">
          <div class="timeline-title" style="${t.done ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(t.title)}</div>
          <div class="timeline-detail">${escapeHtml(t.detail)}</div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="timeline-check ${t.done ? 'done' : ''}" data-task-id="${t.id}">
            ${t.done ? '✓' : ''}
          </button>
          <button class="btn-icon-danger delete-task-btn" data-task-id="${t.id}" title="Delete Task">
            <i class="ph-bold ph-trash"></i>
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load today schedule:', err);
  }
}

async function loadRecentActivity() {
  try {
    const data = await apiRequest<{ activities: Array<{ id: string; action: string; title: string; detail: string; timestamp: string }> }>('/api/activity');
    const container = $('#activity-feed-list');
    if (!container) return;

    if (!data.activities || data.activities.length === 0) {
      container.innerHTML = `<p style="color: var(--text-dim); font-size: 0.82rem;">No recent activities logged.</p>`;
      return;
    }

    container.innerHTML = data.activities.slice(0, 5).map((act: { id: string; action: string; title: string; detail: string; timestamp: string }) => `
      <div class="activity-item">
        <div class="activity-icon-box"><i class="ph-bold ph-lightning"></i></div>
        <div class="activity-info">
          <div class="activity-action">${escapeHtml(act.action)} — ${escapeHtml(act.title)}</div>
          <div class="activity-sub">${escapeHtml(act.detail || act.timestamp)}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load recent activity:', err);
  }
}

interface ProjectItem {
  id: string;
  title: string;
  platform: string;
  stage: string;
  progress: number;
  description: string;
  target_date: string;
  priority: string;
  created_at: string;
  notes?: string;
}

let globalProjectsList: ProjectItem[] = [];
let activeProjectsViewMode: 'kanban' | 'grid' = 'kanban';
let currentDrawerProjectId: string | null = null;

// Load Projects
async function loadProjects() {
  try {
    const res = await apiRequest<{ projects: ProjectItem[] }>('/api/projects');
    globalProjectsList = res.projects || [];

    // Also update Dashboard active projects card list
    const dashList = $('#dashboard-projects-list');
    if (dashList) {
      if (globalProjectsList.length === 0) {
        dashList.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">No content projects created yet.</p>`;
      } else {
        dashList.innerHTML = globalProjectsList.slice(0, 3).map((p) => `
          <div class="item-card open-project-drawer-btn" data-id="${p.id}" style="cursor: pointer;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <span class="platform-tag">${escapeHtml(p.platform || 'YouTube')}</span>
              <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-orange);">${escapeHtml(p.stage || 'Idea')} (${p.progress || 0}%)</span>
            </div>
            <h3 style="font-family: var(--font-heading); font-size: 1.05rem; font-weight: 700; color: #ffffff; margin-bottom: 4px;">${escapeHtml(p.title)}</h3>
            <p style="font-size: 0.82rem; color: #a1a1aa;">${escapeHtml(p.description || 'No description.')}</p>
          </div>
        `).join('');
      }
    }

    renderProjectsVault();
  } catch (err) {
    console.error('Failed to load projects:', err);
  }
}

function renderProjectsVault() {
  const searchInput = $('#projects-search-input') as HTMLInputElement | null;
  const platformSelect = $('#projects-platform-filter') as HTMLSelectElement | null;

  const searchQuery = searchInput?.value.toLowerCase().trim() || '';
  const selectedPlatform = platformSelect?.value || 'ALL';

  const filtered = globalProjectsList.filter((p) => {
    const matchesSearch = p.title.toLowerCase().includes(searchQuery) || (p.description && p.description.toLowerCase().includes(searchQuery));
    const matchesPlatform = selectedPlatform === 'ALL' || p.platform === selectedPlatform;
    return matchesSearch && matchesPlatform;
  });

  const kanbanContainer = $('#projects-kanban-view') as HTMLElement | null;
  const gridContainer = $('#projects-grid-view') as HTMLElement | null;

  if (activeProjectsViewMode === 'kanban') {
    if (kanbanContainer) kanbanContainer.style.display = 'grid';
    if (gridContainer) gridContainer.style.display = 'none';
    renderKanbanView(filtered);
  } else {
    if (kanbanContainer) kanbanContainer.style.display = 'none';
    if (gridContainer) gridContainer.style.display = 'grid';
    renderGridView(filtered);
  }
}

function renderKanbanView(projects: ProjectItem[]) {
  const container = $('#projects-kanban-view');
  if (!container) return;

  const stages = [
    { key: 'Idea', label: 'Idea / Backlog', icon: 'ph-lightbulb' },
    { key: 'Scripting', label: 'Scripting', icon: 'ph-article' },
    { key: 'Production', label: 'Production', icon: 'ph-video-camera' },
    { key: 'Editing', label: 'Editing & Review', icon: 'ph-scissors' },
    { key: 'Published', label: 'Published', icon: 'ph-check-circle' },
  ];

  container.innerHTML = stages
    .map((st) => {
      const stageProjects = projects.filter((p) => (p.stage || 'Idea') === st.key);
      return `
      <div class="kanban-column" data-stage="${st.key}">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <i class="ph-bold ${st.icon}"></i>
            <span>${st.label}</span>
          </div>
          <span class="kanban-count-badge">${stageProjects.length}</span>
        </div>
        <div class="kanban-column-cards">
          ${
            stageProjects.length === 0
              ? `<div style="padding: 20px 10px; text-align: center; color: #71717a; font-size: 0.78rem;">No projects</div>`
              : stageProjects
                  .map(
                    (p) => `
            <div class="kanban-card open-project-drawer-btn" data-id="${p.id}">
              <span class="platform-tag">${escapeHtml(p.platform || 'YouTube')}</span>
              <div class="kanban-card-title">${escapeHtml(p.title)}</div>
              ${p.description ? `<div class="kanban-card-desc">${escapeHtml(p.description)}</div>` : ''}
              <div style="background: #27272a; height: 4px; border-radius: 999px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${p.progress || 0}%; height: 100%; background: var(--accent-orange);"></div>
              </div>
              <div class="kanban-card-meta">
                <span>${p.target_date || 'No date'}</span>
                <span style="font-weight: 700; color: ${p.priority === 'High' ? '#ef4444' : p.priority === 'Medium' ? '#f59e0b' : '#10b981'};">${p.priority || 'Med'}</span>
              </div>
            </div>
          `
                  )
                  .join('')
          }
        </div>
      </div>
    `;
    })
    .join('');
}

function renderGridView(projects: ProjectItem[]) {
  const container = $('#projects-grid-view');
  if (!container) return;

  if (projects.length === 0) {
    container.innerHTML = `<p style="color: #71717a; font-size: 0.88rem;">No matching projects found.</p>`;
    return;
  }

  container.innerHTML = projects
    .map(
      (p) => `
    <div class="kanban-card open-project-drawer-btn" data-id="${p.id}">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <span class="platform-tag">${escapeHtml(p.platform || 'YouTube')}</span>
        <span style="font-size: 0.75rem; font-weight: 700; color: var(--accent-orange);">${escapeHtml(p.stage || 'Idea')}</span>
      </div>
      <div class="kanban-card-title" style="font-size: 1rem; margin-top: 4px;">${escapeHtml(p.title)}</div>
      <div class="kanban-card-desc">${escapeHtml(p.description || 'No description brief set.')}</div>
      <div style="background: #27272a; height: 6px; border-radius: 999px; overflow: hidden; margin: 12px 0 8px 0;">
        <div style="width: ${p.progress || 0}%; height: 100%; background: var(--accent-orange);"></div>
      </div>
      <div class="kanban-card-meta">
        <span>Target: ${p.target_date || 'None'}</span>
        <span style="font-weight: 700; color: #ffffff;">${p.progress || 0}% Complete</span>
      </div>
    </div>
  `
    )
    .join('');
}

// Load Research Notes
async function loadResearch() {
  try {
    const { items } = await apiRequest<{ items: ResearchItem[] }>('/api/research');
    const gridList = $('#research-grid');

    const html = items.length
      ? items
          .map(
            (item) => `
        <div class="item-card view-research-btn" data-id="${item.id}">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="badge">${item.type}</span>
              <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn-icon-danger delete-research-btn" data-id="${item.id}" title="Delete Research Note">
                  <i class="ph-bold ph-trash"></i>
                </button>
                <i class="ph-bold ph-arrow-up-right" style="color: var(--accent-light);"></i>
              </div>
            </div>
            <h3 style="font-family: var(--font-heading); font-size: 1.05rem; font-weight: 700; margin-bottom: 6px;">${escapeHtml(item.title)}</h3>
            <p style="font-size: 0.8rem; color: var(--text-dim); font-family: var(--font-mono);">${escapeHtml(item.path)}</p>
          </div>
        </div>
      `
          )
          .join('')
      : '<p style="color: var(--text-dim);">No research notes in vault.</p>';

    if (gridList) gridList.innerHTML = html;
  } catch {
    // Ignore error if offline
  }
}

// Open Design AI Composer Handler
function initAIComposer() {
  const composerInput = $('#composer-textarea') as HTMLTextAreaElement | null;
  const sendBtn = $('#composer-send-btn');
  const chatStream = $('#chat-stream');

  // Quick Prompt Chips
  $$('.chip-btn').forEach((chip) => {
    chip.addEventListener('click', () => {
      const promptText = chip.getAttribute('data-prompt');
      if (promptText && composerInput) {
        composerInput.value = promptText;
        composerInput.focus();
      }
    });
  });

  async function submitPrompt() {
    if (!composerInput || !composerInput.value.trim()) return;
    const prompt = composerInput.value.trim();
    composerInput.value = '';

    // Append User Message Bubble
    if (chatStream) {
      chatStream.innerHTML += `
        <div class="chat-msg user">
          <div class="chat-avatar"><i class="ph-bold ph-user"></i></div>
          <div class="chat-bubble">${escapeHtml(prompt)}</div>
        </div>
      `;
      chatStream.scrollTop = chatStream.scrollHeight;
    }

    // Append Agent Thinking Bubble
    const thinkingId = `thinking-${Date.now()}`;
    if (chatStream) {
      chatStream.innerHTML += `
        <div class="chat-msg agent" id="${thinkingId}">
          <div class="chat-avatar"><i class="ph-bold ph-robot"></i></div>
          <div class="chat-bubble" style="color: var(--text-dim);"><i class="ph-bold ph-spinner" style="animation: spin 1s linear infinite;"></i> Processing prompt...</div>
        </div>
      `;
      chatStream.scrollTop = chatStream.scrollHeight;
    }

    try {
      const result = await apiRequest<{ response: string }>('/api/agents/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });

      const thinkingEl = $(`#${thinkingId}`);
      if (thinkingEl) {
        const formattedResp = escapeHtml(result.response)
          .replace(/### (.*?)\n/g, '<h4 style="color:#fff; font-size:1rem; margin:6px 0;">$1</h4>')
          .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--accent-orange);">$1</strong>')
          .replace(/`(.*?)`/g, '<code style="background:#27272a; padding:2px 6px; border-radius:4px; font-family:var(--font-mono);">$1</code>')
          .replace(/\n/g, '<br>');

        thinkingEl.innerHTML = `
          <div class="chat-avatar"><i class="ph-bold ph-robot"></i></div>
          <div class="chat-bubble">
            ${formattedResp}
            <div class="chat-actions-row">
              <button class="chat-action-btn save-to-vault-btn" data-title="${escapeHtml(prompt.slice(0, 30))}" data-content="${escapeHtml(result.response)}">
                <i class="ph-bold ph-bookmark-simple"></i> Save to Knowledge Vault
              </button>
              <button class="chat-action-btn create-project-from-chat-btn" data-title="${escapeHtml(prompt.slice(0, 30))}">
                <i class="ph-bold ph-plus-circle"></i> Create Project
              </button>
            </div>
          </div>
        `;
      }
    } catch (err) {
      const thinkingEl = $(`#${thinkingId}`);
      if (thinkingEl) {
        thinkingEl.innerHTML = `
          <div class="chat-avatar"><i class="ph-bold ph-warning"></i></div>
          <div class="chat-bubble" style="color: var(--status-red);">Failed to connect to agent API: ${(err as Error).message}</div>
        `;
      }
    }

    if (chatStream) chatStream.scrollTop = chatStream.scrollHeight;
  }

  sendBtn?.addEventListener('click', submitPrompt);
  composerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitPrompt();
    }
  });

  // Delegated click for Chat Output Action Buttons
  chatStream?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    const vaultBtn = target.closest<HTMLElement>('.save-to-vault-btn');
    if (vaultBtn) {
      const title = vaultBtn.getAttribute('data-title') || 'Agent Response';
      const content = vaultBtn.getAttribute('data-content') || '';
      try {
        await apiRequest('/api/wiki/file', {
          method: 'POST',
          body: JSON.stringify({ path: `agent-outputs/${slugify(title)}.md`, title, content }),
        });
        await loadObsidianVaultTree();
        alert(`Saved note "${title}" to Knowledge Vault!`);
      } catch (err) {
        alert((err as Error).message);
      }
      return;
    }

    const projBtn = target.closest<HTMLElement>('.create-project-from-chat-btn');
    if (projBtn) {
      const title = projBtn.getAttribute('data-title') || 'New Agent Project';
      try {
        await apiRequest('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ title, platform: 'YouTube', stage: 'Idea', priority: 'Medium', description: `Generated from Agent Studio prompt` }),
        });
        await loadProjects();
        alert(`Created project "${title}" in Projects Vault!`);
      } catch (err) {
        alert((err as Error).message);
      }
      return;
    }
  });
}

function showDeleteConfirmModal(message: string, onConfirm: () => void) {
  const modal = $('#confirm-modal-backdrop') as HTMLElement | null;
  const msgEl = $('#confirm-modal-message');
  const actionBtn = $('#confirm-modal-action');
  const cancelBtn = $('#confirm-modal-cancel');
  const closeBtn = $('#close-confirm-modal');

  if (msgEl) msgEl.textContent = message;
  if (modal) modal.classList.add('active');

  function cleanup() {
    modal?.classList.remove('active');
    actionBtn?.removeEventListener('click', handleConfirm);
    cancelBtn?.removeEventListener('click', cleanup);
    closeBtn?.removeEventListener('click', cleanup);
  }

  function handleConfirm() {
    cleanup();
    onConfirm();
  }

  actionBtn?.addEventListener('click', handleConfirm);
  cancelBtn?.addEventListener('click', cleanup);
  closeBtn?.addEventListener('click', cleanup);
}

function openProjectDrawer(projectId: string) {
  const p = globalProjectsList.find((item) => item.id === projectId);
  if (!p) return;

  currentDrawerProjectId = p.id;
  const drawerBackdrop = $('#project-drawer-backdrop');
  if (drawerBackdrop) drawerBackdrop.classList.add('active');

  const titleEl = $('#pd-title');
  const badgeEl = $('#pd-platform-badge');
  const descEl = $('#pd-description') as HTMLTextAreaElement | null;
  const notesEl = $('#pd-notes') as HTMLTextAreaElement | null;
  const progressRange = $('#pd-progress-range') as HTMLInputElement | null;
  const progressVal = $('#pd-progress-value');
  const targetDateInput = $('#pd-target-date') as HTMLInputElement | null;
  const prioritySelect = $('#pd-priority') as HTMLSelectElement | null;

  if (titleEl) titleEl.textContent = p.title;
  if (badgeEl) badgeEl.textContent = p.platform || 'YouTube';
  if (descEl) descEl.value = p.description || '';
  if (notesEl) notesEl.value = p.notes || '';
  if (progressRange) progressRange.value = String(p.progress || 0);
  if (progressVal) progressVal.textContent = `${p.progress || 0}%`;
  if (targetDateInput) targetDateInput.value = p.target_date || '';
  if (prioritySelect) prioritySelect.value = p.priority || 'Medium';

  const activeStage = p.stage || 'Idea';
  $$('.stage-pill').forEach((pill) => {
    if (pill.getAttribute('data-stage') === activeStage) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

// Modals & Actions Handler
function initModalsAndEvents() {
  // Toolbar View Switcher
  $('#view-toggle-kanban')?.addEventListener('click', () => {
    activeProjectsViewMode = 'kanban';
    $('#view-toggle-kanban')?.classList.add('active');
    $('#view-toggle-grid')?.classList.remove('active');
    renderProjectsVault();
  });

  $('#view-toggle-grid')?.addEventListener('click', () => {
    activeProjectsViewMode = 'grid';
    $('#view-toggle-grid')?.classList.add('active');
    $('#view-toggle-kanban')?.classList.remove('active');
    renderProjectsVault();
  });

  // Filter input listeners
  $('#projects-search-input')?.addEventListener('input', () => renderProjectsVault());
  $('#projects-platform-filter')?.addEventListener('change', () => renderProjectsVault());

  // Click handler on Kanban Cards / Grid Cards
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.open-project-drawer-btn');
    if (card) {
      const id = card.getAttribute('data-id');
      if (id) openProjectDrawer(id);
    }
  });

  // Create Project Modal controls
  const modal = $('#project-modal-backdrop');
  $('#open-create-project-modal')?.addEventListener('click', () => modal?.classList.add('active'));
  $('#quick-new-project-btn')?.addEventListener('click', () => modal?.classList.add('active'));
  $('#close-project-modal')?.addEventListener('click', () => modal?.classList.remove('active'));
  $('#cancel-project-modal')?.addEventListener('click', () => modal?.classList.remove('active'));

  // Project Modal Form Submit
  $('#project-modal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const titleInput = $('#pm-title') as HTMLInputElement | null;
    const platformSelect = $('#pm-platform') as HTMLSelectElement | null;
    const stageSelect = $('#pm-stage') as HTMLSelectElement | null;
    const targetDateInput = $('#pm-target-date') as HTMLInputElement | null;
    const prioritySelect = $('#pm-priority') as HTMLSelectElement | null;
    const descInput = $('#pm-description') as HTMLTextAreaElement | null;

    if (!titleInput || !titleInput.value.trim()) return;

    try {
      await apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          title: titleInput.value.trim(),
          platform: platformSelect?.value || 'YouTube',
          stage: stageSelect?.value || 'Idea',
          target_date: targetDateInput?.value || '',
          priority: prioritySelect?.value || 'Medium',
          description: descInput?.value.trim() || '',
        }),
      });

      titleInput.value = '';
      if (descInput) descInput.value = '';
      modal?.classList.remove('active');
      await loadProjects();
    } catch (err) {
      alert((err as Error).message);
    }
  });

  // Project Drawer controls
  const drawer = $('#project-drawer-backdrop');
  $('#close-project-drawer')?.addEventListener('click', () => drawer?.classList.remove('active'));

  // Stage Pills inside Drawer
  $$('.stage-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      $$('.stage-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  // Progress Slider live value text
  const pdSlider = $('#pd-progress-range') as HTMLInputElement | null;
  pdSlider?.addEventListener('input', () => {
    const valSpan = $('#pd-progress-value');
    if (valSpan && pdSlider) valSpan.textContent = `${pdSlider.value}%`;
  });

  // Drawer Save Button
  $('#pd-save-btn')?.addEventListener('click', async () => {
    if (!currentDrawerProjectId) return;

    const activePill = $('.stage-pill.active');
    const stage = activePill?.getAttribute('data-stage') || 'Idea';
    const progress = Number(($('#pd-progress-range') as HTMLInputElement | null)?.value || 0);
    const target_date = ($('#pd-target-date') as HTMLInputElement | null)?.value || '';
    const priority = ($('#pd-priority') as HTMLSelectElement | null)?.value || 'Medium';
    const description = ($('#pd-description') as HTMLTextAreaElement | null)?.value || '';
    const notes = ($('#pd-notes') as HTMLTextAreaElement | null)?.value || '';

    try {
      await apiRequest(`/api/projects/${currentDrawerProjectId}`, {
        method: 'PUT',
        body: JSON.stringify({ stage, progress, target_date, priority, description, notes }),
      });
      drawer?.classList.remove('active');
      await loadProjects();
    } catch (err) {
      alert((err as Error).message);
    }
  });

  // Drawer Delete Project Button
  $('#pd-delete-btn')?.addEventListener('click', async () => {
    if (!currentDrawerProjectId) return;
    const targetProj = globalProjectsList.find((p) => p.id === currentDrawerProjectId);
    const name = targetProj ? targetProj.title : 'this project';

    showDeleteConfirmModal(`Delete project "${name}"?`, async () => {
      try {
        await apiRequest(`/api/projects/${currentDrawerProjectId}`, { method: 'DELETE' });
        drawer?.classList.remove('active');
        await loadProjects();
      } catch (err) {
        alert((err as Error).message);
      }
    });
  });

  // Close Pack & Markdown Modals
  $('#close-pack-modal')?.addEventListener('click', () => $('#pack-modal-backdrop')?.classList.remove('active'));
  $('#close-markdown-modal')?.addEventListener('click', () => $('#markdown-modal-backdrop')?.classList.remove('active'));

  // Research Form Handling
  const addResearchCard = $('#add-research-card') as HTMLElement | null;
  $('#open-add-research-btn')?.addEventListener('click', () => {
    if (addResearchCard) addResearchCard.style.display = addResearchCard.style.display === 'none' ? 'block' : 'none';
  });
  $('#cancel-research-btn')?.addEventListener('click', () => {
    if (addResearchCard) addResearchCard.style.display = 'none';
  });

  $('#research-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    try {
      await apiRequest('/api/research', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      if (addResearchCard) addResearchCard.style.display = 'none';
      await loadResearch();
      await loadSystemStats();
    } catch (err) {
      alert((err as Error).message);
    }
  });


  // Settings Runner Discovery
  $('#scan-runners-btn')?.addEventListener('click', async () => {
    const listEl = $('#discovered-runners-list');
    const statusEl = $('#scan-status');
    if (listEl) listEl.innerHTML = '<p style="color: var(--text-dim);">Scanning machine for installed CLI runners...</p>';
    try {
      const { runners } = await apiRequest<{ runners: { id: string; name: string; path: string }[] }>('/api/runners/discover');
      if (statusEl) statusEl.textContent = `Scan complete. Found ${runners.length} runners.`;
      if (listEl) {
        listEl.innerHTML = runners.length
          ? runners
              .map(
                (r) => `
            <div style="background: var(--bg-surface); border: 1px solid var(--border-color); padding: 12px 16px; border-radius: var(--radius-md);">
              <strong style="color: var(--accent-light); font-family: var(--font-mono); font-size: 0.9rem; display: block;">${escapeHtml(r.name)}</strong>
              <span style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(r.path)}</span>
            </div>
          `
              )
              .join('')
          : '<p style="color: var(--text-dim);">No standard CLI tools found on PATH.</p>';
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = (err as Error).message;
    }
  });
}

// Open Project Pack Viewer & Editor Modal
async function openProjectPackModal(project_id: string) {
  currentActiveProject = project_id;
  try {
    const { project, files } = await apiRequest<{ project: ProjectItem; files: ProjectFile[] }>(`/api/projects/${project_id}`);
    const modal = $('#pack-modal-backdrop');
    const titleEl = $('#pack-modal-title');
    const fileListEl = $('#pack-file-list');

    if (titleEl) titleEl.textContent = `Pack: ${project.title}`;
    if (fileListEl) {
      fileListEl.innerHTML = files
        .map(
          (f) => `
        <div style="display: flex; gap: 4px; align-items: center; margin-bottom: 6px;">
          <button class="btn-secondary pack-file-select-btn" data-filename="${f.name}" style="flex: 1; text-align: left; font-size: 0.8rem; padding: 8px 10px;">
            <i class="ph-bold ph-file-text"></i> ${escapeHtml(f.name)}
          </button>
          <button class="btn-icon-danger delete-pack-file-btn" data-filename="${f.name}" title="Delete File">
            <i class="ph-bold ph-trash"></i>
          </button>
        </div>
      `
        )
        .join('');
    }

    modal?.classList.add('active');

    // Load first file automatically
    if (files.length > 0) {
      loadPackFile(files[0].name);
    }
  } catch (err) {
    alert((err as Error).message);
  }
}

async function loadPackFile(filename: string) {
  if (!currentActiveProject) return;
  currentActivePackFile = filename;
  try {
    const fileData = await apiRequest<{ filename: string; content: string }>(`/api/projects/${currentActiveProject}/files/${filename}`);
    const editor = $('#pack-file-editor') as HTMLTextAreaElement | null;
    const nameEl = $('#current-pack-file-name');

    if (nameEl) nameEl.textContent = filename;
    if (editor) editor.value = fileData.content;
  } catch (err) {
    alert((err as Error).message);
  }
}

// Save edited file in Pack
$('#save-pack-file-btn')?.addEventListener('click', async () => {
  if (!currentActiveProject || !currentActivePackFile) return;
  const editor = $('#pack-file-editor') as HTMLTextAreaElement | null;
  if (!editor) return;

  try {
    await apiRequest(`/api/projects/${currentActiveProject}/files/${currentActivePackFile}`, {
      method: 'PUT',
      body: JSON.stringify({ content: editor.value }),
    });
    alert(`File ${currentActivePackFile} saved successfully.`);
  } catch (err) {
    alert((err as Error).message);
  }
});

// Custom Confirmation Dialog (Replaces native browser popups)
function customConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = $('#confirm-modal-backdrop');
    const titleEl = $('#confirm-modal-title');
    const msgEl = $('#confirm-modal-message');
    const actionBtn = $('#confirm-modal-action');
    const cancelBtn = $('#confirm-modal-cancel');
    const closeBtn = $('#close-confirm-modal');

    if (titleEl) titleEl.innerHTML = `<i class="ph-bold ph-warning-circle" style="color: #ef4444;"></i> ${escapeHtml(title)}`;
    if (msgEl) msgEl.textContent = message;

    backdrop?.classList.add('active');

    function cleanup(result: boolean) {
      backdrop?.classList.remove('active');
      actionBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
      closeBtn?.removeEventListener('click', onCancel);
      backdrop?.removeEventListener('click', onBackdropClick);
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onBackdropClick(e: Event) {
      if (e.target === backdrop) cleanup(false);
    }

    actionBtn?.addEventListener('click', onConfirm);
    cancelBtn?.addEventListener('click', onCancel);
    closeBtn?.addEventListener('click', onCancel);
    backdrop?.addEventListener('click', onBackdropClick);
  });
}

// Document Click Delegation for Delete Buttons & File Selections
document.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;

  // Select File in Pack Editor
  const selectBtn = target.closest<HTMLButtonElement>('.pack-file-select-btn');
  if (selectBtn) {
    const filename = selectBtn.getAttribute('data-filename');
    if (filename) loadPackFile(filename);
    return;
  }

  // Delete Project
  const deleteProjBtn = target.closest<HTMLButtonElement>('.delete-project-btn');
  if (deleteProjBtn) {
    e.stopPropagation();
    const projId = deleteProjBtn.getAttribute('data-id');
    if (projId && (await customConfirm('Delete Project', 'Are you sure you want to delete this project and all its pack files?'))) {
      try {
        await apiRequest(`/api/projects/${projId}`, { method: 'DELETE' });
        await loadProjects();
        await loadSystemStats();
        await loadRecentActivity();
        await loadPipelineStatus();
      } catch (err) {
        alert((err as Error).message);
      }
    }
    return;
  }

  // Delete Research Note
  const deleteResearchBtn = target.closest<HTMLButtonElement>('.delete-research-btn');
  if (deleteResearchBtn) {
    e.stopPropagation();
    const noteId = deleteResearchBtn.getAttribute('data-id');
    if (noteId && (await customConfirm('Delete Research Note', 'Are you sure you want to delete this research note from your vault?'))) {
      try {
        await apiRequest(`/api/research/${noteId}`, { method: 'DELETE' });
        await loadResearch();
        await loadSystemStats();
        await loadRecentActivity();
      } catch (err) {
        alert((err as Error).message);
      }
    }
    return;
  }

  // Delete Pack File
  const deleteFileBtn = target.closest<HTMLButtonElement>('.delete-pack-file-btn');
  if (deleteFileBtn) {
    e.stopPropagation();
    const filename = deleteFileBtn.getAttribute('data-filename');
    if (filename && currentActiveProject && (await customConfirm('Delete Pack File', `Are you sure you want to delete file "${filename}" from this project pack?`))) {
      try {
        await apiRequest(`/api/projects/${currentActiveProject}/files/${filename}`, { method: 'DELETE' });
        await openProjectPackModal(currentActiveProject);
        await loadRecentActivity();
      } catch (err) {
        alert((err as Error).message);
      }
    }
    return;
  }

  // Delete Schedule Task
  const deleteTaskBtn = target.closest<HTMLButtonElement>('.delete-task-btn');
  if (deleteTaskBtn) {
    e.stopPropagation();
    const taskId = deleteTaskBtn.getAttribute('data-task-id');
    if (taskId && (await customConfirm('Delete Task', 'Are you sure you want to remove this task from today\'s schedule?'))) {
      try {
        await apiRequest(`/api/overview/today/${taskId}`, { method: 'DELETE' });
        await loadTodaySchedule();
        await loadRecentActivity();
      } catch (err) {
        alert((err as Error).message);
      }
    }
    return;
  }

  // Build Pack Button
  const buildBtn = target.closest<HTMLButtonElement>('.build-pack-btn');
  if (buildBtn) {
    const projId = buildBtn.getAttribute('data-id');
    if (!projId) return;
    buildBtn.disabled = true;
    buildBtn.textContent = 'Building...';
    try {
      await apiRequest(`/api/projects/${projId}/build-pack`, { method: 'POST' });
      await loadProjects();
      await loadRecentActivity();
      await loadPipelineStatus();
    } catch (err) {
      alert((err as Error).message);
    }
    return;
  }

  // View Pack Button
  const viewBtn = target.closest<HTMLButtonElement>('.view-pack-btn');
  if (viewBtn) {
    const projId = viewBtn.getAttribute('data-id');
    if (projId) openProjectPackModal(projId);
    return;
  }

  // View Research Note Card
  const researchCard = target.closest<HTMLElement>('.view-research-btn');
  if (researchCard) {
    const item_id = researchCard.getAttribute('data-id');
    if (!item_id) return;
    try {
      const item = await apiRequest<{ title: string; content: string }>(`/api/research/${item_id}`);
      const titleEl = $('#markdown-modal-title');
      const contentEl = $('#markdown-modal-content');
      if (titleEl) titleEl.textContent = item.title;
      if (contentEl) contentEl.textContent = item.content;
      $('#markdown-modal-backdrop')?.classList.add('active');
    } catch (err) {
      alert((err as Error).message);
    }
    return;
  }
});

// LiteGraph Workflow Canvas Setup
let graphCanvasInitialized = false;
function initGraphCanvas() {
  if (graphCanvasInitialized) return;
  const host = $('#workflow-canvas-host') as HTMLDivElement | null;
  if (!host) return;

  const LGraphClass = (window as any).LGraph;
  const LGraphCanvasClass = (window as any).LGraphCanvas;
  if (!LGraphClass || !LGraphCanvasClass) return;

  host.innerHTML = '';
  const canvasElement = document.createElement('canvas');
  canvasElement.width = host.clientWidth || 1000;
  canvasElement.height = host.clientHeight || 550;
  host.appendChild(canvasElement);

  const graph = new LGraphClass();
  const canvas = new LGraphCanvasClass(canvasElement, graph);
  canvas.ds.scale = 0.85;

  const steps = [
    ['Competitor Scraper', '#27272a'],
    ['Research Intake', '#3f3f46'],
    ['Script Engine', '#52525b'],
    ['Visual Prompts', '#71717a'],
    ['Voice Synthesis', '#a1a1aa'],
    ['SEO Optimizer', '#d4d4d8'],
    ['Publish Gate', '#ffffff'],
  ];

  const LiteGraphGlobal = (window as any).LiteGraph;
  if (!LiteGraphGlobal) return;

  const nodes = steps.map(([title, color], index) => {
    const node = LiteGraphGlobal.createNode('basic/const');
    if (!node) throw new Error('Unable to create node.');
    node.title = title;
    node.pos = [30 + index * 210, 100 + (index % 2) * 120];
    node.color = color;
    node.bgcolor = '#18181b';
    node.addInput('in', 'flow');
    node.addOutput('out', 'flow');
    graph.add(node);
    return node;
  });

  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].connect(0, nodes[i + 1], 0);
  }

  graph.start();
  graphCanvasInitialized = true;

  window.addEventListener('resize', () => {
    if (host && canvasElement) {
      canvasElement.width = host.clientWidth;
      canvasElement.height = host.clientHeight;
      canvas.resize();
    }
  });
}

// Schedule task modal & toggle handlers
$('#add-schedule-task-btn')?.addEventListener('click', () => {
  $('#task-modal-backdrop')?.classList.add('active');
});

$('#close-task-modal')?.addEventListener('click', () => {
  $('#task-modal-backdrop')?.classList.remove('active');
});

$('#cancel-task-btn')?.addEventListener('click', () => {
  $('#task-modal-backdrop')?.classList.remove('active');
});

$('#create-task-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const formData = new FormData(form);
  const payload = {
    time: formData.get('time') as string,
    title: formData.get('title') as string,
    detail: formData.get('detail') as string,
  };

  try {
    await apiRequest('/api/overview/today', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    form.reset();
    $('#task-modal-backdrop')?.classList.remove('active');
    await loadTodaySchedule();
    await loadRecentActivity();
  } catch (err) {
    alert((err as Error).message);
  }
});

// Delegated click for today's schedule task check toggle
document.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const checkBtn = target.closest<HTMLButtonElement>('.timeline-check');
  if (checkBtn) {
    const taskId = checkBtn.getAttribute('data-task-id');
    if (taskId) {
      try {
        await apiRequest(`/api/overview/today/${taskId}`, { method: 'PUT' });
        await loadTodaySchedule();
        await loadRecentActivity();
      } catch (err) {
        console.error('Failed to toggle task:', err);
      }
    }
  }
});

// ==================== HEYGEN HYPERFRAMES STUDIO ENGINE ====================
function initHyperframeStudio() {
  const statusPill = $('#hf-server-status-pill') as HTMLElement | null;
  const startServerBtn = $('#hf-btn-start-server');
  const launchOverlayBtn = $('#hf-launch-overlay-btn');
  const topExportBtn = $('#hf-btn-export');
  const offlineOverlay = $('#hf-server-offline-overlay') as HTMLElement | null;
  const studioIframe = $('#hf-studio-iframe') as HTMLIFrameElement | null;

  async function checkServerHealth() {
    try {
      const res = await apiRequest<{ status: string; url: string }>('/api/hyperframe/server/status');
      if (res.status === 'online') {
        if (statusPill) {
          statusPill.textContent = 'ONLINE :3002';
          statusPill.style.background = '#10b981';
          statusPill.style.color = '#000000';
        }
        if (offlineOverlay) offlineOverlay.style.display = 'none';
        if (studioIframe) {
          studioIframe.style.display = 'block';
          if (!studioIframe.src || studioIframe.src.includes('about:blank')) {
            studioIframe.src = 'http://localhost:3002';
          }
        }
      } else {
        if (statusPill) {
          statusPill.textContent = 'STARTING...';
          statusPill.style.background = '#eab308';
          statusPill.style.color = '#000000';
        }
        await startLocalServer();
      }
    } catch {
      await startLocalServer();
    }
  }

  async function startLocalServer() {
    if (startServerBtn) startServerBtn.innerHTML = `<i class="ph-bold ph-spinner" style="animation: spin 1s linear infinite;"></i> Starting Studio Server...`;
    if (launchOverlayBtn) launchOverlayBtn.innerHTML = `<i class="ph-bold ph-spinner" style="animation: spin 1s linear infinite;"></i> Starting Studio Server...`;

    try {
      await apiRequest('/api/hyperframe/server/start', { method: 'POST' });
      setTimeout(async () => {
        await checkServerHealth();
        if (studioIframe) studioIframe.src = studioIframe.src;
      }, 3000);
    } catch (err) {
      alert(`Server Launch Error: ${(err as Error).message}`);
    } finally {
      if (startServerBtn) startServerBtn.innerHTML = `<i class="ph-bold ph-play"></i> Start Local Studio Server`;
      if (launchOverlayBtn) launchOverlayBtn.innerHTML = `<i class="ph-bold ph-rocket-launch"></i> Launch HyperFrames Web Studio Server`;
    }
  }

  // Export MP4 Video Action via CLI backend
  async function triggerVideoExport() {
    if (topExportBtn) topExportBtn.innerHTML = `<i class="ph-bold ph-spinner" style="animation: spin 1s linear infinite;"></i> Rendering MP4...`;

    try {
      const res = await apiRequest<{ status: string; filename: string; output_path: string }>('/api/hyperframe/render-mp4', {
        method: 'POST',
        body: JSON.stringify({
          project_name: 'sleep-recharge-motion',
          composition: 'index.html'
        })
      });

      alert(`🎉 Rendered video asset "${res.filename}" saved to database/assets/hyperframes/ and database/project_vault/assets/!`);
    } catch (err) {
      alert(`Export Error: ${(err as Error).message}`);
    } finally {
      if (topExportBtn) topExportBtn.innerHTML = `<i class="ph-bold ph-export"></i> Render Video (MP4)`;
    }
  }

  startServerBtn?.addEventListener('click', startLocalServer);
  launchOverlayBtn?.addEventListener('click', startLocalServer);
  topExportBtn?.addEventListener('click', triggerVideoExport);

  checkServerHealth();
}

// ==================== ASSETS VAULT ENGINE ====================
interface AssetFile {
  name: string;
  rel_path: string;
  abs_path: string;
  folder: string;
  size_bytes: number;
  size_formatted: string;
  media_type: 'video' | 'image' | 'audio' | 'hyperframe' | 'unknown';
  ext: string;
  modified_at: string;
}

interface AssetsVaultTree {
  categories: string[];
  folders: { name: string; rel_path: string; is_category: boolean }[];
  files: AssetFile[];
}

let currentAssetFilter = 'all';
let assetsVaultData: AssetsVaultTree | null = null;

async function loadAssetsVault() {
  const grid = $('#av-assets-grid');
  if (!grid) return;

  try {
    assetsVaultData = await apiRequest<AssetsVaultTree>('/api/assets-vault/tree');
    renderAssetsGrid();
  } catch (err) {
    grid.innerHTML = `<div style="color: #ef4444; padding: 20px;">Failed to load assets vault: ${(err as Error).message}</div>`;
  }
}

function renderAssetsGrid() {
  const grid = $('#av-assets-grid');
  if (!grid || !assetsVaultData) return;

  let filteredFiles = assetsVaultData.files;
  if (currentAssetFilter !== 'all') {
    filteredFiles = assetsVaultData.files.filter(f => 
      f.folder === currentAssetFilter || 
      f.media_type === currentAssetFilter ||
      currentAssetFilter.startsWith(f.media_type) ||
      f.media_type.startsWith(currentAssetFilter.slice(0, 4))
    );
  }

  if (filteredFiles.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; background: #121215; border: 1px dashed #27272a; border-radius: 12px; color: #a1a1aa;">
        <i class="ph-bold ph-vault" style="font-size: 2.5rem; color: #52525b; margin-bottom: 12px;"></i>
        <h3 style="color: #ffffff; font-size: 1.1rem; margin-bottom: 6px;">No assets found in "${currentAssetFilter}"</h3>
        <p style="font-size: 0.85rem; max-width: 400px; margin: 0 auto 16px;">Render videos using Hyperframes or click "+ Import File" to add assets to your vault.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredFiles.map(file => {
    let mediaIcon = 'ph-file';
    let mediaBadgeColor = '#3f3f46';
    let mediaPreview = '';
    const streamUrl = `${API_BASE}/api/assets-vault/stream/${encodeURIComponent(file.rel_path)}`;

    if (file.media_type === 'video' || file.ext === 'mp4' || file.ext === 'webm') {
      mediaIcon = 'ph-video-camera';
      mediaBadgeColor = '#8b5cf6';
      mediaPreview = `
        <video controls preload="metadata" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; background: #000; margin: 6px 0; border: 1px solid #27272a;">
          <source src="${streamUrl}" type="video/${file.ext === 'mp4' ? 'mp4' : 'webm'}">
          Your browser does not support HTML5 video playback.
        </video>
      `;
    } else if (file.media_type === 'image') {
      mediaIcon = 'ph-image';
      mediaBadgeColor = '#ec4899';
      mediaPreview = `
        <img src="${streamUrl}" alt="${file.name}" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; margin: 6px 0; border: 1px solid #27272a;" loading="lazy" />
      `;
    } else if (file.media_type === 'audio') {
      mediaIcon = 'ph-waveform';
      mediaBadgeColor = '#3b82f6';
      mediaPreview = `
        <div style="padding: 12px; background: rgba(59,130,246,0.1); border-radius: 8px; margin: 6px 0; border: 1px solid rgba(59,130,246,0.2);">
          <audio controls style="width: 100%; height: 36px;">
            <source src="${streamUrl}">
          </audio>
        </div>
      `;
    } else if (file.media_type === 'hyperframe') {
      mediaIcon = 'ph-frame-corners';
      mediaBadgeColor = '#f97316';
      mediaPreview = `
        <div style="height: 120px; background: #18181b; border-radius: 8px; padding: 12px; margin: 6px 0; display: flex; flex-direction: column; justify-content: center; align-items: center; border: 1px dashed #3f3f46; color: #a1a1aa; text-align: center;">
          <i class="ph-bold ph-code" style="font-size: 1.8rem; color: #f97316; margin-bottom: 6px;"></i>
          <span style="font-size: 0.8rem; font-weight: 600; color: #f4f4f5;">Hyperframe Template</span>
          <span style="font-size: 0.72rem; color: #71717a;">${file.name}</span>
        </div>
      `;
    }

    return `
      <div class="panel-card" style="padding: 14px; border: 1px solid #27272a; background: #121215; border-radius: 10px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 32px; height: 32px; border-radius: 6px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: ${mediaBadgeColor};">
              <i class="ph-bold ${mediaIcon}"></i>
            </div>
            <span style="font-size: 0.85rem; font-weight: 600; color: #ffffff; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 140px;" title="${file.name}">${file.name}</span>
          </div>
          <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); color: #d4d4d8;">.${file.ext}</span>
        </div>

        ${mediaPreview}

        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.76rem; color: #a1a1aa; border-top: 1px solid #27272a; padding-top: 8px; margin-top: 2px;">
          <span>📁 ${file.folder} • ${file.size_formatted}</span>
          <div style="display: flex; gap: 6px;">
            <button class="btn-icon download-asset-btn" data-url="${API_BASE}/api/assets-vault/stream/${file.rel_path}?download=true" data-name="${file.name}" style="color: #60a5fa; font-size: 0.9rem;" title="Download Asset">
              <i class="ph-bold ph-download-simple"></i>
            </button>
            <button class="btn-icon delete-asset-btn" data-path="${file.rel_path}" style="color: #ef4444; font-size: 0.9rem;" title="Delete Asset">
              <i class="ph-bold ph-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach download events
  $$('.download-asset-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const url = btn.getAttribute('data-url');
      const filename = btn.getAttribute('data-name') || 'download.mp4';
      if (!url) return;

      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        window.open(url, '_blank');
      }
    });
  });

  // Attach delete events
  $$('.delete-asset-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const path = btn.getAttribute('data-path');
      if (!path) return;
      if (confirm(`Delete asset "${path}"?`)) {
        try {
          const resp = await fetch(`${API_BASE}/api/assets-vault/files/${path}`, { method: 'DELETE' });
          if (!resp.ok) {
            const errData = await resp.json().catch(() => null);
            throw new Error(errData?.detail || 'Failed to delete file');
          }
          await loadAssetsVault();
        } catch (err) {
          alert(`Failed to delete: ${(err as Error).message}`);
        }
      }
    });
  });
}

function initAssetsVault() {
  const newFolderBtn = $('#av-btn-new-folder');
  const importFileBtn = $('#av-btn-import-file');
  const fileInput = $('#av-file-input') as HTMLInputElement | null;
  const filterContainer = $('#av-folder-filters');

  filterContainer?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.hf-tab-btn');
    if (!target) return;

    $$('#av-folder-filters .hf-tab-btn').forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    currentAssetFilter = target.getAttribute('data-folder') || 'all';
    renderAssetsGrid();
  });

  newFolderBtn?.addEventListener('click', async () => {
    const folderName = prompt('Enter new folder name for Assets Vault:');
    if (!folderName || !folderName.trim()) return;

    try {
      await apiRequest('/api/assets-vault/folders', {
        method: 'POST',
        body: JSON.stringify({ folder_name: folderName.trim() })
      });
      await loadAssetsVault();
    } catch (err) {
      alert(`Failed to create folder: ${(err as Error).message}`);
    }
  });

  importFileBtn?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    const file = fileInput.files[0];

    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', currentAssetFilter === 'all' ? 'imports' : currentAssetFilter);

    try {
      const res = await fetch(`${API_BASE}/api/assets-vault/upload`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) throw new Error(await res.text());
      await loadAssetsVault();
      fileInput.value = '';
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    }
  });

  loadAssetsVault();
}

// Master App Initialization Entrypoint
function startApp() {
  initNavigation();
  initAIComposer();
  initHyperframeStudio();
  initAssetsVault();
  initModalsAndEvents();
  initObsidianVault();
  initWorkflowStudio();
  initSystemLogs();
  initTTSStudio();
  initVideoStudio();
  loadSystemStats();
  loadPipelineStatus();
  loadTodaySchedule();
  loadRecentActivity();
  loadProjects();
  loadResearch();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
}

// ==================== OBSIDIAN KNOWLEDGE VAULT ENGINE ====================
interface WikiTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children?: WikiTreeNode[];
}

interface WikiTab {
  path: string;
  title: string;
  content: string;
  isGraph?: boolean;
}

let obsidianTabs: WikiTab[] = [];
let activeWikiPath: string | null = null;
let contextTargetNodePath: string | null = null;
let contextTargetNodeType: 'file' | 'folder' = 'file';

async function loadObsidianVaultTree() {
  const rootEl = $('#obsidian-tree-root');
  if (!rootEl) return;

  try {
    const { tree } = await apiRequest<{ tree: WikiTreeNode[] }>('/api/wiki/tree');
    if (!tree || tree.length === 0) {
      rootEl.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-dim); padding: 10px;">Vault is empty. Click <b>New Note</b> icon to create one.</p>';
      return;
    }
    rootEl.innerHTML = buildTreeHtml(tree);
    if (!activeWikiPath && tree.length > 0) {
      const firstFile = findFirstFile(tree);
      if (firstFile) openWikiNote(firstFile);
    }
  } catch (err) {
    console.error('Failed to load wiki tree:', err);
  }
}

function findFirstFile(nodes: WikiTreeNode[]): string | null {
  for (const n of nodes) {
    if (n.type === 'file') return n.path;
    if (n.children) {
      const sub = findFirstFile(n.children);
      if (sub) return sub;
    }
  }
  return null;
}

function buildTreeHtml(nodes: WikiTreeNode[]): string {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    const res = a.name.localeCompare(b.name);
    return treeSortAscending ? res : -res;
  });
  return sorted
    .map((node) => {
      if (node.type === 'folder') {
        return `
          <div class="tree-folder-wrapper">
            <div class="tree-node tree-folder-toggle" data-path="${escapeHtml(node.path)}" data-type="folder">
              <i class="ph-bold ph-caret-down" style="font-size: 0.75rem; color: var(--text-dim);"></i>
              <i class="ph-bold ph-folder tree-folder-icon"></i>
              <span>${escapeHtml(node.name)}</span>
            </div>
            <div class="tree-children" style="display: block;">
              ${node.children ? buildTreeHtml(node.children) : ''}
            </div>
          </div>
        `;
      } else {
        const isActive = activeWikiPath === node.path ? 'active' : '';
        return `
          <div class="tree-node tree-file-item ${isActive}" data-path="${escapeHtml(node.path)}" data-type="file">
            <i class="ph-bold ph-file-text tree-file-icon"></i>
            <span>${escapeHtml(node.name.replace('.md', ''))}</span>
          </div>
        `;
      }
    })
    .join('');
}

async function openWikiNote(relPath: string) {
  if (relPath === 'graph-view') {
    openGraphViewTab();
    return;
  }

  try {
    let tab = obsidianTabs.find((t) => t.path === relPath);
    if (!tab) {
      const res = await apiRequest<{ path: string; name: string; content: string }>(`/api/wiki/file?path=${encodeURIComponent(relPath)}`);
      tab = { path: res.path, title: res.name.replace('.md', ''), content: res.content };
      obsidianTabs.push(tab);
    }
    activeWikiPath = relPath;
    renderObsidianTabs();
    loadActiveNoteIntoEditor();
  } catch (err) {
    alert((err as Error).message);
  }
}

function renderObsidianTabs() {
  const tabsList = $('#obsidian-tabs-list');
  if (!tabsList) return;

  tabsList.innerHTML = obsidianTabs
    .map(
      (t) => `
    <div class="obsidian-tab ${t.path === activeWikiPath ? 'active' : ''}" data-path="${escapeHtml(t.path)}">
      <i class="ph-bold ${t.isGraph ? 'ph-tree-structure' : 'ph-file-text'}"></i>
      <span>${escapeHtml(t.title)}</span>
      <i class="ph-bold ph-x obsidian-tab-close" data-close-path="${escapeHtml(t.path)}"></i>
    </div>
  `
    )
    .join('');
}

function loadActiveNoteIntoEditor() {
  const textarea = $('#obsidian-editor-textarea') as HTMLTextAreaElement | null;
  const preview = $('#obsidian-editor-preview') as HTMLElement | null;
  const graphView = $('#obsidian-graph-tab-view') as HTMLElement | null;

  if (activeWikiPath === 'graph-view') {
    openGraphViewTab();
    return;
  }

  if (graphView) graphView.style.display = 'none';
  if (preview) preview.style.display = 'none';
  if (textarea) textarea.style.display = 'block';

  const tab = obsidianTabs.find((t) => t.path === activeWikiPath);
  if (!tab || !textarea) return;
  textarea.value = tab.content;
  loadObsidianVaultTree();
}

interface GraphPhysicsNode {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphPhysicsLink {
  source: string;
  target: string;
}

let physicsNodes: GraphPhysicsNode[] = [];
let physicsLinks: GraphPhysicsLink[] = [];
let graphAnimFrame: number | null = null;

let zoomScale = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let draggedGraphNode: GraphPhysicsNode | null = null;
let treeSortAscending = true;

async function startFullGraphPhysicsEngine() {
  const canvas = $('#obsidian-full-graph-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = canvas.parentElement?.clientWidth || 800;
  canvas.height = canvas.parentElement?.clientHeight || 600;

  try {
    const data = await apiRequest<{ nodes: { id: string; name: string; path: string }[]; links: { source: string; target: string }[] }>('/api/wiki/graph');

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 80;

    physicsNodes = data.nodes.map((n, idx) => {
      const angle = (idx / data.nodes.length) * 2 * Math.PI;
      return {
        id: n.id,
        name: n.name,
        path: n.path,
        x: centerX + (radius + (Math.random() * 40 - 20)) * Math.cos(angle),
        y: centerY + (radius + (Math.random() * 40 - 20)) * Math.sin(angle),
        vx: 0,
        vy: 0,
      };
    });

    physicsLinks = data.links;

    if (graphAnimFrame) cancelAnimationFrame(graphAnimFrame);

    function step() {
      if (!canvas || !ctx) return;
      ctx.fillStyle = '#1f1f23';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Repulsion between all nodes
      for (let i = 0; i < physicsNodes.length; i++) {
        for (let j = i + 1; j < physicsNodes.length; j++) {
          const n1 = physicsNodes[i];
          const n2 = physicsNodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 3000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (n1 !== draggedGraphNode) {
            n1.vx -= fx;
            n1.vy -= fy;
          }
          if (n2 !== draggedGraphNode) {
            n2.vx += fx;
            n2.vy += fy;
          }
        }
      }

      // Spring attraction along links
      const restLength = 120;
      physicsLinks.forEach((link) => {
        const n1 = physicsNodes.find((n) => n.id.toLowerCase() === link.source.toLowerCase());
        const n2 = physicsNodes.find((n) => n.id.toLowerCase() === link.target.toLowerCase());
        if (n1 && n2) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - restLength) * 0.05;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (n1 !== draggedGraphNode) {
            n1.vx += fx;
            n1.vy += fy;
          }
          if (n2 !== draggedGraphNode) {
            n2.vx -= fx;
            n2.vy -= fy;
          }
        }
      });

      // Gravity towards center & velocity damping
      const cX = canvas.width / 2;
      const cY = canvas.height / 2;

      physicsNodes.forEach((n) => {
        if (n !== draggedGraphNode) {
          n.vx += (cX - n.x) * 0.005;
          n.vy += (cY - n.y) * 0.005;
          n.vx *= 0.82;
          n.vy *= 0.82;
          n.x += n.vx;
          n.y += n.vy;
        }
      });

      // Render transformed scene
      ctx.save();
      ctx.translate(panX, panY);
      ctx.scale(zoomScale, zoomScale);

      // Draw links
      ctx.strokeStyle = 'rgba(255, 85, 0, 0.4)';
      ctx.lineWidth = 2 / zoomScale;
      physicsLinks.forEach((link) => {
        const n1 = physicsNodes.find((n) => n.id.toLowerCase() === link.source.toLowerCase());
        const n2 = physicsNodes.find((n) => n.id.toLowerCase() === link.target.toLowerCase());
        if (n1 && n2) {
          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.stroke();
        }
      });

      // Draw nodes
      physicsNodes.forEach((n) => {
        ctx.fillStyle = '#ff5500';
        ctx.beginPath();
        ctx.arc(n.x, n.y, 7 / zoomScale, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(10, 12 / zoomScale)}px sans-serif`;
        ctx.fillText(n.name, n.x + 10 / zoomScale, n.y + 4 / zoomScale);
      });

      ctx.restore();

      graphAnimFrame = requestAnimationFrame(step);
    }

    step();
  } catch (err) {
    console.error('Failed to start physics engine:', err);
  }
}

function openGraphViewTab() {
  let graphTab = obsidianTabs.find((t) => t.path === 'graph-view');
  if (!graphTab) {
    graphTab = { path: 'graph-view', title: 'Graph view', content: '', isGraph: true };
    obsidianTabs.push(graphTab);
  }
  activeWikiPath = 'graph-view';
  renderObsidianTabs();

  const textarea = $('#obsidian-editor-textarea') as HTMLTextAreaElement | null;
  const preview = $('#obsidian-editor-preview') as HTMLElement | null;
  const graphView = $('#obsidian-graph-tab-view') as HTMLElement | null;

  if (textarea) textarea.style.display = 'none';
  if (preview) preview.style.display = 'none';
  if (graphView) {
    graphView.style.display = 'flex';
    startFullGraphPhysicsEngine();
  }
}

function initObsidianVault() {
  loadObsidianVaultTree();

  // Left Ribbon navigation buttons
  $('#ribbon-btn-graph')?.addEventListener('click', () => openGraphViewTab());
  $('#ribbon-btn-explorer')?.addEventListener('click', () => loadObsidianVaultTree());

  // Add new tab button
  $('#obsidian-add-tab-btn')?.addEventListener('click', async () => {
    const name = prompt('Create or open note:');
    if (name) {
      try {
        const res = await apiRequest<{ path: string }>('/api/wiki/file', {
          method: 'POST',
          body: JSON.stringify({ path: name, title: name }),
        });
        await loadObsidianVaultTree();
        await openWikiNote(res.path);
      } catch (err) {
        alert((err as Error).message);
      }
    }
  });

  // Switch / Close tabs
  $('.obsidian-tab-bar')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const closeBtn = target.closest<HTMLElement>('.obsidian-tab-close');
    if (closeBtn) {
      e.stopPropagation();
      const closePath = closeBtn.getAttribute('data-close-path');
      if (closePath) {
        obsidianTabs = obsidianTabs.filter((t) => t.path !== closePath);
        if (activeWikiPath === closePath) {
          activeWikiPath = obsidianTabs.length > 0 ? obsidianTabs[obsidianTabs.length - 1].path : null;
        }
        renderObsidianTabs();
        loadActiveNoteIntoEditor();
      }
      return;
    }

    const tabEl = target.closest<HTMLElement>('.obsidian-tab');
    if (tabEl) {
      const path = tabEl.getAttribute('data-path');
      if (path) openWikiNote(path);
    }
  });

  // Textarea Auto-save on input
  const textarea = $('#obsidian-editor-textarea') as HTMLTextAreaElement | null;
  let autoSaveTimer: any = null;

  textarea?.addEventListener('input', () => {
    if (activeWikiPath && activeWikiPath !== 'graph-view' && textarea) {
      const tab = obsidianTabs.find((t) => t.path === activeWikiPath);
      if (tab) tab.content = textarea.value;

      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(async () => {
        try {
          await apiRequest('/api/wiki/file', {
            method: 'PUT',
            body: JSON.stringify({ path: activeWikiPath, content: textarea.value }),
          });
        } catch (err) {
          console.error('Auto-save failed:', err);
        }
      }, 800);
    }
  });

  // Tree Action Bar Icons (Image 2)
  $('#obsidian-tree-new-note')?.addEventListener('click', async () => {
    const name = prompt('New note name or path (e.g. concepts/idea.md):');
    if (name) {
      try {
        const res = await apiRequest<{ path: string }>('/api/wiki/file', {
          method: 'POST',
          body: JSON.stringify({ path: name, title: name }),
        });
        await loadObsidianVaultTree();
        await openWikiNote(res.path);
      } catch (err) {
        alert((err as Error).message);
      }
    }
  });

  $('#obsidian-tree-new-folder')?.addEventListener('click', async () => {
    const name = prompt('New folder path (e.g. Vortexia/research):');
    if (name) {
      try {
        await apiRequest('/api/wiki/folder', {
          method: 'POST',
          body: JSON.stringify({ path: name }),
        });
        await loadObsidianVaultTree();
      } catch (err) {
        alert((err as Error).message);
      }
    }
  });

  // Graph View Canvas Mouse Zoom, Pan, and Node Drag Events
  const graphCanvas = $('#obsidian-full-graph-canvas') as HTMLCanvasElement | null;
  if (graphCanvas) {
    let clickStartX = 0;
    let clickStartY = 0;
    let activeClickedNode: GraphPhysicsNode | null = null;

    graphCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      zoomScale = Math.min(Math.max(0.3, zoomScale * zoomFactor), 4.0);
    });

    graphCanvas.addEventListener('mousedown', (e) => {
      const rect = graphCanvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - panX) / zoomScale;
      const mouseY = (e.clientY - rect.top - panY) / zoomScale;

      clickStartX = e.clientX;
      clickStartY = e.clientY;

      // Check if clicking a node circle
      const clicked = physicsNodes.find((n) => {
        const dx = n.x - mouseX;
        const dy = n.y - mouseY;
        return Math.sqrt(dx * dx + dy * dy) <= 18 / zoomScale;
      });

      if (clicked) {
        draggedGraphNode = clicked;
        activeClickedNode = clicked;
      } else {
        isPanning = true;
        startPanX = e.clientX - panX;
        startPanY = e.clientY - panY;
        activeClickedNode = null;
      }
    });

    graphCanvas.addEventListener('mousemove', (e) => {
      const rect = graphCanvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - panX) / zoomScale;
      const mouseY = (e.clientY - rect.top - panY) / zoomScale;

      // Update cursor style on hover over node circles
      const isHover = physicsNodes.some((n) => {
        const dx = n.x - mouseX;
        const dy = n.y - mouseY;
        return Math.sqrt(dx * dx + dy * dy) <= 18 / zoomScale;
      });
      graphCanvas.style.cursor = isHover ? 'pointer' : isPanning ? 'grabbing' : 'grab';

      if (draggedGraphNode) {
        draggedGraphNode.x = mouseX;
        draggedGraphNode.y = mouseY;
      } else if (isPanning) {
        panX = e.clientX - startPanX;
        panY = e.clientY - startPanY;
      }
    });

    graphCanvas.addEventListener('mouseup', (e) => {
      const dist = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY);
      if (dist < 6 && activeClickedNode && activeClickedNode.path) {
        openWikiNote(activeClickedNode.path);
      }
      draggedGraphNode = null;
      isPanning = false;
      activeClickedNode = null;
    });
  }

  // Tree Sort Order Toggle
  $('#obsidian-tree-sort')?.addEventListener('click', () => {
    treeSortAscending = !treeSortAscending;
    loadObsidianVaultTree();
  });

  // Search Ribbon Button (Prompts search filter)
  $('#ribbon-btn-search')?.addEventListener('click', async () => {
    const query = prompt('Search notes in Knowledge Vault:');
    if (query) {
      try {
        const { tree } = await apiRequest<{ tree: WikiTreeNode[] }>('/api/wiki/tree');
        const rootEl = $('#obsidian-tree-root');
        const lowerQ = query.toLowerCase();
        const filtered = tree.filter(n => n.name.toLowerCase().includes(lowerQ));
        if (rootEl) {
          rootEl.innerHTML = buildTreeHtml(filtered.length ? filtered : tree);
        }
      } catch (err) {
        console.error(err);
      }
    }
  });

  // Canvas Ribbon Button
  $('#ribbon-btn-canvas')?.addEventListener('click', async () => {
    try {
      const res = await apiRequest<{ path: string }>('/api/wiki/file', {
        method: 'POST',
        body: JSON.stringify({ path: 'Canvas.md', title: 'Canvas Note Board', content: '# Obsidian Canvas\n\n- [ ] Task 1\n- [ ] Task 2\n\n[[README]]' }),
      });
      await loadObsidianVaultTree();
      await openWikiNote(res.path);
    } catch (err) {
      alert((err as Error).message);
    }
  });

  // Bookmarks Ribbon Button
  $('#ribbon-btn-bookmark')?.addEventListener('click', () => {
    alert('Bookmarked Notes:\n- test/fs.md\n- test/gfd.md\n- README.md');
  });

  // Tree Right-Click Context Menu (Image 3)
  const treeContextMenu = $('#tree-context-menu') as HTMLElement | null;
  const editorContextMenu = $('#editor-context-menu') as HTMLElement | null;

  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;

    // Tree Node right-click
    const treeNode = target.closest<HTMLElement>('.tree-node');
    if (treeNode) {
      e.preventDefault();
      e.stopPropagation();
      contextTargetNodePath = treeNode.getAttribute('data-path');
      contextTargetNodeType = (treeNode.getAttribute('data-type') as 'file' | 'folder') || 'file';

      if (treeContextMenu) {
        treeContextMenu.style.left = `${e.clientX}px`;
        treeContextMenu.style.top = `${e.clientY}px`;
        treeContextMenu.classList.add('active');
        editorContextMenu?.classList.remove('active');
      }
      return;
    }

    // Editor Textarea right-click
    if (target.id === 'obsidian-editor-textarea') {
      e.preventDefault();
      e.stopPropagation();
      if (editorContextMenu) {
        editorContextMenu.style.left = `${e.clientX}px`;
        editorContextMenu.style.top = `${e.clientY}px`;
        editorContextMenu.classList.add('active');
        treeContextMenu?.classList.remove('active');
      }
      return;
    }

    treeContextMenu?.classList.remove('active');
    editorContextMenu?.classList.remove('active');
  });

  document.addEventListener('click', () => {
    treeContextMenu?.classList.remove('active');
    editorContextMenu?.classList.remove('active');
  });

  // Tree Context Menu Actions
  treeContextMenu?.addEventListener('click', async (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.context-item');
    if (!item || !contextTargetNodePath) return;
    const action = item.getAttribute('data-action');

    if (action === 'new-note') {
      const name = prompt(`New note inside ${contextTargetNodePath}:`);
      if (name) {
        const fullPath = `${contextTargetNodePath}/${name}`;
        const res = await apiRequest<{ path: string }>('/api/wiki/file', {
          method: 'POST',
          body: JSON.stringify({ path: fullPath, title: name }),
        });
        await loadObsidianVaultTree();
        await openWikiNote(res.path);
      }
    } else if (action === 'new-folder') {
      const name = prompt(`New folder inside ${contextTargetNodePath}:`);
      if (name) {
        await apiRequest('/api/wiki/folder', {
          method: 'POST',
          body: JSON.stringify({ path: `${contextTargetNodePath}/${name}` }),
        });
        await loadObsidianVaultTree();
      }
    } else if (action === 'copy-path') {
      navigator.clipboard.writeText(contextTargetNodePath);
      alert(`Copied path: ${contextTargetNodePath}`);
    } else if (action === 'delete') {
      if (await customConfirm('Delete Item', `Delete "${contextTargetNodePath}" from vault?`)) {
        await apiRequest(`/api/wiki/file?path=${encodeURIComponent(contextTargetNodePath)}`, { method: 'DELETE' });
        obsidianTabs = obsidianTabs.filter((t) => t.path !== contextTargetNodePath);
        if (activeWikiPath === contextTargetNodePath) {
          activeWikiPath = obsidianTabs.length > 0 ? obsidianTabs[obsidianTabs.length - 1].path : null;
        }
        renderObsidianTabs();
        loadActiveNoteIntoEditor();
        await loadObsidianVaultTree();
      }
    }
  });

  // Editor Context Menu Actions (Image 4)
  editorContextMenu?.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.context-item');
    if (!item || !textarea) return;
    const action = item.getAttribute('data-action');

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    if (action === 'add-link') {
      const replacement = `[[${selectedText || 'Note Name'}]]`;
      textarea.setRangeText(replacement, start, end, 'select');
    } else if (action === 'bold') {
      const replacement = `**${selectedText || 'bold text'}**`;
      textarea.setRangeText(replacement, start, end, 'select');
    } else if (action === 'italic') {
      const replacement = `*${selectedText || 'italic text'}*`;
      textarea.setRangeText(replacement, start, end, 'select');
    } else if (action === 'heading') {
      const replacement = `# ${selectedText || 'Heading'}`;
      textarea.setRangeText(replacement, start, end, 'select');
    } else if (action === 'cut') {
      navigator.clipboard.writeText(selectedText);
      textarea.setRangeText('', start, end, 'end');
    } else if (action === 'copy') {
      navigator.clipboard.writeText(selectedText);
    }

    textarea.dispatchEvent(new Event('input'));
  });

  // Delegated click for Tree Nodes
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const fileItem = target.closest<HTMLElement>('.tree-file-item');
    if (fileItem) {
      const path = fileItem.getAttribute('data-path');
      if (path) openWikiNote(path);
      return;
    }

    const folderToggle = target.closest<HTMLElement>('.tree-folder-toggle');
    if (folderToggle) {
      const childrenEl = folderToggle.nextElementSibling as HTMLElement | null;
      if (childrenEl) {
        childrenEl.style.display = childrenEl.style.display === 'none' ? 'block' : 'none';
      }
      return;
    }
  });
}

// Workflow Pipeline Studio Engine
function initWorkflowStudio() {
  const svgLayer = $('#workflow-svg-layer') as SVGElement | null;
  const nodesArea = $('#workflow-nodes-area');
  const runBtn = $('#run-workflow-btn');
  const inspectorDrawer = $('#node-inspector-drawer');
  const closeInspectorBtn = $('#close-node-inspector');

  if (!nodesArea || !svgLayer) return;

  const nodeConnections = [
    { from: 'topic', to: 'research' },
    { from: 'research', to: 'script' },
    { from: 'script', to: 'prompts' },
    { from: 'script', to: 'voice' },
    { from: 'prompts', to: 'publish' },
    { from: 'voice', to: 'publish' },
  ];

  let nodeOutputs: Record<string, string> = {
    topic: 'Input topic: "Building an AI Content Engine"',
    research: 'Knowledge Vault Ingest:\n- Ingested 3 reference notes\n- Extracted Karpathy Wiki concepts',
    script: 'Generated Script Outline:\n- Hook (0:00-0:15)\n- Body Beats\n- Call To Action',
    prompts: 'Generated Prompts:\n1. Developer studio with neon amber lighting, 8k\n2. AI architecture diagram',
    voice: 'Voice Narration Transcript:\n"Welcome back! Today we build an AI Content Engine step by step."',
    publish: 'Status: Ready to publish to Projects Vault',
  };

  const nodeDescriptions: Record<string, string> = {
    topic: 'Defines the core topic and platform target for content production.',
    research: 'Ingests related research notes and reference materials from your Knowledge Vault.',
    script: 'Synthesizes hook, main narrative beats, and call-to-action into a clean video script.',
    prompts: 'Creates cinematic prompt specifications for Flux, Midjourney, and visual thumbnails.',
    voice: 'Generates narration transcript and audio synthesis timestamps.',
    publish: 'Bundles all outputs into a completed project manifest stored in your Projects Vault.',
  };

  function drawWires(isPipelineActive: boolean = false) {
    if (!svgLayer || !nodesArea) return;
    const areaRect = nodesArea.getBoundingClientRect();
    const scrollLeft = nodesArea.parentElement?.scrollLeft || 0;
    const scrollTop = nodesArea.parentElement?.scrollTop || 0;

    let svgHTML = `
      <defs>
        <linearGradient id="wireGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ff5500" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#ff8800" stop-opacity="0.9" />
        </linearGradient>
      </defs>
    `;

    nodeConnections.forEach((conn) => {
      const fromSocket = nodesArea.querySelector<HTMLElement>(`.node-socket.output[data-node="${conn.from}"]`);
      const toSocket = nodesArea.querySelector<HTMLElement>(`.node-socket.input[data-node="${conn.to}"]`);

      if (fromSocket && toSocket) {
        const fromRect = fromSocket.getBoundingClientRect();
        const toRect = toSocket.getBoundingClientRect();

        const x1 = fromRect.left - areaRect.left + scrollLeft + 6;
        const y1 = fromRect.top - areaRect.top + scrollTop + 6;
        const x2 = toRect.left - areaRect.left + scrollLeft + 6;
        const y2 = toRect.top - areaRect.top + scrollTop + 6;

        const dx = Math.abs(x2 - x1) * 0.5;
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

        svgHTML += `<path d="${d}" class="workflow-wire-path ${isPipelineActive ? 'active' : ''}" />`;
      }
    });

    svgLayer.innerHTML = svgHTML;
  }

  // Draw initial wires
  setTimeout(() => drawWires(), 100);
  window.addEventListener('resize', () => drawWires());

  // Make Node Cards Draggable
  let activeDragNode: HTMLElement | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  nodesArea.querySelectorAll<HTMLElement>('.wf-node-card').forEach((card) => {
    card.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      activeDragNode = card;
      const rect = card.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;

      nodesArea.querySelectorAll('.wf-node-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!activeDragNode || !nodesArea) return;
    const areaRect = nodesArea.getBoundingClientRect();
    const scrollLeft = nodesArea.parentElement?.scrollLeft || 0;
    const scrollTop = nodesArea.parentElement?.scrollTop || 0;

    let x = e.clientX - areaRect.left - dragOffsetX + scrollLeft;
    let y = e.clientY - areaRect.top - dragOffsetY + scrollTop;

    x = Math.max(10, x);
    y = Math.max(10, y);

    activeDragNode.style.left = `${x}px`;
    activeDragNode.style.top = `${y}px`;
    drawWires();
  });

  window.addEventListener('mouseup', () => {
    if (activeDragNode) {
      activeDragNode = null;
      drawWires();
    }
  });

  // Open Node Inspector Drawer on Card Click
  nodesArea.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.wf-node-card');
    if (!card) return;

    const nodeId = card.getAttribute('data-id');
    if (!nodeId) return;

    const titleEl = $('#ni-title');
    const typeBadge = $('#ni-type-badge');
    const statusEl = $('#ni-status-display');
    const descEl = $('#ni-description');
    const previewEl = $('#ni-output-preview');
    const badgeEl = card.querySelector('.node-status-badge');

    if (titleEl) titleEl.textContent = card.querySelector('.node-title')?.textContent || 'Node Inspector';
    if (typeBadge) typeBadge.textContent = nodeId.toUpperCase();
    if (statusEl && badgeEl) statusEl.textContent = badgeEl.textContent || 'WAITING';
    if (descEl) descEl.textContent = nodeDescriptions[nodeId] || 'Pipeline processing node.';
    if (previewEl) previewEl.textContent = nodeOutputs[nodeId] || 'No output generated yet.';

    inspectorDrawer?.classList.add('active');
  });

  closeInspectorBtn?.addEventListener('click', () => inspectorDrawer?.classList.remove('active'));

  // ▶ Run Full Pipeline Execution Engine
  runBtn?.addEventListener('click', async () => {
    const topicInput = $('#wf-input-topic') as HTMLInputElement | null;
    const topic = topicInput?.value.trim() || 'Building an AI Content Engine';

    runBtn.setAttribute('disabled', 'true');
    runBtn.innerHTML = `<i class="ph-bold ph-spinner spinner"></i> <span>Running Pipeline...</span>`;

    const nodeOrder = ['topic', 'research', 'script', 'prompts', 'voice', 'publish'];

    // Reset status badges
    nodeOrder.forEach((id) => {
      const b = $(`#badge-${id}`);
      if (b) {
        b.className = 'node-status-badge waiting';
        b.textContent = 'WAITING';
      }
      $(`#wf-node-${id}`)?.classList.remove('running', 'done');
    });

    drawWires(true);

    for (let i = 0; i < nodeOrder.length; i++) {
      const nodeId = nodeOrder[i];
      const card = $(`#wf-node-${nodeId}`);
      const badge = $(`#badge-${nodeId}`);

      if (card && badge) {
        card.classList.add('running');
        badge.className = 'node-status-badge running';
        badge.textContent = 'RUNNING';
      }

      await new Promise((r) => setTimeout(r, 600));

      if (card && badge) {
        card.classList.remove('running');
        card.classList.add('done');
        badge.className = 'node-status-badge done';
        badge.textContent = 'DONE';
      }
    }

    try {
      const res = await apiRequest<{ status: string; project: any; steps: any }>('/api/pipeline/execute', {
        method: 'POST',
        body: JSON.stringify({ topic, platform: 'YouTube' }),
      });

      if (res.steps) {
        nodeOutputs = {
          topic: `Topic: "${res.steps.topic?.title}"`,
          research: res.steps.research?.summary || 'Research ready.',
          script: res.steps.script?.outline || 'Script generated.',
          prompts: res.steps.prompts?.sample || 'Prompts generated.',
          voice: res.steps.voice?.transcript || 'Voice transcript ready.',
          publish: `Published project: ${res.steps.publish?.project_id}`,
        };
      }

      await loadProjects();
      alert(`🎉 Pipeline executed successfully! Project "${res.project?.title}" saved to Projects Vault.`);
    } catch (err) {
      alert(`Pipeline Execution Error: ${(err as Error).message}`);
    } finally {
      drawWires(false);
      runBtn.removeAttribute('disabled');
      runBtn.innerHTML = `<i class="ph-bold ph-play"></i> <span>▶ Run Full Pipeline</span>`;
    }
  });
}

// ==================== REAL-TIME SYSTEM LOG STREAM ====================
interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
  detail?: string;
}

let activeLogFilter = 'ALL';
let isAutoScrollEnabled = true;
let eventSource: EventSource | null = null;
let allLogsStore: LogEntry[] = [];

function initSystemLogs() {
  const consoleEl = $('#sys-log-console');
  if (!consoleEl) return;

  const filterBtns = $$('.log-filter-btn');
  const autoscrollChk = $('#log-autoscroll-chk') as HTMLInputElement | null;
  const copyBtn = $('#log-copy-btn');
  const clearBtn = $('#log-clear-btn');
  const statusPill = $('#log-status-pill') as HTMLElement | null;

  if (autoscrollChk) {
    autoscrollChk.addEventListener('change', () => {
      isAutoScrollEnabled = autoscrollChk.checked;
    });
  }

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeLogFilter = btn.getAttribute('data-filter') || 'ALL';
      renderLogsConsole();
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      allLogsStore = [];
      renderLogsConsole();
      try {
        await apiRequest('/api/system/logs', { method: 'DELETE' });
      } catch (e) {}
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = allLogsStore
        .map((l) => `[${l.timestamp}] [${l.level}] [${l.source}] ${l.message}`)
        .join('\n');
      navigator.clipboard.writeText(text);
      copyBtn.innerHTML = `<i class="ph-bold ph-check"></i> Copied!`;
      setTimeout(() => {
        copyBtn.innerHTML = `<i class="ph-bold ph-copy"></i> Copy`;
      }, 2000);
    });
  }

  // Connect SSE Live Stream
  if (!eventSource) {
    try {
      eventSource = new EventSource(`${API_BASE}/api/system/logs/stream`);

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'backlog' && Array.isArray(payload.logs)) {
            allLogsStore = payload.logs;
            renderLogsConsole();
          } else if (payload.type === 'log' && payload.log) {
            allLogsStore.push(payload.log);
            if (allLogsStore.length > 500) allLogsStore.shift();
            renderLogsConsole();
          }
        } catch (e) {}
      };

      eventSource.onerror = () => {
        if (statusPill) {
          statusPill.style.background = 'rgba(239, 68, 68, 0.15)';
          statusPill.style.color = '#f87171';
          statusPill.innerHTML = `<i class="ph-bold ph-warning"></i> RECONNECTING...`;
        }
      };

      eventSource.onopen = () => {
        if (statusPill) {
          statusPill.style.background = 'rgba(16, 185, 129, 0.15)';
          statusPill.style.color = '#10b981';
          statusPill.innerHTML = `<i class="ph-bold ph-circle" style="font-size: 0.6rem; margin-right: 4px; color: #10b981;"></i> STREAMING LIVE`;
        }
      };
    } catch (err) {
      console.error('Failed to connect log stream:', err);
    }
  }

  function renderLogsConsole() {
    if (!consoleEl) return;

    let filtered = allLogsStore;
    if (activeLogFilter === 'ERROR') {
      filtered = allLogsStore.filter((l) => l.level === 'ERROR' || l.level === 'WARN');
    } else if (activeLogFilter !== 'ALL') {
      filtered = allLogsStore.filter((l) => l.source === activeLogFilter);
    }

    if (filtered.length === 0) {
      consoleEl.innerHTML = `
        <div class="log-entry log-entry-info">
          <span class="log-time">[${new Date().toLocaleTimeString()}]</span>
          <span class="log-tag tag-system">SYSTEM</span>
          <span class="log-text">No logs matching filter "${activeLogFilter}". Waiting for live events...</span>
        </div>
      `;
      return;
    }

    consoleEl.innerHTML = filtered
      .map((l) => {
        const levelClass = l.level === 'ERROR' ? 'log-entry-error' : l.level === 'SUCCESS' ? 'log-entry-success' : l.level === 'WARN' ? 'log-entry-warn' : 'log-entry-info';
        const tagClass = `tag-${l.source.toLowerCase()}`;
        return `
          <div class="log-entry ${levelClass}">
            <span class="log-time">[${l.timestamp}]</span>
            <span class="log-tag ${tagClass}">${escapeHtml(l.source)}</span>
            <span class="log-text">${escapeHtml(l.message)}</span>
          </div>
        `;
      })
      .join('');

    if (isAutoScrollEnabled) {
      consoleEl.scrollTop = consoleEl.scrollHeight;
    }
  }

  renderLogsConsole();
}

// ==================== TTS STUDIO ENGINE (CHATTERBOX TTS) ====================

function initTTSStudio() {
  const statusBadge = $('#tts-server-status-badge') as HTMLElement | null;
  const startBtn = $('#tts-btn-start-server') as HTMLElement | null;
  const launchOfflineBtn = $('#tts-btn-launch-offline') as HTMLElement | null;
  const offlineNotice = $('#tts-offline-notice') as HTMLElement | null;
  const iframe = $('#tts-studio-iframe') as HTMLIFrameElement | null;
  let isLaunching = false;

  async function checkTTSStatus(): Promise<boolean> {
    try {
      const res = await apiRequest<{ status: string; url: string }>('/api/tts/server/status');
      if (res.status === 'online') {
        if (statusBadge) {
          statusBadge.textContent = '● ONLINE (PORT 8001)';
          statusBadge.style.background = 'rgba(34, 197, 94, 0.15)';
          statusBadge.style.color = '#22c55e';
          statusBadge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        }
        if (offlineNotice) offlineNotice.style.display = 'none';
        if (iframe) {
          iframe.style.display = 'block';
          if (!iframe.src || iframe.src === 'about:blank' || !iframe.src.includes('8001')) {
            iframe.src = 'http://localhost:8001';
          }
        }
        isLaunching = false;
        return true;
      } else {
        if (statusBadge && !isLaunching) {
          statusBadge.textContent = '○ STARTING / OFFLINE';
          statusBadge.style.background = 'rgba(249, 115, 22, 0.15)';
          statusBadge.style.color = '#f97316';
          statusBadge.style.borderColor = 'rgba(249, 115, 22, 0.3)';
        }
        if (offlineNotice) offlineNotice.style.display = 'block';
        if (iframe) iframe.style.display = 'none';
        return false;
      }
    } catch (e) {
      if (statusBadge && !isLaunching) {
        statusBadge.textContent = '○ OFFLINE';
        statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        statusBadge.style.color = '#ef4444';
      }
      if (offlineNotice) offlineNotice.style.display = 'block';
      if (iframe) iframe.style.display = 'none';
      return false;
    }
  }

  async function startTTSServer() {
    isLaunching = true;
    if (statusBadge) statusBadge.textContent = '⏳ LAUNCHING CHATTERBOX SERVER...';
    if (launchOfflineBtn) {
      launchOfflineBtn.textContent = '⏳ Launching Chatterbox Server...';
      (launchOfflineBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
      await apiRequest('/api/tts/server/start', { method: 'POST' });
    } catch (e) {
      console.warn('TTS Launch trigger sent:', e);
    }

    let attempts = 0;
    const pollInterval = setInterval(async () => {
      attempts++;
      const isOnline = await checkTTSStatus();
      if (isOnline) {
        if (iframe) iframe.src = 'http://localhost:8001?t=' + Date.now();
        if (launchOfflineBtn) {
          launchOfflineBtn.textContent = '🚀 Launch Chatterbox Server (Port 8001)';
          (launchOfflineBtn as HTMLButtonElement).disabled = false;
        }
        clearInterval(pollInterval);
      } else if (attempts >= 40) {
        if (launchOfflineBtn) {
          launchOfflineBtn.textContent = '🚀 Launch Chatterbox Server (Port 8001)';
          (launchOfflineBtn as HTMLButtonElement).disabled = false;
        }
        clearInterval(pollInterval);
      }
    }, 1500);
  }

  if (startBtn) {
    startBtn.addEventListener('click', startTTSServer);
  }
  if (launchOfflineBtn) {
    launchOfflineBtn.addEventListener('click', startTTSServer);
  }

  checkTTSStatus();

  setInterval(() => {
    checkTTSStatus();
  }, 4000);
}

function initVideoStudio() {
  const aspectSelect = $<HTMLSelectElement>('#ae-aspect-ratio');
  const stageBox = $('#ae-comp-stage-box');
  const stageBadge = $('#ae-stage-badge');
  const previewCanvas = $<HTMLCanvasElement>('#ae-preview-canvas');
  const infoRes = $('#ae-info-res');
  const timecodeDisplay = $('#ae-timecode-display');
  const playBtn = $('#ae-btn-play');
  const playIcon = $('#ae-play-icon');
  const exportBtn = $('#ae-btn-export');
  const playheadLine = $<HTMLElement>('#ae-playhead-line');
  const toolBtns = $$('.ae-tool-btn');
  // Header + Add Track Popup Handler
  const addTrackHeaderBtn = $<HTMLElement>('#ae-header-btn-add-track');
  const addTrackPopup = $<HTMLElement>('#ae-add-track-popup');
  if (addTrackHeaderBtn && addTrackPopup) {
    addTrackHeaderBtn.onclick = (e) => {
      e.stopPropagation();
      addTrackPopup.style.display = addTrackPopup.style.display === 'none' ? 'block' : 'none';
    };

    window.addEventListener('click', () => {
      addTrackPopup.style.display = 'none';
    });

    addTrackPopup.querySelectorAll<HTMLElement>('.ae-add-track-item').forEach((item) => {
      item.onclick = (e) => {
        e.stopPropagation();
        const trackType = item.getAttribute('data-type') as 'video' | 'audio';
        const isAudio = trackType === 'audio';

        const existingCount = activeTimeline.tracks.filter((t: any) => t.type === trackType).length;
        const newTrack = {
          id: Date.now(),
          name: isAudio ? `A${existingCount + 1} · Audio Track` : `V${existingCount + 1} · Video Track`,
          type: trackType,
          muted: false,
          solo: false,
          locked: false,
        };

        if (isAudio) {
          activeTimeline.tracks.push(newTrack);
        } else {
          const lastVideoIdx = activeTimeline.tracks.map((t: any) => t.type).lastIndexOf('video');
          if (lastVideoIdx >= 0) {
            activeTimeline.tracks.splice(lastVideoIdx + 1, 0, newTrack);
          } else {
            activeTimeline.tracks.unshift(newTrack);
          }
        }

        addTrackPopup.style.display = 'none';
        persistTimelineState();
        renderTimeline();
      };
    });
  }

  // Video State & Timeline Data
  let pxPerSec = 15; // 15px per second on timeline ruler (Compact zoom scale)
  let isPlaying = false;
  let playheadTime = 0.0; // in seconds
  let timelineDuration = 30.0;
  let activeTool: 'select' | 'split' | 'hand' | 'zoom' = 'select';
  let animationFrameId: number | null = null;
  let selectedClipId: string | null = 'clip-1';
  let clipboardClip: any = null;

  function extractAudioFromVideoClip(clipId: string) {
    const targetClip = activeTimeline.clips.find((c) => c.id === clipId);
    if (!targetClip || targetClip.media_type !== 'video') return;

    pushUndoState();
    targetClip.is_muted = true;

    let audioTrackObj = activeTimeline.tracks.find((t: any) => t.type === 'audio');
    if (!audioTrackObj) {
      audioTrackObj = {
        id: Date.now(),
        name: `A${activeTimeline.tracks.filter((t: any) => t.type === 'audio').length + 1} · Dialogue & Audio`,
        type: 'audio',
        muted: false,
        solo: false,
        locked: false,
      };
      activeTimeline.tracks.push(audioTrackObj);
    }

    const extractedAudioClip = {
      id: 'clip-extracted-' + Date.now(),
      name: `${targetClip.name} (Extracted Audio)`,
      src: targetClip.src,
      media_type: 'audio',
      start_time: targetClip.start_time,
      duration: targetClip.duration,
      in_point: targetClip.in_point || 0.0,
      out_point: targetClip.out_point || targetClip.duration,
      track_id: audioTrackObj.id,
      volume_db: 0.0,
      keyframes: [],
    };

    activeTimeline.clips.push(extractedAudioClip);
    selectedClipId = extractedAudioClip.id;

    persistTimelineState();
    renderTimeline();
    drawCompositionGuide();
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

  // Undo / Redo History Stack Engine
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let engineEventQueue: Promise<void> = Promise.resolve();

  function pushUndoState() {
    undoStack.push(JSON.stringify(activeTimeline));
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

  // HTML5 Media Element Cache for Real-Time Canvas Video Playback
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
      // Instantly update offscreen frame cache when frame seek finishes cleanly!
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

  // Explicit Track Configuration (CapCut Desktop Track Icons & Styles)
  const TRACK_DEFS = [
    { id: 1, key: 'v2', name: 'V2 Text & Overlays', type: 'video', icon: 'ph-text-t', color: 'rgba(139, 92, 246, 0.35)', border: '#8b5cf6', iconBg: 'rgba(139, 92, 246, 0.2)' },
    { id: 2, key: 'v1', name: 'V1 Main Video', type: 'video', icon: 'ph-video-camera', color: 'rgba(0, 180, 216, 0.35)', border: '#00b4d8', iconBg: 'rgba(0, 180, 216, 0.2)' },
    { id: 3, key: 'a1', name: 'A1 Voiceover', type: 'audio', icon: 'ph-microphone', color: 'rgba(16, 185, 129, 0.35)', border: '#10b981', iconBg: 'rgba(16, 185, 129, 0.2)' },
    { id: 4, key: 'a2', name: 'A2 Background Music', type: 'audio', icon: 'ph-music-notes', color: 'rgba(5, 150, 105, 0.35)', border: '#059669', iconBg: 'rgba(5, 150, 105, 0.2)' },
    { id: 5, key: 'fx', name: 'FX Color Adjustments', type: 'effect', icon: 'ph-sparkle', color: 'rgba(245, 158, 11, 0.35)', border: '#f59e0b', iconBg: 'rgba(245, 158, 11, 0.2)' },
  ];

  // Sync timeline from FastAPI backend
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

  // Save timeline state to FastAPI backend (debounced with client state authority)
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

    if (pinEl) {
      pinEl.style.left = `${pinLeftPx}px`;
    }
    if (lineEl) {
      lineEl.style.left = `${pinLeftPx}px`;
    }
    if (tcEl) {
      tcEl.textContent = formatFullTimecode(playheadTime);
    }
  }

  function formatShortTimecode(seconds: number): string {
    const s = Math.floor(seconds);
    const ms = Math.floor((seconds - s) * 30);
    return `${String(s).padStart(2, '0')}:${String(ms).padStart(2, '0')}`;
  }

  function formatFullTimecode(seconds: number): string {
    const totalMs = Math.floor(seconds * 1000);
    const hrs = Math.floor(totalMs / 3600000);
    const mins = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const frames = Math.floor(((totalMs % 1000) / 1000) * 30);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  }

  function renderMediaPoolList() {
    const listEl = $('#ae-media-pool-list');
    if (!listEl) return;

    if (!activeTimeline.clips || activeTimeline.clips.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 24px 12px; text-align: center; color: #71717a; font-size: 0.72rem;">
          <i class="ph-bold ph-folder-open" style="font-size: 1.8rem; display: block; margin-bottom: 8px; color: #3f3f46;"></i>
          <span>No media assets imported yet.<br>Click <strong>+ Import</strong> to add files.</span>
        </div>
      `;
      return;
    }

    let html = '';
    activeTimeline.clips.forEach((clip) => {
      const isVideo = clip.media_type === 'video';
      const icon = isVideo ? 'ph-video-camera' : 'ph-waveform';
      const iconColor = isVideo ? '#00b4d8' : '#10b981';

      html += `
        <div class="ae-media-card" style="background: #121215; border: 1px solid #242430; border-radius: 6px; padding: 8px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
          <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
            <div style="width: 26px; height: 26px; background: #1a1a22; border: 1px solid ${iconColor}; border-radius: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i class="ph-bold ${icon}" style="color: ${iconColor}; font-size: 0.85rem;"></i>
            </div>
            <div style="display: flex; flex-direction: column; overflow: hidden;">
              <span style="font-size: 0.72rem; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(clip.name)}</span>
              <span style="font-size: 0.64rem; color: #71717a;">${clip.duration.toFixed(1)}s • ${clip.media_type.toUpperCase()}</span>
            </div>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
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

  // Render Left Layer Panel & Right Track Canvas (CapCut Desktop Layout)
  function renderTimeline() {
    renderMediaPool();

    // 1. Sanitize & Enforce Track Hierarchy: V1 (video) first, A1 (audio) second
    if (!activeTimeline.tracks || activeTimeline.tracks.length === 0) {
      activeTimeline.tracks = [
        { id: 1, name: 'V1 · Main Video Footage', type: 'video', muted: false, solo: false, locked: false },
        { id: 2, name: 'A1 · Dialogue & Audio', type: 'audio', muted: false, solo: false, locked: false },
      ];
    } else {
      const vTracks = activeTimeline.tracks.filter((t: any) => t.type === 'video');
      const aTracks = activeTimeline.tracks.filter((t: any) => t.type === 'audio');

      if (vTracks.length === 0) {
        vTracks.push({ id: 1, name: 'V1 · Main Video Footage', type: 'video', muted: false, solo: false, locked: false });
      }
      if (aTracks.length === 0) {
        aTracks.push({ id: 2, name: 'A1 · Dialogue & Audio', type: 'audio', muted: false, solo: false, locked: false });
      }

      vTracks.forEach((vt: any, i: number) => {
        vt.name = `V${i + 1} · Video Track`;
      });
      aTracks.forEach((at: any, i: number) => {
        at.name = `A${i + 1} · Audio Track`;
      });

      activeTimeline.tracks = [...vTracks, ...aTracks];
    }

    // 2. Dynamic Timeline Duration: Extend timeline ruler dynamically based on max clip end time
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

    // 3. Render Time Ruler Ticks dynamically with generous 90px label spacing
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

    // CapCut-style Playhead: Inverted white triangle pin at top + vertical white scrubber line (NO timecode text on pin!)
    rulerHTML += `
      <div id="ae-playhead-pin" style="position: absolute; left: ${pinLeftPx - 7}px; top: 2px; width: 14px; height: 16px; cursor: pointer; z-index: 30;" title="CapCut Playhead (${playheadTime.toFixed(2)}s)">
        <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
          <path d="M0 0 H14 V10 L7 16 L0 10 Z" fill="#ffffff" stroke="#111827" stroke-width="1.2"/>
        </svg>
      </div>
    `;

    rulerEl.innerHTML = rulerHTML;

    // 4. Render Left CapCut Layer Panel (Compact V1, A1 Row Control Boxes)
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

    // Attach Layer Row Click & Delete Listeners
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

    // 5. Render Right Track Canvas Lanes with CapCut Filmstrip & Waveforms
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

    // Render Clips in CapCut Desktop style (matching Screenshot 2)
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

      // CapCut Audio Waveform SVG Pattern
      let waveSVG = '';
      if (clip.media_type === 'audio') {
        waveSVG = `
          <svg style="position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.6; pointer-events: none;" preserveAspectRatio="none" viewBox="0 0 100 28">
            <path d="M 0 14 Q 5 4, 10 14 T 20 14 T 30 4 T 40 24 T 50 14 T 60 4 T 70 24 T 80 14 T 90 4 T 100 14 L 100 28 L 0 28 Z" fill="#10b981" />
          </svg>
        `;
      }

      // CapCut Video Filmstrip Pattern
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

    // Attach Keyframe Node Click Listener to open Keyframe Settings Box in Inspector
    trackCanvasEl.querySelectorAll('.ae-kf-node').forEach((node) => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const clipId = node.getAttribute('data-clip-id');
        const kfIdx = parseInt(node.getAttribute('data-kf-idx') || '0', 10);
        if (clipId) openKeyframeInspector(clipId, kfIdx);
      });
    });

    // Synchronize horizontal scrolling so ruler and canvas tracks match
    trackCanvasEl.addEventListener('scroll', () => {
      rulerEl.scrollLeft = trackCanvasEl.scrollLeft;
    });
    rulerEl.addEventListener('scroll', () => {
      trackCanvasEl.scrollLeft = rulerEl.scrollLeft;
    });

    // Attach Listeners
    attachClipDragListeners();
    attachTrackCanvasDropListener();
    attachPlayheadPinDragListener();
  }

  function attachPlayheadPinDragListener() {
    const pinEl = $<HTMLElement>('#ae-playhead-pin');
    const trackCanvasEl = $<HTMLElement>('#ae-track-canvas');
    if (!pinEl || !trackCanvasEl) return;

    pinEl.addEventListener('mousedown', (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      if (isPlaying) {
        pausePlayback();
      }

      let isScrubbingAnimationFrame = false;

      const onMove = (moveEvt: MouseEvent) => {
        const rect = trackCanvasEl.getBoundingClientRect();
        const scrollLeft = trackCanvasEl.scrollLeft || 0;
        const mouseX = moveEvt.clientX - rect.left + scrollLeft - 36;
        playheadTime = Math.max(0, Math.min(mouseX / pxPerSec, timelineDuration));

        updatePlayheadUI();

        if (!isScrubbingAnimationFrame) {
          isScrubbingAnimationFrame = true;
          requestAnimationFrame(() => {
            drawCompositionGuide();
            isScrubbingAnimationFrame = false;
          });
        }
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  let isDropListenerAttached = false;
  function attachTrackCanvasDropListener() {
    if (isDropListenerAttached) return;
    const trackCanvasEl = $('#ae-track-canvas');
    if (!trackCanvasEl) return;

    isDropListenerAttached = true;
    trackCanvasEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    trackCanvasEl.addEventListener('drop', (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const dragEvt = e as DragEvent;
      const rawData = dragEvt.dataTransfer?.getData('text/plain');
      if (!rawData) return;

      try {
        const asset = JSON.parse(rawData);
        const rect = trackCanvasEl.getBoundingClientRect();
        const scrollLeft = trackCanvasEl.scrollLeft || 0;
        const dropX = dragEvt.clientX - rect.left + scrollLeft;
        const dropY = dragEvt.clientY - rect.top;

        let dropTime = Math.max(0, dropX / pxPerSec);

        const targetTrackIdx = Math.max(0, Math.floor(dropY / 36));
        const isAudio = asset.type === 'audio';
        let targetTrackObj: any = null;

        if (isAudio) {
          const audioTracks = activeTimeline.tracks.filter((t: any) => t.type === 'audio');
          const matched = activeTimeline.tracks[targetTrackIdx];
          targetTrackObj = (matched && matched.type === 'audio') ? matched : (audioTracks[0] || activeTimeline.tracks.find((t: any) => t.type === 'audio'));
        } else {
          // Video / Image assets MUST land on a Video Track!
          const videoTracks = activeTimeline.tracks.filter((t: any) => t.type === 'video');
          const matched = activeTimeline.tracks[targetTrackIdx];
          targetTrackObj = (matched && matched.type === 'video') ? matched : (videoTracks[0] || activeTimeline.tracks.find((t: any) => t.type === 'video'));
        }

        if (!targetTrackObj) {
          targetTrackObj = {
            id: Date.now(),
            name: isAudio ? 'A1 · Dialogue & Audio' : 'V1 · Main Video Footage',
            type: isAudio ? 'audio' : 'video',
            muted: false,
            solo: false,
            locked: false,
          };
          activeTimeline.tracks.push(targetTrackObj);
        }

        // Calculate drop start time: fit at 0.0s for first clip or dropped near start
        const existingTrackClips = (activeTimeline.clips || []).filter((c: any) => String(c.track_id) === String(targetTrackObj.id));
        let finalDropTime = 0.0;
        if (existingTrackClips.length === 0) {
          finalDropTime = 0.0;
        } else {
          const rawDropTime = Math.max(0, dropX / pxPerSec);
          if (rawDropTime < 3.0) {
            finalDropTime = 0.0;
          } else {
            const maxEnd = Math.max(...existingTrackClips.map((c: any) => c.start_time + c.duration));
            finalDropTime = maxEnd;
          }
        }

        const sourceDuration = asset.type === 'image' ? 5.0 : Math.max(0.1, Number(asset.duration || 12.0));

        pushUndoState();
        const newClip = {
          id: 'clip-' + Date.now(),
          name: asset.name,
          src: asset.url,
          media_type: asset.type,
          start_time: finalDropTime,
          duration: sourceDuration,
          in_point: 0.0,
          out_point: sourceDuration,
          track_id: targetTrackObj.id,
          transform: { position_x: 0, position_y: 0, position_z: 0, scale_x: 100, scale_y: 100, rotation: 0, opacity: 100 },
          color_grading: { exposure: 0, contrast: 100, saturation: 100, temperature: 0 },
          keyframes: [],
          volume_db: 0.0,
          is_muted: false,
        };

        activeTimeline.clips.push(newClip);
        selectedClipId = newClip.id;
        persistTimelineState();
        renderTimeline();
        drawCompositionGuide();
      } catch (err) {
        console.warn('Drop asset parse error:', err);
      }
    });
  }

  function attachClipDragListeners() {
    const trackCanvas = $('#ae-track-canvas');
    if (!trackCanvas) return;

    trackCanvas.querySelectorAll<HTMLElement>('.ae-clip-bar').forEach((bar) => {
      const clipId = bar.getAttribute('data-clip-id');
      const clip = activeTimeline.clips.find((c) => c.id === clipId);
      if (!clip) return;

      // Right-Click Context Menu Handler on Clips
      bar.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedClipId = clip.id;
        renderTimeline();
        updateInspectorForSelectedClip();

        const ctxMenu = $<HTMLElement>('#ae-clip-context-menu');
        if (ctxMenu) {
          ctxMenu.style.display = 'block';

          const menuHeight = ctxMenu.offsetHeight || 420;
          const menuWidth = ctxMenu.offsetWidth || 230;

          let topPx = e.clientY;
          if (e.clientY + menuHeight > window.innerHeight) {
            topPx = Math.max(10, e.clientY - menuHeight);
          }

          let leftPx = e.clientX;
          if (e.clientX + menuWidth > window.innerWidth) {
            leftPx = Math.max(10, e.clientX - menuWidth);
          }

          ctxMenu.style.top = `${topPx}px`;
          ctxMenu.style.left = `${leftPx}px`;

          const copyBtn = $<HTMLElement>('#ae-ctx-copy');
          const cutBtn = $<HTMLElement>('#ae-ctx-cut');
          const deleteBtn = $<HTMLElement>('#ae-ctx-delete');
          const splitBtn = $<HTMLElement>('#ae-ctx-split');
          const extractAudioBtn = $<HTMLElement>('#ae-ctx-extract-audio');
          const adjustColorBtn = $<HTMLElement>('#ae-ctx-adjust-color');
          const deactivateBtn = $<HTMLElement>('#ae-ctx-deactivate');

          const closeMenu = () => {
            ctxMenu.style.display = 'none';
            window.removeEventListener('click', closeMenu);
          };
          window.addEventListener('click', closeMenu);

          if (copyBtn) {
            copyBtn.onclick = () => {
              clipboardClip = JSON.parse(JSON.stringify(clip));
              closeMenu();
            };
          }

          if (cutBtn) {
            cutBtn.onclick = () => {
              clipboardClip = JSON.parse(JSON.stringify(clip));
              activeTimeline.clips = activeTimeline.clips.filter((c: any) => c.id !== clip.id);
              if (selectedClipId === clip.id) selectedClipId = activeTimeline.clips[0]?.id || null;
              persistTimelineState();
              renderTimeline();
              drawCompositionGuide();
              closeMenu();
            };
          }

          if (deleteBtn) {
            deleteBtn.onclick = () => {
              deleteClipById(clip.id);
              closeMenu();
            };
          }

          if (splitBtn) {
            splitBtn.onclick = () => {
              const splitOffset = playheadTime - clip.start_time;
              if (splitOffset > 0.5 && splitOffset < clip.duration - 0.5) {
                const oldDuration = clip.duration;
                clip.duration = splitOffset;

                const newClip = JSON.parse(JSON.stringify(clip));
                newClip.id = 'clip-' + Date.now();
                newClip.name = clip.name + ' (Cut)';
                newClip.start_time = clip.start_time + splitOffset;
                newClip.duration = oldDuration - splitOffset;

                activeTimeline.clips.push(newClip);
                persistTimelineState();
                renderTimeline();
                drawCompositionGuide();
              }
              closeMenu();
            };
          }

          if (extractAudioBtn) {
            const isVideo = clip.media_type === 'video';
            extractAudioBtn.classList.toggle('disabled', !isVideo);
            if (isVideo) {
              extractAudioBtn.onclick = () => {
                extractAudioFromVideoClip(clip.id);
                closeMenu();
              };
            }
          }

          if (adjustColorBtn) {
            adjustColorBtn.onclick = () => {
              switchInspectorTab('lumetri');
              closeMenu();
            };
          }

          if (deactivateBtn) {
            deactivateBtn.onclick = () => {
              clip.is_muted = !clip.is_muted;
              persistTimelineState();
              renderTimeline();
              drawCompositionGuide();
              closeMenu();
            };
          }
        }
      });

      // Click & Drag Handlers
      bar.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Ignore right-clicks for dragging
        const target = e.target as HTMLElement;

        if (activeTool === 'split') {
          e.stopPropagation();
          const splitOffset = playheadTime - clip.start_time;
          if (splitOffset > 0.5 && splitOffset < clip.duration - 0.5) {
            const oldDuration = clip.duration;
            clip.duration = splitOffset;

            const newClip = JSON.parse(JSON.stringify(clip));
            newClip.id = 'clip-' + Date.now();
            newClip.name = clip.name + ' (Cut)';
            newClip.start_time = clip.start_time + splitOffset;
            newClip.duration = oldDuration - splitOffset;

            activeTimeline.clips.push(newClip);
            persistTimelineState();
            renderTimeline();
          }
          return;
        }

        selectedClipId = clip.id;
        updateInspectorForSelectedClip();

        const TRACK_HEADER_WIDTH = 36;

        // 1. Left Edge Trim
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

        // 2. Right Edge Trim
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

        // 3. Move Clip Position Freely (Horizontally & Vertically Across Tracks)
        let initialX = e.clientX;
        let initialStart = clip.start_time;

        pushUndoState();

        const onMove = (mEvt: MouseEvent) => {
          const deltaSec = (mEvt.clientX - initialX) / pxPerSec;
          let newStart = Math.max(0, initialStart + deltaSec);

          if (newStart < 0.15) {
            newStart = 0.0;
          }

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

          // Direct DOM style manipulation for 60fps zero-lag drag!
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

  // CapCut Editing Action Tool Handlers (100% Functional Engine)
  function splitClipAtPlayhead() {
    const targetClip = activeTimeline.clips.find((c) => c.id === selectedClipId) ||
                       activeTimeline.clips.find((c) => playheadTime >= c.start_time && playheadTime <= (c.start_time + c.duration));
    if (!targetClip) return;

    const splitTimeInClip = playheadTime - targetClip.start_time;
    if (splitTimeInClip <= 0.2 || splitTimeInClip >= targetClip.duration - 0.2) return;

    const duration1 = splitTimeInClip;
    const duration2 = targetClip.duration - splitTimeInClip;

    targetClip.duration = duration1;

    const clip2Id = `clip_${Date.now()}`;
    const newClip: any = {
      ...JSON.parse(JSON.stringify(targetClip)),
      id: clip2Id,
      name: `${targetClip.name} (Part 2)`,
      start_time: playheadTime,
      duration: duration2,
      in_point: (targetClip.in_point || 0) + splitTimeInClip,
    };

    activeTimeline.clips.push(newClip);
    selectedClipId = clip2Id;

    persistTimelineState();
    renderTimeline();
    drawCompositionGuide();
  }

  function splitLeftAtPlayhead() {
    const targetClip = activeTimeline.clips.find((c) => c.id === selectedClipId) ||
                       activeTimeline.clips.find((c) => playheadTime >= c.start_time && playheadTime <= (c.start_time + c.duration));
    if (!targetClip) return;

    const splitTimeInClip = playheadTime - targetClip.start_time;
    if (splitTimeInClip <= 0.1 || splitTimeInClip >= targetClip.duration - 0.1) return;

    targetClip.start_time = playheadTime;
    targetClip.duration = targetClip.duration - splitTimeInClip;
    targetClip.in_point = (targetClip.in_point || 0) + splitTimeInClip;

    persistTimelineState();
    renderTimeline();
    drawCompositionGuide();
  }

  function splitRightAtPlayhead() {
    const targetClip = activeTimeline.clips.find((c) => c.id === selectedClipId) ||
                       activeTimeline.clips.find((c) => playheadTime >= c.start_time && playheadTime <= (c.start_time + c.duration));
    if (!targetClip) return;

    const splitTimeInClip = playheadTime - targetClip.start_time;
    if (splitTimeInClip <= 0.1 || splitTimeInClip >= targetClip.duration - 0.1) return;

    targetClip.duration = splitTimeInClip;

    persistTimelineState();
    renderTimeline();
    drawCompositionGuide();
  }

  function deleteSelectedClip() {
    if (!selectedClipId) return;
    activeTimeline.clips = activeTimeline.clips.filter((c) => c.id !== selectedClipId);
    selectedClipId = activeTimeline.clips[0]?.id || null;
    persistTimelineState();
    renderTimeline();
    drawCompositionGuide();
  }

  let selectedKfIdx: { clipId: string; kfIdx: number } | null = null;

  function addKeyframeAtPlayhead() {
    const targetClip = activeTimeline.clips.find((c) => c.id === selectedClipId);
    if (!targetClip) return;

    if (!targetClip.keyframes) targetClip.keyframes = [];

    const clipOffset = Math.max(0, Math.min(playheadTime - targetClip.start_time, targetClip.duration));
    const existingIdx = targetClip.keyframes.findIndex((kf: any) => {
      const off = kf.clip_offset_sec !== undefined ? kf.clip_offset_sec : Math.max(0, (kf.time_sec || 0) - targetClip.start_time);
      return Math.abs(off - clipOffset) < 0.15;
    });

    if (existingIdx >= 0) {
      targetClip.keyframes.splice(existingIdx, 1);
      selectedKfIdx = null;
    } else {
      const newKf = {
        clip_offset_sec: clipOffset,
        property: 'position_x',
        value: targetClip.transform?.position_x || 0,
        easing: 'linear' as const,
      };
      targetClip.keyframes.push(newKf);
      selectedKfIdx = { clipId: targetClip.id, kfIdx: targetClip.keyframes.length - 1 };
      openKeyframeInspector(targetClip.id, targetClip.keyframes.length - 1);
    }

    persistTimelineState();
    renderTimeline();
    updateInspectorForSelectedClip();
    drawCompositionGuide();
  }

  function openKeyframeInspector(clipId: string, kfIdx: number) {
    const clip = activeTimeline.clips.find((c) => c.id === clipId);
    if (!clip || !clip.keyframes || !clip.keyframes[kfIdx]) return;

    selectedClipId = clipId;
    selectedKfIdx = { clipId, kfIdx };

    const kfBox = $<HTMLElement>('#ae-keyframe-settings-box');
    const propNameEl = $('#ae-kf-prop-name');
    const valInput = $<HTMLInputElement>('#ae-kf-val-input');
    const easeBtns = $$('.kf-ease-btn');

    if (kfBox) kfBox.style.display = 'block';

    const kf = clip.keyframes[kfIdx];
    if (propNameEl) propNameEl.textContent = kf.property || 'position_x';
    if (valInput) valInput.value = String(kf.value !== undefined ? kf.value : 0);

    const currentEase = kf.easing || 'linear';
    easeBtns.forEach((btn) => {
      const ease = btn.getAttribute('data-ease');
      btn.classList.toggle('active', ease === currentEase);
    });

    renderTimeline();
  }

  function getInterpolatedClipValue(clip: any, property: string, defaultValue: number): number {
    if (!clip || !clip.keyframes || clip.keyframes.length === 0) return defaultValue;

    const kfs = clip.keyframes
      .filter((k: any) => k.property === property)
      .sort((a: any, b: any) => {
        const offA = a.clip_offset_sec !== undefined ? a.clip_offset_sec : Math.max(0, (a.time_sec || 0) - clip.start_time);
        const offB = b.clip_offset_sec !== undefined ? b.clip_offset_sec : Math.max(0, (b.time_sec || 0) - clip.start_time);
        return offA - offB;
      });

    if (kfs.length === 0) return defaultValue;

    const clipTime = Math.max(0, playheadTime - clip.start_time);

    const getOffset = (k: any) => k.clip_offset_sec !== undefined ? k.clip_offset_sec : Math.max(0, (k.time_sec || 0) - clip.start_time);

    if (clipTime <= getOffset(kfs[0])) return kfs[0].value;
    if (clipTime >= getOffset(kfs[kfs.length - 1])) return kfs[kfs.length - 1].value;

    for (let i = 0; i < kfs.length - 1; i++) {
      const kf1 = kfs[i];
      const kf2 = kfs[i + 1];
      const t1 = getOffset(kf1);
      const t2 = getOffset(kf2);

      if (clipTime >= t1 && clipTime <= t2) {
        const duration = t2 - t1;
        if (duration <= 0) return kf1.value;

        const t = (clipTime - t1) / duration;
        const easing = kf1.easing || 'linear';

        if (easing === 'hold') {
          return t >= 1.0 ? kf2.value : kf1.value;
        } else if (easing === 'ease') {
          const smoothT = t * t * (3 - 2 * t);
          return kf1.value + (kf2.value - kf1.value) * smoothT;
        } else {
          return kf1.value + (kf2.value - kf1.value) * t;
        }
      }
    }

    return defaultValue;
  }

  function initCapCutToolbarEvents() {
    $('#ae-capcut-btn-split')?.addEventListener('click', splitClipAtPlayhead);
    $('#ae-capcut-btn-split-left')?.addEventListener('click', splitLeftAtPlayhead);
    $('#ae-capcut-btn-split-right')?.addEventListener('click', splitRightAtPlayhead);
    $('#ae-capcut-btn-delete')?.addEventListener('click', deleteSelectedClip);
    $('#ae-capcut-btn-keyframe')?.addEventListener('click', addKeyframeAtPlayhead);

    // NOTE: Import file listener is handled in the unified media pool section below (line ~4689).
    // Do NOT attach a second 'change' listener here — it causes duplicate clip creation + conflicts.

    // Bind Undo / Redo & Cut Left / Right Buttons
    $('#ae-capcut-btn-undo')?.addEventListener('click', undoAction);
    $('#ae-capcut-btn-redo')?.addEventListener('click', redoAction);
    $('#ae-capcut-btn-split-left')?.addEventListener('click', splitLeftAtPlayhead);
    $('#ae-capcut-btn-split-right')?.addEventListener('click', splitRightAtPlayhead);

    const zoomSlider = $<HTMLInputElement>('#ae-capcut-zoom-slider');
    if (zoomSlider) {
      zoomSlider.value = String(pxPerSec);
      zoomSlider.addEventListener('input', () => {
        pxPerSec = Math.max(2, parseFloat(zoomSlider.value));
        renderTimeline();
      });
    }

    $('#ae-capcut-btn-zoom-out')?.addEventListener('click', () => {
      if (zoomSlider) {
        zoomSlider.value = String(Math.max(2, parseFloat(zoomSlider.value) - 5));
        pxPerSec = parseFloat(zoomSlider.value);
        renderTimeline();
      }
    });

    $('#ae-capcut-btn-zoom-in')?.addEventListener('click', () => {
      if (zoomSlider) {
        zoomSlider.value = String(Math.min(100, parseFloat(zoomSlider.value) + 5));
        pxPerSec = parseFloat(zoomSlider.value);
        renderTimeline();
      }
    });

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoAction();
      } else if (e.key === 'b' || e.key === 'B') {
        splitClipAtPlayhead();
      } else if (e.key === '[') {
        splitLeftAtPlayhead();
      } else if (e.key === ']') {
        splitRightAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedClip();
      }
    });
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

  // Scrubber Dragging on Time Ruler & Track Canvas
  const timeRuler = $<HTMLElement>('#ae-time-ruler');
  const trackCanvas = $<HTMLElement>('#ae-track-canvas');

  function scrubPlayheadToMouse(e: MouseEvent, container: HTMLElement) {
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft || 0;
    const mouseX = e.clientX - rect.left + scrollLeft - 36;
    playheadTime = Math.max(0, Math.min(mouseX / pxPerSec, timelineDuration));

    updatePlayheadUI();
    drawCompositionGuide();
  }

  if (timeRuler) {
    let isScrubbing = false;
    timeRuler.addEventListener('mousedown', (e: MouseEvent) => {
      isScrubbing = true;
      if (isPlaying) {
        pausePlayback();
      }
      scrubPlayheadToMouse(e, timeRuler);

      const onMove = (mEvt: MouseEvent) => {
        if (isScrubbing) scrubPlayheadToMouse(mEvt, timeRuler);
      };
      const onUp = () => {
        isScrubbing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  // 1. Tool Selection Handlers
  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const title = btn.getAttribute('title') || '';
      if (title.includes('Selection')) activeTool = 'select';
      else if (title.includes('Orbit') || title.includes('Razor') || title.includes('Camera')) activeTool = 'split';
    });
  });

  // 2. Playhead & Timecode Formatter
  function formatTimecode(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hrs)};${pad(mins)};${pad(secs)};${pad(frames)}`;
  }

  function pausePlayback() {
    isPlaying = false;
    if (playIcon) {
      playIcon.className = 'ph-bold ph-play';
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    videoMediaCache.forEach((video) => {
      if (!video.paused) video.pause();
    });
    audioMediaCache.forEach((audio) => {
      if (!audio.paused) audio.pause();
    });
  }

  function togglePlayPause() {
    if (isPlaying) {
      pausePlayback();
    } else {
      isPlaying = true;
      if (playIcon) {
        playIcon.className = 'ph-bold ph-pause';
      }
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

  if (playBtn) {
    playBtn.addEventListener('click', togglePlayPause);
  }

  // Initialize CapCut Desktop Timeline Toolbar Events
  initCapCutToolbarEvents();

  // Add Track Header Popup Controls (+ Icon above V1)
  const btnAddTrackHeader = $('#ae-header-btn-add-track');
  const popupAddTrack = $<HTMLElement>('#ae-add-track-popup');

  if (btnAddTrackHeader && popupAddTrack) {
    btnAddTrackHeader.addEventListener('click', (e) => {
      e.stopPropagation();
      popupAddTrack.style.display = popupAddTrack.style.display === 'block' ? 'none' : 'block';
    });

    window.addEventListener('click', () => {
      popupAddTrack.style.display = 'none';
    });

    popupAddTrack.querySelectorAll('.ae-add-track-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackType = item.getAttribute('data-type') || 'video';
        const existingSameType = activeTimeline.tracks.filter((t: any) => t.type === trackType);
        const newNum = existingSameType.length + 1;
        const prefix = trackType === 'video' ? 'V' : 'A';
        const newTrackName = `${prefix}${newNum} · ${trackType === 'video' ? 'Video Track' : 'Audio Track'}`;

        const newTrack = {
          id: Date.now(),
          name: newTrackName,
          type: trackType,
          muted: false,
          solo: false,
          locked: false,
        };

        activeTimeline.tracks.push(newTrack);
        persistTimelineState();
        renderTimeline();
        drawCompositionGuide();
        popupAddTrack.style.display = 'none';
      });
    });
  }

  // Keyframe Settings Inspector Panel Event Handlers
  const kfValInput = $<HTMLInputElement>('#ae-kf-val-input');
  const btnDeleteKf = $('#ae-btn-delete-kf');
  const kfEaseBtns = $$('.kf-ease-btn');

  if (kfValInput) {
    kfValInput.addEventListener('input', () => {
      if (!selectedKfIdx) return;
      const clip = activeTimeline.clips.find((c) => c.id === selectedKfIdx?.clipId);
      if (clip && clip.keyframes && clip.keyframes[selectedKfIdx.kfIdx]) {
        clip.keyframes[selectedKfIdx.kfIdx].value = parseFloat(kfValInput.value) || 0;
        persistTimelineState();
        drawCompositionGuide();
      }
    });
  }

  if (btnDeleteKf) {
    btnDeleteKf.addEventListener('click', () => {
      if (!selectedKfIdx) return;
      const clip = activeTimeline.clips.find((c) => c.id === selectedKfIdx?.clipId);
      if (clip && clip.keyframes && clip.keyframes[selectedKfIdx.kfIdx]) {
        clip.keyframes.splice(selectedKfIdx.kfIdx, 1);
        selectedKfIdx = null;
        const kfBox = $<HTMLElement>('#ae-keyframe-settings-box');
        if (kfBox) kfBox.style.display = 'none';
        persistTimelineState();
        renderTimeline();
        drawCompositionGuide();
      }
    });
  }

  kfEaseBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!selectedKfIdx) return;
      const clip = activeTimeline.clips.find((c) => c.id === selectedKfIdx?.clipId);
      if (clip && clip.keyframes && clip.keyframes[selectedKfIdx.kfIdx]) {
        const ease = (btn.getAttribute('data-ease') || 'linear') as 'linear' | 'ease' | 'hold';
        clip.keyframes[selectedKfIdx.kfIdx].easing = ease;
        kfEaseBtns.forEach((b) => b.classList.toggle('active', b === btn));
        persistTimelineState();
        renderTimeline();
        drawCompositionGuide();
      }
    });
  });
  // Sidebar Category Nav Tab Switcher (Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters)
  $$('#ae-sidebar-nav .ae-nav-item').forEach((navBtn) => {
    navBtn.addEventListener('click', () => {
      $$('#ae-sidebar-nav .ae-nav-item').forEach((b) => {
        b.classList.remove('active');
        (b as HTMLElement).style.background = 'transparent';
        (b as HTMLElement).style.borderColor = 'transparent';
        (b as HTMLElement).style.color = '#a1a1aa';
      });
      navBtn.classList.add('active');
      (navBtn as HTMLElement).style.background = '#1a1a22';
      (navBtn as HTMLElement).style.borderColor = '#00b4d8';
      (navBtn as HTMLElement).style.color = '#00b4d8';

      const tabCategory = navBtn.getAttribute('data-tab') || 'media';
      renderCategoryExplorer(tabCategory);
    });
  });

  function renderCategoryExplorer(category: string) {
    const listEl = $('#ae-media-pool-list');
    if (!listEl) return;

    if (category === 'text') {
      listEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-weight: 700; font-size: 0.72rem; color: #ffffff; margin-bottom: 4px;">Text Presets (V2 Track)</div>
          <button class="ae-preset-text-btn" data-text="Main Header Title" data-size="72" data-color="#ffffff" style="background: #121215; border: 1px solid #2d2d38; border-radius: 6px; padding: 10px; color: #ffffff; font-size: 0.85rem; font-weight: 800; cursor: pointer; text-align: left;">
            Aa Main Title
          </button>
          <button class="ae-preset-text-btn" data-text="Lower Third Subtitle" data-size="44" data-color="#00b4d8" style="background: #121215; border: 1px solid #00b4d8; border-radius: 6px; padding: 10px; color: #00b4d8; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-align: left;">
            Aa Cyan Subtitle
          </button>
          <button class="ae-preset-text-btn" data-text="Neon Glow Title" data-size="56" data-color="#f59e0b" style="background: #121215; border: 1px solid #f59e0b; border-radius: 6px; padding: 10px; color: #f59e0b; font-size: 0.8rem; font-weight: 700; cursor: pointer; text-align: left;">
            ✨ Neon Glow Text
          </button>
        </div>
      `;

      listEl.querySelectorAll('.ae-preset-text-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const txt = btn.getAttribute('data-text') || 'Preset Title';
          const sz = parseInt(btn.getAttribute('data-size') || '60', 10);
          const col = btn.getAttribute('data-color') || '#ffffff';
          addTextClipToTimeline(txt, sz, col);
        });
      });
    } else if (category === 'filters' || category === 'effects') {
      listEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-weight: 700; font-size: 0.72rem; color: #ffffff; margin-bottom: 4px;">Color Grading LUT Presets</div>
          <button class="ae-preset-lut-btn" data-lut="none" style="background: #121215; border: 1px solid #2d2d38; border-radius: 6px; padding: 8px; color: #ffffff; font-size: 0.74rem; cursor: pointer; text-align: left;">Standard Neutral</button>
          <button class="ae-preset-lut-btn" data-lut="vivid" style="background: #121215; border: 1px solid #00b4d8; border-radius: 6px; padding: 8px; color: #00b4d8; font-size: 0.74rem; cursor: pointer; text-align: left;">Vivid Cyan Boost</button>
          <button class="ae-preset-lut-btn" data-lut="cyberpunk" style="background: #121215; border: 1px solid #8b5cf6; border-radius: 6px; padding: 8px; color: #8b5cf6; font-size: 0.74rem; cursor: pointer; text-align: left;">Cyberpunk Neon</button>
          <button class="ae-preset-lut-btn" data-lut="vintage" style="background: #121215; border: 1px solid #f59e0b; border-radius: 6px; padding: 8px; color: #f59e0b; font-size: 0.74rem; cursor: pointer; text-align: left;">Vintage Warm Sepia</button>
          <button class="ae-preset-lut-btn" data-lut="bw" style="background: #121215; border: 1px solid #71717a; border-radius: 6px; padding: 8px; color: #d4d4d8; font-size: 0.74rem; cursor: pointer; text-align: left;">Monochrome B&W</button>
        </div>
      `;

      listEl.querySelectorAll('.ae-preset-lut-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const lut = btn.getAttribute('data-lut') || 'none';
          const lumPreset = $<HTMLSelectElement>('#lum-lut-preset');
          if (lumPreset) {
            lumPreset.value = lut;
            drawCompositionGuide();
          }
        });
      });
    } else {
      renderMediaPoolList();
    }
  }

  function addTextClipToTimeline(text: string, fontSize: number, color: string) {
    pushUndoState();

    const newClip = {
      id: 'clip-' + Date.now(),
      name: text,
      src: '',
      media_type: 'text',
      start_time: playheadTime,
      duration: 5.0,
      in_point: 0.0,
      out_point: 5.0,
      track_id: 1, // Track 1 is V2 Titles/Overlays
      transform: { position_x: 0, position_y: 0, position_z: 0, scale_x: 100, scale_y: 100, rotation: 0, opacity: 100 },
      color_grading: { exposure: 0, contrast: 100, saturation: 100, temperature: 0 },
      text_style: { text, font_size: fontSize, color, font_family: 'Outfit, sans-serif', align: 'center' },
      keyframes: [],
      volume_db: 0.0,
      is_muted: false,
    };

    activeTimeline.clips.push(newClip);
    selectedClipId = newClip.id;
    persistTimelineState();
    renderTimeline();
    updateInspectorForSelectedClip();
    drawCompositionGuide();
  }

  // Right Inspector Main Tab Switcher
  $$('#ae-panel-right .ae-right-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      $$('#ae-panel-right .ae-right-tab').forEach((b) => {
        b.classList.remove('active');
        (b as HTMLElement).style.background = 'transparent';
        (b as HTMLElement).style.color = '#a1a1aa';
      });
      tabBtn.classList.add('active');
      (tabBtn as HTMLElement).style.background = '#1c1c24';
      (tabBtn as HTMLElement).style.color = '#ffffff';

      const tabId = tabBtn.id;
      const paneTransform = $<HTMLElement>('#ae-pane-transform');
      const paneLumetri = $<HTMLElement>('#ae-pane-lumetri');
      const paneFx = $<HTMLElement>('#ae-pane-fx');

      if (paneTransform) paneTransform.style.display = tabId === 'ae-tab-transform' ? 'flex' : 'none';
      if (paneLumetri) paneLumetri.style.display = (tabId === 'ae-tab-lumetri' || tabId === 'ae-tab-audio') ? 'flex' : 'none';
      if (paneFx) paneFx.style.display = tabId === 'ae-tab-fx' ? 'flex' : 'none';
    });
  });

  // Keyboard Shortcuts (Spacebar Play/Pause, C Razor, V Select)
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
      return;
    }

    const videoPanel = $('#v-video');
    if (!videoPanel || !videoPanel.classList.contains('active')) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key === 'v' || e.key === 'V') {
      activeTool = 'select';
      toolBtns.forEach((b) => b.classList.toggle('active', (b.getAttribute('title') || '').includes('Selection')));
    } else if (e.key === 'c' || e.key === 'C') {
      activeTool = 'split';
      toolBtns.forEach((b) => b.classList.toggle('active', (b.getAttribute('title') || '').includes('Camera') || (b.getAttribute('title') || '').includes('Orbit')));
    }
  });

  // 3. Dynamic Composition Stage Aspect Ratio Switcher
  function updateCompositionStage() {
    if (!aspectSelect || !stageBox) return;
    const ratio = aspectSelect.value;
    stageBox.classList.remove('aspect-16-9', 'aspect-9-16', 'aspect-1-1');

    if (ratio === '9:16') {
      stageBox.classList.add('aspect-9-16');
      if (stageBadge) stageBadge.textContent = '1080 x 1920 • 9:16 SHORTS/REELS STAGE';
      if (infoRes) infoRes.textContent = '1080 x 1920 (9:16)';
      if (previewCanvas) {
        previewCanvas.width = 1080;
        previewCanvas.height = 1920;
      }
    } else if (ratio === '1:1') {
      stageBox.classList.add('aspect-1-1');
      if (stageBadge) stageBadge.textContent = '1080 x 1080 • 1:1 SQUARE STAGE';
      if (infoRes) infoRes.textContent = '1080 x 1080 (1:1)';
      if (previewCanvas) {
        previewCanvas.width = 1080;
        previewCanvas.height = 1080;
      }
    } else {
      stageBox.classList.add('aspect-16-9');
      if (stageBadge) stageBadge.textContent = '1920 x 1080 • 16:9 LANDSCAPE STAGE';
      if (infoRes) infoRes.textContent = '1920 x 1080 (16:9)';
      if (previewCanvas) {
        previewCanvas.width = 1920;
        previewCanvas.height = 1080;
      }
    }
    drawCompositionGuide();
  }

  // 2.5 Right Panel Inspector Tabs
  const tabTransform = $<HTMLElement>('#ae-tab-transform');
  const tabLumetri = $<HTMLElement>('#ae-tab-lumetri');
  const tabFx = $<HTMLElement>('#ae-tab-fx');

  const paneTransform = $<HTMLElement>('#ae-pane-transform');
  const paneLumetri = $<HTMLElement>('#ae-pane-lumetri');
  const paneFx = $<HTMLElement>('#ae-pane-fx');

  function switchInspectorTab(target: 'transform' | 'lumetri' | 'fx') {
    if (tabTransform) tabTransform.style.background = target === 'transform' ? '#1a1a1e' : 'transparent';
    if (tabTransform) tabTransform.style.color = target === 'transform' ? '#ffffff' : '#a1a1aa';
    if (tabLumetri) tabLumetri.style.background = target === 'lumetri' ? '#1a1a1e' : 'transparent';
    if (tabLumetri) tabLumetri.style.color = target === 'lumetri' ? '#ffffff' : '#a1a1aa';
    if (tabFx) tabFx.style.background = target === 'fx' ? '#1a1a1e' : 'transparent';
    if (tabFx) tabFx.style.color = target === 'fx' ? '#ffffff' : '#a1a1aa';

    if (paneTransform) paneTransform.style.display = target === 'transform' ? 'flex' : 'none';
    if (paneLumetri) paneLumetri.style.display = target === 'lumetri' ? 'flex' : 'none';
    if (paneFx) paneFx.style.display = target === 'fx' ? 'flex' : 'none';
  }

  tabTransform?.addEventListener('click', () => switchInspectorTab('transform'));
  tabLumetri?.addEventListener('click', () => switchInspectorTab('lumetri'));
  tabFx?.addEventListener('click', () => switchInspectorTab('fx'));

  // Transform & Lumetri Live Controls
  const inpScale = $<HTMLInputElement>('#ae-inp-scale');
  const valScale = $('#ae-val-scale');
  const inpRotation = $<HTMLInputElement>('#ae-inp-rotation');
  const valRotation = $('#ae-val-rotation');
  const inpOpacity = $<HTMLInputElement>('#ae-inp-opacity');
  const valOpacity = $('#ae-val-opacity');

  const lumExp = $<HTMLInputElement>('#lum-inp-exp');
  const lumValExp = $('#lum-val-exp');
  const lumContrast = $<HTMLInputElement>('#lum-inp-contrast');
  const lumValContrast = $('#lum-val-contrast');
  const lumSat = $<HTMLInputElement>('#lum-inp-sat');
  const lumValSat = $('#lum-val-sat');
  const lumPreset = $<HTMLSelectElement>('#lum-lut-preset');

  [inpScale, inpRotation, inpOpacity, lumExp, lumContrast, lumSat, lumPreset].forEach((ctrl) => {
    ctrl?.addEventListener('input', () => {
      if (valScale && inpScale) valScale.textContent = `${inpScale.value}%`;
      if (valRotation && inpRotation) valRotation.textContent = `${inpRotation.value}°`;
      if (valOpacity && inpOpacity) valOpacity.textContent = `${inpOpacity.value}%`;
      if (lumValExp && lumExp) lumValExp.textContent = lumExp.value;
      if (lumValContrast && lumContrast) lumValContrast.textContent = `${lumContrast.value}%`;
      if (lumValSat && lumSat) lumValSat.textContent = `${lumSat.value}%`;

      drawCompositionGuide();
    });
  });

  // Grid Toggle state
  let showGrid = false;
  const btnToggleGrid = $<HTMLElement>('#ae-btn-toggle-grid');
  if (btnToggleGrid) {
    btnToggleGrid.addEventListener('click', () => {
      showGrid = !showGrid;
      btnToggleGrid.style.color = showGrid ? '#3b82f6' : '#a1a1aa';
      btnToggleGrid.style.borderColor = showGrid ? '#3b82f6' : '#333';
      drawCompositionGuide();
    });
  }

  function drawCompositionGuide() {
    if (!previewCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;
    const w = previewCanvas.width;
    const h = previewCanvas.height;

    ctx.fillStyle = '#08080a';
    ctx.fillRect(0, 0, w, h);

    // Grid lines rendered ONLY IF showGrid is enabled
    if (showGrid) {
      ctx.strokeStyle = '#252530';
      ctx.lineWidth = 1;
      const step = 80;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    // Transform State
    const scale = (inpScale ? parseFloat(inpScale.value) : 100) / 100;
    const rotDeg = inpRotation ? parseFloat(inpRotation.value) : 0;
    const opacity = (inpOpacity ? parseFloat(inpOpacity.value) : 100) / 100;

    // Lumetri Filter state
    const expVal = lumExp ? parseFloat(lumExp.value) : 0;
    const contrastVal = lumContrast ? parseFloat(lumContrast.value) : 100;
    const satVal = lumSat ? parseFloat(lumSat.value) : 100;
    const lut = lumPreset ? lumPreset.value : 'none';

    ctx.save();
    ctx.globalAlpha = opacity;

    // Apply CSS Canvas Filter for Lumetri Grading
    let filterStr = `brightness(${100 + expVal * 25}%) contrast(${contrastVal}%) saturate(${satVal}%)`;
    if (lut === 'bw') filterStr += ' grayscale(100%)';
    else if (lut === 'cyberpunk') filterStr += ' hue-rotate(180deg) saturate(180%)';
    else if (lut === 'vintage') filterStr += ' sepia(50%) contrast(120%)';

    // Calculate total timeline duration dynamically from end of last clip
    let maxClipEnd = 20.0;
    (activeTimeline.clips || []).forEach((c: any) => {
      const end = (c.start_time || 0) + (c.duration || 0);
      if (end > maxClipEnd) maxClipEnd = end;
    });
    timelineDuration = maxClipEnd;

    // Render Active Timeline Clips on Stage Canvas
    const activeClips = activeTimeline.clips || [];
    if (activeClips.length > 0) {
      activeClips.forEach((clip: any) => {
        const isClipActive = playheadTime >= clip.start_time && playheadTime <= (clip.start_time + clip.duration);

        if (clip.media_type === 'text') {
          if (!isClipActive) return;

          const clipTransform = clip.transform || {};
          const posXVal = getInterpolatedClipValue(clip, 'position_x', clipTransform.position_x || 0);
          const posYVal = getInterpolatedClipValue(clip, 'position_y', clipTransform.position_y || 0);
          const scaleVal = getInterpolatedClipValue(clip, 'scale_x', clipTransform.scale_x || 100);
          const rotVal = getInterpolatedClipValue(clip, 'rotation', clipTransform.rotation || 0);
          const opacityVal = getInterpolatedClipValue(clip, 'opacity', clipTransform.opacity || 100);

          ctx.save();
          ctx.filter = filterStr;
          ctx.globalAlpha = (opacityVal / 100) * opacity;
          ctx.translate((w / 2) + posXVal, (h / 2) + posYVal);
          ctx.rotate(((rotVal + rotDeg) * Math.PI) / 180);
          ctx.scale((scaleVal / 100) * scale, (scaleVal / 100) * scale);

          ctx.font = `${clip.text_style?.font_size || 60}px ${clip.text_style?.font_family || 'sans-serif'}`;
          ctx.textAlign = (clip.text_style?.align as any) || 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = clip.text_style?.color || '#ffffff';
          ctx.fillText(clip.text_style?.text || clip.name || 'Sample Title', 0, 0);

          ctx.restore();
        }

        if (clip.media_type === 'video') {
          const video = getOrCreateVideoElement(clip.src);
          if (!isClipActive) {
            if (!video.paused) video.pause();
            return;
          }

          const clipTransform = clip.transform || {};
          const posXVal = getInterpolatedClipValue(clip, 'position_x', clipTransform.position_x || 0);
          const posYVal = getInterpolatedClipValue(clip, 'position_y', clipTransform.position_y || 0);
          const scaleVal = getInterpolatedClipValue(clip, 'scale_x', clipTransform.scale_x || 100);
          const rotVal = getInterpolatedClipValue(clip, 'rotation', clipTransform.rotation || 0);
          const opacityVal = getInterpolatedClipValue(clip, 'opacity', clipTransform.opacity || 100);

          const posX = (w / 2) + posXVal;
          const posY = (h / 2) + posYVal;
          const clipScale = ((scaleVal) / 100) * scale;
          const clipRot = rotVal + rotDeg;

          const mediaTime = (playheadTime - clip.start_time) + (clip.in_point || 0);

          ctx.save();
          ctx.globalAlpha = (opacityVal / 100) * opacity;
          ctx.translate(posX, posY);
          ctx.rotate((clipRot * Math.PI) / 180);
          ctx.scale(clipScale, clipScale);

          if (isPlaying) {
            video.muted = Boolean(clip.is_muted || clip.muted);
            video.volume = Math.min(1.0, Math.max(0.0, Math.pow(10, (clip.volume_db || 0) / 20)));

            if (video.paused) {
              if (Math.abs(video.currentTime - mediaTime) > 0.1) {
                video.currentTime = mediaTime;
              }
              video.play().catch(() => {});
            } else if (Math.abs(video.currentTime - mediaTime) > 0.3) {
              // Resync video element ONLY if it drifts significantly from JS RAF master clock
              video.currentTime = mediaTime;
            }
          } else {
            if (!video.paused) {
              video.pause();
            }
            if (Math.abs(video.currentTime - mediaTime) > 0.03 && !video.seeking) {
              if (typeof (video as any).fastSeek === 'function') {
                (video as any).fastSeek(mediaTime);
              } else {
                video.currentTime = mediaTime;
              }
            }
          }

          // Immutable Offscreen Frame Lock: Stage canvas ONLY draws offscreen cache!
          const offCanvas = getOrCreateVideoOffscreenCanvas(clip.src);
          const offCtx = offCanvas.getContext('2d');

          // While playing naturally, update offscreen cache continuously on every 60fps frame tick
          if (isPlaying && video.readyState >= 2 && !video.seeking) {
            try {
              if (offCtx) offCtx.drawImage(video, 0, 0, 1920, 1080);
            } catch (e) {}
          }

          // Stage canvas ALWAYS draws offscreenCacheCanvas (Zero blackout guarantee!)
          try {
            ctx.drawImage(offCanvas, -w / 2, -h / 2, w, h);
          } catch (e) {
            // Ignore initial load tick before first seeked event
          }

          // If clip is selected, render subtle transform outline box
          if (clip.id === selectedClipId) {
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.strokeRect(-w / 2, -h / 2, w, h);
          }

          ctx.restore();
        } else if (clip.media_type === 'audio') {
          const mediaTime = (playheadTime - clip.start_time) + (clip.in_point || 0);
          const audio = getOrCreateAudioElement(clip.src);

          if (!isClipActive) {
            if (!audio.paused) audio.pause();
            return;
          }

          audio.muted = Boolean(clip.is_muted || clip.muted);
          audio.volume = Math.min(1.0, Math.max(0.0, Math.pow(10, (clip.volume_db || 0) / 20)));

          if (isPlaying) {
            if (audio.paused) {
              if (Math.abs(audio.currentTime - mediaTime) > 0.1) {
                audio.currentTime = mediaTime;
              }
              audio.play().catch(() => {});
            } else if (Math.abs(audio.currentTime - mediaTime) > 0.3) {
              audio.currentTime = mediaTime;
            }
          } else {
            if (!audio.paused) {
              audio.pause();
            }
            if (Math.abs(audio.currentTime - mediaTime) > 0.03) {
              audio.currentTime = mediaTime;
            }
          }
        }
      });
    }

    ctx.restore();
    ctx.filter = 'none';

    // Center Crosshair Guidelines
    ctx.strokeStyle = '#282832';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 20, h / 2);
    ctx.lineTo(w / 2 + 20, h / 2);
    ctx.moveTo(w / 2, h / 2 - 20);
    ctx.lineTo(w / 2, h / 2 + 20);
    ctx.stroke();
  }

  if (aspectSelect) {
    aspectSelect.addEventListener('change', updateCompositionStage);
    updateCompositionStage();
  }

  // 4. Export Render Handler (FastAPI / Native Engine)
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.setAttribute('disabled', 'true');
      exportBtn.innerHTML = `<i class="ph-bold ph-spinner spinner"></i> Rendering GPU...`;

      try {
        const res = await apiRequest<{ status: string; url?: string; message?: string; filename?: string }>('/api/video/engine/render', {
          method: 'POST',
          body: JSON.stringify({ use_gpu: true }),
        });

        if (res.status === 'success') {
          alert(`🎉 Composition Rendered Successfully!\nSaved to Assets Vault: ${res.filename || 'Render Output'}`);
          loadAssetsVault();
        } else {
          alert(`Render Failed: ${res.message || 'Unknown error'}`);
        }
      } catch (err) {
        alert(`Render API Error: ${(err as Error).message}`);
      } finally {
        exportBtn.removeAttribute('disabled');
        exportBtn.innerHTML = `<i class="ph-bold ph-lightning"></i> Render Comp`;
      }
    });
  }

  // Storage Analytics & Cache Drawer Modal
  const btnStorage = $('#ae-btn-storage');
  const storageDrawer = $<HTMLElement>('#ae-storage-drawer');
  const closeStorageModal = $('#ae-close-storage-modal');

  async function refreshStorageStats() {
    try {
      const stats = await apiRequest<{
        formatted?: Record<string, string>;
        unused_assets_count?: number;
      }>('/api/video/storage');
      if (stats.formatted) {
        const elOrig = $('#stg-orig-size');
        const elProxy = $('#stg-proxy-size');
        const elThumb = $('#stg-thumb-size');
        const elExport = $('#stg-export-size');
        const elUnused = $('#stg-unused-info');

        if (elOrig) elOrig.textContent = stats.formatted.original || '0 MB';
        if (elProxy) elProxy.textContent = stats.formatted.proxy || '0 MB';
        if (elThumb) elThumb.textContent = stats.formatted.thumbnail || '0 MB';
        if (elExport) elExport.textContent = stats.formatted.export || '0 MB';
        if (elUnused) elUnused.textContent = `${stats.unused_assets_count || 0} unused files (${stats.formatted.unused || '0 B'})`;
      }
    } catch (err) {
      console.warn('Storage stats fetch error:', err);
    }
  }

  if (btnStorage && storageDrawer) {
    btnStorage.addEventListener('click', () => {
      storageDrawer.style.display = 'flex';
      refreshStorageStats();
    });
  }

  if (closeStorageModal && storageDrawer) {
    closeStorageModal.addEventListener('click', () => {
      storageDrawer.style.display = 'none';
    });
  }

  $('#stg-btn-clean-proxy')?.addEventListener('click', async () => {
    await apiRequest('/api/video/storage/clean', { method: 'POST', body: JSON.stringify({ target: 'proxy' }) });
    refreshStorageStats();
    alert('Proxy cache cleared cleanly.');
  });

  $('#stg-btn-clean-all')?.addEventListener('click', async () => {
    if (confirm('Clear all temporary caches (proxies, thumbnails, waveforms)? Original assets will remain safe.')) {
      await apiRequest('/api/video/storage/clean', { method: 'POST', body: JSON.stringify({ target: 'all' }) });
      refreshStorageStats();
      alert('All video caches cleared cleanly.');
    }
  });

  // AI Tools Handlers (Auto Cut Silence & Auto Captions)
  $('#ae-capcut-btn-autocut')?.addEventListener('click', async () => {
    const btn = $('#ae-capcut-btn-autocut');
    if (btn) btn.innerHTML = `<i class="ph-bold ph-spinner spinner"></i> Cutting...`;
    try {
      const res = await apiRequest<{ status: string; cuts_made?: number; message?: string }>('/api/video/ai/auto-cut', { method: 'POST' });
      if (res.status === 'success') {
        alert(`✨ AI Auto-Cut Complete!\nPerformed ${res.cuts_made || 0} smart cuts on silent periods.`);
        syncTimelineFromBackend();
      } else {
        alert(`AI Auto-Cut Notice: ${res.message || 'Could not perform auto-cut'}`);
      }
    } catch (err) {
      alert(`AI Auto-Cut Error: ${(err as Error).message}`);
    } finally {
      if (btn) btn.innerHTML = `<i class="ph-bold ph-sparkle"></i> Auto Cut`;
    }
  });

  $('#ae-capcut-btn-captions')?.addEventListener('click', async () => {
    const btn = $('#ae-capcut-btn-captions');
    if (btn) btn.innerHTML = `<i class="ph-bold ph-spinner spinner"></i> Generating...`;
    try {
      const res = await apiRequest<{ status: string; captions_added?: number }>('/api/video/ai/auto-captions', { method: 'POST' });
      if (res.status === 'success') {
        alert(`✨ AI Auto-Captions Complete!\nGenerated ${res.captions_added || 0} subtitle text layers.`);
        syncTimelineFromBackend();
      }
    } catch (err) {
      alert(`AI Captions Error: ${(err as Error).message}`);
    } finally {
      if (btn) btn.innerHTML = `<i class="ph-bold ph-closed-captioning"></i> Captions`;
    }
  });

  // Clear All Timeline Layers Handler
  const btnClearTracks = $('#ae-btn-clear-tracks');
  if (btnClearTracks) {
    btnClearTracks.addEventListener('click', () => {
      if (confirm('Clear all layers and reset timeline?')) {
        activeTimeline.clips = [];
        selectedClipId = null;
        persistTimelineState();
        renderTimeline();
        drawCompositionGuide();
      }
    });
  }

  // 5. Interactive Workspace Panel Resizers (Mouse Dragging)
  const splitCol1 = $('#ae-split-col-1');
  const splitCol2 = $('#ae-split-col-2');
  const splitRowBottom = $('#ae-split-row-bottom');

  const panelProject = $<HTMLElement>('#ae-panel-project');
  const panelRight = $<HTMLElement>('#ae-panel-right');
  const panelTimeline = $<HTMLElement>('#ae-panel-timeline');

  // Resize Left Project Panel
  if (splitCol1 && panelProject) {
    let isDragging = false;
    splitCol1.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      splitCol1.classList.add('dragging');
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (moveEvt: MouseEvent) => {
        if (!isDragging) return;
        const newWidth = Math.max(180, Math.min(moveEvt.clientX - panelProject.getBoundingClientRect().left, 550));
        panelProject.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        splitCol1.classList.remove('dragging');
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Resize Right Panel Stack
  if (splitCol2 && panelRight) {
    let isDragging = false;
    splitCol2.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      splitCol2.classList.add('dragging');
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (moveEvt: MouseEvent) => {
        if (!isDragging) return;
        const newWidth = Math.max(200, Math.min(window.innerWidth - moveEvt.clientX, 500));
        panelRight.style.width = `${newWidth}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        splitCol2.classList.remove('dragging');
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Resize Bottom Timeline Height
  if (splitRowBottom && panelTimeline) {
    let isDragging = false;
    splitRowBottom.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      splitRowBottom.classList.add('dragging');
      document.body.style.cursor = 'row-resize';

      const onMouseMove = (moveEvt: MouseEvent) => {
        if (!isDragging) return;
        const newHeight = Math.max(120, Math.min(window.innerHeight - moveEvt.clientY, 500));
        panelTimeline.style.height = `${newHeight}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        splitRowBottom.classList.remove('dragging');
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Media Pool & Import File Upload Handling
  const importInput = $<HTMLInputElement>('#ae-import-file');
  const mediaPoolList = $<HTMLElement>('#ae-media-pool-list');
  let mediaPoolAssets: Array<{ name: string; type: 'video' | 'audio' | 'image'; url: string; duration?: number }> = [];

  let currentAuditionMedia: HTMLAudioElement | HTMLVideoElement | null = null;

  function renderMediaPool() {
    if (!mediaPoolList) return;
    mediaPoolList.className = 'ae-media-card-grid';

    if (mediaPoolAssets.length === 0) {
      mediaPoolList.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px 12px; text-align: center; color: #71717a; font-size: 0.72rem;">
          <i class="ph-bold ph-folder-open" style="font-size: 1.8rem; display: block; margin-bottom: 8px; color: #3f3f46;"></i>
          <span>No media assets imported yet.<br>Click <strong>+ Import</strong> to add files.</span>
        </div>
      `;
      return;
    }

    let html = '';
    mediaPoolAssets.forEach((asset, idx) => {
      const isVideo = asset.type === 'video';
      const isAudio = asset.type === 'audio';
      const isImage = asset.type === 'image';
      const typeIcon = isVideo ? 'ph-video-camera' : isAudio ? 'ph-waveform' : 'ph-image';
      const badgeClass = isVideo ? 'ae-media-badge-video' : isAudio ? 'ae-media-badge-audio' : 'ae-media-badge-image';
      const durationStr = isImage ? 'IMAGE' : `${(asset.duration || 12.0).toFixed(1)}s`;

      const streamUrl = asset.url.startsWith('http') || asset.url.startsWith('blob:')
        ? asset.url
        : `http://localhost:8000/api/assets-vault/stream/${asset.url.replace('database/assets_vault/', '')}`;

      let thumbContent = '';
      if (isVideo) {
        thumbContent = `<video class="ae-media-video-element" src="${streamUrl}" preload="metadata" muted playsinline style="width: 100%; height: 100%; object-fit: cover; background: #000; pointer-events: none;"></video>`;
      } else if (isImage) {
        thumbContent = `<img src="${streamUrl}" alt="${escapeHtml(asset.name)}" style="width: 100%; height: 100%; object-fit: cover;" />`;
      } else {
        thumbContent = `<i class="ph-bold ${typeIcon} media-icon"></i>`;
      }

      html += `
        <div class="ae-media-card-box" data-idx="${idx}" draggable="true" title="Double click to add to timeline">
          <button class="ae-media-btn-delete" data-idx="${idx}" title="Delete asset from Media Explorer">
            <i class="ph-bold ph-trash"></i>
          </button>
          <div class="ae-media-card-thumb">
            ${thumbContent}
            <div class="ae-media-play-overlay">
              <button class="ae-media-btn-play" data-idx="${idx}" title="Audition Play / Pause">
                <i class="ph-bold ph-play"></i>
              </button>
            </div>
          </div>
          <div class="ae-media-card-info">
            <span class="ae-media-card-name" title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</span>
            <div class="ae-media-card-meta">
              <span class="${badgeClass}">${asset.type.toUpperCase()}</span>
              <span>${durationStr}</span>
            </div>
          </div>
        </div>
      `;
    });

    mediaPoolList.innerHTML = html;

    mediaPoolList.querySelectorAll('.ae-media-card-box').forEach((card) => {
      card.addEventListener('dragstart', (e: Event) => {
        const dragEvt = e as DragEvent;
        const idxStr = card.getAttribute('data-idx');
        if (idxStr === null) return;
        const asset = mediaPoolAssets[parseInt(idxStr)];
        if (asset && dragEvt.dataTransfer) {
          dragEvt.dataTransfer.setData('text/plain', JSON.stringify(asset));
          dragEvt.dataTransfer.effectAllowed = 'copy';
        }
      });

      // Click card body -> Add asset to timeline
      card.addEventListener('dblclick', () => {
        const idxStr = card.getAttribute('data-idx');
        if (idxStr === null) return;
        const asset = mediaPoolAssets[parseInt(idxStr)];
        if (asset) addAssetToTimeline(asset);
      });

      // Delete button listener
      const deleteBtn = card.querySelector('.ae-media-btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idxStr = card.getAttribute('data-idx');
          if (idxStr === null) return;
          const idx = parseInt(idxStr, 10);
          mediaPoolAssets.splice(idx, 1);
          renderMediaPool();
        });
      }

      // Play / Audition button listener (plays video frame in card!)
      const playBtn = card.querySelector('.ae-media-btn-play');
      if (playBtn) {
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idxStr = card.getAttribute('data-idx');
          if (idxStr === null) return;
          const asset = mediaPoolAssets[parseInt(idxStr)];
          if (!asset) return;

          const videoEl = card.querySelector<HTMLVideoElement>('.ae-media-video-element');
          const playIcon = playBtn.querySelector('i');

          const streamUrl = asset.url.startsWith('http') || asset.url.startsWith('blob:')
            ? asset.url
            : `http://localhost:8000/api/assets-vault/stream/${asset.url.replace('database/assets_vault/', '')}`;

          if (videoEl) {
            if (videoEl.paused) {
              if (currentAuditionMedia) {
                currentAuditionMedia.pause();
                currentAuditionMedia = null;
              }

              videoEl.muted = false;
              videoEl.volume = 1.0;
              videoEl.play().catch(() => {
                videoEl.muted = true;
                videoEl.play().catch(() => {});
              });

              const audioEl = new Audio(streamUrl);
              audioEl.volume = 1.0;
              audioEl.play().catch(() => {});
              currentAuditionMedia = audioEl;

              if (playIcon) playIcon.className = 'ph-bold ph-pause';
            } else {
              videoEl.pause();
              if (currentAuditionMedia) {
                currentAuditionMedia.pause();
                currentAuditionMedia = null;
              }
              if (playIcon) playIcon.className = 'ph-bold ph-play';
            }
          } else {
            if (currentAuditionMedia) {
              currentAuditionMedia.pause();
              currentAuditionMedia = null;
            }

            const audioEl = new Audio(streamUrl);
            audioEl.volume = 1.0;
            audioEl.play().catch(() => {});
            currentAuditionMedia = audioEl;
            if (playIcon) playIcon.className = 'ph-bold ph-pause';
          }
        });
      }
    });
  }

  function addAssetToTimeline(asset: { name: string; type: 'video' | 'audio' | 'image'; url: string; duration?: number }, targetTrack?: number) {
    pushUndoState();
    const isAudio = asset.type === 'audio';
    const isVideo = asset.type === 'video';

    let targetTrackObj = activeTimeline.tracks.find((t: any) => isAudio ? t.type === 'audio' : (t.type === 'video' || t.type === 'image'));
    if (!targetTrackObj) {
      const trackId = Date.now();
      const trackName = isAudio ? `A${activeTimeline.tracks.filter((t: any) => t.type === 'audio').length + 1} · Audio Track` : `V${activeTimeline.tracks.filter((t: any) => t.type === 'video').length + 1} · Video Track`;
      targetTrackObj = { id: trackId, name: trackName, type: isAudio ? 'audio' : 'video', muted: false, solo: false, locked: false };
      activeTimeline.tracks.push(targetTrackObj);
    }

    const chosenTrackId = targetTrack || targetTrackObj.id;
    const sourceDuration = asset.type === 'image' ? 5.0 : Math.max(0.1, Number(asset.duration || 12.0));

    // Calculate sequential start time: fit at 0.0s for first clip, attach after end for subsequent clips
    const existingTrackClips = activeTimeline.clips.filter((c: any) => String(c.track_id) === String(chosenTrackId));
    let dropStartTime = 0.0;
    if (existingTrackClips.length > 0) {
      const maxEnd = Math.max(...existingTrackClips.map((c: any) => c.start_time + c.duration));
      dropStartTime = maxEnd;
    } else {
      dropStartTime = 0.0;
    }

    const newVideoClip = {
      id: 'clip-' + Date.now(),
      name: asset.name,
      src: asset.url,
      media_type: asset.type,
      start_time: dropStartTime,
      duration: sourceDuration,
      in_point: 0.0,
      out_point: sourceDuration,
      track_id: chosenTrackId,
      transform: { position_x: 0, position_y: 0, position_z: 0, scale_x: 100, scale_y: 100, rotation: 0, opacity: 100 },
      color_grading: { exposure: 0, contrast: 100, saturation: 100, temperature: 0 },
      keyframes: [],
      volume_db: 0.0,
    };

    activeTimeline.clips.push(newVideoClip);
    selectedClipId = newVideoClip.id;

    persistTimelineState();
    renderTimeline();
    drawCompositionGuide();
  }

  async function syncMediaPoolFromBackend() {
    try {
      const res = await fetch('http://localhost:8000/api/assets-vault/tree');
      if (!res.ok) return;
      const data = await res.json();
      if (data.files && Array.isArray(data.files)) {
        const mediaFiles = data.files.filter((f: any) => f.folder === 'imports' && ['video', 'audio', 'image'].includes(f.media_type));
        mediaPoolAssets = mediaFiles.map((f: any) => ({
          name: f.name,
          type: f.media_type as 'video' | 'audio' | 'image',
          url: `database/assets_vault/${f.rel_path}`,
          duration: f.duration || 12.0,
        }));
        renderMediaPool();

        // Probe real HTML5 duration for videos/audios dynamically
        mediaPoolAssets.forEach((asset) => {
          if (asset.type === 'image') return;
          const streamUrl = asset.url.startsWith('http') || asset.url.startsWith('blob:')
            ? asset.url
            : `http://localhost:8000/api/assets-vault/stream/${asset.url.replace('database/assets_vault/', '')}`;

          const tempMedia = asset.type === 'video' ? document.createElement('video') : document.createElement('audio');
          tempMedia.preload = 'metadata';
          tempMedia.src = streamUrl;
          tempMedia.onloadedmetadata = () => {
            if (tempMedia.duration && !isNaN(tempMedia.duration) && isFinite(tempMedia.duration)) {
              asset.duration = tempMedia.duration;
              renderMediaPool();
            }
          };
        });
      }
    } catch (err) {
      console.warn('Failed to sync media pool from assets vault:', err);
    }
  }

  if (importInput) {
    importInput.addEventListener('change', async () => {
      const files = importInput.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const blobUrl = URL.createObjectURL(file);
        const filename = file.name;
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const type: 'video' | 'audio' | 'image' = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'].includes(ext)
          ? 'audio'
          : ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(ext)
          ? 'image'
          : 'video';

        // Determine asset URL — try uploading to backend, fallback to blob URL
        let assetUrl = blobUrl;
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('category', 'imports');
          const res = await fetch('http://localhost:8000/api/video/import', {
            method: 'POST',
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            assetUrl = data.url || `database/assets_vault/imports/${filename}`;
            const importedAsset = data.asset as { duration?: number } | undefined;
            const asset = { name: filename, type, url: assetUrl, duration: importedAsset?.duration };
            if (!mediaPoolAssets.some((a) => a.name === asset.name)) {
              mediaPoolAssets.unshift(asset);
            }
            addAssetToTimeline(asset);
            continue;
          }
        } catch (_) {
          // Backend upload failed — use blob URL as fallback for instant playback
        }

        // Add to media pool
        const asset = { name: filename, type, url: assetUrl };
        if (!mediaPoolAssets.some((a) => a.name === asset.name)) {
          mediaPoolAssets.unshift(asset);
        }

        // Auto-add clip to timeline so user sees it immediately
        addAssetToTimeline(asset);
      }

      renderMediaPool();
      renderTimeline();
      updateInspectorForSelectedClip();
      drawCompositionGuide();
      importInput.value = '';
    });
  }

  // Initial timeline & media pool render & sync with backend
  renderTimeline();
  syncTimelineFromBackend();
  syncMediaPoolFromBackend();
  updatePlayheadUI();
}
