'use strict';

// Thin client for the OpenSubtitles REST API (https://opensubtitles.com).
// A free API key is required (register once, no payment) and is supplied by
// each user through the addon configuration page.

const { fetchJson } = require('./subs');

const BASE = 'https://api.opensubtitles.com/api/v1';

function headers(apiKey, ua) {
	return {
		'Api-Key': apiKey,
		'User-Agent': ua,
		'Content-Type': 'application/json',
		'Accept': 'application/json',
	};
}

// Search subtitles for a movie or a specific series episode.
// When a moviehash is supplied, OpenSubtitles flags hash-matched results
// (attributes.moviehash_match) which are frame-accurate = zero delay.
async function searchSubtitles({ apiKey, ua, type, imdbId, season, episode, languages, moviehash }) {
	const p = new URLSearchParams();
	p.set('languages', languages || 'ar');
	p.set('order_by', 'download_count');
	p.set('order_direction', 'desc');
	if (moviehash) p.set('moviehash', moviehash);
	if (type === 'series') {
		p.set('parent_imdb_id', String(imdbId));
		if (season) p.set('season_number', String(season));
		if (episode) p.set('episode_number', String(episode));
	} else {
		p.set('imdb_id', String(imdbId));
	}
	const data = await fetchJson(BASE + '/subtitles?' + p.toString(), {
		headers: headers(apiKey, ua),
	});
	return (data && data.data) || [];
}

// Turn a file_id into a temporary direct download link.
// NOTE: this call is what consumes the account's daily download quota, so it
// only runs when the viewer actually selects a subtitle (lazy).
async function getDownloadLink({ apiKey, ua, fileId }) {
	const data = await fetchJson(BASE + '/download', {
		method: 'POST',
		headers: headers(apiKey, ua),
		body: JSON.stringify({ file_id: Number(fileId) }),
	});
	return data && data.link;
}

module.exports = { searchSubtitles, getDownloadLink };
