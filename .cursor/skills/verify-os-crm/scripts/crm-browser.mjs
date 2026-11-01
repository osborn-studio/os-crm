#!/usr/bin/env node
// crm-browser.mjs — drive 伴圆 CRM in headless Chrome over CDP with real mouse/keyboard input.
// Verification scaffolding, not product code. Needs Node >=22 (global WebSocket) and Chrome/Chromium.
// Usage: CRM_URL=http://127.0.0.1:<web> node crm-browser.mjs <steps.json> <out-prefix>
// steps.json is a JSON array; each step is one object:
//   {"goto": "/login"}                                   navigate (relative to CRM_URL)
//   {"login": "sales"}                                   UI login: pick role tab, type SEED_ADMIN_PASSWORD, click 登录
//   {"click": "新建客户", "within": ".ant-modal"}          real mouse click on the visible button/link/menu item whose text
//                                                          (whitespace-stripped, so "确 定" == "确定") equals the value
//   {"fill": "客户名称", "value": "...", "within": ".ant-modal"}  focus the input whose Form label / placeholder matches, select all, type
//   {"press": "Enter"}                                    key press on the focused element
//   {"waitText": "已保存", "timeoutMs": 15000}             wait until document.body.innerText contains the text
//   {"waitGone": "...", "timeoutMs": 15000}               wait until the text is gone
//   {"expectUrl": "/dashboard"}                           wait until location.pathname equals the value
//   {"shot": "label"}                                     write <out-prefix>.<label>.png, .text.txt, .ax.txt (accessibility tree)
//   {"sleep": 500}
// Values may contain ${RUN_ID}; it is replaced from the environment. Writes <out-prefix>.steps.log.
// Exit 0 only if every step succeeded. The seed password is never written to any artifact.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [stepsFile, out] = process.argv.slice(2);
if (!stepsFile || !out) { console.error('usage: crm-browser.mjs <steps.json> <out-prefix>'); process.exit(2); }
const base = process.env.CRM_URL;
if (!base) { console.error('set CRM_URL'); process.exit(2); }
const sub = (v) => (typeof v === 'string' ? v.replaceAll('${RUN_ID}', process.env.RUN_ID ?? 'default') : v);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const chromeBin = process.env.CHROME_BIN ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!chromeBin) { console.error('no Chrome/Chromium found; set CHROME_BIN'); process.exit(2); }
const logFile = `${out}.steps.log`;
writeFileSync(logFile, `# ${new Date().toISOString()} CRM_URL=${base} steps=${stepsFile}\n`);
const say = (s) => { console.log(s); appendFileSync(logFile, s + '\n'); };

const profile = mkdtempSync(join(tmpdir(), 'oscrm-verify-chrome-'));
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--lang=zh-CN',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 1;
try {
  let port; const t0 = Date.now();
  while (!port && Date.now() - t0 < 15000) {
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
  }
  if (!port) throw new Error('Chrome did not expose a DevTools port');
  const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Accessibility.enable');
  const until = async (expr, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(200); }
    throw new Error(`timeout ${ms}ms waiting for ${what}`);
  };
  // Locate a visible element and return its center; the click itself is a real CDP mouse event.
  const locate = (kind, text, within) => `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const want = norm(${JSON.stringify(text)});
    const scopes = ${JSON.stringify(within ?? null)} ? [...document.querySelectorAll(${JSON.stringify(within ?? 'body')})] : [document.body];
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    let el = null;
    for (const scope of scopes.filter(visible)) {
      if (${JSON.stringify(kind)} === 'click') {
        const c = [...scope.querySelectorAll('button, a, [role=menuitem], [role=tab], [role=option], .ant-segmented-item, .ant-select-item-option, .ant-menu-submenu-title')]
          .filter((e) => visible(e) && norm(e.innerText) === want);
        if (c.length) el = c[c.length - 1];
      } else {
        const label = [...scope.querySelectorAll('label')].find((l) => visible(l) && norm(l.innerText) === want);
        el = (label && label.htmlFor && scope.querySelector('#' + CSS.escape(label.htmlFor)))
          || [...scope.querySelectorAll('input, textarea')].find((e) => visible(e) && norm(e.placeholder) === want) || null;
      }
      if (el) break;
    }
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    document.querySelectorAll('[data-verify-target]').forEach((e) => e.removeAttribute('data-verify-target'));
    el.setAttribute('data-verify-target', '1');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, key: [r.left, r.top, r.width, r.height].map(Math.round).join(',') };
  })()`;
  const findAndClick = async (kind, text, within, ms = 10000) => {
    // Wait for the element to exist AND hold still (antd modals/drawers animate in; clicking mid-animation misses).
    const end = Date.now() + ms; let pos = null, prev = null;
    while (Date.now() < end) {
      pos = await evaluate(locate(kind, text, within));
      if (pos && prev && pos.key === prev.key) break;
      prev = pos; await sleep(150);
    }
    if (!pos) throw new Error(`no visible ${kind === 'click' ? 'clickable' : 'input'} named ${JSON.stringify(text)}${within ? ' within ' + within : ''}`);
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    if (kind === 'fill' && !(await evaluate("document.activeElement?.hasAttribute('data-verify-target')")))
      throw new Error(`clicked ${JSON.stringify(text)} but focus did not land in it (overlay or animation?)`);
    return pos;
  };
  const keys = { Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 } };
  const press = async (k) => {
    const d = keys[k]; if (!d) throw new Error('unsupported key ' + k);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...d }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...d });
  };
  const type = async (value) => {
    await evaluate(`(() => { const e = document.activeElement; if (e && 'select' in e) e.select(); })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.insertText', { text: value });
  };
  const shot = async (label) => {
    const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(`${out}.${label}.png`, Buffer.from(png.result.data, 'base64'));
    writeFileSync(`${out}.${label}.text.txt`, `url: ${await evaluate('location.href')}\n\n${await evaluate('document.body.innerText')}`);
    const ax = await send('Accessibility.getFullAXTree');
    const lines = (ax.result?.nodes ?? []).filter((n) => !n.ignored && n.name?.value && !['StaticText', 'InlineTextBox', 'generic'].includes(n.role?.value))
      .map((n) => `${n.role?.value}: ${n.name.value}`);
    writeFileSync(`${out}.${label}.ax.txt`, lines.join('\n') + '\n');
    return `${out}.${label}.{png,text.txt,ax.txt}`;
  };
  for (const [i, raw] of steps.entries()) {
    const s = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, sub(v)]));
    const ms = s.timeoutMs ?? 15000; const t = Date.now();
    try {
      let note = '';
      if (s.goto !== undefined) { await send('Page.navigate', { url: new URL(s.goto, base).href }); await until("document.readyState === 'complete'", ms, 'load'); }
      else if (s.login !== undefined) {
        const pw = process.env.SEED_ADMIN_PASSWORD; if (!pw) throw new Error('SEED_ADMIN_PASSWORD not set');
        const tabs = { admin: 'admin', manager: '销售主管', sales: '销售', boss: '老板' };
        await send('Page.navigate', { url: new URL('/login', base).href });
        await until("!!document.querySelector('input[placeholder=\"密码\"]')", ms, 'login form');
        if (tabs[s.login]) await findAndClick('click', tabs[s.login], '.ant-segmented');
        else { await findAndClick('fill', '用户名'); await type(s.login); }
        await findAndClick('fill', '密码'); await type(pw);
        await findAndClick('click', '登录');
        await until("location.pathname === '/dashboard'", ms, 'redirect to /dashboard');
        note = `as ${s.login}`;
      }
      else if (s.click !== undefined) { const p = await findAndClick('click', s.click, s.within, ms); note = `${p.tag}@${Math.round(p.x)},${Math.round(p.y)}`; }
      else if (s.fill !== undefined) { await findAndClick('fill', s.fill, s.within, ms); await type(String(s.value)); note = `= ${JSON.stringify(s.value)}`; }
      else if (s.press !== undefined) await press(s.press);
      else if (s.waitText !== undefined) await until(`document.body.innerText.includes(${JSON.stringify(s.waitText)})`, ms, `text ${JSON.stringify(s.waitText)}`);
      else if (s.waitGone !== undefined) await until(`!document.body.innerText.includes(${JSON.stringify(s.waitGone)})`, ms, `text gone ${JSON.stringify(s.waitGone)}`);
      else if (s.expectUrl !== undefined) await until(`location.pathname === ${JSON.stringify(s.expectUrl)}`, ms, `path ${s.expectUrl}`);
      else if (s.shot !== undefined) note = await shot(s.shot);
      else if (s.sleep !== undefined) await sleep(s.sleep);
      else throw new Error('unknown step ' + JSON.stringify(raw));
      say(`ok   #${i} ${JSON.stringify(raw)} ${note} (${Date.now() - t}ms)`);
    } catch (e) {
      say(`FAIL #${i} ${JSON.stringify(raw)}: ${e instanceof Error ? e.message : e}`);
      say('failure screenshot: ' + (await shot(`fail-${i}`).catch(() => 'n/a')));
      throw e;
    }
  }
  code = 0; say('all steps passed');
  ws.close();
} catch (e) {
  console.error(`crm-browser: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  chrome.kill('SIGTERM'); await sleep(300); rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
