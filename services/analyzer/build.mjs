import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  outfile: resolve(__dirname, 'dist/index.js'),
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: [
    // External node_modules that should not be bundled
    'firebase-admin',
    '@google-cloud/vertexai',
    'zod',
  ],
  // Resolve workspace packages
  alias: {
    '@soccer/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
  },
  loader: {
    '.ts': 'ts',
  },
  tsconfig: resolve(__dirname, 'tsconfig.json'),
});

console.log('Build completed: dist/index.js');
