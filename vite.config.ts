import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.PORT ?? 8787);

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
