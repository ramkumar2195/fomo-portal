const DEBUG_STORAGE_KEY = "fomo.authDebugLogs";
const MAX_DEBUG_ENTRIES = 200;

interface DebugPayload {
  [key: string]: unknown;
}

export interface AuthDebugEntry {
  timestamp: string;
  source: string;
  event: string;
  payload?: DebugPayload;
}

function canUseBrowserApis(): boolean {
  return typeof window !== "undefined";
}

export function isAuthDebugEnabled(): boolean {
  if (!canUseBrowserApis()) {
    return false;
  }

  const localOverride = window.localStorage.getItem("fomo.debug");
  if (localOverride === "1") {
    return true;
  }

  if (localOverride === "0") {
    return false;
  }

  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEBUG_AUTH === "true";
}

function readRawLogs(): AuthDebugEntry[] {
  if (!canUseBrowserApis()) {
    return [];
  }

  const raw = window.sessionStorage.getItem(DEBUG_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed as AuthDebugEntry[];
  } catch {
    return [];
  }
}

function writeRawLogs(entries: AuthDebugEntry[]): void {
  if (!canUseBrowserApis()) {
    return;
  }

  window.sessionStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_DEBUG_ENTRIES)));
}

export function getAuthDebugLogs(): AuthDebugEntry[] {
  return readRawLogs();
}

export function clearAuthDebugLogs(): void {
  if (!canUseBrowserApis()) {
    return;
  }

  window.sessionStorage.removeItem(DEBUG_STORAGE_KEY);
}

export function pushAuthDebug(source: string, event: string, payload?: DebugPayload): void {
  if (!isAuthDebugEnabled()) {
    return;
  }

  const entry: AuthDebugEntry = {
    timestamp: new Date().toISOString(),
    source,
    event,
    payload,
  };

  const current = readRawLogs();
  current.push(entry);
  writeRawLogs(current);

  console.log(`[FOMO-AUTH-DEBUG] ${entry.timestamp} ${source}:${event}`, payload || {});
}

export function tokenPreview(token?: string | null): string {
  if (!token) {
    return "";
  }

  const start = token.slice(0, 16);
  const end = token.slice(-8);
  return `${start}...${end}`;
}

export function maskMobile(mobile?: string): string {
  if (!mobile) {
    return "";
  }

  if (mobile.length <= 4) {
    return mobile;
  }

  const start = mobile.slice(0, 2);
  const end = mobile.slice(-2);
  return `${start}${"*".repeat(Math.max(0, mobile.length - 4))}${end}`;
}
