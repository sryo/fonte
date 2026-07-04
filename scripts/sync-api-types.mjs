#!/usr/bin/env node
// Copies the canonical wire types into the dashboard, which deliberately has
// no workspace dependencies. A vitest drift check keeps the copy honest.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'packages/torrent/src/types.ts');
const target = path.join(root, 'dashboard/src/lib/api-types.ts');

const BANNER = '// GENERATED — edit packages/torrent/src/types.ts and run `npm run sync:types`.\n\n';

writeFileSync(target, BANNER + readFileSync(source, 'utf8'));
console.log(`Synced ${path.relative(root, source)} -> ${path.relative(root, target)}`);
