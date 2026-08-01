/**
 * Content OS — Research Hub & Notes Module
 */

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function initResearchHubModule() {
  const btnSearchPaper = $('#res-btn-search');
  if (btnSearchPaper) {
    btnSearchPaper.addEventListener('click', () => {
      alert('🔍 Academic Research Lookup Triggered');
    });
  }
}
