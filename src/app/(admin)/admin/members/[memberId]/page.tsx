"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Printer,
  Share2,
  UserRound,
  Wallet,
} from "lucide-react";
import { Modal } from "@/components/common/modal";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatMemberCode } from "@/lib/inquiry-code";
import { UserDirectoryItem, FreezeHistoryEntry, InvoiceSummary } from "@/types/models";
import { InquiryRecord } from "@/types/inquiry";
import {
  MemberAccessStateResponse,
  MemberAssessmentHistoryEntry,
  MemberAssessmentStatusResponse,
  MemberFitnessFormPayload,
  MemberNotesResponse,
  MemberProfileAuditEntry,
  MemberProfileShellResponse,
  MemberProfileTabKey,
} from "@/types/member-profile";
import { BranchResponse } from "@/types/admin";
import { BillingSettings, CatalogProduct, CatalogVariant } from "@/lib/api/services/subscription-service";
import { ClientAssignmentRequest } from "@/lib/api/services/training-service";

type TabPayloadMap = {
  overview: MemberProfileShellResponse;
  subscriptions: {
    dashboard: Record<string, unknown>;
    entitlements: unknown[];
    history: unknown[];
    programEnrollments?: unknown[];
  };
  billing: InvoiceSummary[];
  attendance: {
    records: unknown[];
    biometricDevices: unknown[];
    biometricLogs: unknown[];
  };
  "credits-wallet": {
    wallet: Record<string, unknown>;
    ledger: Record<string, unknown>;
  };
  "recovery-services": MemberAccessStateResponse;
  "personal-training": { assignments: unknown[]; sessions: unknown[] };
  progress: {
    summary: Record<string, unknown>;
    measurements: unknown[];
    photos: unknown[];
  };
  "freeze-history": FreezeHistoryEntry[];
  notes: MemberNotesResponse;
  "audit-trail": MemberProfileAuditEntry[];
  "fitness-assessment": {
    fitnessForm: MemberFitnessFormPayload;
    assessmentStatus: MemberAssessmentStatusResponse;
    assessmentHistory: MemberAssessmentHistoryEntry[];
  };
};

const TAB_ORDER: Array<{ key: MemberProfileTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "subscriptions", label: "Membership" },
  { key: "billing", label: "Billing" },
  { key: "attendance", label: "Attendance & Access" },
  { key: "credits-wallet", label: "Credits & Balance" },
  { key: "personal-training", label: "Personal Training" },
  { key: "freeze-history", label: "Freeze History" },
  { key: "notes", label: "Follow-ups & Comments" },
  { key: "audit-trail", label: "Audit Trail" },
  { key: "fitness-assessment", label: "Fitness & Medical" },
  { key: "progress", label: "Progress" },
];

type ActionModalKey =
  | "edit-profile"
  | "freeze"
  | "renew"
  | "upgrade"
  | "downgrade"
  | "transfer"
  | "pt"
  | "visit"
  | "biometric"
  | null;

type RecordLike = Record<string, unknown>;
type MembershipFamily =
  | "FLAGSHIP"
  | "FLEX"
  | "PT"
  | "TRANSFORMATION"
  | "GROUP_CLASS"
  | "CREDIT_PACK"
  | "UNKNOWN";
type MembershipActionKey = "renew" | "upgrade" | "downgrade" | "freeze" | "transfer" | "pt" | "visit";

interface MembershipActionState {
  key: MembershipActionKey;
  label: string;
  enabled: boolean;
  adminApprovalRequired?: boolean;
  note?: string;
}

interface MembershipPortfolioItem {
  subscriptionId: string;
  productVariantId: string;
  family: MembershipFamily;
  categoryCode: string;
  productCode: string;
  productName: string;
  variantName: string;
  status: string;
  startDate: string;
  expiryDate: string;
  durationMonths: number;
  validityDays: number;
  branchCode: string;
  invoiceNumber: string;
  receiptNumber: string;
  paymentConfirmed: boolean;
  includedCheckIns: number;
  usedCheckIns: number;
  checkInsRemaining: number;
  extraVisitPrice: number;
  includedPtSessions: number;
  entitlements: string[];
}

interface MemberEntitlementRecord {
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

function toRecord(payload: unknown): RecordLike {
  return typeof payload === "object" && payload !== null ? (payload as RecordLike) : {};
}

function titleize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeDisplayPlanName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") {
    return "No active membership";
  }

  return trimmed
    .replace(/\b(1|3|6|12)M\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+[-/]\s*$/g, "")
    .trim();
}

function humanizeLabel(value?: string): string {
  if (!value) {
    return "-";
  }
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "PAUSED") {
    return "Frozen";
  }
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanEntitlementFeatureLabel(value?: string): string {
  if (!value) {
    return "-";
  }
  const normalized = value
    .replace(/PASS_BENEFITS?/gi, "PAUSE_BENEFIT")
    .replace(/PASS BENEFITS?/gi, "PAUSE BENEFIT")
    .replace(/_ACCESS$/i, "")
    .replace(/ ACCESS$/i, "")
    .replace(/_BENEFIT$/i, "_BENEFIT")
    .trim()
    .toUpperCase();

  const aliasMap: Record<string, string> = {
    GYM: "Gym",
    PT: "PT",
    HIIT: "HIIT",
    COREFLEX: "CoreFlex",
    CROSSFIT: "CrossFit",
    ZUMBA: "Zumba",
    YOGA: "Yoga",
    BOXING: "Boxing",
    KICKBOXING: "Kickboxing",
    CALISTHENICS: "Calisthenics",
    PAUSE_BENEFIT: "Pause Benefit",
    NUTRITION_COUNSELING: "Nutrition Counseling",
    PHYSIOTHERAPY_COUNSELING: "Physiotherapy Counseling",
    STEAM: "Steam",
    STEAM_ACCESS: "Steam",
    ICE_BATH: "Ice Bath",
    ICE_BATH_ACCESS: "Ice Bath",
  };

  return aliasMap[normalized] || humanizeLabel(normalized);
}

function shouldTrackUsageEntitlement(value?: string): boolean {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/PASS_BENEFITS?/g, "PAUSE_BENEFIT")
    .replace(/PASS_BENEFIT/g, "PAUSE_BENEFIT");
  return [
    "PAUSE_BENEFIT",
    "STEAM_ACCESS",
    "STEAM",
    "ICE_BATH_ACCESS",
    "ICE_BATH",
    "NUTRITION_COUNSELING",
    "PHYSIOTHERAPY_COUNSELING",
  ].includes(normalized);
}

function extractSubscriptionIdFromEntitlementSource(source?: string): string {
  if (!source) {
    return "";
  }
  const [, subscriptionId = ""] = String(source).split(":");
  return subscriptionId.trim();
}

function entitlementUsageLabel(entitlement: MemberEntitlementRecord): string {
  const feature = String(entitlement.feature || "").toUpperCase();
  const included = Number(entitlement.includedCount || 0);
  const remaining = Number(entitlement.remainingCount || 0);
  const used = Number(entitlement.usedCount || 0);

  if (feature === "PAUSE_BENEFIT") {
    return `${remaining} / ${included} days`;
  }

  if (included <= 0) {
    return `${used} used`;
  }

  return `${used} / ${included}`;
}

function entitlementRuleLabel(entitlement: MemberEntitlementRecord): string {
  const recurrence = String(entitlement.recurrence || "FULL_TERM").toUpperCase();
  const included = Number(entitlement.includedCount || 0);

  if (recurrence === "MONTHLY") {
    return `${included} per month`;
  }
  if (recurrence === "QUARTERLY") {
    return `${included} per quarter`;
  }
  if (recurrence === "HALF_YEARLY") {
    return `${included} per half year`;
  }
  if (String(entitlement.feature || "").toUpperCase() === "PAUSE_BENEFIT") {
    return "Per membership";
  }
  return `${included} total`;
}

function shouldShowPackageFeatureChip(value?: string): boolean {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized === "PAUSE_BENEFIT" ||
    normalized === "TRANSFORMATION" ||
    normalized === "TRANSFORMATION_ACCESS" ||
    normalized === "GROUP_CLASS_ACCESS" ||
    normalized === "PT_INCLUDED" ||
    normalized === "TWO_SESSIONS_PER_WEEK" ||
    normalized === "TWO_SESSIONS_EACH_PER_WEEK"
  ) {
    return false;
  }
  return true;
}

function normalizeIndianMobile(value: string): string {
  return value.replace(/^\+91/, "").replace(/\D/g, "");
}

function pickString(payload: unknown, keys: string[]): string {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function pickBoolean(payload: unknown, keys: string[]): boolean | undefined {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
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
  return undefined;
}

function pickNumber(payload: unknown, keys: string[]): number {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
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

function pickFromSourcesString(sources: unknown[], keys: string[]): string {
  for (const source of sources) {
    const value = pickString(source, keys);
    if (value) {
      return value;
    }
  }
  return "";
}

function pickFromSourcesNumber(sources: unknown[], keys: string[]): number {
  for (const source of sources) {
    const value = pickNumber(source, keys);
    if (value !== 0) {
      return value;
    }
  }
  return 0;
}

function toArray<T = unknown>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function compactEntries(payload: unknown): Array<[string, string]> {
  return Object.entries(toRecord(payload))
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
    .slice(0, 12)
    .map(([key, value]) => [titleize(key), String(value)]);
}

function buildTableRows(items: unknown[]): { columns: string[]; rows: Array<Record<string, string>> } {
  const records = items.map((item) => toRecord(item));
  const columnSet = new Set<string>();

  records.slice(0, 6).forEach((record) => {
    Object.entries(record).forEach(([key, value]) => {
      if (value !== null && value !== undefined && typeof value !== "object") {
        columnSet.add(key);
      }
    });
  });

  const columns = Array.from(columnSet).slice(0, 8);
  const rows = records.map((record) => {
    const next: Record<string, string> = {};
    columns.forEach((column) => {
      const value = record[column];
      next[column] = value === null || value === undefined ? "-" : String(value);
    });
    return next;
  });

  return { columns, rows };
}

function statusTone(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized.includes("ACTIVE") || normalized.includes("VALID")) {
    return "border-emerald-400/40 bg-emerald-500/12 text-emerald-200";
  }
  if (normalized.includes("IRREGULAR") || normalized.includes("AT_RISK") || normalized.includes("PENDING")) {
    return "border-amber-300 bg-amber-100/10 text-amber-200";
  }
  if (normalized.includes("EXPIRED") || normalized.includes("INACTIVE") || normalized.includes("LAPSED")) {
    return "border-rose-300 bg-rose-100/10 text-rose-200";
  }
  return "border-slate-500 bg-white/5 text-slate-200";
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

function daysUntil(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const now = new Date();
  const diff = parsed.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatExpiryWindow(days: number | null): string {
  if (days === null) {
    return "-";
  }
  if (days < 0) {
    const overdueDays = Math.abs(days);
    return `Expired ${overdueDays} day${overdueDays === 1 ? "" : "s"} ago`;
  }
  if (days === 0) {
    return "Expires today";
  }
  return `${days} day${days === 1 ? "" : "s"} left`;
}

function ProfilePanel({
  title,
  subtitle,
  children,
  accent = "slate",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent?: "slate" | "lime" | "cyan" | "amber" | "rose";
}) {
  const accentClasses = {
    slate: "border-white/8 bg-[#15181f]",
    lime: "border-[#c42924]/30 bg-[#1a1213]",
    cyan: "border-cyan-400/20 bg-[#12191d]",
    amber: "border-amber-400/20 bg-[#1b1711]",
    rose: "border-rose-400/20 bg-[#1c1415]",
  } as const;

  return (
    <section className={`rounded-[28px] border p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)] ${accentClasses[accent]}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-300">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function StatPill({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function KeyValueGrid({ payload }: { payload: unknown }) {
  const entries = compactEntries(payload);
  if (entries.length === 0) {
    return <div className="text-sm text-slate-400">No data available.</div>;
  }

  return (
    <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</dt>
          <dd className="mt-2 text-sm font-medium text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function GenericTable({ items, emptyLabel }: { items: unknown[]; emptyLabel: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  const { columns, rows } = buildTableRows(items);

  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#15181f] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-white/8 bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            {columns.map((column) => (
              <th key={column} className="px-4 py-3">{titleize(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/6">
          {rows.map((row, index) => (
            <tr key={`row-${index}`} className="hover:bg-white/[0.02]">
              {columns.map((column) => (
                <td key={`${index}-${column}`} className="px-4 py-3 text-slate-200">{row[column]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function extractInvoiceStats(invoices: InvoiceSummary[]) {
  return invoices.reduce(
    (accumulator, invoice) => {
      accumulator.total += invoice.amount || 0;
      accumulator.paid += invoice.paidAmount || 0;
      accumulator.balance += invoice.balanceAmount || 0;
      if (!accumulator.latestIssuedAt || (invoice.issuedAt && new Date(invoice.issuedAt) > new Date(accumulator.latestIssuedAt))) {
        accumulator.latestIssuedAt = invoice.issuedAt;
        accumulator.latestInvoice = invoice.invoiceNumber;
        accumulator.latestReceipt = invoice.receiptNumber || "";
      }
      return accumulator;
    },
    {
      total: 0,
      paid: 0,
      balance: 0,
      latestInvoice: "",
      latestReceipt: "",
      latestIssuedAt: "",
    },
  );
}

function derivePaymentStatus(currentStatus: string, paidAmount: number, balanceAmount: number): string {
  if (paidAmount > 0 && Math.round(balanceAmount) === 0) {
    return "PAID";
  }
  if (currentStatus && currentStatus !== "-") {
    return currentStatus;
  }
  if (paidAmount > 0 && Math.round(balanceAmount) > 0) {
    return "PARTIALLY_PAID";
  }
  return currentStatus || "-";
}

function formatRoundedInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

function formatPlanDuration(durationMonths: number, validityDays: number): string {
  if (durationMonths > 0) {
    return `${durationMonths} ${durationMonths === 1 ? "month" : "months"}`;
  }
  if (validityDays > 0) {
    return `${validityDays} ${validityDays === 1 ? "day" : "days"}`;
  }
  return "-";
}

function roundAmount(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function deriveMembershipFamily(categoryCode?: string, productCode?: string): MembershipFamily {
  const normalizedCategory = String(categoryCode || "").toUpperCase();
  const normalizedProduct = String(productCode || "").toUpperCase();

  if (normalizedCategory === "FLAGSHIP") return "FLAGSHIP";
  if (normalizedCategory === "FLEX" || normalizedProduct.includes("FLEX")) return "FLEX";
  if (normalizedCategory === "PT" || normalizedProduct.includes("PT")) return "PT";
  if (normalizedCategory === "TRANSFORMATION") return "TRANSFORMATION";
  if (normalizedCategory === "GROUP_CLASS") return "GROUP_CLASS";
  if (normalizedCategory === "CREDIT_PACK") return "CREDIT_PACK";
  return "UNKNOWN";
}

function parseFeatureList(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => cleanEntitlementFeatureLabel(entry.trim()))
    .filter(Boolean)
    .filter((entry, index, array) => array.indexOf(entry) === index);
}

function normalizePaymentStatus(currentStatus: string, totalAmount: number, paidAmount: number, balanceAmount: number): string {
  const roundedTotal = roundAmount(totalAmount);
  const roundedPaid = roundAmount(paidAmount);
  const roundedBalance = roundAmount(balanceAmount);
  const normalizedStatus = String(currentStatus || "").trim().toUpperCase();

  if (roundedTotal > 0 && roundedBalance <= 0) {
    return "PAID";
  }
  if (roundedPaid > 0 && roundedBalance > 0) {
    return "PARTIALLY_PAID";
  }
  if (roundedTotal > 0 && roundedPaid <= 0) {
    if (normalizedStatus && normalizedStatus !== "-") {
      return normalizedStatus;
    }
    return "UNPAID";
  }
  if (normalizedStatus && normalizedStatus !== "-") {
    return normalizedStatus;
  }
  return "-";
}

function membershipPanelTitle(family: MembershipFamily): string {
  switch (family) {
    case "TRANSFORMATION":
      return "Transformation";
    case "PT":
      return "Personal Training";
    case "GROUP_CLASS":
      return "Group Class";
    case "FLEX":
      return "Flex";
    case "CREDIT_PACK":
      return "Credits";
    default:
      return "Gym";
  }
}

function membershipPanelSubtitle(family: MembershipFamily): string {
  switch (family) {
    case "TRANSFORMATION":
      return "Bundled gym access, PT sessions, and entitlements managed as one membership.";
    case "PT":
      return "Personal training membership and operational coaching context.";
    case "GROUP_CLASS":
      return "Class-only membership with class-specific access and schedule entitlements.";
    case "FLEX":
      return "Check-in based membership with controlled upgrade paths.";
    case "CREDIT_PACK":
      return "Credits are treated as an add-on ledger and are not managed as a standalone membership.";
    default:
      return "Active membership details, access scope, and operational eligibility.";
  }
}

function trimMembershipCardTitle(title: string): string {
  return title
    .replace(/\bTransform\b/gi, "Transformation")
    .replace(/\s*-\s*\d+\s*M(?:ONTHS?)?$/i, "")
    .trim();
}

function productTierRank(family: MembershipFamily, productCode: string): number {
  const normalized = String(productCode || "").trim().toUpperCase();

  switch (family) {
    case "FLAGSHIP": {
      const order = ["FOMO_MOVE", "FOMO_MOVE_PLUS", "FOMO_CORE", "FOMO_CORE_PLUS", "FOMO_CORE_RHYTHM", "FOMO_BLACK"];
      const index = order.indexOf(normalized);
      return index >= 0 ? index + 1 : 0;
    }
    case "FLEX": {
      const order = ["FLEX_LITE", "FLEX_PRO", "FLEX_ELITE"];
      const index = order.indexOf(normalized);
      return index >= 0 ? index + 1 : 0;
    }
    case "PT": {
      if (normalized.includes("LEVEL_1")) return 1;
      if (normalized.includes("LEVEL_2")) return 2;
      return 0;
    }
    case "TRANSFORMATION": {
      if (normalized.includes("LEVEL_1")) return 1;
      if (normalized.includes("LEVEL_2")) return 2;
      return 0;
    }
    default:
      return 0;
  }
}

function isSamePtTrack(currentProductCode: string, candidateProductCode: string): boolean {
  const current = String(currentProductCode || "").toUpperCase();
  const candidate = String(candidateProductCode || "").toUpperCase();
  const currentCouple = current.includes("COUPLE");
  const candidateCouple = candidate.includes("COUPLE");
  return currentCouple === candidateCouple;
}

function deriveAccentForMembershipFamily(family: MembershipFamily): "slate" | "lime" | "rose" | "amber" | "cyan" {
  switch (family) {
    case "TRANSFORMATION":
      return "amber";
    case "PT":
      return "rose";
    case "GROUP_CLASS":
      return "cyan";
    case "FLEX":
      return "slate";
    default:
      return "lime";
  }
}

function extractMembershipPortfolioItem(payload: unknown): MembershipPortfolioItem | null {
  const record = toRecord(payload);
  const subscriptionId = pickString(record, ["subscriptionId", "id"]);
  if (!subscriptionId) {
    return null;
  }
  const familyRaw = pickString(record, ["family", "categoryCode"]);
  const family = (familyRaw.toUpperCase() || "UNKNOWN") as MembershipFamily;
  return {
    subscriptionId,
    productVariantId: pickString(record, ["productVariantId"]),
    family,
    categoryCode: pickString(record, ["categoryCode"]),
    productCode: pickString(record, ["productCode"]),
    productName: pickString(record, ["productName"]),
    variantName: pickString(record, ["variantName", "activePlan", "name"]),
    status: pickString(record, ["subscriptionStatus", "status"]),
    startDate: pickString(record, ["startDate"]),
    expiryDate: pickString(record, ["expiryDate", "endDate"]),
    durationMonths: pickNumber(record, ["durationMonths"]),
    validityDays: pickNumber(record, ["validityDays"]),
    branchCode: pickString(record, ["branchCode"]),
    invoiceNumber: pickString(record, ["invoiceNumber"]),
    receiptNumber: pickString(record, ["receiptNumber"]),
    paymentConfirmed: pickBoolean(record, ["paymentConfirmed"]) === true,
    includedCheckIns: pickNumber(record, ["includedCheckIns"]),
    usedCheckIns: pickNumber(record, ["usedCheckIns"]),
    checkInsRemaining: pickNumber(record, ["checkInsRemaining"]),
    extraVisitPrice: pickNumber(record, ["extraVisitPrice"]),
    includedPtSessions: pickNumber(record, ["includedPtSessions"]),
    entitlements: toArray(record.entitlements)
      .map((item) => cleanEntitlementFeatureLabel(String(item || "")))
      .filter((item, index, array) => item !== "-" && array.indexOf(item) === index),
  };
}

function deriveUpgradeWindowDays(durationMonths: number, validityDays: number): number {
  if (durationMonths >= 6 || validityDays >= 180) {
    return 28;
  }
  if (durationMonths >= 3 || validityDays >= 90) {
    return 15;
  }
  return 7;
}

async function withTabTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          reject(new Error(`Loading ${label} timed out.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      globalThis.clearTimeout(timer);
    }
  }
}

export default function MemberProfilePage() {
  const params = useParams<{ memberId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const memberId = params.memberId;
  const { token, user } = useAuth();

  const [shell, setShell] = useState<MemberProfileShellResponse | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MemberProfileTabKey>("overview");
  const [tabData, setTabData] = useState<Partial<TabPayloadMap>>({});
  const [loadingTabs, setLoadingTabs] = useState<Partial<Record<MemberProfileTabKey, boolean>>>({});
  const [tabErrors, setTabErrors] = useState<Partial<Record<MemberProfileTabKey, string>>>({});
  // Refs mirror loadingTabs/tabData for use in effect guards without causing re-runs
  const loadingTabsRef = useRef(loadingTabs);
  loadingTabsRef.current = loadingTabs;
  const tabDataRef = useRef(tabData);
  tabDataRef.current = tabData;
  const sessionRegisterRef = useRef<HTMLDivElement | null>(null);
  const [assessmentActionBusy, setAssessmentActionBusy] = useState(false);
  const [documentBusyKey, setDocumentBusyKey] = useState<string | null>(null);
  const [memberRecord, setMemberRecord] = useState<UserDirectoryItem | null>(null);
  const [selectedMembershipId, setSelectedMembershipId] = useState<string>("");
  const [openMembershipMenuId, setOpenMembershipMenuId] = useState<string | null>(null);
  const [ptFocusSection, setPtFocusSection] = useState<"session-register" | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [coaches, setCoaches] = useState<UserDirectoryItem[]>([]);
  const [staffMembers, setStaffMembers] = useState<UserDirectoryItem[]>([]);
  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [transferInquiries, setTransferInquiries] = useState<InquiryRecord[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogVariants, setCatalogVariants] = useState<CatalogVariant[]>([]);
  const [billingSettings, setBillingSettings] = useState<BillingSettings | null>(null);
  const [hasPtAssignment, setHasPtAssignment] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModalKey>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: "",
    email: "",
    mobileCountryCode: "+91",
    mobileNumber: "",
    alternateMobileNumber: "",
    dateOfBirth: "",
    inquiryDate: "",
    clientRepStaffId: "",
    gender: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    defaultBranchId: "",
    defaultTrainerStaffId: "",
  });
  const [lifecycleForm, setLifecycleForm] = useState({
    categoryCode: "",
    productCode: "",
    productVariantId: "",
    startDate: "",
    dueInDays: "7",
    notes: "",
  });
  const [freezeForm, setFreezeForm] = useState({
    freezeDays: "7",
    reason: "",
  });
  const [transferForm, setTransferForm] = useState({
    targetMemberId: "",
    startDate: "",
    deactivateSource: true,
    copyUsage: false,
    notes: "",
  });
  const [ptForm, setPtForm] = useState({
    productCode: "",
    productVariantId: "",
    coachId: "",
    startDate: "",
    endDate: "",
  });
  const [visitForm, setVisitForm] = useState({
    paymentMode: "UPI",
  });
  const [accessNotes, setAccessNotes] = useState("");
  const [selectedBiometricDeviceSerial, setSelectedBiometricDeviceSerial] = useState("");

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (!requestedTab) {
      return;
    }
    const matched = TAB_ORDER.find((tab) => tab.key === requestedTab);
    if (matched) {
      setActiveTab(matched.key);
    }
  }, [searchParams]);

  // Reset stale loading flags when token refreshes so stuck tabs can retry
  useEffect(() => {
    setLoadingTabs({});
  }, [token]);

  const loadMembershipTab = useCallback(async () => {
    if (!token || !memberId) {
      return;
    }

    setLoadingTabs((current) => ({ ...current, subscriptions: true }));
    setTabErrors((current) => ({ ...current, subscriptions: undefined }));

    try {
      const [dashboard, entitlements, programEnrollments] = await withTabTimeout(
        Promise.all([
          subscriptionService.getMemberDashboard(token, memberId),
          subscriptionService.getMemberEntitlements(token, memberId),
          trainingService.getMemberProgramEnrollments(token, memberId),
        ]),
        "subscriptions",
      );

      setTabData((current) => ({
        ...current,
        subscriptions: {
          dashboard: toRecord(dashboard),
          entitlements: toArray(entitlements),
          history: [],
          programEnrollments: toArray(programEnrollments),
        },
      }));
    } catch (loadError) {
      setTabErrors((current) => ({
        ...current,
        subscriptions:
          loadError instanceof ApiError
            ? loadError.message
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load membership details.",
      }));
    } finally {
      setLoadingTabs((current) => ({ ...current, subscriptions: false }));
    }
  }, [memberId, token]);

  const reloadShell = async () => {
    if (!token || !memberId) {
      return;
    }

    const [profile, user] = await Promise.all([
      usersService.getMemberProfileShell(token, memberId),
      usersService.getUserById(token, memberId),
    ]);

    setShell(profile);
    setMemberRecord(user);
    setTabData({ overview: profile });
    setLoadingTabs({});
    setTabErrors({});
  };

  useEffect(() => {
    if (!token || !memberId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingShell(true);
      setShellError(null);

      try {
        const [profile, user] = await Promise.all([
          usersService.getMemberProfileShell(token, memberId),
          usersService.getUserById(token, memberId),
        ]);
        if (!active) {
          return;
        }
        setShell(profile);
        setMemberRecord(user);
        setTabData((current) => ({ ...current, overview: profile }));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setShellError(loadError instanceof ApiError ? loadError.message : "Unable to load member profile.");
      } finally {
        if (active) {
          setLoadingShell(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [memberId, token]);

  const visibleTabs = useMemo(() => {
    const serverKeys = new Set((shell?.tabs || []).map((tab) => tab.key));
    const hasServerTabs = serverKeys.size > 0;

    // Derive category from shell to filter PT tab (productCategoryCode lives in overview, not summary)
    const shellCategory = String(
      (shell?.overview as Record<string, unknown>)?.productCategoryCode ||
      (shell?.overview as Record<string, unknown>)?.categoryCode ||
      (shell?.summary as Record<string, unknown>)?.productCategoryCode ||
      (shell?.summary as Record<string, unknown>)?.categoryCode || ""
    ).toUpperCase();
    const memberHasPt = hasPtAssignment || shellCategory === "PT" || shellCategory === "TRANSFORMATION";

    return TAB_ORDER
      .filter((tab) => !hasServerTabs || serverKeys.has(tab.key))
      .filter((tab) => {
        // Show PT tab if member has PT subscription, active PT assignment, or Transformation package (PT bundled)
        if (tab.key === "personal-training") return memberHasPt;
        return true;
      })
      .map((tab) => ({
        key: tab.key,
        label: shell?.tabs?.find((item) => item.key === tab.key)?.label || tab.label,
      }));
  }, [shell, hasPtAssignment]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setSupportLoading(true);
      try {
        const [branchPage, coachRows, staffRows, memberRows, products, variants, billing, inquiryPage] = await Promise.all([
          branchService.listBranches(token, { page: 0, size: 100 }),
          usersService.searchUsers(token, { role: "COACH", active: true }),
          usersService.searchUsers(token, { role: "STAFF", active: true }),
          usersService.searchUsers(token, { role: "MEMBER", active: true }),
          subscriptionService.getCatalogProducts(token),
          subscriptionService.getCatalogVariants(token),
          subscriptionService.getBillingSettings(token),
          subscriptionService.searchInquiriesPaged(token, {}, 0, 200),
        ]);

        if (!active) {
          return;
        }

        setBranches(branchPage.content || []);
        setCoaches(coachRows);
        setStaffMembers(staffRows);
        setMembers(memberRows);
        setCatalogProducts(products);
        setCatalogVariants(variants);
        setBillingSettings(billing);
        setTransferInquiries(
          (inquiryPage.content || []).filter((item) => {
            const status = String(item.status || "").toUpperCase();
            return status !== "LOST" && status !== "NOT_INTERESTED" && Boolean(item.memberId) && String(item.memberId) !== String(memberId);
          }),
        );

        // Eagerly check if member has any PT assignments (for tab visibility)
        try {
          const ptData = await trainingService.getMemberAssignments(token, memberId);
          const ptArr = Array.isArray(ptData) ? ptData : [];
          if (active) {
            setHasPtAssignment(ptArr.length > 0);
            // Pre-populate PT tab data so it doesn't re-fetch
            if (ptArr.length > 0) {
              setTabData((current) => ({ ...current, "personal-training": { assignments: ptArr, sessions: [] } }));
            }
          }
        } catch {
          // Training service may 404 — means no PT assignments
          if (active) {
            setHasPtAssignment(false);
          }
        }
      } catch {
        if (!active) {
          return;
        }
      } finally {
        if (active) {
          setSupportLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  // Reset loading states when token changes (e.g., after auth refresh) so tabs can retry
  useEffect(() => {
    setLoadingTabs({});
  }, [token]);

  useEffect(() => {
    if (!token || !memberId || !shell) {
      return;
    }

    if (activeTab === "overview") {
      if (tabDataRef.current.subscriptions === undefined && !loadingTabsRef.current.subscriptions) {
        void loadMembershipTab();
      }
    }

    if (activeTab === "subscriptions") {
      if (tabDataRef.current.subscriptions === undefined && !loadingTabsRef.current.subscriptions) {
        void loadMembershipTab();
      }
      return;
    }

    if (tabDataRef.current[activeTab] !== undefined || loadingTabsRef.current[activeTab]) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingTabs((current) => ({ ...current, [activeTab]: true }));
      setTabErrors((current) => ({ ...current, [activeTab]: undefined }));

      try {
        let payload: TabPayloadMap[MemberProfileTabKey];

        switch (activeTab) {
          case "overview":
            payload = shell;
            break;
          case "billing":
            payload = (await withTabTimeout(
              subscriptionService.getInvoicesByMember(token, memberId),
              "billing",
            )) as InvoiceSummary[];
            break;
          case "attendance":
          {
            const [attendance, accessState, biometricDevices, biometricLogs] = await withTabTimeout(
              Promise.all([
                engagementService.getAttendanceByMember(token, memberId),
                usersService.getMemberAccessState(token, memberId),
                engagementService.listBiometricDevices(token).catch(() => []),
                engagementService.getBiometricLogs(token).catch(() => []),
              ]),
              "attendance",
            );
            if (active) {
              setTabData((current) => ({ ...current, "recovery-services": accessState }));
            }
            payload = {
              records: attendance,
              biometricDevices,
              biometricLogs,
            };
            break;
          }
          case "credits-wallet": {
            const [wallet, ledger] = await withTabTimeout(Promise.all([
              engagementService.getCreditsWallet(token, memberId),
              engagementService.getCreditsLedger(token, memberId),
            ]), "credits wallet");
            payload = { wallet: toRecord(wallet), ledger: toRecord(ledger) };
            break;
          }
          case "recovery-services":
            payload = await withTabTimeout(usersService.getMemberAccessState(token, memberId), "access and biometrics");
            break;
          case "personal-training":
            try {
              const ptAssignmentsData = await withTabTimeout(trainingService.getMemberAssignments(token, memberId), "personal training");
              const ptArr = Array.isArray(ptAssignmentsData) ? ptAssignmentsData : [];
              // For each active assignment, try to fetch sessions and slots
              let ptSessions: unknown[] = [];
              let ptSlots: unknown[] = [];
              const activeAssign = ptArr.find((a) => {
                const rec = toRecord(a);
                return pickBoolean(rec, ["active"]) === true;
              });
              if (activeAssign) {
                const assignId = pickString(toRecord(activeAssign), ["id", "assignmentId"]);
                if (assignId) {
                  const [sessionsResult, slotsResult] = await Promise.all([
                    trainingService.getPtSessionsByAssignment(token, assignId).catch(() => []),
                    trainingService.getSlotsByAssignment(token, assignId).catch(() => []),
                  ]);
                  ptSessions = Array.isArray(sessionsResult) ? sessionsResult : [];
                  ptSlots = Array.isArray(slotsResult) ? slotsResult : [];
                }
              }
              payload = { assignments: ptArr, sessions: ptSessions, slots: ptSlots } as unknown as TabPayloadMap["personal-training"];
            } catch {
              // Training service may return 404 when no assignments exist
              payload = { assignments: [], sessions: [] };
            }
            break;
          case "progress": {
            const [summary, measurements, photos] = await withTabTimeout(Promise.all([
              engagementService.getMemberProgressSummary(token, memberId),
              engagementService.getMemberProgressMeasurements(token, memberId),
              engagementService.getMemberProgressPhotos(token, memberId),
            ]), "progress");
            payload = { summary: toRecord(summary), measurements, photos };
            break;
          }
          case "freeze-history":
            payload = await withTabTimeout(engagementService.getFreezeHistory(token, memberId), "freeze history");
            break;
          case "notes":
            payload = await withTabTimeout(usersService.getMemberNotes(token, memberId), "notes");
            break;
          case "audit-trail":
            payload = await withTabTimeout(usersService.getMemberProfileAuditTrail(token, memberId), "audit trail");
            break;
          case "fitness-assessment": {
            const [fitnessForm, assessmentStatus, assessmentHistory] = await withTabTimeout(Promise.all([
              usersService.getMemberFitnessForm(token, memberId),
              trainingService.getMemberAssessmentStatus(token, memberId),
              trainingService.getMemberAssessments(token, memberId),
            ]), "fitness assessment");
            payload = { fitnessForm, assessmentStatus, assessmentHistory };
            break;
          }
          default:
            payload = shell;
        }

        if (!active) {
          return;
        }

        setTabData((current) => ({ ...current, [activeTab]: payload }));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTabErrors((current) => ({
          ...current,
          [activeTab]:
            loadError instanceof ApiError
              ? loadError.message
              : loadError instanceof Error
                ? loadError.message
              : `Unable to load ${activeTab.replace(/-/g, " ")} tab.`,
        }));
      } finally {
        if (active) {
          setLoadingTabs((current) => ({ ...current, [activeTab]: false }));
        }
      }
    })();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadingTabs/tabData accessed via refs to avoid re-run race conditions
  }, [activeTab, loadMembershipTab, memberId, shell, token]);

  useEffect(() => {
    if (activeTab !== "personal-training" || ptFocusSection !== "session-register") {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      sessionRegisterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPtFocusSection(null);
    }, 120);

    return () => globalThis.clearTimeout(timer);
  }, [activeTab, ptFocusSection, tabData]);

  useEffect(() => {
    if (!openMembershipMenuId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-membership-menu-root='true']")) {
        return;
      }
      setOpenMembershipMenuId(null);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openMembershipMenuId]);

  useEffect(() => {
    if (!shell) {
      return;
    }

    const summary = toRecord(shell.summary);
    const overview = toRecord(shell.overview);
    setEditForm({
      fullName: shell.fullName || "",
      email: shell.email || "",
      mobileCountryCode: "+91",
      mobileNumber: normalizeIndianMobile(shell.mobileNumber || ""),
      alternateMobileNumber: pickString(summary, ["alternateMobileNumber"]) || "",
      dateOfBirth: pickString(summary, ["dateOfBirth"]) || "",
      inquiryDate: pickString(summary, ["inquiryAt", "dateOfInquiry", "enquiryDate"]).slice(0, 10) || "",
      clientRepStaffId: pickString(summary, ["clientRepStaffId"]) || "",
      gender: pickString(summary, ["gender"]) || "",
      address: pickString(summary, ["address"]) || "",
      emergencyContactName: pickString(summary, ["emergencyContactName"]) || "",
      emergencyContactPhone: pickString(summary, ["emergencyContactPhone"]) || "",
      emergencyContactRelation: pickString(summary, ["emergencyContactRelation"]) || "",
      defaultBranchId: shell.branchId || pickString(summary, ["defaultBranchId"]) || "",
      defaultTrainerStaffId: pickString(summary, ["defaultTrainerStaffId"]) || "",
    });
    setLifecycleForm((current) => ({
      ...current,
      categoryCode: pickString(overview, ["productCategoryCode"]) || current.categoryCode,
      productCode: pickString(overview, ["productCode"]) || current.productCode,
      productVariantId: pickString(overview, ["productVariantId"]) || current.productVariantId,
      startDate: pickString(overview, ["membershipEndDate", "expiryDate"]) || current.startDate,
    }));
  }, [shell]);

  const reloadFitnessAssessment = async () => {
    if (!token || !memberId) {
      return;
    }

    setLoadingTabs((current) => ({ ...current, "fitness-assessment": true }));
    setTabErrors((current) => ({ ...current, "fitness-assessment": undefined }));
    try {
      const [fitnessForm, assessmentStatus, assessmentHistory] = await Promise.all([
        usersService.getMemberFitnessForm(token, memberId),
        trainingService.getMemberAssessmentStatus(token, memberId),
        trainingService.getMemberAssessments(token, memberId),
      ]);

      setTabData((current) => ({
        ...current,
        "fitness-assessment": { fitnessForm, assessmentStatus, assessmentHistory },
      }));
    } catch (loadError) {
      setTabErrors((current) => ({
        ...current,
        "fitness-assessment":
          loadError instanceof ApiError ? loadError.message : "Unable to refresh fitness assessment.",
      }));
    } finally {
      setLoadingTabs((current) => ({ ...current, "fitness-assessment": false }));
    }
  };

  const downloadDocumentPdf = async (type: "invoice" | "receipt", id: number | string, filename: string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-download-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to download ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const shareDocumentPdf = async (type: "invoice" | "receipt", id: number | string, filename: string, title: string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-share-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const pdfFilename = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
      const file = new File([blob], pdfFilename, {
        type: "application/pdf",
      });

      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title,
          files: [file],
        });
      } else {
        // Fallback: download if share not supported
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = pdfFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setActionSuccess(`${title} PDF downloaded.`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to share ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const printDocumentPdf = async (type: "invoice" | "receipt", id: number | string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-print-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const printWindow = window.open(url, "_blank", "noopener,noreferrer");
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to print ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
    }
  };

  const runAssessmentAction = async (action: "request" | "skip") => {
    if (!token || !memberId) {
      return;
    }

    setAssessmentActionBusy(true);
    setTabErrors((current) => ({ ...current, "fitness-assessment": undefined }));
    try {
      if (action === "request") {
        await trainingService.requestMemberAssessment(token, memberId);
      } else {
        await trainingService.skipMemberAssessment(token, memberId);
      }
      await reloadFitnessAssessment();
    } catch (actionError) {
      setTabErrors((current) => ({
        ...current,
        "fitness-assessment":
          actionError instanceof ApiError ? actionError.message : `Unable to ${action} assessment.`,
      }));
    } finally {
      setAssessmentActionBusy(false);
    }
  };

  const shellSources = useMemo(() => {
    if (!shell) {
      return [] as unknown[];
    }
    return [shell, shell.summary, shell.overview, shell.raw];
  }, [shell]);

  const memberName = shell?.fullName || `Member #${memberId}`;
  const membershipStatus = pickFromSourcesString([shell?.status, ...shellSources], [
    "status",
    "membershipStatus",
    "subscriptionStatus",
  ]) || "Unknown";
  const rawPlanName = pickFromSourcesString(shellSources, [
    "activePlan",
    "planName",
    "currentPlan",
    "variantName",
    "subscriptionName",
  ]) || "-";
  const planName = normalizeDisplayPlanName(rawPlanName);
  const joinDate = pickFromSourcesString(shellSources, ["joinDate", "createdAt", "onboardedAt", "memberSince", "joinedAt"]);
  const dateOfBirth = pickFromSourcesString(shellSources, ["dateOfBirth", "dob"]);
  const inquiryDate = pickFromSourcesString(shellSources, ["inquiryAt", "dateOfInquiry", "enquiryDate"]);
  const lastAttendance = pickFromSourcesString(shellSources, [
    "lastAttendance",
    "lastCheckIn",
    "lastVisitAt",
    "lastAttendanceAt",
  ]);
  const totalVisits = pickFromSourcesNumber(shellSources, ["totalVisits", "checkIns", "totalCheckIns", "visitCount"]);
  const assignedTrainer = pickFromSourcesString(shellSources, [
    "assignedTrainerName",
    "groupClassTrainerName",
    "trainerName",
    "coachName",
    "defaultTrainerName",
  ]) || "-";
  const expiryDate = pickFromSourcesString(shellSources, ["expiryDate", "endDate", "subscriptionEnd", "activeTill", "membershipEndDate"]);
  const startDate = pickFromSourcesString(shellSources, ["startDate", "subscriptionStart", "activeFrom", "membershipStartDate"]);
  const renewalWindowDays = daysUntil(expiryDate);
  const creditsBalance = pickFromSourcesNumber(shellSources, ["credits", "creditBalance", "availableCredits", "walletBalance", "creditsRemaining"]);
  const shellPaymentStatus = pickFromSourcesString(shellSources, ["paymentStatus", "invoicePaymentStatus"]) || "-";
  const branchCode = pickFromSourcesString(shellSources, ["branchCode"]);
  const branchLabel = shell?.branchName || pickFromSourcesString(shellSources, ["branchName"]) || branchCode || shell?.branchId || "-";
  const productCategoryCode = pickFromSourcesString(shellSources, ["productCategoryCode", "categoryCode"]) || "";
  const currentProductCode = pickFromSourcesString(shellSources, ["productCode"]) || "";
  const activeSubscriptionId = pickFromSourcesString(shellSources, ["activeSubscriptionId", "subscriptionId"]);
  const activeProductVariantId = pickFromSourcesString(shellSources, ["productVariantId", "activeVariantId"]);
  const trainerContext = pickFromSourcesString(shellSources, ["trainerContext"]) || "";
  const durationMonths = pickFromSourcesNumber(shellSources, ["durationMonths"]);
  const validityDays = pickFromSourcesNumber(shellSources, ["validityDays"]);
  const planDuration = formatPlanDuration(durationMonths, validityDays);
  const trainerLabel =
    trainerContext === "GROUP_CLASS" || productCategoryCode.toUpperCase() === "GROUP_CLASS"
      ? "Group Class Trainer"
      : "Assigned Trainer";
  const clientRepName = pickFromSourcesString(shellSources, ["clientRepName", "clientRepresentativeName", "clientRep"]) || "-";
  const interestedIn = pickFromSourcesString(shellSources, ["interestedIn"]) || "-";
  const billingRepName = pickFromSourcesString(shellSources, ["billedByStaffName", "billingRepName", "billingRepresentativeName"]) || "-";
  const sourceInquiryId = pickFromSourcesNumber(shellSources, ["sourceInquiryId", "inquiryId", "leadId"]);
  const memberCode =
    pickFromSourcesString(shellSources, ["memberCode", "code", "externalCode"]) ||
    (sourceInquiryId
      ? formatMemberCode(sourceInquiryId, {
          branchCode,
          createdAt: joinDate,
        })
      : String(shell?.memberId || memberId));
  const email = shell?.email || pickFromSourcesString(shellSources, ["email"]);
  const phone = shell?.mobileNumber || pickFromSourcesString(shellSources, ["mobileNumber", "phoneNumber", "mobile"]);
  const normalizedPhonePin = normalizeIndianMobile(phone || "");
  const memberDisplayName =
    shell?.fullName ||
    pickFromSourcesString(shellSources, ["fullName", "name"]) ||
    `Member ${memberCode}`;
  const emergencyContact = pickFromSourcesString(shellSources, [
    "emergencyContactName",
    "emergencyName",
    "emergencyContact",
  ]) || "-";
  const referredBy = pickFromSourcesString(shellSources, ["referralSource", "source", "leadSource", "sourceName"]) || "-";
  const shellPaidAmount = pickFromSourcesNumber(shellSources, ["totalPaidAmount", "paidAmount"]);
  const shellBalanceAmount = pickFromSourcesNumber(shellSources, ["balanceAmount", "outstandingAmount"]);
  const shellLatestInvoiceNumber = pickFromSourcesString(shellSources, ["latestInvoiceNumber"]);
  const shellLatestReceiptNumber = pickFromSourcesString(shellSources, ["latestReceiptNumber"]);
  const attendancePayload = toRecord(tabData.attendance);
  const attendanceRecords = Array.isArray(attendancePayload.records) ? attendancePayload.records : [];
  const biometricDeviceRecords = toArray<RecordLike>(attendancePayload.biometricDevices);
  const availableBiometricDevices = biometricDeviceRecords.filter((device) => {
    const deviceBranchCode = pickString(device, ["branchCode"]);
    if (!branchCode || !deviceBranchCode) {
      return true;
    }
    return deviceBranchCode === branchCode;
  });
  const biometricLogRecords = toArray<RecordLike>(attendancePayload.biometricLogs).filter((entry) => {
    const logMemberId = pickString(entry, ["memberId"]);
    const logPin = pickString(entry, ["deviceUserId"]);
    return logMemberId === String(memberId) || (!!normalizedPhonePin && logPin === normalizedPhonePin);
  });

  const overviewBilling = tabData.billing || [];
  const invoiceStats = extractInvoiceStats(overviewBilling);
  const displayInvoiceStats = overviewBilling.length
    ? invoiceStats
    : {
        total: shellPaidAmount + shellBalanceAmount,
        paid: shellPaidAmount,
        balance: shellBalanceAmount,
        latestInvoice: shellLatestInvoiceNumber,
        latestReceipt: shellLatestReceiptNumber,
        latestIssuedAt: "",
      };
  const roundedInvoiceStats = {
    total: roundAmount(displayInvoiceStats.total),
    paid: roundAmount(displayInvoiceStats.paid),
    balance: roundAmount(displayInvoiceStats.balance),
    latestInvoice: displayInvoiceStats.latestInvoice,
    latestReceipt: displayInvoiceStats.latestReceipt,
    latestIssuedAt: displayInvoiceStats.latestIssuedAt,
  };
  const paymentStatus = normalizePaymentStatus(
    shellPaymentStatus,
    displayInvoiceStats.total,
    displayInvoiceStats.paid,
    displayInvoiceStats.balance,
  );
  const balanceDue = roundedInvoiceStats.balance;
  const roundedBalanceDue = roundedInvoiceStats.balance;
  const ptTabData = tabData["personal-training"] as { assignments?: unknown[]; sessions?: unknown[] } | undefined;
  const ptAssignments = Array.isArray(ptTabData?.assignments) ? ptTabData.assignments : (Array.isArray(tabData["personal-training"]) ? tabData["personal-training"] as unknown[] : []);
  const ptSessions = Array.isArray(ptTabData?.sessions) ? ptTabData.sessions : [];
  const activePtAssignment = ptAssignments.find((item) => {
    const record = toRecord(item);
    return pickBoolean(record, ["active"]) === true;
  });
  const activePtAssignmentRecord = activePtAssignment ? toRecord(activePtAssignment) : null;
  const subscriptionsDashboardRecord = toRecord(tabData.subscriptions?.dashboard);
  const entitlementRecords = toArray<RecordLike>(tabData.subscriptions?.entitlements);
  const dashboardMembershipSummaries = toArray(subscriptionsDashboardRecord.memberships)
    .map(extractMembershipPortfolioItem)
    .filter((entry): entry is MembershipPortfolioItem => entry !== null);
  const membershipVariantLookup = new Map(
    dashboardMembershipSummaries.map((entry) => {
      const catalogVariant =
        catalogVariants.find((variant) => String(variant.variantId) === String(entry.productVariantId)) ||
        catalogVariants.find((variant) => variant.productCode === entry.productCode && variant.variantName === entry.variantName);
      return [entry.subscriptionId, catalogVariant];
    }),
  );
  const normalizedEntitlementRecords = entitlementRecords
    .map((entry) => ({
      entitlementId: Number(pickString(entry, ["entitlementId", "id"]) || 0),
      feature: pickString(entry, ["feature"]),
      source: pickString(entry, ["source"]),
      validFrom: pickString(entry, ["validFrom"]) || undefined,
      validUntil: pickString(entry, ["validUntil"]) || undefined,
      includedCount: pickNumber(entry, ["includedCount"]),
      remainingCount: pickNumber(entry, ["remainingCount"]),
      recurrence: pickString(entry, ["recurrence"]) || undefined,
      usedCount: pickNumber(entry, ["usedCount"]),
      expiredUnusedCount: pickNumber(entry, ["expiredUnusedCount"]),
      manualTopUpCount: pickNumber(entry, ["manualTopUpCount"]),
      expiresIfUnused: pickBoolean(entry, ["expiresIfUnused"]),
      currentCycleStart: pickString(entry, ["currentCycleStart"]) || undefined,
      currentCycleEnd: pickString(entry, ["currentCycleEnd"]) || undefined,
      lastUtilizedAt: pickString(entry, ["lastUtilizedAt"]) || undefined,
      lastExpiredAt: pickString(entry, ["lastExpiredAt"]) || undefined,
    }))
    .filter((entry) => entry.entitlementId > 0)
    .filter((entry) => shouldTrackUsageEntitlement(entry.feature))
    .map((entry) => {
      if (String(entry.feature || "").toUpperCase() !== "PAUSE_BENEFIT") {
        return entry;
      }
      const linkedSubscriptionId = extractSubscriptionIdFromEntitlementSource(entry.source);
      const linkedVariant = membershipVariantLookup.get(linkedSubscriptionId);
      const allowedDays = Math.max(linkedVariant?.passBenefitDays || 0, Number(entry.includedCount || 0));
      if (allowedDays <= 0) {
        return entry;
      }
      const usedDays = Number(entry.usedCount || 0);
      return {
        ...entry,
        includedCount: allowedDays,
        remainingCount: Math.max(allowedDays - usedDays, 0),
      };
    });
  const portfolioMembershipItems = toArray(subscriptionsDashboardRecord.memberships)
    .map(extractMembershipPortfolioItem)
    .filter((entry): entry is MembershipPortfolioItem => entry !== null);
  const portfolioPrimaryMembership = extractMembershipPortfolioItem(subscriptionsDashboardRecord.primaryMembership)
    || portfolioMembershipItems[0]
    || null;
  const portfolioTransformationMembership = extractMembershipPortfolioItem(subscriptionsDashboardRecord.transformationMembership);
  const portfolioSecondaryMemberships = toArray(subscriptionsDashboardRecord.secondaryMemberships)
    .map(extractMembershipPortfolioItem)
    .filter((entry): entry is MembershipPortfolioItem => entry !== null);
  const hasActivePtMembership = portfolioMembershipItems.some((entry) => {
    const normalizedStatus = String(entry.status || "").toUpperCase();
    return entry.family === "PT" && !["EXPIRED", "LAPSED", "INACTIVE", "CANCELLED", "CANCELED"].includes(normalizedStatus);
  });
  const overviewDisplayedMemberships = portfolioTransformationMembership
    ? [
        portfolioTransformationMembership,
        ...portfolioSecondaryMemberships.filter(
          (entry) =>
            entry.subscriptionId !== portfolioTransformationMembership.subscriptionId &&
            entry.family !== "PT",
        ),
      ]
    : portfolioPrimaryMembership
      ? [
          portfolioPrimaryMembership,
          ...portfolioSecondaryMemberships.filter((entry) => entry.subscriptionId !== portfolioPrimaryMembership.subscriptionId),
        ]
      : portfolioMembershipItems;
  const fallbackOverviewMemberships: MembershipPortfolioItem[] = [
    ...(planName && planName !== "-" && planName !== "No active membership"
      ? [
          {
            subscriptionId: activeSubscriptionId || "overview-primary",
            productVariantId: activeProductVariantId || "",
            family: deriveMembershipFamily(productCategoryCode.toUpperCase(), currentProductCode || planName),
            categoryCode: productCategoryCode,
            productCode: currentProductCode,
            productName: planName,
            variantName: planName,
            status: membershipStatus,
            startDate,
            expiryDate,
            durationMonths,
            validityDays,
            branchCode,
            invoiceNumber: shellLatestInvoiceNumber,
            receiptNumber: shellLatestReceiptNumber,
            paymentConfirmed: paymentStatus.toUpperCase() === "PAID",
            includedCheckIns: 0,
            usedCheckIns: 0,
            checkInsRemaining: 0,
            extraVisitPrice: 0,
            includedPtSessions: 0,
            entitlements: [],
          },
        ]
      : []),
    ...(activePtAssignment
      ? [
          {
            subscriptionId: pickString(activePtAssignmentRecord, ["id", "assignmentId"]) || "overview-pt",
            productVariantId: "",
            family: "PT" as MembershipFamily,
            categoryCode: "PT",
            productCode: "PT",
            productName: "Personal Training",
            variantName:
              pickString(activePtAssignmentRecord, ["packageName", "variantName", "productName", "assignmentName"]) || "Personal Training",
            status: pickBoolean(activePtAssignmentRecord, ["active"]) ? "ACTIVE" : "INACTIVE",
            startDate: pickString(activePtAssignmentRecord, ["startDate"]),
            expiryDate: pickString(activePtAssignmentRecord, ["endDate"]),
            durationMonths: 0,
            validityDays: 0,
            branchCode,
            invoiceNumber: "",
            receiptNumber: "",
            paymentConfirmed: true,
            includedCheckIns: 0,
            usedCheckIns: 0,
            checkInsRemaining: 0,
            extraVisitPrice: 0,
            includedPtSessions: pickNumber(activePtAssignmentRecord, ["sessionCount", "includedSessions", "totalSessions"]),
            entitlements: [],
          },
        ]
      : []),
  ].filter((entry, index, array) => array.findIndex((item) => item.subscriptionId === entry.subscriptionId) === index);
  const overviewMembershipCards = overviewDisplayedMemberships.length ? overviewDisplayedMemberships : fallbackOverviewMemberships;
  const selectedMembershipRecord = portfolioMembershipItems.find((entry) => entry.subscriptionId === selectedMembershipId)
    || portfolioPrimaryMembership
    || null;
  const selectedProductCategoryCode = selectedMembershipRecord?.categoryCode || productCategoryCode;
  const selectedProductCode = selectedMembershipRecord?.productCode || currentProductCode;
  const selectedSubscriptionId = selectedMembershipRecord?.subscriptionId || activeSubscriptionId;
  const selectedProductVariantId = selectedMembershipRecord?.productVariantId
    || (selectedMembershipRecord?.subscriptionId
    ? pickString(
        toRecord(
          toArray(subscriptionsDashboardRecord.memberships).find(
            (entry) => pickString(toRecord(entry), ["subscriptionId"]) === selectedMembershipRecord.subscriptionId,
          ),
        ),
        ["productVariantId"],
      ) || activeProductVariantId
    : activeProductVariantId);
  const selectedDurationMonths = selectedMembershipRecord?.durationMonths || durationMonths;
  const selectedValidityDays = selectedMembershipRecord?.validityDays || validityDays;
  const selectedStartDate = selectedMembershipRecord?.startDate || startDate;
  const selectedExpiryDate = selectedMembershipRecord?.expiryDate || expiryDate;
  const selectedPlanLabel = normalizeDisplayPlanName(selectedMembershipRecord?.variantName || planName);
  const currentCatalogProduct = useMemo(
    () => catalogProducts.find((product) => product.productCode === selectedProductCode),
    [catalogProducts, selectedProductCode],
  );
  const currentCatalogVariant = useMemo(
    () =>
      catalogVariants.find((variant) => String(variant.variantId) === String(selectedProductVariantId)) ||
      catalogVariants.find((variant) => variant.variantCode === selectedPlanLabel || variant.variantName === selectedPlanLabel),
    [selectedProductVariantId, catalogVariants, selectedPlanLabel],
  );
  useEffect(() => {
    if (!portfolioPrimaryMembership?.subscriptionId) {
      return;
    }
    setSelectedMembershipId((current) => {
      if (current && portfolioMembershipItems.some((entry) => entry.subscriptionId === current)) {
        return current;
      }
      return portfolioPrimaryMembership.subscriptionId;
    });
  }, [portfolioMembershipItems, portfolioPrimaryMembership]);
  const entitlementFeatures = entitlementRecords.map((entry) => String(entry.feature || "").toUpperCase());
  const hasFreezeEntitlement = entitlementFeatures.some((feature) =>
    feature === "PAUSE_BENEFIT" ||
    feature === "PAUSE_BENEFITS" ||
    feature === "PASS_BENEFIT" ||
    feature === "PASS_BENEFITS",
  ) || (currentCatalogVariant?.passBenefitDays || 0) > 0;
  const normalizedProductCode = selectedProductCode.toUpperCase();
  const normalizedCategoryCode = selectedProductCategoryCode.toUpperCase();
  const membershipFamily = deriveMembershipFamily(normalizedCategoryCode, normalizedProductCode || selectedPlanLabel || rawPlanName);
  const isGroupClassPlan = membershipFamily === "GROUP_CLASS";
  const isFlagshipPlan = membershipFamily === "FLAGSHIP";
  const isTransformationPlan = membershipFamily === "TRANSFORMATION";
  const isFlexPlan = membershipFamily === "FLEX";
  const isPtPlan = membershipFamily === "PT";
  const hasPrimaryMembership = Boolean(selectedSubscriptionId) && membershipFamily !== "CREDIT_PACK";
  const hasOverviewMembership =
    overviewMembershipCards.length > 0 &&
    !["EXPIRED", "LAPSED", "INACTIVE"].some((status) => membershipStatus.toUpperCase().includes(status));
  const isAdminOperator = user?.role === "ADMIN";
  const isStaffOperator = user?.role === "STAFF";
  const canOperateMemberships = isAdminOperator || isStaffOperator;
  const canManageTransfers = isAdminOperator || (user?.role === "STAFF" && user?.designation === "GYM_MANAGER");
  const pauseBenefitDays = Math.max(
    currentCatalogVariant?.passBenefitDays || 0,
    normalizedEntitlementRecords
      .filter((entry) => String(entry.feature || "").toUpperCase() === "PAUSE_BENEFIT")
      .reduce((max, entry) => Math.max(max, Number(entry.includedCount || 0)), 0),
  );
  const freezeMinDays = 5;
  const freezeMaxDays = pauseBenefitDays;
  const canShowFreezeAction = hasPrimaryMembership && canOperateMemberships && hasFreezeEntitlement && !isFlexPlan && !isGroupClassPlan && !isPtPlan;
  const canRenewMembership = hasPrimaryMembership;
  const canUpgradeMembership =
    hasPrimaryMembership &&
    (isFlagshipPlan || isGroupClassPlan || isFlexPlan || isTransformationPlan || isPtPlan) &&
    canOperateMemberships;
  const canShowPtActions = Boolean(activePtAssignment) || isFlagshipPlan || isTransformationPlan || isPtPlan;
  const canTransferMembership =
    hasPrimaryMembership &&
    canManageTransfers &&
    (
      isFlagshipPlan ||
      normalizedProductCode.includes("CORE") ||
      normalizedProductCode.includes("BLACK") ||
      normalizedProductCode.includes("RHYTHM")
    );
  const canAddPtMembershipAction =
    hasPrimaryMembership &&
    isFlagshipPlan &&
    !hasActivePtMembership &&
    !Boolean(activePtAssignment);
  const selectedCheckInsRemaining = selectedMembershipRecord?.checkInsRemaining || 0;
  const selectedIncludedCheckIns = selectedMembershipRecord?.includedCheckIns || 0;
  const selectedUsedCheckIns = selectedMembershipRecord?.usedCheckIns || 0;
  const selectedExtraVisitPrice = Number(currentCatalogVariant?.extraVisitPrice || selectedMembershipRecord?.extraVisitPrice || 0);
  const canAddFlexVisit =
    hasPrimaryMembership &&
    isFlexPlan &&
    canOperateMemberships &&
    selectedCheckInsRemaining <= 0 &&
    selectedExtraVisitPrice > 0;
  const currentProductRank = productTierRank(membershipFamily, selectedProductCode);
  const membershipActions: MembershipActionState[] = useMemo(() => {
    const actions: MembershipActionState[] = [];
    if (canRenewMembership) {
      actions.push({ key: "renew", label: "Renew", enabled: true });
    }
    if (canUpgradeMembership) {
      actions.push({ key: "upgrade", label: "Upgrade", enabled: true });
    }
    if (canShowFreezeAction) {
      actions.push({ key: "freeze", label: "Freeze", enabled: true });
    }
    if (canTransferMembership) {
      const adminApprovalRequired = !isAdminOperator;
      actions.push({
        key: "transfer",
        label: adminApprovalRequired ? "Raise Transfer Request" : "Transfer",
        enabled: isAdminOperator,
        adminApprovalRequired,
        note: adminApprovalRequired ? "Transfer requires admin approval. The request workflow will be introduced separately." : undefined,
      });
    }
    if (canAddPtMembershipAction) {
      actions.push({
        key: "pt",
        label: "Add PT",
        enabled: true,
      });
    }
    if (canAddFlexVisit) {
      actions.push({
        key: "visit",
        label: "Add Visit",
        enabled: true,
      });
    }
    return actions;
  }, [
    canAddFlexVisit,
    canAddPtMembershipAction,
    canRenewMembership,
    canShowFreezeAction,
    canTransferMembership,
    canUpgradeMembership,
    isAdminOperator,
  ]);
  const primaryMembershipDurationLimit = Math.max(
    0,
    portfolioPrimaryMembership?.family !== "PT" ? Number(portfolioPrimaryMembership?.durationMonths || 0) : 0,
  );
  const filteredLifecycleProducts = useMemo(
    () =>
      catalogProducts.filter((product) => {
        if (product.categoryCode === "CREDIT_PACK") {
          return false;
        }
        if (product.categoryCode === "PT" && !isPtPlan) {
          return false;
        }

        const selectedCategory = lifecycleForm.categoryCode || selectedProductCategoryCode;
        if (selectedCategory && product.categoryCode !== selectedCategory) {
          return false;
        }

        const candidateRank = productTierRank(membershipFamily, product.productCode);

        if (actionModal === "upgrade") {
          if (isFlagshipPlan) {
            return product.categoryCode === "FLAGSHIP" && candidateRank >= currentProductRank;
          }
          if (isFlexPlan) {
            return (product.categoryCode === "FLEX" && product.productCode === selectedProductCode)
              || product.categoryCode === "FLAGSHIP";
          }
          if (isPtPlan) {
            return product.categoryCode === "PT"
              && isSamePtTrack(selectedProductCode, product.productCode)
              && candidateRank >= currentProductRank;
          }
          if (isGroupClassPlan) {
            return product.productCode === selectedProductCode;
          }
          if (isTransformationPlan) {
            return product.categoryCode === "TRANSFORMATION" && candidateRank >= currentProductRank;
          }
        }

        if (actionModal === "renew") {
          return product.productCode === selectedProductCode;
        }

        return selectedCategory ? product.categoryCode === selectedCategory : true;
      }),
    [
      actionModal,
      catalogProducts,
      currentProductRank,
      membershipFamily,
      selectedProductCode,
      isFlagshipPlan,
      isFlexPlan,
      isGroupClassPlan,
      isPtPlan,
      isTransformationPlan,
      lifecycleForm.categoryCode,
      selectedProductCategoryCode,
    ],
  );
  const filteredLifecycleVariants = useMemo(
    () =>
      catalogVariants.filter((variant) => {
        if (variant.categoryCode === "CREDIT_PACK") {
          return false;
        }
        if (variant.categoryCode === "PT" && !isPtPlan) {
          return false;
        }
        const selectedCategory = lifecycleForm.categoryCode || selectedProductCategoryCode;
        const selectedProduct = lifecycleForm.productCode || selectedProductCode;

        if (selectedCategory && variant.categoryCode !== selectedCategory) {
          return false;
        }
        if (selectedProduct && variant.productCode !== selectedProduct) {
          return false;
        }

        const currentVariant = catalogVariants.find((item) => String(item.variantId) === String(selectedProductVariantId));
        const currentDuration = currentVariant?.durationMonths || selectedDurationMonths;
        const currentValidity = currentVariant?.validityDays || selectedValidityDays;
        const currentRank = currentCatalogProduct ? productTierRank(membershipFamily, currentCatalogProduct.productCode) : currentProductRank;
        const candidateRank = productTierRank(membershipFamily, variant.productCode);
        const sameProduct = variant.productCode === selectedProductCode;

        if (actionModal === "upgrade") {
          if (sameProduct) {
            if (currentDuration > 0 && variant.durationMonths > 0) {
              return variant.durationMonths > currentDuration;
            }
            if (currentValidity > 0 && variant.validityDays > 0) {
              return variant.validityDays > currentValidity;
            }
          }
          if (candidateRank > currentRank) {
            if (currentDuration > 0 && variant.durationMonths > 0) {
              return variant.durationMonths >= currentDuration;
            }
            if (currentValidity > 0 && variant.validityDays > 0) {
              return variant.validityDays >= currentValidity;
            }
            return true;
          }
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return false;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return false;
          }
          return false;
        }

        if (actionModal === "renew") {
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return sameProduct && variant.durationMonths === currentDuration;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return sameProduct && variant.validityDays === currentValidity;
          }
          return sameProduct;
        }

        return true;
      }),
    [
      actionModal,
      selectedProductVariantId,
      catalogVariants,
      currentCatalogProduct,
      currentProductRank,
      membershipFamily,
      selectedProductCode,
      selectedDurationMonths,
      isPtPlan,
      lifecycleForm.categoryCode,
      lifecycleForm.productCode,
      selectedProductCategoryCode,
      selectedValidityDays,
    ],
  );
  const lifecycleCategoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogProducts
            .filter((product) => {
              if (product.categoryCode === "CREDIT_PACK") {
                return false;
              }
              if (product.categoryCode === "PT" && !isPtPlan) {
                return false;
              }
              if (actionModal === "upgrade") {
                if (isFlagshipPlan) return product.categoryCode === "FLAGSHIP";
                if (isFlexPlan) return product.categoryCode === "FLAGSHIP" || product.categoryCode === "FLEX";
                if (isPtPlan) return product.categoryCode === "PT" && isSamePtTrack(selectedProductCode, product.productCode);
                if (isGroupClassPlan) return product.categoryCode === "GROUP_CLASS";
                if (isTransformationPlan) return product.categoryCode === "TRANSFORMATION";
              }
              if (actionModal === "renew") {
                return product.productCode === selectedProductCode;
              }
              return product.categoryCode === selectedProductCategoryCode;
            })
            .map((product) => product.categoryCode),
        ),
      ),
    [actionModal, catalogProducts, isFlagshipPlan, isFlexPlan, isGroupClassPlan, isPtPlan, isTransformationPlan, selectedProductCategoryCode],
  );
  const ptProducts = useMemo(
    () => catalogProducts.filter((product) => product.categoryCode === "PT"),
    [catalogProducts],
  );
  const ptVariants = useMemo(
    () => catalogVariants.filter((variant) => variant.categoryCode === "PT"),
    [catalogVariants],
  );
  const selectedLifecycleVariant = useMemo(
    () => catalogVariants.find((variant) => String(variant.variantId) === String(lifecycleForm.productVariantId)),
    [catalogVariants, lifecycleForm.productVariantId],
  );
  const transferInquiryOptions = useMemo(
    () => transferInquiries.filter((inquiry) => inquiry.memberId && String(inquiry.memberId) !== String(memberId)),
    [memberId, transferInquiries],
  );
  const currentLifecycleBasePrice = Number(currentCatalogVariant?.basePrice || 0);
  const targetLifecycleBasePrice = Number(selectedLifecycleVariant?.basePrice || 0);
  const commercialTaxRate = Number(billingSettings?.gstPercentage || 0);
  const upgradeBaseDifference = Math.max(targetLifecycleBasePrice - currentLifecycleBasePrice, 0);
  const lifecycleTaxableAmount = actionModal === "upgrade" ? upgradeBaseDifference : targetLifecycleBasePrice;
  const lifecycleTaxAmount = (lifecycleTaxableAmount * commercialTaxRate) / 100;
  const lifecycleHalfTaxAmount = lifecycleTaxAmount / 2;
  const lifecycleInvoiceTotal = lifecycleTaxableAmount + lifecycleTaxAmount;
  const selectedPtVariant = useMemo(
    () => ptVariants.find((variant) => String(variant.variantId) === String(ptForm.productVariantId)),
    [ptForm.productVariantId, ptVariants],
  );
  const selectablePtVariants = useMemo(
    () =>
      ptVariants.filter((variant) => {
        if (ptForm.productCode && variant.productCode !== ptForm.productCode) {
          return false;
        }
        if (primaryMembershipDurationLimit > 0 && variant.durationMonths > 0 && variant.durationMonths > primaryMembershipDurationLimit) {
          return false;
        }
        return true;
      }),
    [primaryMembershipDurationLimit, ptForm.productCode, ptVariants],
  );

  const alerts = useMemo(() => {
    const next: string[] = [];
    if (membershipStatus.toUpperCase().includes("IRREGULAR")) {
      next.push("Attendance is below threshold and needs follow-up.");
    }
    if (membershipStatus.toUpperCase().includes("EXPIRED")) {
      next.push("Membership is expired and requires renewal.");
    }
    if (renewalWindowDays !== null && renewalWindowDays >= 0 && renewalWindowDays <= 7) {
      next.push(`Membership expires in ${renewalWindowDays} day${renewalWindowDays === 1 ? "" : "s"}.`);
    }
    if (roundedBalanceDue > 0) {
      next.push(`Outstanding billing balance of ${formatRoundedInr(balanceDue)} requires collection.`);
    }
    if (assignedTrainer === "-") {
      next.push(
        trainerLabel === "Group Class Trainer"
          ? "Group class trainer is not configured yet."
          : "Trainer is not assigned yet.",
      );
    }
    return next;
  }, [assignedTrainer, balanceDue, membershipStatus, renewalWindowDays, roundedBalanceDue, trainerLabel]);

  const resetActionFeedback = () => {
    setActionError(null);
    setActionSuccess(null);
  };

  const openActionModal = (modal: ActionModalKey) => {
    resetActionFeedback();
    if (modal === "renew" || modal === "upgrade") {
      const defaultLifecycleCategory =
        modal === "upgrade" && isFlexPlan
          ? "FLAGSHIP"
          : selectedProductCategoryCode || "";
      setLifecycleForm({
        categoryCode: defaultLifecycleCategory,
        productCode: modal === "upgrade" && isFlexPlan ? "" : selectedProductCode || "",
        productVariantId: modal === "upgrade" && isFlexPlan ? "" : selectedProductVariantId || "",
        startDate:
          modal === "renew"
            ? (selectedExpiryDate ? new Date(new Date(selectedExpiryDate).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
            : new Date().toISOString().slice(0, 10),
        dueInDays: "7",
        notes: "",
      });
    }
    if (modal === "transfer") {
      setTransferForm({
        targetMemberId: "",
        startDate: new Date().toISOString().slice(0, 10),
        deactivateSource: true,
        copyUsage: false,
        notes: "",
      });
    }
    if (modal === "freeze") {
      setFreezeForm({
        freezeDays: String(Math.max(freezeMinDays, Math.min(freezeMaxDays || freezeMinDays, freezeMinDays))),
        reason: "",
      });
    }
    if (modal === "pt") {
      setPtForm({
        productCode: ptProducts[0]?.productCode || "",
        productVariantId: "",
        coachId: "",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: "",
      });
    }
    if (modal === "visit") {
      setVisitForm({
        paymentMode: "UPI",
      });
    }
    if (modal === "biometric") {
      setAccessNotes("");
      const attendancePayload = toRecord(tabData.attendance);
      const devices = toArray<RecordLike>(attendancePayload.biometricDevices);
      const preferredDevice = devices.find((device) => pickString(device, ["branchCode"]) === branchCode)
        || devices[0];
      setSelectedBiometricDeviceSerial(pickString(preferredDevice, ["serialNumber"]));
    }
    setActionModal(modal);
  };

  const handleEditProfile = async () => {
    if (!token || !memberId) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const normalizedMobile = normalizeIndianMobile(editForm.mobileNumber);
      await usersService.updateUser(token, memberId, {
        fullName: editForm.fullName,
        name: editForm.fullName,
        email: editForm.email,
        mobileNumber: normalizedMobile,
        active: memberRecord?.active ?? true,
        defaultBranchId: editForm.defaultBranchId || undefined,
        alternateMobileNumber: editForm.alternateMobileNumber || undefined,
        dateOfBirth: editForm.dateOfBirth || undefined,
        gender: editForm.gender || undefined,
        address: editForm.address || undefined,
        emergencyContactName: editForm.emergencyContactName || undefined,
        emergencyContactPhone: editForm.emergencyContactPhone || undefined,
        emergencyContactRelation: editForm.emergencyContactRelation || undefined,
        defaultTrainerStaffId: editForm.defaultTrainerStaffId || undefined,
      });
      if (sourceInquiryId) {
        await subscriptionService.updateInquiry(token, sourceInquiryId, {
          fullName: editForm.fullName,
          email: editForm.email,
          mobileNumber: normalizedMobile,
          dateOfBirth: editForm.dateOfBirth || undefined,
          inquiryAt: editForm.inquiryDate ? `${editForm.inquiryDate}T00:00:00` : undefined,
          clientRepStaffId: editForm.clientRepStaffId ? Number(editForm.clientRepStaffId) : undefined,
          gender: editForm.gender || undefined,
          address: editForm.address || undefined,
          emergencyContactName: editForm.emergencyContactName || undefined,
          emergencyContactPhone: editForm.emergencyContactPhone || undefined,
          emergencyContactRelation: editForm.emergencyContactRelation || undefined,
          branchId: editForm.defaultBranchId ? Number(editForm.defaultBranchId) : undefined,
          defaultTrainerStaffId: editForm.defaultTrainerStaffId ? Number(editForm.defaultTrainerStaffId) : undefined,
        });
      }
      await reloadShell();
      setActionSuccess("Member profile updated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to update member profile.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleSubscriptionAction = async (action: "renew" | "upgrade") => {
    if (!token || !memberId || !lifecycleForm.productVariantId) {
      setActionError("Choose a target variant before continuing.");
      return;
    }
    if (action === "upgrade" && !canUpgradeMembership) {
      setActionError("Upgrade is not available for this membership.");
      return;
    }
    if (action === "renew" && !canRenewMembership) {
      setActionError("Renewal is not available for this membership.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const payload = {
        subscriptionId: selectedSubscriptionId ? Number(selectedSubscriptionId) : undefined,
        productVariantId: Number(lifecycleForm.productVariantId),
        startDate: lifecycleForm.startDate || undefined,
        dueInDays: lifecycleForm.dueInDays ? Number(lifecycleForm.dueInDays) : undefined,
        notes: lifecycleForm.notes || undefined,
      };

      if (action === "renew") {
        await subscriptionService.renewSubscription(token, memberId, payload);
      } else {
        await subscriptionService.upgradeSubscription(token, memberId, payload);
      }

      await reloadShell();
      setActionSuccess(`Membership ${action} completed.`);
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : `Unable to ${action} membership.`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleTransfer = async () => {
    if (!token || !selectedSubscriptionId || !transferForm.targetMemberId) {
      setActionError("Choose the target member before transferring.");
      return;
    }
    if (!canTransferMembership) {
      setActionError("Transfer is allowed only for eligible memberships and authorized users.");
      return;
    }
    if (!isAdminOperator) {
      setActionError("Transfer needs admin approval. Workflow submission will be added separately.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await subscriptionService.transferSubscription(token, selectedSubscriptionId, {
        targetMemberId: Number(transferForm.targetMemberId),
        startDate: transferForm.startDate || undefined,
        deactivateSource: transferForm.deactivateSource,
        copyUsage: transferForm.copyUsage,
        notes: transferForm.notes || undefined,
      });
      await reloadShell();
      setActionSuccess("Membership transferred.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to transfer membership.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleFreeze = async () => {
    if (!token || !memberId) {
      return;
    }
    if (!canShowFreezeAction) {
      setActionError("Freeze is not available for this membership.");
      return;
    }

    const freezeDays = Number(freezeForm.freezeDays);
    if (!Number.isFinite(freezeDays) || freezeDays < freezeMinDays || freezeDays > freezeMaxDays) {
      setActionError(`Freeze days must be between ${freezeMinDays} and ${freezeMaxDays}.`);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await engagementService.activateFreeze(token, memberId, {
        subscriptionId: Number(selectedSubscriptionId),
        freezeDays,
        reason: freezeForm.reason || undefined,
      });
      await reloadShell();
      setActionSuccess("Freeze activated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to activate freeze.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddVisit = async () => {
    if (!token || !memberId || !selectedSubscriptionId) {
      return;
    }
    if (!canAddFlexVisit) {
      setActionError("Add Visit is available only when the flex check-in limit is exhausted.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const response = await subscriptionService.addFlexVisit(token, selectedSubscriptionId, {
        memberId: Number(memberId),
        paymentMode: visitForm.paymentMode,
      });
      await reloadShell();
      setActionSuccess(`Extra visit added. Invoice ${response.invoiceNumber} and receipt ${response.receiptNumber} generated.`);
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to add extra visit.");
    } finally {
      setActionBusy(false);
    }
  };

  const handlePtAssignment = async () => {
    if (!token || !memberId || !ptForm.coachId || !email) {
      setActionError("Choose a coach and make sure the member email is available.");
      return;
    }
    if (!canShowPtActions) {
      setActionError("Personal training is not available for this membership.");
      return;
    }

    const coach = coaches.find((item) => item.id === ptForm.coachId);
    if (!coach?.email) {
      setActionError("Selected coach does not have an email configured.");
      return;
    }
    if (selectedPtVariant && primaryMembershipDurationLimit > 0 && selectedPtVariant.durationMonths > primaryMembershipDurationLimit) {
      setActionError(`PT duration cannot be greater than the primary membership duration of ${primaryMembershipDurationLimit} month${primaryMembershipDurationLimit === 1 ? "" : "s"}.`);
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const payload: ClientAssignmentRequest = {
        memberId: Number(memberId),
        memberEmail: email,
        coachId: Number(ptForm.coachId),
        coachEmail: coach.email,
        trainingType: "PERSONAL_TRAINING",
        startDate: ptForm.startDate || new Date().toISOString().slice(0, 10),
        endDate: ptForm.endDate || undefined,
      };
      await trainingService.createAssignment(token, payload);
      await reloadShell();
      setTabData((current) => ({ ...current, "personal-training": undefined }));
      setActionSuccess(activePtAssignment ? "Personal training renewed." : "Personal training assigned.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to assign personal training.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleAccessAction = async (action: string) => {
    if (!token || !memberId) {
      return;
    }
    if (!selectedBiometricDeviceSerial) {
      setActionError("Select a biometric device before continuing.");
      return;
    }
    if (!normalizedPhonePin) {
      setActionError("Member mobile number is required to sync with the biometric device.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const biometricPayload = {
        serialNumber: selectedBiometricDeviceSerial,
        pin: normalizedPhonePin,
        name: memberDisplayName,
      };
      if (action === "ADD_USER") {
        await engagementService.enrollBiometricUser(token, biometricPayload);
      } else if (action === "RE_ADD_USER") {
        await engagementService.reAddBiometricUser(token, biometricPayload);
      } else if (action === "BLOCK_USER") {
        await engagementService.blockBiometricUser(token, biometricPayload);
      } else if (action === "UNBLOCK_USER") {
        await engagementService.unblockBiometricUser(token, biometricPayload);
      } else if (action === "DELETE_USER") {
        await engagementService.deleteBiometricUser(token, {
          serialNumber: selectedBiometricDeviceSerial,
          pin: normalizedPhonePin,
        });
      }
      const nextState = await usersService.applyMemberAccessAction(token, memberId, {
        action,
        notes: accessNotes || undefined,
      });
      const refreshedBiometricLogs = await engagementService.getBiometricLogs(token).catch(() => biometricLogRecords);
      const refreshedAttendanceLogs = refreshedBiometricLogs.filter((entry) => {
        const logMemberId = pickString(toRecord(entry), ["memberId"]);
        const logPin = pickString(toRecord(entry), ["deviceUserId"]);
        return logMemberId === String(memberId) || (!!normalizedPhonePin && logPin === normalizedPhonePin);
      });
      setTabData((current) => ({
        ...current,
        "recovery-services": nextState,
        "audit-trail": undefined,
        attendance: (() => {
          const currentAttendancePayload = toRecord(current.attendance);
          const currentAttendanceRecords: unknown[] = Array.isArray(currentAttendancePayload.records)
            ? (currentAttendancePayload.records as unknown[])
            : attendanceRecords;
          return {
            records: currentAttendanceRecords,
            biometricDevices: availableBiometricDevices,
            biometricLogs: refreshedAttendanceLogs,
          };
        })(),
      }));
      setActionSuccess("Biometric device command queued and access state updated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to sync member access with the biometric device.");
    } finally {
      setActionBusy(false);
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <ProfilePanel title="Personal Details" subtitle="Core member identity and contact information" accent="slate">
            <dl className="divide-y divide-white/8 overflow-hidden rounded-[24px] border border-white/8 bg-white/[0.03]">
              {[
                { label: "Mobile Number", value: phone || "-" },
                { label: "Email Address", value: email || "-" },
                { label: "Date Of Birth", value: formatDateOnly(dateOfBirth || undefined) },
                { label: "Date Of Enquiry", value: formatDateTime(inquiryDate || undefined) },
                { label: "Client Representative", value: clientRepName },
                ...(!isFlexPlan ? [{ label: trainerLabel, value: assignedTrainer }] : []),
                { label: "Interested In", value: interestedIn },
                { label: "Emergency Contact", value: emergencyContact },
                { label: "Referral Source", value: referredBy },
                { label: "Member Code", value: memberCode },
                { label: "Home Branch", value: branchLabel },
              ].map((entry) => (
                <div key={entry.label} className="grid gap-2 px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                  <dd className="text-base font-medium text-white md:text-right">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </ProfilePanel>

        </div>

        <div className="space-y-6">
          {hasOverviewMembership ? (
            <ProfilePanel title="Membership Summary" accent="lime">
              <div className="space-y-4">
                {overviewMembershipCards.map((membership) => {
                  const overviewTrainerLabel =
                    membership.family === "GROUP_CLASS" ? "Group Class Trainer" : membership.family === "PT" ? "Coach" : trainerLabel;
                  const overviewTrainerValue =
                    membership.family === "PT"
                      ? assignedTrainer
                      : membership.family === "GROUP_CLASS"
                        ? assignedTrainer
                        : assignedTrainer;
                  return (
                    <div key={membership.subscriptionId} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-2xl font-semibold tracking-tight text-white">
                          {normalizeDisplayPlanName(membership.variantName || membership.productName || humanizeLabel(membership.productCode || membership.categoryCode))}
                        </p>
                        <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                          {humanizeLabel(membership.family)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <StatPill label="Membership Status" value={humanizeLabel(membership.status || membershipStatus)} />
                        <StatPill label="Duration" value={formatPlanDuration(membership.durationMonths, membership.validityDays)} />
                        <StatPill label="Start Date" value={formatDateOnly(membership.startDate || undefined)} />
                        <StatPill label="Expires In" value={formatExpiryWindow(daysUntil(membership.expiryDate))} />
                        {membership.family !== "FLEX" ? (
                          <StatPill label={overviewTrainerLabel} value={overviewTrainerValue} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ProfilePanel>
          ) : null}

          <ProfilePanel title="Alerts" subtitle="Only active items that need attention" accent={alerts.length ? "rose" : "slate"}>
            {alerts.length === 0 ? (
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-slate-300">
                No active alerts for this member.
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((entry) => (
                  <div key={entry} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-slate-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>{entry}</span>
                  </div>
                ))}
              </div>
            )}
          </ProfilePanel>
        </div>
      </div>
    </div>
  );

  const renderBilling = () => {
    const invoices = tabData.billing || [];
    const stats = extractInvoiceStats(invoices);
    const normalizedStats = {
      total: roundAmount(stats.total),
      paid: roundAmount(stats.paid),
      balance: roundAmount(stats.balance),
      latestInvoice: stats.latestInvoice,
      latestReceipt: stats.latestReceipt,
      latestIssuedAt: stats.latestIssuedAt,
    };

    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Total Invoiced", value: formatRoundedInr(normalizedStats.total), icon: <CreditCard className="h-5 w-5 text-cyan-300" /> },
            { label: "Collected", value: formatRoundedInr(normalizedStats.paid), icon: <BadgeCheck className="h-5 w-5 text-[#c42924]" /> },
            { label: "Outstanding", value: formatRoundedInr(normalizedStats.balance), icon: <AlertTriangle className="h-5 w-5 text-amber-300" /> },
            { label: "Latest Invoice", value: normalizedStats.latestInvoice || "-", icon: <CalendarDays className="h-5 w-5 text-slate-300" /> },
          ].map((entry) => (
            <ProfilePanel key={entry.label} title={entry.label} accent="slate">
              <div className="flex items-center justify-between gap-3">
                <p className="text-2xl font-semibold text-white">{entry.value}</p>
                {entry.icon}
              </div>
            </ProfilePanel>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <ProfilePanel title="Billing Contacts" subtitle="Commercial ownership and last issued references" accent="slate">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatPill label="Billing Representative" value={billingRepName} />
              <StatPill label="Client Representative" value={clientRepName} />
              <StatPill label="Latest Receipt" value={normalizedStats.latestReceipt || "-"} />
              <StatPill label="Payment Status" value={humanizeLabel(paymentStatus)} />
            </div>
          </ProfilePanel>
          <ProfilePanel title="Billing Rules" subtitle="Rounded values and payment status use the same commercial calculation everywhere on this profile." accent="cyan">
            <div className="grid gap-3 sm:grid-cols-2">
              <StatPill label="Rounded Total" value={formatRoundedInr(normalizedStats.total)} />
              <StatPill label="Rounded Collected" value={formatRoundedInr(normalizedStats.paid)} />
              <StatPill label="Rounded Outstanding" value={formatRoundedInr(normalizedStats.balance)} />
              <StatPill label="Status Logic" value={humanizeLabel(paymentStatus)} />
            </div>
          </ProfilePanel>
        </div>

        {invoices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
            No invoices available.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#15181f] shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/8 bg-white/[0.03] text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Balance</th>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Issued At</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {invoices.map((invoice) => {
                  const invoiceView = {
                    amount: roundAmount(invoice.amount),
                    paidAmount: roundAmount(invoice.paidAmount || 0),
                    balanceAmount: roundAmount(invoice.balanceAmount || 0),
                    paymentStatus: normalizePaymentStatus(
                      invoice.status,
                      invoice.amount,
                      invoice.paidAmount || 0,
                      invoice.balanceAmount || 0,
                    ),
                  };
                  return (
                  <tr key={invoice.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3 text-slate-200">{formatRoundedInr(invoiceView.amount)}</td>
                    <td className="px-4 py-3 text-slate-200">{formatRoundedInr(invoiceView.paidAmount)}</td>
                    <td className="px-4 py-3 text-slate-200">{formatRoundedInr(invoiceView.balanceAmount)}</td>
                    <td className="px-4 py-3 text-slate-200">{invoice.receiptNumber || "-"}</td>
                    <td className="px-4 py-3 text-slate-200">{humanizeLabel(invoiceView.paymentStatus)}</td>
                    <td className="px-4 py-3 text-slate-200">{formatDateTime(invoice.issuedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          title={`Print invoice ${invoice.invoiceNumber}`}
                          aria-label={`Print invoice ${invoice.invoiceNumber}`}
                          onClick={() => void printDocumentPdf("invoice", invoice.id)}
                          disabled={documentBusyKey === `invoice-print-${invoice.id}`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title={`Download invoice ${invoice.invoiceNumber}`}
                          aria-label={`Download invoice ${invoice.invoiceNumber}`}
                          onClick={() => void downloadDocumentPdf("invoice", invoice.id, invoice.invoiceNumber)}
                          disabled={documentBusyKey === `invoice-download-${invoice.id}`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title={`Share invoice ${invoice.invoiceNumber}`}
                          aria-label={`Share invoice ${invoice.invoiceNumber}`}
                          onClick={() => void shareDocumentPdf("invoice", invoice.id, invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber}`)}
                          disabled={documentBusyKey === `invoice-share-${invoice.id}`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                        {invoice.receiptNumber && invoice.receiptId ? (() => {
                          const receiptId = invoice.receiptId;
                          const receiptNumber = invoice.receiptNumber;
                          return (
                          <>
                            <button
                              type="button"
                              title={`Print receipt ${receiptNumber}`}
                              aria-label={`Print receipt ${receiptNumber}`}
                              onClick={() => void printDocumentPdf("receipt", receiptId)}
                              disabled={documentBusyKey === `receipt-print-${receiptId}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={`Download receipt ${receiptNumber}`}
                              aria-label={`Download receipt ${receiptNumber}`}
                              onClick={() => void downloadDocumentPdf("receipt", receiptId, receiptNumber)}
                              disabled={documentBusyKey === `receipt-download-${receiptId}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title={`Share receipt ${receiptNumber}`}
                              aria-label={`Share receipt ${receiptNumber}`}
                              onClick={() => void shareDocumentPdf("receipt", receiptId, receiptNumber, `Receipt ${receiptNumber}`)}
                              disabled={documentBusyKey === `receipt-share-${receiptId}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              <Share2 className="h-4 w-4" />
                            </button>
                          </>
                          );
                        })() : null}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderFitnessAssessment = () => {
    const data = tabData["fitness-assessment"];
    if (!data) {
      return null;
    }

    const formCompleted =
      pickBoolean(data.fitnessForm.consent, ["accepted"]) ??
      Object.keys(toRecord(data.fitnessForm)).length > 0;

    return (
      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-3">
          <ProfilePanel title="Fitness Form" accent="slate">
            <KeyValueGrid
              payload={{
                completed: formCompleted ? "Yes" : "No",
                signature: pickString(data.fitnessForm.consent, ["signatureName"]) || "-",
                signedAt: formatDateTime(pickString(data.fitnessForm.consent, ["signedAt"]) || undefined),
              }}
            />
          </ProfilePanel>
          <ProfilePanel title="Assessment Status" accent="slate">
            <KeyValueGrid
              payload={{
                status: data.assessmentStatus.status || "-",
                coach: data.assessmentStatus.assignedCoachName || data.assessmentStatus.assignedCoachId || "-",
                scheduledAt: formatDateTime(data.assessmentStatus.scheduledAt),
                completedAt: formatDateTime(data.assessmentStatus.completedAt),
              }}
            />
          </ProfilePanel>
          <ProfilePanel title="Result" accent="slate">
            <KeyValueGrid
              payload={{
                score: data.assessmentStatus.score ?? 0,
                category: data.assessmentStatus.category || "-",
                classification: data.assessmentStatus.classification || "-",
              }}
            />
          </ProfilePanel>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runAssessmentAction("request")}
            disabled={assessmentActionBusy}
            className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a71f23] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {assessmentActionBusy ? "Working..." : "Request Assessment"}
          </button>
          <button
            type="button"
            onClick={() => void runAssessmentAction("skip")}
            disabled={assessmentActionBusy}
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Skip Assessment
          </button>
        </div>

        <ProfilePanel title="Fitness Form Details" accent="slate">
          <div className="space-y-4">
            <KeyValueGrid payload={data.fitnessForm.personalInfo} />
            <KeyValueGrid payload={data.fitnessForm.physicalReadiness} />
            <KeyValueGrid payload={data.fitnessForm.fitnessGoals} />
          </div>
        </ProfilePanel>

        <ProfilePanel title="Assessment History" accent="slate">
          <GenericTable
            items={data.assessmentHistory.map((entry) => entry.raw)}
            emptyLabel="No assessment history available."
          />
        </ProfilePanel>
      </div>
    );
  };

  const renderTab = () => {
    const tabError = tabErrors[activeTab];
    const tabLoading = loadingTabs[activeTab];
    const hasResolvedSubscriptionData = activeTab === "subscriptions" && Boolean(tabData.subscriptions);

    if (tabError) {
      return <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{tabError}</div>;
    }

    if (tabLoading && !hasResolvedSubscriptionData) {
      return (
        <div className="inline-flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {activeTab.replace(/-/g, " ")}...
        </div>
      );
    }

    switch (activeTab) {
      case "overview":
        return renderOverview();
      case "subscriptions": {
        const data = tabData.subscriptions;
        if (!data) return null;
        const dashboardRecord = toRecord(data.dashboard);
        const primaryMembershipRecord = extractMembershipPortfolioItem(dashboardRecord.primaryMembership);
        const transformationMembershipRecord = extractMembershipPortfolioItem(dashboardRecord.transformationMembership);
        const membershipPortfolio = toArray(dashboardRecord.memberships)
          .map(extractMembershipPortfolioItem)
          .filter((entry): entry is MembershipPortfolioItem => entry !== null);
        const secondaryMembershipRecords = toArray(dashboardRecord.secondaryMemberships)
          .map(extractMembershipPortfolioItem)
          .filter((entry): entry is MembershipPortfolioItem => entry !== null);
        const displayedMemberships = (transformationMembershipRecord
          ? [
              transformationMembershipRecord,
              ...secondaryMembershipRecords.filter(
                (entry) =>
                  entry.subscriptionId !== transformationMembershipRecord.subscriptionId &&
                  entry.family !== "PT",
              ),
            ]
          : primaryMembershipRecord
            ? [
                primaryMembershipRecord,
                ...secondaryMembershipRecords.filter((entry) => entry.subscriptionId !== primaryMembershipRecord.subscriptionId),
              ]
            : membershipPortfolio).filter((entry) => entry.family !== "CREDIT_PACK");
        const shouldShowEntitlementsBesideMembership = displayedMemberships.length <= 1;
        const programEnrollmentRecords = toArray<RecordLike>(data.programEnrollments);
        const displayedEntitlementRecords = (() => {
          const existingPauseBenefit = normalizedEntitlementRecords.some(
            (entry) => String(entry.feature || "").toUpperCase() === "PAUSE_BENEFIT",
          );
          if (existingPauseBenefit) {
            return normalizedEntitlementRecords;
          }

          const pauseBenefitVariant = displayedMemberships
            .map((membership) => {
              const membershipDashboardItem = toRecord(
                toArray(dashboardRecord.memberships).find(
                  (entry) => pickString(toRecord(entry), ["subscriptionId"]) === membership.subscriptionId,
                ),
              );
              const membershipVariantId = pickString(membershipDashboardItem, ["productVariantId"]) || membership.productVariantId;
              return catalogVariants.find((variant) => String(variant.variantId) === membershipVariantId);
            })
            .find((variant) => Number(variant?.passBenefitDays || 0) > 0);

          if (!pauseBenefitVariant) {
            return normalizedEntitlementRecords;
          }

          return [
            ...normalizedEntitlementRecords,
            {
              entitlementId: -1,
              feature: "PAUSE_BENEFIT",
              source: "CATALOG_FALLBACK",
              validFrom: undefined,
              validUntil: undefined,
              includedCount: pauseBenefitVariant.passBenefitDays,
              remainingCount: pauseBenefitVariant.passBenefitDays,
              recurrence: "FULL_TERM",
              usedCount: 0,
              expiredUnusedCount: 0,
              manualTopUpCount: 0,
              expiresIfUnused: false,
              currentCycleStart: undefined,
              currentCycleEnd: undefined,
              lastUtilizedAt: undefined,
              lastExpiredAt: undefined,
            },
          ];
        })();
        const shouldShowEntitlementsPanel = displayedEntitlementRecords.length > 0;
        const ptCompletedSessions = ptSessions.filter((session) => {
          const status = pickString(toRecord(session), ["status"]).toUpperCase();
          return status === "COMPLETED" || status === "DONE";
        }).length;
        const ptConsumedSessions = ptSessions.filter((session) => {
          const status = pickString(toRecord(session), ["status"]).toUpperCase();
          return status === "COMPLETED" || status === "DONE" || status === "NO_SHOW";
        }).length;
        const entitlementsUsagePanel = shouldShowEntitlementsPanel ? (
          <ProfilePanel title="Entitlements & Usage" subtitle="Tracked benefits available on this membership" accent="cyan">
              <div className="space-y-3">
                {displayedEntitlementRecords.map((entitlement) => (
                  <div key={entitlement.entitlementId} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{cleanEntitlementFeatureLabel(entitlement.feature)}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {entitlementRuleLabel(entitlement)}
                          {String(entitlement.feature || "").toUpperCase() !== "PAUSE_BENEFIT" && entitlement.currentCycleEnd
                            ? ` · resets ${formatDateOnly(entitlement.currentCycleEnd)}`
                            : ""}
                        </p>
                        {String(entitlement.feature || "").toUpperCase() === "PAUSE_BENEFIT" ? (
                          <p className="mt-2 text-xs text-slate-500">Available across the full membership duration.</p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            {Number(entitlement.expiredUnusedCount || 0) > 0 ? `${entitlement.expiredUnusedCount} expired unused` : "No expired unused balance"}
                            {Number(entitlement.manualTopUpCount || 0) > 0 ? ` · ${entitlement.manualTopUpCount} manual top-up` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-semibold text-cyan-100">{entitlementUsageLabel(entitlement)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </ProfilePanel>
        ) : null;
        return (
          <div className="space-y-6">
            <div className={`grid gap-6 ${shouldShowEntitlementsBesideMembership && shouldShowEntitlementsPanel ? "xl:grid-cols-2" : ""}`}>
              <div className={shouldShowEntitlementsBesideMembership ? "space-y-6" : "grid gap-6 xl:grid-cols-2"}>
                {displayedMemberships.length ? displayedMemberships.map((membership) => {
                const cardTitle = trimMembershipCardTitle(
                  membership.variantName || membership.productName || humanizeLabel(membership.productCode || membership.categoryCode),
                );
                const isPrimaryCard = primaryMembershipRecord?.subscriptionId === membership.subscriptionId;
                const isTransformationCard = membership.family === "TRANSFORMATION";
                const isPtCard = membership.family === "PT";
                const isSelectedCard = selectedMembershipRecord?.subscriptionId === membership.subscriptionId;
                const isMenuOpen = openMembershipMenuId === membership.subscriptionId;
                const ptTotalSessions = membership.includedPtSessions || 0;
                const ptUsedSessions = isPtCard ? ptConsumedSessions : 0;
                const ptRemainingSessions = isPtCard ? Math.max(ptTotalSessions - ptUsedSessions, 0) : 0;
                const ptProgressPercent = isPtCard && ptTotalSessions > 0 ? Math.min(100, Math.round((ptUsedSessions / ptTotalSessions) * 100)) : 0;
                const membershipDashboardItem = toRecord(
                  toArray(dashboardRecord.memberships).find(
                    (entry) => pickString(toRecord(entry), ["subscriptionId"]) === membership.subscriptionId,
                  ),
                );
                const membershipVariantId = pickString(membershipDashboardItem, ["productVariantId"]);
                const membershipCatalogVariant =
                  catalogVariants.find((variant) => String(variant.variantId) === membershipVariantId) ||
                  catalogVariants.find((variant) => variant.productCode === membership.productCode && variant.variantName === membership.variantName);
                const membershipPackageFeatures = parseFeatureList(membershipCatalogVariant?.includedFeatures)
                  .filter((feature) => shouldShowPackageFeatureChip(feature))
                  .map((feature) => cleanEntitlementFeatureLabel(feature))
                  .filter((feature, index, array) => array.indexOf(feature) === index);
                const linkedPrograms = membership.family === "GROUP_CLASS"
                  ? Array.from(
                      new Set(
                        programEnrollmentRecords
                          .map((entry) => pickString(entry, ["programName"]))
                          .filter(Boolean),
                      ),
                    )
                  : [];
                return (
                  <ProfilePanel
                    key={membership.subscriptionId}
                    title={membershipPanelTitle(membership.family)}
                    subtitle={membershipPanelSubtitle(membership.family)}
                    accent={deriveAccentForMembershipFamily(membership.family)}
                  >
                    <div
                      data-membership-menu-root="true"
                      className={`relative z-10 space-y-4 rounded-2xl border px-4 py-4 ${isSelectedCard ? "border-[#c42924]/60 bg-[#c42924]/8" : "border-white/8 bg-white/[0.02]"}`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="space-y-2">
                          <p className="text-3xl font-semibold tracking-tight text-white">{cardTitle}</p>
                          <p className="text-sm text-slate-300">Category: {humanizeLabel(membership.categoryCode)}</p>
                        </div>
                        {isPrimaryCard ? (
                          <span className="rounded-full border border-lime-400/30 bg-lime-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-lime-100">
                            Primary
                          </span>
                        ) : null}
                        {isTransformationCard ? (
                          <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-200">
                            Gym + PT Bundle
                          </span>
                        ) : null}
                        {isPtCard ? (
                          <span className="rounded-full border border-rose-400/30 bg-rose-500/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-rose-200">
                            Secondary
                          </span>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Open actions for ${cardTitle}`}
                          onClick={() => {
                            setSelectedMembershipId(membership.subscriptionId);
                            setOpenMembershipMenuId((current) => (current === membership.subscriptionId ? null : membership.subscriptionId));
                          }}
                          className="ml-auto rounded-xl border border-white/10 bg-white/[0.04] p-2 text-slate-100 hover:bg-white/[0.08]"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {isMenuOpen ? (
                          <div className="absolute right-4 top-14 z-40 min-w-[220px] rounded-2xl border border-white/10 bg-[#111821] p-2 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
                            {membershipActions
                              .filter((action) => !(isPtCard && action.key === "pt"))
                              .map((action) => (
                              <button
                                key={`${membership.subscriptionId}-${action.key}`}
                                type="button"
                                onClick={() => {
                                  setOpenMembershipMenuId(null);
                                  if (action.enabled) {
                                    openActionModal(action.key === "pt" ? "pt" : action.key);
                                  }
                                }}
                                disabled={!action.enabled}
                                className={`flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${
                                  action.enabled
                                    ? "text-slate-100 hover:bg-white/[0.06]"
                                    : "cursor-not-allowed text-slate-500"
                                }`}
                              >
                                {action.label}
                              </button>
                            ))}
                            {isPtCard || isTransformationCard ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMembershipMenuId(null);
                                  setActiveTab("personal-training");
                                  setPtFocusSection("session-register");
                                }}
                                className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-[#ffd6d4] hover:bg-[#c42924]/10"
                              >
                                Open Session Register
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {membershipPackageFeatures.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {membershipPackageFeatures.map((feature) => (
                            <span
                              key={`${membership.subscriptionId}-${feature}`}
                              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200"
                            >
                              {feature}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {linkedPrograms.length > 0 ? (
                        <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/8 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/70">
                            {linkedPrograms.length === 1 ? "Linked Program" : "Linked Programs"}
                          </p>
                          <p className="mt-2 text-sm font-medium text-cyan-100">{linkedPrograms.join(", ")}</p>
                        </div>
                      ) : null}
                      {isPtCard ? (
                        <p className="text-sm text-slate-300">
                          PT remains a separate commercial membership with its own billing and session delivery.
                        </p>
                      ) : null}
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <StatPill label="Membership Status" value={humanizeLabel(membership.status || "-")} />
                        <StatPill label="Duration" value={formatPlanDuration(membership.durationMonths, membership.validityDays)} />
                        <StatPill label="Start Date" value={formatDateOnly(membership.startDate || undefined)} />
                        <StatPill label="Expiry Date" value={formatDateOnly(membership.expiryDate || undefined)} />
                        {membership.family === "PT" ? (
                          <>
                            <StatPill label="Coach" value={pickString(activePtAssignmentRecord, ["coachEmail", "coachId"]) || assignedTrainer || "-"} />
                            <StatPill label="Sessions" value={ptTotalSessions ? `${ptUsedSessions} / ${ptTotalSessions}` : String(ptCompletedSessions)} />
                          </>
                        ) : null}
                        {membership.family === "FLEX" ? (
                          <>
                            <StatPill label="Check-In Limit" value={String(membership.includedCheckIns || 0)} />
                            <StatPill label="Check-Ins Used" value={String(membership.usedCheckIns || 0)} />
                            <StatPill label="Remaining Check-Ins" value={String(membership.checkInsRemaining || 0)} />
                          </>
                        ) : null}
                      </div>
                      {isPtCard && ptTotalSessions > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                            <span>{ptUsedSessions} completed</span>
                            <span>{ptRemainingSessions} remaining</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/8">
                            <div className="h-full rounded-full bg-rose-400 transition-all" style={{ width: `${ptProgressPercent}%` }} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </ProfilePanel>
                );
                }) : (
                  <ProfilePanel title="Membership Portfolio" subtitle="No active or recent memberships are attached to this member yet." accent="slate">
                    <p className="text-sm text-slate-300">No memberships found.</p>
                  </ProfilePanel>
                )}
              </div>
              {shouldShowEntitlementsBesideMembership && shouldShowEntitlementsPanel ? (
                <div className="xl:min-w-0">
                  {entitlementsUsagePanel}
                </div>
              ) : null}
            </div>
            {!shouldShowEntitlementsBesideMembership && shouldShowEntitlementsPanel ? (
              <div className="xl:w-1/2">
                {entitlementsUsagePanel}
              </div>
            ) : null}
          </div>
        );
      }
      case "billing":
        return renderBilling();
      case "attendance":
        return (
          <div className="space-y-6">
            <ProfilePanel title="Attendance Timeline" subtitle="Check-ins and check-outs" accent="slate">
              <GenericTable items={attendanceRecords} emptyLabel="No attendance records available." />
            </ProfilePanel>
            <ProfilePanel title="Access & Biometrics" subtitle="Operational access state for this member" accent="slate">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Status", value: tabData["recovery-services"]?.status || "NOT_ADDED" },
                  { label: "External Reference", value: tabData["recovery-services"]?.externalReference || `MEMBER-${memberId}` },
                  { label: "Last Action", value: tabData["recovery-services"]?.lastAction || "-" },
                  { label: "Updated At", value: formatDateTime(tabData["recovery-services"]?.updatedAt) },
                ].map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</p>
                    <p className="mt-2 text-base font-medium text-white">{entry.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Biometric PIN</p>
                  <p className="mt-2 text-base font-medium text-white">{normalizedPhonePin || "-"}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Branch Devices</p>
                  <p className="mt-2 text-base font-medium text-white">{availableBiometricDevices.length}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Recent Biometric Logs</p>
                  <p className="mt-2 text-base font-medium text-white">{biometricLogRecords.length}</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openActionModal("biometric")}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/[0.08]"
                >
                  Manage Access Actions
                </button>
              </div>
            </ProfilePanel>
            <ProfilePanel title="Biometric Device Logs" subtitle="Recent attendance punches from the ESSL device for this member" accent="slate">
              <GenericTable items={biometricLogRecords} emptyLabel="No biometric device logs available for this member yet." />
            </ProfilePanel>
          </div>
        );
      case "credits-wallet": {
        const data = tabData["credits-wallet"];
        if (!data) return null;
        const ledgerContent = Array.isArray(data.ledger.content) ? data.ledger.content : [];
        return (
          <div className="space-y-6">
            <ProfilePanel title="Wallet Summary" accent="cyan">
              <KeyValueGrid payload={data.wallet} />
            </ProfilePanel>
            <ProfilePanel title="Ledger" accent="slate">
              <GenericTable items={ledgerContent} emptyLabel="No credit ledger entries available." />
            </ProfilePanel>
          </div>
        );
      }
      case "recovery-services":
        return null;
      case "personal-training": {
        const completedSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "COMPLETED" || status === "DONE";
        }).length;
        const scheduledSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "SCHEDULED" || status === "UPCOMING" || status === "PENDING";
        }).length;
        const inProgressSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "IN_PROGRESS";
        }).length;
        const noShowSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "NO_SHOW";
        }).length;
        const cancelledSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "CANCELLED" || status === "CANCELED";
        }).length;
        const totalSessions = ptSessions.length;
        const ptMembershipRecord = portfolioMembershipItems.find((entry) => entry.family === "PT") || null;
        const includedPtSessions = ptMembershipRecord?.includedPtSessions || 0;
        const pendingSessions = scheduledSessions + inProgressSessions;
        const remainingPtSessions = includedPtSessions > 0 ? Math.max(includedPtSessions - (completedSessions + noShowSessions), 0) : 0;
        const trainerCountedSessions = completedSessions; // Only COMPLETED counts for trainer
        const memberConsumedSessions = completedSessions + noShowSessions; // COMPLETED + NO_SHOW for member
        const attendancePct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

        const activeAssignRec = activePtAssignment ? toRecord(activePtAssignment) : null;
        const activeAssignId = activeAssignRec ? pickString(activeAssignRec, ["id", "assignmentId"]) : null;

        // PT slot data from tabData
        const ptSlots = Array.isArray((tabData["personal-training"] as Record<string, unknown>)?.slots)
          ? ((tabData["personal-training"] as Record<string, unknown>).slots as unknown[])
          : [];

        const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
        const sortedSlots = [...ptSlots].sort((a, b) => {
          const dayA = DAY_ORDER.indexOf(pickString(toRecord(a), ["dayOfWeek"]) || "");
          const dayB = DAY_ORDER.indexOf(pickString(toRecord(b), ["dayOfWeek"]) || "");
          return dayA - dayB;
        });

        const handleSessionAction = async (sessionId: string, action: "start" | "end" | "complete" | "cancel" | "no-show") => {
          if (!token) return;
          try {
            if (action === "start") await trainingService.startSession(token, sessionId, "PORTAL");
            else if (action === "end") await trainingService.endSession(token, sessionId, "PORTAL");
            else if (action === "complete") await trainingService.markSessionComplete(token, sessionId);
            else if (action === "cancel") await trainingService.cancelPtSession(token, sessionId);
            else if (action === "no-show") await trainingService.markSessionNoShow(token, sessionId);
            // Reload PT tab data
            setTabData((current) => ({ ...current, "personal-training": undefined }));
            setLoadingTabs((current) => ({ ...current, "personal-training": false }));
            setActionSuccess(`Session ${action === "start" ? "started" : action === "end" ? "ended" : action} successfully.`);
          } catch (err) {
            setActionError(err instanceof Error ? err.message : `Failed to ${action} session.`);
          }
        };

        const handleGenerateSessions = async () => {
          if (!token || !activeAssignId) return;
          const fromDate = new Date().toISOString().split("T")[0];
          const toDateObj = new Date();
          toDateObj.setDate(toDateObj.getDate() + 30);
          const toDate = toDateObj.toISOString().split("T")[0];
          try {
            await trainingService.generateSessionsFromSlots(token, {
              assignmentId: Number(activeAssignId),
              fromDate,
              toDate,
            });
            setTabData((current) => ({ ...current, "personal-training": undefined }));
            setLoadingTabs((current) => ({ ...current, "personal-training": false }));
            setActionSuccess("Sessions generated from slot schedule for the next 30 days.");
          } catch (err) {
            setActionError(err instanceof Error ? err.message : "Failed to generate sessions.");
          }
        };

        const statusBadge = (status: string) => {
          const s = status?.toUpperCase();
          const map: Record<string, string> = {
            COMPLETED: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200",
            IN_PROGRESS: "border-blue-400/20 bg-blue-500/10 text-blue-200",
            SCHEDULED: "border-slate-400/20 bg-slate-500/10 text-slate-200",
            NO_SHOW: "border-rose-400/20 bg-rose-500/10 text-rose-200",
            CANCELLED: "border-orange-400/20 bg-orange-500/10 text-orange-200",
            RESCHEDULED: "border-purple-400/20 bg-purple-500/10 text-purple-200",
          };
          return map[s] || "border-slate-400/20 bg-slate-500/10 text-slate-200";
        };

        return (
          <div className="space-y-6">
            {/* Transformation bundle notice */}
            {isTransformationPlan ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-5 py-4">
                <p className="text-sm font-semibold text-amber-200">Transformation Package — Gym + PT Bundle</p>
                <p className="mt-1 text-xs text-amber-200/70">
                  This member&apos;s membership includes {(durationMonths || 0) * 13} PT sessions per month. Personal training is bundled with gym access.
                </p>
              </div>
            ) : null}

            {/* Assignment info */}
            <ProfilePanel title="Personal Training Assignment" accent="slate">
              {activePtAssignment ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatPill label="Coach" value={pickString(activeAssignRec!, ["coachEmail", "coachId"]) || "-"} />
                  <StatPill label="Training Type" value={humanizeLabel(pickString(activeAssignRec!, ["trainingType"]) || "PERSONAL_TRAINING")} />
                  <StatPill label="Start Date" value={formatDateOnly(pickString(activeAssignRec!, ["startDate"]))} />
                  <StatPill label="End Date" value={formatDateOnly(pickString(activeAssignRec!, ["endDate"])) || "Ongoing"} />
                  <StatPill label="Status" value={pickBoolean(activeAssignRec!, ["active"]) ? "Active" : "Inactive"} />
                </div>
              ) : (
                <p className="text-sm text-slate-400">No active PT assignment. Assign a trainer to start tracking sessions.</p>
              )}
            </ProfilePanel>

            {/* PT Slot Schedule */}
            {activeAssignId ? (
              <ProfilePanel title="Weekly Slot Schedule" subtitle="Assigned PT time slots for this member" accent="cyan">
                {sortedSlots.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {sortedSlots.map((slot, idx) => {
                      const slotRec = toRecord(slot);
                      return (
                        <div key={idx} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{humanizeLabel(pickString(slotRec, ["dayOfWeek"]) || "")}</p>
                            <p className="text-xs text-slate-400">
                              {pickString(slotRec, ["slotStartTime"]) || ""} — {pickString(slotRec, ["slotEndTime"]) || ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No slot schedule configured yet. Add time slots for automatic session generation.</p>
                )}
                {sortedSlots.length > 0 ? (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => void handleGenerateSessions()}
                      className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/20"
                    >
                      Generate Sessions (Next 30 Days)
                    </button>
                  </div>
                ) : null}
              </ProfilePanel>
            ) : null}

            {/* Session Summary */}
            {totalSessions > 0 ? (
              <ProfilePanel title="Session Tracker" subtitle="Session counts — NO_SHOW counts as consumed for member but NOT for trainer payment" accent="lime">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatPill label="Total PT Sessions" value={includedPtSessions > 0 ? String(includedPtSessions) : String(totalSessions)} />
                  <StatPill label="Total Recorded Sessions" value={String(totalSessions)} />
                  <StatPill label="Pending PT Sessions" value={String(pendingSessions)} />
                  <StatPill label="Client Show" value={String(completedSessions)} />
                  <StatPill label="Client No-Show" value={String(noShowSessions)} />
                  <StatPill label="Remaining Sessions" value={includedPtSessions > 0 ? String(remainingPtSessions) : "-"} />
                  <StatPill label="Cancelled" value={String(cancelledSessions)} />
                  <StatPill label="Trainer Counted" value={String(trainerCountedSessions)} />
                  <StatPill label="Member Consumed" value={String(memberConsumedSessions)} />
                </div>
                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Attendance Rate</span>
                    <span className="text-lg font-semibold text-white">{attendancePct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(attendancePct, 100)}%` }} />
                  </div>
                </div>
              </ProfilePanel>
            ) : null}

            {/* Session Register with Actions */}
            {totalSessions > 0 ? (
              <div ref={sessionRegisterRef}>
              <ProfilePanel title="Session Register" subtitle="All PT sessions — use actions to record attendance" accent="slate">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Slot</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Duration</th>
                        <th className="px-3 py-2">By</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ptSessions.map((s, idx) => {
                        const rec = toRecord(s);
                        const sessId = pickString(rec, ["id"]);
                        const sessStatus = (pickString(rec, ["status"]) || "SCHEDULED").toUpperCase();
                        const slotS = pickString(rec, ["slotStartTime", "sessionTime"]) || "";
                        const slotE = pickString(rec, ["slotEndTime"]) || "";
                        const actualStart = pickString(rec, ["actualStartTime"]) || "";
                        const dur = pickString(rec, ["durationMinutes"]) || "";
                        const startBy = pickString(rec, ["startedBy"]) || "";
                        return (
                          <tr key={idx} className="border-b border-white/5 hover:bg-white/[0.02]">
                            <td className="px-3 py-2.5 text-white">{formatDateOnly(pickString(rec, ["sessionDate"]))}</td>
                            <td className="px-3 py-2.5 text-slate-300">{slotS}{slotE ? ` - ${slotE}` : ""}</td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadge(sessStatus)}`}>
                                {sessStatus.replace("_", " ")}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-300">{actualStart ? formatDateTime(actualStart) : "-"}</td>
                            <td className="px-3 py-2.5 text-slate-300">{dur ? `${dur} min` : "-"}</td>
                            <td className="px-3 py-2.5 text-slate-400">{startBy || "-"}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex gap-1">
                                {sessStatus === "SCHEDULED" && sessId ? (
                                  <>
                                    <button type="button" onClick={() => void handleSessionAction(sessId, "start")}
                                      className="rounded-lg bg-blue-500/20 px-2 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-500/30">
                                      Start
                                    </button>
                                    <button type="button" onClick={() => void handleSessionAction(sessId, "no-show")}
                                      className="rounded-lg bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/30">
                                      No Show
                                    </button>
                                    <button type="button" onClick={() => void handleSessionAction(sessId, "cancel")}
                                      className="rounded-lg bg-orange-500/20 px-2 py-1 text-xs font-semibold text-orange-200 hover:bg-orange-500/30">
                                      Cancel
                                    </button>
                                  </>
                                ) : sessStatus === "IN_PROGRESS" && sessId ? (
                                  <button type="button" onClick={() => void handleSessionAction(sessId, "end")}
                                    className="rounded-lg bg-emerald-500/20 px-2 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30">
                                    End Session
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ProfilePanel>
              </div>
            ) : activePtAssignment ? (
              <div ref={sessionRegisterRef}>
              <ProfilePanel title="Session Register" accent="slate">
                <p className="text-sm text-slate-400">No sessions recorded yet. Configure slot schedule and generate sessions, or create sessions manually.</p>
              </ProfilePanel>
              </div>
            ) : null}

            {/* Action buttons */}
            {canShowPtActions ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openActionModal("pt")}
                  className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a71f23]"
                >
                  {activePtAssignment ? "Renew Personal Training" : "Assign Personal Training"}
                </button>
              </div>
            ) : null}
          </div>
        );
      }
      case "progress": {
        const data = tabData.progress;
        if (!data) return null;
        return (
          <div className="space-y-6">
            <ProfilePanel title="Progress Summary" accent="slate">
              <KeyValueGrid payload={data.summary} />
            </ProfilePanel>
            <ProfilePanel title="Measurements" accent="slate">
              <GenericTable items={data.measurements} emptyLabel="No measurements available." />
            </ProfilePanel>
            <ProfilePanel title="Photos" accent="slate">
              <GenericTable items={data.photos} emptyLabel="No progress photos available." />
            </ProfilePanel>
          </div>
        );
      }
      case "freeze-history":
        return (
          <ProfilePanel title="Freeze History" accent="slate">
            <GenericTable items={tabData["freeze-history"] || []} emptyLabel="No freeze history found." />
          </ProfilePanel>
        );
      case "notes": {
        const notes = tabData.notes;
        return (
          <div className="space-y-6">
            <ProfilePanel title="Enquiry Context" accent="slate">
              <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: "Enquiry Status", value: notes?.inquiryStatus || "-" },
                  { label: "Interested In", value: notes?.interestedIn || interestedIn },
                  { label: "Latest Follow-up Comment", value: notes?.latestFollowUpComment || "-" },
                  { label: "Source Enquiry", value: notes?.sourceInquiryId || (sourceInquiryId ? String(sourceInquiryId) : "-") },
                ].map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                    <dd className="mt-2 text-sm font-medium text-white">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </ProfilePanel>

            <div className="grid gap-6 xl:grid-cols-2">
              <ProfilePanel title="Comments" accent="slate">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Notes</p>
                    <p className="mt-2 text-sm text-slate-200">{notes?.inquiryNotes || "No enquiry notes available."}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Remarks</p>
                    <p className="mt-2 text-sm text-slate-200">{notes?.inquiryRemarks || "No remarks available."}</p>
                  </div>
                </div>
              </ProfilePanel>

              <ProfilePanel title="Follow-up History" accent="slate">
                <GenericTable
                  items={(notes?.followUps || []).map((item) => ({
                    dueAt: formatDateTime(item.dueAt),
                    channel: item.channel || "-",
                    status: item.status || "-",
                    notes: item.notes || item.customMessage || "-",
                  }))}
                  emptyLabel="No follow-up history available."
                />
              </ProfilePanel>
            </div>
          </div>
        );
      }
      case "audit-trail": {
        const auditEntries = tabData["audit-trail"] || [];
        return (
          <ProfilePanel title="Audit Trail" accent="slate">
            <GenericTable
              items={auditEntries.map((entry) => ({
                createdAt: formatDateTime(entry.createdAt),
                action: entry.action || "-",
                actor: entry.actorName || entry.actorId || "-",
                summary: entry.summary || "-",
              }))}
              emptyLabel="No profile audit entries available."
            />
          </ProfilePanel>
        );
      }
      case "fitness-assessment":
        return renderFitnessAssessment();
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-start">
        <button
          type="button"
          onClick={() => router.push("/portal/members")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back To Members
        </button>
      </div>

      {shellError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{shellError}</div> : null}
      {actionSuccess ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {actionSuccess}
        </div>
      ) : null}
      {loadingShell ? (
        <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading member profile...
        </div>
      ) : null}

      {!loadingShell && shell ? (
        <>
          <section className="overflow-hidden rounded-[32px] border border-white/8 bg-[#0d1016] shadow-[0_28px_100px_rgba(0,0,0,0.42)]">
            <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_left,_rgba(196,41,36,0.16),_transparent_32%),linear-gradient(135deg,#0d1016_0%,#151a23_52%,#0f1218_100%)] px-8 py-8">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-6">
                  <div className="flex h-28 w-28 items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.06] text-3xl font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    {initials(memberName) || "M"}
                  </div>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-4xl font-semibold tracking-tight text-white">{memberName}</h1>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusTone(membershipStatus)}`}>
                        {membershipStatus}
                      </span>
                    </div>
                    <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">
                      Member Code: {memberCode}
                    </p>
                    <p className="text-sm text-slate-300">
                      Client Rep: <span className="font-medium text-white">{clientRepName}</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <StatPill label="Join Date" value={formatDateOnly(joinDate)} />
                      <StatPill label="Last Attendance" value={formatDateTime(lastAttendance || undefined)} />
                      <StatPill label="Total Visits" value={String(totalVisits || 0)} />
                      <StatPill label="Home Branch" value={branchLabel} />
                    </div>
                  </div>
                </div>

                <div className="xl:w-[360px]">
                  <div className="mb-3 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => openActionModal("edit-profile")}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-100 hover:bg-white/[0.08]"
                      aria-label="Edit member profile"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Activity className="h-5 w-5 text-cyan-300" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Membership</p>
                          <p className="mt-1 text-base font-semibold text-white">{planName}</p>
                          <p className="mt-1 text-sm text-slate-400">{planDuration}</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Wallet className="h-5 w-5 text-[#c42924]" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Credits</p>
                          <p className="mt-1 text-base font-semibold text-white">{creditsBalance}</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                      <div className="flex items-center gap-3">
                        <CreditCard className="h-5 w-5 text-amber-300" />
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Payment Status</p>
                          <p className="mt-1 text-base font-semibold text-white">{humanizeLabel(paymentStatus)}</p>
                        </div>
                      </div>
                    </div>
                    {!isFlexPlan ? (
                      <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                        <div className="flex items-center gap-3">
                          <UserRound className="h-5 w-5 text-slate-300" />
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{trainerLabel}</p>
                            <p className="mt-1 text-base font-semibold text-white">{assignedTrainer}</p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
                      activeTab === tab.key
                        ? "bg-[#c42924] text-white shadow-[0_10px_30px_rgba(196,41,36,0.22)]"
                        : "border border-white/8 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {supportLoading ? <p className="mt-3 text-xs text-slate-400">Loading action catalogs and lookup data…</p> : null}
            </div>
          </section>

          {renderTab()}

          <Modal
            open={actionModal === "edit-profile"}
            onClose={() => setActionModal(null)}
            title="Edit Member Profile"
            size="lg"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setActionModal(null)}
                  className="rounded-xl border border-slate-700 bg-transparent px-4 py-2 text-sm font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleEditProfile()}
                  disabled={actionBusy}
                  className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionBusy ? "Saving..." : "Save Changes"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Full Name</span>
                  <input value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Mobile Number</span>
                  <div className="flex overflow-hidden rounded-xl border border-slate-200">
                    <select
                      value={editForm.mobileCountryCode}
                      onChange={(event) => setEditForm((current) => ({ ...current, mobileCountryCode: event.target.value }))}
                      className="border-r border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                    >
                      <option value="+91">+91</option>
                    </select>
                    <input
                      value={editForm.mobileNumber}
                      onChange={(event) => setEditForm((current) => ({ ...current, mobileNumber: normalizeIndianMobile(event.target.value) }))}
                      className="w-full px-3 py-2"
                    />
                  </div>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Email</span>
                  <input value={editForm.email} onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Alternate Mobile</span>
                  <input value={editForm.alternateMobileNumber} onChange={(event) => setEditForm((current) => ({ ...current, alternateMobileNumber: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Date Of Birth</span>
                  <input type="date" value={editForm.dateOfBirth} onChange={(event) => setEditForm((current) => ({ ...current, dateOfBirth: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Enquiry Date</span>
                  <input type="date" value={editForm.inquiryDate} onChange={(event) => setEditForm((current) => ({ ...current, inquiryDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Gender</span>
                  <input value={editForm.gender} onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Client Representative</span>
                  <select value={editForm.clientRepStaffId} onChange={(event) => setEditForm((current) => ({ ...current, clientRepStaffId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Client Rep</option>
                    {staffMembers.map((staff) => (
                      <option key={staff.id} value={staff.id}>{staff.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Address</span>
                  <textarea value={editForm.address} onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))} className="min-h-[96px] w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Name</span>
                  <input value={editForm.emergencyContactName} onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactName: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Phone</span>
                  <input value={editForm.emergencyContactPhone} onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Emergency Contact Relation</span>
                  <input value={editForm.emergencyContactRelation} onChange={(event) => setEditForm((current) => ({ ...current, emergencyContactRelation: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Home Branch</span>
                  <select value={editForm.defaultBranchId} onChange={(event) => setEditForm((current) => ({ ...current, defaultBranchId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Branch</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={String(branch.id)}>{branch.name}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Default Trainer</span>
                  <select value={editForm.defaultTrainerStaffId} onChange={(event) => setEditForm((current) => ({ ...current, defaultTrainerStaffId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Trainer</option>
                    {coaches.map((coach) => (
                      <option key={coach.id} value={coach.id}>{coach.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "freeze"}
            onClose={() => setActionModal(null)}
            title="Freeze Membership"
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handleFreeze()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : "Activate Freeze"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Freeze is available only when this membership has a pause benefit entitlement. Minimum freeze is {freezeMinDays} days and the maximum is the package allowance of {freezeMaxDays} days.
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Freeze Days</span>
                <input type="number" min={freezeMinDays} max={freezeMaxDays} value={freezeForm.freezeDays} onChange={(event) => setFreezeForm((current) => ({ ...current, freezeDays: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Reason</span>
                <textarea value={freezeForm.reason} onChange={(event) => setFreezeForm((current) => ({ ...current, reason: event.target.value }))} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
            </div>
          </Modal>

          <Modal
            open={actionModal === "renew" || actionModal === "upgrade"}
            onClose={() => setActionModal(null)}
            title={actionModal === "renew" ? "Renew Membership" : "Upgrade Membership"}
            size="lg"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button
                  type="button"
                  onClick={() => void handleSubscriptionAction((actionModal === "renew" ? "renew" : "upgrade") as "renew" | "upgrade")}
                  disabled={actionBusy}
                  className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionBusy ? "Processing..." : "Continue"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {actionModal === "renew"
                  ? "Renewal creates the next cycle for this membership. If the current membership is active, the renewed plan should start after the current expiry."
                    : "Upgrade applies the selected higher package or duration. The invoice is generated only for the difference between the existing sold membership value and the selected target plan."}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Category</span>
                  <select
                    value={lifecycleForm.categoryCode}
                    onChange={(event) => setLifecycleForm((current) => ({ ...current, categoryCode: event.target.value, productCode: "", productVariantId: "" }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <option value="">Select Category</option>
                    {lifecycleCategoryOptions.map((category) => (
                      <option key={category} value={category}>{humanizeLabel(category)}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Product</span>
                  <select
                    value={lifecycleForm.productCode}
                    onChange={(event) => setLifecycleForm((current) => ({ ...current, productCode: event.target.value, productVariantId: "" }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <option value="">Select Product</option>
                    {filteredLifecycleProducts.map((product) => (
                      <option key={product.productId} value={product.productCode}>{product.productName}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Variant</span>
                  <select
                    value={lifecycleForm.productVariantId}
                    onChange={(event) => setLifecycleForm((current) => ({ ...current, productVariantId: event.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <option value="">Select Variant</option>
                    {filteredLifecycleVariants.map((variant) => (
                      <option key={variant.variantId} value={variant.variantId}>
                        {variant.variantName} · {variant.durationMonths > 0 ? `${variant.durationMonths} months` : `${variant.validityDays} days`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Start Date</span>
                  <input type="date" value={lifecycleForm.startDate} onChange={(event) => setLifecycleForm((current) => ({ ...current, startDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Due In Days</span>
                  <input type="number" min={1} value={lifecycleForm.dueInDays} onChange={(event) => setLifecycleForm((current) => ({ ...current, dueInDays: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="font-medium text-slate-700">Notes</span>
                  <textarea value={lifecycleForm.notes} onChange={(event) => setLifecycleForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
                </label>
              </div>
              <div className="rounded-2xl border border-white/8 bg-slate-900 px-4 py-4 text-sm text-slate-200">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Membership</p>
                    <p className="mt-2 text-base font-semibold text-white">{planName}</p>
                    <p className="mt-1 text-slate-300">{planDuration}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target Membership</p>
                    <p className="mt-2 text-base font-semibold text-white">
                      {selectedLifecycleVariant ? normalizeDisplayPlanName(selectedLifecycleVariant.variantName) : "Choose a target variant"}
                    </p>
                    <p className="mt-1 text-slate-300">
                      {selectedLifecycleVariant
                        ? `${formatPlanDuration(selectedLifecycleVariant.durationMonths, selectedLifecycleVariant.validityDays)} · ${formatInr(selectedLifecycleVariant.basePrice)}`
                        : "Invoice will be generated from the selected target variant once you continue."}
                    </p>
                  </div>
                </div>
                {selectedLifecycleVariant ? (
                  <div className="mt-4 space-y-3">
                    {actionModal === "upgrade" ? (
                      <p className="text-xs text-slate-400">
                        The portal is showing the catalog plan comparison below. Final upgrade billing is computed in the backend from the member&apos;s existing sold value and the selected target plan.
                      </p>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <StatPill label="Current Plan Price" value={formatRoundedInr(currentLifecycleBasePrice)} />
                      <StatPill label="Target Plan Price" value={formatRoundedInr(targetLifecycleBasePrice)} />
                      <StatPill label={actionModal === "upgrade" ? "Reference Base Difference" : "Taxable Amount"} value={formatRoundedInr(lifecycleTaxableAmount)} />
                      <StatPill label={`CGST (${commercialTaxRate / 2}%)`} value={formatRoundedInr(lifecycleHalfTaxAmount)} />
                      <StatPill label={`SGST (${commercialTaxRate / 2}%)`} value={formatRoundedInr(lifecycleHalfTaxAmount)} />
                      <StatPill label={actionModal === "upgrade" ? "Estimated Invoice Total" : "Invoice Total"} value={formatRoundedInr(lifecycleInvoiceTotal)} />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "transfer"}
            onClose={() => setActionModal(null)}
            title="Transfer Membership"
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handleTransfer()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Transferring..." : "Transfer"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Transfer is available only for eligible flagship memberships, and only to Admin or Gym Manager users. This action updates operational ownership only right now, without transfer billing.
              </div>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-slate-700">Target Enquiry</span>
                  <select value={transferForm.targetMemberId} onChange={(event) => setTransferForm((current) => ({ ...current, targetMemberId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                    <option value="">Select Enquiry</option>
                    {transferInquiryOptions.map((item) => (
                      <option key={item.inquiryId} value={String(item.memberId)}>
                        {item.fullName} · {item.mobileNumber} · Inquiry #{item.inquiryId}
                      </option>
                    ))}
                  </select>
                </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Start Date</span>
                <input type="date" value={transferForm.startDate} onChange={(event) => setTransferForm((current) => ({ ...current, startDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={transferForm.deactivateSource} onChange={(event) => setTransferForm((current) => ({ ...current, deactivateSource: event.target.checked }))} />
                Deactivate source membership
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={transferForm.copyUsage} onChange={(event) => setTransferForm((current) => ({ ...current, copyUsage: event.target.checked }))} />
                Copy usage history
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea value={transferForm.notes} onChange={(event) => setTransferForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
            </div>
          </Modal>

          <Modal
            open={actionModal === "pt"}
            onClose={() => setActionModal(null)}
            title={activePtAssignment ? "Renew Personal Training" : "Assign Personal Training"}
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handlePtAssignment()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Saving..." : activePtAssignment ? "Renew PT" : "Assign PT"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Personal training is handled as a separate PT workflow. This action creates or renews the operational PT assignment. PT commercial billing can be generated against the PT invoice flow.
              </div>
              {ptVariants.length > 0 ? (
                <>
                  {primaryMembershipDurationLimit > 0 ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      PT duration cannot exceed the primary membership duration of {primaryMembershipDurationLimit} month{primaryMembershipDurationLimit === 1 ? "" : "s"}.
                    </div>
                  ) : null}
                  <label className="space-y-2 text-sm">
                    <span className="font-medium text-slate-700">PT Product</span>
                    <select
                      value={ptForm.productCode}
                      onChange={(event) => setPtForm((current) => ({ ...current, productCode: event.target.value, productVariantId: "" }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2"
                    >
                      <option value="">Select PT Product</option>
                      {ptProducts.map((product) => (
                        <option key={product.productId} value={product.productCode}>{product.productName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium text-slate-700">PT Variant</span>
                    <select
                      value={ptForm.productVariantId}
                      onChange={(event) => setPtForm((current) => ({ ...current, productVariantId: event.target.value }))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2"
                    >
                      <option value="">Select PT Variant</option>
                      {selectablePtVariants.map((variant) => (
                          <option key={variant.variantId} value={variant.variantId}>
                            {variant.variantName} · {formatPlanDuration(variant.durationMonths, variant.validityDays)}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              ) : null}
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Assigned Coach</span>
                <select value={ptForm.coachId} onChange={(event) => setPtForm((current) => ({ ...current, coachId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                  <option value="">Select Coach</option>
                  {coaches.map((coach) => (
                    <option key={coach.id} value={coach.id}>{coach.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Start Date</span>
                <input type="date" value={ptForm.startDate} onChange={(event) => setPtForm((current) => ({ ...current, startDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">End Date</span>
                <input type="date" value={ptForm.endDate} onChange={(event) => setPtForm((current) => ({ ...current, endDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <div className="rounded-2xl border border-white/8 bg-slate-900 px-4 py-4 text-sm text-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">PT Preview</p>
                <p className="mt-2 text-base font-semibold text-white">
                  {selectedPtVariant ? normalizeDisplayPlanName(selectedPtVariant.variantName) : "Choose a PT plan if you want to tag the assignment to a PT variant"}
                </p>
                <p className="mt-1 text-slate-300">
                  {selectedPtVariant
                    ? `${formatPlanDuration(selectedPtVariant.durationMonths, selectedPtVariant.validityDays)} · ${formatInr(selectedPtVariant.basePrice)}`
                    : "Operational PT assignment can still be created even if PT billing is handled separately."}
                </p>
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "visit"}
            onClose={() => setActionModal(null)}
            title="Add Flex Visit"
            size="md"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button type="button" onClick={() => void handleAddVisit()} disabled={actionBusy} className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {actionBusy ? "Processing..." : "Add Visit"}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <StatPill label="Included Check-Ins" value={String(selectedIncludedCheckIns)} />
                <StatPill label="Used Check-Ins" value={String(selectedUsedCheckIns)} />
                <StatPill label="Remaining Check-Ins" value={String(selectedCheckInsRemaining)} />
                <StatPill label="Extra Visit Price" value={formatRoundedInr(selectedExtraVisitPrice)} />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                This creates an invoice and immediate receipt for one additional flex visit. Once payment succeeds, the check-in allowance increases by one and attendance is unlocked again.
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Payment Mode</span>
                <select value={visitForm.paymentMode} onChange={(event) => setVisitForm({ paymentMode: event.target.value })} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="UPI">UPI</option>
                  <option value="NET_BANKING">Net Banking</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
            </div>
          </Modal>

          <Modal
            open={actionModal === "biometric"}
            onClose={() => setActionModal(null)}
            title="Biometric & Access Actions"
            size="md"
          >
            <div className="space-y-4">
              {actionError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</div> : null}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Current state: <span className="font-semibold">{tabData["recovery-services"]?.status || "NOT_ADDED"}</span>
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Biometric Device</span>
                <select
                  value={selectedBiometricDeviceSerial}
                  onChange={(event) => setSelectedBiometricDeviceSerial(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2"
                >
                  <option value="">Select Device</option>
                  {availableBiometricDevices.map((device) => {
                    const serial = pickString(device, ["serialNumber"]);
                    return (
                      <option key={serial} value={serial}>
                        {pickString(device, ["deviceName"]) || serial} · {serial}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Notes</span>
                <textarea value={accessNotes} onChange={(event) => setAccessNotes(event.target.value)} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { action: "ADD_USER", label: "Add User" },
                  { action: "RE_ADD_USER", label: "Re-add User" },
                  { action: "BLOCK_USER", label: "Block User" },
                  { action: "UNBLOCK_USER", label: "Unblock User" },
                  { action: "DELETE_USER", label: "Delete User" },
                ].map((item) => (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => void handleAccessAction(item.action)}
                    disabled={actionBusy}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {actionBusy ? "Working..." : item.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                These actions now queue the corresponding ESSL device command for the selected branch device and then update the internal member access registry.
              </p>
            </div>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
