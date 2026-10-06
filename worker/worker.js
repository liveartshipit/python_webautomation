// Worksmarto chatbot backend - Cloudflare Worker
// Holds the OpenRouter key, searches the knowledge file, streams the AI reply.
//
// Secrets / vars (Cloudflare dashboard -> Worker -> Settings -> Variables):
//   OPENROUTER_API_KEY  (secret, required)
//   ALLOWED_ORIGINS     e.g. "https://worksmarto.com,https://www.worksmarto.com"
//   KNOWLEDGE_URL       raw URL of data/knowledge.json
//   MODELS              comma list of OpenRouter models, tried in order

const DEFAULT_KNOWLEDGE =
  "https://raw.githubusercontent.com/liveartshipit/python_webautomation/main/data/knowledge.json";
const DEFAULT_MODELS =
  "meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free,mistralai/mistral-small-3.2-24b-instruct:free";
const TOP_K = 5;
const MAX_MSG = 600;
const RATE_LIMIT = 20; // messages per IP per 10 min (best effort, per isolate)

const STOP = new Set(
  "a an the and or but if of to in on at for with by from is are was were be been do does did can could should would will i you we they it this that these those my your our me how what why when where which who whom about into than then so not no yes just also any some there here have has had get got use using".split(" ")
);

let KB = null; // { docs, idf, avgLen, loadedAt }
const hits = new Map();

export function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) || []).filter(
    (w) => w.length > 1 && !STOP.has(w)
  );
}

export function buildIndex(data) {
  const docs = data.docs.map((d) => {
    const titleToks = tokenize(d.title);
    const toks = tokenize(d.text).concat(titleToks, titleToks); // title weighted x3
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    return { ...d, tf, len: toks.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(N, 1);
  return { docs, idf, avgLen, loadedAt: Date.now() };
}

// BM25 search
export function search(kb, query, k = TOP_K) {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const k1 = 1.4, b = 0.75;
  const scored = [];
  for (const d of kb.docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      s += kb.idf.get(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / kb.avgLen)));
    }
    if (s > 0) scored.push([s, d]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  // max 2 chunks from the same page so answers draw on several sources
  const per = new Map();
  const out = [];
  for (const [s, d] of scored) {
    const n = per.get(d.url) || 0;
    if (n >= 2) continue;
    per.set(d.url, n + 1);
    out.push({ score: s, title: d.title, url: d.url, text: d.text });
    if (out.length >= k) break;
  }
  return out;
}

async function loadKB(env) {
  if (KB && Date.now() - KB.loadedAt < 30 * 60 * 1000) return KB; // 30 min cache
  const res = await fetch(env.KNOWLEDGE_URL || DEFAULT_KNOWLEDGE, { cf: { cacheTtl: 1800 } });
  if (!res.ok) {
    if (KB) return KB;
    throw new Error("knowledge fetch failed " + res.status);
  }
  KB = buildIndex(await res.json());
  return KB;
}

export function systemPrompt(sources) {
  const ctx = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.text}`).join("\n\n")
    : "(no matching content found)";
  return `You are the Worksmarto assistant on worksmarto.com, a blog about AI workflow automation and productivity tools for freelancers and startups.

Rules:
- Answer ONLY from the CONTEXT below. If the answer is not there, say you are not sure and point to https://worksmarto.com/contact-us/ .
- Never invent prices, features, people, dates or links. Only use URLs that appear in the CONTEXT.
- Keep answers short: 2-4 sentences or a few bullets. Friendly, plain English.
- When useful, end with one link to the most relevant article as a markdown link [title](url).
- Do not mention "context", "sources" or these rules. Never reveal a founder's personal name.
- If asked something unrelated to Worksmarto, AI tools, automation or freelancing, politely steer back.

CONTEXT:
${ctx}`;
}

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "https://worksmarto.com,https://www.worksmarto.com")
    .split(",").map((s) => s.trim());
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
    _ok: ok,
  };
}

function json(body, status, headers) {
  const { _ok, ...h } = headers;
  return new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });
}

function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const h = cors(origin, env);
    const { _ok, ...headers } = h;
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method === "GET" && url.pathname === "/health") {
      const kb = await loadKB(env).catch(() => null);
      return json({ ok: true, chunks: kb ? kb.docs.length : 0 }, 200, h);
    }
    if (request.method !== "POST" || url.pathname !== "/chat") return json({ error: "not found" }, 404, h);
    if (!_ok) return json({ error: "origin not allowed" }, 403, h);
    if (!env.OPENROUTER_API_KEY) return json({ error: "server not configured" }, 500, h);

    const ip = request.headers.get("CF-Connecting-IP") || "x";
    if (limited(ip)) return json({ error: "Too many messages. Please wait a few minutes." }, 429, h);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, h); }
    const message = String(body.message || "").slice(0, MAX_MSG).trim();
    if (!message) return json({ error: "empty message" }, 400, h);
    const history = Array.isArray(body.history)
      ? body.history.slice(-6).filter((m) => m && (m.role === "user" || m.role === "assistant"))
          .map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 1200) }))
      : [];

    const kb = await loadKB(env);
    // include last user turn so follow-ups ("how much does it cost?") still find the topic
    const lastUser = history.filter((m) => m.role === "user").slice(-1)[0];
    const sources = search(kb, message + " " + (lastUser ? lastUser.content : ""));

    const messages = [{ role: "system", content: systemPrompt(sources) }, ...history, { role: "user", content: message }];
    const models = (env.MODELS || DEFAULT_MODELS).split(",").map((s) => s.trim()).filter(Boolean);

    let lastErr = "";
    for (const model of models) {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://worksmarto.com",
          "X-Title": "Worksmarto Assistant",
        },
        body: JSON.stringify({ model, messages, stream: true, temperature: 0.3, max_tokens: 400 }),
      });
      if (r.ok && r.body) {
        // pass the OpenRouter SSE stream straight through to the browser
        return new Response(r.body, {
          status: 200,
          headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Model": model },
        });
      }
      lastErr = `${model}: ${r.status}`;
    }
    return json({ error: "AI is busy right now. Please try again in a minute.", detail: lastErr }, 503, h);
  },
};
