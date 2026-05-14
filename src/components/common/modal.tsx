import { ReactNode, useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg" | "xl" | "xxl";
  /**
   * Cap on the modal's maximum height. Defaults to "tall"
   * (calc(100vh-2rem)) so existing call sites are unchanged. Pass
   * "half" to cap at 50vh — useful for popups whose content is
   * predominantly a quick read + the operator scrolls inside.
   * The body always scrolls; this prop only controls the OUTER
   * envelope so the modal sits centred on the page.
   */
  maxHeight?: "tall" | "half";
  children: ReactNode;
  footer?: ReactNode;
  closeOnOverlayClick?: boolean;
}

const sizeMap: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  xxl: "max-w-6xl",
};

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  maxHeight = "tall",
  children,
  footer,
  closeOnOverlayClick = true,
}: ModalProps) {
  // "half" was originally 50vh but that turned out too cramped for
  // popups with 4 info cards + status history + follow-up history.
  // Bumped to 80vh — still leaves a comfortable 10vh on top and
  // bottom so the modal floats clearly inside the page, but with
  // enough room for ~6-7 cards / row before scrolling kicks in.
  const heightClass = maxHeight === "half"
    ? "max-h-[80vh]"
    : "max-h-[calc(100vh-2rem)]";
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (closeOnOverlayClick && e.target === overlayRef.current) onClose();
      }}
    >
      <div className={`flex ${heightClass} w-full flex-col overflow-hidden ${sizeMap[size]} rounded-2xl bg-white shadow-xl`}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
