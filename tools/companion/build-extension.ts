// Builds the Builder Capture extension (companion/extension) into companion/extension/dist, the folder Chrome loads
// (chrome://extensions › Load unpacked): its service worker and options script bundled by Vite in library mode, with
// its manifest and options page beside them. npm run extension:build.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

export const EXTENSION = path.resolve('companion', 'extension', 'dist');

export async function buildExtension(): Promise<string> {
  const source = path.resolve('companion', 'extension');
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: EXTENSION,
      emptyOutDir: true,
      minify: false,
      lib: { entry: { background: path.join(source, 'src', 'background.ts'), options: path.join(source, 'src', 'options.ts') }, formats: ['es'], fileName: (_format, name) => `${name}.js` },
    },
  });
  for (const file of ['manifest.json', 'options.html']) fs.copyFileSync(path.join(source, file), path.join(EXTENSION, file));
  return EXTENSION;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log(`the extension is built in ${await buildExtension()}`);
}
