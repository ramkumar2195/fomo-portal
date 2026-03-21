import { useEffect } from "react";

interface ToastBannerProps {
  kind: "success" | "error" | "info" | "warning";
  message: string;
  onClose: () => void;
  autoDismiss?: boolean;
  dismissMs?: number;
}

const kindStyles: Record<ToastBannerProps["kind"], string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-800",
  error: "border-rose-300 bg-rose-50 text-rose-800",
  info: "border-blue-300 bg-blue-50 text-blue-800",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
};

export function ToastBanner({
  kind,
  message,
  onClose,
  autoDismiss = true,
  dismissMs = 5000,
}: ToastBannerProps) {
  useEffect(() => {
    if (!autoDismiss) return;
    const timer = setTimeout(onClose, dismissMs);
    return () => clearTimeout(timer);
  }, [autoDismiss, dismissMs, onClose]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 rounded-lg border px-4 py-3 shadow ${kindStyles[kind]}`}
    >
      <div className="flex items-start gap-3">
        <p className="text-sm font-medium">{message}</p>
        <button type="button" onClick={onClose} className="text-xs font-semibold uppercase">
          Close
        </button>
      </div>
    </div>
  );
}
