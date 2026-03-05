"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { DEFAULT_ROUTE_BY_ROLE } from "@/lib/route-access";

export default function PortalIndexPage() {
  const router = useRouter();
  const { user, isBootstrapping } = useAuth();

  useEffect(() => {
    if (!isBootstrapping && user) {
      router.replace(DEFAULT_ROUTE_BY_ROLE[user.role]);
    }
  }, [isBootstrapping, router, user]);

  return <PageLoader label="Redirecting to your dashboard..." />;
}
