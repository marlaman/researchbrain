import dotenv from "dotenv";
import { createClient } from "@butterbase/sdk";

dotenv.config({ quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

const appId =
  process.env.BUTTERBASE_APP_ID ?? process.env.VITE_BUTTERBASE_APP_ID;
const apiUrl =
  process.env.BUTTERBASE_API_URL ?? process.env.VITE_BUTTERBASE_API_URL;
const anonKey =
  process.env.BUTTERBASE_SERVICE_KEY ??
  process.env.BUTTERBASE_ANON_KEY ??
  process.env.VITE_BUTTERBASE_SERVICE_KEY;

if (!appId) throw new Error("BUTTERBASE_APP_ID (or VITE_BUTTERBASE_APP_ID) is required");
if (!apiUrl) throw new Error("BUTTERBASE_API_URL (or VITE_BUTTERBASE_API_URL) is required");
if (!anonKey) throw new Error("BUTTERBASE_SERVICE_KEY (or VITE_BUTTERBASE_SERVICE_KEY) is required");

export const db = createClient({ appId, apiUrl, anonKey });
