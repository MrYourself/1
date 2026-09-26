'use strict';

(function exposeSpamFilter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.chatSpamFilter = api;
})(typeof window === 'object' ? window : null, () => {
  function createSpamTracker(options = {}) {
    const repeatWindow = Math.max(1000, Number(options.repeatWindow) || 15000);
    const burstWindow = Math.max(1000, Number(options.burstWindow) || 5000);
    const burstLimit = Math.max(1, Number(options.burstLimit) || 5);
    let recent = [];

    function reset() {
      recent = [];
    }

    function isSpam(user, text, observedAt = Date.now()) {
      const numericTime = Number(observedAt);
      const now = Number.isFinite(numericTime) && numericTime > 0 ? numericTime : Date.now();
      recent = recent.filter(item => item.time <= now && now - item.time < repeatWindow);
      // Empty text can represent an emote-only message. Its visual fragments are
      // not part of this compact tracker, so it must not be treated as a repeat.
      const exactRepeats = text
        ? recent.filter(item => item.user === user && item.text === text).length
        : 0;
      const burst = recent.filter(item => item.user === user && now - item.time < burstWindow).length;
      recent.push({ user, text, time: now });
      return exactRepeats >= 1 || burst >= burstLimit;
    }

    return { isSpam, reset };
  }

  return { createSpamTracker };
});
