import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Demo app ke liye (library build `tsup` se hota hai, yeh sirf local dev + GitHub Pages demo ke liye hai)
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: true,
    allowedHosts: true,
  },
  build: {
    outDir: "dist-demo",
  },
});
