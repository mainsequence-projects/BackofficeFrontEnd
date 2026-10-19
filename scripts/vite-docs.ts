import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const run = promisify(execFile);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Serve the real Docusaurus guide under the same /docs/ URL as production. */
export function localDocumentation(): Plugin {
  return {
    name: "backoffice-local-documentation",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const output = resolve(root, "dist/docs");
      const sources = [
        resolve(root, "docs"),
        resolve(root, "documentation/docusaurus.config.mjs"),
        resolve(root, "documentation/navigation.json"),
        resolve(root, "documentation/package.json"),
      ];
      let generation = 0;
      let builtGeneration = -1;
      let build: Promise<void> | undefined;
      server.watcher.add(sources);
      server.watcher.on("all", (_event, file) => {
        if (sources.some((source) => file === source || file.startsWith(source + sep)))
          generation++;
      });
      const ensureGuide = async () => {
        while (builtGeneration !== generation) {
          if (!build) {
            const startedGeneration = generation;
            build = (async () => {
              server.config.logger.info("Building the local Back Office user guide…");
              await run(process.execPath, [resolve(root, "scripts/sync-docs-navigation.mjs")], { cwd: root });
              // Docusaurus SSR enumerates globals; Node 25's experimental
              // localStorage throws without a storage file even when unused.
              await run(process.execPath, ["--no-experimental-webstorage", resolve(root, "node_modules/@docusaurus/core/bin/docusaurus.mjs"),
                "build", "documentation", "--out-dir", "../dist/docs"], { cwd: root });
              builtGeneration = startedGeneration;
            })().finally(() => { build = undefined; });
          }
          await build;
        }
      };
      server.middlewares.use("/docs", async (request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { Allow: "GET, HEAD" }).end();
          return;
        }
        try {
          if (!request.url || request.originalUrl?.split("?")[0] === "/docs") {
            const query = request.url?.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
            response.writeHead(308, { Location: "/docs/" + query }).end();
            return;
          }
          const pathname = decodeURIComponent(request.url.split("?")[0]);
          const file = resolve(output, "." + pathname);
          const child = relative(output, file);
          if (child === ".." || child.startsWith(".." + sep) || isAbsolute(child)) {
            response.writeHead(403).end();
            return;
          }
          await ensureGuide();
          const metadata = await stat(file).catch(() => undefined);
          const target = metadata?.isDirectory() ? resolve(file, "index.html") : file;
          const body = await readFile(target).catch(() => undefined);
          if (!body) {
            response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Guide page not found.");
            return;
          }
          response.writeHead(200, {
            "Content-Type": contentTypes[extname(target)] ?? "application/octet-stream",
            "Content-Length": body.length,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(request.method === "HEAD" ? undefined : body);
        } catch (error) {
          server.config.logger.error(`Local user-guide build failed: ${String(error)}`);
          response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" })
            .end("The local user guide could not be prepared. Check the development console and try again.");
        }
      });
    },
  };
}
