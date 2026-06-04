export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatPercent(value: number): string {
  return `${(value || 0).toFixed(1)}%`;
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * B-11 fix: date-only formatter for fields like sub end_date / start_date /
 * expiry dates where the underlying value is stored as a `date` (no time
 * component) but JS hydrates it as midnight UTC and then formatDateTime
 * renders "5:30 am" via the IST timezone offset. Use this whenever the
 * intent is "show a calendar date" and there's no real time meaning.
 */
export function formatDateOnly(value?: string): string {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-IN", {
    dateStyle: "medium",
  });
}

export function toDateTimeLocalInput(value?: string): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const timezoneOffsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}
