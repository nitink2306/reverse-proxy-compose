const client = require("prom-client");

client.collectDefaultMetrics();

const processMemoryBytes = new client.Gauge({
  name: "process_memory_bytes",
  help: "Process memory usage in bytes",
  labelNames: ["type"],
});

const updateProcessMemoryBytes = () => {
  const memoryUsage = process.memoryUsage();
  processMemoryBytes.set({ type: "rss" }, memoryUsage.rss);
  processMemoryBytes.set({ type: "heapTotal" }, memoryUsage.heapTotal);
  processMemoryBytes.set({ type: "heapUsed" }, memoryUsage.heapUsed);
  processMemoryBytes.set({ type: "external" }, memoryUsage.external);
  if (typeof memoryUsage.arrayBuffers === "number") {
    processMemoryBytes.set(
      { type: "arrayBuffers" },
      memoryUsage.arrayBuffers,
    );
  }
};

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "path", "status"],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const activeConnections = new client.Gauge({
  name: "active_connections",
  help: "Number of active connections",
});

module.exports = {
  register: client.register,
  updateProcessMemoryBytes,
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
};
