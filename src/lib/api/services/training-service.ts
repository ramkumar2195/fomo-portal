import { ApiError, apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";
import { TrainingProgramSummary } from "@/types/admin";
import { ClassScheduleItem } from "@/types/models";
import {
  CompleteAssessmentRequest,
  MemberAssessmentHistoryEntry,
  MemberAssessmentStatusResponse,
} from "@/types/member-profile";
import { SpringPage } from "@/types/pagination";

interface JsonRecord {
  [key: string]: unknown;
}

export interface ClassScheduleListQuery {
  branchCode?: string;
  trainerId?: string | number;
  classType?: string;
  from?: string;
  to?: string;
  active?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface ProgramWriteRequest {
  [key: string]: unknown;
}

export interface ProgramStatusRequest {
  status: string;
}

export interface TrainerAvailabilityRequest {
  [key: string]: unknown;
}

export interface PtBookingRequest {
  [key: string]: unknown;
}

export interface ClientAssignmentRequest {
  memberId: number;
  memberEmail: string;
  coachId: number;
  coachEmail: string;
  trainingType: "GENERAL" | "PERSONAL_TRAINING";
  startDate: string;
  endDate?: string;
}

function toRecord(payload: unknown): JsonRecord {
  return typeof payload === "object" && payload !== null ? (payload as JsonRecord) : {};
}

function toString(payload: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }

  return "";
}

function toNumber(payload: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function toBoolean(payload: JsonRecord, keys: string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
  }

  return false;
}

function toOptionalNumber(payload: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function toOptionalString(payload: JsonRecord, keys: string[]): string | undefined {
  const value = toString(payload, keys);
  return value || undefined;
}

function mapAssessmentStatus(payload: unknown): MemberAssessmentStatusResponse {
  const record = toRecord(payload);
  return {
    ...record,
    workflowId: toOptionalString(record, ["workflowId", "id"]),
    required: record.required === undefined ? undefined : toBoolean(record, ["required"]),
    requested: record.requested === undefined ? undefined : toBoolean(record, ["requested"]),
    skipped: record.skipped === undefined ? undefined : toBoolean(record, ["skipped"]),
    completed: record.completed === undefined ? undefined : toBoolean(record, ["completed"]),
    status: toOptionalString(record, ["status"]),
    requestId: toOptionalString(record, ["requestId"]),
    assignedCoachId: toOptionalString(record, ["assignedCoachId", "coachId"]),
    assignedCoachName: toOptionalString(record, ["assignedCoachName", "coachName"]),
    scheduledAt: toOptionalString(record, ["scheduledAt"]),
    completedAt: toOptionalString(record, ["completedAt"]),
    score: toOptionalNumber(record, ["score"]),
    category: toOptionalString(record, ["category"]) as MemberAssessmentStatusResponse["category"],
    classification: toOptionalString(record, ["classification"]),
  };
}

function mapAssessmentHistory(payload: unknown): MemberAssessmentHistoryEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item) => {
    const record = toRecord(item);
    return {
      workflowId: toOptionalString(record, ["workflowId", "id"]),
      requestId: toOptionalString(record, ["requestId"]),
      status: toOptionalString(record, ["status"]),
      assignedCoachId: toOptionalString(record, ["assignedCoachId", "coachId"]),
      assignedCoachName: toOptionalString(record, ["assignedCoachName", "coachName"]),
      scheduledAt: toOptionalString(record, ["scheduledAt"]),
      completedAt: toOptionalString(record, ["completedAt"]),
      score: toOptionalNumber(record, ["score"]),
      category: toOptionalString(record, ["category"]) as MemberAssessmentHistoryEntry["category"],
      classification: toOptionalString(record, ["classification"]),
      raw: record,
    };
  });
}

function mapClassSchedule(payload: unknown, index: number): ClassScheduleItem {
  const record = toRecord(payload);
  return {
    id: toString(record, ["id", "scheduleId"]) || `schedule-${index}`,
    className: toString(record, ["className", "name", "title"]) || "Class",
    startTime: toString(record, ["startTime", "startsAt", "fromTime"]),
    endTime: toString(record, ["endTime", "endsAt", "toTime"]),
    trainerName: toString(record, ["trainerName", "coachName", "assignedTrainer"]) || "-",
    occupancy: toNumber(record, ["occupancy", "bookedCount", "currentOccupancy"]),
    capacity: toNumber(record, ["capacity", "maxCapacity", "slotCount"]),
    trainerId: toString(record, ["trainerId", "assignedTrainerId"]) || undefined,
    notes: toString(record, ["notes", "description"]) || undefined,
    active: toBoolean(record, ["active", "enabled"]),
  };
}

function ensureClassScheduleArray(payload: unknown): ClassScheduleItem[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload.map((item, index) => mapClassSchedule(item, index));
}

function mapProgramSummary(payload: unknown, index: number): TrainingProgramSummary {
  const record = toRecord(payload);
  return {
    id: toString(record, ["id", "programId"]) || `program-${index}`,
    name: toString(record, ["name", "programName"]) || `Program ${index + 1}`,
    description: toOptionalString(record, ["description"]),
    status: toString(record, ["status"]) || undefined,
    duration: toString(record, ["duration", "durationLabel"]) || undefined,
    durationWeeks: toOptionalNumber(record, ["durationWeeks"]),
    trainerId: toString(record, ["trainerId", "coachId"]) || undefined,
    trainerName: toString(record, ["trainerName", "coachName"]) || undefined,
    branchId: toOptionalNumber(record, ["branchId"]),
    membersEnrolled: toOptionalNumber(record, ["membersEnrolled", "enrolledMembers", "memberCount"]),
    maxCapacity: toOptionalNumber(record, ["maxCapacity", "capacity"]),
    completionRate: toOptionalNumber(record, ["completionRate"]),
    createdAt: toString(record, ["createdAt"]) || undefined,
    updatedAt: toString(record, ["updatedAt"]) || undefined,
  };
}

function mapPageRecord<T>(payload: unknown, mapper: (item: unknown, index: number) => T): SpringPage<T> {
  const record = toRecord(payload);
  const rawContent = Array.isArray(record.content) ? record.content : [];

  return {
    content: rawContent.map((item, index) => mapper(item, index)),
    number: toNumber(record, ["number"]),
    size: toNumber(record, ["size"]),
    totalElements: toNumber(record, ["totalElements"]),
    totalPages: toNumber(record, ["totalPages"]),
    first: toBoolean(record, ["first"]),
    last: toBoolean(record, ["last"]),
    empty: toBoolean(record, ["empty"]),
    numberOfElements: toOptionalNumber(record, ["numberOfElements"]),
  };
}

function ensureArray(payload: unknown): unknown[] {
  return Array.isArray(payload) ? payload : [];
}

export const trainingService = {
  async createAssignment(token: string, payload: ClientAssignmentRequest): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: "/api/training/assignments",
      token,
      method: "POST",
      body: payload,
    });

    return unwrapData<unknown>(response);
  },

  async getMemberAssignments(token: string, memberId: string): Promise<unknown[]> {
    try {
      const response = await apiRequest<unknown | { data: unknown }>({
        service: "training",
        path: `/api/training/assignments/member/${memberId}`,
        token,
      });

      const payload = unwrapData<unknown>(response);
      return Array.isArray(payload) ? payload : [];
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return [];
      }
      throw error;
    }
  },

  async getPtSessionsByAssignment(token: string, assignmentId: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/pt-sessions/assignment/${assignmentId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async listPrograms(token: string, page = 0, size = 20, branchId?: number | string): Promise<SpringPage<TrainingProgramSummary>> {
    const query: Record<string, string | number | boolean | null | undefined> = { page, size };
    if (branchId !== undefined) {
      query.branchId = Number(branchId);
    }
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: "/api/training/programs",
      token,
      query,
    });

    return mapPageRecord(unwrapData<unknown>(response), mapProgramSummary);
  },

  async createProgram(token: string, payload: ProgramWriteRequest): Promise<TrainingProgramSummary> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: "/api/training/programs",
      token,
      method: "POST",
      body: payload,
    });

    return mapProgramSummary(unwrapData<unknown>(response), 0);
  },

  async getProgram(token: string, programId: string | number): Promise<TrainingProgramSummary> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}`,
      token,
    });

    return mapProgramSummary(unwrapData<unknown>(response), 0);
  },

  async updateProgram(
    token: string,
    programId: string | number,
    payload: ProgramWriteRequest,
  ): Promise<TrainingProgramSummary> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}`,
      token,
      method: "PUT",
      body: payload,
    });

    return mapProgramSummary(unwrapData<unknown>(response), 0);
  },

  async patchProgramStatus(
    token: string,
    programId: string | number,
    payload: ProgramStatusRequest,
  ): Promise<TrainingProgramSummary> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}/status`,
      token,
      method: "PATCH",
      body: payload,
    });

    return mapProgramSummary(unwrapData<unknown>(response), 0);
  },

  async enrollProgramMember(token: string, programId: string | number, memberId: string | number): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}/enroll/${memberId}`,
      token,
      method: "POST",
      body: {},
    });

    return unwrapData<unknown>(response);
  },

  async listProgramMembers(
    token: string,
    programId: string | number,
    page = 0,
    size = 20,
  ): Promise<SpringPage<unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}/members`,
      token,
      query: {
        page,
        size,
      },
    });

    return mapPageRecord(unwrapData<unknown>(response), (item) => item);
  },

  async removeProgramMember(token: string, programId: string | number, memberId: string | number): Promise<void> {
    await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}/members/${memberId}`,
      token,
      method: "DELETE",
    });
  },

  async getProgramProgress(token: string, programId: string | number): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/programs/${programId}/progress`,
      token,
    });

    return unwrapData<unknown>(response);
  },

  async getCoachPerformance(token: string, coachId: string | number): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/coaches/${coachId}/performance`,
      token,
    });

    return unwrapData<unknown>(response);
  },

  async getTrainerAvailability(
    token: string,
    trainerId: string | number,
    page = 0,
    size = 20,
  ): Promise<SpringPage<unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/trainers/${trainerId}/availability`,
      token,
      query: {
        page,
        size,
      },
    });

    return mapPageRecord(unwrapData<unknown>(response), (item) => item);
  },

  async createTrainerAvailability(
    token: string,
    trainerId: string | number,
    payload: TrainerAvailabilityRequest,
  ): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/trainers/${trainerId}/availability`,
      token,
      method: "POST",
      body: payload,
    });

    return unwrapData<unknown>(response);
  },

  async getPtCalendar(
    token: string,
    trainerId: string | number,
    page = 0,
    size = 20,
  ): Promise<SpringPage<unknown>> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/pt/calendar/${trainerId}`,
      token,
      query: {
        page,
        size,
      },
    });

    return mapPageRecord(unwrapData<unknown>(response), (item) => item);
  },

  async bookPt(token: string, payload: PtBookingRequest): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: "/api/training/pt/book",
      token,
      method: "POST",
      body: payload,
    });

    return unwrapData<unknown>(response);
  },

  async cancelPtSession(token: string, sessionId: string | number): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/pt/cancel/${sessionId}`,
      token,
      method: "POST",
      body: {},
    });

    return unwrapData<unknown>(response);
  },

  async getCoachAssignments(token: string, coachId: string | number): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assignments/coach/${coachId}`,
      token,
    });

    return ensureArray(unwrapData<unknown>(response));
  },

  async getMemberWorkoutLogPerformance(token: string, memberId: string | number): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/performance/workout-logs/member/${memberId}`,
      token,
    });

    return ensureArray(unwrapData<unknown>(response));
  },

  async getMemberActivePrograms(token: string, memberId: string | number): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/performance/programs/member/${memberId}/active`,
      token,
    });

    return ensureArray(unwrapData<unknown>(response));
  },

  async requestMemberAssessment(token: string, memberId: string | number): Promise<MemberAssessmentStatusResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/member/${memberId}/request`,
      token,
      method: "POST",
      body: {},
    });

    return mapAssessmentStatus(unwrapData<unknown>(response));
  },

  async skipMemberAssessment(token: string, memberId: string | number): Promise<MemberAssessmentStatusResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/member/${memberId}/skip`,
      token,
      method: "POST",
      body: {},
    });

    return mapAssessmentStatus(unwrapData<unknown>(response));
  },

  async scheduleAssessment(
    token: string,
    workflowId: string | number,
    payload: Record<string, unknown>,
  ): Promise<MemberAssessmentStatusResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/${workflowId}/schedule`,
      token,
      method: "POST",
      body: payload,
    });

    return mapAssessmentStatus(unwrapData<unknown>(response));
  },

  async completeAssessment(
    token: string,
    workflowId: string | number,
    payload: CompleteAssessmentRequest,
  ): Promise<MemberAssessmentStatusResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/${workflowId}/complete`,
      token,
      method: "POST",
      body: payload,
    });

    return mapAssessmentStatus(unwrapData<unknown>(response));
  },

  async getCoachAssessmentQueue(token: string, coachId: string | number): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/coach/${coachId}/queue`,
      token,
    });

    return ensureArray(unwrapData<unknown>(response));
  },

  async getMemberAssessmentStatus(
    token: string,
    memberId: string | number,
  ): Promise<MemberAssessmentStatusResponse> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/member/${memberId}/status`,
      token,
    });

    return mapAssessmentStatus(unwrapData<unknown>(response));
  },

  async getMemberAssessments(token: string, memberId: string | number): Promise<MemberAssessmentHistoryEntry[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assessments/member/${memberId}`,
      token,
    });

    return mapAssessmentHistory(unwrapData<unknown>(response));
  },

  async listClassSchedules(token: string, query: ClassScheduleListQuery = {}): Promise<ClassScheduleItem[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: "/api/training/class-schedules",
      token,
      query,
    });

    return ensureClassScheduleArray(unwrapData<unknown>(response));
  },

  async createClassSchedule(token: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: "/api/training/class-schedules",
      method: "POST",
      token,
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  async updateClassSchedule(token: string, scheduleId: number | string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/class-schedules/${scheduleId}`,
      method: "PATCH",
      token,
      body: payload,
    });
    return unwrapData<unknown>(response);
  },

  async deleteClassSchedule(token: string, scheduleId: number | string): Promise<unknown> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/class-schedules/${scheduleId}`,
      method: "DELETE",
      token,
    });
    return unwrapData<unknown>(response);
  },
};
