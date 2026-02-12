'use strict';

/**
 * Lightweight Prometheus-compatible metrics collector.
 * No external dependency — writes plain text in Prometheus exposition format.
 * 
 * Metrics tracked:
 * - http_requests_total (counter) — total HTTP requests by method, route, status
 * - http_request_duration_ms (histogram) — request latency distribution
 * - stores_total (gauge) — current store count by status
 * - circuit_breaker_state (gauge) — circuit breaker states
 * - process_uptime_seconds (gauge) — process uptime
 */

class Counter {
  constructor(name, help, labels = []) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    this.values = new Map();
  }

  inc(labelValues = {}, value = 1) {
    const key = this._key(labelValues);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  _key(labelValues) {
    return this.labels.map(l => `${l}="${labelValues[l] || ''}"`).join(',');
  }

  serialize() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      const labels = key ? `{${key}}` : '';
      lines.push(`${this.name}${labels} ${value}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  constructor(name, help, labels = []) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    this.values = new Map();
  }

  set(labelValues = {}, value) {
    const key = this._key(labelValues);
    this.values.set(key, value);
  }

  inc(labelValues = {}, value = 1) {
    const key = this._key(labelValues);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  dec(labelValues = {}, value = 1) {
    const key = this._key(labelValues);
    this.values.set(key, (this.values.get(key) || 0) - value);
  }

  _key(labelValues) {
    return this.labels.map(l => `${l}="${labelValues[l] || ''}"`).join(',');
  }

  serialize() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      const labels = key ? `{${key}}` : '';
      lines.push(`${this.name}${labels} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  constructor(name, help, labels = [], buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
    this.name = name;
    this.help = help;
    this.labels = labels;
    this.buckets = buckets;
    this.observations = new Map(); // key -> { count, sum, bucketCounts[] }
  }

  observe(labelValues = {}, value) {
    const key = this._key(labelValues);
    if (!this.observations.has(key)) {
      this.observations.set(key, {
        count: 0,
        sum: 0,
        bucketCounts: new Array(this.buckets.length + 1).fill(0), // +1 for +Inf
      });
    }
    const obs = this.observations.get(key);
    obs.count++;
    obs.sum += value;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        obs.bucketCounts[i]++;
      }
    }
    obs.bucketCounts[this.buckets.length]++; // +Inf always increments
  }

  _key(labelValues) {
    return this.labels.map(l => `${l}="${labelValues[l] || ''}"`).join(',');
  }

  serialize() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, obs] of this.observations) {
      const baseLabels = key ? `${key},` : '';
      for (let i = 0; i < this.buckets.length; i++) {
        lines.push(`${this.name}_bucket{${baseLabels}le="${this.buckets[i]}"} ${obs.bucketCounts[i]}`);
      }
      lines.push(`${this.name}_bucket{${baseLabels}le="+Inf"} ${obs.bucketCounts[this.buckets.length]}`);
      lines.push(`${this.name}_sum{${key || ''}} ${obs.sum}`);
      lines.push(`${this.name}_count{${key || ''}} ${obs.count}`);
    }
    return lines.join('\n');
  }
}

// ─── Metric Instances ────────────────────────────────────────────────────────

const httpRequestsTotal = new Counter(
  'http_requests_total',
  'Total number of HTTP requests',
  ['method', 'route', 'status_code']
);

const httpRequestDurationMs = new Histogram(
  'http_request_duration_ms',
  'HTTP request duration in milliseconds',
  ['method', 'route']
);

const storesTotal = new Gauge(
  'stores_total',
  'Current number of stores by status',
  ['status']
);

const provisioningDuration = new Histogram(
  'store_provisioning_duration_ms',
  'Store provisioning duration in milliseconds',
  ['engine'],
  [5000, 10000, 30000, 60000, 120000, 300000, 600000]
);

const activeProvisioningOps = new Gauge(
  'active_provisioning_operations',
  'Number of currently active provisioning operations',
  []
);

const processUptimeSeconds = new Gauge(
  'process_uptime_seconds',
  'Process uptime in seconds',
  []
);

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware to collect request metrics.
 * Tracks request count and duration.
 */
function metricsMiddleware(req, res, next) {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    // Normalize route path to avoid cardinality explosion
    const route = normalizeRoute(req.route?.path || req.path, req.method);
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);
    httpRequestDurationMs.observe({ method: req.method, route }, durationMs);
  });

  next();
}

/**
 * Normalize route paths to avoid high cardinality.
 * Replace UUIDs, store IDs, etc. with placeholders.
 */
function normalizeRoute(path, _method) {
  return path
    .replace(/store-[a-f0-9]{8}/g, ':id')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':uuid')
    .replace(/\/\d+\b/g, '/:num') || '/';
}

/**
 * Serialize all metrics in Prometheus exposition format.
 * @returns {string}
 */
function serializeMetrics() {
  // Update dynamic gauges
  processUptimeSeconds.set({}, Math.floor(process.uptime()));

  const metrics = [
    httpRequestsTotal,
    httpRequestDurationMs,
    storesTotal,
    provisioningDuration,
    activeProvisioningOps,
    processUptimeSeconds,
  ];

  return metrics
    .map(m => m.serialize())
    .filter(s => s.split('\n').length > 2) // Only include metrics with data
    .join('\n\n') + '\n';
}

module.exports = {
  // Metric instances
  httpRequestsTotal,
  httpRequestDurationMs,
  storesTotal,
  provisioningDuration,
  activeProvisioningOps,
  processUptimeSeconds,
  // Utilities
  metricsMiddleware,
  serializeMetrics,
  // Classes (for testing)
  Counter,
  Gauge,
  Histogram,
};
