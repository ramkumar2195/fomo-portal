"use client";

import { UserManagementPage } from "@/components/users/user-management-page";

const TRAINER_VIEW_CAPABILITIES = [
  "TRAINER_VIEW",
  "TRAINER_MANAGE",
  "COACH_VIEW",
  "COACH_MANAGE",
  "USER_VIEW",
  "USER_MANAGE",
] as const;

const TRAINER_UPDATE_CAPABILITIES = [
  "TRAINER_UPDATE",
  "TRAINER_MANAGE",
  "COACH_UPDATE",
  "COACH_MANAGE",
  "USER_UPDATE",
  "USER_MANAGE",
] as const;

const TRAINER_CREATE_CAPABILITIES = [
  "TRAINER_CREATE",
  "COACH_CREATE",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
] as const;

export default function TrainersPage() {
  return (
    <UserManagementPage
      role="COACH"
      title="Trainer Management"
      subtitle="View, filter and manage trainer users"
      addHref="/portal/trainers/add"
      addLabel="Add Trainer"
      designationOptions={[
        { label: "HEAD_COACH", value: "HEAD_COACH" },
        { label: "PT_COACH", value: "PT_COACH" },
        { label: "YOGA_INSTRUCTOR", value: "YOGA_INSTRUCTOR" },
        { label: "ZUMBA_INSTRUCTOR", value: "ZUMBA_INSTRUCTOR" },
        { label: "BOXING_INSTRUCTOR", value: "BOXING_INSTRUCTOR" },
        { label: "FREELANCE_TRAINER", value: "FREELANCE_TRAINER" },
      ]}
      requiredViewCapabilities={TRAINER_VIEW_CAPABILITIES}
      requiredUpdateCapabilities={TRAINER_UPDATE_CAPABILITIES}
      requiredCreateCapabilities={TRAINER_CREATE_CAPABILITIES}
      leaveTitle="Trainer Leave Approvals"
      leaveSubtitle="Approve/reject trainer leave requests"
      showClientAttendance
    />
  );
}
