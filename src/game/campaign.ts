import type { Stats } from './types';

export const CAMPAIGN_XP_KEY = 'echo-abyss-campaign-xp';
export const CAMPAIGN_LOADOUT_KEY = 'echo-abyss-initial-bonuses';
export const MAX_BONUS_RANK = 20;
export const MAX_BONUS_POINTS = 120;

export type InitialBonusId = 'damage' | 'fireRate' | 'vitality' | 'echoDamage' | 'mobility' | 'xpGain';
export type BonusLoadout = Partial<Record<InitialBonusId, number>>;

export interface InitialBonusDefinition {
  id: InitialBonusId;
  name: string;
  enName: string;
  description: string;
  icon: string;
  percent: number;
  maxRank: number;
  apply: (stats: Stats, rank: number) => void;
}

// Every persistent bonus is multiplicative. Percentages compound per rank so
// late-stage enemy inflation never turns an early flat bonus into a dead stat.
export const INITIAL_BONUSES: InitialBonusDefinition[] = [
  {
    id: 'damage', name: '武器出力', enName: 'WEAPON OUTPUT', icon: 'damage', percent: 8, maxRank: MAX_BONUS_RANK,
    description: '全武器の基礎ダメージが1ランクごとに +8%',
    apply: (stats, rank) => { stats.damage *= Math.pow(1.08, rank); },
  },
  {
    id: 'fireRate', name: '時間加速', enName: 'TIME ACCELERATION', icon: 'speed', percent: 6, maxRank: MAX_BONUS_RANK,
    description: '攻撃速度が1ランクごとに +6%',
    apply: (stats, rank) => { stats.fireRate *= Math.pow(1.06, rank); },
  },
  {
    id: 'vitality', name: 'フレーム耐久', enName: 'FRAME INTEGRITY', icon: 'health', percent: 10, maxRank: MAX_BONUS_RANK,
    description: '最大HPが1ランクごとに +10%',
    apply: (stats, rank) => { stats.maxHp = Math.round(stats.maxHp * Math.pow(1.1, rank)); },
  },
  {
    id: 'echoDamage', name: '残響同調', enName: 'ECHO ATTUNEMENT', icon: 'echoDamage', percent: 8, maxRank: MAX_BONUS_RANK,
    description: '残響の武器ダメージが1ランクごとに +8%',
    apply: (stats, rank) => { stats.echoDamage *= Math.pow(1.08, rank); },
  },
  {
    id: 'mobility', name: '機動制御', enName: 'VECTOR CONTROL', icon: 'movement', percent: 4, maxRank: MAX_BONUS_RANK,
    description: '移動速度が1ランクごとに +4%',
    apply: (stats, rank) => { stats.moveSpeed *= Math.pow(1.04, rank); },
  },
  {
    id: 'xpGain', name: '欠片共鳴', enName: 'SHARD RESONANCE', icon: 'experience', percent: 8, maxRank: MAX_BONUS_RANK,
    description: 'ステージ内の進化EXP獲得量が1ランクごとに +8%',
    apply: (stats, rank) => { stats.xpGain *= Math.pow(1.08, rank); },
  },
];

export function readCampaignXp() {
  const value = Number(localStorage.getItem(CAMPAIGN_XP_KEY) ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

// A square-root curve front-loads useful early choices, then gradually opens
// all six builds. Replaying is viable, while the 120-point cap preserves limits.
export function getBonusPoints(xp: number) {
  return Math.min(MAX_BONUS_POINTS, Math.floor(Math.sqrt(Math.max(0, xp) / 18)));
}

export function getNextBonusPointXp(xp: number) {
  const points = getBonusPoints(xp);
  return points >= MAX_BONUS_POINTS ? null : 18 * Math.pow(points + 1, 2);
}

export function countBonusRanks(loadout: BonusLoadout) {
  return INITIAL_BONUSES.reduce((total, bonus) => total + Math.max(0, Math.floor(loadout[bonus.id] ?? 0)), 0);
}

export function sanitizeBonusLoadout(loadout: BonusLoadout | null | undefined, pointBudget: number): BonusLoadout {
  const sanitized: BonusLoadout = {};
  let remaining = Math.max(0, Math.floor(pointBudget));
  for (const bonus of INITIAL_BONUSES) {
    const requested = Math.max(0, Math.floor(Number(loadout?.[bonus.id]) || 0));
    const rank = Math.min(bonus.maxRank, requested, remaining);
    if (rank > 0) sanitized[bonus.id] = rank;
    remaining -= rank;
  }
  return sanitized;
}

export function readInitialBonuses(xp = readCampaignXp()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_LOADOUT_KEY) ?? '{}') as BonusLoadout;
    return sanitizeBonusLoadout(parsed, getBonusPoints(xp));
  } catch {
    return {} as BonusLoadout;
  }
}

export function saveInitialBonuses(loadout: BonusLoadout, xp = readCampaignXp()) {
  const sanitized = sanitizeBonusLoadout(loadout, getBonusPoints(xp));
  localStorage.setItem(CAMPAIGN_LOADOUT_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function applyInitialBonuses(stats: Stats, loadout: BonusLoadout) {
  for (const bonus of INITIAL_BONUSES) {
    const rank = Math.min(bonus.maxRank, Math.max(0, Math.floor(loadout[bonus.id] ?? 0)));
    if (rank > 0) bonus.apply(stats, rank);
  }
}

export function getStageXp(stage: number, firstClear: boolean) {
  const base = 120 + Math.max(1, Math.floor(stage)) * 10;
  return firstClear ? base : Math.max(40, Math.round(base * 0.35));
}

export function awardStageClear(stage: number) {
  const clearKey = `echo-abyss-level-${stage}-clear`;
  const firstClear = localStorage.getItem(clearKey) !== '1';
  const xpEarned = getStageXp(stage, firstClear);
  const totalXp = readCampaignXp() + xpEarned;
  localStorage.setItem(CAMPAIGN_XP_KEY, String(totalXp));
  localStorage.setItem(clearKey, '1');
  return { xpEarned, totalXp, firstClear };
}
