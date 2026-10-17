// Smoke test: opens every tool in a phone-sized headless Chromium and fails on
// any uncaught JS error. Firebase is replaced by tests/firebase-stub.js, so it
// never touches real data. Other libraries load from their CDNs as in production.
//
//   npm install && npx playwright install chromium && npm test
//
// FIELDCAM_CDN_SHIM=<path to .mjs> may export `route(route)` returning true when it
// served a CDN request itself — for sandboxes without CDN access.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;
const shim = process.env.FIELDCAM_CDN_SHIM ? await import(path.resolve(process.env.FIELDCAM_CDN_SHIM)) : null;

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['camera', 'geolocation'], geolocation: { latitude: 40.7, longitude: -74 },
    serviceWorkers: 'block',
});
await ctx.route(/^https:\/\//, async r => {
    const url = new URL(r.request().url());
    if (url.pathname.startsWith('/firebasejs/')) {
        return r.fulfill({ path: path.join(root, 'tests/firebase-stub.js'), contentType: 'application/javascript' });
    }
    if (shim && await shim.route(r)) return;
    const host = url.hostname;
    // Keep the test off live services: weather, map tiles
    if (/open-meteo|basemaps|tile/.test(host)) return r.abort();
    return r.continue();
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
const stepErrors = (label) => { check(errors.length === 0, `${label}${errors.length ? ': ' + errors.join(' | ') : ''}`); errors.length = 0; };

// A couple of log entries so the feed, map, detail view and PDF have content
await page.addInitScript(() => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d'); g.fillStyle = '#3366cc'; g.fillRect(0, 0, 320, 240);
    const url = c.toDataURL('image/jpeg'), now = Date.now();
    window.__fixtureDocs = [
        { id: 'p1', projectId: 'Project-Alpha', type: 'photo', photoNumber: 1, title: 'Roof', url, timestamp: now, dateString: 'today', lat: 40.7, lng: -74 },
        { id: 'p2', projectId: 'Project-Alpha', type: 'photo', photoNumber: 2, title: 'Wall', url, timestamp: now + 1, dateString: 'today', lat: 40.71, lng: -74 },
        { id: 'n1', projectId: 'Project-Alpha', type: 'note', title: 'Note', text: 'Body', html: '<b>Body</b>', timestamp: now + 2, dateString: 'today', lat: 40.72, lng: -74 },
    ];
});

await page.goto(`${base}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.app, null, { timeout: 30000 });
await page.waitForTimeout(1000);
check(await page.evaluate(() => document.querySelectorAll('#feed h4, h4').length >= 3), 'log shows entries');
stepErrors('app loads');

// Sketch: draw a stroke and confirm pixels were painted
await page.evaluate(() => window.app.openSketch());
const box = await page.$eval('#sketch-canvas', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y }; });
await page.mouse.move(box.x + 40, box.y + 80); await page.mouse.down();
await page.mouse.move(box.x + 250, box.y + 200, { steps: 10 }); await page.mouse.up();
check(await page.evaluate(() => {
    const c = document.getElementById('sketch-canvas');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0);
}), 'sketch draws');
await page.evaluate(() => { window.app.setSketchBg('grid'); window.app.closeSketch(); });
stepErrors('sketch');

for (const [label, open, close] of [
    ['notes', 'openNotes()', 'closeNotes(true)'],
    ['note pad', 'openNotepad()', 'closeNotepad()'],
]) {
    await page.evaluate(`window.app.${open}`); await page.waitForTimeout(300);
    await page.evaluate(`window.app.${close}`);
    stepErrors(label);
}

await page.click('#btn-camera-main'); await page.waitForTimeout(1500);
await page.evaluate(() => window.app.cancelCamera());
stepErrors('camera');

for (const tab of ['nav-map', 'nav-files', 'nav-report']) {
    await page.click(`#${tab}`); await page.waitForTimeout(600);
    stepErrors(tab.replace('nav-', '') + ' tab');
}
await page.evaluate(() => window.app.showDetail('p1')); await page.waitForTimeout(400);
check(await page.$eval('#det-img', i => i.getAttribute('src')?.startsWith('data:') && getComputedStyle(i).opacity === '1'), 'detail view shows the photo');
await page.evaluate(() => document.getElementById('detail-modal').classList.add('hidden'));
stepErrors('detail view');

// PDF report: wrap jsPDF so save() records instead of downloading
await page.evaluate(() => {
    const Orig = window.jspdf.jsPDF;
    window.jspdf.jsPDF = function (...a) { const d = new Orig(...a); d.save = () => { window.__pdfPages = d.getNumberOfPages(); }; return d; };
    localStorage.setItem('fp_pdf_options', JSON.stringify({ secMap: false }));
});
await page.evaluate(() => window.app.genPDF());
await page.waitForFunction(() => window.__pdfPages, null, { timeout: 30000 }).catch(() => {});
check(await page.evaluate(() => window.__pdfPages > 0), 'PDF report generates');
stepErrors('pdf');

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
