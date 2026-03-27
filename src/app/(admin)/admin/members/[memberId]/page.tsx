"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CreditCard,
  Loader2,
  Pencil,
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
import { CatalogProduct, CatalogVariant } from "@/lib/api/services/subscription-service";
import { ClientAssignmentRequest } from "@/lib/api/services/training-service";

type TabPayloadMap = {
  overview: MemberProfileShellResponse;
  subscriptions: {
    dashboard: Record<string, unknown>;
    entitlements: unknown[];
    history: unknown[];
  };
  billing: InvoiceSummary[];
  attendance: unknown[];
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
  | "biometric"
  | null;

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

function normalizeDisplayPlanName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") {
    return "No subscription is active";
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
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanEntitlementFeatureLabel(value?: string): string {
  if (!value) {
    return "-";
  }
  return humanizeLabel(
    value
      .replace(/_ACCESS$/i, "")
      .replace(/ ACCESS$/i, "")
      .replace(/_BENEFIT$/i, "_BENEFIT")
      .trim(),
  );
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
  const [assessmentActionBusy, setAssessmentActionBusy] = useState(false);
  const [documentBusyKey, setDocumentBusyKey] = useState<string | null>(null);
  const [memberRecord, setMemberRecord] = useState<UserDirectoryItem | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [coaches, setCoaches] = useState<UserDirectoryItem[]>([]);
  const [staffMembers, setStaffMembers] = useState<UserDirectoryItem[]>([]);
  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogVariants, setCatalogVariants] = useState<CatalogVariant[]>([]);
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
  const [accessNotes, setAccessNotes] = useState("");

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
      const [dashboard, entitlements] = await withTabTimeout(
        Promise.all([
          subscriptionService.getMemberDashboard(token, memberId),
          subscriptionService.getMemberEntitlements(token, memberId),
        ]),
        "subscriptions",
      );

      setTabData((current) => ({
        ...current,
        subscriptions: {
          dashboard: toRecord(dashboard),
          entitlements: toArray(entitlements),
          history: [],
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
        const [branchPage, coachRows, staffRows, memberRows, products, variants] = await Promise.all([
          branchService.listBranches(token, { page: 0, size: 100 }),
          usersService.searchUsers(token, { role: "COACH", active: true }),
          usersService.searchUsers(token, { role: "STAFF", active: true }),
          usersService.searchUsers(token, { role: "MEMBER", active: true }),
          subscriptionService.getCatalogProducts(token),
          subscriptionService.getCatalogVariants(token),
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
            const [attendance, accessState] = await withTabTimeout(
              Promise.all([
                engagementService.getAttendanceByMember(token, memberId),
                usersService.getMemberAccessState(token, memberId),
              ]),
              "attendance",
            );
            if (active) {
              setTabData((current) => ({ ...current, "recovery-services": accessState }));
            }
            payload = attendance;
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
              // For each active assignment, try to fetch sessions
              let ptSessions: unknown[] = [];
              const activeAssign = ptArr.find((a) => {
                const rec = toRecord(a);
                return pickBoolean(rec, ["active"]) === true;
              });
              if (activeAssign) {
                const assignId = pickString(toRecord(activeAssign), ["id", "assignmentId"]);
                if (assignId) {
                  try {
                    ptSessions = await trainingService.getPtSessionsByAssignment(token, assignId);
                  } catch {
                    ptSessions = [];
                  }
                }
              }
              payload = { assignments: ptArr, sessions: Array.isArray(ptSessions) ? ptSessions : [] };
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

  const viewDocumentPdf = async (type: "invoice" | "receipt", id: number | string, title: string) => {
    if (!token) {
      return;
    }

    const busyKey = `${type}-view-${id}`;
    setDocumentBusyKey(busyKey);
    try {
      const blob = type === "invoice"
        ? await subscriptionService.getInvoicePdf(token, id)
        : await subscriptionService.getReceiptPdf(token, id);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener,noreferrer");
      // Revoke after a delay to allow the new tab to load
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : `Unable to open ${type} document.`);
    } finally {
      setDocumentBusyKey(null);
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
  const paymentStatus = derivePaymentStatus(shellPaymentStatus, displayInvoiceStats.paid, displayInvoiceStats.balance);
  const balanceDue = displayInvoiceStats.balance;
  const roundedBalanceDue = Math.round(balanceDue);
  const ptTabData = tabData["personal-training"] as { assignments?: unknown[]; sessions?: unknown[] } | undefined;
  const ptAssignments = Array.isArray(ptTabData?.assignments) ? ptTabData.assignments : (Array.isArray(tabData["personal-training"]) ? tabData["personal-training"] as unknown[] : []);
  const ptSessions = Array.isArray(ptTabData?.sessions) ? ptTabData.sessions : [];
  const activePtAssignment = ptAssignments.find((item) => {
    const record = toRecord(item);
    return pickBoolean(record, ["active"]) === true;
  });
  const entitlementRecords = toArray<RecordLike>(tabData.subscriptions?.entitlements);
  const entitlementFeatures = entitlementRecords.map((entry) => String(entry.feature || "").toUpperCase());
  const hasFreezeEntitlement = entitlementFeatures.some((feature) =>
    feature === "PAUSE_BENEFIT" ||
    feature === "PAUSE_BENEFITS" ||
    feature === "PASS_BENEFIT" ||
    feature === "PASS_BENEFITS",
  );
  const normalizedProductCode = currentProductCode.toUpperCase();
  const normalizedCategoryCode = productCategoryCode.toUpperCase();
  const isGroupClassPlan = normalizedCategoryCode === "GROUP_CLASS";
  const isFlagshipPlan = normalizedCategoryCode === "FLAGSHIP";
  const isTransformationPlan = normalizedCategoryCode === "TRANSFORMATION";
  const isFlexPlan = normalizedProductCode.includes("FLEX") || rawPlanName.toUpperCase().includes("FLEX");
  const isPtPlan = normalizedCategoryCode === "PT" || normalizedProductCode.includes("PT");
  const hasMembershipSubscription = Boolean(activeSubscriptionId) && !isPtPlan;
  const upgradeWindowDays = deriveUpgradeWindowDays(durationMonths, validityDays);
  const subscriptionStartDate = startDate ? new Date(startDate) : null;
  const daysSinceSubscriptionStart =
    subscriptionStartDate && !Number.isNaN(subscriptionStartDate.getTime())
      ? Math.max(0, Math.floor((Date.now() - subscriptionStartDate.getTime()) / (24 * 60 * 60 * 1000)))
      : null;
  const upgradeWindowActive =
    daysSinceSubscriptionStart === null ? true : daysSinceSubscriptionStart <= upgradeWindowDays;
  const canManageTransfers =
    user?.role === "ADMIN" ||
    (user?.role === "STAFF" && user?.designation === "GYM_MANAGER");
  const canShowFreezeAction = hasMembershipSubscription && hasFreezeEntitlement && !isFlexPlan && !isGroupClassPlan;
  const canRenewMembership = hasMembershipSubscription;
  const canUpgradeMembership =
    hasMembershipSubscription &&
    (isFlagshipPlan || isGroupClassPlan || isFlexPlan || isTransformationPlan) &&
    upgradeWindowActive;
  const canDowngradeMembership =
    hasMembershipSubscription &&
    (isFlagshipPlan || isGroupClassPlan || isTransformationPlan) &&
    (!isGroupClassPlan || durationMonths > 1 || validityDays > 30);
  const canShowPtActions =
    Boolean(activePtAssignment) || isFlagshipPlan || isTransformationPlan;
  const canTransferMembership =
    hasMembershipSubscription &&
    canManageTransfers &&
    (
      isFlagshipPlan ||
      normalizedProductCode.includes("CORE") ||
      normalizedProductCode.includes("BLACK") ||
      normalizedProductCode.includes("RHYTHM")
    );
  const filteredLifecycleProducts = useMemo(
    () =>
      catalogProducts.filter((product) => {
        if (product.categoryCode === "PT" || product.categoryCode === "CREDIT_PACK") {
          return false;
        }

        const selectedCategory = lifecycleForm.categoryCode || productCategoryCode;
        if (selectedCategory && product.categoryCode !== selectedCategory) {
          return false;
        }

        if (actionModal === "upgrade") {
          if (isFlagshipPlan) {
            return product.categoryCode === "FLAGSHIP";
          }
          if (isFlexPlan) {
            return product.categoryCode === "FLAGSHIP" || product.productCode === currentProductCode;
          }
          if (isGroupClassPlan) {
            return product.productCode === currentProductCode;
          }
          if (isTransformationPlan) {
            return product.categoryCode === "TRANSFORMATION";
          }
        }

        if (actionModal === "downgrade") {
          if (isGroupClassPlan) {
            return product.productCode === currentProductCode;
          }
          if (isFlagshipPlan) {
            return product.categoryCode === "FLAGSHIP";
          }
          if (isTransformationPlan) {
            return product.categoryCode === "TRANSFORMATION";
          }
        }

        if (actionModal === "renew") {
          if (isGroupClassPlan) {
            return product.productCode === currentProductCode;
          }
          if (isFlexPlan) {
            return product.productCode === currentProductCode;
          }
          if (isFlagshipPlan) {
            return product.categoryCode === "FLAGSHIP";
          }
          if (isTransformationPlan) {
            return product.categoryCode === "TRANSFORMATION";
          }
        }

        return selectedCategory ? product.categoryCode === selectedCategory : true;
      }),
    [
      actionModal,
      catalogProducts,
      currentProductCode,
      isFlagshipPlan,
      isFlexPlan,
      isGroupClassPlan,
      isTransformationPlan,
      lifecycleForm.categoryCode,
      productCategoryCode,
    ],
  );
  const filteredLifecycleVariants = useMemo(
    () =>
      catalogVariants.filter((variant) => {
        if (variant.categoryCode === "PT" || variant.categoryCode === "CREDIT_PACK") {
          return false;
        }
        const selectedCategory = lifecycleForm.categoryCode || productCategoryCode;
        const selectedProduct = lifecycleForm.productCode || currentProductCode;

        if (selectedCategory && variant.categoryCode !== selectedCategory) {
          return false;
        }
        if (selectedProduct && variant.productCode !== selectedProduct) {
          return false;
        }

        const currentVariant = catalogVariants.find((item) => String(item.variantId) === String(activeProductVariantId));
        const currentDuration = currentVariant?.durationMonths || durationMonths;
        const currentValidity = currentVariant?.validityDays || validityDays;

        if (actionModal === "upgrade") {
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return variant.durationMonths > currentDuration;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return variant.validityDays > currentValidity;
          }
        }

        if (actionModal === "downgrade") {
          if (currentDuration > 0 && variant.durationMonths > 0) {
            return variant.durationMonths < currentDuration;
          }
          if (currentValidity > 0 && variant.validityDays > 0) {
            return variant.validityDays < currentValidity;
          }
        }

        return true;
      }),
    [
      actionModal,
      activeProductVariantId,
      catalogVariants,
      currentProductCode,
      durationMonths,
      lifecycleForm.categoryCode,
      lifecycleForm.productCode,
      productCategoryCode,
      validityDays,
    ],
  );
  const lifecycleCategoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogProducts
            .filter((product) => {
              if (product.categoryCode === "PT" || product.categoryCode === "CREDIT_PACK") {
                return false;
              }
              if (actionModal === "upgrade") {
                if (isFlagshipPlan) return product.categoryCode === "FLAGSHIP";
                if (isFlexPlan) return product.categoryCode === "FLAGSHIP";
                if (isGroupClassPlan) return product.categoryCode === "GROUP_CLASS";
                if (isTransformationPlan) return product.categoryCode === "TRANSFORMATION";
              }
              if (actionModal === "downgrade") {
                if (isFlagshipPlan) return product.categoryCode === "FLAGSHIP";
                if (isGroupClassPlan) return product.categoryCode === "GROUP_CLASS";
                if (isTransformationPlan) return product.categoryCode === "TRANSFORMATION";
                return false;
              }
              if (actionModal === "renew") {
                if (isFlagshipPlan) return product.categoryCode === "FLAGSHIP";
                if (isFlexPlan) return product.categoryCode === "FLEX";
                if (isGroupClassPlan) return product.categoryCode === "GROUP_CLASS";
                if (isTransformationPlan) return product.categoryCode === "TRANSFORMATION";
              }
              return product.categoryCode === productCategoryCode;
            })
            .map((product) => product.categoryCode),
        ),
      ),
    [actionModal, catalogProducts, isFlagshipPlan, isFlexPlan, isGroupClassPlan, isTransformationPlan, productCategoryCode],
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
  const selectedPtVariant = useMemo(
    () => ptVariants.find((variant) => String(variant.variantId) === String(ptForm.productVariantId)),
    [ptForm.productVariantId, ptVariants],
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
    if (modal === "renew" || modal === "upgrade" || modal === "downgrade") {
      const defaultLifecycleCategory =
        modal === "upgrade" && isFlexPlan
          ? "FLAGSHIP"
          : productCategoryCode || "";
      setLifecycleForm({
        categoryCode: defaultLifecycleCategory,
        productCode: modal === "upgrade" && isFlexPlan ? "" : currentProductCode || "",
        productVariantId: modal === "upgrade" && isFlexPlan ? "" : activeProductVariantId || "",
        startDate:
          modal === "renew"
            ? (expiryDate ? new Date(new Date(expiryDate).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
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
        freezeDays: "7",
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
    if (modal === "biometric") {
      setAccessNotes("");
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

  const handleSubscriptionAction = async (action: "renew" | "upgrade" | "downgrade") => {
    if (!token || !memberId || !lifecycleForm.productVariantId) {
      setActionError("Choose a target variant before continuing.");
      return;
    }
    if (action === "upgrade" && !canUpgradeMembership) {
      setActionError(`Upgrade is allowed only within ${upgradeWindowDays} day${upgradeWindowDays === 1 ? "" : "s"} of the current subscription start.`);
      return;
    }
    if (action === "downgrade" && !canDowngradeMembership) {
      setActionError("Downgrade is not available for this subscription.");
      return;
    }
    if (action === "renew" && !canRenewMembership) {
      setActionError("Renewal is not available for this subscription.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      const payload = {
        productVariantId: Number(lifecycleForm.productVariantId),
        startDate: lifecycleForm.startDate || undefined,
        dueInDays: lifecycleForm.dueInDays ? Number(lifecycleForm.dueInDays) : undefined,
        notes: lifecycleForm.notes || undefined,
      };

      if (action === "renew") {
        await subscriptionService.renewSubscription(token, memberId, payload);
      } else if (action === "upgrade") {
        await subscriptionService.upgradeSubscription(token, memberId, payload);
      } else {
        await subscriptionService.downgradeSubscription(token, memberId, payload);
      }

      await reloadShell();
      setActionSuccess(`Subscription ${action} completed.`);
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : `Unable to ${action} subscription.`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleTransfer = async () => {
    if (!token || !activeSubscriptionId || !transferForm.targetMemberId) {
      setActionError("Choose the target member before transferring.");
      return;
    }
    if (!canTransferMembership) {
      setActionError("Transfer is allowed only for eligible flagship subscriptions and authorized users.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await subscriptionService.transferSubscription(token, activeSubscriptionId, {
        targetMemberId: Number(transferForm.targetMemberId),
        startDate: transferForm.startDate || undefined,
        deactivateSource: transferForm.deactivateSource,
        copyUsage: transferForm.copyUsage,
        notes: transferForm.notes || undefined,
      });
      await reloadShell();
      setActionSuccess("Subscription transferred.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to transfer subscription.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleFreeze = async () => {
    if (!token || !memberId) {
      return;
    }
    if (!canShowFreezeAction) {
      setActionError("Freeze is not available for this subscription.");
      return;
    }

    const freezeDays = Number(freezeForm.freezeDays);
    if (!Number.isFinite(freezeDays) || freezeDays < 7 || freezeDays > 28) {
      setActionError("Freeze days must be between 7 and 28.");
      return;
    }

    setActionBusy(true);
    setActionError(null);
    try {
      await engagementService.activateFreeze(token, memberId, {
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

  const handlePtAssignment = async () => {
    if (!token || !memberId || !ptForm.coachId || !email) {
      setActionError("Choose a coach and make sure the member email is available.");
      return;
    }
    if (!canShowPtActions) {
      setActionError("Personal training is not available for this subscription.");
      return;
    }

    const coach = coaches.find((item) => item.id === ptForm.coachId);
    if (!coach?.email) {
      setActionError("Selected coach does not have an email configured.");
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

    setActionBusy(true);
    setActionError(null);
    try {
      const nextState = await usersService.applyMemberAccessAction(token, memberId, {
        action,
        notes: accessNotes || undefined,
      });
      setTabData((current) => ({ ...current, "recovery-services": nextState, "audit-trail": undefined }));
      setActionSuccess("Member access state updated.");
      setActionModal(null);
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : "Unable to update member access.");
    } finally {
      setActionBusy(false);
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfilePanel
          title="Membership Summary"
          accent="lime"
        >
          <div className="space-y-4">
            <div>
              <p className="text-4xl font-semibold tracking-tight text-white">{planName}</p>
              <p className="mt-2 text-sm text-slate-300">Category: {humanizeLabel(productCategoryCode)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatPill label="Subscription Status" value={humanizeLabel(membershipStatus)} />
              <StatPill label="Duration" value={planDuration} />
              <StatPill label="Start Date" value={formatDateOnly(startDate)} />
              <StatPill label="Expiry Date" value={formatDateOnly(expiryDate)} />
              {!isFlexPlan ? <StatPill label={trainerLabel} value={assignedTrainer} /> : null}
              <StatPill label="Home Branch" value={branchLabel} />
            </div>
          </div>
        </ProfilePanel>

        <ProfilePanel
          title="Billing Summary"
          subtitle="Latest payment and invoice context"
          accent={balanceDue > 0 ? "rose" : "cyan"}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatPill label="Payment Status" value={humanizeLabel(paymentStatus)} />
            <StatPill label="Amount Paid" value={formatInr(displayInvoiceStats.paid)} />
            <StatPill label="Balance Due" value={formatRoundedInr(displayInvoiceStats.balance)} />
            <StatPill label="Billing Rep" value={billingRepName} />
          </div>
        </ProfilePanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2.1fr)_360px]">
        <ProfilePanel title="Personal Details" subtitle="Core member identity and contact information" accent="slate">
          <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Mobile Number", value: phone || "-" },
              { label: "Email Address", value: email || "-" },
              { label: "Date Of Birth", value: formatDateOnly(dateOfBirth || undefined) },
              { label: "Date Of Enquiry", value: formatDateTime(inquiryDate || undefined) },
              { label: "Client Representative", value: clientRepName },
              { label: "Billing Representative", value: billingRepName },
              ...(!isFlexPlan ? [{ label: trainerLabel, value: assignedTrainer }] : []),
              { label: "Interested In", value: interestedIn },
              { label: "Emergency Contact", value: emergencyContact },
              { label: "Referral Source", value: referredBy },
              { label: "Member Code", value: memberCode },
              { label: "Home Branch", value: branchLabel },
            ].map((entry) => (
              <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                <dd className="mt-2 text-base font-medium text-white">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </ProfilePanel>

        <ProfilePanel title="Alerts" subtitle="Only active items that need attention" accent={alerts.length ? "rose" : "slate"}>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-300">No active alerts for this member.</p>
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
                  <th className="px-4 py-3">Actions</th>
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
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void viewDocumentPdf("invoice", invoice.id, `Invoice ${invoice.invoiceNumber}`)}
                          disabled={documentBusyKey === `invoice-view-${invoice.id}`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          View Invoice
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadDocumentPdf("invoice", invoice.id, invoice.invoiceNumber)}
                          disabled={documentBusyKey === `invoice-download-${invoice.id}`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Download Invoice
                        </button>
                        <button
                          type="button"
                          onClick={() => void shareDocumentPdf("invoice", invoice.id, invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber}`)}
                          disabled={documentBusyKey === `invoice-share-${invoice.id}`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                        >
                          Share Invoice
                        </button>
                        {invoice.receiptNumber && invoice.receiptId ? (() => {
                          const receiptId = invoice.receiptId;
                          const receiptNumber = invoice.receiptNumber;
                          return (
                          <>
                            <button
                              type="button"
                              onClick={() => void viewDocumentPdf("receipt", receiptId, `Receipt ${receiptNumber}`)}
                              disabled={documentBusyKey === `receipt-view-${receiptId}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              View Receipt
                            </button>
                            <button
                              type="button"
                              onClick={() => void downloadDocumentPdf("receipt", receiptId, receiptNumber)}
                              disabled={documentBusyKey === `receipt-download-${receiptId}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              Download Receipt
                            </button>
                            <button
                              type="button"
                              onClick={() => void shareDocumentPdf("receipt", receiptId, receiptNumber, `Receipt ${receiptNumber}`)}
                              disabled={documentBusyKey === `receipt-share-${receiptId}`}
                              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              Share Receipt
                            </button>
                          </>
                          );
                        })() : null}
                      </div>
                    </td>
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
        const recentInvoice = toRecord(toRecord(data.dashboard).recentInvoice);
        const entitlementFeatureRows = toArray<RecordLike>(data.entitlements).map((entry) => ({
          feature: cleanEntitlementFeatureLabel(pickString(entry, ["feature"]) || "-"),
        }));
        return (
          <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <ProfilePanel title="Current Membership" subtitle="Active subscription and current eligibility" accent="lime">
                <div className="space-y-4">
                  <div>
                    <p className="text-3xl font-semibold tracking-tight text-white">{planName}</p>
                    <p className="mt-2 text-sm text-slate-300">Category: {humanizeLabel(productCategoryCode)}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <StatPill label="Subscription Status" value={humanizeLabel(pickString(data.dashboard, ["subscriptionStatus"]) || membershipStatus)} />
                    <StatPill label="Duration" value={planDuration} />
                    <StatPill label="Start Date" value={formatDateOnly(pickString(data.dashboard, ["startDate"]) || startDate || undefined)} />
                    <StatPill label="Expiry Date" value={formatDateOnly(pickString(data.dashboard, ["expiryDate"]) || expiryDate || undefined)} />
                    <StatPill label="Branch" value={branchLabel} />
                    {!isFlexPlan && assignedTrainer !== "-" ? (
                      <StatPill label={trainerLabel} value={assignedTrainer} />
                    ) : null}
                  </div>
                </div>
              </ProfilePanel>
              <ProfilePanel title="Membership Actions" subtitle="Only the actions available for this subscription are shown here" accent="slate">
                <div className="flex flex-wrap gap-2">
                  {canShowFreezeAction ? (
                    <button
                      type="button"
                      onClick={() => openActionModal("freeze")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Freeze
                    </button>
                  ) : null}
                  {canRenewMembership ? (
                    <button
                      type="button"
                      onClick={() => openActionModal("renew")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Renew
                    </button>
                  ) : null}
                  {canUpgradeMembership ? (
                    <button
                      type="button"
                      onClick={() => openActionModal("upgrade")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Upgrade
                    </button>
                  ) : null}
                  {canDowngradeMembership ? (
                    <button
                      type="button"
                      onClick={() => openActionModal("downgrade")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Downgrade
                    </button>
                  ) : null}
                  {canTransferMembership ? (
                    <button
                      type="button"
                      onClick={() => openActionModal("transfer")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      Transfer
                    </button>
                  ) : null}
                  {canShowPtActions ? (
                    <button
                      type="button"
                      onClick={() => openActionModal("pt")}
                      className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.08]"
                    >
                      {activePtAssignment ? "Renew Personal Training" : "Add Personal Training"}
                    </button>
                  ) : null}
                </div>
              </ProfilePanel>
            </div>
            <div className={`grid gap-6 ${isGroupClassPlan ? "xl:grid-cols-1" : "xl:grid-cols-2"}`}>
              <ProfilePanel title="Recent Commercial Record" subtitle="Latest invoice and receipt linked to this membership" accent="slate">
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatPill label="Latest Invoice" value={pickString(recentInvoice, ["invoiceNumber"]) || shellLatestInvoiceNumber || "-"} />
                  <StatPill label="Latest Receipt" value={shellLatestReceiptNumber || "-"} />
                  <StatPill label="Invoice Status" value={humanizeLabel(pickString(recentInvoice, ["status"]) || shellPaymentStatus || "-")} />
                  <StatPill label="Issued At" value={formatDateOnly(pickString(recentInvoice, ["issuedAt"]) || undefined)} />
                  <StatPill label="Invoice Total" value={formatInr(pickNumber(recentInvoice, ["total"]) || displayInvoiceStats.total)} />
                  <StatPill label="Balance Due" value={formatRoundedInr(displayInvoiceStats.balance)} />
                </div>
              </ProfilePanel>
              {!isGroupClassPlan ? (
                <ProfilePanel title="Active Entitlements" subtitle="Live benefits attached to the current subscription" accent="cyan">
                  {entitlementFeatureRows.length === 0 ? (
                    <p className="text-sm text-slate-300">No active entitlements found.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {entitlementFeatureRows.map((entry) => (
                        <span
                          key={entry.feature}
                          className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-sm font-medium text-cyan-100"
                        >
                          {entry.feature}
                        </span>
                      ))}
                    </div>
                  )}
                </ProfilePanel>
              ) : null}
            </div>
          </div>
        );
      }
      case "billing":
        return renderBilling();
      case "attendance":
        return (
          <div className="space-y-6">
            <ProfilePanel title="Attendance Timeline" subtitle="Check-ins and check-outs" accent="slate">
              <GenericTable items={tabData.attendance || []} emptyLabel="No attendance records available." />
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
        const cancelledSessions = ptSessions.filter((s) => {
          const status = pickString(toRecord(s), ["status"])?.toUpperCase();
          return status === "CANCELLED" || status === "CANCELED";
        }).length;
        const totalSessions = ptSessions.length;
        const attendancePct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

        return (
          <div className="space-y-6">
            <ProfilePanel title="Personal Training Assignments" accent="slate">
              <GenericTable items={ptAssignments} emptyLabel="No PT assignments available." />
            </ProfilePanel>

            {totalSessions > 0 ? (
              <>
                <ProfilePanel title="Session Summary" subtitle="Overview of PT session progress" accent="lime">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StatPill label="Total Sessions" value={String(totalSessions)} />
                    <StatPill label="Completed" value={String(completedSessions)} />
                    <StatPill label="Scheduled" value={String(scheduledSessions)} />
                    <StatPill label="Attendance %" value={`${attendancePct}%`} />
                  </div>
                </ProfilePanel>

                <ProfilePanel title="Session Register" subtitle="Detailed log of all PT sessions" accent="slate">
                  <GenericTable items={ptSessions} emptyLabel="No sessions recorded yet." />
                </ProfilePanel>
              </>
            ) : activePtAssignment ? (
              <ProfilePanel title="Session Register" accent="slate">
                <p className="text-sm text-slate-400">No sessions recorded yet for this assignment.</p>
              </ProfilePanel>
            ) : null}

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
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Plan</p>
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
                          <p className="mt-1 text-base font-semibold text-white">{paymentStatus}</p>
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
            title="Freeze Subscription"
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
                Freeze is available only when this subscription has a pause benefit entitlement. This action extends the membership by the approved freeze days and does not use credits in phase 1.
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Freeze Days</span>
                <input type="number" min={7} max={28} value={freezeForm.freezeDays} onChange={(event) => setFreezeForm((current) => ({ ...current, freezeDays: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Reason</span>
                <textarea value={freezeForm.reason} onChange={(event) => setFreezeForm((current) => ({ ...current, reason: event.target.value }))} className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
            </div>
          </Modal>

          <Modal
            open={actionModal === "renew" || actionModal === "upgrade" || actionModal === "downgrade"}
            onClose={() => setActionModal(null)}
            title={actionModal === "renew" ? "Renew Subscription" : actionModal === "upgrade" ? "Upgrade Subscription" : "Downgrade Subscription"}
            size="lg"
            footer={
              <>
                <button type="button" onClick={() => setActionModal(null)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Cancel</button>
                <button
                  type="button"
                  onClick={() => void handleSubscriptionAction((actionModal === "renew" ? "renew" : actionModal === "upgrade" ? "upgrade" : "downgrade") as "renew" | "upgrade" | "downgrade")}
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
                  ? "Renewal creates the next cycle for this membership. If the current subscription is active, the renewed plan should start after the current expiry."
                  : actionModal === "upgrade"
                    ? `Upgrade is immediate and allowed only within ${upgradeWindowDays} day${upgradeWindowDays === 1 ? "" : "s"} of the current subscription start. A billing invoice should be generated for the commercial difference.`
                    : "Downgrade is scheduled for the next cycle. The member continues on the current package until the active subscription ends."}
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
                  <span className="font-medium text-slate-700">{actionModal === "downgrade" ? "Effective Date" : "Start Date"}</span>
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
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Plan</p>
                    <p className="mt-2 text-base font-semibold text-white">{planName}</p>
                    <p className="mt-1 text-slate-300">{planDuration}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Target Plan</p>
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
              </div>
            </div>
          </Modal>

          <Modal
            open={actionModal === "transfer"}
            onClose={() => setActionModal(null)}
            title="Transfer Subscription"
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
                Transfer is available only for eligible flagship subscriptions, and only to Admin or Gym Manager users. A transfer fee and a fresh invoice can be applied in the billing workflow.
              </div>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Target Member</span>
                <select value={transferForm.targetMemberId} onChange={(event) => setTransferForm((current) => ({ ...current, targetMemberId: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2">
                  <option value="">Select Member</option>
                  {members.filter((item) => item.id !== memberId).map((item) => (
                    <option key={item.id} value={item.id}>{item.name} · {item.mobile}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Start Date</span>
                <input type="date" value={transferForm.startDate} onChange={(event) => setTransferForm((current) => ({ ...current, startDate: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2" />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={transferForm.deactivateSource} onChange={(event) => setTransferForm((current) => ({ ...current, deactivateSource: event.target.checked }))} />
                Deactivate source subscription
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
                      {ptVariants
                        .filter((variant) => !ptForm.productCode || variant.productCode === ptForm.productCode)
                        .map((variant) => (
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
                These actions update the member access registry and audit trail now, so the member profile has a consistent operational record even before a direct biometric vendor sync is connected.
              </p>
            </div>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
