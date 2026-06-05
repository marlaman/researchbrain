import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../lib/butterbase";
import { useAuth } from "../context/AuthContext";
import type { Topic } from "../lib/types";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.round(mo / 12);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

function depthLabel(count: number): { label: string; muted: boolean } {
  if (count <= 0) return { label: "No sources yet", muted: true };
  if (count <= 3) return { label: `Sparse · ${count} source${count === 1 ? "" : "s"}`, muted: false };
  if (count <= 8) return { label: `Solid · ${count} sources`, muted: false };
  return { label: `Deep · ${count} sources`, muted: false };
}

export function TopicsList() {
  const { session } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user) loadTopics(session.user.id);
  }, [session]);

  async function loadTopics(userId: string) {
    setLoading(true);
    setError(null);
    const { data, error } = await db
      .from<Topic>("topics")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      setError((error as Error).message);
      setLoading(false);
      return;
    }
    const list = (data as Topic[]) ?? [];
    setTopics(list);
    setLoading(false);
    void loadCounts(list);
  }

  async function loadCounts(list: Topic[]) {
    const entries = await Promise.all(
      list.map(async (topic) => {
        const { data } = await db
          .from("sources")
          .select("id")
          .eq("topic_id", topic.id);
        return [topic.id, Array.isArray(data) ? data.length : 0] as const;
      }),
    );
    setCounts(Object.fromEntries(entries));
  }

  async function toggleSubscription(topic: Topic) {
    setToggling(topic.id);
    const { error } = await db
      .from("topics")
      .update({ is_subscribed: !topic.is_subscribed })
      .eq("id", topic.id);
    if (error) {
      setError((error as Error).message);
    } else {
      setTopics((prev) =>
        prev.map((t) =>
          t.id === topic.id ? { ...t, is_subscribed: !t.is_subscribed } : t
        )
      );
    }
    setToggling(null);
  }

  return (
    <div className="page">
      <div className="hero">
        <h1 className="hero-title">Topics</h1>
        <p className="hero-sub">
          Track the latest on anything you care about. Each topic keeps
          researching in the background and surfaces new findings as they appear.
        </p>
        <div className="hero-actions">
          <Link to="/topics/new" className="btn btn-primary">
            + New Topic
          </Link>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="spinner" />
      ) : topics.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No topics yet</div>
          <div className="empty-sub">
            Create your first topic to start tracking the latest news.
          </div>
        </div>
      ) : (
        <div className="topics-grid">
          {topics.map((topic) => {
            const depth = depthLabel(counts[topic.id] ?? 0);
            return (
              <div key={topic.id} className="topic-card">
                <div className="topic-name">{topic.name}</div>

                {topic.status === "building" ? (
                  <div className="topic-state topic-state-building">Researching…</div>
                ) : topic.status === "error" ? (
                  <div className="topic-state topic-state-error">Needs attention</div>
                ) : (
                  <div
                    className={`topic-depth${depth.muted ? " topic-depth-none" : ""}`}
                  >
                    {depth.label}
                  </div>
                )}

                <div className="topic-meta">
                  <span className="topic-date">
                    Last updated · {relativeTime(topic.last_checked_at ?? topic.created_at)}
                  </span>
                </div>

                <div className="topic-actions">
                  <button
                    className={`btn btn-sm ${topic.is_subscribed ? "btn-subscribe" : "btn-unsubscribe"}`}
                    onClick={() => toggleSubscription(topic)}
                    disabled={toggling === topic.id}
                  >
                    {toggling === topic.id
                      ? "…"
                      : topic.is_subscribed
                      ? "✓ Subscribed"
                      : "○ Unsubscribed"}
                  </button>
                  <Link to={`/topics/${topic.id}`} className="btn btn-ghost btn-sm">
                    Open →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
