'use strict';

/**
 * Integration tests for Store API endpoints and tenant isolation.
 * These tests require:
 * - Backend running on localhost:3001
 * - PostgreSQL running with correct schema
 * 
 * Run: npm test -- --testPathPattern=integration/stores
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
let adminToken;
let tenantAToken, tenantAId;
let tenantBToken, tenantBId;
let storeAId, storeBId;

describe('Store API (/api/v1/stores)', () => {
  // Setup: login admin, register 2 tenants
  beforeAll(async () => {
    // Login as existing admin
    const adminRes = await request('POST', '/auth/login', {
      body: { email: 'admin@example.com', password: 'admin123!' },
    });
    adminToken = adminRes.data.token;

    // Register tenant A
    const aRes = await request('POST', '/auth/register', {
      body: { email: `storetest-a-${testId}@test.com`, username: `sta${testId}`, password: 'testpass123' },
    });
    if (aRes.status === 201) {
      tenantAToken = aRes.data.token;
      tenantAId = aRes.data.user.id;
    }

    // Register tenant B
    const bRes = await request('POST', '/auth/register', {
      body: { email: `storetest-b-${testId}@test.com`, username: `stb${testId}`, password: 'testpass123' },
    });
    if (bRes.status === 201) {
      tenantBToken = bRes.data.token;
      tenantBId = bRes.data.user.id;
    }
  });

  describe('POST /stores — Store Creation', () => {
    it('creates a store for tenant A', async () => {
      const res = await request('POST', '/stores', {
        token: tenantAToken,
        body: { name: `test-a-${testId}`, engine: 'woocommerce' },
      });
      expect(res.status).toBe(202);
      expect(res.data.store).toBeDefined();
      expect(res.data.store.id).toMatch(/^store-[a-f0-9]{8}$/);
      storeAId = res.data.store.id;
    });

    it('creates a store for tenant B', async () => {
      // Wait briefly to avoid cooldown
      await new Promise(r => setTimeout(r, 100));
      const res = await request('POST', '/stores', {
        token: tenantBToken,
        body: { name: `test-b-${testId}`, engine: 'woocommerce' },
      });
      expect(res.status).toBe(202);
      storeBId = res.data.store.id;
    });

    it('rejects reserved store names', async () => {
      const res = await request('POST', '/stores', {
        token: adminToken,
        body: { name: 'admin', engine: 'woocommerce' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects store names with consecutive hyphens', async () => {
      const res = await request('POST', '/stores', {
        token: adminToken,
        body: { name: 'bad--name', engine: 'woocommerce' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects unsupported engine', async () => {
      const res = await request('POST', '/stores', {
        token: adminToken,
        body: { name: `test-eng-${testId}`, engine: 'shopify' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects unauthenticated requests', async () => {
      const res = await request('POST', '/stores', {
        body: { name: 'unauth-store', engine: 'woocommerce' },
      });
      expect(res.status).toBe(401);
    });

    it('ignores injected ownerId in body', async () => {
      const res = await request('POST', '/stores', {
        token: tenantAToken,
        body: { name: `inject-${testId}`, engine: 'woocommerce', ownerId: 'hacker' },
      });
      // Should succeed (ownerId stripped) or fail for other reasons — not assigned to 'hacker'
      if (res.status === 202) {
        // Verify tenant A can see it (owner is them, not 'hacker')
        const check = await request('GET', `/stores/${res.data.store.id}`, { token: tenantAToken });
        expect(check.status).toBe(200);
      }
    });
  });

  describe('GET /stores — List with Tenant Isolation', () => {
    it('tenant A sees only their stores', async () => {
      const res = await request('GET', '/stores?limit=100', { token: tenantAToken });
      expect(res.status).toBe(200);
      const names = res.data.stores.map(s => s.name);
      expect(names).not.toContain(`test-b-${testId}`);
    });

    it('tenant B sees only their stores', async () => {
      const res = await request('GET', '/stores?limit=100', { token: tenantBToken });
      expect(res.status).toBe(200);
      const names = res.data.stores.map(s => s.name);
      expect(names).not.toContain(`test-a-${testId}`);
    });

    it('admin sees all stores', async () => {
      const res = await request('GET', '/stores?limit=100', { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.data.total).toBeGreaterThanOrEqual(2);
    });

    it('rejects unauthenticated list', async () => {
      const res = await request('GET', '/stores');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /stores/:id — Cross-Tenant Detail Access', () => {
    it('tenant A can view own store', async () => {
      if (!storeAId) return;
      const res = await request('GET', `/stores/${storeAId}`, { token: tenantAToken });
      expect(res.status).toBe(200);
    });

    it('tenant B CANNOT view tenant A store', async () => {
      if (!storeAId) return;
      const res = await request('GET', `/stores/${storeAId}`, { token: tenantBToken });
      expect(res.status).toBe(403);
    });

    it('admin CAN view any store', async () => {
      if (!storeAId) return;
      const res = await request('GET', `/stores/${storeAId}`, { token: adminToken });
      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent store', async () => {
      const res = await request('GET', '/stores/store-00000000', { token: adminToken });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /stores/:id/logs — Cross-Tenant Log Access', () => {
    it('tenant A can view own store logs', async () => {
      if (!storeAId) return;
      const res = await request('GET', `/stores/${storeAId}/logs`, { token: tenantAToken });
      expect(res.status).toBe(200);
      expect(res.data.logs).toBeDefined();
    });

    it('tenant B CANNOT view tenant A store logs', async () => {
      if (!storeAId) return;
      const res = await request('GET', `/stores/${storeAId}/logs`, { token: tenantBToken });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /stores/:id — Cross-Tenant Delete', () => {
    it('tenant B CANNOT delete tenant A store', async () => {
      if (!storeAId) return;
      const res = await request('DELETE', `/stores/${storeAId}`, { token: tenantBToken });
      expect(res.status).toBe(403);
    });
  });
});
