'use strict';

const { CircuitBreaker, STATES } = require('../../src/utils/circuitBreaker');

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMax: 1,
    });
  });

  describe('CLOSED state', () => {
    it('passes through successful calls', async () => {
      const result = await breaker.call(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
      expect(breaker.state).toBe(STATES.CLOSED);
    });

    it('passes through errors without opening on fewer than threshold failures', async () => {
      for (let i = 0; i < 2; i++) {
        await expect(breaker.call(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      }
      expect(breaker.state).toBe(STATES.CLOSED);
      expect(breaker.failureCount).toBe(2);
    });

    it('opens after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(breaker.call(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      }
      expect(breaker.state).toBe(STATES.OPEN);
    });
  });

  describe('OPEN state', () => {
    beforeEach(async () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(breaker.call(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
    });

    it('rejects calls immediately without invoking the function', async () => {
      let invoked = false;
      await expect(
        breaker.call(() => { invoked = true; return Promise.resolve(); })
      ).rejects.toThrow(/OPEN/);
      expect(invoked).toBe(false);
    });

    it('transitions to HALF_OPEN after reset timeout', async () => {
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      // Next call should go through (HALF_OPEN)
      const result = await breaker.call(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(breaker.state).toBe(STATES.CLOSED);
    });
  });

  describe('HALF_OPEN state', () => {
    beforeEach(async () => {
      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(breaker.call(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    it('closes on successful test request', async () => {
      const result = await breaker.call(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
      expect(breaker.state).toBe(STATES.CLOSED);
      expect(breaker.failureCount).toBe(0);
    });

    it('reopens on failed test request', async () => {
      await expect(breaker.call(() => Promise.reject(new Error('still broken')))).rejects.toThrow();
      expect(breaker.state).toBe(STATES.OPEN);
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      const stats = breaker.getStats();
      expect(stats.name).toBe('test');
      expect(stats.state).toBe(STATES.CLOSED);
      expect(stats.failureThreshold).toBe(3);
    });
  });

  describe('reset', () => {
    it('resets to CLOSED state', async () => {
      for (let i = 0; i < 3; i++) {
        await expect(breaker.call(() => Promise.reject(new Error()))).rejects.toThrow();
      }
      expect(breaker.state).toBe(STATES.OPEN);
      breaker.reset();
      expect(breaker.state).toBe(STATES.CLOSED);
      expect(breaker.failureCount).toBe(0);
    });
  });

  describe('custom isFailure', () => {
    it('only counts matching errors as failures', async () => {
      const selectiveBreaker = new CircuitBreaker('selective', {
        failureThreshold: 2,
        isFailure: (err) => err.message !== 'expected',
      });

      // This should NOT count as a failure
      await expect(selectiveBreaker.call(() => Promise.reject(new Error('expected')))).rejects.toThrow();
      expect(selectiveBreaker.failureCount).toBe(0);

      // These should count
      await expect(selectiveBreaker.call(() => Promise.reject(new Error('unexpected')))).rejects.toThrow();
      await expect(selectiveBreaker.call(() => Promise.reject(new Error('unexpected')))).rejects.toThrow();
      expect(selectiveBreaker.state).toBe(STATES.OPEN);
    });
  });
});
