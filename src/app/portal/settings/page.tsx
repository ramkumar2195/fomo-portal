"use client";

import { useEffect, useMemo, useState } from "react";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { usersService } from "@/lib/api/services/users-service";

function humanizeLabel(value?: string): string {
  if (!value) return "-";
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildProfileForm(user: ReturnType<typeof useAuth>["user"]) {
  return {
    fullName: user?.name || "",
    mobileNumber: user?.mobile || "",
    email: "",
    dateOfBirth: "",
    gender: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
  };
}

export default function SettingsPage() {
  const { token, user, refreshCurrentUser } = useAuth();
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [profileForm, setProfileForm] = useState(buildProfileForm(user));
  const [securityForm, setSecurityForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setProfileForm(buildProfileForm(user));
  }, [user]);

  useEffect(() => {
    if (!token || !user?.id) return;
    let active = true;
    (async () => {
      try {
        const profile = await usersService.getUserById(token, user.id);
        if (!active || !profile) return;
        setProfileForm({
          fullName: profile.name || user.name || "",
          mobileNumber: profile.mobile || user.mobile || "",
          email: profile.email || "",
          dateOfBirth: profile.dateOfBirth || "",
          gender: profile.gender || "",
          address: profile.address || "",
          emergencyContactName: profile.emergencyContactName || "",
          emergencyContactPhone: profile.emergencyContactPhone || "",
          emergencyContactRelation: profile.emergencyContactRelation || "",
        });
      } catch {
        // keep auth bootstrap values if the detailed profile fetch is unavailable
      }
    })();
    return () => {
      active = false;
    };
  }, [token, user]);

  const designationLabel = useMemo(() => humanizeLabel(user?.designation), [user?.designation]);
  const employmentTypeLabel = useMemo(() => humanizeLabel(user?.employmentType), [user?.employmentType]);

  const updateProfileField = (key: keyof typeof profileForm, value: string) => {
    setProfileForm((current) => ({ ...current, [key]: value }));
  };

  const updateSecurityField = (key: keyof typeof securityForm, value: string) => {
    setSecurityForm((current) => ({ ...current, [key]: value }));
  };

  const handleSaveProfile = async () => {
    if (!token) return;
    setSavingProfile(true);
    setToast(null);
    try {
      await usersService.updateMyProfile(token, {
        fullName: profileForm.fullName.trim(),
        email: profileForm.email.trim(),
        mobileNumber: profileForm.mobileNumber.trim(),
        dateOfBirth: profileForm.dateOfBirth || undefined,
        gender: profileForm.gender || undefined,
        address: profileForm.address.trim() || undefined,
        emergencyContactName: profileForm.emergencyContactName.trim() || undefined,
        emergencyContactPhone: profileForm.emergencyContactPhone.trim() || undefined,
        emergencyContactRelation: profileForm.emergencyContactRelation.trim() || undefined,
      });
      await refreshCurrentUser();
      setToast({ kind: "success", message: "Profile updated successfully." });
    } catch (saveError) {
      setToast({ kind: "error", message: saveError instanceof Error ? saveError.message : "Unable to update profile." });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!token || !user?.id) return;
    if (securityForm.newPassword !== securityForm.confirmPassword) {
      setToast({ kind: "error", message: "New password and confirmation do not match." });
      return;
    }
    setSavingPassword(true);
    setToast(null);
    try {
      await usersService.changePassword(token, user.id, {
        oldPassword: securityForm.oldPassword,
        newPassword: securityForm.newPassword,
      });
      setSecurityForm({ oldPassword: "", newPassword: "", confirmPassword: "" });
      setToast({ kind: "success", message: "Password changed successfully." });
    } catch (saveError) {
      setToast({ kind: "error", message: saveError instanceof Error ? saveError.message : "Unable to change password." });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <header>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400">Basic profile and security settings for the current account.</p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-[#121926] p-6">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Account Summary</h2>
            <p className="mt-1 text-sm text-slate-400">Role details are view-only for branch operations users.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">
              {designationLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
              {employmentTypeLabel}
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Full Name</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.name || "-"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Mobile</p>
            <p className="mt-2 text-sm font-semibold text-white">{user?.mobile || "-"}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Designation</p>
            <p className="mt-2 text-sm font-semibold text-white">{designationLabel}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Employment</p>
            <p className="mt-2 text-sm font-semibold text-white">{employmentTypeLabel}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#121926] p-6">
        <div className="border-b border-white/10 pb-4">
          <h2 className="text-lg font-semibold text-white">Personal Information</h2>
          <p className="mt-1 text-sm text-slate-400">Update your own contact and emergency details.</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Full Name
            <input
              type="text"
              value={profileForm.fullName}
              onChange={(event) => updateProfileField("fullName", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Mobile Number
            <input
              type="text"
              value={profileForm.mobileNumber}
              onChange={(event) => updateProfileField("mobileNumber", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Email
            <input
              type="email"
              value={profileForm.email}
              onChange={(event) => updateProfileField("email", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Date of Birth
            <input
              type="date"
              value={profileForm.dateOfBirth}
              onChange={(event) => updateProfileField("dateOfBirth", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Gender
            <select
              value={profileForm.gender}
              onChange={(event) => updateProfileField("gender", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            >
              <option value="">Select gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Emergency Contact Name
            <input
              type="text"
              value={profileForm.emergencyContactName}
              onChange={(event) => updateProfileField("emergencyContactName", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Emergency Contact Phone
            <input
              type="text"
              value={profileForm.emergencyContactPhone}
              onChange={(event) => updateProfileField("emergencyContactPhone", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Emergency Contact Relation
            <input
              type="text"
              value={profileForm.emergencyContactRelation}
              onChange={(event) => updateProfileField("emergencyContactRelation", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300 md:col-span-2">
            Address
            <textarea
              rows={3}
              value={profileForm.address}
              onChange={(event) => updateProfileField("address", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={savingProfile}
            className="rounded-xl bg-[#C42429] px-5 py-3 text-sm font-semibold text-white hover:bg-[#a61d22] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingProfile ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#121926] p-6">
        <div className="border-b border-white/10 pb-4">
          <h2 className="text-lg font-semibold text-white">Security</h2>
          <p className="mt-1 text-sm text-slate-400">Change your password for portal login.</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Current Password
            <input
              type="password"
              value={securityForm.oldPassword}
              onChange={(event) => updateSecurityField("oldPassword", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            New Password
            <input
              type="password"
              value={securityForm.newPassword}
              onChange={(event) => updateSecurityField("newPassword", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-300">
            Confirm New Password
            <input
              type="password"
              value={securityForm.confirmPassword}
              onChange={(event) => updateSecurityField("confirmPassword", event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none focus:border-[#C42429]"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void handleChangePassword()}
            disabled={savingPassword}
            className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingPassword ? "Updating..." : "Change Password"}
          </button>
        </div>
      </section>
    </div>
  );
}
