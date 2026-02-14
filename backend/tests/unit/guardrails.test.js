'use strict';

/**
 * Tests for middleware/guardrails.js
 * Covers store limit enforcement, cooldown, and engine validation.
 */

// Store mocks
const mockCountActiveByOwner = jest.fn();
jest.mock('../../src/services/storeRegistry', () => ({
  countActiveByOwner: mockCountActiveByOwner,
}));

jest.mock('../../src/utils/logger', () => {
  const child = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  });
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child };
});

// Must set env BEFORE requiring guardrails
process.env.STORE_CREATION_COOLDOWN_MS = '5000'; // 5s for fast tests

const { enforceStoreLimit, enforceCreationCooldown, validateEngine } = require('../../src/middleware/guardrails');

function mockReq(overrides = {}) {
  return {
    user: { id: 'user-1', role: 'tenant' },
    body: {},
    requestId: 'req_test',
    ...overrides,
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enforceStoreLimit', () => {
    it('should allow creation when under limit', async () => {
      mockCountActiveByOwner.mockResolvedValue(2);
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      await enforceStoreLimit(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject when at limit', async () => {
      mockCountActiveByOwner.mockResolvedValue(5);
      const req = mockReq();
      const res = mockRes();
      const next = jest.fn();

      await enforceStoreLimit(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('enforceCreationCooldown', () => {
    it('should allow first creation', () => {
      const req = mockReq({ user: { id: 'cooldown-user-1', role: 'tenant' } });
      const res = mockRes();
      const next = jest.fn();

      enforceCreationCooldown(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('should block rapid second creation', () => {
      const req = mockReq({ user: { id: 'cooldown-user-2', role: 'tenant' } });
      const res = mockRes();
      const next1 = jest.fn();
      const next2 = jest.fn();

      enforceCreationCooldown(req, res, next1);
      enforceCreationCooldown(req, res, next2);
      expect(next2).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 429 }));
    });

    it('should bypass cooldown for admins', () => {
      const req = mockReq({ user: { id: 'admin-user-1', role: 'admin' } });
      const res = mockRes();
      const next = jest.fn();

      enforceCreationCooldown(req, res, next);
      enforceCreationCooldown(req, res, next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('validateEngine', () => {
    it('should allow woocommerce', () => {
      const req = mockReq({ body: { engine: 'woocommerce' } });
      const res = mockRes();
      const next = jest.fn();

      validateEngine(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should allow medusa', () => {
      const req = mockReq({ body: { engine: 'medusa' } });
      const res = mockRes();
      const next = jest.fn();

      validateEngine(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should reject unsupported engine', () => {
      const req = mockReq({ body: { engine: 'shopify' } });
      const res = mockRes();
      const next = jest.fn();

      validateEngine(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'UNSUPPORTED_ENGINE' }),
      }));
    });

    it('should pass through when no engine specified', () => {
      const req = mockReq({ body: {} });
      const res = mockRes();
      const next = jest.fn();

      validateEngine(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});
