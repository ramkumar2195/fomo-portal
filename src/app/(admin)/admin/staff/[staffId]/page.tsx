"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminPageFrame, SurfaceCard, TabStrip } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { engagementService } from "@/lib/api/services/engagement-service";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { UserDirectoryItem } from "@/types/models";

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
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

function parseNumeric(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) {
    return null;
  }

  const fromDigits = Number(digits);
  return Number.isNaN(fromDigits) ? null : fromDigits;
}

export default function StaffProfilePage() {
  const params = useParams<{ staffId: string }>();
  const staffId = params.staffId;
  const { token } = useAuth();

  const [staff, setStaff] = useState<UserDirectoryItem | null>(null);
  const [dashboard, setDashboard] = useState<Record<string, unknown>>({});
  const [assignedLeads, setAssignedLeads] = useState(0);
  const [leaveRequestsCount, setLeaveRequestsCount] = useState(0);
  const [attendancePayload, setAttendancePayload] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !staffId) {
      return;
    }

    let active = true;

    (async () => {
      setError(null);
      try {
        const [profile, dashboardPayload, leaveRequests, attendance] = await Promise.all([
          usersService.getUserById(token, staffId),
          engagementService.getStaffDashboard(token, staffId),
          usersService.getStaffLeaveRequests(token, {
            staffId,
          }),
          usersService.getStaffAttendanceReport(token, {
            staffId,
          }),
        ]);

        if (!active) {
          return;
        }

        setStaff(profile);
        setDashboard(toRecord(dashboardPayload));
        setLeaveRequestsCount(Array.isArray(leaveRequests) ? leaveRequests.length : 0);
        setAttendancePayload(toRecord(attendance));

        const numericStaffId = parseNumeric(staffId);
        if (numericStaffId !== null) {
          const inquiriesPage = await subscriptionService.searchInquiriesPaged(token, { clientRepStaffId: numericStaffId }, 0, 1);
          if (!active) {
            return;
          }

          setAssignedLeads(inquiriesPage.totalElements);
        }
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load staff profile.");
      }
    })();

    return () => {
      active = false;
    };
  }, [staffId, token]);

  return (
    <AdminPageFrame
      title={staff?.name || `Staff #${staffId}`}
      description="Staff profile from users, dashboard, inquiries, attendance, and leave APIs"
      searchPlaceholder="Search lead activity or logs..."
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <TabStrip tabs={["Overview", "Leads", "Activity Logs", "Performance"]} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard title="Assigned Leads">
          <p className="text-2xl font-bold text-slate-800">{assignedLeads}</p>
        </SurfaceCard>
        <SurfaceCard title="Conversion Rate">
          <p className="text-2xl font-bold text-slate-800">{pickNumber(dashboard, ["conversionRate", "leadConversionRate"])}%</p>
        </SurfaceCard>
        <SurfaceCard title="Leave Requests">
          <p className="text-2xl font-bold text-slate-800">{leaveRequestsCount}</p>
        </SurfaceCard>
        <SurfaceCard title="Activity Score">
          <p className="text-2xl font-bold text-slate-800">{pickNumber(dashboard, ["activityScore", "score"])} / 10</p>
        </SurfaceCard>
      </section>

      <SurfaceCard title="Attendance Report Payload">
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(attendancePayload, null, 2)}</pre>
      </SurfaceCard>
    </AdminPageFrame>
  );
}
