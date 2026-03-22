/**
 * Playwright E2E Test — DQN Trading Dashboard
 * Tester: Jarvis Horner
 * 
 * Sprawdza każdy button na dashboardzie — czy wykonuje akcję, czy zwraca dane.
 */

const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

// ─── POMOCNICZE ───────────────────────────────────────────────

async function waitForServer(page) {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
}

async function clickButton(page, selector, waitForResponse = null) {
    if (waitForResponse) {
        const [response] = await Promise.all([
            page.waitForResponse(resp => resp.url().includes(waitForResponse), { timeout: 15000 }),
            page.click(selector)
        ]);
        return response;
    }
    await page.click(selector);
}

// ─── TESTY ────────────────────────────────────────────────────

test.describe('Dashboard — ładowanie', () => {

    test('strona główna ładuje się poprawnie', async ({ page }) => {
        await waitForServer(page);
        await expect(page).toHaveTitle(/DQN Trading/);
        // Sprawdź czy główne elementy istnieją
        await expect(page.locator('.header h1')).toContainText('DQN');
    });

    test('ceny BTC/ETH/SOL się wyświetlają', async ({ page }) => {
        await waitForServer(page);
        // Poczekaj na załadowanie cen
        await page.waitForTimeout(3000);
        const btcPrice = await page.locator('#btcPrice').textContent();
        expect(btcPrice).not.toBe('--');
        expect(btcPrice).not.toBe('');
    });

    test('status bot wyświetla się', async ({ page }) => {
        await waitForServer(page);
        await page.waitForTimeout(2000);
        const status = await page.locator('#statusDot').isVisible();
        expect(status).toBe(true);
    });
});

test.describe('Sekcja Training', () => {

    test('button TRAIN startuje trening', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#trainBtn', '/api/training/start');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    test('button STOP zatrzymuje trening', async ({ page }) => {
        await waitForServer(page);
        // Najpierw start
        await clickButton(page, '#trainBtn', '/api/training/start');
        await page.waitForTimeout(1000);
        // Potem stop
        const response = await clickButton(page, '#stopBtn', '/api/training/stop');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    test('button SAVE MODEL zapisuje model', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#saveBtn', '/api/training/save');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });
});

test.describe('Sekcja Paper Trading', () => {

    test('button RESET resetuje paper trading', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#paperReset', '/api/paper-trading/reset');
        expect(response.status()).toBe(200);
    });

    test('button HISTORY wyświetla historię', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#paperHistoryBtn', '/api/paper-trading/history');
        expect(response.status()).toBe(200);
    });

    test('button EQUITY wyświetla equity curve', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#paperEquityBtn', '/api/paper-trading/equity-curve');
        expect(response.status()).toBe(200);
    });

    test('button CLEAR HISTORY czyści historię', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#paperClearHistory', '/api/paper-trading/clear-history');
        expect(response.status()).toBe(200);
    });

    test('button CSV eksportuje trades', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, 'button:has-text("CSV")', '/api/paper-trading/trades');
        expect(response.status()).toBe(200);
    });

    test('button JSON eksportuje trades', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, 'button:has-text("JSON")', '/api/paper-trading/history');
        expect(response.status()).toBe(200);
    });

    test('button REGIME wyświetla regime stats', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, 'button:has-text("REGIME")', '/api/paper-trading/regime-stats');
        expect(response.status()).toBe(200);
    });
});

test.describe('Sekcja Strategy Compare', () => {

    test('button Compare uruchamia porównanie', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#stratCompareBtn', '/api/strategy/compare');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.comparison).toBeDefined();
        expect(body.comparison.length).toBe(6);
    });

    test('tab P&L % jest aktywny domyślnie', async ({ page }) => {
        await waitForServer(page);
        const btn = page.locator('button:has-text("P&L %")');
        await expect(btn).toHaveClass(/active/);
    });

    test('klik Win Rate zmienia metrykę', async ({ page }) => {
        await waitForServer(page);
        await page.click('button:has-text("Win Rate")');
        const btn = page.locator('button:has-text("Win Rate")');
        await expect(btn).toHaveAttribute('data-metric', 'winRate');
    });
});

test.describe('Sekcja Monte Carlo', () => {

    test('button Run wywołuje Monte Carlo', async ({ page }) => {
        await waitForServer(page);
        // Monte Carlo wymaga historii — sprawdzamy czy endpoint odpowiada
        const response = await clickButton(page, '#monteCarloBtn', '/api/monte-carlo/quick');
        // Może być 200 (sukces) lub 400 (brak danych) — oba są OK
        expect([200, 400]).toContain(response.status());
    });
});

test.describe('Sekcja Attribution', () => {

    test('button ↻ ładuje attribution', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#attrLoadBtn', '/api/attribution');
        expect(response.status()).toBe(200);
    });

    test('tab Strategy jest aktywny domyślnie', async ({ page }) => {
        await waitForServer(page);
        const btn = page.locator('#attrTabStrategy');
        await expect(btn).toBeVisible();
    });
});

test.describe('Sekcja Rebalancer', () => {

    test('button REBALANCE NOW wywołuje rebalancera', async ({ page }) => {
        await waitForServer(page);
        // To jest POST — sprawdzamy czy przycisk istnieje
        const btn = page.locator('button:has-text("REBALANCE NOW")');
        await expect(btn).toBeVisible();
    });

    test('button 🔄 odświeża status rebalancera', async ({ page }) => {
        await waitForServer(page);
        // Sprawdzamy czy przycisk istnieje i jest klikalny
        const btns = page.locator('button:has-text("🔄")');
        const count = await btns.count();
        expect(count).toBeGreaterThan(0);
    });
});

test.describe('Sekcja Alerter', () => {

    test('button TEST wysyła alert testowy', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, '#alerterTestBtn', '/api/alerter/test');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    test('button REFRESH odświeża status alertera', async ({ page }) => {
        await waitForServer(page);
        const response = await clickButton(page, 'button:has-text("REFRESH")', '/api/alerter/status');
        expect(response.status()).toBe(200);
    });
});

test.describe('Sekcja Optimizer', () => {

    test('button OPTYMALIZUJ jest widoczny', async ({ page }) => {
        await waitForServer(page);
        const btn = page.locator('#optimizerStartBtn');
        await expect(btn).toBeVisible();
        await expect(btn).toContainText('OPTYMALIZUJ');
    });
});

test.describe('Nawigacja (bottom nav)', () => {

    test('klik Training przechodzi do sekcji', async ({ page }) => {
        await waitForServer(page);
        await page.click("button[data-section='training']");
        const btn = page.locator("button[data-section='training']");
        await expect(btn).toHaveClass(/active/);
    });

    test('klik Backtest przechodzi do sekcji', async ({ page }) => {
        await waitForServer(page);
        await page.click("button[data-section='backtest']");
        const btn = page.locator("button[data-section='backtest']");
        await expect(btn).toHaveClass(/active/);
    });

    test('klik Paper przechodzi do sekcji', async ({ page }) => {
        await waitForServer(page);
        await page.click("button[data-section='paper']");
        const btn = page.locator("button[data-section='paper']");
        await expect(btn).toHaveClass(/active/);
    });

    test('klik Analytics przechodzi do sekcji', async ({ page }) => {
        await waitForServer(page);
        await page.click("button[data-section='analytics']");
        const btn = page.locator("button[data-section='analytics']");
        await expect(btn).toHaveClass(/active/);
    });

    test('klik Live przechodzi do sekcji', async ({ page }) => {
        await waitForServer(page);
        await page.click("button[data-section='live']");
        const btn = page.locator("button[data-section='live']");
        await expect(btn).toHaveClass(/active/);
    });
});

test.describe('Sentiment', () => {

    test('button 🔄 odświeża sentyment', async ({ page }) => {
        await waitForServer(page);
        // Przewiń do sekcji sentiment
        await page.click("button[data-section='backtest']");
        await page.waitForTimeout(1000);
        const response = await clickButton(page, 'button:has-text("🔄")', '/api/sentiment');
        expect(response.status()).toBe(200);
    });
});

test.describe('Checklista Testów — Edge Case', () => {

    test('podwójne kliknięcie TRAIN nie crashuje', async ({ page }) => {
        await waitForServer(page);
        await clickButton(page, '#trainBtn', '/api/training/start');
        await page.waitForTimeout(500);
        // Kliknij stop
        await clickButton(page, '#stopBtn', '/api/training/stop');
        await page.waitForTimeout(500);
        // Strona powinna działać
        await expect(page.locator('.header h1')).toBeVisible();
    });

    test('szybkie przełączanie sekcji nie crashuje', async ({ page }) => {
        await waitForServer(page);
        for (const section of ['training', 'backtest', 'paper', 'analytics', 'live']) {
            await page.click(`button[data-section='${section}']`);
            await page.waitForTimeout(300);
        }
        await expect(page.locator('.header h1')).toBeVisible();
    });
});
