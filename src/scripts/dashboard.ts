import { LGraph, LGraphCanvas, LiteGraph } from 'litegraph.js';
import 'litegraph.js/css/litegraph.css';

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
  const navItems = $$('.nav-item');
  const viewPanels = $$('.view-panel');
  const viewTitle = $('#view-title');

  function switchView(targetId: string) {
    navItems.forEach((item) => {
      const isTarget = item.getAttribute('data-target') === targetId;
      item.classList.toggle('active', isTarget);
      if (isTarget && viewTitle) {
        const spanText = item.querySelector('span')?.textContent;
        viewTitle.textContent = spanText ? `${spanText} Overview` : 'Dashboard Overview';
      }
    });

    viewPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === targetId);
    });

    if (targetId === 'v-canvas') {
      setTimeout(initWorkflowStudio, 100);
    }
    if (targetId === 'v-templates') {
      loadAssetsVault();
    }
    if (targetId === 'v-assets') {
      initHyperframeStudio();
    }
    if (targetId === 'v-logs') {
      initSystemLogs();
    }
    if (targetId === 'v-voice') {
      initTTSStudio();
    }
  }

  navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');
      if (targetId) {
        switchView(targetId);
        window.location.hash = targetId.replace('v-', '');
      }
    });
  });

  // Handle hash routing on page load
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    const matchingTarget = `v-${hash}`;
    if ($(`#${matchingTarget}`)) switchView(matchingTarget);
  }
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

  host.innerHTML = '';
  const canvasElement = document.createElement('canvas');
  canvasElement.width = host.clientWidth || 1000;
  canvasElement.height = host.clientHeight || 550;
  host.appendChild(canvasElement);

  const graph = new LGraph();
  const canvas = new LGraphCanvas(canvasElement, graph);
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

  const nodes = steps.map(([title, color], index) => {
    const node = LiteGraph.createNode('basic/const');
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
      const res = await fetch('/api/assets-vault/upload', {
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

// Initialize Everything on Load
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initAIComposer();
  initHyperframeStudio();
  initAssetsVault();
  initModalsAndEvents();
  initObsidianVault();
  loadSystemStats();
  loadPipelineStatus();
  loadTodaySchedule();
  loadRecentActivity();
  loadProjects();
  loadResearch();
});

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

  async function checkTTSStatus() {
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
      } else {
        if (statusBadge) {
          statusBadge.textContent = '○ STARTING / OFFLINE';
          statusBadge.style.background = 'rgba(249, 115, 22, 0.15)';
          statusBadge.style.color = '#f97316';
          statusBadge.style.borderColor = 'rgba(249, 115, 22, 0.3)';
        }
        if (offlineNotice) offlineNotice.style.display = 'block';
        if (iframe) iframe.style.display = 'none';
      }
    } catch (e) {
      if (statusBadge) {
        statusBadge.textContent = '○ OFFLINE';
        statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        statusBadge.style.color = '#ef4444';
      }
    }
  }

  async function startTTSServer() {
    if (statusBadge) statusBadge.textContent = '⏳ STARTING SERVER...';
    try {
      await apiRequest('/api/tts/server/start', { method: 'POST' });
      setTimeout(checkTTSStatus, 1500);
      setTimeout(checkTTSStatus, 4000);
    } catch (e) {}
  }

  if (startBtn) {
    startBtn.addEventListener('click', startTTSServer);
  }
  if (launchOfflineBtn) {
    launchOfflineBtn.addEventListener('click', startTTSServer);
  }

  checkTTSStatus();
}

// Auto-initialize Workflow Studio & System Logs Engine on load
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initWorkflowStudio();
    initSystemLogs();
    initTTSStudio();
  });
  setTimeout(initWorkflowStudio, 200);
}

