import { SpringPage } from "@/types/pagination";

export interface BranchResponse {
  id: number;
  name: string;
  branchCode?: string;
  address: string;
  city: string;
  managerId: number | null;
  managerName?: string | null;
  capacity: number;
  activeMembers: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type BranchPage = SpringPage<BranchResponse>;

export interface BranchCapacityResponse {
  capacity?: number;
  activeMembers?: number;
  utilizationPercent?: number;
  availableSlots?: number;
  [key: string]: unknown;
}

export interface BranchOverviewResponse {
  branchId: number;
  branchName: string;
  branchCode: string;
  city: string;
  managerId: number | null;
  capacity: number;
  activeMembers: number;
  availableSlots: number;
  occupancyRate: number;
  totalMembers: number;
  totalCoaches: number;
  totalStaff: number;
  totalPrograms: number;
  activePrograms: number;
  todayCheckIns: number;
  currentlyCheckedIn: number;
  totalInquiries: number;
  convertedInquiries: number;
  openInquiries: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
  invoicesIssued: number;
  invoicesPaid: number;
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  fromDate?: string;
  toDate?: string;
  warnings: string[];
  [key: string]: unknown;
}

export interface BranchRevenuePoint {
  label: string;
  amount: number;
  collected?: number;
  outstanding?: number;
  [key: string]: unknown;
}

export interface BranchRevenueResponse {
  from?: string;
  to?: string;
  totalCollected: number;
  totalOutstanding: number;
  averageInvoiceValue: number;
  points: BranchRevenuePoint[];
  [key: string]: unknown;
}

export interface BranchCurrentCheckInRecord {
  checkInId: string;
  memberId: string;
  memberName: string;
  mobileNumber: string;
  gymId: string;
  status: string;
  source: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  [key: string]: unknown;
}

export interface BranchCurrentCheckInsResponse {
  todayCheckIns: number;
  currentlyCheckedIn: number;
  records: BranchCurrentCheckInRecord[];
  warnings: string[];
  [key: string]: unknown;
}

export type BranchMembersDirectoryFilter = "ALL" | "ACTIVE" | "EXPIRED" | "IRREGULAR" | "PT" | "NON_PT" | "PT_ACTIVE" | "PT_INACTIVE";

export interface BranchMembersDirectorySummary {
  activeMembers: number;
  expiredMembers: number;
  irregularMembers: number;
  ptClients: number;
  [key: string]: unknown;
}

export interface BranchDirectoryMemberRow {
  branchId: string;
  branchName: string;
  memberId: string;
  fullName: string;
  mobileNumber: string;
  activePlan: string;
  attendancePercent: number;
  memberStatus: string;
  paymentStatus: string;
  outstandingAmount: number;
  ptClient: boolean;
  [key: string]: unknown;
}

export interface BranchMembersDirectoryResponse {
  summary: BranchMembersDirectorySummary;
  members: SpringPage<BranchDirectoryMemberRow>;
  [key: string]: unknown;
}

export interface BranchProgramSummary {
  id: string;
  name: string;
  status?: string;
  trainerName?: string;
  membersEnrolled?: number;
  maxCapacity?: number;
  completionRate?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AdminMetricsResponse {
  generatedAt?: string;
  totalMembers: number;
  activeMembers: number;
  newMembersToday?: number;
  totalLeadsToday?: number;
  conversionRate?: number;
  revenueToday?: number;
  monthlyRevenue: number;
  ptRevenue: number;
  programRevenue: number;
  retentionRate: number;
  trainerUtilization: number;
  leadConversionRate: number;
  activeSubscriptions?: number;
  ptSessionsScheduledToday?: number;
  classesRunningToday?: number;
  creditsExpiringSoon?: number;
  trainerScheduleConflicts?: number;
  expiredMembers?: number;
  irregularMembers?: number;
  ptClients?: number;
  todaysRevenue?: number;
  todaysBirthdays?: number;
  upcomingRenewals7Days?: number;
}

export type DashboardDrilldownMetricType =
  | "ACTIVE_MEMBERS"
  | "INACTIVE_MEMBERS"
  | "EXPIRING_MEMBERSHIPS"
  | "AT_RISK_MEMBERS"
  | "INQUIRIES_BY_STATUS"
  | "REVENUE_TRANSACTIONS";

export type DashboardDrilldownPeriod = "TODAY" | "MONTH" | "YEAR" | "CUSTOM";

export interface DashboardSearchMember {
  memberId: string;
  fullName: string;
  mobileNumber: string;
  branchId: string;
  branchName: string;
}

export interface DashboardSearchInquiry {
  inquiryId: string;
  fullName: string;
  mobileNumber: string;
  status: string;
  convertibility: string;
  branchCode: string;
}

export interface DashboardSearchStaffLike {
  id: string;
  fullName: string;
  designation: string;
  mobileNumber: string;
  branchId: string;
  branchName: string;
}

export interface DashboardSearchResponse {
  members: DashboardSearchMember[];
  inquiries: DashboardSearchInquiry[];
  staff: DashboardSearchStaffLike[];
  coaches: DashboardSearchStaffLike[];
  warnings: string[];
}

export interface DashboardDrilldownResponse {
  metricType: DashboardDrilldownMetricType;
  status?: string | null;
  period?: DashboardDrilldownPeriod | string;
  fromDate?: string;
  toDate?: string;
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  content: Record<string, unknown>[];
  warnings: string[];
}

export interface TrainerUtilizationRow {
  trainerId: string;
  trainerName: string;
  sessionsConducted: number;
  ptRevenue: number;
  programSessions: number;
  utilizationPercent: number;
  branchId?: string;
  branchName?: string;
  fromDate?: string;
  toDate?: string;
}

export interface TrainerUtilizationResponse {
  branchId?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  content: TrainerUtilizationRow[];
}

export interface TrainingProgramSummary {
  id: string;
  name: string;
  description?: string;
  status?: string;
  duration?: string;
  durationWeeks?: number;
  trainerId?: number | string;
  trainerName?: string;
  branchId?: number;
  membersEnrolled?: number;
  maxCapacity?: number;
  completionRate?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CommunityPostSummary {
  id: string;
  authorName?: string;
  content: string;
  createdAt?: string;
  likesCount?: number;
  commentsCount?: number;
  [key: string]: unknown;
}
