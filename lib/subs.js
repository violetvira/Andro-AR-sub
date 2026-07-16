'use strict';

// Dependency-free helpers for fetching and parsing subtitle files.

async function fetchText(url, headers) {
	const res = await fetch(url, { headers: headers || {} });
	if (!res.ok) throw new Error('HTTP ' + res.status);
	return await res.text();
}

async function fetchJson(url, opts) {
	const res = await fetch(url, opts || {});
	const text = await res.text();
	let data = null;
	try { data = JSON.parse(text); } catch (e) { /* not json */ }
	if (!res.ok) {
		const msg = (data && (data.message || data.error)) || text.slice(0, 200);
		throw new Error('HTTP ' + res.status + ': ' + msg);
	}
	return data;
}

// Download a subtitle file and decode it to correct UTF-8 text.
// Arabic subs are frequently stored in Windows-1256 / ISO-8859-6; naive UTF-8
// decoding turns them into mojibake, which is a top cause of "broken" subs.
async function fetchSubtitleText(url, headers) {
	const res = await fetch(url, { headers: headers || {} });
	if (!res.ok) throw new Error('HTTP ' + res.status);
	const buf = Buffer.from(await res.arrayBuffer());
	return decodeSubtitleBuffer(buf);
}

function decodeSubtitleBuffer(buf) {
	if (!buf || !buf.length) return '';
	// Strip UTF-8 BOM
	if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
		return buf.slice(3).toString('utf8');
	}
	const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
	const replacements = (utf8.match(/\uFFFD/g) || []).length;
	// If UTF-8 produced many replacement chars, the file is a legacy encoding.
	if (replacements > 2) {
		for (const enc of ['windows-1256', 'iso-8859-6']) {
			try {
				const alt = new TextDecoder(enc, { fatal: false }).decode(buf);
				if ((alt.match(/\uFFFD/g) || []).length < replacements) return alt;
			} catch (e) { /* encoding unsupported, skip */ }
		}
	}
	return utf8;
}

// Parse both SRT and VTT into an array of { timing, text } cues.
function parseCues(input) {
	const text = String(input).replace(/\r/g, '');
	const blocks = text.split(/\n{2,}/);
	const cues = [];
	for (const block of blocks) {
		const lines = block.split('\n');
		const tIdx = lines.findIndex((l) => l.indexOf('-->') !== -1);
		if (tIdx === -1) continue; // header / notes / empty
		const timing = normalizeTiming(lines[tIdx].trim());
		const cueText = lines.slice(tIdx + 1).join('\n').trim();
		if (!cueText) continue;
		cues.push({ timing, text: cueText });
	}
	return cues;
}

function normalizeTiming(t) {
	const re = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;
	const m = t.match(re);
	if (!m) return t.replace(/,/g, '.');
	return fixStamp(m[1]) + ' --> ' + fixStamp(m[2]);
}

function fixStamp(ts) {
	ts = ts.replace(',', '.');
	const parts = ts.split(':');
	if (parts.length === 2) ts = '00:' + ts; // MM:SS.mmm -> HH:MM:SS.mmm
	return ts;
}

function buildVtt(cues) {
	let out = 'WEBVTT\n\n';
	for (const c of cues) out += c.timing + '\n' + c.text + '\n\n';
	return out;
}

// Accept either format from the source and always hand Stremio clean UTF-8 VTT.
function ensureVtt(raw) {
	if (/^\uFEFF?WEBVTT/.test(raw)) return raw;
	return buildVtt(parseCues(raw));
}

module.exports = {
	fetchText, fetchJson, fetchSubtitleText, decodeSubtitleBuffer,
	parseCues, buildVtt, ensureVtt, normalizeTiming,
};
