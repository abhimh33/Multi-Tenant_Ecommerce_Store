'use strict';

/**
 * Tests for middleware/requestTimeout.js
 */

const requestTimeout = require('../../src/middleware/requestTimeout');

function mockReq() {
  return {
    requestId: 'req_test',
    method: 'GET',
    path: '/test',
    setTimeout: jest.fn(),
  };
}

function mockRes() {
  const handlers = {};
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    _handlers: handlers,
  };
  return res;
}

describe('requestTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should call next immediately', () => {
    const middleware = requestTimeout(1000);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should respond with 408 after timeout', () => {
    const middleware = requestTimeout(1000);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    jest.advanceTimersByTime(1001);

    expect(res.status).toHaveBeenCalledWith(408);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'REQUEST_TIMEOUT' }),
    }));
  });

  it('should not send 408 if response already sent', () => {
    const middleware = requestTimeout(1000);
    const req = mockReq();
    const res = mockRes();
    res.headersSent = true;
    const next = jest.fn();

    middleware(req, res, next);
    jest.advanceTimersByTime(1001);

    expect(res.status).not.toHaveBeenCalled();
  });

  it('should clear timer on finish', () => {
    const middleware = requestTimeout(5000);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    // Simulate 'finish' event
    const finishHandler = res.on.mock.calls.find(c => c[0] === 'finish')?.[1];
    expect(finishHandler).toBeDefined();
    finishHandler();

    // Advance past timeout — should NOT trigger 408
    jest.advanceTimersByTime(6000);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should use default timeout of 30s', () => {
    const middleware = requestTimeout();
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(req.setTimeout).toHaveBeenCalledWith(30000);
  });
});
