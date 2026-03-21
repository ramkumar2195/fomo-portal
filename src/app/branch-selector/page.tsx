"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { DEFAULT_ROUTE_BY_ROLE } from "@/lib/route-access";

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

    router.replace(DEFAULT_ROUTE_BY_ROLE[user.role]);
  }, [isAuthenticated, isBootstrapping, router, user]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageLoader label="Redirecting..." />
    </div>
  );
}
