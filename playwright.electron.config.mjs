import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e/electron',
    timeout: 120000,
    retries: process.env.CI ? 1 : 0,
    use: {
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        headless: true
    }
});
