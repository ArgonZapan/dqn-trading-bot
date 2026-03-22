/**
 * Strategies Index - eksport wszystkich strategii
 */

const { GridStrategy, backtestGridStrategy } = require('./gridStrategy');
const { ScalpingStrategy, backtestScalpingStrategy } = require('./scalpingStrategy');

// Re-eksport istniejących strategii z strategies.js
const existingStrategies = require('../strategies');

module.exports = {
    ...existingStrategies,
    GridStrategy,
    backtestGridStrategy,
    ScalpingStrategy,
    backtestScalpingStrategy,
    getStrategy: (name) => {
        switch(name) {
            case 'grid':
                return new GridStrategy();
            case 'scalping':
                return new ScalpingStrategy();
            default:
                // Zwróć istniejącą strategię jeśli istnieje
                if (typeof existingStrategies[name] === 'function') {
                    return existingStrategies[name];
                }
                return null;
        }
    }
};
