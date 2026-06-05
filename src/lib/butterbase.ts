import { createClient } from "@butterbase/sdk";

export const db = createClient({
  appId: import.meta.env.VITE_BUTTERBASE_APP_ID as string,
  apiUrl: import.meta.env.VITE_BUTTERBASE_API_URL as string,
  anonKey: import.meta.env.VITE_BUTTERBASE_SERVICE_KEY as string,
});
