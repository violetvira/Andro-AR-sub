'use strict';

// Tiny in-memory TTL cache. Keeps searches, download links and translated
// files hot so repeat requests are instant ("no delay"). Bounded in size.

const store = new Map();
const MAX = 800;

function get(key) {
	const e = store.get(key);
	if (!e) return undefined;
	if (Date.now() > e.exp) { store.delete(key); return undefined; }
	store.delete(key);
	store.set(key, e); // refresh LRU order
	return e.v;
}

function set(key, value, ttlMs) {
	store.set(key, { v: value, exp: Date.now() + (ttlMs || 60000) });
	while (store.size > MAX) {
		const oldest = store.keys().next().value;
		store.delete(oldest);
	}
}

module.exports = { get, set };
