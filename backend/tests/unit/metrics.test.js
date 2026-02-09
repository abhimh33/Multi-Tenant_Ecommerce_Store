'use strict';

const {
  Counter,
  Gauge,
  Histogram,
  serializeMetrics,
} = require('../../src/utils/metrics');

describe('Metrics', () => {
  describe('Counter', () => {
    it('increments correctly', () => {
      const counter = new Counter('test_counter', 'A test counter', ['method']);
      counter.inc({ method: 'GET' });
      counter.inc({ method: 'GET' });
      counter.inc({ method: 'POST' });

      const output = counter.serialize();
      expect(output).toContain('# TYPE test_counter counter');
      expect(output).toContain('test_counter{method="GET"} 2');
      expect(output).toContain('test_counter{method="POST"} 1');
    });

    it('increments by custom value', () => {
      const counter = new Counter('test2', 'help', []);
      counter.inc({}, 5);
      expect(counter.serialize()).toContain('test2 5');
    });
  });

  describe('Gauge', () => {
    it('sets and gets values', () => {
      const gauge = new Gauge('test_gauge', 'A test gauge', ['status']);
      gauge.set({ status: 'ready' }, 10);
      gauge.set({ status: 'failed' }, 2);

      const output = gauge.serialize();
      expect(output).toContain('# TYPE test_gauge gauge');
      expect(output).toContain('test_gauge{status="ready"} 10');
      expect(output).toContain('test_gauge{status="failed"} 2');
    });

    it('increments and decrements', () => {
      const gauge = new Gauge('test_gauge2', 'help', []);
      gauge.inc({}, 5);
      gauge.dec({}, 2);
      expect(gauge.serialize()).toContain('test_gauge2 3');
    });
  });

  describe('Histogram', () => {
    it('observes values into buckets', () => {
      const hist = new Histogram('test_hist', 'A test histogram', [], [10, 50, 100]);
      hist.observe({}, 5);
      hist.observe({}, 25);
      hist.observe({}, 75);
      hist.observe({}, 200);

      const output = hist.serialize();
      expect(output).toContain('# TYPE test_hist histogram');
      expect(output).toContain('test_hist_bucket{le="10"} 1');
      expect(output).toContain('test_hist_bucket{le="50"} 2');
      expect(output).toContain('test_hist_bucket{le="100"} 3');
      expect(output).toContain('test_hist_bucket{le="+Inf"} 4');
      expect(output).toContain('test_hist_count{} 4');
      expect(output).toContain('test_hist_sum{} 305');
    });
  });

  describe('serializeMetrics', () => {
    it('returns a string in Prometheus format', () => {
      const output = serializeMetrics();
      expect(typeof output).toBe('string');
      // Should at least contain process uptime
      expect(output).toContain('process_uptime_seconds');
    });
  });
});
