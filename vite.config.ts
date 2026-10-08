import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import vesaErrorReporter from "./.vesa/vite-error-plugin.js";
import vesaDesignMode from "./.vesa/vite-design-mode-plugin.js";
import path from "path";
import fs from "fs";

const hasEsaConfig = fs.existsSync(path.resolve(__dirname, "esa.jsonc"));

// Proxy the console/gateway API to the local edge runtime (`esa dev -p 18080`).
const apiProxy = hasEsaConfig
  ? {
      "/api": {
        target: "http://127.0.0.1:18080",
        changeOrigin: true,
      },
    }
  : undefined;

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false,
    },
    ...(apiProxy ? { proxy: apiProxy } : {}),
  },
  preview: {
    port: 4173,
    ...(apiProxy ? { proxy: apiProxy } : {}),
  },
  plugins: [vesaErrorReporter(), vesaDesignMode(), tailwindcss(), react()].filter(Boolean),
  build: {
    // Keep all third-party deps in one vendor chunk and isolate the heavy
    // charting stack. A single vendor chunk avoids the init-order/cycle bugs
    // that appear when react and its consumers live in different chunks.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
