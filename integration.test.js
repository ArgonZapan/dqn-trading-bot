/**
 * Integration test - wszystkie moduły
 */
const modules = [
    './src/dqnAgent',
    './src/environment', 
    './src/indicators',
    './src/portfolio'
];

let passed = 0, failed = 0;
for (const m of modules) {
    try {
        require(m);
        console.log('✅', m);
        passed++;
    } catch(e) {
        console.log('❌', m, e.message);
        failed++;
    }
}

console.log(`\nPassed: ${passed}/${modules.length}`);

if (failed > 0) process.exit(1);
