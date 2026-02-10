#!/usr/bin/env node
// Launch script: ensures ELECTRON_RUN_AS_NODE is removed before starting Electron.
// VSCode's integrated terminal sets this env var, which forces electron.exe
// into plain Node.js mode, breaking require('electron').
const { spawn } = require('child_process');
const electronPath = require('electron');

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env
});

child.on('close', (code, signal) => {
    if (code === null) {
        console.error('electron exited with signal', signal);
        process.exit(1);
    }
    process.exit(code);
});

['SIGINT', 'SIGTERM'].forEach(sig => {
    process.on(sig, () => { if (!child.killed) child.kill(sig); });
});
