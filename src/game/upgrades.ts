import type { Stats, UpgradeDefinition } from './types';

// Names lead with their function; enName preserves the world's more poetic flavor.
export const UPGRADES: UpgradeDefinition[] = [
  {
    id: 'amplifier', name: '武器ダメージ強化', enName: 'HOT CIRCUIT', description: '武器のダメージ +25%。残響の武器にも適用', icon: 'damage', category: 'WEAPON', rarity: 'common', maxStacks: 5,
    apply: s => { s.damage *= 1.25; },
  },
  {
    id: 'overclock', name: '攻撃速度強化', enName: 'OVERCLOCK', description: '攻撃速度 +20%。連射間隔が短くなる', icon: 'speed', category: 'WEAPON', rarity: 'common', maxStacks: 5,
    apply: s => { s.fireRate *= 1.20; },
  },
  {
    id: 'splitstream', name: '追加攻撃', enName: 'SPLITSTREAM', description: '連射弾 +1／雷撃の連鎖 +1／全方位弾 +2', icon: 'multishot', category: 'WEAPON', rarity: 'rare', maxStacks: 3,
    apply: s => { s.projectiles += 1; },
  },
  {
    id: 'velocity', name: '弾速・飛距離強化', enName: 'RAIL DRIVER', description: '弾速 +25%。弾がより遠くまで届く', icon: 'velocity', category: 'WEAPON', rarity: 'common', maxStacks: 3, cores: ['wraith', 'bastion'],
    apply: s => { s.projectileSpeed *= 1.25; },
  },
  {
    id: 'pierce', name: '高圧貫通弾 +1', enName: 'PHASE NEEDLE', description: '連射弾・照準重弾のダメージ +18%。自分と残響の弾がさらに1体貫通', icon: 'pierce', category: 'WEAPON', rarity: 'rare', maxStacks: 3, cores: ['wraith', 'bastion'],
    apply: s => { s.pierce += 1; },
  },
  {
    id: 'critical', name: 'クリティカル +12%', enName: 'FAULT LINE', description: 'クリティカル率 +12%。発生時は2倍ダメージ', icon: 'critical', category: 'WEAPON', rarity: 'common', maxStacks: 4,
    apply: s => { s.critChance += 0.12; },
  },
  {
    id: 'seeker', name: '誘導弾', enName: 'RETURN VECTOR', description: '自分と残響の全ての弾が敵を追跡。全方位弾にも適用', icon: 'homing', category: 'WEAPON', rarity: 'rare', maxStacks: 2, cores: ['wraith', 'bastion'],
    apply: s => { s.homing += 2.2; },
  },
  {
    id: 'chain', name: '雷撃の連鎖 +1', enName: 'CONDUCTIVE VEINS', description: 'CHAIN ARCがさらに1体へ跳躍。単一対象では集中雷撃に変換', icon: 'chain', category: 'WEAPON', rarity: 'rare', maxStacks: 3, cores: ['tempest'],
    apply: s => { s.chain += 1; },
  },
  {
    id: 'singularity', name: '6撃ごとの引力場', enName: 'EVENT HORIZON', description: '自分が6回攻撃するたび、敵を引き寄せる引力場を3.2秒生成', icon: 'gravity', category: 'WEAPON', rarity: 'epic', maxStacks: 1,
    apply: () => {},
  },
  {
    id: 'echo_time', name: '残響の持続 +35%', enName: 'LONG ECHO', description: '残響が再生する過去の時間 +35%', icon: 'echoTime', category: 'ECHO', rarity: 'common', maxStacks: 4,
    apply: s => { s.echoDuration *= 1.35; },
  },
  {
    id: 'echo_cooldown', name: '残響の冷却 -20%', enName: 'SHORT MEMORY', description: '残響を再召喚できるまでの時間 -20%', icon: 'cooldown', category: 'ECHO', rarity: 'common', maxStacks: 4,
    apply: s => { s.echoCooldown *= 0.80; },
  },
  {
    id: 'echo_damage', name: '残響の火力 +35%', enName: 'SELF SIMILARITY', description: '残響が武器で与えるダメージ +35%', icon: 'echoDamage', category: 'ECHO', rarity: 'common', maxStacks: 4,
    apply: s => { s.echoDamage *= 1.35; },
  },
  {
    id: 'fork', name: '残響の同時召喚 +1', enName: 'FORKED TIMELINE', description: '同時に存在できる残響 +1。上限時は最も古い残響が消滅', icon: 'fork', category: 'ECHO', rarity: 'epic', maxStacks: 2,
    apply: s => { s.maxEchoes += 1; },
  },
  {
    id: 'afterimage', name: '残響の消滅爆発', enName: 'LAST IMAGE', description: '残響消滅時、武器ダメージの270%を周囲へ。強化で範囲・倍率上昇', icon: 'explosion', category: 'ECHO', rarity: 'rare', maxStacks: 3,
    apply: () => {},
  },
  {
    id: 'resonance', name: '共鳴ダメージ +80%', enName: 'RESONANT BODY', description: '自分と残響の同時攻撃で起きる共鳴ダメージ +80%', icon: 'resonance', category: 'ECHO', rarity: 'rare', maxStacks: 3,
    apply: s => { s.syncDamage *= 1.8; },
  },
  {
    id: 'harvest', name: 'ZEROゲージ +35%', enName: 'SYNC HARVEST', description: '共鳴と欠片で得られるZEROゲージ +35%', icon: 'charge', category: 'ECHO', rarity: 'common', maxStacks: 3,
    apply: s => { s.syncGain *= 1.35; },
  },
  {
    id: 'dash_echo', name: 'ダッシュで残響生成', enName: 'TWIN INSTANT', description: 'ダッシュ時、直前2.6秒の残響をクールダウンなしで生成', icon: 'dashEcho', category: 'ECHO', rarity: 'epic', maxStacks: 1,
    apply: () => {},
  },
  {
    id: 'vitality', name: '最大HP +20%・回復', enName: 'SPARE HEART', description: '最大HP +20%。取得時に増えた分のHPを回復', icon: 'health', category: 'SURVIVAL', rarity: 'common', maxStacks: 5,
    apply: s => { s.maxHp = Math.round(s.maxHp * 1.2); },
  },
  {
    id: 'armor', name: '被ダメージ -12%', enName: 'OBSIDIAN SKIN', description: '敵から受けるダメージ -12%。複数取得時は乗算', icon: 'armor', category: 'SURVIVAL', rarity: 'common', maxStacks: 4,
    apply: s => { s.armor = 1 - (1 - s.armor) * 0.88; },
  },
  {
    id: 'mobility', name: '移動速度 +14%', enName: 'INERTIA THEFT', description: '自分の移動速度 +14%', icon: 'movement', category: 'SURVIVAL', rarity: 'common', maxStacks: 4,
    apply: s => { s.moveSpeed *= 1.14; },
  },
  {
    id: 'dash_cooldown', name: 'ダッシュの冷却 -18%', enName: 'SHORT LEAP', description: '位相ダッシュを再使用できるまでの時間 -18%', icon: 'dashCooldown', category: 'SURVIVAL', rarity: 'common', maxStacks: 4,
    apply: s => { s.dashCooldown *= 0.82; },
  },
  {
    id: 'dash_damage', name: 'ダッシュで斬撃', enName: 'PHASE SHEAR', description: 'ダッシュ中に触れた敵へ武器ダメージの280%。強化で倍率上昇', icon: 'dashDamage', category: 'SURVIVAL', rarity: 'rare', maxStacks: 3,
    apply: s => { s.dashDamage += 2.8; },
  },
  {
    id: 'shield', name: '自動シールド', enName: 'CYCLIC AEGIS', description: '攻撃を1回防ぎ即展開。再構成時間 -2.5秒', icon: 'shield', category: 'SURVIVAL', rarity: 'rare', maxStacks: 3,
    apply: s => { s.shieldInterval = Math.max(5, s.shieldInterval - 2.5); },
  },
  {
    id: 'leech', name: '撃破時にHP回復', enName: 'RED RETURN', description: '敵を倒した時、3%の確率で最大HPの2.5%を回復', icon: 'leech', category: 'SURVIVAL', rarity: 'rare', maxStacks: 3,
    apply: s => { s.lifeSteal += 0.03; },
  },
  {
    id: 'magnet', name: '欠片の回収範囲 +50%', enName: 'GRAVITY HAND', description: '経験値の欠片と回復アイテムを引き寄せる範囲 +50%', icon: 'magnet', category: 'SYSTEM', rarity: 'common', maxStacks: 3,
    apply: s => { s.pickupRadius *= 1.50; },
  },
  {
    id: 'interest', name: '経験値 +22%', enName: 'COMPOUND SOUL', description: '欠片から得られる経験値 +22%', icon: 'experience', category: 'SYSTEM', rarity: 'common', maxStacks: 4,
    apply: s => { s.xpGain *= 1.22; },
  },
  {
    id: 'luck', name: '高レア進化の確率上昇', enName: 'PROBABILITY THEFT', description: 'ADVANCED・ABYSSALの進化が出やすくなる', icon: 'luck', category: 'SYSTEM', rarity: 'rare', maxStacks: 3,
    apply: s => { s.luck += 0.14; },
  },
  {
    id: 'zero_time', name: 'ZERO FIELD +2秒', enName: 'ZERO EXTENSION', description: 'ZERO FIELDの持続時間 +2秒', icon: 'zeroTime', category: 'SYSTEM', rarity: 'rare', maxStacks: 3,
    apply: s => { s.overdriveDuration += 2; },
  },
  {
    id: 'revive', name: '致命傷から復活', enName: 'DEATH, CANCELLED', description: '致命傷を防ぎ全回復＋敵弾消去。発動後は効果を失う', icon: 'revive', category: 'SYSTEM', rarity: 'epic', maxStacks: 1,
    apply: () => {},
  },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map(upgrade => [upgrade.id, upgrade]));
