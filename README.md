# ANDRO — Arabic Subtitles for Stremio

**Automatic Arabic subtitles for every movie & series.** ANDRO auto-detects the
best *working, in-sync* Arabic subtitle (zero delay), and when no Arabic sub
exists it **auto-translates** one on the fly — so you always get Arabic. Zero
dependencies, free, open source (MIT). Deploy once and never touch a terminal
again.

```
         _    _   _ ____  ____   ___
        / \  | \ | |  _ \|  _ \ / _ \
       / _ \ |  \| | | | | |_) | | | |
      / ___ \| |\  | |_| |  _ <| |_| |
     /_/   \_\_| \_|____/|_| \_\\___/   Arabic Subtitles for Stremio
```

## Features

- 🎯 **Auto-detects working subs** — ranks by hash-match, trusted uploader,
  rating and downloads; skips broken/empty entries and de-duplicates.
- ⏱️ **Zero-delay / in-sync** — uses the video hash Stremio sends to pick
  **frame-accurate** subtitles, so no manual re-syncing.
- 🇦🇪 **Correct Arabic encoding** — auto-fixes Windows-1256 / ISO-8859-6 files
  that otherwise show as gibberish, always outputs clean UTF-8.
- 🧠 **Auto-translate fallback** (e.g. English → Arabic) for titles with no
  Arabic sub.
- ⚡ **No delay** — in-memory caching of searches, links and translations.
- 🌐 **Runs serverless** (always-on, no terminal) or as a plain Node server.
- 💸 **100% free & open source**, zero dependencies.

## Deploy once, no terminal needed

The addon is a single stateless function. Host it free and it stays online 24/7
— you never run a terminal again.

### Option A — Vercel (recommended, always-on, free)
1. Put this folder in a GitHub repo.
2. On <https://vercel.com> → **New Project** → import the repo → **Deploy**.
   - `vercel.json` routes every request to `api/index.js` automatically.
3. Open `https://<your-app>.vercel.app/configure`, paste your free key, install.

### Option B — Render (free web service)
- `render.yaml` is included. On <https://render.com> → **New → Blueprint** →
  pick the repo. Start command `node server.js`, health check `/health`.

### Option C — Docker / any VPS
```bash
docker build -t andro-subs .
docker run -p 7000:7000 andro-subs
```

## Run locally (optional, for testing)

```bash
npm start                     # node server.js
# open http://127.0.0.1:7000/configure
```

## Requirements

- **Node.js 18+** (uses the built-in `fetch`).
- A **free** OpenSubtitles API key — register at
  <https://www.opensubtitles.com/en/consumers> (no payment required).

## How it works

Stremio sends the addon the title's IMDb ID plus (when available) the video's
hash and filename. ANDRO:

1. Searches OpenSubtitles for Arabic subs, passing the **video hash** so
   hash-matched (perfectly synced) results are flagged.
2. **Ranks** results — hash match > trusted > rating > downloads — drops broken
   ones, and returns the best first so Stremio auto-loads the right subtitle.
3. If auto-translate is on, it also exposes an **`Arabic (auto-translated)`**
   option. Translation runs only when selected, decodes the source with the
   correct charset, and outputs clean UTF-8 WebVTT.
4. Caches everything in memory for instant repeat playback.

## Endpoints

| Route | Purpose |
|-------|---------|
| `/configure` | Setup page that builds your install URL |
| `/<config>/manifest.json` | Stremio manifest |
| `/<config>/subtitles/:type/:id/:extra.json` | Ranked subtitle list |
| `/<config>/sub?mode=download\|translate&file_id=..` | Serves the file (lazy) |
| `/health` | Health check |

`<config>` is a URL-safe base64 blob (`{ apiKey, translate, translateFrom }`).

## Honest limitations

- **Coverage:** ready-made Arabic subs depend on OpenSubtitles' library; the
  auto-translate fallback covers the rest wherever *any* source-language sub
  exists (the vast majority of titles).
- **Free translation** uses Google's public endpoint — unofficial and rate
  limited; ANDRO batches cues to stay within limits. Swap in
  [LibreTranslate](https://libretranslate.com) in `lib/translate.js` for a
  self-hosted engine.
- **Download quota:** OpenSubtitles' free tier limits daily downloads per
  account; ANDRO only downloads when a subtitle is actually selected.

## Roadmap: subtitles from audio (Whisper)

True speech-to-text from the audio is intentionally **not** in the addon: a
Stremio addon never receives the video's audio, so it would need a separate
service downloading each video and running Whisper on a GPU (heavy, not free).
A future companion worker could add this for self-hosters.

## License

MIT © 2026 Andro. See [LICENSE](./LICENSE).
