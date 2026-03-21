/**
 * Alerter - Email/SMS alerts for trading events
 * Supports Email (nodemailer) and SMS (via Telegram as fallback)
 */

const nodemailer = require('nodemailer');

class Alerter {
    constructor(config = {}) {
        // Email config
        this.smtpHost = config.smtpHost || process.env.SMTP_HOST || '';
        this.smtpPort = parseInt(config.smtpPort || process.env.SMTP_PORT || '587');
        this.smtpUser = config.smtpUser || process.env.SMTP_USER || '';
        this.smtpPass = config.smtpPass || process.env.SMTP_PASS || '';
        this.alertEmail = config.alertEmail || process.env.ALERT_EMAIL || '';
        
        // Telegram fallback
        this.telegramToken = config.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
        this.telegramChatId = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        
        this.enabled = !!(this.smtpHost && this.smtpUser && this.alertEmail);
        this.smsFallback = !!(this.telegramToken && this.telegramChatId);
        
        this._initTransporter();
    }
    
    _initTransporter() {
        if (!this.enabled) return;
        
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
     * Send email alert
     */
    async sendEmail(subject, body) {
        if (!this.enabled) {
            return this._sendTelegramFallback(`📧 EMAIL (not configured): ${subject}\n${body}`);
        }
        
        try {
            await this.transporter.sendMail({
                from: `"DQN Trading Bot" <${this.smtpUser}>`,
                to: this.alertEmail,
                subject: `[DQN] ${subject}`,
                text: body,
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5;">
                        <h2 style="color: #333;">🤖 DQN Trading Bot Alert</h2>
                        <h3 style="color: #e67e22;">${subject}</h3>
                        <p style="color: #555; font-size: 14px;">${body.replace(/\n/g, '<br>')}</p>
                        <hr style="border: 1px solid #ddd;">
                        <p style="color: #999; font-size: 12px;">
                            Sent by DQN Trading Bot • ${new Date().toLocaleString()}
                        </p>
                    </div>
                `
            });
            console.log(`[Alerter] Email sent: ${subject}`);
            return true;
        } catch (err) {
            console.error(`[Alerter] Email failed: ${err.message}`);
            // Fallback to Telegram
            return this._sendTelegramFallback(`📧 EMAIL ERROR: ${subject}\n${body}`);
        }
    }
    
    /**
     * Send Telegram message (fallback or direct)
     */
    async _sendTelegramFallback(message) {
        if (!this.smsFallback) return false;
        
        const data = JSON.stringify({
            chat_id: this.telegramChatId,
            text: message,
            parse_mode: 'HTML'
        });
        
        return new Promise((resolve) => {
            const https = require('https');
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${this.telegramToken}/sendMessage`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            };
            
            const req = https.request(options, (res) => resolve(res.statusCode === 200));
            req.on('error', () => resolve(false));
            req.write(data);
            req.end();
        });
    }
    
    /**
     * Alert on large drawdown
     */
    async drawdownAlert(currentDrawdown, maxAllowed = 10) {
        const subject = '⚠️ Drawdown Alert';
        const body = `Current drawdown: ${currentDrawdown.toFixed(2)}%\nMax allowed: ${maxAllowed}%\n\nConsider stopping training or adjusting risk parameters.`;
        return this.sendEmail(subject, body);
    }
    
    /**
     * Alert on significant P&L change
     */
    async pnlAlert(currentPnl, percentChange) {
        const subject = percentChange > 0 ? '📈 Profit Alert' : '📉 Loss Alert';
        const body = `P&L: $${currentPnl.toFixed(2)} (${percentChange > 0 ? '+' : ''}${percentChange.toFixed(2)}%)\nTime: ${new Date().toLocaleString()}`;
        return this.sendEmail(subject, body);
    }
    
    /**
     * Alert on trade milestone
     */
    async milestoneAlert(balance, totalTrades, winRate) {
        const subject = '🎯 Trading Milestone';
        const body = `Balance: $${balance.toFixed(2)}\nTotal Trades: ${totalTrades}\nWin Rate: ${(winRate * 100).toFixed(1)}%\n\nGreat progress!`;
        return this.sendEmail(subject, body);
    }
    
    /**
     * Alert on error
     */
    async errorAlert(error, context = '') {
        const subject = '🔴 Trading Bot Error';
        const body = `Error: ${error.message}\nStack: ${error.stack}\nContext: ${context}\nTime: ${new Date().toLocaleString()}`;
        return this.sendEmail(subject, body);
    }
    
    /**
     * Daily summary
     */
    async dailySummary(stats) {
        const subject = '📊 Daily Summary';
        const body = `
Trading Day Summary:
━━━━━━━━━━━━━━━━━━━━
💰 Balance: $${stats.balance.toFixed(2)}
📈 Total P&L: ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}
📊 Total Trades: ${stats.totalTrades}
✅ Win Rate: ${(stats.winRate * 100).toFixed(1)}%
📉 Max Drawdown: ${stats.maxDrawdownPercent.toFixed(2)}%
🔄 Profit Factor: ${stats.profitFactor.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━
        `.trim();
        return this.sendEmail(subject, body);
    }
    
    /**
     * Test alert
     */
    async test() {
        const result = await this.sendEmail('🧪 Test Alert', 'This is a test alert from DQN Trading Bot.\n\nIf you receive this, email alerts are working correctly!');
        if (result && this.smsFallback) {
            await this._sendTelegramFallback('✅ Alerter test complete - email sent successfully');
        }
        return result;
    }
}

module.exports = Alerter;
