"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, Plus, Save, X } from "lucide-react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { branchService } from "@/lib/api/services/branch-service";
import { BranchResponse } from "@/types/admin";
import { UserDirectoryItem } from "@/types/models";

interface EditBranchFormState {
  name: string;
  address: string;
  city: string;
  managerId: string;
  capacity: string;
  active: boolean;
}

const EMPTY_EDIT_FORM: EditBranchFormState = {
  name: "",
  address: "",
  city: "",
  managerId: "",
  capacity: "0",
  active: true,
};

function capacityUtilization(branch: BranchResponse): string {
  if (!branch.capacity) {
    return "0%";
  }

  return `${Math.round((branch.activeMembers / branch.capacity) * 100)}%`;
}

function toEditState(branch: BranchResponse): EditBranchFormState {
  return {
    name: branch.name,
    address: branch.address,
    city: branch.city,
    managerId: branch.managerId === null ? "" : String(branch.managerId),
    capacity: String(branch.capacity),
    active: branch.active,
  };
}

function parseNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function BranchesPage() {
  const router = useRouter();
  const { token } = useAuth();

  const [branches, setBranches] = useState<BranchResponse[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalElements, setTotalElements] = useState(0);
  const [isFirstPage, setIsFirstPage] = useState(true);
  const [isLastPage, setIsLastPage] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOptions, setManagerOptions] = useState<UserDirectoryItem[]>([]);

  const [editingBranch, setEditingBranch] = useState<BranchResponse | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editForm, setEditForm] = useState<EditBranchFormState>(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 350);

    return () => {
      window.clearTimeout(handle);
    };
  }, [search]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const page = await branchService.listBranches(token, {
          query: debouncedSearch || undefined,
          page: pageIndex,
          size: 20,
        });
        if (!active) {
          return;
        }

        setBranches(page.content);
        setTotalPages(page.totalPages || 1);
        setTotalElements(page.totalElements || 0);
        setIsFirstPage(page.first);
        setIsLastPage(page.last);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load branches.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedSearch, pageIndex, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const page = await branchService.getBranchManagersPaged(token, {
          active: true,
          page: 0,
          size: 100,
        });
        if (!active) {
          return;
        }
        setManagerOptions(page.content);
      } catch {
        if (active) {
          setManagerOptions([]);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  const branchSummary = useMemo(() => {
    const activeBranches = branches.filter((branch) => branch.active).length;
    const inactiveBranches = Math.max(branches.length - activeBranches, 0);
    const totalActiveMembers = branches.reduce((total, branch) => total + branch.activeMembers, 0);
    const totalCapacity = branches.reduce((total, branch) => total + branch.capacity, 0);
    const averageUtilization = totalCapacity > 0 ? Math.round((totalActiveMembers / totalCapacity) * 100) : 0;
    const unassignedManagers = branches.filter((branch) => !branch.managerId).length;

    return {
      activeBranches,
      inactiveBranches,
      totalActiveMembers,
      averageUtilization,
      unassignedManagers,
    };
  }, [branches]);

  const openEdit = (branch: BranchResponse) => {
    setEditorMode("edit");
    setEditingBranch(branch);
    setEditError(null);
    setEditForm(toEditState(branch));
  };

  const openCreate = () => {
    setEditorMode("create");
    setEditingBranch(null);
    setEditError(null);
    setEditForm(EMPTY_EDIT_FORM);
  };

  const closeEdit = () => {
    setEditorMode(null);
    setEditingBranch(null);
    setEditError(null);
    setEditForm(EMPTY_EDIT_FORM);
  };

  const onSaveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !editorMode) {
      return;
    }

    const managerId = parseNumeric(editForm.managerId);
    const capacity = parseNumeric(editForm.capacity);
    if (capacity === null || capacity < 0) {
      setEditError("Capacity must be a non-negative number.");
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      if (editorMode === "create") {
        const created = await branchService.createBranch(token, {
          name: editForm.name.trim(),
          address: editForm.address.trim(),
          city: editForm.city.trim(),
          managerId,
          capacity,
        });
        setBranches((current) => [created, ...current]);
        setTotalElements((current) => current + 1);
      } else if (editingBranch) {
        const updated = await branchService.updateBranch(token, editingBranch.id, {
          name: editForm.name.trim(),
          address: editForm.address.trim(),
          city: editForm.city.trim(),
          managerId,
          capacity,
        });

        const finalBranch =
          editForm.active !== editingBranch.active
            ? await branchService.patchBranchStatus(token, editingBranch.id, editForm.active)
            : updated;

        setBranches((current) => current.map((item) => (item.id === finalBranch.id ? finalBranch : item)));
      }
      closeEdit();
    } catch (saveError) {
      setEditError(saveError instanceof ApiError ? saveError.message : editorMode === "create" ? "Unable to create branch." : "Unable to save branch changes.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <AdminPageFrame
      title="Branches"
      description="Manage branch operations and performance"
      searchPlaceholder="Search branch, city, address..."
      searchValue={search}
      onSearchChange={(value) => {
        setPageIndex(0);
        setSearch(value);
      }}
      action={
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
        >
          <span className="inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Branch
          </span>
        </button>
      }
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-[#121722] p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Branches</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">{totalElements || branches.length}</p>
          <p className="mt-2 text-sm text-slate-300">{branchSummary.activeBranches} active, {branchSummary.inactiveBranches} inactive</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#121722] p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Active Members</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">{branchSummary.totalActiveMembers}</p>
          <p className="mt-2 text-sm text-slate-300">Live member count across listed branches</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#121722] p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Utilization</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">{branchSummary.averageUtilization}%</p>
          <p className="mt-2 text-sm text-slate-300">Average usage against configured capacity</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#121722] p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Manager Gaps</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white">{branchSummary.unassignedManagers}</p>
          <p className="mt-2 text-sm text-slate-300">Branches needing manager assignment</p>
        </div>
      </section>

      <SurfaceCard title="Branch List">
        <div className="mb-4 flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-700">Branch master data and quick settings</p>
            <p className="text-sm text-slate-500">Manage branch master data here. Open a branch to review members, people, revenue, and programs.</p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {totalElements || branches.length} branches
          </div>
        </div>

        {loading ? <div className="text-sm text-slate-500">Loading branches...</div> : null}

        {!loading && branches.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#121722] px-3 py-4 text-sm text-slate-300">No branches found.</div>
        ) : null}

        {!loading && branches.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#121722]">
            <table className="min-w-full divide-y divide-white/10 text-sm">
              <thead className="bg-[#171d29] text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Branch</th>
                  <th className="px-4 py-3 text-left">Branch Code</th>
                  <th className="px-4 py-3 text-left">Manager</th>
                  <th className="px-4 py-3 text-right">Members</th>
                  <th className="px-4 py-3 text-right">Capacity</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-[#121722]">
                {branches.map((branch) => (
                  <tr key={branch.id} className="align-top hover:bg-white/5">
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className="rounded-xl bg-slate-100 p-2 text-[#C42429]">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="font-semibold text-white">{branch.name}</div>
                          <div className="text-sm text-slate-300">{branch.city}</div>
                          <div className="text-xs text-slate-400">{branch.address}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-200">{branch.branchCode || "-"}</div>
                      <div className="text-xs text-slate-400">Unique branch reference</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-200">{branch.managerName || "Unassigned"}</div>
                      <div className="text-xs text-slate-400">{branch.managerName ? "Assigned branch manager" : "Needs mapping"}</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-slate-200">{branch.activeMembers}</div>
                      <div className="text-xs text-slate-400">active members</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-slate-200">{branch.capacity}</div>
                      <div className="text-xs text-slate-400">{capacityUtilization(branch)} utilized</div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          branch.active ? "bg-[#E8F2D7] text-[#5B7F2B]" : "bg-[#FCE7E8] text-[#B42318]"
                        }`}
                      >
                        {branch.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/branches/${branch.id}`)}
                          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(branch)}
                          className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
                        >
                          Edit Settings
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </SurfaceCard>

      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#121722] px-3 py-2 text-xs text-slate-400">
        <span>
          Page {pageIndex + 1} of {Math.max(totalPages, 1)} ({totalElements} total)
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            disabled={isFirstPage}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPageIndex((current) => current + 1)}
            disabled={isLastPage}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {editorMode ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-xl overflow-y-auto bg-[#121722] p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">{editorMode === "create" ? "Add Branch" : "Edit Branch Settings"}</h2>
                <p className="text-sm text-slate-400">
                  {editorMode === "create" ? "Create a new branch and assign its operating basics." : "Update branch master details, manager mapping, capacity, and status."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/5"
                aria-label="Close edit branch"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {editError ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{editError}</div> : null}

            <form className="grid gap-3 md:grid-cols-2" onSubmit={onSaveEdit}>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Branch Name</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.name}
                  onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">City</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.city}
                  onChange={(event) => setEditForm((current) => ({ ...current, city: event.target.value }))}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600">Address</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.address}
                  onChange={(event) => setEditForm((current) => ({ ...current, address: event.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Manager ID</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.managerId}
                  onChange={(event) => setEditForm((current) => ({ ...current, managerId: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {managerOptions.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name} ({manager.id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Capacity</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={editForm.capacity}
                  onChange={(event) => setEditForm((current) => ({ ...current, capacity: event.target.value.replace(/[^0-9]/g, "") }))}
                  required
                />
              </div>
              <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(event) => setEditForm((current) => ({ ...current, active: event.target.checked }))}
                />
                Branch Active
              </label>

              <div className="md:col-span-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  disabled={savingEdit}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingEdit ? (editorMode === "create" ? "Creating..." : "Saving...") : editorMode === "create" ? "Create Branch" : "Save Branch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

    </AdminPageFrame>
  );
}
