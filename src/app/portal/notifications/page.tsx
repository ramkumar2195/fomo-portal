"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasDesignation, isAdminOrStaff } from "@/lib/access-policy";
import { notificationService } from "@/lib/api/services/notification-service";
import { formatDateTime } from "@/lib/formatters";
import { resolveStaffId } from "@/lib/staff-id";
import {
  CampaignStats,
  CreateCampaignRequest,
  InAppNotificationType,
  NotificationCampaign,
  NotificationChannel,
  SendInAppRequest,
} from "@/types/notification";

interface ToastState {
  kind: "success" | "error";
  message: string;
}

interface CampaignFilters {
  status: string;
  channel: "" | NotificationChannel;
}

function parseIds(value: string): number[] {
  return value
    .split(",")
    .map((id) => Number(id.trim()))
    .filter((id) => !Number.isNaN(id) && Number.isFinite(id));
}

export default function NotificationsPage() {
  const { token, user } = useAuth();
  const { effectiveBranchId } = useBranch();

  const isCampaignManager = isAdminOrStaff(user);
  const isSuperAdmin = hasDesignation(user, "SUPER_ADMIN");
  const staffId = resolveStaffId(user);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [sendingCampaignId, setSendingCampaignId] = useState<number | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [sendingInApp, setSendingInApp] = useState(false);

  const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [selectedCampaignStats, setSelectedCampaignStats] = useState<CampaignStats | null>(null);

  const [filters, setFilters] = useState<CampaignFilters>({ status: "", channel: "" });

  const [createForm, setCreateForm] = useState({
    name: "",
    title: "",
    message: "",
    channel: "IN_APP" as NotificationChannel,
    audienceType: "SPECIFIC_MEMBERS",
    targetMemberIds: "",
    scheduledAt: "",
    metadataJson: '{"source":"staff-portal"}',
  });

  const [inAppForm, setInAppForm] = useState({
    memberIds: "",
    title: "",
    message: "",
    type: "INFO" as InAppNotificationType,
    deepLink: "/member/classes",
    metadataJson: '{"priority":"normal"}',
    expiresAt: "",
  });

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.campaignId === selectedCampaignId) || null,
    [campaigns, selectedCampaignId],
  );

  const loadCampaigns = useCallback(async () => {
    if (!token || !isCampaignManager) {
      setLoadingCampaigns(false);
      return;
    }

    setLoadingCampaigns(true);
    setError(null);

    try {
      const list = await notificationService.listCampaigns(token, {
        status: filters.status || undefined,
        channel: filters.channel || undefined,
      });
      setCampaigns(list);
      setSelectedCampaignId((current) => current || list[0]?.campaignId || null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load campaigns";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoadingCampaigns(false);
    }
  }, [token, isCampaignManager, filters]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const loadCampaignStats = useCallback(async () => {
    if (!token || !selectedCampaignId || !isCampaignManager) {
      setSelectedCampaignStats(null);
      return;
    }

    setLoadingStats(true);
    setError(null);

    try {
      const stats = await notificationService.getCampaignStats(token, selectedCampaignId);
      setSelectedCampaignStats(stats);
    } catch (statsError) {
      const message = statsError instanceof Error ? statsError.message : "Unable to load campaign stats";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setLoadingStats(false);
    }
  }, [token, selectedCampaignId, isCampaignManager]);

  useEffect(() => {
    void loadCampaignStats();
  }, [loadCampaignStats]);

  const onCreateCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !isCampaignManager || staffId === null) {
      setToast({ kind: "error", message: "Campaign creation requires ADMIN/STAFF with numeric staff ID" });
      return;
    }

    const targetMemberIds = parseIds(createForm.targetMemberIds);
    if (targetMemberIds.length === 0) {
      setToast({ kind: "error", message: "At least one target member ID is required" });
      return;
    }

    setSavingCampaign(true);
    setError(null);

    try {
      const payload: CreateCampaignRequest = {
        name: createForm.name,
        title: createForm.title,
        message: createForm.message,
        channel: createForm.channel,
        audienceType: createForm.audienceType,
        targetMemberIds,
        branchId: effectiveBranchId ? Number(effectiveBranchId) : null,
        createdBy: staffId,
        scheduledAt: createForm.scheduledAt ? new Date(createForm.scheduledAt).toISOString() : null,
        metadataJson: createForm.metadataJson,
      };

      const created = await notificationService.createCampaign(token, payload);
      setCampaigns((prev) => [created, ...prev]);
      setSelectedCampaignId(created.campaignId);
      setCreateForm((prev) => ({
        ...prev,
        name: "",
        title: "",
        message: "",
        targetMemberIds: "",
      }));
      setToast({ kind: "success", message: "Campaign created" });
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "Unable to create campaign";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setSavingCampaign(false);
    }
  };

  const onSendCampaign = async (campaignId: number) => {
    if (!token || !isCampaignManager) {
      return;
    }

    setSendingCampaignId(campaignId);
    setError(null);

    try {
      const sent = await notificationService.sendCampaign(token, campaignId);
      setCampaigns((prev) => prev.map((item) => (item.campaignId === campaignId ? sent : item)));
      setToast({ kind: "success", message: `Campaign #${campaignId} sent` });
      await loadCampaignStats();
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Unable to send campaign";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setSendingCampaignId(null);
    }
  };

  const onSendInApp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !isCampaignManager) {
      setToast({ kind: "error", message: "In-app broadcast requires ADMIN/STAFF" });
      return;
    }

    const memberIds = parseIds(inAppForm.memberIds);
    if (memberIds.length === 0) {
      setToast({ kind: "error", message: "At least one member ID is required" });
      return;
    }

    setSendingInApp(true);
    setError(null);

    try {
      const payload: SendInAppRequest = {
        memberIds,
        title: inAppForm.title,
        message: inAppForm.message,
        type: inAppForm.type,
        campaignId: selectedCampaignId,
        branchId: effectiveBranchId ? Number(effectiveBranchId) : null,
        deepLink: inAppForm.deepLink,
        metadataJson: inAppForm.metadataJson,
        expiresAt: inAppForm.expiresAt ? new Date(inAppForm.expiresAt).toISOString() : null,
      };

      const sent = await notificationService.sendInApp(token, payload);
      setToast({ kind: "success", message: `In-app sent to ${sent.length || memberIds.length} member(s)` });
      setInAppForm((prev) => ({ ...prev, memberIds: "", title: "", message: "" }));
    } catch (inAppError) {
      const message = inAppError instanceof Error ? inAppError.message : "Unable to send in-app notification";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setSendingInApp(false);
    }
  };

  if (!isCampaignManager) {
    return (
      <SectionCard title="Notifications" subtitle="Campaign management is restricted to ADMIN/STAFF">
        <p className="text-sm text-slate-500">You do not have permission to manage campaigns.</p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <SectionCard title="Campaign Filters" actions={<button type="button" onClick={() => void loadCampaigns()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Refresh</button>}>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Status"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
          />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={filters.channel}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, channel: event.target.value as "" | NotificationChannel }))
            }
          >
            <option value="">All channels</option>
            <option value="IN_APP">In-App Notification</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">EMAIL</option>
            <option value="WHATSAPP">WHATSAPP</option>
          </select>
          <button
            type="button"
            onClick={() => void loadCampaigns()}
            className="rounded-lg bg-[#c42924] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b]"
          >
            Apply Filters
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Create Campaign">
        <form className="grid gap-3" onSubmit={onCreateCampaign}>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Campaign name"
              value={createForm.name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={createForm.channel}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, channel: event.target.value as NotificationChannel }))
              }
            >
              <option value="IN_APP">In-App Notification</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">EMAIL</option>
              <option value="WHATSAPP">WHATSAPP</option>
            </select>
          </div>

          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Title"
            value={createForm.title}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, title: event.target.value }))}
            required
          />

          <textarea
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Message"
            value={createForm.message}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, message: event.target.value }))}
            rows={3}
            required
          />

          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Target member IDs (comma separated)"
            value={createForm.targetMemberIds}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, targetMemberIds: event.target.value }))}
            required
          />

          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="datetime-local"
              value={createForm.scheduledAt}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, scheduledAt: event.target.value }))}
            />
            {/* Metadata field hidden from staff UI — auto-populated */}
            <input type="hidden" value={createForm.metadataJson} />
          </div>

          <button
            type="submit"
            disabled={savingCampaign}
            className="rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a81f1c] disabled:opacity-50"
          >
            {savingCampaign ? "Creating..." : "Create Campaign"}
          </button>
        </form>
      </SectionCard>

      <SectionCard
        title="Campaigns"
        subtitle={
          loadingCampaigns
            ? "Loading campaigns..."
            : `${campaigns.length} campaign(s)${isSuperAdmin ? " (SUPER_ADMIN)" : ""}`
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-2 py-2 font-semibold">ID</th>
                <th className="px-2 py-2 font-semibold">Name</th>
                <th className="px-2 py-2 font-semibold">Channel</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-slate-500" colSpan={5}>
                    No campaigns found
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr
                    key={campaign.campaignId}
                    className={`border-b border-slate-100 ${
                      selectedCampaignId === campaign.campaignId ? "bg-slate-50" : ""
                    }`}
                  >
                    <td className="px-2 py-3 font-medium text-slate-900">#{campaign.campaignId}</td>
                    <td className="px-2 py-3">{campaign.name}</td>
                    <td className="px-2 py-3">{campaign.channel === "IN_APP" ? "In-App" : campaign.channel}</td>
                    <td className="px-2 py-3">{campaign.status || "-"}</td>
                    <td className="px-2 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedCampaignId(campaign.campaignId)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          disabled={sendingCampaignId === campaign.campaignId}
                          onClick={() => void onSendCampaign(campaign.campaignId)}
                          className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:bg-emerald-300"
                        >
                          Send
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Campaign Stats Panel">
        {!selectedCampaign ? (
          <p className="text-sm text-slate-500">Select a campaign to view details and stats.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p>
                <span className="font-semibold">Campaign:</span> #{selectedCampaign.campaignId} {selectedCampaign.name}
              </p>
              <p>
                <span className="font-semibold">Title:</span> {selectedCampaign.title}
              </p>
              <p>
                <span className="font-semibold">Channel:</span> {selectedCampaign.channel === "IN_APP" ? "In-App Notification" : selectedCampaign.channel}
              </p>
              <p>
                <span className="font-semibold">Scheduled:</span> {formatDateTime(selectedCampaign.scheduledAt || undefined)}
              </p>
            </div>

            {loadingStats ? (
              <p className="text-sm text-slate-500">Loading stats...</p>
            ) : !selectedCampaignStats ? (
              <p className="text-sm text-slate-500">No stats available yet.</p>
            ) : (
              <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(selectedCampaignStats, null, 2)}
              </pre>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Quick In-App Broadcast">
        <form className="grid gap-3" onSubmit={onSendInApp}>
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Member IDs (comma separated)"
            value={inAppForm.memberIds}
            onChange={(event) => setInAppForm((prev) => ({ ...prev, memberIds: event.target.value }))}
            required
          />

          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Title"
              value={inAppForm.title}
              onChange={(event) => setInAppForm((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={inAppForm.type}
              onChange={(event) =>
                setInAppForm((prev) => ({ ...prev, type: event.target.value as InAppNotificationType }))
              }
            >
              <option value="INFO">INFO</option>
              <option value="REMINDER">REMINDER</option>
              <option value="ACTION">ACTION</option>
            </select>
          </div>

          <textarea
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Message"
            rows={3}
            value={inAppForm.message}
            onChange={(event) => setInAppForm((prev) => ({ ...prev, message: event.target.value }))}
            required
          />

          <div className="grid gap-3 md:grid-cols-3">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Deep link"
              value={inAppForm.deepLink}
              onChange={(event) => setInAppForm((prev) => ({ ...prev, deepLink: event.target.value }))}
            />
            {/* Metadata field hidden from staff UI — auto-populated */}
            <input type="hidden" value={inAppForm.metadataJson} />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              type="datetime-local"
              value={inAppForm.expiresAt}
              onChange={(event) => setInAppForm((prev) => ({ ...prev, expiresAt: event.target.value }))}
            />
          </div>

          <button
            type="submit"
            disabled={sendingInApp}
            className="rounded-xl bg-[#c42924] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#a81f1c] disabled:opacity-50"
          >
            {sendingInApp ? "Sending..." : "Send In-App Notification"}
          </button>
        </form>
      </SectionCard>
    </div>
  );
}
