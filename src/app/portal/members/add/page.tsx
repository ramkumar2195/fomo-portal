"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { GuidedMemberOnboarding } from "@/components/users/guided-member-onboarding";
import { UserOnboardForm } from "@/components/users/user-onboard-form";

const CREATE_MEMBER_CAPABILITIES = [
  "MEMBER_CREATE",
  "MEMBER_ONBOARDING",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
] as const;

export default function AddMemberPage() {
  const searchParams = useSearchParams();
  const sourceInquiryId = useMemo(() => {
    const raw = searchParams.get("sourceInquiryId");
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const prefill = useMemo(
    () => ({
      name: searchParams.get("name") || "",
      mobileNumber: searchParams.get("mobile") || "",
      email: searchParams.get("email") || "",
    }),
    [searchParams],
  );

  if (sourceInquiryId) {
    return <GuidedMemberOnboarding sourceInquiryId={sourceInquiryId} />;
  }

  return (
    <UserOnboardForm
      title="Add Member"
      subtitle="Create member from enquiry convert flow (users/register + inquiries/convert)"
      targetRole="MEMBER"
      designationOptions={[{ label: "MEMBER", value: "MEMBER" }]}
      dataScopeOptions={[{ label: "ASSIGNED_ONLY", value: "ASSIGNED_ONLY" }]}
      requiredCapabilities={CREATE_MEMBER_CAPABILITIES}
      successLabel="Member created successfully."
      initialPrefill={prefill}
      sourceInquiryId={sourceInquiryId}
    />
  );
}
