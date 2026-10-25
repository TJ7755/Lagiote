import { spawnSync } from 'node:child_process';

const tests = [
    'platform-services',
    'cortex',
    'mcq-remediation',
    'utils',
    'eval-assignment-stratified',
    'sequence-utils',
    'exam-weak-area-prioritization'
];

for (const test of tests) {
    const result = spawnSync(process.execPath, ['--no-warnings', `tests/${test}.test.mjs`], {
        env: { ...process.env, NODE_ENV: 'test' },
        stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
