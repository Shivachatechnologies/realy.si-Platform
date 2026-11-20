/**
 * The embeddable website chat widget (vanilla JS, no dependencies), served by ./route.ts as /api/public/chat/widget.js.
 * Embed: <script src="https://APP/api/public/chat/widget.js" data-key="lc_…" async></script>
 *
 * Renders inside a closed Shadow DOM on the host page (no iframe, so the app's frame-ancestors 'none' CSP stays as is);
 * styles go through a constructable stylesheet (falls back to a <style> element). Talks to /api/public/chat/* with
 * CORS (the company's allowed origins). Visitor language is auto-detected from the browser (closest of the 5 locales);
 * strings come localized from the server. Accessible: labelled dialog, live region log, focus handling, Escape to
 * close, reduced-motion aware, RTL aware, full-screen on small screens. The visitor token is kept in localStorage.
 *
 * Kept free of backticks and dollar-brace sequences: it is embedded in a template literal.
 */
export const WIDGET_JS = String.raw`(function () {
  "use strict";
  if (window.__realyChat) return;
  var script = document.currentScript || document.querySelector('script[data-key][src*="/api/public/chat/widget.js"]');
  if (!script) return;
  var key = script.getAttribute("data-key") || "";
  if (!/^lc_[A-Za-z0-9]{8,40}$/.test(key)) return;
  var base = new URL(script.src, location.href).origin;
  var api = function (path) { return base + "/api/public/chat/" + path + "?key=" + encodeURIComponent(key); };
  var storeKey = "realy_lc_" + key;
  var store = {
    get: function () { try { return localStorage.getItem(storeKey); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem(storeKey, v); } catch (e) { /* storage blocked */ } },
  };
  var state = { token: store.get(), conv: null, status: null, messages: [], last: null, open: false, busy: false, typing: false, contactShared: false, unread: 0, cfg: null, s: null, timer: null, closed: false };

  function req(method, path, body) {
    return fetch(api(path) + (method === "GET" && body ? "&" + new URLSearchParams(body).toString() : ""), {
      method: method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      credentials: "omit",
      mode: "cors",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.error && d.error.code) || "error"); e.code = (d && d.error && d.error.code) || "error"; throw e; }
        return d;
      });
    });
  }

  function textOn(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var l = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    var lum = 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
    return lum > 0.4 ? "#111827" : "#ffffff";
  }

  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans','Noto Sans Arabic','Noto Sans Devanagari','Noto Sans SC',sans-serif}",
    ".root{position:fixed;bottom:20px;z-index:2147483000;font-size:15px;line-height:1.45;color:#111827}",
    ".root.right{right:20px}.root.left{left:20px}",
    ".launcher{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:var(--brand);color:var(--on);box-shadow:0 8px 24px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;position:relative}",
    ".launcher:focus-visible,button:focus-visible,textarea:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #2563eb;outline-offset:2px}",
    ".badge{position:absolute;top:-2px;inset-inline-end:-2px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}",
    ".panel{position:absolute;bottom:72px;width:min(380px,calc(100vw - 32px));height:min(600px,calc(100vh - 120px));background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.25);display:flex;flex-direction:column;overflow:hidden;transition:opacity .18s ease,transform .18s ease}",
    ".right .panel{right:0}.left .panel{left:0}",
    ".panel[hidden]{display:none}",
    ".head{background:var(--brand);color:var(--on);padding:14px 14px 12px;display:flex;align-items:flex-start;gap:10px}",
    ".head h2{margin:0;font-size:16px;font-weight:650}",
    ".tag{display:inline-block;margin-top:3px;font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.22)}",
    ".grow{flex:1;min-width:0}",
    ".icon{background:transparent;border:0;color:inherit;cursor:pointer;padding:6px;border-radius:8px;font-size:13px;line-height:1}",
    ".icon:hover{background:rgba(255,255,255,.18)}",
    ".disclosure{font-size:12px;color:#4b5563;background:#f3f4f6;padding:8px 14px;margin:0}",
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#fafafa}",
    ".msg{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}",
    ".msg.v{align-self:flex-end;background:var(--brand);color:var(--on);border-end-end-radius:4px}",
    ".msg.a{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-end-start-radius:4px}",
    ".who{display:block;font-size:11px;font-weight:600;color:#6b7280;margin-bottom:2px}",
    ".event{align-self:center;font-size:12px;color:#4b5563;background:#eef2ff;padding:4px 10px;border-radius:999px;text-align:center}",
    ".typing{align-self:flex-start;font-size:12px;color:#6b7280;font-style:italic}",
    ".card{align-self:stretch;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px;display:grid;gap:8px}",
    ".card h3{margin:0;font-size:14px}.card p{margin:0;font-size:12px;color:#4b5563}",
    "label{display:grid;gap:3px;font-size:12px;font-weight:600;color:#374151}",
    "input[type=text],input[type=email]{font:inherit;font-weight:400;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;width:100%}",
    ".check{display:flex;gap:8px;align-items:flex-start;font-weight:400}",
    ".check input{margin-top:3px}",
    ".foot{border-top:1px solid #e5e7eb;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff}",
    "textarea{flex:1;font:inherit;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;max-height:120px;min-height:42px}",
    ".btn{background:var(--brand);color:var(--on);border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer;font-size:14px}",
    ".btn[disabled]{opacity:.55;cursor:default}",
    ".link{background:none;border:0;color:#1d4ed8;text-decoration:underline;cursor:pointer;font-size:12px;padding:0}",
    ".err{color:#b91c1c;font-size:12px;padding:0 14px 6px;margin:0}",
    ".hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}",
    "@media (max-width:480px){.root.open{inset:0;bottom:0}.root.open .panel{position:fixed;inset:0;width:100%;height:100%;border-radius:0;bottom:0}.root.open .launcher{display:none}}",
    "@media (prefers-reduced-motion:reduce){.panel{transition:none}}",
  ].join("\n");

  var host = document.createElement("div");
  host.setAttribute("data-realy-chat", "");
  var shadow = host.attachShadow({ mode: "closed" });
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (e) {
    var st = document.createElement("style");
    st.textContent = CSS;
    shadow.appendChild(st);
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "on") for (var ev in attrs.on) n.addEventListener(ev, attrs.on[ev]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  var ui = {};
  function build() {
    var s = state.s, c = state.cfg;
    var root = el("div", { class: "root " + (c.position === "left" ? "left" : "right"), dir: state.dir || "ltr", lang: state.locale });
    root.style.setProperty("--brand", c.brandColor);
    root.style.setProperty("--on", textOn(c.brandColor));
    ui.badge = el("span", { class: "badge", hidden: true, "aria-hidden": "true" });
    ui.launcher = el("button", { class: "launcher", type: "button", "aria-label": s.launcher, "aria-expanded": "false", "aria-controls": "realy-chat-panel", on: { click: toggle } }, [
      svg('<path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
      ui.badge,
    ]);
    ui.title = el("h2", { id: "realy-chat-title", text: c.assistantName + " · " + c.company });
    ui.human = el("button", { class: "icon", type: "button", text: s.human, on: { click: askHuman } });
    var closeBtn = el("button", { class: "icon", type: "button", "aria-label": s.close, on: { click: toggle } }, [svg('<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>')]);
    var head = el("div", { class: "head" }, [el("div", { class: "grow" }, [ui.title, el("span", { class: "tag", text: s.aiBadge })]), ui.human, closeBtn]);
    ui.log = el("div", { class: "log", role: "log", "aria-live": "polite", "aria-relevant": "additions", tabindex: "0" });
    ui.err = el("p", { class: "err", role: "alert", hidden: true });
    ui.input = el("textarea", { rows: "1", maxlength: "2000", placeholder: s.placeholder, "aria-label": s.placeholder, on: { keydown: onKey, input: autosize } });
    ui.hp = el("input", { class: "hp", type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    ui.send = el("button", { class: "btn", type: "submit", text: s.send });
    var form = el("form", { class: "foot", on: { submit: function (e) { e.preventDefault(); send(); } } }, [ui.hp, ui.input, ui.send]);
    ui.panel = el("div", { class: "panel", id: "realy-chat-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "realy-chat-title", hidden: true, on: { keydown: function (e) { if (e.key === "Escape") toggle(); } } }, [
      head,
      el("p", { class: "disclosure", text: s.disclosure }),
      ui.log,
      ui.err,
      form,
    ]);
    root.appendChild(ui.panel);
    root.appendChild(ui.launcher);
    ui.root = root;
    shadow.appendChild(root);
    document.body.appendChild(host);
    render();
  }

  function svg(inner) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    n.setAttribute("viewBox", "0 0 24 24");
    n.setAttribute("width", "24");
    n.setAttribute("height", "24");
    n.setAttribute("aria-hidden", "true");
    n.innerHTML = inner;
    return n;
  }

  function autosize() { ui.input.style.height = "auto"; ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + "px"; }
  function onKey(e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }

  function showError(code) {
    var s = state.s;
    ui.err.textContent = code === "rate_limited" ? s.rateLimited : code === "not_available" || code === "forbidden" || code === "not_found" ? s.unavailable : s.error;
    ui.err.hidden = false;
  }

  function merge(conv) {
    if (!conv) return;
    state.conv = conv.conversationId;
    var prevStatus = state.status;
    state.status = conv.status;
    state.typing = !!conv.typing;
    var known = {};
    state.messages.forEach(function (m) { known[m.id] = true; });
    var fresh = 0;
    (conv.messages || []).forEach(function (m) {
      if (known[m.id]) return;
      state.messages.push(m);
      if (m.author !== "VISITOR") fresh++;
      if (!state.last || m.createdAt > state.last) state.last = m.createdAt;
    });
    if (fresh && !state.open) state.unread += fresh;
    if (prevStatus !== "CLOSED" && state.status === "CLOSED") state.closed = true;
  }

  function render() {
    var s = state.s, c = state.cfg;
    ui.log.textContent = "";
    var greeting = c.greeting || s.greeting;
    if (!c.ai) greeting = s.offline;
    ui.log.appendChild(bubble("a", s.assistant, greeting));
    var lastContactReq = -1;
    state.messages.forEach(function (m, i) {
      if (m.kind === "contact_request") { lastContactReq = i; return; }
      if (m.kind === "event") {
        var t = (s.events && s.events[m.body]) || "";
        if (t) ui.log.appendChild(el("div", { class: "event", text: t.replace("{number}", m.number == null ? "" : String(m.number)) }));
        return;
      }
      if (m.author === "VISITOR") ui.log.appendChild(bubble("v", s.you, m.body));
      else ui.log.appendChild(bubble("a", m.author === "AGENT" ? s.teamMember : s.assistant, m.body));
    });
    if (lastContactReq >= 0 && !state.contactShared) ui.log.appendChild(contactCard());
    if (state.typing || state.busy) ui.log.appendChild(el("div", { class: "typing", text: s.typing }));
    var closed = state.status === "CLOSED";
    if (closed) ui.log.appendChild(el("div", { class: "event", text: s.closed }));
    ui.input.disabled = state.busy;
    ui.send.disabled = state.busy;
    ui.human.hidden = !state.conv || closed || state.status === "WAITING_HUMAN" || state.status === "HUMAN_ACTIVE";
    ui.log.scrollTop = ui.log.scrollHeight;
    ui.badge.hidden = !state.unread;
    ui.badge.textContent = state.unread > 9 ? "9+" : String(state.unread);
    ui.launcher.setAttribute("aria-label", state.unread ? s.launcher + " · " + s.unread : s.launcher);
  }

  function bubble(kind, who, text) {
    return el("div", { class: "msg " + kind }, [el("span", { class: "who", text: who }), text]);
  }

  function contactCard() {
    var s = state.s, c = state.cfg;
    var name = el("input", { type: "text", required: true, maxlength: "200", autocomplete: "name" });
    var email = el("input", { type: "email", required: true, maxlength: "254", autocomplete: "email" });
    var consent = el("input", { type: "checkbox", required: true });
    var consentText = s.consent;
    var consentLabel = el("label", { class: "check" }, [consent, el("span", { text: consentText })]);
    var privacy = c.privacyUrl ? el("a", { href: c.privacyUrl, target: "_blank", rel: "noopener noreferrer", text: s.privacy }) : null;
    var submit = el("button", { class: "btn", type: "submit", text: s.contactSubmit });
    return el("form", { class: "card", on: { submit: function (e) {
      e.preventDefault();
      if (!consent.checked) return;
      submit.disabled = true;
      req("POST", "contact", { visitorToken: state.token, name: name.value, email: email.value, consent: true, consentText: consentText, website: ui.hp.value })
        .then(function (d) { state.contactShared = true; ui.err.hidden = true; merge(d.conversation); render(); })
        .catch(function (err) { submit.disabled = false; showError(err.code); });
    } } }, [
      el("h3", { text: s.contactTitle }),
      el("p", { text: s.contactHint }),
      el("label", {}, [s.contactName, name]),
      el("label", {}, [s.contactEmail, email]),
      consentLabel,
      privacy,
      submit,
    ]);
  }

  function ensureSession() {
    if (state.token && state.sessionReady) return Promise.resolve();
    return req("POST", "session", { visitorToken: state.token || undefined, locale: state.locale, pageUrl: location.href.slice(0, 1000), referrer: document.referrer.slice(0, 1000), website: "" })
      .then(function (d) {
        state.token = d.visitorToken;
        store.set(d.visitorToken);
        state.sessionReady = true;
        state.contactShared = !!d.contactShared;
        merge(d.conversation);
        render();
      });
  }

  function send() {
    var text = ui.input.value.trim();
    if (!text || state.busy) return;
    if (state.status === "CLOSED") { state.messages = []; state.conv = null; state.status = null; state.last = null; }
    state.busy = true;
    ui.err.hidden = true;
    var optimistic = { id: "tmp-" + Date.now(), author: "VISITOR", kind: "text", body: text, createdAt: "" };
    state.messages.push(optimistic);
    ui.input.value = "";
    autosize();
    render();
    ensureSession()
      .then(function () { return req("POST", "messages", { visitorToken: state.token, body: text, locale: state.locale, pageUrl: location.href.slice(0, 1000), website: ui.hp.value, after: state.last || undefined }); })
      .then(function (d) {
        state.messages = state.messages.filter(function (m) { return m !== optimistic; });
        merge(d.conversation);
      })
      .catch(function (err) {
        state.messages = state.messages.filter(function (m) { return m !== optimistic; });
        ui.input.value = text;
        showError(err.code);
      })
      .then(function () { state.busy = false; render(); if (state.open) ui.input.focus(); schedule(); });
  }

  function askHuman() {
    ensureSession().then(function () { return req("POST", "handoff", { visitorToken: state.token }); })
      .then(function (d) { merge(d.conversation); render(); })
      .catch(function (err) { showError(err.code); });
  }

  function poll() {
    if (!state.token || !state.conv || state.busy) return Promise.resolve();
    return req("POST", "poll", { visitorToken: state.token, after: state.last || undefined })
      .then(function (d) { if (d.conversation) { merge(d.conversation); render(); } })
      .catch(function () { /* transient */ });
  }

  function schedule() {
    clearTimeout(state.timer);
    if (!state.conv || state.status === "CLOSED") return;
    var every = state.open ? (state.status === "HUMAN_ACTIVE" || state.typing ? 2500 : 4000) : 20000;
    if (document.hidden) every = 30000;
    state.timer = setTimeout(function () { poll().then(schedule); }, every);
  }

  function toggle() {
    state.open = !state.open;
    ui.panel.hidden = !state.open;
    ui.root.classList.toggle("open", state.open);
    ui.launcher.setAttribute("aria-expanded", state.open ? "true" : "false");
    if (state.open) {
      state.unread = 0;
      render();
      ui.input.focus();
      if (state.token) ensureSession().then(poll).then(schedule).catch(function () {});
    } else {
      ui.launcher.focus();
      schedule();
    }
  }

  var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || document.documentElement.lang || "en-US"]);
  req("GET", "config", { locale: langs[0] || "en-US" })
    .then(function (d) {
      state.cfg = d.config;
      state.s = d.strings;
      state.locale = d.locale;
      state.dir = d.dir;
      var start = function () {
        build();
        if (state.token) ensureSession().then(schedule).catch(function () {});
      };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    })
    .catch(function () { /* chat unavailable on this site: render nothing */ });

  window.__realyChat = {
    open: function () { if (ui.panel && !state.open) toggle(); },
    destroy: function () { clearTimeout(state.timer); if (host.parentNode) host.parentNode.removeChild(host); window.__realyChat = undefined; },
  };
})();
`;
