import axios from "axios";
import { apiBaseUrl } from "@/lib/api/config";
import { apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";
import {
  InquiryAnalyticsQuery,
  InquiryAnalyticsResponse,
  AssignInquiryRequest,
  BulkAssignInquiriesRequest,
  BulkAssignInquiriesResponse,
  CloseInquiryRequest,
  CreateInquiryRequest,
  InquiryCustomerStatus,
  InquiryConvertibility,
  InquiryRecord,
  InquiryResponseType,
  InquirySearchQuery,
  InquirySummary,
  InquiryStatus,
  InquiryStatusHistoryEntry,
  PreferredContactChannel,
  UpdateInquiryRequest,
} from "@/types/inquiry";
import { BillingReceiptSummary, InvoiceSummary } from "@/types/models";
import { MemberProfileAuditEntry } from "@/types/member-profile";
import { SpringPage } from "@/types/pagination";

interface JsonRecord {
  [key: string]: unknown;
}

export interface InquiryActionResult {
  inquiryId: string;
  memberId?: string;
  raw: unknown;
}

export interface ConvertInquiryRequest {
  memberId?: number;
  [key: string]: unknown;
}

export interface RenewalQueueQuery {
  [key: string]: string | number | undefined;
  memberId?: string | number;
  status?: string;
  state?: string;
  daysAhead?: number;
  from?: string;
  to?: string;
}

export interface RenewalQueueItem {
  memberSubscriptionId: string;
  memberId: string;
  productVariantId?: string;
  variantName: string;
  subscriptionStatus: string;
  startDate?: string;
  endDate?: string;
  daysRemaining: number;
  renewalState: string;
  invoiceId?: string;
  receiptId?: string;
  paymentConfirmed: boolean;
  legacyCatalog?: boolean;
  migrationOnly?: boolean;
}

export interface CatalogProduct {
  productId: string;
  categoryCode: string;
  productCode: string;
  productName: string;
  description?: string;
  active: boolean;
}

export interface CatalogVariant {
  variantId: string;
  categoryCode: string;
  productCode: string;
  variantCode: string;
  variantName: string;
  durationMonths: number;
  basePrice: number;
  allowedFeatures?: string;
  includedFeatures: string;
  includedPtSessions: number;
  passBenefitDays: number;
  includedCredits: number;
  checkInLimit: number;
  extraVisitPrice: number;
  validityDays: number;
  bonusCreditsOnFullUsage: number;
  creditBased: boolean;
}

export interface CreateCatalogVariantPayload {
  productCode: string;
  variantCode: string;
  variantName: string;
  durationMonths: number;
  basePrice: number;
  includedFeatures?: string;
  extraVisitPrice?: number;
  validityDays: number;
  includedPtSessions?: number;
  passBenefitDays?: number;
  includedCredits?: number;
  checkInLimit?: number;
  bonusCreditsOnFullUsage?: number;
  creditBased?: boolean;
}

export interface UpdateCatalogVariantPayload {
  productCode?: string;
  variantCode?: string;
  variantName?: string;
  durationMonths?: number;
  basePrice?: number;
  includedFeatures?: string;
  extraVisitPrice?: number;
  validityDays?: number;
  includedPtSessions?: number;
  passBenefitDays?: number;
  includedCredits?: number;
  checkInLimit?: number;
  bonusCreditsOnFullUsage?: number;
  creditBased?: boolean;
  active?: boolean;
}

export interface BillingSettings {
  gstPercentage: number;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  invoiceSequenceYear: number;
  receiptPrefix: string;
  nextReceiptNumber: number;
  receiptSequenceYear: number;
  paymentModesEnabled?: string;
  maxDiscountPercent?: number;
  lateFeeEnabled?: boolean;
  lateFeePercentPerDay?: number;
  invoiceFooterText?: string;
  hsnSacCode?: string;
}

export interface MembershipPolicySettings {
  freezeMinDays: number;
  freezeMaxDays: number;
  maxFreezesPerSubscription: number;
  freezeCooldownDays: number;
  upgradeWindowShortDays: number;
  upgradeWindowMediumDays: number;
  upgradeWindowLongDays: number;
  gracePeriodDays: number;
  autoRenewalEnabled: boolean;
  renewalReminderDaysBefore: number;
  transferEnabled: boolean;
  minPartialPaymentPercent: number;
}

export interface UpdateMembershipPolicyRequest {
  freezeMinDays?: number;
  freezeMaxDays?: number;
  maxFreezesPerSubscription?: number;
  freezeCooldownDays?: number;
  upgradeWindowShortDays?: number;
  upgradeWindowMediumDays?: number;
  upgradeWindowLongDays?: number;
  gracePeriodDays?: number;
  autoRenewalEnabled?: boolean;
  renewalReminderDaysBefore?: number;
  transferEnabled?: boolean;
  minPartialPaymentPercent?: number;
}

export interface CreatedSubscriptionItem {
  memberSubscriptionId: number;
  productVariantId?: number;
  variantName?: string;
  subscriptionStatus?: string;
  startDate?: string;
  endDate?: string;
  addOn?: boolean;
}

export interface SubscriptionInvoiceLine {
  lineType: string;
  description: string;
  amount: number;
  quantity: number;
  referenceId?: number;
}

export interface CreateMemberSubscriptionResult {
  memberSubscriptionId: number;
  invoiceId: number;
  invoiceNumber: string;
  memberId: number;
  productVariantId: number;
  variantName: string;
  subscriptionStatus: string;
  startDate?: string;
  endDate?: string;
  invoiceTotal: number;
  grossSubtotal: number;
  discountAmount: number;
  taxableSubtotal: number;
  gstPercentage: number;
  cgstAmount: number;
  sgstAmount: number;
  totalTax: number;
  totalPaidAmount: number;
  balanceAmount: number;
  invoiceStatus: string;
  invoiceDueAt?: string;
  billedByStaffId?: number;
  createdSubscriptions: CreatedSubscriptionItem[];
  invoiceLines: SubscriptionInvoiceLine[];
}

export interface PaymentReceipt {
  invoiceId: number;
  invoiceNumber: string;
  receiptId: number;
  receiptNumber: string;
  transactionId?: string;
  amount: number;
  totalPaidAmount: number;
  balanceAmount: number;
  paymentStatus: string;
  paymentMode: string;
  paidAt?: string;
}

export interface AddFlexVisitResult {
  subscriptionId: number;
  memberId: number;
  invoiceId: number;
  invoiceNumber: string;
  receiptId: number;
  receiptNumber: string;
  amountPaid: number;
  paymentMode: string;
  includedCheckIns: number;
  usedCheckIns: number;
  remainingCheckIns: number;
}

export interface MemberEntitlement {
  entitlementId: number;
  feature: string;
  source: string;
  validFrom?: string;
  validUntil?: string;
  includedCount?: number;
  remainingCount?: number;
  recurrence?: string;
  usedCount?: number;
  expiredUnusedCount?: number;
  manualTopUpCount?: number;
  expiresIfUnused?: boolean;
  currentCycleStart?: string;
  currentCycleEnd?: string;
  lastUtilizedAt?: string;
  lastExpiredAt?: string;
}

export interface MemberEntitlementLedgerEntry {
  ledgerId: number;
  entitlementId: number;
  feature: string;
  eventType: string;
  quantity: number;
  occurredOn?: string;
  cycleStart?: string;
  cycleEnd?: string;
  notes?: string;
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

function toNullableNumber(payload: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (value === null) {
      return null;
    }

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

  return null;
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

function mapInvoices(payload: unknown): InvoiceSummary[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      id: toString(record, ["id", "invoiceId"]) || `invoice-${index}`,
      invoiceNumber: toString(record, ["invoiceNumber", "number", "invoiceNo"]) || "-",
      billedByStaffId: toString(record, ["billedByStaffId"]) || undefined,
      amount: toNumber(record, ["amount", "total", "invoiceAmount"]),
      status: toString(record, ["status", "invoiceStatus"]) || "UNKNOWN",
      issuedAt: toString(record, ["issuedAt", "createdAt", "invoiceDate"]),
      dueAt: toString(record, ["dueAt", "invoiceDueAt"]) || undefined,
      subtotal: toOptionalNumber(record, ["subtotal"]) ?? undefined,
      tax: toOptionalNumber(record, ["tax"]) ?? undefined,
      paidAmount: toOptionalNumber(record, ["paidAmount", "totalPaidAmount"]) ?? undefined,
      balanceAmount: toOptionalNumber(record, ["balanceAmount", "outstandingAmount"]) ?? undefined,
      receiptId: toString(record, ["receiptId"]) || undefined,
      receiptNumber: toString(record, ["receiptNumber"]) || undefined,
    }));
}

function mapReceipts(payload: unknown): BillingReceiptSummary[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      id: toString(record, ["receiptId", "id"]) || `receipt-${index}`,
      receiptNumber: toString(record, ["receiptNumber", "number"]) || "-",
      invoiceId: toString(record, ["invoiceId"]) || undefined,
      memberId: toString(record, ["memberId"]) || undefined,
      amount: toNumber(record, ["amount", "paidAmount"]),
      paymentMode: toString(record, ["paymentMode"]) || undefined,
      paidAt: toString(record, ["paidAt", "createdAt"]) || undefined,
    }));
}

function mapLifecycleAudit(payload: unknown): MemberProfileAuditEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      auditId: toString(record, ["auditId", "id"]) || `lifecycle-audit-${index}`,
      memberId: toString(record, ["memberId"]) || undefined,
      actorId: toString(record, ["actorId"]) || undefined,
      actorName: toString(record, ["actorName"]) || undefined,
      action: toString(record, ["action"]) || undefined,
      summary: toString(record, ["summary"]) || undefined,
      changesJson: toString(record, ["details"]) || undefined,
      createdAt: toString(record, ["createdAt"]) || undefined,
      raw: record,
    }));
}

function mapRenewalQueue(payload: unknown): RenewalQueueItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      memberSubscriptionId: toString(record, ["memberSubscriptionId", "id"]) || `renewal-${index}`,
      memberId: toString(record, ["memberId"]) || "",
      productVariantId: toString(record, ["productVariantId"]) || undefined,
      variantName: toString(record, ["variantName", "planName", "productName"]) || "Subscription",
      subscriptionStatus: toString(record, ["subscriptionStatus", "status"]) || "UNKNOWN",
      startDate: toString(record, ["startDate"]) || undefined,
      endDate: toString(record, ["endDate", "expiryDate"]) || undefined,
      daysRemaining: toNumber(record, ["daysRemaining"]),
      renewalState: toString(record, ["renewalState", "state"]) || "UNKNOWN",
      invoiceId: toString(record, ["invoiceId"]) || undefined,
      receiptId: toString(record, ["receiptId"]) || undefined,
      paymentConfirmed: toBoolean(record, ["paymentConfirmed"]),
      legacyCatalog: toBoolean(record, ["legacyCatalog"]),
      migrationOnly: toBoolean(record, ["migrationOnly"]),
    }));
}

function mapCatalogProducts(payload: unknown): CatalogProduct[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record, index) => ({
      productId: toString(record, ["productId", "id"]) || `product-${index}`,
      categoryCode: toString(record, ["categoryCode"]) || "UNCATEGORIZED",
      productCode: toString(record, ["productCode", "code"]) || `PRODUCT_${index + 1}`,
      productName: toString(record, ["productName", "name"]) || `Product ${index + 1}`,
      description: toString(record, ["description"]) || undefined,
      active: toBoolean(record, ["active"]),
    }));
}

function mapCatalogVariant(payload: unknown): CatalogVariant {
  const record = toRecord(payload);
  return {
    variantId: toString(record, ["variantId", "id"]),
    categoryCode: toString(record, ["categoryCode"]) || "UNCATEGORIZED",
    productCode: toString(record, ["productCode"]) || "",
    variantCode: toString(record, ["variantCode", "code"]) || "",
    variantName: toString(record, ["variantName", "name"]) || "Variant",
    durationMonths: toNumber(record, ["durationMonths"]),
    basePrice: toNumber(record, ["basePrice", "price"]),
    allowedFeatures: toString(record, ["allowedFeatures"]) || undefined,
    includedFeatures: toString(record, ["includedFeatures"]),
    includedPtSessions: toNumber(record, ["includedPtSessions"]),
    passBenefitDays: toNumber(record, ["passBenefitDays"]),
    includedCredits: toNumber(record, ["includedCredits"]),
    checkInLimit: toNumber(record, ["checkInLimit"]),
    extraVisitPrice: toNumber(record, ["extraVisitPrice"]),
    validityDays: toNumber(record, ["validityDays"]),
    bonusCreditsOnFullUsage: toNumber(record, ["bonusCreditsOnFullUsage"]),
    creditBased: toBoolean(record, ["creditBased"]),
  };
}

function mapCatalogVariants(payload: unknown): CatalogVariant[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => mapCatalogVariant(item));
}

function mapBillingSettings(payload: unknown): BillingSettings {
  const record = toRecord(payload);
  return {
    gstPercentage: toNumber(record, ["gstPercentage"]),
    invoicePrefix: toString(record, ["invoicePrefix"]) || "INV",
    nextInvoiceNumber: toNumber(record, ["nextInvoiceNumber"]) || 1,
    invoiceSequenceYear: toNumber(record, ["invoiceSequenceYear"]) || new Date().getFullYear(),
    receiptPrefix: toString(record, ["receiptPrefix"]) || "RCPT",
    nextReceiptNumber: toNumber(record, ["nextReceiptNumber"]) || 1,
    receiptSequenceYear: toNumber(record, ["receiptSequenceYear"]) || new Date().getFullYear(),
    paymentModesEnabled: toString(record, ["paymentModesEnabled"]) || "CASH,UPI,CARD,BANK_TRANSFER",
    maxDiscountPercent: toOptionalNumber(record, ["maxDiscountPercent"]) ?? 100,
    lateFeeEnabled: toBoolean(record, ["lateFeeEnabled"]),
    lateFeePercentPerDay: toOptionalNumber(record, ["lateFeePercentPerDay"]) ?? 0,
    invoiceFooterText: toString(record, ["invoiceFooterText"]) || undefined,
    hsnSacCode: toString(record, ["hsnSacCode"]) || undefined,
  };
}

function mapMembershipPolicySettings(payload: unknown): MembershipPolicySettings {
  const record = toRecord(payload);
  return {
    freezeMinDays: toNumber(record, ["freezeMinDays"]) || 7,
    freezeMaxDays: toNumber(record, ["freezeMaxDays"]) || 28,
    maxFreezesPerSubscription: toNumber(record, ["maxFreezesPerSubscription"]) || 4,
    freezeCooldownDays: toNumber(record, ["freezeCooldownDays"]),
    upgradeWindowShortDays: toNumber(record, ["upgradeWindowShortDays"]) || 7,
    upgradeWindowMediumDays: toNumber(record, ["upgradeWindowMediumDays"]) || 15,
    upgradeWindowLongDays: toNumber(record, ["upgradeWindowLongDays"]) || 28,
    gracePeriodDays: toNumber(record, ["gracePeriodDays"]) || 7,
    autoRenewalEnabled: toBoolean(record, ["autoRenewalEnabled"]),
    renewalReminderDaysBefore: toNumber(record, ["renewalReminderDaysBefore"]) || 7,
    transferEnabled: toBoolean(record, ["transferEnabled"]),
    minPartialPaymentPercent: toNumber(record, ["minPartialPaymentPercent"]) || 50,
  };
}

function mapCreatedSubscriptionItem(payload: unknown): CreatedSubscriptionItem {
  const record = toRecord(payload);
  return {
    memberSubscriptionId: toNumber(record, ["memberSubscriptionId", "id"]),
    productVariantId: toOptionalNumber(record, ["productVariantId"]),
    variantName: toString(record, ["variantName"]),
    subscriptionStatus: toString(record, ["subscriptionStatus", "status"]),
    startDate: toString(record, ["startDate"]) || undefined,
    endDate: toString(record, ["endDate"]) || undefined,
    addOn: toBoolean(record, ["addOn"]),
  };
}

function mapSubscriptionInvoiceLine(payload: unknown): SubscriptionInvoiceLine {
  const record = toRecord(payload);
  return {
    lineType: toString(record, ["lineType"]) || "LINE",
    description: toString(record, ["description"]) || "-",
    amount: toNumber(record, ["amount"]),
    quantity: toNumber(record, ["quantity"]),
    referenceId: toOptionalNumber(record, ["referenceId"]),
  };
}

function mapCreateMemberSubscriptionResult(payload: unknown): CreateMemberSubscriptionResult {
  const record = toRecord(payload);
  const createdSubscriptionsRaw = Array.isArray(record.createdSubscriptions) ? record.createdSubscriptions : [];
  const invoiceLinesRaw = Array.isArray(record.invoiceLines) ? record.invoiceLines : [];

  return {
    memberSubscriptionId: toNumber(record, ["memberSubscriptionId"]),
    invoiceId: toNumber(record, ["invoiceId"]),
    invoiceNumber: toString(record, ["invoiceNumber"]),
    memberId: toNumber(record, ["memberId"]),
    productVariantId: toNumber(record, ["productVariantId"]),
    variantName: toString(record, ["variantName"]),
    subscriptionStatus: toString(record, ["subscriptionStatus"]),
    startDate: toString(record, ["startDate"]) || undefined,
    endDate: toString(record, ["endDate"]) || undefined,
    invoiceTotal: toNumber(record, ["invoiceTotal", "total"]),
    grossSubtotal: toNumber(record, ["grossSubtotal"]),
    discountAmount: toNumber(record, ["discountAmount"]),
    taxableSubtotal: toNumber(record, ["taxableSubtotal"]),
    gstPercentage: toNumber(record, ["gstPercentage"]),
    cgstAmount: toNumber(record, ["cgstAmount"]),
    sgstAmount: toNumber(record, ["sgstAmount"]),
    totalTax: toNumber(record, ["totalTax"]),
    totalPaidAmount: toNumber(record, ["totalPaidAmount"]),
    balanceAmount: toNumber(record, ["balanceAmount"]),
    invoiceStatus: toString(record, ["invoiceStatus", "status"]) || "ISSUED",
    invoiceDueAt: toString(record, ["invoiceDueAt"]) || undefined,
    billedByStaffId: toOptionalNumber(record, ["billedByStaffId"]),
    createdSubscriptions: createdSubscriptionsRaw.map((item) => mapCreatedSubscriptionItem(item)),
    invoiceLines: invoiceLinesRaw.map((item) => mapSubscriptionInvoiceLine(item)),
  };
}

function mapPaymentReceipt(payload: unknown): PaymentReceipt {
  const record = toRecord(payload);
  return {
    invoiceId: toNumber(record, ["invoiceId"]),
    invoiceNumber: toString(record, ["invoiceNumber"]),
    receiptId: toNumber(record, ["receiptId"]),
    receiptNumber: toString(record, ["receiptNumber"]),
    transactionId: toString(record, ["transactionId", "transactionReference"]) || undefined,
    amount: toNumber(record, ["amount"]),
    totalPaidAmount: toNumber(record, ["totalPaidAmount"]),
    balanceAmount: toNumber(record, ["balanceAmount"]),
    paymentStatus: toString(record, ["paymentStatus", "status"]) || "ISSUED",
    paymentMode: toString(record, ["paymentMode"]) || "OTHER",
    paidAt: toString(record, ["paidAt"]) || undefined,
  };
}

function mapAddFlexVisitResult(payload: unknown): AddFlexVisitResult {
  const record = toRecord(payload);
  return {
    subscriptionId: toNumber(record, ["subscriptionId", "memberSubscriptionId"]),
    memberId: toNumber(record, ["memberId"]),
    invoiceId: toNumber(record, ["invoiceId"]),
    invoiceNumber: toString(record, ["invoiceNumber"]),
    receiptId: toNumber(record, ["receiptId"]),
    receiptNumber: toString(record, ["receiptNumber"]),
    amountPaid: toNumber(record, ["amountPaid", "amount"]),
    paymentMode: toString(record, ["paymentMode"]) || "OTHER",
    includedCheckIns: toNumber(record, ["includedCheckIns"]),
    usedCheckIns: toNumber(record, ["usedCheckIns"]),
    remainingCheckIns: toNumber(record, ["remainingCheckIns"]),
  };
}

function mapInquiry(payload: unknown): InquiryRecord {
  const record = toRecord(payload);
  const status = toString(record, ["status"]) as InquiryStatus;

  return {
    inquiryId: toNumber(record, ["inquiryId", "id"]),
    fullName: toString(record, ["fullName", "name"]),
    mobileNumber: toString(record, ["mobileNumber", "mobile", "phone"]),
    alternateMobileNumber: toString(record, ["alternateMobileNumber"]) || undefined,
    email: toString(record, ["email"]) || undefined,
    dateOfBirth: toString(record, ["dateOfBirth"]) || undefined,
    inquiryAt: toString(record, ["inquiryAt"]) || undefined,
    clientRepStaffId: toOptionalNumber(record, ["clientRepStaffId"]),
    assignedToStaffId: toOptionalNumber(record, ["assignedToStaffId"]),
    gender: toString(record, ["gender"]) || undefined,
    aadhaarNumber: toString(record, ["aadhaarNumber"]) || undefined,
    gstNumber: toString(record, ["gstNumber"]) || undefined,
    defaultTrainerStaffId: toOptionalNumber(record, ["defaultTrainerStaffId"]),
    referredByType: toString(record, ["referredByType"]) || undefined,
    referredByName: toString(record, ["referredByName"]) || undefined,
    promotionSource: toString(record, ["promotionSource"]) || undefined,
    employmentStatus: toString(record, ["employmentStatus"]) || undefined,
    address: toString(record, ["address"]) || undefined,
    emergencyContactName: toString(record, ["emergencyContactName"]) || undefined,
    emergencyContactPhone: toString(record, ["emergencyContactPhone"]) || undefined,
    emergencyContactRelation: toString(record, ["emergencyContactRelation"]) || undefined,
    branchId: toOptionalNumber(record, ["branchId"]),
    branchCode: toString(record, ["branchCode"]) || undefined,
    notes: toString(record, ["notes"]) || undefined,
    remarks: toString(record, ["remarks"]) || undefined,
    responseType: toString(record, ["responseType"]) as InquiryResponseType | undefined,
    preferredContactChannel: toString(record, ["preferredContactChannel"]) as PreferredContactChannel | undefined,
    customerStatus: toString(record, ["customerStatus"]) as InquiryCustomerStatus | undefined,
    interestedIn: toString(record, ["interestedIn"]) || undefined,
    trialGiven: toBoolean(record, ["trialGiven"]),
    trialDays: toOptionalNumber(record, ["trialDays", "trialDaysGiven"]),
    trialAttempts: toOptionalNumber(record, ["trialAttempts"]),
    trialExpiryAt: toString(record, ["trialExpiryAt"]) || undefined,
    followUpComment: toString(record, ["followUpComment"]) || undefined,
    status,
    convertibility: toString(record, ["convertibility"]) as InquiryConvertibility | undefined,
    closeReason: toString(record, ["closeReason"]) || undefined,
    workflowStatus: toString(record, ["workflowStatus"]) || undefined,
    converted: toBoolean(record, ["converted"]),
    memberId: toNullableNumber(record, ["memberId"]),
    createdAt: toString(record, ["createdAt"]) || undefined,
    updatedAt: toString(record, ["updatedAt"]) || undefined,
  };
}

function mapInquirySummary(payload: unknown): InquirySummary {
  const record = toRecord(payload);
  const latestFollowUp = toRecord(record.latestFollowUp);
  const enquiryContext = toRecord(record.enquiryContext);

  return {
    latestFollowUp:
      Object.keys(latestFollowUp).length > 0
        ? {
            dueAt: toString(latestFollowUp, ["dueAt"]) || undefined,
            channel: toString(latestFollowUp, ["channel"]) as PreferredContactChannel | undefined,
            status: toString(latestFollowUp, ["status"]) || undefined,
            notes: toString(latestFollowUp, ["notes"]) || null,
          }
        : undefined,
    enquiryContext:
      Object.keys(enquiryContext).length > 0
        ? {
            responseType: toString(enquiryContext, ["responseType"]) as InquiryResponseType | undefined,
            preferredContactChannel: toString(enquiryContext, ["preferredContactChannel"]) as PreferredContactChannel | undefined,
            customerStatus: toString(enquiryContext, ["customerStatus"]) as InquiryCustomerStatus | undefined,
            interestedIn: toString(enquiryContext, ["interestedIn"]) || undefined,
            trialGiven: toBoolean(enquiryContext, ["trialGiven"]),
            trialDays: toOptionalNumber(enquiryContext, ["trialDays", "trialDaysGiven"]),
            trialAttempts: toOptionalNumber(enquiryContext, ["trialAttempts"]),
            trialExpiryAt: toString(enquiryContext, ["trialExpiryAt"]) || undefined,
          }
        : undefined,
  };
}

function mapInquiryPage(payload: unknown): SpringPage<InquiryRecord> {
  const record = toRecord(payload);
  const rawContent = Array.isArray(record.content) ? record.content : [];

  return {
    content: rawContent.map((item) => mapInquiry(item)),
    number: toNumber(record, ["number"]),
    size: toNumber(record, ["size"]),
    totalElements: toNumber(record, ["totalElements"]),
    totalPages: toNumber(record, ["totalPages"]),
    first: toBoolean(record, ["first"]),
    last: toBoolean(record, ["last"]),
    empty: toBoolean(record, ["empty"]),
    numberOfElements: toOptionalNumber(record, ["numberOfElements"]),
  };
}

function mapInquiryAction(payload: unknown): InquiryActionResult {
  const record = toRecord(payload);
  return {
    inquiryId: toString(record, ["inquiryId"]),
    memberId: toString(record, ["memberId"]) || undefined,
    raw: payload,
  };
}

function mapInquiryStatusHistory(payload: unknown): InquiryStatusHistoryEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toRecord(item))
    .map((record) => ({
      fromStatus: toString(record, ["fromStatus"]) as InquiryStatus | undefined,
      toStatus: toString(record, ["toStatus"]) as InquiryStatus | undefined,
      changedByStaffId: toNullableNumber(record, ["changedByStaffId"]),
      changedAt: toString(record, ["changedAt"]) || undefined,
      remarks: toString(record, ["remarks"]) || undefined,
    }));
}

function mapBulkAssignResponse(payload: unknown): BulkAssignInquiriesResponse {
  const record = toRecord(payload);
  const inquiryIdsRaw = Array.isArray(record.inquiryIds) ? record.inquiryIds : [];
  const inquiryIds = inquiryIdsRaw
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) {
        return item;
      }
      if (typeof item === "string") {
        const parsed = Number(item);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((item): item is number => item !== null);

  return {
    assignedToStaffId: toNumber(record, ["assignedToStaffId"]),
    requestedCount: toNumber(record, ["requestedCount"]),
    updatedCount: toNumber(record, ["updatedCount"]),
    inquiryIds,
  };
}

export const subscriptionService = {
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

  async searchInquiriesPaged(
    token: string,
    query: InquirySearchQuery = {},
    page = 0,
    size = 10,
  ): Promise<SpringPage<InquiryRecord>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries/paged",
      token,
      query: {
        ...query,
        page,
        size,
      },
    });

    return mapInquiryPage(unwrapData<unknown>(response));
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

  async getInquiryById(token: string, inquiryId: number): Promise<InquiryRecord> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}`,
      token,
    });

    return mapInquiry(unwrapData<unknown>(response));
  },

  async getInquirySummary(token: string, inquiryId: number): Promise<InquirySummary> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/summary`,
      token,
    });

    return mapInquirySummary(unwrapData<unknown>(response));
  },

  async getInquiryAnalytics(token: string, query: InquiryAnalyticsQuery = {}): Promise<InquiryAnalyticsResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries/analytics",
      token,
      query,
    });

    return toRecord(unwrapData<unknown>(response));
  },

  async convertInquiry(
    token: string,
    inquiryId: string,
    payload: ConvertInquiryRequest = {},
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

  async createInquiryFollowUp(
    token: string,
    inquiryId: number,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/follow-ups`,
      token,
      method: "POST",
      body: payload,
    });

    return unwrapData<unknown>(response);
  },

  async getInquiryStatusHistory(token: string, inquiryId: number): Promise<InquiryStatusHistoryEntry[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/status-history`,
      token,
    });

    return mapInquiryStatusHistory(unwrapData<unknown>(response));
  },

  async assignInquiry(token: string, inquiryId: number, payload: AssignInquiryRequest): Promise<InquiryRecord> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/assign`,
      token,
      method: "PATCH",
      body: payload,
    });

    return mapInquiry(unwrapData<unknown>(response));
  },

  async bulkAssignInquiries(token: string, payload: BulkAssignInquiriesRequest): Promise<BulkAssignInquiriesResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/inquiries/assign/bulk",
      token,
      method: "PATCH",
      body: payload,
    });

    return mapBulkAssignResponse(unwrapData<unknown>(response));
  },

  async closeInquiry(token: string, inquiryId: number, payload: CloseInquiryRequest): Promise<InquiryRecord> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/inquiries/${inquiryId}/close`,
      token,
      method: "POST",
      body: payload,
    });

    return mapInquiry(unwrapData<unknown>(response));
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

  async getMemberEntitlementLedger(token: string, memberId: string, entitlementId: number | string): Promise<MemberEntitlementLedgerEntry[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/entitlements/${entitlementId}/ledger`,
      token,
    });

    const data = unwrapData<unknown>(response);
    return Array.isArray(data) ? (data as MemberEntitlementLedgerEntry[]) : [];
  },

  async consumeMemberEntitlement(
    token: string,
    memberId: string,
    entitlementId: number | string,
    payload: { quantity?: number; usedOn?: string; notes?: string },
  ): Promise<MemberEntitlement> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/entitlements/${entitlementId}/consume`,
      token,
      method: "POST",
      body: payload,
    });

    return unwrapData<MemberEntitlement>(response);
  },

  async topUpMemberEntitlement(
    token: string,
    memberId: string,
    entitlementId: number | string,
    payload: { quantity?: number; effectiveOn?: string; notes?: string },
  ): Promise<MemberEntitlement> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/entitlements/${entitlementId}/top-up`,
      token,
      method: "POST",
      body: payload,
    });

    return unwrapData<MemberEntitlement>(response);
  },

  /**
   * Direct grant of additional PAUSE_BENEFIT days. Backend enforces that
   * only SUPER_ADMIN and GYM_MANAGER can hit this endpoint — any other
   * STAFF role gets 403 and must submit an approval request instead via
   * approvalsService.submit({ requestType: "GRANT_PAUSE_BENEFIT", ... }).
   *
   * The caller is expected to pass its own idempotencyKey (e.g.
   * `DIRECT_GRANT_<memberId>_<timestamp>`) so a retry of the same submit
   * doesn't double-credit the entitlement.
   */
  async grantPauseBenefit(
    token: string,
    memberId: string | number,
    payload: { days: number; reason?: string; idempotencyKey: string },
  ): Promise<MemberEntitlement> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/pause-benefit/grant`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<MemberEntitlement>(response);
  },

  async getCreditsWallet(token: string, memberId: string): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "engagement",
      path: `/api/credits/wallet/${memberId}`,
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

  async getMemberBillingInvoices(token: string, memberId: string): Promise<InvoiceSummary[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/billing/invoices`,
      token,
    });

    return mapInvoices(unwrapData<unknown>(response));
  },

  async getMemberBillingReceipts(token: string, memberId: string): Promise<BillingReceiptSummary[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/billing/receipts`,
      token,
    });

    return mapReceipts(unwrapData<unknown>(response));
  },

  async getMemberLifecycleAudit(token: string, memberId: string): Promise<MemberProfileAuditEntry[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/lifecycle-audit`,
      token,
    });

    return mapLifecycleAudit(unwrapData<unknown>(response));
  },

  async getRenewalsQueue(token: string, query: RenewalQueueQuery = {}): Promise<RenewalQueueItem[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/renewals",
      token,
      query,
    });

    return mapRenewalQueue(unwrapData<unknown>(response));
  },

  // ── Finance Dashboard ──────────────────────────────────────────────

  async getFinanceDashboard(token: string, query: { from?: string; to?: string } = {}): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/finance/dashboard",
      token,
      query,
    });
    return toRecord(unwrapData<unknown>(response));
  },

  async getInvoiceRegister(token: string, query: { from?: string; to?: string; memberId?: string; status?: string } = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/finance/registers/invoices",
      token,
      query,
    });
    const data = unwrapData<unknown>(response);
    return Array.isArray(data) ? data : [];
  },

  async getReceiptRegister(token: string, query: { from?: string; to?: string; memberId?: string; paymentMode?: string } = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/finance/registers/receipts",
      token,
      query,
    });
    const data = unwrapData<unknown>(response);
    return Array.isArray(data) ? data : [];
  },

  async getBalanceDue(token: string, query: { memberId?: string; asOfDate?: string; branchCode?: string } = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/finance/registers/balance-due",
      token,
      query,
    });
    const data = unwrapData<unknown>(response);
    return Array.isArray(data) ? data : [];
  },

  async getSubscriptionRegister(token: string, query: { from?: string; to?: string; memberId?: string; status?: string } = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/finance/registers/subscriptions",
      token,
      query,
    });
    const data = unwrapData<unknown>(response);
    return Array.isArray(data) ? data : [];
  },

  async getDiscountLogs(token: string, query: { from?: string; to?: string; memberId?: string; discountedByStaffId?: string } = {}): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/finance/registers/discount-logs",
      token,
      query,
    });
    const data = unwrapData<unknown>(response);
    return Array.isArray(data) ? data : [];
  },

  async getBillingSettings(token: string): Promise<BillingSettings> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/settings/billing",
      token,
    });
    return mapBillingSettings(unwrapData<unknown>(response));
  },

  async updateBillingSettings(
    token: string,
    payload: {
      gstPercentage: number;
      invoicePrefix?: string;
      nextInvoiceNumber?: number;
      receiptPrefix?: string;
      nextReceiptNumber?: number;
      paymentModesEnabled?: string;
      maxDiscountPercent?: number;
      lateFeeEnabled?: boolean;
      lateFeePercentPerDay?: number;
      invoiceFooterText?: string;
      hsnSacCode?: string;
    },
  ): Promise<BillingSettings> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/settings/billing",
      token,
      method: "PATCH",
      body: payload,
    });
    return mapBillingSettings(unwrapData<unknown>(response));
  },

  // ── Catalog & Subscription Lifecycle ───────────────────────────────

  async getCatalogVariants(token: string, query: { categoryCode?: string; productCode?: string } = {}): Promise<CatalogVariant[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/catalog/variants",
      token,
      query,
    });
    return mapCatalogVariants(unwrapData<unknown>(response));
  },

  async getCatalogProducts(token: string, query: { categoryCode?: string } = {}): Promise<CatalogProduct[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/catalog/products",
      token,
      query,
    });
    return mapCatalogProducts(unwrapData<unknown>(response));
  },

  async createCatalogVariant(token: string, payload: CreateCatalogVariantPayload): Promise<CatalogVariant> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/catalog/variants",
      token,
      method: "POST",
      body: payload,
    });
    return mapCatalogVariant(unwrapData<unknown>(response));
  },

  async updateCatalogVariant(token: string, variantId: string | number, payload: UpdateCatalogVariantPayload): Promise<CatalogVariant> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/catalog/variants/${variantId}`,
      token,
      method: "PATCH",
      body: payload,
    });
    return mapCatalogVariant(unwrapData<unknown>(response));
  },

  async deactivateCatalogVariant(token: string, variantId: string | number): Promise<CatalogVariant> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/catalog/variants/${variantId}`,
      token,
      method: "DELETE",
    });
    return mapCatalogVariant(unwrapData<unknown>(response));
  },

  async createMemberSubscription(token: string, memberId: string, payload: Record<string, unknown>): Promise<CreateMemberSubscriptionResult> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/subscriptions`,
      token,
      method: "POST",
      body: payload,
    });
    return mapCreateMemberSubscriptionResult(unwrapData<unknown>(response));
  },

  async createMemberAddOnSubscription(token: string, memberId: string, payload: Record<string, unknown>): Promise<CreateMemberSubscriptionResult> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/add-ons`,
      token,
      method: "POST",
      body: payload,
    });
    return mapCreateMemberSubscriptionResult(unwrapData<unknown>(response));
  },

  async renewSubscription(token: string, memberId: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/renew`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  async upgradeSubscription(token: string, memberId: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/upgrade`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  async downgradeSubscription(token: string, memberId: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/members/${memberId}/downgrade`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  async transferSubscription(
    token: string,
    subscriptionId: string | number,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/subscriptions/${subscriptionId}/transfer`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  async recordPayment(token: string, invoiceId: number, payload: Record<string, unknown>): Promise<PaymentReceipt> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/invoices/${invoiceId}/pay`,
      token,
      method: "POST",
      body: payload,
    });
    return mapPaymentReceipt(unwrapData<unknown>(response));
  },

  // ----- B4-B7 / Phase 2B-3..6 risky-op endpoints -----
  // SUPER_ADMIN can call these directly. GYM_MANAGER + below get back
  // a 400 with prefix `<TYPE>_APPROVAL_REQUIRED:approver=SUPER_ADMIN: ...`
  // — caller catches via ApiError.riskyOpApproval and submits a request
  // through approvalsService.submit with the matching payload shape.

  async voidReceipt(token: string, receiptId: number, reason: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/receipts/${receiptId}/void`,
      token,
      method: "POST",
      body: { reason, idempotencyKey },
    });
    return unwrapData<Record<string, unknown>>(response);
  },

  async voidInvoice(token: string, invoiceId: number, reason: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/invoices/${invoiceId}/void`,
      token,
      method: "POST",
      body: { reason, idempotencyKey },
    });
    return unwrapData<Record<string, unknown>>(response);
  },

  async deletePayment(token: string, receiptId: number, reason: string, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/payments/${receiptId}/soft-delete`,
      token,
      method: "POST",
      body: { reason, idempotencyKey },
    });
    return unwrapData<Record<string, unknown>>(response);
  },

  async backdateSubscription(
    token: string,
    subscriptionId: number,
    payload: { newStartDate: string; newEndDate?: string; reason: string; idempotencyKey?: string },
  ): Promise<Record<string, unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/subscriptions/${subscriptionId}/backdate`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<Record<string, unknown>>(response);
  },

  async addFlexVisit(
    token: string,
    subscriptionId: string | number,
    payload: Record<string, unknown>,
  ): Promise<AddFlexVisitResult> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/subscriptions/${subscriptionId}/flex/add-visit`,
      token,
      method: "POST",
      body: payload,
    });
    return mapAddFlexVisitResult(unwrapData<unknown>(response));
  },

  async getInvoiceDocumentHtml(token: string, invoiceId: number | string): Promise<string> {
    const response = await axios.get<string>(`${apiBaseUrl}/api/subscriptions/v2/invoices/${invoiceId}/document`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "text",
    });
    return response.data;
  },

  async getReceiptDocumentHtml(token: string, receiptId: number | string): Promise<string> {
    const response = await axios.get<string>(`${apiBaseUrl}/api/subscriptions/v2/receipts/${receiptId}/document`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "text",
    });
    return response.data;
  },

  async getInvoicePdf(token: string, invoiceId: number | string): Promise<Blob> {
    const response = await axios.get(`${apiBaseUrl}/api/subscriptions/v2/invoices/${invoiceId}/pdf`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "blob",
    });
    return response.data as Blob;
  },

  async getReceiptPdf(token: string, receiptId: number | string): Promise<Blob> {
    const response = await axios.get(`${apiBaseUrl}/api/subscriptions/v2/receipts/${receiptId}/pdf`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: "blob",
    });
    return response.data as Blob;
  },

  async activateMembership(token: string, subscriptionId: number): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/subscriptions/${subscriptionId}/activate`,
      token,
      method: "POST",
      body: {},
    });
    return unwrapData<unknown>(response);
  },

  async provisionPtOperationalSetup(
    token: string,
    subscriptionId: number | string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: `/api/subscriptions/v2/subscriptions/${subscriptionId}/pt-setup`,
      token,
      method: "POST",
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  // ── Membership Policy Settings ──────────────────────────────────────

  async getMembershipPolicySettings(token: string): Promise<MembershipPolicySettings> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/settings/membership-policy",
      token,
    });
    return mapMembershipPolicySettings(unwrapData<unknown>(response));
  },

  async updateMembershipPolicySettings(
    token: string,
    payload: UpdateMembershipPolicyRequest,
  ): Promise<MembershipPolicySettings> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "subscription",
      path: "/api/subscriptions/v2/settings/membership-policy",
      token,
      method: "PATCH",
      body: payload,
    });
    return mapMembershipPolicySettings(unwrapData<unknown>(response));
  },

};
