import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRetentionScheduler } from '../src/infrastructure/retention-scheduler.js';

afterEach(() => vi.useRealTimers());

describe('evidence retention scheduler', () => {
  it('runs once immediately and then at the configured daily interval', async () => {
    vi.useFakeTimers();
    const sweep = vi.fn().mockResolvedValue({ reports: 1, sessions: 0 });
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = startRetentionScheduler(sweep, logger, 24 * 60 * 60 * 1000);
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith({ removed: { reports: 1, sessions: 0 } }, 'evidence retention sweep completed');
    stop();
  });

  it('does not overlap sweeps and records failures without exposing error details', async () => {
    vi.useFakeTimers();
    let finish!: (value: Record<string, number>) => void;
    const sweep = vi.fn(() => new Promise<Record<string, number>>(resolve => { finish = resolve; }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const stop = startRetentionScheduler(sweep, logger, 1000);
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep).toHaveBeenCalledTimes(1);
    finish({ reports: 0 });
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledOnce());
    stop();

    const failingStop = startRetentionScheduler(vi.fn().mockRejectedValue(new Error('private db detail')), logger, 1000);
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledWith({ errorName: 'Error' }, 'evidence retention sweep failed'));
    failingStop();
  });
});
