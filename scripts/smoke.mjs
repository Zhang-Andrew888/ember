#!/usr/bin/env node
// Headless end-to-end smoke test against a running Ember Line server (and optionally the web dev server).
// Uses only Node >= 22 built-ins (fetch, WebSocket). Run via `scripts/demo.sh --smoke` or directly:
//   SERVER_URL=http://127.0.0.1:3000 WEB_URL=http://127.0.0.1:5173 node scripts/smoke.mjs

const SERVER_URL = (process.env.SERVER_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const WEB_URL = (process.env.WEB_URL ?? "").replace(/\/$/, "");
/** How long to observe the live stream for clock advance and message variety. */
const OBSERVE_MS = Number(process.env.SMOKE_OBSERVE_MS ?? 6000);
const PRIVATE_FIELD_PATTERN = /privateWorldParameters|spreadMultiplier|"seed":|"requiredWork":|"truth/;

const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? "PASS" : "FAIL";
  process.stdout.write(`${mark}  ${name}${detail ? `  (${detail})` : ""}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(path, init) {
  const response = await fetch(`${SERVER_URL}${path}`, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = predicate();
      if (found !== undefined && found !== false && found !== null) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}`));
      }
    }, 50);
  });
}

async function main() {
  // 1. Health
  const health = await fetchJson("/health");
  check("GET /health responds with protocolVersion 1", health.status === 200 && health.body?.protocolVersion === 1, JSON.stringify(health.body));

  // 2. Create incident
  const created = await fetchJson("/incidents", { method: "POST" });
  const c = created.body ?? {};
  check(
    "POST /incidents returns id, token, websocket paths and briefing view",
    created.status === 200 &&
      typeof c.incidentId === "string" &&
      typeof c.token === "string" &&
      typeof c.websocket?.events === "string" &&
      c.briefing?.incidentStatus === "active",
    `status=${created.status}`,
  );
  check("briefing view has agents and sites", Array.isArray(c.briefing?.agents) && c.briefing.agents.length >= 1 && Array.isArray(c.briefing?.sites) && c.briefing.sites.length >= 1, `agents=${c.briefing?.agents?.length} sites=${c.briefing?.sites?.length}`);
  check("briefing clock is stopped before start", c.briefing?.simTimeMs === 0 && c.briefing?.wallElapsedMs === 0);
  const createdBlob = JSON.stringify(c.briefing);
  check("POST /incidents briefing carries no private world fields", !PRIVATE_FIELD_PATTERN.test(createdBlob));

  // 3. Auth negative paths
  const noToken = await fetchJson(`/incidents/${c.incidentId}/start`, { method: "POST" });
  check("start without token is 401", noToken.status === 401, `status=${noToken.status}`);
  const badToken = await fetchJson(`/incidents/${c.incidentId}/start`, { method: "POST", headers: { "x-incident-token": "nope" } });
  check("start with wrong token is 401", badToken.status === 401, `status=${badToken.status}`);
  const badWs = await new Promise((resolve) => {
    const ws = new WebSocket(`${SERVER_URL.replace(/^http/, "ws")}/incidents/${c.incidentId}/events?token=nope`);
    ws.onopen = () => resolve("open");
    ws.onerror = () => resolve("error");
    ws.onclose = () => resolve("closed");
  });
  check("events socket with wrong token is refused", badWs !== "open", badWs);

  // 4. Start via REST
  const started = await fetchJson(`/incidents/${c.incidentId}/start`, { method: "POST", headers: { "x-incident-token": c.token } });
  check("start with token succeeds", started.status === 200 && started.body?.started === true, JSON.stringify(started.body));
  const replayEarly = await fetchJson(`/incidents/${c.incidentId}/replay`, { headers: { "x-incident-token": c.token } });
  check("replay while active is 409", replayEarly.status === 409, `status=${replayEarly.status}`);

  // 5. Events socket
  const messages = [];
  let leak = null;
  let nonMonotonicSequence = null;
  let invalidEnvelope = null;
  let lastSequence = -1;
  const ws = new WebSocket(`${SERVER_URL.replace(/^http/, "ws")}${c.websocket.events}`);
  ws.onmessage = (event) => {
    const raw = String(event.data);
    if (leak === null && PRIVATE_FIELD_PATTERN.test(raw)) leak = raw.slice(0, 200);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalidEnvelope ??= raw.slice(0, 120);
      return;
    }
    if (parsed?.protocolVersion !== 1 || typeof parsed?.message?.type !== "string") invalidEnvelope ??= raw.slice(0, 120);
    const m = parsed.message;
    if (m?.type === "view") {
      if (m.view.sequence < lastSequence) nonMonotonicSequence ??= `${lastSequence} -> ${m.view.sequence}`;
      lastSequence = m.view.sequence;
    }
    messages.push(m);
  };
  const opened = await new Promise((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
  });
  check("events socket opens with token", opened);
  if (!opened) return;

  const firstView = await waitFor(() => messages.find((m) => m.type === "view"), 3000, "first view").catch(() => null);
  check("first frame after connect is a coordinator view", firstView !== null && messages[0]?.type === "view", messages[0]?.type);

  // 6. Commands
  ws.send(JSON.stringify({ protocolVersion: 1, message: { type: "inspect", agentId: "crew-1" } }));
  const inspection = await waitFor(() => messages.find((m) => m.type === "inspection"), 3000, "inspection").catch(() => null);
  check("inspect crew-1 yields an inspection message", inspection?.agentId === "crew-1" && typeof inspection?.callsign === "string", inspection ? `${inspection.callsign}: ${inspection.state}` : "none");

  ws.send(JSON.stringify({ protocolVersion: 1, message: { type: "inspect", agentId: "nobody" } }));
  const unknownAgent = await waitFor(() => messages.find((m) => m.type === "notice" && m.kind === "bad_message" && m.detail === "Unknown agent."), 3000, "unknown agent notice").catch(() => null);
  check("inspect unknown agent yields bad_message notice", unknownAgent !== null);

  ws.send("this is not json");
  const badMessage = await waitFor(() => messages.find((m) => m.type === "notice" && m.kind === "bad_message" && m.detail !== "Unknown agent."), 3000, "bad message notice").catch(() => null);
  check("malformed frame yields bad_message notice, socket stays open", badMessage !== null && ws.readyState === WebSocket.OPEN);

  const sayCount = messages.filter((m) => m.type === "receipt").length;
  ws.send(JSON.stringify({ protocolVersion: 1, message: { type: "say", text: "Crew 1, go to Ridge Cabins", idempotencyKey: `smoke-${Date.now()}` } }));
  const receipt = await waitFor(() => messages.filter((m) => m.type === "receipt").length > sayCount && messages.filter((m) => m.type === "receipt").at(-1), 3000, "receipt").catch(() => null);
  check("say yields a receipt with a reply", receipt !== null && typeof receipt.reply === "string", receipt ? `${receipt.receipt?.status ?? "?"}: ${receipt.reply}` : "none");

  // Idempotency: the same key twice must not produce two distinct applied commands.
  const key = `smoke-idem-${Date.now()}`;
  const before = messages.filter((m) => m.type === "receipt").length;
  ws.send(JSON.stringify({ protocolVersion: 1, message: { type: "say", text: "Crew 2, hold position", idempotencyKey: key } }));
  ws.send(JSON.stringify({ protocolVersion: 1, message: { type: "say", text: "Crew 2, hold position", idempotencyKey: key } }));
  await sleep(1000);
  const idemReceipts = messages.filter((m) => m.type === "receipt").slice(before);
  const distinctCommandIds = new Set(idemReceipts.map((r) => r.receipt?.commandId));
  check("duplicate idempotency key does not create two commands", distinctCommandIds.size <= 1, `receipts=${idemReceipts.length} distinct=${distinctCommandIds.size}`);

  // 7. Observe the live stream
  await sleep(OBSERVE_MS);
  const views = messages.filter((m) => m.type === "view");
  const lastView = views.at(-1);
  check("simulation clock advances while connected", views.length >= 2 && lastView.view.simTimeMs > firstView.view.simTimeMs, `${firstView?.view.simTimeMs} -> ${lastView?.view.simTimeMs} ms over ${views.length} views`);
  check("wallElapsedMs advances and is distinct from simTimeMs", lastView.view.wallElapsedMs > 0 && Number.isInteger(lastView.view.wallElapsedMs) && Number.isInteger(lastView.view.simTimeMs));
  check("view sequence is monotonic", nonMonotonicSequence === null, nonMonotonicSequence ?? "");
  check("every frame is a protocol v1 envelope", invalidEnvelope === null, invalidEnvelope ?? "");
  check("no private world fields in any frame", leak === null, leak ?? "");
  const kinds = [...new Set(messages.map((m) => m.type))].sort();
  check("stream contains views and at least one non-view message", kinds.includes("view") && kinds.length >= 2, kinds.join(","));
  const transcripts = messages.filter((m) => m.type === "transcript");
  check("transcript lines arrive on the events socket", transcripts.length >= 1, `${transcripts.length} lines`);

  // 8. Server-side pacing: docs/SIMULATION.md - one simulated second per 200 ms wall, so sim/wall should be ~5.
  const ratio = lastView.view.simTimeMs / Math.max(1, lastView.view.wallElapsedMs);
  check("sim keeps pace with wall clock (1 sim s per 200 ms; ratio within [4, 5.5])", ratio >= 4 && ratio <= 5.5, `sim/wall=${ratio.toFixed(2)}`);

  ws.close();

  // 9. Second client gets a fresh view immediately and the incident is not reset.
  const ws2 = new WebSocket(`${SERVER_URL.replace(/^http/, "ws")}${c.websocket.events}`);
  const second = await new Promise((resolve) => {
    ws2.onmessage = (event) => resolve(JSON.parse(String(event.data)).message);
    ws2.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 3000);
  });
  check("second client receives current view on connect (incident not reset)", second?.type === "view" && second.view.simTimeMs >= lastView.view.simTimeMs, `simTimeMs=${second?.view?.simTimeMs}`);
  ws2.close();

  // 10. Web dev server
  if (WEB_URL !== "") {
    const index = await fetch(`${WEB_URL}/`).then(async (r) => ({ status: r.status, text: await r.text() })).catch(() => ({ status: 0, text: "" }));
    check("web dev server serves index.html", index.status === 200 && index.text.includes("Ember Line") && index.text.includes("/src/main.tsx"), `status=${index.status}`);
    const proxied = await fetch(`${WEB_URL}/health`).then(async (r) => ({ status: r.status, body: await r.json() })).catch(() => ({ status: 0, body: null }));
    check("web dev server proxies /health to the server", proxied.status === 200 && proxied.body?.protocolVersion === 1, `status=${proxied.status}`);
    const proxiedCreate = await fetch(`${WEB_URL}/incidents`, { method: "POST" }).then(async (r) => ({ status: r.status, body: await r.json() })).catch(() => ({ status: 0, body: null }));
    check("web dev server proxies POST /incidents", proxiedCreate.status === 200 && typeof proxiedCreate.body?.incidentId === "string", `status=${proxiedCreate.status}`);
    if (proxiedCreate.body?.websocket?.events) {
      const proxiedWs = await new Promise((resolve) => {
        const s = new WebSocket(`${WEB_URL.replace(/^http/, "ws")}${proxiedCreate.body.websocket.events}`);
        s.onmessage = (event) => {
          resolve(JSON.parse(String(event.data)).message?.type);
          s.close();
        };
        s.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 3000);
      });
      check("web dev server proxies the events WebSocket", proxiedWs === "view", String(proxiedWs));
    }
  }

  process.stdout.write(`\n${results.length - failures}/${results.length} checks passed\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`smoke test crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
