/**
 * Strategies Index - eksport wszystkich strategii
 */

const { GridStrategy, backtestGridStrategy } = require('./gridStrategy');

// Re-eksport istniejących strategii z strategies.js
const existingStrategies = require('../strategies');

module.exports = {
    ...existingStrategies,
    GridStrategy,
    backtestGridStrategy,
    getStrategy: (name) => {
        switch(name) {
            case 'grid':
                return new GridStrategy();
            default:
                // Zwróć istniejącą strategię jeśli istnieje
                if (typeof existingStrategies[name] === 'function') {
                    return existingStrategies[name];
                }
                return null;
        }
    }
};
