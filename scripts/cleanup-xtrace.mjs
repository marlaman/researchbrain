#!/usr/bin/env node
/**
 * Delete Xtrace memories (facts/episodes/artifacts) for app-related user_ids.
 * Usage: node scripts/cleanup-xtrace.mjs
 *
 * Episode *session rows* in Memory Hub are not on the Memory API — no API/UI delete today.
 */

import dotenv from "dotenv";
import { createClient } from "@butterbase/sdk";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

const BASE =
  process.env.XTRACE_API_URL ?? "https://api.production.xtrace.ai";
const API_KEY = process.env.XTRACE_API_KEY;
const ORG_ID = process.env.XTRACE_ORG_ID;

if (!API_KEY || !ORG_ID) {
  console.error("Set XTRACE_API_KEY and XTRACE_ORG_ID in .env.local");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "X-Org-Id": ORG_ID,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listMemories(userId, type) {
  const ids = [];
  let cursor = null;
  for (;;) {
    const url = new URL(`${BASE}/v1/memories`);
    url.searchParams.set("user_id", userId);
    url.searchParams.set("limit", "100");
    if (type) url.searchParams.set("type", type);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, { headers });
    if (res.status === 429) {
      await sleep(3000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      console.warn(`skip list user_id=${userId} type=${type ?? "all"}: ${res.status} ${text.slice(0, 120)}`);
      return ids;
    }
    const body = await res.json();
    for (const row of body.data ?? []) {
      if (row.id) ids.push(row);
    }
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
    await sleep(300);
  }
  return ids;
}

async function deleteMemory(id) {
  const res = await fetch(`${BASE}/v1/memories/${id}`, {
    method: "DELETE",
    headers,
  });
  if (res.status === 429) {
    await sleep(3000);
    return deleteMemory(id);
  }
  if (res.status !== 204 && !res.ok) {
    const text = await res.text();
    throw new Error(`delete ${id}: ${res.status} ${text.slice(0, 200)}`);
  }
}

async function collectUserIds() {
  const userIds = new Set(["test", "sky", "research-brain"]);
  const appId =
    process.env.BUTTERBASE_APP_ID ?? process.env.VITE_BUTTERBASE_APP_ID;
  const apiUrl =
    process.env.BUTTERBASE_API_URL ?? process.env.VITE_BUTTERBASE_API_URL;
  const key =
    process.env.BUTTERBASE_SERVICE_KEY ??
    process.env.VITE_BUTTERBASE_SERVICE_KEY;

  if (appId && apiUrl && key) {
    const db = createClient({ appId, apiUrl, anonKey: key });
    const { data, error } = await db.from("topics").select("name,user_id");
    if (!error) {
      for (const row of data ?? []) {
        if (row.name) userIds.add(String(row.name).trim());
        if (row.user_id) userIds.add(String(row.user_id).trim());
      }
    }
  }
  return [...userIds].filter(Boolean);
}

async function main() {
  const userIds = await collectUserIds();
  const seen = new Set();
  let deleted = 0;

  for (const userId of userIds) {
    for (const type of [undefined, "fact", "episode", "artifact"]) {
      const rows = await listMemories(userId, type);
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        await deleteMemory(row.id);
        deleted += 1;
        console.log(`deleted ${row.type} ${row.id} (user=${row.user_id})`);
        await sleep(200);
      }
      await sleep(300);
    }
  }

  if (deleted === 0) {
    console.log("No memories on the Memory API.");
    console.log("Hub Episodes tab rows still need Xtrace to add delete/purge.");
  } else {
    console.log(`Done. Deleted ${deleted} memory row(s).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
