const client = require("prom-client");

client.collectDefaultMetrics();

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
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
};
