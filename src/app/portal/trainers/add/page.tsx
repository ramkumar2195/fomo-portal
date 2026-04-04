"use client";

import { UserOnboardForm } from "@/components/users/user-onboard-form";

const CREATE_TRAINER_CAPABILITIES = [
  "TRAINER_CREATE",
  "COACH_CREATE",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
] as const;

export default function AddTrainerPage() {
  return (
    <UserOnboardForm
      title="Add Trainer"
      subtitle="Create a COACH user via users-service register API"
      targetRole="COACH"
      designationOptions={[
        { label: "PT_COACH", value: "PT_COACH" },
        { label: "GENERAL_TRAINER", value: "GENERAL_TRAINER" },
        { label: "YOGA_INSTRUCTOR", value: "YOGA_INSTRUCTOR" },
        { label: "ZUMBA_INSTRUCTOR", value: "ZUMBA_INSTRUCTOR" },
        { label: "BOXING_INSTRUCTOR", value: "BOXING_INSTRUCTOR" },
        { label: "FREELANCE_TRAINER", value: "FREELANCE_TRAINER" },
      ]}
      dataScopeOptions={[
        { label: "ASSIGNED_ONLY", value: "ASSIGNED_ONLY" },
        { label: "BRANCH", value: "BRANCH" },
      ]}
      requiredCapabilities={CREATE_TRAINER_CAPABILITIES}
      successLabel="Trainer created successfully."
    />
  );
}
