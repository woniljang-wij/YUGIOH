/* Browser scheduler inspired by the callback timing model in CCScheduler.js. */
(function (global) {
  'use strict';

  let nextSequenceId = 1;
  const sequences = new Map();

  function sequence(steps) {
    if (!Array.isArray(steps) || steps.length === 0)
      throw new TypeError('GameScheduler.sequence requires at least one step.');

    steps.forEach((step) => {
      if (!Number.isFinite(step.at) || step.at < 0 || typeof step.run !== 'function')
        throw new TypeError('Each scheduled step needs a non-negative time and callback.');
    });
    const orderedSteps = steps.slice().sort((left, right) => left.at - right.at);

    const id = nextSequenceId++;
    const timers = new Set();
    const startedAt = global.performance.now();
    let cancelled = false;

    const handle = {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        timers.forEach(global.clearTimeout);
        timers.clear();
        sequences.delete(id);
      }
    };

    sequences.set(id, handle);
    orderedSteps.forEach((step) => {
      const timer = global.setTimeout(() => {
        timers.delete(timer);
        if (cancelled) return;
        try {
          step.run();
        } finally {
          if (timers.size === 0) sequences.delete(id);
        }
      }, Math.max(0, step.at - (global.performance.now() - startedAt)));
      timers.add(timer);
    });

    return handle;
  }

  function cancelAll() {
    Array.from(sequences.values()).forEach((handle) => handle.cancel());
  }

  global.GameScheduler = Object.freeze({ sequence, cancelAll });
  global.addEventListener('pagehide', cancelAll);
})(window);
