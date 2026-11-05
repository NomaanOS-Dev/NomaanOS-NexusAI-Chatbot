import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isStandalone = process.env.BUILD_TARGET === 'standalone';

export default defineConfig({
  plugins: [react()],
  build: isStandalone
    ? {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: path.resolve(__dirname, 'src/standalone.ts'),
          name: 'NexusWidget',
          fileName: () => 'nexus-widget.umd.js',
          formats: ['umd'],
        },
        rollupOptions: {
          // In standalone bundle, react and react-dom are bundled inside!
        },
      }
    : {
        outDir: 'dist',
        lib: {
          entry: path.resolve(__dirname, 'src/index.ts'),
          name: 'NexusChatWidget',
          fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
          formats: ['es', 'cjs'],
        },
        rollupOptions: {
          external: ['react', 'react-dom', 'react/jsx-runtime'],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
              'react/jsx-runtime': 'jsxRuntime',
            },
          },
        },
      },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});

