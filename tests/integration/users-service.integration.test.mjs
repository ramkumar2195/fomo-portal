import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

const USERS_BASE_URL = (
  process.env.TEST_USERS_SERVICE_URL ||
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
const ENABLE_WRITE_TESTS = process.env.FOMO_INTEGRATION_WRITE === "true";
const MEMBER_SOURCE_INQUIRY_ID = process.env.FOMO_TEST_MEMBER_SOURCE_INQUIRY_ID;

function requireCredentials() {
  assert.ok(TEST_MOBILE, "Set FOMO_TEST_MOBILE to run integration tests.");
  assert.ok(TEST_PASSWORD, "Set FOMO_TEST_PASSWORD to run integration tests.");
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

async function usersRequest({ method = "GET", path, token, data, params }) {
  let response;
  try {
    response = await axios.request({
      baseURL: USERS_BASE_URL,
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
    throw new Error(`Network error (code=${code}, baseURL=${USERS_BASE_URL}, path=${path}): ${message}`);
  }

  if (response.status >= 400) {
    const message =
      typeof response.data === "object" && response.data !== null && "message" in response.data
        ? String(response.data.message)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return unwrapEnvelope(response.data);
}

async function loginAndGetToken() {
  requireCredentials();

  const payload = await usersRequest({
    method: "POST",
    path: `${USERS_API_PREFIX}/login`,
    data: {
      mobileNumber: TEST_MOBILE,
      password: TEST_PASSWORD,
    },
  });

  assert.ok(payload?.accessToken, "Expected accessToken in login response data.");
  return payload.accessToken;
}

function uniqueMobileNumber() {
  const tail = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    .slice(-9)
    .padStart(9, "0");
  return `9${tail}`;
}

async function registerAndVerify(token, roleConfig) {
  const mobileNumber = uniqueMobileNumber();
  const password = "Temp@1234";
  const fullName = `IT-${roleConfig.role}-${Date.now()}`;
  const parsedSourceInquiryId = Number(MEMBER_SOURCE_INQUIRY_ID);

  if (roleConfig.role === "MEMBER" && !MEMBER_SOURCE_INQUIRY_ID) {
    throw new Error("Set FOMO_TEST_MEMBER_SOURCE_INQUIRY_ID for MEMBER write-registration test.");
  }
  if (roleConfig.role === "MEMBER" && (!Number.isFinite(parsedSourceInquiryId) || parsedSourceInquiryId <= 0)) {
    throw new Error("FOMO_TEST_MEMBER_SOURCE_INQUIRY_ID must be a positive number.");
  }

  await usersRequest({
    method: "POST",
    path: `${USERS_API_PREFIX}/register`,
    token,
    data: {
      fullName,
      mobileNumber,
      password,
      role: roleConfig.role,
      employmentType: roleConfig.employmentType,
      designation: roleConfig.designation,
      dataScope: roleConfig.dataScope,
      active: true,
      ...(roleConfig.role === "MEMBER" ? { sourceInquiryId: parsedSourceInquiryId } : {}),
    },
  });

  const searchResult = await usersRequest({
    path: `${USERS_API_PREFIX}/search`,
    token,
    params: {
      role: roleConfig.role,
      query: mobileNumber,
    },
  });

  assert.ok(Array.isArray(searchResult), "Expected search response to be an array.");
  const created = searchResult.find((item) => {
    const itemMobile = item?.mobileNumber || item?.mobile || item?.phone;
    return String(itemMobile || "") === mobileNumber;
  });

  assert.ok(created, `Expected registered ${roleConfig.role} to be discoverable via /search.`);
}

test("users-service login returns accessToken", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const token = await loginAndGetToken();
  assert.equal(typeof token, "string");
  assert.ok(token.length > 20);
});

test("users-service /me and /metadata/access are accessible with bearer token", { skip: !TEST_MOBILE || !TEST_PASSWORD }, async () => {
  const token = await loginAndGetToken();

  const me = await usersRequest({
    path: `${USERS_API_PREFIX}/me`,
    token,
  });
  assert.ok(me, "Expected /me response payload.");
  assert.ok(me.role, "Expected role in /me payload.");

  const metadata = await usersRequest({
    path: `${USERS_API_PREFIX}/metadata/access`,
    token,
  });
  assert.ok(metadata, "Expected metadata payload.");
});

test(
  "users-service register + search for MEMBER/COACH/STAFF",
  { skip: !TEST_MOBILE || !TEST_PASSWORD || !ENABLE_WRITE_TESTS },
  async (t) => {
    const token = await loginAndGetToken();

    if (MEMBER_SOURCE_INQUIRY_ID) {
      await registerAndVerify(token, {
        role: "MEMBER",
        employmentType: "INTERNAL",
        designation: "MEMBER",
        dataScope: "ASSIGNED_ONLY",
      });
    } else {
      t.diagnostic("Skipping MEMBER register write-check because FOMO_TEST_MEMBER_SOURCE_INQUIRY_ID is not set.");
    }

    await registerAndVerify(token, {
      role: "COACH",
      employmentType: "INTERNAL",
      designation: "PT_COACH",
      dataScope: "ASSIGNED_ONLY",
    });

    await registerAndVerify(token, {
      role: "STAFF",
      employmentType: "INTERNAL",
      designation: "SALES_EXECUTIVE",
      dataScope: "BRANCH",
    });
  },
);
