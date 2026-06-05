import { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { db } from "../lib/butterbase";
import { triggerCheckResearch, triggerInitialResearch } from "../lib/trigger-research";
import { StatusBadge } from "../components/StatusBadge";
import type { Topic, Job, Source } from "../lib/types";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TopicDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [topic, setTopic] = useState<Topic | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researchStep, setResearchStep] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [checkTriggering, setCheckTriggering] = useState(false);
  const [checkStep, setCheckStep] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkSubmitting, setCheckSubmitting] = useState(false);
  const invokedJobs = useRef<Set<string>>(new Set());

  function triggerKey(jobId: string, kind: "research" | "check" = "research") {
    return `${kind}-triggered:${jobId}`;
  }

  function markTriggered(jobId: string, kind: "research" | "check" = "research") {
    invokedJobs.current.add(`${kind}:${jobId}`);
    try {
      sessionStorage.setItem(triggerKey(jobId, kind), String(Date.now()));
    } catch {
      // ignore
    }
  }

  function wasTriggered(jobId: string, kind: "research" | "check" = "research") {
    if (invokedJobs.current.has(`${kind}:${jobId}`)) return true;
    try {
      return sessionStorage.getItem(triggerKey(jobId, kind)) != null;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!id) return;
    loadAll(id, true);
  }, [id]);

  useEffect(() => {
    if (!id || !topic) return;
    const active =
      topic.status === "building" ||
      jobs.some((j) => j.status === "queued" || j.status === "running") ||
      checkTriggering ||
      triggering;
    if (!active) return;

    const timer = setInterval(() => loadAll(id, false), 3000);
    return () => clearInterval(timer);
  }, [id, topic?.status, jobs]);

  useEffect(() => {
    if (!id || !topic) return;
    const queued = jobs.find((j) => j.type === "initial_research" && j.status === "queued");
    if (!queued || wasTriggered(queued.id) || triggering) return;

    markTriggered(queued.id, "research");
    setTriggering(true);
    setResearchError(null);
    setResearchStep(
      import.meta.env.DEV
        ? "Calling local Rocket Ride (topic-research.pipe)…"
        : "Calling cloud research function…",
    );

    void triggerInitialResearch({
      job_id: queued.id,
      topic_id: topic.id,
      topic_name: topic.name,
    }).then(({ error: triggerErr }) => {
      setTriggering(false);
      if (triggerErr) {
        setResearchError(triggerErr);
        setResearchStep(null);
        // Do not retry automatically — user clicks Retry research
      } else {
        setResearchStep("Pipeline finished — saving sources…");
        void loadAll(id, false);
      }
    });
  }, [id, topic?.id, topic?.name, jobs]);

  useEffect(() => {
    if (!id || !topic) return;
    const queued = jobs.find((j) => j.type === "check" && j.status === "queued");
    if (!queued || wasTriggered(queued.id, "check") || checkTriggering) return;

    markTriggered(queued.id, "check");
    setCheckTriggering(true);
    setCheckError(null);
    setCheckStep(
      import.meta.env.DEV
        ? "Calling local Rocket Ride (topic-research-check.pipe)…"
        : "Checking for updates…",
    );

    void triggerCheckResearch({
      job_id: queued.id,
      topic_id: topic.id,
      topic_name: topic.name,
    }).then(({ error: triggerErr }) => {
      setCheckTriggering(false);
      if (triggerErr) {
        setCheckError(triggerErr);
        setCheckStep(null);
      } else {
        setCheckStep("Check finished — saving results…");
        void loadAll(id, false);
      }
    });
  }, [id, topic?.id, topic?.name, jobs]);

  async function loadAll(topicId: string, showSpinner: boolean) {
    if (showSpinner) setLoading(true);
    setError(null);

    const [topicRes, jobsRes, sourcesRes] = await Promise.all([
      db.from<Topic>("topics").select("*").eq("id", topicId).single(),
      db.from<Job>("jobs").select("*").eq("topic_id", topicId).order("triggered_at", { ascending: false }),
      db.from<Source>("sources").select("*").eq("topic_id", topicId).order("added_at", { ascending: false }),
    ]);

    if (topicRes.error) {
      setError((topicRes.error as Error).message);
      setLoading(false);
      return;
    }
    setTopic(topicRes.data as unknown as Topic);
    setJobs((jobsRes.data as Job[]) ?? []);
    setSources((sourcesRes.data as Source[]) ?? []);
    if (showSpinner) setLoading(false);
  }

  const initialJob = jobs.find((j) => j.type === "initial_research");
  const checkJob = jobs.find(
    (j) => j.type === "check" && (j.status === "queued" || j.status === "running" || j.status === "failed"),
  );
  const jobStatus = initialJob?.status;
  const checkJobStatus = checkJob?.status;
  const jobBusy = jobs.some((j) => j.status === "queued" || j.status === "running");

  const isActive =
    topic?.status === "building" ||
    topic?.status === "error" ||
    jobStatus === "queued" ||
    jobStatus === "running" ||
    jobStatus === "failed" ||
    triggering ||
    !!researchError;

  const isCheckActive =
    checkTriggering ||
    checkJobStatus === "queued" ||
    checkJobStatus === "running" ||
    !!checkError;

  function statusMessage(): string {
    if (researchError) return researchError;
    if (triggering || researchStep) return researchStep ?? "Starting…";
    if (jobStatus === "queued") return "Job queued — waiting to start…";
    if (jobStatus === "running") {
      return import.meta.env.DEV
        ? "Rocket Ride agent running (arXiv + Exa + Firecrawl). Usually 1–3 minutes."
        : "Research in progress. Usually 1–3 minutes.";
    }
    if (jobStatus === "failed") {
      return initialJob?.result_summary ?? "Research failed.";
    }
    return "Research in progress…";
  }

  function checkStatusMessage(): string {
    if (checkError) return checkError;
    if (checkTriggering || checkStep) return checkStep ?? "Starting check…";
    if (checkJobStatus === "queued") return "Check queued — waiting to start…";
    if (checkJobStatus === "running") {
      return import.meta.env.DEV
        ? "Rocket Ride check running (topic-research-check.pipe). Usually 1–3 minutes."
        : "Checking for new developments…";
    }
    if (checkJobStatus === "failed") {
      return checkJob?.result_summary ?? "Check failed.";
    }
    return "Checking for updates…";
  }

  async function checkLatestInfo() {
    if (!topic || topic.status !== "ready" || jobBusy || checkSubmitting) return;
    setCheckSubmitting(true);
    setCheckError(null);
    setCheckStep(null);

    const { data: jobData, error: jobErr } = await db
      .from<Job>("jobs")
      .insert({
        topic_id: topic.id,
        type: "check",
        status: "queued",
        payload: { topic_name: topic.name },
      })
      .select("*");

    if (jobErr) {
      setCheckError((jobErr as Error).message);
      setCheckSubmitting(false);
      return;
    }

    const job = (Array.isArray(jobData) ? jobData[0] : jobData) as Job | undefined;
    if (!job?.id) {
      setCheckError("Check job was created but no id was returned.");
      setCheckSubmitting(false);
      return;
    }

    markTriggered(job.id, "check");
    setCheckTriggering(true);
    setCheckStep(
      import.meta.env.DEV
        ? "Calling local Rocket Ride (topic-research-check.pipe)…"
        : "Checking for updates…",
    );

    const { error: triggerErr } = await triggerCheckResearch({
      job_id: job.id,
      topic_id: topic.id,
      topic_name: topic.name,
    });

    setCheckSubmitting(false);
    setCheckTriggering(false);

    if (triggerErr) {
      setCheckError(triggerErr);
      setCheckStep(null);
    } else {
      setCheckStep(null);
      if (id) await loadAll(id, false);
    }
  }

  async function toggleSubscription() {
    if (!topic) return;
    setToggling(true);
    const next = !topic.is_subscribed;
    const { error } = await db
      .from("topics")
      .update({ is_subscribed: next })
      .eq("id", topic.id);
    if (error) {
      setError((error as Error).message);
    } else {
      setTopic({ ...topic, is_subscribed: next });
    }
    setToggling(false);
  }

  if (loading) return <div className="spinner" />;

  if (!topic) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-title">Topic not found</div>
          <Link to="/" className="btn btn-ghost" style={{ marginTop: "1rem" }}>
            ← Back to Topics
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/" className="page-back">
        ← All Topics
      </Link>

      {error && <div className="error-banner">{error}</div>}

      {isCheckActive && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            padding: "1rem 1.25rem",
            borderColor: checkError || checkJobStatus === "failed" ? "var(--danger, #c44)" : undefined,
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: ".5rem" }}>
            {(checkTriggering || checkJobStatus === "running") && !checkError && (
              <span className="spinner" style={{ width: 16, height: 16, margin: 0 }} />
            )}
            {checkError || checkJobStatus === "failed" ? "Check failed" : "Checking for updates"}
          </div>
          <p
            style={{
              margin: ".5rem 0 0",
              fontSize: ".9rem",
              color: checkError || checkJobStatus === "failed" ? "var(--danger, #c44)" : "var(--text-muted)",
            }}
          >
            {checkStatusMessage()}
          </p>
          {import.meta.env.DEV && (
            <p style={{ margin: ".5rem 0 0", fontSize: ".8rem", color: "var(--text-muted)" }}>
              Run <code>topic-research-check.pipe</code> in Cursor (▶) before checking.
            </p>
          )}
        </div>
      )}

      {isActive && (
        <div
          className="card"
          style={{
            marginBottom: "1rem",
            padding: "1rem 1.25rem",
            borderColor: researchError || jobStatus === "failed" ? "var(--danger, #c44)" : undefined,
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: ".5rem" }}>
            {(triggering || jobStatus === "running") && !researchError && (
              <span className="spinner" style={{ width: 16, height: 16, margin: 0 }} />
            )}
            {researchError || jobStatus === "failed" ? "Research failed" : "Research in progress"}
          </div>
          <p style={{ margin: ".5rem 0 0", fontSize: ".9rem", color: researchError || jobStatus === "failed" ? "var(--danger, #c44)" : "var(--text-muted)" }}>
            {statusMessage()}
          </p>
          {import.meta.env.DEV && (researchError || jobStatus === "queued" || jobStatus === "failed") && (
            <div style={{ margin: ".75rem 0 0", fontSize: ".85rem", color: "var(--text-muted)" }}>
              <p>
                <strong>Local dev checklist:</strong>
              </p>
              <ol style={{ margin: ".25rem 0 0", paddingLeft: "1.25rem" }}>
                <li>
                  Open <code>topic-research.pipe</code> (not the check pipe) → Rocket Ride → confirm{" "}
                  <strong>OpenAI billing/quota</strong> → <strong>Run (▶)</strong> until &quot;chat is
                  now available&quot;
                </li>
                <li>
                  UI at <strong>http://localhost:5173</strong> (<code>npm run dev</code>)
                </li>
                <li>
                  Copy <strong>Local URL</strong> + <strong>Private Token</strong> from Rocket Ride →
                  Endpoint Configuration into <code>.env.local</code>
                </li>
                <li>Watch the terminal running <code>npm run dev</code> for <code>[research]</code> logs</li>
              </ol>
              {(researchError || jobStatus === "failed") && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  style={{ marginTop: ".75rem" }}
                  disabled={triggering}
                  onClick={() => {
                    if (!initialJob || !topic) return;
                    try {
                      sessionStorage.removeItem(triggerKey(initialJob.id, "research"));
                    } catch {
                      // ignore
                    }
                    invokedJobs.current.delete(`research:${initialJob.id}`);
                    setResearchError(null);
                    void db
                      .from("jobs")
                      .update({ status: "queued", result_summary: null, finished_at: null })
                      .eq("id", initialJob.id)
                      .then(() => db.from("topics").update({ status: "building" }).eq("id", topic.id))
                      .then(() => {
                        if (id) void loadAll(id, false);
                      });
                  }}
                >
                  Retry research
                </button>
              )}
            </div>
          )}
          {jobStatus && (
            <p style={{ margin: ".5rem 0 0", fontSize: ".8rem", color: "var(--text-muted)" }}>
              Job status: <code>{jobStatus}</code>
              {initialJob?.finished_at ? null : " · auto-refresh every 3s"}
            </p>
          )}
        </div>
      )}

      {/* Topic header card */}
      <div className="detail-header">
        <div className="detail-title">{topic.name}</div>
        <div className="detail-row">
          <div className="detail-badges">
            <StatusBadge status={topic.status} />
            {topic.xtrace_memory_id && (
              <span className="badge badge-queued" title="xTrace memory ID">
                🔗 {topic.xtrace_memory_id}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
            <span className="detail-date">
              Created {new Date(topic.created_at).toLocaleDateString()}
              {topic.last_checked_at && (
                <> · Checked {fmt(topic.last_checked_at)}</>
              )}
            </span>
            {topic.status === "ready" && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void checkLatestInfo()}
                disabled={jobBusy || checkSubmitting || checkTriggering}
              >
                {checkSubmitting || checkTriggering ? "Checking…" : "Check latest info"}
              </button>
            )}
            <button
              className={`btn btn-sm ${topic.is_subscribed ? "btn-subscribe" : "btn-unsubscribe"}`}
              onClick={toggleSubscription}
              disabled={toggling}
            >
              {toggling
                ? "…"
                : topic.is_subscribed
                ? "✓ Subscribed"
                : "○ Unsubscribed"}
            </button>
          </div>
        </div>
      </div>

      {/* Jobs section */}
      <div className="section">
        <div className="section-title">
          Jobs
          <span className="section-count">{jobs.length}</span>
        </div>
        {jobs.length === 0 ? (
          <div className="card">
            <div className="empty" style={{ padding: "2rem" }}>
              <div className="empty-sub">No jobs have run for this topic yet.</div>
            </div>
          </div>
        ) : (
          <div className="job-list">
            {jobs.map((job) => (
              <div key={job.id} className="job-item">
                <span className="job-type">{job.type.replace(/_/g, " ")}</span>
                <div className="job-body">
                  <div className="job-summary">
                    {job.status === "queued" && (
                      <em style={{ color: "var(--text-muted)" }}>Waiting to start…</em>
                    )}
                    {job.status === "running" && (
                      <em style={{ color: "var(--text-muted)" }}>
                        {job.type === "check"
                          ? "Rocket Ride check pipeline running…"
                          : "Rocket Ride pipeline running…"}
                      </em>
                    )}
                    {job.status === "failed" && (
                      <span style={{ color: "var(--danger, #c44)" }}>
                        {job.result_summary ?? "Failed"}
                      </span>
                    )}
                    {job.status === "done" &&
                      (job.result_summary ?? (
                        <em style={{ color: "var(--text-muted)" }}>Completed</em>
                      ))}
                  </div>
                  <div className="job-dates">
                    Triggered {fmt(job.triggered_at)}
                    {job.finished_at && <> · Finished {fmt(job.finished_at)}</>}
                  </div>
                </div>
                <StatusBadge status={job.status} type="job" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sources section */}
      <div className="section">
        <div className="section-title">
          Sources
          <span className="section-count">{sources.length}</span>
        </div>
        {sources.length === 0 ? (
          <div className="card">
            <div className="empty" style={{ padding: "2rem" }}>
              <div className="empty-sub">No sources have been collected yet.</div>
            </div>
          </div>
        ) : (
          <div className="source-list">
            {sources.map((src) => (
              <div key={src.id} className="source-item">
                <div className="source-body">
                  {src.title && <div className="source-title">{src.title}</div>}
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-url"
                  >
                    {src.url}
                  </a>
                  <div className="source-meta">
                    <span className={`badge badge-${src.added_by}`}>{src.added_by}</span>
                    <span className={`badge ${src.was_novel ? "badge-novel" : "badge-known"}`}>
                      {src.was_novel ? "✦ novel" : "known"}
                    </span>
                    <span style={{ fontSize: ".75rem", color: "var(--text-muted)" }}>
                      {fmt(src.added_at)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
