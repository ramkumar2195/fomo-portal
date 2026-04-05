"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { Modal } from "@/components/common/modal";
import { FormField } from "@/components/common/form-field";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import { trainingService } from "@/lib/api/services/training-service";
import { ClassScheduleItem } from "@/types/models";

const CLASS_TYPES = ["ALL", "GROUP", "PROGRAM", "PT", "EVENT"];
const EDITABLE_CLASS_TYPES = CLASS_TYPES.filter((t) => t !== "ALL");
const ACTIVE_CLASS_NAMES = new Set([
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

interface BranchFilterOption {
  label: string;
  value: string;
}

interface ScheduleFormData {
  className: string;
  classType: string;
  branchCode: string;
  trainerId: string;
  trainerName: string;
  startAt: string;
  endAt: string;
  capacity: string;
  notes: string;
}

const EMPTY_FORM: ScheduleFormData = {
  className: "",
  classType: "GROUP",
  branchCode: "",
  trainerId: "",
  trainerName: "",
  startAt: "",
  endAt: "",
  capacity: "20",
  notes: "",
};

export default function ClassesPage() {
  const { token } = useAuth();
  const { selectedBranchCode } = useBranch();
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState(selectedBranchCode || "ALL");
  const [classType, setClassType] = useState("ALL");
  const [schedules, setSchedules] = useState<ClassScheduleItem[]>([]);
  const [branches, setBranches] = useState<BranchFilterOption[]>([{ label: "All Branches", value: "ALL" }]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormData>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (selectedBranchCode && branchFilter === "ALL") {
      setBranchFilter(selectedBranchCode);
    }
  }, [branchFilter, selectedBranchCode]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const page = await branchService.listBranches(token, { page: 0, size: 100 });
        if (!active) return;
        const next = page.content.map((item) => ({
          label: item.name,
          value: item.branchCode || String(item.id),
        }));
        setBranches([{ label: "All Branches", value: "ALL" }, ...next]);
      } catch {
        if (active) setBranches([{ label: "All Branches", value: "ALL" }]);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const loadSchedules = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await trainingService.listClassSchedules(token, {
        branchCode: branchFilter === "ALL" ? undefined : branchFilter,
        classType: classType === "ALL" ? undefined : classType,
      });
      setSchedules(response);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load class schedules.");
    } finally {
      setLoading(false);
    }
  }, [branchFilter, classType, token]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const filteredSchedules = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const supportedSchedules = schedules.filter((schedule) => ACTIVE_CLASS_NAMES.has(schedule.className));
    if (!normalized) return supportedSchedules;
    return supportedSchedules.filter(
      (s) =>
        s.className.toLowerCase().includes(normalized) ||
        s.trainerName.toLowerCase().includes(normalized)
    );
  }, [schedules, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      branchCode: branchFilter !== "ALL" ? branchFilter : (selectedBranchCode || ""),
    });
    setShowModal(true);
  };

  const openEdit = (item: ClassScheduleItem) => {
    setEditingId(item.id);
    setForm({
      className: item.className,
      classType: item.classType || "GROUP",
      branchCode: item.branchCode || "",
      trainerId: item.trainerId ? String(item.trainerId) : "",
      trainerName: item.trainerName || "",
      startAt: item.startTime || "",
      endAt: item.endTime || "",
      capacity: String(item.capacity || 20),
      notes: item.notes || "",
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!token || !form.className || !form.branchCode || !form.startAt || !form.endAt) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        className: form.className,
        classType: form.classType,
        branchCode: form.branchCode,
        trainerId: form.trainerId ? Number(form.trainerId) : null,
        trainerName: form.trainerName || null,
        startAt: form.startAt,
        endAt: form.endAt,
        capacity: Number(form.capacity) || 20,
        bookedCount: 0,
        notes: form.notes || null,
      };

      if (editingId) {
        await trainingService.updateClassSchedule(token, editingId, payload);
        setToast({ kind: "success", message: "Class schedule updated" });
      } else {
        await trainingService.createClassSchedule(token, payload);
        setToast({ kind: "success", message: "Class schedule created" });
      }
      setShowModal(false);
      void loadSchedules();
    } catch {
      setToast({ kind: "error", message: `Failed to ${editingId ? "update" : "create"} class schedule` });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    try {
      await trainingService.deleteClassSchedule(token, id);
      setToast({ kind: "success", message: "Class schedule deactivated" });
      void loadSchedules();
    } catch {
      setToast({ kind: "error", message: "Failed to deactivate class schedule" });
    }
  };

  const updateField = (key: keyof ScheduleFormData, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <AdminPageFrame
      title="Classes / Sessions"
      description="Manage class schedules across branches"
      searchPlaceholder="Search class name or trainer..."
      searchValue={search}
      onSearchChange={setSearch}
      filters={[
        { id: "branch", label: "Branch", options: branches },
        { id: "classType", label: "Class Type", options: CLASS_TYPES.map((v) => ({ label: v, value: v })) },
      ]}
      filterValues={{ branch: branchFilter, classType }}
      onFilterChange={(id, value) => {
        if (id === "branch") setBranchFilter(value);
        if (id === "classType") setClassType(value);
      }}
      action={
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
        >
          Add Session
        </button>
      }
    >
      {toast && <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <SurfaceCard title="Class Schedule List">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Trainer</th>
                <th className="px-3 py-2">Start</th>
                <th className="px-3 py-2">End</th>
                <th className="px-3 py-2">Occupancy</th>
                <th className="px-3 py-2">Capacity</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSchedules.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-semibold text-slate-800">{item.className}</td>
                  <td className="px-3 py-2 text-slate-600">{item.classType || "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{item.trainerName || "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{item.startTime || "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{item.endTime || "-"}</td>
                  <td className="px-3 py-2 text-slate-700">{item.occupancy}</td>
                  <td className="px-3 py-2 text-slate-700">{item.capacity}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item.id)}
                        className="text-sm font-medium text-rose-600 hover:text-rose-800"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && <div className="mt-3 text-sm text-slate-500">Loading schedules...</div>}
        {!loading && filteredSchedules.length === 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            No schedules found.
          </div>
        )}
      </SurfaceCard>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? "Edit Class Schedule" : "Add Class Schedule"}
        size="md"
      >
        <div className="space-y-4">
          <FormField label="Class Name" required>
            <input
              type="text"
              value={form.className}
              onChange={(e) => updateField("className", e.target.value)}
              placeholder="e.g., Morning Yoga"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Class Type" required>
              <select
                value={form.classType}
                onChange={(e) => updateField("classType", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {EDITABLE_CLASS_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Branch" required>
              <select
                value={form.branchCode}
                onChange={(e) => updateField("branchCode", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select branch</option>
                {branches.filter((b) => b.value !== "ALL").map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Trainer ID">
              <input
                type="number"
                value={form.trainerId}
                onChange={(e) => updateField("trainerId", e.target.value)}
                placeholder="Trainer ID"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
            <FormField label="Trainer Name">
              <input
                type="text"
                value={form.trainerName}
                onChange={(e) => updateField("trainerName", e.target.value)}
                placeholder="Trainer name"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Start Time" required>
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => updateField("startAt", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
            <FormField label="End Time" required>
              <input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => updateField("endAt", e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          </div>
          <FormField label="Capacity">
            <input
              type="number"
              value={form.capacity}
              onChange={(e) => updateField("capacity", e.target.value)}
              placeholder="Max participants"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Optional notes"
              rows={2}
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
            disabled={submitting || !form.className || !form.branchCode || !form.startAt || !form.endAt}
            className="rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:opacity-50"
          >
            {submitting ? "Saving..." : editingId ? "Update" : "Create"}
          </button>
        </div>
      </Modal>
    </AdminPageFrame>
  );
}
