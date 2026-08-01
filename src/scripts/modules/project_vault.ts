/**
 * Content OS — Projects Vault Module
 */

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function initProjectVaultModule() {
  const btnNewProject = $('#proj-btn-new');
  if (btnNewProject) {
    btnNewProject.addEventListener('click', () => {
      const projName = prompt('Enter new Project Name:');
      if (projName) {
        alert(`📁 Project created: "${projName}"`);
      }
    });
  }
}
