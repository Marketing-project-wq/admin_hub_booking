import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { cpSync, existsSync, mkdirSync } from "fs";

// Self-host WASM MediaPipe: salin dari node_modules ke public/mediapipe-wasm saat
// dev & build. File wasm TIDAK di-commit (lihat .gitignore); model .task tetap di git.
function copyMediapipeWasm() {
  return {
    name: "copy-mediapipe-wasm",
    buildStart() {
      const src = path.resolve(import.meta.dirname, "node_modules/@mediapipe/tasks-vision/wasm");
      const dest = path.resolve(import.meta.dirname, "public/mediapipe-wasm");
      if (!existsSync(src)) {
        this.warn("[copy-mediapipe-wasm] sumber tidak ada — jalankan pnpm install dulu: " + src);
        return;
      }
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [
    copyMediapipeWasm(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    host: "0.0.0.0",
  },
  preview: {
    port: Number(process.env.PORT) || 3000,
    host: "0.0.0.0",
  },
});
