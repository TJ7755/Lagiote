import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e/web',
    outputDir: 'test-results/web',
    timeout: 90000,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: 'http://127.0.0.1:4187',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        headless: true
    },
    webServer: {
        command: 'npm run dev:web -- --host 127.0.0.1 --port 4187 --strictPort',
        env: { VITE_TEST_MODE: '1', TEST_MODE: '1' },
        url: 'http://127.0.0.1:4187',
        reuseExistingServer: false,
        timeout: 120000
    }
});
