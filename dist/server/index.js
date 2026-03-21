"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Express + Socket.IO Server
 */
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const http = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(http, { cors: { origin: '*' } });
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, 'client')));
// Price cache
let btcPrice = 0;
let ethPrice = 0;
let solPrice = 0;
// REST API
app.get('/api/status', (req, res) => {
    res.json({ status: 'running', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
app.get('/api/btc/price', async (req, res) => {
    try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
        const d = await r.json();
        btcPrice = parseFloat(d.price);
        res.json({ price: btcPrice, timestamp: new Date().toISOString() });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/eth/price', async (req, res) => {
    try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
        const d = await r.json();
        ethPrice = parseFloat(d.price);
        res.json({ price: ethPrice, timestamp: new Date().toISOString() });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/sol/price', async (req, res) => {
    try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
        const d = await r.json();
        solPrice = parseFloat(d.price);
        res.json({ price: solPrice, timestamp: new Date().toISOString() });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/btc/klines', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=${limit}`);
        const d = await r.json();
        const klines = d.map((k) => ({
            time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
            low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
        }));
        res.json({ klines, timestamp: new Date().toISOString() });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Socket.IO
io.on('connection', (socket) => {
    console.log(`Client: ${socket.id}`);
    socket.emit('price', { pair: 'BTC', price: btcPrice });
    socket.emit('price', { pair: 'ETH', price: ethPrice });
    socket.emit('price', { pair: 'SOL', price: solPrice });
});
// Price polling
setInterval(async () => {
    try {
        const [btc, eth, sol] = await Promise.all([
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT').then(r => r.json()),
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT').then(r => r.json()),
            fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT').then(r => r.json())
        ]);
        btcPrice = parseFloat(btc.price);
        ethPrice = parseFloat(eth.price);
        solPrice = parseFloat(sol.price);
        io.emit('price', { pair: 'BTC', price: btcPrice });
        io.emit('price', { pair: 'ETH', price: ethPrice });
        io.emit('price', { pair: 'SOL', price: solPrice });
    }
    catch (e) {
        // Ignore errors
    }
}, 2000);
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
function getLocalIP() {
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const iface of nets[name]) {
            if (iface.family === 'IPv4' && !iface.internal)
                return iface.address;
        }
    }
    return 'localhost';
}
http.listen(PORT, HOST, () => {
    console.log(`🚀 DQN Trading Bot: http://${getLocalIP()}:${PORT}`);
});
process.on('SIGTERM', () => { process.exit(0); });
