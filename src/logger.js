/**
 * Logger - Structured logging with rotation
 */

const fs = require('fs');
const path = require('path');

class Logger {
    constructor(dir = '/tmp') {
        this.dir = dir;
        this.file = path.join(dir, `bot-${new Date().toISOString().slice(0, 10)}.log`);
    }

    write(level, ...args) {
        const msg = `[${new Date().toISOString()}] [${level}] ${args.join(' ')}`;
        console.log(msg);
        try {
            fs.appendFileSync(this.file, msg + '\n');
        } catch (e) {}
    }

    info(...args) { this.write('INFO', ...args); }
    warn(...args) { this.write('WARN', ...args); }
    error(...args) { this.write('ERROR', ...args); }
}

module.exports = new Logger();
