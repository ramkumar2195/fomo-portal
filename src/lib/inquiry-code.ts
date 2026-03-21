function toSafeNumericId(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toBranchToken(branchCode?: string | null): string {
  const normalized = String(branchCode || "")
    .trim()
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  return normalized || "GEN";
}

function toFinancialYearStartYear(value?: string | number | Date | null): number {
  const reference = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const year = safeDate.getFullYear();
  return safeDate.getMonth() + 1 >= 4 ? year : year - 1;
}

function toFinancialYearShort(value?: string | number | Date | null): string {
  const startYear = toFinancialYearStartYear(value);
  return String(startYear).slice(-2);
}

export function formatInquiryCode(
  inquiryId: number | string,
  options: { branchCode?: string | null; createdAt?: string | number | Date | null } = {},
): string {
  return `ENQ-FOMO-${toBranchToken(options.branchCode)}-${toFinancialYearShort(options.createdAt)}-${String(toSafeNumericId(inquiryId)).padStart(4, "0")}`;
}

export function formatMemberCode(
  sourceInquiryId: number | string,
  options: { branchCode?: string | null; createdAt?: string | number | Date | null } = {},
): string {
  return `MEM-FOMO-${toBranchToken(options.branchCode)}-${toFinancialYearShort(options.createdAt)}-${String(toSafeNumericId(sourceInquiryId)).padStart(4, "0")}`;
}

export function formatFinancialYearLabel(value?: string | number | Date | null): string {
  const startYear = toFinancialYearStartYear(value);
  const endYear = startYear + 1;
  return `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`;
}
