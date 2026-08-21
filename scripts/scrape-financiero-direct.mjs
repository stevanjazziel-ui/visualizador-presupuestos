import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "data", "sync-source", "financiero-direct-scrape.json");
const browserClientPath = "C:/Users/PC/.codex/plugins/cache/openai-bundled/browser/26.814.41957/scripts/browser-client.mjs";

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
  return /^\d{2}\.\d{2}\.\d{2}\.\d{4}\.\d+\.\d+(?:\.\d+){5}$/.test(code);
}

function rowsFromPage(page) {
  const rows = [];
  const keys = Object.keys(page.series);
  for (let index = 0; index < page.xTicks.length; index += 1) {
    const code = page.xTicks[index];
    if (!isLongCode(code)) continue;
    const row = { code };
    for (const key of keys) {
      row[key] = page.series[key][index] ?? 0;
    }
    rows.push(row);
  }
  return rows;
}

async function getRuntime() {
  try {
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
  if (!target) {
    throw new Error("No encontre una pestana abierta de Financiero en el navegador integrado.");
  }
  return iab.user.claimTab(target);
}

async function readVisibleState(tab) {
  return tab.playwright.evaluate(() => {
    function parseY(pathD) {
      const match = /L\s*[-0-9.]+,([-0-9.]+)/.exec(pathD || "");
      return match ? Number(match[1]) : null;
    }

    function parseTickY(transform) {
      const match = /translate\(0,([-0-9.]+)\)/.exec(transform || "");
      return match ? Number(match[1]) : null;
    }

    const root = document.querySelector(".graph .c3");
    if (!root) {
      throw new Error("No encontre la grafica .graph .c3 en la consulta presupuestaria.");
    }

    const badge = [...document.querySelectorAll("span,div,button")]
      .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
      .find((text) => /^\d+\s*\/\s*\d+(?:\s*de\s*\d+)?$/i.test(text)) || null;

    const xTicks = [...root.querySelectorAll(".c3-axis-x .tick text")].map((element) => element.textContent.trim());
    const yTicks = [...root.querySelectorAll(".c3-axis-y .tick")]
      .map((element) => ({
        value: Number(element.querySelector("text")?.textContent?.trim() || "0"),
        y: parseTickY(element.getAttribute("transform") || ""),
      }))
      .filter((tick) => Number.isFinite(tick.y));

    const y0 = yTicks.find((tick) => tick.value === 0)?.y ?? yTicks[0]?.y;
    const maxTick = yTicks.reduce((winner, tick) => (winner.value > tick.value ? winner : tick), yTicks[0]);
    const valueFromY = (y) => (y0 - y) * (maxTick.value / (y0 - maxTick.y));

    const series = {};
    for (const target of root.querySelectorAll(".c3-chart-bars .c3-target")) {
      const className = target.getAttribute("class") || "";
      const key = (className.match(/c3-target-([a-z_]+)/) || [])[1];
      if (!key) continue;
      series[key] = [...target.querySelectorAll(".c3-bar")].map((element) => {
        const value = valueFromY(parseY(element.getAttribute("d") || ""));
        return Math.round(value * 100) / 100;
      });
    }

    return { badge, xTicks, series };
  });
}

async function clickPager(tab, direction) {
  const title = direction === "next" ? "Siguiente" : "Anterior";
  const locator = tab.playwright.locator(`button[title="${title}"]`);
  const count = await locator.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    try {
      const button = locator.nth(index);
      await button.click();
      await tab.playwright.waitForTimeout(1200);
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

  const page1 = await ensurePage(tab, "1 /");
  const page2 = await ensurePage(tab, "1001 /");

  const payload = {
    meta: {
      source: "financiero-direct-dom",
      capturedAt: new Date().toISOString(),
      pages: [page1.badge, page2.badge],
      rowCount: rowsFromPage(page1).length + rowsFromPage(page2).length,
    },
    rows: [...rowsFromPage(page1), ...rowsFromPage(page2)],
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
