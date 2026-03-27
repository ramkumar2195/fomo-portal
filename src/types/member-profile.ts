export type MemberProfileTabKey =
  | "overview"
  | "subscriptions"
  | "billing"
  | "attendance"
  | "credits-wallet"
  | "recovery-services"
  | "personal-training"
  | "progress"
  | "freeze-history"
  | "notes"
  | "audit-trail"
  | "fitness-assessment";

export interface MemberProfileShellTab {
  key: MemberProfileTabKey;
  label: string;
  endpoint?: string;
  enabled?: boolean;
}

export interface MemberProfileShellResponse {
  memberId: string;
  fullName: string;
  mobileNumber: string;
  email?: string;
  status?: string;
  branchId?: string;
  branchName?: string;
  summary: Record<string, unknown>;
  overview: Record<string, unknown>;
  tabs: MemberProfileShellTab[];
  raw: Record<string, unknown>;
}

export type ConditioningLevel = "ADVANCED" | "INTERMEDIATE" | "RETURNING_AFTER_BREAK" | "BEGINNER";
export type FitnessGoalTimeframe = "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM";
export type FitnessAssessmentCategory = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "SPECIAL_CONDITION";

export interface FitnessFormPersonalInfo {
  fullName?: string;
  gender?: string;
  age?: number;
  dateOfBirth?: string;
  mobileNumber?: string;
  email?: string;
}

export interface FitnessFormEmergencyContact {
  name?: string;
  mobileNumber?: string;
  relationship?: string;
}

export interface FitnessFormPhysicalReadiness {
  chestPainDuringActivity?: boolean;
  chestPainLastMonth?: boolean;
  losesBalanceOrConsciousness?: boolean;
  boneJointBackIssue?: boolean;
  takingPrescriptionForBloodPressureHeartConditionOrChronicIllness?: boolean;
  knowsOtherReasonToAvoidPhysicalActivity?: boolean;
  conditioningLevel?: ConditioningLevel;
}

export interface FitnessFormGoals {
  targetOutcome?: string;
  timeframe?: FitnessGoalTimeframe;
}

export interface FitnessFormExtendedHealth {
  diabetesThyroidHormonalDisorder?: boolean;
  asthmaRespiratoryCondition?: boolean;
  surgeryPastYear?: boolean;
  recentInjury?: boolean;
  chronicPain?: boolean;
  wearsMedicalDevices?: boolean;
  additionalNotes?: string;
}

export interface FitnessFormConsent {
  accepted?: boolean;
  signatureName?: string;
  signedAt?: string;
}

export interface MemberFitnessFormPayload {
  personalInfo?: FitnessFormPersonalInfo;
  emergencyContact?: FitnessFormEmergencyContact;
  physicalReadiness?: FitnessFormPhysicalReadiness;
  fitnessGoals?: FitnessFormGoals;
  extendedHealthScreening?: FitnessFormExtendedHealth;
  consent?: FitnessFormConsent;
  [key: string]: unknown;
}

export interface MemberFitnessFormStatusResponse {
  required?: boolean;
  completed?: boolean;
  completedAt?: string;
  lastUpdatedAt?: string;
  [key: string]: unknown;
}

export interface MemberAssessmentStatusResponse {
  workflowId?: string;
  required?: boolean;
  requested?: boolean;
  skipped?: boolean;
  completed?: boolean;
  status?: string;
  requestId?: string;
  assignedCoachId?: string;
  assignedCoachName?: string;
  scheduledAt?: string;
  completedAt?: string;
  score?: number;
  category?: FitnessAssessmentCategory;
  classification?: string;
  [key: string]: unknown;
}

export interface MemberAssessmentHistoryEntry {
  workflowId?: string;
  requestId?: string;
  status?: string;
  assignedCoachId?: string;
  assignedCoachName?: string;
  scheduledAt?: string;
  completedAt?: string;
  score?: number;
  category?: FitnessAssessmentCategory;
  classification?: string;
  raw: Record<string, unknown>;
}

export interface MemberFollowUpNote {
  followUpId?: string;
  dueAt?: string;
  channel?: string;
  status?: string;
  notes?: string;
  customMessage?: string;
  raw: Record<string, unknown>;
}

export interface MemberNotesResponse {
  memberId?: string;
  sourceInquiryId?: string;
  inquiryStatus?: string;
  inquiryNotes?: string;
  inquiryRemarks?: string;
  interestedIn?: string;
  latestFollowUpComment?: string;
  followUps: MemberFollowUpNote[];
  items: Array<Record<string, unknown>>;
  raw: unknown;
}

export interface MemberContextResponse {
  onboarding?: Record<string, unknown>;
  fitnessForm?: MemberFitnessFormStatusResponse;
  fitnessAssessment?: MemberAssessmentStatusResponse;
  raw: Record<string, unknown>;
}

export interface MemberAccessStateResponse {
  memberId?: string;
  status?: string;
  externalReference?: string;
  lastAction?: string;
  lastActionAt?: string;
  lastNotes?: string;
  createdAt?: string;
  updatedAt?: string;
  raw?: Record<string, unknown>;
}

export interface MemberProfileAuditEntry {
  auditId?: string;
  memberId?: string;
  actorId?: string;
  actorName?: string;
  action?: string;
  summary?: string;
  changesJson?: string;
  createdAt?: string;
  raw: Record<string, unknown>;
}

export interface CompleteAssessmentRequest {
  weight?: number;
  bmi?: number;
  bodyFat?: number;
  skeletalMuscleMass?: number;
  visceralFat?: number;
  bmr?: number;
  squat1RM?: number;
  bench1RM?: number;
  deadlift1RM?: number;
  pushups?: number;
  plankTime?: number;
  mobilityScore?: number;
  enduranceScore?: number;
  supermanUpDown?: number;
  sitAndReach?: number;
  sideBridgeLeft?: number;
  sideBridgeRight?: number;
  squatTestRepetitions?: number;
  pushUpsTestRepetitions?: number;
  trxInvertedRowRepetitions?: number;
  archType?: string;
  shoeFootNotes?: string;
  medicalRisk?: boolean;
  medicalRiskNotes?: string;
  [key: string]: unknown;
}
