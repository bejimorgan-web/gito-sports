import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  base: process.env.VITE_DEV_SERVER_URL ? "/" : "./",
  plugins: [react()],
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".json"],
    alias: {
      "@gito/shared": path.resolve(__dirname, "../shared/src"),
      "@gito/shared/": path.resolve(__dirname, "../shared/src")
    }
  },
  server: {
    port: 4200
  }
});

