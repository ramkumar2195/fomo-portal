import { ReactNode } from "react";

interface BadgeProps {
  variant: "success" | "warning" | "error" | "info" | "neutral";
  children: ReactNode;
  size?: "sm" | "md";
}

const variantStyles: Record<BadgeProps["variant"], string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
  neutral: "bg-gray-50 text-gray-700 border-gray-200",
};

const sizeStyles: Record<NonNullable<BadgeProps["size"]>, string> = {
  sm: "text-[10px] px-2 py-0.5",
  md: "text-xs px-2.5 py-0.5",
};

export function Badge({ variant, children, size = "md" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${variantStyles[variant]} ${sizeStyles[size]}`}
    >
      {children}
    </span>
  );
}
