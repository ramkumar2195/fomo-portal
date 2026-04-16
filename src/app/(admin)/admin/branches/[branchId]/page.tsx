"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BarChart3, Users, UserSquare2, UserStar } from "lucide-react";
import { LineChart } from "@/components/admin/charts";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import {
  BranchCapacityResponse,
  BranchMembersDirectoryFilter,
  BranchMembersDirectoryResponse,
  BranchCurrentCheckInsResponse,
  BranchOverviewResponse,
  BranchProgramSummary,
  BranchResponse,
  BranchRevenueResponse,
} from "@/types/admin";
import { UserDirectoryItem } from "@/types/models";
import { SpringPage } from "@/types/pagination";

type BranchTab = "overview" | "members" | "people" | "revenue" | "programs";

const TABS: Array<{ key: BranchTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "people", label: "People" },
  { key: "revenue", label: "Revenue" },
  { key: "programs", label: "Programs" },
];

const EMPTY_BRANCH: BranchResponse = {
  id: 0,
  name: "",
  address: "",
  city: "",
  managerId: null,
  capacity: 0,
  activeMembers: 0,
  active: true,
};

const EMPTY_OVERVIEW: BranchOverviewResponse = {
  branchId: 0,
  branchName: "",
  branchCode: "",
  city: "",
  managerId: null,
  capacity: 0,
  activeMembers: 0,
  availableSlots: 0,
  occupancyRate: 0,
  totalMembers: 0,
  totalCoaches: 0,
  totalStaff: 0,
  totalPrograms: 0,
  activePrograms: 0,
  todayCheckIns: 0,
  currentlyCheckedIn: 0,
  totalInquiries: 0,
  convertedInquiries: 0,
  openInquiries: 0,
  followUpsDueToday: 0,
  followUpsOverdue: 0,
  invoicesIssued: 0,
  invoicesPaid: 0,
  totalInvoiced: 0,
  totalCollected: 0,
  totalOutstanding: 0,
  warnings: [],
};

const EMPTY_REVENUE: BranchRevenueResponse = {
  totalCollected: 0,
  totalOutstanding: 0,
  averageInvoiceValue: 0,
  points: [],
};

const EMPTY_CAPACITY: BranchCapacityResponse = {
  capacity: 0,
  activeMembers: 0,
  utilizationPercent: 0,
  availableSlots: 0,
};

const EMPTY_DIRECTORY_PAGE: SpringPage<UserDirectoryItem> = {
  content: [],
  number: 0,
  size: 8,
  totalElements: 0,
  totalPages: 1,
  first: true,
  last: true,
  empty: true,
  numberOfElements: 0,
};

const EMPTY_PROGRAM_PAGE: SpringPage<BranchProgramSummary> = {
  content: [],
  number: 0,
  size: 8,
  totalElements: 0,
  totalPages: 1,
  first: true,
  last: true,
  empty: true,
  numberOfElements: 0,
};

const EMPTY_CURRENT_CHECK_INS: BranchCurrentCheckInsResponse = {
  todayCheckIns: 0,
  currentlyCheckedIn: 0,
  records: [],
  warnings: [],
};

const MEMBER_FILTERS: BranchMembersDirectoryFilter[] = ["ALL", "ACTIVE", "EXPIRED", "IRREGULAR", "PT", "NON_PT"];
const MEMBERS_PAGE_SIZE = 20;

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

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function toLocalDateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  return {
    from: toLocalDateInput(from),
    to: toLocalDateInput(now),
  };
}

function formatTimestamp(value?: string): string {
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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function csvEscape(value: string | number): string {
  const normalized = String(value ?? "");
  if (normalized.includes(",") || normalized.includes("\"") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

export default function BranchDetailPage() {
  const router = useRouter();
  const params = useParams<{ branchId: string }>();
  const branchId = params.branchId;
  const { token } = useAuth();
  const defaultDateRange = useMemo(() => getDefaultDateRange(), []);

  const [activeTab, setActiveTab] = useState<BranchTab>("overview");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [memberFilter, setMemberFilter] = useState<BranchMembersDirectoryFilter>("ALL");
  const [membersPageIndex, setMembersPageIndex] = useState(0);
  const fromDate = defaultDateRange.from;
  const toDate = defaultDateRange.to;
  const programStatus = "ALL";
  const [programPageIndex, setProgramPageIndex] = useState(0);
  const [coachPageIndex, setCoachPageIndex] = useState(0);
  const [staffPageIndex, setStaffPageIndex] = useState(0);

  const [branch, setBranch] = useState<BranchResponse>(EMPTY_BRANCH);
  const [overview, setOverview] = useState<BranchOverviewResponse>(EMPTY_OVERVIEW);
  const [revenue, setRevenue] = useState<BranchRevenueResponse>(EMPTY_REVENUE);
  const [capacity, setCapacity] = useState<BranchCapacityResponse>(EMPTY_CAPACITY);
  const [memberDirectory, setMemberDirectory] = useState<BranchMembersDirectoryResponse>(EMPTY_MEMBER_DIRECTORY);
  const [coachesPage, setCoachesPage] = useState<SpringPage<UserDirectoryItem>>(EMPTY_DIRECTORY_PAGE);
  const [staffPage, setStaffPage] = useState<SpringPage<UserDirectoryItem>>(EMPTY_DIRECTORY_PAGE);
  const [programsPage, setProgramsPage] = useState<SpringPage<BranchProgramSummary>>(EMPTY_PROGRAM_PAGE);
  const [currentCheckIns, setCurrentCheckIns] = useState<BranchCurrentCheckInsResponse>(EMPTY_CURRENT_CHECK_INS);

  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingMembersDirectory, setLoadingMembersDirectory] = useState(true);
  const [loadingPrograms, setLoadingPrograms] = useState(true);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [exportingMembersCsv, setExportingMembersCsv] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => {
      window.clearTimeout(handle);
    };
  }, [search]);

  useEffect(() => {
    if (!token || !branchId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingSummary(true);
      setError(null);

      try {
        const [branchData, branchOverview, branchRevenue, branchCapacity, checkIns] = await Promise.all([
          branchService.getBranch(token, branchId),
          branchService.getBranchOverview(token, branchId, {
            from: fromDate || undefined,
            to: toDate || undefined,
          }),
          branchService.getBranchRevenue(token, branchId, {
            from: fromDate || undefined,
            to: toDate || undefined,
          }),
          branchService.getBranchCapacity(token, branchId),
          branchService.getBranchCurrentCheckIns(token, branchId),
        ]);

        if (!active) {
          return;
        }

        setBranch(branchData);
        setOverview(branchOverview);
        setRevenue(branchRevenue);
        setCapacity(branchCapacity);
        setCurrentCheckIns(checkIns);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load branch detail.");
      } finally {
        if (active) {
          setLoadingSummary(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [branchId, fromDate, toDate, token]);

  useEffect(() => {
    if (!token || !branchId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingMembersDirectory(true);
      try {
        const directory = await branchService.getBranchMembersDirectory(token, branchId, {
          query: debouncedSearch || undefined,
          filter: memberFilter,
          page: membersPageIndex,
          size: MEMBERS_PAGE_SIZE,
        });

        if (!active) {
          return;
        }

        setMemberDirectory(directory);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load member directory.");
      } finally {
        if (active) {
          setLoadingMembersDirectory(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [branchId, debouncedSearch, memberFilter, membersPageIndex, token]);

  useEffect(() => {
    if (!token || !branchId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingEmployees(true);
      try {
        const [coaches, staff] = await Promise.all([
          branchService.getBranchCoaches(token, branchId, {
            query: debouncedSearch || undefined,
            page: coachPageIndex,
            size: 8,
          }),
          branchService.getBranchStaff(token, branchId, {
            query: debouncedSearch || undefined,
            page: staffPageIndex,
            size: 8,
          }),
        ]);

        if (!active) {
          return;
        }

        setCoachesPage(coaches);
        setStaffPage(staff);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load branch employees.");
      } finally {
        if (active) {
          setLoadingEmployees(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [branchId, coachPageIndex, debouncedSearch, staffPageIndex, token]);

  useEffect(() => {
    if (!token || !branchId) {
      return;
    }

    let active = true;

    (async () => {
      setLoadingPrograms(true);
      setError(null);

      try {
        const page = await branchService.getBranchProgramsPaged(token, branchId, {
          page: programPageIndex,
          size: 8,
          status: programStatus !== "ALL" ? programStatus : undefined,
        });

        if (!active) {
          return;
        }

        setProgramsPage(page);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load branch programs.");
      } finally {
        if (active) {
          setLoadingPrograms(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [branchId, programPageIndex, programStatus, token]);

  const revenueLabels = useMemo(() => {
    if (!revenue.points.length) {
      return ["Collected", "Outstanding"];
    }
    return revenue.points.map((point, index) => point.label || `Point ${index + 1}`);
  }, [revenue.points]);

  const revenueSeries = useMemo(
    () => [
      {
        name: "Collected",
        color: "#C42429",
        values: revenue.points.length
          ? revenue.points.map((point) => point.collected || point.amount || 0)
          : [revenue.totalCollected, revenue.totalOutstanding],
      },
      {
        name: "Outstanding",
        color: "#0284c7",
        values: revenue.points.length ? revenue.points.map((point) => point.outstanding || 0) : [0, revenue.totalOutstanding],
      },
    ],
    [revenue.points, revenue.totalCollected, revenue.totalOutstanding],
  );

  const filteredCoaches = coachesPage.content;
  const filteredStaff = staffPage.content;

  const filteredPrograms = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return programsPage.content;
    }

    return programsPage.content.filter((program) => {
      const name = (program.name || "").toLowerCase();
      const trainer = (program.trainerName || "").toLowerCase();
      return name.includes(query) || trainer.includes(query);
    });
  }, [programsPage.content, search]);

  const onExportMembersCsv = async () => {
    if (!token || !branchId) {
      return;
    }

    setExportingMembersCsv(true);
    try {
      const exportResult = await branchService.getBranchMembersDirectory(token, branchId, {
        query: debouncedSearch || undefined,
        filter: memberFilter,
        page: 0,
        size: 1000,
      });

      const header = ["memberId", "fullName", "mobileNumber", "activePlan", "attendancePercent", "memberStatus", "paymentStatus"];
      const rows = exportResult.members.content.map((member) => [
        csvEscape(member.memberId),
        csvEscape(member.fullName),
        csvEscape(member.mobileNumber),
        csvEscape(member.activePlan),
        csvEscape(clampPercent(member.attendancePercent)),
        csvEscape(member.memberStatus),
        csvEscape(member.paymentStatus),
      ]);

      const csv = [header.join(","), ...rows.map((row) => row.join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.setAttribute("download", `branch-${branchId}-members-${memberFilter.toLowerCase()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (exportError) {
      setError(exportError instanceof ApiError ? exportError.message : "Unable to export members CSV.");
    } finally {
      setExportingMembersCsv(false);
    }
  };

  return (
    <AdminPageFrame
      title={branch.name || `Branch ${branchId}`}
      description={`${branch.managerName || "Manager unavailable"}${
        branch.address ? ` • ${branch.address}` : ""
      }`}
      searchPlaceholder="Search member, trainer, staff, or program..."
      searchValue={search}
      onSearchChange={(value) => {
        setMembersPageIndex(0);
        setCoachPageIndex(0);
        setStaffPageIndex(0);
        setSearch(value);
      }}
      action={
        <button
          type="button"
          onClick={() => router.push("/admin/branches")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back To Branches
        </button>
      }
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {overview.warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {overview.warnings.join(" | ")}
        </div>
      ) : null}
      {currentCheckIns.warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {currentCheckIns.warnings.join(" | ")}
        </div>
      ) : null}

      <section className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              activeTab === tab.key ? "bg-[#C42429] text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === "overview" ? (
        <section className="space-y-4">
          <section className="grid gap-4 xl:grid-cols-12">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Members</p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">Total members</p>
                    <p className="mt-2 text-4xl font-bold text-[#282828]">{overview.totalMembers || overview.activeMembers}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {overview.activeMembers} active
                  </span>
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Occupancy</p>
                  <p className="mt-2 text-2xl font-bold text-[#282828]">
                    {Math.round(overview.occupancyRate || capacity.utilizationPercent || 0)}%
                  </p>
                  <span className="mt-2 inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                    {overview.availableSlots} slots open
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Branch capacity</p>
                  <p className="mt-2 text-2xl font-bold text-[#282828]">{capacity.capacity || overview.capacity || 0}</p>
                  <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {capacity.activeMembers || overview.activeMembers} filled
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Revenue</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Collected</p>
                  <p className="mt-3 text-3xl font-bold text-[#282828]">{formatInr(overview.totalCollected)}</p>
                  <div className="mt-4 h-2 rounded-full bg-slate-200">
                    <div
                      className="h-2 rounded-full bg-[#C42429]"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            overview.totalCollected > 0
                              ? (overview.totalCollected / Math.max(overview.totalInvoiced || overview.totalCollected, 1)) * 100
                              : 0,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Outstanding</p>
                  <p className="mt-3 text-3xl font-bold text-[#282828]">{formatInr(overview.totalOutstanding)}</p>
                  <span className="mt-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                    Avg invoice {formatInr(revenue.averageInvoiceValue)}
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Invoices issued</p>
                  <p className="mt-2 text-2xl font-bold text-[#282828]">{overview.invoicesIssued}</p>
                  <span className="mt-2 inline-flex rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                    {overview.invoicesPaid} paid
                  </span>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Total invoiced</p>
                  <p className="mt-2 text-2xl font-bold text-[#282828]">{formatInr(overview.totalInvoiced)}</p>
                  <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Window total
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Team & Enquiries</p>
              <div className="mt-4 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Total staff</p>
                    <p className="mt-2 text-2xl font-bold text-[#282828]">{overview.totalStaff}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-500">Total coaches</p>
                    <p className="mt-2 text-2xl font-bold text-[#282828]">{overview.totalCoaches}</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-500">Open enquiries</p>
                      <p className="mt-2 text-3xl font-bold text-[#282828]">{overview.openInquiries}</p>
                    </div>
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                      {overview.followUpsOverdue} overdue
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Converted</p>
                      <p className="mt-1 text-xl font-bold text-[#282828]">{overview.convertedInquiries}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-ups today</p>
                      <p className="mt-1 text-xl font-bold text-[#282828]">{overview.followUpsDueToday}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-4">
            <SurfaceCard title="Today Check-ins">
              <p className="text-2xl font-bold text-[#282828]">{currentCheckIns.todayCheckIns || overview.todayCheckIns}</p>
            </SurfaceCard>
            <SurfaceCard title="Currently Checked In">
              <p className="text-2xl font-bold text-[#282828]">{currentCheckIns.currentlyCheckedIn || overview.currentlyCheckedIn}</p>
            </SurfaceCard>
            <SurfaceCard title="Invoices">
              <p className="text-2xl font-bold text-[#282828]">{overview.invoicesIssued}</p>
              <p className="text-xs text-slate-500">Paid: {overview.invoicesPaid}</p>
            </SurfaceCard>
            <SurfaceCard title="Programs">
              <p className="text-2xl font-bold text-[#282828]">{overview.activePrograms}</p>
              <p className="text-xs text-slate-500">Total: {overview.totalPrograms}</p>
            </SurfaceCard>
          </div>

          <section className="lg:col-span-12 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Current Branch Presence</h2>
              <span className="text-xs text-slate-500">
                todayCheckIns: {currentCheckIns.todayCheckIns || overview.todayCheckIns} | currentlyCheckedIn:{" "}
                {currentCheckIns.currentlyCheckedIn || overview.currentlyCheckedIn}
              </span>
            </div>
            {currentCheckIns.records.length === 0 ? (
              <div className="px-4 py-4 text-sm text-slate-500">No members currently checked in</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      <th className="px-4 py-3">Check-in ID</th>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Mobile</th>
                      <th className="px-4 py-3">Gym ID</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Checked In</th>
                      <th className="px-4 py-3">Checked Out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {currentCheckIns.records.map((record) => (
                      <tr key={record.checkInId || `${record.memberId}-${record.checkedInAt}`} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">{record.checkInId || "-"}</td>
                        <td className="px-4 py-3">{record.memberName || record.memberId || "-"}</td>
                        <td className="px-4 py-3">{record.mobileNumber || "-"}</td>
                        <td className="px-4 py-3">{record.gymId || "-"}</td>
                        <td className="px-4 py-3">{record.status || "-"}</td>
                        <td className="px-4 py-3">{record.source || "-"}</td>
                        <td className="px-4 py-3">{formatTimestamp(record.checkedInAt)}</td>
                        <td className="px-4 py-3">{formatTimestamp(record.checkedOutAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      ) : null}

      {activeTab === "members" ? (
        <section className="space-y-4">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SurfaceCard title="Active Members">
              <p className="text-2xl font-bold text-[#282828]">{memberDirectory.summary.activeMembers}</p>
            </SurfaceCard>
            <SurfaceCard title="Expired">
              <p className="text-2xl font-bold text-[#282828]">{memberDirectory.summary.expiredMembers}</p>
            </SurfaceCard>
            <SurfaceCard title="Irregular">
              <p className="text-2xl font-bold text-[#282828]">{memberDirectory.summary.irregularMembers}</p>
            </SurfaceCard>
            <SurfaceCard title="PT Clients">
              <p className="text-2xl font-bold text-[#282828]">{memberDirectory.summary.ptClients}</p>
            </SurfaceCard>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {MEMBER_FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMembersPageIndex(0);
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

              <button
                type="button"
                onClick={() => void onExportMembersCsv()}
                disabled={exportingMembersCsv}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exportingMembersCsv ? "Exporting..." : "Export CSV"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3">Attendance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {memberDirectory.members.content.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={6}>
                        No members found.
                      </td>
                    </tr>
                  ) : (
                    memberDirectory.members.content.map((member) => {
                      const attendancePercent = clampPercent(member.attendancePercent);
                      return (
                        <tr key={member.memberId} className="hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-700">{member.fullName || member.memberId}</p>
                            <p className="text-xs text-slate-500">{member.mobileNumber || "-"}</p>
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
                          <td className="px-4 py-3 text-slate-700">{member.paymentStatus || "-"}</td>
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
                Page {memberDirectory.members.number + 1} of {Math.max(memberDirectory.members.totalPages, 1)} (
                {memberDirectory.members.totalElements} total)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMembersPageIndex((current) => Math.max(0, current - 1))}
                  disabled={memberDirectory.members.first}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setMembersPageIndex((current) => Math.min(memberDirectory.members.totalPages - 1, current + 1))}
                  disabled={memberDirectory.members.last}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </section>

          {loadingMembersDirectory ? <div className="text-sm text-slate-500">Loading member directory...</div> : null}
        </section>
      ) : null}

      {activeTab === "people" ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <UserStar className="h-4 w-4 text-[#C42429]" />
                Coaches
              </h2>
              <span className="text-xs text-slate-500">Total: {coachesPage.totalElements}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Mobile</th>
                    <th className="px-4 py-3">Designation</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredCoaches.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={4}>
                        No coaches found.
                      </td>
                    </tr>
                  ) : (
                    filteredCoaches.map((coach) => (
                      <tr key={coach.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-700">{coach.name}</td>
                        <td className="px-4 py-3">{coach.mobile}</td>
                        <td className="px-4 py-3">{coach.designation || "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => router.push(`/portal/trainers/${coach.id}`)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Open Profile
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setCoachPageIndex((current) => Math.max(0, current - 1))}
                disabled={coachesPage.first}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCoachPageIndex((current) => current + 1)}
                disabled={coachesPage.last}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <UserSquare2 className="h-4 w-4 text-[#C42429]" />
                Staff
              </h2>
              <span className="text-xs text-slate-500">Total: {staffPage.totalElements}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Mobile</th>
                    <th className="px-4 py-3">Designation</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredStaff.length === 0 ? (
                    <tr>
                      <td className="px-4 py-4 text-slate-500" colSpan={4}>
                        No staff found.
                      </td>
                    </tr>
                  ) : (
                    filteredStaff.map((staff) => (
                      <tr key={staff.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-700">{staff.name}</td>
                        <td className="px-4 py-3">{staff.mobile}</td>
                        <td className="px-4 py-3">{staff.designation || "-"}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => router.push(`/admin/staff/${staff.id}`)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Open Profile
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setStaffPageIndex((current) => Math.max(0, current - 1))}
                disabled={staffPage.first}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setStaffPageIndex((current) => current + 1)}
                disabled={staffPage.last}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "revenue" ? (
        <section className="grid gap-4 lg:grid-cols-3">
          <SurfaceCard title="Total Collected">
            <p className="text-2xl font-bold text-[#282828]">{formatInr(revenue.totalCollected)}</p>
          </SurfaceCard>
          <SurfaceCard title="Outstanding">
            <p className="text-2xl font-bold text-[#282828]">{formatInr(revenue.totalOutstanding)}</p>
          </SurfaceCard>
          <SurfaceCard title="Average Invoice Value">
            <p className="text-2xl font-bold text-[#282828]">{formatInr(revenue.averageInvoiceValue)}</p>
          </SurfaceCard>

          <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <BarChart3 className="h-4 w-4 text-[#C42429]" />
              Revenue Series
            </h2>
            <LineChart labels={revenueLabels} series={revenueSeries} />
          </div>
        </section>
      ) : null}

      {activeTab === "programs" ? (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Users className="h-4 w-4 text-[#C42429]" />
              Branch Programs
            </h2>
            <span className="text-xs text-slate-500">
              Page {programsPage.number + 1} of {Math.max(programsPage.totalPages, 1)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <th className="px-4 py-3">Program</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trainer</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Capacity</th>
                  <th className="px-4 py-3">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredPrograms.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={6}>
                      No programs found.
                    </td>
                  </tr>
                ) : (
                  filteredPrograms.map((program) => (
                    <tr key={program.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-700">{program.name || program.id}</td>
                      <td className="px-4 py-3">{program.status || "-"}</td>
                      <td className="px-4 py-3">{program.trainerName || "-"}</td>
                      <td className="px-4 py-3">{program.membersEnrolled ?? 0}</td>
                      <td className="px-4 py-3">{program.maxCapacity ?? "-"}</td>
                      <td className="px-4 py-3">
                        {program.completionRate === undefined || program.completionRate === null ? "-" : `${Math.round(program.completionRate)}%`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button
              type="button"
              onClick={() => setProgramPageIndex((current) => Math.max(0, current - 1))}
              disabled={programPageIndex === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setProgramPageIndex((current) => Math.min(programsPage.totalPages - 1, current + 1))}
              disabled={programPageIndex >= programsPage.totalPages - 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </section>
      ) : null}

      {loadingSummary || loadingPrograms || loadingMembersDirectory || loadingEmployees ? (
        <div className="text-sm text-slate-500">Loading branch workspace...</div>
      ) : null}
    </AdminPageFrame>
  );
}
