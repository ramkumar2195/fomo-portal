import { canAccessRoute as canAccessRouteByPolicy } from "@/lib/access-policy";
import { AccessMetadata, AuthUser, UserDesignation, UserRole } from "@/types/auth";

export const DEFAULT_ROUTE_BY_ROLE: Record<UserRole, string> = {
  ADMIN: "/portal/sales-dashboard",
  STAFF: "/portal/sales-dashboard",
  COACH: "/unauthorized",
  MEMBER: "/unauthorized",
};

export function canAccessRoute(
  pathname: string,
  roleOrUser?: UserRole | AuthUser,
  designation?: UserDesignation,
  accessMetadata?: AccessMetadata | null,
): boolean {
  if (!roleOrUser) {
    return false;
  }

  const user: AuthUser =
    typeof roleOrUser === "string"
      ? {
          id: "",
          name: "",
          mobile: "",
          role: roleOrUser,
          designation,
        }
      : roleOrUser;

  return canAccessRouteByPolicy(pathname, user, accessMetadata);
}
