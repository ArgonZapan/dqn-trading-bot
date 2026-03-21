/**
 * Express + Socket.IO Server
 */
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

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
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/eth/price', async (req, res) => {
    try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
        const d = await r.json();
        ethPrice = parseFloat(d.price);
        res.json({ price: ethPrice, timestamp: new Date().toISOString() });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sol/price', async (req, res) => {
    try {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
        const d = await r.json();
        solPrice = parseFloat(d.price);
        res.json({ price: solPrice, timestamp: new Date().toISOString() });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/btc/klines', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=${limit}`);
        const d = await r.json();
        const klines = d.map((k: any[]) => ({
            time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
            low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5])
        }));
        res.json({ klines, timestamp: new Date().toISOString() });
    } catch (e: any) {
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
    } catch (e) {
        // Ignore errors
    }
}, 2000);

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

function getLocalIP() {
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const iface of nets[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

http.listen(PORT, HOST, () => {
    console.log(`🚀 DQN Trading Bot: http://${getLocalIP()}:${PORT}`);
});

process.on('SIGTERM', () => { process.exit(0); });
