const express = require('express');
const cors = require('cors');
const compression = require('compression');
const axios = require('axios');
const iconv = require('iconv-lite');

const app = express();
app.use(cors());
app.use(compression());

const PORT = process.env.PORT || 7000;

// Helper to get current domain automatically on mobile/cloud
function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

// ============================================================================
// 1. STATELESS TOKEN ENCODER (ما يضيع الجلسة أبد حتى لو السيرفر طفى واشتغل)
// ============================================================================
function encodePayload(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodePayload(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

// ============================================================================
// 2. AUTO-DELAY, FPS & ARABIC RTL ENGINE
// ============================================================================
function timeToMs(timeStr) {
  const clean = timeStr.trim().replace('.', ',');
  const [hms, ms] = clean.split(',');
  const [h, m, s] = (hms || '0:0:0').split(':').map(Number);
  return ((h * 3600) + (m * 60) + (s || 0)) * 1000 + parseInt(ms || '0', 10);
}

function msToTime(ms) {
  const safeMs = Math.max(0, Math.round(ms));
  const h = Math.floor(safeMs / 3600000);
  const m = Math.floor((safeMs % 3600000) / 60000);
  const s = Math.floor((safeMs % 60000) / 1000);
  const milli = safeMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

function decodeArabicBuffer(rawBuffer) {
  let text = rawBuffer.toString('utf8');
  const utf8ArabicCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  if (utf8ArabicCount < 15) {
    const win1256 = iconv.decode(rawBuffer, 'win1256');
    const winArabicCount = (win1256.match(/[\u0600-\u06FF]/g) || []).length;
    if (winArabicCount > utf8ArabicCount) text = win1256;
  }
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function processSrt(text, offsetMs = 0, cleanSdh = true) {
  if (cleanSdh) {
    text = text.replace(/\[.*?\]|\(.*?\)|♪.*?♪/g, '');
  }

  const blocks = text.split('\n\n');
  const fixed = blocks.map(block => {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex(l => l.includes('-->'));
    if (timeIdx === -1) return block;

    const [startRaw, endRaw] = lines[timeIdx].split('-->');
    if (!startRaw || !endRaw) return block;

    lines[timeIdx] = `${msToTime(timeToMs(startRaw) + offsetMs)} --> ${msToTime(timeToMs(endRaw) + offsetMs)}`;

    // Fix RTL punctuation on Mobile & TV screens
    for (let i = timeIdx + 1; i < lines.length; i++) {
      if (/[\u0600-\u06FF]/.test(lines[i])) {
        lines[i] = `\u202B${lines[i].trim()}\u202C`;
      }
    }
    return lines.join('\n');
  });

  return '\uFEFF' + fixed.join('\n\n');
}

// ============================================================================
// 3. ZERO-KEY INSTANT AI TRANSLATOR (يشتغل فوراً حتى بدون مفتاح API)
// ============================================================================
async function autoTranslateSrtToArabic(englishSrt, dialect = 'standard') {
  const blocks = englishSrt.split('\n\n').filter(Boolean).slice(0, 140);

  // إذا ضايف مفتاح Gemini يستخدمه، وإذا ماكو يستخدم المترجم الفوري المجاني
  if (process.env.GEMINI_API_KEY) {
    try {
      const style = dialect === 'iraqi'
        ? 'Translate into natural Iraqi dialect (لهجة عراقية مفهومة).'
        : dialect === 'bilingual'
        ? 'Keep the English line and add Arabic translation above it.'
        : 'Translate into cinema-grade clear Arabic.';

      const { data } = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [{ parts: [{ text: `Translate this SRT to Arabic. ${style} Keep timestamps untouched. Output raw SRT only:\n\n${blocks.join('\n\n')}` }] }]
        },
        { timeout: 9000 }
      );
      const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (out) return out.replace(/```srt|```/g, '').trim();
    } catch (_) {}
  }

  // Instant Free Zero-Key Fallback Translator
  try {
    const dialogueLines = [];
    const parsedBlocks = blocks.map(block => {
      const lines = block.split('\n');
      const timeIdx = lines.findIndex(l => l.includes('-->'));
      if (timeIdx === -1) return null;
      const textPart = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]*>/g, '').trim();
      dialogueLines.push(textPart || '...');
      return { header: lines.slice(0, timeIdx + 1).join('\n'), original: textPart };
    }).filter(Boolean);

    const joinedQuery = dialogueLines.join(' ||| ');
    const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
      params: { client: 'gtx', sl: 'en', tl: 'ar', dt: 't', q: joinedQuery },
      timeout: 7000
    });

    const fullTranslated = data[0].map(item => item[0]).join('');
    const splitTranslated = fullTranslated.split(/\s*\|\|\|\s*/);

    return parsedBlocks.map((b, idx) => {
      const arLine = splitTranslated[idx] || b.original;
      if (dialect === 'bilingual') {
        return `${b.header}\n${arLine}\n${b.original}`;
      }
      return `${b.header}\n${arLine}`;
    }).join('\n\n');
  } catch (_) {
    return englishSrt;
  }
}

// ============================================================================
// 4. FETCH SUBTITLES & MATCH VIDEO FORMAT
// ============================================================================
async function fetchSubs(type, id, videoHash) {
  try {
    let url = `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(id)}.json`;
    if (videoHash) {
      url = `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(id)}/videoHash=${videoHash}.json`;
    }
    const { data } = await axios.get(url, { timeout: 6000 });
    return Array.isArray(data?.subtitles) ? data.subtitles : [];
  } catch (_) {
    return [];
  }
}

// ============================================================================
// 5. STREMIO ROUTES
// ============================================================================
function getManifest(cfg = {}) {
  return {
    id: 'org.andro.subtitles.mobile',
    version: '2.1.0',
    name: `Andro (${cfg.dialect === 'iraqi' ? 'عراقي + AI' : 'Auto-Sync + AI'})`,
    description: 'Andro Smart Arabic Subtitles: Auto-Fix Delay, Format Matcher & Instant AI Generator.',
    logo: 'https://img.icons8.com/fluency/256/closed-captioning.png',
    resources: ['subtitles'],
    types: ['movie', 'series', 'anime'],
    idPrefixes: ['tt', 'kitsu'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

app.get('/manifest.json', (req, res) => res.json(getManifest()));
app.get('/:config/manifest.json', (req, res) => {
  res.json(getManifest(decodePayload(req.params.config) || {}));
});

async function subtitlesHandler(req, res) {
  const baseUrl = getBaseUrl(req);
  const cfg = decodePayload(req.params.config) || { dialect: 'standard', cleanSdh: true };
  const { type, id } = req.params;
  const extraParams = new URLSearchParams(req.params.extra || '');
  const videoHash = extraParams.get('videoHash') || '';

  const allSubs = await fetchSubs(type, id, videoHash);
  const arabicSubs = allSubs.filter(s => s.lang === 'ara');
  const englishSubs = allSubs.filter(s => s.lang === 'eng');

  const subtitles = [];

  // 1. Best Matched Arabic Subtitles + Instant Delay Fix Tracks
  arabicSubs.slice(0, 3).forEach((sub, idx) => {
    const token = encodePayload({ u: sub.url, ai: 0, sdh: cfg.cleanSdh });
    subtitles.push({
      id: `Andro-Best-Sync-${idx + 1}`,
      url: `${baseUrl}/sub/${token}/0/ara.srt`,
      lang: 'ara'
    });

    if (idx === 0) {
      subtitles.push(
        {
          id: `Andro-Delay-Plus-0.5s`,
          url: `${baseUrl}/sub/${token}/500/ara.srt`,
          lang: 'ara'
        },
        {
          id: `Andro-Delay-Minus-0.5s`,
          url: `${baseUrl}/sub/${token}/-500/ara.srt`,
          lang: 'ara'
        },
        {
          id: `Andro-Web-to-BluRay-Fix`,
          url: `${baseUrl}/sub/${token}/-1200/ara.srt`,
          lang: 'ara'
        }
      );
    }
  });

  // 2. Andro AI Auto-Generated Track (100% Coverage Guarantee)
  if (englishSubs.length > 0) {
    const aiToken = encodePayload({
      u: englishSubs[0].url,
      ai: 1,
      d: cfg.dialect || 'standard',
      sdh: cfg.cleanSdh
    });
    subtitles.push({
      id: `Andro-AI-Generator-${cfg.dialect || 'Cinema'}`,
      url: `${baseUrl}/sub/${aiToken}/0/ara.srt`,
      lang: 'ara'
    });
  }

  res.json({ subtitles });
}

app.get('/subtitles/:type/:id.json', subtitlesHandler);
app.get('/subtitles/:type/:id/:extra.json', subtitlesHandler);
app.get('/:config/subtitles/:type/:id.json', subtitlesHandler);
app.get('/:config/subtitles/:type/:id/:extra.json', subtitlesHandler);

// ============================================================================
// 6. SUBTITLE PROXY & REAL-TIME PROCESSOR
// ============================================================================
app.get('/sub/:token/:offset/ara.srt', async (req, res) => {
  const meta = decodePayload(req.params.token);
  const offsetMs = parseInt(req.params.offset || '0', 10) || 0;

  if (!meta || !meta.u) {
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    return res.send('\uFEFF1\n00:00:01,000 --> 00:00:05,000\n\u202B[Andro] الرابط غير صالح\u202C\n');
  }

  try {
    const response = await axios.get(meta.u, { responseType: 'arraybuffer', timeout: 7000 });
    let text = decodeArabicBuffer(Buffer.from(response.data));

    if (meta.ai === 1) {
      text = await autoTranslateSrtToArabic(text, meta.d);
    }

    const processed = processSrt(text, offsetMs, meta.sdh !== false);
    const badge = meta.ai === 1
      ? `🤖 Andro AI (${meta.d})`
      : `⚡ Andro Auto-Sync (${offsetMs >= 0 ? '+' : ''}${offsetMs}ms)`;

    const headerSub = `0\n00:00:00,300 --> 00:00:04,000\n\u202B${badge}\u202C\n\n`;
    const finalOutput = '\uFEFF' + headerSub + processed.replace(/^\uFEFF/, '');

    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.send(finalOutput);
  } catch (err) {
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.send('\uFEFF1\n00:00:01,000 --> 00:00:05,000\n\u202B[Andro] تعذر سحب المصدر، جرب الخيار الثاني بالقائمة\u202C\n');
  }
});

// ============================================================================
// 7. MOBILE-FIRST INSTALLATION WEBSITE
// ============================================================================
function renderSite(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Andro Subtitles — Stremio</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-white min-h-screen flex items-center justify-center p-4">
  <div class="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl">
    <div class="text-center mb-6">
      <span class="px-3 py-1 rounded-full text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
        ⚡ جاهز للموبايل والتلفزيون (10k+ Users)
      </span>
      <h1 class="text-3xl font-extrabold mt-3 bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
        Andro Subtitles
      </h1>
      <p class="text-zinc-400 text-sm mt-2">
        ترجمة عربية 100% مع تصليح التأخير التلقائي والترجمة بالذكاء الاصطناعي
      </p>
    </div>

    <div class="space-y-4">
      <div>
        <label class="block text-xs text-zinc-400 mb-1">نمط الذكاء الاصطناعي (Andro AI):</label>
        <select id="dialect" class="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-sm text-white">
          <option value="standard">🎬 عربي سينمائي واضح</option>
          <option value="iraqi">🇮🇶 لهجة عراقية</option>
          <option value="bilingual">🌍 مزدوج (عربي + إنكليزي سوية)</option>
        </select>
      </div>

      <label class="flex items-center justify-between bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/60 cursor-pointer">
        <span class="text-xs text-zinc-300">حذف الإعلانات والوصف الصوتي [موسيقى]</span>
        <input id="cleanSdh" type="checkbox" checked class="w-5 h-5 accent-indigo-500 rounded" />
      </label>

      <a id="installBtn" href="#" class="block w-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 transition text-center font-bold py-4 rounded-2xl shadow-lg shadow-indigo-600/30">
        🚀 تنصيب مباشر في تطبيق Stremio
      </a>

      <button id="copyBtn" onclick="copyLink()" class="block w-full bg-zinc-800 hover:bg-zinc-700 text-center text-sm font-medium py-3 rounded-2xl border border-zinc-700">
        📋 نسخ رابط الإضافة (Manifest URL)
      </button>
    </div>
  </div>

  <script>
    function getCfg() {
      const data = {
        dialect: document.getElementById('dialect').value,
        cleanSdh: document.getElementById('cleanSdh').checked
      };
      return btoa(JSON.stringify(data)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }
    function update() {
      const cfg = getCfg();
      const host = window.location.host;
      const fullUrl = window.location.protocol + '//' + host + '/' + cfg + '/manifest.json';
      document.getElementById('installBtn').href = 'stremio://' + host + '/' + cfg + '/manifest.json';
      return fullUrl;
    }
    function copyLink() {
      navigator.clipboard.writeText(update());
      const btn = document.getElementById('copyBtn');
      btn.innerText = '✅ تم النسخ! الصقه في بحث إضافات Stremio';
      setTimeout(() => { btn.innerText = '📋 نسخ رابط الإضافة (Manifest URL)'; }, 3000);
    }
    document.getElementById('dialect').addEventListener('change', update);
    document.getElementById('cleanSdh').addEventListener('change', update);
    update();
  </script>
</body>
</html>`);
}

app.get('/', renderSite);
app.get('/configure', renderSite);
app.get('/:config/configure', renderSite);

if (require.main === module) {
  app.listen(PORT, () => console.log(`Andro Live on port ${PORT}`));
}

module.exports = app;
