"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ToastBanner } from "@/components/common/toast-banner";
import { PageLoader } from "@/components/common/page-loader";
import { AttendanceAccessSection } from "@/components/portal/attendance-access-section";
import {
  engagementService,
  BiometricAttendanceLogRecord,
  BiometricDeviceRecord,
  MemberBiometricEnrollmentRecord,
} from "@/lib/api/services/engagement-service";
import { usersService } from "@/lib/api/services/users-service";
import { isRealBiometricDevice } from "@/lib/biometric-device-filter";
import { usePollingEnrollments } from "@/hooks/use-polling-enrollments";

/**
 * Self-profile route for the portal user (primarily ADMIN — they don't
 * appear in Coaches / Staff directories but still need a place to see
 * their own biometric enrollment state and attendance punches). Other
 * staff roles can view it too; STAFF already has per-person profile
 * pages under /portal/staff/[id] and coaches under /portal/trainers/[id],
 * but those require someone else's id — this route is always "me."
 */

function normalizePin(raw: string): string {
  const digits = (raw || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function humanize(code?: string): string {
  if (!code) return "";
  return code
    .split("_")
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export default function MyProfilePage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [devices, setDevices] = useState<BiometricDeviceRecord[]>([]);
  const [enrollments, setEnrollments] = useState<MemberBiometricEnrollmentRecord[]>([]);
  const [allLogs, setAllLogs] = useState<BiometricAttendanceLogRecord[]>([]);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const myPin = useMemo(() => normalizePin(String(user?.mobile || "")), [user?.mobile]);

  const myLogs = useMemo(() => {
    if (!myPin) return [];
    return allLogs.filter((entry) => String(entry.deviceUserId || "") === myPin);
  }, [allLogs, myPin]);

  const loadData = useCallback(async () => {
    if (!token || !user?.id) return;
    setLoading(true);
    try {
      const [devs, enrolls, logs] = await Promise.all([
        engagementService.listBiometricDevices(token).catch(() => []),
        engagementService.getMemberBiometricEnrollments(token, user.id).catch(() => []),
        engagementService.getBiometricLogs(token).catch(() => []),
      ]);
      setDevices(Array.isArray(devs) ? devs.filter(isRealBiometricDevice) : []);
      setEnrollments(Array.isArray(enrolls) ? enrolls : []);
      setAllLogs(Array.isArray(logs) ? logs : []);
    } catch (err) {
      setToast({ kind: "error", message: err instanceof Error ? err.message : "Failed to load profile." });
    } finally {
      setLoading(false);
    }
  }, [token, user?.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Face-scan polling while any enrollment is PENDING — flips Pending → Active
  // without a manual refresh. Same hook used on coach / member profiles.
  usePollingEnrollments({
    token,
    userId: user?.id ?? null,
    enabled: true,
    initial: enrollments,
    onUpdate: setEnrollments,
  });

  const handleAccessAction = useCallback(
    async (
      action: "ADD_USER" | "RE_ADD_USER" | "BLOCK_USER" | "UNBLOCK_USER" | "DELETE_USER",
      serial: string,
    ) => {
      if (!token || !user?.id || !myPin || !user?.name) return;
      setAccessBusy(true);
      setAccessError(null);
      try {
        const payload = { serialNumber: serial, pin: myPin, name: user.name, memberId: user.id };
        if (action === "ADD_USER") await engagementService.enrollBiometricUser(token, payload);
        else if (action === "RE_ADD_USER") await engagementService.reAddBiometricUser(token, payload);
        else if (action === "BLOCK_USER") await engagementService.blockBiometricUser(token, payload);
        else if (action === "UNBLOCK_USER") await engagementService.unblockBiometricUser(token, payload);
        else if (action === "DELETE_USER")
          await engagementService.deleteBiometricUser(token, { serialNumber: serial, pin: myPin, memberId: Number(user.id) });
        setToast({ kind: "success", message: "Biometric command queued; status will update shortly." });
        await loadData();
      } catch (err) {
        setAccessError(err instanceof Error ? err.message : "Failed to update biometric access.");
      } finally {
        setAccessBusy(false);
      }
    },
    [token, user, myPin, loadData],
  );

  if (!user) return <PageLoader label="Loading..." />;
  if (loading) return <PageLoader label="Loading profile..." />;

  return (
    <div className="space-y-6 pb-12">
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white">My Profile</h1>
        <p className="text-slate-400">Your account, biometric access, and attendance punches.</p>
      </div>

      {/* Profile card */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#c42924]/20 text-[#c42924]">
            <UserRound className="h-7 w-7" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-xl font-semibold text-white">{user.name}</h2>
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                {humanize(user.designation) || humanize(user.role)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-4 w-4" />
                {user.mobile}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Biometric access */}
      <AttendanceAccessSection
        pin={myPin}
        devices={devices}
        enrollments={enrollments}
        logs={myLogs}
        actionBusy={accessBusy}
        actionError={accessError}
        onAction={handleAccessAction}
      />
    </div>
  );
}
