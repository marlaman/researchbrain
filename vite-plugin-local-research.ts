import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function localResearchPlugin(): Plugin {
  return {
    name: "local-research-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (path !== "/api/run-initial-research" || req.method !== "POST") {
          next();
          return;
        }

        console.log("[research] POST /api/run-initial-research");

        try {
          // Ensure env is loaded before dynamic import (Vite middleware cwd = project root)
          const dotenv = await import("dotenv");
          dotenv.config({ path: ".env.local", override: true, quiet: true });

          const body = (await readJsonBody(req)) as {
            job_id?: string;
            topic_id?: string;
            topic_name?: string;
          };

          if (!body.job_id) {
            sendJson(res, 400, { error: "job_id is required" });
            return;
          }

          const { runInitialResearchJob } = await import("./server/run-initial-research-job.ts");
          const result = await runInitialResearchJob({
            job_id: body.job_id,
            topic_id: body.topic_id,
            topic_name: body.topic_name,
          });

          if (!result.ok) {
            console.error("[research] failed:", result.error);
            sendJson(res, 500, { error: result.error });
            return;
          }

          console.log("[research] done:", body.job_id, result.sources, "sources");
          sendJson(res, 200, {
            ok: true,
            job_id: body.job_id,
            sources: result.sources,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[research] error:", message);
          sendJson(res, 500, { error: message });
        }
      });
    },
  };
}
