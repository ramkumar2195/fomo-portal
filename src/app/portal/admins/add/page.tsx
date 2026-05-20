"use client";

import { UserOnboardForm } from "@/components/users/user-onboard-form";

/**
 * Add-Admin page (DEC-036). Mirrors {@link AddStaffPage} but with
 * targetRole="ADMIN" so the register call lands as
 * {role: "ADMIN", designation: "SUPER_ADMIN", dataScope: "GLOBAL"}.
 *
 * <p>Visibility: SUPER_ADMIN's route prefix is the wildcard, so only
 * SUPER_ADMIN reaches this route; the {@code STAFF_MANAGE} capability
 * (also SUPER_ADMIN-only) belt-and-braces the form-level submit gate.
 */
const CREATE_ADMIN_CAPABILITIES = [
  "STAFF_MANAGE",
  "ADMIN_MANAGE_USERS",
  "USER_MANAGE",
] as const;

export default function AddAdminPage() {
  return (
    <UserOnboardForm
      title="Add Admin"
      subtitle="Create a Super Admin profile with global scope. Reserved for co-owners and platform admins."
      targetRole="ADMIN"
      designationOptions={[
        { label: "SUPER_ADMIN", value: "SUPER_ADMIN" },
      ]}
      dataScopeOptions={[
        { label: "GLOBAL", value: "GLOBAL" },
      ]}
      employmentTypeOptions={[
        { label: "INTERNAL", value: "INTERNAL" },
      ]}
      requiredCapabilities={CREATE_ADMIN_CAPABILITIES}
      successLabel="Admin user created successfully."
    />
  );
}
