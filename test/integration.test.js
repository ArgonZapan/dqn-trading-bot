/**
 * Integration tests - verify server + agent + environment
 */

const http = require('http');

// Test server
function test(name, fn) {
    return new Promise((res, rej) => {
        try {
            fn();
            console.log('✅', name);
            res();
        } catch(e) {
            console.log('❌', name, e.message);
            rej(e);
        }
    });
}

async function run() {
    console.log('\n🧪 Integration Tests\n');
    
    // Test modules
    await test('dqnAgent.js', () => require('./src/dqnAgent'));
    await test('environment.js', () => require('./src/environment'));
    await test('indicators.js', () => require('./src/indicators'));
    
    // Test server
    console.log('\n   Server: node server/index.js (wymaga osobnego terminala)');
    
    console.log('\n✅ Wszystkie moduły załadowane\n');
}

run().catch(console.error);
