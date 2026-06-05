export interface User {
  id: string;
  slack_user_id: string | null;
  discord_user_id: string | null;
  notify_channel: "slack" | "discord";
  created_at: string;
}

export interface Topic {
  id: string;
  user_id: string;
  name: string;
  xtrace_memory_id: string | null;
  status: "building" | "ready" | "error";
  is_subscribed: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  topic_id: string;
  type: "initial_research" | "link" | "check";
  status: "queued" | "running" | "done" | "failed";
  payload: Record<string, unknown> | null;
  result_summary: string | null;
  triggered_at: string;
  finished_at: string | null;
}

export interface Source {
  id: string;
  topic_id: string;
  url: string;
  title: string | null;
  added_by: "system" | "user";
  was_novel: boolean;
  added_at: string;
}
