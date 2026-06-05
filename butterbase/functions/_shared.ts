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
