"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { UnifiedShell } from "@/components/layout/unified-shell";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { canAccessRoute, isAdminOrStaff } from "@/lib/access-policy";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, accessMetadata, isAuthenticated, isBootstrapping } = useAuth();
  const { isLoadingBranches } = useBranch();
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (isBootstrapping) return;

    if (!isAuthenticated || !user) {
      router.replace("/login");
      return;
    }

    if (!isAdminOrStaff(user) || !canAccessRoute(pathname, user, accessMetadata)) {
      router.replace("/unauthorized");
    }
  }, [isBootstrapping, isAuthenticated, pathname, router, user, accessMetadata]);

  if (!isClient || isBootstrapping || isLoadingBranches || !isAuthenticated || !user) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <PageLoader label="Loading..." />
      </div>
    );
  }

  if (!canAccessRoute(pathname, user, accessMetadata)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6">
        <PageLoader label="Redirecting..." />
      </div>
    );
  }

  return <UnifiedShell>{children}</UnifiedShell>;
}
