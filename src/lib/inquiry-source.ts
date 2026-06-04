export function normalizeInquirySourceLabel(source?: string): string {
  const raw = String(source || "").trim();
  // B-3 fix: return empty string instead of "Other" when source is unknown
  // or missing. Half the YDL-migrated rows carry empty/UNKNOWN promotion_source
  // and rendering "Other" for hundreds of leads is just noise that pollutes
  // analytics. Callers already render a "-" dash when this returns "".
  if (!raw) {
    return "";
  }

  const normalized = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return "";
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
    return "";
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
