/* Worksmarto chat widget
 * Embed:
 * <script src="https://cdn.jsdelivr.net/gh/liveartshipit/python_webautomation@main/widget/chatbot.js"
 *   data-api="https://worksmarto-chatbot.YOUR-SUBDOMAIN.workers.dev" defer></script>
 * Optional: data-color="#4f46e5" data-title="Worksmarto Assistant"
 */
(function () {
  if (window.__wsChat) return;
  window.__wsChat = true;

  var script = document.currentScript || document.querySelector('script[src*="chatbot.js"]');
  var API = (script && script.dataset.api || "").replace(/\/$/, "");
  var COLOR = (script && script.dataset.color) || "#4f46e5";
  var TITLE = (script && script.dataset.title) || "Worksmarto Assistant";
  var FAQ_URL = (script && script.dataset.faq) ||
    "https://cdn.jsdelivr.net/gh/liveartshipit/python_webautomation@main/data/faq.json";
  var GREETING = "Hi! Ask me anything about AI tools, automation workflows or Worksmarto.";
  var CHIPS = ["What is an MCP server?", "Free workflow generator?", "Zapier vs Make vs n8n", "Contact the team"];

  var faq = [];
  fetch(FAQ_URL).then(function (r) { return r.json(); }).then(function (d) { faq = d || []; }).catch(function () {});

  var history = [];
  var busy = false;

  var css = "\
#wsc-btn{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:" + COLOR + ";color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s}\
#wsc-btn:hover{transform:scale(1.06)}\
#wsc-box{position:fixed;right:20px;bottom:90px;width:370px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937}\
#wsc-box.open{display:flex}\
#wsc-head{background:" + COLOR + ";color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;font-weight:600}\
#wsc-head button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}\
#wsc-msgs{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}\
.wsc-m{max-width:85%;padding:9px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}\
.wsc-bot{background:#fff;border:1px solid #e5e7eb;align-self:flex-start;border-bottom-left-radius:4px}\
.wsc-me{background:" + COLOR + ";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}\
.wsc-bot a{color:" + COLOR + ";font-weight:600}\
.wsc-chips{display:flex;flex-wrap:wrap;gap:6px}\
.wsc-chip{border:1px solid " + COLOR + ";color:" + COLOR + ";background:#fff;border-radius:999px;padding:5px 11px;font-size:13px;cursor:pointer}\
.wsc-dots span{display:inline-block;width:7px;height:7px;margin:0 2px;border-radius:50%;background:#9ca3af;animation:wscb 1s infinite}\
.wsc-dots span:nth-child(2){animation-delay:.15s}.wsc-dots span:nth-child(3){animation-delay:.3s}\
@keyframes wscb{0%,80%,100%{opacity:.3}40%{opacity:1}}\
#wsc-form{display:flex;border-top:1px solid #e5e7eb;background:#fff}\
#wsc-in{flex:1;border:0;padding:14px;font:inherit;outline:none;background:transparent;color:inherit}\
#wsc-send{border:0;background:none;color:" + COLOR + ";font-weight:700;padding:0 16px;cursor:pointer}\
#wsc-foot{font-size:11px;color:#9ca3af;text-align:center;padding:4px 0 6px;background:#fff}\
@media (prefers-color-scheme:dark){#wsc-box{background:#111827;color:#e5e7eb}#wsc-msgs{background:#0b1220}.wsc-bot{background:#1f2937;border-color:#374151}#wsc-form,#wsc-foot{background:#111827;border-color:#374151}.wsc-chip{background:#111827}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var btn = el("button", { id: "wsc-btn", "aria-label": "Open chat" });
  btn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var box = el("div", { id: "wsc-box", role: "dialog", "aria-label": TITLE });
  box.innerHTML = '<div id="wsc-head"><span>' + esc(TITLE) + '</span><button aria-label="Close">&times;</button></div>' +
    '<div id="wsc-msgs"></div>' +
    '<form id="wsc-form"><input id="wsc-in" placeholder="Type your question..." autocomplete="off" maxlength="600"><button id="wsc-send" type="submit">Send</button></form>' +
    '<div id="wsc-foot">AI answers can be wrong. Check linked articles.</div>';
  document.body.appendChild(btn);
  document.body.appendChild(box);

  var msgs = box.querySelector("#wsc-msgs");
  var input = box.querySelector("#wsc-in");
  var started = false;

  btn.onclick = toggle;
  box.querySelector("#wsc-head button").onclick = toggle;
  box.querySelector("#wsc-form").onsubmit = function (e) {
    e.preventDefault();
    send(input.value);
  };

  function toggle() {
    box.classList.toggle("open");
    if (box.classList.contains("open")) {
      if (!started) {
        started = true;
        addBot(GREETING);
        var chips = el("div", { class: "wsc-chips" });
        CHIPS.forEach(function (c) {
          var b = el("button", { class: "wsc-chip", type: "button" });
          b.textContent = c;
          b.onclick = function () { chips.remove(); send(c); };
          chips.appendChild(b);
        });
        msgs.appendChild(chips);
      }
      input.focus();
    }
  }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // safe mini-markdown: escape, then links + bold
  function render(s) {
    return esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }
  function addMe(t) {
    var d = el("div", { class: "wsc-m wsc-me" });
    d.textContent = t;
    msgs.appendChild(d);
    scroll();
  }
  function addBot(t) {
    var d = el("div", { class: "wsc-m wsc-bot" });
    d.innerHTML = render(t);
    msgs.appendChild(d);
    scroll();
    return d;
  }
  function scroll() { msgs.scrollTop = msgs.scrollHeight; }

  function norm(s) { return " " + s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim() + " "; }
  function faqMatch(q) {
    var n = norm(q);
    var best = null, bestLen = 0;
    faq.forEach(function (f) {
      (f.keys || []).forEach(function (k) {
        var kk = norm(k);
        if (n.indexOf(kk) !== -1 && kk.length > bestLen) { best = f; bestLen = kk.length; }
      });
    });
    // only short questions get the instant answer; long ones go to the AI
    return best && q.split(/\s+/).length <= 9 ? best : null;
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    input.value = "";
    addMe(text);

    var f = faqMatch(text);
    if (f) {
      var ans = f.a + (f.url ? "\n\n[Read more](" + f.url + ")" : "");
      addBot(ans);
      history.push({ role: "user", content: text }, { role: "assistant", content: f.a });
      return;
    }
    ask(text);
  }

  function ask(text) {
    if (!API) { addBot("Chat is not configured yet."); return; }
    busy = true;
    var bubble = el("div", { class: "wsc-m wsc-bot" });
    bubble.innerHTML = '<span class="wsc-dots"><span></span><span></span><span></span></span>';
    msgs.appendChild(bubble);
    scroll();

    var out = "";
    fetch(API + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: history.slice(-6) }),
    }).then(function (res) {
      if (!res.ok || !res.body) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || "Something went wrong. Please try again.");
        });
      }
      // WordPress backend replies with JSON {reply}; the Cloudflare Worker streams
      if ((res.headers.get("Content-Type") || "").indexOf("application/json") !== -1) {
        return res.json().then(function (j) { out = j.reply || ""; bubble.innerHTML = render(out); scroll(); });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
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
              var j = JSON.parse(data);
              var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (delta) { out += delta; bubble.innerHTML = render(out); scroll(); }
            } catch (e) {}
          });
          return pump();
        });
      }
      return pump();
    }).then(function () {
      if (!out) { out = "Sorry, I couldn't answer that. You can reach the team at https://worksmarto.com/contact-us/"; bubble.innerHTML = render(out); }
      history.push({ role: "user", content: text }, { role: "assistant", content: out });
    }).catch(function (e) {
      bubble.innerHTML = render(e.message || "Network error. Please try again.");
    }).then(function () { busy = false; input.focus(); });
  }
})();
