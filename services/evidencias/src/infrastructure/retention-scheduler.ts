export type RetentionLogger = {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
};

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startRetentionScheduler(
  sweep: () => Promise<Record<string, number>>,
  logger: RetentionLogger,
  intervalMs = DAILY_INTERVAL_MS,
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { logger.info({ removed: await sweep() }, 'evidence retention sweep completed'); }
    catch (error) { logger.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'evidence retention sweep failed'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
