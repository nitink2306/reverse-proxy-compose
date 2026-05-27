// =============================================================================
// metrics.js
//
// Defines and exports all Prometheus metrics used by the API.
// This module is the single source of truth for metric definitions —
// index.js imports them and records values; this file only declares them.
//
// Three metric types are used:
//   Counter  — monotonically increasing (only goes up, resets on restart)
//   Gauge    — can go up and down (current snapshot of a value)
//   Histogram — tracks the distribution of values across predefined buckets
// =============================================================================

// prom-client is the official Node.js Prometheus client library.
// It handles metric registration, formatting, and the /metrics text output.
// `client` here is a module-level singleton — all metrics share the same registry.
const client = require("prom-client");

// Automatically register a standard set of Node.js and process metrics.
// This single call adds ~15 metrics with no extra code, including:
//   - process_cpu_seconds_total       (CPU usage)
//   - nodejs_eventloop_lag_seconds    (event loop health)
//   - nodejs_gc_duration_seconds      (garbage collector pauses)
//   - nodejs_heap_size_used_bytes     (V8 heap memory)
//   - nodejs_active_handles_total     (open sockets, timers, etc.)
// These are collected on an internal timer managed by prom-client.
client.collectDefaultMetrics();

// -----------------------------------------------------------------------------
// GAUGE: process_memory_bytes
//
// Tracks Node.js process memory across 5 dimensions, differentiated by the
// `type` label. A single gauge with labels is more efficient than 5 separate
// gauges — one metric name, multiple time series in Prometheus.
//
// Memory dimensions:
//   rss          — Resident Set Size: total RAM the OS has allocated to this
//                  process (heap + stack + code + C++ bindings)
//   heapTotal    — total V8 heap capacity currently reserved
//   heapUsed     — V8 heap actually in use; watch this for memory leak detection
//   external     — memory used by C++ objects bound to JS (e.g. Buffer)
//   arrayBuffers — memory held in ArrayBuffer / SharedArrayBuffer instances
//
// This gauge is NOT self-updating — it must be driven by a setInterval
// in index.js via the exported `updateProcessMemoryBytes` function.
// -----------------------------------------------------------------------------
const processMemoryBytes = new client.Gauge({
  name: "process_memory_bytes",
  help: "Process memory usage in bytes",
  labelNames: ["type"], // each `type` value becomes a separate Prometheus time series
});

// Reads current memory snapshot from Node.js and pushes each dimension
// into the gauge. Called externally on a timer (every 10s in index.js).
//
// The arrayBuffers field is not guaranteed to exist on all runtimes —
// the guard avoids setting the gauge to `undefined` if the field is absent.
const updateProcessMemoryBytes = () => {
  // process.memoryUsage() returns a synchronous snapshot — no I/O involved
  const memoryUsage = process.memoryUsage();

  processMemoryBytes.set({ type: "rss" }, memoryUsage.rss);
  processMemoryBytes.set({ type: "heapTotal" }, memoryUsage.heapTotal);
  processMemoryBytes.set({ type: "heapUsed" }, memoryUsage.heapUsed);
  processMemoryBytes.set({ type: "external" }, memoryUsage.external);

  // arrayBuffers may not be present on all runtimes — guard prevents setting the gauge to NaN or undefined
  if (typeof memoryUsage.arrayBuffers === "number") {
    processMemoryBytes.set({ type: "arrayBuffers" }, memoryUsage.arrayBuffers);
  }
};

// -----------------------------------------------------------------------------
// COUNTER: http_requests_total
//
// Counts every HTTP request the API handles. Counters only ever go up and
// reset to 0 when the process restarts — they are never decremented.
//
// The 3-label combination (method + path + status) creates a separate time
// series for every unique combination, enabling fine-grained queries:
//
//   Total requests:
//     http_requests_total
//
//   Requests per second (rate over last 5 minutes):
//     rate(http_requests_total[5m])
//
//   Only failed POST requests:
//     http_requests_total{method="POST", status=~"5.."}
//
//   Error rate as a percentage:
//     rate(http_requests_total{status=~"5.."}[5m])
//     / rate(http_requests_total[5m]) * 100
// -----------------------------------------------------------------------------
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
});

// -----------------------------------------------------------------------------
// HISTOGRAM: http_request_duration_seconds
//
// Records the distribution of request durations. Unlike a counter (total) or
// gauge (current value), a histogram answers "how fast are most requests?" by
// sorting observations into predefined time buckets.
//
// Each bucket is cumulative: the "0.1" bucket counts all requests that took
// ≤100ms, not just those between 50ms and 100ms.
//
// The bucket range (5ms → 10s) is chosen to cover:
//   0.005  — very fast: health checks, cache hits
//   0.01   — fast: simple DB lookups
//   0.025  — normal: typical API response
//   0.05   — slightly slow: moderate DB query
//   0.1    — slow: complex query or light processing
//   0.25   — degraded: heavy query or multiple DB calls
//   0.5    — bad: network issues or slow external service
//   1      — very bad: timeout territory
//   2.5+   — critical: something is seriously wrong
//
// Prometheus percentile queries (PromQL):
//   P50 (median):   histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))
//   P95:            histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
//   P99:            histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
//
// prom-client automatically creates 3 series per histogram:
//   http_request_duration_seconds_bucket{le="0.005"} — the buckets
//   http_request_duration_seconds_sum                — total time spent
//   http_request_duration_seconds_count              — total observations
// -----------------------------------------------------------------------------
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// -----------------------------------------------------------------------------
// GAUGE: active_connections
//
// Tracks how many HTTP requests are currently being processed (in-flight).
// Incremented when a request arrives, decremented when it ends — whether it
// completes normally OR the client disconnects early.
//
// This is a real-time concurrency indicator. A sustained high value means:
//   - The server is under heavy load, OR
//   - Requests are hanging (slow DB, deadlock, external service timeout)
//
// Incremented/decremented in the metrics middleware in index.js, not here.
// No labels needed — we only care about the total count, not breakdown by route.
// -----------------------------------------------------------------------------
const activeConnections = new client.Gauge({
  name: "active_connections",
  help: "Number of active connections",
});

// -----------------------------------------------------------------------------
// Exports
//
// `register` — the global prom-client registry. Knows about all metrics
//              (custom ones above + default metrics from collectDefaultMetrics).
//              Calling register.metrics() serializes everything into the
//              Prometheus text exposition format that the scraper expects.
//
// `updateProcessMemoryBytes` — exported as a function so index.js can call
//                              it on a timer. Not auto-updating by design —
//                              the caller controls the polling frequency.
//
// The metric objects themselves (httpRequestsTotal, etc.) are exported so
// index.js middleware can call .inc(), .observe(), .dec() on them directly.
// -----------------------------------------------------------------------------
module.exports = {
  register: client.register,
  updateProcessMemoryBytes,
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
};
