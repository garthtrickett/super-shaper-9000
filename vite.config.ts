import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    host: "127.0.0.1",
    allowedHosts: true,
    port: 3000,
        strictPort: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin"
    },
    hmr: {
      host: "127.0.0.1",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:42069",
        changeOrigin: true,
      }
    },
  },
});
