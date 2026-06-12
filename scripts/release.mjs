#!/usr/bin/env node
// scripts/release.mjs — bump root + backend + frontend package.json,
// commit, tag vX.Y.Z, push (triggers build-backend + build-frontend workflows).

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');

const level = process.argv[2];
const valid = ['patch', 'minor', 'major'];

if (!valid.includes(level)) {
  console.error(`Usage: node scripts/release.mjs <${valid.join('|')}>`);
  process.exit(1);
}

/** Read, bump, write a package.json and return the new version string. */
function bumpPkg(pkgPath, targetVersion) {
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.version = targetVersion;
  // Preserve trailing newline style of original.
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return pkg.version;
}

/** Semver bump */
function nextVersion(current, level) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Unexpected version format: "${current}"`);
  }
  if (level === 'major') return `${parts[0] + 1}.0.0`;
  if (level === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/** Thin shell wrapper — throws on non-zero exit. */
function sh(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
}

// ── 1. Read current version from root package.json ────────────────────────
const rootPkgPath = resolve(root, 'package.json');
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
const prev = rootPkg.version;
const next = nextVersion(prev, level);
const tag = `v${next}`;

console.log(`\nBumping ${level}: ${prev} → ${next} (${tag})\n`);

// ── 2. Guard: working tree must be clean ──────────────────────────────────
try {
  const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim();
  if (dirty) {
    console.error('Working tree is not clean. Commit or stash changes before releasing.');
    process.exit(1);
  }
} catch {
  console.error('Failed to check git status.');
  process.exit(1);
}

// ── 3. Guard: tag must not already exist ─────────────────────────────────
try {
  execSync(`git rev-parse "${tag}"`, { cwd: root, stdio: 'pipe' });
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
} catch {
  // tag does not exist — good
}

// ── 4. Bump all three package.json files ─────────────────────────────────
bumpPkg(rootPkgPath, next);
bumpPkg(resolve(root, 'backend', 'package.json'), next);
bumpPkg(resolve(root, 'frontend', 'package.json'), next);

// ── 5. Commit, tag, push ─────────────────────────────────────────────────
sh('git add package.json backend/package.json frontend/package.json');
sh(`git commit -m "chore: release ${tag}"`);
sh(`git tag ${tag}`);
sh('git push');
sh(`git push origin ${tag}`);

console.log(`\nReleased ${tag}. Build + deploy workflows will start shortly.`);
