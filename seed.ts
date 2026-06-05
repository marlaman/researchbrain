import "dotenv/config";
import { db } from "./server/db.js";

async function insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.from(table).insert(row);
  if (error) throw new Error(`${table} insert failed: ${(error as Error).message}`);
  return data as T;
}

async function seed() {
  console.log("Seeding…");

  const userA = await insert<{ id: string }>("users", {
    slack_user_id: "U0123SLACK",
    discord_user_id: null,
    notify_channel: "slack",
  });
  const userB = await insert<{ id: string }>("users", {
    slack_user_id: null,
    discord_user_id: "1234567890",
    notify_channel: "discord",
  });

  const topicA = await insert<{ id: string }>("topics", {
    user_id: userA.id,
    name: "LLM inference optimizations",
    status: "ready",
    is_subscribed: true,
  });

  await insert("sources", {
    topic_id: topicA.id,
    url: "https://arxiv.org/abs/2402.00001",
    title: "FlashAttention-3",
    added_by: "system",
    was_novel: true,
  });

  console.log("Done. users=2 topics=1");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
