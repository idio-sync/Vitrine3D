import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    define: {
        'import.meta.env.VITE_ARCHIVE_SECRET': JSON.stringify(
            process.env.ARCHIVE_SECRET || 'test-secret-key-for-unit-tests'
        ),
    },
    resolve: {
        alias: {
            'three/addons/': 'three/examples/jsm/',
            '@': resolve(__dirname, 'src'),
        },
    },
    test: {
        include: ['src/**/__tests__/**/*.test.{ts,js}'],
        globals: true,
    },
});
