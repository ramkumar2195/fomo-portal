"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { COOKIE_KEYS, STORAGE_KEYS } from "@/lib/constants";
import { getFromStorage, saveToStorage, setCookie } from "@/lib/storage";
import { Branch } from "@/types/models";
import { useAuth } from "@/contexts/auth-context";

interface BranchContextValue {
  branches: Branch[];
  selectedBranchId: string;
  isLoadingBranches: boolean;
  refreshBranches: () => Promise<void>;
  selectBranch: (branchId: string) => void;
}

const DEFAULT_BRANCH: Branch = {
  id: "default",
  name: "All Branches",
  city: "UI only",
};

const BranchContext = createContext<BranchContextValue | undefined>(undefined);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => getFromStorage<string>(STORAGE_KEYS.selectedBranchId) || DEFAULT_BRANCH.id,
  );

  const selectBranch = useCallback((branchId: string) => {
    const normalizedBranchId = branchId === DEFAULT_BRANCH.id ? branchId : DEFAULT_BRANCH.id;
    setSelectedBranchId(normalizedBranchId);
    saveToStorage(STORAGE_KEYS.selectedBranchId, normalizedBranchId);
    setCookie(COOKIE_KEYS.branchId, normalizedBranchId);
  }, []);

  const refreshBranches = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    selectBranch(selectedBranchId);
  }, [isAuthenticated, selectBranch, selectedBranchId]);

  const value = useMemo<BranchContextValue>(
    () => ({
      branches: isAuthenticated ? [DEFAULT_BRANCH] : [],
      selectedBranchId,
      isLoadingBranches: false,
      refreshBranches,
      selectBranch,
    }),
    [isAuthenticated, selectedBranchId, refreshBranches, selectBranch],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchContextValue {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error("useBranch must be used within BranchProvider");
  }

  return context;
}
