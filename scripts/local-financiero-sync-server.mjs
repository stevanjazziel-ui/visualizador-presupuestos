import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.FINANCIERO_LOCAL_SYNC_PORT || 8765);
const payloadPath = path.join(root, "data", "budget-viewer-data.json");
const trackedPaths = [
  "data/sync-source/financiero-direct-scrape.json",
  "data/sync-source/latest.json",
  "data/budget-viewer-data.json",
  "public/budget-viewer-data.js",
  "public/budget-viewer-data.json",
  "public/sync-source/latest.json",
];

function accessHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...accessHeaders(),
  });
  response.end(JSON.stringify(payload));
}

function readRequestUrl(request) {
  return new URL(request.url || "/", `http://${host}:${port}`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Command failed with code ${code}`).trim()));
        return;
      }

      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runLocalCasSync() {
  await runCommand("powershell", [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(root, "scripts", "fetch-financiero-cas.ps1"),
  ]);
}

async function runBrowserScrapeSync({ publish }) {
  const args = [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.join(root, "scripts", "scrape-financiero-direct.ps1"),
  ];

  if (publish) {
    args.push("-Publish");
  }

  await runCommand("powershell", args);
}

async function publishGitHubChanges() {
  await runCommand("git", ["add", ...trackedPaths]);

  let hasChanges = true;
  try {
    await runCommand("git", ["diff", "--cached", "--quiet"]);
    hasChanges = false;
  } catch {
    hasChanges = true;
  }

  if (!hasChanges) {
    return { changed: false, pushed: false };
  }

  const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  await runCommand("git", ["commit", "-m", `chore: sync presupuesto local ${stamp}`]);
  await runCommand("git", ["push", "origin", "master"]);
  return { changed: true, pushed: true };
}

async function readPayload() {
  return JSON.parse(await readFile(payloadPath, "utf8"));
}

let activeSync = null;

async function runSyncFlow({ publish }) {
  let mode = "cas";
  let publishResult = { changed: false, pushed: false };

  try {
    await runLocalCasSync();
    if (publish) {
      publishResult = await publishGitHubChanges();
    }
  } catch (casError) {
    mode = "browser";
    await runBrowserScrapeSync({ publish });
    publishResult = { changed: publish, pushed: publish };
  }

  const payload = await readPayload();

  return {
    ok: true,
    payload,
    local: true,
    mode,
    published: publishResult.pushed,
    changed: publishResult.changed,
    message: publishResult.pushed
      ? `Sincronizado desde eGOB local (${mode}) y publicado a GitHub.`
      : `Sincronizado desde eGOB local (${mode}).`,
  };
}

const server = http.createServer(async (request, response) => {
  const url = readRequestUrl(request);

  if (request.method === "OPTIONS") {
    response.writeHead(204, accessHeaders());
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      local: true,
      service: "financiero-local-sync",
      now: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sync-live") {
    const publish = url.searchParams.get("publish") !== "0";

    try {
      if (!activeSync) {
        activeSync = runSyncFlow({ publish }).finally(() => {
          activeSync = null;
        });
      }

      const result = await activeSync;
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        local: true,
        error: error?.message || "La sincronizacion local fallo.",
      });
    }
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Ruta no encontrada.",
  });
});

server.listen(port, host, () => {
  process.stdout.write(
    JSON.stringify({
      ok: true,
      host,
      port,
      health: `http://${host}:${port}/api/health`,
      sync: `http://${host}:${port}/api/sync-live`,
    }) + "\n",
  );
});
