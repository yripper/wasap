/// Fixed-interval runner that skips a tick while the previous run is still
/// going (a slow first sweep over thousands of dialogs must not stack up)
/// and never dies on a task error. `immediate` runs the first tick right away
/// under the same in-flight guard, so a slow first run also blocks the timer.
export function startNonOverlappingLoop(
  task: () => Promise<void>,
  intervalMs: number,
  onError: (e: unknown) => void,
  opts: { immediate?: boolean } = {},
): () => void {
  let inFlight = false;
  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    task()
      .catch(onError)
      .finally(() => {
        inFlight = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  if (opts.immediate) tick();
  return () => clearInterval(timer);
}
