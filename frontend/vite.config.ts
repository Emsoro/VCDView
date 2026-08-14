import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 相对路径，确保打包产物可被 VirtualFS 以任意虚拟路径加载
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 5173,
  },
});
