import { db } from "./butterbase";

export type TriggerResearchInput = {
  job_id: string;
  topic_id: string;
  topic_name: string;
};

/** Dev: Vite → local Rocket Ride. Prod: Butterbase cloud function. */
export async function triggerInitialResearch(
  input: TriggerResearchInput,
): Promise<{ error?: string }> {
  if (import.meta.env.DEV) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const res = await fetch("/api/run-initial-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        return {
          error:
            "Local API returned a non-JSON response. Use http://localhost:5173 (npm run dev) — kill any other dev servers first.",
        };
      }

      if (!res.ok) {
        return { error: data.error ?? `HTTP ${res.status}` };
      }
      return {};
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { error: "Research timed out after 10 minutes." };
      }
      return {
        error:
          err instanceof Error
            ? err.message
            : "Failed to reach local API. Is npm run dev running on port 5173?",
      };
    }
  }

  const { error } = await db.functions.invoke("run-initial-research", {
    method: "POST",
    body: input,
  });
  return { error: error ? (error as Error).message : undefined };
}

/** Dev: Vite → local Rocket Ride check pipe. Prod: Butterbase cloud function. */
export async function triggerCheckResearch(
  input: TriggerResearchInput,
): Promise<{ error?: string }> {
  if (import.meta.env.DEV) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
      const res = await fetch("/api/run-check-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      let data: { error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        return {
          error:
            "Local API returned a non-JSON response. Is npm run dev running?",
        };
      }

      if (!res.ok) {
        return { error: data.error ?? `HTTP ${res.status}` };
      }
      return {};
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { error: "Check timed out after 10 minutes." };
      }
      return {
        error:
          err instanceof Error
            ? err.message
            : "Failed to reach local check API.",
      };
    }
  }

  const { error } = await db.functions.invoke("run-check-research", {
    method: "POST",
    body: input,
  });
  return { error: error ? (error as Error).message : undefined };
}
