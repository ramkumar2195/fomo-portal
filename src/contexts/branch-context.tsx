"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { COOKIE_KEYS, STORAGE_KEYS } from "@/lib/constants";
import { getFromStorage, saveToStorage, setCookie } from "@/lib/storage";
import { branchService } from "@/lib/api/services/branch-service";
import { Branch } from "@/types/models";
import { useAuth } from "@/contexts/auth-context";

interface BranchContextValue {
  branches: Branch[];
  selectedBranchId: string;
  selectedBranchCode: string | undefined;
  effectiveBranchId: number | undefined;
  selectedBranchName: string;
  canSwitchBranches: boolean;
  isLoadingBranches: boolean;
  refreshBranches: () => Promise<void>;
  selectBranch: (branchId: string) => void;
}

const DEFAULT_BRANCH: Branch = {
  id: "all-branches",
  name: "All Branches",
  city: "UI only",
};

const BranchContext = createContext<BranchContextValue | undefined>(undefined);

export function BranchProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => getFromStorage<string>(STORAGE_KEYS.selectedBranchId) || "",
  );
  const canSwitchBranches = user?.role === "ADMIN";
  const realBranches = branches.filter((branch) => branch.id !== DEFAULT_BRANCH.id);
  const singleRealBranch = realBranches.length === 1 ? realBranches[0] : undefined;
  const selectedRealBranch = selectedBranchId
    ? realBranches.find((branch) => branch.id === selectedBranchId)
    : undefined;
  const defaultUserBranch = user?.defaultBranchId || "";
  const resolvedBranchId = !canSwitchBranches
    ? defaultUserBranch || singleRealBranch?.id || realBranches[0]?.id || ""
    : selectedBranchId === DEFAULT_BRANCH.id && realBranches.length > 1
      ? DEFAULT_BRANCH.id
      : selectedRealBranch?.id ||
        singleRealBranch?.id ||
        (defaultUserBranch && realBranches.some((branch) => branch.id === defaultUserBranch) ? defaultUserBranch : "") ||
        (realBranches.length > 1 ? DEFAULT_BRANCH.id : realBranches[0]?.id || "");

  const selectBranch = useCallback((branchId: string) => {
    if (!canSwitchBranches) {
      return;
    }
    const normalizedBranchId = branchId || DEFAULT_BRANCH.id;
    setSelectedBranchId(normalizedBranchId);
    saveToStorage(STORAGE_KEYS.selectedBranchId, normalizedBranchId);
    setCookie(COOKIE_KEYS.branchId, normalizedBranchId);
  }, [canSwitchBranches]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    saveToStorage(STORAGE_KEYS.selectedBranchId, resolvedBranchId);
    setCookie(COOKIE_KEYS.branchId, resolvedBranchId);
  }, [isAuthenticated, resolvedBranchId]);

  const refreshBranches = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setBranches([]);
      return;
    }

    setIsLoadingBranches(true);
    const fallbackBranches: Branch[] = !canSwitchBranches && user?.defaultBranchId
      ? [{
          id: user.defaultBranchId,
          name: `Branch ${user.defaultBranchId}`,
          city: "From user profile",
        }]
      : [];

    try {
      const page = await branchService.listBranches(token, { page: 0, size: 100 });
      const remoteBranches = page.content.map((item) => ({
        id: String(item.id),
        name: item.name,
        city: item.city || item.address || undefined,
        branchCode: item.branchCode || undefined,
      }));
      const scopedBranches = canSwitchBranches
        ? remoteBranches
        : remoteBranches.filter((branch) => branch.id === user?.defaultBranchId);
      const merged = [
        ...scopedBranches,
        ...(canSwitchBranches && scopedBranches.length > 1 ? [DEFAULT_BRANCH] : []),
      ];

      setBranches(merged.length > 0 ? merged : fallbackBranches);
    } catch {
      setBranches(fallbackBranches);
    } finally {
      setIsLoadingBranches(false);
    }

    saveToStorage(STORAGE_KEYS.selectedBranchId, resolvedBranchId);
    setCookie(COOKIE_KEYS.branchId, resolvedBranchId);
  }, [canSwitchBranches, isAuthenticated, resolvedBranchId, token, user?.defaultBranchId]);

  useEffect(() => {
    void refreshBranches();
  }, [refreshBranches]);

  const selectedBranch = branches.find((b) => b.id === resolvedBranchId);
  const isAllBranches = resolvedBranchId === DEFAULT_BRANCH.id;

  const value = useMemo<BranchContextValue>(
    () => ({
      branches: isAuthenticated ? branches : [],
      selectedBranchId: resolvedBranchId,
      selectedBranchCode: isAllBranches ? undefined : (selectedBranch?.branchCode || undefined),
      effectiveBranchId: isAllBranches ? undefined : (Number(resolvedBranchId) || undefined),
      selectedBranchName: isAllBranches ? "All Branches" : (selectedBranch?.name || ""),
      canSwitchBranches,
      isLoadingBranches,
      refreshBranches,
      selectBranch,
    }),
    [branches, canSwitchBranches, isAuthenticated, isAllBranches, isLoadingBranches, refreshBranches, resolvedBranchId, selectBranch, selectedBranch],
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
