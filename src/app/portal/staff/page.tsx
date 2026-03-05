"use client";

import { UserManagementPage } from "@/components/users/user-management-page";

const STAFF_VIEW_CAPABILITIES = [
  "STAFF_VIEW",
  "STAFF_MANAGE",
  "USER_VIEW",
  "USER_MANAGE",
  "ADMIN_MANAGE_USERS",
] as const;

const STAFF_UPDATE_CAPABILITIES = [
  "STAFF_UPDATE",
  "STAFF_MANAGE",
  "USER_UPDATE",
  "USER_MANAGE",
  "ADMIN_MANAGE_USERS",
] as const;

const STAFF_CREATE_CAPABILITIES = [
  "STAFF_CREATE",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
  "ADMIN_MANAGE_USERS",
] as const;

export default function StaffPage() {
  return (
    <UserManagementPage
      role="STAFF"
      title="Staff Management"
      subtitle="View, filter and manage staff users"
      addHref="/portal/staff/add"
      addLabel="Add Staff"
      designationOptions={[
        { label: "GYM_MANAGER", value: "GYM_MANAGER" },
        { label: "SALES_MANAGER", value: "SALES_MANAGER" },
        { label: "SALES_EXECUTIVE", value: "SALES_EXECUTIVE" },
        { label: "FRONT_DESK_EXECUTIVE", value: "FRONT_DESK_EXECUTIVE" },
        { label: "FITNESS_MANAGER", value: "FITNESS_MANAGER" },
      ]}
      requiredViewCapabilities={STAFF_VIEW_CAPABILITIES}
      requiredUpdateCapabilities={STAFF_UPDATE_CAPABILITIES}
      requiredCreateCapabilities={STAFF_CREATE_CAPABILITIES}
      leaveTitle="Staff Leave Approvals"
      leaveSubtitle="Approve/reject staff leave requests"
    />
  );
}
