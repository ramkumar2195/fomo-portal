"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { pushAuthDebug } from "@/lib/debug/auth-debug";
import { DEFAULT_ROUTE_BY_ROLE } from "@/lib/route-access";

export default function LoginPage() {
  const router = useRouter();
  const { login, user, isAuthenticated, isBootstrapping } = useAuth();

  const [mobileNumber, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isBootstrapping && isAuthenticated) {
      const destination = user ? DEFAULT_ROUTE_BY_ROLE[user.role] : "/portal";
      router.replace(destination);
    }
  }, [isBootstrapping, isAuthenticated, router, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    pushAuthDebug("login-page", "submit", {
      mobileLength: mobileNumber.length,
      hasPassword: Boolean(password),
    });

    try {
      const resolvedUser = await login({ mobileNumber, password });
      router.replace(DEFAULT_ROUTE_BY_ROLE[resolvedUser.role]);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to login";
      if (message.includes("only for ADMIN and STAFF")) {
        router.replace("/unauthorized");
        return;
      }
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Staff Portal Login</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in with mobile number and password</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-700">
            Mobile
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-800"
              type="tel"
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={mobileNumber}
              onChange={(event) => setMobile(event.target.value.replace(/[^0-9]/g, ""))}
              required
              minLength={10}
              maxLength={10}
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-800"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-500"
          >
            {isSubmitting ? "Signing in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
