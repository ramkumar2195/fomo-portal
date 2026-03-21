"use client";

import { useState } from "react";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";

const SETTINGS_TABS = ["Profile", "Notifications", "Security", "Appearance", "Help & Support"];

function buildProfileForm(user: ReturnType<typeof useAuth>["user"]) {
  return {
    name: user?.name || "",
    phone: user?.mobile || "",
    role: user?.role || "",
    designation: user?.designation || "",
  };
}

function SettingsForm({ user }: { user: ReturnType<typeof useAuth>["user"] }) {
  const initialForm = buildProfileForm(user);
  const [activeTab, setActiveTab] = useState("Profile");
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState(initialForm);
  const [savedForm, setSavedForm] = useState(initialForm);

  const handleSave = () => {
    setSavedForm(form);
    setToast({ kind: "success", message: "Profile settings saved" });
  };

  const handleCancel = () => {
    setForm(savedForm);
  };

  const updateField = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <div className="max-w-6xl space-y-8 pb-12">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account and gym configurations.</p>
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <aside className="w-full space-y-1 md:w-64">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item}
              onClick={() => setActiveTab(item)}
              className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                activeTab === item ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {item}
            </button>
          ))}
        </aside>

        <main className="flex-1 space-y-6">
          {activeTab === "Profile" && (
            <>
              <section className="space-y-8 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                <h2 className="border-b border-gray-100 pb-4 text-lg font-bold text-gray-900">Personal Information</h2>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium text-gray-700">
                    Full Name
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => updateField("name", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 outline-none focus:border-red-600"
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-gray-700">
                    Phone Number
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => updateField("phone", e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 outline-none focus:border-red-600"
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-gray-700">
                    Role
                    <input
                      type="text"
                      value={form.role}
                      disabled
                      className="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-2.5 text-gray-500"
                    />
                  </label>
                  {form.designation ? (
                    <label className="space-y-2 text-sm font-medium text-gray-700">
                      Designation
                      <input
                        type="text"
                        value={form.designation}
                        disabled
                        className="w-full rounded-lg border border-gray-200 bg-gray-100 px-4 py-2.5 text-gray-500"
                      />
                    </label>
                  ) : null}
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={handleCancel}
                    className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Save Changes
                  </button>
                </div>
              </section>

              <section className="space-y-6 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
                <h2 className="border-b border-gray-100 pb-4 text-lg font-bold text-gray-900">Gym Branding</h2>
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-red-600 text-3xl font-black text-white">
                    FG
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <button className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
                        Upload New Logo
                      </button>
                      <button className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                        Remove
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">Recommended size: 512x512px. PNG or SVG. Max 2MB.</p>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab !== "Profile" && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
                  <span className="text-2xl text-gray-400">
                    {activeTab === "Notifications" ? "🔔" : activeTab === "Security" ? "🔒" : activeTab === "Appearance" ? "🎨" : "❓"}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{activeTab}</h3>
                <p className="mt-2 text-sm text-gray-500">This section is coming soon.</p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  return <SettingsForm key={user?.id || "settings-anon"} user={user} />;
}
