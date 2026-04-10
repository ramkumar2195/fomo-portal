import { useEffect } from "react";

interface ToastBannerProps {
  kind: "success" | "error" | "info" | "warning";
  message: string;
  onClose: () => void;
  autoDismiss?: boolean;
  dismissMs?: number;
}

const kindStyles: Record<ToastBannerProps["kind"], string> = {
  success: "border-emerald-200 bg-white text-emerald-700",
  error: "border-rose-200 bg-white text-rose-700",
  info: "border-sky-200 bg-white text-sky-700",
  warning: "border-amber-200 bg-white text-amber-700",
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
      <div className={`w-full max-w-md rounded-2xl border shadow-2xl ${kindStyles[kind]}`}>
        <div className="border-b border-slate-100 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {kind === "success" ? "Success" : kind === "error" ? "Action Required" : kind === "warning" ? "Warning" : "Notice"}
          </p>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-800">{message}</p>
        </div>
        <div className="flex justify-end px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#c42924] px-4 py-2 text-sm font-semibold text-white"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
