const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const supertest = require("supertest");
const { createApp } = require("./index");

const mockPool = {
  query: async (sql, params) => {
    if (sql.includes("SELECT")) {
      return { rows: [{ id: 1, text: "hello", created_at: new Date() }] };
    }
    if (sql.includes("INSERT")) {
      return { rows: [{ id: 2, text: params[0], created_at: new Date() }] };
    }
    return { rows: [] };
  },
};

const request = supertest(createApp(mockPool));

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await request.get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

describe("GET /messages", () => {
  test("returns 200 with an array", async () => {
    const res = await request.get("/messages");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

describe("POST /messages", () => {
  test("returns 201 with the created message", async () => {
    const res = await request.post("/messages").send({ text: "test message" });
    assert.equal(res.status, 201);
    assert.equal(res.body.text, "test message");
  });
});

describe("GET /metrics", () => {
  before(async () => {
    // generate some traffic so counters are populated
    await request.get("/health");
    await request.get("/messages");
  });

  test("returns 200 with Prometheus content-type", async () => {
    const res = await request.get("/metrics");
    assert.equal(res.status, 200);
    assert.ok(res.headers["content-type"].includes("text/plain"));
  });

  test("contains http_requests_total", async () => {
    const res = await request.get("/metrics");
    assert.ok(res.text.includes("http_requests_total"));
  });

  test("contains http_request_duration_seconds", async () => {
    const res = await request.get("/metrics");
    assert.ok(res.text.includes("http_request_duration_seconds"));
  });

  test("contains active_connections", async () => {
    const res = await request.get("/metrics");
    assert.ok(res.text.includes("active_connections"));
  });

  test("contains process_memory_bytes", async () => {
    const res = await request.get("/metrics");
    assert.ok(res.text.includes("process_memory_bytes"));
  });
});
