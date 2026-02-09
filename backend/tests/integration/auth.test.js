'use strict';

/**
 * Integration tests for Auth API endpoints.
 * These tests require:
 * - Backend running on localhost:3001
 * - PostgreSQL running with correct schema
 * 
 * Run: npm test -- --testPathPattern=integration/auth
 */

const BASE = 'http://localhost:3001/api/v1';

async function request(method, path, { body, token } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: Object.fromEntries(res.headers) };
}

// Generate unique test email for each run
const testId = Date.now().toString(36);
const testEmail = `test-${testId}@integration.com`;
const testUsername = `testuser-${testId}`;
const testPassword = 'integrationPass123!';

let testToken;

describe('Auth API (/api/v1/auth)', () => {
  describe('POST /auth/register', () => {
    it('registers a new user with tenant role', async () => {
      const res = await request('POST', '/auth/register', {
        body: { email: testEmail, username: testUsername, password: testPassword },
      });
      expect(res.status).toBe(201);
      expect(res.data.user.email).toBe(testEmail);
      expect(res.data.user.role).toBe('tenant');
      expect(res.data.token).toBeDefined();
      testToken = res.data.token;
    });

    it('rejects duplicate email', async () => {
      const res = await request('POST', '/auth/register', {
        body: { email: testEmail, username: `dup-${testId}`, password: testPassword },
      });
      expect(res.status).toBe(409);
      expect(res.data.error.code).toBe('USER_EXISTS');
    });

    it('rejects invalid email', async () => {
      const res = await request('POST', '/auth/register', {
        body: { email: 'not-valid', username: 'test', password: testPassword },
      });
      expect(res.status).toBe(400);
    });

    it('rejects short password', async () => {
      const res = await request('POST', '/auth/register', {
        body: { email: `short-${testId}@example.com`, username: 'test', password: '123' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('logs in with correct credentials', async () => {
      const res = await request('POST', '/auth/login', {
        body: { email: testEmail, password: testPassword },
      });
      expect(res.status).toBe(200);
      expect(res.data.token).toBeDefined();
      expect(res.data.user.email).toBe(testEmail);
    });

    it('rejects wrong password', async () => {
      const res = await request('POST', '/auth/login', {
        body: { email: testEmail, password: 'wrongpassword' },
      });
      expect(res.status).toBe(401);
      expect(res.data.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects non-existent email', async () => {
      const res = await request('POST', '/auth/login', {
        body: { email: 'nonexistent@test.com', password: testPassword },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns user profile with valid token', async () => {
      const res = await request('GET', '/auth/me', { token: testToken });
      expect(res.status).toBe(200);
      expect(res.data.user.email).toBe(testEmail);
    });

    it('rejects request without token', async () => {
      const res = await request('GET', '/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects invalid token', async () => {
      const res = await request('GET', '/auth/me', { token: 'invalid.token.here' });
      expect(res.status).toBe(401);
    });
  });
});
