"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { Modal } from "@/components/common/modal";
import { FormField } from "@/components/common/form-field";
import { ToastBanner } from "@/components/common/toast-banner";
import { Badge } from "@/components/common/badge";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import { trainingService } from "@/lib/api/services/training-service";
import { TrainingProgramSummary } from "@/types/admin";

const STATUS_OPTIONS = ["ALL", "DRAFT", "ACTIVE", "PAUSED", "COMPLETED"];
const EDITABLE_STATUS_OPTIONS = STATUS_OPTIONS.filter((s) => s !== "ALL");
const ACTIVE_PROGRAM_NAMES = new Set([
  "Yoga",
  "Zumba",
  "HIIT",
  "Coreflex",
  "CrossFit",
  "Kickboxing",
  "Calisthenics Kids",
  "Calisthenics Self",
  "Calisthenics Adult",
]);

interface BranchOption {
  label: string;
  value: string; // numeric id as string
}

interface ProgramFormData {
  name: string;
  description: string;
  durationWeeks: string;
  trainerId: string;
  maxCapacity: string;
  branchId: string;
  status: string;
}

const EMPTY_FORM: ProgramFormData = {
  name: "",
  description: "",
  durationWeeks: "4",
  trainerId: "",
  maxCapacity: "20",
  branchId: "",
  status: "DRAFT",
};

function statusVariant(status?: string): "success" | "warning" | "error" | "neutral" {
  switch (status?.toUpperCase()) {
    case "ACTIVE":
      return "success";
    case "DRAFT":
      return "neutral";
    case "PAUSED":
      return "warning";
    case "COMPLETED":
      return "error";
    default:
      return "neutral";
  }
}

export default function ProgramsPage() {
  const { token } = useAuth();
  const { effectiveBranchId } = useBranch();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [branchFilter, setBranchFilter] = useState<string>(
    effectiveBranchId ? String(effectiveBranchId) : "ALL"
  );
  const [programs, setPrograms] = useState<TrainingProgramSummary[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([{ label: "All Branches", value: "ALL" }]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProgramFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Sync branch filter with header selector
  useEffect(() => {
    if (effectiveBranchId) {
      setBranchFilter(String(effectiveBranchId));
    } else {
      setBranchFilter("ALL");
    }
  }, [effectiveBranchId]);

  // Load branch options
  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const page = await branchService.listBranches(token, { page: 0, size: 100 });
        if (!active) return;
        const next = page.content.map((item) => ({
          label: item.name,
          value: String(item.id),
        }));
        setBranches([{ label: "All Branches", value: "ALL" }, ...next]);
      } catch {
        if (active) setBranches([{ label: "All Branches", value: "ALL" }]);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const loadPrograms = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const branchId = branchFilter !== "ALL" ? Number(branchFilter) : undefined;
      const page = await trainingService.listPrograms(token, 0, 100, branchId);
      setPrograms(page.content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load programs.");
    } finally {
      setLoading(false);
    }
  }, [branchFilter, token]);

  useEffect(() => {
    void loadPrograms();
  }, [loadPrograms]);

  const filtered = useMemo(() => {
    let list = programs.filter((program) => ACTIVE_PROGRAM_NAMES.has(program.name));
    if (statusFilter !== "ALL") {
      list = list.filter((p) => p.status?.toUpperCase() === statusFilter);
    }
    const normalized = search.trim().toLowerCase();
    if (normalized) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(normalized) ||
          (p.trainerName || "").toLowerCase().includes(normalized) ||
          (p.description || "").toLowerCase().includes(normalized)
      );
    }
    return list;
  }, [programs, search, statusFilter]);

  const branchName = (bId?: number) => {
    if (!bId) return "-";
    const match = branches.find((b) => b.value === String(bId));
    return match ? match.label : String(bId);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      branchId: branchFilter !== "ALL" ? branchFilter : "",
    });
    setShowModal(true);
  };

  const openEdit = (program: TrainingProgramSummary) => {
    setEditingId(program.id);
    setForm({
      name: program.name,
      description: program.description || "",
      durationWeeks: String(program.durationWeeks || ""),
      trainerId: program.trainerId ? String(program.trainerId) : "",
      maxCapacity: String(program.maxCapacity ?? 20),
      branchId: program.branchId ? String(program.branchId) : "",
      status: program.status || "DRAFT",
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!token || !form.name || !form.branchId || !form.durationWeeks) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        durationWeeks: Number(form.durationWeeks),
        trainerId: form.trainerId ? Number(form.trainerId) : null,
        maxCapacity: Number(form.maxCapacity) || 20,
        branchId: Number(form.branchId),
        status: form.status,
      };

      if (editingId) {
        await trainingService.updateProgram(token, editingId, payload);
        setToast({ kind: "success", message: "Program updated" });
      } else {
        await trainingService.createProgram(token, payload);
        setToast({ kind: "success", message: "Program created" });
      }
      setShowModal(false);
      void loadPrograms();
    } catch {
      setToast({ kind: "error", message: `Failed to ${editingId ? "update" : "create"} program` });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (programId: string, newStatus: string) => {
    if (!token) return;
    try {
      await trainingService.patchProgramStatus(token, programId, { status: newStatus });
      setToast({ kind: "success", message: `Program status updated to ${newStatus}` });
      void loadPrograms();
    } catch {
      setToast({ kind: "error", message: "Failed to update program status" });
    }
  };

  const updateField = (key: keyof ProgramFormData, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <AdminPageFrame
      title="Programs"
      description="Manage training programs across branches"
      searchPlaceholder="Search program name, trainer, description..."
      searchValue={search}
      onSearchChange={setSearch}
      filters={[
        { id: "branch", label: "Branch", options: branches },
        { id: "status", label: "Status", options: STATUS_OPTIONS.map((v) => ({ label: v, value: v })) },
      ]}
      filterValues={{ branch: branchFilter, status: statusFilter }}
      onFilterChange={(id, value) => {
        if (id === "branch") setBranchFilter(value);
        if (id === "status") setStatusFilter(value);
      }}
      action={
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
        >
          Create Program
        </button>
      }
    >
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((program) => (
          <SurfaceCard key={program.id} title="">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-lg font-semibold text-slate-800">{program.name}</p>
                  <p className="text-xs text-slate-400">{branchName(program.branchId)}</p>
                </div>
                <Badge variant={statusVariant(program.status)}>
                  {program.status || "DRAFT"}
                </Badge>
              </div>

              {program.description && (
                <p className="text-sm text-slate-500 line-clamp-2">{program.description}</p>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                <div>
                  <span className="text-xs text-slate-400">Duration</span>
                  <p className="font-medium">{program.durationWeeks ? `${program.durationWeeks} weeks` : program.duration || "-"}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Trainer</span>
                  <p className="font-medium">{program.trainerName || program.trainerId || "-"}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Enrolled</span>
                  <p className="font-medium">{program.membersEnrolled ?? "-"}</p>
                </div>
                <div>
                  <span className="text-xs text-slate-400">Capacity</span>
                  <p className="font-medium">{program.maxCapacity ?? "-"}</p>
                </div>
              </div>

              {program.maxCapacity && program.maxCapacity > 0 && (
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span>Enrollment</span>
                    <span>{Math.round(((program.membersEnrolled || 0) / program.maxCapacity) * 100)}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-[#C42429]"
                      style={{ width: `${Math.min(100, ((program.membersEnrolled || 0) / program.maxCapacity) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openEdit(program)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
                {program.status?.toUpperCase() === "DRAFT" && (
                  <button
                    type="button"
                    onClick={() => void handleStatusChange(program.id, "ACTIVE")}
                    className="text-sm font-medium text-emerald-600 hover:text-emerald-800"
                  >
                    Activate
                  </button>
                )}
                {program.status?.toUpperCase() === "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() => void handleStatusChange(program.id, "PAUSED")}
                    className="text-sm font-medium text-amber-600 hover:text-amber-800"
                  >
                    Pause
                  </button>
                )}
                {program.status?.toUpperCase() === "PAUSED" && (
                  <button
                    type="button"
                    onClick={() => void handleStatusChange(program.id, "ACTIVE")}
                    className="text-sm font-medium text-emerald-600 hover:text-emerald-800"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          </SurfaceCard>
        ))}
      </section>

      {loading && <div className="text-sm text-slate-500">Loading programs...</div>}
      {!loading && filtered.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-sm text-slate-600">
          No programs found.
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? "Edit Program" : "Create Program"}
        size="md"
      >
        <div className="space-y-4">
          <FormField label="Program Name" required>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="e.g., 12-Week Strength Training"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>

          <FormField label="Description">
            <textarea
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Program details..."
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Duration (weeks)" required>
              <input
                type="number"
                value={form.durationWeeks}
                onChange={(e) => updateField("durationWeeks", e.target.value)}
                min={1}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
            <FormField label="Max Capacity" required>
              <input
                type="number"
                value={form.maxCapacity}
                onChange={(e) => updateField("maxCapacity", e.target.value)}
                min={1}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Branch" required>
              <select
                value={form.branchId}
                onChange={(e) => updateField("branchId", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select branch</option>
                {branches.filter((b) => b.value !== "ALL").map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Status">
              <select
                value={form.status}
                onChange={(e) => updateField("status", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {EDITABLE_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Trainer ID">
            <input
              type="number"
              value={form.trainerId}
              onChange={(e) => updateField("trainerId", e.target.value)}
              placeholder="Trainer ID (optional)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowModal(false)}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !form.name || !form.branchId || !form.durationWeeks}
            className="rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
          >
            {submitting ? "Saving..." : editingId ? "Update" : "Create"}
          </button>
        </div>
      </Modal>
    </AdminPageFrame>
  );
}
