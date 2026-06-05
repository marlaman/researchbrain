import dotenv from "dotenv";
dotenv.config({ quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import type { Job, Topic } from "../src/lib/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PYTHON = process.env.PYTHON ?? "python3";
const ROCKETRIDE_SCRIPT = path.join(ROOT, "scripts", "rocketride_run.py");
const ROCKETRIDE_URI = process.env.ROCKETRIDE_URI ?? "http://127.0.0.1:5565";

export type ResearchSource = {
  title?: string;
  url?: string;
  snippet?: string;
};

export type ResearchResult = {
  summary?: string;
  sources?: ResearchSource[];
  error?: string;
};

/** Best-effort probe — Rocket Ride speaks WebSocket, not HTTP, so a bare fetch often lies. */
export async function assertRocketRideReachable(): Promise<void> {
  const url = new URL(ROCKETRIDE_URI);
  const port = Number(url.port || 5565);
  const host = url.hostname || "127.0.0.1";

  const reachable = await new Promise<boolean>((resolve) => {
    import("node:net").then(({ connect }) => {
      const socket = connect({ host, port }, () => {
        socket.end();
        resolve(true);
      });
      socket.setTimeout(2000);
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => resolve(false));
    });
  });

  if (!reachable) {
    throw new Error(
      `Cannot reach Rocket Ride engine at ${host}:${port}. ` +
        `Copy Local URL + Public Authorization Key from Rocket Ride → Endpoint Configuration into .env.local ` +
        `(ROCKETRIDE_URI + ROCKETRIDE_APIKEY). Default port 5565 is often wrong — yours may differ.`,
    );
  }
}

export async function runRocketRide(topicName: string): Promise<ResearchResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [ROCKETRIDE_SCRIPT, topicName], {
      cwd: ROOT,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("close", (code) => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
      try {
        const parsed = JSON.parse(line) as ResearchResult;
        if (code !== 0 && !parsed.error) {
          parsed.error = stderr.trim() || `rocketride_run exited ${code}`;
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

export async function runInitialResearchJob(input: {
  job_id: string;
  topic_id?: string;
  topic_name?: string;
}): Promise<{ ok: true; sources: number } | { ok: false; error: string }> {
  const job = await fetchJob(input.job_id);
  if (!job || job.type !== "initial_research") {
    return { ok: false, error: "initial_research job not found" };
  }
  if (job.status === "done") {
    return { ok: true, sources: 0 };
  }

  const topic = await fetchTopic(job.topic_id);
  if (!topic) {
    return { ok: false, error: "topic not found" };
  }

  const topicName =
    input.topic_name ??
    (job.payload?.topic_name as string | undefined) ??
    topic.name;

  await db.from("jobs").update({ status: "running" }).eq("id", job.id);

  try {
    await assertRocketRideReachable();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("jobs").update({
      status: "failed",
      result_summary: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    await db.from("topics").update({ status: "error" }).eq("id", topic.id);
    return { ok: false, error: message };
  }

  let result: ResearchResult;
  try {
    result = await runRocketRide(topicName);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("jobs").update({
      status: "failed",
      result_summary: message.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    await db.from("topics").update({ status: "error" }).eq("id", topic.id);
    return { ok: false, error: message };
  }

  if (result.error) {
    await db.from("jobs").update({
      status: "failed",
      result_summary: result.error.slice(0, 500),
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    await db.from("topics").update({ status: "error" }).eq("id", topic.id);
    return { ok: false, error: result.error };
  }

  const sources = result.sources ?? [];
  for (const src of sources) {
    if (!src.url) continue;
    await db.from("sources").insert({
      topic_id: topic.id,
      url: src.url,
      title: src.title ?? null,
      added_by: "system",
      was_novel: true,
    });
  }

  const summary =
    result.summary ?? `Found ${sources.length} source(s) for "${topicName}".`;

  await db.from("jobs").update({
    status: "done",
    result_summary: summary.slice(0, 1000),
    finished_at: new Date().toISOString(),
  }).eq("id", job.id);

  await db.from("topics").update({
    status: "ready",
    last_checked_at: new Date().toISOString(),
  }).eq("id", topic.id);

  return { ok: true, sources: sources.length };
}
