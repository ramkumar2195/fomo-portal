"use client";

import { UserOnboardForm } from "@/components/users/user-onboard-form";

const CREATE_STAFF_CAPABILITIES = [
  "STAFF_CREATE",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
  "ADMIN_MANAGE_USERS",
] as const;

export default function AddStaffPage() {
  return (
    <UserOnboardForm
      title="Add Staff"
      subtitle="Create a STAFF user via users-service register API"
      targetRole="STAFF"
      designationOptions={[
        { label: "GYM_MANAGER", value: "GYM_MANAGER" },
        { label: "SALES_MANAGER", value: "SALES_MANAGER" },
        { label: "SALES_EXECUTIVE", value: "SALES_EXECUTIVE" },
        { label: "FRONT_DESK_EXECUTIVE", value: "FRONT_DESK_EXECUTIVE" },
        { label: "FITNESS_MANAGER", value: "FITNESS_MANAGER" },
      ]}
      dataScopeOptions={[
        { label: "BRANCH", value: "BRANCH" },
        { label: "GLOBAL", value: "GLOBAL" },
      ]}
      requiredCapabilities={CREATE_STAFF_CAPABILITIES}
      successLabel="Staff user created successfully."
    />
  );
}
