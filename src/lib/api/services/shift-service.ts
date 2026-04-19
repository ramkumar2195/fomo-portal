import { apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";

/**
 * Shift management API client. Wraps users-service's /api/shifts/*
 * endpoints — the Phase 1 backend for the FOMO roster (see Shift Structure
 * document). Three surfaces:
 *
 *   - Shift definitions (named templates like "PT Standard Split"). Admin
 *     edits them via the Shifts settings page.
 *   - Staff assignments (staff × day-of-week → shift). Upsert one row at a
 *     time; null shiftDefinitionId means "OFF".
 *   - Expected-shift lookup — feeds the compliance columns on the
 *     gym-attendance register. Bulk variant avoids N round-trips per page.
 */

export type ShiftType = "STRAIGHT" | "SPLIT";
export type AssignmentSource = "DEFAULT" | "ROTATION" | "OVERRIDE";
export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface ShiftBlockDto {
  id?: number;
  blockIndex: number;
  startTime: string;       // "HH:mm" (LocalTime serialised)
  endTime: string;
  graceMinutes?: number | null;
}

export interface ShiftDefinitionDto {
  id?: number;
  code: string;
  name: string;
  branchId?: number;
  shiftType: ShiftType;
  totalHours?: string;
  description?: string | null;
  active?: boolean;
  blocks: ShiftBlockDto[];
}

export interface StaffShiftAssignmentDto {
  id?: number;
  staffId: number;
  staffName?: string | null;
  dayOfWeek: DayOfWeek;
  shiftDefinitionId?: number | null;  // null = OFF that day
  shiftCode?: string | null;
  shiftName?: string | null;
  effectiveFrom: string;               // YYYY-MM-DD
  effectiveTo?: string | null;
  source?: AssignmentSource;
  notes?: string | null;
}

export interface ExpectedShiftBlockDto {
  blockIndex: number;
  startAt: string;   // ISO local date-time, no offset
  endAt: string;
  graceMinutes?: number | null;
}

export interface ExpectedShiftDto {
  staffId: number;
  date: string;
  off: boolean;
  shiftCode?: string | null;
  shiftName?: string | null;
  shiftType?: ShiftType | null;
  blocks?: ExpectedShiftBlockDto[];
  expectedInAt?: string | null;
  expectedOutAt?: string | null;
}

export const shiftService = {
  async listDefinitions(token: string, branchId?: number): Promise<ShiftDefinitionDto[]> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/definitions`,
      token,
      query: branchId != null ? { branchId } : undefined,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? (payload as ShiftDefinitionDto[]) : [];
  },

  async getDefinition(token: string, id: number): Promise<ShiftDefinitionDto | null> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/definitions/${id}`,
      token,
    });
    const payload = unwrapData<unknown>(response);
    return payload && typeof payload === "object" ? (payload as ShiftDefinitionDto) : null;
  },

  async createDefinition(token: string, body: ShiftDefinitionDto): Promise<ShiftDefinitionDto> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/definitions`,
      method: "POST",
      token,
      body,
    });
    return unwrapData<ShiftDefinitionDto>(response);
  },

  async updateDefinition(token: string, id: number, body: ShiftDefinitionDto): Promise<ShiftDefinitionDto> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/definitions/${id}`,
      method: "PATCH",
      token,
      body,
    });
    return unwrapData<ShiftDefinitionDto>(response);
  },

  async deactivateDefinition(token: string, id: number): Promise<void> {
    await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/definitions/${id}`,
      method: "DELETE",
      token,
    });
  },

  async listAssignmentsForStaff(token: string, staffId: number): Promise<StaffShiftAssignmentDto[]> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/assignments/staff/${staffId}`,
      token,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? (payload as StaffShiftAssignmentDto[]) : [];
  },

  async upsertAssignment(token: string, body: StaffShiftAssignmentDto): Promise<StaffShiftAssignmentDto> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/assignments`,
      method: "POST",
      token,
      body,
    });
    return unwrapData<StaffShiftAssignmentDto>(response);
  },

  async getExpectedShift(token: string, staffId: number, date: string): Promise<ExpectedShiftDto | null> {
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/expected`,
      token,
      query: { staffId, date },
    });
    const payload = unwrapData<unknown>(response);
    return payload && typeof payload === "object" ? (payload as ExpectedShiftDto) : null;
  },

  /**
   * Bulk lookup for the compliance columns on /portal/gym-attendance.
   * Pass the list of (staffId, date) pairs in one call; get back the same
   * list of expected-shift results in order. Prefer this over N individual
   * calls when rendering a register of >5 rows.
   */
  async getExpectedShiftsBulk(
    token: string,
    pairs: Array<{ staffId: number; date: string }>,
  ): Promise<ExpectedShiftDto[]> {
    if (pairs.length === 0) return [];
    const response = await apiRequest<unknown>({
      service: "users",
      path: `/api/shifts/expected/bulk`,
      method: "POST",
      token,
      body: pairs,
    });
    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? (payload as ExpectedShiftDto[]) : [];
  },
};
