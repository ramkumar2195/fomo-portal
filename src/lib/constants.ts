export const STORAGE_KEYS = {
  token: "fomo.token",
  refreshToken: "fomo.refreshToken",
  user: "fomo.user",
  accessMetadata: "fomo.accessMetadata",
  selectedBranchId: "fomo.branchId",
} as const;

export const COOKIE_KEYS = {
  token: "fomo_token",
  role: "fomo_role",
  designation: "fomo_designation",
  branchId: "fomo_branch",
} as const;

export const GST_DEFAULT_PERCENT = 18;
export const TRAINER_SESSION_LIMIT = 20;
