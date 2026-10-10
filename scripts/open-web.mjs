import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const url = 'http://127.0.0.1:3000';
const root = fileURLToPath(new URL('../', import.meta.url));
async function ready() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return false;
    const text = await response.text();
    return text.includes('Hà Đông') || text.includes('Flood');
  } catch { return false; }
}

try {
  if (!(await ready())) {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: root, detached: true, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, PORT: '3000' }
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    let running = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await ready()) { running = true; break; }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!running) throw new Error('Khong khoi dong duoc web. Cong 3000 co the dang duoc ung dung khac su dung.');
  }
  const browser = spawn('explorer.exe', [url], { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    browser.once('spawn', resolve);
    browser.once('error', reject);
  });
  browser.unref();
  console.log('Da mo website. Ban co the dong cua so nay.');
} catch (error) {
  console.error(error.message);
  console.error('Thu chay: node server.mjs, sau do mo http://localhost:3000');
  process.exitCode = 1;
}
