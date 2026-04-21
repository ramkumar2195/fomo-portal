import { apiRequest } from "@/lib/api/http-client";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import type { SpringPage } from "@/types/pagination";
import type {
  ApprovalDecisionBody,
  ApprovalRequestRecord,
  SubmitApprovalRequestBody,
} from "@/types/approvals";

/**
 * Client for the approval-request workflow (DEC-019).
 *
 * Maps 1:1 to {@code ApprovalRequestController} in subscription-service:
 *   POST    /api/subscriptions/v2/approvals            → submit
 *   POST    /api/subscriptions/v2/approvals/{id}/approve
 *   POST    /api/subscriptions/v2/approvals/{id}/reject
 *   DELETE  /api/subscriptions/v2/approvals/{id}       → cancel (requester)
 *   GET     /api/subscriptions/v2/approvals/{id}
 *   GET     /api/subscriptions/v2/approvals/pending    (role-scoped)
 *   GET     /api/subscriptions/v2/approvals/pending/count
 *   GET     /api/subscriptions/v2/approvals/mine
 *
 * All endpoints require STAFF or ADMIN. The controller resolves the caller
 * from the JWT — no client-supplied identity headers.
 */

const BASE = "/api/subscriptions/v2/approvals";

function asArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [];
}

function mapPage(payload: unknown): SpringPage<ApprovalRequestRecord> {
  if (!payload || typeof payload !== "object") {
    return {
      content: [],
      totalElements: 0,
      totalPages: 0,
      size: 0,
      number: 0,
      first: true,
      last: true,
      empty: true,
    };
  }
  const record = payload as Record<string, unknown>;
  const rawContent = asArray(record.content) as ApprovalRequestRecord[];
  return {
    content: rawContent,
    totalElements: typeof record.totalElements === "number" ? record.totalElements : rawContent.length,
    totalPages: typeof record.totalPages === "number" ? record.totalPages : 1,
    size: typeof record.size === "number" ? record.size : rawContent.length,
    number: typeof record.number === "number" ? record.number : 0,
    first: record.first !== false,
    last: record.last !== false,
    empty: rawContent.length === 0,
  };
}

export const approvalsService = {
  async submit(token: string, body: SubmitApprovalRequestBody): Promise<ApprovalRequestRecord> {
    const response = await apiRequest<ApiResponse<ApprovalRequestRecord> | ApprovalRequestRecord>({
      service: "subscription",
      path: BASE,
      method: "POST",
      token,
      body,
    });
    return unwrapData<ApprovalRequestRecord>(response);
  },

  async approve(
    token: string,
    id: number,
    decision?: ApprovalDecisionBody,
  ): Promise<ApprovalRequestRecord> {
    const response = await apiRequest<ApiResponse<ApprovalRequestRecord> | ApprovalRequestRecord>({
      service: "subscription",
      path: `${BASE}/${id}/approve`,
      method: "POST",
      token,
      body: decision ?? {},
    });
    return unwrapData<ApprovalRequestRecord>(response);
  },

  async reject(
    token: string,
    id: number,
    decision?: ApprovalDecisionBody,
  ): Promise<ApprovalRequestRecord> {
    const response = await apiRequest<ApiResponse<ApprovalRequestRecord> | ApprovalRequestRecord>({
      service: "subscription",
      path: `${BASE}/${id}/reject`,
      method: "POST",
      token,
      body: decision ?? {},
    });
    return unwrapData<ApprovalRequestRecord>(response);
  },

  async cancel(token: string, id: number): Promise<ApprovalRequestRecord> {
    const response = await apiRequest<ApiResponse<ApprovalRequestRecord> | ApprovalRequestRecord>({
      service: "subscription",
      path: `${BASE}/${id}`,
      method: "DELETE",
      token,
    });
    return unwrapData<ApprovalRequestRecord>(response);
  },

  async getById(token: string, id: number): Promise<ApprovalRequestRecord> {
    const response = await apiRequest<ApiResponse<ApprovalRequestRecord> | ApprovalRequestRecord>({
      service: "subscription",
      path: `${BASE}/${id}`,
      token,
    });
    return unwrapData<ApprovalRequestRecord>(response);
  },

  async listPending(
    token: string,
    page = 0,
    size = 20,
  ): Promise<SpringPage<ApprovalRequestRecord>> {
    const response = await apiRequest<ApiResponse<unknown> | unknown>({
      service: "subscription",
      path: `${BASE}/pending`,
      token,
      query: { page, size },
    });
    return mapPage(unwrapData<unknown>(response));
  },

  async pendingCount(token: string): Promise<number> {
    const response = await apiRequest<ApiResponse<{ count: number }> | { count: number }>({
      service: "subscription",
      path: `${BASE}/pending/count`,
      token,
    });
    const payload = unwrapData<{ count?: number }>(response);
    return payload?.count ?? 0;
  },

  async listMine(
    token: string,
    page = 0,
    size = 20,
  ): Promise<SpringPage<ApprovalRequestRecord>> {
    const response = await apiRequest<ApiResponse<unknown> | unknown>({
      service: "subscription",
      path: `${BASE}/mine`,
      token,
      query: { page, size },
    });
    return mapPage(unwrapData<unknown>(response));
  },
};
