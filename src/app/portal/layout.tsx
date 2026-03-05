"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { PortalShell } from "@/components/layout/portal-shell";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasDesignation } from "@/lib/access-policy";
import { canAccessRoute, DEFAULT_ROUTE_BY_ROLE } from "@/lib/route-access";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, accessMetadata, isAuthenticated, isBootstrapping } = useAuth();
  const { selectedBranchId, isLoadingBranches } = useBranch();
  const requiresBranchSelection = Boolean(user?.role === "ADMIN" && hasDesignation(user, "SUPER_ADMIN"));
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (!isAuthenticated || !user) {
      router.replace("/login");
      return;
    }

    if (requiresBranchSelection && !selectedBranchId) {
      router.replace("/branch-selector");
      return;
    }

    if (!canAccessRoute(pathname, user, undefined, accessMetadata)) {
      router.replace(DEFAULT_ROUTE_BY_ROLE[user.role]);
    }
  }, [isBootstrapping, isAuthenticated, pathname, router, selectedBranchId, user, accessMetadata, requiresBranchSelection]);

  if (
    !isClient ||
    isBootstrapping ||
    isLoadingBranches ||
    !isAuthenticated ||
    !user ||
    (requiresBranchSelection && !selectedBranchId)
  ) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <PageLoader label="Loading portal..." />
      </div>
    );
  }

  if (!canAccessRoute(pathname, user, undefined, accessMetadata)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <PageLoader label="Redirecting..." />
      </div>
    );
  }

  return <PortalShell>{children}</PortalShell>;
}
