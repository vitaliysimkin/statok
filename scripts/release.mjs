#!/usr/bin/env node
// Release stub — to be implemented in ST-052.
// Intended: bump version in root + backend + frontend package.json, create git tag vX.Y.Z, push.
// Single source of version is the root package.json `version` field.

const level = process.argv[2];
const valid = ['patch', 'minor', 'major'];

if (!valid.includes(level)) {
  console.error(`Usage: node scripts/release.mjs <${valid.join('|')}>`);
  process.exit(1);
}

console.error(
  `[release] '${level}' bump is not implemented yet (stub — see ST-052). ` +
    `Will sync root/backend/frontend versions, tag vX.Y.Z and push.`,
);
process.exit(1);
