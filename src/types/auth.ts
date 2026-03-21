export type UserRole = "ADMIN" | "STAFF" | "COACH" | "MEMBER";

export type EmploymentType = "INTERNAL" | "VENDOR";

export type UserDesignation =
  | "SUPER_ADMIN"
  | "GYM_MANAGER"
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE"
  | "FRONT_DESK_EXECUTIVE"
  | "FITNESS_MANAGER"
  | "HEAD_COACH"
  | "PT_COACH"
  | "YOGA_INSTRUCTOR"
  | "ZUMBA_INSTRUCTOR"
  | "BOXING_INSTRUCTOR"
  | "FREELANCE_TRAINER"
  | "MEMBER";

export type DataScope = "GLOBAL" | "BRANCH" | "ASSIGNED_ONLY";

export type DesignationCapabilities = Record<string, unknown>;

export interface AccessMetadata {
  roles?: UserRole[];
  employmentTypes?: EmploymentType[];
  designations?: UserDesignation[];
  dataScopes?: DataScope[];
  capabilitiesByDesignation?: Record<string, DesignationCapabilities | string[]>;
  [key: string]: unknown;
}

export interface AuthUser {
  id: string;
  name: string;
  mobile: string;
  role: UserRole;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  defaultBranchId?: string;
}

export interface LoginRequest {
  mobileNumber: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  refreshToken: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType?: string;
  user: AuthUser;
}
