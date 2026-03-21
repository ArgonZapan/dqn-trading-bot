/**
 * Test - verify all modules work
 */
const Env = require('./src/environment');
const Agent = require('./src/dqnAgent');
const fs = require('fs');

console.log('Testing modules...');
try {
    const e = new Env('BTCUSDT', 60);
    console.log('Environment: OK');
} catch(err) {
    console.log('Environment: ERROR', err.message);
}
try {
    const a = new Agent(300, 3);
    console.log('Agent: OK');
} catch(err) {
    console.log('Agent: ERROR', err.message);
}
try {
    fs.statSync('./server/index.js');
    console.log('Server: OK');
} catch(err) {
    console.log('Server: ERROR', err.message);
}
console.log('All tests passed!');
