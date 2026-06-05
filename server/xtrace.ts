import type { Topic } from "../src/lib/types.js";

type ResearchSource = {
  id?: string;
  title?: string;
  url?: string;
  snippet?: string;
  type?: string;
  date?: string;
};

export type ResearchPayload = {
  topic?: string;
  summary?: string;
  sources?: ResearchSource[];
  entities?: Array<{ id?: string; name?: string; type?: string }>;
  relations?: Array<{ from?: string; to?: string; label?: string }>;
  claims?: Array<{ text?: string; source_ids?: string[] }>;
  open_questions?: string[];
};

type XtraceMessage = { role: "user"; content: string };

const BASE_URL =
  process.env.XTRACE_API_URL ?? "https://api.production.xtrace.ai";
const API_KEY = process.env.XTRACE_API_KEY;
const ORG_ID = process.env.XTRACE_ORG_ID;
const POLL_MS = 1000;
const POLL_TIMEOUT_MS = 45_000;
const MAX_CLAIM_MESSAGES = 12;
const MAX_SOURCE_MESSAGES = 5;

type MemoryCreated = {
  id?: string;
  type?: string;
  text?: string;
};

type IngestJob = {
  id?: string;
  status?: string;
  result?: {
    memories_created?: MemoryCreated[];
  };
  error?: string | null;
};

function headers(): Record<string, string> {
  if (!API_KEY || !ORG_ID) {
    throw new Error("XTRACE_API_KEY and XTRACE_ORG_ID are required in .env.local");
  }
  return {
    Authorization: `Bearer ${API_KEY}`,
    "X-Org-Id": ORG_ID,
    "Content-Type": "application/json",
  };
}

export function xtraceUserId(actorUserId?: string, topic?: Topic): string {
  return (
    actorUserId?.trim() ||
    topic?.user_id?.trim() ||
    process.env.XTRACE_USER_ID ||
    "1"
  );
}

export function xtraceConvId(topic: Topic): string {
  return `topic-${topic.name.trim()}`;
}

/** Load existing beliefs from the topic's Xtrace conversation (no LLM). */
export async function fetchTopicMemoryContext(
  topic: Topic,
  actorUserId?: string,
): Promise<string[]> {
  const userId = xtraceUserId(actorUserId, topic);
  const convId = xtraceConvId(topic);
  const lines: string[] = [];
  let cursor: string | null = null;

  for (;;) {
    const url = new URL(`${BASE_URL}/v1/memories`);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("conv_id", convId);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      console.warn(
        `[xtrace] list memories ${res.status} for conv_id=${convId}`,
      );
      break;
    }

    const body = (await res.json()) as {
      data?: Array<{ text?: string }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };

    for (const row of body.data ?? []) {
      if (row.text?.trim()) lines.push(row.text.trim());
    }

    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }

  return lines;
}

/** User turns for an incremental check (append to same conv_id). */
export function buildXtraceCheckMessages(
  topic: Topic,
  updateSummary: string,
  claims: Array<{ text?: string }>,
): XtraceMessage[] {
  const name = topic.name.trim();
  const messages: XtraceMessage[] = [];

  const summary = updateSummary.trim();
  if (summary) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, latest check update: ${summary}`,
    });
  }

  for (const claim of claims.filter((c) => c.text?.trim()).slice(0, MAX_CLAIM_MESSAGES)) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, new finding: ${claim.text!.trim()}`,
    });
  }

  return messages;
}

/**
 * Xtrace only extracts facts from user-role turns. Prefix findings with
 * "Regarding {topic}, …" so they land as searchable beliefs under that user.
 */
export function buildXtraceMessages(
  topic: Topic,
  result: ResearchPayload,
): XtraceMessage[] {
  const name = topic.name.trim();
  const messages: XtraceMessage[] = [
    { role: "user", content: `I love researching ${name}.` },
  ];

  const summary = result.summary?.trim();
  if (summary) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, ${summary}`,
    });
  }

  const claims = (result.claims ?? []).filter((c) => c.text?.trim());
  for (const claim of claims.slice(0, MAX_CLAIM_MESSAGES)) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, ${claim.text!.trim()}`,
    });
  }

  const sources = (result.sources ?? []).filter((s) => s.title?.trim() || s.url);
  for (const src of sources.slice(0, MAX_SOURCE_MESSAGES)) {
    const title = src.title?.trim() || src.url || "source";
    const url = src.url ? ` (${src.url})` : "";
    const snippet = src.snippet?.trim();
    const detail = snippet ? `: ${snippet}` : "";
    messages.push({
      role: "user",
      content: `Regarding ${name}, I found this source — ${title}${url}${detail}`,
    });
  }

  const questions = (result.open_questions ?? []).filter((q) => q.trim());
  for (const question of questions.slice(0, 5)) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, an open question is: ${question.trim()}`,
    });
  }

  if (messages.length === 1) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, initial research completed with ${(result.sources ?? []).length} source(s).`,
    });
  }

  return messages;
}

async function pollJob(jobId: string): Promise<IngestJob> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/memories/jobs/${jobId}`, {
      headers: headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Xtrace job poll ${res.status}: ${text.slice(0, 300)}`);
    }
    const job = (await res.json()) as IngestJob;
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Xtrace ingest timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

/** Push pipeline output to Xtrace after research completes. Returns first memory id. */
export async function ingestResearchToXtrace(
  topic: Topic,
  result: ResearchPayload,
  actorUserId?: string,
): Promise<string | undefined> {
  const userId = xtraceUserId(actorUserId, topic);
  const convId = xtraceConvId(topic);
  const messages = buildXtraceMessages(topic, result);

  console.log(
    `[xtrace] pushing ${messages.length} user turn(s) for "${topic.name}" (user_id=${userId}, conv_id=${convId})`,
  );

  const res = await fetch(`${BASE_URL}/v1/memories`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      wait: true,
      user_id: userId,
      conv_id: convId,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xtrace ingest ${res.status}: ${text.slice(0, 300)}`);
  }

  let job = (await res.json()) as IngestJob;
  if (job.status === "pending" || job.status === "running") {
    if (!job.id) throw new Error("Xtrace returned pending job without id");
    job = await pollJob(job.id);
  }

  if (job.status === "failed") {
    throw new Error(job.error ?? "Xtrace ingest failed");
  }

  const created = job.result?.memories_created ?? [];
  if (created.length === 0) {
    console.warn(
      `[xtrace] ingest succeeded but extracted 0 memories for "${topic.name}"`,
    );
    return undefined;
  }

  for (const memory of created) {
    const preview = memory.text?.slice(0, 160) ?? "(no text)";
    console.log(`[xtrace]   ${memory.type ?? "memory"}: ${preview}`);
  }

  return created[0]?.id;
}

/** Push incremental check findings to the same Xtrace conversation. */
export async function ingestCheckToXtrace(
  topic: Topic,
  updateSummary: string,
  claims: Array<{ text?: string }>,
  actorUserId?: string,
): Promise<string | undefined> {
  const messages = buildXtraceCheckMessages(topic, updateSummary, claims);
  if (messages.length === 0) return undefined;

  const userId = xtraceUserId(actorUserId, topic);
  const convId = xtraceConvId(topic);

  console.log(
    `[xtrace] check push ${messages.length} turn(s) (user_id=${userId}, conv_id=${convId})`,
  );

  const res = await fetch(`${BASE_URL}/v1/memories`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      wait: true,
      user_id: userId,
      conv_id: convId,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xtrace check ingest ${res.status}: ${text.slice(0, 300)}`);
  }

  let job = (await res.json()) as IngestJob;
  if (job.status === "pending" || job.status === "running") {
    if (!job.id) throw new Error("Xtrace returned pending job without id");
    job = await pollJob(job.id);
  }

  if (job.status === "failed") {
    throw new Error(job.error ?? "Xtrace check ingest failed");
  }

  const created = job.result?.memories_created ?? [];
  for (const memory of created) {
    const preview = memory.text?.slice(0, 160) ?? "(no text)";
    console.log(`[xtrace]   ${memory.type ?? "memory"}: ${preview}`);
  }

  return created[0]?.id;
}
