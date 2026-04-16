"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2, Plus } from "lucide-react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import {
  BranchMembersDirectoryFilter,
  BranchMembersDirectoryResponse,
} from "@/types/admin";

const MEMBERS_PAGE_SIZE = 20;
const MEMBER_FILTERS: BranchMembersDirectoryFilter[] = ["ALL", "ACTIVE", "EXPIRED", "IRREGULAR", "PT", "NON_PT"];

const EMPTY_MEMBER_DIRECTORY: BranchMembersDirectoryResponse = {
  summary: {
    activeMembers: 0,
    expiredMembers: 0,
    irregularMembers: 0,
    ptClients: 0,
  },
  members: {
    content: [],
    number: 0,
    size: MEMBERS_PAGE_SIZE,
    totalElements: 0,
    totalPages: 1,
    first: true,
    last: true,
    empty: true,
    numberOfElements: 0,
  },
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function csvEscape(value: string | number): string {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes("\"") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

export default function MembersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = useAuth();

  const branchFromQuery = searchParams.get("branchId");
  const selectedBranchFilterId = branchFromQuery || undefined;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState<BranchMembersDirectoryFilter>("ALL");
  const [page, setPage] = useState(0);
  const [directory, setDirectory] = useState<BranchMembersDirectoryResponse>(EMPTY_MEMBER_DIRECTORY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => {
      window.clearTimeout(handle);
    };
  }, [search]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await branchService.getGlobalMembersDirectory(token, {
          branchId: selectedBranchFilterId,
          query: debouncedSearch || undefined,
          filter: memberFilter,
          page,
          size: MEMBERS_PAGE_SIZE,
        });

        if (!active) {
          return;
        }

        setDirectory(response);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load member directory.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedSearch, memberFilter, page, selectedBranchFilterId, token]);

  const onExportCsv = async () => {
    if (!token) {
      return;
    }

    setExporting(true);
    try {
      const exportResult = await branchService.getGlobalMembersDirectory(token, {
        branchId: selectedBranchFilterId,
        query: debouncedSearch || undefined,
        filter: memberFilter,
        page: 0,
        size: 1000,
      });

      const header = [
        "branchId",
        "branchName",
        "memberId",
        "fullName",
        "mobileNumber",
        "activePlan",
        "attendancePercent",
        "memberStatus",
        "paymentStatus",
        "outstandingAmount",
        "ptClient",
      ];
      const rows = exportResult.members.content.map((member) => [
        csvEscape(member.branchId),
        csvEscape(member.branchName),
        csvEscape(member.memberId),
        csvEscape(member.fullName),
        csvEscape(member.mobileNumber),
        csvEscape(member.activePlan),
        csvEscape(clampPercent(member.attendancePercent)),
        csvEscape(member.memberStatus),
        csvEscape(member.paymentStatus),
        csvEscape(member.outstandingAmount),
        csvEscape(member.ptClient ? "true" : "false"),
      ]);

      const csv = [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", `members-${selectedBranchFilterId || "all"}-${memberFilter.toLowerCase()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (exportError) {
      setError(exportError instanceof ApiError ? exportError.message : "Unable to export members.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminPageFrame
      title="Member Directory"
      description={selectedBranchFilterId ? `Branch ${selectedBranchFilterId} member directory` : "All branches member directory"}
      searchPlaceholder="Search by name or phone..."
      searchValue={search}
      onSearchChange={(value) => {
        setPage(0);
        setSearch(value);
      }}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onExportCsv()}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/portal/members/add")}
            className="inline-flex items-center gap-1 rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
          >
            <Plus className="h-4 w-4" />
            New Member
          </button>
        </div>
      }
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard title="Active Members">
          <p className="text-2xl font-bold text-[#282828]">{directory.summary.activeMembers}</p>
        </SurfaceCard>
        <SurfaceCard title="Expired">
          <p className="text-2xl font-bold text-[#282828]">{directory.summary.expiredMembers}</p>
        </SurfaceCard>
        <SurfaceCard title="Irregular">
          <p className="text-2xl font-bold text-[#282828]">{directory.summary.irregularMembers}</p>
        </SurfaceCard>
        <SurfaceCard title="PT Clients">
          <p className="text-2xl font-bold text-[#282828]">{directory.summary.ptClients}</p>
        </SurfaceCard>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          {MEMBER_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setPage(0);
                setMemberFilter(value);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                memberFilter === value ? "bg-[#C42429] text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Attendance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {directory.members.content.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={7}>
                    No members found.
                  </td>
                </tr>
              ) : (
                directory.members.content.map((member) => {
                  const attendancePercent = clampPercent(member.attendancePercent);
                  return (
                    <tr key={member.memberId} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-700">{member.fullName || member.memberId}</p>
                        <p className="text-xs text-slate-500">{member.mobileNumber || "-"}</p>
                        <p className="text-xs text-slate-400">{member.gender || "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{member.branchName || "-"}</p>
                        <p className="text-xs text-slate-500">{member.branchId || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{member.activePlan || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${attendancePercent}%` }} />
                          </div>
                          <span className="text-xs text-slate-600">{attendancePercent}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{member.memberStatus || "-"}</td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{member.paymentStatus || "-"}</p>
                        <p className="text-xs text-slate-500">{formatInr(member.outstandingAmount || 0)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/members/${encodeURIComponent(member.memberId)}`)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          ⋮
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          <span>
            Page {directory.members.number + 1} of {Math.max(directory.members.totalPages, 1)} ({directory.members.totalElements} total)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={directory.members.first}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(directory.members.totalPages - 1, current + 1))}
              disabled={directory.members.last}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {loading ? <div className="text-sm text-slate-500">Loading member directory...</div> : null}
    </AdminPageFrame>
  );
}
