/**
 * Validator - Sprawdza konfigurację
 */
const fs = require('fs');

const vars = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
let ok = true;
for (const v of vars) {
    if (!process.env[v]) {
        console.log(`⚠️ ${v} nie ustawione`);
        ok = false;
    }
}
if (ok) console.log('✅ Wszystkie wymagane zmienne ustawione');
process.exit(ok ? 0 : 1);
