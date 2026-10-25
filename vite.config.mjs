import { defineConfig } from 'vite';
import { resolve, join } from 'path';
import { cpSync, existsSync, lstatSync } from 'fs';

const staticDirs = ['assets', 'css'];

function copyStaticDirectories() {
    let resolvedConfig = null;
    return {
        name: 'copy-static-directories',
        apply: 'build',
        configResolved(config) {
            resolvedConfig = config;
        },
        closeBundle() {
            if (!resolvedConfig) return;
            const outDir = resolve(resolvedConfig.root || process.cwd(), resolvedConfig.build.outDir || 'dist');
            staticDirs.forEach((dir) => {
                const src = resolve(resolvedConfig.root || process.cwd(), dir);
                if (!existsSync(src)) return;
                const stats = lstatSync(src);
                if (!stats.isDirectory()) return;
                const dest = join(outDir, dir);
                cpSync(src, dest, { recursive: true });
            });
        }
    };
}

export default defineConfig({
    root: '.',
    base: './',
    server: {
        host: '127.0.0.1',
        port: 5173
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: resolve(import.meta.dirname, 'index.html'),
                study: resolve(import.meta.dirname, 'study.html'),
                auth: resolve(import.meta.dirname, 'auth.html')
            }
        }
    },
    plugins: [
        copyStaticDirectories()
    ]
});
