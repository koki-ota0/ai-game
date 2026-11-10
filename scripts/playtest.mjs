import { chromium } from '@playwright/test';
import chromiumBin, { inflate, setupLambdaEnvironment } from '@sparticuz/chromium';
import path from 'node:path';

const duration = Number(process.argv[2] ?? 100);
const core = process.argv[3] ?? 'wraith';
const runSeed = process.argv[4] ?? null;
const gameMode = process.argv[5] ?? 'infinite';
const challengeLevel = Number(process.argv[6] ?? 1);
const metaProfile = process.argv[7] ?? 'none'; // none | progression | max
const fastMode = process.argv[8] === 'fast';
const difficulty = process.argv[9] === 'abyss' ? 'abyss' : 'standard';

await inflate(path.resolve('node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
setupLambdaEnvironment('/tmp/al2023/lib');
chromiumBin.setGraphicsMode = false;
const args = chromiumBin.args.filter(arg => arg !== '--single-process' && arg !== '--in-process-gpu');
const browser = await chromium.launch({ executablePath: await chromiumBin.executablePath(), args, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const navigations = [];
page.on('pageerror', error => errors.push(error.stack || error.message));
page.on('crash', () => errors.push('PAGE_CRASH'));
page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push({ url: frame.url(), at: Date.now() }); });
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

let meta = null;
if (gameMode === 'level' && metaProfile !== 'none') {
  meta = await page.evaluate(async ({ challengeLevel, metaProfile }) => {
    const campaign = await import('/src/game/campaign.ts');
    localStorage.setItem(campaign.CAMPAIGN_XP_KEY, '0');
    localStorage.setItem(campaign.CAMPAIGN_LOADOUT_KEY, '{}');
    if (metaProfile === 'max') {
      const bonuses = Object.fromEntries(campaign.INITIAL_BONUSES.map(bonus => [bonus.id, bonus.maxRank]));
      localStorage.setItem(campaign.CAMPAIGN_LOADOUT_KEY, JSON.stringify(bonuses));
      localStorage.setItem('echo-abyss-unlocked-level', String(challengeLevel));
      return { profile: metaProfile, xp: 0, invested: campaign.getBonusInvestedXp(bonuses), ranks: campaign.countBonusRanks(bonuses), bonuses };
    }

    // Spend each previous first-clear reward on a plausible weighted build.
    // Purchases use the real per-rank costs rather than a hidden point budget.
    const order = ['damage', 'fireRate', 'vitality', 'echoDamage', 'vitality', 'damage', 'fireRate', 'vitality', 'echoDamage', 'damage'];
    for (let stage = 1; stage < challengeLevel; stage++) {
      const available = campaign.readCampaignXp() + campaign.getStageXp(stage, true);
      localStorage.setItem(campaign.CAMPAIGN_XP_KEY, String(available));
      let purchased = true;
      while (purchased) {
        purchased = false;
        for (const id of order) {
          const transaction = campaign.purchaseInitialBonus(id);
          if (transaction.changed) purchased = true;
        }
      }
    }
    const bonuses = campaign.readInitialBonuses();
    localStorage.setItem('echo-abyss-unlocked-level', String(challengeLevel));
    return {
      profile: metaProfile, xp: campaign.readCampaignXp(), invested: campaign.getBonusInvestedXp(bonuses),
      ranks: campaign.countBonusRanks(bonuses), bonuses,
    };
  }, { challengeLevel, metaProfile });
  await page.reload({ waitUntil: 'networkidle' });
}

if (core !== 'wraith') await page.locator(`.core-card`).filter({ hasText: core.toUpperCase() }).click();
if (runSeed) {
  // The seed is supplied through the same public start path used by the UI.
  await page.evaluate(({ core, difficulty, runSeed, gameMode, challengeLevel }) => window.__ECHO__.start(core, difficulty, runSeed, gameMode, challengeLevel), { core, difficulty, runSeed, gameMode, challengeLevel });
} else {
  if (gameMode === 'infinite' && difficulty === 'abyss') await page.getByRole('button', { name: /ABYSS/ }).click();
  await page.getByRole('button', { name: /潜行を開始/ }).click();
}
if (fastMode) {
  await page.evaluate(() => {
    const engine = window.__ECHO__;
    const render = engine.render.bind(engine);
    let frame = 0;
    engine.render = time => { if (frame++ % 6 === 0) render(time); };
  });
}

const started = Date.now();
console.log(`MODE ${gameMode}${gameMode === 'level' ? ` ${String(challengeLevel).padStart(3, '0')}` : ''} // ${difficulty} // ${core} // ${runSeed ?? 'RANDOM'}`);
if (meta) console.log('META', JSON.stringify(meta));
let lastLog = -10;
let lastShot = 0;
const priorities = ['残響の同時召喚', '追加攻撃', '引力場', 'ダッシュで残響生成', '武器ダメージ強化', '攻撃速度強化', '残響の火力', '残響の持続', '共鳴ダメージ', '自動シールド', '最大HP', '貫通弾'];
let drafts = 0;

while ((Date.now() - started) / 1000 < duration) {
  const elapsed = (Date.now() - started) / 1000;
  const state = await page.evaluate(() => {
    const engine = window.__ECHO__;
    const snapshot = engine.getDebugSnapshot();
    if (snapshot.status === 'draft') return { snapshot };
    if (snapshot.status !== 'running') return { snapshot };
    const p = engine.player;
    const bossTarget = engine.enemies.find(enemy => enemy.kind === 'boss' && !enemy.dead);
    // Use the same manual-fire path as a human during the boss fight so the
    // autoplay measures boss durability instead of nearest-target add clear.
    engine.pointer.down = Boolean(bossTarget);
    engine.pointer.inside = Boolean(bossTarget);
    if (bossTarget) { engine.pointer.x = bossTarget.x; engine.pointer.y = bossTarget.y; }
    let x = 0, y = 0;
    let nearest = 9999;
    for (const enemy of engine.enemies) {
      if (enemy.dead) continue;
      const dx = p.x - enemy.x, dy = p.y - enemy.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      nearest = Math.min(nearest, d - enemy.radius);
      const range = enemy.kind === 'boss' ? (engine.core === 'bastion' ? 255 : engine.core === 'tempest' ? 345 : 420) : 285;
      if (d < range) {
        const force = (range - d) / range * (enemy.kind === 'boss' ? 2.4 : 1.25);
        x += dx / d * force; y += dy / d * force;
      }
    }
    for (const shot of engine.projectiles) {
      if (shot.friendly || shot.life <= 0) continue;
      const dx = p.x - shot.x, dy = p.y - shot.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (d < 175) {
        const force = (175 - d) / 175 * 2.6;
        x += dx / d * force; y += dy / d * force;
      }
    }
    let targetPickup = null, pickupDistance = 440;
    for (const pickup of engine.pickups) {
      const d = Math.hypot(p.x - pickup.x, p.y - pickup.y);
      if (d < pickupDistance) { pickupDistance = d; targetPickup = pickup; }
    }
    if (targetPickup && nearest > 95) {
      x += (targetPickup.x - p.x) / Math.max(1, pickupDistance) * 0.65;
      y += (targetPickup.y - p.y) / Math.max(1, pickupDistance) * 0.65;
    }
    if (engine.rift && (nearest > 85 || engine.rift.progress > 0)) {
      const dx = engine.rift.x - p.x, dy = engine.rift.y - p.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      if (d > 24) { x += dx / d * 1.05; y += dy / d * 1.05; }
    }
    if (p.x < 180) x += 1.2; if (p.x > 1420) x -= 1.2;
    if (p.y < 160) y += 1.2; if (p.y > 740) y -= 1.2;
    if (Math.hypot(x, y) < 0.15) { x = Math.cos(engine.elapsed * 0.45); y = Math.sin(engine.elapsed * 0.45); }
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    engine.setTouchMove(x, y);
    if (p.echoCooldown <= 0 && engine.elapsed > 5) engine.triggerEcho();
    if (p.dashCooldown <= 0 && nearest < 72) engine.triggerDash();
    const skillRange = engine.core === 'bastion' ? 285 : engine.core === 'tempest' ? 450 : 900;
    if (p.weaponCooldown <= 0 && nearest < skillRange && engine.elapsed > 2) engine.triggerWeaponSkill();
    if (p.sync >= 100) engine.triggerOverdrive();
    return {
      snapshot,
      elapsed: engine.elapsed,
      kills: engine.kills,
      hp: p.hp,
      maxHp: p.stats.maxHp,
      sync: p.sync,
      stacks: engine.stacks,
      boss: engine.enemies.some(enemy => enemy.kind === 'boss' && !enemy.dead),
      bossHp: engine.enemies.find(enemy => enemy.kind === 'boss' && !enemy.dead)?.hp ?? null,
      rift: engine.rift ? engine.rift.progress / engine.rift.duration : null,
    };
  });

  if (state.snapshot.status === 'draft') {
    const cards = page.locator('.upgrade-card');
    let selected = null;
    for (const priority of priorities) {
      const candidate = cards.filter({ hasText: priority });
      if (await candidate.count()) { selected = candidate.first(); break; }
    }
    if (!selected) selected = cards.first();
    if (drafts === 0) await page.screenshot({ path: 'test-results/playtest-first-draft.png' });
    await selected.click();
    drafts++;
  }
  if (state.snapshot.status === 'checkpoint') {
    console.log(`CHECKPOINT ${state.snapshot.sector} // CONTINUE`);
    await page.evaluate(() => window.__ECHO__.continueInfinite());
  }
  if (state.snapshot.status === 'gameover' || state.snapshot.status === 'idle') break;
  if (state.snapshot.status === 'paused') await page.evaluate(() => window.__ECHO__.resume());

  if (state.elapsed !== undefined && state.elapsed - lastLog >= 10) {
    lastLog = state.elapsed;
    console.log(JSON.stringify({
      t: Number(state.elapsed.toFixed(1)), sector: state.snapshot.sector,
      level: state.snapshot.level, hp: Math.round(state.hp), kills: state.kills,
      enemies: state.snapshot.enemies, echoes: state.snapshot.echoes,
      sync: Math.round(state.sync), boss: state.boss, bossHp: state.bossHp === null ? null : Math.round(state.bossHp),
      cleanup: state.snapshot.cleanupStarted ? state.snapshot.remainingEnemies : null,
      rift: state.rift === null ? null : `${Math.floor(state.rift * 100)}%`, upgrades: state.stacks,
    }));
  }
  if (state.elapsed !== undefined && state.elapsed >= lastShot + 30) {
    lastShot = state.elapsed;
    await page.screenshot({ path: `test-results/playtest-${Math.round(state.elapsed)}s.png` });
  }
  await page.waitForTimeout(120);
}

await page.screenshot({ path: 'test-results/playtest-final.png' });
console.log('FINAL', await page.evaluate(() => ({ ...window.__ECHO__.getDebugSnapshot(), kills: window.__ECHO__.kills, elapsed: window.__ECHO__.elapsed, stacks: window.__ECHO__.stacks, campaignXp: Number(localStorage.getItem('echo-abyss-campaign-xp') ?? 0), victory: window.__ECHO__.status === 'gameover' && window.__ECHO__.player.hp > 0 })));
console.log('DRAFTS', drafts, 'ERRORS', errors, 'NAVIGATIONS', navigations);
await browser.close();
