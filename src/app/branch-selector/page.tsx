"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { DEFAULT_ROUTE_BY_ROLE } from "@/lib/route-access";
import { setCookie } from "@/lib/storage";
import { COOKIE_KEYS } from "@/lib/constants";

export default function BranchSelectorPage() {
  const router = useRouter();
  const { isAuthenticated, isBootstrapping, user } = useAuth();

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (!isAuthenticated || !user) {
      router.replace("/login");
      return;
    }

    // Belt-and-braces: if a SUPER_ADMIN lands here directly (e.g. deep-link,
    // stale tab), make sure the branchId cookie is set before the redirect.
    // Without this, middleware may loop us back here when the cookie write
    // from login hasn't propagated yet.
    if (user.role === "ADMIN") {
      const preferred = user.defaultBranchId != null
        ? String(user.defaultBranchId)
        : "all-branches";
      setCookie(COOKIE_KEYS.branchId, preferred);
    }

    router.replace(DEFAULT_ROUTE_BY_ROLE[user.role]);
  }, [isAuthenticated, isBootstrapping, router, user]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageLoader label="Redirecting..." />
    </div>
  );
}
