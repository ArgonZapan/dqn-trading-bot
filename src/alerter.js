/**
 * Alerter - Email/SMS alerts for DQN Trading Bot
 * Fallback: alerts.log when no credentials configured
 */
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const ALERTS_LOG = path.join(__dirname, '..', 'alerts.log');

class Alerter {
    constructor(config = {}) {
        // Email config
        this.smtpHost = config.smtpHost || process.env.SMTP_HOST || '';
        this.smtpPort = parseInt(config.smtpPort || process.env.SMTP_PORT || '587');
        this.smtpUser = config.smtpUser || process.env.SMTP_USER || '';
        this.smtpPass = config.smtpPass || process.env.SMTP_PASS || '';
        this.alertEmail = config.alertEmail || process.env.ALERT_EMAIL || '';
        
        // SMS config (Twilio)
        this.twilioSid = config.twilioSid || process.env.TWILIO_ACCOUNT_SID || '';
        this.twilioToken = config.twilioToken || process.env.TWILIO_AUTH_TOKEN || '';
        this.twilioPhone = config.twilioPhone || process.env.TWILIO_PHONE_NUMBER || '';
        this.alertPhone = config.alertPhone || process.env.ALERT_PHONE || '';
        
        // Telegram fallback
        this.telegramToken = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
        this.telegramChatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        
        // Alert toggles
        this.enabled = !!(config.alertEnabled ?? (this.smtpHost && this.smtpUser && this.alertEmail));
        this.alertOnTrade = config.alertOnTrade ?? false;
        this.alertOnProfit = config.alertOnProfit ?? 5;     // % threshold, 0 = off
        this.alertOnLoss = config.alertOnLoss ?? 5;         // % threshold, 0 = off
        this.alertOnTrainingStart = config.alertOnTrainingStart ?? false;
        this.alertOnTrainingEnd = config.alertOnTrainingEnd ?? false;
        this.alertOnTradeSize = config.alertOnTradeSize ?? 10; // % of portfolio, 0 = off
        
        this.emailEnabled = !!(this.smtpHost && this.smtpUser && this.alertEmail);
        this.smsEnabled = !!(this.twilioSid && this.twilioToken && this.twilioPhone && this.alertPhone);
        this.telegramEnabled = !!(this.telegramToken && this.telegramChatId);
        
        this._initTransporter();
    }
    
    _initTransporter() {
        if (!this.emailEnabled) return;
        this.transporter = nodemailer.createTransport({
            host: this.smtpHost,
            port: this.smtpPort,
            secure: this.smtpPort === 465,
            auth: {
                user: this.smtpUser,
                pass: this.smtpPass
            }
        });
    }
    
    /**
     * Log to alerts.log (fallback when no email/SMS)
     */
    _log(subject, body) {
        const safeSubject = subject == null ? 'UNKNOWN' : String(subject);
        const safeBody = body == null ? 'No details' : String(body);
        const msg = `[${new Date().toISOString()}] [ALERT] ${safeSubject}\n${safeBody}\n${'─'.repeat(50)}`;
        console.log(msg);
        try {
            fs.appendFileSync(ALERTS_LOG, msg + '\n');
        } catch(e) {
            console.error('[Alerter] Log write failed:', e.message);
        }
    }
    
    /**
     * Send alert via email, SMS, Telegram, or log
     */
    async send(type, subject, body) {
        const safeType = type == null ? 'ALERT' : String(type);
        const safeSubject = subject == null ? 'UNKNOWN' : String(subject);
        const safeBody = body == null ? 'No details' : String(body);
        const fullSubject = `[DQN] ${safeSubject}`;
        
        // Always log
        this._log(fullSubject, body);
        
        let sent = false;
        
        // Try email
        if (this.emailEnabled) {
            try {
                await this.transporter.sendMail({
                    from: `"DQN Trading Bot" <${this.smtpUser}>`,
                    to: this.alertEmail,
                    subject: fullSubject,
                    text: safeBody,
                    html: `<div style="font-family: Arial; padding: 20px; background: #f5f5f5;">
                        <h2 style="color: #333;">🤖 DQN Trading Bot</h2>
                        <h3 style="color: #e67e22;">${safeSubject}</h3>
                        <pre style="color: #555; font-size: 14px;">${safeBody}</pre>
                        <hr><p style="color: #999; font-size: 12px;">${new Date().toLocaleString()}</p>
                    </div>`
                });
                console.log(`[Alerter] Email sent: ${subject}`);
                sent = true;
            } catch (err) {
                console.error(`[Alerter] Email failed: ${err.message}`);
            }
        }
        
        // Try SMS (Twilio)
        if (this.smsEnabled && this.alertPhone) {
            try {
                await this._sendTwilioSMS(`${fullSubject}: ${body.substring(0, 160)}`);
                sent = true;
            } catch (err) {
                console.error(`[Alerter] SMS failed: ${err.message}`);
            }
        }
        
        // Try Telegram
        if (this.telegramEnabled) {
            await this._sendTelegram(`📢 ${safeType}: ${safeSubject}\n${safeBody}`);
        }
        
        return sent;
    }
    
    /**
     * Twilio SMS
     */
    async _sendTwilioSMS(message) {
        const https = require('https');
        const auth = Buffer.from(`${this.twilioSid}:${this.twilioToken}`).toString('base64');
        const body = JSON.stringify({
            To: this.alertPhone,
            From: this.twilioPhone,
            Body: message
        });
        
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.twilio.com',
                path: `/2010-04-01/Accounts/${this.twilioSid}/Messages.json`,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                }
            };
            const req = https.request(options, (res) => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(d);
                        if (res.statusCode === 201 || res.statusCode === 200) {
                            console.log('[Alerter] SMS sent via Twilio');
                            resolve(true);
                        } else {
                            reject(new Error(parsed.message || 'Twilio error'));
                        }
                    } catch(e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }
    
    /**
     * Telegram message
     */
    async _sendTelegram(message) {
        const https = require('https');
        const body = JSON.stringify({
            chat_id: this.telegramChatId,
            text: message,
            parse_mode: 'HTML'
        });
        
        return new Promise((resolve) => {
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${this.telegramToken}/sendMessage`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            };
            const req = https.request(options, (res) => resolve(res.statusCode === 200));
            req.on('error', () => resolve(false));
            req.write(body);
            req.end();
        });
    }
    
    /**
     * Check if alert should trigger based on thresholds
     */
    shouldAlert(type, value, threshold) {
        if (!this.enabled) return false;
        if (!threshold || threshold <= 0) return false;
        return Math.abs(value) >= threshold;
    }
    
    // ─── Alert Types ─────────────────────────────────────────────────────────
    
    /**
     * Trade alert
     */
    async tradeAlert(action, price, quantity, pnl, portfolioPct) {
        if (!this.shouldAlert('trade', portfolioPct, this.alertOnTradeSize)) {
            // Still send if ALERT_ON_TRADE is enabled
            if (!this.alertOnTrade) return false;
        }
        
        const subject = `${action === 'BUY' ? '🟢' : '🔴'} ${action} Trade`;
        const body = `Action: ${action}\nPrice: $${price?.toFixed(2)}\nQuantity: ${quantity}\nP&L: ${pnl ? (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) : '-'}\nPortfolio: ${portfolioPct?.toFixed(1)}%\nTime: ${new Date().toLocaleString()}`;
        return this.send('TRADE', subject, body);
    }
    
    /**
     * Profit alert
     */
    async profitAlert(currentEquity, startEquity, percentChange) {
        if (!this.shouldAlert('profit', percentChange, this.alertOnProfit)) return false;
        
        const subject = '📈 Profit Alert';
        const body = `Equity: $${currentEquity.toFixed(2)}\nP&L: +${percentChange.toFixed(2)}%\nStart: $${startEquity.toFixed(2)}\nTime: ${new Date().toLocaleString()}`;
        return this.send('PROFIT', subject, body);
    }
    
    /**
     * Loss alert
     */
    async lossAlert(currentEquity, startEquity, percentChange) {
        if (!this.shouldAlert('loss', percentChange, this.alertOnLoss)) return false;
        
        const subject = '📉 Loss Alert';
        const body = `Equity: $${currentEquity.toFixed(2)}\nP&L: ${percentChange.toFixed(2)}%\nStart: $${startEquity.toFixed(2)}\nTime: ${new Date().toLocaleString()}`;
        return this.send('LOSS', subject, body);
    }
    
    /**
     * Drawdown alert
     */
    async drawdownAlert(currentDrawdown, maxAllowed = 10) {
        const subject = '⚠️ Drawdown Alert';
        const body = `Current drawdown: ${currentDrawdown.toFixed(2)}%\nMax allowed: ${maxAllowed}%\nConsider stopping training or adjusting risk.`;
        return this.send('DRAWDOWN', subject, body);
    }
    
    /**
     * Training start alert
     */
    async trainingStartAlert(episode, balance) {
        if (!this.alertOnTrainingStart) return false;
        
        const subject = '▶️ Training Started';
        const body = `Episode: #${episode}\nBalance: $${balance.toFixed(2)}\nTime: ${new Date().toLocaleString()}`;
        return this.send('TRAINING_START', subject, body);
    }
    
    /**
     * Training end alert (with stats)
     */
    async trainingEndAlert(stats) {
        if (!this.alertOnTrainingEnd) return false;
        
        const subject = `🏁 Training Episode #${stats.episode} Complete`;
        const body = `Episode: #${stats.episode}
Equity: $${stats.equity.toFixed(2)}
P&L: ${stats.pnlPct >= 0 ? '+' : ''}${stats.pnlPct.toFixed(2)}%
Trades: ${stats.tradesCount}
Win Rate: ${stats.winRate?.toFixed(1)}%
Max Drawdown: ${stats.maxDrawdown?.toFixed(2)}%
Final Epsilon: ${stats.epsilon?.toFixed(4)}
Duration: ${stats.duration ? Math.round(stats.duration / 1000) + 's' : '-'}
Time: ${new Date().toLocaleString()}`;
        return this.send('TRAINING_END', subject, body);
    }
    
    /**
     * Error alert
     */
    async errorAlert(error, context = '') {
        const subject = '🔴 Trading Bot Error';
        const body = `Error: ${error?.message || error}\nContext: ${context}\nTime: ${new Date().toLocaleString()}`;
        return this.send('ERROR', subject, body);
    }
    
    /**
     * Milestone alert
     */
    async milestoneAlert(balance, totalTrades, winRate) {
        const subject = '🎯 Trading Milestone';
        const body = `Balance: $${balance.toFixed(2)}\nTotal Trades: ${totalTrades}\nWin Rate: ${(winRate * 100).toFixed(1)}%`;
        return this.send('MILESTONE', subject, body);
    }
    
    /**
     * Daily summary
     */
    async dailySummary(stats) {
        const subject = '📊 Daily Summary';
        const body = `Balance: $${stats.balance.toFixed(2)}
Total P&L: ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}
Total Trades: ${stats.totalTrades}
Win Rate: ${(stats.winRate * 100).toFixed(1)}%
Max Drawdown: ${stats.maxDrawdownPercent.toFixed(2)}%
Profit Factor: ${stats.profitFactor?.toFixed(2) || 'N/A'}`;
        return this.send('DAILY_SUMMARY', subject, body);
    }
    
    /**
     * Test alert
     */
    async test() {
        const result = await this.send('TEST', '🧪 Test Alert', 
            'This is a test alert from DQN Trading Bot.\nIf you receive this, alerts are working correctly!');
        if (result && this.telegramEnabled) {
            await this._sendTelegram('✅ Alerter test complete');
        }
        return result;
    }
    
    /**
     * Get config (safe - no secrets)
     */
    getConfig() {
        return {
            enabled: this.enabled,
            emailEnabled: this.emailEnabled,
            smsEnabled: this.smsEnabled,
            telegramEnabled: this.telegramEnabled,
            alertEmail: this.alertEmail ? this.alertEmail.replace(/(.{2}).+(@.+)/, '$1***$2') : null,
            alertPhone: this.alertPhone ? '***' + this.alertPhone.slice(-4) : null,
            smtpHost: this.smtpHost || null,
            alertOnTrade: this.alertOnTrade,
            alertOnProfit: this.alertOnProfit,
            alertOnLoss: this.alertOnLoss,
            alertOnTrainingStart: this.alertOnTrainingStart,
            alertOnTrainingEnd: this.alertOnTrainingEnd,
            alertOnTradeSize: this.alertOnTradeSize
        };
    }
    
    /**
     * Update config
     */
    updateConfig(config) {
        if (typeof config.alertEnabled === 'boolean') this.enabled = config.alertEnabled;
        if (typeof config.alertOnTrade === 'boolean') this.alertOnTrade = config.alertOnTrade;
        if (typeof config.alertOnProfit === 'number') this.alertOnProfit = config.alertOnProfit;
        if (typeof config.alertOnLoss === 'number') this.alertOnLoss = config.alertOnLoss;
        if (typeof config.alertOnTrainingStart === 'boolean') this.alertOnTrainingStart = config.alertOnTrainingStart;
        if (typeof config.alertOnTrainingEnd === 'boolean') this.alertOnTrainingEnd = config.alertOnTrainingEnd;
        if (typeof config.alertOnTradeSize === 'number') this.alertOnTradeSize = config.alertOnTradeSize;
        if (config.alertEmail) this.alertEmail = config.alertEmail;
        if (config.alertPhone) this.alertPhone = config.alertPhone;
    }
}

module.exports = Alerter;
