import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Unauthorized</h1>
        <p className="mt-2 text-sm text-slate-600">
          This Staff Portal is only for ADMIN and STAFF users. COACH and MEMBER accounts are not allowed.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
