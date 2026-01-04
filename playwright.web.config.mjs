import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e/web',
    timeout: 90000,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        headless: true
    },
    webServer: {
        command: 'VITE_TEST_MODE=1 TEST_MODE=1 npm run dev:web -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
