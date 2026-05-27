// =============================================================================
// index.js
//
// Entry point and application factory for the Express API.
//
// Two responsibilities:
//   1. createApp(pool) — builds and returns the Express app (importable,
//                        testable, no side effects)
//   2. Boot block       — creates the real DB pool and starts the HTTP server
//                        (only runs when executed directly: `node index.js`)
//
// This separation is the Dependency Injection pattern: the database pool is
// passed in rather than created inside createApp, so tests can substitute a
// mock pool without needing a real Postgres instance or environment variables.
// =============================================================================

const express = require("express");

// Pool manages a set of reusable Postgres connections.
// Rather than opening and closing a TCP connection per request (slow),
// the pool keeps connections alive and lends them out on demand.
const { Pool } = require("pg");

// Import all metric instruments defined in metrics.js.
// This file only *uses* them (calls .inc(), .observe(), etc.) —
// metrics.js is the single place where they are defined and registered.
const {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
  updateProcessMemoryBytes,
} = require("./metrics");

// =============================================================================
// createApp(pool)
//
// Factory function that wires together middleware and routes, then returns
// the configured Express app. Accepts a `pool` argument so the caller
// decides which database to use — real in production, mock in tests.
// =============================================================================
function createApp(pool) {
  const app = express();

  // Parse incoming JSON request bodies into req.body.
  // Without this, req.body would be undefined for POST /messages.
  app.use(express.json());

  // ---------------------------------------------------------------------------
  // MIDDLEWARE: Request metrics capture
  //
  // Runs before every route handler. Tracks three things:
  //   1. active_connections gauge — how many requests are in-flight right now
  //   2. http_requests_total counter — total requests, labelled by method/path/status
  //   3. http_request_duration_seconds histogram — how long each request took
  //
  // Key design: uses both "finish" and "close" response events to handle both
  // normal completions and early client disconnections correctly.
  // ---------------------------------------------------------------------------
  app.use((req, res, next) => {
    // Capture start time using the high-resolution monotonic clock.
    // process.hrtime.bigint() returns nanoseconds as a BigInt.
    // We use this instead of Date.now() because:
    //   - Resolution: nanoseconds vs milliseconds
    //   - Monotonic: unaffected by system clock changes (NTP, DST adjustments)
    const start = process.hrtime.bigint();

    // A request has arrived — increment the in-flight counter immediately,
    // before next() is called, so even slow requests are counted from the start.
    activeConnections.inc();

    // Guard flag that ensures finalize() is called at most once per request.
    // Both "finish" and "close" can fire on the same response; without this
    // flag, activeConnections would be decremented twice — going negative.
    let finished = false;

    // finalize is called when the request lifecycle ends, either normally or
    // via early client disconnection. The `recordMetrics` parameter controls
    // whether duration/count metrics are recorded (only valid if a response
    // was actually sent).
    const finalize = (recordMetrics) => {
      // Idempotency guard — only the first call does anything.
      // The second call (from whichever event fires second) returns immediately.
      if (finished) return;
      finished = true;

      // Always decrement — whether the request finished or the client dropped.
      // This keeps the gauge accurate and prevents it from growing unboundedly.
      activeConnections.dec();

      // Skip recording duration/count metrics if the client disconnected before
      // the server sent a response. There is no valid status code or meaningful
      // duration to record in that case — it would corrupt the metrics.
      if (!recordMetrics) return;

      // Calculate elapsed time in seconds.
      // process.hrtime.bigint() - start = nanoseconds elapsed (BigInt arithmetic)
      // Number(...) converts BigInt → float
      // / 1e9 converts nanoseconds → seconds (Prometheus convention)
      const duration = Number(process.hrtime.bigint() - start) / 1e9;

      // Resolve the route path for the label.
      // req.route.path is set by Express after a route matches (e.g. "/messages").
      // req.baseUrl handles mounted routers (prefixes like "/api").
      // Falls back to "unknown" if no route matched (e.g. 404 for undefined routes).
      const routePath = req.route?.path
        ? `${req.baseUrl || ""}${req.route.path}`
        : req.baseUrl || "unknown";

      // Increment the request counter with all three labels.
      // Each unique combination of method + path + status is a separate
      // time series in Prometheus, enabling fine-grained rate/error queries.
      httpRequestsTotal.inc({
        method: req.method,
        path: routePath,
        status: res.statusCode.toString(),
      });

      // Record the duration in the histogram.
      // prom-client places this observation into the appropriate bucket(s)
      // and updates the _sum and _count series automatically.
      httpRequestDuration.observe(duration);
    };

    // "finish" fires when the response has been fully written to the OS network
    // buffer — status, headers, and body are all sent. This is the normal
    // happy path. recordMetrics=true so duration and count are recorded.
    res.on("finish", () => finalize(true));

    // "close" fires when the underlying TCP connection is closed — this happens
    // after a normal "finish" (connection teardown), BUT ALSO fires alone when
    // the client disconnects before the response is sent (tab closed, timeout,
    // network drop mid-request). recordMetrics=false in that scenario because
    // no response was delivered and there is no valid status code to label with.
    //
    // After a normal request: finish fires first (finalize runs) → close fires
    //   second (finalize returns immediately due to the `finished` guard).
    // After a client drop: only close fires → finalize runs with false,
    //   decrementing the gauge but skipping duration/count recording.
    res.on("close", () => finalize(false));

    // Pass control to the next middleware or route handler.
    next();
  });

  // ---------------------------------------------------------------------------
  // Memory metrics polling
  //
  // Reads process.memoryUsage() every 10 seconds and updates the
  // process_memory_bytes gauge in metrics.js with the latest values.
  //
  // Why setInterval here and not in metrics.js?
  //   Keeping it here ties the interval to the app instance lifecycle.
  //   In tests, a new app is created per run — if this were at module level,
  //   the interval would start once on first require() and never be restarted.
  //
  // .unref() tells Node.js: "don't keep the event loop alive just for this
  // timer." Without it, the process would hang after tests finish because
  // the pending interval would prevent Node from exiting cleanly.
  // ---------------------------------------------------------------------------
  const memoryMetricsInterval = setInterval(() => {
    updateProcessMemoryBytes();
  }, 10000); // every 10 seconds
  memoryMetricsInterval.unref();

  // ---------------------------------------------------------------------------
  // ROUTE: GET /health
  //
  // Liveness check used by Docker's healthcheck directive in compose.yaml:
  //   test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
  //
  // Docker polls this every 10s. If it fails 3 consecutive times, the container
  // is marked "unhealthy". Because nginx has `depends_on: api: condition:
  // service_healthy`, nginx will not start until this route returns 200.
  // This guarantees traffic never reaches the API before it's ready.
  // ---------------------------------------------------------------------------
  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ---------------------------------------------------------------------------
  // ROUTE: GET /messages
  //
  // Returns all messages from the database, newest first.
  // Uses async/await — Express 5 automatically catches rejected promises from
  // async route handlers and forwards them to the error handler, so no
  // try/catch is needed here.
  // ---------------------------------------------------------------------------
  app.get("/messages", async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM messages ORDER BY created_at DESC",
    );
    res.json(result.rows);
  });

  // ---------------------------------------------------------------------------
  // ROUTE: POST /messages
  //
  // Creates a new message and returns the created record.
  //
  // Security: uses a parameterized query ($1 placeholder) instead of string
  // concatenation. The `pg` library sends SQL and parameters separately to
  // Postgres, which treats $1 as data — never as executable SQL code.
  // This prevents SQL injection regardless of what `text` contains.
  //
  // RETURNING * avoids a second SELECT to fetch the created row —
  // Postgres returns the full inserted record in the same round-trip.
  // ---------------------------------------------------------------------------
  app.post("/messages", async (req, res) => {
    const { text } = req.body;
    const result = await pool.query(
      "INSERT INTO messages (text) VALUES ($1) RETURNING *",
      [text], // parameterized — safe from SQL injection
    );
    res.status(201).json(result.rows[0]); // 201 Created with the new record
  });

  // ---------------------------------------------------------------------------
  // ROUTE: GET /metrics
  //
  // Exposes all Prometheus metrics in the text exposition format.
  // Scraped by Prometheus every 15 seconds (configured in prometheus.yml).
  //
  // Security: this route is intentionally NOT proxied through Nginx.
  // nginx.conf has `location /metrics { deny all; }` so external clients
  // cannot reach this endpoint. Prometheus scrapes api:3000 directly,
  // bypassing Nginx entirely, staying within the Docker bridge network.
  //
  // Content-Type is set explicitly to register.contentType because
  // Prometheus's scraper validates the header before parsing the body.
  // The error handler uses text/plain (not HTML) for the same reason.
  // ---------------------------------------------------------------------------
  app.get("/metrics", async (req, res) => {
    try {
      // register.metrics() serializes all registered metrics (custom + default)
      // into the Prometheus text format. It's async because some collectors
      // may perform async work to gather their data before serializing.
      res.set("Content-Type", register.contentType);
      res.send(await register.metrics());
    } catch (error) {
      // Use text/plain so Prometheus doesn't try to parse an HTML error page
      res.status(500).type("text/plain").send("Failed to collect metrics");
    }
  });

  return app;
}

// =============================================================================
// Boot block — only runs when this file is executed directly (`node index.js`).
// Skipped entirely when the file is require()'d by tests.
//
// `require.main === module` is true only for the file Node was invoked with.
// This is the Node.js equivalent of Python's `if __name__ == "__main__":`.
// =============================================================================
if (require.main === module) {
  // Create the real connection pool using environment variables injected
  // by Docker Compose (defined in compose.yaml under the api service).
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  // Ensure the messages table exists before accepting traffic.
  // IF NOT EXISTS makes this a safe no-op if the table already exists —
  // no migrations framework needed for a simple schema like this.
  // The .then() fires asynchronously; the server starts listening in parallel.
  pool
    .query(
      `
    CREATE TABLE IF NOT EXISTS messages (
      id         SERIAL    PRIMARY KEY,
      text       TEXT      NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `,
    )
    .then(() => console.log("Table ready"));

  // Start the HTTP server. Port 3000 matches the Docker EXPOSE and the
  // Prometheus scrape target configured in prometheus/prometheus.yml.
  createApp(pool).listen(3000, () => console.log("API running on port 3000"));
}

// Export only createApp — the pool and server are intentionally not exported.
// Tests call createApp(mockPool) directly; they don't need the real pool
// or a running server (supertest handles the HTTP layer in-process).
module.exports = { createApp };
