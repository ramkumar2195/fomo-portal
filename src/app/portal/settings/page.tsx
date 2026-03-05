"use client";

const SETTINGS_NAV = ["Profile", "Notifications", "Security", "Appearance", "Billing", "Help & Support"];

export default function SettingsPage() {
  return (
    <div className="max-w-6xl space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account and gym configurations.</p>
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <aside className="w-full space-y-1 md:w-64">
          {SETTINGS_NAV.map((item, index) => (
            <button
              key={item}
              className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                index === 0 ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {item}
            </button>
          ))}
        </aside>

        <main className="flex-1 space-y-6">
          <section className="space-y-8 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            <h2 className="border-b border-gray-100 pb-4 text-lg font-bold text-gray-900">Personal Information</h2>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Full Name
                <input
                  type="text"
                  defaultValue="Jane Doe"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 outline-none focus:border-red-600"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Email Address
                <input
                  type="email"
                  defaultValue="jane.doe@fomogym.com"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 outline-none focus:border-red-600"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Phone Number
                <input
                  type="text"
                  defaultValue="+91 98765 43210"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 outline-none focus:border-red-600"
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-gray-700">
                Job Role
                <input
                  type="text"
                  defaultValue="Sales Manager"
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 outline-none focus:border-red-600"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button className="rounded-xl border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
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
        </main>
      </div>
    </div>
  );
}
