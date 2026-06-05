import dotenv from "dotenv";
dotenv.config({ quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import type { Job, Source, Topic } from "../src/lib/types.js";
import {
  fetchTopicMemoryContext,
  ingestCheckToXtrace,
} from "./xtrace.js";
import { assertRocketRideReachable } from "./run-initial-research-job.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PYTHON = process.env.PYTHON ?? "python3";
const CHECK_SCRIPT = path.join(ROOT, "scripts", "rocketride_check.py");

export type CheckSource = {
  id?: string;
  title?: string;
  url?: string;
  snippet?: string;
  type?: string;
  date?: string;
};

export type CheckResult = {
  topic?: string;
  has_new_info?: boolean;
  significance?: "none" | "low" | "high" | string;
  update_summary?: string;
  new_sources?: CheckSource[];
  new_claims?: Array<{ text?: string; source_ids?: string[] }>;
  reason_no_push?: string;
  error?: string;
};

export function buildCheckPrompt(
  topicName: string,
  xtraceMemory: string[],
  knownSources: Array<{ url: string; title: string | null }>,
): string {
  const memoryBlock =
    xtraceMemory.length > 0
      ? xtraceMemory.map((line) => `- ${line}`).join("\n")
      : "(none yet)";

  const sourcesBlock =
    knownSources.length > 0
      ? knownSources
          .map((s) => `- ${s.url}${s.title ? ` — ${s.title}` : ""}`)
          .join("\n")
      : "(none yet)";

  return [
    `TOPIC: ${topicName}`,
    "",
    "EXISTING XTRACE MEMORY (already stored — do not repeat as new):",
    memoryBlock,
    "",
    "KNOWN SOURCES (already saved — skip unless materially updated):",
    sourcesBlock,
    "",
    "TASK: Search for the latest developments on this topic. Compare against the memory and sources above.",
    "Return ONLY new information that is meaningfully different. If nothing new, set has_new_info to false and significance to none.",
  ].join("\n");
}

function shouldPushToXtrace(result: CheckResult, novelCount: number): boolean {
  if (!result.has_new_info) return false;
  if (result.significance === "none") return false;
  const hasClaims = (result.new_claims ?? []).some((c) => c.text?.trim());
  return novelCount > 0 || hasClaims || !!result.update_summary?.trim();
}

export async function runRocketRideCheck(prompt: string): Promise<CheckResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [CHECK_SCRIPT], {
      cwd: ROOT,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on("close", (code) => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
      try {
        const parsed = JSON.parse(line) as CheckResult;
        if (code !== 0 && !parsed.error) {
          parsed.error = stderr.trim() || `rocketride_check exited ${code}`;
        }
        resolve(parsed);
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`));
      }
    });
  });
}

async function fetchTopic(topicId: string): Promise<Topic | null> {
  const { data, error } = await db.from<Topic>("topics").select("*").eq("id", topicId).single();
  if (error) return null;
  return data as Topic;
}

async function fetchJob(jobId: string): Promise<Job | null> {
  const { data, error } = await db.from<Job>("jobs").select("*").eq("id", jobId).single();
  if (error) return null;
  return data as Job;
}

async function fetchSources(topicId: string): Promise<Source[]> {
  const { data } = await db
    .from<Source>("sources")
    .select("*")
    .eq("topic_id", topicId);
  return (data as Source[]) ?? [];
}

export async function runCheckResearchJob(input: {
  job_id: string;
  topic_id?: string;
  topic_name?: string;
  user_id?: string;
}): Promise<
  | { ok: true; novel_sources: number; pushed_xtrace: boolean }
  | { ok: false; error: string }
> {
  const job = await fetchJob(input.job_id);
  if (!job || job.type !== "check") {
    return { ok: false, error: "check job not found" };
  }
  if (job.status === "done") {
    return { ok: true, novel_sources: 0, pushed_xtrace: false };
  }

  const topic = await fetchTopic(job.topic_id);
  if (!topic) {
    return { ok: false, error: "topic not found" };
  }

  const topicName =
    input.topic_name ??
    (job.payload?.topic_name as string | undefined) ??
    topic.name;

  const jobUpdate = await db.from("jobs").update({ status: "running" }).eq("id", job.id);
  if (jobUpdate.error) {
    return { ok: false, error: (jobUpdate.error as Error).message };
  }

  console.log("[check] rocket ride:", topicName);

  try {
    await assertRocketRideReachable();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("jobs").update({
      status: "failed",
      result_summary: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { ok: false, error: message };
  }

  const existingSources = await fetchSources(topic.id);
  const knownUrls = new Set(
    existingSources.map((s) => s.url.trim().toLowerCase()).filter(Boolean),
  );

  let xtraceMemory: string[] = [];
  try {
    xtraceMemory = await fetchTopicMemoryContext(topic, input.user_id);
    console.log(`[check] xtrace context: ${xtraceMemory.length} belief(s)`);
  } catch (err) {
    console.warn(
      "[check] xtrace read failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const prompt = buildCheckPrompt(
    topicName,
    xtraceMemory,
    existingSources.map((s) => ({ url: s.url, title: s.title })),
  );

  let result: CheckResult;
  try {
    result = await runRocketRideCheck(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("jobs").update({
      status: "failed",
      result_summary: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { ok: false, error: message };
  }

  if (result.error) {
    await db.from("jobs").update({
      status: "failed",
      result_summary: result.error.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { ok: false, error: result.error };
  }

  let novelCount = 0;
  for (const src of result.new_sources ?? []) {
    if (!src.url) continue;
    const normalized = src.url.trim().toLowerCase();
    if (knownUrls.has(normalized)) continue;
    novelCount += 1;
    knownUrls.add(normalized);
    await db.from("sources").insert({
      topic_id: topic.id,
      url: src.url,
      title: src.title ?? null,
      added_by: "system",
      was_novel: true,
    });
  }

  const pushXtrace = shouldPushToXtrace(result, novelCount);
  let summary: string;

  if (!pushXtrace) {
    summary =
      result.reason_no_push?.trim() ||
      "No meaningful updates since last check.";
    console.log("[check] skipping xtrace push:", summary);
  } else {
    summary =
      result.update_summary?.trim() ||
      `Found ${novelCount} new source(s) for "${topicName}".`;
    try {
      const memoryId = await ingestCheckToXtrace(
        topic,
        summary,
        result.new_claims ?? [],
        input.user_id,
      );
      if (memoryId) {
        console.log("[xtrace] check ingested:", memoryId);
        await db.from("topics").update({ xtrace_memory_id: memoryId }).eq("id", topic.id);
      }
    } catch (err) {
      console.error(
        "[xtrace] check failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await db.from("jobs").update({
    status: "done",
    result_summary: summary.slice(0, 1000),
    finished_at: new Date().toISOString(),
  }).eq("id", job.id);

  await db.from("topics").update({
    last_checked_at: new Date().toISOString(),
  }).eq("id", topic.id);

  console.log(
    "[check] done:",
    job.id,
    novelCount,
    "novel sources, xtrace=",
    pushXtrace,
  );

  return { ok: true, novel_sources: novelCount, pushed_xtrace: pushXtrace };
}
