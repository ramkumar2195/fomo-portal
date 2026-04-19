"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { notificationService } from "@/lib/api/services/notification-service";
import { NotificationCampaign } from "@/types/notification";

interface CampaignFormState {
  name: string;
  title: string;
  message: string;
  channel: "IN_APP" | "SMS" | "EMAIL" | "WHATSAPP";
  targetMemberIds: string;
}

const INITIAL_FORM: CampaignFormState = {
  name: "",
  title: "",
  message: "",
  channel: "IN_APP",
  targetMemberIds: "",
};

function numericUserId(id: string | undefined): number {
  if (!id) {
    return 0;
  }

  const parsed = Number(id);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const digits = id.replace(/[^0-9]/g, "");
  const fromDigits = Number(digits);
  return Number.isNaN(fromDigits) ? 0 : fromDigits;
}

export default function NotificationsPage() {
  const { token, user } = useAuth();
  const [campaigns, setCampaigns] = useState<NotificationCampaign[]>([]);
  const [statsByCampaign, setStatsByCampaign] = useState<Record<number, Record<string, unknown>>>({});
  const [form, setForm] = useState<CampaignFormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await notificationService.listCampaigns(token);
      setCampaigns(data);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "Unable to load campaigns.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const handleCreateCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !user) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const parsedMemberIds = form.targetMemberIds
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => !Number.isNaN(value));

      if (parsedMemberIds.length === 0) {
        throw new Error("Enter at least one target member ID.");
      }

      await notificationService.createCampaign(token, {
        name: form.name,
        title: form.title,
        message: form.message,
        channel: form.channel,
        audienceType: "SPECIFIC_MEMBERS",
        targetMemberIds: parsedMemberIds,
        branchId: null,
        createdBy: numericUserId(user.id),
        scheduledAt: null,
        metadataJson: JSON.stringify({ source: "staff-portal-admin" }),
      });

      setForm(INITIAL_FORM);
      setSuccess("Campaign created.");
      await loadCampaigns();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to create campaign.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendCampaign = async (campaignId: number) => {
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await notificationService.sendCampaign(token, campaignId);
      setSuccess(`Campaign ${campaignId} sent.`);
      await loadCampaigns();
    } catch (sendError) {
      setError(sendError instanceof ApiError ? sendError.message : "Unable to send campaign.");
    }
  };

  const handleLoadStats = async (campaignId: number) => {
    if (!token) {
      return;
    }

    setError(null);

    try {
      const stats = await notificationService.getCampaignStats(token, campaignId);
      setStatsByCampaign((prev) => ({
        ...prev,
        [campaignId]: stats as Record<string, unknown>,
      }));
    } catch (statsError) {
      setError(statsError instanceof ApiError ? statsError.message : "Unable to load campaign stats.");
    }
  };

  return (
    <AdminPageFrame
      title="Notifications"
      description="Campaign management via /api/notifications/campaigns and in-app APIs"
      searchPlaceholder="Search campaign title or channel..."
      action={
        <button
          type="button"
          className="rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
          onClick={() => setSuccess("Use the create form below.")}
        >
          New Campaign
        </button>
      }
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</div> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <SurfaceCard title="Campaign Queue">
          <div className="space-y-3">
            {campaigns.map((campaign) => {
              const stats = statsByCampaign[campaign.campaignId];
              return (
                <div key={campaign.campaignId} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-sm font-semibold text-slate-800">{campaign.title}</p>
                  <p className="text-xs text-slate-500">
                    {campaign.channel} • {campaign.status || "UNKNOWN"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{campaign.message}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSendCampaign(campaign.campaignId)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLoadStats(campaign.campaignId)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Stats
                    </button>
                  </div>
                  {stats ? (
                    <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-600">
                      {JSON.stringify(stats, null, 2)}
                    </pre>
                  ) : null}
                </div>
              );
            })}
            {loading ? <p className="text-sm text-slate-500">Loading campaigns...</p> : null}
          </div>
        </SurfaceCard>

        <SurfaceCard title="Create Campaign">
          <form className="space-y-3" onSubmit={handleCreateCampaign}>
            <input
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              placeholder="Campaign name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <input
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              placeholder="Title"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
            <textarea
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              rows={4}
              placeholder="Message"
              value={form.message}
              onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
              required
            />
            <select
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              value={form.channel}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  channel: event.target.value as CampaignFormState["channel"],
                }))
              }
            >
              <option value="IN_APP">IN_APP</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">EMAIL</option>
              <option value="WHATSAPP">WHATSAPP</option>
            </select>
            <input
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
              placeholder="Target Member IDs (comma separated)"
              value={form.targetMemberIds}
              onChange={(event) => setForm((prev) => ({ ...prev, targetMemberIds: event.target.value }))}
              required
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#c42924] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a51f1b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating..." : "Create Campaign"}
            </button>
          </form>
        </SurfaceCard>
      </section>
    </AdminPageFrame>
  );
}
