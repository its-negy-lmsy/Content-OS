/**
 * Content OS — HyperFrames Studio Keyframe & Animation Module
 */

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function initHyperframesStudioModule() {
  const btnRenderHyper = $('#hyper-btn-render');
  if (btnRenderHyper) {
    btnRenderHyper.addEventListener('click', () => {
      alert('⚡ HyperFrames Animation Render Triggered');
    });
  }
}
