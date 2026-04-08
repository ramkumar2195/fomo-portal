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
        { label: "PT Coach", value: "PT_COACH" },
        { label: "General Trainer", value: "GENERAL_TRAINER" },
        { label: "Yoga Instructor", value: "YOGA_INSTRUCTOR" },
        { label: "Zumba Instructor", value: "ZUMBA_INSTRUCTOR" },
        { label: "Boxing Instructor", value: "BOXING_INSTRUCTOR" },
        { label: "Freelance Trainer", value: "FREELANCE_TRAINER" },
      ]}
      requiredViewCapabilities={TRAINER_VIEW_CAPABILITIES}
      requiredUpdateCapabilities={TRAINER_UPDATE_CAPABILITIES}
      requiredCreateCapabilities={TRAINER_CREATE_CAPABILITIES}
      leaveTitle="Trainer Leave Approvals"
      leaveSubtitle="Approve/reject trainer leave requests"
      profileRoute="/portal/trainers"
    />
  );
}
