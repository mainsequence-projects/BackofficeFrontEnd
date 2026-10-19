import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { platformRequestProxy } from "@dev-mainsequence/command-center-sdk/vite";

export default defineConfig({
  plugins: [react(), platformRequestProxy()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.BACKOFFICE_API_ORIGIN ?? "http://127.0.0.1:28641",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, "") || "/",
      },
    },
  },
});
