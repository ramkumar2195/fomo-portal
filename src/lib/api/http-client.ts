import { serviceBaseUrls, ServiceName } from "@/lib/api/config";
import axios, { AxiosError, Method } from "axios";

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

export async function apiRequest<T>(options: RequestOptions): Promise<T> {
  const { service, path, token, method = "GET", query, body } = options;

  try {
    const response = await axios.request<T>({
      baseURL: serviceBaseUrls[service],
      url: path.startsWith("/") ? path : `/${path}`,
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      params: cleanQuery(query),
      data: body,
    });

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      const status = error.response?.status ?? 500;
      const payload = error.response?.data;
      const message =
        typeof payload === "object" && payload !== null && "message" in payload
          ? String((payload as { message?: unknown }).message)
          : error.message;

      if (typeof window !== "undefined" && shouldTriggerUnauthorized(status, message)) {
        window.dispatchEvent(
          new CustomEvent("fomo:unauthorized", {
            detail: {
              status,
              message,
            },
          }),
        );
      }

      throw new ApiError(message, status, payload);
    }

    const message = error instanceof Error ? error.message : "Request failed";
    throw new ApiError(message, 500, error);
  }
}
