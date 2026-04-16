"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasCapability } from "@/lib/access-policy";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { RegisterUserRequest, usersService } from "@/lib/api/services/users-service";
import { DataScope, EmploymentType, UserDesignation, UserRole } from "@/types/auth";
import { UserDirectoryItem } from "@/types/models";

interface ToastState {
  kind: "success" | "error";
  message: string;
}

interface Option<T extends string> {
  label: string;
  value: T;
}

interface UserOnboardFormProps {
  title: string;
  subtitle: string;
  targetRole: UserRole;
  designationOptions: Option<UserDesignation>[];
  dataScopeOptions: Option<DataScope>[];
  employmentTypeOptions?: Option<EmploymentType>[];
  requiredCapabilities: readonly string[];
  successLabel: string;
  initialPrefill?: {
    name?: string;
    mobileNumber?: string;
    email?: string;
  };
  sourceInquiryId?: number | null;
}

interface FormState {
  name: string;
  mobileNumber: string;
  password: string;
  email: string;
  defaultBranchId: string;
  employmentType: EmploymentType | "";
  designation: UserDesignation;
  dataScope: DataScope;
  active: boolean;
  dateOfBirth: string;
  gender: string;
  dateOfJoining: string;
  totalExperienceYears: string;
  maxClientCapacity: string;
  shiftTimings: string;
  assignedCategory: string;
  profileImageUrl: string;
  address: string;
}

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function resolveMemberId(createdUser: UserDirectoryItem): number | null {
  const directId = Number(String(createdUser.id || "").trim());
  if (!Number.isNaN(directId) && Number.isFinite(directId)) {
    return directId;
  }

  const idDigits = String(createdUser.id || "").replace(/[^0-9]/g, "");
  if (idDigits.length > 0) {
    const parsed = Number(idDigits);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const mobileDigits = String(createdUser.mobile || "").replace(/[^0-9]/g, "");
  if (mobileDigits.length > 0) {
    const parsed = Number(mobileDigits);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function UserOnboardForm({
  title,
  subtitle,
  targetRole,
  designationOptions,
  dataScopeOptions,
  employmentTypeOptions = [
    { label: "INTERNAL", value: "INTERNAL" },
    { label: "VENDOR", value: "VENDOR" },
  ],
  requiredCapabilities,
  successLabel,
  initialPrefill,
  sourceInquiryId = null,
}: UserOnboardFormProps) {
  const router = useRouter();
  const { token, user, accessMetadata } = useAuth();
  const { selectedBranchId, branches } = useBranch();
  const canCreate = hasCapability(user, accessMetadata, requiredCapabilities, true);
  const isMemberFlow = targetRole === "MEMBER";
  const isCoachFlow = targetRole === "COACH";
  const isStaffFlow = targetRole === "STAFF";
  const hasSourceInquiryId = isMemberFlow ? Number.isFinite(Number(sourceInquiryId)) && Number(sourceInquiryId) > 0 : true;
  const sourceId = hasSourceInquiryId ? Number(sourceInquiryId) : null;

  const defaults = useMemo(
    () => ({
      designation: designationOptions[0]?.value || "MEMBER",
      dataScope: dataScopeOptions[0]?.value || "ASSIGNED_ONLY",
      employmentType: employmentTypeOptions[0]?.value || "",
    }),
    [designationOptions, dataScopeOptions, employmentTypeOptions],
  );

  const prefill = useMemo(
    () => ({
      name: initialPrefill?.name || "",
      mobileNumber: (initialPrefill?.mobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
      email: initialPrefill?.email || "",
    }),
    [initialPrefill?.email, initialPrefill?.mobileNumber, initialPrefill?.name],
  );

  const [form, setForm] = useState<FormState>(() => ({
    name: prefill.name,
    mobileNumber: prefill.mobileNumber,
    password: "",
    email: prefill.email,
    defaultBranchId:
      (selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : user?.defaultBranchId) || "",
    employmentType: defaults.employmentType,
    designation: defaults.designation,
    dataScope: defaults.dataScope,
    active: true,
    dateOfBirth: "",
    gender: "",
    dateOfJoining: "",
    totalExperienceYears: "",
    maxClientCapacity: "",
    shiftTimings: "",
    assignedCategory: "",
    profileImageUrl: "",
    address: "",
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdUser, setCreatedUser] = useState<UserDirectoryItem | null>(null);
  const [pendingConvert, setPendingConvert] = useState<{ inquiryId: number; memberId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const fallbackBranchId =
      (selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : user?.defaultBranchId) || "";

    if (!fallbackBranchId) {
      return;
    }

    setForm((prev) => (prev.defaultBranchId ? prev : { ...prev, defaultBranchId: fallbackBranchId }));
  }, [selectedBranchId, user?.defaultBranchId]);

  const convertCreatedMember = async (inquiryId: number, memberId: number): Promise<void> => {
    if (!token) {
      throw new Error("Session expired. Please login again.");
    }

    await subscriptionService.convertInquiry(token, String(inquiryId), { memberId });
  };

  const retryPendingConvert = async () => {
    if (!pendingConvert || !token) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await convertCreatedMember(pendingConvert.inquiryId, pendingConvert.memberId);
      setPendingConvert(null);
      setToast({ kind: "success", message: `Enquiry #${pendingConvert.inquiryId} converted successfully.` });
      router.push("/portal/inquiries");
    } catch (convertError) {
      const message = convertError instanceof Error ? convertError.message : "Unable to convert enquiry";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !canCreate) {
      setToast({ kind: "error", message: "You do not have permission to create users in this module." });
      return;
    }

    if (isMemberFlow && !sourceId) {
      const message = "Member onboarding must start from Enquiries Convert action (sourceInquiryId is required).";
      setError(message);
      setToast({ kind: "error", message });
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setPendingConvert(null);

    try {
      const payload: RegisterUserRequest = {
        fullName: form.name.trim(),
        mobileNumber: form.mobileNumber.trim(),
        password: form.password,
        role: targetRole,
        email: toOptionalString(form.email),
        defaultBranchId: toOptionalString(form.defaultBranchId),
        employmentType: form.employmentType || undefined,
        designation: form.designation,
        dataScope: form.dataScope,
        active: form.active,
        dateOfBirth: toOptionalString(form.dateOfBirth),
        gender: toOptionalString(form.gender),
        dateOfJoining: toOptionalString(form.dateOfJoining),
        totalExperienceYears: toOptionalString(form.totalExperienceYears)
          ? Number(form.totalExperienceYears)
          : undefined,
        maxClientCapacity: toOptionalString(form.maxClientCapacity)
          ? Number(form.maxClientCapacity)
          : undefined,
        shiftTimings: toOptionalString(form.shiftTimings),
        assignedCategory: toOptionalString(form.assignedCategory),
        profileImageUrl: toOptionalString(form.profileImageUrl),
        address: toOptionalString(form.address),
        ...(isMemberFlow && sourceId ? { sourceInquiryId: sourceId } : {}),
      };

      const created = await usersService.registerUser(token, payload);
      setCreatedUser(created);

      if (isMemberFlow && sourceId) {
        const memberId = resolveMemberId(created);
        if (memberId === null) {
          throw new Error("Member created but numeric memberId is missing in response.");
        }

        try {
          await convertCreatedMember(sourceId, memberId);
          setToast({ kind: "success", message: `${successLabel} Enquiry converted.` });
          setForm({
            name: prefill.name,
            mobileNumber: prefill.mobileNumber,
            password: "",
            email: prefill.email,
            defaultBranchId:
              (selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : user?.defaultBranchId) || "",
            employmentType: defaults.employmentType,
            designation: defaults.designation,
            dataScope: defaults.dataScope,
            active: true,
            dateOfBirth: "",
            gender: "",
            dateOfJoining: "",
            totalExperienceYears: "",
            maxClientCapacity: "",
            shiftTimings: "",
            assignedCategory: "",
            profileImageUrl: "",
            address: "",
          });
          router.push("/portal/inquiries");
          return;
        } catch (convertError) {
          const convertMessage =
            convertError instanceof Error ? convertError.message : "Member created but enquiry conversion failed";
          setPendingConvert({ inquiryId: sourceId, memberId });
          setError(convertMessage);
          setToast({
            kind: "error",
            message: "Member created, but enquiry conversion failed. Use Retry Convert below.",
          });
          return;
        }
      }

      setForm({
        name: prefill.name,
        mobileNumber: prefill.mobileNumber,
        password: "",
        email: prefill.email,
        defaultBranchId:
          (selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : user?.defaultBranchId) || "",
        employmentType: defaults.employmentType,
        designation: defaults.designation,
        dataScope: defaults.dataScope,
        active: true,
        dateOfBirth: "",
        gender: "",
        dateOfJoining: "",
        totalExperienceYears: "",
        maxClientCapacity: "",
        shiftTimings: "",
        assignedCategory: "",
        profileImageUrl: "",
        address: "",
      });
      setToast({ kind: "success", message: successLabel });
    } catch (submitError) {
      const rawMessage = submitError instanceof Error ? submitError.message : "Unable to create user";
      const message = rawMessage.includes("sourceInquiryId")
        ? "sourceInquiryId is missing/invalid. Start member onboarding from Enquiries -> Convert."
        : rawMessage;
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <SectionCard
        title={title}
        subtitle={subtitle}
      >
        {!canCreate ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Your designation does not have create capability for this module.
          </p>
        ) : isMemberFlow && !hasSourceInquiryId ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Member creation requires enquiry conversion. Go to Enquiries and use the Convert action.
          </p>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit}>
            {isMemberFlow && sourceId ? (
              <div className="md:col-span-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                Source Enquiry ID: {sourceId}
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Name</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Mobile Number</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.mobileNumber}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    mobileNumber: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                  }))
                }
                minLength={10}
                maxLength={10}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Password</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="password"
                value={form.password}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                required={!isMemberFlow}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Default Branch</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.defaultBranchId}
                onChange={(event) => setForm((prev) => ({ ...prev, defaultBranchId: event.target.value }))}
              >
                <option value="">Select branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={String(branch.id)}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Employment Type</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.employmentType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    employmentType: event.target.value as EmploymentType,
                  }))
                }
              >
                {employmentTypeOptions.map((option) => (
                  <option key={`employment-${option.value}`} value={option.value}>
                    {formatEnumLabel(option.label)}
                  </option>
                ))}
              </select>
            </div>

            {!isMemberFlow ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Date of Birth</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.dateOfBirth}
                    onChange={(event) => setForm((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Gender</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.gender}
                    onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value }))}
                  >
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Joining Date</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.dateOfJoining}
                    onChange={(event) => setForm((prev) => ({ ...prev, dateOfJoining: event.target.value }))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Shift Timings</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.shiftTimings}
                    onChange={(event) => setForm((prev) => ({ ...prev, shiftTimings: event.target.value }))}
                    placeholder={isCoachFlow ? "6 AM to 10 AM, 5 PM to 9 PM" : "9 AM to 6 PM"}
                  />
                </div>
              </>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Designation</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.designation}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    designation: event.target.value as UserDesignation,
                  }))
                }
              >
                {designationOptions.map((option) => (
                  <option key={`designation-${option.value}`} value={option.value}>
                    {formatEnumLabel(option.label)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Data Scope</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={form.dataScope}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    dataScope: event.target.value as DataScope,
                  }))
                }
              >
                {dataScopeOptions.map((option) => (
                  <option key={`scope-${option.value}`} value={option.value}>
                    {option.value === "BRANCH"
                      ? "Branch Only"
                      : option.value === "ASSIGNED_ONLY"
                        ? "Assigned Only"
                        : "Global"}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {form.dataScope === "BRANCH"
                  ? "User can work within the selected branch."
                  : form.dataScope === "ASSIGNED_ONLY"
                    ? "Use for coaches who should only see their assigned members."
                    : "Use only for users who need access across all branches."}
              </p>
            </div>

            {isCoachFlow ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Total Experience (Years)</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.totalExperienceYears}
                    onChange={(event) => setForm((prev) => ({ ...prev, totalExperienceYears: event.target.value.replace(/[^0-9]/g, "") }))}
                    inputMode="numeric"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Max Client Capacity</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.maxClientCapacity}
                    onChange={(event) => setForm((prev) => ({ ...prev, maxClientCapacity: event.target.value.replace(/[^0-9]/g, "") }))}
                    inputMode="numeric"
                    placeholder="20"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Assigned Category</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.assignedCategory}
                    onChange={(event) => setForm((prev) => ({ ...prev, assignedCategory: event.target.value }))}
                    placeholder="PT, HIIT, CrossFit"
                  />
                </div>
              </>
            ) : null}

            {(isCoachFlow || isStaffFlow) ? (
              <>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Profile Image URL</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={form.profileImageUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, profileImageUrl: event.target.value }))}
                    placeholder="https://..."
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Address</label>
                  <textarea
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    rows={3}
                    value={form.address}
                    onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                  />
                </div>
              </>
            ) : null}

            <label className="mt-6 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
              />
              Active
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={isSubmitting || (isMemberFlow && !hasSourceInquiryId)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
              >
                {isSubmitting ? "Saving..." : "Create User"}
              </button>
            </div>
          </form>
        )}

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {pendingConvert ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">
              Member created, but enquiry conversion is pending for enquiry #{pendingConvert.inquiryId}.
            </p>
            <button
              type="button"
              onClick={() => void retryPendingConvert()}
              disabled={isSubmitting}
              className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:bg-amber-300"
            >
              {isSubmitting ? "Retrying..." : "Retry Convert"}
            </button>
          </div>
        ) : null}
      </SectionCard>

    </div>
  );
}
