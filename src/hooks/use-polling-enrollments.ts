"use client";

import { useEffect, useRef, useState } from "react";
import { engagementService, MemberBiometricEnrollmentRecord } from "@/lib/api/services/engagement-service";

/**
 * Poll the biometric enrollments endpoint every `intervalMs` while any
 * enrollment row is still PENDING. Used on member and coach profile
 * attendance tabs so a freshly-submitted face-scan flips from
 * Pending → Active without a full-page refresh.
 *
 * Auto-stops when:
 *   - No row is in PENDING (all settled to ENROLLED / BLOCKED / FAILED)
 *   - `enabled` flips to false (caller can drop polling when the modal closes)
 *   - The component unmounts (cleanup via useEffect return)
 *
 * This hook fetches on its own tick — the caller should seed the list
 * via their existing loader and pass `initial`. Successful polls update
 * both the hook's internal state AND invoke `onUpdate` so the caller
 * can push the fresh list into its own state (e.g. to re-render the
 * "Manage Access" section).
 *
 * Kept deliberately small: no exponential backoff, no retry-on-error —
 * if a poll fails we just wait for the next tick. A 3-second cadence
 * against a single endpoint is cheap.
 */
export function usePollingEnrollments(params: {
  token: string | null;
  userId: number | string | null;
  enabled: boolean;
  initial: MemberBiometricEnrollmentRecord[];
  onUpdate?: (rows: MemberBiometricEnrollmentRecord[]) => void;
  intervalMs?: number;
}): MemberBiometricEnrollmentRecord[] {
  const { token, userId, enabled, initial, onUpdate, intervalMs = 3000 } = params;
  const [rows, setRows] = useState<MemberBiometricEnrollmentRecord[]>(initial);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Keep internal state synced with the caller's seed data when it changes
  // (e.g. after an enroll action refetches). Without this, the hook would
  // be looking at stale rows and decide nothing is pending.
  useEffect(() => {
    setRows(initial);
  }, [initial]);

  useEffect(() => {
    if (!enabled || !token || userId == null) return;
    const hasPending = rows.some((r) => String(r.status || "").toUpperCase() === "PENDING");
    if (!hasPending) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await engagementService.getMemberBiometricEnrollments(token, userId);
        if (cancelled) return;
        setRows(fresh);
        onUpdateRef.current?.(fresh);
      } catch {
        // swallow — next tick will retry
      }
    };
    const handle = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled, token, userId, rows, intervalMs]);

  return rows;
}
