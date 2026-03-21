"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminPageFrame, SurfaceCard, TabStrip } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { trainingService } from "@/lib/api/services/training-service";
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

export default function CoachProfilePage() {
  const params = useParams<{ coachId: string }>();
  const coachId = params.coachId;
  const { token } = useAuth();

  const [coach, setCoach] = useState<UserDirectoryItem | null>(null);
  const [performance, setPerformance] = useState<Record<string, unknown>>({});
  const [availabilityCount, setAvailabilityCount] = useState(0);
  const [calendarCount, setCalendarCount] = useState(0);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !coachId) {
      return;
    }

    let active = true;

    (async () => {
      setError(null);

      try {
        const [profile, perf, availability, calendar, assignments] = await Promise.all([
          usersService.getUserById(token, coachId),
          trainingService.getCoachPerformance(token, coachId),
          trainingService.getTrainerAvailability(token, coachId, 0, 1),
          trainingService.getPtCalendar(token, coachId, 0, 1),
          trainingService.getCoachAssignments(token, coachId),
        ]);

        if (!active) {
          return;
        }

        setCoach(profile);
        setPerformance(toRecord(perf));
        setAvailabilityCount(availability.totalElements);
        setCalendarCount(calendar.totalElements);
        setAssignmentCount(assignments.length);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load coach profile.");
      }
    })();

    return () => {
      active = false;
    };
  }, [coachId, token]);

  return (
    <AdminPageFrame
      title={coach?.name || `Coach #${coachId}`}
      description="Coach profile from users + training composite endpoints"
      searchPlaceholder="Search sessions, client, programs..."
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <TabStrip tabs={["Overview", "Schedule", "Clients", "Programs", "Revenue", "Performance"]} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard title="PT Clients">
          <p className="text-2xl font-bold text-slate-800">{pickNumber(performance, ["ptClients", "totalPtClients"])}</p>
        </SurfaceCard>
        <SurfaceCard title="Program Members">
          <p className="text-2xl font-bold text-slate-800">{assignmentCount}</p>
        </SurfaceCard>
        <SurfaceCard title="Availability Slots">
          <p className="text-2xl font-bold text-slate-800">{availabilityCount}</p>
        </SurfaceCard>
        <SurfaceCard title="PT Calendar Entries">
          <p className="text-2xl font-bold text-slate-800">{calendarCount}</p>
        </SurfaceCard>
      </section>
    </AdminPageFrame>
  );
}
