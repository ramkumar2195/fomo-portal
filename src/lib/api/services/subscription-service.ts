import { apiRequest } from "@/lib/api/http-client";
import { serviceBaseUrls } from "@/lib/api/config";
import { unwrapData } from "@/lib/api/response";
import {
  CreateInquiryRequest,
  InquiryRecord,
  InquirySearchQuery,
  InquiryStatus,
  UpdateInquiryRequest,
} from "@/types/inquiry";
import { BillingInvoice, InvoiceSummary, Plan } from "@/types/models";

interface JsonRecord {
  [key: string]: unknown;
}

export interface SubscriptionCreateRequest {
  variantId: string;
  discountAmount?: number;
  gstPercent?: number;
  [key: string]: unknown;
}

export interface InvoicePaymentRequest {
  amount?: number;
  mode?: string;
  [key: string]: unknown;
}

export interface InquiryActionResult {
  inquiryId: string;
  memberId?: string;
  raw: unknown;
}

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function toString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return "";
}

function toNumber(payload: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function toOptionalNumber(payload: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function toBoolean(payload: JsonRecord, keys: string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }

      if (normalized === "false") {
        return false;
      }
    }
  }

  return false;
}

function mapPlans(payload: unknown): Plan[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      id: toString(record, ["id", "variantId", "code"]) || `variant-${index}`,
      name: toString(record, ["name", "title", "variantName"]) || `Variant ${index + 1}`,
      durationMonths: toNumber(record, ["durationMonths", "duration", "tenureMonths"]),
      price: toNumber(record, ["price", "mrp", "amount", "baseAmount"]),
      gstPercent: toNumber(record, ["gstPercent", "taxPercent"]),
    }));
}

function mapBillingResult(payload: unknown): BillingInvoice {
  const record = toRecord(payload);

  return {
    subscriptionId: toString(record, ["subscriptionId", "id", "subscription_id"]) || undefined,
    invoiceId: toString(record, ["invoiceId", "id", "invoice_id"]),
    invoiceNumber: toString(record, ["invoiceNumber", "number", "invoiceNo"]),
    receiptId: toString(record, ["receiptId", "receipt_id"]) || undefined,
    receiptNumber: toString(record, ["receiptNumber", "receiptNo"]) || undefined,
    total: toNumber(record, ["total", "amount", "invoiceAmount"]),
  };
}

function mapInvoices(payload: unknown): InvoiceSummary[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      id: toString(record, ["id", "invoiceId"]) || `invoice-${index}`,
      invoiceNumber: toString(record, ["invoiceNumber", "number", "invoiceNo"]) || "-",
      amount: toNumber(record, ["amount", "total", "invoiceAmount"]),
      status: toString(record, ["status", "invoiceStatus"]) || "UNKNOWN",
      issuedAt: toString(record, ["issuedAt", "createdAt", "invoiceDate"]),
    }));
}

function mapInquiry(payload: unknown): InquiryRecord {
  const record = toRecord(payload);
  const status = (toString(record, ["status", "leadStatus"]) || "NEW") as InquiryStatus;
  const converted = toBoolean(record, ["converted", "isConverted"]) || status === "CONVERTED";

  return {
    inquiryId: toNumber(record, ["inquiryId", "id"]),
    fullName: toString(record, ["fullName", "name", "clientName"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    alternateMobileNumber:
      toString(record, ["alternateMobileNumber", "alternateMobile", "secondaryMobile"]) || undefined,
    email: toString(record, ["email"]) || undefined,
    dateOfBirth: toString(record, ["dateOfBirth", "dob"]) || undefined,
    inquiryAt: toString(record, ["inquiryAt", "createdAt", "inquiryDate"]) || undefined,
    clientRepStaffId: toOptionalNumber(record, ["clientRepStaffId", "staffId", "assignedStaffId"]),
    gender: toString(record, ["gender"]) || undefined,
    aadhaarNumber: toString(record, ["aadhaarNumber", "aadharNumber"]) || undefined,
    gstNumber: toString(record, ["gstNumber"]) || undefined,
    defaultTrainerStaffId: toOptionalNumber(record, ["defaultTrainerStaffId", "trainerStaffId"]),
    referredByType: toString(record, ["referredByType"]) || undefined,
    referredByName: toString(record, ["referredByName"]) || undefined,
    promotionSource: toString(record, ["promotionSource", "source"]) || undefined,
    employmentStatus: toString(record, ["employmentStatus"]) || undefined,
    address: toString(record, ["address"]) || undefined,
    emergencyContactName: toString(record, ["emergencyContactName"]) || undefined,
    emergencyContactPhone: toString(record, ["emergencyContactPhone"]) || undefined,
    emergencyContactRelation: toString(record, ["emergencyContactRelation"]) || undefined,
    branchCode: toString(record, ["branchCode"]) || undefined,
    notes: toString(record, ["notes"]) || undefined,
    remarks: toString(record, ["remarks"]) || undefined,
    status,
    converted,
    memberId: toOptionalNumber(record, ["memberId"]),
    createdAt: toString(record, ["createdAt"]) || undefined,
    updatedAt: toString(record, ["updatedAt"]) || undefined,
  };
}

function mapInquiryList(payload: unknown): InquiryRecord[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => mapInquiry(item));
}

function mapInquiryAction(payload: unknown): InquiryActionResult {
  const record = toRecord(payload);
  return {
    inquiryId: toString(record, ["inquiryId", "id"]),
    memberId: toString(record, ["memberId", "customerId"]) || undefined,
    raw: payload,
  };
}

export const subscriptionService = {
  async getCatalogVariants(token: string, categoryCode: string, productCode: string): Promise<Plan[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/catalog/variants",
      token,
      query: {
        categoryCode,
        productCode,
      },
    });

    return mapPlans(unwrapData<unknown>(response));
  },

  async createInquiry(token: string, payload: CreateInquiryRequest): Promise<InquiryActionResult> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries",
      token,
      method: "POST",
      body: payload,
    });

    return mapInquiryAction(unwrapData<unknown>(response));
  },

  async searchInquiries(token: string, query: InquirySearchQuery = {}): Promise<InquiryRecord[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries",
      token,
      query,
    });

    return mapInquiryList(unwrapData<unknown>(response));
  },

  async updateInquiry(
    token: string,
    inquiryId: number,
    payload: UpdateInquiryRequest,
  ): Promise<InquiryRecord> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}`,
      token,
      method: "PATCH",
      body: payload,
    });

    return mapInquiry(unwrapData<unknown>(response));
  },

  async convertInquiry(
    token: string,
    inquiryId: string,
    payload: { customMessage?: string } = {},
  ): Promise<InquiryActionResult> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/convert`,
      token,
      method: "POST",
      body: payload,
    });

    return mapInquiryAction(unwrapData<unknown>(response));
  },

  async createMemberSubscription(
    token: string,
    memberId: string,
    payload: SubscriptionCreateRequest,
  ): Promise<BillingInvoice> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/subscriptions`,
      token,
      method: "POST",
      body: payload,
    });

    return mapBillingResult(unwrapData<unknown>(response));
  },

  async payInvoice(token: string, invoiceId: string, payload: InvoicePaymentRequest = {}): Promise<BillingInvoice> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/invoices/${invoiceId}/pay`,
      token,
      method: "POST",
      body: payload,
    });

    return mapBillingResult(unwrapData<unknown>(response));
  },

  async activateSubscription(token: string, subscriptionId: string): Promise<BillingInvoice> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/subscriptions/${subscriptionId}/activate`,
      token,
      method: "POST",
      body: {},
    });

    return mapBillingResult(unwrapData<unknown>(response));
  },

  async getMemberDashboard(token: string, memberId: string): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/dashboard/member/${memberId}`,
      token,
    });

    return unwrapData<unknown>(response);
  },

  async getMemberEntitlements(token: string, memberId: string): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/entitlements`,
      token,
    });

    return unwrapData<unknown>(response);
  },

  async getCreditsWallet(token: string, memberId: string): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/credits/wallet/${memberId}`,
      token,
    });

    return unwrapData<unknown>(response);
  },

  async getMemberStateDebug(token: string, memberId: string): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/debug/member-state/${memberId}`,
      token,
    });

    return unwrapData<unknown>(response);
  },

  async getInvoicesByMember(token: string, memberId: string): Promise<InvoiceSummary[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/invoices/member/${memberId}`,
      token,
    });

    return mapInvoices(unwrapData<unknown>(response));
  },

  getReceiptPdfUrl(receiptId: string): string {
    return `${serviceBaseUrls.subscription}/api/subscriptions/v2/receipts/${receiptId}/pdf`;
  },
};
