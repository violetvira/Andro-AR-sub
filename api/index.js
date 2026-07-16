var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// lib/config.js
var require_config = __commonJS({
  "lib/config.js"(exports2, module2) {
    "use strict";
    function encodeConfig(cfg) {
      return Buffer.from(JSON.stringify(cfg || {}), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function decodeConfig(seg) {
      if (!seg) return {};
      try {
        let b = String(seg).replace(/-/g, "+").replace(/_/g, "/");
        while (b.length % 4) b += "=";
        const obj = JSON.parse(Buffer.from(b, "base64").toString("utf8"));
        return obj && typeof obj === "object" ? obj : {};
      } catch (e) {
        return {};
      }
    }
    module2.exports = { encodeConfig, decodeConfig };
  }
});

// lib/subs.js
var require_subs = __commonJS({
  "lib/subs.js"(exports2, module2) {
    "use strict";
    async function fetchText(url, headers) {
      const res = await fetch(url, { headers: headers || {} });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    }
    async function fetchJson(url, opts) {
      const res = await fetch(url, opts || {});
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
      }
      if (!res.ok) {
        const msg = data && (data.message || data.error) || text.slice(0, 200);
        throw new Error("HTTP " + res.status + ": " + msg);
      }
      return data;
    }
    async function fetchSubtitleText(url, headers) {
      const res = await fetch(url, { headers: headers || {} });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      return decodeSubtitleBuffer(buf);
    }
    function decodeSubtitleBuffer(buf) {
      if (!buf || !buf.length) return "";
      if (buf[0] === 239 && buf[1] === 187 && buf[2] === 191) {
        return buf.slice(3).toString("utf8");
      }
      const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      const replacements = (utf8.match(/\uFFFD/g) || []).length;
      if (replacements > 2) {
        for (const enc of ["windows-1256", "iso-8859-6"]) {
          try {
            const alt = new TextDecoder(enc, { fatal: false }).decode(buf);
            if ((alt.match(/\uFFFD/g) || []).length < replacements) return alt;
          } catch (e) {
          }
        }
      }
      return utf8;
    }
    function parseCues(input) {
      const text = String(input).replace(/\r/g, "");
      const blocks = text.split(/\n{2,}/);
      const cues = [];
      for (const block of blocks) {
        const lines = block.split("\n");
        const tIdx = lines.findIndex((l) => l.indexOf("-->") !== -1);
        if (tIdx === -1) continue;
        const timing = normalizeTiming(lines[tIdx].trim());
        const cueText = lines.slice(tIdx + 1).join("\n").trim();
        if (!cueText) continue;
        cues.push({ timing, text: cueText });
      }
      return cues;
    }
    function normalizeTiming(t) {
      const re = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;
      const m = t.match(re);
      if (!m) return t.replace(/,/g, ".");
      return fixStamp(m[1]) + " --> " + fixStamp(m[2]);
    }
    function fixStamp(ts) {
      ts = ts.replace(",", ".");
      const parts = ts.split(":");
      if (parts.length === 2) ts = "00:" + ts;
      return ts;
    }
    function buildVtt(cues) {
      let out = "WEBVTT\n\n";
      for (const c of cues) out += c.timing + "\n" + c.text + "\n\n";
      return out;
    }
    function ensureVtt(raw) {
      if (/^\uFEFF?WEBVTT/.test(raw)) return raw;
      return buildVtt(parseCues(raw));
    }
    module2.exports = {
      fetchText,
      fetchJson,
      fetchSubtitleText,
      decodeSubtitleBuffer,
      parseCues,
      buildVtt,
      ensureVtt,
      normalizeTiming
    };
  }
});

// lib/opensubtitles.js
var require_opensubtitles = __commonJS({
  "lib/opensubtitles.js"(exports2, module2) {
    "use strict";
    var { fetchJson } = require_subs();
    var BASE = "https://api.opensubtitles.com/api/v1";
    function headers(apiKey, ua) {
      return {
        "Api-Key": apiKey,
        "User-Agent": ua,
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
    }
    async function searchSubtitles({ apiKey, ua, type, imdbId, season, episode, languages, moviehash }) {
      const p = new URLSearchParams();
      p.set("languages", languages || "ar");
      p.set("order_by", "download_count");
      p.set("order_direction", "desc");
      if (moviehash) p.set("moviehash", moviehash);
      if (type === "series") {
        p.set("parent_imdb_id", String(imdbId));
        if (season) p.set("season_number", String(season));
        if (episode) p.set("episode_number", String(episode));
      } else {
        p.set("imdb_id", String(imdbId));
      }
      const data = await fetchJson(BASE + "/subtitles?" + p.toString(), {
        headers: headers(apiKey, ua)
      });
      return data && data.data || [];
    }
    async function getDownloadLink({ apiKey, ua, fileId }) {
      const data = await fetchJson(BASE + "/download", {
        method: "POST",
        headers: headers(apiKey, ua),
        body: JSON.stringify({ file_id: Number(fileId) })
      });
      return data && data.link;
    }
    module2.exports = { searchSubtitles, getDownloadLink };
  }
});

// lib/translate.js
var require_translate = __commonJS({
  "lib/translate.js"(exports2, module2) {
    "use strict";
    var ENDPOINT = "https://translate.googleapis.com/translate_a/single";
    var DELIM = "\n#~#\n";
    async function gtx(text, from, to) {
      const url = ENDPOINT + "?client=gtx&sl=" + encodeURIComponent(from) + "&tl=" + encodeURIComponent(to) + "&dt=t&q=" + encodeURIComponent(text);
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error("translate HTTP " + res.status);
      const data = await res.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) return "";
      return data[0].map((seg) => seg && seg[0] ? seg[0] : "").join("");
    }
    async function translateLines(lines, from, to) {
      const out = new Array(lines.length);
      let i = 0;
      while (i < lines.length) {
        const batch = [];
        let budget = 0;
        while (i < lines.length && budget < 1200 && batch.length < 30) {
          batch.push(i);
          budget += lines[i].length + 4;
          i++;
        }
        const joined = batch.map((idx) => lines[idx]).join(DELIM);
        let ok = false;
        try {
          const t = await gtx(joined, from, to);
          const parts = t.split(/\s*#~#\s*/);
          if (parts.length === batch.length) {
            batch.forEach((idx, k) => {
              out[idx] = parts[k].trim();
            });
            ok = true;
          }
        } catch (e) {
          ok = false;
        }
        if (!ok) {
          for (const idx of batch) {
            try {
              out[idx] = (await gtx(lines[idx], from, to)).trim();
            } catch (e) {
              out[idx] = lines[idx];
            }
          }
        }
      }
      return out;
    }
    async function translateCues(cues, from, to) {
      const lines = cues.map((c) => c.text.replace(/\n/g, " ").trim());
      const translated = await translateLines(lines, from, to);
      return cues.map((c, idx) => ({ timing: c.timing, text: translated[idx] || c.text }));
    }
    module2.exports = { translateCues, translateLines, gtx };
  }
});

// lib/configureHtml.js
var require_configureHtml = __commonJS({
  "lib/configureHtml.js"(exports2, module2) {
    "use strict";
    var CONFIGURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ANDRO \u2014 Arabic Subtitles for Stremio</title>
<style>
  :root { --p:#6c5ce7; --p2:#8f7bff; --bg:#0e0e14; --card:#1a1a24; --tx:#e9e9f0; --mut:#9aa0b5; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
         background:radial-gradient(1200px 600px at 50% -10%,#241b46 0%,var(--bg) 55%); color:var(--tx); min-height:100vh; }
  .wrap { max-width:560px; margin:0 auto; padding:48px 20px 80px; }
  .logo { font-size:44px; font-weight:800; letter-spacing:2px; text-align:center;
          background:linear-gradient(90deg,var(--p2),#c8b6ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .tag { text-align:center; color:var(--mut); margin:6px 0 24px; font-size:15px; }
  .feat { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin-bottom:28px; }
  .feat span { font-size:12px; background:#20203010; border:1px solid #33334a; color:#c8b6ff; padding:5px 10px; border-radius:20px; }
  .card { background:var(--card); border:1px solid #2a2a3a; border-radius:16px; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,.4); }
  label { display:block; font-size:13px; color:var(--mut); margin:16px 0 6px; font-weight:600; }
  input[type=text], select { width:100%; padding:12px 14px; border-radius:10px; border:1px solid #33334a;
          background:#12121b; color:var(--tx); font-size:15px; }
  .row { display:flex; align-items:center; gap:10px; margin-top:18px; }
  .row input { width:18px; height:18px; accent-color:var(--p); }
  .row label { margin:0; color:var(--tx); font-size:14px; }
  .hint { font-size:12px; color:var(--mut); margin-top:6px; line-height:1.5; }
  .hint a { color:var(--p2); }
  .btn { display:block; width:100%; text-align:center; margin-top:24px; padding:14px; border-radius:12px;
          border:0; font-size:16px; font-weight:700; cursor:pointer; text-decoration:none;
          background:linear-gradient(90deg,var(--p),var(--p2)); color:#fff; }
  .btn.secondary { background:#23233250; border:1px solid #33334a; color:var(--tx); margin-top:12px; }
  .out { margin-top:18px; font-size:12px; word-break:break-all; color:var(--mut); background:#12121b;
          border:1px dashed #33334a; border-radius:10px; padding:12px; display:none; }
  .steps { margin:28px 0 0; padding:0; list-style:none; font-size:13px; color:var(--mut); line-height:1.7; }
  .steps b { color:var(--tx); }
  .badge { display:inline-block; font-size:11px; background:#2a2350; color:#c8b6ff; padding:3px 8px; border-radius:20px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">ANDRO</div>
  <div class="tag">Automatic Arabic subtitles for every movie &amp; series</div>
  <div class="feat">
    <span>\u2713 Auto-synced (zero delay)</span>
    <span>\u2713 Auto-picks working subs</span>
    <span>\u2713 Auto-translate fallback</span>
    <span>\u2713 Free &amp; open source</span>
  </div>

  <div class="card">
    <label for="apiKey">OpenSubtitles API key <span class="badge">free</span></label>
    <input id="apiKey" type="text" placeholder="paste your free API key" autocomplete="off" />
    <div class="hint">Create one for free (no payment) at
      <a href="https://www.opensubtitles.com/en/consumers" target="_blank" rel="noopener">opensubtitles.com &rarr; API consumers</a>.
    </div>

    <div class="row">
      <input id="translate" type="checkbox" checked />
      <label for="translate">Auto-translate to Arabic when no Arabic subtitle exists</label>
    </div>

    <label for="from">Translate from</label>
    <select id="from">
      <option value="en" selected>English</option>
      <option value="fr">French</option>
      <option value="es">Spanish</option>
      <option value="tr">Turkish</option>
      <option value="de">German</option>
    </select>

    <button class="btn" id="install">Install in Stremio</button>
    <button class="btn secondary" id="copy">Copy manifest URL</button>
    <div class="out" id="out"></div>
  </div>

  <ol class="steps">
    <li><b>1.</b> Paste your free OpenSubtitles API key above.</li>
    <li><b>2.</b> Click <b>Install in Stremio</b> (opens the Stremio app).</li>
    <li><b>3.</b> Play any movie or show \u2192 ANDRO auto-loads the best synced Arabic sub.</li>
  </ol>
</div>

<script>
  function b64url(obj){
    var s = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    return s.replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  }
  function buildConfig(){
    return {
      apiKey: document.getElementById('apiKey').value.trim(),
      translate: document.getElementById('translate').checked,
      translateFrom: document.getElementById('from').value
    };
  }
  function manifestUrl(){
    var cfg = buildConfig();
    if(!cfg.apiKey){ alert('Please paste your free OpenSubtitles API key first.'); return null; }
    return window.location.origin + '/' + b64url(cfg) + '/manifest.json';
  }
  document.getElementById('install').addEventListener('click', function(){
    var url = manifestUrl(); if(!url) return;
    var out = document.getElementById('out');
    out.style.display='block'; out.textContent = url;
    window.location.href = url.replace(/^https?:\\/\\//, 'stremio://');
  });
  document.getElementById('copy').addEventListener('click', function(){
    var url = manifestUrl(); if(!url) return;
    var out = document.getElementById('out');
    out.style.display='block'; out.textContent = url;
    if(navigator.clipboard){ navigator.clipboard.writeText(url); }
  });
</script>
</body>
</html>`;
    module2.exports = { CONFIGURE_HTML };
  }
});

// lib/cache.js
var require_cache = __commonJS({
  "lib/cache.js"(exports2, module2) {
    "use strict";
    var store = /* @__PURE__ */ new Map();
    var MAX = 800;
    function get(key) {
      const e = store.get(key);
      if (!e) return void 0;
      if (Date.now() > e.exp) {
        store.delete(key);
        return void 0;
      }
      store.delete(key);
      store.set(key, e);
      return e.v;
    }
    function set(key, value, ttlMs) {
      store.set(key, { v: value, exp: Date.now() + (ttlMs || 6e4) });
      while (store.size > MAX) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }
    }
    module2.exports = { get, set };
  }
});

// server.js
var require_server = __commonJS({
  "server.js"(exports2, module2) {
    "use strict";
    var http = require("http");
    var { URL, URLSearchParams: URLSearchParams2 } = require("url");
    var { decodeConfig, encodeConfig } = require_config();
    var { searchSubtitles, getDownloadLink } = require_opensubtitles();
    var { translateCues } = require_translate();
    var { parseCues, buildVtt, ensureVtt, fetchSubtitleText } = require_subs();
    var { CONFIGURE_HTML } = require_configureHtml();
    var cache = require_cache();
    var PORT = process.env.PORT || 7e3;
    var VERSION = "1.1.0";
    var UA = "ANDRO-Arabic-Subtitles/" + VERSION;
    var RESERVED = /* @__PURE__ */ new Set([
      "manifest.json",
      "subtitles",
      "configure",
      "sub",
      "health",
      "logo.png",
      "favicon.ico",
      ""
    ]);
    function manifest(configured) {
      return {
        id: "community.andro.arabic.subtitles",
        version: VERSION,
        name: "ANDRO \u2014 Arabic Subtitles",
        description: "Automatic Arabic subtitles for every movie & series. Auto-detects the best working, in-sync subtitle (zero delay) and auto-translates when no Arabic subtitle exists. Free and open source.",
        logo: "https://icongr.am/material/subtitles.svg?size=128&color=6c5ce7",
        resources: ["subtitles"],
        types: ["movie", "series"],
        catalogs: [],
        idPrefixes: ["tt"],
        behaviorHints: { configurable: true, configurationRequired: !configured }
      };
    }
    function send(res, status, body, headers) {
      const h = Object.assign({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      }, headers || {});
      res.writeHead(status, h);
      res.end(body);
    }
    function sendJson(res, obj) {
      send(res, 200, JSON.stringify(obj), {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      });
    }
    function subUrl(origin, cfgSeg, params) {
      return origin + "/" + cfgSeg + "/sub?" + new URLSearchParams2(params).toString();
    }
    function rankItems(items) {
      const seen = /* @__PURE__ */ new Set();
      const ranked = [];
      for (const it of items) {
        const a = it.attributes || {};
        const f = a.files && a.files[0];
        if (!f || !f.file_id) continue;
        if (seen.has(f.file_id)) continue;
        seen.add(f.file_id);
        const score = (a.moviehash_match ? 1e3 : 0) + (a.from_trusted ? 60 : 0) + (Number(a.ratings) || 0) * 6 + Math.log10((Number(a.download_count) || 0) + 1) * 10 - (a.hearing_impaired ? 5 : 0);
        ranked.push({
          fileId: f.file_id,
          hash: !!a.moviehash_match,
          score
        });
      }
      ranked.sort((x, y) => y.score - x.score);
      return ranked;
    }
    async function cachedSearch(opts) {
      const key = "s:" + [
        opts.type,
        opts.imdbId,
        opts.season,
        opts.episode,
        opts.languages,
        opts.moviehash || ""
      ].join(":");
      const hit = cache.get(key);
      if (hit) return hit;
      const data = await searchSubtitles(opts);
      cache.set(key, data, 60 * 60 * 1e3);
      return data;
    }
    async function handleSubtitles(res, origin, config, segments) {
      const type = segments[1];
      const rest = segments.slice(2);
      const idPart = decodeURIComponent(rest[0] || "").replace(/\.json$/, "");
      const extraRaw = rest.length >= 2 ? rest.slice(1).join("/").replace(/\.json$/, "") : "";
      const extra = new URLSearchParams2(extraRaw);
      const moviehash = extra.get("videoHash") || "";
      const parts = idPart.split(":");
      const numericImdb = (parts[0] || "").replace(/^tt/, "");
      const season = parts[1];
      const episode = parts[2];
      if (!config.apiKey) return sendJson(res, { subtitles: [] });
      const cfgSeg = encodeConfig(config);
      const subtitles = [];
      try {
        const arabic = await cachedSearch({
          apiKey: config.apiKey,
          ua: UA,
          type,
          imdbId: numericImdb,
          season,
          episode,
          languages: "ar",
          moviehash
        });
        for (const r of rankItems(arabic).slice(0, 8)) {
          subtitles.push({
            id: "andro-ar-" + r.fileId,
            url: subUrl(origin, cfgSeg, { mode: "download", file_id: r.fileId }),
            lang: r.hash ? "ara" : "ara"
          });
        }
      } catch (e) {
        console.error("Arabic search failed:", e.message);
      }
      if (config.translate !== false) {
        const from = config.translateFrom || "en";
        try {
          const source = await cachedSearch({
            apiKey: config.apiKey,
            ua: UA,
            type,
            imdbId: numericImdb,
            season,
            episode,
            languages: from,
            moviehash
          });
          for (const r of rankItems(source).slice(0, 2)) {
            subtitles.push({
              id: "andro-auto-" + r.fileId,
              url: subUrl(origin, cfgSeg, { mode: "translate", file_id: r.fileId, from }),
              lang: "Arabic (auto-translated)"
            });
          }
        } catch (e) {
          console.error("Translate-source search failed:", e.message);
        }
      }
      sendJson(res, { subtitles });
    }
    async function handleSub(res, config, query) {
      if (!config.apiKey) return send(res, 400, "Missing configuration");
      const fileId = query.get("file_id");
      const mode = query.get("mode") || "download";
      const from = query.get("from") || "en";
      if (!fileId) return send(res, 400, "Missing file_id");
      const vttHeaders = {
        "Content-Type": "text/vtt; charset=utf-8",
        "Cache-Control": "public, max-age=86400"
      };
      const outKey = (mode === "translate" ? "tr:" : "dl:") + fileId + ":" + from;
      const cached = cache.get(outKey);
      if (cached) return send(res, 200, cached, vttHeaders);
      let link = cache.get("link:" + fileId);
      if (!link) {
        try {
          link = await getDownloadLink({ apiKey: config.apiKey, ua: UA, fileId });
        } catch (e) {
          return send(res, 502, "Download link error: " + e.message);
        }
        if (!link) return send(res, 404, "No download link");
        cache.set("link:" + fileId, link, 30 * 60 * 1e3);
      }
      let raw;
      try {
        raw = await fetchSubtitleText(link);
      } catch (e) {
        return send(res, 502, "Fetch subtitle error: " + e.message);
      }
      if (mode === "translate") {
        try {
          const cues = parseCues(raw);
          const vtt2 = buildVtt(await translateCues(cues, from, "ar"));
          cache.set(outKey, vtt2, 24 * 60 * 60 * 1e3);
          return send(res, 200, vtt2, vttHeaders);
        } catch (e) {
          return send(res, 502, "Translation error: " + e.message);
        }
      }
      const vtt = ensureVtt(raw);
      cache.set(outKey, vtt, 24 * 60 * 60 * 1e3);
      return send(res, 200, vtt, vttHeaders);
    }
    async function handler(req, res) {
      try {
        if (req.method === "OPTIONS") return send(res, 204, "");
        const reqUrl = new URL(req.url, "http://" + (req.headers.host || "localhost:" + PORT));
        const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0] || reqUrl.protocol.replace(":", "");
        const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:" + PORT;
        const origin = proto + "://" + host;
        let segments = reqUrl.pathname.split("/").filter((s) => s.length > 0);
        let config = {};
        if (segments.length && !RESERVED.has(segments[0])) {
          config = decodeConfig(segments[0]);
          segments = segments.slice(1);
        } else if (reqUrl.searchParams.get("c")) {
          config = decodeConfig(reqUrl.searchParams.get("c"));
        }
        const head = segments[0] || "";
        if (head === "health") return send(res, 200, "ok");
        if (head === "" || head === "configure") {
          return send(res, 200, CONFIGURE_HTML, { "Content-Type": "text/html; charset=utf-8" });
        }
        if (head === "manifest.json") return sendJson(res, manifest(!!config.apiKey));
        if (head === "subtitles") return await handleSubtitles(res, origin, config, segments);
        if (head === "sub") return await handleSub(res, config, reqUrl.searchParams);
        return send(res, 404, "Not found");
      } catch (e) {
        console.error(e);
        return send(res, 500, "Internal error");
      }
    }
    var server = http.createServer(handler);
    if (require.main === module2) {
      server.listen(PORT, () => {
        console.log("ANDRO Arabic Subtitles addon running on port " + PORT);
        console.log("Configure:  http://127.0.0.1:" + PORT + "/configure");
      });
    }
    module2.exports = { handler, server, manifest };
  }
});

// _vercel-entry.js
module.exports = require_server().handler;
