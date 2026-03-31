export interface Branch {
  id: string;
  name: string;
  city?: string;
  branchCode?: string;
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
  defaultBranchId?: string;
  defaultTrainerStaffId?: string;
  sourceInquiryId?: string;
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

export interface SuperAdminDashboardUsers {
  totalUsers: number;
  totalMembers: number;
  totalStaff: number;
  totalCoaches: number;
  activeMembers: number;
  inactiveMembers: number;
  activeStaff: number;
  activeCoaches: number;
}

export interface SuperAdminDashboardInquiries {
  total: number;
  open: number;
  converted: number;
  closed: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
}

export interface SuperAdminDashboardRevenue {
  todayCollected: number;
  monthCollected: number;
  yearCollected: number;
  lifetimeCollected: number;
  monthOutstanding: number;
  yearOutstanding: number;
  lifetimeOutstanding: number;
  monthAverageInvoiceValue: number;
}

export interface SuperAdminDashboardSubscriptions {
  activeSubscriptions: number;
  ptClients: number;
  expiringIn7Days: number;
  expiringIn30Days: number;
  expiredSubscriptions: number;
  balanceDueInvoices: number;
  balanceDueAmount: number;
}

export interface SuperAdminDashboardEngagement {
  todayCheckIns: number;
  currentlyInside: number;
  onlineUsers: number;
  atRiskMembers: number;
  inactiveMembers3To5Days: number;
  inactiveMembers5PlusDays: number;
}

export interface SuperAdminDashboardMetrics {
  totalMembers: number;
  activeMembers: number;
  expiredMembers: number;
  irregularMembers: number;
  ptClients: number;
  ptActiveClients: number;
  ptInactiveClients: number;
  newMembersToday: number;
  totalLeadsToday: number;
  conversionRate: number;
  revenueToday: number;
  revenueThisMonth: number;
  revenueThisYear: number;
  revenueLifetime: number;
  activeSubscriptions: number;
  ptSessionsScheduledToday: number;
  classesRunningToday: number;
}

export interface SuperAdminDashboardSummaryMembers {
  totalMembers: number;
  activeMembers: number;
  inactiveMembers: number;
  expiredMembers: number;
  irregularMembers: number;
}

export interface SuperAdminDashboardSummaryPt {
  ptClients: number;
  ptActiveClients: number;
  ptInactiveClients: number;
}

export interface SuperAdminDashboardSummaryRevenue {
  revenueToday: number;
  revenueThisMonth: number;
  revenueThisYear: number;
  revenueLifetime: number;
}

export interface SuperAdminDashboardSummarySubscriptions {
  activeSubscriptions: number;
}

export interface SuperAdminDashboardSummaryNewMembers {
  today: number;
  month: number;
}

export interface SuperAdminDashboardSummaryStaff {
  totalStaff: number;
  activeStaff: number;
}

export interface SuperAdminDashboardSummaryCoaches {
  totalCoaches: number;
  activeCoaches: number;
}

export interface SuperAdminDashboardSummary {
  members: SuperAdminDashboardSummaryMembers;
  pt: SuperAdminDashboardSummaryPt;
  revenue: SuperAdminDashboardSummaryRevenue;
  subscriptions: SuperAdminDashboardSummarySubscriptions;
  newMembers: SuperAdminDashboardSummaryNewMembers;
  staff: SuperAdminDashboardSummaryStaff;
  coaches: SuperAdminDashboardSummaryCoaches;
}

export type DashboardDrilldownEntityType = "MEMBER" | "SUBSCRIPTION" | "REVENUE" | "STAFF" | "COACH";

export type DashboardDrilldownMetricKey =
  | "TOTAL_MEMBERS"
  | "ACTIVE_MEMBERS"
  | "INACTIVE_MEMBERS"
  | "EXPIRED_MEMBERS"
  | "IRREGULAR_MEMBERS"
  | "PT_CLIENTS"
  | "PT_ACTIVE_CLIENTS"
  | "PT_INACTIVE_CLIENTS"
  | "REVENUE_TODAY"
  | "REVENUE_THIS_MONTH"
  | "REVENUE_THIS_YEAR"
  | "REVENUE_LIFETIME"
  | "TOTAL_STAFF"
  | "ACTIVE_STAFF"
  | "TOTAL_COACHES"
  | "ACTIVE_COACHES"
  | "ACTIVE_SUBSCRIPTIONS"
  | "NEW_MEMBERS_TODAY"
  | "NEW_MEMBERS_THIS_MONTH";

export interface DashboardDrilldownMemberRow {
  memberId: string;
  fullName: string;
  mobileNumber: string;
  branchId?: string;
  branchName?: string;
  activePlan?: string;
  memberStatus?: string;
  paymentStatus?: string;
  attendancePercent?: number;
  ptClient?: boolean;
  createdAt?: string;
}

export interface DashboardDrilldownSubscriptionRow {
  subscriptionId: string;
  memberId?: string;
  memberName: string;
  mobileNumber: string;
  branchId?: string;
  branchName?: string;
  planName?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  amount?: number;
}

export interface DashboardDrilldownRevenueRow {
  invoiceId?: string;
  invoiceNumber?: string;
  receiptId?: string;
  receiptNumber?: string;
  memberId?: string;
  memberName: string;
  mobileNumber: string;
  branchId?: string;
  branchName?: string;
  amount?: number;
  collectedAt?: string;
  paymentStatus?: string;
  paymentMode?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface DashboardDrilldownStaffLikeRow {
  id: string;
  fullName: string;
  mobileNumber: string;
  designation?: string;
  role?: string;
  active?: boolean;
  branchId?: string;
  branchName?: string;
  employmentType?: string;
  dataScope?: string;
}

export type DashboardDrilldownRow =
  | DashboardDrilldownMemberRow
  | DashboardDrilldownSubscriptionRow
  | DashboardDrilldownRevenueRow
  | DashboardDrilldownStaffLikeRow;

export interface SuperAdminDashboardDrilldownResponse {
  metricKey: DashboardDrilldownMetricKey;
  entityType: DashboardDrilldownEntityType;
  generatedAt?: string;
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  content: DashboardDrilldownRow[];
  warnings: string[];
}

export interface SuperAdminInquiryAnalytics {
  totalInquiries: number;
  convertedInquiries: number;
  statusDistribution: unknown[] | Record<string, unknown>;
  sourceDistribution: unknown[] | Record<string, unknown>;
}

export interface SuperAdminBranchInsight {
  branchId: number;
  branchName: string;
  branchCode?: string;
  revenue: number;
  members: number;
  leads: number;
  converted: number;
  conversionRate: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
}

export interface SuperAdminDashboardAlerts {
  membershipsExpiringSoon: number;
  followUpsDueToday: number;
  followUpsOverdue: number;
  creditsExpiringSoon: number;
  trainerScheduleConflicts: number;
}

export interface SuperAdminDashboardResponse {
  generatedAt?: string;
  summary: SuperAdminDashboardSummary;
  metrics: SuperAdminDashboardMetrics;
  inquiryAnalytics: SuperAdminInquiryAnalytics;
  multiBranchInsights: SuperAdminBranchInsight[];
  alerts: SuperAdminDashboardAlerts;
  users: SuperAdminDashboardUsers;
  inquiries: SuperAdminDashboardInquiries;
  revenue: SuperAdminDashboardRevenue;
  subscriptions: SuperAdminDashboardSubscriptions;
  engagement: SuperAdminDashboardEngagement;
  warnings: string[];
}

export type InquiryStatus =
  | "NEW"
  | "CONTACTED"
  | "FOLLOW_UP"
  | "TRIAL_BOOKED"
  | "CONVERTED"
  | "NOT_INTERESTED"
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
  receiptId?: string;
  amount: number;
  status: string;
  issuedAt: string;
  dueAt?: string;
  subtotal?: number;
  tax?: number;
  paidAmount?: number;
  balanceAmount?: number;
  receiptNumber?: string;
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

export interface CatalogProduct {
  id: string;
  productCode?: string;
  categoryCode?: string;
  name: string;
  active?: boolean;
}

export interface CatalogVariant {
  id: string;
  productId?: string;
  productCode?: string;
  categoryCode?: string;
  code?: string;
  name: string;
  durationMonths: number;
  price: number;
  gstPercent?: number;
  active?: boolean;
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
  classType?: string;
  branchCode?: string;
  startTime: string;
  endTime: string;
  trainerName: string;
  occupancy: number;
  capacity: number;
  trainerId?: string;
  notes?: string;
  active?: boolean;
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
