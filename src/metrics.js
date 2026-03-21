/**
 * DQN Trading Bot Dashboard
 */
const http = require('http');
const fs = require('fs');
const https = require('https');
const PORT = 3000;

const BINANCE = 'https://api.binance.com';

// State
let prices = { btc: 0, eth: 0, sol: 0 };
let metrics = { trades: 0, wins: 0, losses: 0, equity: 1000, buffer: 0, epsilon: 1.0 };

// Fetch price
function fetchPrice(pair) {
    return new Promise((resolve, reject) => {
        https.get(`${BINANCE}/api/v3/ticker/price?symbol=${pair}`, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve(JSON.parse(d).price); }
                catch { resolve(0); }
            });
        }).on('error', reject);
    });
}

// Dashboard HTML
const DASHBOARD = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>DQN Trading Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: monospace; background: #0d1117; color: #c9d1d9; min-height: 100vh; }
        .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
        
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
        .card h2 { font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 12px; }
        
        .prices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .price-item { background: #0d1117; padding: 16px; border-radius: 6px; text-align: center; }
        .btc { border-left: 3px solid #f7931a; }
        .eth { border-left: 3px solid #627eea; }
        .sol { border-left: 3px solid #14f195; }
        .price-item .pair { font-size: 11px; color: #8b949e; }
        .price-item .value { font-size: 18px; font-weight: bold; margin-top: 8px; }
        .price-item .change { font-size: 11px; margin-top: 4px; }
        
        .green { color: #3fb950; }
        .red { color: #f85149; }
        
        .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #21262d; }
        .metric:last-child { border: none; }
        .metric-label { color: #8b949e; }
        .metric-value { font-weight: 600; }
        .metric-value.green { color: #3fb950; }
        .metric-value.red { color: #f85149; }
        
        .actions { display: grid; gap: 8px; }
        .btn { background: #238636; color: #fff; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-size: 14px; }
        .btn.stop { background: #da3633; }
        .btn:hover { opacity: 0.9; }
        
        .status { display: flex; gap: 16px; font-size: 12px; color: #8b949e; }
        .status span { color: #3fb950; }
        
        .chart { height: 200px; background: #0d1117; border-radius: 6px; margin-top: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <h1 style="margin-bottom: 20px">🤖 DQN Trading Bot Dashboard</h1>
        <div class="status">
            <span>🟢 Online</span>
            <span id="uptime">Uptime: 0s</span>
        </div>
        
        <div class="grid" style="margin-top: 20px">
            <div class="card">
                <h2>💰 Portfolio</h2>
                <div class="metric"><span>Balance</span><span id="balance" class="green">$1000</span></div>
                <div class="metric"><span>Equity</span><span id="equity">$1000</span></div>
                <div class="metric"><span>Open P&L</span><span id="pnl">$0</span></div>
            </div>
            
            <div class="card">
                <h2>📊 Metrics</h2>
                <div class="metric"><span>Trades</span><span id="trades">0</span></div>
                <div class="metric"><span>Wins</span><span class="green" id="wins">0</span></div>
                <div class="metric"><span>Win Rate</span><span id="winRate">0%</span></div>
                <div class="metric"><span>Drawdown</span><span class="red" id="drawdown">0%</span></div>
            </div>
            
            <div class="card">
                <h2>🧠 Agent</h2>
                <div class="metric"><span>Epsilon</span><span id="epsilon">1.000</span></div>
                <div class="metric"><span>Buffer</span><span id="buffer">0</span></div>
                <div class="metric"><span>Loss</span><span id="loss">-</span></div>
                <div class="metric"><span>Episode</span><span id="episode">0</span></div>
            </div>
            
            <div class="card">
                <h2>📈 Live Prices</h2>
                <div class="prices">
                    <div class="price-item btc"><div class="pair">BTC/USDT</div><div class="value" id="btc">-</div></div>
                    <div class="price-item eth"><div class="pair">ETH/USDT</div><div class="value" id="eth">-</div></div>
                    <div class="price-item sol"><div class="pair">SOL/USDT</div><div class="value" id="sol">-</div></div>
                </div>
            </div>
        </div>
    </div>
    <script>
        async function update() {
            try {
                const [btc, eth, sol] = await Promise.all([
                    fetch('/api/btc/price').then(r => r.json()),
                    fetch('/api/eth/price').then(r => r.json()),
                    fetch('/api/sol/price').then(r => r.json())
                ]);
                
                document.getElementById('btc').textContent = '$' + parseFloat(btc.price || 0).toLocaleString();
                document.getElementById('eth').textContent = '$' + parseFloat(eth.price || 0).toLocaleString();
                document.getElementById('sol').textContent = '$' + parseFloat(sol.price || 0).toLocaleString();
                
                const metrics = await fetch('/api/metrics').then(r => r.json()).catch(() => ({});
                if (metrics.trades) {
                    document.getElementById('trades').textContent = metrics.trades;
                }
            } catch (e) {}
        }
        update();
        setInterval(update, 3000);
    </script>
</body>
</html>
`;
</parameter>
</parameter>
