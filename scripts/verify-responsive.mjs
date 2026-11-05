import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../apps/widget-demo/dist');
const screensDir = path.resolve(__dirname, '../temp_screens');

if (!fs.existsSync(screensDir)) {
  fs.mkdirSync(screensDir, { recursive: true });
}

// 1. Static file server for apps/widget-demo/dist
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || !path.extname(reqPath)) {
    reqPath = '/index.html';
  }
  const filePath = path.join(distDir, reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback
    const indexHtml = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexHtml).pipe(res);
  }
});

await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve));
console.log('Static preview server listening at http://127.0.0.1:4173');

// 2. Launch headless Edge with remote debugging
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const edgeProcess = spawn(edgePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  'about:blank',
]);

// Wait for CDP to be ready
let versionData = null;
for (let i = 0; i < 30; i++) {
  try {
    const response = await fetch('http://127.0.0.1:9222/json/version');
    if (response.ok) {
      versionData = await response.json();
      break;
    }
  } catch (err) {}
  await new Promise((r) => setTimeout(r, 200));
}

if (!versionData) {
  console.error('Failed to connect to Edge CDP');
  edgeProcess.kill();
  server.close();
  process.exit(1);
}

console.log('Connected to Edge CDP:', versionData.Browser);

// Create a new tab
const newTabRes = await fetch('http://127.0.0.1:9222/json/new?http://127.0.0.1:4173', { method: 'PUT' });
const tabData = await newTabRes.json();
const wsUrl = tabData.webSocketDebuggerUrl;

const ws = new WebSocket(wsUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));

let id = 1;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(data.error);
    else resolve(data.result);
  }
});

function send(method, params = {}) {
  const msgId = id++;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

await send('Page.enable');
await send('DOM.enable');

// Helper to evaluate JavaScript in the page
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res.result?.value;
}

// Wait for DOM to render
await new Promise((r) => setTimeout(r, 1000));

const viewports = [
  { name: 'Mobile (390px)', width: 390, height: 844 },
  { name: 'Tablet (768px)', width: 768, height: 1024 },
  { name: 'Desktop (1440px)', width: 1440, height: 900 },
];

const results = [];

for (const vp of viewports) {
  console.log(`\n========================================`);
  console.log(`Verifying viewport: ${vp.name} (${vp.width}x${vp.height})`);
  console.log(`========================================`);

  await send('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: vp.width <= 768,
  });

  await new Promise((r) => setTimeout(r, 400));

  // Test across all 3 sites
  const sites = ['sentinel', 'docs', 'cloud'];
  for (const site of sites) {
    // Click tab to switch site
    const clickResult = await evaluate(`
      (() => {
        const btn = document.querySelector('.tab-${site}');
        if (btn) {
          btn.click();
          return { clicked: true, text: btn.textContent };
        }
        return { clicked: false };
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    const currentTitle = await evaluate(`document.querySelector('.site-title')?.textContent`);
    console.log(`Switched to ${site}: clickResult=`, clickResult, `currentTitle=`, currentTitle);
    await new Promise((r) => setTimeout(r, 300));

    const check = await evaluate(`
      (() => {
        const bodyWidth = document.body.getBoundingClientRect().width;
        const docScrollWidth = document.documentElement.scrollWidth;
        const innerWidth = window.innerWidth;
        const hasHorizontalOverflow = docScrollWidth > innerWidth;

        // Navbar & Tabs check
        const navbar = document.querySelector('.showcase-navbar');
        const brand = document.querySelector('.showcase-brand');
        const tabs = document.querySelector('.showcase-tabs');
        const navRect = navbar ? navbar.getBoundingClientRect() : null;
        const brandRect = brand ? brand.getBoundingClientRect() : null;
        const tabsRect = tabs ? tabs.getBoundingClientRect() : null;

        let navbarOverlaps = false;
        if (brandRect && tabsRect) {
          // Check if brand and tabs intersect
          const intersects = !(
            brandRect.right <= tabsRect.left ||
            brandRect.left >= tabsRect.right ||
            brandRect.bottom <= tabsRect.top ||
            brandRect.top >= tabsRect.bottom
          );
          navbarOverlaps = intersects;
        }

        // Docs sidebar check
        let docsSidebarStacked = true;
        if ('${site}' === 'docs') {
          const sidebar = document.querySelector('.docs-sidebar');
          const article = document.querySelector('.docs-layout article');
          if (sidebar && article) {
            const sRect = sidebar.getBoundingClientRect();
            const aRect = article.getBoundingClientRect();
            if (window.innerWidth <= 768) {
              // Should be stacked (sidebar top < article top and article below sidebar)
              docsSidebarStacked = sRect.bottom <= aRect.top + 5;
            } else {
              // Should be side-by-side on desktop
              docsSidebarStacked = false; // side by side
            }
          }
        }

        // Widget launcher position check
        const launcher = document.querySelector('.nexus-launcher-btn');
        let launcherInside = true;
        let launcherRect = null;
        if (launcher) {
          const lRect = launcher.getBoundingClientRect();
          launcherRect = { top: lRect.top, left: lRect.left, right: lRect.right, bottom: lRect.bottom, width: lRect.width, height: lRect.height };
          launcherInside = (
            lRect.left >= 0 &&
            lRect.right <= innerWidth + 1 &&
            lRect.top >= 0 &&
            lRect.bottom <= window.innerHeight + 1
          );
        }

        return {
          site: '${site}',
          innerWidth,
          docScrollWidth,
          hasHorizontalOverflow,
          navbarOverlaps,
          docsSidebarStacked,
          launcherInside,
          launcherRect,
        };
      })()
    `);

    // Capture screenshot
    const shotRes = await send('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(screensDir, `${site}-${vp.width}px.png`);
    fs.writeFileSync(shotPath, Buffer.from(shotRes.data, 'base64'));

    console.log(`[${site.toUpperCase()}] at ${vp.width}px:`);
    console.log(`  - Horizontal Overflow: ${check.hasHorizontalOverflow ? 'FAIL (scrollWidth: ' + check.docScrollWidth + ' > ' + check.innerWidth + ')' : 'PASS (0 overflow)'}`);
    console.log(`  - Navbar/Tabs Overlap: ${check.navbarOverlaps ? 'FAIL (overlapping)' : 'PASS (no overlap)'}`);
    if (site === 'docs') {
      console.log(`  - Docs Sidebar Stacked: ${vp.width <= 768 ? (check.docsSidebarStacked ? 'PASS (stacked above content)' : 'FAIL (not stacked)') : 'PASS (side-by-side desktop)'}`);
    }
    console.log(`  - Widget Launcher in Viewport: ${check.launcherInside ? 'PASS (' + JSON.stringify(check.launcherRect) + ')' : 'FAIL'}`);
    console.log(`  - Screenshot saved: ${shotPath}`);

    results.push({ viewport: vp.name, width: vp.width, ...check });
  }
}

// Cleanup
ws.close();
edgeProcess.kill();
server.close();

console.log('\n========================================');
console.log('ALL RESPONSIVE CHECKS COMPLETE');
console.log('========================================');

const failures = results.filter(
  (r) => r.hasHorizontalOverflow || r.navbarOverlaps || !r.launcherInside || (r.site === 'docs' && r.width <= 768 && !r.docsSidebarStacked)
);

if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} issues detected!`);
  process.exit(1);
} else {
  console.log('SUCCESS: All checks passed at 390px, 768px, and 1440px!');
}
