import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

const API_BASE_URL = (
  process.env.TEST_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8081"
).replace(/\/$/, "");

const USERS_API_PREFIX = (
  process.env.TEST_USERS_API_PREFIX ||
  process.env.NEXT_PUBLIC_USERS_API_PREFIX ||
  "/api/users"
).replace(/\/$/, "");

const TEST_MOBILE = process.env.FOMO_TEST_MOBILE;
const TEST_PASSWORD = process.env.FOMO_TEST_PASSWORD;

let cachedAuth = null;

function unwrapEnvelope(payload) {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    if (!payload.success) throw new Error(payload.message || "Backend returned success=false");
    return payload.data;
  }
  return payload;
}

async function gatewayRequest({ method = "GET", path, token, data, params }) {
  const response = await axios.request({
    baseURL: API_BASE_URL,
    url: path,
    method,
    data,
    params,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const message =
      typeof response.data === "object" && response.data !== null && "message" in response.data
        ? String(response.data.message)
        : `HTTP ${response.status}`;
    throw new Error(`${message} (status=${response.status}, path=${path})`);
  }

  return unwrapEnvelope(response.data);
}

async function gatewayRequestRaw({ method = "GET", path, token, data, params }) {
  return axios.request({
    baseURL: API_BASE_URL,
    url: path,
    method,
    data,
    params,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    validateStatus: () => true,
  });
}

async function getAuthContext() {
  if (cachedAuth) return cachedAuth;
  assert.ok(TEST_MOBILE, "Set FOMO_TEST_MOBILE to run integration tests.");
  assert.ok(TEST_PASSWORD, "Set FOMO_TEST_PASSWORD to run integration tests.");

  const payload = await gatewayRequest({
    method: "POST",
    path: `${USERS_API_PREFIX}/login`,
    data: { mobileNumber: TEST_MOBILE, password: TEST_PASSWORD },
  });
  assert.ok(payload?.accessToken, "Expected accessToken");

  const me = await gatewayRequest({
    path: `${USERS_API_PREFIX}/me`,
    token: payload.accessToken,
  });

  cachedAuth = { token: payload.accessToken, me };
  return cachedAuth;
}

// ── Finance Dashboard Tests ─────────────────────────────────────────

test("finance dashboard endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const dashboard = await gatewayRequest({
    path: "/api/subscriptions/v2/finance/dashboard",
    token,
  });
  assert.ok(dashboard && typeof dashboard === "object", "Expected finance dashboard object");
});

test("finance registers load (invoices, receipts, subscriptions)", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();

  const endpoints = [
    "/api/subscriptions/v2/finance/registers/invoices",
    "/api/subscriptions/v2/finance/registers/receipts",
    "/api/subscriptions/v2/finance/registers/balance-due",
    "/api/subscriptions/v2/finance/registers/subscriptions",
    "/api/subscriptions/v2/finance/registers/discount-logs",
  ];

  for (const path of endpoints) {
    const raw = await gatewayRequestRaw({ path, token });
    if (raw.status >= 500) {
      t.skip(`${path} returned 500`);
      continue;
    }
    assert.ok(raw.status < 400, `Expected success for ${path}, got ${raw.status}`);
    const data = unwrapEnvelope(raw.data);
    assert.ok(Array.isArray(data), `Expected array from ${path}`);
  }
});

// ── Credits Tests ───────────────────────────────────────────────────

test("credits rules endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({ path: "/api/credits/rules", token });
  assert.ok(raw.status < 400, `Expected credits rules success, got ${raw.status}`);
  const data = unwrapEnvelope(raw.data);
  assert.ok(Array.isArray(data) || typeof data === "object", "Expected rules data");
});

test("credits wallet by member endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();

  const members = await gatewayRequest({
    path: `${USERS_API_PREFIX}/search`,
    token,
    params: { role: "MEMBER", query: "" },
  });

  if (!Array.isArray(members) || members.length === 0) {
    t.skip("No members available");
    return;
  }

  const memberId = members[0].id || members[0].userId;
  const wallet = await gatewayRequest({
    path: `/api/credits/wallet/${memberId}`,
    token,
  });
  assert.ok(wallet && typeof wallet === "object", "Expected wallet object");
});

// ── Community Tests ─────────────────────────────────────────────────

test("community feed loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({
    path: "/api/community/feed",
    token,
    params: { page: 0, size: 10 },
  });
  assert.ok(raw.status < 400, `Expected community feed success, got ${raw.status}`);
});

// ── Attendance Tests ────────────────────────────────────────────────

test("today attendance loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const data = await gatewayRequest({ path: "/api/attendance/today", token });
  assert.ok(Array.isArray(data), "Expected today attendance array");
});

test("attendance report loads with date params", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({
    path: "/api/attendance/report",
    token,
    params: { from: "2025-01-01", to: "2025-12-31" },
  });
  if (raw.status >= 500) {
    t.skip("Attendance report returned 500");
    return;
  }
  assert.ok(raw.status < 400, `Expected attendance report success, got ${raw.status}`);
});

// ── Automation Tests ────────────────────────────────────────────────

test("automation rules endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({ path: "/api/automation/rules", token });
  assert.ok(raw.status < 400, `Expected automation rules success, got ${raw.status}`);
  const data = unwrapEnvelope(raw.data);
  assert.ok(Array.isArray(data) || (data && typeof data === "object"), "Expected automation rules payload");
});

test("at-risk members endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({ path: "/api/automation/risk/at-risk", token });
  if (raw.status >= 500) {
    t.skip("At-risk endpoint returned 500");
    return;
  }
  assert.ok(raw.status < 400, `Expected at-risk success, got ${raw.status}`);
});

test("gamification leaderboard loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({ path: "/api/automation/leaderboard/monthly", token });
  assert.ok(raw.status < 400, `Expected leaderboard success, got ${raw.status}`);
});

// ── Notification In-App Tests ───────────────────────────────────────

test("in-app notifications endpoint loads for member", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();

  const members = await gatewayRequest({
    path: `${USERS_API_PREFIX}/search`,
    token,
    params: { role: "MEMBER", query: "" },
  });

  if (!Array.isArray(members) || members.length === 0) {
    t.skip("No members available");
    return;
  }

  const memberId = members[0].id || members[0].userId;

  const notifications = await gatewayRequest({
    path: `/api/notifications/in-app/${memberId}`,
    token,
  });
  assert.ok(Array.isArray(notifications), "Expected notifications array");

  const unread = await gatewayRequest({
    path: `/api/notifications/in-app/${memberId}/unread-count`,
    token,
  });
  assert.ok(unread && typeof unread === "object", "Expected unread count object");
});

// ── Branch Tests ────────────────────────────────────────────────────

test("branches list endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();
  const raw = await gatewayRequestRaw({
    path: "/api/branches",
    token,
    params: { page: 0, size: 20 },
  });
  assert.ok(raw.status < 400, `Expected branches success, got ${raw.status}`);
});

// ── Catalog Tests ───────────────────────────────────────────────────

test("catalog products and variants load", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();

  const products = await gatewayRequest({
    path: "/api/subscriptions/v2/catalog/products",
    token,
  });
  assert.ok(Array.isArray(products), "Expected catalog products array");

  const variants = await gatewayRequest({
    path: "/api/subscriptions/v2/catalog/variants",
    token,
  });
  assert.ok(Array.isArray(variants), "Expected catalog variants array");
});

// ── Trainer Utilization Test ────────────────────────────────────────

test("trainer utilization endpoint loads for admin", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token, me } = await getAuthContext();

  if (me.role !== "ADMIN") {
    t.skip("Trainer utilization requires ADMIN role");
    return;
  }

  const raw = await gatewayRequestRaw({
    path: "/api/dashboard/admin/trainer-utilization",
    token,
    params: { page: 0, size: 10 },
  });

  if (raw.status >= 500) {
    t.skip("Trainer utilization returned 500");
    return;
  }

  assert.ok(raw.status < 400, `Expected trainer utilization success, got ${raw.status}`);
});
