const express = require("express");
const { Pool } = require("pg");
const {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
} = require("./metrics");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  activeConnections.inc();
  let finished = false;
  const finalize = (recordMetrics) => {
    if (finished) return;
    finished = true;
    activeConnections.dec();
    if (!recordMetrics) return;
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const routePath = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : req.baseUrl || "unknown";
    httpRequestsTotal.inc({
      method: req.method,
      path: routePath,
      status: res.statusCode.toString(),
    });
    httpRequestDuration.observe(duration);
  };
  res.on("finish", () => finalize(true));
  res.on("close", () => finalize(false));
  next();
});

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Create table on startup
pool
  .query(
    `
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
`,
  )
  .then(() => console.log("Table ready"));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/messages", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM messages ORDER BY created_at DESC",
  );
  res.json(result.rows);
});

app.post("/messages", async (req, res) => {
  const { text } = req.body;
  const result = await pool.query(
    "INSERT INTO messages (text) VALUES ($1) RETURNING *",
    [text],
  );
  res.status(201).json(result.rows[0]);
});

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.listen(3000, () => console.log("API running on port 3000"));
