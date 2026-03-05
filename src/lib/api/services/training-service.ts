import { apiRequest } from "@/lib/api/http-client";
import { unwrapData } from "@/lib/api/response";

export const trainingService = {
  async getMemberAssignments(token: string, memberId: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/assignments/member/${memberId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
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

  async getWorkoutPlansByAssignment(token: string, assignmentId: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/workout-plans/${assignmentId}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },

  async getConversation(token: string, user1: string, user2: string): Promise<unknown[]> {
    const response = await apiRequest<unknown | { data: unknown }>({
      service: "training",
      path: `/api/training/chat/conversation/${user1}/${user2}`,
      token,
    });

    const payload = unwrapData<unknown>(response);
    return Array.isArray(payload) ? payload : [];
  },
};
