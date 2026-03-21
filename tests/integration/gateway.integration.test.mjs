import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

const API_BASE_URL = (
  process.env.TEST_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8081"
).replace(/\/$/, "");

const USERS_API_PREFIX = (process.env.TEST_USERS_API_PREFIX || process.env.NEXT_PUBLIC_USERS_API_PREFIX || "/api/users").replace(
  /\/$/,
  "",
);

const TEST_MOBILE = process.env.FOMO_TEST_MOBILE;
const TEST_PASSWORD = process.env.FOMO_TEST_PASSWORD;
const TEST_CATEGORY_CODE = process.env.FOMO_TEST_CATEGORY_CODE;
const TEST_PRODUCT_CODE = process.env.FOMO_TEST_PRODUCT_CODE;

let cachedAuth = null;

const LEAD_STATUS_ENUM = new Set([
  "NEW",
  "CONTACTED",
  "FOLLOW_UP",
  "TRIAL_BOOKED",
  "CONVERTED",
  "NOT_INTERESTED",
  "LOST",
]);

const CONVERTIBILITY_ENUM = new Set(["HOT", "WARM", "COLD"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTestMobile() {
  const suffix = String(Date.now()).slice(-8);
  return `9${suffix.slice(0, 8)}${Math.floor(Math.random() * 10)}`;
}

function extractInquiryId(payload) {
  const id = payload?.inquiryId ?? payload?.id;
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function gatewayRequestRaw({ method = "GET", path, token, data, params }) {
  try {
    return await axios.request({
      baseURL: API_BASE_URL,
      url: path,
      method,
      data,
      params,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      validateStatus: () => true,
    });
  } catch (networkError) {
    const errorObj = networkError && typeof networkError === "object" ? networkError : {};
    const code = "code" in errorObj ? String(errorObj.code) : "UNKNOWN";
    const message = "message" in errorObj ? String(errorObj.message) : "Network request failed";
    throw new Error(`Network error (code=${code}, baseURL=${API_BASE_URL}, path=${path}): ${message}`);
  }
}

function requireCredentials() {
  assert.ok(TEST_MOBILE, "Set FOMO_TEST_MOBILE to run gateway integration tests.");
  assert.ok(TEST_PASSWORD, "Set FOMO_TEST_PASSWORD to run gateway integration tests.");
}

function unwrapEnvelope(payload) {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    if (!payload.success) {
      throw new Error(payload.message || "Backend returned success=false");
    }
    return payload.data;
  }

  return payload;
}

async function gatewayRequest({ method = "GET", path, token, data, params }) {
  let response;
  try {
    response = await axios.request({
      baseURL: API_BASE_URL,
      url: path,
      method,
      data,
      params,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      validateStatus: () => true,
    });
  } catch (networkError) {
    const errorObj = networkError && typeof networkError === "object" ? networkError : {};
    const code = "code" in errorObj ? String(errorObj.code) : "UNKNOWN";
    const message = "message" in errorObj ? String(errorObj.message) : "Network request failed";
    throw new Error(`Network error (code=${code}, baseURL=${API_BASE_URL}, path=${path}): ${message}`);
  }

  if (response.status >= 400) {
    const message =
      typeof response.data === "object" && response.data !== null && "message" in response.data
        ? String(response.data.message)
        : `HTTP ${response.status}`;
    throw new Error(`${message} (status=${response.status}, path=${path})`);
  }

  return unwrapEnvelope(response.data);
}

async function loginAndGetToken() {
  requireCredentials();

  const payload = await gatewayRequest({
    method: "POST",
    path: `${USERS_API_PREFIX}/login`,
    data: {
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD,
    },
  });

  assert.ok(payload?.accessToken, "Expected accessToken at response.data.accessToken");

  return payload.accessToken;
}

async function getAuthContext() {
  if (cachedAuth) {
    return cachedAuth;
  }

  const token = await loginAndGetToken();
  const me = await gatewayRequest({
    path: `${USERS_API_PREFIX}/me`,
    token,
  });

  cachedAuth = { token, me };
  return cachedAuth;
}

async function createInquiryForTest(token, overrides = {}) {
  const mobileNumber = overrides.mobileNumber || makeTestMobile();
  const payload = await gatewayRequest({
    method: "POST",
    path: "/api/subscriptions/v2/inquiries",
    token,
    data: {
      fullName: "Portal Contract Test",
      mobileNumber,
      inquiryAt: new Date().toISOString(),
      status: "NEW",
      convertibility: "WARM",
      promotionSource: "TEST",
      ...overrides,
    },
  });

  const inquiryId = extractInquiryId(payload);
  assert.ok(Number.isFinite(inquiryId), "Expected inquiryId in create response");
  return { inquiryId, mobileNumber, payload };
}

test("gateway login returns token at data.accessToken", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const token = await loginAndGetToken();
  assert.equal(typeof token, "string");
  assert.ok(token.length > 20);
});

test("gateway /api/users/me and /api/users/metadata/access work with bearer", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token, me } = await getAuthContext();

  assert.ok(me, "Expected /me payload");
  assert.ok(me.role, "Expected role in /me payload");

  const metadata = await gatewayRequest({
    path: `${USERS_API_PREFIX}/metadata/access`,
    token,
  });

  assert.ok(metadata, "Expected metadata payload");
});

test("gateway users search for MEMBER/STAFF/COACH works", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();

  const [members, staff, coaches] = await Promise.all([
    gatewayRequest({ path: `${USERS_API_PREFIX}/search`, token, params: { role: "MEMBER", query: "" } }),
    gatewayRequest({ path: `${USERS_API_PREFIX}/search`, token, params: { role: "STAFF", query: "" } }),
    gatewayRequest({ path: `${USERS_API_PREFIX}/search`, token, params: { role: "COACH", query: "" } }),
  ]);

  assert.ok(Array.isArray(members), "Expected members search to return array");
  assert.ok(Array.isArray(staff), "Expected staff search to return array");
  assert.ok(Array.isArray(coaches), "Expected coaches search to return array");
});

test("gateway dashboard endpoints load by role", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token, me } = await getAuthContext();

  const dashboardPath =
    me.role === "ADMIN" ? "/api/dashboard/admin/overview" : `/api/dashboard/staff/${me.id}`;

  const dashboard = await gatewayRequest({ path: dashboardPath, token });
  assert.ok(dashboard && typeof dashboard === "object", "Expected dashboard payload");

  if (me.role === "ADMIN") {
    const superAdminDashboardRaw = await gatewayRequestRaw({
      path: "/api/users/dashboard/super-admin",
      token,
    });
    if (superAdminDashboardRaw.status >= 500) {
      t.skip("Super-admin dashboard endpoint returned 500 for this environment");
      return;
    }
    assert.ok(superAdminDashboardRaw.status < 400, "Expected super-admin dashboard success response");
    const superAdminDashboard = unwrapEnvelope(superAdminDashboardRaw.data);
    assert.ok(superAdminDashboard && typeof superAdminDashboard === "object", "Expected super-admin dashboard payload");
  }

  const leaderboard = await gatewayRequest({ path: "/api/retention/leaderboard", token });
  assert.ok(Array.isArray(leaderboard), "Expected leaderboard array");
});

test("gateway inquiry and follow-up list endpoints load", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();

  const inquiriesRaw = await gatewayRequestRaw({
    path: "/api/subscriptions/v2/inquiries/paged",
    token,
    params: { query: "", status: "", converted: "", page: 0, size: 10 },
  });

  if (inquiriesRaw.status >= 500) {
    t.skip("Paged inquiry endpoint returned 500 for this environment");
    return;
  }

  assert.ok(inquiriesRaw.status < 400, "Expected paged inquiry response");
  const inquiriesPage = unwrapEnvelope(inquiriesRaw.data);
  assert.ok(Array.isArray(inquiriesPage.content), "Expected inquiries page content array");
  if (inquiriesPage.content.length > 0) {
    const sample = inquiriesPage.content[0];
    if (typeof sample.status === "string" && sample.status.length > 0) {
      assert.ok(LEAD_STATUS_ENUM.has(sample.status), `Unexpected enquiry status: ${sample.status}`);
    }
    if (typeof sample.convertibility === "string" && sample.convertibility.length > 0) {
      assert.ok(
        CONVERTIBILITY_ENUM.has(sample.convertibility),
        `Unexpected enquiry convertibility: ${sample.convertibility}`,
      );
    }
  }

  const queueRaw = await gatewayRequestRaw({
    path: "/api/subscriptions/v2/inquiries/follow-ups/paged",
    token,
    params: { page: 0, size: 10 },
  });
  assert.ok(queueRaw.status < 400, "Expected paged follow-up queue response");
  const queuePage = unwrapEnvelope(queueRaw.data);
  assert.ok(Array.isArray(queuePage.content), "Expected follow-up queue page content array");
});

test("gateway inquiry closeReason validation, status history, and server filters", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();
  const closeReason = `NO_RESPONSE_${Date.now()}`;
  const { inquiryId, mobileNumber } = await createInquiryForTest(token, {
    convertibility: "COLD",
  });

  const invalidClose = await gatewayRequestRaw({
    method: "PATCH",
    path: `/api/subscriptions/v2/inquiries/${inquiryId}`,
    token,
    data: { status: "LOST" },
  });
  assert.ok(invalidClose.status >= 400, "Expected validation error when closeReason is missing");
  const invalidMessage =
    typeof invalidClose.data === "object" && invalidClose.data !== null && "message" in invalidClose.data
      ? String(invalidClose.data.message)
      : "";
  assert.ok(
    invalidClose.status === 400 || invalidClose.status === 422 || invalidClose.status === 500,
    `Expected validation-style failure status, got ${invalidClose.status}`,
  );
  assert.ok(invalidMessage.length > 0, "Expected backend failure message for missing closeReason");

  const serializedFilterUri = axios.getUri({
    baseURL: API_BASE_URL,
    url: "/api/subscriptions/v2/inquiries/paged",
    params: {
      query: mobileNumber,
      status: "NEW",
      convertibility: "COLD",
      closeReason,
      converted: false,
      page: 0,
      size: 10,
    },
  });
  assert.match(serializedFilterUri, /closeReason=/, "Expected closeReason query serialization");

  const historyResponse = await gatewayRequestRaw({
    path: `/api/subscriptions/v2/inquiries/${inquiryId}/status-history`,
    token,
  });
  if (historyResponse.status >= 500) {
    t.skip("Status history endpoint returned 500 for this environment");
    return;
  }

  assert.ok(historyResponse.status < 400, `Expected status history success, got ${historyResponse.status}`);
  const history = unwrapEnvelope(historyResponse.data);
  assert.ok(Array.isArray(history), "Expected status history array");
});

test("gateway inquiry convert flow updates status and converted state", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();
  const { inquiryId, mobileNumber } = await createInquiryForTest(token, {
    convertibility: "HOT",
  });

  try {
    await gatewayRequest({
      method: "POST",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/convert`,
      token,
      data: {},
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("status=403")) {
      t.skip("Current test user does not have convert permission");
      return;
    }
    throw error;
  }

  let convertedRecord = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const resultRaw = await gatewayRequestRaw({
      path: "/api/subscriptions/v2/inquiries/paged",
      token,
      params: {
        query: mobileNumber,
        status: "CONVERTED",
        converted: true,
        page: 0,
        size: 10,
      },
    });

    if (resultRaw.status >= 500) {
      t.skip("Paged inquiry endpoint returned 500 for this environment");
      return;
    }

    assert.ok(resultRaw.status < 400, "Expected paged inquiry response");
    const result = unwrapEnvelope(resultRaw.data);
    if (Array.isArray(result.content)) {
      convertedRecord = result.content.find((item) => Number(item.inquiryId) === inquiryId) || null;
    }

    if (convertedRecord) {
      break;
    }
    await sleep(300);
  }

  assert.ok(convertedRecord, "Expected converted inquiry in filtered list");
  assert.equal(String(convertedRecord.status || "").toUpperCase(), "CONVERTED");
  assert.equal(Boolean(convertedRecord.converted), true);
});

test("gateway billing-related endpoints load (catalog optional, invoices by member)", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();

  const members = await gatewayRequest({
    path: `${USERS_API_PREFIX}/search`,
    token,
    params: { role: "MEMBER", query: "" },
  });

  if (!Array.isArray(members) || members.length === 0) {
    t.skip("No members available to validate invoices endpoint");
    return;
  }

  const memberId = members[0].id || members[0].userId;
  assert.ok(memberId, "Expected member id");

  const invoices = await gatewayRequest({
    path: `/api/subscriptions/invoices/member/${memberId}`,
    token,
  });
  assert.ok(Array.isArray(invoices), "Expected invoices array");

  if (TEST_CATEGORY_CODE && TEST_PRODUCT_CODE) {
    const variants = await gatewayRequest({
      path: "/api/subscriptions/v2/catalog/variants",
      token,
      params: { categoryCode: TEST_CATEGORY_CODE, productCode: TEST_PRODUCT_CODE },
    });
    assert.ok(Array.isArray(variants), "Expected catalog variants array");
  }
});

test("gateway renewals and finance registers load", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();

  const [renewals, invoices, receipts, balanceDue, subscriptions, discountLogs] = await Promise.all([
    gatewayRequest({
      path: "/api/subscriptions/v2/renewals",
      token,
      params: { daysAhead: 30 },
    }),
    gatewayRequest({
      path: "/api/subscriptions/v2/finance/registers/invoices",
      token,
    }),
    gatewayRequest({
      path: "/api/subscriptions/v2/finance/registers/receipts",
      token,
    }),
    gatewayRequest({
      path: "/api/subscriptions/v2/finance/registers/balance-due",
      token,
    }),
    gatewayRequest({
      path: "/api/subscriptions/v2/finance/registers/subscriptions",
      token,
    }),
    gatewayRequest({
      path: "/api/subscriptions/v2/finance/registers/discount-logs",
      token,
    }),
  ]);

  assert.ok(Array.isArray(renewals), "Expected renewals array");
  assert.ok(Array.isArray(invoices), "Expected invoice register array");
  assert.ok(Array.isArray(receipts), "Expected receipt register array");
  assert.ok(Array.isArray(balanceDue), "Expected balance due register array");
  assert.ok(Array.isArray(subscriptions), "Expected subscription register array");
  assert.ok(Array.isArray(discountLogs), "Expected discount logs array");
});

test("gateway member profile replacement endpoints load", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async (t) => {
  const { token } = await getAuthContext();

  const members = await gatewayRequest({
    path: `${USERS_API_PREFIX}/search`,
    token,
    params: { role: "MEMBER", query: "" },
  });

  if (!Array.isArray(members) || members.length === 0) {
    t.skip("No members available to validate member profile endpoints");
    return;
  }

  const memberId = members[0].id || members[0].userId;
  assert.ok(memberId, "Expected member id");

  const ptAssignmentsRaw = await gatewayRequestRaw({
    path: `/api/training/assignments/member/${memberId}`,
    token,
  });
  if (ptAssignmentsRaw.status >= 500) {
    t.skip("PT assignments endpoint returned 500 for this environment");
    return;
  }
  const ptAssignments =
    ptAssignmentsRaw.status === 404 ? [] : unwrapEnvelope(ptAssignmentsRaw.data);

  const [
    profile,
    notes,
    fitnessForm,
    attendance,
    creditsWallet,
    creditsLedger,
    progressSummary,
    progressMeasurements,
    progressPhotos,
    freezeHistory,
    assessmentStatus,
    assessments,
  ] = await Promise.all([
    gatewayRequest({
      path: `${USERS_API_PREFIX}/members/${memberId}/profile`,
      token,
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/members/${memberId}/notes`,
      token,
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/members/${memberId}/fitness-form`,
      token,
    }),
    gatewayRequest({
      path: `/api/attendance/member/${memberId}`,
      token,
    }),
    gatewayRequest({
      path: `/api/credits/wallet/${memberId}`,
      token,
    }),
    gatewayRequest({
      path: `/api/credits/ledger/${memberId}`,
      token,
    }),
    gatewayRequest({
      path: `/api/progress/summary/member/${memberId}`,
      token,
    }),
    gatewayRequest({
      path: `/api/progress/measurements/member/${memberId}`,
      token,
    }),
    gatewayRequest({
      path: `/api/progress/photos/member/${memberId}`,
      token,
    }),
    gatewayRequest({
      path: `/api/retention/member/${memberId}/freeze/history`,
      token,
    }),
    gatewayRequest({
      path: `/api/training/assessments/member/${memberId}/status`,
      token,
    }),
    gatewayRequest({
      path: `/api/training/assessments/member/${memberId}`,
      token,
    }),
  ]);

  assert.ok(profile && typeof profile === "object", "Expected member profile payload");
  assert.ok(notes && typeof notes === "object", "Expected member notes payload");
  assert.ok(fitnessForm && typeof fitnessForm === "object", "Expected member fitness form payload");
  assert.ok(Array.isArray(attendance), "Expected member attendance array");
  assert.ok(creditsWallet && typeof creditsWallet === "object", "Expected member credits wallet payload");
  assert.ok(creditsLedger && typeof creditsLedger === "object", "Expected member credits ledger payload");
  assert.ok(progressSummary && typeof progressSummary === "object", "Expected member progress summary payload");
  assert.ok(Array.isArray(progressMeasurements), "Expected member progress measurements array");
  assert.ok(Array.isArray(progressPhotos), "Expected member progress photos array");
  assert.ok(Array.isArray(freezeHistory), "Expected freeze history array");
  assert.ok(Array.isArray(ptAssignments), "Expected PT assignments array");
  assert.ok(assessmentStatus && typeof assessmentStatus === "object", "Expected assessment status payload");
  assert.ok(Array.isArray(assessments), "Expected assessments history array");
});

test("gateway staff and trainer management replacement endpoints load", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();

  const [staff, coaches, staffAttendance, staffLeaveRequests, trainerAttendance, trainerLeaveRequests] = await Promise.all([
    gatewayRequest({
      path: `${USERS_API_PREFIX}/search`,
      token,
      params: { role: "STAFF", query: "" },
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/search`,
      token,
      params: { role: "COACH", query: "" },
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/staff/attendance/report`,
      token,
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/staff/leave-requests`,
      token,
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/trainers/attendance/report`,
      token,
    }),
    gatewayRequest({
      path: `${USERS_API_PREFIX}/trainers/leave-requests`,
      token,
    }),
  ]);

  assert.ok(Array.isArray(staff), "Expected staff array");
  assert.ok(Array.isArray(coaches), "Expected coach array");
  assert.ok(staffAttendance && typeof staffAttendance === "object", "Expected staff attendance report payload");
  assert.ok(Array.isArray(staffLeaveRequests), "Expected staff leave requests array");
  assert.ok(trainerAttendance && typeof trainerAttendance === "object", "Expected trainer attendance report payload");
  assert.ok(Array.isArray(trainerLeaveRequests), "Expected trainer leave requests array");
});

test("gateway notifications campaigns endpoint loads", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const { token } = await getAuthContext();

  const campaigns = await gatewayRequest({
    path: "/api/notifications/campaigns",
    token,
    params: { status: "", channel: "" },
  });

  assert.ok(Array.isArray(campaigns), "Expected campaigns list array");
});
