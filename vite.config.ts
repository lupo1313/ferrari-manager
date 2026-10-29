import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' : chemins relatifs, l'application fonctionne aussi bien à la racine
// d'un domaine (Cloudflare Pages) que dans un sous-dossier (GitHub Pages).
// La navigation utilise le hash (#/commandes), donc aucune règle de réécriture n'est nécessaire.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
