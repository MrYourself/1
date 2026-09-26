'use strict';

// Sends audio only while someone speaks. Deepgram bills streamed audio, so
// silence between sentences would otherwise cost money for the whole stream.
(function exposeSpeechGate(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.captionSpeechGate = api;
})(typeof window === 'object' ? window : null, () => {
  const MIN_RMS = 0.001;

  // Slider 0–100 on a logarithmic scale: 0 → 0.001, 50 → 0.01, 100 → 0.1 RMS.
  function gateThreshold(value) {
    const position = Math.min(100, Math.max(0, Number(value) || 0));
    return MIN_RMS * 10 ** (position / 50);
  }

  function levelFromRms(rms) {
    if (!(rms > MIN_RMS)) return 0;
    return Math.min(100, Math.max(0, 50 * Math.log10(rms / MIN_RMS)));
  }

  function createSpeechGate({ send, speechEnded, preRollFrames = 3, hangoverFrames = 12 }) {
    let preRoll = [];
    let hangover = 0;
    let speaking = false;

    function push(pcm, rms, threshold) {
      if (rms >= threshold) {
        if (!speaking) {
          speaking = true;
          // Keep the start of the first word, which is usually quieter.
          for (const frame of preRoll) send(frame);
          preRoll = [];
        }
        hangover = hangoverFrames;
        send(pcm);
      } else if (speaking) {
        send(pcm);
        hangover -= 1;
        if (hangover <= 0) {
          speaking = false;
          speechEnded();
        }
      } else {
        preRoll.push(pcm);
        if (preRoll.length > preRollFrames) preRoll.shift();
      }
    }

    function reset() {
      if (speaking) speechEnded();
      preRoll = [];
      hangover = 0;
      speaking = false;
    }

    return { push, reset, get speaking() { return speaking; } };
  }

  return { createSpeechGate, gateThreshold, levelFromRms };
});
