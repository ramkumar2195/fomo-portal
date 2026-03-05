"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { hasCapability } from "@/lib/access-policy";
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
}

interface FormState {
  name: string;
  mobileNumber: string;
  password: string;
  email: string;
  employmentType: EmploymentType | "";
  designation: UserDesignation;
  dataScope: DataScope;
  active: boolean;
}

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
}: UserOnboardFormProps) {
  const { token, user, accessMetadata } = useAuth();
  const canCreate = hasCapability(user, accessMetadata, requiredCapabilities, true);

  const defaults = useMemo(
    () => ({
      designation: designationOptions[0]?.value || "MEMBER",
      dataScope: dataScopeOptions[0]?.value || "ASSIGNED_ONLY",
      employmentType: employmentTypeOptions[0]?.value || "",
    }),
    [designationOptions, dataScopeOptions, employmentTypeOptions],
  );

  const [form, setForm] = useState<FormState>(() => ({
    name: "",
    mobileNumber: "",
    password: "",
    email: "",
    employmentType: defaults.employmentType,
    designation: defaults.designation,
    dataScope: defaults.dataScope,
    active: true,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdUser, setCreatedUser] = useState<UserDirectoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !canCreate) {
      setToast({ kind: "error", message: "You do not have permission to create users in this module." });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload: RegisterUserRequest = {
        name: form.name.trim(),
        mobileNumber: form.mobileNumber.trim(),
        password: form.password,
        role: targetRole,
        email: toOptionalString(form.email),
        employmentType: form.employmentType || undefined,
        designation: form.designation,
        dataScope: form.dataScope,
        active: form.active,
      };

      const created = await usersService.registerUser(token, payload);
      setCreatedUser(created);
      setForm({
        name: "",
        mobileNumber: "",
        password: "",
        email: "",
        employmentType: defaults.employmentType,
        designation: defaults.designation,
        dataScope: defaults.dataScope,
        active: true,
      });
      setToast({ kind: "success", message: successLabel });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to create user";
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
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portal/members/add"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Add Member
            </Link>
            <Link
              href="/portal/trainers/add"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Add Trainer
            </Link>
            <Link
              href="/portal/staff/add"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Add Staff
            </Link>
          </div>
        }
      >
        {!canCreate ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Your designation does not have create capability for this module.
          </p>
        ) : (
          <form className="grid gap-3 md:grid-cols-2" onSubmit={onSubmit}>
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
              <label className="mb-1 block text-xs font-semibold text-slate-600">Email (optional)</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              />
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
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

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
                    {option.label}
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
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

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
                disabled={isSubmitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
              >
                {isSubmitting ? "Saving..." : "Create User"}
              </button>
            </div>
          </form>
        )}

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Last Created User" subtitle="Result from users-service register API">
        {!createdUser ? (
          <p className="text-sm text-slate-500">No user created in this session.</p>
        ) : (
          <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-slate-900">ID:</span> {createdUser.id || "-"}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Name:</span> {createdUser.name}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Mobile:</span> {createdUser.mobile}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Role:</span> {createdUser.role}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Designation:</span>{" "}
              {createdUser.designation || "-"}
            </p>
            <p>
              <span className="font-semibold text-slate-900">Data Scope:</span> {createdUser.dataScope || "-"}
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
