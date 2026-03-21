export type ServiceName = "users" | "subscription" | "engagement" | "training" | "notification";

const trimSlash = (value: string): string => value.replace(/\/$/, "");

const getUrl = (value: string | undefined, fallback: string): string =>
  trimSlash(value?.trim() || fallback);

export const apiBaseUrl = getUrl(process.env.NEXT_PUBLIC_API_BASE_URL, "http://localhost:8081");
