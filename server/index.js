/**
 * Simple HTTP Server with Socket.IO (bundled)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 3000;
const HOST = '0.0.0.0';

let btcPrice = 0, ethPrice = 0, solPrice = 0;

// Simple HTTP server
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/html');
    
    if (req.url === '/api/btc/price') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ price: btcPrice, timestamp: new Date().toISOString() }));
        return;
    }
    if (req.url === '/api/eth/price') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ price: ethPrice, timestamp: new Date().toISOString() }));
        return;
    }
    if (req.url === '/api/sol/price') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ price: solPrice, timestamp: new Date().toISOString() }));
        return;
    }
    if (req.url === '/api/status') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({ status: 'running', uptime: process.uptime() }));
        return;
    }
    
    // Serve static files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    const fullPath = path.join(__dirname, '..', 'client', filePath);
    
    if (fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath);
        const contentType = ext === '.js' ? 'application/javascript' : ext === '.html' ? 'text/html' : 'text/plain';
        res.writeHead(200, {'Content-Type': contentType});
        res.end(fs.readFileSync(fullPath));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (r) => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        }).on('error', reject);
    });
}

// Price polling
setInterval(async () => {
    try {
        const [btc, eth, sol] = await Promise.all([
            fetchUrl('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
            fetchUrl('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT'),
            fetchUrl('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
        ]);
        btcPrice = parseFloat(btc.price);
        ethPrice = parseFloat(eth.price);
        solPrice = parseFloat(sol.price);
    } catch (e) { /* ignore */ }
}, 2000);

function getLocalIP() {
    const nets = require('os').networkInterfaces();
    for (const n of Object.keys(nets)) {
        for (const i of nets[n]) {
            if (i.family === 'IPv4' && !i.internal) return i.address;
        }
    }
    return 'localhost';
}

server.listen(PORT, HOST, () => {
    console.log(`🚀 DQN Trading Bot: http://${getLocalIP()}:${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
// test
