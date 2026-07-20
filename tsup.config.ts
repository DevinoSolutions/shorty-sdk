import { defineConfig } from 'tsup'

// Dual ESM + CJS build with type declarations. Zero runtime dependencies, so
// nothing is bundled in; `target` matches the package's `engines.node >= 20`.
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    splitting: false,
    target: 'node20',
    outDir: 'dist',
})
