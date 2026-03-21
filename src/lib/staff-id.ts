import { AuthUser } from "@/types/auth";

export function resolveStaffId(user?: AuthUser | null): number | null {
  if (!user) {
    return null;
  }

  const fromMobile = Number(user.mobile);
  if (!Number.isNaN(fromMobile) && Number.isFinite(fromMobile)) {
    return fromMobile;
  }

  const fromId = Number(user.id);
  if (!Number.isNaN(fromId) && Number.isFinite(fromId)) {
    return fromId;
  }

  return null;
}
