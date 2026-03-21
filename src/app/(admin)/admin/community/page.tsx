"use client";

import { useEffect, useState } from "react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { PendingApiPlaceholder } from "@/components/admin/pending-api-placeholder";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { engagementService } from "@/lib/api/services/engagement-service";

function toRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
}

function pickString(payload: unknown, keys: string[]): string {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "-";
}

function pickNumber(payload: unknown, keys: string[]): number {
  const record = toRecord(payload);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

export default function CommunityPage() {
  const { token } = useAuth();
  const [feed, setFeed] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await engagementService.getCommunityFeed(token, 0, 25);
        if (!active) {
          return;
        }

        setFeed(data);
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof ApiError ? loadError.message : "Unable to load community feed.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <AdminPageFrame
      title="Community"
      description="Community feed from /api/community/feed"
      searchPlaceholder="Search community posts..."
    >
      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <SurfaceCard title="Community Feed">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2">Author</th>
                <th className="px-3 py-2">Content</th>
                <th className="px-3 py-2">Likes</th>
                <th className="px-3 py-2">Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {feed.map((item, index) => (
                <tr key={String(toRecord(item).id || index)}>
                  <td className="px-3 py-2 text-slate-700">{pickString(item, ["authorName", "createdByName", "userName"])}</td>
                  <td className="px-3 py-2 text-slate-700">{pickString(item, ["content", "message", "text"])}</td>
                  <td className="px-3 py-2 text-slate-700">{pickNumber(item, ["likesCount", "likes", "likeCount"])}</td>
                  <td className="px-3 py-2 text-slate-700">{pickNumber(item, ["commentsCount", "comments", "commentCount"])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading ? <div className="mt-3 text-sm text-slate-500">Loading feed...</div> : null}

        {!loading && feed.length === 0 ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">No posts found.</div>
        ) : null}
      </SurfaceCard>

      <PendingApiPlaceholder
        title="Community Modules"
        missingEndpoints={[
          "/api/community/challenges",
          "/api/community/leaderboard (branch scoped)",
          "/api/community/events",
          "/api/community/announcements",
        ]}
      />
    </AdminPageFrame>
  );
}
