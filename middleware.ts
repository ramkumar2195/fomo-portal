import { NextRequest, NextResponse } from "next/server";
import { COOKIE_KEYS } from "@/lib/constants";
import { isAdminOrStaff } from "@/lib/access-policy";
import { DEFAULT_ROUTE_BY_ROLE, canAccessRoute } from "@/lib/route-access";
import { UserDesignation, UserRole } from "@/types/auth";

const PUBLIC_ROUTES = new Set(["/login", "/unauthorized"]);

function redirectTo(request: NextRequest, target: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = "";
  return NextResponse.redirect(url);
}

function clearAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete(COOKIE_KEYS.token);
  response.cookies.delete(COOKIE_KEYS.role);
  response.cookies.delete(COOKIE_KEYS.designation);
  response.cookies.delete(COOKIE_KEYS.branchId);
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_KEYS.token)?.value;
  const role = request.cookies.get(COOKIE_KEYS.role)?.value as UserRole | undefined;
  const cookieDesignation = request.cookies.get(COOKIE_KEYS.designation)?.value as UserDesignation | undefined;
  const designation = (cookieDesignation || (role === "ADMIN" ? "SUPER_ADMIN" : undefined)) as
    | UserDesignation
    | undefined;
  const branchId = request.cookies.get(COOKIE_KEYS.branchId)?.value;
  const isSuperAdmin = role === "ADMIN" && designation === "SUPER_ADMIN";

  if (PUBLIC_ROUTES.has(pathname)) {
    if (pathname === "/unauthorized") {
      return NextResponse.next();
    }

    if (token && role && isAdminOrStaff(role)) {
      if (isSuperAdmin && !branchId) {
        return redirectTo(request, "/branch-selector");
      }

      return redirectTo(request, DEFAULT_ROUTE_BY_ROLE[role]);
    }

    if (token && role && !isAdminOrStaff(role)) {
      return clearAuthCookies(redirectTo(request, "/unauthorized"));
    }

    return NextResponse.next();
  }

  if (!token || !role) {
    return redirectTo(request, "/login");
  }

  if (!isAdminOrStaff(role)) {
    return clearAuthCookies(redirectTo(request, "/unauthorized"));
  }

  if (!canAccessRoute(pathname, role, designation)) {
    return redirectTo(request, DEFAULT_ROUTE_BY_ROLE[role]);
  }

  if (pathname === "/branch-selector" && role === "STAFF") {
    return redirectTo(request, DEFAULT_ROUTE_BY_ROLE[role]);
  }

  if (pathname.startsWith("/portal") && isSuperAdmin && !branchId) {
    return redirectTo(request, "/branch-selector");
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
