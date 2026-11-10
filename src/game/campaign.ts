import type { Stats } from './types';

export const CAMPAIGN_XP_KEY = 'echo-abyss-campaign-xp';
export const CAMPAIGN_LOADOUT_KEY = 'echo-abyss-initial-bonuses';
export const MAX_BONUS_RANK = 20;
export const TOTAL_BONUS_RANKS = 120;
const RANK_COST_CURVE = 18;

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
  baseCost: number;
  costStep: number;
  apply: (stats: Stats, rank: number) => void;
}

// Every persistent bonus is multiplicative. Percentages compound per rank so
// late-stage enemy inflation never turns an early flat bonus into a dead stat.
export const INITIAL_BONUSES: InitialBonusDefinition[] = [
  {
    id: 'damage', name: '武器出力', enName: 'WEAPON OUTPUT', icon: 'damage', percent: 8, maxRank: MAX_BONUS_RANK,
    baseCost: 100, costStep: 20,
    description: '全武器の基礎ダメージが1ランクごとに +8%',
    apply: (stats, rank) => { stats.damage *= Math.pow(1.08, rank); },
  },
  {
    id: 'fireRate', name: '時間加速', enName: 'TIME ACCELERATION', icon: 'speed', percent: 6, maxRank: MAX_BONUS_RANK,
    baseCost: 110, costStep: 22,
    description: '攻撃速度が1ランクごとに +6%',
    apply: (stats, rank) => { stats.fireRate *= Math.pow(1.06, rank); },
  },
  {
    id: 'vitality', name: 'フレーム耐久', enName: 'FRAME INTEGRITY', icon: 'health', percent: 10, maxRank: MAX_BONUS_RANK,
    baseCost: 120, costStep: 24,
    description: '最大HPが1ランクごとに +10%',
    apply: (stats, rank) => { stats.maxHp = Math.round(stats.maxHp * Math.pow(1.1, rank)); },
  },
  {
    id: 'echoDamage', name: '残響同調', enName: 'ECHO ATTUNEMENT', icon: 'echoDamage', percent: 8, maxRank: MAX_BONUS_RANK,
    baseCost: 100, costStep: 20,
    description: '残響の武器ダメージが1ランクごとに +8%',
    apply: (stats, rank) => { stats.echoDamage *= Math.pow(1.08, rank); },
  },
  {
    id: 'mobility', name: '機動制御', enName: 'VECTOR CONTROL', icon: 'movement', percent: 4, maxRank: MAX_BONUS_RANK,
    baseCost: 80, costStep: 16,
    description: '移動速度が1ランクごとに +4%',
    apply: (stats, rank) => { stats.moveSpeed *= Math.pow(1.04, rank); },
  },
  {
    id: 'xpGain', name: '欠片共鳴', enName: 'SHARD RESONANCE', icon: 'experience', percent: 8, maxRank: MAX_BONUS_RANK,
    baseCost: 90, costStep: 18,
    description: 'ステージ内の進化EXP獲得量が1ランクごとに +8%',
    apply: (stats, rank) => { stats.xpGain *= Math.pow(1.08, rank); },
  },
];

export function readCampaignXp() {
  const value = Number(localStorage.getItem(CAMPAIGN_XP_KEY) ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getBonusUpgradeCost(id: InitialBonusId, currentRank: number) {
  const definition = INITIAL_BONUSES.find(bonus => bonus.id === id)!;
  const rank = Math.max(0, Math.floor(currentRank));
  if (rank >= definition.maxRank) return null;
  // Early ranks are affordable after one or two clears. Later ranks grow
  // quadratically, so high-stage rewards matter without exponential inflation.
  return Math.round(definition.baseCost + definition.costStep * rank + RANK_COST_CURVE * Math.pow(rank, 2));
}

export function getBonusInvestedXp(loadout: BonusLoadout) {
  return INITIAL_BONUSES.reduce((total, bonus) => {
    const rank = Math.min(bonus.maxRank, Math.max(0, Math.floor(loadout[bonus.id] ?? 0)));
    let invested = 0;
    for (let currentRank = 0; currentRank < rank; currentRank++) invested += getBonusUpgradeCost(bonus.id, currentRank)!;
    return total + invested;
  }, 0);
}

export function countBonusRanks(loadout: BonusLoadout) {
  return INITIAL_BONUSES.reduce((total, bonus) => total + Math.min(bonus.maxRank, Math.max(0, Math.floor(loadout[bonus.id] ?? 0))), 0);
}

// When owned is supplied, a run may equip only ranks already purchased in the
// menu. This prevents a caller from injecting an unearned loadout at start.
export function sanitizeBonusLoadout(loadout: BonusLoadout | null | undefined, owned?: BonusLoadout): BonusLoadout {
  const sanitized: BonusLoadout = {};
  for (const bonus of INITIAL_BONUSES) {
    const requested = Math.max(0, Math.floor(Number(loadout?.[bonus.id]) || 0));
    const ownedRank = owned ? Math.max(0, Math.floor(Number(owned[bonus.id]) || 0)) : bonus.maxRank;
    const rank = Math.min(bonus.maxRank, requested, ownedRank);
    if (rank > 0) sanitized[bonus.id] = rank;
  }
  return sanitized;
}

export function readInitialBonuses() {
  try {
    // Existing saved ranks remain owned; the campaign XP value is now the
    // spendable balance rather than a shared-point unlock threshold.
    const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_LOADOUT_KEY) ?? '{}') as BonusLoadout;
    return sanitizeBonusLoadout(parsed);
  } catch {
    return {} as BonusLoadout;
  }
}

function storeCampaign(xp: number, loadout: BonusLoadout) {
  const sanitized = sanitizeBonusLoadout(loadout);
  const availableXp = Math.max(0, Math.floor(xp));
  localStorage.setItem(CAMPAIGN_XP_KEY, String(availableXp));
  localStorage.setItem(CAMPAIGN_LOADOUT_KEY, JSON.stringify(sanitized));
  return { xp: availableXp, loadout: sanitized };
}

export function purchaseInitialBonus(id: InitialBonusId) {
  const loadout = readInitialBonuses();
  const xp = readCampaignXp();
  const currentRank = loadout[id] ?? 0;
  const cost = getBonusUpgradeCost(id, currentRank);
  if (cost === null || xp < cost) return { xp, loadout, changed: false, cost };
  const stored = storeCampaign(xp - cost, { ...loadout, [id]: currentRank + 1 });
  return { ...stored, changed: true, cost };
}

export function refundInitialBonus(id: InitialBonusId) {
  const loadout = readInitialBonuses();
  const xp = readCampaignXp();
  const currentRank = loadout[id] ?? 0;
  if (currentRank <= 0) return { xp, loadout, changed: false, refund: 0 };
  const refund = getBonusUpgradeCost(id, currentRank - 1)!;
  const next = { ...loadout, [id]: currentRank - 1 };
  if (currentRank === 1) delete next[id];
  const stored = storeCampaign(xp + refund, next);
  return { ...stored, changed: true, refund };
}

export function resetInitialBonuses() {
  const loadout = readInitialBonuses();
  const refund = getBonusInvestedXp(loadout);
  const stored = storeCampaign(readCampaignXp() + refund, {});
  return { ...stored, changed: refund > 0, refund };
}

export function applyInitialBonuses(stats: Stats, loadout: BonusLoadout) {
  for (const bonus of INITIAL_BONUSES) {
    const rank = Math.min(bonus.maxRank, Math.max(0, Math.floor(loadout[bonus.id] ?? 0)));
    if (rank > 0) bonus.apply(stats, rank);
  }
}

export function getStageXp(stage: number, firstClear: boolean) {
  const normalizedStage = Math.max(1, Math.floor(stage));
  // Early clears stay familiar; harder stages pay quadratically more so their
  // rewards keep pace with individual rank costs without exponential inflation.
  const base = Math.round(120 + normalizedStage * 12 + Math.pow(normalizedStage, 2) * 0.18);
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
