import { apiBaseUrl, ServiceName } from "@/lib/api/config";
import { ApiResponse, unwrapData } from "@/lib/api/response";
import { COOKIE_KEYS, STORAGE_KEYS } from "@/lib/constants";
import { pushAuthDebug, tokenPreview } from "@/lib/debug/auth-debug";
import { getFromStorage, saveToStorage, setCookie } from "@/lib/storage";
import axios, { AxiosError, AxiosRequestConfig, Method } from "axios";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type QueryValue = string | number | boolean | null | undefined;

type RequestOptions = {
  service: ServiceName;
  path: string;
  token?: string;
  method?: Method;
  query?: Record<string, QueryValue>;
  body?: unknown;
};

interface RefreshTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
  tokenType?: string;
}

interface FomoAxiosRequestConfig extends AxiosRequestConfig {
  _fomoCanRefresh?: boolean;
  _fomoRetried?: boolean;
}

const USERS_API_PREFIX = process.env.NEXT_PUBLIC_USERS_API_PREFIX || "/api/users";
const LOGIN_PATH = `${USERS_API_PREFIX}/login`;
const REFRESH_PATH = `${USERS_API_PREFIX}/refresh`;

const http = axios.create({
  baseURL: apiBaseUrl,
});

let refreshInFlightPromise: Promise<RefreshTokenPayload> | null = null;

function cleanQuery(query?: Record<string, QueryValue>): Record<string, QueryValue> | undefined {
  if (!query) {
    return undefined;
  }

  const cleaned = Object.entries(query).reduce<Record<string, QueryValue>>((acc, [key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      acc[key] = value;
    }
    return acc;
  }, {});

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function shouldTriggerUnauthorized(status: number, message: string): boolean {
  if (status === 401) {
    return true;
  }

  if (status !== 403) {
    return false;
  }

  return /(unauthor|expired|invalid token|forbidden)/i.test(message);
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function shouldSkipRefresh(path: string): boolean {
  return path === LOGIN_PATH || path === REFRESH_PATH;
}

function dispatchUnauthorized(status: number, message: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("fomo:unauthorized", {
      detail: {
        status,
        message,
      },
    }),
  );
}

function persistRefreshedTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") {
    return;
  }

  saveToStorage(STORAGE_KEYS.token, accessToken);
  saveToStorage(STORAGE_KEYS.refreshToken, refreshToken);
  setCookie(COOKIE_KEYS.token, accessToken);

  window.dispatchEvent(
    new CustomEvent("fomo:token-refreshed", {
      detail: {
        accessToken,
        refreshToken,
      },
    }),
  );
}

function getStoredRefreshToken(): string | null {
  return getFromStorage<string>(STORAGE_KEYS.refreshToken);
}

async function runRefreshTokenFlow(): Promise<RefreshTokenPayload> {
  if (refreshInFlightPromise) {
    return refreshInFlightPromise;
  }

  const storedRefreshToken = getStoredRefreshToken();
  if (!storedRefreshToken) {
    throw new Error("Refresh token missing");
  }

  refreshInFlightPromise = (async () => {
    console.debug("[FOMO-AUTH] refresh start");
    pushAuthDebug("http-client", "refresh:start", {
      refreshTokenPreview: tokenPreview(storedRefreshToken),
    });

    const refreshResponse = await axios.request<ApiResponse<RefreshTokenPayload> | RefreshTokenPayload>({
      baseURL: apiBaseUrl,
      url: REFRESH_PATH,
      method: "POST",
      data: {
        refreshToken: storedRefreshToken,
      },
    });

    const payload = unwrapData<RefreshTokenPayload>(refreshResponse.data);
    if (!payload.accessToken || !payload.refreshToken) {
      throw new Error("Refresh response missing accessToken or refreshToken");
    }

    console.debug("[FOMO-AUTH] refresh success");
    pushAuthDebug("http-client", "refresh:success", {
      tokenPreview: tokenPreview(payload.accessToken),
      refreshTokenPreview: tokenPreview(payload.refreshToken),
      expiresIn: payload.expiresIn,
    });

    return payload;
  })().finally(() => {
    refreshInFlightPromise = null;
  });

  return refreshInFlightPromise;
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status ?? 500;
    const payload = error.response?.data;
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : error.message;

    const config = (error.config || {}) as FomoAxiosRequestConfig;
    const path = normalizePath(typeof config.url === "string" ? config.url : "");
    const canRefresh = config._fomoCanRefresh === true && !shouldSkipRefresh(path);
    const alreadyRetried = config._fomoRetried === true;

    const shouldTryRefresh = (status === 401 || shouldTriggerUnauthorized(status, message)) && canRefresh && !alreadyRetried;

    if (shouldTryRefresh) {
      try {
        const refreshed = await runRefreshTokenFlow();
        persistRefreshedTokens(refreshed.accessToken, refreshed.refreshToken as string);

        config._fomoRetried = true;
        const existingHeaders =
          config.headers && typeof config.headers === "object"
            ? (config.headers as Record<string, string>)
            : {};
        config.headers = {
          ...existingHeaders,
          Authorization: `Bearer ${refreshed.accessToken}`,
        };

        console.debug("[FOMO-AUTH] request retry after refresh", path);
        pushAuthDebug("http-client", "refresh:retry-request", {
          path,
          method: config.method,
        });

        return http.request(config);
      } catch (refreshError) {
        const refreshMessage = refreshError instanceof Error ? refreshError.message : "Token refresh failed";
        console.debug("[FOMO-AUTH] refresh fail", refreshMessage);
        pushAuthDebug("http-client", "refresh:fail", {
          path,
          message: refreshMessage,
        });
        dispatchUnauthorized(401, refreshMessage);
        throw new ApiError(refreshMessage, 401, payload);
      }
    }

    if (typeof window !== "undefined" && shouldTriggerUnauthorized(status, message)) {
      dispatchUnauthorized(status, message);
    }

    throw new ApiError(message, status, payload);
  },
);

export async function apiRequest<T>(options: RequestOptions): Promise<T> {
  const { path, token, method = "GET", query, body } = options;
  const normalizedPath = normalizePath(path);
  const storedAccessToken = getFromStorage<string>(STORAGE_KEYS.token);
  const effectiveToken = token || storedAccessToken || undefined;

  const requestConfig: FomoAxiosRequestConfig = {
    url: normalizedPath,
    method,
    headers: {
      ...(effectiveToken ? { Authorization: `Bearer ${effectiveToken}` } : {}),
    },
    params: cleanQuery(query),
    data: body,
    _fomoCanRefresh: Boolean(effectiveToken) && !shouldSkipRefresh(normalizedPath),
    _fomoRetried: false,
  };

  pushAuthDebug("http-client", "request:start", {
    method,
    baseURL: apiBaseUrl,
    path: normalizedPath,
    hasToken: Boolean(effectiveToken),
    tokenPreview: tokenPreview(effectiveToken),
    queryKeys: query ? Object.keys(query) : [],
  });

  try {
    const response = await http.request<T>(requestConfig);
    pushAuthDebug("http-client", "request:success", {
      method,
      path: normalizedPath,
      status: response.status,
    });

    return response.data;
  } catch (error) {
    if (error instanceof ApiError) {
      pushAuthDebug("http-client", "request:error", {
        method,
        path: normalizedPath,
        status: error.status,
        message: error.message,
      });
      throw error;
    }

    const message = error instanceof Error ? error.message : "Request failed";
    throw new ApiError(message, 500, error);
  }
}
