"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { hasCapability } from "@/lib/access-policy";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { formatDateTime, toDateTimeLocalInput } from "@/lib/formatters";
import {
  CreateInquiryRequest,
  InquiryRecord,
  InquirySearchQuery,
  InquiryStatus,
  UpdateInquiryRequest,
} from "@/types/inquiry";

const CAPABILITIES = {
  viewInquiries: ["INQUIRY_VIEW", "INQUIRIES_VIEW", "INQUIRY_READ", "INQUIRY_MANAGE"],
  createInquiry: ["INQUIRY_CREATE", "INQUIRIES_CREATE", "INQUIRY_MANAGE", "MEMBER_INTAKE_CREATE"],
  updateInquiry: ["INQUIRY_UPDATE", "INQUIRIES_UPDATE", "INQUIRY_EDIT", "INQUIRY_MANAGE"],
  convertInquiry: ["INQUIRY_CONVERT", "MEMBER_ONBOARDING", "INQUIRY_MANAGE"],
} as const;

interface ToastState {
  kind: "success" | "error";
  message: string;
}

interface InquiryFilterState {
  query: string;
  status: string;
  clientRepStaffId: string;
  converted: "" | "true" | "false";
  from: string;
  to: string;
}

interface InquiryFormValues {
  fullName: string;
  mobileNumber: string;
  alternateMobileNumber: string;
  email: string;
  dateOfBirth: string;
  inquiryAt: string;
  clientRepStaffId: string;
  gender: string;
  aadhaarNumber: string;
  gstNumber: string;
  defaultTrainerStaffId: string;
  referredByType: string;
  referredByName: string;
  promotionSource: string;
  employmentStatus: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  branchCode: string;
  notes: string;
  remarks: string;
}

interface InquiryEditFormValues extends InquiryFormValues {
  status: string;
  converted: "true" | "false";
  memberId: string;
}

interface IntakeOption {
  label: string;
  value: string;
}

interface IntakeFieldConfig {
  key: keyof InquiryFormValues;
  label: string;
  type: "text" | "email" | "tel" | "date" | "datetime-local" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  options?: IntakeOption[];
}

const INTAKE_FIELDS: IntakeFieldConfig[] = [
  { key: "fullName", label: "Full Name", type: "text", required: true, placeholder: "Full name" },
  {
    key: "mobileNumber",
    label: "Mobile Number",
    type: "tel",
    required: true,
    placeholder: "10-digit mobile",
  },
  {
    key: "alternateMobileNumber",
    label: "Alternate Mobile",
    type: "tel",
    placeholder: "Optional",
  },
  { key: "email", label: "Email", type: "email", placeholder: "Optional" },
  { key: "dateOfBirth", label: "Date of Birth", type: "date" },
  { key: "inquiryAt", label: "Inquiry At", type: "datetime-local" },
  {
    key: "clientRepStaffId",
    label: "Client Rep Staff ID",
    type: "text",
    placeholder: "Numeric staff ID",
  },
  {
    key: "gender",
    label: "Gender",
    type: "select",
    options: [
      { label: "Select", value: "" },
      { label: "MALE", value: "MALE" },
      { label: "FEMALE", value: "FEMALE" },
      { label: "OTHER", value: "OTHER" },
    ],
  },
  { key: "aadhaarNumber", label: "Aadhaar Number", type: "text", placeholder: "Optional" },
  { key: "gstNumber", label: "GST Number", type: "text", placeholder: "Optional" },
  {
    key: "defaultTrainerStaffId",
    label: "Default Trainer Staff ID",
    type: "text",
    placeholder: "Numeric trainer ID",
  },
  { key: "referredByType", label: "Referred By Type", type: "text", placeholder: "Optional" },
  { key: "referredByName", label: "Referred By Name", type: "text", placeholder: "Optional" },
  { key: "promotionSource", label: "Promotion Source", type: "text", placeholder: "Optional" },
  { key: "employmentStatus", label: "Employment Status", type: "text", placeholder: "Optional" },
  { key: "address", label: "Address", type: "textarea", placeholder: "Optional" },
  {
    key: "emergencyContactName",
    label: "Emergency Contact Name",
    type: "text",
    placeholder: "Optional",
  },
  {
    key: "emergencyContactPhone",
    label: "Emergency Contact Phone",
    type: "tel",
    placeholder: "Optional",
  },
  {
    key: "emergencyContactRelation",
    label: "Emergency Contact Relation",
    type: "text",
    placeholder: "Optional",
  },
  { key: "branchCode", label: "Branch Code (optional)", type: "text", placeholder: "Optional" },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "Optional" },
  { key: "remarks", label: "Remarks", type: "textarea", placeholder: "Optional" },
];

const NUMERIC_FIELDS = new Set<keyof InquiryFormValues>([
  "mobileNumber",
  "alternateMobileNumber",
  "clientRepStaffId",
  "defaultTrainerStaffId",
  "emergencyContactPhone",
]);

const EMPTY_INTAKE_FORM: InquiryFormValues = {
  fullName: "",
  mobileNumber: "",
  alternateMobileNumber: "",
  email: "",
  dateOfBirth: "",
  inquiryAt: "",
  clientRepStaffId: "",
  gender: "",
  aadhaarNumber: "",
  gstNumber: "",
  defaultTrainerStaffId: "",
  referredByType: "",
  referredByName: "",
  promotionSource: "",
  employmentStatus: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelation: "",
  branchCode: "",
  notes: "",
  remarks: "",
};

function parseNumeric(value: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeFormValue(key: keyof InquiryFormValues, value: string): string {
  if (!NUMERIC_FIELDS.has(key)) {
    return value;
  }

  return value.replace(/[^0-9]/g, "").slice(0, 10);
}

function toIsoDatetime(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function parseConverted(value: "" | "true" | "false"): boolean | undefined {
  if (!value) {
    return undefined;
  }

  return value === "true";
}

function toCreateInquiryPayload(values: InquiryFormValues): CreateInquiryRequest {
  return {
    fullName: values.fullName.trim(),
    mobileNumber: values.mobileNumber.trim(),
    alternateMobileNumber: toOptionalString(values.alternateMobileNumber),
    email: toOptionalString(values.email),
    dateOfBirth: toOptionalString(values.dateOfBirth),
    inquiryAt: toIsoDatetime(values.inquiryAt),
    clientRepStaffId: parseNumeric(values.clientRepStaffId),
    gender: toOptionalString(values.gender),
    aadhaarNumber: toOptionalString(values.aadhaarNumber),
    gstNumber: toOptionalString(values.gstNumber),
    defaultTrainerStaffId: parseNumeric(values.defaultTrainerStaffId),
    referredByType: toOptionalString(values.referredByType),
    referredByName: toOptionalString(values.referredByName),
    promotionSource: toOptionalString(values.promotionSource),
    employmentStatus: toOptionalString(values.employmentStatus),
    address: toOptionalString(values.address),
    emergencyContactName: toOptionalString(values.emergencyContactName),
    emergencyContactPhone: toOptionalString(values.emergencyContactPhone),
    emergencyContactRelation: toOptionalString(values.emergencyContactRelation),
    branchCode: toOptionalString(values.branchCode),
    notes: toOptionalString(values.notes),
    remarks: toOptionalString(values.remarks),
  };
}

function toInquiryEditFormValues(inquiry: InquiryRecord): InquiryEditFormValues {
  return {
    fullName: inquiry.fullName || "",
    mobileNumber: inquiry.mobileNumber || "",
    alternateMobileNumber: inquiry.alternateMobileNumber || "",
    email: inquiry.email || "",
    dateOfBirth: inquiry.dateOfBirth || "",
    inquiryAt: toDateTimeLocalInput(inquiry.inquiryAt),
    clientRepStaffId: inquiry.clientRepStaffId ? String(inquiry.clientRepStaffId) : "",
    gender: inquiry.gender || "",
    aadhaarNumber: inquiry.aadhaarNumber || "",
    gstNumber: inquiry.gstNumber || "",
    defaultTrainerStaffId: inquiry.defaultTrainerStaffId ? String(inquiry.defaultTrainerStaffId) : "",
    referredByType: inquiry.referredByType || "",
    referredByName: inquiry.referredByName || "",
    promotionSource: inquiry.promotionSource || "",
    employmentStatus: inquiry.employmentStatus || "",
    address: inquiry.address || "",
    emergencyContactName: inquiry.emergencyContactName || "",
    emergencyContactPhone: inquiry.emergencyContactPhone || "",
    emergencyContactRelation: inquiry.emergencyContactRelation || "",
    branchCode: inquiry.branchCode || "",
    notes: inquiry.notes || "",
    remarks: inquiry.remarks || "",
    status: inquiry.status,
    converted: inquiry.converted ? "true" : "false",
    memberId: inquiry.memberId ? String(inquiry.memberId) : "",
  };
}

function toUpdateInquiryPayload(values: InquiryEditFormValues): UpdateInquiryRequest {
  return {
    ...toCreateInquiryPayload(values),
    status: toOptionalString(values.status) as InquiryStatus | undefined,
    converted: values.converted === "true",
    memberId: parseNumeric(values.memberId),
  };
}

function getStatusBadge(status: InquiryStatus): string {
  const normalized = status.toUpperCase();

  if (normalized === "CONVERTED") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }

  if (normalized === "LOST") {
    return "bg-rose-100 text-rose-700 border-rose-200";
  }

  if (normalized === "NEGOTIATION" || normalized === "FOLLOW_UP") {
    return "bg-amber-100 text-amber-700 border-amber-200";
  }

  return "bg-blue-100 text-blue-700 border-blue-200";
}

function getHeatTag(status: InquiryStatus): { label: string; className: string } {
  const normalized = status.toUpperCase();

  if (normalized === "CONVERTED") {
    return {
      label: "Won",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }

  if (normalized === "LOST") {
    return {
      label: "Cold",
      className: "bg-slate-100 text-slate-600 border-slate-200",
    };
  }

  if (normalized === "NEGOTIATION" || normalized === "FOLLOW_UP") {
    return {
      label: "Warm",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }

  return {
    label: "Hot",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  };
}

function isTextareaField(field: IntakeFieldConfig): boolean {
  return field.type === "textarea";
}

export default function InquiriesPage() {
  const { token, user, accessMetadata } = useAuth();
  const canViewInquiries = hasCapability(user, accessMetadata, CAPABILITIES.viewInquiries, true);
  const canCreateInquiry = hasCapability(user, accessMetadata, CAPABILITIES.createInquiry, true);
  const canUpdateInquiry = hasCapability(user, accessMetadata, CAPABILITIES.updateInquiry, true);
  const canConvertInquiry = hasCapability(user, accessMetadata, CAPABILITIES.convertInquiry, true);

  const initialStaffId = useMemo(() => {
    const parsed = Number(user?.id);
    return Number.isNaN(parsed) ? null : parsed;
  }, [user]);

  const [inquiries, setInquiries] = useState<InquiryRecord[]>([]);
  const [filters, setFilters] = useState<InquiryFilterState>({
    query: "",
    status: "",
    clientRepStaffId: initialStaffId ? String(initialStaffId) : "",
    converted: "",
    from: "",
    to: "",
  });
  const [newInquiry, setNewInquiry] = useState<InquiryFormValues>(EMPTY_INTAKE_FORM);
  const [editingInquiryId, setEditingInquiryId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<InquiryEditFormValues | null>(null);
  const [customMessages, setCustomMessages] = useState<Record<number, string>>({});
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [loadingInquiries, setLoadingInquiries] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [rowActionLoadingId, setRowActionLoadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const loadInquiries = useCallback(
    async (nextFilters?: InquiryFilterState) => {
      if (!token || !canViewInquiries) {
        setLoadingInquiries(false);
        return;
      }

      const applied = nextFilters || filters;

      setLoadingInquiries(true);
      setError(null);

      try {
        const query: InquirySearchQuery = {
          query: toOptionalString(applied.query),
          status: toOptionalString(applied.status),
          clientRepStaffId: parseNumeric(applied.clientRepStaffId),
          converted: parseConverted(applied.converted),
          from: toIsoDatetime(applied.from),
          to: toIsoDatetime(applied.to),
        };

        const records = await subscriptionService.searchInquiries(token, query);
        setInquiries(records);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Unable to load inquiries";
        setError(message);
        setToast({ kind: "error", message });
      } finally {
        setLoadingInquiries(false);
      }
    },
    [token, canViewInquiries, filters],
  );

  useEffect(() => {
    void loadInquiries();
  }, [loadInquiries]);

  const setIntakeField = (key: keyof InquiryFormValues, value: string) => {
    setNewInquiry((prev) => ({ ...prev, [key]: sanitizeFormValue(key, value) }));
  };

  const setEditField = (key: keyof InquiryFormValues, value: string) => {
    setEditForm((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        [key]: sanitizeFormValue(key, value),
      };
    });
  };

  const onAddInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !canCreateInquiry) {
      setToast({ kind: "error", message: "You do not have capability to create inquiries" });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await subscriptionService.createInquiry(token, toCreateInquiryPayload(newInquiry));
      await loadInquiries();

      setNewInquiry(EMPTY_INTAKE_FORM);
      setIsCreateModalOpen(false);
      setToast({ kind: "success", message: "Inquiry created" });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to add inquiry";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openInquiryEditor = (inquiry: InquiryRecord) => {
    setEditingInquiryId(inquiry.inquiryId);
    setEditForm(toInquiryEditFormValues(inquiry));
  };

  const closeInquiryEditor = () => {
    setEditingInquiryId(null);
    setEditForm(null);
  };

  const onSaveInquiryEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token || !canUpdateInquiry || !editingInquiryId || !editForm) {
      return;
    }

    setIsSavingEdit(true);
    setError(null);

    try {
      const updated = await subscriptionService.updateInquiry(
        token,
        editingInquiryId,
        toUpdateInquiryPayload(editForm),
      );

      setInquiries((prev) => prev.map((item) => (item.inquiryId === editingInquiryId ? updated : item)));
      setToast({ kind: "success", message: "Inquiry updated" });
      closeInquiryEditor();
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "Unable to update inquiry";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const convertInquiry = async (inquiryId: number) => {
    if (!token || !canConvertInquiry) {
      setToast({ kind: "error", message: "You do not have capability to convert inquiries" });
      return;
    }

    setRowActionLoadingId(inquiryId);
    setError(null);

    try {
      const result = await subscriptionService.convertInquiry(token, String(inquiryId), {
        customMessage: customMessages[inquiryId] || undefined,
      });

      const parsedMemberId = result.memberId ? Number(result.memberId) : undefined;

      setInquiries((prev) =>
        prev.map((item) =>
          item.inquiryId === inquiryId
            ? {
                ...item,
                status: "CONVERTED",
                converted: true,
                memberId:
                  parsedMemberId !== undefined && !Number.isNaN(parsedMemberId)
                    ? parsedMemberId
                    : item.memberId,
              }
            : item,
        ),
      );

      setToast({ kind: "success", message: "Inquiry converted" });
    } catch (convertError) {
      const message = convertError instanceof Error ? convertError.message : "Unable to convert inquiry";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setRowActionLoadingId(null);
    }
  };

  const selectedInquiry = useMemo(
    () => inquiries.find((item) => item.inquiryId === editingInquiryId) || null,
    [inquiries, editingInquiryId],
  );

  if (!canViewInquiries) {
    return (
      <SectionCard title="Inquiry Access" subtitle="Capabilities are controlled by designation metadata">
        <p className="text-sm text-slate-500">You do not have capability to view inquiry data.</p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-8">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enquiry Management</h1>
          <p className="text-gray-500">Manage all incoming enquiries in one table view.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
        >
          Add Enquiry
        </button>
      </div>

      <SectionCard
        title="Enquiry Table"
        subtitle="Search, edit and convert enquiries"
        actions={
          <button
            type="button"
            onClick={() => void loadInquiries()}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            Refresh
          </button>
        }
      >
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Search name/mobile"
            value={filters.query}
            onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
          />
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Status"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          />
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            placeholder="Client rep staff ID"
            value={filters.clientRepStaffId}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                clientRepStaffId: event.target.value.replace(/[^0-9]/g, ""),
              }))
            }
          />
          <select
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            value={filters.converted}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, converted: event.target.value as "" | "true" | "false" }))
            }
          >
            <option value="">All</option>
            <option value="true">Converted</option>
            <option value="false">Not Converted</option>
          </select>
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            type="datetime-local"
            value={filters.from}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
          />
          <input
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            type="datetime-local"
            value={filters.to}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void loadInquiries()}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              const resetFilters: InquiryFilterState = {
                query: "",
                status: "",
                clientRepStaffId: initialStaffId ? String(initialStaffId) : "",
                converted: "",
                from: "",
                to: "",
              };
              setFilters(resetFilters);
              void loadInquiries(resetFilters);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Reset
          </button>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold tracking-wide text-gray-500 uppercase">
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Inquiry At</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingInquiries ? (
                <tr>
                  <td className="px-4 py-4 text-gray-500" colSpan={6}>
                    Loading enquiries...
                  </td>
                </tr>
              ) : inquiries.length === 0 ? (
                <tr>
                  <td className="px-4 py-4 text-gray-500" colSpan={6}>
                    No enquiries found
                  </td>
                </tr>
              ) : (
                inquiries.map((inquiry) => {
                  const heat = getHeatTag(inquiry.status);
                  const isConverting = rowActionLoadingId === inquiry.inquiryId;

                  return (
                    <tr key={inquiry.inquiryId} className="align-top hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{inquiry.fullName || "-"}</p>
                        <p className="text-xs text-gray-500">#{inquiry.inquiryId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{inquiry.mobileNumber || "-"}</p>
                        <p className="text-xs text-gray-500">{inquiry.email || "No email"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{inquiry.promotionSource || "Walk-in"}</p>
                        <p className="text-xs text-gray-500">Rep: {inquiry.clientRepStaffId || "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-semibold ${getStatusBadge(inquiry.status)}`}
                          >
                            {inquiry.status}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-1 text-xs font-semibold ${heat.className}`}
                          >
                            {heat.label}
                          </span>
                          {inquiry.converted ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                              Converted
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatDateTime(inquiry.inquiryAt)}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={!canUpdateInquiry}
                              onClick={() => openInquiryEditor(inquiry)}
                              className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={!canConvertInquiry || inquiry.converted || isConverting}
                              onClick={() => void convertInquiry(inquiry.inquiryId)}
                              className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:bg-emerald-300"
                            >
                              {isConverting ? "Converting..." : "Convert"}
                            </button>
                          </div>
                          <input
                            className="w-52 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                            placeholder="Custom conversion message"
                            value={customMessages[inquiry.inquiryId] || ""}
                            onChange={(event) =>
                              setCustomMessages((prev) => ({
                                ...prev,
                                [inquiry.inquiryId]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {isCreateModalOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-4xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add Enquiry</h2>
                <p className="text-sm text-slate-500">Capture complete intake details.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            {!canCreateInquiry ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Your designation does not have create capability for this module.
              </p>
            ) : (
              <form className="space-y-3" onSubmit={onAddInquiry}>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {INTAKE_FIELDS.map((field) => {
                    const value = newInquiry[field.key];

                    return (
                      <div
                        key={`create-${field.key}`}
                        className={isTextareaField(field) ? "md:col-span-2 xl:col-span-3" : ""}
                      >
                        <label className="mb-1 block text-xs font-semibold text-slate-600">{field.label}</label>
                        {field.type === "textarea" ? (
                          <textarea
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={field.placeholder}
                            rows={2}
                            value={value}
                            onChange={(event) => setIntakeField(field.key, event.target.value)}
                          />
                        ) : field.type === "select" ? (
                          <select
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={value}
                            onChange={(event) => setIntakeField(field.key, event.target.value)}
                          >
                            {(field.options || []).map((option) => (
                              <option key={`${field.key}-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            type={field.type}
                            placeholder={field.placeholder}
                            value={value}
                            required={field.required}
                            onChange={(event) => setIntakeField(field.key, event.target.value)}
                            minLength={field.key === "mobileNumber" ? 10 : undefined}
                            maxLength={
                              field.key === "mobileNumber" || field.key === "alternateMobileNumber" ? 10 : undefined
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-red-300"
                >
                  {isSubmitting ? "Creating..." : "Create Inquiry"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {selectedInquiry && editForm ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-3xl overflow-y-auto bg-white p-4 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Edit Inquiry #{selectedInquiry.inquiryId}</h2>
                <p className="text-sm text-slate-500">Update intake fields and status via PATCH API.</p>
              </div>
              <button
                type="button"
                onClick={closeInquiryEditor}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form className="space-y-3" onSubmit={onSaveInquiryEdit}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {INTAKE_FIELDS.map((field) => (
                  <div
                    key={`edit-${field.key}`}
                    className={isTextareaField(field) ? "md:col-span-2 xl:col-span-3" : ""}
                  >
                    <label className="mb-1 block text-xs font-semibold text-slate-600">{field.label}</label>
                    {field.type === "textarea" ? (
                      <textarea
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        rows={2}
                        value={editForm[field.key]}
                        onChange={(event) => setEditField(field.key, event.target.value)}
                      />
                    ) : field.type === "select" ? (
                      <select
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={editForm[field.key]}
                        onChange={(event) => setEditField(field.key, event.target.value)}
                      >
                        {(field.options || []).map((option) => (
                          <option key={`edit-${field.key}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        type={field.type}
                        value={editForm[field.key]}
                        onChange={(event) => setEditField(field.key, event.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Status</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={editForm.status}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, status: event.target.value } : prev))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Converted</label>
                  <select
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={editForm.converted}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, converted: event.target.value as "true" | "false" } : prev,
                      )
                    }
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Member ID (optional)</label>
                  <input
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={editForm.memberId}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, memberId: event.target.value.replace(/[^0-9]/g, "") } : prev,
                      )
                    }
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSavingEdit}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
              >
                {isSavingEdit ? "Saving..." : "Save Inquiry"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
