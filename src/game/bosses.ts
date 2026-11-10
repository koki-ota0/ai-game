export const BOSS_ORDER = ['warden', 'lancer', 'choir', 'colossus'] as const;
export type BossKind = typeof BOSS_ORDER[number];

export interface BossDefinition {
  id: BossKind;
  name: string;
  title: string;
  role: string;
  description: string;
  color: string;
  fill: string;
  radius: number;
  speed: number;
}

export const BOSS_DEFINITIONS: Record<BossKind, BossDefinition> = {
  warden: {
    id: 'warden', name: 'AION // WARDEN', title: '深淵の管理者', role: '円形弾幕・召喚',
    description: '円形弾幕と扇状射撃に、周囲へのドローン召喚を組み合わせる。',
    color: '#ff405f', fill: 'rgba(65,12,27,.88)', radius: 64, speed: 1,
  },
  lancer: {
    id: 'lancer', name: 'KAIROS // LANCER', title: '時を裂く槍騎', role: '照準突進・貫通射',
    description: '照準線を先に示し、高速の貫通射撃と直線突進を交互に放つ。',
    color: '#ff9a62', fill: 'rgba(65,31,15,.88)', radius: 58, speed: 1.2,
  },
  choir: {
    id: 'choir', name: 'NEXUS // CHOIR', title: '分岐する残響', role: '螺旋弾幕・召喚',
    description: '二重螺旋の弾幕と衛星射撃を展開し、ウィーバーを呼び出す。',
    color: '#c27bff', fill: 'rgba(42,20,65,.88)', radius: 62, speed: 0.95,
  },
  colossus: {
    id: 'colossus', name: 'ATLAS // COLOSSUS', title: '不動の時間防壁', role: '予兆円・衝撃波',
    description: '予兆円の後に近距離衝撃波を放ち、重い回転弾幕で間合いを制限する。',
    color: '#ffcf70', fill: 'rgba(61,45,17,.9)', radius: 72, speed: 0.78,
  },
};

export function bossKindForEncounter(encounter: number): BossKind {
  const index = Math.max(0, Math.floor(encounter) - 1) % BOSS_ORDER.length;
  return BOSS_ORDER[index]!;
}
