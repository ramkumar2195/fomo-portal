export interface Branch {
  id: string;
  name: string;
  city?: string;
}

export interface UserDirectoryItem {
  id: string;
  name: string;
  mobile: string;
  role: string;
  email?: string;
  active?: boolean;
  employmentType?: string;
  designation?: string;
  dataScope?: string;
}

export interface DashboardMetrics {
  todaysInquiries: number;
  followUpsDue: number;
  conversionRate: number;
  revenueToday: number;
  revenueThisMonth: number;
}

export interface AdminOverviewMetrics {
  totalActiveMembers: number;
  expiredMembers: number;
  irregularMembers: number;
  totalPtClients: number;
  todaysRevenue: number;
  monthRevenue: number;
  todaysBirthdays: number;
  upcomingRenewals7Days: number;
  upcomingRenewals15Days: number;
  upcomingRenewals30Days: number;
  totalMembers: number;
  totalStaff: number;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  conversions: number;
  revenue: number;
}

export type InquiryStatus =
  | "NEW"
  | "FOLLOW_UP"
  | "TRIAL"
  | "NEGOTIATION"
  | "CONVERTED"
  | "LOST";

export interface Inquiry {
  id: string;
  name: string;
  mobile: string;
  status: InquiryStatus;
  source?: string;
  followUpAt?: string;
  notes?: string;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: string;
  issuedAt: string;
}

export interface Member {
  id: string;
  name: string;
  mobile: string;
  activePlan?: string;
  credits: number;
  ptSessions: number;
  checkIns: number;
  invoices: InvoiceSummary[];
}

export interface FreezeHistoryEntry {
  freezeId: string;
  freezeFrom?: string;
  freezeTo?: string;
  status?: string;
  reason?: string;
  days?: number;
  requestedAt?: string;
  approvedAt?: string;
  createdAt?: string;
}

export interface Plan {
  id: string;
  name: string;
  durationMonths: number;
  price: number;
  gstPercent?: number;
}

export interface BillingInvoice {
  subscriptionId?: string;
  invoiceId: string;
  invoiceNumber: string;
  receiptId?: string;
  receiptNumber?: string;
  total: number;
}

export interface TrainerAttendanceRecord {
  id: string;
  trainerId: string;
  trainerName: string;
  entryTime?: string;
  exitTime?: string;
  sessionsDone: number;
}

export interface ClassScheduleItem {
  id: string;
  className: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  occupancy: number;
  capacity: number;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  amount: number;
  receivedAt: string;
  invoiceNumber: string;
}

export interface DiscountLog {
  id: string;
  memberName: string;
  invoiceNumber: string;
  discountAmount: number;
  reason?: string;
  createdAt: string;
}
