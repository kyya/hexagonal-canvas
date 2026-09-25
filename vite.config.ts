import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = `http://127.0.0.1:${Number(process.env.HEX_API_PORT) || 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": api,
    },
  },
  preview: {
    proxy: {
      "/api": api,
    },
  },
});
