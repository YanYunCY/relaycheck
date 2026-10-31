import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/bin.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  splitting: false,
  clean: true,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
});
