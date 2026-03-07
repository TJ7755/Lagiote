import assert from 'assert';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const root = process.cwd();
const assetsJsDir = path.join(root, 'assets', 'js');
const allowedAssetsJsFiles = new Set([
    'chart.js',
    'mammoth.browser.min.js',
    'pdf.min.js'
]);

function read(filePath) {
    return readFileSync(path.join(root, filePath), 'utf8');
}

function checkAssetsJs() {
    const files = readdirSync(assetsJsDir).sort();
    assert.deepStrictEqual(files, [...allowedAssetsJsFiles].sort(), 'assets/js contains unexpected first-party runtime files');
}

function checkHtmlEntrypoints() {
    const indexHtml = read('index.html');
    const studyHtml = read('study.html');
    const authHtml = read('auth.html');

    assert.ok(indexHtml.includes('./src/platform/web/index-boot.js'), 'index.html must load the web dashboard bootstrap');
    assert.ok(!indexHtml.includes('./js/pages/dashboard.js'), 'index.html must not load dashboard.js directly');
    assert.ok(!indexHtml.includes('./js/pages/bridge.js'), 'index.html must not load bridge.js directly');
    assert.ok(!indexHtml.includes('./js/core/keyboard.js'), 'index.html must not load keyboard.js directly');
    assert.ok(!indexHtml.includes('./js/pages/exam-mode-ui.js'), 'index.html must not load exam-mode-ui.js directly');

    assert.ok(studyHtml.includes('./src/platform/web/study-boot.js'), 'study.html must load the study bootstrap');
    assert.ok(!studyHtml.includes('./js/pages/study.js'), 'study.html must not load study.js directly');

    assert.ok(authHtml.includes('./src/platform/web/auth-page-boot.js'), 'auth.html must load the auth page bootstrap');
}

function checkElectronEntrypoints() {
    const packageJson = JSON.parse(read('package.json'));
    const legacyMain = read('main.js');

    assert.strictEqual(packageJson.main, 'electron-main.cjs', 'package.json main must point to electron-main.cjs');
    assert.ok(legacyMain.includes("require('./electron-main.cjs')"), 'main.js must delegate to electron-main.cjs');
}

function main() {
    checkAssetsJs();
    checkHtmlEntrypoints();
    checkElectronEntrypoints();
    console.log('Runtime structure checks passed.');
}

main();
