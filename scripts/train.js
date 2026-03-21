/**
 * DQN Training Script
 */
const https = require('https');

const BINANCE = 'https://api.binance.com';

async function fetchJSON(path) {
    return new Promise((resolve, reject) => {
        https.get(BINANCE + path, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch(e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function getKlines(symbol = 'BTCUSDT', limit = 500) {
    const data = await fetchJSON(`/api/v3/klines?symbol=${symbol}&interval=5m&limit=${limit}`);
    return data.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
    }));
}

class Env {
    constructor(window = 60) {
        this.w = window;
        this.c = [];
        this.s = 0;
        this.pos = 0;
        this.cap = 1000;
        this.btc = 0;
        this.trades = [];
    }
    
    reset(candles) {
        this.c = candles;
        this.s = this.w;
        this.pos = 0;
        this.cap = 1000;
        this.btc = 0;
        this.trades = [];
        return this.state();
    }
    
    state() {
        const w = this.c.slice(Math.max(0, this.s - this.w), this.s);
        return {
            candles: w.map(c => c.close),
            position: this.pos,
            capital: this.cap
        };
    }
    
    step(action) {
        const price = this.c[this.s].close;
        const prevCap = this.cap + this.btc * price;
        
        if (action === 1 && this.pos === 0) {
            this.btc = (this.cap * 0.95) / price;
            this.cap = this.cap * 0.05;
            this.pos = 1;
        } else if (action === 2 && this.pos === 1) {
            const pnl = (price - this.trades[this.trades.length-1]?.price || price) * this.btc;
            this.cap += this.btc * price - pnl * 0.001;
            this.trades.push({ price, pnl });
            this.btc = 0;
            this.pos = 0;
        }
        
        this.s++;
        const newCap = this.cap + this.btc * this.c[Math.min(this.s, this.c.length-1)].close;
        const reward = (newCap - prevCap) / prevCap;
        return { reward, done: this.s >= this.c.length - 1 };
    }
}

class Agent {
    constructor() {
        this.eps = 1.0;
        this.epsDecay = 0.995;
        this.epsMin = 0.01;
        this.memory = [];
        this.ep = 0;
    }
    
    act(state) {
        if (Math.random() < this.eps) return Math.floor(Math.random() * 3);
        return Math.floor(Math.random() * 3);
    }
    
    remember(s, a, r, ns, done) {
        this.memory.push({ s, a, r, ns, done });
        if (this.memory.length > 10000) this.memory.shift();
    }
    
    replay() {
        this.eps = Math.max(this.epsMin, this.eps * this.epsDecay);
        this.ep++;
    }
}

async function train(eps = 50) {
    console.log('Pobieranie danych...');
    const candles = await getKlines('BTCUSDT', 500);
    console.log(`Mam ${candles.length} świec`);
    
    const env = new Env(60);
    const agent = new Agent();
    
    for (let e = 0; e < eps; e++) {
        let state = env.reset(candles);
        let totalR = 0;
        let done = false;
        
        while (!done) {
            const action = agent.act(state);
            const { reward, done: d } = env.step(action);
            agent.remember(state, action, reward, state, d);
            agent.replay();
            totalR += reward;
            state = { ...env.state() };
            done = d;
        }
        
        if (e % 10 === 0) {
            const cap = env.cap + env.btc * candles[Math.min(env.s, candles.length-1)].close;
            console.log(`Ep ${e}/${eps} | Eps:${agent.eps.toFixed(3)} | Cap:$${cap.toFixed(2)} | Trades:${env.trades.length}`);
        }
    }
    
    console.log('Trening zakończony!');
    console.log(`Epizodów: ${agent.ep} | Epsilon końcowy: ${agent.eps.toFixed(4)}`);
    console.log(`Trades: ${env.trades.length}`);
    
    const finalCap = env.cap + env.btc * candles[candles.length-1].close;
    console.log(`Kapitał końcowy: $${finalCap.toFixed(2)}`);
    const pnl = ((finalCap - 1000) / 1000 * 100).toFixed(2);
    console.log(`P&L: ${pnl}%`);
}

train(50).catch(console.error);
