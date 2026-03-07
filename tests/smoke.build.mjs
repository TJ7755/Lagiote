import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const distRoot = path.resolve('dist');

function requireFile(...segments) {
    const target = path.join(distRoot, ...segments);
    assert.ok(existsSync(target), `Missing build artifact: ${segments.join('/')}`);
    return target;
}

function assertIdPresent(html, id, context) {
    assert.ok(html.includes(`id="${id}`), `Expected id="${id}" in ${context}`);
}

function checkIndex() {
    const indexPath = requireFile('index.html');
    const html = readFileSync(indexPath, 'utf8');
    ['decksContainer', 'analyticsView', 'cardHistoryModal'].forEach((id) => assertIdPresent(html, id, 'index.html'));
    assert.ok(/assets\/index-.*\.js/.test(html), 'Vite bundle reference missing in index.html');
    assert.ok(!html.includes('js/pages/dashboard.js'), 'index.html build should not reference dashboard.js directly');
    assert.ok(!html.includes('js/pages/bridge.js'), 'index.html build should not reference bridge.js directly');
}

function checkStudy() {
    const studyPath = requireFile('study.html');
    const html = readFileSync(studyPath, 'utf8');
    assertIdPresent(html, 'studyMode', 'study.html');
    assert.ok(/assets\/study-.*\.js/.test(html), 'Vite bundle reference missing in study.html');
    assert.ok(!html.includes('js/pages/study.js'), 'study.html build should not reference study.js directly');
}

function checkAuth() {
    const authPath = requireFile('auth.html');
    const html = readFileSync(authPath, 'utf8');
    assert.ok(/assets\/auth-.*\.js/.test(html), 'Vite bundle reference missing in auth.html');
}

function main() {
    requireFile('assets');
    requireFile('css');
    requireFile('js');
    checkIndex();
    checkStudy();
    checkAuth();
    assert.ok(existsSync(path.resolve('docs/runtime-architecture.md')), 'Runtime architecture documentation missing');
    console.log('Smoke build checks passed.');
}

main();
