import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_KEYS } from "@/lib/constants";
import { UserRole } from "@/types/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.token)?.value;
  const role = cookieStore.get(COOKIE_KEYS.role)?.value as UserRole | undefined;
  const designation = cookieStore.get(COOKIE_KEYS.designation)?.value;
  const branchId = cookieStore.get(COOKIE_KEYS.branchId)?.value;

  if (!token) {
    redirect("/login");
  }

  const isSuperAdmin = role === "ADMIN" && designation === "SUPER_ADMIN";
  if (isSuperAdmin && !branchId) {
    redirect("/branch-selector");
  }

  redirect("/portal");
}
