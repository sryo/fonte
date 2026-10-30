import path from 'path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: [{ find: /^@\//, replacement: `${path.resolve(__dirname, 'dashboard/src')}/` }],
    },
    test: {
        exclude: [...configDefaults.exclude, '.claude/**', '**/dist/**', '**/.next/**'],
        globalSetup: ['./vitest.global-setup.ts'],
    },
});
