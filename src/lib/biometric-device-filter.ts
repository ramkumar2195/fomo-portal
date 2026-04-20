/**
 * Shared device filter for attendance surfaces.
 *
 * Two categories of non-real devices exist in the database and must be
 * hidden from any user-facing device list:
 *
 *   1. **TEST\***  — local dev fixtures + QA devices. Serial starts with
 *      "TEST" (e.g. "TEST_ESSL_01").
 *   2. **LEGACY_GYMSW** — the synthetic device we attach to attendance
 *      rows imported from the pre-ESSL Excel history (July 2025 – March
 *      2026). It's not a real gate — no enroll / block / delete action
 *      applies. Logs that reference it are relabelled to "Legacy" at
 *      render time, but the device itself must never appear in pickers.
 *
 * Everything else (real serials from the Main Entrance devices) is
 * "real." If a future device class appears, extend the deny list here —
 * all attendance views share this one predicate.
 */
export function isRealBiometricDevice(device: unknown): boolean {
  if (!device || typeof device !== "object") return false;
  const record = device as { serialNumber?: unknown };
  const serial = String(record.serialNumber ?? "").trim().toUpperCase();
  if (!serial) return false;
  if (serial.startsWith("TEST")) return false;
  if (serial === "LEGACY_GYMSW") return false;
  return true;
}
