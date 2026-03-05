export type ServiceName = "users" | "subscription" | "engagement" | "training" | "notification";

const trimSlash = (value: string): string => value.replace(/\/$/, "");

const getUrl = (value: string | undefined, fallback: string): string =>
  trimSlash(value?.trim() || fallback);

export const serviceBaseUrls: Record<ServiceName, string> = {
  users: getUrl(process.env.NEXT_PUBLIC_USERS_SERVICE_URL, "http://localhost:8082"),
  subscription: getUrl(
    process.env.NEXT_PUBLIC_SUBSCRIPTION_SERVICE_URL,
    "http://localhost:8084",
  ),
  engagement: getUrl(process.env.NEXT_PUBLIC_ENGAGEMENT_SERVICE_URL, "http://localhost:8083"),
  training: getUrl(process.env.NEXT_PUBLIC_TRAINING_SERVICE_URL, "http://localhost:8085"),
  notification: getUrl(process.env.NEXT_PUBLIC_NOTIFICATION_SERVICE_URL, "http://localhost:8086"),
};
