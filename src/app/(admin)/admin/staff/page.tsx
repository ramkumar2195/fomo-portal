"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { UserDesignation } from "@/types/auth";
import { UserDirectoryItem } from "@/types/models";

interface StaffRow {
  user: UserDirectoryItem;
  assignedLeads: string;
  conversionRate: string;
  activityStatus: string;
}

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractNumericId(user: UserDirectoryItem): number | null {
  const direct = parseNumber(user.id);
  if (direct !== null) {
    return direct;
  }

  const mobileDigits = user.mobile.replace(/[^0-9]/g, "");
  if (!mobileDigits) {
    return null;
  }

  return parseNumber(mobileDigits);
}

function pickString(payload: unknown, keys: string[]): string | null {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickNumber(payload: unknown, keys: string[]): number | null {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    const parsed = parseNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

async function enrichStaffRow(token: string, staffUser: UserDirectoryItem): Promise<StaffRow> {
  const numericId = extractNumericId(staffUser);

  const [dashboardResult, inquiriesResult] = await Promise.allSettled([
    engagementService.getStaffDashboard(token, staffUser.id),
    numericId === null
      ? Promise.resolve(null)
      : subscriptionService.searchInquiriesPaged(token, { clientRepStaffId: numericId }, 0, 1),
  ]);

  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const inquiriesPage = inquiriesResult.status === "fulfilled" ? inquiriesResult.value : null;

  const assignedLeads = inquiriesPage ? String(inquiriesPage.totalElements) : "-";
  const conversionRate = pickNumber(dashboard, ["conversionRate", "leadConversionRate"]);
  const activityStatus = pickString(dashboard, ["activityStatus", "status", "onlineStatus"]);

  return {
    user: staffUser,
    assignedLeads,
    conversionRate: conversionRate === null ? "-" : `${conversionRate}%`,
    activityStatus: activityStatus || "-",
  };
}

export default function StaffPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [designationFilter, setDesignationFilter] = useState("ALL");
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const staffUsers = await usersService.searchUsers(token, {
          role: "STAFF",
          query: search.trim() || undefined,
          designation: designationFilter === "ALL" ? undefined : (designationFilter as UserDesignation),
        });

        const enriched = await Promise.all(staffUsers.slice(0, 20).map((user) => enrichStaffRow(token, user)));

        if (!active) {
          return;
        }

        setRows(enriched);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load staff.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [designationFilter, search, token]);

  const filterValues = useMemo(
    () => ({
      designation: designationFilter,
    }),
    [designationFilter],
  );

  return (
    <AdminPageFrame
      title="Staff"
      description="Staff table from users-service + staff dashboard + inquiry assignment counts"
      searchPlaceholder="Search staff name, role, branch..."
      searchValue={search}
      onSearchChange={setSearch}
      filters={[
        {
          id: "designation",
          label: "Role",
          options: [
            { label: "All Roles", value: "ALL" },
            { label: "GYM_MANAGER", value: "GYM_MANAGER" },
            { label: "SALES_MANAGER", value: "SALES_MANAGER" },
            { label: "SALES_EXECUTIVE", value: "SALES_EXECUTIVE" },
            { label: "FRONT_DESK_EXECUTIVE", value: "FRONT_DESK_EXECUTIVE" },
            { label: "FITNESS_MANAGER", value: "FITNESS_MANAGER" },
          ],
        },
      ]}
      filterValues={filterValues}
      onFilterChange={(filterId, value) => {
        if (filterId === "designation") {
          setDesignationFilter(value);
        }
      }}
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Assigned Leads</th>
              <th className="px-4 py-3">Conversion Rate</th>
              <th className="px-4 py-3">Activity Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.user.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">{row.user.name || row.user.mobile}</td>
                <td className="px-4 py-3 text-slate-700">{row.user.designation || "-"}</td>
                <td className="px-4 py-3 text-slate-700">{row.user.defaultBranchId || "-"}</td>
                <td className="px-4 py-3 text-slate-700">{row.assignedLeads}</td>
                <td className="px-4 py-3 text-slate-700">{row.conversionRate}</td>
                <td className="px-4 py-3 text-slate-700">{row.activityStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {loading ? <div className="text-sm text-slate-500">Loading staff...</div> : null}

      {!loading && rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">No staff found.</div>
      ) : null}
    </AdminPageFrame>
  );
}
