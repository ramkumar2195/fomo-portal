"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminPageFrame, SurfaceCard, TabStrip } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { trainingService } from "@/lib/api/services/training-service";
import { TrainingProgramSummary } from "@/types/admin";

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

export default function ProgramDetailPage() {
  const params = useParams<{ programId: string }>();
  const programId = params.programId;
  const { token } = useAuth();

  const [program, setProgram] = useState<TrainingProgramSummary | null>(null);
  const [membersCount, setMembersCount] = useState(0);
  const [progressPayload, setProgressPayload] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !programId) {
      return;
    }

    let active = true;

    (async () => {
      setError(null);
      try {
        const [programData, membersPage, progress] = await Promise.all([
          trainingService.getProgram(token, programId),
          trainingService.listProgramMembers(token, programId, 0, 1),
          trainingService.getProgramProgress(token, programId),
        ]);

        if (!active) {
          return;
        }

        setProgram(programData);
        setMembersCount(membersPage.totalElements);
        setProgressPayload(toRecord(progress));
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load program detail.");
      }
    })();

    return () => {
      active = false;
    };
  }, [programId, token]);

  return (
    <AdminPageFrame
      title={program?.name || `Program #${programId}`}
      description="Program detail from /api/training/programs/{programId}"
      searchPlaceholder="Search by member, session, trainer..."
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <TabStrip tabs={["Overview", "Members", "Schedule", "Progress"]} />

      <section className="grid gap-4 lg:grid-cols-3">
        <SurfaceCard title="Overview">
          <div className="space-y-2 text-sm text-slate-600">
            <p>Name: {program?.name || "-"}</p>
            <p>Trainer: {program?.trainerName || program?.trainerId || "-"}</p>
            <p>Status: {program?.status || "-"}</p>
            <p>Duration: {program?.duration || "-"}</p>
          </div>
        </SurfaceCard>
        <SurfaceCard title="Members">
          <p className="text-2xl font-bold text-slate-800">{membersCount}</p>
          <p className="text-xs text-slate-500">From /api/training/programs/{programId}/members</p>
        </SurfaceCard>
        <SurfaceCard title="Progress">
          <p className="text-2xl font-bold text-slate-800">{pickNumber(progressPayload, ["completionRate", "progress", "completion"])}%</p>
          <p className="text-xs text-slate-500">From /api/training/programs/{programId}/progress</p>
        </SurfaceCard>
      </section>

      <SurfaceCard title="Raw Progress Payload">
        <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(progressPayload, null, 2)}</pre>
      </SurfaceCard>
    </AdminPageFrame>
  );
}
