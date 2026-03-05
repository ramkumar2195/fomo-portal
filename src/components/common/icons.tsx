import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function SvgBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </SvgBase>
  );
}

export function EnquiryIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H17a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5l-4.5 4v-4h-1A2.5 2.5 0 0 1 4 12.5z" />
      <path d="M8 8h8" />
      <path d="M8 11h6" />
    </SvgBase>
  );
}

export function MembersIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M4 19c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M14.5 18.5c.4-1.7 1.8-3 3.8-3 1.1 0 2.1.3 2.7 1" />
    </SvgBase>
  );
}

export function TrainersIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="8" cy="8" r="2.5" />
      <circle cx="16" cy="7" r="2" />
      <path d="M3.5 19c0-2.4 1.9-4.2 4.5-4.2s4.5 1.8 4.5 4.2" />
      <path d="M13 18.8c.2-1.8 1.7-3.2 3.8-3.2 1.4 0 2.6.5 3.2 1.4" />
      <path d="M6.5 12h5" />
      <path d="M9 10.5v3" />
    </SvgBase>
  );
}

export function StaffIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c0-2.9 2.3-5 6-5s6 2.1 6 5" />
      <rect x="17.5" y="13.5" width="4" height="4" rx="0.8" />
      <path d="M19.5 13.5v-1.2a1.2 1.2 0 0 0-2.4 0v1.2" />
    </SvgBase>
  );
}

export function RenewalsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M7.5 9a6 6 0 0 1 10-.8L20 10" />
      <path d="M16.5 15a6 6 0 0 1-10 .8L4 14" />
    </SvgBase>
  );
}

export function FollowUpsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </SvgBase>
  );
}

export function ReportsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M4 20h16" />
      <rect x="5" y="10" width="3" height="8" rx="1" />
      <rect x="10.5" y="6.5" width="3" height="11.5" rx="1" />
      <rect x="16" y="9" width="3" height="9" rx="1" />
    </SvgBase>
  );
}

export function CommunityIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="8.5" cy="9" r="2.5" />
      <circle cx="15.5" cy="9" r="2.5" />
      <path d="M3.5 18c0-2.3 2-4 5-4" />
      <path d="M20.5 18c0-2.3-2-4-5-4" />
      <path d="M8 19c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8" />
    </SvgBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1L4.8 9a1.9 1.9 0 1 1 2.7-2.7l.1.1a1 1 0 0 0 1.1.2h.1a1 1 0 0 0 .6-.9V5a2 2 0 1 1 4 0v.2a1 1 0 0 0 .6.9h.1a1 1 0 0 0 1.1-.2l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1 1 0 0 0-.2 1.1v.1a1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.6z" />
    </SvgBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4-4" />
    </SvgBase>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
      <path d="M3.5 9.5h17" />
    </SvgBase>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M15 17H5a2 2 0 0 1-2-2c1.5 0 2.5-1.3 2.5-3V9a6.5 6.5 0 0 1 13 0v3c0 1.7 1 3 2.5 3a2 2 0 0 1-2 2h-4" />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" />
    </SvgBase>
  );
}

export function ActiveMembersIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c0-3 2.2-5 6-5s6 2 6 5" />
      <path d="m17.5 5.5 1.2 1.2 2.8-2.8" />
    </SvgBase>
  );
}

export function ExpiredMembersIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c0-3 2.2-5 6-5s6 2 6 5" />
      <path d="m18 5.5 3 3" />
      <path d="m21 5.5-3 3" />
    </SvgBase>
  );
}

export function IrregularMembersIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c0-3 2.2-5 6-5s6 2 6 5" />
      <path d="M12 4v2" />
      <path d="M12 10v2" />
    </SvgBase>
  );
}

export function PTClientsIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="4" y="10.5" width="16" height="3" rx="1.2" />
      <path d="M7 10.5V8a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 17 8v2.5" />
      <path d="M9 13.5v2.5" />
      <path d="M15 13.5v2.5" />
    </SvgBase>
  );
}

export function RevenueIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M12 3v18" />
      <path d="M17 7.5c0-1.8-2.2-3.3-5-3.3s-5 1.5-5 3.3 2.2 3 5 3 5 1.2 5 3-2.2 3.3-5 3.3-5-1.5-5-3.3" />
    </SvgBase>
  );
}

export function BirthdayIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <rect x="4" y="11" width="16" height="9" rx="1.5" />
      <path d="M12 11v9" />
      <path d="M4 15.5h16" />
      <path d="M10.5 8.5c0-1.4-1.4-2.5-3-2.5 0 1.7 1.3 3 3 3h1V8.5z" />
      <path d="M13.5 8.5c0-1.4 1.4-2.5 3-2.5 0 1.7-1.3 3-3 3h-1V8.5z" />
    </SvgBase>
  );
}

export function RenewalsMetricIcon(props: IconProps) {
  return (
    <SvgBase {...props}>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M7.5 9a6 6 0 0 1 10-.8L20 10" />
      <path d="M16.5 15a6 6 0 0 1-10 .8L4 14" />
    </SvgBase>
  );
}
