import { chromium } from '@playwright/test';
import chromiumBin, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = '/tmp/echo-promo';
const rawDir = path.join(root, 'raw');
await fs.mkdir(rawDir, { recursive: true });
await inflate(path.resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
setupLambdaEnvironment('/tmp/al2023/lib');
chromiumBin.setGraphicsMode = false;
const args = chromiumBin.args.filter(arg => arg !== '--single-process' && arg !== '--in-process-gpu');
const browser = await chromium.launch({ executablePath: await chromiumBin.executablePath(), args, headless: true });

async function makePage(name) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } },
  });
  await context.addInitScript(() => localStorage.setItem('echo-abyss-tutorial-complete', '1'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  return { context, page, video: page.video(), name, errors };
}

async function finish(recording) {
  await recording.context.close();
  const output = path.join(rawDir, `${recording.name}.webm`);
  await recording.video.saveAs(output);
  console.log(`${recording.name}: ${output}; errors=${JSON.stringify(recording.errors)}`);
}

async function startRun(page, scene, core = 'wraith', mode = 'infinite') {
  await page.evaluate(async ({ scene, core, mode }) => {
    await window.__ECHO__.start(core, 'standard', `PROMO-${scene}`, mode, 1);
    window.__ECHO__.tutorialEnabled = false;
    window.__ECHO__.tutorialStep = 5;
  }, { scene, core, mode });
  await page.waitForTimeout(500);
}

async function drive(page, seconds, scene = 'combat') {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const status = await page.evaluate(({ scene }) => {
      const engine = window.__ECHO__;
      if (engine.status !== 'running') return engine.status;
      const p = engine.player;
      const living = engine.enemies.filter(enemy => !enemy.dead);
      const boss = living.find(enemy => enemy.kind === 'boss');
      const target = scene === 'boss' ? boss : living.sort((a, b) =>
        Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
      if (target) {
        engine.pointer.inside = true;
        engine.pointer.down = true;
        engine.pointer.x = target.x;
        engine.pointer.y = target.y;
      }
      let x = Math.cos(engine.elapsed * 0.72) * 0.45;
      let y = Math.sin(engine.elapsed * 0.72) * 0.45;
      for (const enemy of living) {
        const dx = p.x - enemy.x, dy = p.y - enemy.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        if (d < 250) {
          const force = (250 - d) / 250 * (enemy.kind === 'boss' ? 1.8 : 1.15);
          x += dx / d * force; y += dy / d * force;
        }
      }
      if (p.x < 190) x += 1; if (p.x > 1410) x -= 1;
      if (p.y < 160) y += 1; if (p.y > 740) y -= 1;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      engine.setTouchMove(x, y);
      if (engine.elapsed > 1.2 && p.echoCooldown <= 0) engine.triggerEcho();
      if (target && p.weaponCooldown <= 0 && engine.elapsed > 0.8) engine.triggerWeaponSkill();
      if (p.dashCooldown <= 0 && living.some(enemy => Math.hypot(enemy.x - p.x, enemy.y - p.y) < 80)) engine.triggerDash();
      if (p.sync >= 100) engine.triggerOverdrive();
      // Keep the capture focused on combat rather than an accidental game-over.
      if (p.hp > 0 && p.hp < p.stats.maxHp * 0.22) p.hp = p.stats.maxHp * 0.65;
      return engine.status;
    }, { scene });
    if (status === 'draft') await page.locator('.upgrade-card').first().click();
    if (status === 'checkpoint') await page.evaluate(() => window.__ECHO__.continueInfinite());
    if (status === 'gameover') break;
    await page.waitForTimeout(100);
  }
}

// Clean combat: echo, manual fire and the wraith rail are all visible.
{
  const recording = await makePage('combat');
  await startRun(recording.page, 'COMBAT');
  await drive(recording.page, 10, 'combat');
  await finish(recording);
}

// A deliberately lined-up wave makes the piercing rail legible in the edit.
{
  const recording = await makePage('rail');
  await startRun(recording.page, 'RAIL');
  await recording.page.evaluate(() => {
    const engine = window.__ECHO__;
    engine.enemies = [];
    engine.player.x = 290; engine.player.y = 450; engine.player.angle = 0;
    for (let index = 0; index < 7; index++) engine.spawnEnemy(index % 3 === 0 ? 'tank' : 'drone', 560 + index * 115, 450, false);
    engine.pointer.inside = true; engine.pointer.down = true; engine.pointer.x = 1250; engine.pointer.y = 450;
    engine.triggerWeaponSkill();
  });
  await drive(recording.page, 4.5, 'rail');
  await finish(recording);
}

// Real draft UI, followed by a real upgrade selection.
{
  const recording = await makePage('draft');
  await startRun(recording.page, 'DRAFT');
  await recording.page.evaluate(() => {
    const engine = window.__ECHO__;
    engine.enemies = []; engine.spawnTimer = 999;
    engine.player.xp = engine.player.xpNext;
    engine.checkLevelUp();
  });
  await recording.page.waitForTimeout(3000);
  await recording.page.locator('.upgrade-card').first().click();
  await drive(recording.page, 1.5, 'combat');
  await finish(recording);
}

// Boss footage uses the same live boss and player weapon systems as a normal run.
{
  const recording = await makePage('boss');
  await startRun(recording.page, 'BOSS');
  await recording.page.evaluate(() => {
    const engine = window.__ECHO__;
    engine.sector = 3; engine.enemies = []; engine.bossSpawned = true; engine.spawnTimer = 999;
    engine.spawnBoss();
    for (let index = 0; index < 5; index++) engine.spawnEnemy('drone', 430 + index * 190, 650, false);
  });
  await drive(recording.page, 8.5, 'boss');
  await finish(recording);
}

// The actual title screen supplies the mode-selection shot.
{
  const recording = await makePage('menu');
  await recording.page.waitForTimeout(2200);
  await recording.page.getByRole('button', { name: 'LEVEL', exact: true }).click();
  await recording.page.waitForTimeout(2200);
  await finish(recording);
}

await browser.close();
