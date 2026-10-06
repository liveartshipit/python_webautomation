/* Worksmarto chat widget v2
 * Embed (WordPress adds this automatically; for micro SaaS sites copy it from Settings -> Worksmarto Bot):
 * <script src="https://cdn.jsdelivr.net/gh/liveartshipit/python_webautomation@<ref>/widget/chatbot.js"
 *   data-api="https://worksmarto.com/wp-json/wsbot/v1" data-position="left" defer></script>
 * Options: data-color, data-title, data-position (left|right), data-tour (1|0), data-capture (1|0), data-privacy
 */
(function () {
  if (window.__wsChat) return;
  window.__wsChat = true;

  var script = document.currentScript || document.querySelector('script[src*="chatbot.js"]');
  var ds = (script && script.dataset) || {};
  var API = (ds.api || "").replace(/\/$/, "");
  var COLOR = ds.color || "#4f46e5";
  var TITLE = ds.title || "Worksmarto Assistant";
  var SIDE = ds.position === "left" ? "left" : "right"; // left keeps clear of Tidio on the right
  var TOUR_ON = ds.tour !== "0";
  var CAPTURE_ON = ds.capture !== "0";
  var PRIVACY = ds.privacy || "https://worksmarto.com/privacy-policy/";
  var AI_NAME = ds.ai || "an AI provider";
  var TERMS = ds.terms || "https://worksmarto.com/terms-and-conditions/";
  var FAQ_URL = ds.faq || "https://cdn.jsdelivr.net/gh/liveartshipit/python_webautomation@main/data/faq.json";
  var CONSENT_TEXT = "I agree to receive emails with new AI workflows from Worksmarto. I can unsubscribe anytime.";

  /* ---------- page context ---------- */
  var meta = function (n) { var m = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return m ? m.content : ""; };
  var host = location.hostname.replace(/^www\./, "");
  var IS_ARTICLE = meta("og:type") === "article" || document.body.classList.contains("single-post");
  var IS_SAAS = !/^worksmarto\.com$/.test(host) && /\.worksmarto\.com$/.test(host);
  var PAGE_TITLE = (meta("og:title") || document.title || "").replace(/\s*[|–—-]\s*Worksmarto.*$/i, "").trim();

  function pageContext() {
    var root = document.querySelector("article, main, .entry-content, #main, [role=main]") || document.body;
    var clone = root.cloneNode(true);
    // never send form fields, scripts or our own widget
    clone.querySelectorAll("form, input, textarea, select, script, style, nav, footer, header, #wsc-box, #wsc-btn, #wsc-teaser").forEach(function (n) { n.remove(); });
    var text = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 1500);
    return { url: location.href.split("#")[0], title: PAGE_TITLE, text: text };
  }

  /* ---------- consent-aware storage ---------- */
  // Long-term memory (localStorage) only with the visitor's "preferences" consent (Complianz); otherwise per-session only.
  function store() {
    try {
      var ok = typeof window.cmplz_has_consent === "function" && window.cmplz_has_consent("preferences");
      return ok ? window.localStorage : window.sessionStorage;
    } catch (e) { return null; }
  }
  function getFlag(k) { try { var s = store(); var v = s && s.getItem("wsc_" + k); if (!v) return null; var o = JSON.parse(v); return o.exp && o.exp < Date.now() ? null : o.v; } catch (e) { return null; } }
  function setFlag(k, v, days) { try { var s = store(); s && s.setItem("wsc_" + k, JSON.stringify({ v: v, exp: days ? Date.now() + days * 864e5 : 0 })); } catch (e) {} }

  /* ---------- state ---------- */
  var history = [];
  var busy = false;
  var botReplies = 0;
  var captureShown = false;
  var welcome = null;
  var faq = [];
  var sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  /* ---------- styles ---------- */
  var css = "\
#wsc-btn{position:fixed;" + SIDE + ":20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:" + COLOR + ";color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s}\
#wsc-btn:hover{transform:scale(1.06)}\
#wsc-btn:focus-visible,#wsc-box button:focus-visible,#wsc-box input:focus-visible{outline:2px solid " + COLOR + ";outline-offset:2px}\
#wsc-teaser{position:fixed;" + SIDE + ":20px;bottom:88px;max-width:260px;background:#fff;color:#1f2937;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.18);z-index:2147483000;font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}\
#wsc-teaser b{display:block;margin-bottom:6px}\
#wsc-teaser .row{display:flex;gap:8px;margin-top:8px}\
#wsc-teaser .x{position:absolute;top:4px;right:8px;border:0;background:none;font-size:18px;cursor:pointer;color:#9ca3af}\
#wsc-box{position:fixed;" + SIDE + ":20px;bottom:90px;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937}\
#wsc-box.open{display:flex}\
#wsc-head{background:" + COLOR + ";color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;font-weight:600}\
#wsc-head small{display:block;font-weight:400;font-size:12px;opacity:.85}\
#wsc-head button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}\
#wsc-msgs{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}\
.wsc-m{max-width:88%;padding:9px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}\
.wsc-bot{background:#fff;border:1px solid #e5e7eb;align-self:flex-start;border-bottom-left-radius:4px}\
.wsc-me{background:" + COLOR + ";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}\
.wsc-bot a,.wsc-card a{color:" + COLOR + ";font-weight:600}\
.wsc-chips{display:flex;flex-wrap:wrap;gap:6px}\
.wsc-chip{border:1px solid " + COLOR + ";color:" + COLOR + ";background:#fff;border-radius:999px;padding:6px 11px;font-size:13px;cursor:pointer}\
.wsc-btnp{border:0;background:" + COLOR + ";color:#fff;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer}\
.wsc-btns{border:0;background:none;color:#6b7280;padding:7px 4px;font-size:13px;cursor:pointer}\
.wsc-card{align-self:stretch;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}\
.wsc-card h4{margin:0;font-size:14px}\
.wsc-card p{margin:0;font-size:14px}\
.wsc-step{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}\
.wsc-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}\
.wsc-list li{font-size:14px}\
.wsc-tag{font-size:10px;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:1px 5px;margin-right:6px;background:#eef2ff;color:" + COLOR + "}\
.wsc-rel{align-self:flex-start;max-width:88%;font-size:13px;color:#6b7280}\
.wsc-rel a{color:" + COLOR + "}\
.wsc-card input[type=email]{border:1px solid #d1d5db;border-radius:8px;padding:8px 10px;font:inherit;width:100%;box-sizing:border-box;background:#fff;color:inherit}\
.wsc-card label{font-size:12px;display:flex;gap:6px;align-items:flex-start;color:#4b5563}\
.wsc-err{font-size:12px;color:#b91c1c}\
.wsc-dots span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#9ca3af;animation:wscb 1s infinite}\
.wsc-dots span:nth-child(2){animation-delay:.15s}.wsc-dots span:nth-child(3){animation-delay:.3s}\
@keyframes wscb{0%,80%,100%{opacity:.3}40%{opacity:1}}\
@media (prefers-reduced-motion:reduce){.wsc-dots span{animation:none}#wsc-btn{transition:none}}\
#wsc-form{display:flex;border-top:1px solid #e5e7eb;background:#fff}\
#wsc-in{flex:1;min-width:0;border:0;padding:14px;font:inherit;outline:none;background:transparent;color:inherit}\
#wsc-send{border:0;background:none;color:" + COLOR + ";font-weight:700;padding:0 16px;cursor:pointer}\
#wsc-foot{font-size:11px;line-height:1.35;color:#9ca3af;text-align:center;padding:5px 12px 7px;background:#fff}\
#wsc-foot a{color:inherit}\
@media (prefers-color-scheme:dark){#wsc-box,#wsc-teaser{background:#111827;color:#e5e7eb}#wsc-msgs{background:#0b1220}.wsc-bot,.wsc-card{background:#1f2937;border-color:#374151}#wsc-form,#wsc-foot{background:#111827;border-color:#374151}.wsc-chip{background:#111827}.wsc-card input[type=email]{background:#111827;border-color:#4b5563}.wsc-card label{color:#9ca3af}.wsc-tag{background:#312e81;color:#c7d2fe}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------- DOM ---------- */
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function render(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  var btn = el("button", { id: "wsc-btn", "aria-label": "Open chat", type: "button" },
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>');
  var box = el("div", { id: "wsc-box", role: "dialog", "aria-label": TITLE },
    '<div id="wsc-head"><span>' + esc(TITLE) + '<small>AI assistant</small></span><button type="button" aria-label="Close">&times;</button></div>' +
    '<div id="wsc-msgs" aria-live="polite"></div>' +
    '<form id="wsc-form"><input id="wsc-in" placeholder="Type your question..." autocomplete="off" maxlength="600" aria-label="Your question"><button id="wsc-send" type="submit">Send</button></form>' +
    '<div id="wsc-foot">AI assistant (answers by ' + esc(AI_NAME) + ') for ages 18+. Answers can be wrong and are not professional advice. Don\'t share personal details; chats are stored anonymously for 90 days. <a href="' + esc(PRIVACY) + '" target="_blank" rel="noopener">Privacy</a> · <a href="' + esc(TERMS) + '" target="_blank" rel="noopener">Terms</a></div>');
  document.body.appendChild(btn);
  document.body.appendChild(box);

  var msgs = box.querySelector("#wsc-msgs");
  var input = box.querySelector("#wsc-in");
  var started = false;

  btn.onclick = function () { toggle(); };
  box.querySelector("#wsc-head button").onclick = function () { toggle(false); };
  box.querySelector("#wsc-form").onsubmit = function (e) { e.preventDefault(); send(input.value); };

  function scroll() { msgs.scrollTop = msgs.scrollHeight; }
  function addMe(t) { var d = el("div", { class: "wsc-m wsc-me" }); d.textContent = t; msgs.appendChild(d); scroll(); }
  function addBot(t) { var d = el("div", { class: "wsc-m wsc-bot" }, render(t)); msgs.appendChild(d); scroll(); return d; }
  function addNode(n) { msgs.appendChild(n); scroll(); return n; }

  function api(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
        return j;
      });
    });
  }
  function loadWelcome() {
    if (welcome) return Promise.resolve(welcome);
    return api("/welcome").then(function (j) { welcome = j; return j; }).catch(function () { welcome = { tour: [], trending: [] }; return welcome; });
  }

  /* ---------- teaser for first-time visitors ---------- */
  function showTeaser() {
    if (!TOUR_ON || getFlag("seen") || document.getElementById("wsc-teaser") || box.classList.contains("open")) return;
    setFlag("seen", 1, 180);
    var t = el("div", { id: "wsc-teaser", role: "status" },
      '<button class="x" type="button" aria-label="Dismiss">&times;</button><b>New here?</b>Take a 30-second tour of Worksmarto, or ask me anything.' +
      '<div class="row"><button class="wsc-btnp" type="button">Start tour</button><button class="wsc-btns" type="button">Ask a question</button></div>');
    document.body.appendChild(t);
    t.querySelector(".x").onclick = function () { t.remove(); };
    t.querySelector(".wsc-btnp").onclick = function () { t.remove(); toggle(true); startTour(); };
    t.querySelector(".wsc-btns").onclick = function () { t.remove(); toggle(true); };
  }
  if (TOUR_ON && !IS_SAAS) setTimeout(showTeaser, 6000);

  /* ---------- open / greeting ---------- */
  function toggle(force) {
    var open = typeof force === "boolean" ? force : !box.classList.contains("open");
    box.classList.toggle("open", open);
    var t = document.getElementById("wsc-teaser");
    if (t) t.remove();
    if (!open) return;
    if (!started) {
      started = true;
      if (!faq.length) fetch(FAQ_URL).then(function (r) { return r.json(); }).then(function (d) { faq = d || []; }).catch(function () {});
      greet();
    }
    input.focus();
  }

  function greet() {
    var chips = [];
    if (IS_ARTICLE && PAGE_TITLE) {
      addBot("Questions about this guide? I can explain \"" + PAGE_TITLE + "\" or anything else on Worksmarto.");
      chips = ["Summarize this guide", "Popular reads", "Take the tour"];
    } else if (IS_SAAS) {
      addBot("Hi! Questions about " + (PAGE_TITLE || "this tool") + "? I can help you use it, or answer anything about Worksmarto.");
      chips = ["How does this tool work?", "Popular reads", "Contact the team"];
    } else {
      addBot("Hi! Ask me anything about AI tools, automation workflows or Worksmarto.");
      chips = ["Take the tour", "Popular reads", "What is an MCP server?", "Contact the team"];
    }
    var row = el("div", { class: "wsc-chips" });
    chips.forEach(function (c) {
      var b = el("button", { class: "wsc-chip", type: "button" });
      b.textContent = c;
      b.onclick = function () { row.remove(); onChip(c); };
      row.appendChild(b);
    });
    addNode(row);
  }

  function onChip(c) {
    if (c === "Take the tour") return startTour();
    if (c === "Popular reads") return showPopular();
    if (c === "Summarize this guide") return send("Summarize this guide in a few bullet points.", c);
    send(c);
  }

  /* ---------- tour ---------- */
  function startTour() {
    var step = 0;
    loadWelcome().then(function (w) {
      var steps = (w.tour || []).slice(0, 5);
      if (!steps.length) return addBot("Ask me anything about Worksmarto's AI workflows and tools.");
      var card = addNode(el("div", { class: "wsc-card" }));
      function draw() {
        var s = steps[step];
        card.innerHTML = '<span class="wsc-step">Tour ' + (step + 1) + " of " + steps.length + "</span><h4>" + esc(s.title) + "</h4><p>" + esc(s.text) + "</p>" +
          '<div class="wsc-chips">' + (s.url ? '<a class="wsc-chip" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.cta || "Open") + "</a>" : "") +
          (step < steps.length - 1 ? '<button class="wsc-btnp" type="button" data-n>Next</button>' : '<button class="wsc-btnp" type="button" data-p>Show popular reads</button>') + "</div>";
        var n = card.querySelector("[data-n]");
        if (n) n.onclick = function () { step++; draw(); scroll(); };
        var p = card.querySelector("[data-p]");
        if (p) p.onclick = function () { showPopular(); };
        scroll();
      }
      draw();
    });
  }

  /* ---------- popular reads ---------- */
  function showPopular() {
    loadWelcome().then(function (w) {
      var list = w.trending || [];
      if (!list.length) return addBot("Browse the latest guides at https://worksmarto.com/blog/");
      var card = el("div", { class: "wsc-card" }, "<h4>Worth reading</h4>");
      var ul = el("ul", { class: "wsc-list" });
      list.forEach(function (p) {
        ul.appendChild(el("li", null, '<span class="wsc-tag">' + esc(p.label || "") + '</span><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.title) + "</a>"));
      });
      card.appendChild(ul);
      addNode(card);
    });
  }

  /* ---------- email capture (explicit consent) ---------- */
  function maybeCapture(reason) {
    if (!CAPTURE_ON || captureShown || getFlag("sub")) return;
    if (reason !== "noanswer" && botReplies < 3) return;
    captureShown = true;
    var card = el("div", { class: "wsc-card" },
      "<h4>Get new AI workflows by email</h4><p>" + (reason === "noanswer" ? "I couldn't fully answer that one. " : "") + "One practical workflow at a time. No spam.</p>" +
      '<input type="email" placeholder="you@example.com" aria-label="Email address" autocomplete="email">' +
      '<label><input type="checkbox"> <span>' + esc(CONSENT_TEXT) + ' <a href="' + esc(PRIVACY) + '" target="_blank" rel="noopener">Privacy policy</a></span></label>' +
      '<div class="wsc-err" hidden></div>' +
      '<div class="wsc-chips"><button class="wsc-btnp" type="button">Subscribe</button><button class="wsc-btns" type="button">No thanks</button></div>');
    var email = card.querySelector("input[type=email]");
    var box2 = card.querySelector("input[type=checkbox]");
    var err = card.querySelector(".wsc-err");
    card.querySelector(".wsc-btns").onclick = function () { setFlag("sub", "dismissed", 30); card.remove(); };
    card.querySelector(".wsc-btnp").onclick = function () {
      err.hidden = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { err.textContent = "Please enter a valid email address."; err.hidden = false; return; }
      if (!box2.checked) { err.textContent = "Please tick the box to agree to receive emails."; err.hidden = false; return; }
      var b = this; b.disabled = true; b.textContent = "Subscribing...";
      api("/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value.trim(), consent: true, consent_text: CONSENT_TEXT, page: { url: location.href.split("#")[0] } }),
      }).then(function (j) {
        setFlag("sub", "yes", 365);
        card.innerHTML = "<h4>You're in.</h4><p>" + (j.confirm ? "Check your inbox to confirm your subscription." : "Thanks for subscribing.") + "</p>";
      }).catch(function (e) { err.textContent = e.message; err.hidden = false; b.disabled = false; b.textContent = "Subscribe"; });
    };
    addNode(card);
  }

  /* ---------- FAQ instant answers ---------- */
  function norm(s) { return " " + s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim() + " "; }
  function faqMatch(q) {
    var n = norm(q), best = null, bestLen = 0;
    faq.forEach(function (f) {
      (f.keys || []).forEach(function (k) {
        var kk = norm(k);
        if (n.indexOf(kk) !== -1 && kk.length > bestLen) { best = f; bestLen = kk.length; }
      });
    });
    return best && q.split(/\s+/).length <= 9 ? best : null;
  }

  /* ---------- send ---------- */
  function send(text, shown) {
    text = (text || "").trim();
    if (!text || busy) return;
    input.value = "";
    addMe(shown || text);

    var f = faqMatch(text);
    if (f) {
      addBot(f.a + (f.url ? "\n\n[Read more](" + f.url + ")" : ""));
      history.push({ role: "user", content: text }, { role: "assistant", content: f.a });
      botReplies++;
      maybeCapture("count");
      return;
    }
    ask(text);
  }

  function ask(text) {
    if (!API) { addBot("Chat is not configured yet."); return; }
    busy = true;
    var bubble = addNode(el("div", { class: "wsc-m wsc-bot" }, '<span class="wsc-dots"><span></span><span></span><span></span></span>'));
    var out = "";
    var answered = true;
    var related = [];
    fetch(API + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history.slice(-6), page: pageContext(), sid: sid }),
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || "Something went wrong. Please try again."); });
      }
      // WordPress backend: JSON {reply, answered, related}
      if ((res.headers.get("Content-Type") || "").indexOf("application/json") !== -1) {
        return res.json().then(function (j) {
          out = j.reply || "";
          answered = j.answered !== false;
          related = j.related || [];
          if (j.declined) captureShown = true;
          bubble.innerHTML = render(out);
          scroll();
        });
      }
      // Cloudflare Worker: streamed (SSE)
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (line.indexOf("data:") !== 0) return;
            var data = line.slice(5).trim();
            if (data === "[DONE]") return;
            try {
              var d = JSON.parse(data).choices[0].delta.content;
              if (d) { out += d; bubble.innerHTML = render(out); scroll(); }
            } catch (e) {}
          });
          return pump();
        });
      }
      return pump();
    }).then(function () {
      if (!out) { out = "Sorry, I couldn't answer that. You can reach the team at https://worksmarto.com/contact-us/"; bubble.innerHTML = render(out); answered = false; }
      history.push({ role: "user", content: text }, { role: "assistant", content: out });
      botReplies++;
      if (related.length) {
        addNode(el("div", { class: "wsc-rel" }, "Related: " + related.map(function (r) {
          return '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + "</a>";
        }).join(" · ")));
      }
      maybeCapture(answered ? "count" : "noanswer");
    }).catch(function (e) {
      bubble.innerHTML = render(e.message || "Network error. Please try again.");
    }).then(function () { busy = false; input.focus(); });
  }
})();
