const escapeLabelValue = (value) =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/"/g, '\\"');

const escapeHelp = (value) =>
  String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

const normalizeLabels = (labels = {}, labelNames = []) => {
  if (!labels || typeof labels !== "object") {
    throw new Error("Labels must be an object.");
  }
  if (labelNames.length === 0) {
    const ordered = {};
    for (const key of Object.keys(labels).sort()) {
      ordered[key] = labels[key];
    }
    return ordered;
  }
  const missing = labelNames.filter((name) => !(name in labels));
  const extra = Object.keys(labels).filter((name) => !labelNames.includes(name));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (extra.length) parts.push(`extra: ${extra.join(", ")}`);
    throw new Error(`Invalid label set (${parts.join("; ")}).`);
  }
  const ordered = {};
  for (const name of labelNames) {
    ordered[name] = labels[name];
  }
  return ordered;
};

class Counter {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }

  inc(labels = {}, value = 1) {
    const normalizedLabels = normalizeLabels(labels, this.labelNames);
    const key = JSON.stringify(normalizedLabels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  expose() {
    let output = `# HELP ${this.name} ${escapeHelp(this.help)}\n`;
    output += `# TYPE ${this.name} counter\n`;
    for (const [key, value] of this.values) {
      const labels = JSON.parse(key);
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
        .join(",");
      output += labelStr
        ? `${this.name}{${labelStr}} ${value}\n`
        : `${this.name} ${value}\n`;
    }
    return output;
  }
}

class Gauge {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }

  set(labels = {}, value) {
    const normalizedLabels = normalizeLabels(labels, this.labelNames);
    const key = JSON.stringify(normalizedLabels);
    this.values.set(key, value);
  }

  inc(labels = {}, value = 1) {
    const normalizedLabels = normalizeLabels(labels, this.labelNames);
    const key = JSON.stringify(normalizedLabels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  dec(labels = {}, value = 1) {
    const normalizedLabels = normalizeLabels(labels, this.labelNames);
    const key = JSON.stringify(normalizedLabels);
    this.values.set(key, (this.values.get(key) || 0) - value);
  }

  expose() {
    let output = `# HELP ${this.name} ${escapeHelp(this.help)}\n`;
    output += `# TYPE ${this.name} gauge\n`;
    for (const [key, value] of this.values) {
      const labels = JSON.parse(key);
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
        .join(",");
      output += labelStr
        ? `${this.name}{${labelStr}} ${value}\n`
        : `${this.name} ${value}\n`;
    }
    return output;
  }
}

class Histogram {
  constructor(
    name,
    help,
    buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ) {
    this.name = name;
    this.help = help;
    this.buckets = buckets;
    this.counts = new Map();
    this.sums = new Map();
    this.bucketCounts = new Map();
  }

  observe(labels = {}, value) {
    const normalizedLabels = normalizeLabels(labels);
    const key = JSON.stringify(normalizedLabels);
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    this.sums.set(key, (this.sums.get(key) || 0) + value);
    if (!this.bucketCounts.has(key)) {
      this.bucketCounts.set(key, new Array(this.buckets.length).fill(0));
    }
    const bc = this.bucketCounts.get(key);
    this.buckets.forEach((bucket, i) => {
      if (value <= bucket) bc[i]++;
    });
  }

  expose() {
    let output = `# HELP ${this.name} ${escapeHelp(this.help)}\n`;
    output += `# TYPE ${this.name} histogram\n`;
    for (const [key, count] of this.counts) {
      const labels = JSON.parse(key);
      const baseLabelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
        .join(",");
      const bc = this.bucketCounts.get(key);
      this.buckets.forEach((bucket, i) => {
        const bucketLabel = baseLabelStr
          ? `${baseLabelStr},le="${escapeLabelValue(bucket)}"`
          : `le="${escapeLabelValue(bucket)}"`;
        output += `${this.name}_bucket{${bucketLabel}} ${bc[i]}\n`;
      });
      const infLabel = baseLabelStr
        ? `${baseLabelStr},le="${escapeLabelValue("+Inf")}"`
        : `le="${escapeLabelValue("+Inf")}"`;
      output += `${this.name}_bucket{${infLabel}} ${count}\n`;
      output += baseLabelStr
        ? `${this.name}_sum{${baseLabelStr}} ${this.sums.get(key)}\n`
        : `${this.name}_sum ${this.sums.get(key)}\n`;
      output += baseLabelStr
        ? `${this.name}_count{${baseLabelStr}} ${count}\n`
        : `${this.name}_count ${count}\n`;
    }
    return output;
  }
}

class Registry {
  constructor() {
    this.metrics = [];
  }

  register(metric) {
    this.metrics.push(metric);
    return metric;
  }

  expose() {
    return this.metrics.map((m) => m.expose()).join("\n");
  }
}

const registry = new Registry();

const httpRequestsTotal = registry.register(
  new Counter("http_requests_total", "Total number of HTTP requests", [
    "method",
    "path",
    "status",
  ]),
);

const httpRequestDuration = registry.register(
  new Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
  ),
);

const activeConnections = registry.register(
  new Gauge("active_connections", "Number of active connections"),
);

const memoryUsage = registry.register(
  new Gauge("process_memory_bytes", "Process memory usage in bytes", ["type"]),
);

module.exports = {
  registry,
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
  memoryUsage,
};
