'use strict';

/**
 * Tests for middleware/errorHandler.js
 * Covers all error types: AppError, Joi, state transition, and unexpected errors.
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

const errorHandler = require('../../src/middleware/errorHandler');
const { AppError, NotFoundError, ValidationError, ConflictError } = require('../../src/utils/errors');

function mockReq() {
  return {
    requestId: 'req_test123',
    path: '/test',
    method: 'POST',
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('errorHandler', () => {
  it('should handle AppError with correct status code', () => {
    const err = new NotFoundError('Store', 'store-abc12345');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req_test123',
      error: expect.objectContaining({
        code: 'STORE_NOT_FOUND',
      }),
    }));
  });

  it('should handle ConflictError', () => {
    const err = new ConflictError('Store name already taken');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('should handle Joi ValidationError', () => {
    const err = { isJoi: true, message: 'Invalid input', details: [] };
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
      }),
    }));
  });

  it('should handle state transition errors', () => {
    const err = { code: 'INVALID_STATE_TRANSITION', message: 'Cannot transition' };
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'INVALID_STATE_TRANSITION',
      }),
    }));
  });

  it('should handle unexpected errors with 500 and no stack trace', () => {
    const err = new Error('Something broke');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const responseBody = res.json.mock.calls[0][0];
    expect(responseBody.error.code).toBe('INTERNAL_ERROR');
    expect(responseBody.error.message).toBe('An unexpected error occurred.');
    // No stack trace leaked
    expect(responseBody.error.stack).toBeUndefined();
  });

  it('should include requestId in all error responses', () => {
    const err = new Error('test');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    errorHandler(err, req, res, next);
    const responseBody = res.json.mock.calls[0][0];
    expect(responseBody.requestId).toBeDefined();
  });
});
