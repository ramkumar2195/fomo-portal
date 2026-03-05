export function PageLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-100 bg-white shadow-sm">
      <p className="text-sm font-medium text-gray-600">{label}</p>
    </div>
  );
}
