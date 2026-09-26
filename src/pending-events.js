'use strict';

function createPendingEventBuffer(dispatch, maximum = 500) {
  if (typeof dispatch !== 'function') throw new TypeError('dispatch must be a function');
  const limit = Math.max(1, Math.floor(Number(maximum) || 500));
  const pending = [];
  let released = false;

  function push(kind, payload) {
    if (released) {
      dispatch(kind, payload, { historyReplay: false });
      return;
    }
    pending.push({ kind, payload });
    if (pending.length > limit) pending.shift();
  }

  function release() {
    if (released) return;
    released = true;
    for (const event of pending.splice(0)) dispatch(event.kind, event.payload, { historyReplay: true });
  }

  return {
    push,
    release,
    get pendingCount() { return pending.length; },
    get released() { return released; }
  };
}

module.exports = { createPendingEventBuffer };
