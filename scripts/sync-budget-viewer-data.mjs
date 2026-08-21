import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(root, "data", "budget-viewer-data.json");

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function isHttpSource(source) {
  return /^https?:\/\//i.test(source);
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...bodyRows] = rows;
  const headers = headerRow.map((value) => value.trim());
  return bodyRows.map((values) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] || "").trim();
    });
    return record;
  });
}

function toNumber(value, field) {
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      throw new Error(`Unable to parse ${field} as number: ${value}`);
    }
    return value;
  }

  const normalized = value.replaceAll(".", "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse ${field} as number: ${value}`);
  }
  return parsed;
}

function normalizePayload(payload, fallbackPayload) {
  const baseMeta = fallbackPayload?.meta || {};
  const normalized = Array.isArray(payload)
    ? { items: payload }
    : payload;

  const items = Array.isArray(normalized.items) ? normalized.items : [];
  const blockMeta = normalized.blockMeta || fallbackPayload?.blockMeta || {};

  if (items.length === 0) {
    throw new Error("The synchronized payload returned no items.");
  }

  const previousComparable = JSON.stringify({
    items: fallbackPayload?.items || [],
    blockMeta: fallbackPayload?.blockMeta || {},
  });
  const nextComparable = JSON.stringify({
    items,
    blockMeta,
  });
  const dataChanged = previousComparable !== nextComparable;

  return {
    meta: {
      title: normalized.meta?.title || baseMeta.title || "Direcciones - Monto codificado",
      year: normalized.meta?.year || baseMeta.year || new Date().getUTCFullYear(),
      updatedAt: dataChanged
        ? new Date().toISOString()
        : (normalized.meta?.updatedAt || baseMeta.updatedAt || new Date().toISOString())
    },
    items,
    blockMeta
  };
}

function payloadFromCsvRecords(records, fallbackPayload) {
  const items = records.map((record) => ({
    code: record.code,
    name: record.name,
    block: record.block,
    tone: record.tone || fallbackPayload?.blockMeta?.[record.block]?.tone || "tone-a",
    kind: record.kind || "direccion",
    initial: toNumber(record.initial, "initial"),
    reforma: toNumber(record.reforma, "reforma"),
    codificado: toNumber(record.codificado, "codificado"),
    certificado: toNumber(record.certificado || "0", "certificado"),
    comprometido: toNumber(record.comprometido || "0", "comprometido"),
    devengado: toNumber(record.devengado || "0", "devengado"),
    ejecutado: toNumber(record.ejecutado || "0", "ejecutado"),
    pendienteCertificar: toNumber(record.pendienteCertificar || "0", "pendienteCertificar"),
    pendienteDevengar: toNumber(record.pendienteDevengar || "0", "pendienteDevengar"),
    pendienteEjecutar: toNumber(record.pendienteEjecutar || "0", "pendienteEjecutar"),
    ...(record.focus ? { focus: /^(1|true|si|yes)$/i.test(record.focus) } : {})
  }));

  const blockMeta = { ...(fallbackPayload?.blockMeta || {}) };

  for (const record of records) {
    if (!blockMeta[record.block]) {
      blockMeta[record.block] = {
        label: record.block_label || `Bloque ${record.block}`,
        note: record.block_note || "Bloque sincronizado automaticamente.",
        tone: record.tone || "tone-a"
      };
    }
  }

  return normalizePayload({ items, blockMeta }, fallbackPayload);
}

function validatePayload(payload) {
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("The payload must contain at least one item.");
  }

  if (!payload.blockMeta || typeof payload.blockMeta !== "object") {
    throw new Error("The payload must contain blockMeta.");
  }

  const seenCodes = new Set();
  for (const item of payload.items) {
    for (const field of ["code", "name", "block", "tone", "kind"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        throw new Error(`Item is missing ${field}.`);
      }
    }

    for (const field of ["initial", "reforma", "codificado"]) {
      if (typeof item[field] !== "number" || Number.isNaN(item[field])) {
        throw new Error(`Item ${item.code} has invalid ${field}.`);
      }
    }

    for (const field of ["certificado", "comprometido", "devengado", "ejecutado", "pendienteCertificar", "pendienteDevengar", "pendienteEjecutar"]) {
      if (item[field] !== undefined && (typeof item[field] !== "number" || Number.isNaN(item[field]))) {
        throw new Error(`Item ${item.code} has invalid ${field}.`);
      }
    }

    if (!payload.blockMeta[item.block]) {
      throw new Error(`Item ${item.code} references unknown block ${item.block}.`);
    }

    if (seenCodes.has(item.code)) {
      throw new Error(`Duplicate code detected: ${item.code}.`);
    }

    seenCodes.add(item.code);
  }
}

async function loadSource(source, token) {
  if (isHttpSource(source)) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(source, { headers });
    if (!response.ok) {
      throw new Error(`Sync source request failed with status ${response.status}.`);
    }
    return {
      text: await response.text(),
      contentType: response.headers.get("content-type") || ""
    };
  }

  return {
    text: await readFile(path.resolve(source), "utf8"),
    contentType: ""
  };
}

const args = parseArgs(process.argv);
const source = args.source || process.env.BUDGET_SYNC_SOURCE;
const format = (args.format || process.env.BUDGET_SYNC_FORMAT || "").toLowerCase();
const outputPath = path.resolve(args.output || defaultOutput);

if (!source) {
  throw new Error("Missing sync source. Use --source or BUDGET_SYNC_SOURCE.");
}

const fallbackPayload = JSON.parse(await readFile(outputPath, "utf8"));
const { text, contentType } = await loadSource(source, process.env.BUDGET_SYNC_TOKEN);

let payload;
const detectedFormat = format
  || (source.toLowerCase().endsWith(".csv") ? "csv" : "")
  || (contentType.includes("text/csv") ? "csv" : "")
  || "json";

if (detectedFormat === "csv") {
  payload = payloadFromCsvRecords(parseCsv(text), fallbackPayload);
} else {
  payload = normalizePayload(JSON.parse(text), fallbackPayload);
}

payload.items = payload.items.map((item) => ({
  ...item,
  certificado: item.certificado === undefined || item.certificado === null
    ? 0
    : toNumber(item.certificado, "certificado"),
  comprometido: item.comprometido === undefined || item.comprometido === null
    ? 0
    : toNumber(item.comprometido, "comprometido"),
  devengado: item.devengado === undefined || item.devengado === null
    ? 0
    : toNumber(item.devengado, "devengado"),
  ejecutado: item.ejecutado === undefined || item.ejecutado === null
    ? 0
    : toNumber(item.ejecutado, "ejecutado"),
  pendienteCertificar: item.pendienteCertificar === undefined || item.pendienteCertificar === null
    ? 0
    : toNumber(item.pendienteCertificar, "pendienteCertificar"),
  pendienteDevengar: item.pendienteDevengar === undefined || item.pendienteDevengar === null
    ? 0
    : toNumber(item.pendienteDevengar, "pendienteDevengar"),
  pendienteEjecutar: item.pendienteEjecutar === undefined || item.pendienteEjecutar === null
    ? 0
    : toNumber(item.pendienteEjecutar, "pendienteEjecutar"),
}));

validatePayload(payload);
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    outputPath,
    items: payload.items.length,
    blocks: Object.keys(payload.blockMeta).length,
    updatedAt: payload.meta.updatedAt
  }),
);
