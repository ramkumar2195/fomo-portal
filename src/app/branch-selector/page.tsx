"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";

export default function BranchSelectorPage() {
  const router = useRouter();
  const { user, isAuthenticated, isBootstrapping } = useAuth();
  const { branches, selectedBranchId, selectBranch, isLoadingBranches } = useBranch();

  useEffect(() => {
    if (!isBootstrapping && !isAuthenticated) {
      router.replace("/login");
      return;
    }

    if (!isBootstrapping && user?.role === "STAFF") {
      router.replace("/portal");
    }
  }, [isAuthenticated, isBootstrapping, router, user]);

  if (isBootstrapping || isLoadingBranches) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <PageLoader label="Loading branches..." />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Select Branch</h1>
        <p className="mt-1 text-sm text-slate-500">
          Branch selection is currently UI-only; backend data is not branch-scoped yet
        </p>

        {branches.length === 0 ? (
          <p className="mt-6 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Branch list is not available from backend yet.
          </p>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {branches.map((branch) => {
              const active = branch.id === selectedBranchId;
              return (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => selectBranch(branch.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-500"
                  }`}
                >
                  <p className="text-base font-semibold">{branch.name}</p>
                  <p className={`text-sm ${active ? "text-slate-100" : "text-slate-500"}`}>
                    {branch.city || "City not specified"}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          disabled={!selectedBranchId}
          onClick={() => {
            selectBranch(selectedBranchId || "default");
            router.push("/portal");
          }}
          className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Continue to Portal
        </button>
      </div>
    </div>
  );
}
