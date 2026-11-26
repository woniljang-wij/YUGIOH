function scheduleAutoPhaseAdvance({
  delay,
  isActionBusy,
  advance,
  schedule = setTimeout,
  cancel = clearTimeout
}) {
  let timeout;
  let cancelled = false;

  const attemptAdvance = () => {
    if (cancelled) return;
    if (isActionBusy()) {
      timeout = schedule(attemptAdvance, 50);
      return;
    }
    advance();
  };

  timeout = schedule(attemptAdvance, delay);
  return () => {
    cancelled = true;
    cancel(timeout);
  };
}

export { scheduleAutoPhaseAdvance };
