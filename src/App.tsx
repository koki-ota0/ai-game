import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowLeft, ArrowRight, AudioWaveform, Bomb, Check, ChevronRight,
  ChevronLeft, ChevronsRight, CircleDot, Clock3, Copy, CopyPlus, Cpu, Crosshair, Dices,
  FastForward, Gamepad2, Gauge, Ghost, GitBranch, Heart, HeartPulse, Hexagon, Hourglass,
  Infinity as InfinityIcon, Keyboard, Layers3, LocateFixed, Lock, Magnet, MousePointer2, MoveRight,
  MoveUpRight, Navigation, Minus, Pause, Play, Plus, Radio, RefreshCw, RotateCcw, ScanLine,
  Shield, ShieldCheck, SlidersHorizontal, Sparkles, Split, Swords, Timer, TimerReset, TrendingUp,
  Trophy, Volume2, VolumeX, Wind, X, Zap,
} from 'lucide-react';
import { GameEngine, INFINITE_CHECKPOINT_INTERVAL, INFINITE_MAX_SECTOR, WEAPON_SKILLS, createSeed } from './game/GameEngine';
import { CORES } from './game/types';
import { LEVELS, formatStage } from './game/levels';
import {
  INITIAL_BONUSES, MAX_BONUS_POINTS, countBonusRanks, getBonusPoints,
  getNextBonusPointXp, readCampaignXp, readInitialBonuses, saveInitialBonuses,
} from './game/campaign';
import type { BonusLoadout, InitialBonusId } from './game/campaign';
import type {
  CoreId, Difficulty, DraftState, EngineStatus, GameMode, HudState, RunResult, ToastMessage,
} from './game/types';

type Phase = 'menu' | EngineStatus;

const number = (value: number) => Math.floor(value).toLocaleString('en-US');
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

const UPGRADE_ICONS: Record<string, typeof Zap> = {
  damage: Gauge, speed: FastForward, multishot: Split, velocity: MoveUpRight,
  pierce: MoveRight, critical: Crosshair, homing: LocateFixed, chain: Zap,
  gravity: CircleDot, echoTime: TimerReset, cooldown: RefreshCw,
  echoDamage: CopyPlus, fork: Copy, explosion: Bomb, resonance: AudioWaveform,
  charge: Activity, dashEcho: ChevronsRight, health: HeartPulse, armor: Shield,
  movement: Wind, dashCooldown: Timer, dashDamage: Swords, shield: ShieldCheck,
  leech: Heart, magnet: Magnet, experience: TrendingUp, luck: Sparkles,
  zeroTime: Hourglass, revive: RotateCcw,
};

const CATEGORY_LABELS = { WEAPON: '武器', ECHO: '残響', SURVIVAL: '防御', SYSTEM: '特殊' } as const;

const PILOT_STEPS = [
  { title: '「YOU」が、あなたの機体', detail: 'WASD・矢印キー・左スティックで移動' },
  { title: '狙って、撃て', detail: 'マウス左・画面を長押しして照準＋射撃' },
  { title: '危険をすり抜けろ', detail: 'SPACE / DASH で無敵ダッシュ' },
  { title: '過去の自分を呼べ', detail: 'E / ECHO で数秒前の自分を召喚' },
  { title: 'フレーム技能を解放', detail: 'R / SKILL で強力な武器スキル' },
];

function UpgradeIcon({ icon }: { icon: string }) {
  const Icon = UPGRADE_ICONS[icon] ?? Cpu;
  return <Icon size={29} strokeWidth={1.6} />;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true"><i /><b /></span>
      <span>ECHO<span>//</span>ABYSS</span>
    </div>
  );
}

function CoreIcon({ core, size = 22 }: { core: CoreId; size?: number }) {
  if (core === 'tempest') return <Zap size={size} />;
  if (core === 'bastion') return <Hexagon size={size} />;
  return <Crosshair size={size} />;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [hud, setHud] = useState<HudState | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [selectedCore, setSelectedCore] = useState<CoreId>('wraith');
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [gameMode, setGameMode] = useState<GameMode>('infinite');
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [levelChapter, setLevelChapter] = useState(0);
  const [unlockedLevel, setUnlockedLevel] = useState(1);
  const [campaignXp, setCampaignXp] = useState(0);
  const [bonusLoadout, setBonusLoadout] = useState<BonusLoadout>({});
  const [bonusEditor, setBonusEditor] = useState(false);
  const [seed, setSeed] = useState(createSeed);
  const [sound, setSound] = useState(() => localStorage.getItem('echo-abyss-sound') !== 'off');
  const [help, setHelp] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  const [bestSector, setBestSector] = useState(0);

  const refreshRecords = () => {
    setBestScore(Math.max(
      Number(localStorage.getItem('echo-abyss-best-standard') ?? 0),
      Number(localStorage.getItem('echo-abyss-best-abyss') ?? 0),
    ));
    setBestSector(Number(localStorage.getItem('echo-abyss-best-sector') ?? 0));
    setUnlockedLevel(Math.max(1, Math.min(LEVELS.length, Number(localStorage.getItem('echo-abyss-unlocked-level') ?? 1))));
    const xp = readCampaignXp();
    setCampaignXp(xp);
    setBonusLoadout(readInitialBonuses(xp));
  };

  useEffect(() => {
    refreshRecords();
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onHud: setHud,
      onStatus: status => setPhase(status),
      onDraft: setDraft,
      onGameOver: runResult => { setResult(runResult); refreshRecords(); },
      onToast: toast => {
        setToasts(current => [...current.slice(-2), toast]);
        window.setTimeout(() => setToasts(current => current.filter(item => item.id !== toast.id)), 3300);
      },
    });
    engineRef.current = engine;
    engine.setSound(sound);
    if (import.meta.env.DEV) {
      (window as unknown as { __ECHO__: GameEngine }).__ECHO__ = engine;
    }
    return () => { engine.destroy(); engineRef.current = null; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (phase === 'draft' && draft) {
        const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
        if (index >= 0 && draft.choices[index]) engineRef.current?.chooseUpgrade(draft.choices[index].id);
        if (event.code === 'KeyR') engineRef.current?.rerollDraft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, draft]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    localStorage.setItem('echo-abyss-sound', next ? 'on' : 'off');
    engineRef.current?.setSound(next);
  };

  const begin = (core = selectedCore, runDifficulty = difficulty, runSeed = seed, runMode = gameMode, challenge = selectedLevel) => {
    setSelectedCore(core);
    setDifficulty(runDifficulty);
    setGameMode(runMode);
    setSelectedLevel(Math.max(1, challenge));
    setLevelChapter(Math.floor((Math.max(1, challenge) - 1) / 10));
    setSeed(runSeed);
    setResult(null);
    setDraft(null);
    setToasts([]);
    setHelp(false);
    setBonusEditor(false);
    void engineRef.current?.start(core, runDifficulty, runSeed, runMode, challenge, runMode === 'level' ? bonusLoadout : undefined);
  };

  const exitToMenu = () => {
    engineRef.current?.pause();
    setPhase('menu');
    setDraft(null);
    setResult(null);
    setToasts([]);
    setBonusEditor(false);
    setSeed(createSeed());
    refreshRecords();
  };

  const prepareLevel = (level: number) => {
    engineRef.current?.pause();
    const next = Math.max(1, Math.min(LEVELS.length, level));
    setPhase('menu');
    setGameMode('level');
    setDifficulty('standard');
    setSelectedLevel(next);
    setLevelChapter(Math.floor((next - 1) / 10));
    setDraft(null);
    setResult(null);
    setToasts([]);
    setSeed(createSeed());
    refreshRecords();
    setBonusEditor(true);
  };

  const changeBonus = (id: InitialBonusId, delta: number) => {
    const definition = INITIAL_BONUSES.find(bonus => bonus.id === id)!;
    const currentRank = bonusLoadout[id] ?? 0;
    const nextRank = Math.max(0, Math.min(definition.maxRank, currentRank + delta));
    if (nextRank === currentRank) return;
    if (delta > 0 && countBonusRanks(bonusLoadout) >= getBonusPoints(campaignXp)) return;
    const next = { ...bonusLoadout, [id]: nextRank };
    setBonusLoadout(saveInitialBonuses(next, campaignXp));
  };

  const resetBonuses = () => setBonusLoadout(saveInitialBonuses({}, campaignXp));
  const selectedChallenge = LEVELS[selectedLevel - 1]!;
  const visibleLevels = LEVELS.slice(levelChapter * 10, levelChapter * 10 + 10);
  const bonusPoints = getBonusPoints(campaignXp);
  const usedBonusPoints = countBonusRanks(bonusLoadout);
  const activeBonusNames = INITIAL_BONUSES.filter(bonus => (bonusLoadout[bonus.id] ?? 0) > 0).map(bonus => `${bonus.name} LV.${bonusLoadout[bonus.id]}`);
  const initialBuildSummary = activeBonusNames.length
    ? `${activeBonusNames.slice(0, 2).join(' / ')}${activeBonusNames.length > 2 ? ` ほか${activeBonusNames.length - 2}` : ''}`
    : 'ボーナス未装備（基本性能で開始）';
  const inRun = phase !== 'menu';
  const infiniteClear = Boolean(result?.gameMode === 'infinite' && result.victory);

  return (
    <main className={`app ${inRun ? 'app--game' : 'app--menu'} ${phase === 'gameover' ? 'app--gameover' : ''}`}>
      <canvas ref={canvasRef} className="game-canvas" aria-label="ECHO ABYSS ゲームフィールド" />
      <div className="noise" aria-hidden="true" />

      {phase === 'menu' && (
        <section className="menu-screen">
          <div className="menu-keyart" aria-hidden="true" />
          <div className="menu-vignette" aria-hidden="true" />
          <header className="menu-header">
            <Brand compact />
            <div className="build-label"><span /> OBSIDIAN RESEARCH <b>//</b> BUILD 01.00</div>
            <div className="header-actions">
              <button className="icon-button" onClick={toggleSound} aria-label={sound ? 'サウンドをオフ' : 'サウンドをオン'}>
                {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button className="text-button" onClick={() => setHelp(true)}><Keyboard size={17} /> 遊び方</button>
            </div>
          </header>

          <div className="menu-layout">
            <div className="hero-copy">
              <div className="eyebrow"><span>TEMPORAL COMBAT ROGUELITE</span></div>
              <h1>ECHO<span>//</span><br />ABYSS</h1>
              <p className="hero-japanese">過去の自分と、未来を切り拓け。</p>
              <p className="hero-description">
                深淵で戦った数秒前の「あなた」が、もう一度戦う。<br />
                時間の残響を召喚し、共鳴し、終わりのない敵を穿て。
              </p>
              <div className="feature-line">
                <span><GitBranch size={14} /> 時間残響</span>
                <span><Layers3 size={14} /> 29 進化</span>
                <span><InfinityIcon size={14} /> 最大{INFINITE_MAX_SECTOR}セクター + 100ステージ</span>
              </div>
              <div className="record-line">
                <div><small>PERSONAL BEST</small><strong>{bestScore ? number(bestScore) : '——'}</strong></div>
                <i />
                <div><small>DEEPEST TIMELINE</small><strong>{bestSector ? String(bestSector).padStart(2, '0') : '——'}</strong></div>
              </div>
            </div>

            <div className={`launch-panel glass-panel ${gameMode === 'level' ? 'launch-panel--campaign' : ''}`}>
              <div className="panel-heading">
                <div><small>LOADOUT</small><h2>フレームを選択</h2></div>
                <span className="step-label">01 — 03</span>
              </div>
              <div className="core-list">
                {CORES.map(core => (
                  <button
                    key={core.id}
                    className={`core-card ${selectedCore === core.id ? 'selected' : ''}`}
                    onClick={() => setSelectedCore(core.id)}
                    style={{ '--core-color': core.color } as React.CSSProperties}
                  >
                    <span className="core-icon"><CoreIcon core={core.id} /></span>
                    <span className="core-info">
                      <span className="core-code">{core.code}</span>
                      <strong>{core.name}</strong>
                      <small>{core.weapon}</small>
                    </span>
                    <span className="core-check">{selectedCore === core.id ? <Check size={16} /> : <ChevronRight size={16} />}</span>
                    <span className="core-tooltip">{core.description}<b>{core.trait}</b></span>
                  </button>
                ))}
              </div>
              <div className="selected-trait">
                <Sparkles size={14} />
                <span><b>{CORES.find(core => core.id === selectedCore)?.trait}</b>{CORES.find(core => core.id === selectedCore)?.description}</span>
              </div>

              <div className="mode-row run-mode-row">
                <span>ゲームモード</span>
                <div className="segmented mode-segmented">
                  <button className={gameMode === 'infinite' ? 'active' : ''} onClick={() => setGameMode('infinite')}><InfinityIcon size={12} /> INFINITE</button>
                  <button className={gameMode === 'level' ? 'active' : ''} onClick={() => { setGameMode('level'); setDifficulty('standard'); }}><Trophy size={12} /> LEVEL</button>
                </div>
              </div>
              {gameMode === 'infinite' ? (
                <div className="mode-row difficulty-row">
                  <span>難易度</span>
                  <div className="segmented">
                    <button className={difficulty === 'standard' ? 'active' : ''} onClick={() => setDifficulty('standard')}>STANDARD</button>
                    <button className={difficulty === 'abyss' ? 'active danger' : ''} onClick={() => setDifficulty('abyss')} title="敵HP ×1.55 / ワーデンHP ×2 / 出現 ×1.4 / 敵速度 ×1.1 / 敵攻撃 ×1.2">ABYSS <small>EXTREME</small></button>
                  </div>
                </div>
              ) : (
                <div className="level-setup">
                  <div className="level-setup-heading"><span>CAMPAIGN // 100 STAGES</span><small>{formatStage(unlockedLevel)} / 100 UNLOCKED</small></div>
                  <button className="campaign-loadout" onClick={() => setBonusEditor(true)} aria-label="初期ボーナスを編集">
                    <span><small>CAMPAIGN EXP</small><strong>{number(campaignXp)} <em>XP</em></strong></span>
                    <span><small>INITIAL BONUS</small><strong>{usedBonusPoints} <em>/ {bonusPoints} PT</em></strong></span>
                    <span className="campaign-loadout-edit"><SlidersHorizontal size={14} /> 編集</span>
                  </button>
                  <div className="chapter-selector">
                    <button disabled={levelChapter === 0} onClick={() => setLevelChapter(chapter => Math.max(0, chapter - 1))} aria-label="前の10ステージ"><ChevronLeft size={13} /></button>
                    <span>SECTOR {String(levelChapter + 1).padStart(2, '0')}<small>{formatStage(levelChapter * 10 + 1)} — {formatStage(levelChapter * 10 + 10)}</small></span>
                    <button disabled={levelChapter === 9} onClick={() => setLevelChapter(chapter => Math.min(9, chapter + 1))} aria-label="次の10ステージ"><ChevronRight size={13} /></button>
                  </div>
                  <div className="level-selector">
                    {visibleLevels.map(level => {
                      const locked = level.id > unlockedLevel;
                      return (
                        <button key={level.id} disabled={locked} className={selectedLevel === level.id ? 'selected' : ''} onClick={() => setSelectedLevel(level.id)} aria-label={`レベル${level.id} ${level.name}${locked ? ' ロック中' : ''}`}>
                          <strong>{formatStage(level.id)}</strong><small>{level.name}</small>{locked ? <Lock size={9} /> : level.id < unlockedLevel ? <Check size={9} /> : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="level-brief">
                    <div><strong>{selectedChallenge.sectorName} / {selectedChallenge.name}<small>LEVEL {formatStage(selectedChallenge.id)} // {selectedChallenge.enName}</small></strong><b>敵HP ×{selectedChallenge.enemyHealth.toFixed(2)}</b></div>
                    <p>{selectedChallenge.briefing}</p>
                    <div className="stage-parameters"><span>WARDEN 0{selectedChallenge.bossTier}</span><span>戦闘 {selectedChallenge.combatDuration}s</span><span>FIRST +{selectedChallenge.xpReward} XP</span></div>
                    <div className="initial-build" title={activeBonusNames.join(' / ')}><Layers3 size={13} /><span><small>INITIAL BONUS // {usedBonusPoints} PT</small>{initialBuildSummary}</span></div>
                  </div>
                </div>
              )}
              <div className="seed-row"><span>TIMELINE SEED</span><button onClick={() => setSeed(createSeed())} title="シードを変更">{seed} <RotateCcw size={12} /></button></div>
              <button className="launch-button" onClick={() => begin()}>
                <span className="launch-icon"><Play size={20} fill="currentColor" /></span>
                <span><small>{gameMode === 'level' ? `INITIALIZE LEVEL ${formatStage(selectedLevel)}` : 'INITIALIZE TIMELINE'}</small><strong>{gameMode === 'level' ? `レベル${formatStage(selectedLevel)}を開始` : '潜行を開始'}</strong></span>
                <ArrowRight size={22} />
              </button>
              <p className="launch-note"><span /> {gameMode === 'level' ? `初期ボーナス ${usedBonusPoints}Pt。ワーデン＋残敵の全滅でクリア。` : difficulty === 'abyss' ? `ABYSS：敵HP ×1.55・ワーデンHP ×2・高密度。${INFINITE_CHECKPOINT_INTERVAL}セクターごとに継続／終了を選択。` : `${INFINITE_CHECKPOINT_INTERVAL}セクターごとに継続／終了を選択。最大${INFINITE_MAX_SECTOR}セクター。`}</p>
            </div>
          </div>

          <footer className="menu-footer">
            <div className="control-hints">
              <span><kbd>WASD</kbd> 移動</span>
              <span><kbd>MOUSE</kbd> 照準・射撃</span>
              <span><kbd>SPACE</kbd> ダッシュ</span>
              <span><kbd>R</kbd> 武器スキル</span>
              <span><kbd>E</kbd> 残響召喚</span>
              <span><kbd>Q</kbd> ZERO FIELD</span>
            </div>
            <span className="footer-status"><i /> SYSTEM NOMINAL</span>
          </footer>
        </section>
      )}

      {inRun && hud && (
        <section className="hud" aria-label="ゲーム情報">
          <div className="hud-top">
            <div className="hud-left">
              <Brand compact />
              <div className="vitals-panel">
                <div className="vitals-label"><span><Heart size={13} /> FRAME INTEGRITY</span><strong>{Math.ceil(hud.hp)} <small>/ {hud.maxHp}</small></strong></div>
                <div className="health-track"><i style={{ width: `${Math.max(0, hud.hp / hud.maxHp * 100)}%` }} /><b style={{ width: `${Math.max(0, hud.hp / hud.maxHp * 100)}%` }} /></div>
                <div className="xp-row"><span>LV.{String(hud.level).padStart(2, '0')}</span><div><i style={{ width: `${Math.min(100, hud.xp / hud.xpNext * 100)}%` }} /></div><small>{Math.floor(hud.xp)} / {hud.xpNext}</small></div>
              </div>
            </div>

            <div className={`timeline-panel ${hud.challengeCleanup ? 'is-cleanup' : ''}`} title={hud.gameMode === 'level' ? `LEVEL ${formatStage(hud.challengeLevel)}: ワーデンと残敵を全滅させてクリア` : hud.anomaly?.description ?? '安定した時間領域'}>
              <small>{hud.gameMode === 'level' ? 'CAMPAIGN STAGE' : 'T I M E L I N E'}</small>
              <div><strong>{hud.gameMode === 'level' ? formatStage(hud.challengeLevel) : String(hud.sector).padStart(2, '0')}</strong><span><b>{time(hud.elapsed)}</b><small>{hud.boss ? 'WARDEN ENGAGED' : hud.challengeCleanup ? `残敵 ${hud.remainingEnemies} // 全滅でクリア` : hud.gameMode === 'level' ? hud.challengeName : hud.anomaly?.name ?? 'STABLE TIMELINE'}</small></span></div>
              <div className="timeline-track"><i style={{ width: `${Math.min(100, hud.sectorProgress * 100)}%` }} /></div>
            </div>

            <div className="hud-right">
              <div className="score-panel"><small>SYNC SCORE</small><strong>{number(hud.score).padStart(7, '0')}</strong><span>{hud.gameMode === 'level' ? `LEVEL ${formatStage(hud.challengeLevel)} // ${hud.challengeName}` : hud.difficulty === 'abyss' ? 'ABYSS ×1.5' : hud.weapon}</span></div>
              <button className="icon-button hud-button" onClick={toggleSound} aria-label="サウンド切り替え">{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
              <button className="icon-button hud-button" onClick={() => engineRef.current?.togglePause()} aria-label="一時停止"><Pause size={18} /></button>
            </div>
          </div>

          {hud.boss && (
            <div className="boss-hud">
              <div><span><Radio size={13} /> ABYSSAL ENTITY</span><strong>{hud.boss.name}</strong><small>PHASE 0{hud.boss.phase}</small></div>
              <div className="boss-track"><i style={{ width: `${hud.boss.hp / hud.boss.maxHp * 100}%` }} /></div>
            </div>
          )}

          {hud.challengeCleanup && (
            <div className="cleanup-objective"><Check size={17} /><span><small>WARDEN ERASED</small><strong>残敵を全滅</strong></span><b>{String(hud.remainingEnemies).padStart(2, '0')}</b></div>
          )}

          {hud.rift && (
            <div className={`rift-objective ${hud.rift.inside ? 'is-inside' : ''}`}>
              <div className="rift-heading">
                <Navigation size={18} style={{ transform: `rotate(${hud.rift.angle * 180 / Math.PI + 90}deg)` }} />
                <span><small>OPTIONAL // {Math.ceil(hud.rift.life)}s</small><strong>SYNC RIFT</strong></span>
                <b>{hud.rift.inside ? `${Math.floor(hud.rift.progress * 100)}%` : `${Math.round(hud.rift.distance / 10)}m`}</b>
              </div>
              <div className="rift-progress"><i style={{ width: `${hud.rift.progress * 100}%` }} /></div>
              <p>{hud.rift.inside ? '円内で安定化（累計4秒）' : '進行保持 · 再入場で再開'}<span>ZERO +35 · HP +15%</span></p>
            </div>
          )}

          <div className="toast-stack" aria-live="polite">
            {toasts.map(toast => (
              <div className={`game-toast toast--${toast.tone ?? 'cyan'}`} key={toast.id}>
                <small>{toast.eyebrow}</small><strong>{toast.title}</strong>{toast.detail && <span>{toast.detail}</span>}
              </div>
            ))}
          </div>

          {hud.combo > 1 && (
            <div className="combo-counter"><small>RESONANCE</small><strong>{hud.combo}<span>×</span></strong><i style={{ width: `${Math.min(100, hud.combo * 5)}%` }} /></div>
          )}

          {hud.tutorialStep < 5 && phase === 'running' && (
            <div className="pilot-guide">
              <div className="pilot-guide-heading"><span><Gamepad2 size={14} /> PILOT LINK</span><b>0{hud.tutorialStep + 1} / 05</b></div>
              <strong>{PILOT_STEPS[hud.tutorialStep]?.title}</strong>
              <p>{PILOT_STEPS[hud.tutorialStep]?.detail}{hud.tutorialStep === 4 && <b>「{hud.weaponSkillName}」</b>}</p>
              <div className="pilot-guide-progress">{PILOT_STEPS.map((_, index) => <i key={index} className={index <= hud.tutorialStep ? 'active' : ''} />)}</div>
            </div>
          )}

          <div className="ability-dock">
            <Ability
              icon={<ChevronRight size={23} />} label="位相ダッシュ" hotkey="SPACE"
              description="発動中は無敵。敵と弾幕をすり抜ける"
              ready={hud.dashCooldown <= 0} progress={1 - hud.dashCooldown / hud.dashMaxCooldown}
              cooldown={hud.dashCooldown} onClick={() => engineRef.current?.triggerDash()}
            />
            <Ability
              icon={<CoreIcon core={hud.core} size={21} />} label={hud.weaponSkillName} hotkey="R"
              description={hud.weaponSkillDescription}
              ready={hud.weaponCooldown <= 0} progress={1 - hud.weaponCooldown / hud.weaponMaxCooldown}
              cooldown={hud.weaponCooldown} onClick={() => engineRef.current?.triggerWeaponSkill()}
            />
            <Ability
              icon={<Copy size={21} />} label="残響召喚" hotkey="E"
              description="過去の移動と射撃を再生し、射線を現在の敵へ補正する分身を召喚"
              ready={hud.echoCooldown <= 0} progress={1 - hud.echoCooldown / hud.echoMaxCooldown}
              cooldown={hud.echoCooldown} badge={`${hud.activeEchoes}/${hud.maxEchoes}`}
              onClick={() => engineRef.current?.triggerEcho()} primary
            />
            <Ability
              icon={<Zap size={22} />} label="ZERO FIELD" hotkey="Q"
              description="敵と弾幕を遅延し、攻撃速度を上げる究極能力"
              ready={hud.sync >= 100} progress={hud.overdrive > 0 ? 1 : hud.sync / 100}
              active={hud.overdrive > 0} cooldown={hud.overdrive}
              onClick={() => engineRef.current?.triggerOverdrive()} ultimate
            />
          </div>
          <div className="weapon-readout" style={{ '--weapon-color': CORES.find(core => core.id === hud.core)?.color } as React.CSSProperties}>
            <span className="weapon-readout-icon"><CoreIcon core={hud.core} size={20} /></span>
            <span><small>WEAPON // {hud.weapon}</small><strong>{hud.weaponDetail}</strong><em><kbd>R</kbd>{hud.weaponSkillName}</em></span>
          </div>
          <div className="manual-fire-hint"><MousePointer2 size={14} /><span><b>LMB</b> FIRE · <b>RMB / R</b> SKILL</span></div>
          <div className="run-meta"><span>SEED // {hud.seed}</span><span>{hud.kills} HOSTILES ERASED</span></div>
          {hud.shield && <div className="shield-indicator"><ShieldCheck size={14} /> シールド展開中</div>}
        </section>
      )}

      {phase === 'running' && <TouchControls engine={engineRef.current} />}

      {phase === 'draft' && draft && (
        <section className="modal-layer draft-layer">
          <div className="draft-backdrop" />
          <div className="draft-container">
            <div className="draft-heading">
              <div className="draft-symbol">{draft.reason === 'boss' ? <Trophy size={28} /> : <Sparkles size={28} />}</div>
              <small>{draft.reason === 'boss' ? 'ABYSSAL CORE ACQUIRED' : 'EVOLUTION AVAILABLE'}</small>
              <h2>{draft.reason === 'boss' ? '深淵のコアを接続' : '進化を選択'}</h2>
              <p>{draft.reason === 'boss' ? 'ワーデンの残滓が、高純度の可能性を残した。' : 'タイムラインが分岐する。ひとつを選び、さらに深くへ。'}</p>
            </div>
            <div className="upgrade-grid">
              {draft.choices.map((upgrade, index) => {
                const stack = draft.stacks[upgrade.id] ?? 0;
                return (
                  <button className={`upgrade-card rarity--${upgrade.rarity}`} key={upgrade.id} onClick={() => engineRef.current?.chooseUpgrade(upgrade.id)}>
                    <span className="upgrade-number">0{index + 1}</span>
                    <span className="upgrade-rarity">{upgrade.rarity === 'epic' ? 'ABYSSAL' : upgrade.rarity === 'rare' ? 'ADVANCED' : 'STANDARD'}</span>
                    <span className="upgrade-icon"><UpgradeIcon icon={upgrade.icon} /></span>
                    <span className="upgrade-category">{CATEGORY_LABELS[upgrade.category]} // {upgrade.enName}</span>
                    <strong>{upgrade.name}</strong>
                    <span className="upgrade-description">{upgrade.description}</span>
                    <span className="stack-pips">
                      {Array.from({ length: upgrade.maxStacks }, (_, pip) => <i key={pip} className={pip < stack ? 'filled' : pip === stack ? 'next' : ''} />)}
                      <small>{stack > 0 ? `LV.${stack} → LV.${stack + 1}` : 'NEW'}</small>
                    </span>
                    <span className="install-label">強化を適用 <ArrowRight size={15} /></span>
                  </button>
                );
              })}
            </div>
            <div className="draft-footer">
              <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 選択</span>
              <button className="reroll-button" disabled={draft.rerolls <= 0} onClick={() => engineRef.current?.rerollDraft()}><Dices size={17} /> 選択肢を再構成 <b>{draft.rerolls}</b><kbd>R</kbd></button>
              <span className="draft-paused"><Pause size={12} /> TIME SUSPENDED</span>
            </div>
          </div>
        </section>
      )}

      {phase === 'paused' && (
        <section className="modal-layer pause-layer">
          <div className="pause-panel glass-panel">
            <div className="pause-icon"><Pause size={28} /></div>
            <small>TIMELINE SUSPENDED</small>
            <h2>時間停止中</h2>
            <p>深淵は待ってくれる。あなたの準備ができるまで。</p>
            {hud && <div className="pause-stats"><span>{hud.gameMode === 'level' ? 'LEVEL' : 'TIMELINE'} <b>{hud.gameMode === 'level' ? formatStage(hud.challengeLevel) : String(hud.sector).padStart(2, '0')}</b></span><span>SCORE <b>{number(hud.score)}</b></span><span>LEVEL <b>{hud.level}</b></span></div>}
            <button className="primary-button" onClick={() => engineRef.current?.resume()}><Play size={18} fill="currentColor" /> 戦闘へ戻る <kbd>ESC</kbd></button>
            <button className="secondary-button" onClick={() => setHelp(true)}><Keyboard size={17} /> 操作・システムを確認</button>
            <button className="quiet-button" onClick={exitToMenu}><ArrowLeft size={16} /> 潜行を断念してタイトルへ</button>
          </div>
        </section>
      )}

      {phase === 'checkpoint' && hud && (
        <section className="modal-layer pause-layer checkpoint-layer">
          <div className="pause-panel glass-panel checkpoint-panel">
            <div className="pause-icon checkpoint-icon"><Check size={28} /></div>
            <small>TIMELINE CHECKPOINT // SCORE SAVED</small>
            <h2>SECTOR {String(hud.sector).padStart(2, '0')}</h2>
            <p>ここで終えるか、さらに深部へ進むか選択できます。</p>
            <div className="pause-stats">
              <span>SCORE <b>{number(hud.score)}</b></span>
              <span>ERASED <b>{number(hud.kills)}</b></span>
              <span>NEXT <b>{String(hud.sector + 1).padStart(2, '0')}</b></span>
            </div>
            <div className="checkpoint-record"><Check size={14} /> 現在の得点と最深セクターを記録しました</div>
            <button className="primary-button" onClick={() => engineRef.current?.continueInfinite()}><ArrowRight size={18} /> セクター{String(hud.sector + 1).padStart(2, '0')}へ進む <span>CONTINUE</span></button>
            <button className="secondary-button" onClick={() => engineRef.current?.finishInfinite()}><Trophy size={17} /> ここで終了して結果を確定</button>
            <small className="checkpoint-limit">{INFINITE_CHECKPOINT_INTERVAL}セクターごとに選択 // 最大{INFINITE_MAX_SECTOR}セクター</small>
          </div>
        </section>
      )}

      {phase === 'gameover' && result && (
        <section className={`modal-layer result-layer ${result.victory ? 'result-layer--victory' : ''}`}>
          <div className="result-vignette" />
          <div className="result-panel">
            <div className="result-heading">
              <small>{result.victory ? infiniteClear ? `TIMELINE COMPLETE // ${result.sector} SECTORS` : `CHALLENGE COMPLETE // LEVEL ${formatStage(result.challengeLevel)}` : `SIMULATION TERMINATED // ${result.difficulty.toUpperCase()}`}</small>
              <h2>{result.victory ? infiniteClear ? <>TIME <span>CLEAR</span></> : <>LEVEL <span>CLEAR</span></> : <>SIGNAL <span>LOST</span></>}</h2>
              <p>{result.victory ? infiniteClear ? result.sector >= INFINITE_MAX_SECTOR ? `最大の${INFINITE_MAX_SECTOR}セクターへ到達。最終スコアを記録し、この時間を完走しました。` : `セクター${result.sector}で潜行を終了。到達時点のスコアと最深記録を保存しました。` : result.challengeLevel < LEVELS.length ? result.firstClear ? `LEVEL ${formatStage(result.challengeLevel + 1)} 解放。獲得EXPで初期ボーナスを強化できます。` : 'ステージを再攻略。EXPを持ち帰り、別の初期編成も試せます。' : '全100ステージを突破。無限深海は、あなたの時間に書き換えられた。' : 'この時間のあなたは消えた。だが、記録は次へ引き継がれる。'}</p>
              {result.newBest && <div className="new-record"><Trophy size={15} /> NEW PERSONAL BEST</div>}
            </div>
            <div className="final-score"><small>FINAL SYNC SCORE</small><strong>{number(result.score)}</strong><span>{result.gameMode === 'level' ? `LEVEL ${formatStage(result.challengeLevel)} // ${LEVELS[result.challengeLevel - 1]?.name ?? ''}` : infiniteClear ? `TIMELINE ${String(result.sector).padStart(2, '0')} // COMPLETE` : `TIMELINE ${String(result.sector).padStart(2, '0')} に到達`}</span></div>
            {result.gameMode === 'level' && result.victory && (
              <div className="xp-reward"><Trophy size={18} /><span><small>{result.firstClear ? 'FIRST CLEAR REWARD' : 'REPEAT CLEAR REWARD'}</small><strong>+{number(result.xpEarned)} <em>XP</em></strong></span><span><small>CAMPAIGN TOTAL</small><b>{number(result.totalXp)} XP / {result.bonusPoints} PT</b></span></div>
            )}
            <div className="result-stats">
              <div><Clock3 size={17} /><small>{result.victory ? 'CLEAR TIME' : 'SURVIVAL'}</small><strong>{time(result.elapsed)}</strong></div>
              <div><Swords size={17} /><small>ERASED</small><strong>{number(result.kills)}</strong></div>
              <div><Activity size={17} /><small>RUN LEVEL</small><strong>{result.level}</strong></div>
              <div><Copy size={17} /><small>ECHOES</small><strong>{result.echoes}</strong></div>
              <div><GitBranch size={17} /><small>BEST SYNC</small><strong>{result.bestCombo}×</strong></div>
            </div>
            <div className="result-actions">
              {result.victory && result.gameMode === 'level' && result.challengeLevel < LEVELS.length ? (
                <>
                  <button className="primary-button" onClick={() => prepareLevel(result.challengeLevel + 1)}><ArrowRight size={18} /> 次のレベルを準備 <span>LEVEL {formatStage(result.challengeLevel + 1)}</span></button>
                  <button className="secondary-button" onClick={() => begin(result.core, result.difficulty, result.seed, result.gameMode, result.challengeLevel)}><RotateCcw size={18} /> 同じレベルをやり直す</button>
                </>
              ) : (
                <>
                  <button className="primary-button" onClick={() => begin(result.core, result.difficulty, result.seed, result.gameMode, result.challengeLevel || 1)}><RotateCcw size={18} /> 同じ時間へ戻る <span>RETRY SEED</span></button>
                  {result.gameMode === 'level' ? (
                    <button className="secondary-button" onClick={() => prepareLevel(result.challengeLevel || 1)}><SlidersHorizontal size={18} /> 初期ボーナスを調整</button>
                  ) : (
                    <button className="secondary-button" onClick={() => begin(result.core, result.difficulty, createSeed(), result.gameMode, result.challengeLevel || 1)}><GitBranch size={18} /> 新しいタイムラインへ</button>
                  )}
                </>
              )}
            </div>
            <button className="quiet-button" onClick={exitToMenu}><ArrowLeft size={15} /> タイトルへ戻る</button>
            <div className="result-seed">FRAME // {CORES.find(core => core.id === result.core)?.name} <i /> SEED // {result.seed}</div>
          </div>
        </section>
      )}

      {help && <HelpModal onClose={() => setHelp(false)} />}
      {bonusEditor && phase === 'menu' && (
        <BonusEditor xp={campaignXp} loadout={bonusLoadout} onChange={changeBonus} onReset={resetBonuses} onClose={() => setBonusEditor(false)} />
      )}
    </main>
  );
}

function Ability({ icon, label, hotkey, ready, progress, cooldown, onClick, badge, primary, ultimate, active, description }: {
  icon: React.ReactNode; label: string; hotkey: string; ready: boolean; progress: number;
  cooldown: number; onClick: () => void; badge?: string; primary?: boolean; ultimate?: boolean; active?: boolean; description?: string;
}) {
  return (
    <button className={`ability ${ready ? 'ready' : ''} ${primary ? 'primary' : ''} ${ultimate ? 'ultimate' : ''} ${active ? 'active' : ''}`} onClick={onClick} title={description} aria-label={`${hotkey}: ${label}${description ? ` — ${description}` : ''}`}>
      <span className="ability-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} />
      <kbd>{hotkey}</kbd>
      <span className="ability-icon">{icon}{!ready && cooldown > 0 && <b>{cooldown.toFixed(1)}</b>}</span>
      <span className="ability-label"><strong>{label}</strong><small>{active ? '時間遅延中' : ready ? ultimate ? '発動可能' : '使用可能' : ultimate ? `ゲージ ${Math.floor(progress * 100)}%` : '冷却中'}</small></span>
      {badge && <span className="ability-badge">{badge}</span>}
    </button>
  );
}

function BonusEditor({ xp, loadout, onChange, onReset, onClose }: {
  xp: number;
  loadout: BonusLoadout;
  onChange: (id: InitialBonusId, delta: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const points = getBonusPoints(xp);
  const used = countBonusRanks(loadout);
  const available = points - used;
  const nextPointXp = getNextBonusPointXp(xp);
  const currentThreshold = 18 * points * points;
  const progress = nextPointXp === null ? 1 : Math.max(0, Math.min(1, (xp - currentThreshold) / Math.max(1, nextPointXp - currentThreshold)));
  return (
    <section className="modal-layer bonus-layer" role="dialog" aria-modal="true" aria-label="初期ボーナス編成">
      <div className="bonus-panel glass-panel">
        <button className="close-button" onClick={onClose} aria-label="初期ボーナスを閉じる"><X size={20} /></button>
        <small className="help-eyebrow">CAMPAIGN LOADOUT // PERSISTENT</small>
        <h2>初期ボーナスを設計</h2>
        <p className="bonus-intro">ステージクリアで貯まるEXPに応じてポイントが増加。割り振ってもEXPは消費せず、いつでも無料で編成できます。全て乗算％強化です。</p>
        <div className="bonus-account">
          <div><small>CAMPAIGN EXP</small><strong>{number(xp)} <em>XP</em></strong></div>
          <div><small>AVAILABLE POINTS</small><strong>{available} <em>/ {points} PT</em></strong></div>
          <div><small>NEXT POINT</small><strong>{nextPointXp === null ? 'MAX' : `${number(Math.max(0, nextPointXp - xp))} XP`}</strong></div>
        </div>
        <div className="bonus-xp-track"><i style={{ width: `${progress * 100}%` }} /></div>
        <div className="bonus-grid">
          {INITIAL_BONUSES.map(bonus => {
            const rank = loadout[bonus.id] ?? 0;
            const effect = Math.round((Math.pow(1 + bonus.percent / 100, rank) - 1) * 100);
            return (
              <article className={`bonus-card ${rank > 0 ? 'active' : ''}`} key={bonus.id}>
                <span className="bonus-card-icon"><UpgradeIcon icon={bonus.icon} /></span>
                <div className="bonus-card-copy">
                  <small>{bonus.enName}</small>
                  <h3>{bonus.name}<b>1R +{bonus.percent}%</b></h3>
                  <p>{bonus.description}</p>
                  <span className="bonus-effect">{rank > 0 ? `現在 合計 +${effect}%` : '未装備'}<small>LV.{rank} / {bonus.maxRank}</small></span>
                </div>
                <div className="bonus-stepper">
                  <button disabled={rank <= 0} onClick={() => onChange(bonus.id, -1)} aria-label={`${bonus.name}を下げる`}><Minus size={15} /></button>
                  <strong>{String(rank).padStart(2, '0')}</strong>
                  <button disabled={available <= 0 || rank >= bonus.maxRank} onClick={() => onChange(bonus.id, 1)} aria-label={`${bonus.name}を強化`}><Plus size={15} /></button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="bonus-footer">
          <button className="quiet-button" disabled={used === 0} onClick={onReset}><RotateCcw size={14} /> 全てリセット</button>
          <span>ステージ内の進化・レベルは次回開始時にリセット</span>
          <button className="primary-button" onClick={onClose}><Check size={16} /> この編成で閉じる</button>
        </div>
        {points >= MAX_BONUS_POINTS && <p className="bonus-max-note">初期ボーナスポイントは上限に達しています。</p>}
      </div>
    </section>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'systems' | 'codex'>('systems');
  const enemies = [
    { name: '追跡ドローン', role: '追跡', description: '赤い矢印。あなたへまっすぐ追いかける基本の敵。', color: '#ff6078', icon: <Navigation size={20} /> },
    { name: '高速ダート', role: '突進', description: '橙色の尾翼付き。蛇行しながら高速で接近する。', color: '#ff9a62', icon: <ChevronsRight size={20} /> },
    { name: 'ガンナー', role: '射撃', description: 'ピンクの砲台。距離を保ち、敵弾を撃ってくる。', color: '#ef83ff', icon: <Crosshair size={20} /> },
    { name: 'スプリッター', role: '分裂', description: '二つの核を持つ球体。倒すと小型の敵2体に分裂。', color: '#ff7fae', icon: <Split size={20} /> },
    { name: 'タンク', role: '高耐久', description: '二重の大型六角形。低速だが耐久力が高い。', color: '#d66b89', icon: <Hexagon size={20} /> },
    { name: 'スナイパー', role: '長射程', description: '長い砲身。赤い照準線が固定されたら射線から離れる。', color: '#ff384f', icon: <ScanLine size={20} /> },
    { name: 'ウィーバー', role: '弾幕', description: '紫の星型。周囲へ6方向の回転弾幕を展開する。', color: '#c27bff', icon: <Sparkles size={20} /> },
    { name: 'AION // WARDEN', role: 'ボス', description: '3タイムラインごとに出現。外周リングの収縮が攻撃予兆。', color: '#ff405f', icon: <Radio size={20} /> },
  ];
  return (
    <section className="modal-layer help-layer" role="dialog" aria-modal="true" aria-label="遊び方">
      <div className="help-panel glass-panel">
        <button className="close-button" onClick={onClose} aria-label="閉じる"><X size={20} /></button>
        <small className="help-eyebrow">FIELD MANUAL // 01</small>
        <h2>{tab === 'systems' ? '過去と連携し、深淵を生き延びろ。' : '武器と敵を、見た目で理解する。'}</h2>
        <div className="help-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'systems'} className={tab === 'systems' ? 'active' : ''} onClick={() => setTab('systems')}><Keyboard size={15} /> 操作・能力</button>
          <button role="tab" aria-selected={tab === 'codex'} className={tab === 'codex' ? 'active' : ''} onClick={() => setTab('codex')}><ScanLine size={15} /> 武器・敵図鑑</button>
        </div>
        {tab === 'systems' ? (
          <>
            <p className="help-intro">近敵へのオート射撃に加え、マウス長押しで自由に照準・射撃できます。敵の欠片で進化し、3タイムラインごとのワーデンを撃破してください。</p>
            <div className="help-controls">
              <div><kbd>W A S D</kbd><span><strong>移動</strong><small>矢印キーでも操作可能。「YOU」が自機</small></span></div>
              <div><kbd>MOUSE</kbd><span><strong>照準・手動射撃</strong><small>左長押しで連射。左を押したまま右クリックでも技能発動</small></span></div>
              <div><kbd>SPACE</kbd><span><strong>位相ダッシュ</strong><small>発動中は無敵。すり抜けて回避</small></span></div>
              <div><kbd>R</kbd><span><strong>武器スキル</strong><small>フレーム固有の強力な能動攻撃</small></span></div>
              <div><kbd>E</kbd><span><strong>残響召喚</strong><small>数秒前の移動と射撃をもう一度再生</small></span></div>
              <div><kbd>Q</kbd><span><strong>ZERO FIELD</strong><small>共鳴で溜まる究極の時間遅延</small></span></div>
            </div>
            <div className="help-systems">
              <article><span><Copy size={21} /></span><div><small>01 // ECHO</small><h3>過去の自分は、最高の相棒</h3><p>残響は過去の移動と射撃タイミングを再生し、弾の向きだけを現在の敵へ自動補正します。ダッシュで位置を変え、残響と別方向から攻撃しましょう。</p></div></article>
              <article><span><GitBranch size={21} /></span><div><small>02 // RESONANCE</small><h3>同じ敵を、時間の両側から撃つ</h3><p>あなたと残響が短時間に同じ敵へ命中すると共鳴。追加ダメージとZEROゲージを得て、連鎖でスコアが伸びます。</p></div></article>
              <article><span><Zap size={21} /></span><div><small>03 // ZERO FIELD</small><h3>危機を、反撃の時間に変える</h3><p>ゲージ100%で発動。敵と弾幕が遅くなり、攻撃速度が上昇。ダッシュ・武器スキル・残響も即座に再使用できます。</p></div></article>
            </div>
            <p className="elite-note"><span /> SYNC RIFT はタイムライン02以降に現れる任意目標。円内で累計4秒維持すると、ZERO +35・最大HPの15%回復・欠片を獲得。円の外に出ても進行は減りません。</p>
            <p className="elite-note"><span /> LEVEL MODE は全100ステージ。ワーデンと残敵を全滅させるとクリアです。獲得した永続EXPで％初期ボーナスを自由に編成でき、ステージ内の進化は次回開始時にリセットされます。</p>
          </>
        ) : (
          <div className="codex-content">
            <section className="weapon-guide">
              {CORES.map(core => (
                <article key={core.id} style={{ '--guide-color': core.color } as React.CSSProperties}>
                  <span className="guide-icon"><CoreIcon core={core.id} size={23} /></span>
                  <div><small>{core.weapon}</small><h3>{core.name}<b>{core.trait}</b></h3><p>{core.description}</p><p className="guide-skill"><kbd>R</kbd><span><b>{WEAPON_SKILLS[core.id].name}</b>{WEAPON_SKILLS[core.id].description}</span></p></div>
                </article>
              ))}
            </section>
            <div className="codex-divider"><span>HOSTILE ARCHIVE</span><small>色・形・予備動作で判別</small></div>
            <section className="enemy-guide">
              {enemies.map(enemy => (
                <article key={enemy.name} style={{ '--guide-color': enemy.color } as React.CSSProperties}>
                  <span className="guide-icon">{enemy.icon}</span>
                  <div><h3>{enemy.name}<b>{enemy.role}</b></h3><p>{enemy.description}</p></div>
                </article>
              ))}
            </section>
            <p className="elite-note"><span /> 金色の外周リングはエリート個体。耐久が高く、倒すと多くの欠片とスコアを落とします。</p>
          </div>
        )}
        <button className="primary-button" onClick={onClose}><Check size={17} /> 理解した</button>
      </div>
    </section>
  );
}

function TouchControls({ engine }: { engine: GameEngine | null }) {
  const padRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!padRef.current || event.buttons === 0) return;
    const rect = padRef.current.getBoundingClientRect();
    let x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.35);
    let y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.35);
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    setKnob({ x, y });
    engine?.setTouchMove(x, y);
  };
  const end = () => { setKnob({ x: 0, y: 0 }); engine?.setTouchMove(0, 0); };
  return (
    <div className="touch-controls">
      <div ref={padRef} className="touch-pad" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); move(event); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <span style={{ transform: `translate(${knob.x * 30}px, ${knob.y * 30}px)` }} /><small>MOVE</small>
      </div>
      <div className="touch-actions">
        <button aria-label="武器スキル" onPointerDown={event => { event.preventDefault(); engine?.triggerWeaponSkill(); }}><Crosshair size={21} /><small>SKILL</small></button>
        <button aria-label="ZERO FIELD" onPointerDown={event => { event.preventDefault(); engine?.triggerOverdrive(); }}><Zap size={20} /><small>ZERO</small></button>
        <button aria-label="残響召喚" onPointerDown={event => { event.preventDefault(); engine?.triggerEcho(); }}><Copy size={22} /><small>ECHO</small></button>
        <button aria-label="位相ダッシュ" onPointerDown={event => { event.preventDefault(); engine?.triggerDash(); }}><ChevronRight size={25} /><small>DASH</small></button>
      </div>
    </div>
  );
}

export default App;
