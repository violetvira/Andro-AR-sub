'use strict';

// ANDRO — Arabic Subtitles addon for Stremio
// Dependency-free HTTP server implementing the Stremio addon protocol.
// Runs as a standalone server OR as a serverless function (see api/index.js).
// MIT licensed.

const http = require('http');
const { URL, URLSearchParams } = require('url');

const { decodeConfig, encodeConfig } = require('./lib/config');
const { searchSubtitles, getDownloadLink } = require('./lib/opensubtitles');
const { translateCues } = require('./lib/translate');
const { parseCues, buildVtt, ensureVtt, fetchSubtitleText } = require('./lib/subs');
const { CONFIGURE_HTML } = require('./lib/configureHtml');
const cache = require('./lib/cache');

const PORT = process.env.PORT || 7000;
const VERSION = '1.1.0';
const UA = 'ANDRO-Arabic-Subtitles/' + VERSION;

const RESERVED = new Set([
	'manifest.json', 'subtitles', 'configure', 'sub',
	'health', 'logo.png', 'favicon.ico', '',
]);

function manifest(configured) {
	return {
		id: 'community.andro.arabic.subtitles',
		version: VERSION,
		name: 'ANDRO — Arabic Subtitles',
		description:
			'Automatic Arabic subtitles for every movie & series. Auto-detects the ' +
			'best working, in-sync subtitle (zero delay) and auto-translates when no ' +
			'Arabic subtitle exists. Free and open source.',
		logo: 'https://icongr.am/material/subtitles.svg?size=128&color=6c5ce7',
		resources: ['subtitles'],
		types: ['movie', 'series'],
		catalogs: [],
		idPrefixes: ['tt'],
		behaviorHints: { configurable: true, configurationRequired: !configured },
	};
}

function send(res, status, body, headers) {
	const h = Object.assign({
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	}, headers || {});
	res.writeHead(status, h);
	res.end(body);
}

function sendJson(res, obj) {
	send(res, 200, JSON.stringify(obj), {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'public, max-age=3600',
	});
}

function subUrl(origin, cfgSeg, params) {
	return origin + '/' + cfgSeg + '/sub?' + new URLSearchParams(params).toString();
}

// Rank results so the best WORKING, in-sync subtitle is first.
// hash match (perfect sync) > trusted uploader > rating > downloads.
function rankItems(items) {
	const seen = new Set();
	const ranked = [];
	for (const it of items) {
		const a = it.attributes || {};
		const f = a.files && a.files[0];
		if (!f || !f.file_id) continue;           // skip entries with no file = broken
		if (seen.has(f.file_id)) continue;        // dedupe
		seen.add(f.file_id);
		const score =
			(a.moviehash_match ? 1000 : 0) +
			(a.from_trusted ? 60 : 0) +
			(Number(a.ratings) || 0) * 6 +
			Math.log10((Number(a.download_count) || 0) + 1) * 10 -
			(a.hearing_impaired ? 5 : 0);
		ranked.push({
			fileId: f.file_id,
			hash: !!a.moviehash_match,
			score,
		});
	}
	ranked.sort((x, y) => y.score - x.score);
	return ranked;
}

async function cachedSearch(opts) {
	const key = 's:' + [
		opts.type, opts.imdbId, opts.season, opts.episode, opts.languages, opts.moviehash || '',
	].join(':');
	const hit = cache.get(key);
	if (hit) return hit;
	const data = await searchSubtitles(opts);
	cache.set(key, data, 60 * 60 * 1000); // 1h
	return data;
}

async function handleSubtitles(res, origin, config, segments) {
	// segments: ['subtitles', type, <id>(.json), <extra>.json?]
	const type = segments[1];
	const rest = segments.slice(2);
	const idPart = decodeURIComponent(rest[0] || '').replace(/\.json$/, '');
	const extraRaw = rest.length >= 2 ? rest.slice(1).join('/').replace(/\.json$/, '') : '';
	const extra = new URLSearchParams(extraRaw);
	const moviehash = extra.get('videoHash') || '';

	const parts = idPart.split(':');
	const numericImdb = (parts[0] || '').replace(/^tt/, '');
	const season = parts[1];
	const episode = parts[2];

	if (!config.apiKey) return sendJson(res, { subtitles: [] });

	const cfgSeg = encodeConfig(config);
	const subtitles = [];

	// 1) Ready-made Arabic subtitles — hash-synced & best first.
	try {
		const arabic = await cachedSearch({
			apiKey: config.apiKey, ua: UA, type,
			imdbId: numericImdb, season, episode, languages: 'ar', moviehash,
		});
		for (const r of rankItems(arabic).slice(0, 8)) {
			subtitles.push({
				id: 'andro-ar-' + r.fileId,
				url: subUrl(origin, cfgSeg, { mode: 'download', file_id: r.fileId }),
				lang: r.hash ? 'ara' : 'ara',
			});
		}
	} catch (e) {
		console.error('Arabic search failed:', e.message);
	}

	// 2) Auto-translated fallback so EVERY title still gets Arabic.
	if (config.translate !== false) {
		const from = config.translateFrom || 'en';
		try {
			const source = await cachedSearch({
				apiKey: config.apiKey, ua: UA, type,
				imdbId: numericImdb, season, episode, languages: from, moviehash,
			});
			for (const r of rankItems(source).slice(0, 2)) {
				subtitles.push({
					id: 'andro-auto-' + r.fileId,
					url: subUrl(origin, cfgSeg, { mode: 'translate', file_id: r.fileId, from }),
					lang: 'Arabic (auto-translated)',
				});
			}
		} catch (e) {
			console.error('Translate-source search failed:', e.message);
		}
	}

	sendJson(res, { subtitles });
}

async function handleSub(res, config, query) {
	if (!config.apiKey) return send(res, 400, 'Missing configuration');
	const fileId = query.get('file_id');
	const mode = query.get('mode') || 'download';
	const from = query.get('from') || 'en';
	if (!fileId) return send(res, 400, 'Missing file_id');

	const vttHeaders = {
		'Content-Type': 'text/vtt; charset=utf-8',
		'Cache-Control': 'public, max-age=86400',
	};

	// Serve cached output instantly when available ("no delay").
	const outKey = (mode === 'translate' ? 'tr:' : 'dl:') + fileId + ':' + from;
	const cached = cache.get(outKey);
	if (cached) return send(res, 200, cached, vttHeaders);

	let link = cache.get('link:' + fileId);
	if (!link) {
		try {
			link = await getDownloadLink({ apiKey: config.apiKey, ua: UA, fileId });
		} catch (e) {
			return send(res, 502, 'Download link error: ' + e.message);
		}
		if (!link) return send(res, 404, 'No download link');
		cache.set('link:' + fileId, link, 30 * 60 * 1000); // links are short-lived
	}

	let raw;
	try { raw = await fetchSubtitleText(link); }
	catch (e) { return send(res, 502, 'Fetch subtitle error: ' + e.message); }

	if (mode === 'translate') {
		try {
			const cues = parseCues(raw);
			const vtt = buildVtt(await translateCues(cues, from, 'ar'));
			cache.set(outKey, vtt, 24 * 60 * 60 * 1000);
			return send(res, 200, vtt, vttHeaders);
		} catch (e) {
			return send(res, 502, 'Translation error: ' + e.message);
		}
	}
	const vtt = ensureVtt(raw);
	cache.set(outKey, vtt, 24 * 60 * 60 * 1000);
	return send(res, 200, vtt, vttHeaders);
}

async function handler(req, res) {
	try {
		if (req.method === 'OPTIONS') return send(res, 204, '');
		const reqUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost:' + PORT));

		const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] ||
			reqUrl.protocol.replace(':', '');
		const host = req.headers['x-forwarded-host'] || req.headers.host || ('localhost:' + PORT);
		const origin = proto + '://' + host;

		let segments = reqUrl.pathname.split('/').filter((s) => s.length > 0);
		let config = {};
		if (segments.length && !RESERVED.has(segments[0])) {
			config = decodeConfig(segments[0]);
			segments = segments.slice(1);
		} else if (reqUrl.searchParams.get('c')) {
			config = decodeConfig(reqUrl.searchParams.get('c'));
		}

		const head = segments[0] || '';

		if (head === 'health') return send(res, 200, 'ok');
		if (head === '' || head === 'configure') {
			return send(res, 200, CONFIGURE_HTML, { 'Content-Type': 'text/html; charset=utf-8' });
		}
		if (head === 'manifest.json') return sendJson(res, manifest(!!config.apiKey));
		if (head === 'subtitles') return await handleSubtitles(res, origin, config, segments);
		if (head === 'sub') return await handleSub(res, config, reqUrl.searchParams);

		return send(res, 404, 'Not found');
	} catch (e) {
		console.error(e);
		return send(res, 500, 'Internal error');
	}
}

const server = http.createServer(handler);

if (require.main === module) {
	server.listen(PORT, () => {
		console.log('ANDRO Arabic Subtitles addon running on port ' + PORT);
		console.log('Configure:  http://127.0.0.1:' + PORT + '/configure');
	});
}

module.exports = { handler, server, manifest };
