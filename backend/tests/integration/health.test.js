'use strict';

/**
 * Integration tests for Health and Metrics endpoints.
 * 
 * Run: npm test -- --testPathPattern=integration/health
 */

const BASE = 'http://localhost:3001/api/v1';

describe('Health & Metrics API', () => {
  describe('GET /health', () => {
    it('returns health status with checks', async () => {
      const res = await fetch(`${BASE}/health`);
      const data = await res.json();

      // 200 = fully healthy, 503 = degraded (e.g. no K8s in CI)
      expect([200, 503]).toContain(res.status);
      expect(data.status).toBeDefined();
      expect(data.checks).toBeDefined();
      expect(data.checks.database).toBeDefined();
      expect(data.checks.kubernetes).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });

    it('reports database health', async () => {
      const res = await fetch(`${BASE}/health`);
      const data = await res.json();

      expect(data.checks.database.status).toBe('healthy');
    });
  });

  describe('GET /metrics', () => {
    it('returns Prometheus text format', async () => {
      const res = await fetch(`${BASE}/metrics`);
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(text).toContain('process_uptime_seconds');
    });
  });

  describe('GET /metrics/json', () => {
    it('returns JSON metrics summary', async () => {
      const res = await fetch(`${BASE}/metrics/json`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.uptime).toBeDefined();
      expect(typeof data.uptime).toBe('number');
      expect(data.memoryUsage).toBeDefined();
      expect(data.circuitBreakers).toBeDefined();
      expect(Array.isArray(data.circuitBreakers)).toBe(true);
    });
  });

  describe('Root endpoint', () => {
    it('returns platform info', async () => {
      const res = await fetch('http://localhost:3001/');
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.name).toContain('Multi-Tenant');
      expect(data.endpoints).toBeDefined();
    });
  });

  describe('404 handler', () => {
    it('returns structured error for unknown routes', async () => {
      const res = await fetch(`${BASE}/nonexistent`);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });
});
