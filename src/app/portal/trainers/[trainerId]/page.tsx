"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Dumbbell,
  Mail,
  MapPin,
  Phone,
  Shield,
  User,
  UserRound,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { usersService } from "@/lib/api/services/users-service";
import { trainingService } from "@/lib/api/services/training-service";
import { engagementService } from "@/lib/api/services/engagement-service";
import { ToastBanner } from "@/components/common/toast-banner";

/* ── helpers ─────────────────────────────────────────────────── */

type Rec = Record<string, unknown>;
function toRec(v: unknown): Rec {
  return typeof v === "object" && v !== null ? (v as Rec) : {};
}
function str(r: Rec, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "-";
}
function num(r: Rec, ...keys: string[]): number {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function formatDate(value: string | undefined | null): string {
  if (!value || value === "-") return "-";
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── types ───────────────────────────────────────────────────── */

type TabKey = "overview" | "clients" | "attendance" | "sessions";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "clients", label: "Client List" },
  { key: "attendance", label: "Attendance" },
  { key: "sessions", label: "PT Sessions" },
];

interface ClientRow {
  memberId: string | number;
  memberName: string;
  planName: string;
  category: string;
  status: string;
  type: "general" | "pt";
}

/* ── component ───────────────────────────────────────────────── */

export default function TrainerProfilePage() {
  const params = useParams();
  const trainerId = String(params.trainerId);
  const { token } = useAuth();

  const [trainer, setTrainer] = useState<Rec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  // Tab data
  const [assignments, setAssignments] = useState<unknown[]>([]);
  const [performance, setPerformance] = useState<Rec | null>(null);
  const [attendanceData, setAttendanceData] = useState<unknown[]>([]);
  const [ptSessions, setPtSessions] = useState<unknown[]>([]);
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});

  // Load trainer profile
  useEffect(() => {
    if (!token || !trainerId) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        // Search with COACH role first, then STAFF as fallback
        let user = await usersService.searchUsers(token, { role: "COACH" }).then((list) => list.find((u) => String(u.id) === String(trainerId)) || null);
        if (!user) {
          user = await usersService.getUserById(token, trainerId);
        }
        if (active && user) setTrainer(user as unknown as Rec);
        else if (active) setError("Trainer not found");
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load trainer");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, trainerId]);

  // Load tab data
  const loadTab = useCallback(async (tab: TabKey) => {
    if (!token || !trainerId || tabLoading[tab]) return;
    setTabLoading((prev) => ({ ...prev, [tab]: true }));
    try {
      switch (tab) {
        case "clients": {
          const [coachAssigns, perf] = await Promise.all([
            trainingService.getCoachAssignments(token, trainerId).catch(() => []),
            trainingService.getCoachPerformance(token, trainerId).catch(() => null),
          ]);
          setAssignments(coachAssigns);
          if (perf) setPerformance(toRec(perf));
          break;
        }
        case "attendance": {
          try {
            const report = await usersService.getTrainerAttendanceReport(token, { trainerId: Number(trainerId) });
            const entries = Array.isArray(report) ? report : (Array.isArray((report as Rec).entries) ? (report as Rec).entries as unknown[] : []);
            setAttendanceData(entries);
          } catch {
            setAttendanceData([]);
          }
          break;
        }
        case "sessions": {
          // Load all PT sessions for this coach
          try {
            const coachAssigns = assignments.length > 0 ? assignments : await trainingService.getCoachAssignments(token, trainerId).catch(() => []);
            if (assignments.length === 0 && coachAssigns.length > 0) setAssignments(coachAssigns);
            const allSessions: unknown[] = [];
            for (const assign of coachAssigns) {
              const rec = toRec(assign);
              const assignId = str(rec, "id", "assignmentId");
              if (assignId && assignId !== "-") {
                try {
                  const sessions = await trainingService.getPtSessionsByAssignment(token, assignId);
                  allSessions.push(...sessions.map((s) => ({ ...toRec(s), memberName: str(rec, "memberName", "clientName") })));
                } catch {
                  // skip
                }
              }
            }
            setPtSessions(allSessions);
          } catch {
            setPtSessions([]);
          }
          break;
        }
        default:
          break;
      }
    } finally {
      setTabLoading((prev) => ({ ...prev, [tab]: false }));
    }
  }, [token, trainerId, tabLoading, assignments]);

  useEffect(() => {
    if (activeTab !== "overview") {
      loadTab(activeTab);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive trainer info
  const t = trainer || {};
  const name = str(t, "name", "fullName", "displayName");
  const designation = str(t, "designation");
  const email = str(t, "email");
  const mobile = str(t, "mobile", "mobileNumber", "phoneNumber");
  const dob = str(t, "dateOfBirth", "dob");
  const gender = str(t, "gender");
  const joinDate = str(t, "createdAt", "joinDate", "hireDate");
  const branchName = str(t, "defaultBranchName", "branchName");
  const branchId = num(t, "defaultBranchId", "branchId");
  const employmentType = str(t, "employmentType");
  const active = t.active !== false;
  const emergencyContact = str(t, "emergencyContactName", "emergencyContact");
  const emergencyPhone = str(t, "emergencyContactNumber", "emergencyPhone");
  const address = str(t, "address", "fullAddress");
  const initials = name.split(" ").map((w) => w[0]).join("").substring(0, 2).toUpperCase();

  // Derive client lists
  const clientRows = useMemo<ClientRow[]>(() => {
    return assignments.map((a) => {
      const r = toRec(a);
      return {
        memberId: str(r, "memberId", "clientId", "id"),
        memberName: str(r, "memberName", "clientName", "name"),
        planName: str(r, "planName", "productName", "subscriptionName"),
        category: str(r, "categoryCode", "productCategoryCode", "type"),
        status: str(r, "status", "assignmentStatus"),
        type: (str(r, "type", "assignmentType", "categoryCode").toUpperCase().includes("PT") ? "pt" : "general") as "general" | "pt",
      };
    });
  }, [assignments]);

  const generalClients = clientRows.filter((c) => c.type === "general");
  const ptClients = clientRows.filter((c) => c.type === "pt");

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
      </div>
    );
  }

  if (error || !trainer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <ToastBanner kind="error" message={error || "Trainer not found"} onClose={() => setError(null)} />
        <Link href="/portal/trainers" className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Trainers
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      {/* Back link */}
      <Link href="/portal/trainers" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">
        <ArrowLeft className="h-4 w-4" /> Back To Trainers
      </Link>

      {/* Header card */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#141b24] to-[#0c1016] p-6">
        <div className="flex items-start gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[#c42924]/20 text-2xl font-bold text-[#c42924]">
            {initials}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{name}</h1>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wider ${active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                {active ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{humanize(designation)} {employmentType !== "-" ? `\u00b7 ${humanize(employmentType)}` : ""}</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-300">
              {mobile !== "-" && <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-500" />{mobile}</span>}
              {email !== "-" && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-slate-500" />{email}</span>}
              {branchName !== "-" && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-500" />{branchName || `Branch #${branchId}`}</span>}
            </div>
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Calendar} label="Join Date" value={formatDate(joinDate !== "-" ? joinDate : undefined)} />
          <StatCard icon={Users} label="Total Clients" value={String(clientRows.length || "-")} />
          <StatCard icon={Dumbbell} label="PT Clients" value={String(ptClients.length || "-")} />
          <StatCard icon={Shield} label="Designation" value={humanize(designation)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "bg-[#c42924] text-white"
                : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[300px]">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Personal details */}
            <Panel title="Personal Details">
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: "Full Name", value: name },
                  { label: "Mobile", value: mobile },
                  { label: "Email", value: email },
                  { label: "Date of Birth", value: formatDate(dob !== "-" ? dob : undefined) },
                  { label: "Gender", value: gender !== "-" ? humanize(gender) : "-" },
                  { label: "Home Branch", value: branchName || `Branch #${branchId}` },
                  { label: "Employment Type", value: employmentType !== "-" ? humanize(employmentType) : "-" },
                  { label: "Designation", value: humanize(designation) },
                  { label: "Join Date", value: formatDate(joinDate !== "-" ? joinDate : undefined) },
                ].map((entry) => (
                  <div key={entry.label} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{entry.label}</dt>
                    <dd className="mt-2 text-base font-medium text-white">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

            {/* Emergency Contact */}
            <Panel title="Emergency Contact">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Contact Name</dt>
                  <dd className="mt-2 text-base font-medium text-white">{emergencyContact}</dd>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Contact Number</dt>
                  <dd className="mt-2 text-base font-medium text-white">{emergencyPhone}</dd>
                </div>
                {address !== "-" && (
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 sm:col-span-2">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Address</dt>
                    <dd className="mt-2 text-base font-medium text-white">{address}</dd>
                  </div>
                )}
              </dl>
            </Panel>
          </div>
        )}

        {activeTab === "clients" && (
          <div className="space-y-6">
            {tabLoading.clients ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
              </div>
            ) : (
              <>
                {/* General Clients */}
                <Panel title="General Clients" subtitle="Members assigned for default gym training">
                  {generalClients.length === 0 && ptClients.length === 0 && clientRows.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">No clients assigned yet.</p>
                  ) : (
                    <ClientTable clients={generalClients.length > 0 ? generalClients : clientRows.filter((c) => c.type !== "pt")} />
                  )}
                </Panel>

                {/* PT Clients */}
                <Panel title="PT Clients" subtitle="Personal training dedicated clients">
                  {ptClients.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">No PT clients assigned.</p>
                  ) : (
                    <ClientTable clients={ptClients} />
                  )}
                </Panel>

                {/* Performance Summary */}
                {performance && (
                  <Panel title="Performance Summary">
                    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {Object.entries(performance).map(([key, value]) => (
                        <div key={key} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{humanize(key)}</dt>
                          <dd className="mt-2 text-base font-medium text-white">{String(value ?? "-")}</dd>
                        </div>
                      ))}
                    </dl>
                  </Panel>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === "attendance" && (
          <div className="space-y-6">
            {tabLoading.attendance ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
              </div>
            ) : (
              <Panel title="Attendance Log" subtitle="Check-in and check-out records">
                {attendanceData.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-500">No attendance records found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Check In</th>
                          <th className="px-4 py-3">Check Out</th>
                          <th className="px-4 py-3">Hours</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {attendanceData.map((entry, i) => {
                          const r = toRec(entry);
                          const date = str(r, "date", "attendanceDate", "checkInAt");
                          const checkIn = str(r, "checkInAt", "checkIn", "entryTime", "firstPunch");
                          const checkOut = str(r, "checkOutAt", "checkOut", "exitTime", "lastPunch");
                          const hours = str(r, "totalHours", "hoursWorked", "duration");
                          const status = str(r, "status", "attendanceStatus");
                          return (
                            <tr key={i} className="text-slate-300 hover:bg-white/5">
                              <td className="px-4 py-3">{formatDate(date !== "-" ? date : undefined)}</td>
                              <td className="px-4 py-3">{checkIn}</td>
                              <td className="px-4 py-3">{checkOut}</td>
                              <td className="px-4 py-3">{hours}</td>
                              <td className="px-4 py-3">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  status.toUpperCase() === "PRESENT" ? "bg-emerald-500/10 text-emerald-400" :
                                  status.toUpperCase() === "ABSENT" ? "bg-rose-500/10 text-rose-400" :
                                  "bg-amber-500/10 text-amber-400"
                                }`}>{status !== "-" ? humanize(status) : "-"}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}
          </div>
        )}

        {activeTab === "sessions" && (
          <div className="space-y-6">
            {tabLoading.sessions ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#c42924] border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Session Summary */}
                {(() => {
                  const completed = ptSessions.filter((s) => {
                    const st = str(toRec(s), "status").toUpperCase();
                    return st === "COMPLETED" || st === "DONE";
                  }).length;
                  const scheduled = ptSessions.filter((s) => {
                    const st = str(toRec(s), "status").toUpperCase();
                    return st === "SCHEDULED" || st === "UPCOMING" || st === "PENDING";
                  }).length;
                  const cancelled = ptSessions.filter((s) => {
                    const st = str(toRec(s), "status").toUpperCase();
                    return st === "CANCELLED" || st === "CANCELED";
                  }).length;
                  const total = ptSessions.length;
                  return (
                    <Panel title="Session Summary">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard icon={Calendar} label="Total Sessions" value={String(total)} />
                        <StatCard icon={CheckCircle2} label="Completed" value={String(completed)} />
                        <StatCard icon={Clock} label="Scheduled" value={String(scheduled)} />
                        <StatCard icon={User} label="Cancelled" value={String(cancelled)} />
                      </div>
                    </Panel>
                  );
                })()}

                {/* Session Register */}
                <Panel title="Session Register" subtitle="Detailed log of all PT sessions">
                  {ptSessions.length === 0 ? (
                    <p className="py-4 text-center text-sm text-slate-500">No PT sessions recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-3">Member</th>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Time Slot</th>
                            <th className="px-4 py-3">Duration</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {ptSessions.map((session, i) => {
                            const r = toRec(session);
                            const memberName = str(r, "memberName", "clientName");
                            const date = str(r, "sessionDate", "date", "scheduledAt");
                            const timeSlot = str(r, "timeSlot", "startTime", "scheduledTime");
                            const duration = str(r, "duration", "sessionDuration", "durationMinutes");
                            const status = str(r, "status", "sessionStatus");
                            const notes = str(r, "notes", "trainerNotes", "remarks");
                            return (
                              <tr key={i} className="text-slate-300 hover:bg-white/5">
                                <td className="px-4 py-3 font-medium text-white">{memberName}</td>
                                <td className="px-4 py-3">{formatDate(date !== "-" ? date : undefined)}</td>
                                <td className="px-4 py-3">{timeSlot}</td>
                                <td className="px-4 py-3">{duration !== "-" ? `${duration} min` : "-"}</td>
                                <td className="px-4 py-3">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                    status.toUpperCase() === "COMPLETED" || status.toUpperCase() === "DONE" ? "bg-emerald-500/10 text-emerald-400" :
                                    status.toUpperCase() === "CANCELLED" || status.toUpperCase() === "CANCELED" ? "bg-rose-500/10 text-rose-400" :
                                    status.toUpperCase() === "SCHEDULED" || status.toUpperCase() === "UPCOMING" ? "bg-blue-500/10 text-blue-400" :
                                    "bg-amber-500/10 text-amber-400"
                                  }`}>{humanize(status)}</span>
                                </td>
                                <td className="px-4 py-3 max-w-[200px] truncate">{notes}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── sub-components ──────────────────────────────────────────── */

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#141b24] to-[#0c1016] p-6">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.05] px-5 py-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-slate-300" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
          <p className="mt-1 text-base font-semibold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

function ClientTable({ clients }: { clients: ClientRow[] }) {
  if (clients.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-500">No clients in this category.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-3">Member</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {clients.map((c) => (
            <tr key={c.memberId} className="text-slate-300 hover:bg-white/5">
              <td className="px-4 py-3 font-medium text-white">{c.memberName}</td>
              <td className="px-4 py-3">{c.planName}</td>
              <td className="px-4 py-3">{humanize(c.category)}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  c.status.toUpperCase() === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400" :
                  "bg-amber-500/10 text-amber-400"
                }`}>{humanize(c.status)}</span>
              </td>
              <td className="px-4 py-3">
                <Link href={`/admin/members/${c.memberId}`} className="text-xs font-semibold text-[#c42924] hover:underline">
                  View Profile
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
