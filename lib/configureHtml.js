'use strict';

// The configure page is embedded as a string so the addon works both as a
// standalone server and as a serverless function (no filesystem reads needed).

const CONFIGURE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ANDRO — Arabic Subtitles for Stremio</title>
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
    <span>✓ Auto-synced (zero delay)</span>
    <span>✓ Auto-picks working subs</span>
    <span>✓ Auto-translate fallback</span>
    <span>✓ Free &amp; open source</span>
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
    <li><b>3.</b> Play any movie or show → ANDRO auto-loads the best synced Arabic sub.</li>
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

module.exports = { CONFIGURE_HTML };
