"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { COOKIE_KEYS, STORAGE_KEYS } from "@/lib/constants";
import { clearCookie, getFromStorage, removeFromStorage, saveToStorage, setCookie } from "@/lib/storage";
import { usersService } from "@/lib/api/services/users-service";
import { isAdminOrStaff } from "@/lib/access-policy";
import { AccessMetadata, AuthUser, LoginRequest } from "@/types/auth";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  accessMetadata: AccessMetadata | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (payload: LoginRequest) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function getStoredToken(): string | null {
  return getFromStorage<string>(STORAGE_KEYS.token);
}

function getStoredUser(): AuthUser | null {
  const storedUser = getFromStorage<AuthUser>(STORAGE_KEYS.user);
  if (!storedUser || !isAdminOrStaff(storedUser)) {
    return null;
  }

  return storedUser;
}

function getStoredAccessMetadata(): AccessMetadata | null {
  return getFromStorage<AccessMetadata>(STORAGE_KEYS.accessMetadata);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => (getStoredUser() ? getStoredToken() : null));
  const [accessMetadata, setAccessMetadata] = useState<AccessMetadata | null>(() =>
    getStoredUser() ? getStoredAccessMetadata() : null,
  );
  const isBootstrapping = false;

  useEffect(() => {
    if (token && user) {
      setCookie(COOKIE_KEYS.token, token);
      setCookie(COOKIE_KEYS.role, user.role);
      if (user.designation) {
        setCookie(COOKIE_KEYS.designation, user.designation);
      } else {
        clearCookie(COOKIE_KEYS.designation);
      }
    } else {
      clearCookie(COOKIE_KEYS.token);
      clearCookie(COOKIE_KEYS.role);
      clearCookie(COOKIE_KEYS.designation);
    }
  }, [token, user]);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setAccessMetadata(null);

    removeFromStorage(STORAGE_KEYS.token);
    removeFromStorage(STORAGE_KEYS.user);
    removeFromStorage(STORAGE_KEYS.accessMetadata);
    removeFromStorage(STORAGE_KEYS.selectedBranchId);

    clearCookie(COOKIE_KEYS.token);
    clearCookie(COOKIE_KEYS.role);
    clearCookie(COOKIE_KEYS.designation);
    clearCookie(COOKIE_KEYS.branchId);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onUnauthorized = () => {
      clearSession();
      window.location.replace("/login");
    };

    window.addEventListener("fomo:unauthorized", onUnauthorized);
    return () => window.removeEventListener("fomo:unauthorized", onUnauthorized);
  }, [clearSession]);

  const login = useCallback(async (payload: LoginRequest): Promise<AuthUser> => {
    const response = await usersService.login(payload);
    const resolvedUser = await usersService.getMe(response.token, response.user);

    if (!isAdminOrStaff(resolvedUser)) {
      clearSession();
      throw new Error("Portal access is only for ADMIN and STAFF users.");
    }

    let resolvedAccessMetadata: AccessMetadata | null = null;

    try {
      resolvedAccessMetadata = await usersService.getAccessMetadata(response.token);
    } catch (metadataError) {
      const message = metadataError instanceof Error ? metadataError.message : "Unable to load access metadata";
      console.warn(message);
    }

    setToken(response.token);
    setUser(resolvedUser);
    setAccessMetadata(resolvedAccessMetadata);

    saveToStorage(STORAGE_KEYS.token, response.token);
    saveToStorage(STORAGE_KEYS.user, resolvedUser);
    if (resolvedAccessMetadata) {
      saveToStorage(STORAGE_KEYS.accessMetadata, resolvedAccessMetadata);
    } else {
      removeFromStorage(STORAGE_KEYS.accessMetadata);
    }

    setCookie(COOKIE_KEYS.token, response.token);
    setCookie(COOKIE_KEYS.role, resolvedUser.role);
    if (resolvedUser.designation) {
      setCookie(COOKIE_KEYS.designation, resolvedUser.designation);
    } else {
      clearCookie(COOKIE_KEYS.designation);
    }

    if (resolvedUser.role === "STAFF") {
      const autoBranchId = resolvedUser.defaultBranchId || "default";
      saveToStorage(STORAGE_KEYS.selectedBranchId, autoBranchId);
      setCookie(COOKIE_KEYS.branchId, autoBranchId);
    } else {
      removeFromStorage(STORAGE_KEYS.selectedBranchId);
      clearCookie(COOKIE_KEYS.branchId);
    }

    return resolvedUser;
  }, [clearSession]);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      accessMetadata,
      isAuthenticated: Boolean(user && token),
      isBootstrapping,
      login,
      logout,
    }),
    [user, token, accessMetadata, isBootstrapping, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
