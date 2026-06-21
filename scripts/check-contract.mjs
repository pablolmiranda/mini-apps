#!/usr/bin/env node
// Validates a single .tsx mini-app against the PWA Store contract.
//
// A Store-compatible mini-app is a single self-contained file that:
//   - imports ONLY from the allowlist below (same shape the Claude web
//     interface produces),
//   - has NO relative imports (so it is genuinely one self-contained file),
//   - default-exports the component.
//
// Run: node scripts/check-contract.mjs <path-to-tsx> [...more]
// Exits non-zero on any violation so it can gate a build.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Single source of truth for what the Store allows. Update here if the
// Store's allowed-import set changes.
const ALLOWED_IMPORTS = ["react", "lucide-react"];

/**
 * Extract the module specifier from every static import/export-from statement.
 * Covers: `import X from 's'`, `import {a} from 's'`, `import * as x from 's'`,
 * `import 's'` (side-effect), and `export ... from 's'`.
 */
function extractImportSources(code) {
  const sources = [];
  // `import ... from '<src>'` and `export ... from '<src>'`
  const fromRe = /\b(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g;
  // bare side-effect imports: `import '<src>'`
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = fromRe.exec(code)) !== null) sources.push(m[1]);
  while ((m = bareRe.exec(code)) !== null) sources.push(m[1]);
  return sources;
}

/** A package import is allowed if it equals or is a subpath of an allowed pkg. */
function isAllowed(src) {
  return ALLOWED_IMPORTS.some(
    (pkg) => src === pkg || src.startsWith(pkg + "/")
  );
}

function isRelative(src) {
  return src.startsWith("./") || src.startsWith("../") || src.startsWith("/");
}

function checkFile(path) {
  const abs = resolve(path);
  let code;
  try {
    code = readFileSync(abs, "utf8");
  } catch (err) {
    return { path, errors: [`cannot read file: ${err.message}`], warnings: [] };
  }

  const errors = [];
  const warnings = [];

  const sources = extractImportSources(code);
  for (const src of sources) {
    if (isRelative(src)) {
      errors.push(`relative import "${src}" — output must be a single self-contained file`);
    } else if (!isAllowed(src)) {
      errors.push(`disallowed import "${src}" — allowed: ${ALLOWED_IMPORTS.join(", ")}`);
    }
  }

  const defaultExports = (code.match(/\bexport\s+default\b/g) || []).length;
  if (defaultExports === 0) {
    errors.push("no `export default` found — the Store mounts the default export");
  } else if (defaultExports > 1) {
    errors.push(`found ${defaultExports} \`export default\` statements — expected exactly 1`);
  }

  if (/dangerouslySetInnerHTML/.test(code)) {
    warnings.push("uses dangerouslySetInnerHTML — ensure input is HTML-escaped first (XSS)");
  }

  return { path, errors, warnings };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node scripts/check-contract.mjs <file.tsx> [...]");
    process.exit(2);
  }

  let failed = false;
  for (const file of files) {
    const { path, errors, warnings } = checkFile(file);
    for (const w of warnings) console.warn(`  ⚠ ${path}: ${w}`);
    if (errors.length > 0) {
      failed = true;
      console.error(`  ✗ ${path}`);
      for (const e of errors) console.error(`      ${e}`);
    } else {
      console.log(`  ✓ ${path} — Store contract OK`);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
