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

const failPool = {
  query: async () => {
    throw new Error("DB unavailable");
  },
};

const request = supertest(createApp(mockPool));
const failRequest = supertest(createApp(failPool));

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await request.get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

describe("GET /messages", () => {
  test("returns 200 with an array of messages", async () => {
    const res = await request.get("/messages");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0);
  });
});

describe("POST /messages", () => {
  test("returns 201 with the created message", async () => {
    const res = await request.post("/messages").send({ text: "test message" });
    assert.equal(res.status, 201);
    assert.equal(res.body.text, "test message");
    assert.ok(res.body.id);
  });
});

describe("GET /metrics", () => {
  let metricsBody;

  before(async () => {
    await request.get("/health");
    await request.get("/messages");
    const res = await request.get("/metrics");
    metricsBody = res.text;
  });

  test("returns 200 with Prometheus content-type", async () => {
    const res = await request.get("/metrics");
    assert.equal(res.status, 200);
    assert.ok(res.headers["content-type"].includes("text/plain"));
  });

  test("exposes http_requests_total counter", () => {
    assert.ok(metricsBody.includes("# TYPE http_requests_total counter"));
  });

  test("records traffic with correct labels", () => {
    assert.ok(metricsBody.includes('method="GET"'));
    assert.ok(metricsBody.includes('status="200"'));
  });

  test("exposes http_request_duration_seconds histogram", () => {
    assert.ok(metricsBody.includes("# TYPE http_request_duration_seconds histogram"));
  });

  test("exposes active_connections gauge", () => {
    assert.ok(metricsBody.includes("# TYPE active_connections gauge"));
  });

  test("exposes process_memory_bytes gauge", () => {
    assert.ok(metricsBody.includes("# TYPE process_memory_bytes gauge"));
  });
});

describe("POST /messages - input validation", () => {
  test("returns 400 when body is empty", async () => {
    const res = await request.post("/messages").send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test("returns 400 when text is an empty string", async () => {
    const res = await request.post("/messages").send({ text: "" });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  test("returns 400 when text is not a string", async () => {
    const res = await request.post("/messages").send({ text: 42 });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });
});

describe("error handling", () => {
  test("GET /messages returns 500 JSON on DB failure", async () => {
    const res = await failRequest.get("/messages");
    assert.equal(res.status, 500);
    assert.ok(res.body.error);
  });

  test("POST /messages returns 500 JSON on DB failure", async () => {
    const res = await failRequest.post("/messages").send({ text: "hello" });
    assert.equal(res.status, 500);
    assert.ok(res.body.error);
  });
});
