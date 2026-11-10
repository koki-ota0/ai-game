import { SoundSystem } from './audio';
import { BASTION_COLOR, CORES, ECHO_COLOR } from './types';
import { UPGRADES, UPGRADE_BY_ID } from './upgrades';
import { BOSS_DEFINITIONS, bossKindForEncounter } from './bosses';
import type { BossKind } from './bosses';
import { LEVELS, LEVEL_STARTING_MODIFIER, formatStage } from './levels';
import type { LevelDefinition } from './levels';
import {
  applyInitialBonuses, awardStageClear, countBonusRanks,
  readCampaignXp, readInitialBonuses, sanitizeBonusLoadout,
} from './campaign';
import type { BonusLoadout } from './campaign';
import type {
  CoreId, Difficulty, DraftState, EngineStatus, GameMode, HudState, RunResult,
  Stats, ToastMessage, UpgradeDefinition,
} from './types';

const W = 1600;
const H = 900;
const TAU = Math.PI * 2;
const SECTOR_DURATION = 40;
export const INFINITE_CHECKPOINT_INTERVAL = 10;
export const INFINITE_MAX_SECTOR = 100;
const STARTING_DAMAGE_MODIFIER = 0.90;
const INFINITE_STARTING_MODIFIER = { damage: 0.92, fireRate: 0.97, maxHp: 0.97 } as const;
const INFINITE_ABILITY_COOLDOWN = { dash: 2.8, echo: 12, weapon: 1.2 } as const;
const INFINITE_DEPTH_SCALING = { health: 1.12, lateHealth: 1.18, bossHealth: 1.16, spawnRate: 0.03, enemyCap: 3 } as const;
const INFINITE_ROUND_SPAWN_PAUSE = 2.4;
const ABYSS_MODIFIER = { health: 1.55, bossHealth: 2, spawnRate: 1.4, damage: 1.2, speed: 1.1, enemyCap: 1.2, elite: 0.07 } as const;

// The requirement rises at every run level. Enemy shards use a separate,
// bounded difficulty multiplier so later fights still support this curve.
export function getRunXpRequirement(level: number) {
  const completedLevels = Math.max(0, Math.floor(level) - 1);
  return Math.floor(30 + completedLevels * 24 + Math.pow(completedLevels, 2) * 4);
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
};
const formatSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// Compass directions used to cluster hostiles for the WRAITH rail. Aiming at
// the most populated lane keeps the cannon on the densest group instead of the
// pointer, which is what makes the skill read as a screen-wide sweep.
const AIM_BUCKETS = 16;
const RAIL_LOCK_TIME = 0.45;
// The rail is a wide lance: everything inside this half-width is swept, which
// is what lets one cast clear a whole side of the field.
const RAIL_HALF_WIDTH = 150;
const RAIL_LENGTH = 1750;
const RAIL_NORMAL_DAMAGE = 30;
const angleInBucket = (angle: number, bucket: number) => {
  const width = TAU / AIM_BUCKETS;
  return Math.abs(angleDelta(bucket * width + width / 2, angle)) <= width / 2;
};

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class Random {
  private state: number;
  constructor(seed: string) { this.state = hashSeed(seed) || 1; }
  next() {
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min: number, max: number) { return min + this.next() * (max - min); }
  int(min: number, max: number) { return Math.floor(this.range(min, max + 1)); }
  pick<T>(items: T[]) { return items[Math.floor(this.next() * items.length)]; }
}

interface ShotRecord { angle: number; kind: 'bullet' | 'arc' | 'nova'; power?: number; }
interface HistoryFrame { time: number; x: number; y: number; angle: number; shots: ShotRecord[]; }
interface Echo {
  id: number; x: number; y: number; angle: number; frames: HistoryFrame[];
  startTime: number; age: number; index: number; life: number; alpha: number;
  dash: boolean;
}
type EnemyKind = 'drone' | 'dart' | 'gunner' | 'tank' | 'splitter' | 'mite' | 'sniper' | 'weaver' | 'boss';
interface Enemy {
  id: number; kind: EnemyKind; x: number; y: number; vx: number; vy: number;
  radius: number; hp: number; maxHp: number; speed: number; damage: number;
  xp: number; angle: number; lockedAngle: number; fireTimer: number; age: number; flash: number;
  elite: boolean; dead: boolean; showLabel: boolean; contactTimer: number; telegraph: number; stun: number;
  lastHitBy: 'player' | 'echo' | null; lastHitAt: number; syncCooldown: number;
  phase: number; pattern: number; seed: number; specialTimer: number;
  bossKind?: BossKind;
}
interface Projectile {
  id: number; x: number; y: number; vx: number; vy: number; radius: number;
  damage: number; life: number; friendly: boolean; color: string; pierce: number;
  source: 'player' | 'echo' | 'enemy'; hit: Set<number>; kind: 'bullet' | 'nova' | 'enemy';
}
interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; maxLife: number;
  size: number; color: string; drag: number; shape?: 'line' | 'square';
}
interface Pickup { x: number; y: number; vx: number; vy: number; value: number; kind: 'xp' | 'health'; age: number; }
interface Beam {
  points: { x: number; y: number }[]; life: number; maxLife: number; color: string; kind?: 'arc' | 'rail';
  tickDamage?: number; tickTimer?: number; tickInterval?: number; ticksLeft?: number; halfWidth?: number;
}
interface FloatText { x: number; y: number; text: string; color: string; life: number; size: number; }
interface Field { x: number; y: number; life: number; maxLife: number; tick: number; }
interface Player {
  x: number; y: number; vx: number; vy: number; radius: number; angle: number;
  hp: number; stats: Stats; fireTimer: number; invulnerable: number;
  dashTimer: number; dashCooldown: number; echoCooldown: number;
  shieldReady: boolean; shieldTimer: number; sync: number; overdrive: number;
  weaponCooldown: number;
  level: number; xp: number; xpNext: number;
}

interface Anomaly {
  id: string; name: string; description: string;
  spawn: number; hp: number; speed: number; xp: number; score: number;
  elite: number; sync: number; echoRecovery: number;
}

const ENEMY_COLORS: Record<EnemyKind, string> = {
  drone: '#ff6078', dart: '#ff9a62', gunner: '#ef83ff', tank: '#d66b89',
  splitter: '#ff7fae', mite: '#ff806d', sniper: '#ff384f', weaver: '#c27bff', boss: '#ff405f',
};
const ENEMY_LABELS: Record<EnemyKind, [string, string]> = {
  drone: ['追跡ドローン', '追跡'], dart: ['高速ダート', '蛇行突進'],
  gunner: ['ガンナー', '遠距離射撃'], tank: ['タンク', '高耐久'],
  splitter: ['スプリッター', '撃破で分裂'], mite: ['小型ドローン', '分裂個体'],
  sniper: ['スナイパー', '照準線に注意'], weaver: ['ウィーバー', '全方位弾幕'],
  boss: ['AION // WARDEN', '深淵の管理者'],
};
// Each row adds only one normal archetype. Weights also let the director
// reroll tanks into the remaining roster without changing overall spawn density.
const ENEMY_ROSTERS: ReadonlyArray<ReadonlyArray<readonly [EnemyKind, number]>> = [
  [['drone', 0.78], ['dart', 0.22]],
  [['drone', 0.55], ['dart', 0.23], ['gunner', 0.22]],
  [['drone', 0.48], ['dart', 0.22], ['gunner', 0.2], ['splitter', 0.1]],
  [['drone', 0.3], ['dart', 0.17], ['gunner', 0.18], ['splitter', 0.15], ['tank', 0.2]],
  [['drone', 0.22], ['dart', 0.16], ['gunner', 0.17], ['splitter', 0.15], ['tank', 0.14], ['sniper', 0.16]],
  [['drone', 0.2], ['dart', 0.15], ['gunner', 0.17], ['splitter', 0.14], ['tank', 0.13], ['sniper', 0.12], ['weaver', 0.09]],
];

const ANOMALIES: Anomaly[] = [
  { id: 'dense', name: '過密時間', description: '敵の出現 +30% / 欠片 +15%', spawn: 0.77, hp: 1, speed: 1, xp: 1.15, score: 1.1, elite: 0, sync: 1, echoRecovery: 0 },
  { id: 'fractured', name: '破断時間', description: '敵の速度 +18% / 耐久 -12%', spawn: 1, hp: 0.88, speed: 1.18, xp: 1, score: 1.15, elite: 0, sync: 1, echoRecovery: 0 },
  { id: 'gilded', name: '黄金の静電気', description: 'エリート出現率上昇 / スコア +35%', spawn: 1, hp: 1, speed: 1, xp: 1, score: 1.35, elite: 0.11, sync: 1, echoRecovery: 0 },
  { id: 'resonant', name: '共鳴する大気', description: '共鳴ゲージ獲得 +50%', spawn: 1, hp: 1.08, speed: 1, xp: 1, score: 1.1, elite: 0, sync: 1.5, echoRecovery: 0 },
  { id: 'recursive', name: '再帰する記憶', description: '残響の冷却回復 +45%', spawn: 1.08, hp: 1, speed: 1, xp: 1, score: 1.1, elite: 0.02, sync: 1, echoRecovery: 0.45 },
];

export const WEAPON_SKILLS: Record<CoreId, { name: string; enName: string; description: string; cooldown: number }> = {
  wraith: { name: '貫通レール', enName: 'RAIL LANCE', description: '敵が最も密集する方向を自動で狙い、幅広い射線上の通常敵を一掃する', cooldown: 5 },
  tempest: { name: '連鎖サンダー', enName: 'CIRCUIT BREAK', description: '周囲の敵へ雷撃＋短時間の行動停止', cooldown: 7 },
  bastion: { name: 'ノヴァバースト', enName: 'NOVA BURST', description: '周囲へ衝撃波＋敵弾消去＋ノックバック', cooldown: 7 },
};

interface Rift { x: number; y: number; radius: number; progress: number; duration: number; life: number; }
interface Shockwave { x: number; y: number; life: number; maxLife: number; radius: number; color: string; }

interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onStatus: (status: EngineStatus) => void;
  onDraft: (draft: DraftState | null) => void;
  onGameOver: (result: RunResult) => void;
  onToast: (toast: ToastMessage) => void;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: EngineCallbacks;
  private sound = new SoundSystem();
  private random = new Random('ECHO');
  private animation = 0;
  private lastFrame = 0;
  private hudTimer = 0;
  private status: EngineStatus = 'idle';
  private checkpointNewBest = false;
  private checkpointScore = -1;
  private checkpointKind: 'sector' | 'build' | null = null;
  private buildCheckpointShown = false;
  private reviveUsed = false;
  private runCounted = false;
  private core: CoreId = 'wraith';
  private difficulty: Difficulty = 'standard';
  private gameMode: GameMode = 'infinite';
  private challengeLevel = 1;
  private initialBonusRanks = 0;
  private activeBonuses: BonusLoadout = {};
  private bossSpawned = false;
  private bossDefeated = false;
  private cleanupStarted = false;
  private seed = 'ECHO';
  private player!: Player;
  private keys = new Set<string>();
  private touchMove = { x: 0, y: 0 };
  private pointer = { x: W / 2, y: H / 2, down: false, inside: false, manualShots: 0 };
  private firePointerId: number | null = null;
  private pointerButtons = 0;
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private pickups: Pickup[] = [];
  private echoes: Echo[] = [];
  private beams: Beam[] = [];
  private texts: FloatText[] = [];
  private fields: Field[] = [];
  private shockwaves: Shockwave[] = [];
  private rift: Rift | null = null;
  private riftSpawned = false;
  private history: HistoryFrame[] = [];
  private pendingShots: ShotRecord[] = [];
  private historyTimer = 0;
  private stacks: Record<string, number> = {};
  private elapsed = 0;
  private sector = 1;
  private sectorTime = 0;
  private anomaly: Anomaly | null = null;
  private spawnTimer = 0;
  private score = 0;
  private kills = 0;
  private level = 1;
  private combo = 0;
  private bestCombo = 0;
  private comboTimer = 0;
  private echoesCreated = 0;
  private tutorialEnabled = true;
  private tutorialStep = 0;
  private tutorialMoved = false;
  private tutorialDashed = false;
  private tutorialWeaponUsed = false;
  private rerolls = 1;
  private nextId = 1;
  private seenKinds = new Set<EnemyKind>();
  private bossId: number | null = null;
  private pendingBossDraft = false;
  // Last rail lane plus the timestamp it was chosen, so the cannon keeps its
  // heading briefly instead of snapping between crowded directions.
  private railAim: { angle: number; at: number } | null = null;
  private shotCounter = 0;
  private dashHit = new Set<number>();
  private shake = 0;
  private flash = 0;
  private slowMotion = 0;
  private view = { width: W, height: H, scale: 1, x: 0, y: 0, dpr: 1, portrait: false };
  private stars = Array.from({ length: 110 }, (_, index) => ({
    x: (index * 733) % W, y: (index * 397) % H, size: 0.5 + (index % 4) * 0.45, phase: index * 0.7,
  }));

  private get challenge(): LevelDefinition | undefined {
    return this.gameMode === 'level' ? LEVELS[this.challengeLevel - 1] : undefined;
  }

  private get bossTier() {
    if (this.challenge) return this.challenge.bossTier;
    return Math.max(1, Math.floor(this.sector / 3));
  }

  private get currentBossKind(): BossKind {
    if (this.challenge) return this.challenge.bossKind;
    return bossKindForEncounter(Math.max(1, Math.floor(this.sector / 3)));
  }

  private get infiniteDepth() {
    return this.challenge ? 0 : Math.floor((this.sector - 1) / INFINITE_CHECKPOINT_INTERVAL);
  }

  private get combatXpScale() {
    if (this.challenge) return this.challenge.enemyXp;
    return 1 + Math.min(1.5, (this.sector - 1) * 0.012 + this.infiniteDepth * 0.04);
  }

  private get infiniteNormalHealthScale() {
    const earlyDepth = Math.min(this.infiniteDepth, 2);
    const lateDepth = Math.max(0, this.infiniteDepth - 2);
    return Math.pow(INFINITE_DEPTH_SCALING.health, earlyDepth) * Math.pow(INFINITE_DEPTH_SCALING.lateHealth, lateDepth);
  }

  private get enemyRosterTier() {
    if (this.challenge) return this.challenge.enemyTier;
    return Math.min(ENEMY_ROSTERS.length, 1 + Math.floor(this.sector / 2));
  }

  private get tankLimit() {
    if (this.challenge) {
      const tier = this.challenge.enemyTier;
      return tier < 4 ? 0 : Math.min(12, tier - 2);
    }
    return this.sector < 6 ? 0 : Math.min(12, 2 + Math.floor((this.sector - 6) / 2));
  }

  private get weaponSkillCooldown() {
    return WEAPON_SKILLS[this.core].cooldown * (this.challenge ? 1 : INFINITE_ABILITY_COOLDOWN.weapon);
  }

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not supported');
    this.ctx = context;
    this.callbacks = callbacks;
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerup', this.onPointerUp);
    this.animation = requestAnimationFrame(this.loop);
  }

  async start(core: CoreId, difficulty: Difficulty, seed = formatSeed(), gameMode: GameMode = 'infinite', challengeLevel = 1, bonuses?: BonusLoadout) {
    this.core = core;
    this.gameMode = gameMode;
    this.challengeLevel = clamp(Math.round(challengeLevel), 1, LEVELS.length);
    this.difficulty = gameMode === 'level' ? 'standard' : difficulty;
    this.seed = seed;
    this.random = new Random(seed);
    const definition = CORES.find(item => item.id === core)!;
    const stats: Stats = {
      damage: definition.damage * STARTING_DAMAGE_MODIFIER, fireRate: definition.fireRate, moveSpeed: definition.speed,
      maxHp: definition.hp, projectileSpeed: 610, projectiles: 1, pierce: 0,
      critChance: 0, critDamage: 2, pickupRadius: 125, armor: 0,
      echoDuration: 5, echoCooldown: 10, echoDamage: 0.8, maxEchoes: 1,
      dashCooldown: 2.4, dashDamage: 0, syncGain: 1, syncDamage: 1,
      shieldInterval: 14, homing: 0, chain: core === 'tempest' ? 2 : 0,
      overdriveDuration: 5, luck: 0, lifeSteal: 0, xpGain: 1,
    };
    // Run drafts never carry over. Only the separately selected, persistent
    // percentage loadout is applied to a fresh set of base frame stats.
    this.stacks = {};
    if (this.challenge) {
      stats.damage *= LEVEL_STARTING_MODIFIER.damage;
      stats.fireRate *= LEVEL_STARTING_MODIFIER.fireRate;
      stats.maxHp = Math.round(stats.maxHp * LEVEL_STARTING_MODIFIER.maxHp);
    } else {
      stats.damage *= INFINITE_STARTING_MODIFIER.damage;
      stats.fireRate *= INFINITE_STARTING_MODIFIER.fireRate;
      stats.maxHp = Math.round(stats.maxHp * INFINITE_STARTING_MODIFIER.maxHp);
      stats.dashCooldown = INFINITE_ABILITY_COOLDOWN.dash;
      stats.echoCooldown = INFINITE_ABILITY_COOLDOWN.echo;
    }
    const purchasedBonuses = readInitialBonuses();
    this.activeBonuses = this.challenge
      ? sanitizeBonusLoadout(bonuses ?? purchasedBonuses, purchasedBonuses)
      : {};
    this.initialBonusRanks = countBonusRanks(this.activeBonuses);
    if (this.challenge) applyInitialBonuses(stats, this.activeBonuses);
    this.player = {
      x: W / 2, y: H / 2, vx: 0, vy: 0, radius: 17, angle: -Math.PI / 2,
      hp: stats.maxHp, stats, fireTimer: 0.2, invulnerable: 1,
      dashTimer: 0, dashCooldown: 0, echoCooldown: 0,
      shieldReady: false, shieldTimer: stats.shieldInterval,
      sync: 0, overdrive: 0, weaponCooldown: 0, level: 1, xp: 0, xpNext: getRunXpRequirement(1),
    };
    this.enemies = []; this.projectiles = []; this.particles = []; this.pickups = [];
    this.echoes = []; this.beams = []; this.texts = []; this.fields = []; this.history = [];
    this.shockwaves = []; this.rift = null; this.riftSpawned = false;
    this.pendingShots = []; this.elapsed = 0; this.sector = 1; this.railAim = null;
    this.sectorTime = 0;
    this.anomaly = this.challenge && this.challengeLevel > 1 ? ANOMALIES[(this.challengeLevel - 2) % ANOMALIES.length]! : null;
    this.bossSpawned = false;
    this.bossDefeated = false;
    this.cleanupStarted = false;
    this.spawnTimer = 2; this.score = 0; this.kills = 0;
    this.level = 1; this.combo = 0; this.bestCombo = 0; this.comboTimer = 0;
    this.echoesCreated = 0; this.rerolls = 1; this.nextId = 1; this.seenKinds.clear(); this.bossId = null;
    this.pendingBossDraft = false; this.shotCounter = 0; this.historyTimer = 0;
    this.checkpointNewBest = false; this.checkpointScore = -1;
    this.checkpointKind = null; this.buildCheckpointShown = false;
    this.reviveUsed = false; this.runCounted = false;
    this.shake = 0; this.flash = 0; this.slowMotion = 0; this.keys.clear();
    this.pointer = { x: W / 2, y: H / 2, down: false, inside: false, manualShots: 0 };
    this.firePointerId = null; this.pointerButtons = 0; this.touchMove = { x: 0, y: 0 };
    this.tutorialEnabled = localStorage.getItem('echo-abyss-tutorial-complete') !== '1';
    this.tutorialStep = this.tutorialEnabled ? 0 : 5;
    this.tutorialMoved = false; this.tutorialDashed = false; this.tutorialWeaponUsed = false;
    await this.sound.unlock();
    this.setStatus('running');
    this.callbacks.onDraft(null);
    if (this.challenge) this.toast(
      `LEVEL ${formatStage(this.challenge.id)} // ${this.challenge.enName}`,
      `「${this.challenge.name}」開始`,
      `初期ボーナス ${this.initialBonusRanks}Pt / ${this.challenge.hasBoss ? 'ボスと残敵を全滅せよ' : '時間終了後、残敵を全滅せよ'}`,
      'gold',
    );
    else this.toast('TIMELINE 01', '潜行開始', '過去の自分と同期せよ', 'cyan');
    this.emitHud();
  }

  destroy() {
    cancelAnimationFrame(this.animation);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.sound.destroy();
  }

  setSound(enabled: boolean) { this.sound.setEnabled(enabled); }

  togglePause() {
    if (this.status === 'running') this.setStatus('paused');
    else if (this.status === 'paused') this.setStatus('running');
  }

  resume() { if (this.status === 'paused') this.setStatus('running'); }
  pause() { if (this.status === 'running') this.setStatus('paused'); }

  continueInfinite() {
    if (this.status !== 'checkpoint' || this.challenge) return;
    if (this.checkpointKind === 'build') {
      this.checkpointKind = null;
      this.setStatus('running');
      this.emitHud();
      return;
    }
    if (this.sector >= INFINITE_MAX_SECTOR) return;
    this.checkpointKind = null;
    this.advanceInfiniteSector();
    this.setStatus('running');
    this.emitHud();
  }

  finishInfinite() {
    if (this.status !== 'checkpoint' || this.challenge) return;
    this.gameOver(true);
  }

  reviveInfinite(): boolean {
    if (this.status !== 'gameover' || this.challenge || this.reviveUsed || this.player.hp > 0) return false;
    this.reviveUsed = true;
    const p = this.player;
    p.hp = Math.max(1, p.stats.maxHp * 0.5);
    p.invulnerable = 3;
    p.vx = 0; p.vy = 0; p.dashTimer = 0; p.dashCooldown = 0;
    this.projectiles = this.projectiles.filter(projectile => projectile.friendly);
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const d = distance(p.x, p.y, enemy.x, enemy.y);
      if (d >= 260) continue;
      const angle = Math.atan2(enemy.y - p.y, enemy.x - p.x);
      const force = enemy.kind === 'boss' ? 110 : 420;
      enemy.vx += Math.cos(angle) * force;
      enemy.vy += Math.sin(angle) * force;
    }
    this.keys.clear(); this.touchMove = { x: 0, y: 0 };
    this.pointer.down = false; this.firePointerId = null; this.pointerButtons = 0;
    this.shockwaves.push({ x: p.x, y: p.y, life: 0.75, maxLife: 0.75, radius: 250, color: ECHO_COLOR });
    for (let i = 0; i < 36; i++) this.particle(p.x, p.y, ECHO_COLOR, 1, 260, 0.65, 6);
    this.flash = 0.55; this.shake = 8;
    this.setStatus('running');
    this.sound.play('level');
    this.toast('SIGNAL RESTORED // 1 OF 1', '時間へ復帰', 'HP 50% / 3秒無敵 / このランの復活権を消費', 'cyan');
    this.emitHud();
    return true;
  }

  setTouchMove(x: number, y: number) { this.touchMove = { x, y }; }

  triggerDash() { if (this.status === 'running') this.dash(); }
  triggerEcho() { if (this.status === 'running') this.createEcho(); }
  triggerWeaponSkill() { if (this.status === 'running') this.useWeaponSkill(); }
  triggerOverdrive() { if (this.status === 'running') this.activateOverdrive(); }

  rerollDraft() {
    if (this.status !== 'draft' || this.rerolls <= 0) return;
    this.rerolls--;
    this.sound.play('select');
    this.callbacks.onDraft(this.makeDraft(this.pendingBossDraft ? 'boss' : 'level'));
  }

  chooseUpgrade(id: string) {
    if (this.status !== 'draft') return;
    const upgrade = UPGRADE_BY_ID.get(id);
    if (!upgrade || (this.stacks[id] ?? 0) >= upgrade.maxStacks || (upgrade.cores && !upgrade.cores.includes(this.core))) return;
    this.stacks[id] = (this.stacks[id] ?? 0) + 1;
    const previousMaxHp = this.player.stats.maxHp;
    upgrade.apply(this.player.stats);
    if (id === 'vitality') this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + (this.player.stats.maxHp - previousMaxHp));
    if (id === 'shield') {
      this.player.shieldReady = true;
      this.player.shieldTimer = this.player.stats.shieldInterval;
    }
    if (id === 'revive') this.toast('ONE MORE TIMELINE', '死を撤廃', '致命傷を一度だけ無効化', 'gold');
    this.sound.play('select');
    this.pendingBossDraft = false;
    this.callbacks.onDraft(null);
    this.setStatus('running');
    if (!this.challenge && !this.hasAvailableUpgrades()) this.openBuildCheckpoint();
    else this.checkLevelUp();
    this.emitHud();
  }

  getDebugSnapshot() {
    return {
      status: this.status, hp: this.player?.hp, enemies: this.enemies.length,
      projectiles: this.projectiles.length, echoes: this.echoes.length,
      sector: this.sector, level: this.level, score: this.score, seed: this.seed,
      weaponCooldown: this.player?.weaponCooldown, manualShots: this.pointer.manualShots, tutorialStep: this.tutorialStep,
      gameMode: this.gameMode, challengeLevel: this.challenge?.id ?? 0, reviveUsed: this.reviveUsed,
      initialBonusRanks: this.initialBonusRanks, initialBonuses: { ...this.activeBonuses },
      bossDefeated: this.bossDefeated, cleanupStarted: this.cleanupStarted,
      remainingEnemies: this.enemies.filter(enemy => !enemy.dead).length,
      bossKind: this.enemies.find(enemy => enemy.id === this.bossId && !enemy.dead)?.bossKind ?? null,
      checkpointKind: this.checkpointKind, buildCheckpointShown: this.buildCheckpointShown,
      rift: this.rift ? { x: this.rift.x, y: this.rift.y, progress: this.rift.progress, life: this.rift.life } : null,
      player: this.player ? { x: this.player.x, y: this.player.y } : null,
    };
  }

  private setStatus(status: EngineStatus) {
    this.status = status;
    this.lastFrame = performance.now();
    this.callbacks.onStatus(status);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (event.code === 'Escape') {
      if (this.status === 'running' || this.status === 'paused') this.togglePause();
      return;
    }
    this.keys.add(event.code);
    if (event.repeat || this.status !== 'running') return;
    if (event.code === 'Space' || event.code === 'ShiftLeft') this.dash();
    if (event.code === 'KeyQ') this.triggerWeaponSkill();
    if (event.code === 'KeyE') this.createEcho();
    if (event.code === 'KeyR') this.activateOverdrive();
  };

  private onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  private onBlur = () => {
    this.keys.clear(); this.touchMove = { x: 0, y: 0 }; this.pointer.down = false; this.firePointerId = null; this.pointerButtons = 0;
    if (document.hidden) this.pause();
  };

  private updatePointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = (event.clientX - rect.left - this.cameraX()) / this.view.scale;
    this.pointer.y = (event.clientY - rect.top - this.view.y) / this.view.scale;
    this.pointer.inside = this.pointer.x >= 0 && this.pointer.x <= W && this.pointer.y >= 0 && this.pointer.y <= H;
  }

  private onPointerMove = (event: PointerEvent) => {
    this.updatePointer(event);
    const leftDown = (event.buttons & 1) !== 0;
    const rightDown = (event.buttons & 2) !== 0;
    // Mouse chord presses arrive as pointermove, not another pointerdown.
    // Watch button edges so LMB fire + RMB skill works without releasing either button.
    if (rightDown && (this.pointerButtons & 2) === 0 && this.pointer.inside) {
      event.preventDefault();
      this.triggerWeaponSkill();
    }
    if (leftDown && this.status === 'running' && this.pointer.inside && (event.pointerId === this.firePointerId || this.firePointerId === null)) {
      this.pointer.down = true; this.firePointerId = event.pointerId;
    } else if (!leftDown && event.pointerId === this.firePointerId) {
      this.pointer.down = false; this.firePointerId = null;
    }
    this.pointerButtons = event.buttons;
  };

  private onPointerDown = (event: PointerEvent) => {
    this.updatePointer(event);
    this.pointerButtons = event.buttons;
    if (event.button === 2) {
      event.preventDefault();
      this.triggerWeaponSkill();
      return;
    }
    if (event.button === 0 && this.status === 'running') {
      event.preventDefault();
      this.pointer.down = true;
      this.firePointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    this.pointerButtons = event.buttons;
    if (event.pointerId !== this.firePointerId || (event.buttons & 1) !== 0) return;
    this.pointer.down = false; this.firePointerId = null;
    if (event.pointerType === 'touch') this.pointer.inside = false;
  };
  private onPointerLeave = () => { this.pointer.inside = false; this.pointer.down = false; this.firePointerId = null; this.pointerButtons = 0; };
  private onContextMenu = (event: MouseEvent) => event.preventDefault();

  private cameraX() {
    const { width, scale, portrait, x } = this.view;
    return portrait && this.player ? clamp(width / 2 - this.player.x * scale, width - W * scale, 0) : x;
  }

  private resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const portrait = rect.width < 700 && rect.height > rect.width * 1.15;
    const scale = portrait ? rect.width / 650 : Math.min(rect.width / W, rect.height / H);
    this.view = {
      width: rect.width, height: rect.height, scale,
      x: portrait ? 0 : (rect.width - W * scale) / 2,
      y: (rect.height - H * scale) / 2, dpr, portrait,
    };
  };

  private loop = (now: number) => {
    let remaining = Math.min(0.12, Math.max(0, (now - (this.lastFrame || now)) / 1000));
    this.lastFrame = now;
    // Small fixed steps keep collisions reliable without slowing the simulation on low-FPS devices.
    while (this.status === 'running' && remaining > 0.0001) {
      const step = Math.min(1 / 30, remaining);
      this.update(step);
      remaining -= step;
    }
    this.render(now / 1000);
    this.animation = requestAnimationFrame(this.loop);
  };

  private update(dt: number) {
    this.elapsed += dt;
    const scoreTier = this.challenge?.enemyTier ?? this.sector;
    this.score += dt * (8 + scoreTier * 1.5) * (this.difficulty === 'abyss' ? 1.5 : 1) * (this.anomaly?.score ?? 1);
    this.hudTimer -= dt;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 18);
    this.slowMotion = Math.max(0, this.slowMotion - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    const p = this.player;
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.echoCooldown = Math.max(0, p.echoCooldown - dt * (1 + (this.anomaly?.echoRecovery ?? 0)));
    p.weaponCooldown = Math.max(0, p.weaponCooldown - dt);
    p.overdrive = Math.max(0, p.overdrive - dt);
    if ((this.stacks.shield ?? 0) > 0 && !p.shieldReady) {
      p.shieldTimer -= dt;
      if (p.shieldTimer <= 0) {
        p.shieldReady = true;
        p.shieldTimer = p.stats.shieldInterval;
        this.toast('AEGIS ONLINE', '周期シールド再構成', undefined, 'cyan');
      }
    }

    this.updatePlayer(dt);
    this.updateTutorial();
    this.updateHistory(dt);
    this.updateEchoes(dt);
    this.updateDirector(dt);
    this.updateRift(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateRailDamage(dt);
    this.updateFields(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);
    this.enemies = this.enemies.filter(enemy => !enemy.dead);
    this.projectiles = this.projectiles.filter(projectile => projectile.life > 0);
    this.pickups = this.pickups.filter(pickup => pickup.value > 0);
    this.echoes = this.echoes.filter(echo => echo.life > 0);
    this.beams = this.beams.filter(beam => beam.life > 0);
    this.fields = this.fields.filter(field => field.life > 0);
    this.shockwaves = this.shockwaves.filter(wave => wave.life > 0);
    this.texts = this.texts.filter(text => text.life > 0);
    if (this.particles.length > 650) this.particles.splice(0, this.particles.length - 650);

    // Boss stages enter cleanup on boss death; normal stages enter it when
    // their combat timer expires. Both require every remaining hostile to die.
    if (this.challenge && this.cleanupStarted && this.status === 'running' && this.enemies.length === 0) {
      this.gameOver(true);
      return;
    }
    if (this.pendingBossDraft) this.openDraft('boss');
    else this.checkLevelUp();
    if (this.hudTimer <= 0) { this.hudTimer = 0.075; this.emitHud(); }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    let dx = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.touchMove.x;
    let dy = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) + this.touchMove.y;
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }

    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (Math.random() < 0.85) this.particle(p.x, p.y, '#62f6e7', 1, 90, 0.28, 8);
      if (p.stats.dashDamage > 0) {
        for (const enemy of this.enemies) {
          if (!enemy.dead && !this.dashHit.has(enemy.id) && distance(p.x, p.y, enemy.x, enemy.y) < 65 + enemy.radius) {
            this.dashHit.add(enemy.id);
            this.damageEnemy(enemy, p.stats.dashDamage * p.stats.damage, 'player');
          }
        }
      }
    } else {
      const speed = p.stats.moveSpeed * (p.overdrive > 0 ? 1.12 : 1);
      const responsiveness = 1 - Math.exp(-dt * 18);
      p.vx = lerp(p.vx, dx * speed, responsiveness);
      p.vy = lerp(p.vy, dy * speed, responsiveness);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    p.x = clamp(p.x, 45, W - 45);
    p.y = clamp(p.y, 45, H - 45);

    if (!this.tutorialMoved && distance(p.x, p.y, W / 2, H / 2) > 45) this.tutorialMoved = true;
    const target = this.nearestEnemy(p.x, p.y, 850);
    const manualFire = this.pointer.down && this.pointer.inside;
    if (manualFire) p.angle = Math.atan2(this.pointer.y - p.y, this.pointer.x - p.x);
    else if (target) p.angle = Math.atan2(target.y - p.y, target.x - p.x);
    else if (length > 0.1) p.angle = Math.atan2(dy, dx);

    p.fireTimer -= dt;
    if ((target || manualFire) && p.fireTimer <= 0) {
      this.fireWeapon(p.x, p.y, p.angle, 'player', 1, true);
      if (manualFire) this.pointer.manualShots++;
      const manualBonus = manualFire ? 1.2 : 1;
      const rate = p.stats.fireRate * manualBonus * (p.overdrive > 0 ? 1.85 : 1) * ((this.stacks.overclock ?? 0) > 0 && p.hp < p.stats.maxHp * 0.3 ? 1.1 : 1);
      p.fireTimer += 1 / rate;
    }
  }

  private updateTutorial() {
    if (!this.tutorialEnabled) return;
    const completed = [
      this.tutorialMoved,
      this.pointer.manualShots > 0,
      this.tutorialDashed,
      this.echoesCreated > 0,
      this.tutorialWeaponUsed,
    ];
    const timeouts = [6, 11, 17, 24, 32];
    while (this.tutorialStep < 5 && (completed[this.tutorialStep] || this.elapsed > timeouts[this.tutorialStep]!)) {
      this.tutorialStep++;
    }
    if (this.tutorialStep >= 5) {
      this.tutorialEnabled = false;
      localStorage.setItem('echo-abyss-tutorial-complete', '1');
      this.toast('PILOT LINK 100%', '操作リンク確立', 'ここからは、あなたの時間だ', 'cyan');
    }
  }

  private updateHistory(dt: number) {
    this.historyTimer -= dt;
    if (this.historyTimer > 0) return;
    this.historyTimer += 1 / 30;
    const p = this.player;
    this.history.push({ time: this.elapsed, x: p.x, y: p.y, angle: p.angle, shots: this.pendingShots });
    this.pendingShots = [];
    if (this.history.length > 480) this.history.splice(0, this.history.length - 480);
  }

  private updateEchoes(dt: number) {
    for (let echoIndex = this.echoes.length - 1; echoIndex >= 0; echoIndex--) {
      const echo = this.echoes[echoIndex];
      echo.age += dt;
      echo.life -= dt;
      echo.alpha = Math.min(0.72, echo.alpha + dt * 3);
      while (echo.index < echo.frames.length && echo.frames[echo.index].time - echo.startTime <= echo.age) {
        const frame = echo.frames[echo.index];
        echo.x = frame.x; echo.y = frame.y; echo.angle = frame.angle;
        for (const shot of frame.shots) this.fireRecordedShot(echo, shot, frame.angle);
        echo.index++;
        if (Math.random() < 0.3) this.particle(echo.x, echo.y, ECHO_COLOR, 1, 35, 0.25, 5);
      }
      if (echo.life <= 0 || echo.index >= echo.frames.length) this.expireEcho(echoIndex);
    }
  }

  private updateDirector(dt: number) {
    const boss = this.enemies.find(enemy => enemy.kind === 'boss' && !enemy.dead);
    if (!boss) {
      if (!this.cleanupStarted) this.sectorTime += dt;
      if (this.challenge) {
        if (!this.bossSpawned && !this.cleanupStarted && this.sectorTime >= this.challenge.combatDuration) {
          this.rift = null;
          if (this.challenge.hasBoss) {
            this.bossSpawned = true;
            this.spawnBoss();
          } else {
            this.cleanupStarted = true;
            this.toast(
              'COMBAT WINDOW SEALED // CLEANUP',
              '残敵を掃討せよ',
              '通常出現を停止。全ての敵を倒すとレベル完了',
              'gold',
            );
          }
        }
      } else {
        if (!this.bossSpawned && this.sector % 3 === 0 && this.sectorTime >= INFINITE_ROUND_SPAWN_PAUSE) {
          this.bossSpawned = true;
          this.spawnBoss();
          return;
        }
        if (this.sectorTime >= SECTOR_DURATION) {
          if (this.sector % INFINITE_CHECKPOINT_INTERVAL === 0) {
            this.sectorTime = SECTOR_DURATION;
            if (this.sector >= INFINITE_MAX_SECTOR) {
              this.gameOver(true);
              return;
            }
            this.checkpointScore = Math.floor(this.score);
            this.checkpointNewBest = this.recordInfiniteRecords();
            this.checkpointKind = 'sector';
            this.setStatus('checkpoint');
            this.sound.play('level');
            this.emitHud();
            return;
          }
          this.advanceInfiniteSector();
        }
      }
    }

    if (!boss && !this.cleanupStarted && (this.sector >= 2 || (this.challenge && this.challenge.id >= 2)) && !this.riftSpawned && this.sectorTime > 10) {
      let x = W / 2, y = H / 2;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = this.random.range(170, W - 170); y = this.random.range(160, H - 170);
        if (distance(x, y, this.player.x, this.player.y) > 280) break;
      }
      this.rift = { x, y, radius: 76, progress: 0, duration: 4, life: 18 };
      this.riftSpawned = true;
      this.toast('OPTIONAL OBJECTIVE', 'SYNC RIFT 出現', '円内で累計4秒・外でも進行保持 → ZERO・回復・欠片を獲得', 'gold');
    }

    this.spawnTimer -= dt;
    const enemyTier = this.challenge?.enemyTier ?? this.sector;
    const depth = this.infiniteDepth;
    const maxEnemies = this.challenge
      ? Math.min(60, 34 + enemyTier * 2)
      : Math.round((Math.min(125, 55 + enemyTier * 8) + depth * INFINITE_DEPTH_SCALING.enemyCap) * (this.difficulty === 'abyss' ? ABYSS_MODIFIER.enemyCap : 1));
    if (!this.cleanupStarted && this.spawnTimer <= 0 && this.enemies.length < maxEnemies) {
      const difficultyScale = this.difficulty === 'abyss' ? ABYSS_MODIFIER.spawnRate : 1;
      const depthSpawnRate = this.challenge ? 1 : 1 + depth * INFINITE_DEPTH_SCALING.spawnRate;
      const stageSpawnRate = this.challenge?.spawnRate ?? 1;
      const baseInterval = this.challenge
        ? 0.95 + enemyTier * 0.055 - this.elapsed * 0.0001
        : 1.0 - enemyTier * 0.052 - this.elapsed * 0.00045;
      const interval = Math.max(this.challenge ? 0.65 : 0.17, baseInterval / stageSpawnRate) * (this.anomaly?.spawn ?? 1) * (boss ? 2.2 : 1) / difficultyScale / depthSpawnRate;
      this.spawnTimer += interval * this.random.range(0.72, 1.25);
      this.spawnDirectedEnemy();
      const extraChance = this.challenge ? 0.05 : 0.16;
      if (enemyTier > 6 && this.random.next() < extraChance) this.spawnDirectedEnemy();
    }
  }

  private advanceInfiniteSector() {
    this.sectorTime = 0;
    this.sector = Math.min(INFINITE_MAX_SECTOR, this.sector + 1);
    this.rift = null;
    this.riftSpawned = false;
    this.bossSpawned = false;
    this.spawnTimer = INFINITE_ROUND_SPAWN_PAUSE;
    // Thin the previous round without awarding kills, then leave a short lull.
    let normalIndex = 0;
    this.enemies = this.enemies.filter(enemy => {
      if (enemy.dead) return false;
      if (enemy.kind === 'boss') return true;
      normalIndex++;
      return normalIndex % 3 !== 0;
    });
    const previousAnomaly = this.anomaly?.id;
    this.anomaly = this.random.pick(ANOMALIES.filter(anomaly => anomaly.id !== previousAnomaly));
    const escalated = this.sector > 1 && (this.sector - 1) % INFINITE_CHECKPOINT_INTERVAL === 0;
    if (escalated) {
      this.toast(`THREAT ESCALATION // DEPTH ${String(this.infiniteDepth).padStart(2, '0')}`, '敵戦力が増幅', '敵HP・出現密度・同時出現数・ワーデンHPが上昇', 'coral');
    }
    if (this.sector === INFINITE_MAX_SECTOR) {
      this.toast(`FINAL TIMELINE ${INFINITE_MAX_SECTOR}`, '最終セクター', 'このセクターの終了時にスコアと結果を確定', 'gold');
    } else if (!escalated) {
      this.toast(`TIMELINE ${String(this.sector).padStart(2, '0')} // ANOMALY`, this.anomaly.name, this.anomaly.description, this.sector > 5 ? 'coral' : 'cyan');
    }
  }

  private pickEnemyKind(tankAllowed = true): EnemyKind {
    const tier = this.enemyRosterTier;
    // LEVEL uses the same roster through its more gradually increasing enemyTier.
    const roster = ENEMY_ROSTERS[Math.min(ENEMY_ROSTERS.length, Math.max(1, tier)) - 1]!;
    const totalWeight = roster.reduce((total, [kind, weight]) => total + (kind === 'tank' && !tankAllowed ? 0 : weight), 0);
    let roll = this.random.next() * totalWeight;
    for (const [kind, weight] of roster) {
      if (kind === 'tank' && !tankAllowed) continue;
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return 'drone';
  }

  private spawnDirectedEnemy() {
    const tankCount = this.enemies.reduce((count, enemy) => count + (enemy.kind === 'tank' && !enemy.dead ? 1 : 0), 0);
    this.spawnEnemy(this.pickEnemyKind(tankCount < this.tankLimit));
  }

  private spawnEnemy(kind: EnemyKind, x?: number, y?: number, eliteOverride = false) {
    if (x === undefined || y === undefined) {
      const edge = this.random.int(0, 3);
      const positions: [number, number][] = [
        [this.random.range(60, W - 60), 50],
        [W - 50, this.random.range(60, H - 60)],
        [this.random.range(60, W - 60), H - 50],
        [50, this.random.range(60, H - 60)],
      ];
      let [spawnX, spawnY] = positions[edge]!;
      if (distance(spawnX, spawnY, this.player.x, this.player.y) < 360) {
        spawnX = spawnX < W / 2 ? 55 : W - 55;
        spawnY = spawnY < H / 2 ? 55 : H - 55;
      }
      x = spawnX;
      y = spawnY;
    }
    const configs: Record<Exclude<EnemyKind, 'boss'>, [number, number, number, number, number, number]> = {
      drone: [36, 88, 11, 16, 7, 1], dart: [34, 155, 9, 12, 6, 1],
      gunner: [55, 70, 10, 18, 10, 1], tank: [240, 43, 22, 29, 24, 1],
      splitter: [72, 74, 13, 21, 12, 1], mite: [15, 130, 6, 9, 3, 1],
      sniper: [65, 55, 17, 18, 13, 1], weaver: [100, 82, 12, 22, 16, 1],
    };
    if (kind === 'boss') return;
    const [baseHp, speed, damage, radius, xp] = configs[kind];
    const tier = this.challenge?.enemyTier ?? this.sector;
    const elite = eliteOverride || (tier >= 2 && this.random.next() < Math.min(0.28, 0.025 + tier * 0.009 + (this.challenge?.eliteBonus ?? 0) + (this.anomaly?.elite ?? 0) + (this.difficulty === 'abyss' ? ABYSS_MODIFIER.elite : 0)));
    const healthScale = this.challenge
      ? this.challenge.enemyHealth * (1 + this.elapsed * 0.001) * (this.anomaly?.hp ?? 1)
      : (1 + (this.sector - 1) * 0.2 + this.elapsed * 0.0015) * this.infiniteNormalHealthScale * (this.difficulty === 'abyss' ? ABYSS_MODIFIER.health : 1) * (this.anomaly?.hp ?? 1);
    const hp = baseHp * healthScale * (elite ? 2.8 : 1);
    const damageScale = this.challenge
      ? this.challenge.enemyDamage * (1 + this.elapsed * 0.0005)
      : (1 + (this.sector - 1) * 0.055) * (this.difficulty === 'abyss' ? ABYSS_MODIFIER.damage : 1);
    const enemy: Enemy = {
      id: this.nextId++, kind, x, y, vx: 0, vy: 0, radius: radius * (elite ? 1.22 : 1),
      hp, maxHp: hp, speed: speed * (1 + Math.min(0.35, tier * 0.018)) * (this.challenge?.enemySpeed ?? 1) * (this.anomaly?.speed ?? 1) * (this.difficulty === 'abyss' ? ABYSS_MODIFIER.speed : 1),
      damage: damage * damageScale,
      xp: xp * (elite ? 3 : 1) * (this.anomaly?.xp ?? 1) * this.combatXpScale, angle: 0, lockedAngle: 0, fireTimer: this.random.range(0.5, 2),
      age: 0, flash: 0, elite, dead: false, showLabel: false, contactTimer: 0, telegraph: 0, stun: 0,
      lastHitBy: null, lastHitAt: -10, syncCooldown: 0, phase: 1,
      pattern: 0, seed: this.random.range(0, 100), specialTimer: 0,
    };
    if (!this.seenKinds.has(kind)) {
      enemy.showLabel = true;
      this.seenKinds.add(kind);
    }
    this.enemies.push(enemy);
  }

  private spawnBoss(kind = this.currentBossKind) {
    const tier = this.bossTier;
    const definition = BOSS_DEFINITIONS[kind];
    const hp = 1250 * (1 + (tier - 1) * 0.82) * (this.challenge?.bossHealth ?? 1) * Math.pow(INFINITE_DEPTH_SCALING.bossHealth, this.infiniteDepth) * (this.difficulty === 'abyss' ? ABYSS_MODIFIER.bossHealth : 1);
    const bossDamageScale = this.challenge ? 1 + (this.challenge.enemyDamage - 1) * 0.65 : 1;
    const enemy: Enemy = {
      id: this.nextId++, kind: 'boss', x: W / 2, y: 115, vx: 0, vy: 0, radius: definition.radius,
      hp, maxHp: hp, speed: (48 + tier * 3) * definition.speed, damage: (26 + tier * 3) * bossDamageScale, xp: (100 + tier * 20) * this.combatXpScale,
      angle: 0, lockedAngle: 0, fireTimer: 1.8, age: 0, flash: 0, elite: true, dead: false,
      showLabel: false, contactTimer: 0, telegraph: 0, stun: 0, lastHitBy: null, lastHitAt: -10,
      syncCooldown: 0, phase: 1, pattern: 0, seed: this.random.range(0, 100), specialTimer: 0, bossKind: kind,
    };
    this.enemies.push(enemy);
    this.bossId = enemy.id;
    this.sound.play('boss');
    this.shake = 12;
    this.toast(
      this.challenge ? `LEVEL ${formatStage(this.challenge.id)} // ${definition.name}` : `${definition.name} // ${String(tier).padStart(2, '0')}`,
      `${definition.title}、顕現`,
      definition.description,
      'coral',
    );
  }

  private updateRift(dt: number) {
    const rift = this.rift;
    if (!rift) return;
    rift.life -= dt;
    const inside = distance(this.player.x, this.player.y, rift.x, rift.y) < rift.radius;
    // Leaving the circle pauses stabilization instead of erasing earned progress.
    if (inside) rift.progress = Math.min(rift.duration, rift.progress + dt);
    if (rift.progress >= rift.duration) {
      const p = this.player;
      p.sync = Math.min(100, p.sync + 35);
      p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * 0.15);
      this.score += 1200 * (this.difficulty === 'abyss' ? 1.5 : 1);
      for (let i = 0; i < 6; i++) {
        const angle = i * TAU / 6;
        this.pickups.push({ x: rift.x + Math.cos(angle) * 34, y: rift.y + Math.sin(angle) * 34, vx: Math.cos(angle) * 80, vy: Math.sin(angle) * 80, value: 8 * this.combatXpScale, kind: 'xp', age: 0 });
      }
      this.shockwaves.push({ x: rift.x, y: rift.y, life: 0.65, maxLife: 0.65, radius: 220, color: '#62f6e7' });
      this.toast('RIFT STABILIZED', '同期リフト安定化', 'ZERO +35 / HP +15% / 欠片を獲得', 'gold');
      this.sound.play('level');
      this.rift = null;
    } else if (rift.life <= 0) this.rift = null;
  }

  private updateEnemies(dt: number) {
    const p = this.player;
    const timeScale = p.overdrive > 0 ? 0.42 : 1;
    const scaledDt = dt * timeScale;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.age += scaledDt;
      enemy.flash = Math.max(0, enemy.flash - dt * 6);
      enemy.contactTimer = Math.max(0, enemy.contactTimer - dt);
      enemy.syncCooldown = Math.max(0, enemy.syncCooldown - dt);
      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const nx = dx / dist;
      const ny = dy / dist;
      enemy.angle = Math.atan2(dy, dx);
      if (enemy.stun > 0) {
        enemy.stun = Math.max(0, enemy.stun - dt);
        enemy.x += enemy.vx * scaledDt; enemy.y += enemy.vy * scaledDt;
        enemy.vx *= Math.pow(0.03, scaledDt); enemy.vy *= Math.pow(0.03, scaledDt);
        continue;
      }
      let mx = nx, my = ny;

      if (enemy.kind === 'dart') {
        const sway = Math.sin(enemy.age * 5 + enemy.seed) * 0.65;
        mx = nx - ny * sway; my = ny + nx * sway;
      } else if (enemy.kind === 'gunner') {
        const direction = dist > 390 ? 1 : dist < 275 ? -0.8 : 0;
        mx = nx * direction - ny * 0.55; my = ny * direction + nx * 0.55;
        enemy.fireTimer -= scaledDt;
        if (enemy.fireTimer <= 0 && dist < 700) {
          this.enemyShot(enemy.x, enemy.y, enemy.angle, 250, enemy.damage, 6);
          enemy.fireTimer = this.random.range(1.8, 2.5);
        }
      } else if (enemy.kind === 'sniper') {
        const direction = dist > 560 ? 1 : dist < 440 ? -0.8 : 0;
        mx = nx * direction - ny * 0.25; my = ny * direction + nx * 0.25;
        enemy.fireTimer -= scaledDt;
        if (enemy.fireTimer <= 0 && enemy.telegraph <= 0) {
          enemy.telegraph = 0.85;
          enemy.lockedAngle = enemy.angle;
        }
        if (enemy.telegraph > 0) {
          enemy.angle = enemy.lockedAngle;
          enemy.telegraph -= scaledDt;
          mx = my = 0;
          if (enemy.telegraph <= 0) {
            this.enemyShot(enemy.x, enemy.y, enemy.lockedAngle, 520, enemy.damage * 1.25, 7);
            enemy.fireTimer = 3.2;
          }
        }
      } else if (enemy.kind === 'weaver') {
        const direction = dist > 330 ? 0.8 : dist < 240 ? -0.6 : 0;
        mx = nx * direction - ny * 0.85; my = ny * direction + nx * 0.85;
        enemy.fireTimer -= scaledDt;
        if (enemy.fireTimer <= 0) {
          for (let i = 0; i < 6; i++) this.enemyShot(enemy.x, enemy.y, i * TAU / 6 + enemy.age * 0.3, 175, enemy.damage * 0.75, 5);
          enemy.fireTimer = 3;
        }
      } else if (enemy.kind === 'boss') {
        this.updateBoss(enemy, scaledDt, nx, ny, dist);
        mx = enemy.vx; my = enemy.vy;
      }

      if (enemy.kind !== 'boss') {
        const wobble = 1 + Math.sin(enemy.age * 2 + enemy.seed) * 0.05;
        enemy.x += (mx * enemy.speed * wobble + enemy.vx) * scaledDt;
        enemy.y += (my * enemy.speed * wobble + enemy.vy) * scaledDt;
        enemy.vx *= Math.pow(0.04, scaledDt);
        enemy.vy *= Math.pow(0.04, scaledDt);
      } else {
        enemy.x += enemy.vx * scaledDt;
        enemy.y += enemy.vy * scaledDt;
      }
      enemy.x = clamp(enemy.x, 30, W - 30);
      enemy.y = clamp(enemy.y, 30, H - 30);

      if (dist < p.radius + enemy.radius + 2 && p.invulnerable <= 0) {
        this.hurtPlayer(enemy.damage);
        p.vx = nx * 260; p.vy = ny * 260;
        enemy.vx = -nx * 120; enemy.vy = -ny * 120;
      }
    }
  }

  private updateBoss(enemy: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const hpRatio = enemy.hp / enemy.maxHp;
    const finalBoss = this.bossTier >= 4;
    const nextPhase = finalBoss
      ? hpRatio < 0.25 ? 4 : hpRatio < 0.5 ? 3 : hpRatio < 0.75 ? 2 : 1
      : hpRatio < 0.32 ? 3 : hpRatio < 0.67 ? 2 : 1;
    if (nextPhase !== enemy.phase) {
      enemy.phase = nextPhase;
      enemy.specialTimer = 0;
      enemy.telegraph = 0;
      this.shake = 15;
      this.flash = 0.35;
      for (let i = 0; i < 12 + nextPhase * 2; i++) this.fireBossShot(enemy, i * TAU / (12 + nextPhase * 2), 155, 0.55, 6);
      this.toast(`PHASE 0${nextPhase}`, nextPhase === 2 ? '制限解除' : '深淵臨界', '弾幕が加速します', 'coral');
    }
    switch (enemy.bossKind ?? 'warden') {
      case 'lancer': this.updateLancerBoss(enemy, dt, nx, ny, dist); break;
      case 'choir': this.updateChoirBoss(enemy, dt, nx, ny, dist); break;
      case 'colossus': this.updateColossusBoss(enemy, dt, nx, ny, dist); break;
      default: this.updateWardenBoss(enemy, dt, nx, ny, dist); break;
    }
  }

  private updateWardenBoss(enemy: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const radial = dist > 390 ? 0.7 : dist < 260 ? -0.55 : 0;
    enemy.vx = nx * enemy.speed * radial - ny * enemy.speed * 0.6;
    enemy.vy = ny * enemy.speed * radial + nx * enemy.speed * 0.6;
    enemy.fireTimer -= dt;
    if (enemy.fireTimer <= 0) {
      enemy.pattern++;
      const pattern = enemy.pattern % 3;
      if (pattern === 0) {
        const count = 12 + enemy.phase * 4;
        for (let i = 0; i < count; i++) this.fireBossShot(enemy, i * TAU / count + enemy.age * 0.45, 175 + enemy.phase * 20, 0.55, 6);
      } else if (pattern === 1) {
        const shots = 3 + enemy.phase * 2;
        for (let i = 0; i < shots; i++) this.fireBossShot(enemy, enemy.angle + (i - (shots - 1) / 2) * 0.13, 300, 0.7, 7);
      } else {
        const amount = Math.min(5, 1 + enemy.phase);
        for (let i = 0; i < amount; i++) this.spawnEnemy(i % 2 ? 'dart' : 'drone', enemy.x + Math.cos(i * TAU / amount) * 90, enemy.y + Math.sin(i * TAU / amount) * 90);
      }
      enemy.fireTimer = Math.max(1.15, 2.35 - enemy.phase * 0.25);
    }
  }

  private updateLancerBoss(enemy: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const definition = BOSS_DEFINITIONS.lancer;
    if (enemy.specialTimer > 0) {
      enemy.specialTimer -= dt;
      this.particle(enemy.x, enemy.y, definition.color, 1, 85, 0.25, 5);
      if (enemy.specialTimer <= 0) enemy.fireTimer = 0.85;
      return;
    }
    if (enemy.telegraph > 0) {
      enemy.vx = 0; enemy.vy = 0;
      enemy.telegraph -= dt;
      if (enemy.telegraph <= 0) {
        if (enemy.pattern % 2 === 0) {
          enemy.specialTimer = 0.38 + enemy.phase * 0.03;
          const speed = 610 + enemy.phase * 45;
          enemy.vx = Math.cos(enemy.lockedAngle) * speed;
          enemy.vy = Math.sin(enemy.lockedAngle) * speed;
          this.shake = Math.max(this.shake, 8);
        } else {
          const shots = 3 + enemy.phase * 2;
          for (let i = 0; i < shots; i++) this.fireBossShot(enemy, enemy.lockedAngle + (i - (shots - 1) / 2) * 0.1, 460 + enemy.phase * 25, 0.52, 6);
          enemy.fireTimer = Math.max(1.1, 1.75 - enemy.phase * 0.12);
        }
      }
      return;
    }
    const radial = dist > 520 ? 0.85 : dist < 370 ? -0.65 : 0;
    enemy.vx = nx * enemy.speed * radial - ny * enemy.speed * 0.85;
    enemy.vy = ny * enemy.speed * radial + nx * enemy.speed * 0.85;
    enemy.fireTimer -= dt;
    if (enemy.fireTimer <= 0) {
      enemy.pattern++;
      enemy.lockedAngle = enemy.angle;
      enemy.telegraph = Math.max(0.6, 1 - enemy.phase * 0.08);
    }
  }

  private updateChoirBoss(enemy: Enemy, dt: number, nx: number, ny: number, dist: number) {
    const radial = dist > 400 ? 0.55 : dist < 280 ? -0.4 : 0;
    enemy.vx = nx * enemy.speed * radial - ny * enemy.speed * 0.85;
    enemy.vy = ny * enemy.speed * radial + nx * enemy.speed * 0.85;
    enemy.fireTimer -= dt;
    if (enemy.fireTimer > 0) return;
    enemy.pattern++;
    const pattern = enemy.pattern % 3;
    if (pattern === 1) {
      const count = 6 + enemy.phase * 2;
      for (let i = 0; i < count; i++) {
        const angle = enemy.age * 0.85 + i * 0.3;
        this.fireBossShot(enemy, angle, 190 + enemy.phase * 15, 0.34, 5);
        this.fireBossShot(enemy, angle + Math.PI, 190 + enemy.phase * 15, 0.34, 5);
      }
    } else if (pattern === 2) {
      const shots = 4 + enemy.phase * 2;
      for (let i = 0; i < shots; i++) this.fireBossShot(enemy, enemy.angle + (i - (shots - 1) / 2) * 0.16, 280, 0.42, 6);
    } else {
      const weavers = this.enemies.filter(target => !target.dead && target.kind === 'weaver').length;
      const amount = Math.min(enemy.phase >= 3 ? 2 : 1, Math.max(0, 2 - weavers));
      for (let i = 0; i < amount; i++) this.spawnEnemy('weaver', enemy.x + (i ? 95 : -95), enemy.y + 65);
      const count = 6 + enemy.phase * 2;
      for (let i = 0; i < count; i++) this.fireBossShot(enemy, i * TAU / count - enemy.age * 0.55, 165, 0.32, 5);
    }
    enemy.fireTimer = Math.max(1, 2.1 - enemy.phase * 0.18);
  }

  private updateColossusBoss(enemy: Enemy, dt: number, nx: number, ny: number, dist: number) {
    if (enemy.telegraph > 0) {
      enemy.vx = 0; enemy.vy = 0;
      enemy.telegraph -= dt;
      if (enemy.telegraph <= 0) {
        const radius = 280;
        const definition = BOSS_DEFINITIONS.colossus;
        this.shockwaves.push({ x: enemy.x, y: enemy.y, life: 0.65, maxLife: 0.65, radius, color: definition.color });
        if (distance(this.player.x, this.player.y, enemy.x, enemy.y) < radius + this.player.radius) this.hurtPlayer(enemy.damage * 0.72);
        const count = 10 + enemy.phase * 2;
        for (let i = 0; i < count; i++) this.fireBossShot(enemy, i * TAU / count, 210, 0.32, 7);
        this.sound.play('explode', 0.8);
        this.shake = Math.max(this.shake, 14);
        enemy.fireTimer = Math.max(1.3, 2.5 - enemy.phase * 0.15);
      }
      return;
    }
    const radial = dist > 350 ? 0.55 : dist < 250 ? -0.25 : 0;
    enemy.vx = nx * enemy.speed * radial - ny * enemy.speed * 0.25;
    enemy.vy = ny * enemy.speed * radial + nx * enemy.speed * 0.25;
    enemy.fireTimer -= dt;
    if (enemy.fireTimer > 0) return;
    enemy.pattern++;
    if (enemy.pattern % 2 === 1) {
      enemy.telegraph = 1.05;
    } else {
      const count = 8 + enemy.phase * 2;
      for (let i = 0; i < count; i++) this.fireBossShot(enemy, i * TAU / count + enemy.pattern * 0.17, 190 + enemy.phase * 15, 0.44, 8);
      const tankExists = this.enemies.some(target => !target.dead && target.kind === 'tank');
      if (enemy.phase >= 2 && !tankExists) this.spawnEnemy('tank', enemy.x + 100, enemy.y + 80);
      enemy.fireTimer = Math.max(1.4, 2.6 - enemy.phase * 0.16);
    }
  }

  private updateProjectiles(dt: number) {
    const p = this.player;
    for (const projectile of this.projectiles) {
      if (projectile.life <= 0) continue;
      projectile.life -= dt;
      if (projectile.friendly && p.stats.homing > 0) {
        const isNova = projectile.kind === 'nova';
        const target = this.nearestEnemy(projectile.x, projectile.y, isNova ? 360 : 290);
        if (target) {
          const current = Math.atan2(projectile.vy, projectile.vx);
          const desired = Math.atan2(target.y - projectile.y, target.x - projectile.x);
          const speed = Math.hypot(projectile.vx, projectile.vy);
          const turnRate = p.stats.homing * (isNova ? 1.4 : 1);
          const next = current + clamp(angleDelta(current, desired), -turnRate * dt, turnRate * dt);
          projectile.vx = Math.cos(next) * speed; projectile.vy = Math.sin(next) * speed;
        }
      }
      const timeScale = !projectile.friendly && p.overdrive > 0 ? 0.42 : 1;
      projectile.x += projectile.vx * dt * timeScale;
      projectile.y += projectile.vy * dt * timeScale;
      if (projectile.x < -40 || projectile.x > W + 40 || projectile.y < -40 || projectile.y > H + 40) projectile.life = 0;
      if (projectile.life <= 0) continue;

      if (projectile.friendly) {
        for (const enemy of this.enemies) {
          if (enemy.dead || projectile.hit.has(enemy.id)) continue;
          if (distance(projectile.x, projectile.y, enemy.x, enemy.y) < projectile.radius + enemy.radius) {
            projectile.hit.add(enemy.id);
            this.damageEnemy(enemy, projectile.damage, projectile.source === 'echo' ? 'echo' : 'player');
            for (let i = 0; i < 3; i++) this.particle(projectile.x, projectile.y, projectile.color, 1, 100, 0.2, 4);
            if (projectile.pierce > 0) projectile.pierce--;
            else { projectile.life = 0; break; }
          }
        }
      } else if (p.invulnerable <= 0 && distance(projectile.x, projectile.y, p.x, p.y) < projectile.radius + p.radius) {
        projectile.life = 0;
        this.hurtPlayer(projectile.damage);
      }
    }
  }

  private updateFields(dt: number) {
    for (const field of this.fields) {
      field.life -= dt;
      field.tick -= dt;
      for (const enemy of this.enemies) {
        if (enemy.dead || enemy.kind === 'boss') continue;
        const dx = field.x - enemy.x, dy = field.y - enemy.y;
        const dist = Math.max(25, Math.hypot(dx, dy));
        if (dist < 190) {
          enemy.vx += dx / dist * 460 * dt;
          enemy.vy += dy / dist * 460 * dt;
        }
      }
      if (field.tick <= 0) {
        field.tick = 0.3;
        for (const enemy of this.enemies) {
          if (!enemy.dead && distance(field.x, field.y, enemy.x, enemy.y) < 150 + enemy.radius) {
            this.damageEnemy(enemy, this.player.stats.damage * 0.45, 'player');
          }
        }
      }
      if (Math.random() < 0.5) {
        const angle = Math.random() * TAU;
        this.particles.push({ x: field.x + Math.cos(angle) * 145, y: field.y + Math.sin(angle) * 145, vx: -Math.cos(angle) * 170, vy: -Math.sin(angle) * 170, life: 0.65, maxLife: 0.65, size: 3, color: '#a893ff', drag: 1 });
      }
    }
  }

  private updatePickups(dt: number) {
    const p = this.player;
    for (const pickup of this.pickups) {
      pickup.age += dt;
      const dx = p.x - pickup.x, dy = p.y - pickup.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const range = (pickup.kind === 'xp' && pickup.age > 15) || (pickup.kind === 'health' && pickup.age > 25)
        ? 2000
        : pickup.kind === 'health' ? p.stats.pickupRadius * 0.75 : p.stats.pickupRadius;
      if (dist < range) {
        const pull = 300 + (range - dist) * 6;
        pickup.vx = lerp(pickup.vx, dx / dist * pull, 1 - Math.exp(-dt * 8));
        pickup.vy = lerp(pickup.vy, dy / dist * pull, 1 - Math.exp(-dt * 8));
      } else { pickup.vx *= Math.pow(0.08, dt); pickup.vy *= Math.pow(0.08, dt); }
      pickup.x += pickup.vx * dt; pickup.y += pickup.vy * dt;
      if (dist < p.radius + 15) {
        if (pickup.kind === 'xp') {
          p.xp += pickup.value * p.stats.xpGain;
          p.sync = Math.min(100, p.sync + 0.5 * p.stats.syncGain * (this.anomaly?.sync ?? 1));
          this.score += pickup.value * 2;
        } else {
          const healing = p.stats.maxHp * pickup.value;
          p.hp = Math.min(p.stats.maxHp, p.hp + healing);
          this.text(p.x, p.y - 30, `+${Math.round(healing)} HP`, '#7dffb2', 16);
        }
        pickup.value = 0;
        this.sound.play('pickup');
      }
    }
  }

  private updateRailDamage(dt: number) {
    for (const beam of this.beams) {
      if (beam.kind !== 'rail' || beam.tickDamage === undefined || beam.life <= 0) continue;
      const [start, end] = beam.points;
      if (!start || !end) continue;
      const interval = beam.tickInterval ?? 0.3;
      beam.tickTimer = (beam.tickTimer ?? interval) - Math.min(dt, beam.life);
      let hits = 0;
      while (beam.tickTimer <= 0) {
        beam.tickTimer += interval;
        // The beam carries a fixed tick budget, so one large update step can
        // never squeeze extra hits out of a beam that has already expired.
        if (beam.ticksLeft !== undefined) {
          if (beam.ticksLeft <= 0) break;
          beam.ticksLeft--;
        }
        for (const enemy of this.enemies) {
          const reach = (beam.halfWidth ?? 24) + enemy.radius;
          if (!enemy.dead && distanceToSegment(enemy.x, enemy.y, start.x, start.y, end.x, end.y) < reach) {
            // The sweep already erased normal enemies; the lingering beam keeps
            // pressuring bosses and anything that drifted into the lane.
            const damage = enemy.kind === 'boss' ? beam.tickDamage : Math.max(beam.tickDamage, enemy.hp * 1.02);
            this.damageEnemy(enemy, damage, 'player');
            hits++;
          }
        }
      }
      if (hits > 0) this.sound.play('arc', 0.3);
    }
  }

  private updateEffects(dt: number) {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= Math.pow(particle.drag, dt); particle.vy *= Math.pow(particle.drag, dt);
    }
    this.particles = this.particles.filter(particle => particle.life > 0);
    for (const beam of this.beams) beam.life -= dt;
    for (const wave of this.shockwaves) wave.life -= dt;
    for (const text of this.texts) { text.life -= dt; text.y -= dt * 28; }
  }

  // Picks the direction that covers the most hostiles: sweep the compass in
  // 16 lanes, score each lane by target count and proximity, then fire down the
  // best one. Clustered packs win because a narrow lane still covers all of
  // them, while single scattered enemies rarely justify the shot.
  private getRailAimAngle() {
    const p = this.player;
    // Bosses participate, but a single target scores far lower than a pack, so
    // a crowd wins while a lone boss still gets aimed at instead of firing blind.
    const candidates = this.enemies.filter(enemy => !enemy.dead);
    if (candidates.length === 0) return this.pointer.inside ? Math.atan2(this.pointer.y - p.y, this.pointer.x - p.x) : p.angle;
    const width = TAU / AIM_BUCKETS;
    // Score the same corridor the beam will actually sweep so the chosen lane
    // matches the targets that die, not just their compass bucket.
    const reaches = (angle: number, enemy: Enemy) => {
      const endX = p.x + Math.cos(angle) * RAIL_LENGTH;
      const endY = p.y + Math.sin(angle) * RAIL_LENGTH;
      return distanceToSegment(enemy.x, enemy.y, p.x, p.y, endX, endY) < RAIL_HALF_WIDTH + enemy.radius;
    };
    let bestAngle = p.angle;
    let bestScore = -Infinity;
    for (let bucket = 0; bucket < AIM_BUCKETS; bucket++) {
      const angle = bucket * width + width / 2;
      let score = 0;
      for (const enemy of candidates) {
        if (!angleInBucket(Math.atan2(enemy.y - p.y, enemy.x - p.x), bucket)) continue;
        if (!reaches(angle, enemy)) continue;
        // Close and heavy targets matter more, but never enough to outvote a
        // large pack sitting on one lane.
        score += 1 + Math.min(1, 420 / Math.max(60, distance(p.x, p.y, enemy.x, enemy.y))) + Math.min(1, enemy.hp / 900);
      }
      if (score > bestScore) { bestScore = score; bestAngle = angle; }
    }
    // All lanes empty (e.g. a lone boss behind us): fall back to the target.
    if (bestScore <= 0) {
      const nearest = candidates.reduce((best, enemy) => {
        const d = distance(p.x, p.y, enemy.x, enemy.y);
        return !best || d < best.d ? { enemy, d } : best;
      }, null as { enemy: Enemy; d: number } | null);
      if (nearest) return Math.atan2(nearest.enemy.y - p.y, nearest.enemy.x - p.x);
    }
    return bestAngle;
  }

  private useWeaponSkill() {
    const p = this.player;
    if (p.weaponCooldown > 0) return;
    if (this.core === 'tempest' && !this.enemies.some(enemy => !enemy.dead && distance(p.x, p.y, enemy.x, enemy.y) < 480)) {
      this.text(p.x, p.y - 34, 'NO TARGET', '#829a96', 13);
      return;
    }
    p.weaponCooldown = this.weaponSkillCooldown;
    this.tutorialWeaponUsed = true;

    if (this.core === 'wraith') {
      // Hold the previous lane for a moment so rapid presses keep the cannon
      // steady, then re-aim at the densest cluster once the lock expires.
      if (!this.railAim || this.elapsed - this.railAim.at > RAIL_LOCK_TIME) {
        this.railAim = { angle: this.getRailAimAngle(), at: this.elapsed };
      }
      const angle = this.railAim.angle;
      const endX = p.x + Math.cos(angle) * RAIL_LENGTH;
      const endY = p.y + Math.sin(angle) * RAIL_LENGTH;
      this.beams.push({
        points: [{ x: p.x, y: p.y }, { x: endX, y: endY }],
        life: 1, maxLife: 1, color: '#8dfff3', kind: 'rail', tickDamage: p.stats.damage * 0.75, tickTimer: 0.3, tickInterval: 0.3, ticksLeft: 3,
        halfWidth: RAIL_HALF_WIDTH,
      });
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (distanceToSegment(enemy.x, enemy.y, p.x, p.y, endX, endY) >= RAIL_HALF_WIDTH + enemy.radius) continue;
        // Bosses take the tuned single-target hit; every other hostile caught
        // in the lane is erased outright so one cast reads as a full sweep.
        const lethal = enemy.kind === 'boss'
          ? p.stats.damage * 6
          : Math.max(p.stats.damage * RAIL_NORMAL_DAMAGE, enemy.hp * 1.02);
        this.damageEnemy(enemy, lethal, 'player');
      }
      for (let i = 0; i < 28; i++) {
        const t = Math.random();
        this.particle(p.x + (endX - p.x) * t, p.y + (endY - p.y) * t, '#62f6e7', 1, 85, 0.35, 5);
      }
      this.sound.play('arc', 1.2);
      this.shake = Math.max(this.shake, 9);
    } else if (this.core === 'tempest') {
      const targets = this.enemies
        .filter(enemy => !enemy.dead && distance(p.x, p.y, enemy.x, enemy.y) < 480)
        .sort((a, b) => distance(p.x, p.y, a.x, a.y) - distance(p.x, p.y, b.x, b.y))
        .slice(0, 6 + p.stats.chain);
      let previous = { x: p.x, y: p.y };
      for (const target of targets) {
        this.beams.push({ points: [previous, { x: target.x, y: target.y }], life: 0.3, maxLife: 0.3, color: '#c0b2ff', kind: 'arc' });
        this.damageEnemy(target, p.stats.damage * 2.4, 'player');
        target.stun = Math.max(target.stun, target.kind === 'boss' ? 0.3 : 1.1);
        previous = { x: target.x, y: target.y };
      }
      this.shockwaves.push({ x: p.x, y: p.y, life: 0.4, maxLife: 0.4, radius: 480, color: '#aa96ff' });
      this.sound.play('arc', 1.25);
      this.flash = Math.max(this.flash, 0.22);
    } else {
      const radius = 310;
      this.shockwaves.push({ x: p.x, y: p.y, life: 0.48, maxLife: 0.48, radius, color: BASTION_COLOR });
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const d = distance(p.x, p.y, enemy.x, enemy.y);
        if (d < radius + enemy.radius) {
          this.damageEnemy(enemy, p.stats.damage * 3.4, 'player');
          const nx = (enemy.x - p.x) / Math.max(1, d), ny = (enemy.y - p.y) / Math.max(1, d);
          const force = enemy.kind === 'boss' ? 85 : 390;
          enemy.vx += nx * force; enemy.vy += ny * force;
        }
      }
      for (const projectile of this.projectiles) {
        if (!projectile.friendly && distance(p.x, p.y, projectile.x, projectile.y) < radius) projectile.life = 0;
      }
      for (let i = 0; i < 36; i++) this.particle(p.x, p.y, BASTION_COLOR, 1, 300, 0.55, 7);
      this.sound.play('nova', 1.3);
      this.shake = Math.max(this.shake, 12);
    }
  }

  private fireWeapon(x: number, y: number, angle: number, source: 'player' | 'echo', multiplier: number, record: boolean) {
    const p = this.player;
    const damage = p.stats.damage * multiplier * (source === 'echo' ? p.stats.echoDamage : 1);
    if (this.core === 'tempest') {
      this.fireArc(x, y, angle, source, damage);
      if (record) this.pendingShots.push({ angle, kind: 'arc' });
      this.sound.play('arc', 0.7);
    } else {
      const isNova = this.core === 'bastion';
      const count = isNova ? 6 + (p.stats.projectiles - 1) * 2 : p.stats.projectiles;
      for (let i = 0; i < count; i++) {
        // The aimed heavy shot occupies the forward lane. Offset the nova
        // ring so it does not always stack with an aligned opening nova.
        const shotAngle = isNova ? angle + (i + 0.5) * TAU / count : angle + (i - (count - 1) / 2) * 0.12;
        this.spawnFriendlyShot(x, y, shotAngle, damage, source, isNova ? 'nova' : 'bullet');
        if (record) this.pendingShots.push({ angle: shotAngle, kind: isNova ? 'nova' : 'bullet' });
      }
      if (isNova) {
        const power = 1.75;
        this.spawnFriendlyShot(x, y, angle, damage * power, source, 'bullet');
        if (record) this.pendingShots.push({ angle, kind: 'bullet', power });
      }
      this.sound.play(isNova ? 'nova' : 'shot', 0.65);
    }
    if (source === 'player') {
      this.shotCounter++;
      if ((this.stacks.singularity ?? 0) > 0 && this.shotCounter % 6 === 0) {
        const target = this.nearestEnemy(x, y, 700);
        const fx = target?.x ?? x + Math.cos(angle) * 240;
        const fy = target?.y ?? y + Math.sin(angle) * 240;
        this.fields.push({ x: fx, y: fy, life: 3.2, maxLife: 3.2, tick: 0 });
        this.shake = Math.max(this.shake, 4);
      }
    }
  }

  private fireRecordedShot(echo: Echo, shot: ShotRecord, recordedAim = shot.angle) {
    const damage = this.player.stats.damage * this.player.stats.echoDamage * (shot.power ?? 1);
    let angle = shot.angle;
    const target = this.nearestEnemy(echo.x, echo.y, this.core === 'tempest' ? 610 : 850);
    if (target) {
      const targetAngle = Math.atan2(target.y - echo.y, target.x - echo.x);
      // Rotate the complete recorded volley around its old aim. Relative
      // spread and nova spacing survive, while its center tracks a live enemy.
      angle += angleDelta(recordedAim, targetAngle);
      echo.angle = targetAngle;
    }
    if (shot.kind === 'arc') this.fireArc(echo.x, echo.y, angle, 'echo', damage);
    else this.spawnFriendlyShot(echo.x, echo.y, angle, damage, 'echo', shot.kind);
  }

  private spawnFriendlyShot(x: number, y: number, angle: number, damage: number, source: 'player' | 'echo', kind: 'bullet' | 'nova') {
    if (this.projectiles.length > 450) return;
    const p = this.player;
    const speed = p.stats.projectileSpeed * (kind === 'nova' ? 0.76 : 1);
    const life = (kind === 'nova' ? 0.82 : 1.2) * Math.pow(p.stats.projectileSpeed / 610, 0.55);
    const color = source === 'echo' ? ECHO_COLOR : this.core === 'bastion' ? BASTION_COLOR : '#62f6e7';
    this.projectiles.push({
      id: this.nextId++, x: x + Math.cos(angle) * 23, y: y + Math.sin(angle) * 23,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: kind === 'nova' ? 5 : 4,
      damage: damage * (kind === 'bullet' ? 1 + p.stats.pierce * 0.18 : 1), life, friendly: true, color, pierce: p.stats.pierce, source,
      hit: new Set(), kind,
    });
  }

  private fireArc(x: number, y: number, angle: number, source: 'player' | 'echo', damage: number) {
    let target: Enemy | undefined;
    let bestAim = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const d = distance(x, y, enemy.x, enemy.y);
      if (d > 610) continue;
      const offset = Math.abs(Math.atan2(Math.sin(Math.atan2(enemy.y - y, enemy.x - x) - angle), Math.cos(Math.atan2(enemy.y - y, enemy.x - x) - angle)));
      if (offset < 0.7 && offset * 400 + d * 0.25 < bestAim) { bestAim = offset * 400 + d * 0.25; target = enemy; }
    }
    target ??= this.nearestEnemy(x, y, 610);
    if (!target) return;
    const primary = target;
    const hit = new Set<number>();
    const points = [{ x, y }];
    const chains = Math.max(1, this.player.stats.chain + this.player.stats.projectiles - (this.core === 'tempest' ? 0 : 1));
    for (let i = 0; i < chains && target; i++) {
      hit.add(target.id);
      points.push({ x: target.x, y: target.y });
      this.damageEnemy(target, damage * Math.pow(0.88, i), source);
      const current = target;
      let next: Enemy | undefined;
      let best = 205;
      for (const enemy of this.enemies) {
        if (enemy.dead || hit.has(enemy.id)) continue;
        const d = distance(current.x, current.y, enemy.x, enemy.y);
        if (d < best) { best = d; next = enemy; }
      }
      target = next;
    }
    if (points.length === 2 && chains > 1 && !primary.dead) {
      this.damageEnemy(primary, damage * (chains - 1) * 0.22, source);
    }
    this.beams.push({ points, life: 0.16, maxLife: 0.16, color: source === 'echo' ? ECHO_COLOR : '#aa96ff' });
  }

  private enemyShot(x: number, y: number, angle: number, speed: number, damage: number, radius: number, color = '#ff6078') {
    if (this.projectiles.length > 480) return;
    this.projectiles.push({
      id: this.nextId++, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      radius, damage, life: 5, friendly: false, color, pierce: 0,
      source: 'enemy', hit: new Set(), kind: 'enemy',
    });
  }

  private fireBossShot(enemy: Enemy, angle: number, speed: number, damageScale: number, radius = 6) {
    const definition = BOSS_DEFINITIONS[enemy.bossKind ?? 'warden'];
    this.enemyShot(enemy.x, enemy.y, angle, speed, enemy.damage * damageScale, radius, definition.color);
  }

  private damageEnemy(enemy: Enemy, baseDamage: number, source: 'player' | 'echo') {
    if (enemy.dead) return;
    const crit = this.random.next() < this.player.stats.critChance;
    const damage = baseDamage * (crit ? this.player.stats.critDamage : 1);
    enemy.hp -= damage;
    enemy.flash = 1;
    if (crit || damage > 45) this.text(enemy.x, enemy.y - enemy.radius, `${Math.round(damage)}`, crit ? '#ffdf8a' : '#d9fffa', crit ? 21 : 15);
    this.sound.play('hit', 0.45);

    const now = this.elapsed;
    if (enemy.lastHitBy && enemy.lastHitBy !== source && now - enemy.lastHitAt < 0.58 && enemy.syncCooldown <= 0) {
      const syncDamage = this.player.stats.damage * (1 + this.level * 0.1) * this.player.stats.syncDamage;
      enemy.hp -= syncDamage;
      enemy.syncCooldown = 0.42;
      this.player.sync = Math.min(100, this.player.sync + 10 * this.player.stats.syncGain * (this.anomaly?.sync ?? 1));
      this.combo++;
      this.comboTimer = 2.4;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += 25 * this.combo;
      this.beams.push({ points: [{ x: this.player.x, y: this.player.y }, { x: enemy.x, y: enemy.y }], life: 0.1, maxLife: 0.1, color: '#ffffff' });
      for (let i = 0; i < 8; i++) this.particle(enemy.x, enemy.y, '#b8fff7', 1, 170, 0.35, 5);
      if (this.combo > 1 && this.combo % 10 === 0) this.text(enemy.x, enemy.y - 45, `${this.combo} RESONANCE`, '#62f6e7', 20);
    }
    enemy.lastHitBy = source;
    enemy.lastHitAt = now;
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  private killEnemy(enemy: Enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    this.kills++;
    this.score += (enemy.maxHp * 2 + enemy.xp * 12) * (this.difficulty === 'abyss' ? 1.5 : 1) * (this.anomaly?.score ?? 1);
    const pieces = enemy.kind === 'boss' ? 55 : enemy.elite ? 18 : 7;
    const color = enemy.kind === 'boss' ? BOSS_DEFINITIONS[enemy.bossKind ?? 'warden'].color : enemy.elite ? '#ffcf70' : '#62f6e7';
    for (let i = 0; i < pieces; i++) this.particle(enemy.x, enemy.y, color, 1, enemy.kind === 'boss' ? 310 : 180, 0.3 + Math.random() * 0.5, 3 + Math.random() * 5);
    this.sound.play('explode', enemy.kind === 'boss' ? 1.3 : 0.45);
    if (enemy.kind === 'boss') {
      this.bossId = null;
      if (this.challenge) {
        this.bossDefeated = true;
        this.cleanupStarted = true;
        this.player.sync = 100;
        this.shake = 24;
        this.flash = 0.7;
        this.rift = null;
        this.toast(
          `${BOSS_DEFINITIONS[enemy.bossKind ?? 'warden'].name} ERASED // CLEANUP`,
          '残敵を掃討せよ',
          this.challenge ? '出現を停止。全ての敵を倒すまでレベルは継続' : '出現を停止。全ての敵を倒すとタイムライン完了',
          'gold',
        );
        return;
      }
      this.pendingBossDraft = true;
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + this.player.stats.maxHp * 0.25);
      this.player.sync = 100;
      this.rerolls++;
      this.sectorTime = SECTOR_DURATION - 6;
      this.shake = 24;
      this.flash = 0.7;
      for (let i = 0; i < 12; i++) this.pickups.push({ x: enemy.x + this.random.range(-90, 90), y: enemy.y + this.random.range(-90, 90), vx: 0, vy: 0, value: 12 * this.combatXpScale, kind: 'xp', age: 0 });
      return;
    }
    if (enemy.kind === 'splitter') {
      for (let i = 0; i < 2; i++) this.spawnEnemy('mite', enemy.x + (i ? 20 : -20), enemy.y + this.random.range(-15, 15));
    }
    this.pickups.push({ x: enemy.x, y: enemy.y, vx: this.random.range(-45, 45), vy: this.random.range(-45, 45), value: enemy.xp, kind: 'xp', age: 0 });
    if (this.random.next() < (this.player.hp < this.player.stats.maxHp * 0.45 ? 0.055 : 0.018)) {
      this.pickups.push({ x: enemy.x + 12, y: enemy.y, vx: 0, vy: 0, value: 0.18, kind: 'health', age: 0 });
    }
    if (this.random.next() < this.player.stats.lifeSteal) this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + this.player.stats.maxHp * 0.025);
  }

  private hurtPlayer(rawDamage: number) {
    const p = this.player;
    if (p.invulnerable > 0) return;
    if (p.shieldReady) {
      p.shieldReady = false;
      p.invulnerable = 0.55;
      this.sound.play('echo', 0.5);
      this.text(p.x, p.y - 35, 'AEGIS', '#9c8cff', 18);
      for (let i = 0; i < 14; i++) this.particle(p.x, p.y, '#9c8cff', 1, 180, 0.4, 4);
      return;
    }
    const damage = Math.max(1, Math.round(rawDamage * (1 - clamp(p.stats.armor, 0, 0.75))));
    p.hp -= damage;
    p.invulnerable = 0.72;
    this.combo = 0;
    this.shake = Math.max(this.shake, 11);
    this.flash = Math.max(this.flash, 0.32);
    this.sound.play('hurt');
    this.text(p.x, p.y - 30, `-${damage}`, '#ff6078', 22);
    if (p.hp <= 0) {
      if ((this.stacks.revive ?? 0) > 0) {
        delete this.stacks.revive;
        p.hp = p.stats.maxHp;
        p.invulnerable = 2.5;
        this.projectiles = this.projectiles.filter(projectile => projectile.friendly);
        this.toast('DEATH, CANCELLED', '時間を巻き戻しました', '復活効果は消費されました', 'gold');
        this.flash = 1;
      } else this.gameOver();
    }
  }

  private dash() {
    const p = this.player;
    if (p.dashCooldown > 0 || p.dashTimer > 0) return;
    let dx = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.touchMove.x;
    let dy = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) + this.touchMove.y;
    if (Math.hypot(dx, dy) < 0.1) { dx = Math.cos(p.angle); dy = Math.sin(p.angle); }
    const length = Math.max(1, Math.hypot(dx, dy));
    p.vx = dx / length * 890; p.vy = dy / length * 890;
    p.dashTimer = 0.19; p.dashCooldown = p.stats.dashCooldown; p.invulnerable = 0.32;
    this.tutorialDashed = true;
    this.dashHit.clear();
    this.sound.play('dash');
    for (let i = 0; i < 14; i++) this.particle(p.x, p.y, '#62f6e7', 1, 210, 0.38, 5);
    if ((this.stacks.dash_echo ?? 0) > 0) this.createEcho(2.6, true, true);
  }

  private createEcho(duration = this.player.stats.echoDuration, dash = false, free = false) {
    const p = this.player;
    if (!free && p.echoCooldown > 0) return;
    if (!free) p.echoCooldown = p.stats.echoCooldown;
    let frames = this.history.filter(frame => frame.time >= this.elapsed - duration).map(frame => ({ ...frame, shots: [...frame.shots] }));
    if (frames.length < 2) frames = [{ time: this.elapsed - 0.1, x: p.x, y: p.y, angle: p.angle, shots: [] }, { time: this.elapsed, x: p.x, y: p.y, angle: p.angle, shots: [] }];
    const startTime = frames[0].time;
    if (this.echoes.length >= p.stats.maxEchoes) this.expireEcho(0);
    this.echoes.push({
      id: this.nextId++, x: frames[0].x, y: frames[0].y, angle: frames[0].angle,
      frames, startTime, age: 0, index: 0, life: frames[frames.length - 1].time - startTime + 0.3,
      alpha: 0, dash,
    });
    this.echoesCreated++;
    this.sound.play('echo');
    this.shake = Math.max(this.shake, 4);
    for (let i = 0; i < 22; i++) this.particle(frames[0].x, frames[0].y, ECHO_COLOR, 1, 160, 0.55, 5);
    if (!dash && this.echoesCreated === 1) this.toast('ECHO SYNCHRONIZED', '過去の自分が参戦', '同じ敵を挟み撃ちにして共鳴せよ', 'cyan');
  }

  private expireEcho(index: number) {
    const echo = this.echoes[index];
    if (!echo) return;
    const afterimage = this.stacks.afterimage ?? 0;
    if (afterimage > 0) {
      const radius = 135 + afterimage * 25;
      for (const enemy of this.enemies) {
        if (!enemy.dead && distance(echo.x, echo.y, enemy.x, enemy.y) < radius + enemy.radius) {
          this.damageEnemy(enemy, this.player.stats.damage * (1.8 + afterimage * 0.9) * this.player.stats.echoDamage, 'echo');
        }
      }
      for (let i = 0; i < 30; i++) this.particle(echo.x, echo.y, ECHO_COLOR, 1, 260, 0.65, 6);
      this.shake = Math.max(this.shake, 8);
    }
    this.echoes.splice(index, 1);
  }

  private activateOverdrive() {
    const p = this.player;
    if (p.sync < 100 || p.overdrive > 0) return;
    p.sync = 0;
    p.overdrive = p.stats.overdriveDuration;
    p.echoCooldown = 0;
    p.dashCooldown = 0;
    p.weaponCooldown = 0;
    this.slowMotion = p.overdrive;
    this.flash = 0.65;
    this.shake = 12;
    this.sound.play('zero');
    this.toast('ZERO FIELD', '時間を、止めろ。', `攻撃速度上昇 / ${p.stats.overdriveDuration.toFixed(1)}秒`, 'gold');
    for (let i = 0; i < 50; i++) this.particle(p.x, p.y, i % 2 ? '#62f6e7' : '#ffffff', 1, 330, 0.8, 6);
  }

  private nearestEnemy(x: number, y: number, range: number) {
    let target: Enemy | undefined;
    let best = range;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const rawDistance = distance(x, y, enemy.x, enemy.y) - enemy.radius;
      const d = rawDistance * (enemy.kind === 'boss' ? 0.45 : 1);
      if (d < best) { best = d; target = enemy; }
    }
    return target;
  }

  private availableUpgrades() {
    return UPGRADES.filter(upgrade =>
      (this.stacks[upgrade.id] ?? 0) < upgrade.maxStacks &&
      (!upgrade.cores || upgrade.cores.includes(this.core))
    );
  }

  private hasAvailableUpgrades() { return this.availableUpgrades().length > 0; }

  private checkLevelUp() {
    if (this.status !== 'running' || this.pendingBossDraft) return;
    const p = this.player;
    if (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      this.level++;
      p.level = this.level;
      p.xpNext = getRunXpRequirement(this.level);
      if (this.hasAvailableUpgrades()) this.openDraft('level');
      else if (!this.challenge) this.openBuildCheckpoint();
    }
  }

  private openBuildCheckpoint() {
    if (this.status !== 'running' || this.challenge || this.buildCheckpointShown) return;
    this.buildCheckpointShown = true;
    this.pendingBossDraft = false;
    this.checkpointScore = Math.floor(this.score);
    this.checkpointNewBest = this.recordInfiniteRecords();
    this.checkpointKind = 'build';
    this.setStatus('checkpoint');
    this.sound.play('level');
    this.emitHud();
  }

  private openDraft(reason: 'level' | 'boss') {
    if (this.status !== 'running') return;
    if (!this.hasAvailableUpgrades()) {
      this.pendingBossDraft = false;
      if (!this.challenge) this.openBuildCheckpoint();
      return;
    }
    this.pendingBossDraft = reason === 'boss';
    this.setStatus('draft');
    this.sound.play('level');
    this.callbacks.onDraft(this.makeDraft(reason));
  }

  private makeDraft(reason: 'level' | 'boss'): DraftState {
    const available = this.availableUpgrades();
    const choices: UpgradeDefinition[] = [];
    const pool = [...available];
    while (choices.length < 3 && pool.length) {
      const luck = this.player.stats.luck;
      const roll = this.random.next();
      let rarity: 'common' | 'rare' | 'epic';
      if (reason === 'boss') rarity = roll < 0.24 + luck ? 'epic' : roll < 0.82 ? 'rare' : 'common';
      else rarity = roll < 0.055 + luck * 0.45 ? 'epic' : roll < 0.31 + luck ? 'rare' : 'common';
      let candidates = pool.filter(upgrade => upgrade.rarity === rarity);
      if (!candidates.length) candidates = pool;
      const choice = this.random.pick(candidates);
      choices.push(choice);
      pool.splice(pool.indexOf(choice), 1);
    }
    return { choices, stacks: { ...this.stacks }, rerolls: this.rerolls, reason };
  }

  private recordInfiniteRecords() {
    if (this.challenge) return false;
    const bestKey = `echo-abyss-best-${this.difficulty}`;
    const finalScore = Math.floor(this.score);
    const previousBest = Number(localStorage.getItem(bestKey) ?? 0);
    const newBest = finalScore > previousBest;
    if (newBest) localStorage.setItem(bestKey, String(finalScore));
    const bestSector = Number(localStorage.getItem('echo-abyss-best-sector') ?? 0);
    if (this.sector > bestSector) localStorage.setItem('echo-abyss-best-sector', String(this.sector));
    return newBest;
  }

  private gameOver(victory = false) {
    if (this.status === 'gameover') return;
    if (victory && this.challenge) this.score += 2500 * this.challenge.id + Math.max(0, this.player.hp) * 10;
    else if (!victory) this.player.hp = 0;
    this.setStatus('gameover');
    this.sound.play(victory ? 'level' : 'gameover');
    this.shake = victory ? 12 : 25;
    if (victory) this.flash = 0.8;
    const finalScore = Math.floor(this.score);
    let newBest = false;
    if (this.challenge) {
      const bestKey = `echo-abyss-best-level-${this.challenge.id}`;
      const previousBest = Number(localStorage.getItem(bestKey) ?? 0);
      newBest = finalScore > previousBest;
      if (newBest) localStorage.setItem(bestKey, String(finalScore));
    } else {
      newBest = this.recordInfiniteRecords() || (this.checkpointNewBest && this.checkpointScore === finalScore);
    }
    let xpEarned = 0;
    let firstClear = false;
    let totalXp = readCampaignXp();
    if (this.challenge && victory) {
      const reward = awardStageClear(this.challenge.id);
      xpEarned = reward.xpEarned;
      totalXp = reward.totalXp;
      firstClear = reward.firstClear;
      const unlocked = Number(localStorage.getItem('echo-abyss-unlocked-level') ?? 1);
      const next = Math.min(LEVELS.length, this.challenge.id + 1);
      if (next > unlocked) localStorage.setItem('echo-abyss-unlocked-level', String(next));
    }
    if (!this.runCounted) {
      const runs = Number(localStorage.getItem('echo-abyss-runs') ?? 0);
      localStorage.setItem('echo-abyss-runs', String(runs + 1));
      this.runCounted = true;
    }
    this.callbacks.onGameOver({
      score: finalScore, sector: this.sector, elapsed: this.elapsed, kills: this.kills,
      level: this.level, echoes: this.echoesCreated, bestCombo: this.bestCombo,
      core: this.core, seed: this.seed, difficulty: this.difficulty,
      gameMode: this.gameMode, challengeLevel: this.challenge?.id ?? 0, victory, newBest,
      xpEarned, totalXp, firstClear,
      reviveAvailable: !victory && !this.challenge && !this.reviveUsed,
    });
  }

  private emitHud() {
    if (!this.player) return;
    const p = this.player;
    const boss = this.enemies.find(enemy => enemy.id === this.bossId && !enemy.dead);
    const skill = WEAPON_SKILLS[this.core];
    const rift = this.rift;
    this.callbacks.onHud({
      hp: Math.max(0, p.hp), maxHp: p.stats.maxHp, shield: p.shieldReady,
      level: p.level, xp: p.xp, xpNext: p.xpNext, score: Math.floor(this.score),
      sector: this.sector, sectorProgress: boss || this.cleanupStarted ? 1 : this.sectorTime / (this.challenge?.combatDuration ?? SECTOR_DURATION),
      anomaly: this.anomaly ? { name: this.anomaly.name, description: this.anomaly.description } : null,
      elapsed: this.elapsed, kills: this.kills,
      echoCooldown: p.echoCooldown, echoMaxCooldown: p.stats.echoCooldown,
      activeEchoes: this.echoes.length, maxEchoes: p.stats.maxEchoes,
      dashCooldown: p.dashCooldown, dashMaxCooldown: p.stats.dashCooldown,
      sync: p.sync, overdrive: p.overdrive, combo: this.combo,
      boss: boss ? {
        name: `${BOSS_DEFINITIONS[boss.bossKind ?? 'warden'].name} ${String(this.bossTier).padStart(2, '0')}`,
        hp: Math.max(0, boss.hp), maxHp: boss.maxHp, phase: boss.phase,
        color: BOSS_DEFINITIONS[boss.bossKind ?? 'warden'].color,
      } : null,
      core: this.core, weapon: CORES.find(core => core.id === this.core)!.weapon,
      weaponDetail: this.core === 'wraith'
        ? `${p.stats.projectiles}弾・オート連射`
        : this.core === 'tempest'
          ? `${Math.max(1, p.stats.chain + p.stats.projectiles)}体へ連鎖する雷撃`
          : `全方位${6 + (p.stats.projectiles - 1) * 2}弾 + 照準重弾`,
      weaponSkillName: skill.name, weaponSkillDescription: skill.description,
      weaponCooldown: p.weaponCooldown, weaponMaxCooldown: this.weaponSkillCooldown,
      tutorialStep: this.tutorialEnabled ? this.tutorialStep : 5,
      rift: rift ? {
        distance: distance(p.x, p.y, rift.x, rift.y), angle: Math.atan2(rift.y - p.y, rift.x - p.x),
        progress: rift.progress / rift.duration, duration: rift.duration, life: rift.life,
        inside: distance(p.x, p.y, rift.x, rift.y) < rift.radius,
      } : null,
      seed: this.seed, difficulty: this.difficulty,
      gameMode: this.gameMode, challengeLevel: this.challenge?.id ?? 0,
      challengeName: this.challenge?.name ?? '', challengeDuration: this.challenge?.combatDuration ?? 0,
      challengeHasBoss: this.challenge?.hasBoss ?? false,
      challengeCleanup: this.cleanupStarted,
      checkpointKind: this.checkpointKind,
      remainingEnemies: this.enemies.filter(enemy => !enemy.dead).length,
      initialBonusRanks: this.initialBonusRanks,
    });
  }

  private toast(eyebrow: string, title: string, detail?: string, tone: 'cyan' | 'coral' | 'gold' = 'cyan') {
    this.callbacks.onToast({ id: Date.now() + Math.random(), eyebrow, title, detail, tone });
  }

  private particle(x: number, y: number, color: string, count: number, speed: number, life: number, size: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * TAU;
      const velocity = speed * (0.25 + Math.random() * 0.75);
      this.particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life, maxLife: life, size: size * (0.45 + Math.random() * 0.55), color, drag: 0.08, shape: Math.random() < 0.5 ? 'line' : 'square' });
    }
  }

  private text(x: number, y: number, text: string, color: string, size: number) {
    if (this.texts.length > 55) this.texts.shift();
    this.texts.push({ x, y, text, color, life: 0.65, size });
  }

  private render(time: number) {
    const ctx = this.ctx;
    const { width, height, dpr, scale, y } = this.view;
    const x = this.cameraX();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#030509';
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * x, dpr * y);
    ctx.save();
    if (this.shake > 0 && this.status === 'running') ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    this.drawBackground(ctx, time);
    if (this.player) {
      this.drawRift(ctx, time);
      this.drawFields(ctx, time);
      this.drawShockwaves(ctx);
      this.drawPickups(ctx, time);
      this.drawBeams(ctx);
      this.drawProjectiles(ctx);
      this.drawEnemies(ctx, time);
      this.drawEchoes(ctx, time);
      this.drawPlayer(ctx, time);
      this.drawParticles(ctx);
      this.drawTexts(ctx);
      this.drawCursor(ctx, time);
    }
    ctx.restore();
    if (this.flash > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(190,255,248,${this.flash * 0.13})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, time: number) {
    const gradient = ctx.createRadialGradient(W * 0.5, H * 0.45, 30, W * 0.5, H * 0.45, 850);
    gradient.addColorStop(0, this.player?.overdrive > 0 ? '#102b31' : '#0b1620');
    gradient.addColorStop(0.55, '#070c14');
    gradient.addColorStop(1, '#030509');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(92, 211, 207, 0.045)';
    ctx.lineWidth = 1;
    const grid = 64;
    const offset = (time * 7) % grid;
    ctx.beginPath();
    for (let x = -grid + offset; x < W + grid; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = -grid + offset; y < H + grid; y += grid) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    for (const star of this.stars) {
      const alpha = 0.15 + Math.sin(time * 0.8 + star.phase) * 0.1;
      ctx.fillStyle = `rgba(161,225,225,${alpha})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }

    ctx.strokeStyle = 'rgba(98,246,231,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(28.5, 28.5, W - 57, H - 57);
    ctx.strokeStyle = 'rgba(98,246,231,0.45)';
    ctx.lineWidth = 2;
    const corners = [[28, 28, 1, 1], [W - 28, 28, -1, 1], [W - 28, H - 28, -1, -1], [28, H - 28, 1, -1]];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath(); ctx.moveTo(cx, cy + sy * 36); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * 36, cy); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(98,246,231,0.28)';
    ctx.font = '12px monospace';
    ctx.fillText(`T+${this.elapsed.toFixed(2)} // ${this.seed}`, 48, H - 46);
    ctx.textAlign = 'right';
    ctx.fillText('OBSIDIAN RESEARCH // TEMPORAL COMBAT SIMULATION', W - 48, H - 46);
    ctx.textAlign = 'left';
  }

  private drawRift(ctx: CanvasRenderingContext2D, time: number) {
    const rift = this.rift;
    if (!rift) return;
    const inside = distance(this.player.x, this.player.y, rift.x, rift.y) < rift.radius;
    const ratio = rift.progress / rift.duration;
    const alpha = Math.min(1, rift.life * 1.5);
    ctx.save(); ctx.globalAlpha = alpha;
    const gradient = ctx.createRadialGradient(rift.x, rift.y, 8, rift.x, rift.y, rift.radius * 1.5);
    gradient.addColorStop(0, inside ? 'rgba(98,246,231,.16)' : 'rgba(255,207,112,.09)');
    gradient.addColorStop(1, 'rgba(98,246,231,0)');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(rift.x, rift.y, rift.radius * 1.5, 0, TAU); ctx.fill();
    const color = inside ? '#62f6e7' : '#ffcf70';
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.arc(rift.x, rift.y, rift.radius + Math.sin(time * 3) * 3, time * 0.35, time * 0.35 + TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(rift.x, rift.y, rift.radius - 7, -Math.PI / 2, -Math.PI / 2 + TAU * ratio); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.save(); ctx.translate(rift.x, rift.y); ctx.rotate(Math.PI / 4 + time * 0.35);
    ctx.strokeRect(-12, -12, 24, 24); ctx.restore();
    ctx.textAlign = 'center'; ctx.fillStyle = color;
    ctx.font = "600 9px 'Space Grotesk', sans-serif"; ctx.fillText('SYNC RIFT', rift.x, rift.y - rift.radius - 18);
    ctx.font = "500 10px 'Noto Sans JP Variable', sans-serif";
    ctx.fillText(inside ? `安定化 ${Math.floor(ratio * 100)}%` : '進行保持・再入場で再開', rift.x, rift.y + rift.radius + 23);
    ctx.textAlign = 'left'; ctx.restore();
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const wave of this.shockwaves) {
      const progress = 1 - wave.life / wave.maxLife;
      const radius = wave.radius * (1 - Math.pow(1 - progress, 3));
      ctx.globalAlpha = Math.max(0, wave.life / wave.maxLife);
      ctx.strokeStyle = wave.color; ctx.lineWidth = 5 * (1 - progress) + 1;
      ctx.beginPath(); ctx.arc(wave.x, wave.y, radius, 0, TAU); ctx.stroke();
      ctx.globalAlpha *= 0.35; ctx.lineWidth = 14 * (1 - progress) + 1;
      ctx.beginPath(); ctx.arc(wave.x, wave.y, Math.max(0, radius - 12), 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  private drawFields(ctx: CanvasRenderingContext2D, time: number) {
    for (const field of this.fields) {
      const alpha = Math.min(1, field.life * 2);
      const gradient = ctx.createRadialGradient(field.x, field.y, 4, field.x, field.y, 175);
      gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
      gradient.addColorStop(0.35, `rgba(89,55,140,${alpha * 0.4})`);
      gradient.addColorStop(1, 'rgba(80,50,130,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(field.x, field.y, 175, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(174,145,255,${alpha * 0.65})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 20]);
      ctx.beginPath(); ctx.arc(field.x, field.y, 115 + Math.sin(time * 4) * 8, time, time + Math.PI * 1.6); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawPickups(ctx: CanvasRenderingContext2D, time: number) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const pickup of this.pickups) {
      const color = pickup.kind === 'health' ? '#7dffb2' : pickup.value >= 20 ? '#ffcf70' : '#62f6e7';
      const pulse = 1 + Math.sin(time * 5 + pickup.x) * 0.12;
      ctx.save(); ctx.translate(pickup.x, pickup.y); ctx.rotate(time * 1.4 + pickup.age);
      ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 13;
      const size = (pickup.kind === 'health' ? 8 : pickup.value >= 20 ? 8 : 5) * pulse;
      if (pickup.kind === 'health') {
        ctx.fillRect(-3, -10, 6, 20); ctx.fillRect(-10, -3, 20, 6);
      } else {
        ctx.beginPath(); ctx.moveTo(0, -size * 1.5); ctx.lineTo(size, 0); ctx.lineTo(0, size * 1.5); ctx.lineTo(-size, 0); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawBeams(ctx: CanvasRenderingContext2D) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const beam of this.beams) {
      const alpha = beam.life / beam.maxLife;
      if (beam.kind === 'rail') {
        const [start, end] = beam.points;
        if (start && end) {
          ctx.globalAlpha = alpha * 0.22; ctx.strokeStyle = beam.color; ctx.shadowColor = beam.color; ctx.shadowBlur = 34;
          ctx.lineCap = 'round'; ctx.lineWidth = (beam.halfWidth ?? 24) * 1.45 * (0.5 + alpha * 0.5);
          ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
          ctx.globalAlpha = alpha; ctx.shadowBlur = 28; ctx.lineWidth = 18 * alpha + 2;
          ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineCap = 'butt';
        }
        continue;
      }
      ctx.strokeStyle = beam.color; ctx.globalAlpha = alpha;
      ctx.shadowColor = beam.color; ctx.shadowBlur = 18; ctx.lineWidth = 3;
      ctx.beginPath();
      beam.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else {
          const previous = beam.points[index - 1];
          const mx = (previous.x + point.x) / 2 + Math.sin(index * 9 + beam.life * 80) * 12;
          const my = (previous.y + point.y) / 2 + Math.cos(index * 7 + beam.life * 80) * 12;
          ctx.lineTo(mx, my); ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }
    ctx.restore();
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const projectile of this.projectiles) {
      if (projectile.life <= 0) continue;
      ctx.save(); ctx.translate(projectile.x, projectile.y);
      ctx.fillStyle = projectile.color; ctx.shadowColor = projectile.color; ctx.shadowBlur = projectile.friendly ? 14 : 20;
      if (projectile.friendly) {
        ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
        ctx.fillRect(-projectile.radius * 2.8, -projectile.radius * 0.55, projectile.radius * 4.5, projectile.radius * 1.1);
      } else {
        ctx.beginPath(); ctx.arc(0, 0, projectile.radius, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,180,190,.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, projectile.radius + 4, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, time: number) {
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (enemy.kind === 'sniper' && enemy.telegraph > 0) {
        const charge = 1 - enemy.telegraph / 0.85;
        ctx.strokeStyle = `rgba(255,56,79,${0.25 + charge * 0.75})`;
        ctx.lineWidth = 1 + charge * 2.5;
        ctx.setLineDash([12 - charge * 7, 10 - charge * 5]);
        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y);
        ctx.lineTo(enemy.x + Math.cos(enemy.lockedAngle) * 1800, enemy.y + Math.sin(enemy.lockedAngle) * 1800);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (enemy.kind === 'boss' && enemy.bossKind === 'lancer' && enemy.telegraph > 0) {
        const definition = BOSS_DEFINITIONS.lancer;
        ctx.save();
        ctx.strokeStyle = definition.color;
        ctx.globalAlpha = 0.35 + Math.sin(time * 24) * 0.15;
        ctx.lineWidth = enemy.pattern % 2 === 0 ? 18 : 4;
        ctx.setLineDash([20, 12]);
        ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y);
        ctx.lineTo(enemy.x + Math.cos(enemy.lockedAngle) * 1800, enemy.y + Math.sin(enemy.lockedAngle) * 1800); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 14, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      if (enemy.kind === 'boss' && enemy.bossKind === 'colossus' && enemy.telegraph > 0) {
        const charge = clamp(1 - enemy.telegraph / 1.05, 0, 1);
        const definition = BOSS_DEFINITIONS.colossus;
        ctx.save();
        ctx.fillStyle = definition.color; ctx.globalAlpha = 0.035 + charge * 0.055;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 280, 0, TAU); ctx.fill();
        ctx.strokeStyle = definition.color; ctx.globalAlpha = 0.35 + charge * 0.6;
        ctx.lineWidth = 2 + charge * 3; ctx.setLineDash([16, 10]);
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 280 + (1 - charge) * 90, 0, TAU); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
      }
      ctx.save(); ctx.translate(enemy.x, enemy.y); ctx.rotate(enemy.angle);
      const color = enemy.flash > 0 ? '#ffffff' : enemy.kind === 'boss' ? BOSS_DEFINITIONS[enemy.bossKind ?? 'warden'].color : enemy.elite ? '#ffcf70' : ENEMY_COLORS[enemy.kind];
      ctx.strokeStyle = color; ctx.fillStyle = enemy.kind === 'boss' ? BOSS_DEFINITIONS[enemy.bossKind ?? 'warden'].fill : 'rgba(32,13,24,.9)';
      ctx.lineWidth = enemy.elite ? 2.5 : 1.6; ctx.shadowColor = color; ctx.shadowBlur = enemy.flash > 0 ? 24 : 8;
      const r = enemy.radius;
      if (enemy.kind === 'drone' || enemy.kind === 'dart' || enemy.kind === 'mite') {
        ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.75, r * 0.72); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.75, -r * 0.72); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = color; ctx.fillRect(r * 0.05, -2, r * 0.65, 4);
        if (enemy.kind === 'dart') {
          ctx.globalAlpha = 0.55;
          ctx.beginPath(); ctx.moveTo(-r * 0.65, r * 0.45); ctx.lineTo(-r * 1.8, r * 0.8); ctx.moveTo(-r * 0.65, -r * 0.45); ctx.lineTo(-r * 1.8, -r * 0.8); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (enemy.kind === 'gunner' || enemy.kind === 'sniper') {
        ctx.beginPath(); ctx.rect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44); ctx.fill(); ctx.stroke();
        ctx.rotate(Math.PI / 4); ctx.strokeRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1); ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = color;
        const barrel = enemy.kind === 'sniper' ? r * 2.15 : r * 1.45;
        ctx.fillRect(0, enemy.kind === 'sniper' ? -2 : -3, barrel, enemy.kind === 'sniper' ? 4 : 6);
        if (enemy.kind === 'sniper') {
          ctx.beginPath(); ctx.arc(r * 0.15, 0, r * 0.28, 0, TAU); ctx.stroke();
          if (enemy.telegraph > 0) {
            ctx.globalAlpha = 0.5 + Math.sin(time * 24) * 0.35;
            ctx.beginPath(); ctx.arc(barrel, 0, 7, 0, TAU); ctx.fill();
            ctx.globalAlpha = 1;
          }
        } else if (enemy.fireTimer < 0.4) {
          ctx.globalAlpha = 1 - enemy.fireTimer / 0.4;
          ctx.beginPath(); ctx.arc(0, 0, r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - enemy.fireTimer / 0.4)); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (enemy.kind === 'tank') {
        ctx.lineWidth = 3.5;
        ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 1.4;
        ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; const px = Math.cos(a) * r * 0.72, py = Math.sin(a) * r * 0.72; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke();
        ctx.strokeRect(-r * 0.3, -r * 0.3, r * 0.6, r * 0.6);
      } else if (enemy.kind === 'splitter') {
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(-r * 0.34, 0, r * 0.23, 0, TAU); ctx.arc(r * 0.34, 0, r * 0.23, 0, TAU); ctx.fill();
      } else if (enemy.kind === 'weaver') {
        ctx.rotate(time * 0.8); ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8; const rr = i % 2 ? r * 0.5 : r; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = color;
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, 2.2, 0, TAU); ctx.fill(); }
      } else if (enemy.kind === 'boss') {
        this.drawBoss(ctx, enemy, time, color);
      }
      if (enemy.elite && enemy.kind !== 'boss') {
        ctx.strokeStyle = '#ffcf70'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.arc(0, 0, enemy.radius + 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
      if (enemy.stun > 0) {
        ctx.strokeStyle = '#c0b2ff'; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 7 + Math.sin(time * 15) * 2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      if ((enemy.elite || enemy.kind === 'tank') && enemy.kind !== 'boss' && enemy.hp < enemy.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(enemy.x - 22, enemy.y - enemy.radius - 13, 44, 3);
        ctx.fillStyle = color; ctx.fillRect(enemy.x - 22, enemy.y - enemy.radius - 13, 44 * Math.max(0, enemy.hp / enemy.maxHp), 3);
      }
      if (enemy.showLabel && enemy.age < 4.2) {
        const [name, role] = ENEMY_LABELS[enemy.kind];
        ctx.save();
        ctx.globalAlpha = clamp(Math.min(enemy.age * 2.5, 4.2 - enemy.age), 0, 1);
        ctx.font = "500 11px 'Noto Sans JP Variable', sans-serif";
        const nameWidth = ctx.measureText(name).width;
        ctx.font = "400 8px 'Noto Sans JP Variable', sans-serif";
        const roleWidth = ctx.measureText(role).width;
        const width = nameWidth + roleWidth + 30;
        const labelX = clamp(enemy.x - width / 2, 34, W - width - 34);
        const labelY = enemy.y < 110 ? enemy.y + enemy.radius + 13 : enemy.y - enemy.radius - 35;
        ctx.fillStyle = 'rgba(3,8,13,.88)'; ctx.fillRect(labelX, labelY, width, 24);
        ctx.strokeStyle = color; ctx.globalAlpha *= 0.55; ctx.strokeRect(labelX + 0.5, labelY + 0.5, width - 1, 23);
        ctx.globalAlpha = clamp(Math.min(enemy.age * 2.5, 4.2 - enemy.age), 0, 1);
        ctx.fillStyle = color; ctx.fillRect(labelX, labelY, 2, 24);
        ctx.fillStyle = '#e4f1ef'; ctx.font = "500 11px 'Noto Sans JP Variable', sans-serif";
        ctx.fillText(name, labelX + 9, labelY + 16);
        ctx.fillStyle = color; ctx.font = "400 8px 'Noto Sans JP Variable', sans-serif";
        ctx.fillText(role, labelX + nameWidth + 18, labelY + 16);
        ctx.restore();
      }
    }
  }

  private drawBoss(ctx: CanvasRenderingContext2D, enemy: Enemy, time: number, color: string) {
    const r = enemy.radius;
    const kind = enemy.bossKind ?? 'warden';
    if (kind === 'lancer') {
      ctx.save(); ctx.rotate(time * 0.65); ctx.setLineDash([18, 12]);
      ctx.beginPath(); ctx.arc(0, 0, r + 17, 0, TAU); ctx.stroke(); ctx.restore();
      ctx.setLineDash([]); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(r * 1.35, 0); ctx.lineTo(-r * 0.75, r * 0.58);
      ctx.lineTo(-r * 0.42, 0); ctx.lineTo(-r * 0.75, -r * 0.58); ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(-r * 0.2, side * r * 0.42); ctx.lineTo(r * 0.62, side * r * 0.92);
        ctx.lineTo(r * 0.35, side * r * 0.35); ctx.stroke();
      }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(r * 0.12, 0, 11 + enemy.phase * 2, 0, TAU); ctx.fill();
      if (enemy.specialTimer > 0) {
        ctx.globalAlpha = 0.45; ctx.lineWidth = 5;
        for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(-r * (0.8 + i * 0.4), -r * 0.35); ctx.lineTo(-r * (0.8 + i * 0.4), r * 0.35); ctx.stroke(); }
      }
    } else if (kind === 'choir') {
      ctx.rotate(time * 0.25);
      for (let ring = 0; ring < 3; ring++) {
        ctx.save(); ctx.rotate(ring * Math.PI / 3 - time * (0.3 + ring * 0.12)); ctx.setLineDash([14 + ring * 3, 12]);
        ctx.beginPath(); ctx.arc(0, 0, r + ring * 13, 0, TAU); ctx.stroke(); ctx.restore();
      }
      ctx.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        const angle = i * TAU / 4 + time * 0.7;
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(Math.cos(angle) * (r + 18), Math.sin(angle) * (r + 18), 6, 0, TAU); ctx.fill();
      }
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const angle = i * TAU / 12, radius = i % 2 ? r * 0.42 : r * 0.82;
        i ? ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius) : ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 12 + enemy.phase * 2, 0, TAU); ctx.fill();
    } else if (kind === 'colossus') {
      ctx.rotate(time * 0.08); ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.rotate(i * TAU / 4); ctx.strokeRect(-r * 0.26, -r * 1.12, r * 0.52, r * 0.42); ctx.restore();
      }
      for (const scale of [1, 0.7]) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = i * TAU / 6, px = Math.cos(angle) * r * scale, py = Math.sin(angle) * r * scale;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = color; ctx.fillRect(-15 - enemy.phase * 2, -15 - enemy.phase * 2, 30 + enemy.phase * 4, 30 + enemy.phase * 4);
      ctx.strokeRect(-r * 0.35, -r * 0.35, r * 0.7, r * 0.7);
    } else {
      ctx.rotate(time * 0.18);
      for (let ring = 0; ring < 3; ring++) {
        ctx.save(); ctx.rotate(ring * time * 0.22); ctx.setLineDash([24 - ring * 4, 14 + ring * 3]);
        ctx.beginPath(); ctx.arc(0, 0, r + ring * 15, 0, TAU); ctx.stroke(); ctx.restore();
      }
      ctx.setLineDash([]);
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; const px = Math.cos(a) * r * 0.8, py = Math.sin(a) * r * 0.8; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(-time * 0.8); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 15 + enemy.phase * 3, 0, TAU); ctx.fill();
    }
    if ((kind === 'warden' || kind === 'choir') && enemy.fireTimer < 0.45) {
      const charge = 1 - enemy.fireTimer / 0.45;
      ctx.globalAlpha = 0.25 + charge * 0.65; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r + 52 - charge * 35, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  private drawShip(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string, alpha: number, radius: number) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.fillStyle = 'rgba(7,20,27,.92)'; ctx.lineWidth = 2;
    ctx.shadowColor = color; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.moveTo(radius * 1.35, 0); ctx.lineTo(-radius * 0.55, radius * 0.85); ctx.lineTo(-radius * 0.2, radius * 0.25); ctx.lineTo(-radius * 0.95, 0); ctx.lineTo(-radius * 0.2, -radius * 0.25); ctx.lineTo(-radius * 0.55, -radius * 0.85); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(2, 0, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  private drawEchoes(ctx: CanvasRenderingContext2D, time: number) {
    for (const echo of this.echoes) {
      ctx.strokeStyle = `rgba(79,141,255,${echo.alpha * 0.18})`;
      ctx.lineWidth = 1; ctx.setLineDash([5, 10]);
      ctx.beginPath(); ctx.moveTo(this.player.x, this.player.y); ctx.lineTo(echo.x, echo.y); ctx.stroke(); ctx.setLineDash([]);
      this.drawShip(ctx, echo.x, echo.y, echo.angle, ECHO_COLOR, echo.alpha, this.player.radius);
      ctx.strokeStyle = `rgba(79,141,255,${echo.alpha * 0.45})`;
      ctx.beginPath(); ctx.arc(echo.x, echo.y, 26 + Math.sin(time * 5) * 3, 0, TAU); ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, time: number) {
    const p = this.player;
    const blink = p.invulnerable > 0 && Math.floor(time * 18) % 2 === 0 && p.dashTimer <= 0;
    if (p.overdrive > 0) {
      const gradient = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 150);
      gradient.addColorStop(0, 'rgba(98,246,231,.16)'); gradient.addColorStop(1, 'rgba(98,246,231,0)');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(p.x, p.y, 150, 0, TAU); ctx.fill();
    }
    if (p.shieldReady) {
      ctx.strokeStyle = 'rgba(156,140,255,.75)'; ctx.lineWidth = 2; ctx.setLineDash([8, 7]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 30 + Math.sin(time * 3) * 2, time, time + TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    const color = this.core === 'tempest' ? '#aa96ff' : this.core === 'bastion' ? BASTION_COLOR : '#62f6e7';
    this.drawShip(ctx, p.x, p.y, p.angle, color, blink ? 0.38 : 1, p.radius * 1.12);
    if (this.tutorialEnabled && this.tutorialStep === 0) {
      const pulse = 2 + Math.sin(time * 4) * 2;
      ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 13 + pulse, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = "700 11px 'Space Grotesk', sans-serif";
      ctx.fillText('YOU', p.x, p.y - p.radius - 24);
      ctx.beginPath(); ctx.moveTo(p.x - 4, p.y - p.radius - 18); ctx.lineTo(p.x + 4, p.y - p.radius - 18); ctx.lineTo(p.x, p.y - p.radius - 12); ctx.fill();
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
    if (Math.hypot(p.vx, p.vy) > 40) {
      ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x - Math.cos(p.angle) * 15, p.y - Math.sin(p.angle) * 15); ctx.lineTo(p.x - p.vx * 0.09, p.y - p.vy * 0.09); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha; ctx.fillStyle = particle.color; ctx.strokeStyle = particle.color;
      if (particle.shape === 'line') {
        ctx.lineWidth = Math.max(1, particle.size * 0.35); ctx.beginPath(); ctx.moveTo(particle.x, particle.y); ctx.lineTo(particle.x - particle.vx * 0.045, particle.y - particle.vy * 0.045); ctx.stroke();
      } else ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    ctx.restore();
  }

  private drawCursor(ctx: CanvasRenderingContext2D, time: number) {
    if (!this.pointer.inside || this.status !== 'running') return;
    const color = this.core === 'tempest' ? '#aa96ff' : this.core === 'bastion' ? BASTION_COLOR : '#62f6e7';
    ctx.save();
    if (this.pointer.down) {
      ctx.strokeStyle = color; ctx.globalAlpha = 0.16; ctx.setLineDash([3, 10]);
      ctx.beginPath(); ctx.moveTo(this.player.x, this.player.y); ctx.lineTo(this.pointer.x, this.pointer.y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.translate(this.pointer.x, this.pointer.y); ctx.rotate(this.pointer.down ? time * 0.8 : 0);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5;
    const radius = this.pointer.down ? 10 : 14;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(radius + 4, 0); ctx.lineTo(radius + 10, 0); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill();
    if (this.tutorialStep === 1 && !this.pointer.down) {
      ctx.rotate(this.pointer.down ? -time * 0.8 : 0);
      ctx.textAlign = 'center'; ctx.font = "500 8px 'Space Grotesk', sans-serif";
      ctx.fillText('HOLD TO FIRE', 0, 35); ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  private drawTexts(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center';
    for (const text of this.texts) {
      ctx.globalAlpha = clamp(text.life * 2, 0, 1); ctx.fillStyle = text.color;
      ctx.font = `600 ${text.size}px 'Space Grotesk', sans-serif`;
      ctx.fillText(text.text, text.x, text.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }
}

export { W as GAME_WIDTH, H as GAME_HEIGHT, formatSeed as createSeed };
