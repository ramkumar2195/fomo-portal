import { apiRequest } from "@/lib/api/http-client";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import {
  AccessMetadata,
  AuthUser,
  DataScope,
  EmploymentType,
  LoginRequest,
  LoginResponse,
  UserDesignation,
  UserRole,
} from "@/types/auth";
import { UserDirectoryItem } from "@/types/models";

const USERS_API_PREFIX = process.env.NEXT_PUBLIC_USERS_API_PREFIX || "/api/users";

interface LoginTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType?: string;
}

interface JwtClaims {
  sub?: string;
  name?: string;
  given_name?: string;
  preferred_username?: string;
  realm_access?: {
    roles?: string[];
  };
}

interface BackendUserPayload {
  id?: string;
  userId?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  mobile?: string;
  mobileNumber?: string;
  phone?: string;
  role?: string;
  roles?: string[];
  employmentType?: string;
  designation?: string;
  dataScope?: string;
  active?: boolean;
  email?: string;
  defaultBranchId?: string | number;
  branchId?: string | number;
  branchCode?: string | number;
}

export interface UserSearchQuery {
  role?: UserRole;
  active?: boolean;
  query?: string;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  [key: string]: string | boolean | undefined;
}

export interface RegisterUserRequest {
  name: string;
  mobileNumber: string;
  password: string;
  role: UserRole;
  email?: string;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  active?: boolean;
}

export interface UpdateUserRequest {
  name?: string;
  mobileNumber?: string;
  password?: string;
  role?: UserRole;
  email?: string;
  employmentType?: EmploymentType;
  designation?: UserDesignation;
  dataScope?: DataScope;
  active?: boolean;
}

const VALID_ROLES: UserRole[] = ["ADMIN", "STAFF", "COACH", "MEMBER"];
const VALID_EMPLOYMENT_TYPES: EmploymentType[] = ["INTERNAL", "VENDOR"];
const VALID_DATA_SCOPES: DataScope[] = ["GLOBAL", "BRANCH", "ASSIGNED_ONLY"];
const VALID_DESIGNATIONS: UserDesignation[] = [
  "SUPER_ADMIN",
  "GYM_MANAGER",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "FRONT_DESK_EXECUTIVE",
  "FITNESS_MANAGER",
  "HEAD_COACH",
  "PT_COACH",
  "YOGA_INSTRUCTOR",
  "ZUMBA_INSTRUCTOR",
  "BOXING_INSTRUCTOR",
  "FREELANCE_TRAINER",
  "MEMBER",
];

const STAFF_DESIGNATIONS = new Set<UserDesignation>([
  "GYM_MANAGER",
  "SALES_MANAGER",
  "SALES_EXECUTIVE",
  "FRONT_DESK_EXECUTIVE",
  "FITNESS_MANAGER",
]);

const COACH_DESIGNATIONS = new Set<UserDesignation>([
  "HEAD_COACH",
  "PT_COACH",
  "YOGA_INSTRUCTOR",
  "ZUMBA_INSTRUCTOR",
  "BOXING_INSTRUCTOR",
  "FREELANCE_TRAINER",
]);

function decodeJwtClaims(accessToken: string): JwtClaims {
  const segments = accessToken.split(".");
  if (segments.length < 2) {
    return {};
  }

  try {
    const base64Url = segments[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    if (typeof globalThis.atob !== "function") {
      return {};
    }

    return JSON.parse(globalThis.atob(padded)) as JwtClaims;
  } catch {
    return {};
  }
}

function normalizeRole(role?: string): UserRole | undefined {
  if (!role) {
    return undefined;
  }

  const normalized = role.toUpperCase() as UserRole;
  return VALID_ROLES.includes(normalized) ? normalized : undefined;
}

function normalizeEmploymentType(value?: string): EmploymentType | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase() as EmploymentType;
  return VALID_EMPLOYMENT_TYPES.includes(normalized) ? normalized : undefined;
}

function normalizeDesignation(value?: string): UserDesignation | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase() as UserDesignation;
  return VALID_DESIGNATIONS.includes(normalized) ? normalized : undefined;
}

function normalizeDataScope(value?: string): DataScope | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase() as DataScope;
  return VALID_DATA_SCOPES.includes(normalized) ? normalized : undefined;
}

function roleFromClaims(claims: JwtClaims): UserRole {
  const roles = (claims.realm_access?.roles || []).map((role) => role.toUpperCase());
  if (roles.includes("ADMIN")) {
    return "ADMIN";
  }

  if (roles.includes("STAFF")) {
    return "STAFF";
  }

  if (roles.includes("COACH")) {
    return "COACH";
  }

  if (roles.includes("MEMBER")) {
    return "MEMBER";
  }

  return "STAFF";
}

function roleFromDesignation(value?: string): UserRole | undefined {
  const designation = normalizeDesignation(value);
  if (!designation) {
    return undefined;
  }

  if (designation === "SUPER_ADMIN") {
    return "ADMIN";
  }

  if (designation === "MEMBER") {
    return "MEMBER";
  }

  if (STAFF_DESIGNATIONS.has(designation)) {
    return "STAFF";
  }

  if (COACH_DESIGNATIONS.has(designation)) {
    return "COACH";
  }

  return undefined;
}

function getUserRole(
  payload: BackendUserPayload,
  fallbackRole?: UserRole,
  fallbackDesignation?: UserDesignation,
): UserRole {
  const roleFromPayload = normalizeRole(payload.role);
  if (roleFromPayload) {
    return roleFromPayload;
  }

  const firstRole = payload.roles
    ?.filter((role): role is string => typeof role === "string")
    .map((role) => normalizeRole(role))
    .find((role): role is UserRole => Boolean(role));

  if (firstRole) {
    return firstRole;
  }

  const roleFromPayloadDesignation = roleFromDesignation(payload.designation);
  if (roleFromPayloadDesignation) {
    return roleFromPayloadDesignation;
  }

  const roleFromFallbackDesignation = roleFromDesignation(fallbackDesignation);
  if (roleFromFallbackDesignation) {
    return roleFromFallbackDesignation;
  }

  return fallbackRole || "STAFF";
}

function mapAuthUser(payload: BackendUserPayload, fallback: Partial<AuthUser> = {}): AuthUser {
  const mobile = payload.mobile || payload.mobileNumber || payload.phone || fallback.mobile || "";
  const name = payload.name || payload.fullName || payload.displayName || fallback.name || "Staff";
  const id = payload.id || payload.userId || fallback.id || mobile || "unknown";
  const role = getUserRole(payload, fallback.role, fallback.designation);
  const designation =
    normalizeDesignation(payload.designation) ||
    fallback.designation ||
    (role === "ADMIN" ? "SUPER_ADMIN" : role === "MEMBER" ? "MEMBER" : undefined);

  return {
    id,
    name,
    mobile,
    role,
    employmentType: normalizeEmploymentType(payload.employmentType) || fallback.employmentType,
    designation,
    dataScope: normalizeDataScope(payload.dataScope) || fallback.dataScope,
    defaultBranchId:
      (payload.defaultBranchId !== undefined
        ? String(payload.defaultBranchId)
        : payload.branchId !== undefined
          ? String(payload.branchId)
          : payload.branchCode !== undefined
            ? String(payload.branchCode)
            : fallback.defaultBranchId) || undefined,
  };
}

function mapDirectoryUser(payload: BackendUserPayload): UserDirectoryItem {
  return {
    id: payload.id || payload.userId || "",
    name: payload.name || payload.fullName || payload.displayName || "Unknown",
    mobile: payload.mobile || payload.mobileNumber || payload.phone || "-",
    role: payload.role || payload.roles?.[0] || "UNKNOWN",
    email: payload.email,
    active: payload.active,
    employmentType: payload.employmentType,
    designation: payload.designation,
    dataScope: payload.dataScope,
  };
}

function mapDirectoryUsers(payload: unknown): UserDirectoryItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((item): item is BackendUserPayload => typeof item === "object" && item !== null)
    .map((item) => mapDirectoryUser(item));
}

export const usersService = {
  async login(payload: LoginRequest): Promise<LoginResponse> {
    const response = await apiRequest<ApiResponse<LoginTokenPayload> | LoginTokenPayload>({
      service: "users",
      path: `${USERS_API_PREFIX}/login`,
      method: "POST",
      body: payload,
    });

    const tokenPayload = unwrapData<LoginTokenPayload>(response);
    if (!tokenPayload.accessToken) {
      throw new Error("Invalid login response: accessToken is missing");
    }

    const claims = decodeJwtClaims(tokenPayload.accessToken);

    return {
      token: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresIn: tokenPayload.expiresIn,
      refreshExpiresIn: tokenPayload.refreshExpiresIn,
      tokenType: tokenPayload.tokenType || "Bearer",
      user: {
        id: claims.sub || payload.mobileNumber,
        name: claims.name || claims.given_name || "Staff",
        mobile: claims.preferred_username || payload.mobileNumber,
        role: roleFromClaims(claims),
      },
    };
  },

  async getMe(token: string, fallback?: Partial<AuthUser>): Promise<AuthUser> {
    const response = await apiRequest<ApiResponse<BackendUserPayload> | BackendUserPayload>({
      service: "users",
      path: `${USERS_API_PREFIX}/me`,
      token,
    });

    return mapAuthUser(unwrapData<BackendUserPayload>(response), fallback);
  },

  async getAccessMetadata(token: string): Promise<AccessMetadata> {
    const response = await apiRequest<ApiResponse<AccessMetadata> | AccessMetadata>({
      service: "users",
      path: `${USERS_API_PREFIX}/metadata/access`,
      token,
    });

    return unwrapData<AccessMetadata>(response);
  },

  async searchMembers(token: string, query: string): Promise<UserDirectoryItem[]> {
    return this.searchUsers(token, {
      role: "MEMBER",
      query,
    });
  },

  async searchUsers(token: string, query: UserSearchQuery = {}): Promise<UserDirectoryItem[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/search`,
      token,
      query,
    });

    return mapDirectoryUsers(unwrapData<unknown>(response));
  },

  async getAllUsers(token: string): Promise<UserDirectoryItem[]> {
    return this.searchUsers(token);
  },

  async getUsersByRole(token: string, role: string): Promise<UserDirectoryItem[]> {
    return this.searchUsers(token, {
      role: normalizeRole(role) || undefined,
    });
  },

  async getUserById(token: string, id: string): Promise<UserDirectoryItem | null> {
    const list = await this.searchUsers(token, { query: id });
    return list.find((item) => item.id === id) || null;
  },

  async registerUser(token: string, payload: RegisterUserRequest): Promise<UserDirectoryItem> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/register`,
      token,
      method: "POST",
      body: payload,
    });

    return mapDirectoryUser(unwrapData<BackendUserPayload>(response));
  },

  async updateUser(token: string, id: string, payload: UpdateUserRequest): Promise<UserDirectoryItem> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "users",
      path: `${USERS_API_PREFIX}/update/${id}`,
      token,
      method: "PUT",
      body: payload,
    });

    return mapDirectoryUser(unwrapData<BackendUserPayload>(response));
  },
};
