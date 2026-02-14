'use strict';

/**
 * Unit tests for the Semaphore concurrency limiter.
 * Validates max concurrent, queuing, queue-full rejection, timeout, and drain.
 */

const { Semaphore, SemaphoreRejectedError, SemaphoreTimeoutError } = require('../../src/utils/semaphore');

// Mock logger to suppress output in tests
jest.mock('../../src/utils/logger', () => {
  const noop = () => {};
  const childLogger = { info: noop, warn: noop, error: noop, debug: noop };
  return { child: () => childLogger, info: noop, warn: noop, error: noop, debug: noop };
});

describe('Semaphore', () => {
  it('allows up to maxConcurrent operations', async () => {
    const sem = new Semaphore({ maxConcurrent: 3, maxQueueSize: 5 });

    const p1 = await sem.acquire();
    const p2 = await sem.acquire();
    const p3 = await sem.acquire();

    expect(sem.active).toBe(3);
    expect(sem.queued).toBe(0);
    expect(p1.waitMs).toBe(0);
    expect(p2.waitMs).toBe(0);
    expect(p3.waitMs).toBe(0);

    p1.release();
    p2.release();
    p3.release();
    expect(sem.active).toBe(0);
  });

  it('queues when maxConcurrent is reached', async () => {
    const sem = new Semaphore({ maxConcurrent: 1, maxQueueSize: 3 });

    const p1 = await sem.acquire();
    expect(sem.active).toBe(1);

    // This should be queued
    let resolved = false;
    const p2Promise = sem.acquire().then(p => { resolved = true; return p; });

    // Give event loop a tick
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);
    expect(sem.queued).toBe(1);

    // Release first — should dequeue second
    p1.release();
    const p2 = await p2Promise;
    expect(resolved).toBe(true);
    expect(p2.waitMs).toBeGreaterThanOrEqual(0);
    expect(sem.active).toBe(1);
    expect(sem.queued).toBe(0);

    p2.release();
    expect(sem.active).toBe(0);
  });

  it('rejects when queue is full', async () => {
    const sem = new Semaphore({ maxConcurrent: 1, maxQueueSize: 1 });

    const p1 = await sem.acquire();
    // Queue one
    const p2Promise = sem.acquire();
    // Queue full — should reject
    await expect(sem.acquire()).rejects.toThrow(SemaphoreRejectedError);
    await expect(sem.acquire()).rejects.toThrow('queue is full');

    const stats = sem.stats();
    expect(stats.totalRejected).toBe(2);

    p1.release();
    const p2 = await p2Promise;
    p2.release();
  });

  it('times out when waiting too long', async () => {
    const sem = new Semaphore({ maxConcurrent: 1, maxQueueSize: 5, acquireTimeoutMs: 50 });

    const p1 = await sem.acquire();

    // This will queue and timeout
    await expect(sem.acquire()).rejects.toThrow(SemaphoreTimeoutError);

    const stats = sem.stats();
    expect(stats.totalTimedOut).toBe(1);

    p1.release();
  });

  it('release is idempotent', async () => {
    const sem = new Semaphore({ maxConcurrent: 2 });
    const p = await sem.acquire();
    expect(sem.active).toBe(1);

    p.release();
    expect(sem.active).toBe(0);

    // Double release should be safe
    p.release();
    expect(sem.active).toBe(0);
  });

  it('processes queue in FIFO order', async () => {
    const sem = new Semaphore({ maxConcurrent: 1, maxQueueSize: 5 });
    const order = [];

    const p1 = await sem.acquire();

    const p2Promise = sem.acquire().then(p => { order.push(2); return p; });
    const p3Promise = sem.acquire().then(p => { order.push(3); return p; });

    expect(sem.queued).toBe(2);

    p1.release();
    const p2 = await p2Promise;
    p2.release();
    const p3 = await p3Promise;
    p3.release();

    expect(order).toEqual([2, 3]);
  });

  it('drain rejects all queued entries', async () => {
    const sem = new Semaphore({ maxConcurrent: 1, maxQueueSize: 5 });

    const p1 = await sem.acquire();

    const rejections = [];
    sem.acquire().catch(err => rejections.push(err));
    sem.acquire().catch(err => rejections.push(err));

    await new Promise(r => setTimeout(r, 10)); // let them enqueue
    expect(sem.queued).toBe(2);

    sem.drain();
    await new Promise(r => setTimeout(r, 10)); // let rejections propagate

    expect(sem.queued).toBe(0);
    expect(rejections).toHaveLength(2);
    expect(rejections[0]).toBeInstanceOf(SemaphoreRejectedError);

    p1.release();
  });

  it('stats returns accurate snapshot', async () => {
    const sem = new Semaphore({ maxConcurrent: 2, maxQueueSize: 3 });

    const stats1 = sem.stats();
    expect(stats1.active).toBe(0);
    expect(stats1.queued).toBe(0);
    expect(stats1.totalAcquired).toBe(0);

    const p1 = await sem.acquire();
    const p2 = await sem.acquire();

    const stats2 = sem.stats();
    expect(stats2.active).toBe(2);
    expect(stats2.totalAcquired).toBe(2);
    expect(stats2.maxConcurrent).toBe(2);
    expect(stats2.maxQueueSize).toBe(3);

    p1.release();
    p2.release();

    const stats3 = sem.stats();
    expect(stats3.active).toBe(0);
    expect(stats3.totalAcquired).toBe(2);
  });

  it('handles high contention correctly', async () => {
    const sem = new Semaphore({ maxConcurrent: 2, maxQueueSize: 20 });
    const results = [];

    // Fire 10 concurrent acquires
    const promises = Array.from({ length: 10 }, (_, i) =>
      sem.acquire().then(async ({ release, waitMs }) => {
        results.push({ id: i, waitMs });
        // Simulate work
        await new Promise(r => setTimeout(r, 10));
        release();
      })
    );

    await Promise.all(promises);

    expect(results).toHaveLength(10);
    expect(sem.active).toBe(0);
    expect(sem.queued).toBe(0);

    // First 2 should have 0 wait time
    expect(results[0].waitMs).toBe(0);
    expect(results[1].waitMs).toBe(0);
  });
});
