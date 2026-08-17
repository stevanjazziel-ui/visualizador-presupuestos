import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceHtml = path.resolve(
  root,
  "..",
  "..",
  "..",
  ".codex",
  "visualizations",
  "2026",
  "08",
  "17",
  "01a011a2-97d3-7be3-8d10-688252184cec",
  "avaluos-monto-codificado.preview.html",
);
const publicDir = path.join(root, "public");
const distServerDir = path.join(root, "dist", "server");
const publicViewerPath = path.join(publicDir, "published-viewer.html");
const workerPath = path.join(distServerDir, "index.js");

const html = await readFile(sourceHtml, "utf8");
const escaped = JSON.stringify(html);

await mkdir(publicDir, { recursive: true });
await mkdir(distServerDir, { recursive: true });
await rm(path.join(root, "dist", "static"), { recursive: true, force: true });

await writeFile(publicViewerPath, html, "utf8");
await writeFile(
  workerPath,
  `const html = ${escaped};

function withHeaders(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/published-viewer.html") {
      return withHeaders(html);
    }

    return withHeaders(html, 200);
  }
};
`,
  "utf8",
);

console.log(
  JSON.stringify({
    publicViewerPath,
    workerPath,
  }),
);
