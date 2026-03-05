"use client";

import { AuthProvider } from "@/contexts/auth-context";
import { BranchProvider } from "@/contexts/branch-context";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <BranchProvider>{children}</BranchProvider>
    </AuthProvider>
  );
}
