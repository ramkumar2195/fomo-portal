"use client";

const POSTS = [
  {
    id: 1,
    user: "Amit Verma",
    role: "Member",
    content:
      "Just completed my first 100kg deadlift. Shoutout to trainer team for the guidance. #GymGoals #FOMO",
    likes: 24,
    comments: 5,
    time: "2 hours ago",
  },
  {
    id: 2,
    user: "Vikram Singh",
    role: "Trainer",
    content: "New Zumba batch starts this Monday at 7 PM. Limited slots available, register at front desk.",
    likes: 42,
    comments: 12,
    time: "4 hours ago",
  },
  {
    id: 3,
    user: "Sonia Khan",
    role: "Member",
    content: "Anyone up for early morning cardio sessions this week?",
    likes: 8,
    comments: 15,
    time: "6 hours ago",
  },
];

export default function CommunityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gym Community</h1>
          <p className="text-gray-500">Connect with members and share updates.</p>
        </div>
        <button className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
          Create Post
        </button>
      </div>

      <div className="space-y-6">
        {POSTS.map((post) => (
          <article key={post.id} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-600">
                {post.user.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-gray-900">{post.user}</p>
                <p className="text-xs text-gray-500">
                  {post.role} • {post.time}
                </p>
              </div>
            </div>

            <p className="mb-6 text-gray-800">{post.content}</p>

            <div className="flex items-center gap-6 border-t border-gray-50 pt-4">
              <button className="text-sm font-medium text-gray-500 hover:text-red-600">Like {post.likes}</button>
              <button className="text-sm font-medium text-gray-500 hover:text-blue-600">Comments {post.comments}</button>
              <button className="ml-auto text-sm font-medium text-gray-500 hover:text-gray-900">Share</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
