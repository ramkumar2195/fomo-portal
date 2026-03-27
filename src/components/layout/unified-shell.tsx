"use client";

import Link from "next/link";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  LogOut,
  Package2,
  Wallet,
} from "lucide-react";
import {
  BellIcon,
  CommunityIcon,
  DashboardIcon,
  EnquiryIcon,
  FollowUpsIcon,
  MembersIcon,
  ReportsIcon,
  SearchIcon,
  StaffIcon,
  SettingsIcon,
  TrainersIcon,
} from "@/components/common/icons";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { canAccessRoute } from "@/lib/access-policy";
import { InquiryRecord } from "@/types/inquiry";
import { UserDirectoryItem } from "@/types/models";

interface NavLinkItem {
  href: string;
  accessHref?: string;
  activeAliases?: string[];
  label: string;
  icon: ReactNode;
  queryKey?: string;
  queryValues?: string[];
  queryNotValues?: string[];
}

interface NavSection {
  key: string;
  label: string;
  icon: ReactNode;
  href?: string;
  accessHref?: string;
  activeAliases?: string[];
  children?: NavLinkItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/portal/sales-dashboard",
    activeAliases: ["/admin/dashboard"],
    icon: <DashboardIcon className="h-4 w-4" />,
  },
  {
    key: "branches",
    label: "Branches",
    href: "/admin/branches",
    activeAliases: ["/admin/branches"],
    icon: <Building2 className="h-4 w-4" />,
  },
  {
    key: "crm",
    label: "CRM",
    icon: <EnquiryIcon className="h-4 w-4" />,
    children: [
      { href: "/portal/inquiries", label: "Enquiries", icon: <EnquiryIcon className="h-4 w-4" /> },
      { href: "/portal/follow-ups", label: "Follow-ups", icon: <FollowUpsIcon className="h-4 w-4" /> },
    ],
  },
  {
    key: "members",
    label: "Members",
    icon: <MembersIcon className="h-4 w-4" />,
    children: [
      { href: "/portal/members", label: "All Members", icon: <MembersIcon className="h-4 w-4" /> },
      { href: "/portal/renewals", label: "Renewals", icon: <FollowUpsIcon className="h-4 w-4" /> },
    ],
  },
  {
    key: "people",
    label: "People",
    icon: <StaffIcon className="h-4 w-4" />,
    children: [
      { href: "/portal/trainers", label: "Coaches", icon: <TrainersIcon className="h-4 w-4" />, activeAliases: ["/portal/trainer-attendance"] },
      { href: "/portal/staff", label: "Staff", icon: <StaffIcon className="h-4 w-4" /> },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    icon: <CreditCard className="h-4 w-4" />,
    children: [
      {
        href: "/portal/billing?tab=invoices",
        accessHref: "/portal/billing",
        label: "Billing & Invoices",
        icon: <CreditCard className="h-4 w-4" />,
        activeAliases: ["/portal/accounts"],
        queryKey: "tab",
        queryNotValues: ["subscriptions"],
      },
      {
        href: "/portal/billing?tab=subscriptions",
        accessHref: "/portal/billing",
        label: "Subscriptions",
        icon: <CreditCard className="h-4 w-4" />,
        queryKey: "tab",
        queryValues: ["subscriptions"],
      },
    ],
  },
  {
    key: "catalog",
    label: "Catalog",
    icon: <Package2 className="h-4 w-4" />,
    children: [
      { href: "/admin/catalog", label: "Products & Plans", icon: <Package2 className="h-4 w-4" /> },
      { href: "/admin/credits", label: "Credits & Wallet", icon: <Wallet className="h-4 w-4" /> },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    icon: <BookOpen className="h-4 w-4" />,
    children: [
      { href: "/admin/programs", label: "Programs", icon: <BookOpen className="h-4 w-4" /> },
      { href: "/admin/classes", label: "Classes", icon: <CalendarDays className="h-4 w-4" />, activeAliases: ["/portal/class-schedule"] },
    ],
  },
  {
    key: "community",
    label: "Community",
    href: "/portal/community",
    icon: <CommunityIcon className="h-4 w-4" />,
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/portal/notifications",
    icon: <BellIcon className="h-4 w-4" />,
  },
  {
    key: "reports",
    label: "Reports",
    href: "/portal/reports",
    icon: <ReportsIcon className="h-4 w-4" />,
  },
  {
    key: "settings",
    label: "Settings",
    icon: <SettingsIcon className="h-4 w-4" />,
    children: [
      { href: "/portal/settings", label: "General Settings", icon: <SettingsIcon className="h-4 w-4" /> },
      {
        href: "/admin/settings?tab=billing",
        accessHref: "/admin/settings",
        label: "Billing Settings",
        icon: <SettingsIcon className="h-4 w-4" />,
        queryKey: "tab",
        queryValues: ["billing"],
      },
    ],
  },
];

function toPathname(href: string): string {
  return href.split("?")[0] || href;
}

function matchesPathname(pathname: string, href: string, aliases?: string[]): boolean {
  const hrefs = [toPathname(href), ...(aliases || []).map((value) => toPathname(value))];
  return hrefs.some((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
}

function matchesQuery(searchParams: ReturnType<typeof useSearchParams>, item: NavLinkItem): boolean {
  if (!item.queryKey) {
    return true;
  }
  const value = searchParams.get(item.queryKey);
  if (item.queryValues?.length) {
    return item.queryValues.includes(value || "");
  }
  if (item.queryNotValues?.length) {
    return !item.queryNotValues.includes(value || "");
  }
  return true;
}

function isLinkActive(
  pathname: string,
  searchParams: ReturnType<typeof useSearchParams>,
  item: NavLinkItem,
): boolean {
  return matchesPathname(pathname, item.href, item.activeAliases) && matchesQuery(searchParams, item);
}

export function UnifiedShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user, accessMetadata, logout } = useAuth();
  const { branches, canSwitchBranches, selectedBranchId, selectedBranchName, selectBranch } = useBranch();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSectionKey, setOpenSectionKey] = useState<string | null>(null);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchResults, setGlobalSearchResults] = useState<Array<
    | { kind: "user"; item: UserDirectoryItem }
    | { kind: "enquiry"; item: InquiryRecord }
  >>([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const navSections = useMemo(
    () =>
      NAV_SECTIONS
        .map((section) => {
          if (!section.children) {
            return canAccessRoute(section.accessHref || section.href || "", user, accessMetadata) ? section : null;
          }

          const visibleChildren = section.children.filter((item) =>
            canAccessRoute(item.accessHref || toPathname(item.href), user, accessMetadata),
          );

          if (visibleChildren.length === 0) {
            return null;
          }

          return {
            ...section,
            children: visibleChildren,
          };
        })
        .filter((section): section is NavSection => section !== null),
    [user, accessMetadata],
  );

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  const activeSectionKey = useMemo(() => {
    const activeSection = navSections.find(
      (section) => section.children && section.children.some((item) => isLinkActive(pathname, searchParams, item)),
    );
    return activeSection?.key ?? null;
  }, [navSections, pathname, searchParams]);

  const isAdmin = user?.role === "ADMIN";
  const brandTitle = isAdmin ? "FOMO HQ" : "FOMO Training";
  const brandSubtitle = isAdmin ? "Multi-Branch Control Center" : "Staff Operations";

  const offsetClass = collapsed ? "md:pl-24" : "md:pl-72";
  const headerOffsetClass = collapsed ? "md:left-24" : "md:left-72";

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) {
        setGlobalSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (activeSectionKey) {
      setOpenSectionKey(activeSectionKey);
    }
  }, [activeSectionKey]);

  useEffect(() => {
    if (!token) {
      setGlobalSearchResults([]);
      setGlobalSearchLoading(false);
      return;
    }

    const query = globalSearchQuery.trim();
    if (query.length < 2) {
      setGlobalSearchResults([]);
      setGlobalSearchLoading(false);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setGlobalSearchLoading(true);
      try {
        const [users, enquiryPage] = await Promise.all([
          usersService.searchUsers(token, { query }),
          subscriptionService.searchInquiriesPaged(token, { query }, 0, 5),
        ]);
        if (!active) {
          return;
        }
        // Filter out CONVERTED enquiries — those already appear as members in user results
        const openEnquiries = enquiryPage.content.filter(
          (enq) => enq.status !== "CONVERTED",
        );
        setGlobalSearchResults([
          ...users.slice(0, 6).map((item) => ({ kind: "user" as const, item })),
          ...openEnquiries.slice(0, 4).map((item) => ({ kind: "enquiry" as const, item })),
        ]);
        setGlobalSearchOpen(true);
      } catch {
        if (!active) {
          return;
        }
        setGlobalSearchResults([]);
      } finally {
        if (active) {
          setGlobalSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [globalSearchQuery, token]);

  const getGlobalSearchHref = (
    result:
      | { kind: "user"; item: UserDirectoryItem }
      | { kind: "enquiry"; item: InquiryRecord },
  ): string => {
    if (result.kind === "enquiry") {
      const label = result.item.fullName?.trim() || String(result.item.inquiryId);
      return `/portal/inquiries?query=${encodeURIComponent(label)}&openInquiryId=${result.item.inquiryId}`;
    }

    const role = String(result.item.role || "").toUpperCase();
    if (role === "MEMBER") {
      return `/admin/members/${result.item.id}`;
    }
    if (role === "STAFF" || role === "ADMIN") {
      return `/admin/staff/${result.item.id}`;
    }
    if (role === "COACH") {
      return `/admin/coaches/${result.item.id}`;
    }
    return "/portal/members";
  };

  const handleGlobalSearchSelect = (
    result:
      | { kind: "user"; item: UserDirectoryItem }
      | { kind: "enquiry"; item: InquiryRecord },
  ) => {
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
    setGlobalSearchResults([]);
    router.push(getGlobalSearchHref(result));
  };

  const renderGlobalSearchMeta = (
    result:
      | { kind: "user"; item: UserDirectoryItem }
      | { kind: "enquiry"; item: InquiryRecord },
  ) => {
    if (result.kind === "enquiry") {
      return `ENQUIRY • ${result.item.status?.replace(/_/g, " ") || "NEW"}`;
    }

    const item = result.item;
    const roleLabel = item.designation?.replace(/_/g, " ") || item.role || "USER";
    const branchLabel = item.defaultBranchId ? ` • ${item.defaultBranchId}` : "";
    return `${roleLabel}${branchLabel}`;
  };

  return (
    <div className="min-h-screen bg-[#0c1016] text-slate-100">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/8 bg-[#0b0f15] shadow-[0_30px_80px_rgba(0,0,0,0.42)] transition-all duration-200
          ${collapsed ? "md:w-24" : "md:w-72"}
          ${mobileOpen ? "w-72" : "w-0 overflow-hidden md:overflow-visible"}
        `}
      >
        {/* Logo / Brand */}
        <div className="flex h-16 items-center justify-between border-b border-white/8 px-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#c42924]">
              <span className="text-xs font-bold text-white">F</span>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold tracking-[0.24em] text-[#c42924]">
                  {brandTitle}
                </p>
                <p className="truncate text-[10px] text-slate-500">{brandSubtitle}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="hidden rounded-lg border border-white/8 p-1.5 text-slate-400 hover:bg-white/[0.06] md:inline-flex"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 overflow-y-auto p-3">
          {navSections.map((section) => {
            if (!section.children && section.href) {
              const active = matchesPathname(pathname, section.href, section.activeAliases);
              return (
                <Link
                  key={section.key}
                  href={section.href}
                  title={collapsed ? section.label : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    active
                      ? "bg-[#c42924] text-white shadow-[0_10px_30px_rgba(196,41,36,0.22)]"
                      : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  <span className="shrink-0">{section.icon}</span>
                  {!collapsed && <span className="truncate">{section.label}</span>}
                </Link>
              );
            }

            if (!section.children) {
              return null;
            }

            const sectionActive = section.children.some((item) => isLinkActive(pathname, searchParams, item));
            const sectionOpen = !collapsed && openSectionKey === section.key;

            return (
              <div key={section.key} className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    if (collapsed) {
                      setCollapsed(false);
                      setOpenSectionKey(section.key);
                      return;
                    }
                    setOpenSectionKey((current) => (current === section.key ? null : section.key));
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                    sectionActive ? "bg-white/[0.06] text-[#c42924]" : "text-slate-500 hover:bg-white/[0.03]"
                  }`}
                  title={collapsed ? section.label : undefined}
                >
                  <span className="shrink-0">{section.icon}</span>
                  {!collapsed ? (
                    <>
                      <span className="truncate text-xs font-bold uppercase tracking-[0.18em]">{section.label}</span>
                      <ChevronDown
                        className={`ml-auto h-4 w-4 transition-transform ${sectionOpen ? "rotate-180" : ""}`}
                      />
                    </>
                  ) : null}
                </button>
                {sectionOpen ? (
                  <div className="space-y-1 pl-4">
                  {section.children.map((item) => {
                    const active = isLinkActive(pathname, searchParams, item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        onClick={() => setMobileOpen(false)}
                        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                          active
                            ? "bg-[#c42924] text-white shadow-[0_10px_30px_rgba(196,41,36,0.22)]"
                            : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                        }`}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    );
                  })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {/* User card */}
        <div className="border-t border-white/8 p-3">
          <div className={`rounded-xl border border-white/8 bg-white/[0.04] p-3 ${collapsed ? "text-center" : ""}`}>
            {!collapsed && (
              <>
                <p className="text-xs font-semibold text-slate-500">Signed in as</p>
                <p suppressHydrationWarning className="truncate text-sm font-bold text-white">
                  {user?.name || "User"}
                </p>
                <p suppressHydrationWarning className="text-xs text-slate-500">
                  {user?.designation?.replace(/_/g, " ") || user?.role || ""}
                </p>
              </>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className={`mt-2 inline-flex items-center gap-1 rounded-lg border border-white/8 px-2.5 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/[0.08] ${
                collapsed ? "mx-auto justify-center" : ""
              }`}
            >
              <LogOut className="h-3.5 w-3.5" />
              {!collapsed && "Logout"}
            </button>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className={`${offsetClass} transition-all duration-200`}>
        {/* Header */}
        <header
          className={`fixed top-0 right-0 z-30 h-16 border-b border-white/8 bg-[#0c1016] ${headerOffsetClass} left-0 md:left-auto transition-all duration-200`}
        >
          <div className="mx-auto flex h-full max-w-[1500px] items-center justify-between px-4 md:px-6">
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-lg border border-white/8 p-2 text-slate-300 hover:bg-white/[0.06] md:hidden"
                aria-label="Open menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {/* Search */}
              <div className="hidden w-64 md:block lg:w-80">
                <div ref={searchRef} className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search user name, mobile, or ID..."
                    value={globalSearchQuery}
                    onChange={(event) => {
                      setGlobalSearchQuery(event.target.value);
                      setGlobalSearchOpen(true);
                    }}
                    onFocus={() => {
                      if (globalSearchQuery.trim().length >= 2) {
                        setGlobalSearchOpen(true);
                      }
                    }}
                    className="w-full rounded-xl border border-white/8 bg-white/[0.04] py-2 pr-4 pl-9 text-sm text-slate-100 outline-none focus:border-[#c42924]"
                  />
                  {globalSearchOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-white/8 bg-[#131925] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
                      {globalSearchLoading ? (
                        <p className="px-4 py-3 text-sm text-slate-400">Searching users...</p>
                      ) : globalSearchQuery.trim().length < 2 ? (
                        <p className="px-4 py-3 text-sm text-slate-400">Type at least 2 characters to search.</p>
                      ) : globalSearchResults.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-slate-400">No users found.</p>
                      ) : (
                        <div className="max-h-80 overflow-y-auto py-1">
                          {globalSearchResults.map((result) => (
                            <button
                              key={result.kind === "user" ? `${result.item.role}-${result.item.id}` : `enquiry-${result.item.inquiryId}`}
                              type="button"
                              onClick={() => handleGlobalSearchSelect(result)}
                              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.05]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {result.kind === "user"
                                    ? result.item.name || result.item.mobile || result.item.id
                                    : result.item.fullName || `Enquiry #${result.item.inquiryId}`}
                                </p>
                                <p className="truncate text-xs text-slate-400">
                                  {result.kind === "user"
                                    ? result.item.mobile || result.item.email || result.item.id
                                    : result.item.mobileNumber || `Enquiry #${result.item.inquiryId}`}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                                {renderGlobalSearchMeta(result)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Branch selector */}
              {branches.length > 0 ? (
                canSwitchBranches && branches.length > 1 ? (
                  <select
                    className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 text-sm text-slate-100"
                    value={selectedBranchId}
                    onChange={(e) => selectBranch(e.target.value)}
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-100">
                    {selectedBranchName || branches[0]?.name || "Branch"}
                  </div>
                )
              ) : null}

              <button
                type="button"
                aria-label="Calendar"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 text-slate-300 hover:bg-white/[0.06]"
              >
                <CalendarDays className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Notifications"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 text-slate-300 hover:bg-white/[0.06]"
              >
                <Bell className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 pt-24 pb-8 md:px-6">{children}</main>
      </div>
    </div>
  );
}
