export const LEVEL_COUNT = 100;

// Campaign starts with a slightly weaker bare frame. Persistent percentage
// bonuses are applied afterwards; INFINITE never reads these modifiers.
export const LEVEL_STARTING_MODIFIER = {
  damage: 0.90,
  fireRate: 0.95,
  maxHp: 0.95,
} as const;

export interface LevelDefinition {
  id: number;
  sector: number;
  name: string;
  sectorName: string;
  enName: string;
  briefing: string;
  combatDuration: number;
  enemyTier: number;
  enemyHealth: number;
  enemyDamage: number;
  enemySpeed: number;
  spawnRate: number;
  eliteBonus: number;
  bossTier: number;
  bossHealth: number;
  xpReward: number;
}

const SECTOR_NAMES = ['同期領域', '加速領域', '分岐領域', '共鳴領域', '深淵領域', '特異領域', '零度領域', '逆光回廊', '終末環', '無限深海'];
const SECTOR_EN_NAMES = ['SYNCHRONIZE', 'ACCELERATION', 'DIVERGENCE', 'RESONANCE', 'ABYSSAL', 'SINGULARITY', 'ZERO POINT', 'AFTERLIGHT', 'LAST CIRCLE', 'ENDLESS DEEP'];
const DEPTH_NAMES = ['起動', '脈動', '分岐', '加速', '共鳴', '侵食', '臨界', '反転', '収束', '管理者'];
const LEGACY_NAMES = ['同期', '加速', '分岐', '共鳴', '深淵', '特異点'];

export const formatStage = (stage: number) => String(stage).padStart(3, '0');

function createLevel(id: number): LevelDefinition {
  const sectorIndex = Math.floor((id - 1) / 10);
  const depth = (id - 1) % 10;
  const enemyHealth = Math.pow(1.02, id - 1);
  const bossTier = Math.min(4, 1 + Math.floor((id - 1) / 25));
  const sectorName = SECTOR_NAMES[sectorIndex]!;
  return {
    id,
    sector: sectorIndex + 1,
    name: LEGACY_NAMES[id - 1] ?? DEPTH_NAMES[depth]!,
    sectorName,
    enName: `${SECTOR_EN_NAMES[sectorIndex]} // ${String(depth + 1).padStart(2, '0')}`,
    briefing: `${sectorName}・深度${depth + 1}。時間異常と敵編成が変化。ワーデンを倒した後も、残敵を全滅させるまで終了しない。`,
    combatDuration: 32 + sectorIndex * 2,
    // Director complexity grows separately from raw stats and remains bounded.
    enemyTier: Math.min(13, 1 + Math.floor((id - 1) / 8)),
    // 2% compound HP leaves room for draft growth and avoids bullet-sponge
    // stages; enemy damage compounds more gently at 1.3% per stage.
    enemyHealth,
    enemyDamage: Math.pow(1.013, id - 1),
    enemySpeed: 1 + Math.min(0.22, (id - 1) * 0.0022),
    spawnRate: 1 + Math.min(0.15, (id - 1) * 0.0015),
    eliteBonus: Math.min(0.06, (id - 1) * 0.0006),
    bossTier,
    bossHealth: enemyHealth * (0.82 + sectorIndex * 0.025),
    xpReward: 120 + id * 10,
  };
}

// One hundred deterministic, reproducible stages: ten sectors of ten depths.
// The definitions are data-only, so menu, autoplay and engine share one balance.
export const LEVELS: LevelDefinition[] = Array.from({ length: LEVEL_COUNT }, (_, index) => createLevel(index + 1));
