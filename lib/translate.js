'use strict';

// Free, key-less machine translation using Google's public gtx endpoint.
// Best-effort: it is rate limited, so ANDRO batches cues to keep requests low
// and falls back to line-by-line translation if a batch cannot be split back.

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const DELIM = '\n#~#\n';

async function gtx(text, from, to) {
	const url =
		ENDPOINT +
		'?client=gtx&sl=' + encodeURIComponent(from) +
		'&tl=' + encodeURIComponent(to) +
		'&dt=t&q=' + encodeURIComponent(text);
	const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
	if (!res.ok) throw new Error('translate HTTP ' + res.status);
	const data = await res.json();
	if (!Array.isArray(data) || !Array.isArray(data[0])) return '';
	return data[0].map((seg) => (seg && seg[0] ? seg[0] : '')).join('');
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
				batch.forEach((idx, k) => { out[idx] = parts[k].trim(); });
				ok = true;
			}
		} catch (e) { ok = false; }
		if (!ok) {
			for (const idx of batch) {
				try { out[idx] = (await gtx(lines[idx], from, to)).trim(); }
				catch (e) { out[idx] = lines[idx]; }
			}
		}
	}
	return out;
}

async function translateCues(cues, from, to) {
	const lines = cues.map((c) => c.text.replace(/\n/g, ' ').trim());
	const translated = await translateLines(lines, from, to);
	return cues.map((c, idx) => ({ timing: c.timing, text: translated[idx] || c.text }));
}

module.exports = { translateCues, translateLines, gtx };
