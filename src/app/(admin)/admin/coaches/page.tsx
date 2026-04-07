"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { trainingService } from "@/lib/api/services/training-service";
import { usersService } from "@/lib/api/services/users-service";
import { UserDirectoryItem } from "@/types/models";

interface CoachCard {
  user: UserDirectoryItem;
  specializations: string[];
  programs: string[];
  ptClients: string;
  revenue: string;
  rating: string;
}

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function pickNumber(payload: unknown, keys: string[]): number | null {
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
  return null;
}

function pickStringArray(payload: unknown, keys: string[]): string[] {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }

  return [];
}

function formatInr(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

async function enrichCoach(
  token: string,
  coach: UserDirectoryItem,
  programsByTrainer: Map<string, string[]>,
): Promise<CoachCard> {
  const [performanceResult, assignmentsResult] = await Promise.allSettled([
    trainingService.getCoachPerformance(token, coach.id),
    trainingService.getCoachAssignments(token, coach.id),
  ]);

  const performance = performanceResult.status === "fulfilled" ? performanceResult.value : null;
  const assignments = assignmentsResult.status === "fulfilled" ? assignmentsResult.value : [];

  const specializationFromPerformance = pickStringArray(performance, ["specializations", "skills", "expertise"]);
  const specializationFromDesignation = coach.designation ? [coach.designation.replaceAll("_", " ")] : [];

  const specializations =
    specializationFromPerformance.length > 0 ? specializationFromPerformance : specializationFromDesignation;

  const assignedPrograms = programsByTrainer.get(String(coach.id)) || [];
  const assignmentCount = Array.isArray(assignments) ? assignments.length : 0;

  const ptClients = pickNumber(performance, ["ptClients", "totalPtClients", "activePtClients"]);
  const monthlyRevenue = pickNumber(performance, ["monthlyRevenue", "ptRevenue", "revenue"]);
  const rating = pickNumber(performance, ["rating", "averageRating"]);

  return {
    user: coach,
    specializations: specializations.length > 0 ? specializations : ["-"],
    programs: assignedPrograms,
    ptClients: ptClients === null ? String(assignmentCount) : String(ptClients),
    revenue: formatInr(monthlyRevenue),
    rating: rating === null ? "-" : String(rating),
  };
}

export default function CoachesPage() {
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [cards, setCards] = useState<CoachCard[]>([]);
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
        const [coaches, programsPage] = await Promise.all([
          usersService.searchUsers(token, {
            role: "COACH",
            query: search.trim() || undefined,
          }),
          trainingService.listPrograms(token, 0, 200),
        ]);

        const programsByTrainer = new Map<string, string[]>();
        programsPage.content.forEach((program) => {
          if (!program.trainerId) {
            return;
          }

          const key = String(program.trainerId);
          const existing = programsByTrainer.get(key) || [];
          existing.push(program.name);
          programsByTrainer.set(key, existing);
        });

        const coachCards = await Promise.all(
          coaches.slice(0, 20).map((coach) => enrichCoach(token, coach, programsByTrainer)),
        );

        if (!active) {
          return;
        }

        setCards(coachCards);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load coaches.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [search, token]);

  const cardsToRender = useMemo(() => cards, [cards]);

  return (
    <AdminPageFrame
      title="Coaches"
      description="Coach list from users-service with performance + assignments from training-service"
      searchPlaceholder="Search coach name, specialization..."
      searchValue={search}
      onSearchChange={setSearch}
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cardsToRender.map((coach) => (
          <article key={coach.user.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-full bg-slate-200" />
              <div>
                <p className="text-lg font-semibold text-slate-800">{coach.user.name || coach.user.mobile}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-600">
                  <Star className="h-3.5 w-3.5 fill-amber-400" /> {coach.rating}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {coach.specializations.map((item) => (
                <span key={`${coach.user.id}-${item}`} className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">
                  {item}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {coach.programs.length === 0 ? (
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">No assigned programs</span>
              ) : (
                coach.programs.map((program) => (
                  <span key={`${coach.user.id}-${program}`} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {program}
                  </span>
                ))
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">PT Clients</p>
                <p className="text-sm font-bold text-slate-700">{coach.ptClients}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">Revenue</p>
                <p className="text-sm font-bold text-slate-700">{coach.revenue}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">Programs</p>
                <p className="text-sm font-bold text-slate-700">{coach.programs.length}</p>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Link
                href={`/admin/coaches/${coach.user.id}`}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open Schedule Master
              </Link>
            </div>
          </article>
        ))}
      </section>

      {loading ? <div className="text-sm text-slate-500">Loading coaches...</div> : null}

      {!loading && cardsToRender.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">No coaches found.</div>
      ) : null}
    </AdminPageFrame>
  );
}
