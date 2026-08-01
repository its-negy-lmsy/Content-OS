/**
 * Content OS — Knowledge Vault Module
 */

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function initKnowledgeVaultModule() {
  const btnKnowledge = $('#kv-btn-search');
  if (btnKnowledge) {
    btnKnowledge.addEventListener('click', () => {
      alert('💡 Knowledge Graph Query Triggered');
    });
  }
}
