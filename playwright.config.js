// Playwright config — DQN Trading Dashboard E2E Tests
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    testMatch: '**/*.spec.js',
    timeout: 60000,
    retries: 1,
    workers: 1, // jeden worker — serwer jest współdzielony
    use: {
        baseURL: 'http://localhost:3000',
        headless: true,
        viewport: { width: 1400, height: 900 },
        ignoreHTTPSErrors: true,
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
    },
    reporter: [['list'], ['html', { open: 'never' }]],
});
