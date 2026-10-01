'use strict';

// Renders caption lines. Shared by the capture window (fed over IPC) and the
// browser-source page (fed over server-sent events), so both always look the same.
(function exposeCaptionDisplay(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.captionDisplay = api;
})(typeof window === 'object' ? window : null, () => {
  const LINE_LIMIT = 2;
  const LINE_SECONDS = 7;
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

  function createCaptionDisplay(container, doc, timers = { set: (callback, ms) => setTimeout(callback, ms) }) {
    let state = { fontSize: 30, textColor: '#ffffff', box: true, showOriginal: false };
    let interimElement = null;

    function applyState(next) {
      state = { ...state, ...(next || {}) };
      const style = doc.documentElement.style;
      style.setProperty('--caption-size', `${Number(state.fontSize) || 30}px`);
      style.setProperty('--caption-text', COLOR_PATTERN.test(state.textColor) ? state.textColor : '#ffffff');
      doc.body.classList.toggle('boxed', state.box !== false);
      for (const original of container.querySelectorAll('.caption-original')) {
        original.classList.toggle('hidden', !state.showOriginal);
      }
      return state;
    }

    function clearInterim() {
      interimElement?.remove();
      interimElement = null;
    }

    function showInterim({ text } = {}) {
      if (!text) {
        clearInterim();
        return;
      }
      if (!interimElement) {
        interimElement = doc.createElement('div');
        interimElement.className = 'caption-line interim';
        container.append(interimElement);
      }
      interimElement.textContent = text;
    }

    function showLine(line) {
      clearInterim();
      if (!line?.text) return;
      const element = doc.createElement('div');
      element.className = 'caption-line';
      if (line.translated && line.original) {
        const original = doc.createElement('span');
        original.className = 'caption-original';
        original.classList.toggle('hidden', !state.showOriginal);
        original.textContent = line.original;
        element.append(original);
      }
      element.append(doc.createTextNode(line.text));
      container.append(element);
      const finals = [...container.querySelectorAll('.caption-line:not(.interim)')];
      for (const old of finals.slice(0, Math.max(0, finals.length - LINE_LIMIT))) old.remove();
      timers.set(() => {
        element.classList.add('fading');
        timers.set(() => element.remove(), 500);
      }, LINE_SECONDS * 1000);
    }

    return { applyState, showInterim, showLine };
  }

  return { createCaptionDisplay };
});
