import { fetchTopicMemoryContext, ingestCheckToXtrace, runTopicCheck, shouldPushCheckToXtrace, type CheckResult } from "./_shared.ts";

type FunctionContext = {
  env: Record<string, string | undefined>;
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  waitUntil?: (promise: Promise<unknown>) => void;
};

type JobRow = {
  id: string;
  topic_id: string;
  status: string;
  payload: { topic_name?: string } | null;
};

type SourceRow = {
  url: string;
  title: string | null;
};

async function markJobFailed(
  ctx: FunctionContext,
  jobId: string,
  message: string,
): Promise<void> {
  await ctx.db.query(
    `UPDATE jobs
     SET status = 'failed', result_summary = $2, finished_at = now()
     WHERE id = $1`,
    [jobId, message.slice(0, 1000)],
  );
}

async function processJob(
  ctx: FunctionContext,
  job: JobRow,
  topicName: string,
): Promise<{ novel_sources: number; pushed_xtrace: boolean }> {
  await ctx.db.query(`UPDATE jobs SET status = 'running' WHERE id = $1`, [job.id]);

  const sourcesRes = await ctx.db.query(
    `SELECT url, title FROM sources WHERE topic_id = $1`,
    [job.topic_id],
  );
  const existingSources = (sourcesRes.rows as SourceRow[]) ?? [];
  const knownUrls = new Set(
    existingSources.map((s) => s.url.trim().toLowerCase()).filter(Boolean),
  );

  let xtraceMemory: string[] = [];
  if (ctx.env.XTRACE_API_KEY && ctx.env.XTRACE_ORG_ID) {
    try {
      xtraceMemory = await fetchTopicMemoryContext(topicName, ctx.env);
    } catch (err) {
      console.warn(
        "xtrace read failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const result: CheckResult = await runTopicCheck(
    topicName,
    xtraceMemory,
    existingSources,
    ctx.env,
  );

  let novelCount = 0;
  for (const src of result.new_sources ?? []) {
    if (!src.url) continue;
    const normalized = src.url.trim().toLowerCase();
    if (knownUrls.has(normalized)) continue;
    novelCount += 1;
    knownUrls.add(normalized);
    await ctx.db.query(
      `INSERT INTO sources (topic_id, url, title, added_by, was_novel)
       VALUES ($1, $2, $3, 'system', true)`,
      [job.topic_id, src.url, src.title ?? null],
    );
  }

  const pushXtrace = shouldPushCheckToXtrace(result, novelCount);
  let summary: string;

  if (!pushXtrace) {
    summary =
      result.reason_no_push?.trim() ||
      "No meaningful updates since last check.";
  } else {
    summary =
      result.update_summary?.trim() ||
      `Found ${novelCount} new source(s) for "${topicName}".`;

    if (ctx.env.XTRACE_API_KEY && ctx.env.XTRACE_ORG_ID) {
      try {
        const memoryId = await ingestCheckToXtrace(
          topicName,
          summary,
          result.new_claims ?? [],
          ctx.env,
        );
        if (memoryId) {
          await ctx.db.query(
            `UPDATE topics SET xtrace_memory_id = $2 WHERE id = $1`,
            [job.topic_id, memoryId],
          );
        }
      } catch (err) {
        console.error(
          "xtrace check push failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  await ctx.db.query(
    `UPDATE jobs
     SET status = 'done', result_summary = $2, finished_at = now()
     WHERE id = $1`,
    [job.id, summary.slice(0, 1000)],
  );
  await ctx.db.query(
    `UPDATE topics SET last_checked_at = now() WHERE id = $1`,
    [job.topic_id],
  );

  return { novel_sources: novelCount, pushed_xtrace: pushXtrace };
}

export default async function handler(
  req: Request,
  ctx: FunctionContext,
): Promise<Response> {
  let activeJobId: string | undefined;
  try {
    const body = req.method === "POST" ? await req.json() : {};
    const jobId = (body as { job_id?: string }).job_id?.trim();
    activeJobId = jobId;
    const topicId = (body as { topic_id?: string }).topic_id?.trim();
    const topicName = (body as { topic_name?: string }).topic_name?.trim();

    let job: JobRow | null = null;

    if (jobId) {
      const res = await ctx.db.query(
        `SELECT id, topic_id, status, payload
         FROM jobs
         WHERE id = $1 AND type = 'check'`,
        [jobId],
      );
      job = (res.rows[0] as JobRow | undefined) ?? null;
    } else if (topicId) {
      const res = await ctx.db.query(
        `SELECT id, topic_id, status, payload
         FROM jobs
         WHERE topic_id = $1 AND type = 'check'
         ORDER BY triggered_at DESC
         LIMIT 1`,
        [topicId],
      );
      job = (res.rows[0] as JobRow | undefined) ?? null;
    }

    if (!job) {
      return new Response(JSON.stringify({ error: "check job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (job.status === "done") {
      return new Response(
        JSON.stringify({ ok: true, job_id: job.id, status: "done" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const resolvedTopicName =
      topicName ?? job.payload?.topic_name ?? "Untitled topic";

    const outcome = await processJob(ctx, job, resolvedTopicName);

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: job.id,
        topic_id: job.topic_id,
        status: "done",
        novel_sources: outcome.novel_sources,
        pushed_xtrace: outcome.pushed_xtrace,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (activeJobId) {
      await markJobFailed(ctx, activeJobId, message);
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
