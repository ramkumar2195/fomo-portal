"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { ApiError } from "@/lib/api/http-client";
import { usersService } from "@/lib/api/services/users-service";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import {
  DashboardDrilldownEntityType,
  DashboardDrilldownMemberRow,
  DashboardDrilldownMetricKey,
  DashboardDrilldownRevenueRow,
  DashboardDrilldownStaffLikeRow,
  DashboardDrilldownSubscriptionRow,
  SuperAdminDashboardDrilldownResponse,
} from "@/types/models";

const DEFAULT_PAGE_SIZE = 20;

const EMPTY_DRILLDOWN: SuperAdminDashboardDrilldownResponse = {
  metricKey: "TOTAL_MEMBERS",
  entityType: "MEMBER",
  number: 0,
  size: DEFAULT_PAGE_SIZE,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
  content: [],
  warnings: [],
};

interface DashboardDrilldownModalProps {
  open: boolean;
  title: string;
  metricKey: DashboardDrilldownMetricKey;
  token: string | null;
  branchId?: number;
  onClose: () => void;
}

interface RenderedDrilldownRow {
  key: string;
  memberId?: string;
  cells: React.ReactNode[];
}

function openMemberProfile(memberId?: string, query?: string): void {
  const normalizedMemberId = String(memberId || "").trim();
  if (!normalizedMemberId) {
    return;
  }
  const suffix = query ? `?${query}` : "";
  window.location.assign(memberProfileHref(normalizedMemberId, query));
}

function memberProfileHref(memberId?: string, query?: string): string {
  const normalizedMemberId = String(memberId || "").trim();
  if (!normalizedMemberId) {
    return "#";
  }
  const suffix = query ? `?${query}` : "";
  return `/admin/members/${encodeURIComponent(normalizedMemberId)}${suffix}`;
}

function renderMemberIdentity(name: string, mobile: string, memberId?: string): React.ReactNode {
  const label = name || "Unnamed member";
  return (
    <>
      <div className="font-semibold">{label}</div>
      <div className="text-xs text-slate-500">{mobile || "-"}</div>
    </>
  );
}

function profileLinkedCell(
  key: string,
  className: string,
  memberId: string | undefined,
  children: React.ReactNode,
  query?: string,
): React.ReactNode {
  return <td key={key} className={className}>{children}</td>;
}

function formatBool(value?: boolean): string {
  return value ? "Yes" : "No";
}

function isPtMemberMetric(metricKey: DashboardDrilldownMetricKey): boolean {
  return metricKey === "PT_CLIENTS" || metricKey === "PT_ACTIVE_CLIENTS" || metricKey === "PT_INACTIVE_CLIENTS";
}

function renderMemberRows(rows: DashboardDrilldownMemberRow[], metricKey: DashboardDrilldownMetricKey): RenderedDrilldownRow[] {
  const ptMetric = isPtMemberMetric(metricKey);
  return rows.map((row) => ({
    key: row.memberId,
    memberId: row.memberId,
    cells: [
      profileLinkedCell("member", "px-4 py-3 text-slate-700", row.memberId, renderMemberIdentity(row.fullName, row.mobileNumber, undefined)),
      profileLinkedCell("branch", "px-4 py-3 text-slate-600", row.memberId, row.branchName || "-"),
      profileLinkedCell("plan", "px-4 py-3 text-slate-600", row.memberId, row.activePlan || "-"),
      profileLinkedCell("status", "px-4 py-3 text-slate-600", row.memberId, row.memberStatus || "-"),
      profileLinkedCell("payment", "px-4 py-3 text-slate-600", row.memberId, row.paymentStatus || "-"),
      profileLinkedCell("attendance", "px-4 py-3 text-slate-600", row.memberId, `${Math.round(row.attendancePercent || 0)}%`),
      ptMetric
        ? profileLinkedCell("trainer", "px-4 py-3 text-slate-600", row.memberId, row.assignedTrainerName || "-")
        : profileLinkedCell("pt", "px-4 py-3 text-slate-600", row.memberId, formatBool(row.ptClient)),
      profileLinkedCell("joined", "px-4 py-3 text-slate-600", row.memberId, formatDateTime(row.createdAt)),
      ptMetric ? (
        <td key="sessionRegister" className="px-4 py-3 text-slate-600">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openMemberProfile(row.memberId, "tab=personal-training&section=session-register");
            }}
            disabled={!row.memberId}
            title="Open session register"
            aria-label="Open session register"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </td>
      ) : null,
    ],
  })).map((row, index) => ({
    ...row,
    key: row.key || `member-row-${index}`,
  }));
}

function renderSubscriptionRows(rows: DashboardDrilldownSubscriptionRow[]): RenderedDrilldownRow[] {
  return rows.map((row) => ({
    key: row.subscriptionId,
    memberId: row.memberId,
    cells: [
      profileLinkedCell("member", "px-4 py-3 text-slate-700", row.memberId, renderMemberIdentity(row.memberName, row.mobileNumber, undefined)),
      profileLinkedCell("branch", "px-4 py-3 text-slate-600", row.memberId, row.branchName || "-"),
      profileLinkedCell("plan", "px-4 py-3 text-slate-600", row.memberId, row.planName || "-"),
      profileLinkedCell("status", "px-4 py-3 text-slate-600", row.memberId, row.status || "-"),
      profileLinkedCell("start", "px-4 py-3 text-slate-600", row.memberId, formatDateTime(row.startDate)),
      profileLinkedCell("end", "px-4 py-3 text-slate-600", row.memberId, formatDateTime(row.endDate)),
      profileLinkedCell("amount", "px-4 py-3 text-slate-600", row.memberId, formatCurrency(row.amount || 0)),
    ],
  })).map((row, index) => ({
    ...row,
    key: row.key || `subscription-row-${index}`,
  }));
}

function renderRevenueRows(rows: DashboardDrilldownRevenueRow[], metricKey: DashboardDrilldownMetricKey): RenderedDrilldownRow[] {
  const isPendingRevenue = metricKey === "PENDING_REVENUE";
  return rows.map((row, index) => ({
    key: `${row.invoiceId || "invoice"}-${row.receiptId || "receipt"}-${index}`,
    memberId: row.memberId,
    cells: [
      profileLinkedCell("member", "px-4 py-3 text-slate-700", row.memberId, renderMemberIdentity(row.memberName, row.mobileNumber, undefined)),
      profileLinkedCell("branch", "px-4 py-3 text-slate-600", row.memberId, row.branchName || "-"),
      profileLinkedCell("amount", "px-4 py-3 text-slate-600", row.memberId, formatCurrency(row.amount || 0)),
      profileLinkedCell("collectedAt", "px-4 py-3 text-slate-600", row.memberId, formatDateTime(row.collectedAt)),
      profileLinkedCell("paymentMode", "px-4 py-3 text-slate-600", row.memberId, row.paymentMode || "-"),
      profileLinkedCell("paymentStatus", "px-4 py-3 text-slate-600", row.memberId, row.paymentStatus ? row.paymentStatus.replace(/_/g, " ") : "-"),
      profileLinkedCell("invoice", "px-4 py-3 text-slate-600", row.memberId, (
        <>
          <div>{row.invoiceNumber || "-"}</div>
          <div className="text-xs text-slate-500">{row.invoiceId ? `ID ${row.invoiceId}` : "-"}</div>
        </>
      )),
      !isPendingRevenue ? profileLinkedCell("receipt", "px-4 py-3 text-slate-600", row.memberId, (
        <>
          <div>{row.receiptNumber || "-"}</div>
          <div className="text-xs text-slate-500">{row.receiptId ? `ID ${row.receiptId}` : "-"}</div>
        </>
      )) : null,
      isPendingRevenue ? <td key="actions" className="px-4 py-3 text-slate-600">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            const invoiceQuery = row.invoiceId ? `&collectBalanceInvoiceId=${encodeURIComponent(row.invoiceId)}` : "";
            openMemberProfile(row.memberId, `tab=billing${invoiceQuery}`);
          }}
          disabled={!row.memberId}
          title="Collect balance"
          className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Collect Balance
        </button>
      </td> : null,
    ].filter(Boolean),
  }));
}

function renderStaffLikeRows(rows: DashboardDrilldownStaffLikeRow[]): RenderedDrilldownRow[] {
  return rows.map((row) => ({
    key: row.id,
    cells: [
      <td key="name" className="px-4 py-3 text-slate-700">
        <div className="font-semibold">{row.fullName || "Unnamed user"}</div>
      </td>,
      <td key="mobile" className="px-4 py-3 text-slate-600">{row.mobileNumber || "-"}</td>,
      <td key="designation" className="px-4 py-3 text-slate-600">{row.designation || "-"}</td>,
      <td key="branch" className="px-4 py-3 text-slate-600">{row.branchName || "-"}</td>,
      <td key="employmentType" className="px-4 py-3 text-slate-600">{row.employmentType || "-"}</td>,
      <td key="dataScope" className="px-4 py-3 text-slate-600">{row.dataScope || "-"}</td>,
      <td key="active" className="px-4 py-3 text-slate-600">{row.active ? "Active" : "Inactive"}</td>,
    ],
  })).map((row, index) => ({
    ...row,
    key: row.key || `staff-like-row-${index}`,
  }));
}

function tableHeaders(entityType: DashboardDrilldownEntityType, metricKey: DashboardDrilldownMetricKey): string[] {
  switch (entityType) {
    case "MEMBER":
      return isPtMemberMetric(metricKey)
        ? ["Member", "Branch", "Plan", "Status", "Payment", "Attendance", "Trainer", "Joined", "Session Register"]
        : ["Member", "Branch", "Plan", "Status", "Payment", "Attendance", "PT", "Joined"];
    case "SUBSCRIPTION":
      return ["Member", "Branch", "Plan", "Status", "Start Date", "End Date", "Amount"];
    case "REVENUE":
      return metricKey === "PENDING_REVENUE"
        ? ["Member", "Branch", "Amount", "Due Date", "Payment Mode", "Payment Status", "Invoice", "Actions"]
        : ["Member", "Branch", "Amount", "Collected At", "Payment Mode", "Payment Status", "Invoice", "Receipt"];
    case "STAFF":
    case "COACH":
      return ["Name", "Mobile", "Designation", "Branch", "Employment Type", "Data Scope", "Active"];
    default:
      return [];
  }
}

export function DashboardDrilldownModal({
  open,
  title,
  metricKey,
  token,
  branchId,
  onClose,
}: DashboardDrilldownModalProps) {
  const router = useRouter();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SuperAdminDashboardDrilldownResponse>(EMPTY_DRILLDOWN);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebouncedSearch("");
      setPage(0);
      setData(EMPTY_DRILLDOWN);
      setError(null);
    }
  }, [open, metricKey]);

  useEffect(() => {
    if (!open || !token) {
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await usersService.getSuperAdminDashboardDrilldown(token, {
          metricKey,
          branchId,
          query: debouncedSearch || undefined,
          page,
          size: DEFAULT_PAGE_SIZE,
        });

        if (!active) {
          return;
        }

        setData(response);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load drilldown.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [branchId, debouncedSearch, metricKey, open, page, token]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, metricKey]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, open]);

  const headers = useMemo(() => tableHeaders(data.entityType, metricKey), [data.entityType, metricKey]);

  const rows = useMemo(() => {
    switch (data.entityType) {
      case "MEMBER":
        return renderMemberRows(data.content as DashboardDrilldownMemberRow[], metricKey);
      case "SUBSCRIPTION":
        return renderSubscriptionRows(data.content as DashboardDrilldownSubscriptionRow[]);
      case "REVENUE":
        return renderRevenueRows(data.content as DashboardDrilldownRevenueRow[], metricKey);
      case "STAFF":
      case "COACH":
        return renderStaffLikeRows(data.content as DashboardDrilldownStaffLikeRow[]);
      default:
        return [];
    }
  }, [data.content, data.entityType, metricKey]);
  const navigateToMemberProfile = useCallback((memberId?: string) => {
    const href = memberProfileHref(memberId);
    if (href === "#") {
      return;
    }
    router.push(href);
  }, [router]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 py-6"
      onClick={(event) => {
        if (event.target === overlayRef.current) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-sm font-medium text-slate-300">{Math.max(data.totalElements || 0, rows.length)} records</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 p-2 text-slate-300 transition hover:border-white/20 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <input
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none ring-red-500 transition focus:bg-white focus:ring-1"
            placeholder="Search records..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null}

          {data.warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {data.warnings.join(" | ")}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-4 py-3 text-left">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className={row.memberId ? "cursor-pointer transition hover:bg-slate-50" : ""}
                    onClick={() => {
                      if (!row.memberId) {
                        return;
                      }
                      navigateToMemberProfile(row.memberId);
                    }}
                  >
                    {row.cells}
                  </tr>
                ))}
                {!loading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(headers.length, 1)} className="px-4 py-10 text-center text-sm text-slate-500">
                      No records found for this card.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {loading ? "Loading records..." : `Showing ${rows.length} of ${data.totalElements || 0} records`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={loading || data.first}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-slate-500">
                Page {data.number + 1} of {Math.max(data.totalPages, 1)}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={loading || data.last}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
