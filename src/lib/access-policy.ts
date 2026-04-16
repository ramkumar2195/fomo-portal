import { AccessMetadata, AuthUser, UserDesignation, UserRole } from "@/types/auth";

const STAFF_DESIGNATION_ROUTE_PREFIXES: Record<UserDesignation, string[]> = {
  SUPER_ADMIN: ["*"],
  GYM_MANAGER: [
    "/portal/sales-dashboard",
    "/portal/inquiries",
    "/portal/follow-ups",
    "/portal/members",
    "/admin/members",
    "/portal/renewals",
    "/portal/billing",
    "/portal/trainers",
    "/admin/coaches",
    "/portal/trainer-attendance",
    "/portal/staff",
    "/portal/community",
    "/portal/notifications",
    "/portal/reports",
    "/portal/settings",
    "/portal/class-schedule",
    "/portal/accounts",
    "/admin/programs",
    "/admin/classes",
  ],
  SALES_MANAGER: [
    "/portal/sales-dashboard",
    "/portal/inquiries",
    "/portal/follow-ups",
    "/portal/members",
    "/portal/renewals",
    "/portal/billing",
    "/portal/notifications",
    "/portal/reports",
  ],
  SALES_EXECUTIVE: [
    "/portal/sales-dashboard",
    "/portal/inquiries",
    "/portal/follow-ups",
    "/portal/members",
    "/portal/renewals",
  ],
  FRONT_DESK_EXECUTIVE: [
    "/portal/sales-dashboard",
    "/portal/inquiries",
    "/portal/follow-ups",
    "/portal/members",
    "/portal/renewals",
    "/portal/billing",
  ],
  FITNESS_MANAGER: [
    "/portal/sales-dashboard",
    "/portal/trainers",
    "/portal/trainer-attendance",
    "/portal/reports",
    "/portal/class-schedule",
    "/admin/programs",
    "/admin/classes",
  ],
  HEAD_COACH: [],
  PT_COACH: [],
  GENERAL_TRAINER: [],
  YOGA_INSTRUCTOR: [],
  ZUMBA_INSTRUCTOR: [],
  BOXING_INSTRUCTOR: [],
  FREELANCE_TRAINER: [],
  MEMBER: [],
};

const STAFF_DESIGNATION_DENY_PREFIXES: Partial<Record<UserDesignation, string[]>> = {
  GYM_MANAGER: [
    "/portal/trainers/add",
    "/portal/staff/add",
    "/admin/catalog",
    "/admin/credits",
    "/admin/settings",
  ],
};

function roleFromInput(input?: AuthUser | UserRole | null): UserRole | undefined {
  if (!input) {
    return undefined;
  }

  return typeof input === "string" ? input : input.role;
}

function routeMatches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

const ROUTE_CAPABILITY_MAP: Array<{ prefix: string; capabilities: string[] }> = [
  {
    prefix: "/portal/sales-dashboard",
    capabilities: ["DASHBOARD_VIEW", "SALES_DASHBOARD_VIEW", "ADMIN_OVERVIEW_VIEW"],
  },
  {
    prefix: "/portal/inquiries",
    capabilities: ["INQUIRY_VIEW", "INQUIRIES_VIEW", "INQUIRY_MANAGE"],
  },
  {
    prefix: "/portal/members",
    capabilities: ["MEMBER_VIEW", "MEMBERS_VIEW", "MEMBER_MANAGE"],
  },
  {
    prefix: "/portal/renewals",
    capabilities: ["RENEWAL_VIEW", "RENEWALS_VIEW", "MEMBER_RENEWAL_VIEW", "SALES_REPORT_VIEW"],
  },
  {
    prefix: "/portal/follow-ups",
    capabilities: ["FOLLOW_UP_VIEW", "FOLLOW_UP_MANAGE", "INQUIRY_MANAGE"],
  },
  {
    prefix: "/portal/billing",
    capabilities: ["BILLING_VIEW", "INVOICE_VIEW", "BILLING_MANAGE"],
  },
  {
    prefix: "/portal/reports",
    capabilities: ["REPORTS_VIEW", "SALES_REPORT_VIEW", "ANALYTICS_VIEW"],
  },
  {
    prefix: "/portal/trainer-attendance",
    capabilities: ["TRAINER_ATTENDANCE_VIEW", "ATTENDANCE_VIEW", "OPERATIONS_VIEW"],
  },
  {
    prefix: "/portal/class-schedule",
    capabilities: ["CLASS_SCHEDULE_VIEW", "SCHEDULE_VIEW", "OPERATIONS_VIEW"],
  },
  {
    prefix: "/portal/accounts",
    capabilities: ["ACCOUNTS_VIEW", "FINANCE_VIEW", "RECEIPT_VIEW", "INVOICE_VIEW", "REPORTS_VIEW"],
  },
  {
    prefix: "/portal/notifications",
    capabilities: ["NOTIFICATION_VIEW", "CAMPAIGN_MANAGE", "NOTIFICATION_MANAGE"],
  },
  {
    prefix: "/portal/trainers",
    capabilities: ["TRAINER_CREATE", "TRAINER_MANAGE", "COACH_CREATE", "USER_MANAGE"],
  },
  {
    prefix: "/portal/staff",
    capabilities: ["STAFF_CREATE", "STAFF_MANAGE", "USER_MANAGE", "ADMIN_MANAGE_USERS"],
  },
  {
    prefix: "/portal/community",
    capabilities: ["COMMUNITY_VIEW", "COMMUNITY_MANAGE"],
  },
  {
    prefix: "/portal/settings",
    capabilities: ["SETTINGS_VIEW", "ADMIN_SETTINGS_VIEW", "SYSTEM_SETTINGS_MANAGE"],
  },
];

function normalizeCapabilityToken(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function flattenCapabilities(value: unknown, bucket: Set<string>, path: string[] = []): void {
  if (typeof value === "string") {
    const normalized = normalizeCapabilityToken(value);
    if (normalized && !["TRUE", "FALSE", "YES", "NO"].includes(normalized)) {
      bucket.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => flattenCapabilities(item, bucket, path));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    const nextPath = [...path, key];
    const keyToken = normalizeCapabilityToken(key);
    const pathToken = normalizeCapabilityToken(nextPath.join("_"));

    if (keyToken) {
      bucket.add(keyToken);
    }

    if (pathToken) {
      bucket.add(pathToken);
    }

    if (typeof nested === "boolean") {
      if (nested) {
        if (keyToken) {
          bucket.add(keyToken);
        }
        if (pathToken) {
          bucket.add(pathToken);
        }
      }
      return;
    }

    flattenCapabilities(nested, bucket, nextPath);
  });
}

export function isAdminOrStaff(input?: AuthUser | UserRole | null): boolean {
  const role = roleFromInput(input);
  return role === "ADMIN" || role === "STAFF";
}

export function hasDesignation(
  user: Pick<AuthUser, "designation"> | null | undefined,
  required: UserDesignation | UserDesignation[],
): boolean {
  if (!user?.designation) {
    return false;
  }

  const requiredList = Array.isArray(required) ? required : [required];
  return requiredList.includes(user.designation);
}

export function getCapabilitiesForDesignation(
  designation: UserDesignation | undefined,
  accessMetadata: AccessMetadata | null | undefined,
): string[] {
  if (!designation || !accessMetadata?.capabilitiesByDesignation) {
    return [];
  }

  const source = accessMetadata.capabilitiesByDesignation;
  const raw =
    source[designation] ||
    source[designation.toUpperCase()] ||
    source[designation.toLowerCase()];

  if (!raw) {
    return [];
  }

  const bucket = new Set<string>();
  flattenCapabilities(raw, bucket);
  return Array.from(bucket);
}

export function hasCapability(
  user: Pick<AuthUser, "role" | "designation"> | null | undefined,
  accessMetadata: AccessMetadata | null | undefined,
  required: string | readonly string[],
  fallbackWhenMetadataMissing = true,
): boolean {
  if (!user || (user.role !== "ADMIN" && user.role !== "STAFF")) {
    return false;
  }

  if (user.role === "ADMIN") {
    return true;
  }

  const requiredList = (Array.isArray(required) ? required : [required])
    .map((item) => normalizeCapabilityToken(item))
    .filter(Boolean);

  if (requiredList.length === 0) {
    return true;
  }

  const capabilities = getCapabilitiesForDesignation(user.designation, accessMetadata);
  if (capabilities.length === 0) {
    return fallbackWhenMetadataMissing;
  }

  const capabilitySet = new Set(capabilities);
  const wildcardTokens = ["*", "ALL", "ALL_CAPABILITIES", "FULL_ACCESS", "SUPER_ADMIN"];
  if (wildcardTokens.some((token) => capabilitySet.has(token))) {
    return true;
  }

  return requiredList.some((capability) => capabilitySet.has(capability));
}

export function canManagePlans(user?: AuthUser | null): boolean {
  return Boolean(user?.role === "ADMIN" && hasDesignation(user, "SUPER_ADMIN"));
}

function hasStrictCapability(
  user: Pick<AuthUser, "role" | "designation"> | null | undefined,
  accessMetadata: AccessMetadata | null | undefined,
  required: string | readonly string[],
): boolean {
  return hasCapability(user, accessMetadata, required, false);
}

export function isGymManager(user?: Pick<AuthUser, "role" | "designation"> | null): boolean {
  return Boolean(user?.role === "STAFF" && user.designation === "GYM_MANAGER");
}

export function canOperatePtSessions(
  user: Pick<AuthUser, "role" | "designation"> | null | undefined,
  accessMetadata?: AccessMetadata | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN" || user.role === "COACH") return true;
  if (isGymManager(user)) return true;
  return hasStrictCapability(user, accessMetadata, [
    "PT_SESSION_OPERATE",
    "PT_SESSION_MANAGE",
    "TRAINING_SESSION_OPERATE",
  ]);
}

export function canManagePtSetup(
  user: Pick<AuthUser, "role" | "designation"> | null | undefined,
  accessMetadata?: AccessMetadata | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return hasStrictCapability(user, accessMetadata, [
    "PT_SETUP_MANAGE",
    "PT_ASSIGNMENT_MANAGE",
    "TRAINING_ASSIGNMENT_MANAGE",
  ]);
}

export function canEditTrainerProfile(
  user: Pick<AuthUser, "role" | "designation"> | null | undefined,
  accessMetadata?: AccessMetadata | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return hasStrictCapability(user, accessMetadata, [
    "TRAINER_MANAGE",
    "COACH_MANAGE",
    "USER_MANAGE",
  ]);
}

export function canAssignTrainerScheduleSlots(
  user: Pick<AuthUser, "role" | "designation"> | null | undefined,
  accessMetadata?: AccessMetadata | null,
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (isGymManager(user)) return true;
  return hasStrictCapability(user, accessMetadata, [
    "TRAINER_SCHEDULE_MANAGE",
    "PT_SLOT_MANAGE",
    "CLASS_SCHEDULE_MANAGE",
  ]);
}

export function canAccessRoute(
  pathname: string,
  user?: AuthUser | null,
  accessMetadata?: AccessMetadata | null,
): boolean {
  return canAccessRouteWithMetadata(pathname, user, accessMetadata);
}

function resolveRouteCapabilities(pathname: string): string[] {
  const sorted = [...ROUTE_CAPABILITY_MAP].sort((a, b) => b.prefix.length - a.prefix.length);
  const matched = sorted.find((routeConfig) => pathname.startsWith(routeConfig.prefix));
  return matched?.capabilities || [];
}

function hasMetadataCapabilities(
  user: AuthUser | null | undefined,
  accessMetadata: AccessMetadata | null | undefined,
): boolean {
  return getCapabilitiesForDesignation(user?.designation, accessMetadata).length > 0;
}

export function canAccessRouteWithMetadata(
  pathname: string,
  user?: AuthUser | null,
  accessMetadata?: AccessMetadata | null,
): boolean {
  if (pathname.startsWith("/admin")) {
    if (!user || !isAdminOrStaff(user)) return false;
    if (user.role === "ADMIN") return true;
    // STAFF can access specific /admin routes based on designation
    if (user.role === "STAFF" && user.designation) {
      const deniedPrefixes = STAFF_DESIGNATION_DENY_PREFIXES[user.designation] || [];
      if (routeMatches(pathname, deniedPrefixes)) {
        return false;
      }
      const allowedPrefixes = STAFF_DESIGNATION_ROUTE_PREFIXES[user.designation] || [];
      return allowedPrefixes.includes("*") || routeMatches(pathname, allowedPrefixes);
    }
    return false;
  }

  if (!pathname.startsWith("/portal") && !pathname.startsWith("/branch-selector")) {
    return true;
  }

  // /portal root is a redirect page — allow any authenticated staff/admin through
  if (pathname === "/portal") {
    return Boolean(user && isAdminOrStaff(user));
  }

  if (!user || !isAdminOrStaff(user)) {
    return false;
  }

  if (user.role === "ADMIN") {
    return true;
  }

  if (!user.designation) {
    return false;
  }

  const deniedPrefixes = STAFF_DESIGNATION_DENY_PREFIXES[user.designation] || [];
  if (routeMatches(pathname, deniedPrefixes)) {
    return false;
  }

  const allowedPrefixes = STAFF_DESIGNATION_ROUTE_PREFIXES[user.designation] || [];
  const designationAllowsRoute = allowedPrefixes.includes("*") || routeMatches(pathname, allowedPrefixes);

  // Designation prefix grants access — no capability veto needed
  if (designationAllowsRoute) {
    return true;
  }

  // Route not in designation's prefix list — check capabilities as fallback grant
  const requiredCapabilities = resolveRouteCapabilities(pathname);
  if (requiredCapabilities.length > 0 && hasMetadataCapabilities(user, accessMetadata)) {
    return hasCapability(user, accessMetadata, requiredCapabilities, false);
  }

  return false;
}
