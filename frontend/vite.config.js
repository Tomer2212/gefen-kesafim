import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build id baked into the bundle and published as /version.json, so an open tab can tell a
// newer deploy is live (useAppVersion → NewVersionBanner).
const APP_VERSION = new Date().toISOString();

function versionFile() {
  return {
    name: "app-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: APP_VERSION }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    proxy: {
      "/auth": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/agent": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/analyze": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/attendance": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/calendar": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/calls": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/chatbot": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/contact/send": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/performance": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/person-tasks": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/public": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/rounds": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/schools": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/sessions": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/signup":  { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/tasks": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/training-videos": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
