'use strict';

/**
 * Tests for middleware/loginLimiter.js
 * Covers account lockout mechanism.
 */

jest.mock('../../src/utils/logger', () => {
  const child = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  });
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child };
});

// Set env for fast lockout in tests
process.env.ACCOUNT_LOCKOUT_MAX_ATTEMPTS = '3';
process.env.ACCOUNT_LOCKOUT_DURATION_MS = '2000'; // 2s lockout for testing

const { checkAccountLockout, recordFailedAttempt, clearLockout } = require('../../src/middleware/loginLimiter');

function mockReq(email = 'test@example.com') {
  return {
    body: { email },
    requestId: 'req_test',
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('Account Lockout', () => {
  beforeEach(() => {
    clearLockout('locktest@example.com');
    clearLockout('test@example.com');
  });

  describe('recordFailedAttempt', () => {
    it('should track failed attempts', () => {
      recordFailedAttempt('locktest@example.com');
      recordFailedAttempt('locktest@example.com');
      // Not locked yet (threshold is 3)
      const req = mockReq('locktest@example.com');
      const res = mockRes();
      const next = jest.fn();
      checkAccountLockout(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should lock account after max attempts', () => {
      for (let i = 0; i < 3; i++) {
        recordFailedAttempt('locktest@example.com');
      }
      const req = mockReq('locktest@example.com');
      const res = mockRes();
      const next = jest.fn();
      checkAccountLockout(req, res, next);
      expect(res.status).toHaveBeenCalledWith(423);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'ACCOUNT_LOCKED' }),
      }));
    });
  });

  describe('clearLockout', () => {
    it('should clear lockout on successful login', () => {
      for (let i = 0; i < 3; i++) {
        recordFailedAttempt('locktest@example.com');
      }
      clearLockout('locktest@example.com');

      const req = mockReq('locktest@example.com');
      const res = mockRes();
      const next = jest.fn();
      checkAccountLockout(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('checkAccountLockout', () => {
    it('should pass through when no email provided', () => {
      const req = { body: {}, requestId: 'req_test' };
      const res = mockRes();
      const next = jest.fn();
      checkAccountLockout(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should pass through for unlocked accounts', () => {
      const req = mockReq('clean@example.com');
      const res = mockRes();
      const next = jest.fn();
      checkAccountLockout(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should unlock after lockout duration expires', async () => {
      for (let i = 0; i < 3; i++) {
        recordFailedAttempt('locktest@example.com');
      }
      // Wait for lockout to expire (2s in test)
      await new Promise(resolve => setTimeout(resolve, 2100));

      const req = mockReq('locktest@example.com');
      const res = mockRes();
      const next = jest.fn();
      checkAccountLockout(req, res, next);
      expect(next).toHaveBeenCalled();
    }, 5000);
  });
});
