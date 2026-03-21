"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { COOKIE_KEYS, STORAGE_KEYS } from "@/lib/constants";
import { clearCookie, getFromStorage, removeFromStorage, saveToStorage, setCookie } from "@/lib/storage";
import { usersService } from "@/lib/api/services/users-service";
import { isAdminOrStaff } from "@/lib/access-policy";
import { maskMobile, pushAuthDebug, tokenPreview } from "@/lib/debug/auth-debug";
import { AccessMetadata, AuthUser, LoginRequest } from "@/types/auth";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  refreshToken: string | null;
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

function getStoredRefreshToken(): string | null {
  return getFromStorage<string>(STORAGE_KEYS.refreshToken);
}

function getStoredAccessMetadata(): AccessMetadata | null {
  return getFromStorage<AccessMetadata>(STORAGE_KEYS.accessMetadata);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => (getStoredUser() ? getStoredToken() : null));
  const [refreshToken, setRefreshToken] = useState<string | null>(() =>
    getStoredUser() ? getStoredRefreshToken() : null,
  );
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
    pushAuthDebug("auth-context", "session:clear", {
      hadToken: Boolean(token),
      hadUser: Boolean(user),
    });

    setToken(null);
    setRefreshToken(null);
    setUser(null);
    setAccessMetadata(null);

    removeFromStorage(STORAGE_KEYS.token);
    removeFromStorage(STORAGE_KEYS.refreshToken);
    removeFromStorage(STORAGE_KEYS.user);
    removeFromStorage(STORAGE_KEYS.accessMetadata);
    removeFromStorage(STORAGE_KEYS.selectedBranchId);

    clearCookie(COOKIE_KEYS.token);
    clearCookie(COOKIE_KEYS.role);
    clearCookie(COOKIE_KEYS.designation);
    clearCookie(COOKIE_KEYS.branchId);
  }, [token, user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onUnauthorized = () => {
      pushAuthDebug("auth-context", "unauthorized:event", {
        pathname: typeof window !== "undefined" ? window.location.pathname : "",
      });
      clearSession();
      window.location.replace("/login");
    };

    window.addEventListener("fomo:unauthorized", onUnauthorized);
    return () => window.removeEventListener("fomo:unauthorized", onUnauthorized);
  }, [clearSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onTokenRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<{ accessToken?: unknown; refreshToken?: unknown }>).detail || {};
      const nextAccessToken = typeof detail.accessToken === "string" ? detail.accessToken : "";
      const nextRefreshToken = typeof detail.refreshToken === "string" ? detail.refreshToken : "";

      if (!nextAccessToken || !nextRefreshToken) {
        return;
      }

      pushAuthDebug("auth-context", "token:refreshed", {
        tokenPreview: tokenPreview(nextAccessToken),
        refreshTokenPreview: tokenPreview(nextRefreshToken),
      });

      setToken(nextAccessToken);
      setRefreshToken(nextRefreshToken);
      saveToStorage(STORAGE_KEYS.token, nextAccessToken);
      saveToStorage(STORAGE_KEYS.refreshToken, nextRefreshToken);
      setCookie(COOKIE_KEYS.token, nextAccessToken);
    };

    window.addEventListener("fomo:token-refreshed", onTokenRefreshed);
    return () => window.removeEventListener("fomo:token-refreshed", onTokenRefreshed);
  }, []);

  const login = useCallback(async (payload: LoginRequest): Promise<AuthUser> => {
    pushAuthDebug("auth-context", "login:start", {
      mobileNumber: maskMobile(payload.mobileNumber),
    });

    const response = await usersService.login(payload);
    if (!response.refreshToken) {
      throw new Error("Login response missing refreshToken");
    }
    pushAuthDebug("auth-context", "login:token-received", {
      tokenPreview: tokenPreview(response.token),
      tokenLength: response.token?.length,
      refreshTokenPreview: tokenPreview(response.refreshToken),
    });

    const resolvedUser = await usersService.getMe(response.token, response.user);
    pushAuthDebug("auth-context", "login:me-success", {
      userId: resolvedUser.id,
      role: resolvedUser.role,
      designation: resolvedUser.designation,
    });

    if (!isAdminOrStaff(resolvedUser)) {
      clearSession();
      throw new Error("Portal access is only for ADMIN and STAFF users.");
    }

    let resolvedAccessMetadata: AccessMetadata | null = null;

    try {
      resolvedAccessMetadata = await usersService.getAccessMetadata(response.token);
      pushAuthDebug("auth-context", "login:metadata-success", {
        hasMetadata: Boolean(resolvedAccessMetadata),
      });
    } catch (metadataError) {
      const message = metadataError instanceof Error ? metadataError.message : "Unable to load access metadata";
      pushAuthDebug("auth-context", "login:metadata-error", { message });
      console.warn(message);
    }

    setToken(response.token);
    setRefreshToken(response.refreshToken);
    setUser(resolvedUser);
    setAccessMetadata(resolvedAccessMetadata);

    saveToStorage(STORAGE_KEYS.token, response.token);
    saveToStorage(STORAGE_KEYS.refreshToken, response.refreshToken);
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

    pushAuthDebug("auth-context", "login:complete", {
      role: resolvedUser.role,
      designation: resolvedUser.designation,
    });

    return resolvedUser;
  }, [clearSession]);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      refreshToken,
      accessMetadata,
      isAuthenticated: Boolean(user && token),
      isBootstrapping,
      login,
      logout,
    }),
    [user, token, refreshToken, accessMetadata, isBootstrapping, login, logout],
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
