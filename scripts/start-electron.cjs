const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', error => {
    console.error('Failed to launch Electron:', error.message);
    process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
