import { SVGProps } from "react";
import {
  BarChart3,
  Bell,
  Cake,
  CalendarDays,
  Clock3,
  Dumbbell,
  Fingerprint,
  Handshake,
  IndianRupee,
  LayoutDashboard,
  MessageSquareText,
  RefreshCcw,
  RefreshCw,
  Search,
  Settings,
  UserCheck,
  UserCog,
  UserMinus,
  UserX,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

function renderIcon(Icon: LucideIcon, props: IconProps) {
  return <Icon aria-hidden="true" strokeWidth={1.8} {...props} />;
}

export function DashboardIcon(props: IconProps) {
  return renderIcon(LayoutDashboard, props);
}

export function EnquiryIcon(props: IconProps) {
  return renderIcon(MessageSquareText, props);
}

export function MembersIcon(props: IconProps) {
  return renderIcon(Users, props);
}

export function TrainersIcon(props: IconProps) {
  return renderIcon(Dumbbell, props);
}

export function StaffIcon(props: IconProps) {
  return renderIcon(UserCog, props);
}

export function RenewalsIcon(props: IconProps) {
  return renderIcon(RefreshCcw, props);
}

export function FollowUpsIcon(props: IconProps) {
  return renderIcon(Clock3, props);
}

export function ReportsIcon(props: IconProps) {
  return renderIcon(BarChart3, props);
}

export function CommunityIcon(props: IconProps) {
  return renderIcon(Users2, props);
}

export function SettingsIcon(props: IconProps) {
  return renderIcon(Settings, props);
}

export function SearchIcon(props: IconProps) {
  return renderIcon(Search, props);
}

export function CalendarIcon(props: IconProps) {
  return renderIcon(CalendarDays, props);
}

export function BellIcon(props: IconProps) {
  return renderIcon(Bell, props);
}

export function ActiveMembersIcon(props: IconProps) {
  return renderIcon(UserCheck, props);
}

export function ExpiredMembersIcon(props: IconProps) {
  return renderIcon(UserX, props);
}

export function IrregularMembersIcon(props: IconProps) {
  return renderIcon(UserMinus, props);
}

export function PTClientsIcon(props: IconProps) {
  return renderIcon(Handshake, props);
}

export function RevenueIcon(props: IconProps) {
  return renderIcon(IndianRupee, props);
}

export function BiometricIcon(props: IconProps) {
  return renderIcon(Fingerprint, props);
}

export function BirthdayIcon(props: IconProps) {
  return renderIcon(Cake, props);
}

export function RenewalsMetricIcon(props: IconProps) {
  return renderIcon(RefreshCw, props);
}
