import { defineConfig } from 'vite';

// base relative : le build statique (dist/) s'ouvre depuis n'importe quel chemin d'hébergement.
export default defineConfig({
  base: './',
  server: { port: 5199, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as any);
