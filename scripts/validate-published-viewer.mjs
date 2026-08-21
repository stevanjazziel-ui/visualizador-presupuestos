import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "public", "published-viewer.html");
const dataJsPath = path.join(root, "public", "budget-viewer-data.js");
const dataJsonPath = path.join(root, "public", "budget-viewer-data.json");

const html = await readFile(htmlPath, "utf8");
const dataJs = await readFile(dataJsPath, "utf8");
const dataJson = JSON.parse(await readFile(dataJsonPath, "utf8"));

if (!html.includes("./budget-viewer-data.js")) {
  throw new Error("published-viewer.html no longer references budget-viewer-data.js.");
}

if (!dataJs.trimStart().startsWith("window.BUDGET_VIEWER_PAYLOAD = ")) {
  throw new Error("budget-viewer-data.js does not expose the expected global payload.");
}

if (!Array.isArray(dataJson.items) || dataJson.items.length === 0) {
  throw new Error("budget-viewer-data.json does not contain any items.");
}

if (!dataJson.blockMeta || typeof dataJson.blockMeta !== "object") {
  throw new Error("budget-viewer-data.json does not contain blockMeta.");
}

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  throw new Error("Unable to locate the inline application script.");
}

new Function(scriptMatch[1]);

console.log(
  JSON.stringify({
    htmlPath,
    dataJsPath,
    dataJsonPath,
    items: dataJson.items.length
  }),
);
