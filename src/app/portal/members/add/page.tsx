"use client";

import { UserOnboardForm } from "@/components/users/user-onboard-form";

const CREATE_MEMBER_CAPABILITIES = [
  "MEMBER_CREATE",
  "MEMBER_ONBOARDING",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
] as const;

export default function AddMemberPage() {
  return (
    <UserOnboardForm
      title="Add Member"
      subtitle="Create a MEMBER user via users-service register API"
      targetRole="MEMBER"
      designationOptions={[{ label: "MEMBER", value: "MEMBER" }]}
      dataScopeOptions={[{ label: "ASSIGNED_ONLY", value: "ASSIGNED_ONLY" }]}
      requiredCapabilities={CREATE_MEMBER_CAPABILITIES}
      successLabel="Member created successfully."
    />
  );
}
