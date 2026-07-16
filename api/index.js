'use strict';

// Serverless entry point (Vercel / Netlify functions style).
// All routes are rewritten to this single function — see vercel.json.
// This is what lets ANDRO run always-on with NO terminal.

const { handler } = require('../server');

module.exports = (req, res) => handler(req, res);
