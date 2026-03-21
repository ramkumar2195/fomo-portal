"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CreditCard,
  Loader2,
  Mail,
  Phone,
  UserRound,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatMemberCode } from "@/lib/inquiry-code";
import { FreezeHistoryEntry, InvoiceSummary } from "@/types/models";
import {
  MemberAssessmentHistoryEntry,
  MemberAssessmentStatusResponse,
  MemberFitnessFormPayload,
  MemberNotesResponse,
  MemberProfileShellResponse,
  MemberProfileTabKey,
} from "@/types/member-profile";

type TabPayloadMap = {
  overview: MemberProfileShellResponse;
  subscriptions: {
    dashboard: Record<string, unknown>;
    entitlements: Record<string, unknown>;
  };
  billing: InvoiceSummary[];
  attendance: unknown[];
  "credits-wallet": {
    wallet: Record<string, unknown>;
    ledger: Record<string, unknown>;
  };
  "recovery-services": null;
  "personal-training": unknown[];
  progress: {
    summary: Record<string, unknown>;
    measurements: unknown[];
    photos: unknown[];
  };
  "freeze-history": FreezeHistoryEntry[];
  notes: MemberNotesResponse;
  "fitness-assessment": {
    fitnessForm: MemberFitnessFormPayload;
    assessmentStatus: MemberAssessmentStatusResponse;
    assessmentHistory: MemberAssessmentHistoryEntry[];
  };
};

const TAB_ORDER: Array<{ key: MemberProfileTabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "subscriptions", label: "Subscriptions" },
  { key: "billing", label: "Billing" },
  { key: "attendance", label: "Attendance" },
  { key: "credits-wallet", label: "Credits & Wallet" },
  { key: "personal-training", label: "Personal Training" },
  { key: "freeze-history", label: "Freeze History" },
  { key: "notes", label: "Notes" },
  { key: "fitness-assessment", label: "Fitness Assessment" },
  { key: "progress", label: "Progress" },
  { key: "recovery-services", label: "Recovery Services" },
];

type RecordLike = Record<string, unknown>;

function toRecord(payload: unknown): RecordLike {
  return typeof payload === "object" && payload !== null ? (payload as RecordLike) : {};
}

function titleize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
    return "border-[#c42924] bg-[#c42924]/10 text-[#f3b7b5]";
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
        accumulator.latestStatus = invoice.status;
      }
      return accumulator;
    },
    {
      total: 0,
      paid: 0,
      balance: 0,
      latestInvoice: "",
      latestStatus: "",
      latestIssuedAt: "",
    },
  );
}

export default function MemberProfilePage() {
  const params = useParams<{ memberId: string }>();
  const router = useRouter();
  const memberId = params.memberId;
  const { token } = useAuth();

  const [shell, setShell] = useState<MemberProfileShellResponse | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [shellError, setShellError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MemberProfileTabKey>("overview");
  const [tabData, setTabData] = useState<Partial<TabPayloadMap>>({});
  const [loadingTabs, setLoadingTabs] = useState<Partial<Record<MemberProfileTabKey, boolean>>>({});
  const [tabErrors, setTabErrors] = useState<Partial<Record<MemberProfileTabKey, string>>>({});
  const [assessmentActionBusy, setAssessmentActionBusy] = useState(false);

  useEffect(() => {
    if (!token || !memberId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingShell(true);
      setShellError(null);

      try {
        const profile = await usersService.getMemberProfileShell(token, memberId);
        if (!active) {
          return;
        }
        setShell(profile);
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
    const serverTabs = shell?.tabs?.length
      ? shell.tabs.map((tab) => ({
          key: tab.key,
          label: tab.label || TAB_ORDER.find((item) => item.key === tab.key)?.label || titleize(tab.key),
        }))
      : TAB_ORDER;

    const seen = new Set<MemberProfileTabKey>();
    return serverTabs.filter((tab) => {
      if (seen.has(tab.key)) {
        return false;
      }
      seen.add(tab.key);
      return true;
    });
  }, [shell]);

  useEffect(() => {
    if (!token || !memberId || !shell) {
      return;
    }

    if (tabData[activeTab] !== undefined || loadingTabs[activeTab]) {
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
          case "subscriptions": {
            const [dashboard, entitlements] = await Promise.all([
              subscriptionService.getMemberDashboard(token, memberId),
              subscriptionService.getMemberEntitlements(token, memberId),
            ]);
            payload = { dashboard: toRecord(dashboard), entitlements: toRecord(entitlements) };
            break;
          }
          case "billing":
            payload = (await subscriptionService.getInvoiceRegister(token, { memberId })) as InvoiceSummary[];
            break;
          case "attendance":
            payload = await engagementService.getAttendanceByMember(token, memberId);
            break;
          case "credits-wallet": {
            const [wallet, ledger] = await Promise.all([
              engagementService.getCreditsWallet(token, memberId),
              engagementService.getCreditsLedger(token, memberId),
            ]);
            payload = { wallet: toRecord(wallet), ledger: toRecord(ledger) };
            break;
          }
          case "recovery-services":
            payload = null;
            break;
          case "personal-training":
            payload = await trainingService.getMemberAssignments(token, memberId);
            break;
          case "progress": {
            const [summary, measurements, photos] = await Promise.all([
              engagementService.getMemberProgressSummary(token, memberId),
              engagementService.getMemberProgressMeasurements(token, memberId),
              engagementService.getMemberProgressPhotos(token, memberId),
            ]);
            payload = { summary: toRecord(summary), measurements, photos };
            break;
          }
          case "freeze-history":
            payload = await engagementService.getFreezeHistory(token, memberId);
            break;
          case "notes":
            payload = await usersService.getMemberNotes(token, memberId);
            break;
          case "fitness-assessment": {
            const [fitnessForm, assessmentStatus, assessmentHistory] = await Promise.all([
              usersService.getMemberFitnessForm(token, memberId),
              trainingService.getMemberAssessmentStatus(token, memberId),
              trainingService.getMemberAssessments(token, memberId),
            ]);
            payload = { fitnessForm, assessmentStatus, assessmentHistory };
            break;
          }
          default:
            payload = null;
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
  }, [activeTab, loadingTabs, memberId, shell, tabData, token]);

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
    return [shell.summary, shell.overview, shell.raw];
  }, [shell]);

  const memberName = shell?.fullName || `Member #${memberId}`;
  const membershipStatus = pickFromSourcesString([shell?.status, ...shellSources], [
    "status",
    "membershipStatus",
    "subscriptionStatus",
  ]) || "Unknown";
  const planName = pickFromSourcesString(shellSources, [
    "activePlan",
    "planName",
    "currentPlan",
    "variantName",
    "subscriptionName",
  ]) || "-";
  const joinDate = pickFromSourcesString(shellSources, ["joinDate", "createdAt", "onboardedAt", "memberSince"]);
  const lastAttendance = pickFromSourcesString(shellSources, [
    "lastAttendance",
    "lastCheckIn",
    "lastVisitAt",
    "lastAttendanceAt",
  ]);
  const totalVisits = pickFromSourcesNumber(shellSources, ["totalVisits", "checkIns", "totalCheckIns", "visitCount"]);
  const assignedTrainer = pickFromSourcesString(shellSources, [
    "assignedTrainerName",
    "trainerName",
    "coachName",
    "defaultTrainerName",
  ]) || "-";
  const expiryDate = pickFromSourcesString(shellSources, ["expiryDate", "endDate", "subscriptionEnd", "activeTill"]);
  const renewalWindowDays = daysUntil(expiryDate);
  const creditsBalance = pickFromSourcesNumber(shellSources, ["credits", "creditBalance", "availableCredits", "walletBalance"]);
  const paymentStatus = pickFromSourcesString(shellSources, ["paymentStatus", "invoicePaymentStatus"]) || "-";
  const branchLabel = shell?.branchName || shell?.branchId || "-";
  const sourceInquiryId = pickFromSourcesNumber(shellSources, ["sourceInquiryId", "inquiryId", "leadId"]);
  const branchCode = pickFromSourcesString(shellSources, ["branchCode"]);
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
  const emergencyContact = pickFromSourcesString(shellSources, [
    "emergencyContactName",
    "emergencyName",
    "emergencyContact",
  ]) || "-";
  const referredBy = pickFromSourcesString(shellSources, ["referralSource", "source", "leadSource", "sourceName"]) || "-";

  const overviewBilling = tabData.billing || [];
  const invoiceStats = extractInvoiceStats(overviewBilling);
  const balanceDue = invoiceStats.balance;

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
    if (balanceDue > 0) {
      next.push(`Outstanding billing balance of ${formatInr(balanceDue)} requires collection.`);
    }
    if (assignedTrainer === "-") {
      next.push("Trainer is not assigned yet.");
    }
    return next;
  }, [assignedTrainer, balanceDue, membershipStatus, renewalWindowDays]);

  const renderOverview = () => (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2.15fr)_360px]">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <ProfilePanel
            title="Current Plan"
            subtitle="Primary membership and renewal context"
            accent="lime"
          >
            <div className="space-y-4">
              <div>
                <p className="text-4xl font-semibold tracking-tight text-white">{planName}</p>
                <p className="mt-2 text-sm text-slate-300">Status: {membershipStatus}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatPill label="Start Date" value={formatDateOnly(pickFromSourcesString(shellSources, ["startDate", "subscriptionStart", "activeFrom"]))} />
                <StatPill label="Expiry Date" value={formatDateOnly(expiryDate)} />
              </div>
            </div>
          </ProfilePanel>

          <ProfilePanel
            title="Billing Snapshot"
            subtitle="Live invoice and payment view"
            accent={balanceDue > 0 ? "rose" : "cyan"}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <StatPill label="Payment Status" value={paymentStatus} />
              <StatPill label="Invoice Status" value={invoiceStats.latestStatus || "-"} />
              <StatPill label="Amount Paid" value={formatInr(invoiceStats.paid)} />
              <StatPill label="Balance Due" value={formatInr(invoiceStats.balance)} />
            </div>
            <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-slate-300">
              Latest invoice: <span className="font-semibold text-white">{invoiceStats.latestInvoice || "-"}</span>
            </div>
          </ProfilePanel>
        </div>

        <ProfilePanel title="Attendance & Engagement" subtitle="Current behavior snapshot" accent="slate">
          <div className="grid gap-3 md:grid-cols-3">
            <StatPill label="Last Attendance" value={formatDateTime(lastAttendance || undefined)} />
            <StatPill label="Total Visits" value={String(totalVisits || 0)} />
            <StatPill label="Assigned Trainer" value={assignedTrainer} />
          </div>
        </ProfilePanel>

        <ProfilePanel title="Personal Details" subtitle="Core contact and source information" accent="slate">
          <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Email Address", value: email || "-" },
              { label: "Phone Number", value: phone || "-" },
              { label: "Home Branch", value: branchLabel },
              { label: "Emergency Contact", value: emergencyContact },
              { label: "Referral Source", value: referredBy },
              { label: "Member Code", value: memberCode },
            ].map((entry) => (
              <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                <dd className="mt-2 text-base font-medium text-white">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </ProfilePanel>
      </div>

      <div className="space-y-6">
        <ProfilePanel title="Alerts" subtitle="Actionable items for this member" accent={alerts.length ? "rose" : "slate"}>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-300">No immediate alerts for this member.</p>
          ) : (
            <div className="space-y-3">
              {alerts.map((entry) => (
                <div key={entry} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-sm text-slate-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>{entry}</span>
                </div>
              ))}
            </div>
          )}
        </ProfilePanel>

        <ProfilePanel title="Credits Snapshot" subtitle="Wallet and credit usage" accent="cyan">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Available Credits</p>
              <p className="mt-3 text-5xl font-semibold tracking-tight text-[#f3b7b5]">{creditsBalance}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatPill label="Branch" value={branchLabel} />
              <StatPill label="Member Status" value={membershipStatus} />
            </div>
          </div>
        </ProfilePanel>

        <ProfilePanel title="Member Context" subtitle="Fast reference summary" accent="slate">
          <div className="space-y-3 text-sm text-slate-300">
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <Phone className="h-4 w-4 text-slate-400" />
              <span>{phone || "-"}</span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <Mail className="h-4 w-4 text-slate-400" />
              <span>{email || "-"}</span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <Building2 className="h-4 w-4 text-slate-400" />
              <span>{branchLabel}</span>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <BadgeCheck className="h-4 w-4 text-slate-400" />
              <span>{assignedTrainer}</span>
            </div>
          </div>
        </ProfilePanel>
      </div>
    </div>
  );

  const renderBilling = () => {
    const invoices = tabData.billing || [];
    const stats = extractInvoiceStats(invoices);

    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Total Invoiced", value: formatInr(stats.total), icon: <CreditCard className="h-5 w-5 text-cyan-300" /> },
            { label: "Collected", value: formatInr(stats.paid), icon: <BadgeCheck className="h-5 w-5 text-[#c42924]" /> },
            { label: "Outstanding", value: formatInr(stats.balance), icon: <AlertTriangle className="h-5 w-5 text-amber-300" /> },
            { label: "Latest Invoice", value: stats.latestInvoice || "-", icon: <CalendarDays className="h-5 w-5 text-slate-300" /> },
          ].map((entry) => (
            <ProfilePanel key={entry.label} title={entry.label} accent="slate">
              <div className="flex items-center justify-between gap-3">
                <p className="text-2xl font-semibold text-white">{entry.value}</p>
                {entry.icon}
              </div>
            </ProfilePanel>
          ))}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6">
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3 text-slate-200">{formatInr(invoice.amount)}</td>
                    <td className="px-4 py-3 text-slate-200">{formatInr(invoice.paidAmount || 0)}</td>
                    <td className="px-4 py-3 text-slate-200">{formatInr(invoice.balanceAmount || 0)}</td>
                    <td className="px-4 py-3 text-slate-200">{invoice.receiptNumber || "-"}</td>
                    <td className="px-4 py-3 text-slate-200">{invoice.status}</td>
                    <td className="px-4 py-3 text-slate-200">{formatDateTime(invoice.issuedAt)}</td>
                  </tr>
                ))}
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

    if (tabError) {
      return <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{tabError}</div>;
    }

    if (tabLoading) {
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
        return (
          <div className="grid gap-6 xl:grid-cols-2">
            <ProfilePanel title="Subscription Dashboard" accent="lime">
              <KeyValueGrid payload={data.dashboard} />
            </ProfilePanel>
            <ProfilePanel title="Entitlements" accent="cyan">
              <KeyValueGrid payload={data.entitlements} />
            </ProfilePanel>
          </div>
        );
      }
      case "billing":
        return renderBilling();
      case "attendance":
        return (
          <ProfilePanel title="Attendance Timeline" subtitle="Check-ins and check-outs" accent="slate">
            <GenericTable items={tabData.attendance || []} emptyLabel="No attendance records available." />
          </ProfilePanel>
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
        return (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
            Recovery services API is pending.
          </div>
        );
      case "personal-training":
        return (
          <ProfilePanel title="Personal Training" accent="slate">
            <GenericTable items={tabData["personal-training"] || []} emptyLabel="No PT assignments available." />
          </ProfilePanel>
        );
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
          <ProfilePanel title="Notes" accent="slate">
            {notes && notes.items.length > 0 ? (
              <div className="space-y-3">
                {notes.items.map((item, index) => (
                  <div key={`note-${index}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <KeyValueGrid payload={item} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
                No notes available.
              </div>
            )}
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
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/admin/members")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back To Members
        </button>
        <Link
          href="/portal/renewals"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          <CalendarDays className="h-4 w-4" />
          Open Renewals
        </Link>
      </div>

      {shellError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{shellError}</div> : null}
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
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <StatPill label="Join Date" value={formatDateOnly(joinDate)} />
                      <StatPill label="Last Attendance" value={formatDateTime(lastAttendance || undefined)} />
                      <StatPill label="Total Visits" value={String(totalVisits || 0)} />
                      <StatPill label="Home Branch" value={branchLabel} />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:w-[340px]">
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Activity className="h-5 w-5 text-cyan-300" />
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Plan</p>
                        <p className="mt-1 text-base font-semibold text-white">{planName}</p>
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
                        <p className="mt-1 text-base font-semibold text-white">{paymentStatus}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <UserRound className="h-5 w-5 text-slate-300" />
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Trainer</p>
                        <p className="mt-1 text-base font-semibold text-white">{assignedTrainer}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="flex flex-wrap gap-2">
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
            </div>
          </section>

          {renderTab()}
        </>
      ) : null}
    </div>
  );
}
