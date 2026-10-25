import * as esbuild from 'esbuild';
import { copyFile, mkdir, rm, stat, watch as fsWatch } from 'node:fs/promises';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const OUT = 'dist';
// [source under src/, destination under dist/]
const STATIC = [
  ['manifest.json', 'manifest.json'],
  ['pages/palette.html', 'palette.html'],
  ['pages/options.html', 'options.html'],
  ['pages/options.css', 'options.css'],
  ...[16, 32, 48, 128].map((n) => [`icons/icon${n}.png`, `icons/icon${n}.png`]),
];

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome121',
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'warning',
  outdir: OUT,
};

const configs = [
  { ...common, format: 'esm', entryPoints: { background: 'src/background/index.ts' } },
  {
    ...common,
    format: 'iife',
    entryPoints: {
      content: 'src/content/index.ts',
      palette: 'src/pages/palette.ts',
      options: 'src/pages/options.ts',
    },
  },
];

async function copyStatic() {
  await Promise.all(STATIC.map(([from, to]) => copyFile(join('src', from), join(OUT, to))));
}

async function report() {
  for (const f of ['content.js', 'background.js', 'palette.js', 'options.js']) {
    const { size } = await stat(join(OUT, f));
    console.log(`  ${f.padEnd(14)} ${(size / 1024).toFixed(1)} KB`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'icons'), { recursive: true });
await copyStatic();

if (watch) {
  const plugin = { name: 'log', setup: (b) => b.onEnd((r) => r.errors.length || console.log('rebuilt')) };
  for (const c of configs) await (await esbuild.context({ ...c, plugins: [plugin] })).watch();
  console.log('watching…');
  for await (const _ of fsWatch('src', { recursive: true })) await copyStatic().catch(() => {});
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log(`built ${OUT}/`);
  await report();
}
