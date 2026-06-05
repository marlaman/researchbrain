import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../lib/butterbase";
import { triggerInitialResearch } from "../lib/trigger-research";
import type { Topic, User } from "../lib/types";

export function CreateTopic() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.from<User>("users")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        const list = (data as User[]) ?? [];
        setUsers(list);
        if (list.length > 0) setUserId(list[0].id);
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !userId) return;
    setSubmitting(true);
    setError(null);

    const topicName = name.trim();

    const { data: topicData, error: topicErr } = await db
      .from<Topic>("topics")
      .insert({
        name: topicName,
        user_id: userId,
        status: "building",
        is_subscribed: true,
      })
      .select("*");

    if (topicErr) {
      setError((topicErr as Error).message);
      setSubmitting(false);
      return;
    }

    const topic = (Array.isArray(topicData) ? topicData[0] : topicData) as Topic | undefined;
    if (!topic?.id) {
      setError("Topic was created but no id was returned.");
      setSubmitting(false);
      return;
    }

    const { data: jobData, error: jobErr } = await db
      .from("jobs")
      .insert({
        topic_id: topic.id,
        type: "initial_research",
        status: "queued",
        payload: { topic_name: topicName },
      })
      .select("*");

    if (jobErr) {
      setError((jobErr as Error).message);
      setSubmitting(false);
      return;
    }

    const job = (Array.isArray(jobData) ? jobData[0] : jobData) as { id?: string } | undefined;

    if (job?.id) {
      try {
        sessionStorage.setItem(`research-triggered:${job.id}`, String(Date.now()));
      } catch {
        // ignore
      }
      void triggerInitialResearch({
        job_id: job.id,
        topic_id: topic.id,
        topic_name: topicName,
      }).then(({ error: triggerErr }) => {
        if (triggerErr) {
          console.error("initial research:", triggerErr);
          try {
            sessionStorage.removeItem(`research-triggered:${job.id}`);
          } catch {
            // ignore
          }
        }
      });
    }

    navigate(`/topics/${topic.id}`);
  }

  function userLabel(u: User) {
    if (u.slack_user_id) return `${u.slack_user_id} (Slack)`;
    if (u.discord_user_id) return `${u.discord_user_id} (Discord)`;
    return u.id.slice(0, 8) + "…";
  }

  return (
    <div className="page">
      <Link to="/" className="page-back">
        ← Back to Topics
      </Link>

      <div className="page-header">
        <h1 className="page-title">New Topic</h1>
      </div>

      <div className="form-card">
        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="name">
              Topic name
            </label>
            <input
              id="name"
              className="form-input"
              type="text"
              placeholder="e.g. LLM inference optimizations"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <p className="form-hint">
              {import.meta.env.DEV
                ? "Local dev: runs topic-research.pipe via Rocket Ride on your Mac."
                : "Research starts automatically in the cloud when you create a topic."}
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="user">
              User
            </label>
            <select
              id="user"
              className="form-select"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            >
              {users.length === 0 && (
                <option value="" disabled>
                  Loading users…
                </option>
              )}
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
            <p className="form-hint">Which user owns this topic?</p>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !name.trim() || !userId}
            >
              {submitting ? "Creating…" : "Create Topic"}
            </button>
            <Link to="/" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
