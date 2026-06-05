import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../lib/butterbase";
import { triggerInitialResearch } from "../lib/trigger-research";
import { useAuth } from "../context/AuthContext";
import type { Topic } from "../lib/types";

export function CreateTopic() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !session?.user) return;
    setSubmitting(true);
    setError(null);

    const topicName = name.trim();

    const { data: topicData, error: topicErr } = await db
      .from<Topic>("topics")
      .insert({
        name: topicName,
        user_id: session.user.id,
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
        payload: { topic_name: topicName, user_id: session.user.id },
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
        user_id: session.user.id,
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

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !name.trim()}
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
