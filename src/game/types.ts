export type CoreId = 'wraith' | 'tempest' | 'bastion';
export type Difficulty = 'standard' | 'abyss';
export type GameMode = 'infinite' | 'level';
export type EngineStatus = 'idle' | 'running' | 'paused' | 'draft' | 'checkpoint' | 'gameover';
export type Rarity = 'common' | 'rare' | 'epic';

export interface CoreDefinition {
  id: CoreId;
  name: string;
  code: string;
  weapon: string;
  description: string;
  trait: string;
  color: string;
  hp: number;
  speed: number;
  damage: number;
  fireRate: number;
}

export interface Stats {
  damage: number;
  fireRate: number;
  moveSpeed: number;
  maxHp: number;
  projectileSpeed: number;
  projectiles: number;
  pierce: number;
  critChance: number;
  critDamage: number;
  pickupRadius: number;
  armor: number;
  echoDuration: number;
  echoCooldown: number;
  echoDamage: number;
  maxEchoes: number;
  dashCooldown: number;
  dashDamage: number;
  syncGain: number;
  syncDamage: number;
  shieldInterval: number;
  homing: number;
  chain: number;
  overdriveDuration: number;
  luck: number;
  lifeSteal: number;
  xpGain: number;
}

export interface UpgradeDefinition {
  id: string;
  name: string;
  enName: string;
  description: string;
  icon: string;
  category: 'WEAPON' | 'ECHO' | 'SURVIVAL' | 'SYSTEM';
  rarity: Rarity;
  maxStacks: number;
  /** Omit for upgrades shared by every frame. */
  cores?: CoreId[];
  apply: (stats: Stats) => void;
}

export interface DraftState {
  choices: UpgradeDefinition[];
  stacks: Record<string, number>;
  rerolls: number;
  reason: 'level' | 'boss';
}

export interface HudState {
  hp: number;
  maxHp: number;
  shield: boolean;
  level: number;
  xp: number;
  xpNext: number;
  score: number;
  sector: number;
  sectorProgress: number;
  anomaly: { name: string; description: string } | null;
  elapsed: number;
  kills: number;
  echoCooldown: number;
  echoMaxCooldown: number;
  activeEchoes: number;
  maxEchoes: number;
  dashCooldown: number;
  dashMaxCooldown: number;
  sync: number;
  overdrive: number;
  combo: number;
  boss: { name: string; hp: number; maxHp: number; phase: number } | null;
  core: CoreId;
  weapon: string;
  weaponDetail: string;
  weaponSkillName: string;
  weaponSkillDescription: string;
  weaponCooldown: number;
  weaponMaxCooldown: number;
  tutorialStep: number;
  rift: { distance: number; angle: number; progress: number; duration: number; life: number; inside: boolean } | null;
  seed: string;
  difficulty: Difficulty;
  gameMode: GameMode;
  challengeLevel: number;
  challengeName: string;
  challengeDuration: number;
  challengeCleanup: boolean;
  remainingEnemies: number;
  initialBonusRanks: number;
}

export interface RunResult {
  score: number;
  sector: number;
  elapsed: number;
  kills: number;
  level: number;
  echoes: number;
  bestCombo: number;
  core: CoreId;
  seed: string;
  difficulty: Difficulty;
  gameMode: GameMode;
  challengeLevel: number;
  victory: boolean;
  newBest: boolean;
  xpEarned: number;
  totalXp: number;
  bonusPoints: number;
  firstClear: boolean;
}

export interface ToastMessage {
  id: number;
  eyebrow: string;
  title: string;
  detail?: string;
  tone?: 'cyan' | 'coral' | 'gold';
}

export const CORES: CoreDefinition[] = [
  {
    id: 'wraith',
    name: 'WRAITH',
    code: '01 / ASSAULT',
    weapon: 'PULSE REPEATER',
    description: '連射に優れた標準フレーム。遠距離から敵を削り、残響と十字火力を組む。',
    trait: '高速弾 / 高い機動力',
    color: '#62f6e7',
    hp: 100,
    speed: 285,
    damage: 23,
    fireRate: 3.6,
  },
  {
    id: 'tempest',
    name: 'TEMPEST',
    code: '02 / ARC',
    weapon: 'CHAIN ARC',
    description: '敵の間を跳ぶ雷撃を放つ。単一の敵には未使用の連鎖を集中する技巧フレーム。',
    trait: '連鎖雷撃 / 集団制圧',
    color: '#9c8cff',
    hp: 90,
    speed: 270,
    damage: 25,
    fireRate: 1.55,
  },
  {
    id: 'bastion',
    name: 'BASTION',
    code: '03 / NOVA',
    weapon: 'NOVA ARRAY',
    description: '全方位へ新星を放つ重装甲。敵の中心へ飛び込み、残響で弹幕を倍増させる。',
    trait: '全方位射撃 / 高耐久',
    color: '#ffbd69',
    hp: 130,
    speed: 245,
    damage: 16,
    fireRate: 1.05,
  },
];
