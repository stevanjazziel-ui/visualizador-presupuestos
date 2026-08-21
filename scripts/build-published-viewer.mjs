import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const distServerDir = path.join(root, "dist", "server");
const htmlPath = path.join(publicDir, "published-viewer.html");
const dataPath = path.join(root, "data", "budget-viewer-data.json");
const syncSourcePath = path.join(root, "data", "sync-source", "latest.json");
const publicDataJsPath = path.join(publicDir, "budget-viewer-data.js");
const publicDataJsonPath = path.join(publicDir, "budget-viewer-data.json");
const publicSyncSourceDir = path.join(publicDir, "sync-source");
const publicSyncSourceJsonPath = path.join(publicSyncSourceDir, "latest.json");
const workerPath = path.join(distServerDir, "index.js");
const workerTemplatePath = path.join(root, "scripts", "live-sync-worker-template.js");

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The budget viewer payload must be an object.");
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("The budget viewer payload must include at least one item.");
  }

  if (!payload.blockMeta || typeof payload.blockMeta !== "object") {
    throw new Error("The budget viewer payload must include blockMeta.");
  }

  const seenCodes = new Set();
  for (const item of payload.items) {
    const requiredStrings = ["code", "name", "block", "tone", "kind"];
    for (const field of requiredStrings) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        throw new Error(`Item is missing a valid ${field}.`);
      }
    }

    const requiredNumbers = ["initial", "reforma", "codificado"];
    for (const field of requiredNumbers) {
      if (typeof item[field] !== "number" || Number.isNaN(item[field])) {
        throw new Error(`Item ${item.code} is missing a valid numeric ${field}.`);
      }
    }

    for (const field of ["certificado", "comprometido", "devengado", "ejecutado", "pendienteCertificar", "pendienteDevengar", "pendienteEjecutar"]) {
      if (item[field] !== undefined && (typeof item[field] !== "number" || Number.isNaN(item[field]))) {
        throw new Error(`Item ${item.code} has invalid ${field}.`);
      }
    }

    if (seenCodes.has(item.code)) {
      throw new Error(`Duplicate item code detected: ${item.code}.`);
    }
    seenCodes.add(item.code);

    if (!payload.blockMeta[item.block]) {
      throw new Error(`Item ${item.code} references an unknown block: ${item.block}.`);
    }
  }
}

function toBrowserScript(payload) {
  return `window.BUDGET_VIEWER_PAYLOAD = ${JSON.stringify(payload, null, 2)};\n`;
}

const html = await readFile(htmlPath, "utf8");
const payload = JSON.parse(await readFile(dataPath, "utf8"));
const syncSourcePayload = JSON.parse(await readFile(syncSourcePath, "utf8"));
const workerTemplate = await readFile(workerTemplatePath, "utf8");
validatePayload(payload);
validatePayload(syncSourcePayload);

const browserScript = toBrowserScript(payload);
const escapedHtml = JSON.stringify(html);
const escapedBrowserScript = JSON.stringify(browserScript);
const escapedPublicJson = JSON.stringify(JSON.stringify(payload, null, 2));
const escapedSyncSourceJson = JSON.stringify(JSON.stringify(syncSourcePayload, null, 2));

await mkdir(publicDir, { recursive: true });
await mkdir(publicSyncSourceDir, { recursive: true });
await mkdir(distServerDir, { recursive: true });
await rm(path.join(root, "dist", "static"), { recursive: true, force: true });

await writeFile(publicDataJsPath, browserScript, "utf8");
await writeFile(publicDataJsonPath, JSON.stringify(payload, null, 2), "utf8");
await writeFile(publicSyncSourceJsonPath, JSON.stringify(syncSourcePayload, null, 2), "utf8");
const workerSource = workerTemplate
  .replace("__HTML__", escapedHtml)
  .replace("__BROWSER_SCRIPT__", escapedBrowserScript)
  .replace("__RAW_JSON__", escapedPublicJson)
  .replace("__SYNC_SOURCE_JSON__", escapedSyncSourceJson);

await writeFile(workerPath, workerSource, "utf8");

console.log(
  JSON.stringify({
    publicDataJsPath,
    publicDataJsonPath,
    publicSyncSourceJsonPath,
    workerPath,
  }),
);
