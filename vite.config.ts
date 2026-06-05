import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { localResearchPlugin } from "./vite-plugin-local-research";

export default defineConfig({
  plugins: [react(), localResearchPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: { outDir: "dist" },
  resolve: {
    alias: {
      "node:crypto": path.resolve("./src/shims/crypto.ts"),
    },
  },
});
