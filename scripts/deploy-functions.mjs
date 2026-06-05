import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { runCheckResearch, runInitialResearch } from "./bundle-function.mjs";

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

function request(method, url, apiKey, body) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deployFunction(appId, apiKey, name, filePath, trigger, extra = {}) {
  const code = fs.readFileSync(filePath, "utf8");
  const url = new URL(`https://api.butterbase.ai/v1/${appId}/functions`);
  const result = await request("POST", url, apiKey, {
    name,
    code,
    description: extra.description,
    trigger,
    timeoutMs: extra.timeoutMs ?? 300000,
    memoryLimitMb: extra.memoryLimitMb ?? 256,
    envVars: extra.envVars,
  });
  console.log(`${name}: HTTP ${result.status}`);
  if (result.status >= 400) {
    console.error(result.body);
    throw new Error(`Deploy failed for ${name}`);
  }
  return result;
}

const root = path.resolve(import.meta.dirname, "..");
const env = {
  ...loadEnv(path.join(root, ".env")),
  ...loadEnv(path.join(root, ".env.local")),
};

const appId = env.BUTTERBASE_APP_ID ?? env.VITE_BUTTERBASE_APP_ID;
const apiKey =
  env.BUTTERBASE_SERVICE_KEY ??
  env.VITE_BUTTERBASE_SERVICE_KEY ??
  env.BUTTERBASE_API_KEY;

if (!appId || !apiKey) {
  console.error("Need BUTTERBASE_APP_ID and BUTTERBASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const functionEnv = {
  ROCKETRIDE_OPENAI_KEY: env.ROCKETRIDE_OPENAI_KEY ?? "",
  ROCKETRIDE_EXA_KEY: env.ROCKETRIDE_EXA_KEY ?? "",
  XTRACE_API_KEY: env.XTRACE_API_KEY ?? "",
  XTRACE_ORG_ID: env.XTRACE_ORG_ID ?? "",
  XTRACE_API_URL: env.XTRACE_API_URL ?? "",
  XTRACE_USER_ID: env.XTRACE_USER_ID ?? "",
};

await deployFunction(appId, apiKey, "run-initial-research", runInitialResearch, {
  type: "http",
  config: { method: "POST", auth: "none" },
}, {
  description: "Process initial_research jobs from the UI",
  envVars: functionEnv,
});

await deployFunction(appId, apiKey, "run-check-research", runCheckResearch, {
  type: "http",
  config: { method: "POST", auth: "none" },
}, {
  description: "Process check jobs (latest info) from the UI",
  envVars: functionEnv,
});

console.log("Deployed run-initial-research");
console.log(`POST https://api.butterbase.ai/v1/${appId}/fn/run-initial-research`);
console.log("Deployed run-check-research");
console.log(`POST https://api.butterbase.ai/v1/${appId}/fn/run-check-research`);
