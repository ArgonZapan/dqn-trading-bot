/**
 * Notifier - Telegram notifications for trading events
 */

class Notifier {
    constructor(botToken, chatId) {
        this.token = botToken;
        this.chatId = chatId;
        this.enabled = !!botToken;
        this.https = require('https');
    }

    send(message, parseMode = 'HTML') {
        if (!this.enabled) return;
        
        const data = JSON.stringify({
            chat_id: this.chatId,
            text: message,
            parse_mode: parseMode
        });
        
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${this.token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };
        
        const req = this.https.request(options, (res) => {
            // Async response handling
        });
        
        req.on('error', () => {});
        req.write(data);
        req.end();
    }

    trade(action, price, quantity, pnl) {
        const emoji = action === 'BUY' ? '🟢' : '🔴';
        const msg = `${emoji} <b>${action}</b>\n💰 Price: $${price}\n📊 Qty: ${quantity}\n💵 P&L: ${pnl ? '$' + pnl.toFixed(2) : '-'}\n🕐 ${new Date().toLocaleTimeString()}`;
        this.send(msg);
    }

    milestone(balance, percent) {
        this.send(`🎯 <b>Milestone!</b>\n💰 Balance: $${balance.toFixed(2)}\n📈 P&L: ${percent > 0 ? '+' : ''}${percent.toFixed(2)}%\n${new Date().toLocaleString()}`);
    }

    error(err) {
        this.send(`⚠️ <b>Error</b>\n${err.message}\n${new Date().toLocaleTimeString()}`);
    }

    test() {
        this.send('✅ Bot działa!');
    }
}

module.exports = Notifier;
