import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleAutoPhaseAdvance } from './duelAutoPhase.js';

test('auto phase transition waits for a busy action instead of dropping the advance', () => {
  const scheduled = [];
  let actionBusy = true;
  let advanceCount = 0;
  const schedule = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };

  scheduleAutoPhaseAdvance({
    delay: 0,
    isActionBusy: () => actionBusy,
    advance: () => { advanceCount += 1; },
    schedule,
    cancel: () => {}
  });

  scheduled.shift().callback();
  assert.equal(advanceCount, 0);
  assert.equal(scheduled[0].delay, 50);

  actionBusy = false;
  scheduled.shift().callback();
  assert.equal(advanceCount, 1);
});
