export type ResearchSource = {
  id?: string;
  title?: string;
  url?: string;
  snippet?: string;
  type?: string;
  date?: string;
};

export type ResearchResult = {
  topic?: string;
  summary?: string;
  sources?: ResearchSource[];
  open_questions?: string[];
};

export function parseResearchAnswer(raw: unknown): ResearchResult {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ResearchResult;
  }
  const text = String(raw).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate) as ResearchResult;
  } catch {
    return { summary: text };
  }
}

async function fetchArxivSources(topic: string): Promise<ResearchSource[]> {
  const q = encodeURIComponent(topic);
  const url = `https://export.arxiv.org/api/query?search_query=all:${q}&max_results=8&sortBy=submittedDate`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const xml = await res.text();
  const entries = xml.split("<entry>").slice(1);
  const sources: ResearchSource[] = [];

  for (const entry of entries) {
    const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim();
    const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim();
    const id = entry.match(/<id>([^<]+)<\/id>/)?.[1]?.trim();
    const absUrl = id?.includes("arxiv.org") ? id.replace("http://", "https://") : null;
    if (!absUrl) continue;
    sources.push({
      id: `arxiv-${sources.length + 1}`,
      title: title ?? "arXiv paper",
      url: absUrl,
      snippet: summary?.slice(0, 400) ?? "",
      type: "arxiv",
    });
  }
  return sources;
}

async function fetchExaSources(
  topic: string,
  apiKey: string | undefined,
): Promise<ResearchSource[]> {
  if (!apiKey) return [];
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: `${topic} research`,
      numResults: 8,
      useAutoprompt: true,
      type: "auto",
      contents: { text: { maxCharacters: 500 } },
    }),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r, i) => ({
      id: `exa-${i + 1}`,
      title: r.title ?? r.url!,
      url: r.url!,
      snippet: r.text?.slice(0, 400) ?? "",
      type: "web",
    }));
}

async function synthesizeWithOpenAI(
  topic: string,
  seedSources: ResearchSource[],
  apiKey: string,
): Promise<ResearchResult> {
  const sourceBlock = seedSources
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet ?? ""}`,
    )
    .join("\n\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a research assistant. Return JSON only with keys: topic, summary, sources (array of {id,title,url,type,snippet}), open_questions. Only use URLs from the provided source list — never invent links.",
        },
        {
          role: "user",
          content: `Topic: ${topic}\n\nSources:\n${sourceBlock || "(no sources found)"}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return parseResearchAnswer(content);
}

export async function runTopicResearch(
  topic: string,
  env: Record<string, string | undefined>,
): Promise<ResearchResult> {
  const openaiKey = env.ROCKETRIDE_OPENAI_KEY ?? env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("Missing ROCKETRIDE_OPENAI_KEY");
  }

  const arxiv = await fetchArxivSources(topic);
  const exa = await fetchExaSources(topic, env.ROCKETRIDE_EXA_KEY);
  const merged = [...arxiv, ...exa];
  const uniqueByUrl = new Map<string, ResearchSource>();
  for (const src of merged) {
    if (src.url && !uniqueByUrl.has(src.url)) uniqueByUrl.set(src.url, src);
  }
  const seedSources = [...uniqueByUrl.values()];

  const result = await synthesizeWithOpenAI(topic, seedSources, openaiKey);
  if (!result.sources?.length && seedSources.length) {
    result.sources = seedSources;
  }
  result.topic = result.topic ?? topic;
  return result;
}

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
};

export function parseCheckAnswer(raw: unknown): CheckResult {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as CheckResult;
  }
  const text = String(raw).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate) as CheckResult;
  } catch {
    return { reason_no_push: text, has_new_info: false, significance: "none" };
  }
}

export function buildCheckPrompt(
  topicName: string,
  xtraceMemory: string[],
  knownSources: Array<{ url: string; title: string | null }>,
  seedSources: ResearchSource[],
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

  const freshBlock =
    seedSources.length > 0
      ? seedSources
          .map(
            (s, i) =>
              `[${i + 1}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet ?? ""}`,
          )
          .join("\n\n")
      : "(no fresh search results)";

  return [
    `TOPIC: ${topicName}`,
    "",
    "EXISTING XTRACE MEMORY (already stored — do not repeat as new):",
    memoryBlock,
    "",
    "KNOWN SOURCES (already saved — skip unless materially updated):",
    sourcesBlock,
    "",
    "FRESH SEARCH RESULTS (candidate new material):",
    freshBlock,
    "",
    "TASK: Compare fresh results against memory and known sources. Return ONLY genuinely new developments.",
    "If nothing meaningfully new, set has_new_info to false and significance to none.",
  ].join("\n");
}

function xtraceBaseUrl(env: Record<string, string | undefined>): string {
  return env.XTRACE_API_URL ?? "https://api.production.xtrace.ai";
}

function xtraceHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const apiKey = env.XTRACE_API_KEY;
  const orgId = env.XTRACE_ORG_ID;
  if (!apiKey || !orgId) {
    throw new Error("Missing XTRACE_API_KEY or XTRACE_ORG_ID");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Org-Id": orgId,
    "Content-Type": "application/json",
  };
}

function resolveXtraceUserId(
  actorUserId: string | undefined,
  env: Record<string, string | undefined>,
): string {
  if (!actorUserId?.trim()) {
    throw new Error("user_id is required for Xtrace (logged-in user performing the action)");
  }
  return actorUserId.trim();
}

function xtraceConvId(topicName: string): string {
  return `topic-${topicName.trim()}`;
}

export async function fetchTopicMemoryContext(
  topicName: string,
  actorUserId: string,
  env: Record<string, string | undefined>,
): Promise<string[]> {
  const userId = resolveXtraceUserId(actorUserId, env);
  const convId = xtraceConvId(topicName);
  const lines: string[] = [];
  let cursor: string | null = null;

  for (;;) {
    const url = new URL(`${xtraceBaseUrl(env)}/v1/memories`);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("conv_id", convId);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers: xtraceHeaders(env) });
    if (!res.ok) break;

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

async function pollXtraceJob(
  jobId: string,
  env: Record<string, string | undefined>,
): Promise<{ status?: string; result?: { memories_created?: Array<{ id?: string }> }; error?: string | null }> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${xtraceBaseUrl(env)}/v1/memories/jobs/${jobId}`, {
      headers: xtraceHeaders(env),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Xtrace job poll ${res.status}: ${text.slice(0, 300)}`);
    }
    const job = (await res.json()) as {
      status?: string;
      result?: { memories_created?: Array<{ id?: string }> };
      error?: string | null;
    };
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Xtrace ingest timed out");
}

function buildXtraceResearchMessages(
  topicName: string,
  result: ResearchResult,
): Array<{ role: "user"; content: string }> {
  const name = topicName.trim();
  const messages: Array<{ role: "user"; content: string }> = [
    { role: "user", content: `I love researching ${name}.` },
  ];

  const summary = result.summary?.trim();
  if (summary) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, ${summary}`,
    });
  }

  const sources = (result.sources ?? []).filter((s) => s.title?.trim() || s.url);
  for (const src of sources.slice(0, 5)) {
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

export async function ingestResearchToXtrace(
  topicName: string,
  actorUserId: string,
  result: ResearchResult,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  if (!env.XTRACE_API_KEY || !env.XTRACE_ORG_ID) return undefined;

  const messages = buildXtraceResearchMessages(topicName, result);
  const res = await fetch(`${xtraceBaseUrl(env)}/v1/memories`, {
    method: "POST",
    headers: xtraceHeaders(env),
    body: JSON.stringify({
      wait: true,
      user_id: resolveXtraceUserId(actorUserId, env),
      conv_id: xtraceConvId(topicName),
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xtrace ingest ${res.status}: ${text.slice(0, 300)}`);
  }

  let job = (await res.json()) as {
    id?: string;
    status?: string;
    result?: { memories_created?: Array<{ id?: string }> };
    error?: string | null;
  };

  if (job.status === "pending" || job.status === "running") {
    if (!job.id) throw new Error("Xtrace returned pending job without id");
    job = await pollXtraceJob(job.id, env);
  }

  if (job.status === "failed") {
    throw new Error(job.error ?? "Xtrace ingest failed");
  }

  return job.result?.memories_created?.[0]?.id;
}

export async function ingestCheckToXtrace(
  topicName: string,
  actorUserId: string,
  updateSummary: string,
  claims: Array<{ text?: string }>,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  const name = topicName.trim();
  const messages: Array<{ role: "user"; content: string }> = [];

  const summary = updateSummary.trim();
  if (summary) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, latest check update: ${summary}`,
    });
  }

  for (const claim of claims.filter((c) => c.text?.trim()).slice(0, 12)) {
    messages.push({
      role: "user",
      content: `Regarding ${name}, new finding: ${claim.text!.trim()}`,
    });
  }

  if (messages.length === 0) return undefined;

  const res = await fetch(`${xtraceBaseUrl(env)}/v1/memories`, {
    method: "POST",
    headers: xtraceHeaders(env),
    body: JSON.stringify({
      wait: true,
      user_id: resolveXtraceUserId(actorUserId, env),
      conv_id: xtraceConvId(name),
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xtrace check ingest ${res.status}: ${text.slice(0, 300)}`);
  }

  let job = (await res.json()) as {
    id?: string;
    status?: string;
    result?: { memories_created?: Array<{ id?: string }> };
    error?: string | null;
  };

  if (job.status === "pending" || job.status === "running") {
    if (!job.id) throw new Error("Xtrace returned pending job without id");
    job = await pollXtraceJob(job.id, env);
  }

  if (job.status === "failed") {
    throw new Error(job.error ?? "Xtrace check ingest failed");
  }

  return job.result?.memories_created?.[0]?.id;
}

async function synthesizeCheckWithOpenAI(
  prompt: string,
  apiKey: string,
): Promise<CheckResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an incremental research checker. Return JSON only with keys: topic, has_new_info (boolean), significance (none|low|high), update_summary, new_sources (array of {id,title,url,type,snippet,date}), new_claims (array of {text,source_ids}), reason_no_push. Only include URLs from FRESH SEARCH RESULTS that are not in KNOWN SOURCES. Never invent URLs.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return parseCheckAnswer(content);
}

export function shouldPushCheckToXtrace(
  result: CheckResult,
  novelCount: number,
): boolean {
  if (!result.has_new_info) return false;
  if (result.significance === "none") return false;
  const hasClaims = (result.new_claims ?? []).some((c) => c.text?.trim());
  return novelCount > 0 || hasClaims || !!result.update_summary?.trim();
}

export async function runTopicCheck(
  topicName: string,
  xtraceMemory: string[],
  knownSources: Array<{ url: string; title: string | null }>,
  env: Record<string, string | undefined>,
): Promise<CheckResult> {
  const openaiKey = env.ROCKETRIDE_OPENAI_KEY ?? env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("Missing ROCKETRIDE_OPENAI_KEY");
  }

  const searchQuery = `${topicName} latest research news 2025 2026`;
  const arxiv = await fetchArxivSources(searchQuery);
  const exa = await fetchExaSources(searchQuery, env.ROCKETRIDE_EXA_KEY);
  const merged = [...arxiv, ...exa];
  const knownSet = new Set(
    knownSources.map((s) => s.url.trim().toLowerCase()).filter(Boolean),
  );
  const seedSources = merged.filter(
    (s) => s.url && !knownSet.has(s.url.trim().toLowerCase()),
  );

  const prompt = buildCheckPrompt(
    topicName,
    xtraceMemory,
    knownSources,
    seedSources,
  );
  const result = await synthesizeCheckWithOpenAI(prompt, openaiKey);
  result.topic = result.topic ?? topicName;
  return result;
}
