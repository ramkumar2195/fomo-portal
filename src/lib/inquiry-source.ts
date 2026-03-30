export function normalizeInquirySourceLabel(source?: string): string {
  const raw = String(source || "").trim();
  if (!raw) {
    return "Other";
  }

  const normalized = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return "Other";
  }

  if (normalized === "walk in" || normalized === "walkin") {
    return "Walk-in";
  }

  if (
    normalized === "unknown" ||
    normalized === "other" ||
    normalized === "others" ||
    normalized === "na" ||
    normalized === "n a" ||
    normalized === "none" ||
    normalized === "unspecified"
  ) {
    return "Other";
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
