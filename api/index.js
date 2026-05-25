const express = require("express");
const { Pool } = require("pg");
const {
  registry,
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
  memoryUsage,
} = require("./metrics");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  activeConnections.inc({}, 1);
  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestsTotal.inc({
      method: req.method,
      path: req.path,
      status: res.statusCode.toString(),
    });
    httpRequestDuration.observe({}, duration);
    activeConnections.dec({}, 1);
  });
  next();
});

setInterval(() => {
  const mem = process.memoryUsage();
  memoryUsage.set({ type: "rss" }, mem.rss);
  memoryUsage.set({ type: "heapUsed" }, mem.heapUsed);
  memoryUsage.set({ type: "heapTotal" }, mem.heapTotal);
}, 10000);

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

app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain");
  res.send(registry.expose());
});

app.listen(3000, () => console.log("API running on port 3000"));
