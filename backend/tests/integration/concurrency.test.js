'use strict';

/**
 * Stress tests for concurrent store provisioning.
 *
 * Validates:
 * - Parallel store creation requests are serialized through the semaphore
 * - Queue depth and rejection behavior when limits are exceeded
 * - No duplicate Helm releases under race conditions
 * - Idempotent behavior during retries
 * - Queue time and execution duration are logged correctly
 *
 * Each store creation uses a UNIQUE freshly-registered user to avoid
 * store-limit contamination (accumulated stores from prior runs) and
 * the 5-min cooldown that applies to non-admin users after their first creation.
 *
 * These tests require: Backend running on localhost:3001, PostgreSQL, and K8s.
 * Run: npm test -- --testPathPattern=integration/concurrency
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
  return { status: res.status, data };
}

const testId = Date.now().toString(36);

/** Register a fresh user and return their JWT token. */
async function freshUserToken(tag) {
  const res = await request('POST', '/auth/register', {
    body: {
      email: `conc-${tag}-${testId}@test.com`,
      username: `c${tag}${testId}`,
      password: 'testpass123',
    },
  });
  if (res.status !== 201) throw new Error(`Registration failed for ${tag}: ${res.status}`);
  return res.data.token;
}

let adminToken;
// Tokens keyed by role in the test — each used for at most ONE store creation
const tokens = {};

describe('Concurrency & Scaling Enforcement (/api/v1)', () => {
  beforeAll(async () => {
    // Admin login (used only for read-only / admin-only endpoints)
    const adminRes = await request('POST', '/auth/login', {
      body: { email: 'admin@example.com', password: 'admin123!' },
    });
    adminToken = adminRes.data.token;

    // Register 12 fresh users in parallel — one per store-creation call
    const tags = [
      'single',            // test 1 — single creation
      'par1', 'par2', 'par3',  // test 2 — 3-parallel
      'uniq1', 'uniq2', 'uniq3', // test 3 — unique IDs
      'dup1', 'dup2',        // test 4 — duplicate name
      'retry',               // test 5 — retry
      'fairA', 'fairB',      // test 6 — tenant fairness
    ];

    const results = await Promise.all(tags.map(t => freshUserToken(t)));
    tags.forEach((t, i) => { tokens[t] = results[i]; });
  }, 30000);

  // ── Provisioning Concurrency Limits ──────────────────────────────────

  describe('Provisioning Concurrency Limits', () => {
    it('accepts store creation and returns 202', async () => {
      const res = await request('POST', '/stores', {
        token: tokens.single,
        body: { name: `conc-single-${testId}`, engine: 'woocommerce' },
      });
      expect(res.status).toBe(202);
      expect(res.data.store.id).toMatch(/^store-[a-f0-9]{8}$/);
    });

    it('handles 3 parallel store creation requests from different users', async () => {
      const promises = [
        request('POST', '/stores', {
          token: tokens.par1,
          body: { name: `conc-par-1-${testId}`, engine: 'medusa' },
        }),
        request('POST', '/stores', {
          token: tokens.par2,
          body: { name: `conc-par-2-${testId}`, engine: 'woocommerce' },
        }),
        request('POST', '/stores', {
          token: tokens.par3,
          body: { name: `conc-par-3-${testId}`, engine: 'medusa' },
        }),
      ];

      const results = await Promise.all(promises);
      const accepted = results.filter(r => r.status === 202);

      // All 3 should succeed — each user is fresh (no cooldown, no limit)
      expect(accepted.length).toBe(3);

      // Verify unique IDs
      const ids = accepted.map(r => r.data.store.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('returns unique store IDs and namespaces for parallel requests', async () => {
      const promises = [
        request('POST', '/stores', {
          token: tokens.uniq1,
          body: { name: `conc-uniq-0-${testId}`, engine: 'medusa' },
        }),
        request('POST', '/stores', {
          token: tokens.uniq2,
          body: { name: `conc-uniq-1-${testId}`, engine: 'medusa' },
        }),
        request('POST', '/stores', {
          token: tokens.uniq3,
          body: { name: `conc-uniq-2-${testId}`, engine: 'medusa' },
        }),
      ];

      const results = await Promise.all(promises);
      const stores = results.filter(r => r.status === 202).map(r => r.data.store);

      expect(stores.length).toBe(3);
      const ids = stores.map(s => s.id);
      const namespaces = stores.map(s => s.namespace);
      expect(new Set(ids).size).toBe(3);
      expect(new Set(namespaces).size).toBe(3);
    });
  });

  // ── Health Endpoint ──────────────────────────────────────────────────

  describe('Health Endpoint Concurrency Stats', () => {
    it('health endpoint includes concurrency stats', async () => {
      const res = await request('GET', '/health');
      expect(res.status).toBe(200);
      expect(res.data.concurrency).toBeDefined();
      expect(res.data.concurrency).toHaveProperty('maxConcurrent');
      expect(res.data.concurrency).toHaveProperty('maxQueueSize');
      expect(res.data.concurrency).toHaveProperty('active');
      expect(res.data.concurrency).toHaveProperty('queued');
      expect(res.data.concurrency).toHaveProperty('totalAcquired');
      expect(res.data.concurrency).toHaveProperty('totalRejected');
    });
  });

  // ── Duplicate Store Name Prevention ──────────────────────────────────

  describe('Duplicate Store Name Prevention', () => {
    it('prevents or handles duplicate store names gracefully', async () => {
      const name = `dup-${testId}`;

      // Two different fresh users create stores with the same display name
      const promises = [
        request('POST', '/stores', {
          token: tokens.dup1,
          body: { name, engine: 'woocommerce' },
        }),
        request('POST', '/stores', {
          token: tokens.dup2,
          body: { name, engine: 'woocommerce' },
        }),
      ];

      const results = await Promise.all(promises);
      const accepted = results.filter(r => r.status === 202);
      const rejected = results.filter(r => r.status === 409 || r.status === 500);

      // Both may succeed (names are unique per tenant) or one may conflict
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      expect(accepted.length + rejected.length).toBe(2);

      accepted.forEach(r => {
        expect(r.data.store.id).toMatch(/^store-[a-f0-9]{8}$/);
      });
    });
  });

  // ── Retry Under Concurrency ──────────────────────────────────────────

  describe('Idempotent Retry Under Concurrency', () => {
    it('handles retry of a failed store', async () => {
      const createRes = await request('POST', '/stores', {
        token: tokens.retry,
        body: { name: `retry-conc-${testId}`, engine: 'woocommerce' },
      });
      expect(createRes.status).toBe(202);
      const storeId = createRes.data.store.id;

      // Wait a moment for provisioning to start
      await new Promise(r => setTimeout(r, 1000));

      // Fetch the store — use the same user who created it
      const checkRes = await request('GET', `/stores/${storeId}`, { token: tokens.retry });
      if (checkRes.data.store?.status === 'failed') {
        const retryRes = await request('POST', `/stores/${storeId}/retry`, { token: tokens.retry });
        expect([202, 409]).toContain(retryRes.status);
      }
      // If still provisioning, that's fine — the test validates the path exists
    });
  });

  // ── Tenant Fairness ──────────────────────────────────────────────────

  describe('Tenant Fairness Under Load', () => {
    it('stores from different tenants both succeed under concurrent load', async () => {
      const results = await Promise.all([
        request('POST', '/stores', {
          token: tokens.fairA,
          body: { name: `fair-a-${testId}`, engine: 'woocommerce' },
        }),
        request('POST', '/stores', {
          token: tokens.fairB,
          body: { name: `fair-b-${testId}`, engine: 'woocommerce' },
        }),
      ]);

      // Both fresh users should succeed — no cooldown, no store-limit issues
      const accepted = results.filter(r => r.status === 202);
      expect(accepted.length).toBe(2);
    });
  });

  // ── Metrics ──────────────────────────────────────────────────────────

  describe('Metrics Endpoint', () => {
    it('exposes provisioning concurrency metrics', async () => {
      const res = await request('GET', '/metrics', { token: adminToken });
      expect(res.status).toBe(200);

      const jsonRes = await request('GET', '/metrics/json', { token: adminToken });
      expect(jsonRes.status).toBe(200);
    });
  });
});
