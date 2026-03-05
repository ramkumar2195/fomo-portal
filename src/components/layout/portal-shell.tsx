"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ComponentType, ReactNode, SVGProps, useMemo } from "react";
import {
  BellIcon,
  CalendarIcon,
  CommunityIcon,
  DashboardIcon,
  EnquiryIcon,
  FollowUpsIcon,
  MembersIcon,
  RenewalsIcon,
  ReportsIcon,
  SearchIcon,
  StaffIcon,
  SettingsIcon,
  TrainersIcon,
} from "@/components/common/icons";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { canAccessRoute } from "@/lib/access-policy";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/portal/sales-dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/portal/inquiries", label: "Enquiries", icon: EnquiryIcon },
  { href: "/portal/members", label: "Members", icon: MembersIcon },
  { href: "/portal/trainers", label: "Trainers", icon: TrainersIcon },
  { href: "/portal/staff", label: "Staff", icon: StaffIcon },
  { href: "/portal/renewals", label: "Renewals", icon: RenewalsIcon },
  { href: "/portal/follow-ups", label: "Follow-ups", icon: FollowUpsIcon },
  { href: "/portal/reports", label: "Reports", icon: ReportsIcon },
  { href: "/portal/community", label: "Community", icon: CommunityIcon },
  { href: "/portal/settings", label: "Settings", icon: SettingsIcon },
];

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, accessMetadata, logout } = useAuth();
  const { branches, selectedBranchId, selectBranch } = useBranch();
  const isSuperAdmin = user?.role === "ADMIN" && user.designation === "SUPER_ADMIN";

  const navItems = useMemo(
    () => NAV_ITEMS.filter((item) => canAccessRoute(item.href, user, accessMetadata)),
    [user, accessMetadata],
  );

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900 md:flex-row">
      <aside className="w-full bg-black text-white md:min-h-screen md:w-64 md:shrink-0">
        <div className="flex items-center gap-3 border-b border-white/10 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-sm font-bold">FG</div>
          <div>
            <p className="text-lg font-bold">FOMO Gym</p>
            <p className="text-xs text-gray-400">{isSuperAdmin ? "Super Admin Console" : "Staff Operations"}</p>
          </div>
        </div>

        <nav className="grid gap-1 p-3 md:px-3 md:py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/portal/sales-dashboard"
                ? pathname === "/portal" || pathname.startsWith(item.href)
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? "bg-red-600 text-white" : "text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 md:hidden">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Logout
          </button>
        </div>

        <div className="hidden border-t border-white/10 p-4 md:block">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-gray-400">Signed in as</p>
            <p className="truncate text-sm font-semibold text-white">{user?.name || "Unknown"}</p>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-gray-200 bg-white px-4 py-4 md:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:max-w-md">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search member name or phone..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-9 text-sm text-gray-600 outline-none focus:border-red-600"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {isSuperAdmin ? (
                <label className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  Branch
                  <select
                    className="mt-1 block rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                    value={selectedBranchId}
                    onChange={(event) => selectBranch(event.target.value)}
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600"
              >
                <CalendarIcon className="h-4 w-4" />
                Calendar
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600"
              >
                <BellIcon className="h-4 w-4" />
                Alerts
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
