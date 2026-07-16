'use strict';

// Config is carried inside the addon URL as one URL-safe base64 path segment,
// e.g.  https://host/<config>/manifest.json
// This lets every user run the same public instance with their own settings.

function encodeConfig(cfg) {
	return Buffer.from(JSON.stringify(cfg || {}), 'utf8')
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function decodeConfig(seg) {
	if (!seg) return {};
	try {
		let b = String(seg).replace(/-/g, '+').replace(/_/g, '/');
		while (b.length % 4) b += '=';
		const obj = JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
		return obj && typeof obj === 'object' ? obj : {};
	} catch (e) {
		return {};
	}
}

module.exports = { encodeConfig, decodeConfig };
