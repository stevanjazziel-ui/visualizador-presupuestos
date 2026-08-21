const html = __HTML__;
const browserScript = __BROWSER_SCRIPT__;
const rawJson = __RAW_JSON__;
const syncSourceJson = __SYNC_SOURCE_JSON__;

const EGOB_SERVICE_URL = "https://egobfinanciero.gadmriobamba.gob.ec:8000/#riobamba";
const EGOB_CAS_LOGIN_URL = `https://egob.gadmriobamba.gob.ec:8443/cas/login?service=${encodeURIComponent(EGOB_SERVICE_URL)}`;
const EGOB_RPC_URL = "https://egobfinanciero.gadmriobamba.gob.ec:8000/riobamba/";
const LONG_CODE_RE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}\.\d+\.\d+(?:\.\d+){4,5}$/;

function accessHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function withHeaders(body, contentType, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
      ...accessHeaders(),
      ...extraHeaders,
    },
  });
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return withHeaders(JSON.stringify(payload), "application/json; charset=utf-8", status, {
    "cache-control": "no-store",
    ...extraHeaders,
  });
}

function parseCookieHeader(setCookieValue) {
  if (!setCookieValue) return "";
  return setCookieValue
    .split(/,(?=[^;,]+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function extractCasExecutionToken(html) {
  const patterns = [
    /name=["']execution["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']execution["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function getNumberValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "decimal" in value) {
    return Number(value.decimal || 0);
  }
  return Number(value || 0);
}

function roundValue(value) {
  return Math.round((value || 0) * 100) / 100;
}

function getDirectionCodeFromPartida(partida) {
  const parts = String(partida || "").split(".");
  if (parts.length < 6) return null;
  return `${parts[3]}.${parts[4]}.${parts[5]}`;
}

function cloneTemplatePayload() {
  return JSON.parse(rawJson);
}

function buildLivePayload(rows) {
  const payload = cloneTemplatePayload();
  const itemsByCode = new Map(payload.items.map((item) => [item.code, item]));
  const totalsByDirection = new Map();

  for (const row of rows) {
    const directionCode = getDirectionCodeFromPartida(row.code);
    if (!directionCode || !itemsByCode.has(directionCode)) continue;

    if (!totalsByDirection.has(directionCode)) {
      totalsByDirection.set(directionCode, {
        initial: 0,
        reforma: 0,
        codificado: 0,
        certificado: 0,
        comprometido: 0,
        devengado: 0,
        ejecutado: 0,
        pendienteCertificar: 0,
        pendienteDevengar: 0,
        pendienteEjecutar: 0,
      });
    }

    const totals = totalsByDirection.get(directionCode);
    totals.initial += getNumberValue(row.initial_amount);
    totals.reforma += getNumberValue(row.reform_amount);
    totals.codificado += getNumberValue(row.codified_amount);
    totals.certificado += getNumberValue(row.certified_amount);
    totals.comprometido += getNumberValue(row.committed_amount);
    totals.devengado += getNumberValue(row.accrued_amount);
    totals.ejecutado += getNumberValue(row.executed_amount);
    totals.pendienteCertificar += getNumberValue(row.certified_pending);
    totals.pendienteDevengar += getNumberValue(row.accrued_pending);
    totals.pendienteEjecutar += getNumberValue(row.executed_pending);
  }

  payload.items = payload.items.map((item) => {
    const totals = totalsByDirection.get(item.code);
    if (!totals) return item;
    return {
      ...item,
      initial: roundValue(totals.initial),
      reforma: roundValue(totals.reforma),
      codificado: roundValue(totals.codificado),
      certificado: roundValue(totals.certificado),
      comprometido: roundValue(totals.comprometido),
      devengado: roundValue(totals.devengado),
      ejecutado: roundValue(totals.ejecutado),
      pendienteCertificar: roundValue(totals.pendienteCertificar),
      pendienteDevengar: roundValue(totals.pendienteDevengar),
      pendienteEjecutar: roundValue(totals.pendienteEjecutar),
    };
  });

  const now = new Date().toISOString();
  payload.meta = {
    ...(payload.meta || {}),
    updatedAt: now,
    sourceUpdatedAt: now,
    sourceCapturedAt: now,
    publishedAt: now,
  };

  return payload;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Fallo la solicitud ${url} (${response.status}): ${errorBody.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchBudgetRows(env) {
  const username = env.FINANCIERO_USERNAME || env.BUDGET_SYNC_USERNAME;
  const password = env.FINANCIERO_PASSWORD || env.BUDGET_SYNC_PASSWORD;

  if (!username || !password) {
    throw new Error("Faltan las credenciales de Financiero en el entorno del sitio.");
  }

  const loginResponse = await fetch(EGOB_CAS_LOGIN_URL, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es-EC,es;q=0.9,en;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    },
  });
  const loginHtml = await loginResponse.text();
  const casCookie = parseCookieHeader(loginResponse.headers.get("set-cookie"));
  const executionToken = extractCasExecutionToken(loginHtml);
  if (!executionToken) {
    throw new Error("No se encontró el token execution del CAS.");
  }

  const formBody = new URLSearchParams({
    username,
    password,
    execution: executionToken,
    _eventId: "submit",
    geolocation: "",
  }).toString();

  const authResponse = await fetch(EGOB_CAS_LOGIN_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(casCookie ? { cookie: casCookie } : {}),
    },
    body: formBody,
  });

  const locationHeader = authResponse.headers.get("location") || "";
  const ticketUrl = locationHeader || authResponse.url || "";
  const ticketMatch = ticketUrl.match(/ticket=([^&#\s]+)/);
  if (!ticketMatch) {
    throw new Error("No se encontró el ticket CAS al autenticar en Financiero.");
  }
  const ticket = ticketMatch[1];

  const loginPayload = {
    id: 0,
    method: "common.db.login",
    params: [ticket, {}, "en"],
  };
  const loginRpc = await fetchJson(EGOB_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(loginPayload),
  });

  if (!loginRpc?.result || loginRpc.result.length < 2) {
    throw new Error("El backend de Financiero no devolvió una sesión válida.");
  }

  const [userId, sessionId] = loginRpc.result;
  const authToken = btoa(`${ticket}:${userId}:${sessionId}`);
  const context = {
    context_model: "public.planning.unit.context",
    advanced_filters: false,
    category_filter: null,
    company: 2,
    compromise: false,
    cost_center: null,
    department: null,
    direction: null,
    drag_filter: "complete",
    end_date: { __class__: "date", year: 2026, month: 12, day: 31 },
    exp_category: null,
    funding_code: "",
    ods_goal: null,
    ods_indicator: null,
    ods_target: null,
    orientation: null,
    participatory_budget: false,
    participatory_budget_filter: "",
    poa: 10095,
    poa_end_date: { __class__: "date", year: 2026, month: 12, day: 31 },
    poa_start_date: { __class__: "date", year: 2026, month: 1, day: 1 },
    posted: true,
    priority_group: null,
    program: null,
    project: null,
    requirement_type: null,
    start_date: { __class__: "date", year: 2026, month: 1, day: 1 },
    strategic_axis: null,
  };

  const fields = [
    "code",
    "type",
    "kind",
    "level",
    "initial_amount",
    "reform_amount",
    "codified_amount",
    "certified_amount",
    "committed_amount",
    "accrued_amount",
    "executed_amount",
    "certified_pending",
    "accrued_pending",
    "executed_pending",
  ];

  const rowsPayload = {
    id: 2,
    method: "model.public.budget.card.search_read",
    params: [
      [["type", "=", "expense"]],
      0,
      5000,
      null,
      fields,
      context,
    ],
  };

  const rowsRpc = await fetchJson(EGOB_RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Session ${authToken}`,
    },
    body: JSON.stringify(rowsPayload),
  });

  return (rowsRpc?.result || [])
    .filter((row) => row?.type === "expense" && LONG_CODE_RE.test(String(row.code || "")))
    .map((row) => ({
      code: String(row.code || ""),
      initial_amount: getNumberValue(row.initial_amount),
      reform_amount: getNumberValue(row.reform_amount),
      codified_amount: getNumberValue(row.codified_amount),
      certified_amount: getNumberValue(row.certified_amount),
      committed_amount: getNumberValue(row.committed_amount),
      accrued_amount: getNumberValue(row.accrued_amount),
      executed_amount: getNumberValue(row.executed_amount),
      certified_pending: getNumberValue(row.certified_pending),
      accrued_pending: getNumberValue(row.accrued_pending),
      executed_pending: getNumberValue(row.executed_pending),
    }));
}

async function handleLiveSync(env) {
  const rows = await fetchBudgetRows(env);
  const payload = buildLivePayload(rows);
  return jsonResponse({
    ok: true,
    payload,
    meta: {
      rowCount: rows.length,
      syncedAt: payload.meta.sourceUpdatedAt,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withHeaders("", "text/plain; charset=utf-8", 204, { "cache-control": "no-store" });
    }

    if (url.pathname === "/api/health") {
      return jsonResponse({ ok: true, source: "live-sync-worker" });
    }

    if (url.pathname === "/api/sync-live") {
      try {
        return await handleLiveSync(env);
      } catch (error) {
        return jsonResponse(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        );
      }
    }

    if (url.pathname === "/budget-viewer-data.js") {
      return withHeaders(browserScript, "application/javascript; charset=utf-8");
    }

    if (url.pathname === "/budget-viewer-data.json") {
      return withHeaders(rawJson, "application/json; charset=utf-8");
    }

    if (url.pathname === "/sync-source/latest.json") {
      return withHeaders(syncSourceJson, "application/json; charset=utf-8");
    }

    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/published-viewer.html") {
      return withHeaders(html, "text/html; charset=utf-8");
    }

    return withHeaders(html, "text/html; charset=utf-8", 200);
  },
};
