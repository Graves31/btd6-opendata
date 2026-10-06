import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";

/** Preload the two above-the-fold fonts (hashed by Vite) straight from index.html, so text never re-flows late. */
function preloadFonts(): Plugin {
  return {
    name: "preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const fonts = Object.keys(ctx.bundle ?? {}).filter((f) => /(archivo|big-shoulders)[^/]*latin-wght-normal[^/]*\.woff2$/.test(f));
        return fonts.map((f) => ({
          tag: "link",
          attrs: { rel: "preload", href: `/${f}`, as: "font", type: "font/woff2", crossorigin: "" },
          injectTo: "head" as const,
        }));
      },
    },
  };
}

/** Build output, relative to the web/ root. OUT_DIR lets parallel builds use their own folder (e.g. ../dist-a). */
const OUT_DIR = process.env.OUT_DIR ?? "../dist";

/** Stamp the service worker with a build id (hash of the emitted file names), so each deploy gets its own cache. */
function stampServiceWorker(): Plugin {
  let id = "dev";
  return {
    name: "stamp-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      id = createHash("sha256").update(Object.keys(bundle).sort().join("|")).digest("hex").slice(0, 10);
    },
    closeBundle() {
      const file = fileURLToPath(new URL(`${OUT_DIR}/sw.js`, new URL("./web/", import.meta.url)));
      writeFileSync(file, readFileSync(file, "utf8").replace("__BUILD__", id));
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [preact(), preloadFonts(), stampServiceWorker()],
  build: { outDir: OUT_DIR, emptyOutDir: true, target: "es2022", assetsInlineLimit: 0 },
  // `npm run dev:web` proxies the API to a local `wrangler dev` on :8787.
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
