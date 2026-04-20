import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "guest-list-full-reload",
      handleHotUpdate({ file, server }) {
        const fileName = path.basename(file);

        if (fileName === "guest-list-cleaned.md" || fileName === "guest-list.md") {
          server.ws.send({ type: "full-reload" });
          return [];
        }
      },
    },
  ],
});
