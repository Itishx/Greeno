import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  root: "web",
  // The app is served under /app; site/ owns the root.
  base: "/app/",
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    // The API key never reaches the browser: everything that needs it goes
    // through the local server, which is the same code the Mac app runs.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { outDir: "../dist-web/app", emptyOutDir: true },
});
