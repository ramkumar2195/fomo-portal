export interface ApiResponse<T> {
  status?: number;
  success: boolean;
  message: string;
  data: T;
}

function isApiResponse(payload: unknown): payload is ApiResponse<unknown> {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "success" in payload &&
    "message" in payload &&
    "data" in payload
  );
}

export function unwrapData<T>(payload: unknown): T {
  if (isApiResponse(payload)) {
    if (!payload.success) {
      throw new Error(payload.message || "Request failed");
    }

    return payload.data as T;
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }

  return payload as T;
}
