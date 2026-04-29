import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          elk: ["elkjs/lib/elk.bundled.js"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4177,
  },
});
