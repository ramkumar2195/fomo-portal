import { ReactNode } from "react";

interface BadgeProps {
  variant: "success" | "warning" | "error" | "info" | "neutral";
  children: ReactNode;
  size?: "sm" | "md";
}

const variantStyles: Record<BadgeProps["variant"], string> = {
  success: "bg-[#eaf3de] text-[#27500a] border-transparent",
  warning: "bg-[#faeeda] text-[#633806] border-transparent",
  error: "bg-[#fcebeb] text-[#791f1f] border-transparent",
  info: "bg-[#e6f1fb] text-[#0c447c] border-transparent",
  neutral: "bg-[#eef0f3] text-[#5e6673] border-transparent",
};

const sizeStyles: Record<NonNullable<BadgeProps["size"]>, string> = {
  sm: "text-[10px] px-2 py-0.5",
  md: "text-[11px] px-2.5 py-0.5",
};

export function Badge({ variant, children, size = "md" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${variantStyles[variant]} ${sizeStyles[size]}`}
    >
      {children}
    </span>
  );
}
