interface ToastBannerProps {
  kind: "success" | "error";
  message: string;
  onClose: () => void;
}

export function ToastBanner({ kind, message, onClose }: ToastBannerProps) {
  const style =
    kind === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : "border-rose-300 bg-rose-50 text-rose-800";

  return (
    <div className={`fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 shadow ${style}`}>
      <div className="flex items-start gap-3">
        <p className="text-sm font-medium">{message}</p>
        <button type="button" onClick={onClose} className="text-xs font-semibold uppercase">
          Close
        </button>
      </div>
    </div>
  );
}
