import react from "@vitejs/plugin-react";
import { cwd } from "node:process";
import { defineConfig, loadEnv } from "vite";
import { resolveRealtimeOrigin } from "./src/lib/realtimeConfig.js";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const env = loadEnv(mode, cwd(), "");
    resolveRealtimeOrigin({
      configuredUrl: env.VITE_REALTIME_URL,
      apiOrigin: String(env.VITE_API_URL || "").replace(/\/api\/?$/, ""),
      development: false
    });
  }

  return {
    plugins: [react()],
    server: {
      port: 5173
    }
  };
});
