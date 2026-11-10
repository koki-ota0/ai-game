import { test, expect } from '@playwright/test';
import { SoundSystem } from '../src/game/audio';
import { BASTION_COLOR, CORES, ECHO_COLOR } from '../src/game/types';
import { UPGRADES } from '../src/game/upgrades';
import { BOSS_DEFINITIONS } from '../src/game/bosses';
import { getRunXpRequirement } from '../src/game/GameEngine';
import { getBonusInvestedXp, getBonusUpgradeCost, getStageXp, TOTAL_BONUS_RANKS } from '../src/game/campaign';

const snapshot = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__ECHO__.getDebugSnapshot());

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /潜行を開始/ })).toBeVisible();
});

test('title, loadout, and field manual work without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page).toHaveTitle('ECHO//ABYSS');
  await expect(page.locator('h1')).toContainText('ABYSS');
  await page.locator('.core-card').filter({ hasText: 'TEMPEST' }).click();
  await expect(page.locator('.core-card.selected')).toContainText('CHAIN ARC');
  await page.getByRole('button', { name: '遊び方' }).click();
  await expect(page.getByRole('dialog', { name: '遊び方' })).toBeVisible();
  await expect(page.getByText('過去の自分は、最高の相棒')).toBeVisible();
  await page.getByRole('tab', { name: '武器・敵図鑑' }).click();
  await expect(page.locator('.enemy-guide h3').filter({ hasText: 'スナイパー' })).toBeVisible();
  await expect(page.getByText('長い砲身。赤い照準線が固定されたら射線から離れる。')).toBeVisible();
  await page.getByRole('button', { name: '理解した' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('finished sound effects disconnect their audio nodes', () => {
  const sound = new SoundSystem() as any;
  let oscillatorDisconnects = 0;
  let gainDisconnects = 0;
  const gain = {
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {}, disconnect() { gainDisconnects++; },
  };
  const oscillator = {
    type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    onended: null as null | (() => void),
    connect() {}, start() {}, stop() {},
    disconnect() { oscillatorDisconnects++; },
  };
  sound.context = { currentTime: 0, createOscillator: () => oscillator, createGain: () => gain };
  sound.master = {};
  sound.play('select');
  const cleanup = oscillator.onended;
  cleanup?.();
  expect({ oscillatorDisconnects, gainDisconnects, cleared: oscillator.onended === null })
    .toEqual({ oscillatorDisconnects: 1, gainDisconnects: 1, cleared: true });
});

test('movement, echo, pause, draft, reroll, death, and same-seed retry form a complete run', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /潜行を開始/ }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  const seed = (await snapshot(page)).seed;

  await page.keyboard.down('d');
  await page.waitForTimeout(550);
  await page.keyboard.up('d');
  expect((await snapshot(page)).player.x).toBeGreaterThan(850);

  await page.keyboard.press('e');
  await expect.poll(async () => (await snapshot(page)).echoes).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '時間停止中' })).toBeVisible();
  expect((await snapshot(page)).status).toBe('paused');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');

  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.player.xp = engine.player.xpNext;
  });
  await expect.poll(async () => (await snapshot(page)).status).toBe('draft');
  await expect(page.locator('.upgrade-card')).toHaveCount(3);
  await page.getByRole('button', { name: /選択肢を再構成/ }).click();
  await expect(page.getByRole('button', { name: /選択肢を再構成/ })).toBeDisabled();
  await page.locator('.upgrade-card').first().click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');

  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.player.invulnerable = 0; engine.player.shieldReady = false;
    engine.hurtPlayer(99999);
  });
  await expect(page.getByText('SIGNAL', { exact: false })).toBeVisible();
  await expect(page.locator('.final-score')).toBeVisible();
  await page.getByRole('button', { name: /同じ時間へ戻る/ }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  expect((await snapshot(page)).seed).toBe(seed);
  expect(errors).toEqual([]);
});

test('INFINITE offers one free ad revive per run and LEVEL offers none', async ({ page }) => {
  await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'REVIVE-ONCE', 'infinite');
    engine.score = 4000; engine.level = 3; engine.player.level = 3;
    engine.enemyShot(engine.player.x + 100, engine.player.y, 0, 100, 10, 6);
    engine.player.invulnerable = 0; engine.player.shieldReady = false;
    engine.hurtPlayer(99999);
  });
  await expect(page.getByRole('heading', { name: 'SIGNAL LOST' })).toBeVisible();
  await expect(page.getByRole('button', { name: /広告を見て復活/ })).toBeVisible();
  await expect(page.locator('.revive-offer')).toContainText('現在は広告なしで即復活');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-runs'))).toBe('1');

  await page.getByRole('button', { name: /広告を見て復活/ }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  await expect(page.locator('.result-panel')).toHaveCount(0);
  const revived = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    return {
      hp: engine.player.hp, maxHp: engine.player.stats.maxHp, invulnerable: engine.player.invulnerable,
      enemyProjectiles: engine.projectiles.filter((projectile: any) => !projectile.friendly).length,
      score: engine.score, level: engine.level, reviveUsed: engine.reviveUsed,
    };
  });
  expect(revived.hp).toBeCloseTo(revived.maxHp * 0.5, 5);
  expect(revived.invulnerable).toBeGreaterThan(0);
  expect(revived.invulnerable).toBeLessThanOrEqual(3);
  expect(revived.enemyProjectiles).toBe(0);
  expect(revived.score).toBeGreaterThanOrEqual(4000);
  expect(revived.level).toBe(3);
  expect(revived.reviveUsed).toBe(true);

  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.player.invulnerable = 0; engine.player.shieldReady = false;
    engine.hurtPlayer(99999);
  });
  await expect(page.getByRole('heading', { name: 'SIGNAL LOST' })).toBeVisible();
  await expect(page.getByRole('button', { name: /広告を見て復活/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__ECHO__.reviveInfinite())).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-runs'))).toBe('1');

  await page.getByRole('button', { name: /同じ時間へ戻る/ }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  expect((await snapshot(page)).reviveUsed).toBe(false);
  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.player.invulnerable = 0; engine.player.shieldReady = false;
    engine.hurtPlayer(99999);
  });
  await expect(page.getByRole('button', { name: /広告を見て復活/ })).toBeVisible();

  await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'REVIVE-LEVEL', 'level', 1);
    engine.player.invulnerable = 0; engine.player.shieldReady = false;
    engine.hurtPlayer(99999);
  });
  await expect(page.getByRole('heading', { name: 'SIGNAL LOST' })).toBeVisible();
  await expect(page.getByRole('button', { name: /広告を見て復活/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__ECHO__.reviveInfinite())).toBe(false);
});

test('all frames initialize distinct weapons with weaker opening balance in both modes', async ({ page }) => {
  for (const core of ['wraith', 'tempest', 'bastion']) {
    await page.evaluate(({ core }) => (window as any).__ECHO__.start(core, 'standard', `CORE-${core}`), { core });
    await expect.poll(async () => (await snapshot(page)).status).toBe('running');
    const state = await page.evaluate(() => {
      const engine = (window as any).__ECHO__;
      const choices = Array.from({ length: 8 }, () => engine.makeDraft('level').choices.map((choice: any) => ({ id: choice.id, icon: choice.icon }))).flat();
      return {
        core: engine.core, chain: engine.player.stats.chain, hp: engine.player.stats.maxHp,
        damage: engine.player.stats.damage, fireRate: engine.player.stats.fireRate,
        dashCooldown: engine.player.stats.dashCooldown, echoCooldown: engine.player.stats.echoCooldown,
        weaponSkillCooldown: engine.weaponSkillCooldown,
        critChance: engine.player.stats.critChance, choices,
      };
    });
    const frame = ({
      wraith: { damage: 23, fireRate: 3.6, hp: 100, skill: 5 },
      tempest: { damage: 25, fireRate: 1.55, hp: 90, skill: 7 },
      bastion: { damage: 16, fireRate: 1.05, hp: 130, skill: 7 },
    } as Record<string, { damage: number; fireRate: number; hp: number; skill: number }>)[core]!;
    expect(state.core).toBe(core);
    expect(state.damage).toBeCloseTo(frame.damage * 0.9 * 0.92, 6);
    expect(state.fireRate).toBeCloseTo(frame.fireRate * 0.97, 6);
    expect(state.hp).toBe(Math.round(frame.hp * 0.97));
    expect(state.dashCooldown).toBeCloseTo(2.8, 6);
    expect(state.echoCooldown).toBeCloseTo(12, 6);
    expect(state.weaponSkillCooldown).toBeCloseTo(frame.skill * 1.2, 6);
    expect(state.critChance).toBe(0);
    if (core === 'tempest') expect(state.chain).toBe(2);
    const forbidden = core === 'tempest' ? ['velocity', 'pierce', 'seeker'] : ['chain'];
    for (const choice of state.choices) {
      expect(forbidden).not.toContain(choice.id);
      expect(choice.icon).toBeTruthy();
    }

    const levelBase = await page.evaluate(async ({ core }) => {
      const engine = (window as any).__ECHO__;
      await engine.start(core, 'standard', `LEVEL-BASE-${core}`, 'level', 1);
      return { damage: engine.player.stats.damage, fireRate: engine.player.stats.fireRate, maxHp: engine.player.stats.maxHp, dashCooldown: engine.player.stats.dashCooldown, echoCooldown: engine.player.stats.echoCooldown, weaponSkillCooldown: engine.weaponSkillCooldown };
    }, { core });
    // LEVEL starts weaker than INFINITE; persistent bonuses apply afterwards.
    expect(levelBase.damage).toBeCloseTo(frame.damage * 0.9 * 0.88, 6);
    expect(levelBase.fireRate).toBeCloseTo(frame.fireRate * 0.92, 6);
    expect(levelBase.maxHp).toBe(Math.round(frame.hp * 0.9));
    expect(levelBase.damage).toBeLessThan(state.damage);
    expect(levelBase.fireRate).toBeLessThan(state.fireRate);
    expect(levelBase.maxHp).toBeLessThan(state.hp);
    expect(levelBase.dashCooldown).toBeCloseTo(2.4, 6);
    expect(levelBase.echoCooldown).toBeCloseTo(10, 6);
    expect(levelBase.weaponSkillCooldown).toBeCloseTo(frame.skill, 6);

    const openingHits = await page.evaluate(async ({ core }) => {
      const engine = (window as any).__ECHO__;
      await engine.start(core, 'standard', `OPENING-${core}`);
      const results = [];
      for (const kind of ['drone', 'dart']) {
        for (const range of [60, 180]) {
          engine.enemies = []; engine.projectiles = []; engine.echoes = [];
          engine.player.fireTimer = 999;
          engine.spawnEnemy(kind, engine.player.x + range, engine.player.y, false);
          const target = engine.enemies[0];
          engine.fireWeapon(engine.player.x, engine.player.y, 0, 'player', 1, false);
          for (let step = 0; step < 45; step++) engine.updateProjectiles(1 / 30);
          results.push({ kind, range, dead: target.dead, hp: target.hp, maxHp: target.maxHp });
        }
      }
      return results;
    }, { core });
    for (const hit of openingHits) {
      expect(hit.dead, `${core} opening ${hit.kind} at ${hit.range} must survive one normal attack`).toBe(false);
      expect(hit.hp).toBeGreaterThan(0);
      expect(hit.hp).toBeLessThan(hit.maxHp);
    }
  }
});

test('WRAITH kills opening drones and darts in two normal shots in both modes', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const results = [];
    for (const gameMode of ['infinite', 'level']) {
      await engine.start('wraith', 'standard', `WRAITH-TWO-SHOT-${gameMode}`, gameMode, 1);
      for (const kind of ['drone', 'dart']) {
        engine.elapsed = 2; // Representative of the first scheduled opening spawn.
        engine.enemies = []; engine.projectiles = []; engine.echoes = [];
        engine.player.fireTimer = 999;
        engine.spawnEnemy(kind, engine.player.x + 60, engine.player.y, false);
        const target = engine.enemies[0];
        const fire = () => {
          engine.fireWeapon(engine.player.x, engine.player.y, 0, 'player', 1, false);
          for (let step = 0; step < 45; step++) engine.updateProjectiles(1 / 30);
        };
        fire();
        const hpAfterOne = target.hp;
        const deadAfterOne = target.dead;
        fire();
        results.push({ gameMode, kind, hpAfterOne, deadAfterOne, deadAfterTwo: target.dead });
      }
    }
    return results;
  });
  expect(results).toHaveLength(4);
  for (const result of results) {
    expect(result.hpAfterOne, `${result.gameMode} ${result.kind} must survive the first shot`).toBeGreaterThan(0);
    expect(result.deadAfterOne).toBe(false);
    expect(result.deadAfterTwo, `${result.gameMode} ${result.kind} must die to the second shot`).toBe(true);
  }
});

test('manual fire, left/right mouse chords, all weapon skills, and pilot link work together', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => (window as any).__ECHO__.start('wraith', 'standard', 'DIRECT-CONTROL'));
  await expect(page.locator('.pilot-guide')).toContainText('「YOU」が、あなたの機体');
  await page.keyboard.down('d');
  await page.waitForTimeout(350);
  await page.keyboard.up('d');
  await page.mouse.move(1030, 420);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await expect.poll(async () => (await snapshot(page)).manualShots).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await page.keyboard.press('e');
  await page.keyboard.press('q');
  await expect.poll(async () => (await snapshot(page)).weaponCooldown).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).tutorialStep).toBe(5);
  await page.evaluate(() => { (window as any).__ECHO__.player.weaponCooldown = 0; });
  const shotsBeforeChord = (await snapshot(page)).manualShots;
  await page.mouse.down({ button: 'right' });
  await expect.poll(async () => (await snapshot(page)).weaponCooldown).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  expect((await snapshot(page)).manualShots).toBeGreaterThan(shotsBeforeChord);
  await page.mouse.up({ button: 'right' });
  await page.mouse.up({ button: 'left' });
  await expect(page.getByRole('button', { name: /Q: 貫通レール/ })).toBeVisible();

  for (const core of ['tempest', 'bastion']) {
    await page.evaluate(({ core }) => {
      const engine = (window as any).__ECHO__;
      void engine.start(core, 'standard', `SKILL-${core}`);
    }, { core });
    await expect.poll(async () => (await snapshot(page)).status).toBe('running');
    await page.evaluate(() => {
      const engine = (window as any).__ECHO__;
      engine.spawnEnemy('tank', engine.player.x + 130, engine.player.y, false);
    });
    await page.keyboard.press('q');
    await expect.poll(async () => (await snapshot(page)).weaponCooldown).toBeGreaterThan(0);
    const effect = await page.evaluate(() => {
      const engine = (window as any).__ECHO__;
      return { stunned: engine.enemies.some((enemy: any) => enemy.stun > 0), shockwaves: engine.shockwaves.length };
    });
    if (core === 'tempest') expect(effect.stunned).toBe(true);
    else expect(effect.shockwaves).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

test('action dock runs Q, E, R left to right and each key fires its own ability', async ({ page }) => {
  await page.evaluate(() => (window as any).__ECHO__.start('wraith', 'standard', 'HOTKEY-ORDER'));
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');

  const dock = page.locator('.ability-dock .ability');
  await expect(dock).toHaveCount(4);
  const labels = await dock.evaluateAll(nodes => nodes.map(node => node.querySelector('kbd')?.textContent ?? ''));
  expect(labels).toEqual(['SPACE', 'Q', 'E', 'R']);

  // SPACE / Q / E / R must line up with the on-screen buttons from left to right.
  for (const [index, key] of [[1, 'q'], [2, 'e'], [3, 'r']] as const) {
    expect(labels[index]).toBe(key.toUpperCase());
  }

  const pilot = () => page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    return { overdrive: engine.player.overdrive as number, sync: engine.player.sync as number };
  });

  // Q = weapon skill only
  await page.keyboard.press('q');
  await expect.poll(async () => (await snapshot(page)).weaponCooldown).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).echoes).toBe(0);
  expect((await pilot()).overdrive).toBe(0);

  // E = echo summon only
  await page.keyboard.press('e');
  await expect.poll(async () => (await snapshot(page)).echoes).toBeGreaterThan(0);
  expect((await pilot()).overdrive).toBe(0);

  // R = ZERO FIELD
  await page.evaluate(() => { const engine = (window as any).__ECHO__; engine.player.sync = 100; });
  await page.keyboard.press('r');
  await expect.poll(async () => (await pilot()).overdrive).toBeGreaterThan(0);
});

test('SYNC RIFT retains progress outside and resumes in both modes', async ({ page }) => {
  for (const gameMode of ['infinite', 'level'] as const) {
    await page.evaluate(async ({ gameMode }) => {
      const engine = (window as any).__ECHO__;
      await engine.start('wraith', 'standard', `RIFT-${gameMode}`, gameMode, gameMode === 'level' ? 2 : 1);
      if (gameMode === 'infinite') engine.sector = 2;
      engine.sectorTime = 10.1; engine.spawnTimer = 999;
      engine.player.hp = 50; engine.player.invulnerable = 10;
    }, { gameMode });
    await expect.poll(async () => (await snapshot(page)).rift).not.toBeNull();
    await expect(page.locator('.rift-objective')).toContainText('SYNC RIFT');
    await page.evaluate(() => {
      const engine = (window as any).__ECHO__;
      engine.player.x = engine.rift.x; engine.player.y = engine.rift.y;
    });
    await expect(page.locator('.rift-objective')).toHaveClass(/is-inside/);
    await expect.poll(() => page.evaluate(() => (window as any).__ECHO__.rift?.progress ?? 0)).toBeGreaterThan(0.8);
    if (gameMode === 'infinite') await page.screenshot({ path: 'test-results/rift-objective.png' });

    const progressBeforeLeaving = await page.evaluate(() => {
      const engine = (window as any).__ECHO__;
      const progress = engine.rift.progress;
      engine.player.x = engine.rift.x + (engine.rift.x < 800 ? 220 : -220);
      engine.player.y = engine.rift.y;
      return progress;
    });
    await page.waitForTimeout(650);
    const progressOutside = await page.evaluate(() => (window as any).__ECHO__.rift.progress);
    expect(progressOutside).toBeCloseTo(progressBeforeLeaving, 5);
    await expect(page.locator('.rift-objective')).toContainText('進行保持');

    await page.evaluate(() => {
      const engine = (window as any).__ECHO__;
      engine.player.x = engine.rift.x; engine.player.y = engine.rift.y;
    });
    await expect.poll(async () => (await snapshot(page)).rift, { timeout: 7000 }).toBeNull();
    const reward = await page.evaluate(() => ({ sync: (window as any).__ECHO__.player.sync, hp: (window as any).__ECHO__.player.hp, maxHp: (window as any).__ECHO__.player.stats.maxHp }));
    expect(reward.sync).toBeGreaterThanOrEqual(35);
    expect(reward.hp).toBeCloseTo(50 + reward.maxHp * 0.15, 5);
  }
});

test('normal enemy roster unlocks every two INFINITE rounds and preserves LEVEL pacing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const sample = async (gameMode: string, rounds: number[]) => {
      const rosters: string[][] = [];
      for (const round of rounds) {
        const stage = gameMode === 'level' ? 1 + (round - 1) * 8 : 1;
        await engine.start('wraith', 'standard', `ROSTER-${gameMode}-${round}`, gameMode, stage);
        engine.sector = round;
        const roster = new Set<string>();
        for (let index = 0; index < 600; index++) roster.add(engine.pickEnemyKind());
        rosters.push([...roster].sort());
      }
      return rosters;
    };
    return {
      infinite: await sample('infinite', Array.from({ length: 12 }, (_, index) => index + 1)),
      level: await sample('level', Array.from({ length: 7 }, (_, index) => index + 1)),
    };
  });
  const infiniteExpected: string[][] = [];
  const infiniteRoster = new Set(['drone', 'dart']);
  infiniteExpected.push([...infiniteRoster].sort());
  for (const kind of ['gunner', 'splitter', 'tank', 'sniper', 'weaver']) {
    infiniteRoster.add(kind);
    infiniteExpected.push([...infiniteRoster].sort(), [...infiniteRoster].sort());
  }
  infiniteExpected.push([...infiniteRoster].sort());
  const levelExpected: string[][] = [];
  const levelRoster = new Set(['drone', 'dart']);
  levelExpected.push([...levelRoster].sort());
  for (const kind of ['gunner', 'splitter', 'tank', 'sniper', 'weaver']) {
    levelRoster.add(kind);
    levelExpected.push([...levelRoster].sort());
  }
  levelExpected.push([...levelRoster].sort());
  expect(result.infinite).toEqual(infiniteExpected);
  expect(result.level).toEqual(levelExpected);
});

test('tank concurrency starts at two without reducing total spawns in either mode', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const run = async (gameMode: string, round: number) => {
      const stage = gameMode === 'level' ? 1 + (round - 1) * 8 : 1;
      await engine.start('wraith', 'standard', `TANK-CAP-${gameMode}-${round}`, gameMode, stage);
      engine.sector = round; engine.elapsed = 0; engine.sectorTime = 0;
      engine.enemies = []; engine.anomaly = null;
      // This roll selects a tank in both of the first two tank-enabled rosters.
      engine.random.next = () => 0.82;
      for (let index = 0; index < 30; index++) {
        engine.spawnTimer = 0;
        engine.updateDirector(0);
      }
      return {
        tanks: engine.enemies.filter((enemy: any) => enemy.kind === 'tank').length,
        total: engine.enemies.length,
      };
    };
    return {
      infinite: [await run('infinite', 6), await run('infinite', 8)],
      level: [await run('level', 4), await run('level', 5)],
    };
  });
  expect(result.infinite).toEqual([{ tanks: 2, total: 30 }, { tanks: 3, total: 30 }]);
  expect(result.level).toEqual([{ tanks: 2, total: 30 }, { tanks: 3, total: 30 }]);
});

test('BASTION homing bends nova shots and WRAITH pierce adds dependable damage', async ({ page }) => {
  await page.evaluate(() => (window as any).__ECHO__.start('bastion', 'standard', 'HOMING-CHECK'));
  const before = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.enemies = []; engine.projectiles = [];
    engine.player.stats.homing = 2.2;
    engine.spawnEnemy('tank', engine.player.x + 170, engine.player.y + 170, false);
    engine.spawnFriendlyShot(engine.player.x, engine.player.y, 0, 50, 'player', 'nova');
    const shot = engine.projectiles[0];
    return { id: shot.id, angle: Math.atan2(shot.vy, shot.vx) };
  });
  await page.waitForTimeout(180);
  const after = await page.evaluate((id: number) => {
    const shot = (window as any).__ECHO__.projectiles.find((projectile: any) => projectile.id === id);
    return shot ? Math.atan2(shot.vy, shot.vx) : null;
  }, before.id);
  expect(after).not.toBeNull();
  expect(after!).toBeGreaterThan(before.angle + 0.15);

  const piercedDamage = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'PIERCE-CHECK');
    engine.projectiles = []; engine.player.stats.pierce = 2;
    engine.spawnFriendlyShot(engine.player.x, engine.player.y, 0, 50, 'player', 'bullet');
    return engine.projectiles[0].damage;
  });
  expect(piercedDamage).toBeCloseTo(68, 5);

  const focusedArcDamage = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('tempest', 'standard', 'FOCUS-CHECK');
    engine.enemies = []; engine.player.stats.critChance = 0;
    engine.player.stats.chain = 3; engine.player.stats.projectiles = 2;
    engine.spawnEnemy('tank', engine.player.x + 180, engine.player.y, false);
    const target = engine.enemies[0];
    const hp = target.hp;
    engine.fireArc(engine.player.x, engine.player.y, 0, 'player', 50);
    return hp - target.hp;
  });
  expect(focusedArcDamage).toBeCloseTo(94, 5);
});

test('echo volleys preserve their formation but rotate toward live enemies', async ({ page }) => {
  for (const core of ['wraith', 'bastion']) {
    const result = await page.evaluate(async ({ core }) => {
      const engine = (window as any).__ECHO__;
      await engine.start(core, 'standard', `ECHO-AIM-${core}`);
      engine.enemies = []; engine.projectiles = []; engine.player.fireTimer = 999;
      engine.spawnEnemy('tank', 650, 450, false);
      const target = engine.enemies[0];
      const echo = { id: 999, x: 400, y: 450, angle: -Math.PI / 2, frames: [], startTime: 0, age: 0, index: 0, life: 1, alpha: 0.7, dash: false };
      const recordedAim = -Math.PI / 2;
      const shots = core === 'wraith'
        ? [-0.12, 0, 0.12].map(offset => ({ angle: recordedAim + offset, kind: 'bullet' }))
        : [
            ...Array.from({ length: 6 }, (_, index) => ({ angle: recordedAim + (index + 0.5) * Math.PI * 2 / 6, kind: 'nova' })),
            { angle: recordedAim, kind: 'bullet', power: 1.75 },
          ];
      for (const shot of shots) engine.fireRecordedShot(echo, shot, recordedAim);
      const fired = engine.projectiles.map((projectile: any, index: number) => {
        const angle = Math.atan2(projectile.vy, projectile.vx);
        const original = shots[index].angle;
        return {
          source: projectile.source,
          correction: Math.atan2(Math.sin(angle - original), Math.cos(angle - original)),
        };
      });
      const hpBefore = target.hp;
      for (let step = 0; step < 60; step++) engine.updateProjectiles(1 / 30);
      return { fired, hpBefore, hpAfter: target.hp, echoAngle: echo.angle, echoX: echo.x, echoY: echo.y };
    }, { core });
    expect(result.fired).toHaveLength(core === 'wraith' ? 3 : 7);
    for (const shot of result.fired) {
      expect(shot.source).toBe('echo');
      expect(shot.correction).toBeCloseTo(Math.PI / 2, 5);
    }
    expect(result.hpAfter).toBeLessThan(result.hpBefore);
    expect(result.echoAngle).toBeCloseTo(0, 5);
    expect(result.echoX).toBe(400);
    expect(result.echoY).toBe(450);
  }
});

test('WRAITH echo and BASTION combat colors stay distinct from self and elite yellow', async ({ page }) => {
  const palette = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const shipColors: string[] = [];
    await engine.start('wraith', 'standard', 'PALETTE-WRAITH', 'infinite');
    engine.tutorialEnabled = false; engine.player.invulnerable = 0;
    engine.drawShip = (_ctx: CanvasRenderingContext2D, _x: number, _y: number, _angle: number, color: string) => { shipColors.push(color); };
    engine.echoes = [{ x: 400, y: 450, angle: 0, alpha: 0.7 }];
    engine.drawEchoes(engine.ctx, 0);
    engine.drawPlayer(engine.ctx, 0);
    const wraith = { echo: shipColors[0], self: shipColors[1] };

    await engine.start('bastion', 'standard', 'PALETTE-BASTION', 'infinite');
    shipColors.length = 0;
    engine.tutorialEnabled = false; engine.player.invulnerable = 0;
    engine.drawPlayer(engine.ctx, 0);
    engine.projectiles = [];
    engine.spawnFriendlyShot(engine.player.x, engine.player.y, 0, 50, 'player', 'nova');
    engine.spawnFriendlyShot(engine.player.x, engine.player.y, 0, 50, 'echo', 'nova');
    return {
      wraith,
      bastionSelf: shipColors[0],
      bastionShot: engine.projectiles[0].color,
      bastionEchoShot: engine.projectiles[1].color,
    };
  });
  const wraithColor = CORES.find(core => core.id === 'wraith')!.color;
  expect(palette.wraith).toEqual({ echo: ECHO_COLOR, self: wraithColor });
  expect(palette.wraith.echo).not.toBe(palette.wraith.self);
  expect(palette.bastionSelf).toBe(BASTION_COLOR);
  expect(palette.bastionShot).toBe(BASTION_COLOR);
  expect(palette.bastionEchoShot).toBe(ECHO_COLOR);
  expect(CORES.find(core => core.id === 'bastion')!.color).toBe(BASTION_COLOR);
  expect(BASTION_COLOR).not.toBe('#ffcf70');
});

test('four bosses rotate across both modes without changing HP scaling or the final AION', async ({ page }) => {
  const infinite = [];
  for (const sector of [3, 6, 9, 12, 99]) {
    infinite.push(await page.evaluate(async ({ sector }) => {
      const engine = (window as any).__ECHO__;
      await engine.start('wraith', 'standard', `BOSS-ROTATION-${sector}`, 'infinite');
      engine.enemies = []; engine.sector = sector; engine.spawnBoss();
      const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
      engine.render(1);
      const pixels = engine.canvas.toDataURL();
      let renderHash = 0;
      for (let index = 0; index < pixels.length; index++) renderHash = (renderHash * 31 + pixels.charCodeAt(index)) >>> 0;
      return { sector, kind: boss.bossKind, hp: boss.maxHp, renderHash };
    }, { sector }));
  }
  expect(infinite.map(state => state.kind)).toEqual(['warden', 'lancer', 'choir', 'colossus', 'warden']);
  expect(new Set(infinite.slice(0, 4).map(state => state.renderHash)).size).toBe(4);
  for (const state of infinite) {
    const tier = Math.max(1, Math.floor(state.sector / 3));
    const depth = Math.floor((state.sector - 1) / 10);
    expect(state.hp).toBeCloseTo(1250 * (1 + (tier - 1) * 0.82) * Math.pow(1.16, depth), 5);
  }

  const levels = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const states = [];
    for (const stage of [5, 10, 15, 20, 25, 100]) {
      await engine.start('wraith', 'standard', `BOSS-LEVEL-${stage}`, 'level', stage);
      engine.enemies = []; engine.spawnBoss();
      const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
      states.push({ stage, kind: boss.bossKind, hp: boss.maxHp, expectedHp: 1250 * (1 + (engine.bossTier - 1) * 0.82) * engine.challenge.bossHealth });
    }
    return states;
  });
  expect(levels.map(state => state.kind)).toEqual(['warden', 'lancer', 'choir', 'colossus', 'warden', 'warden']);
  for (const state of levels) expect(state.hp).toBeCloseTo(state.expectedHp, 5);
});

test('KAIROS telegraphs fast piercing shots before alternating into a locked dash', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'LANCER-ATTACKS', 'infinite');
    engine.enemies = []; engine.projectiles = []; engine.spawnBoss('lancer');
    const boss = engine.enemies[0];
    boss.x = 800; boss.y = 200; boss.angle = Math.PI / 2; boss.fireTimer = 0;
    engine.player.x = 800; engine.player.y = 450;
    engine.updateBoss(boss, 0, 0, 1, 250);
    const shotTelegraph = boss.telegraph;
    const lockedAngle = boss.lockedAngle;
    engine.updateBoss(boss, shotTelegraph, 0, 1, 250);
    const shots = engine.projectiles.map((projectile: any) => ({
      color: projectile.color, speed: Math.hypot(projectile.vx, projectile.vy), angle: Math.atan2(projectile.vy, projectile.vx),
    }));
    engine.projectiles = []; boss.fireTimer = 0;
    engine.updateBoss(boss, 0, 0, 1, 250);
    const dashTelegraph = boss.telegraph;
    engine.updateBoss(boss, dashTelegraph, 0, 1, 250);
    return {
      shotTelegraph, dashTelegraph, lockedAngle, shots, specialTimer: boss.specialTimer,
      dashSpeed: Math.hypot(boss.vx, boss.vy), dashAngle: Math.atan2(boss.vy, boss.vx),
    };
  });
  expect(result.shotTelegraph).toBeGreaterThan(0.8);
  expect(result.dashTelegraph).toBeGreaterThan(0.8);
  expect(result.lockedAngle).toBeCloseTo(Math.PI / 2, 6);
  expect(result.shots).toHaveLength(5);
  for (const shot of result.shots) {
    expect(shot.color).toBe(BOSS_DEFINITIONS.lancer.color);
    expect(shot.speed).toBeGreaterThan(400);
    expect(Math.abs(shot.angle - Math.PI / 2)).toBeLessThanOrEqual(0.25);
  }
  expect(result.specialTimer).toBeGreaterThan(0);
  expect(result.dashSpeed).toBeGreaterThan(600);
  expect(result.dashAngle).toBeCloseTo(Math.PI / 2, 6);
});

test('NEXUS fires a colored double spiral and caps its weaver summons', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'CHOIR-ATTACKS', 'infinite');
    engine.enemies = []; engine.projectiles = []; engine.spawnBoss('choir');
    const boss = engine.enemies[0];
    boss.fireTimer = 0;
    engine.updateBoss(boss, 0, 1, 0, 400);
    const spiral = engine.projectiles.map((projectile: any) => ({ color: projectile.color, angle: Math.atan2(projectile.vy, projectile.vx) }));
    engine.projectiles = []; boss.fireTimer = 0;
    engine.updateBoss(boss, 0, 1, 0, 400);
    const satelliteShots = engine.projectiles.length;
    const summons = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      boss.pattern = 2; boss.fireTimer = 0; engine.projectiles = [];
      engine.updateBoss(boss, 0, 1, 0, 400);
      summons.push(engine.enemies.filter((enemy: any) => enemy.kind === 'weaver').length);
    }
    return { spiral, satelliteShots, summons };
  });
  expect(result.spiral).toHaveLength(16);
  expect(new Set(result.spiral.map((shot: { angle: number }) => Math.round(shot.angle * 100))).size).toBeGreaterThan(8);
  expect(result.spiral.every((shot: { color: string }) => shot.color === BOSS_DEFINITIONS.choir.color)).toBe(true);
  expect(result.satelliteShots).toBe(6);
  expect(result.summons).toEqual([1, 2, 2]);
});

test('ATLAS telegraphs its shockwave and only damages targets inside the warning circle', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'COLOSSUS-ATTACKS', 'infinite');
    engine.enemies = []; engine.projectiles = []; engine.shockwaves = []; engine.spawnBoss('colossus');
    const boss = engine.enemies[0];
    boss.x = 800; boss.y = 200; boss.fireTimer = 0;
    engine.player.x = 800; engine.player.y = 400; engine.player.hp = 100;
    engine.player.invulnerable = 0; engine.player.shieldReady = false;
    engine.updateBoss(boss, 0, 0, 1, 200);
    const initialTelegraph = boss.telegraph;
    engine.updateBoss(boss, 0.5, 0, 1, 200);
    const hpDuringWarning = engine.player.hp;
    engine.updateBoss(boss, 0.6, 0, 1, 200);
    const inside = {
      hp: engine.player.hp, waves: engine.shockwaves.length, shots: engine.projectiles.length,
      colors: engine.projectiles.map((projectile: any) => projectile.color),
    };
    engine.player.hp = 100; engine.player.invulnerable = 0; engine.player.x = 1400; engine.player.y = 800;
    engine.projectiles = []; engine.shockwaves = [];
    boss.pattern = 0; boss.fireTimer = 0; boss.telegraph = 0;
    engine.updateBoss(boss, 0, 0, 1, 800);
    engine.drawEnemies(engine.ctx, 1);
    engine.updateBoss(boss, 1.1, 0, 1, 800);
    return { initialTelegraph, hpDuringWarning, inside, outsideHp: engine.player.hp, outsideWaves: engine.shockwaves.length };
  });
  expect(result.initialTelegraph).toBeCloseTo(1.05, 6);
  expect(result.hpDuringWarning).toBe(100);
  expect(result.inside.hp).toBeLessThan(100);
  expect(result.inside.waves).toBe(1);
  expect(result.inside.shots).toBe(12);
  expect(result.inside.colors.every((color: string) => color === BOSS_DEFINITIONS.colossus.color)).toBe(true);
  expect(result.outsideHp).toBe(100);
  expect(result.outsideWaves).toBe(1);
});

test('LEVEL bosses appear only every fifth stage and normal stages require cleanup', async ({ page }) => {
  const schedule = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const states = [];
    for (const stage of [1, 4, 5, 6, 9, 10, 95, 100]) {
      await engine.start('wraith', 'standard', `BOSS-SCHEDULE-${stage}`, 'level', stage);
      engine.enemies = []; engine.sectorTime = engine.challenge.combatDuration; engine.spawnTimer = 999;
      engine.updateDirector(0);
      states.push({
        stage, hasBoss: engine.challenge.hasBoss, cleanupStarted: engine.cleanupStarted,
        boss: engine.enemies.some((enemy: any) => enemy.kind === 'boss'),
      });
    }
    return states;
  });
  for (const state of schedule) {
    expect(state.hasBoss).toBe(state.stage % 5 === 0);
    expect(state.boss).toBe(state.stage % 5 === 0);
    expect(state.cleanupStarted).toBe(state.stage % 5 !== 0);
  }

  const clear = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'NORMAL-STAGE-CLEANUP', 'level', 1);
    engine.tutorialEnabled = false; engine.enemies = []; engine.echoes = []; engine.player.fireTimer = 999;
    engine.sectorTime = engine.challenge.combatDuration;
    engine.spawnEnemy('drone', 250, 200, false); engine.spawnEnemy('dart', 1350, 700, false);
    engine.spawnTimer = 0; engine.updateDirector(0);
    const before = {
      bossSpawned: engine.bossSpawned, bossDefeated: engine.bossDefeated,
      cleanupStarted: engine.cleanupStarted, enemies: engine.enemies.length,
    };
    engine.update(0);
    const waiting = { status: engine.status, enemies: engine.enemies.length };
    for (const enemy of engine.enemies) engine.damageEnemy(enemy, enemy.maxHp * 10, 'player');
    engine.update(0);
    return {
      before, waiting, status: engine.status,
      xp: Number(localStorage.getItem('echo-abyss-campaign-xp') ?? 0),
      unlocked: Number(localStorage.getItem('echo-abyss-unlocked-level') ?? 1),
    };
  });
  expect(clear.before).toEqual({ bossSpawned: false, bossDefeated: false, cleanupStarted: true, enemies: 2 });
  expect(clear.waiting).toEqual({ status: 'running', enemies: 2 });
  expect(clear.status).toBe('gameover');
  expect(clear.xp).toBe(132);
  expect(clear.unlocked).toBe(2);
  await expect(page.getByRole('heading', { name: 'LEVEL CLEAR' })).toBeVisible();
});

test('XP costs rise steadily while stage rewards and enemy shards scale without runaway growth', async ({ page }) => {
  const levels = [1, 2, 3, 4, 5, 10, 20];
  const requirements = levels.map(getRunXpRequirement);
  expect(requirements).toEqual([30, 58, 94, 138, 190, 570, 1930]);
  for (let index = 1; index < requirements.length; index++) expect(requirements[index]!).toBeGreaterThan(requirements[index - 1]!);

  expect(getStageXp(1, true)).toBe(132);
  expect(getStageXp(5, true)).toBe(185);
  expect(getStageXp(100, true)).toBe(3120);
  expect(getStageXp(1, false)).toBe(46);
  expect(getStageXp(100, false)).toBe(1092);
  let firstClearTotal = 0;
  for (let stage = 1; stage <= 100; stage++) firstClearTotal += getStageXp(stage, true);
  expect(firstClearTotal).toBe(133508);
  expect(getBonusUpgradeCost('damage', 0)).toBe(100);
  expect(getBonusUpgradeCost('damage', 1)).toBe(138);
  expect(getBonusUpgradeCost('damage', 2)).toBe(212);
  expect(getBonusUpgradeCost('damage', 19)).toBe(6978);
  expect(getBonusUpgradeCost('damage', 20)).toBeNull();
  expect(getBonusUpgradeCost('fireRate', 0)).toBe(110);
  expect(getBonusUpgradeCost('vitality', 0)).toBe(120);
  expect(getBonusUpgradeCost('mobility', 0)).toBe(80);
  for (const id of ['damage', 'fireRate', 'vitality', 'echoDamage', 'mobility', 'xpGain'] as const) {
    for (let rank = 1; rank < 20; rank++) expect(getBonusUpgradeCost(id, rank)!).toBeGreaterThan(getBonusUpgradeCost(id, rank - 1)!);
  }
  const maxLoadout = Object.fromEntries(['damage', 'fireRate', 'vitality', 'echoDamage', 'mobility', 'xpGain'].map(id => [id, 20]));
  expect(getBonusInvestedXp(maxLoadout)).toBe(301560);
  expect(TOTAL_BONUS_RANKS).toBe(120);

  const drops = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const states = [];
    for (const stage of [1, 50, 100]) {
      await engine.start('wraith', 'standard', `XP-DROP-${stage}`, 'level', stage);
      engine.anomaly = null; engine.enemies = []; engine.random.next = () => 1;
      engine.spawnEnemy('drone', 400, 400, false);
      states.push({ stage, scale: engine.challenge.enemyXp, xp: engine.enemies[0].xp });
    }
    await engine.start('wraith', 'standard', 'XP-DROP-CAP', 'infinite');
    engine.anomaly = null; engine.sector = 100; engine.enemies = []; engine.random.next = () => 1;
    engine.spawnEnemy('drone', 400, 400, false);
    return { states, infiniteCap: engine.enemies[0].xp };
  });
  expect(drops.states[0]!.scale).toBe(1);
  expect(drops.states[1]!.scale).toBeCloseTo(1.735, 6);
  expect(drops.states[2]!.scale).toBeCloseTo(2.485, 6);
  expect(drops.states[0]!.xp).toBeCloseTo(7, 6);
  expect(drops.states[1]!.xp).toBeCloseTo(7 * 1.735, 6);
  expect(drops.states[2]!.xp).toBeCloseTo(7 * 2.485, 6);
  expect(drops.infiniteCap).toBeCloseTo(17.5, 6);
});

test('persistent upgrades spend their own XP costs and refund downgrades or a full reset', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/src/game/campaign.ts';
    const campaign = await import(/* @vite-ignore */ modulePath);
    localStorage.setItem(campaign.CAMPAIGN_XP_KEY, '0');
    localStorage.setItem(campaign.CAMPAIGN_LOADOUT_KEY, '{}');
    const noFunds = campaign.purchaseInitialBonus('damage');
    localStorage.setItem(campaign.CAMPAIGN_XP_KEY, '500');
    const purchases = [
      campaign.purchaseInitialBonus('damage'),
      campaign.purchaseInitialBonus('damage'),
      campaign.purchaseInitialBonus('fireRate'),
      campaign.purchaseInitialBonus('vitality'),
    ];
    const afterPurchases = {
      xp: campaign.readCampaignXp(), loadout: campaign.readInitialBonuses(),
      invested: campaign.getBonusInvestedXp(campaign.readInitialBonuses()),
    };
    const insufficient = campaign.purchaseInitialBonus('damage');
    const refund = campaign.refundInitialBonus('damage');
    const afterRefund = {
      xp: campaign.readCampaignXp(), loadout: campaign.readInitialBonuses(),
      invested: campaign.getBonusInvestedXp(campaign.readInitialBonuses()),
    };
    const reset = campaign.resetInitialBonuses();
    return { noFunds, purchases, afterPurchases, insufficient, refund, afterRefund, reset };
  });
  expect(result.noFunds).toMatchObject({ changed: false, cost: 100, xp: 0 });
  expect(result.purchases.map((purchase: any) => [purchase.changed, purchase.cost])).toEqual([[true, 100], [true, 138], [true, 110], [true, 120]]);
  expect(result.afterPurchases).toEqual({ xp: 32, loadout: { damage: 2, fireRate: 1, vitality: 1 }, invested: 468 });
  expect(result.insufficient).toMatchObject({ changed: false, cost: 212, xp: 32 });
  expect(result.refund).toMatchObject({ changed: true, refund: 138, xp: 170 });
  expect(result.afterRefund).toEqual({ xp: 170, loadout: { damage: 1, fireRate: 1, vitality: 1 }, invested: 330 });
  expect(result.reset).toMatchObject({ changed: true, refund: 330, xp: 500, loadout: {} });
});

test('boss death stops spawning but requires every remaining enemy before clear and EXP', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(() => localStorage.setItem('echo-abyss-unlocked-level', '5'));
  await page.reload();
  await page.getByRole('button', { name: 'LEVEL', exact: true }).click();
  await expect(page.locator('.level-setup')).toBeVisible();
  await expect(page.getByRole('button', { name: /レベル6 .* ロック中/ })).toBeDisabled();
  await page.getByRole('button', { name: 'レベル5 深淵', exact: true }).click();
  await expect(page.locator('.stage-parameters')).toContainText(`BOSS // ${BOSS_DEFINITIONS.warden.name}`);
  await page.screenshot({ path: 'test-results/level-menu.png' });
  await page.getByRole('button', { name: /レベル005を開始/ }).click();
  await expect.poll(async () => (await snapshot(page)).gameMode).toBe('level');
  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.enemies = []; engine.echoes = []; engine.player.fireTimer = 999;
    engine.bossSpawned = true; engine.spawnBoss();
    engine.spawnEnemy('tank', 250, 200, false);
    engine.spawnEnemy('drone', 1350, 700, false);
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    boss.hp = 1; engine.damageEnemy(boss, 10, 'player');
    engine.spawnTimer = 0;
  });
  await expect(page.locator('.cleanup-objective')).toContainText('残敵を全滅');
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  await page.waitForTimeout(350);
  const cleanup = await snapshot(page);
  expect(cleanup.bossDefeated).toBe(true);
  expect(cleanup.remainingEnemies).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-campaign-xp'))).toBeNull();
  await page.screenshot({ path: 'test-results/level-cleanup.png' });
  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    const target = engine.enemies.find((enemy: any) => !enemy.dead);
    target.hp = 1; engine.damageEnemy(target, 10, 'player');
  });
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    const target = engine.enemies.find((enemy: any) => !enemy.dead);
    target.hp = 1; engine.damageEnemy(target, 10, 'player');
  });
  await expect(page.getByRole('heading', { name: 'LEVEL CLEAR' })).toBeVisible();
  await expect(page.locator('.xp-reward')).toContainText('+185');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-campaign-xp'))).toBe('185');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-unlocked-level'))).toBe('6');
  await page.screenshot({ path: 'test-results/level-clear.png' });
  await page.getByRole('button', { name: /次のレベルを準備/ }).click();
  await expect(page.getByRole('dialog', { name: '初期ボーナス編成' })).toBeVisible();
  await expect(page.locator('.bonus-account')).toContainText('185');
  await expect(page.locator('.bonus-account')).toContainText('AVAILABLE EXP');
  await expect(page.locator('.bonus-account > div').nth(2)).toContainText('0 / 120 LV');
  await expect(page.locator('.bonus-panel')).not.toContainText('AVAILABLE POINTS');
  await expect(page.locator('.launch-button')).toContainText('レベル006を開始');
  await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'REPEAT-CLEAR', 'level', 5);
    engine.enemies = []; engine.bossSpawned = true; engine.spawnBoss();
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    boss.hp = 1; engine.damageEnemy(boss, 10, 'player');
  });
  await expect(page.getByRole('heading', { name: 'LEVEL CLEAR' })).toBeVisible();
  await expect(page.locator('.xp-reward')).toContainText('+65');
  await expect(page.locator('.xp-reward')).toContainText('250 XP');
  await expect(page.locator('.xp-reward')).not.toContainText('PT');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-campaign-xp'))).toBe('250');
  expect(errors).toEqual([]);
});

test('completed builds save a checkpoint and never open empty XP or boss drafts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const stacks = Object.fromEntries(UPGRADES.map(upgrade => [upgrade.id, upgrade.id === 'amplifier' ? upgrade.maxStacks - 1 : upgrade.maxStacks]));
  const openFinalUpgrade = async (seed: string, gameMode: 'infinite' | 'level' = 'infinite') => {
    await page.evaluate(async ({ seed, gameMode, stacks }) => {
      const engine = (window as any).__ECHO__;
      await engine.start('wraith', 'standard', seed, gameMode, 1);
      engine.enemies = [];
      engine.score = 1234.75;
      engine.stacks = { ...stacks };
      engine.openDraft('level');
    }, { seed, gameMode, stacks });
    await expect(page.locator('.upgrade-card')).toHaveCount(1);
  };

  await openFinalUpgrade('BUILD-FINISH');
  await page.locator('.upgrade-card').click();
  await expect(page.getByRole('heading', { name: 'BUILD COMPLETE' })).toBeVisible();
  expect((await snapshot(page)).checkpointKind).toBe('build');
  expect((await snapshot(page)).buildCheckpointShown).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-best-standard'))).toBe('1234');
  await page.getByRole('button', { name: /ここで終了して結果を確定/ }).click();
  await expect(page.getByRole('heading', { name: 'TIME CLEAR' })).toBeVisible();
  await expect(page.locator('.final-score')).toContainText('1,234');

  await openFinalUpgrade('BUILD-CONTINUE');
  await page.locator('.upgrade-card').click();
  await expect(page.getByRole('heading', { name: 'BUILD COMPLETE' })).toBeVisible();
  const sectorBeforeContinue = (await snapshot(page)).sector;
  await page.getByRole('button', { name: /このビルドで戦闘を続ける/ }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  expect((await snapshot(page)).sector).toBe(sectorBeforeContinue);
  expect((await snapshot(page)).buildCheckpointShown).toBe(true);

  const afterXp = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.player.xp = engine.player.xpNext;
    engine.checkLevelUp();
    return { status: engine.status, level: engine.level, checkpointKind: engine.checkpointKind, pendingBossDraft: engine.pendingBossDraft };
  });
  expect(afterXp).toEqual({ status: 'running', level: 2, checkpointKind: null, pendingBossDraft: false });
  await expect(page.locator('.draft-layer')).toHaveCount(0);

  const afterBoss = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.enemies = [];
    engine.spawnBoss();
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    boss.hp = 1;
    engine.damageEnemy(boss, 10, 'player');
    engine.update(0);
    return { status: engine.status, checkpointKind: engine.checkpointKind, pendingBossDraft: engine.pendingBossDraft };
  });
  expect(afterBoss).toEqual({ status: 'running', checkpointKind: null, pendingBossDraft: false });
  await expect(page.locator('.draft-layer')).toHaveCount(0);

  await openFinalUpgrade('LEVEL-NO-BUILD-CHECKPOINT', 'level');
  await page.locator('.upgrade-card').click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  const levelState = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.player.xp = engine.player.xpNext;
    engine.checkLevelUp();
    engine.pendingBossDraft = true;
    engine.openDraft('boss');
    return { status: engine.status, checkpointKind: engine.checkpointKind, pendingBossDraft: engine.pendingBossDraft };
  });
  expect(levelState).toEqual({ status: 'running', checkpointKind: null, pendingBossDraft: false });
  await expect(page.locator('.checkpoint-panel')).toHaveCount(0);
  await expect(page.locator('.draft-layer')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('INFINITE saves checkpoints every 10 sectors and allows continue or finish through 100', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const ninthBoss = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'NINTH-BOSS', 'infinite');
    engine.enemies = []; engine.sector = 9; engine.spawnBoss();
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    const bossHp = boss.maxHp;
    boss.hp = boss.maxHp * 0.2;
    engine.updateBoss(boss, 0, 1, 0, 500);
    const phase = boss.phase;
    engine.killEnemy(boss);
    return { bossDefeated: engine.bossDefeated, pendingBossDraft: engine.pendingBossDraft, sector: engine.sector, bossTier: engine.bossTier, bossHp, phase };
  });
  expect(ninthBoss.bossDefeated).toBe(false);
  expect(ninthBoss.pendingBossDraft).toBe(true);
  expect(ninthBoss.sector).toBe(9);
  expect(ninthBoss.bossTier).toBe(3);
  expect(ninthBoss.bossHp).toBeCloseTo(3300, 5);
  expect(ninthBoss.phase).toBe(3);

  const checkpoint = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'CHECKPOINT-10', 'infinite');
    engine.enemies = []; engine.sector = 10; engine.sectorTime = 40; engine.score = 12345; engine.spawnTimer = 999;
    engine.updateDirector(0);
    return {
      status: engine.status, sector: engine.sector, checkpointScore: engine.checkpointScore,
      storedScore: Number(localStorage.getItem('echo-abyss-best-standard') ?? 0),
      storedSector: Number(localStorage.getItem('echo-abyss-best-sector') ?? 0),
    };
  });
  expect(checkpoint).toEqual({ status: 'checkpoint', sector: 10, checkpointScore: 12345, storedScore: 12345, storedSector: 10 });
  await expect(page.getByRole('heading', { name: 'SECTOR 10' })).toBeVisible();
  await expect(page.locator('.checkpoint-record')).toContainText('得点と最深セクターを記録');
  await expect(page.locator('.checkpoint-panel')).toContainText('12,345');
  await page.screenshot({ path: 'test-results/infinite-checkpoint.png' });
  await page.getByRole('button', { name: /セクター11へ進む/ }).click();
  await expect.poll(async () => (await snapshot(page)).status).toBe('running');
  expect((await snapshot(page)).sector).toBe(11);

  await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.enemies = []; engine.sector = 20; engine.sectorTime = 40; engine.score = 23456;
    engine.updateDirector(0);
  });
  await expect(page.getByRole('heading', { name: 'SECTOR 20' })).toBeVisible();
  await page.getByRole('button', { name: /ここで終了して結果を確定/ }).click();
  await expect(page.getByRole('heading', { name: 'TIME CLEAR' })).toBeVisible();
  await expect(page.locator('.final-score')).toContainText('23,456');
  await expect(page.locator('.final-score')).toContainText('TIMELINE 20 // COMPLETE');
  await expect(page.locator('.new-record')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-best-standard'))).toBe('23456');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-best-sector'))).toBe('20');
  expect((await snapshot(page)).hp).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/infinite-checkpoint-clear.png' });

  await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'CHECKPOINT-100', 'infinite');
    engine.enemies = []; engine.sector = 100; engine.sectorTime = 40; engine.score = 34567;
    engine.updateDirector(0);
  });
  await expect(page.getByRole('heading', { name: 'TIME CLEAR' })).toBeVisible();
  await expect(page.locator('.final-score')).toContainText('34,567');
  await expect(page.locator('.final-score')).toContainText('TIMELINE 100 // COMPLETE');
  await expect(page.locator('.checkpoint-panel')).toHaveCount(0);
  await expect(page.locator('.xp-reward')).toHaveCount(0);
  expect((await snapshot(page)).sector).toBe(100);
  expect((await snapshot(page)).status).toBe('gameover');
  expect((await snapshot(page)).hp).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-best-standard'))).toBe('34567');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-best-sector'))).toBe('100');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-campaign-xp'))).toBeNull();
  await page.screenshot({ path: 'test-results/infinite-100-clear.png' });
  expect(errors).toEqual([]);
});

test('INFINITE round transitions thin enemies and pause regular and boss spawns', async ({ page }) => {
  const transition = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'ROUND-LULL', 'infinite');
    engine.sector = 2; engine.enemies = []; engine.kills = 0;
    for (let index = 0; index < 10; index++) engine.spawnEnemy('drone', 300 + index * 40, 300, false);
    engine.spawnTimer = 0;
    engine.advanceInfiniteSector();
    const initial = {
      sector: engine.sector, enemies: engine.enemies.length, spawnTimer: engine.spawnTimer,
      boss: engine.enemies.some((enemy: any) => enemy.kind === 'boss'),
    };
    engine.updateDirector(1);
    engine.updateDirector(1);
    const waiting = {
      sectorTime: engine.sectorTime, enemies: engine.enemies.length, spawnTimer: engine.spawnTimer,
      boss: engine.enemies.some((enemy: any) => enemy.kind === 'boss'),
    };
    engine.updateDirector(0.5);
    const opened = {
      boss: engine.enemies.some((enemy: any) => enemy.kind === 'boss'),
      enemies: engine.enemies.length,
    };
    return { initial, waiting, opened, kills: engine.kills };
  });
  expect(transition.initial.sector).toBe(3);
  expect(transition.initial.enemies).toBe(7);
  expect(transition.initial.spawnTimer).toBeCloseTo(2.4, 6);
  expect(transition.initial.boss).toBe(false);
  expect(transition.waiting.sectorTime).toBeCloseTo(2, 6);
  expect(transition.waiting.enemies).toBe(7);
  expect(transition.waiting.spawnTimer).toBeCloseTo(0.4, 6);
  expect(transition.waiting.boss).toBe(false);
  expect(transition.opened).toEqual({ boss: true, enemies: 8 });
  expect(transition.kills).toBe(0);
});

test('WRAITH rail keeps its impact and adds three sustained damage ticks over one second', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'RAIL-SUSTAINED', 'infinite');
    engine.tutorialEnabled = false;
    engine.enemies = [];
    engine.player.fireTimer = 999;
    engine.player.angle = 0;
    engine.pointer.inside = false;
    engine.random.next = () => 0.99;
    // Bosses are the only targets that survive the opening hit, so they are
    // the ones that can measure the sustained beam ticks.
    engine.bossSpawned = true;
    engine.spawnBoss();
    const target = engine.enemies[0];
    target.x = engine.player.x + 150; target.y = engine.player.y;
    const initialHp = target.hp;
    engine.useWeaponSkill();
    const afterImpact = target.hp;
    const beam = engine.beams.find((candidate: any) => candidate.kind === 'rail');
    const samples = [afterImpact];
    for (let step = 0; step < 4; step++) {
      engine.updateRailDamage(0.3);
      engine.updateEffects(0.3);
      samples.push(target.hp);
    }
    return {
      initialHp, afterImpact, samples, damage: engine.player.stats.damage,
      tickDamage: beam.tickDamage, duration: beam.maxLife, lifeAfter: beam.life,
    };
  });
  // Bosses take the original single-target rail damage, not the sweep bonus.
  expect(result.afterImpact).toBeCloseTo(result.initialHp - result.damage * 6, 6);
  expect(result.tickDamage).toBeCloseTo(result.damage * 0.75, 6);
  expect(result.duration).toBe(1);
  expect(result.samples[1]).toBeCloseTo(result.afterImpact - result.tickDamage, 6);
  expect(result.samples[2]).toBeCloseTo(result.afterImpact - result.tickDamage * 2, 6);
  expect(result.samples[3]).toBeCloseTo(result.afterImpact - result.tickDamage * 3, 6);
  expect(result.samples[4]).toBeCloseTo(result.samples[3], 6);
  expect(result.lifeAfter).toBeLessThanOrEqual(0);
});

test('WRAITH rail aims at the densest hostile cluster and erases normal enemies in one cast', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const engine = (window as any).__ECHO__;
    const setup = async (seed: string) => {
      await engine.start('wraith', 'standard', seed, 'level', 40);
      engine.tutorialEnabled = false;
      engine.enemies = [];
      engine.projectiles = [];
      engine.beams = [];
      engine.player.fireTimer = 999;
      engine.player.weaponCooldown = 0;
      engine.player.angle = 0;
      engine.pointer.inside = false;
      engine.railAim = null;
      engine.elapsed = 0;
      engine.random.next = () => 0.99;
      engine.spawnTimer = 999;
      engine.bossSpawned = true;
    };
    const place = (kind: string, x: number, y: number) => {
      engine.spawnEnemy(kind, x, y, false);
      const enemy = engine.enemies[engine.enemies.length - 1];
      enemy.elite = false; enemy.hp = enemy.maxHp;
      return enemy;
    };

    // Crowd on the left, a lone straggler on the right. The beam must sweep
    // the crowd even though the pointer sits on the right.
    await setup('RAIL-AIM-LEFT');
    const px = engine.player.x, py = engine.player.y;
    const left = [
      place('drone', px - 210, py - 40), place('drone', px - 250, py + 30),
      place('drone', px - 180, py + 10), place('gunner', px - 320, py - 60),
      place('dart', px - 300, py + 70),
    ];
    const right = place('drone', px + 260, py + 5);
    engine.pointer = { x: px + 500, y: py, inside: true };
    engine.useWeaponSkill();
    const beam = engine.beams.find((candidate: any) => candidate.kind === 'rail');
    const at = beam.points[1];
    const aimedLeft = at.x < px;
    const crowdCleared = left.every(enemy => enemy.dead);
    const stragglerCleared = right.dead;
    const crowdDead = left.filter(enemy => enemy.dead).length;

    // Pointing the pointer at an empty corner must not drag the lane off the
    // crowd either.
    await setup('RAIL-AIM-CORNER');
    for (let i = 0; i < 6; i++) place('drone', px + 120 + i * 34, py - 180 - i * 12);
    engine.pointer = { x: px - 600, y: py + 500, inside: true };
    engine.useWeaponSkill();
    const upBeam = engine.beams.find((candidate: any) => candidate.kind === 'rail');
    const aimedUpRight = upBeam.points[1].y < py && upBeam.points[1].x > px;

    // A HUD-driven press without any pointer input still picks the crowd.
    await setup('RAIL-AIM-NO-POINTER');
    engine.pointer = { x: 0, y: 0, inside: false };
    for (let i = 0; i < 5; i++) place('drone', px - 140, py + 200 + i * 30);
    engine.useWeaponSkill();
    const noPointerBeam = engine.beams.find((candidate: any) => candidate.kind === 'rail');
    const aimedDownLeft = noPointerBeam.points[1].y > py && noPointerBeam.points[1].x < px;

    return { aimedLeft, crowdCleared, stragglerCleared, crowdDead, aimedUpRight, aimedDownLeft };
  });
  expect(result.aimedLeft).toBe(true);
  expect(result.crowdDead).toBe(5);
  expect(result.crowdCleared).toBe(true);
  expect(result.stragglerCleared).toBe(false);
  expect(result.aimedUpRight).toBe(true);
  expect(result.aimedDownLeft).toBe(true);
});

test('normal enemies gain extra durability after round 30 without changing boss or attack scaling', async ({ page }) => {
  const measure = async (sector: number) => page.evaluate(async ({ sector }) => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', `LATE-HP-${sector}`, 'infinite');
    engine.elapsed = 0; engine.sector = sector; engine.enemies = []; engine.anomaly = null;
    engine.random.next = () => 0.99;
    engine.spawnEnemy('tank', 500, 500, false);
    engine.spawnBoss();
    const tank = engine.enemies.find((enemy: any) => enemy.kind === 'tank');
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    return { hp: tank.maxHp, damage: tank.damage, bossHp: boss.maxHp };
  }, { sector });
  const normalHp = (sector: number) => 240 * (1 + (sector - 1) * 0.2);
  const lateScale = (sector: number) => {
    const depth = Math.floor((sector - 1) / 10);
    return Math.pow(1.12, Math.min(depth, 2)) * Math.pow(1.18, Math.max(0, depth - 2));
  };
  for (const sector of [30, 31, 41, 99]) {
    const state = await measure(sector);
    expect(state.hp).toBeCloseTo(normalHp(sector) * lateScale(sector), 5);
    expect(state.damage).toBeCloseTo(22 * (1 + (sector - 1) * 0.055), 5);
    expect(state.bossHp).toBeCloseTo(1250 * (1 + (Math.floor(sector / 3) - 1) * 0.82) * Math.pow(1.16, Math.floor((sector - 1) / 10)), 5);
  }
  const round30 = await measure(30);
  const round31 = await measure(31);
  expect(round31.hp / (normalHp(31) * Math.pow(1.12, 2))).toBeCloseTo(1.18, 6);
  expect(round30.hp).toBeCloseTo(normalHp(30) * Math.pow(1.12, 2), 5);
});

test('INFINITE depth and ABYSS scaling increase pressure without runaway attack damage', async ({ page }) => {
  const measure = async (difficulty: string, sector: number) => page.evaluate(async ({ difficulty, sector }) => {
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', difficulty, `SCALE-${difficulty}-${sector}`, 'infinite');
    engine.elapsed = 0; engine.sector = sector; engine.enemies = []; engine.anomaly = null;
    engine.random.next = () => 0.99;
    engine.spawnEnemy('tank', 500, 500, false);
    const tank = engine.enemies[0];
    engine.spawnBoss();
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    return { hp: tank.maxHp, damage: tank.damage, speed: tank.speed, bossHp: boss.maxHp };
  }, { difficulty, sector });
  const sector10 = await measure('standard', 10);
  const sector11 = await measure('standard', 11);
  const sector21 = await measure('standard', 21);
  const sector99 = await measure('standard', 99);
  const abyss11 = await measure('abyss', 11);
  const normalHp = (sector: number) => 240 * (1 + (sector - 1) * 0.2);
  const bossHp = (sector: number) => 1250 * (1 + (Math.floor(sector / 3) - 1) * 0.82);
  expect(sector10.hp).toBeCloseTo(normalHp(10), 5);
  expect(sector11.hp).toBeCloseTo(normalHp(11) * 1.12, 5);
  expect(sector21.hp).toBeCloseTo(normalHp(21) * Math.pow(1.12, 2), 5);
  expect(sector11.bossHp).toBeCloseTo(bossHp(11) * 1.16, 5);
  expect(sector21.bossHp).toBeCloseTo(bossHp(21) * Math.pow(1.16, 2), 5);
  expect(sector99.bossHp).toBeCloseTo(bossHp(99) * Math.pow(1.16, 9), 5);
  expect(sector11.damage).toBeCloseTo(22 * (1 + 10 * 0.055), 5);
  expect(sector21.damage).toBeCloseTo(22 * (1 + 20 * 0.055), 5);
  expect(abyss11.hp).toBeCloseTo(sector11.hp * 1.55, 5);
  expect(abyss11.bossHp).toBeCloseTo(sector11.bossHp * 2, 5);
  expect(abyss11.damage).toBeCloseTo(sector11.damage * 1.2, 5);
  expect(abyss11.speed).toBeCloseTo(sector11.speed * 1.1, 5);

  const density = await page.evaluate(async () => {
    const run = async (difficulty: string) => {
      const engine = (window as any).__ECHO__;
      await engine.start('wraith', difficulty, `DENSITY-${difficulty}`, 'infinite');
      engine.elapsed = 0; engine.sector = 11; engine.enemies = []; engine.anomaly = null;
      engine.random.next = () => 0.99;
      for (let index = 0; index < 170; index++) { engine.spawnTimer = 0; engine.updateDirector(0); }
      return engine.enemies.length;
    };
    return { standard: await run('standard'), abyss: await run('abyss') };
  });
  expect(density.standard).toBe(128);
  expect(density.abyss).toBe(154);

  const pacing = await page.evaluate(async () => {
    const run = async (difficulty: string) => {
      const engine = (window as any).__ECHO__;
      await engine.start('wraith', difficulty, `PACING-${difficulty}`, 'infinite');
      engine.elapsed = 0; engine.sector = 21; engine.enemies = []; engine.anomaly = null;
      engine.random.next = () => 0.5; engine.spawnTimer = 0;
      engine.updateDirector(0);
      const interval = engine.spawnTimer;
      engine.enemies = []; engine.random.next = () => 0.25;
      engine.spawnEnemy('drone', 500, 500, false);
      return { interval, elite: engine.enemies[0].elite };
    };
    return { standard: await run('standard'), abyss: await run('abyss') };
  });
  expect(pacing.standard.interval).toBeCloseTo(0.17 * 0.985 / 1.06, 6);
  expect(pacing.abyss.interval).toBeCloseTo(pacing.standard.interval / 1.4, 6);
  expect(pacing.standard.elite).toBe(false);
  expect(pacing.abyss.elite).toBe(true);
});

test('percentage loadout is editable and run drafts reset between stages', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('echo-abyss-campaign-xp', '5000');
    localStorage.setItem('echo-abyss-initial-bonuses', JSON.stringify({ damage: 2, fireRate: 1, vitality: 2 }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'LEVEL', exact: true }).click();
  await page.getByRole('button', { name: '初期ボーナスを編集' }).click();
  await expect(page.locator('.bonus-account > div').nth(0)).toContainText('5,000');
  await expect(page.locator('.bonus-account > div').nth(1)).toContainText('630');
  await expect(page.locator('.bonus-account > div').nth(2)).toContainText('5 / 120 LV');
  await expect(page.locator('.bonus-panel')).not.toContainText('AVAILABLE POINTS');
  const damageCard = page.locator('.bonus-card').filter({ hasText: '武器出力' });
  await expect(damageCard).toContainText('合計 +17%');
  await expect(damageCard).toContainText('NEXT LV.3');
  await expect(damageCard).toContainText('212 XP');
  await damageCard.getByRole('button', { name: '武器出力を強化' }).click();
  await expect(damageCard).toContainText('合計 +26%');
  await expect(damageCard).toContainText('NEXT LV.4');
  await expect(damageCard).toContainText('322 XP');
  await expect(page.locator('.bonus-account > div').nth(0)).toContainText('4,788');
  expect(await page.evaluate(() => localStorage.getItem('echo-abyss-campaign-xp'))).toBe('4788');
  await page.screenshot({ path: 'test-results/bonus-editor.png' });
  await page.getByRole('button', { name: 'この編成で閉じる' }).click();
  await page.getByRole('button', { name: /レベル001を開始/ }).click();
  const initial = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    return {
      ranks: engine.initialBonusRanks, damage: engine.player.stats.damage,
      fireRate: engine.player.stats.fireRate, maxHp: engine.player.stats.maxHp,
      hp: engine.player.hp, stacks: Object.keys(engine.stacks).length,
    };
  });
  expect(initial.ranks).toBe(6);
  expect(initial.damage).toBeCloseTo(18.216 * Math.pow(1.08, 3), 6);
  expect(initial.fireRate).toBeCloseTo(3.6 * 0.92 * 1.06, 6);
  expect(initial.maxHp).toBe(109);
  expect(initial.hp).toBe(109);
  expect(initial.stacks).toBe(0);
  await page.evaluate(() => { const engine = (window as any).__ECHO__; engine.player.xp = engine.player.xpNext; });
  await expect.poll(async () => (await snapshot(page)).status).toBe('draft');
  await page.locator('.upgrade-card').first().click();
  expect(await page.evaluate(() => Object.keys((window as any).__ECHO__.stacks).length)).toBe(1);
  await page.evaluate(async () => { await (window as any).__ECHO__.start('wraith', 'standard', 'RESET-CHECK', 'level', 2); });
  const reset = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    return { level: engine.player.level, stacks: Object.keys(engine.stacks).length, damage: engine.player.stats.damage, ranks: engine.initialBonusRanks, stage: engine.challenge.id };
  });
  expect(reset.level).toBe(1);
  expect(reset.stacks).toBe(0);
  expect(reset.damage).toBeCloseTo(18.216 * Math.pow(1.08, 3), 6);
  expect(reset.ranks).toBe(6);
  expect(reset.stage).toBe(2);
});

test('100-stage navigation reaches the final scaling and fourth warden phase', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('echo-abyss-unlocked-level', '100');
    localStorage.setItem('echo-abyss-campaign-xp', '0');
    localStorage.setItem('echo-abyss-initial-bonuses', JSON.stringify({ damage: 20, fireRate: 20, vitality: 20, echoDamage: 20, mobility: 20, xpGain: 20 }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'LEVEL', exact: true }).click();
  for (let chapter = 0; chapter < 9; chapter++) await page.getByRole('button', { name: '次の10ステージ' }).click();
  const finalStage = page.getByRole('button', { name: 'レベル100 管理者' });
  await expect(finalStage).toBeEnabled();
  await finalStage.click();
  await expect(page.locator('.level-brief')).toContainText('LEVEL 100');
  await expect(page.locator('.level-brief')).toContainText('敵HP ×7.10');
  await page.screenshot({ path: 'test-results/level-100-menu.png' });
  await page.getByRole('button', { name: /レベル100を開始/ }).click();
  const scaling = await page.evaluate(() => {
    const engine = (window as any).__ECHO__;
    engine.enemies = []; engine.spawnBoss();
    const boss = engine.enemies.find((enemy: any) => enemy.kind === 'boss');
    boss.hp = boss.maxHp * 0.2;
    return { stage: engine.challenge.id, bossTier: engine.challenge.bossTier, enemyHealth: engine.challenge.enemyHealth, ranks: engine.initialBonusRanks };
  });
  expect(scaling.stage).toBe(100);
  expect(scaling.bossTier).toBe(4);
  expect(scaling.enemyHealth).toBeCloseTo(7.10259, 3);
  expect(scaling.ranks).toBe(120);
  await expect.poll(() => page.evaluate(() => (window as any).__ECHO__.enemies.find((enemy: any) => enemy.kind === 'boss').phase)).toBe(4);
});

test('persistent bonuses only equip purchased ranks and compound to the rank cap', async ({ page }) => {
  const locked = await page.evaluate(async () => {
    localStorage.setItem('echo-abyss-campaign-xp', '0');
    localStorage.setItem('echo-abyss-initial-bonuses', '{}');
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'NO-FREE-BONUS', 'level', 50, { damage: 20 });
    return { damage: engine.player.stats.damage, ranks: engine.initialBonusRanks };
  });
  expect(locked).toEqual({ damage: 18.216, ranks: 0 });
  const earned = await page.evaluate(async () => {
    const modulePath = '/src/game/campaign.ts';
    const campaign = await import(/* @vite-ignore */ modulePath);
    localStorage.setItem(campaign.CAMPAIGN_XP_KEY, '500');
    localStorage.setItem(campaign.CAMPAIGN_LOADOUT_KEY, '{}');
    campaign.purchaseInitialBonus('damage');
    campaign.purchaseInitialBonus('damage');
    campaign.purchaseInitialBonus('damage');
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'EARNED-BONUS', 'level', 50, { damage: 20 });
    return {
      damage: engine.player.stats.damage, ranks: engine.initialBonusRanks,
      available: campaign.readCampaignXp(), invested: campaign.getBonusInvestedXp(campaign.readInitialBonuses()),
    };
  });
  expect(earned.ranks).toBe(3);
  expect(earned.damage).toBeCloseTo(18.216 * Math.pow(1.08, 3), 6);
  expect(earned.available).toBe(50);
  expect(earned.invested).toBe(450);
  const capped = await page.evaluate(async () => {
    localStorage.setItem('echo-abyss-campaign-xp', '0');
    localStorage.setItem('echo-abyss-initial-bonuses', JSON.stringify({ damage: 20, fireRate: 20, vitality: 20, echoDamage: 20, mobility: 20, xpGain: 20 }));
    const engine = (window as any).__ECHO__;
    await engine.start('wraith', 'standard', 'CAP-BONUS', 'level', 100, { damage: 99, fireRate: 99, vitality: 99, echoDamage: 99, mobility: 99, xpGain: 99 });
    return { damage: engine.player.stats.damage, maxHp: engine.player.stats.maxHp, ranks: engine.initialBonusRanks, bonuses: engine.activeBonuses };
  });
  expect(capped.ranks).toBe(120);
  expect(capped.damage).toBeCloseTo(18.216 * Math.pow(1.08, 20), 6);
  expect(capped.maxHp).toBe(605);
  expect(Object.values(capped.bonuses).every(rank => rank === 20)).toBe(true);
});

test.describe('touch layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('mobile level setup and bonus editor remain readable without overflow', async ({ page }) => {
    await page.getByRole('button', { name: 'LEVEL', exact: true }).tap();
    await expect(page.locator('.level-setup')).toBeVisible();
    await expect(page.getByRole('button', { name: /レベル001を開始/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.locator('.launch-panel').screenshot({ path: 'test-results/mobile-level-menu.png' });
    await page.getByRole('button', { name: '初期ボーナスを編集' }).tap();
    await expect(page.getByRole('dialog', { name: '初期ボーナス編成' })).toBeVisible();
    await expect(page.locator('.bonus-card')).toHaveCount(6);
    const damageCard = page.locator('.bonus-card').filter({ hasText: '武器出力' });
    await expect(damageCard).toContainText('NEXT LV.1');
    await expect(damageCard).toContainText('100 XP');
    await expect(damageCard.getByRole('button', { name: '武器出力を強化' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.screenshot({ path: 'test-results/mobile-bonus-editor.png' });
  });

  test('mobile launch and touch controls remain usable', async ({ page }) => {
    await page.getByRole('button', { name: /潜行を開始/ }).tap();
    await expect.poll(async () => (await snapshot(page)).status).toBe('running');
    await expect(page.locator('.touch-controls')).toBeVisible();
    await expect(page.locator('.touch-pad')).toBeVisible();
    await page.locator('.touch-actions').getByRole('button', { name: '武器スキル' }).tap();
    await expect.poll(async () => (await snapshot(page)).weaponCooldown).toBeGreaterThan(0);
    await page.locator('.touch-actions').getByRole('button', { name: '残響召喚' }).tap();
    await expect.poll(async () => (await snapshot(page)).echoes).toBeGreaterThan(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});
