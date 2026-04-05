import { AuthUser } from "@/types/auth";

export function resolveStaffId(user?: AuthUser | null): number | null {
  if (!user) {
    return null;
  }

  // Use the database user ID (numeric), not the mobile number
  const fromId = Number(user.id);
  if (!Number.isNaN(fromId) && Number.isFinite(fromId) && fromId > 0) {
    return fromId;
  }

  return null;
}
