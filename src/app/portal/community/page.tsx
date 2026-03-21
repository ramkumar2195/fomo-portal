"use client";

import { useCallback, useEffect, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { Modal } from "@/components/common/modal";
import { ToastBanner } from "@/components/common/toast-banner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAuth } from "@/contexts/auth-context";
import { engagementService } from "@/lib/api/services/engagement-service";

type Row = Record<string, unknown>;

function str(row: Row, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function num(row: Row, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number") return v;
  }
  return 0;
}

export default function CommunityPage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Row[]>([]);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Create post
  const [showCreate, setShowCreate] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Comments
  const [expandedPost, setExpandedPost] = useState<number | null>(null);
  const [comments, setComments] = useState<Row[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);

  // Delete
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const loadFeed = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await engagementService.getCommunityFeed(token);
      setPosts(data as Row[]);
    } catch {
      setToast({ kind: "error", message: "Failed to load community feed" });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const handleCreatePost = async () => {
    if (!token || !newContent.trim()) return;
    setSubmitting(true);
    try {
      await engagementService.createPost(token, { content: newContent.trim() });
      setToast({ kind: "success", message: "Post created!" });
      setShowCreate(false);
      setNewContent("");
      void loadFeed();
    } catch {
      setToast({ kind: "error", message: "Failed to create post" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (postId: number) => {
    if (!token) return;
    try {
      await engagementService.likePost(token, postId);
      void loadFeed();
    } catch {
      // If already liked, try unlike
      try {
        await engagementService.unlikePost(token, postId);
        void loadFeed();
      } catch {
        setToast({ kind: "error", message: "Failed to toggle like" });
      }
    }
  };

  const handleExpandComments = async (postId: number) => {
    if (expandedPost === postId) {
      setExpandedPost(null);
      return;
    }
    if (!token) return;
    setExpandedPost(postId);
    setLoadingComments(true);
    try {
      const data = await engagementService.getPostComments(token, postId);
      setComments(data as Row[]);
    } catch {
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleAddComment = async (postId: number) => {
    if (!token || !newComment.trim()) return;
    try {
      await engagementService.createComment(token, postId, { content: newComment.trim() });
      setNewComment("");
      const data = await engagementService.getPostComments(token, postId);
      setComments(data as Row[]);
      void loadFeed();
    } catch {
      setToast({ kind: "error", message: "Failed to add comment" });
    }
  };

  const handleDelete = async () => {
    if (!token || deleteId === null) return;
    try {
      await engagementService.deletePost(token, deleteId);
      setToast({ kind: "success", message: "Post deleted" });
      setDeleteId(null);
      void loadFeed();
    } catch {
      setToast({ kind: "error", message: "Failed to delete post" });
    }
  };

  if (loading) return <PageLoader label="Loading community feed..." />;

  const isStaffOrAdmin = user?.role === "ADMIN" || user?.role === "STAFF";

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      {toast && (
        <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gym Community</h1>
          <p className="text-gray-500">Connect with members and share updates.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
        >
          Create Post
        </button>
      </div>

      {posts.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center">
          <p className="text-gray-500">No posts yet. Be the first to share something!</p>
        </div>
      )}

      <div className="space-y-6">
        {posts.map((post) => {
          const postId = num(post, "id", "postId");
          const authorName = str(post, "authorName", "userName", "user", "author");
          const authorRole = str(post, "authorRole", "role");
          const content = str(post, "content", "body", "text");
          const likes = num(post, "likeCount", "likes", "totalLikes");
          const commentCount = num(post, "commentCount", "comments", "totalComments");
          const timeAgo = str(post, "createdAt", "postedAt", "time");

          return (
            <article
              key={postId || content.slice(0, 20)}
              className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-600">
                  {(authorName || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-gray-900">{authorName || "Unknown"}</p>
                  <p className="text-xs text-gray-500">
                    {authorRole ? `${authorRole} \u2022 ` : ""}
                    {timeAgo}
                  </p>
                </div>
                {isStaffOrAdmin && postId > 0 && (
                  <button
                    type="button"
                    onClick={() => setDeleteId(postId)}
                    className="text-xs font-medium text-red-500 hover:text-red-700"
                  >
                    Delete
                  </button>
                )}
              </div>

              <p className="mb-6 whitespace-pre-wrap text-gray-800">{content}</p>

              <div className="flex items-center gap-6 border-t border-gray-50 pt-4">
                <button
                  type="button"
                  onClick={() => void handleLike(postId)}
                  className="text-sm font-medium text-gray-500 hover:text-red-600"
                >
                  Like {likes > 0 ? likes : ""}
                </button>
                <button
                  type="button"
                  onClick={() => void handleExpandComments(postId)}
                  className="text-sm font-medium text-gray-500 hover:text-blue-600"
                >
                  Comments {commentCount > 0 ? commentCount : ""}
                </button>
              </div>

              {/* Comments section */}
              {expandedPost === postId && (
                <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                  {loadingComments ? (
                    <p className="text-sm text-gray-400">Loading comments...</p>
                  ) : (
                    <>
                      {comments.map((c, i) => (
                        <div key={i} className="flex gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                            {(str(c as Row, "authorName", "userName", "author") || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-700">
                              {str(c as Row, "authorName", "userName", "author")}
                            </p>
                            <p className="text-sm text-gray-600">
                              {str(c as Row, "content", "body", "text")}
                            </p>
                          </div>
                        </div>
                      ))}
                      {comments.length === 0 && (
                        <p className="text-xs text-gray-400">No comments yet.</p>
                      )}

                      <div className="flex gap-2 pt-2">
                        <input
                          type="text"
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Write a comment..."
                          className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleAddComment(postId);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleAddComment(postId)}
                          className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
                        >
                          Post
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Create Post Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Post" size="md">
        <textarea
          rows={4}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="What's on your mind?"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowCreate(false)}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleCreatePost()}
            disabled={submitting || !newContent.trim()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? "Posting..." : "Post"}
          </button>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Post"
        message="Are you sure you want to delete this post? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
