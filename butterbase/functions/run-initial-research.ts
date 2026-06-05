import { runTopicResearch, type ResearchResult } from "./_shared.ts";

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

async function markJobFailed(
  ctx: FunctionContext,
  jobId: string,
  topicId: string,
  message: string,
): Promise<void> {
  await ctx.db.query(
    `UPDATE jobs
     SET status = 'failed', result_summary = $2, finished_at = now()
     WHERE id = $1`,
    [jobId, message.slice(0, 1000)],
  );
  await ctx.db.query(`UPDATE topics SET status = 'error' WHERE id = $1`, [topicId]);
}

async function saveResearch(
  ctx: FunctionContext,
  jobId: string,
  topicId: string,
  topicName: string,
  result: ResearchResult,
): Promise<void> {
  const sources = result.sources ?? [];
  for (const src of sources) {
    if (!src.url) continue;
    await ctx.db.query(
      `INSERT INTO sources (topic_id, url, title, added_by, was_novel)
       VALUES ($1, $2, $3, 'system', true)`,
      [topicId, src.url, src.title ?? null],
    );
  }

  const summary =
    result.summary ??
    `Found ${sources.length} source(s) for "${topicName}".`;

  await ctx.db.query(
    `UPDATE jobs
     SET status = 'done', result_summary = $2, finished_at = now()
     WHERE id = $1`,
    [jobId, summary.slice(0, 1000)],
  );
  await ctx.db.query(
    `UPDATE topics SET status = 'ready', last_checked_at = now() WHERE id = $1`,
    [topicId],
  );
}

async function processJob(
  ctx: FunctionContext,
  job: JobRow,
  topicName: string,
): Promise<void> {
  await ctx.db.query(`UPDATE jobs SET status = 'running' WHERE id = $1`, [job.id]);

  try {
    const result = await runTopicResearch(topicName, ctx.env);
    await saveResearch(ctx, job.id, job.topic_id, topicName, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`run-initial-research failed for job ${job.id}`, message);
    await markJobFailed(ctx, job.id, job.topic_id, message);
    throw error;
  }
}

export default async function handler(
  req: Request,
  ctx: FunctionContext,
): Promise<Response> {
  try {
    const body = req.method === "POST" ? await req.json() : {};
    const jobId = (body as { job_id?: string }).job_id?.trim();
    const topicId = (body as { topic_id?: string }).topic_id?.trim();
    const topicName = (body as { topic_name?: string }).topic_name?.trim();

    let job: JobRow | null = null;

    if (jobId) {
      const res = await ctx.db.query(
        `SELECT id, topic_id, status, payload
         FROM jobs
         WHERE id = $1 AND type = 'initial_research'`,
        [jobId],
      );
      job = (res.rows[0] as JobRow | undefined) ?? null;
    } else if (topicId) {
      const res = await ctx.db.query(
        `SELECT id, topic_id, status, payload
         FROM jobs
         WHERE topic_id = $1 AND type = 'initial_research'
         ORDER BY triggered_at DESC
         LIMIT 1`,
        [topicId],
      );
      job = (res.rows[0] as JobRow | undefined) ?? null;
    }

    if (!job) {
      return new Response(JSON.stringify({ error: "job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (job.status === "done") {
      return new Response(JSON.stringify({ ok: true, job_id: job.id, status: "done" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const resolvedTopicName =
      topicName ?? job.payload?.topic_name ?? "Untitled topic";

    await processJob(ctx, job, resolvedTopicName);

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: job.id,
        topic_id: job.topic_id,
        status: "done",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
