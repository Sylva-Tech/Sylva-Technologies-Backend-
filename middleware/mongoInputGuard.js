'use strict';

/**
 * Reject MongoDB operator and path injection in untrusted request data.
 *
 * The API builds database filters on the server; clients must never be able
 * to submit query operators such as $ne/$where/$regex or dotted update paths.
 * This runs after Express body parsing and before any route handler.
 */
const FORBIDDEN_KEYS = /[.$]/;
const FORBIDDEN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 30;
const MAX_NODES = 10000;

function findUnsafeKey(root) {
  if (root === null || typeof root !== 'object') return null;

  const stack = [{ value: root, depth: 0 }];
  const seen = new Set();
  let visited = 0;

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (depth > MAX_DEPTH || ++visited > MAX_NODES) {
      return '[request structure limit]';
    }

    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.test(key) || FORBIDDEN_NAMES.has(key)) {
        return key;
      }
      const child = value[key];
      if (child && typeof child === 'object') {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }

  return null;
}

function rejectMongoOperatorInjection(req, res, next) {
  const unsafeKey =
    findUnsafeKey(req.body) ||
    findUnsafeKey(req.query) ||
    findUnsafeKey(req.params);

  if (unsafeKey) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request structure.',
    });
  }

  return next();
}

module.exports = {
  rejectMongoOperatorInjection,
  findUnsafeKey,
};
