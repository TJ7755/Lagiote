import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const pkgPath = path.resolve('package.json');
const pkgData = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
const scripts = pkgData.scripts || {};
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
    { label: 'npm test', args: ['test'], scriptKey: 'test' },
    { label: 'npm run test:unit', args: ['run', 'test:unit'], scriptKey: 'test:unit' },
    { label: 'npm run test:e2e:web', args: ['run', 'test:e2e:web'], scriptKey: 'test:e2e:web' },
    { label: 'npm run test:e2e:electron', args: ['run', 'test:e2e:electron'], scriptKey: 'test:e2e:electron', optional: true }
];

const runStep = (step) => new Promise((resolve) => {
    const child = spawn(npmCmd, step.args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
});

for (const step of steps) {
    if (!scripts[step.scriptKey]) {
        if (step.optional) {
            console.log(`Skipping ${step.label} (script missing)`);
            continue;
        }
        console.error(`Missing script for ${step.label}`);
        process.exit(1);
    }
    console.log(`Running ${step.label}`);
    const code = await runStep(step);
    if (code !== 0) {
        console.error(`Step failed: ${step.label}`);
        process.exit(code || 1);
    }
}
