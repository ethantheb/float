import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, rm, stat, watch as fsWatch, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const OUT = 'dist';
// [source under src/, destination under dist/]
const STATIC = [
  ['pages/palette.html', 'palette.html'],
  ['background/bangs.json', 'bangs.json'],
  ...[16, 32, 48, 128].map((n) => [`icons/icon${n}.png`, `icons/icon${n}.png`]),
];

// CSS imported as text ships in content.js, so minify it too.
const minifyCss = {
  name: 'minify-css',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const css = await readFile(path, 'utf8');
      if (watch) return { contents: css, loader: 'text' };
      const { code } = await esbuild.transform(css, { loader: 'css', minify: true, target: 'chrome121' });
      return { contents: code.trim(), loader: 'text' };
    });
  },
};

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome121',
  plugins: [minifyCss],
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
    },
  },
];

// package.json is the single source of the version (bump with `npm version`).
async function writeManifest() {
  const [manifest, pkg] = await Promise.all(
    ['src/manifest.json', 'package.json'].map(async (f) => JSON.parse(await readFile(f, 'utf8'))),
  );
  const { manifest_version, name, ...rest } = manifest;
  const out = { manifest_version, name, version: pkg.version, ...rest };
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
}

// options.html is palette.html with another title.
async function writeOptionsPage() {
  const html = await readFile('src/pages/palette.html', 'utf8');
  const options = html.replace('<title>New Tab</title>', '<title>Float Options</title>');
  if (options === html) throw new Error("palette.html's <title> changed: update writeOptionsPage");
  await writeFile(join(OUT, 'options.html'), options);
}

async function copyStatic() {
  await Promise.all([
    writeManifest(),
    writeOptionsPage(),
    ...STATIC.map(([from, to]) => copyFile(join('src', from), join(OUT, to))),
  ]);
}

async function report() {
  for (const f of ['content.js', 'background.js', 'palette.js']) {
    const { size } = await stat(join(OUT, f));
    console.log(`  ${f.padEnd(14)} ${(size / 1024).toFixed(1)} KB`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'icons'), { recursive: true });
await copyStatic();

if (watch) {
  const plugin = { name: 'log', setup: (b) => b.onEnd((r) => r.errors.length || console.log('rebuilt')) };
  for (const c of configs) await (await esbuild.context({ ...c, plugins: [...c.plugins, plugin] })).watch();
  console.log('watching…');
  for await (const _ of fsWatch('src', { recursive: true })) await copyStatic().catch(() => {});
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  console.log(`built ${OUT}/`);
  await report();
}
