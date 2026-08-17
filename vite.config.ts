import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  const connectSource = command === "serve" ? "'self' ws://127.0.0.1:5173" : "'self'";
  return {
    plugins: [
      react(),
      {
        name: "flighttune-csp",
        transformIndexHtml: (html: string) => html.replace("__FLIGHTTUNE_CONNECT_SRC__", connectSource),
      },
    ],
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
