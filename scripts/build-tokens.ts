import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { renderTokenCss } from '../src/design/generate-css.ts';

const target = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));
writeFileSync(target, renderTokenCss(), 'utf8');
process.stdout.write(`wrote ${target}\n`);
