"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { subscriptionFollowUpService } from "@/lib/api/services/subscription-followup-service";
import { CatalogVariant, subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { resolveStaffId } from "@/lib/staff-id";
import type { FollowUpChannel } from "@/types/follow-up";
import type { InquiryResponseType } from "@/types/inquiry";
import type { AuthUser } from "@/types/auth";
import {
  EMPLOYMENT_STATUS_OPTIONS,
  GENDER_OPTIONS,
  OTHER_REFERRAL_OPTIONS,
  PREFERRED_CONTACT_CHANNEL_OPTIONS,
  PROMOTION_SOURCE_OPTIONS,
  REFERRED_BY_TYPE_OPTIONS,
  RESPONSE_TYPE_OPTIONS,
  deriveInquiryStatusFromResponseType,
} from "./inquiry-form-constants";
import type {
  FollowUpPlanValues,
  InquiryCoreFormValues,
  InquiryCreateFormValues,
  SelectOption,
  StaffOption,
} from "./inquiry-form-types";
import {
  buildFullName,
  createEmptyFollowUpPlan,
  createEmptyInquiryForm,
  getQuickPickDate,
  parseNumeric,
  sanitizeFormValue,
  toCreateInquiryPayload,
  toIsoDatetime,
  toOptionalString,
} from "./inquiry-form-utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateInquiryModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  staffOptions: StaffOption[];
  initialStaffId: number | null;
  effectiveBranchId?: number;
  effectiveBranchCode: string;
  token: string;
  user: AuthUser | null;
}

// ---------------------------------------------------------------------------
// Tiny UI primitives (internal)
// ---------------------------------------------------------------------------

function RequiredFieldIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 text-rose-600">
      <path d="M10 2.8a1 1 0 0 1 .95.68l1.03 3.16h3.32a1 1 0 0 1 .59 1.81l-2.69 1.96 1.03 3.15a1 1 0 0 1-1.54 1.12L10 12.72l-2.69 1.96a1 1 0 0 1-1.54-1.12l1.03-3.15-2.69-1.96a1 1 0 0 1 .58-1.81h3.33l1.03-3.16A1 1 0 0 1 10 2.8Z" />
    </svg>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-600">
      {children}
      {required && <RequiredFieldIcon />}
    </label>
  );
}

const INPUT_CLASS = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400";
const SELECT_CLASS = INPUT_CLASS;

// ---------------------------------------------------------------------------
// Pill selector
// ---------------------------------------------------------------------------

interface PillOption {
  label: string;
  value: string;
  activeClass?: string;
}

function PillSelector({
  options,
  value,
  onChange,
}: {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = opt.value === value;
        const activeStyle = opt.activeClass ?? "bg-red-600 text-white border-red-600";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              isActive ? activeStyle : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = [
  { number: 1, label: "Contact Info" },
  { number: 2, label: "Enquiry Details" },
  { number: 3, label: "Follow-up" },
] as const;

function StepIndicator({ current, onNavigate }: { current: number; onNavigate: (s: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, idx) => {
        const isActive = step.number === current;
        const isCompleted = step.number < current;
        return (
          <div key={step.number} className="flex items-center">
            {idx > 0 && (
              <div className={`mx-1.5 h-px w-8 sm:w-12 ${isCompleted ? "bg-red-400" : "bg-slate-200"}`} />
            )}
            <button
              type="button"
              onClick={() => onNavigate(step.number)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-red-50 text-red-700"
                  : isCompleted
                    ? "text-red-600 hover:bg-red-50/50"
                    : "text-slate-400"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  isActive
                    ? "bg-red-600 text-white"
                    : isCompleted
                      ? "bg-red-100 text-red-600"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {isCompleted ? "\u2713" : step.number}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CreateInquiryModal({
  open,
  onClose,
  onCreated,
  staffOptions,
  initialStaffId,
  effectiveBranchId,
  effectiveBranchCode,
  token,
  user,
}: CreateInquiryModalProps) {
  const router = useRouter();
  // -- wizard step -----------------------------------------------------------
  const [step, setStep] = useState(1);

  // -- form state ------------------------------------------------------------
  const [newInquiry, setNewInquiry] = useState<InquiryCreateFormValues>(() =>
    createEmptyInquiryForm(initialStaffId),
  );
  const [followUpPlan, setFollowUpPlan] = useState<FollowUpPlanValues>(() =>
    createEmptyFollowUpPlan(initialStaffId),
  );

  // -- UI state --------------------------------------------------------------
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [showAdditionalContact, setShowAdditionalContact] = useState(false);
  const [referredByOptions, setReferredByOptions] = useState<SelectOption[]>([]);
  const [loadingReferredByOptions, setLoadingReferredByOptions] = useState(false);
  const [interestedInOptions, setInterestedInOptions] = useState<SelectOption[]>([]);

  // -- reset on open/close ---------------------------------------------------
  useEffect(() => {
    if (open) {
      setStep(1);
      setNewInquiry(createEmptyInquiryForm(initialStaffId));
      setFollowUpPlan(createEmptyFollowUpPlan(initialStaffId));
      setIsSubmitting(false);
      setSubmitError(null);
      setStepErrors([]);
      setShowAdditionalContact(false);
    }
  }, [open, initialStaffId]);

  useEffect(() => {
    if (!open || !token) return;

    let isCancelled = false;

    const loadInterestedInOptions = async () => {
      try {
        const variants = await subscriptionService.getCatalogVariants(token);
        if (isCancelled) {
          return;
        }

        const options = variants
          .filter((variant: CatalogVariant) => Boolean(variant.variantName))
          .sort((left, right) => left.variantName.localeCompare(right.variantName))
          .map((variant) => ({
            label: variant.variantName,
            value: variant.variantName,
          }));

        const uniqueOptions = Array.from(new Map(options.map((option) => [option.value, option])).values());
        setInterestedInOptions(uniqueOptions);
      } catch {
        if (!isCancelled) {
          setInterestedInOptions([]);
        }
      }
    };

    void loadInterestedInOptions();

    return () => {
      isCancelled = true;
    };
  }, [open, token]);

  // -- field setters ---------------------------------------------------------
  const setIntakeField = useCallback(
    (key: keyof InquiryCoreFormValues, value: string) => {
      setNewInquiry((prev) => ({ ...prev, [key]: sanitizeFormValue(key, value) }));
    },
    [],
  );

  const setFollowUpField = useCallback(
    <K extends keyof FollowUpPlanValues>(key: K, value: FollowUpPlanValues[K]) => {
      setFollowUpPlan((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "responseType") {
          const responseType = value as InquiryResponseType;
          if (responseType !== "REQUESTED_TRIAL") {
            next.trialGiven = false;
            next.trialDays = "";
            next.trialExpiryAt = "";
          }
          if (responseType !== "ASKED_CALLBACK" && responseType !== "NEEDS_DETAILS") {
            next.followUpAt = "";
          }
        }
        if (key === "trialGiven" && value === false) {
          next.trialDays = "";
          next.trialExpiryAt = "";
        }
        return next;
      });
    },
    [],
  );

  const isNextFollowUpRequired =
    followUpPlan.responseType === "ASKED_CALLBACK"
    || followUpPlan.responseType === "NEEDS_DETAILS"
    || followUpPlan.responseType === "REQUESTED_TRIAL";
  const isTrialGivenRequired = followUpPlan.responseType === "REQUESTED_TRIAL";

  // -- referred-by options ---------------------------------------------------
  useEffect(() => {
    if (!open) return;

    const referredType = newInquiry.referredByType.trim().toUpperCase();
    if (!referredType) {
      setReferredByOptions([]);
      setLoadingReferredByOptions(false);
      return;
    }

    if (referredType === "OTHER") {
      setReferredByOptions(OTHER_REFERRAL_OPTIONS);
      setLoadingReferredByOptions(false);
      return;
    }

    if (!token) return;

    let isCancelled = false;

    const loadReferredOptions = async () => {
      setLoadingReferredByOptions(true);
      try {
        const role = referredType === "MEMBER" ? "MEMBER" : referredType === "TRAINER" ? "COACH" : "STAFF";
        const records = await usersService.searchUsers(token, { role, active: true });
        const options = records
          .map((record) => ({
            label: `${record.name} (${record.mobile})`,
            value: record.name,
          }))
          .filter((opt) => opt.value.trim().length > 0);
        if (!isCancelled) setReferredByOptions(options);
      } catch {
        if (!isCancelled) setReferredByOptions([]);
      } finally {
        if (!isCancelled) setLoadingReferredByOptions(false);
      }
    };

    void loadReferredOptions();
    return () => {
      isCancelled = true;
    };
  }, [open, newInquiry.referredByType, token]);

  // -- per-step validation ---------------------------------------------------
  const validateStep = useCallback(
    (s: number): string[] => {
      const missing: string[] = [];

      if (s === 1) {
        if (!newInquiry.firstName.trim()) missing.push("Customer Name");
        if (newInquiry.mobileNumber.trim().length !== 10) missing.push("Mobile Number (10 digits)");
        if (!newInquiry.gender) missing.push("Gender");
      }

      if (s === 2) {
        if (!toIsoDatetime(newInquiry.inquiryAt)) missing.push("Enquiry Date");
        if (!newInquiry.clientRepStaffId.trim()) missing.push("Client Rep");
        if (!newInquiry.promotionSource.trim()) missing.push("Source of Promotion");
        if (!newInquiry.convertibility.trim()) missing.push("Convertibility");
      }

      if (s === 3) {
        if (isNextFollowUpRequired && !toIsoDatetime(followUpPlan.followUpAt)) missing.push("Next Follow-up Date");
        if (isTrialGivenRequired && !followUpPlan.trialGiven) missing.push("Trial Given");
        if (isTrialGivenRequired && followUpPlan.trialGiven && !followUpPlan.trialDays.trim()) missing.push("Trial Days");
        if (isTrialGivenRequired && followUpPlan.trialGiven && !toIsoDatetime(followUpPlan.trialExpiryAt)) missing.push("Trial Expiry");
        if (!followUpPlan.followUpComment.trim()) missing.push("Follow-up Comment");
        if (followUpPlan.responseType === "NOT_INTERESTED" && !newInquiry.closeReason.trim()) missing.push("Close Reason");
      }

      return missing;
    },
    [followUpPlan, isNextFollowUpRequired, isTrialGivenRequired, newInquiry],
  );

  const goNext = useCallback(() => {
    const errors = validateStep(step);
    if (errors.length > 0) {
      setStepErrors(errors);
      return;
    }
    setStepErrors([]);
    setStep((s) => Math.min(3, s + 1));
  }, [step, validateStep]);

  const goBack = useCallback(() => {
    setStepErrors([]);
    setStep((s) => Math.max(1, s - 1));
  }, []);

  const navigateToStep = useCallback(
    (target: number) => {
      if (target < step) {
        setStepErrors([]);
        setStep(target);
        return;
      }
      // Validate all steps up to target
      for (let s = step; s < target; s++) {
        const errors = validateStep(s);
        if (errors.length > 0) {
          setStepErrors(errors);
          setStep(s);
          return;
        }
      }
      setStepErrors([]);
      setStep(target);
    },
    [step, validateStep],
  );

  // -- submit ----------------------------------------------------------------
  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      // Validate all steps
      for (let s = 1; s <= 3; s++) {
        const errors = validateStep(s);
        if (errors.length > 0) {
          setStepErrors(errors);
          setStep(s);
          return;
        }
      }

      setIsSubmitting(true);
      setSubmitError(null);
      setStepErrors([]);

      try {
        const fullName = buildFullName(newInquiry);
        const dueAt = toIsoDatetime(followUpPlan.followUpAt);
        const assignedToStaffId = parseNumeric(followUpPlan.assignedToStaffId);
        const createdByStaffId = resolveStaffId(user) ?? assignedToStaffId;

        if (
          (toIsoDatetime(followUpPlan.followUpAt) && assignedToStaffId === undefined) ||
          createdByStaffId === undefined ||
          Number.isNaN(Number(createdByStaffId))
        ) {
          setSubmitError("Assigned staff is required to schedule follow-up.");
          setIsSubmitting(false);
          return;
        }

        const requestPayload: InquiryCoreFormValues = {
          ...newInquiry,
          fullName,
          status: deriveInquiryStatusFromResponseType(followUpPlan.responseType),
          branchCode: newInquiry.branchCode || effectiveBranchCode,
          responseType: followUpPlan.responseType,
          preferredContactChannel: followUpPlan.contactType,
          trialGiven: followUpPlan.trialGiven,
          trialDays: followUpPlan.trialDays,
          trialExpiryAt: followUpPlan.trialExpiryAt,
          followUpComment: followUpPlan.followUpComment,
        };

        const created = await subscriptionService.createInquiry(token, {
          ...toCreateInquiryPayload(requestPayload),
          branchId: effectiveBranchId,
        });

        const inquiryId = Number(created.inquiryId);
        if (Number.isNaN(inquiryId)) {
          throw new Error("Enquiry created but enquiryId was missing in response.");
        }

        if (dueAt && assignedToStaffId !== undefined) {
          await subscriptionFollowUpService.createFollowUp(token, inquiryId, {
            dueAt: dueAt,
            channel: followUpPlan.contactType,
            assignedToStaffId,
            createdByStaffId,
            notes: toOptionalString(followUpPlan.followUpComment),
            responseType: followUpPlan.responseType,
          });
        }

        await Promise.resolve(onCreated());

        if (followUpPlan.responseType === "READY_TO_PAY") {
          const params = new URLSearchParams();
          params.set("sourceInquiryId", String(inquiryId));
          if (fullName.trim()) {
            params.set("name", fullName.trim());
          }
          if (newInquiry.mobileNumber.trim()) {
            params.set("mobile", newInquiry.mobileNumber.trim());
          }
          if (newInquiry.email.trim()) {
            params.set("email", newInquiry.email.trim());
          }
          router.push(`/portal/members/add?${params.toString()}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to add enquiry";
        setSubmitError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [newInquiry, followUpPlan, token, user, effectiveBranchCode, effectiveBranchId, validateStep, onCreated, router],
  );

  // -- convertibility pill styles -------------------------------------------
  const convertibilityPills: PillOption[] = useMemo(
    () => [
      { label: "Hot", value: "HOT", activeClass: "bg-rose-600 text-white border-rose-600" },
      { label: "Warm", value: "WARM", activeClass: "bg-amber-500 text-white border-amber-500" },
      { label: "Cold", value: "COLD", activeClass: "bg-blue-600 text-white border-blue-600" },
    ],
    [],
  );

  const genderPills: PillOption[] = useMemo(
    () =>
      GENDER_OPTIONS.map((g) => ({
        label: g.label,
        value: g.value,
      })),
    [],
  );

  const contactChannelPills: PillOption[] = useMemo(
    () =>
      PREFERRED_CONTACT_CHANNEL_OPTIONS.map((c) => ({
        label: c.label,
        value: c.value,
      })),
    [],
  );

  // -------------------------------------------------------------------------
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Add Enquiry</h2>
              <p className="text-xs text-slate-500">
                Capture enquiry details and follow-up context in one flow.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StepIndicator current={step} onNavigate={navigateToStep} />
            <button
              type="button"
              onClick={onClose}
              className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        {/* ─── Body (scrollable) ──────────────────────────────────────── */}
        <form id="create-inquiry-form" className="flex-1 overflow-y-auto" onSubmit={onSubmit}>
          <div className="space-y-4 p-5">
            {/* Error banner */}
            {(stepErrors.length > 0 || submitError) && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {submitError && <p>{submitError}</p>}
                {stepErrors.length > 0 && (
                  <p>Missing required fields: {stepErrors.join(", ")}</p>
                )}
              </div>
            )}

            {/* ━━━ STEP 1: Contact Info ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {step === 1 && (
              <div className="space-y-4">
                <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Contact Information</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {/* First Name */}
                    <div>
                      <FieldLabel required>Customer Name</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        placeholder="First name"
                        value={newInquiry.firstName}
                        required
                        onChange={(e) =>
                          setNewInquiry((prev) => ({ ...prev, firstName: e.target.value }))
                        }
                      />
                    </div>
                    {/* Last Name */}
                    <div>
                      <FieldLabel>Last Name</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        placeholder="Last name"
                        value={newInquiry.lastName}
                        onChange={(e) =>
                          setNewInquiry((prev) => ({ ...prev, lastName: e.target.value }))
                        }
                      />
                    </div>
                    {/* Mobile */}
                    <div>
                      <FieldLabel required>Mobile Number</FieldLabel>
                      <div className="flex">
                        <span className="flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold text-slate-500">
                          +91
                        </span>
                        <input
                          className="w-full rounded-r-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
                          value={newInquiry.mobileNumber}
                          required
                          minLength={10}
                          maxLength={10}
                          placeholder="10-digit number"
                          onChange={(e) => setIntakeField("mobileNumber", e.target.value)}
                        />
                      </div>
                      {newInquiry.mobileNumber.length > 0 && newInquiry.mobileNumber.length !== 10 && (
                        <p className="mt-0.5 text-[11px] text-rose-500">Must be 10 digits</p>
                      )}
                    </div>
                    {/* Gender */}
                    <div>
                      <FieldLabel required>Gender</FieldLabel>
                      <PillSelector
                        options={genderPills}
                        value={newInquiry.gender}
                        onChange={(v) => setIntakeField("gender", v)}
                      />
                    </div>
                    {/* Email */}
                    <div>
                      <FieldLabel>Email</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        type="email"
                        placeholder="email@example.com"
                        value={newInquiry.email}
                        onChange={(e) => setIntakeField("email", e.target.value)}
                      />
                    </div>
                    {/* Date of Birth */}
                    <div>
                      <FieldLabel>Date of Birth</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        type="date"
                        value={newInquiry.dateOfBirth}
                        onChange={(e) => setIntakeField("dateOfBirth", e.target.value)}
                      />
                    </div>
                    {/* Alternate Mobile */}
                    <div>
                      <FieldLabel>Alternate Mobile</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        placeholder="Alternate number"
                        maxLength={10}
                        value={newInquiry.alternateMobileNumber}
                        onChange={(e) => setIntakeField("alternateMobileNumber", e.target.value)}
                      />
                    </div>
                  </div>
                </section>

                {/* Collapsible: Address & Emergency */}
                <section className="rounded-xl border border-slate-200 p-4">
                  <button
                    type="button"
                    onClick={() => setShowAdditionalContact((v) => !v)}
                    className="flex w-full items-center gap-2 text-sm font-semibold text-slate-700"
                  >
                    <span
                      className={`inline-block transition-transform ${showAdditionalContact ? "rotate-90" : ""}`}
                    >
                      &#9654;
                    </span>
                    Address, Emergency Contact &amp; IDs
                    <span className="text-xs font-normal text-slate-400">(optional)</span>
                  </button>

                  {showAdditionalContact && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {/* Address */}
                      <div className="md:col-span-2 xl:col-span-3">
                        <FieldLabel>Address</FieldLabel>
                        <textarea
                          className={INPUT_CLASS}
                          rows={2}
                          placeholder="Full address"
                          value={newInquiry.address}
                          onChange={(e) => setIntakeField("address", e.target.value)}
                        />
                      </div>
                      {/* Emergency Contact */}
                      <div>
                        <FieldLabel>Emergency Contact Name</FieldLabel>
                        <input
                          className={INPUT_CLASS}
                          placeholder="Contact name"
                          value={newInquiry.emergencyContactName}
                          onChange={(e) => setIntakeField("emergencyContactName", e.target.value)}
                        />
                      </div>
                      <div>
                        <FieldLabel>Emergency Phone</FieldLabel>
                        <input
                          className={INPUT_CLASS}
                          placeholder="Phone number"
                          maxLength={10}
                          value={newInquiry.emergencyContactPhone}
                          onChange={(e) => setIntakeField("emergencyContactPhone", e.target.value)}
                        />
                      </div>
                      <div>
                        <FieldLabel>Relation</FieldLabel>
                        <input
                          className={INPUT_CLASS}
                          placeholder="e.g. Spouse, Parent"
                          value={newInquiry.emergencyContactRelation}
                          onChange={(e) => setIntakeField("emergencyContactRelation", e.target.value)}
                        />
                      </div>
                      {/* ID documents */}
                      <div>
                        <FieldLabel>Aadhaar Number</FieldLabel>
                        <input
                          className={INPUT_CLASS}
                          placeholder="12-digit Aadhaar"
                          maxLength={12}
                          value={newInquiry.aadhaarNumber}
                          onChange={(e) =>
                            setNewInquiry((prev) => ({
                              ...prev,
                              aadhaarNumber: e.target.value.replace(/[^0-9]/g, "").slice(0, 12),
                            }))
                          }
                        />
                      </div>
                      <div>
                        <FieldLabel>GST Number</FieldLabel>
                        <input
                          className={INPUT_CLASS}
                          placeholder="GST number"
                          maxLength={15}
                          value={newInquiry.gstNumber}
                          onChange={(e) =>
                            setNewInquiry((prev) => ({ ...prev, gstNumber: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* ━━━ STEP 2: Enquiry Context ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {step === 2 && (
              <div className="space-y-4">
                <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Enquiry Details</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {/* Enquiry Date */}
                    <div>
                      <FieldLabel required>Enquiry Date</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        type="datetime-local"
                        value={newInquiry.inquiryAt}
                        required
                        onChange={(e) => setIntakeField("inquiryAt", e.target.value)}
                      />
                    </div>
                    {/* Client Rep */}
                    <div>
                      <FieldLabel required>Client Rep</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={newInquiry.clientRepStaffId}
                        required
                        onChange={(e) => setIntakeField("clientRepStaffId", e.target.value)}
                      >
                        <option value="">Select staff</option>
                        {staffOptions.map((s) => (
                          <option key={`rep-${s.id}`} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Source of Promotion */}
                    <div>
                      <FieldLabel required>Source of Promotion</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={newInquiry.promotionSource}
                        required
                        onChange={(e) => setIntakeField("promotionSource", e.target.value)}
                      >
                        <option value="">Select source</option>
                        {PROMOTION_SOURCE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Enquiry Status</FieldLabel>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        Derived automatically from the follow-up outcome in step 3.
                      </div>
                    </div>
                    {/* Convertibility (pills) */}
                    <div>
                      <FieldLabel required>Convertibility</FieldLabel>
                      <PillSelector
                        options={convertibilityPills}
                        value={newInquiry.convertibility}
                        onChange={(v) => setIntakeField("convertibility", v)}
                      />
                    </div>
                    {/* Interested In */}
                    <div>
                      <FieldLabel>Interested In</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={newInquiry.interestedIn}
                        onChange={(e) => setIntakeField("interestedIn", e.target.value)}
                      >
                        <option value="">Select plan or package</option>
                        {interestedInOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Employment Status (NEW) */}
                    <div>
                      <FieldLabel>Employment Status</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={newInquiry.employmentStatus}
                        onChange={(e) => setIntakeField("employmentStatus", e.target.value)}
                      >
                        <option value="">Select</option>
                        {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                {/* Referral & Trainer */}
                <section className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Referral</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {/* Referred By Type */}
                    <div>
                      <FieldLabel>Referred By Type</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={newInquiry.referredByType}
                        onChange={(e) => {
                          setIntakeField("referredByType", e.target.value);
                          setIntakeField("referredByName", "");
                        }}
                      >
                        <option value="">Select</option>
                        {REFERRED_BY_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Referred By Name (conditional) */}
                    <div>
                      <FieldLabel>Referred By Name</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={newInquiry.referredByName}
                        onChange={(e) => setIntakeField("referredByName", e.target.value)}
                        disabled={!newInquiry.referredByType || loadingReferredByOptions}
                      >
                        <option value="">
                          {loadingReferredByOptions ? "Loading..." : "Select referred by"}
                        </option>
                        {referredByOptions.map((opt) => (
                          <option key={`${opt.value}-${opt.label}`} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                {/* Notes */}
                <section className="rounded-xl border border-slate-200 p-4">
                  <div>
                    <FieldLabel>Enquiry Notes</FieldLabel>
                    <textarea
                      className={INPUT_CLASS}
                      rows={2}
                      placeholder="Additional notes about the enquiry..."
                      value={newInquiry.notes}
                      onChange={(e) => setIntakeField("notes", e.target.value)}
                    />
                  </div>
                </section>
              </div>
            )}

            {/* ━━━ STEP 3: Follow-up Plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {step === 3 && (
              <div className="space-y-4">
                <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Follow-up Details</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {/* Follow-up response */}
                    <div>
                      <FieldLabel>Follow-up Response</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={followUpPlan.responseType}
                        onChange={(e) =>
                          setFollowUpField("responseType", e.target.value as InquiryResponseType)
                        }
                      >
                        {RESPONSE_TYPE_OPTIONS.map((opt) => (
                          <option key={`rt-${opt.value}`} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Preferred Contact Channel (NEW — pills) */}
                    <div className="xl:col-span-2">
                      <FieldLabel>Preferred Contact</FieldLabel>
                      <PillSelector
                        options={contactChannelPills}
                        value={followUpPlan.contactType}
                        onChange={(v) => setFollowUpField("contactType", v as FollowUpChannel)}
                      />
                    </div>
                    {/* Assign To */}
                    <div>
                      <FieldLabel>Assign To</FieldLabel>
                      <select
                        className={SELECT_CLASS}
                        value={followUpPlan.assignedToStaffId}
                        onChange={(e) => setFollowUpField("assignedToStaffId", e.target.value)}
                      >
                        <option value="">Select staff</option>
                        {staffOptions.map((s) => (
                          <option key={`follow-${s.id}`} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Resulting Enquiry Status</FieldLabel>
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                        {deriveInquiryStatusFromResponseType(followUpPlan.responseType).replace(/_/g, " ")}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Follow-up date with quick picks */}
                <section className="rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Schedule</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="xl:col-span-2">
                      <FieldLabel required={isNextFollowUpRequired}>Next Follow-up Date</FieldLabel>
                      <input
                        className={INPUT_CLASS}
                        type="datetime-local"
                        value={followUpPlan.followUpAt}
                        required={isNextFollowUpRequired}
                        onChange={(e) => setFollowUpField("followUpAt", e.target.value)}
                      />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setFollowUpField("followUpAt", getQuickPickDate("tomorrow"))}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Tomorrow 9 AM
                        </button>
                        <button
                          type="button"
                          onClick={() => setFollowUpField("followUpAt", getQuickPickDate("3days"))}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          +3 Days
                        </button>
                        <button
                          type="button"
                          onClick={() => setFollowUpField("followUpAt", getQuickPickDate("1week"))}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          +1 Week
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Trial section */}
                  <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <input
                        type="checkbox"
                        checked={followUpPlan.trialGiven}
                        onChange={(e) => setFollowUpField("trialGiven", e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                      />
                      Trial Given {isTrialGivenRequired ? "(required)" : ""}
                    </label>

                    {followUpPlan.trialGiven && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <FieldLabel required>Trial Days</FieldLabel>
                          <input
                            className={INPUT_CLASS}
                            type="number"
                            min={0}
                            value={followUpPlan.trialDays}
                            onChange={(e) => setFollowUpField("trialDays", e.target.value)}
                            required={isTrialGivenRequired}
                          />
                        </div>
                        <div>
                          <FieldLabel required>Trial Expiry</FieldLabel>
                          <input
                            className={INPUT_CLASS}
                            type="datetime-local"
                            value={followUpPlan.trialExpiryAt}
                            onChange={(e) => setFollowUpField("trialExpiryAt", e.target.value)}
                            required={isTrialGivenRequired}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* Comments */}
                <section className="rounded-xl border border-slate-200 p-4">
                  <div>
                    <FieldLabel required>Follow-up Comment</FieldLabel>
                    <input
                      className={INPUT_CLASS}
                      value={followUpPlan.followUpComment}
                      required
                      placeholder="Brief summary of the follow-up plan..."
                      onChange={(e) => setFollowUpField("followUpComment", e.target.value)}
                    />
                  </div>
                  {followUpPlan.responseType === "NOT_INTERESTED" ? (
                    <div className="mt-3">
                      <FieldLabel required>Close Reason</FieldLabel>
                      <textarea
                        className={INPUT_CLASS}
                        rows={2}
                        value={newInquiry.closeReason}
                        onChange={(e) => setIntakeField("closeReason", e.target.value)}
                        placeholder="Required when the enquiry is marked as not interested"
                        required
                      />
                    </div>
                  ) : null}
                </section>
              </div>
            )}
          </div>
        </form>

        {/* ─── Footer (sticky) ────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <p className="flex items-center gap-1 text-[11px] text-slate-400">
            <RequiredFieldIcon />
            <span>Mandatory fields</span>
          </p>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                &larr; Back
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                onClick={goNext}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
              >
                Next &rarr;
              </button>
            )}
            {step === 3 && (
              <button
                type="submit"
                form="create-inquiry-form"
                disabled={isSubmitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-red-300"
              >
                {isSubmitting
                  ? "Creating..."
                  : followUpPlan.responseType === "READY_TO_PAY"
                    ? "Create & Convert"
                    : "Create Enquiry"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
