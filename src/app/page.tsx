import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_KEYS } from "@/lib/constants";
import { DEFAULT_ROUTE_BY_ROLE } from "@/lib/route-access";
import { UserRole } from "@/types/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_KEYS.token)?.value;
  const role = cookieStore.get(COOKIE_KEYS.role)?.value as UserRole | undefined;

  if (!token) {
    redirect("/login");
  }

  if (!role) {
    redirect("/login");
  }

  redirect(DEFAULT_ROUTE_BY_ROLE[role]);
}
