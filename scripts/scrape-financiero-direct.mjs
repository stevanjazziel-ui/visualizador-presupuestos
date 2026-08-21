import { readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "data", "sync-source", "financiero-direct-scrape.json");
const browserPluginRoot = "C:/Users/PC/.codex/plugins/cache/openai-bundled/browser";

function parseArgs(argv) {
  const args = { publish: false, output: defaultOutput };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--publish") {
      args.publish = true;
      continue;
    }
    if (token === "--output" && argv[index + 1]) {
      args.output = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
  }
  return args;
}

function isLongCode(code) {
  return /^\d{2}\.\d{2}\.\d{2}\.\d{4}\.\d+\.\d+(?:\.\d+){4,5}$/.test(code);
}

function parseNumber(value) {
  const text = String(value ?? "").replaceAll(",", "").trim();
  const parsed = Number(text || "0");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

async function getRuntime() {
  try {
    const versions = await readdir(browserPluginRoot, { withFileTypes: true });
    const candidates = versions
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    if (candidates.length === 0) {
      throw new Error("No encontre una version instalada del plugin browser.");
    }

    const browserClientPath = path.join(browserPluginRoot, candidates[0], "scripts", "browser-client.mjs");
    const { setupBrowserRuntime } = await import(pathToFileURL(browserClientPath).href);
    return setupBrowserRuntime();
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/trusted Node REPL browser service/i.test(message)) {
      throw new Error("La captura directa solo puede ejecutarse desde una sesion confiable de Codex con navegador integrado abierto.");
    }
    throw error;
  }
}

async function openFinancialTab(iab) {
  const openTabs = await iab.user.openTabs();
  const target = openTabs.find((tab) => /egobfinanciero\.gadmriobamba\.gob\.ec:8000/i.test(tab.url || ""));
  if (target) {
    return iab.user.claimTab(target);
  }

  const listedTabs = await iab.tabs.list();
  const listedTarget = listedTabs.find((tab) => /egobfinanciero\.gadmriobamba\.gob\.ec:8000/i.test(tab.url || ""));
  if (!listedTarget) {
    throw new Error("No encontre una pestana abierta de Financiero en el navegador integrado.");
  }

  return iab.tabs.get(listedTarget.id);
}

async function readVisibleState(tab) {
  return tab.playwright.evaluate(() => {
    function cleanText(value) {
      return (value || "").replace(/\s+/g, " ").trim();
    }

    const mainTable =
      document.querySelectorAll("table.tree.table.table-hover.table-striped.table-condensed")[0]
      || document.querySelectorAll("table")[6];

    if (!mainTable) {
      throw new Error("No encontre la tabla principal de la consulta presupuestaria.");
    }

    const badge = [...document.querySelectorAll("span, div, button")]
      .map((element) => cleanText(element.textContent || ""))
      .find((text) => /^\d+\s*\/\s*\d+(?:\s*de\s*\d+)?$/i.test(text)) || null;

    const rows = [...mainTable.querySelectorAll("tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => cleanText(td.innerText || td.textContent || "")))
      .filter((cells) => cells.length >= 18)
      .map((cells) => ({
        code: cells[3],
        initial_amount: cells[10],
        codified_amount: cells[12],
        certified_pending: cells[13],
        certified_amount: cells[14],
        committed_amount: cells[15],
        accrued_amount: cells[16],
        executed_amount: cells[17],
        reform_amount: cells[11],
        accrued_pending: cells[18] ?? "",
        executed_pending: cells[19] ?? "",
      }))
      .filter((row) => /^\d{2}\.\d{2}\.\d{2}\.\d{4}\.\d+\.\d+(?:\.\d+){4,5}$/.test(row.code));

    return { badge, rows };
  });
}

async function clickPager(tab, direction) {
  const title = direction === "next" ? "Siguiente" : "Anterior";
  const locator = tab.playwright.locator(`button[title="${title}"]`);
  const count = await locator.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    try {
      const button = locator.nth(index);
      const visible = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!visible) continue;
      const disabled = await button.evaluate((element) => Boolean(element.disabled) || element.classList.contains("disabled"));
      if (disabled) continue;
      await button.click();
      await tab.playwright.waitForTimeout(1500);
      return true;
    } catch {}
  }
  return false;
}

async function ensurePage(tab, expectedPrefix) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await readVisibleState(tab);
    if ((state.badge || "").startsWith(expectedPrefix)) {
      return state;
    }
    const moved = expectedPrefix.startsWith("1 /")
      ? await clickPager(tab, "previous")
      : await clickPager(tab, "next");
    if (!moved) break;
  }
  const current = await readVisibleState(tab);
  throw new Error(`No pude ubicar la pagina ${expectedPrefix}. Estado actual: ${current.badge || "sin badge"}`);
}

async function collectAllPages(tab) {
  const seenCodes = new Set();
  const collected = [];
  const visitedBadges = new Set();

  for (;;) {
    const state = await readVisibleState(tab);
    const badge = state.badge || `page-${visitedBadges.size + 1}`;
    if (visitedBadges.has(badge)) {
      break;
    }
    visitedBadges.add(badge);

    for (const row of state.rows) {
      if (seenCodes.has(row.code)) continue;
      seenCodes.add(row.code);
      collected.push(row);
    }

    const moved = await clickPager(tab, "next");
    if (!moved) {
      break;
    }
  }

  return {
    pages: [...visitedBadges],
    rows: collected,
  };
}

function rowsFromPage(page) {
  return page.rows.map((row) => ({
    code: row.code,
    initial_amount: parseNumber(row.initial_amount),
    reform_amount: parseNumber(row.reform_amount),
    codified_amount: parseNumber(row.codified_amount),
    certified_amount: parseNumber(row.certified_amount),
    committed_amount: parseNumber(row.committed_amount),
    accrued_amount: parseNumber(row.accrued_amount),
    executed_amount: parseNumber(row.executed_amount),
    certified_pending: parseNumber(row.certified_pending),
    accrued_pending: parseNumber(row.accrued_pending),
    executed_pending: parseNumber(row.executed_pending),
  }));
}

function runDirectPublish() {
  const result = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "import-financiero-direct.ps1"), "-Publish"],
    { cwd: root, stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`La publicacion directa devolvio codigo ${result.status ?? 1}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const agent = await getRuntime();
  const iab = await agent.browsers.get("iab");
  const tab = await openFinancialTab(iab);
  await ensurePage(tab, "1 /");
  const collected = await collectAllPages(tab);
  const parsedRows = rowsFromPage({ rows: collected.rows });

  const payload = {
    meta: {
      source: "financiero-direct-dom",
      capturedAt: new Date().toISOString(),
      pages: collected.pages,
      rowCount: parsedRows.length,
    },
    rows: parsedRows,
  };

  await writeFile(args.output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: args.output, rowCount: payload.meta.rowCount, pages: payload.meta.pages }, null, 2));

  if (args.publish) {
    runDirectPublish();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
