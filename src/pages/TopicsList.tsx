import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../lib/butterbase";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import type { Topic } from "../lib/types";

export function TopicsList() {
  const { session } = useAuth();
  const [topics, setTopics] = useState<Topic[]>([]);
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
    } else {
      setTopics((data as Topic[]) ?? []);
    }
    setLoading(false);
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
      <div className="page-header">
        <h1 className="page-title">Topics</h1>
        <Link to="/topics/new" className="btn btn-primary">
          + New Topic
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="spinner" />
      ) : topics.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🔬</div>
          <div className="empty-title">No topics yet</div>
          <div className="empty-sub">Create your first topic to start researching.</div>
        </div>
      ) : (
        <div className="topics-grid">
          {topics.map((topic) => (
            <div key={topic.id} className="topic-card">
              <div className="topic-name">{topic.name}</div>
              <div className="topic-meta">
                <StatusBadge status={topic.status} />
                <span className="topic-date">
                  {new Date(topic.created_at).toLocaleDateString()}
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
                  View Details →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
