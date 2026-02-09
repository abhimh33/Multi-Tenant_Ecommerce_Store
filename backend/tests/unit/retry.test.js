'use strict';

const { retryWithBackoff, sleep } = require('../../src/utils/retry');

describe('Retry Utility', () => {
  describe('sleep', () => {
    it('resolves after specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('retryWithBackoff', () => {
    it('returns immediately on first success', async () => {
      let attempts = 0;
      const result = await retryWithBackoff(
        () => { attempts++; return 'ok'; },
        { maxRetries: 3, baseDelayMs: 10 }
      );
      expect(result).toBe('ok');
      expect(attempts).toBe(1);
    });

    it('retries on failure and eventually succeeds', async () => {
      let attempt = 0;
      const result = await retryWithBackoff(
        () => {
          attempt++;
          if (attempt < 3) throw new Error(`fail ${attempt}`);
          return 'success';
        },
        { maxRetries: 3, baseDelayMs: 10, operationName: 'test-op' }
      );
      expect(result).toBe('success');
      expect(attempt).toBe(3);
    });

    it('throws after exhausting retries', async () => {
      await expect(
        retryWithBackoff(
          () => { throw new Error('permanent failure'); },
          { maxRetries: 2, baseDelayMs: 10, operationName: 'test-op' }
        )
      ).rejects.toThrow('permanent failure');
    });

    it('stops retrying when shouldRetry returns false', async () => {
      let attempts = 0;
      await expect(
        retryWithBackoff(
          () => {
            attempts++;
            const err = new Error('non-retryable');
            err.retryable = false;
            throw err;
          },
          {
            maxRetries: 5,
            baseDelayMs: 10,
            shouldRetry: (err) => err.retryable !== false,
          }
        )
      ).rejects.toThrow('non-retryable');
      expect(attempts).toBe(1);
    });

    it('respects maxDelayMs cap', async () => {
      const start = Date.now();
      let attempts = 0;
      await expect(
        retryWithBackoff(
          () => { attempts++; throw new Error('fail'); },
          { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 20, operationName: 'test' }
        )
      ).rejects.toThrow();
      // Should complete quickly due to low maxDelay
      expect(Date.now() - start).toBeLessThan(2000);
    });
  });
});
