import { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ title, subtitle, actions, children }: SectionCardProps) {
  return (
    <section className="rounded-[28px] border border-white/8 bg-[#131925] p-6 shadow-[0_22px_65px_rgba(0,0,0,0.3)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
