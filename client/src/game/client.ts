import {
  BTN,
  type Cmd,
  CMDS_PER_PACKET_MAX,
  CollisionWorld,
  DEG,
  DUCK_EYE,
  type GameEvent,
  type GameMode,
  INTERP_DELAY_MS,
  MODE_LABEL,
  type MapDef,
  type MatchInfo,
  PLAYER_COLORS,
  TEAMS,
  ZOOM_SENSITIVITY_RATIO,
  PROTOCOL_VERSION,
  type PlayerState,
  RESPAWN_TICKS,
  RF_ALIVE,
  RF_DROP,
  RF_DUCK,
  RF_GROUND,
  RF_PROTECT,
  RF_RELOAD,
  type ResultRow,
  type RosterEntry,
  STAND_EYE,
  type ServerMsg,
  type ShotInfo,
  type VoteInfo,
  TICK_MS,
  TICK_RATE,
  WEAPON,
  type WeaponId,
  applyCmd,
  clamp,
  computeSpread,
  copyState,
  createPlayerState,
  encodeCmd,
  getMap,
  lerpAngle,
  rayHitbox,
  recoilOffset,
  unpackState,
  weaponDef,
} from '@calindra-strike/shared';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Settings } from '../settings.ts';
import { Hud, type LeaderRow, type Marker, type ScoreRow } from '../ui/hud.ts';
import { Sfx } from './audio.ts';
import { Input } from './input.ts';
import type { Connection } from './net.ts';
import { AirdropView } from './render/airdrop.ts';
import { Avatar } from './render/avatar.ts';
import { Effects } from './render/effects.ts';
import { PodiumScene } from './render/podium.ts';
import { ViewModel } from './render/viewmodel.ts';
import { type WorldView, buildWorld, followShadow } from './render/world.ts';

interface Snap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  w: number;
}

interface Remote {
  id: number;
  avatar: Avatar;
  buf: Snap[];
  visible: boolean;
  last: THREE.Vector3;
  speed: number;
  step: number;
  ground: boolean;
  dropping: boolean;
}

export interface Welcome {
  id: number;
  time: number;
  roster: RosterEntry[];
  match: MatchInfo;
  maxPlayers: number;
  token: string;
}

export interface PodiumData {
  mode: GameMode;
  featured: ResultRow[]; // who stands on the podium (TDM: best of the winning team)
  results: ResultRow[]; // full ranking, including both teams
  myId: number;
  winner: number; // TDM winning team, -1 draw / FFA
  teams: number[];
  myTeam: number;
  colorFor: (r: ResultRow) => string;
  vote: VoteInfo | null;
}

export interface TeamState {
  team: number;
  canSwitch: boolean;
}

export interface UiHooks {
  showClickToPlay(show: boolean): void;
  showMenu(show: boolean): void;
  showPodium(data: PodiumData | null, next: string): void;
  updateVotes(counts: number[], mine: number): void;
  updatePodiumCountdown(seconds: number): void;
  disconnected(reason: string, code: number): void;
}

const STREAKS: Record<number, string> = {
  2: 'double kill',
  3: 'triple kill',
  4: 'multi kill',
  5: 'rampage!',
  7: 'imparável',
  10: 'deus da forja',
};

const v3 = new THREE.Vector3();
const v3b = new THREE.Vector3();

export class ClientGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly input: Input;
  readonly hud: Hud;
  readonly sfx: Sfx;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(74, 1, 1, 12000);
  private readonly effects: Effects;
  private readonly view: ViewModel;
  private readonly podium = new PodiumScene();
  private readonly muzzleLight = new THREE.PointLight('#ffcf8a', 0, 420, 0);
  private world: WorldView | null = null;
  private collision!: CollisionWorld;
  private map!: MapDef;
  private mapIndex = -1;
  private sunDir = new THREE.Vector3();

  readonly myId: number;
  private readonly names = new Map<number, { name: string; personal: string; team: number; bot: boolean }>();
  private myVote = -1;
  private voteCounts: number[] = [];
  private teamScores = [0, 0];
  private readonly online = new Set<number>();
  private readonly scores = new Map<number, { kills: number; deaths: number; ping: number; streak: number; hs: number }>();
  match: MatchInfo;

  private readonly me: PlayerState = createPlayerState();
  private readonly serverState: PlayerState = createPlayerState();
  private prev = new THREE.Vector3();
  private alive = false;
  private pending: Cmd[] = [];
  private outbox: Cmd[] = [];
  private seq = 0;
  private correction = new THREE.Vector3();
  private eye = STAND_EYE;
  private punch = 0;
  private stepAcc = 0;
  private reloadStarted = 0;
  private reloadStages = 0;

  private readonly remotes = new Map<number, Remote>();
  private readonly airdrops = new Map<number, AirdropView>();

  private clockOffset = 0;
  private rtt = 0;
  private gotPong = false;
  private accum = 0;
  private lastFrame = 0;
  private tickCount = 0;
  private running = true;
  private raf = 0;
  private lastPing = 0;
  private fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private lastBeep = -1;

  private deathAt = 0;
  private deathPos = new THREE.Vector3();
  private killerId = -1;
  private scoreboardOpen = false;
  private chatOpen = false;
  private podiumActive = false;
  private menuOpen = false;
  private elapsed = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly net: Connection,
    private settings: Settings,
    welcome: Welcome,
    private readonly ui: UiHooks,
  ) {
    this.myId = welcome.id;
    this.match = welcome.match;
    this.clockOffset = welcome.time - performance.now();

    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === 'high' ? 1.75 : 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = true;
    container.append(this.renderer.domElement);
    this.renderer.domElement.tabIndex = -1;

    this.input = new Input(this.renderer.domElement);
    this.input.sensitivity = settings.sensitivity;
    this.input.onKey = (code, down, e) => this.onKey(code, down, e);
    this.hud = new Hud(container);
    this.sfx = new Sfx(settings.volume);
    this.effects = new Effects(this.scene);
    this.view = new ViewModel(PLAYER_COLORS[settings.color]);
    this.scene.add(this.camera, this.muzzleLight);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.view.setEnvironment(env);
    this.podium.scene.environment = env;
    this.podium.scene.environmentIntensity = 0.4;
    pmrem.dispose();
    if (import.meta.env.DEV) (window as unknown as { __game: ClientGame }).__game = this;

    this.setRoster(welcome.roster);
    this.loadMap(this.match.map);

    net.onMessage((m) => this.onMessage(m));
    net.onClose((code, reason) => {
      if (!this.running) return;
      this.running = false;
      if (document.pointerLockElement) document.exitPointerLock();
      const why =
        reason === 'policy' ? 'Conexão encerrada pelo servidor (tráfego inválido).' : code === 1006 ? 'A conexão caiu.' : reason || 'Desconectado do servidor.';
      this.ui.disconnected(why, code);
    });

    this.renderer.domElement.addEventListener('click', () => {
      if (!this.input.locked && !this.menuOpen) void this.requestPlay();
    });
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.hud.chatInput.addEventListener('keydown', this.onChatKey);
    this.onResize();
    this.ui.showClickToPlay(true);
    if (this.match.phase === 'podium') this.enterPodium(this.match);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ setup

  private onBeforeUnload = (e: BeforeUnloadEvent): void => {
    // guards against Ctrl+W (crouch + forward) closing the tab mid-match; off in dev for hot reload
    if (this.running && !import.meta.env.DEV) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.view.camera.aspect = w / h;
    this.view.camera.updateProjectionMatrix();
    this.podium.resize(w, h);
  };

  private onLockChange = (): void => {
    if (!this.running) return;
    if (this.input.locked) {
      this.menuOpen = false;
      this.ui.showMenu(false);
      this.ui.showClickToPlay(false);
      this.sfx.resume();
    } else if (!this.chatOpen && !this.podiumActive) {
      this.menuOpen = true;
      this.ui.showMenu(true);
    }
  };

  async requestPlay(): Promise<void> {
    this.sfx.resume();
    await this.input.lock();
  }

  applySettings(s: Settings): void {
    this.settings = s;
    this.input.sensitivity = s.sensitivity;
    this.sfx.setVolume(s.volume);
    this.net.send({ t: 'loadout', primary: s.primary });
  }

  private setRoster(roster: RosterEntry[]): void {
    this.online.clear();
    for (const [id, name, color, team, bot] of roster) {
      const prev = this.names.get(id);
      this.names.set(id, { name, personal: PLAYER_COLORS[color] ?? '#f0f0f0', team, bot: bot === 1 });
      this.online.add(id);
      if (prev && prev.team !== team) this.dropAvatar(id); // rebuilt next snapshot in the new team colour
    }
    for (const id of [...this.remotes.keys()]) if (!this.online.has(id)) this.dropAvatar(id);
    this.view.setSleeveColor(this.nameOf(this.myId).color);
  }

  private dropAvatar(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.avatar.root);
    r.avatar.dispose();
    this.remotes.delete(id);
  }

  /** Display identity: team colour in TDM, personal colour in free-for-all. */
  private nameOf(id: number): { name: string; color: string; team: number } {
    const n = this.names.get(id);
    if (!n) return { name: `#${id}`, color: '#9b9b94', team: -1 };
    const color = this.match.mode !== 'ffa' && n.team >= 0 ? TEAMS[n.team].color : n.personal;
    return { name: n.name, color, team: n.team };
  }

  get myTeam(): number {
    return this.names.get(this.myId)?.team ?? -1;
  }

  private isTeammate(id: number): boolean {
    const t = this.myTeam;
    return this.match.mode !== 'ffa' && t >= 0 && this.names.get(id)?.team === t;
  }

  teamState(): TeamState | null {
    if (this.match.mode !== 'tdm' || this.myTeam < 0) return null;
    let mine = 0;
    let other = 0;
    for (const id of this.online) {
      const t = this.names.get(id)?.team;
      if (t === this.myTeam) mine++;
      else if (t === 1 - this.myTeam) other++;
    }
    return { team: this.myTeam, canSwitch: this.match.phase !== 'podium' && other < mine };
  }

  switchTeam(): void {
    const st = this.teamState();
    if (st?.canSwitch) this.net.send({ t: 'team', team: 1 - st.team });
  }

  private loadMap(index: number): void {
    if (index === this.mapIndex) return;
    this.mapIndex = index;
    this.map = getMap(index);
    this.collision = new CollisionWorld(this.map);
    this.world?.dispose();
    this.world = buildWorld(this.map, this.scene, this.settings.quality);
    const t = this.map.theme;
    this.sunDir.set(t.sunDir.x, t.sunDir.y, t.sunDir.z).normalize();
    this.view.setLighting(t.hemiSky, t.hemiGround, t.sun, t.sunIntensity);
    for (const a of this.airdrops.values()) {
      this.scene.remove(a.group);
      a.dispose();
    }
    this.airdrops.clear();
    for (const r of this.remotes.values()) r.buf.length = 0;
    this.effects.clear();
  }

  serverNow(): number {
    return performance.now() + this.clockOffset;
  }

  // ------------------------------------------------------------------ messages

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'snap':
        this.onSnap(m);
        break;
      case 'ev':
        for (const e of m.e) this.onEvent(e);
        break;
      case 'roster':
        this.setRoster(m.roster);
        break;
      case 'score':
        this.scores.clear();
        for (const [id, kills, deaths, ping, streak, hs] of m.s) this.scores.set(id, { kills, deaths, ping, streak, hs });
        if (Array.isArray(m.ts)) this.teamScores = m.ts;
        break;
      case 'match':
        this.onMatch(m.match);
        break;
      case 'votes':
        this.voteCounts = m.counts;
        this.ui.updateVotes(m.counts, this.myVote);
        break;
      case 'pong': {
        const now = performance.now();
        const rtt = now - m.c;
        this.rtt = this.gotPong ? this.rtt * 0.8 + rtt * 0.2 : rtt;
        const sample = m.s + rtt / 2 - now;
        this.clockOffset = this.gotPong ? this.clockOffset + (sample - this.clockOffset) * 0.15 : sample;
        this.gotPong = true;
        break;
      }
      case 'chat': {
        const n = this.nameOf(m.id);
        this.hud.chatLine(n.name, n.color, m.text);
        break;
      }
      default:
        break;
    }
  }

  private onSnap(m: Extract<ServerMsg, { t: 'snap' }>): void {
    // drift guard: snapshots should never be "from the future"
    const est = this.serverNow();
    if (m.time > est + 30) this.clockOffset += (m.time - est) * 0.5;

    if (m.me) {
      unpackState(m.me, this.serverState);
      this.pending = this.pending.filter((c) => c.seq > m.ack);
      if (!this.alive) {
        this.alive = true;
        copyState(this.me, this.serverState);
        for (const c of this.pending) applyCmd(this.collision, this.me, c, this.myId);
        this.prev.set(this.me.x, this.me.y, this.me.z);
        this.correction.set(0, 0, 0);
        // Skydivers face the centre of the arena below.
        this.input.yaw = Math.atan2(this.me.x, this.me.z);
        this.input.pitch = -0.55;
        this.hud.setDeath(null);
        this.view.setWeapon(this.me.weapon);
      } else {
        const ox = this.me.x;
        const oy = this.me.y;
        const oz = this.me.z;
        copyState(this.me, this.serverState);
        for (const c of this.pending) applyCmd(this.collision, this.me, c, this.myId);
        const dx = ox - this.me.x;
        const dy = oy - this.me.y;
        const dz = oz - this.me.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 0.001) {
          this.prev.x -= dx;
          this.prev.y -= dy;
          this.prev.z -= dz;
          if (d < 64) this.correction.add(v3.set(dx, dy, dz));
          else this.correction.set(0, 0, 0);
        }
      }
    } else if (this.alive) {
      this.alive = false;
    }

    const seen = new Set<number>();
    for (const p of m.ps) {
      const [id, x, y, z, yaw, pitch, flags, w] = p;
      if (id === this.myId) continue;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        const n = this.nameOf(id);
        r = { id, avatar: new Avatar(n.name, n.color), buf: [], visible: false, last: new THREE.Vector3(x, y, z), speed: 0, step: 0, ground: true, dropping: false };
        this.scene.add(r.avatar.root);
        this.remotes.set(id, r);
      }
      r.buf.push({ t: m.time, x, y, z, yaw, pitch, flags, w });
      if (r.buf.length > 40) r.buf.shift();
    }
    for (const r of this.remotes.values()) {
      if (!seen.has(r.id)) {
        const lastSnap = r.buf[r.buf.length - 1];
        if (lastSnap && lastSnap.flags & RF_ALIVE) r.buf.push({ ...lastSnap, t: m.time, flags: 0 });
      }
    }

    const present = new Set<number>();
    for (const [id, x, y, z, w, landed] of m.ad) {
      present.add(id);
      let a = this.airdrops.get(id);
      if (!a) {
        a = new AirdropView(id, x, z, y, w as WeaponId);
        a.groundY = Math.max(0, this.collision.groundBelow(x, this.map.dropHeight + 300, z, 22));
        this.scene.add(a.group);
        this.airdrops.set(id, a);
      }
      a.target(y, landed === 1);
    }
    for (const [id, a] of this.airdrops) {
      if (!present.has(id)) {
        this.scene.remove(a.group);
        a.dispose();
        this.airdrops.delete(id);
      }
    }
  }

  private onEvent(e: GameEvent): void {
    switch (e.k) {
      case 'shot':
        this.onRemoteShot(e);
        break;
      case 'hit': {
        if (e.by === this.myId && e.to !== this.myId) {
          this.hud.hit(e.hp <= 0 ? 'kill' : e.zone === 0 ? 'head' : 'body');
          if (e.zone === 0) this.sfx.headshot();
          else this.sfx.hitmarker();
          const r = this.remotes.get(e.to);
          if (r?.visible) this.effects.burst(v3.copy(r.avatar.root.position).setY(r.avatar.root.position.y + (e.zone === 0 ? 64 : 40)), this.nameOf(e.to).color, e.zone === 0 ? 16 : 8);
        }
        if (e.to === this.myId) {
          const [fx, , fz] = e.from;
          const ang = Math.atan2(-(fx - this.me.x), -(fz - this.me.z));
          const rel = ang - this.input.yaw;
          this.hud.damage(-rel);
          this.sfx.hurt();
          this.punch = Math.min(3, this.punch + e.dmg / 25);
        }
        break;
      }
      case 'kill': {
        const k = this.nameOf(e.by);
        const v = this.nameOf(e.to);
        const def = weaponDef(e.w);
        this.hud.killfeed(k.name, k.color, v.name, v.color, def.tag, e.hs === 1, e.by === this.myId || e.to === this.myId);
        if (e.by === this.myId && e.to !== this.myId) {
          this.sfx.kill(e.streak);
          const s = STREAKS[e.streak];
          if (s) this.hud.announce(s, `${e.streak} em sequência`);
          else if (e.hs) this.hud.announce('headshot', undefined, true);
        }
        if (e.to === this.myId) {
          this.alive = false;
          this.deathAt = performance.now();
          this.deathPos.set(this.me.x, this.me.y, this.me.z);
          this.killerId = e.by;
          this.hud.setDeath({ killer: k.name, color: k.color, weapon: def.name, hs: e.hs === 1 });
          this.sfx.setWind(0);
        } else {
          const r = this.remotes.get(e.to);
          if (r?.visible) {
            const c = r.avatar.corpse();
            this.effects.corpse(c, r.avatar.root.rotation.y);
            this.effects.burst(v3.copy(r.avatar.root.position).setY(r.avatar.root.position.y + 40), v.color, 22);
            r.avatar.root.visible = false;
            r.visible = false;
          }
        }
        break;
      }
      case 'drop': {
        this.sfx.airdrop();
        const d = weaponDef(e.w);
        this.hud.announce('suprimento a caminho', `${d.name} (${d.tag}) · siga o feixe verde`);
        break;
      }
      case 'loot': {
        const def = weaponDef(e.w);
        if (e.id === this.myId) {
          this.sfx.loot();
          this.hud.announce(`${def.name.toLowerCase()} na mão`, def.zoomFov.length ? 'botão direito: mira 40° → 10° · fique parado pra acertar' : 'arma lendária + armadura completa');
          this.view.setWeapon(e.w as WeaponId);
        } else {
          this.hud.info(`${this.nameOf(e.id).name} pegou ${def.name}`);
        }
        break;
      }
      case 'join':
        if (e.id !== this.myId) this.hud.info(`${this.nameOf(e.id).name} entrou no jogo`);
        break;
      case 'leave':
        this.hud.info(`${this.nameOf(e.id).name} saiu`);
        break;
      case 'team': {
        const t = TEAMS[e.team];
        if (!t) break;
        if (e.id === this.myId) this.hud.announce(`agora você é ${t.name.toLowerCase()}`, e.auto ? 'balanceamento automático de times' : 'troca de time', true);
        else this.hud.info(`${this.nameOf(e.id).name} foi para os ${t.name}${e.auto ? ' (balanceamento)' : ''}`);
        break;
      }
    }
  }

  private onMatch(info: MatchInfo): void {
    const before = this.match;
    this.match = info;
    if (Array.isArray(info.teams)) this.teamScores = info.teams;
    if (info.mode !== before.mode) {
      this.dropAllAvatars();
      this.view.setSleeveColor(this.nameOf(this.myId).color);
    }
    if (info.map !== this.mapIndex) this.loadMap(info.map);
    if (info.phase === 'podium') {
      this.enterPodium(info);
    } else {
      if (this.podiumActive) this.exitPodium();
      const min = Math.round((info.endsAt - this.serverNow()) / 60000);
      if (info.phase === 'live' && info.mode === 'tdm') {
        const t = TEAMS[this.myTeam];
        this.hud.announce('team deathmatch', `${t ? `você é dos ${t.name}` : this.map.name} · ${info.limit ? `${info.limit} kills ou ` : ''}${min} min`);
      } else if (info.phase === 'live') this.hud.announce('todos contra todos', `${this.map.name} · ${min} min · mais kills vence`);
      else if (before.phase !== 'warmup') this.hud.announce('aquecimento', 'esperando mais jogadores', true);
    }
  }

  private dropAllAvatars(): void {
    for (const id of [...this.remotes.keys()]) this.dropAvatar(id);
  }

  private enterPodium(info: MatchInfo): void {
    const results = info.results ?? [];
    const tdm = info.mode !== 'ffa';
    const winner = tdm ? (info.winner ?? -1) : -1;
    const featured = winner >= 0 ? results.filter((r) => r.team === winner) : results;
    const colorFor = (r: ResultRow) => (tdm && r.team >= 0 ? TEAMS[r.team].color : (PLAYER_COLORS[r.color] ?? '#f0f0f0'));
    this.podiumActive = true;
    this.podium.setResults(featured.slice(0, 3), colorFor);
    this.hud.setVisible(false);
    this.sfx.fanfare();
    this.sfx.setWind(0);
    const next = info.next ? `${getMap(info.next.map).name} · ${MODE_LABEL[info.next.mode]}` : '';
    this.myVote = -1;
    this.voteCounts = info.vote?.counts ?? [];
    // free the mouse so people can click a map in the vote
    if (document.pointerLockElement) document.exitPointerLock();
    this.ui.showMenu(false);
    this.ui.showPodium({ mode: info.mode, featured, results, myId: this.myId, winner, teams: info.teams ?? [0, 0], myTeam: this.myTeam, colorFor, vote: info.vote ?? null }, next);
  }

  /** Map vote on the podium (keys 1-3 or click). */
  vote(option: number): void {
    if (!this.podiumActive || !this.match.vote || option < 0 || option >= this.match.vote.options.length) return;
    this.myVote = option;
    this.net.send({ t: 'vote', option });
    this.ui.updateVotes(this.voteCounts, this.myVote);
    this.sfx.click();
  }

  private exitPodium(): void {
    this.podiumActive = false;
    this.hud.setVisible(true);
    this.ui.showPodium(null, '');
    this.effects.clear();
    if (!this.input.locked) this.ui.showClickToPlay(true);
  }

  // ------------------------------------------------------------------ input

  private onKey(code: string, down: boolean, e: KeyboardEvent): boolean {
    if (this.chatOpen) return true;
    if (this.podiumActive && down && /^(Digit|Numpad)[1-3]$/.test(code)) {
      this.vote(Number(code.slice(-1)) - 1);
      return true;
    }
    if (code === 'Tab') {
      if (this.input.locked) e.preventDefault();
      this.scoreboardOpen = down;
      return true;
    }
    if (down && this.input.locked && (code === 'Enter' || code === 'KeyY' || code === 'KeyT')) {
      e.preventDefault();
      this.chatOpen = true;
      this.input.enabled = false;
      this.input.releaseAll();
      this.hud.openChat(true);
      return true;
    }
    return false;
  }

  private onChatKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.code === 'Enter') {
      const text = this.hud.chatInput.value.trim();
      if (text) this.net.send({ t: 'chat', text: text.slice(0, 100) });
      this.closeChat();
    } else if (e.code === 'Escape') {
      this.closeChat();
    }
  };

  private closeChat(): void {
    this.chatOpen = false;
    this.input.enabled = true;
    this.hud.openChat(false);
    if (!this.input.locked) void this.requestPlay();
  }

  private resolveWeaponRequest(req: number): number {
    if (req !== 5 && req !== 6) return req;
    const order = [this.me.primary, WEAPON.PISTOL, WEAPON.HAMMER];
    const idx = Math.max(0, order.indexOf(this.me.weapon));
    const next = (idx + (req === 5 ? 1 : 2)) % 3;
    return next + 1;
  }

  // ------------------------------------------------------------------ simulation

  private tick(): void {
    this.tickCount++;
    const renderTime = Math.max(0, this.serverNow() - INTERP_DELAY_MS);
    const canPlay = this.alive && this.match.phase !== 'podium';
    const buttons = this.input.buttons();
    const req = this.resolveWeaponRequest(this.input.takeWeaponRequest());
    const cmd: Cmd = { seq: ++this.seq, buttons, yaw: this.input.yaw, pitch: this.input.pitch, weapon: req, interp: Math.round(renderTime) };
    if (canPlay) {
      const s = this.me;
      const before = { ground: s.onGround, drop: s.dropping, reload: s.reload, weapon: s.weapon, nextFire: s.nextFire, vy: s.vy, zoom: s.zoom };
      this.prev.set(s.x, s.y, s.z);
      const shot = applyCmd(this.collision, s, cmd, this.myId);
      this.pending.push(cmd);
      if (this.pending.length > 180) this.pending.shift();
      if (shot) this.onLocalShot(shot);
      this.localSounds(before, cmd, shot);
    }
    this.outbox.push(cmd);
    if (this.tickCount % 2 === 0) this.flush();
  }

  private flush(): void {
    while (this.outbox.length) {
      const chunk = this.outbox.splice(0, CMDS_PER_PACKET_MAX);
      this.net.send({ t: 'in', c: chunk.map(encodeCmd) });
    }
  }

  private localSounds(before: { ground: boolean; drop: boolean; reload: number; weapon: WeaponId; nextFire: number; vy: number; zoom: number }, cmd: Cmd, shot: ShotInfo | null): void {
    const s = this.me;
    if (before.zoom !== s.zoom && s.zoom > 0) this.sfx.zoom();
    if (before.ground && !s.onGround && s.vy > 0) this.sfx.jump();
    if (!before.ground && s.onGround && !before.drop) this.sfx.land(before.vy < -480);
    if (before.drop && !s.dropping) {
      this.sfx.land(true);
      this.hud.announce('pousou!', 'proteção de spawn por 1,5 s', true);
    }
    if (before.weapon !== s.weapon) {
      this.view.setWeapon(s.weapon);
      this.sfx.deploy();
    }
    if (before.reload === 0 && s.reload > 0) {
      this.reloadStarted = s.reload;
      this.reloadStages = 0;
    }
    if (s.reload > 0 && this.reloadStarted > 0) {
      const frac = 1 - s.reload / this.reloadStarted;
      const marks = [0.15, 0.6, 0.88];
      while (this.reloadStages < 3 && frac >= marks[this.reloadStages]) this.sfx.reload(this.reloadStages++);
    }
    if (!shot && cmd.buttons & BTN.ATTACK && s.nextFire !== before.nextFire && s.reload === 0) this.sfx.dryFire();
    const speed = Math.hypot(s.vx, s.vz);
    if (s.onGround && speed > 150) {
      this.stepAcc += speed / TICK_RATE;
      if (this.stepAcc > 76) {
        this.stepAcc = 0;
        this.sfx.footstep(null, 0.55);
      }
    }
  }

  private gunOrigin(out: THREE.Vector3): THREE.Vector3 {
    const fwd = v3b.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.camera.quaternion);
    return out.copy(this.camera.position).addScaledVector(fwd, 30).addScaledVector(right, 7).addScaledVector(down, 6);
  }

  private onLocalShot(shot: ShotInfo): void {
    const def = weaponDef(shot.weapon);
    this.view.fire(shot.heavy);
    this.sfx.shot(shot.weapon, null, shot.heavy);
    const melee = def.slot === 3;
    if (!melee) this.muzzleLight.intensity = 3.5;
    const origin = this.gunOrigin(new THREE.Vector3());
    const renderT = this.serverNow() - INTERP_DELAY_MS;
    for (let i = 0; i < shot.dirs.length; i += 3) {
      const dx = shot.dirs[i];
      const dy = shot.dirs[i + 1];
      const dz = shot.dirs[i + 2];
      const wall = this.collision.trace(shot.ox, shot.oy, shot.oz, dx, dy, dz, def.range);
      let dist = wall ? wall.t : def.range;
      let hitPlayer = false;
      for (const r of this.remotes.values()) {
        if (!r.visible || this.isTeammate(r.id)) continue; // no friendly fire: rounds pass through
        const s = this.sample(r, renderT);
        if (!s || !(s.flags & RF_ALIVE) || s.flags & (RF_DROP | RF_PROTECT)) continue;
        const h = rayHitbox(shot.ox, shot.oy, shot.oz, dx, dy, dz, s.x, s.y, s.z, (s.flags & RF_DUCK) !== 0, dist);
        if (h) {
          dist = h.t;
          hitPlayer = true;
        }
      }
      const end = new THREE.Vector3(shot.ox + dx * dist, shot.oy + dy * dist, shot.oz + dz * dist);
      if (!melee) this.effects.tracer(origin, end);
      if (!hitPlayer && wall && wall.t <= dist + 0.01 && (!melee || wall.t < def.range)) {
        this.effects.impact(end, new THREE.Vector3(wall.nx, wall.ny, wall.nz));
      }
    }
  }

  private onRemoteShot(e: Extract<GameEvent, { k: 'shot' }>): void {
    const def = weaponDef(e.w);
    const [ox, oy, oz] = e.o;
    this.sfx.shot(e.w as WeaponId, { x: ox, y: oy, z: oz }, e.h === 1);
    const r = this.remotes.get(e.id);
    if (def.slot === 3) return;
    const origin = new THREE.Vector3(ox, oy, oz);
    if (r?.visible) {
      r.avatar.muzzleWorld(origin);
      r.avatar.kick();
    }
    this.effects.muzzleFlash(origin);
    for (let i = 0; i < e.e.length; i += 3) {
      const end = new THREE.Vector3(e.e[i], e.e[i + 1], e.e[i + 2]);
      this.effects.tracer(origin, end);
      const dir = v3.copy(end).sub(v3b.set(ox, oy, oz));
      const len = dir.length();
      dir.divideScalar(len || 1);
      const hit = this.collision.trace(ox, oy, oz, dir.x, dir.y, dir.z, len + 2);
      if (hit && Math.abs(hit.t - len) < 3) this.effects.impact(end, new THREE.Vector3(hit.nx, hit.ny, hit.nz));
    }
  }

  private sample(r: Remote, t: number): Snap | null {
    const b = r.buf;
    while (b.length >= 2 && b[1].t <= t) b.shift();
    if (b.length === 0) return null;
    const a = b[0];
    const c = b[1];
    if (!c || t <= a.t) return a;
    const k = (t - a.t) / Math.max(1, c.t - a.t);
    if (!(a.flags & RF_ALIVE) || !(c.flags & RF_ALIVE)) return k < 0.5 ? a : c;
    if (Math.hypot(c.x - a.x, c.z - a.z) > 400) return k < 0.5 ? a : c; // respawn teleport
    return {
      t,
      x: a.x + (c.x - a.x) * k,
      y: a.y + (c.y - a.y) * k,
      z: a.z + (c.z - a.z) * k,
      yaw: lerpAngle(a.yaw, c.yaw, k),
      pitch: a.pitch + (c.pitch - a.pitch) * k,
      flags: k < 0.5 ? a.flags : c.flags,
      w: k < 0.5 ? a.w : c.w,
    };
  }

  // ------------------------------------------------------------------ frame

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.25) dt = 0.25;
    this.elapsed += dt;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }

    if (now - this.lastPing > 2000) {
      this.lastPing = now;
      this.net.send({ t: 'ping', c: now });
    }

    this.accum += dt * 1000;
    let n = 0;
    while (this.accum >= TICK_MS && n < 15) {
      this.tick();
      this.accum -= TICK_MS;
      n++;
    }
    if (n === 15) this.accum = 0;

    if (this.podiumActive) {
      this.podium.update(dt);
      this.podium.render(this.renderer);
      const left = Math.max(0, Math.ceil((this.match.endsAt - this.serverNow()) / 1000));
      this.ui.updatePodiumCountdown(left);
      return;
    }

    const [ldx, ldy] = this.input.takeLook();
    this.updateCamera(dt);
    this.updateRemotes(dt);
    for (const a of this.airdrops.values()) a.update(dt, this.elapsed, this.camera.position);
    this.effects.update(dt);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 60);
    this.muzzleLight.position.copy(this.camera.position).add(v3.set(0, 0, -40).applyQuaternion(this.camera.quaternion));
    if (this.world) {
      followShadow(this.world.sun, this.camera.position.x, this.camera.position.z, this.sunDir);
      this.world.sky.position.copy(this.camera.position);
    }

    const def = weaponDef(this.me.weapon);
    const zoomed = this.alive && this.me.zoom > 0 && def.zoomFov.length > 0;
    this.view.update({
      dt,
      speed: Math.hypot(this.me.vx, this.me.vz),
      onGround: this.me.onGround,
      lookDX: ldx,
      lookDY: ldy,
      reloadFrac: this.me.reload > 0 ? 1 - this.me.reload / def.reloadTicks : -1,
      deployFrac: this.me.deploy > 0 ? 1 - this.me.deploy / def.deployTicks : -1,
      hidden: !this.alive || zoomed || this.me.dropping,
    });

    this.renderer.render(this.scene, this.camera);
    if (this.alive && !zoomed && !this.me.dropping) this.view.render(this.renderer);

    this.updateHud(zoomed);
    const f = v3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.sfx.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, f.x, f.y, f.z);
  };

  private updateCamera(dt: number): void {
    const s = this.me;
    const def = weaponDef(s.weapon);
    this.correction.multiplyScalar(Math.exp(-dt * 14));
    this.punch = Math.max(0, this.punch - dt * 8);

    // field of view: CS-style horizontal FOV defined at 4:3, Hor+ for wider screens
    const csToVertical = (h: number) => (2 * Math.atan(Math.tan((h * DEG) / 2) * 0.75)) / DEG;
    const baseV = csToVertical(this.settings.fov);
    let vfov = baseV;
    const zoomed = this.alive && s.zoom > 0 && def.zoomFov.length > 0;
    if (zoomed) vfov = csToVertical(def.zoomFov[s.zoom - 1]);
    if (this.alive && s.dropping) vfov = baseV + 8;
    if (Math.abs(this.camera.fov - vfov) > 0.01) {
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
    }
    this.input.zoomSensScale = zoomed ? (def.zoomFov[s.zoom - 1] / this.settings.fov) * ZOOM_SENSITIVITY_RATIO : 1;

    if (this.alive) {
      const alpha = clamp(this.accum / TICK_MS, 0, 1);
      const x = this.prev.x + (s.x - this.prev.x) * alpha + this.correction.x;
      const y = this.prev.y + (s.y - this.prev.y) * alpha + this.correction.y;
      const z = this.prev.z + (s.z - this.prev.z) * alpha + this.correction.z;
      const eyeTarget = s.ducked ? DUCK_EYE + (s.onGround ? 0 : 18) : STAND_EYE;
      this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 18);
      this.camera.position.set(x, y + this.eye, z);
      const [rp, ry] = recoilOffset(def, s.recoil);
      this.camera.rotation.set(this.input.pitch + rp + this.punch * 0.012, this.input.yaw + ry, 0, 'YXZ');
    } else {
      // death cam: rise above the body and look at the killer
      const t = (performance.now() - this.deathAt) / 1000;
      const rise = Math.min(1, t / 1.2);
      this.camera.position.set(this.deathPos.x, this.deathPos.y + 40 + rise * 90, this.deathPos.z);
      const k = this.remotes.get(this.killerId);
      if (k?.visible) {
        this.camera.lookAt(k.avatar.root.position.x, k.avatar.root.position.y + 50, k.avatar.root.position.z);
      } else {
        this.camera.rotation.set(-0.9 * rise - 0.2, this.input.yaw, 0, 'YXZ');
      }
    }
  }

  private updateRemotes(dt: number): void {
    const renderT = this.serverNow() - INTERP_DELAY_MS;
    const camFwd = v3b.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    for (const r of this.remotes.values()) {
      const s = this.sample(r, renderT);
      const visible = !!s && (s.flags & RF_ALIVE) !== 0;
      if (!visible || !s) {
        r.avatar.root.visible = false;
        r.visible = false;
        continue;
      }
      const pos = r.avatar.root.position;
      const wasVisible = r.visible;
      pos.set(s.x, s.y, s.z);
      r.avatar.root.rotation.y = s.yaw;
      r.avatar.root.visible = true;
      r.visible = true;
      const moved = wasVisible ? Math.hypot(s.x - r.last.x, s.z - r.last.z) : 0;
      const inst = dt > 0 ? moved / dt : 0;
      r.speed += (Math.min(inst, 600) - r.speed) * Math.min(1, dt * 10);
      r.last.set(s.x, s.y, s.z);
      const ground = (s.flags & RF_GROUND) !== 0;
      const dropping = (s.flags & RF_DROP) !== 0;
      if (wasVisible && ground && r.speed > 150) {
        r.step += moved;
        if (r.step > 76) {
          r.step = 0;
          this.sfx.footstep({ x: s.x, y: s.y, z: s.z });
        }
      }
      if (wasVisible && ground && !r.ground) this.sfx.land(r.dropping, { x: s.x, y: s.y, z: s.z });
      r.ground = ground;
      r.dropping = dropping;
      r.avatar.setWeapon(s.w as WeaponId);
      r.avatar.update(dt, {
        speed: r.speed,
        ducked: (s.flags & RF_DUCK) !== 0,
        dropping,
        onGround: ground,
        pitch: s.pitch,
        protect: (s.flags & RF_PROTECT) !== 0,
        reloading: (s.flags & RF_RELOAD) !== 0,
      });
      // name tags only up close or when aimed at (no wallhack-style radar)
      const to = v3.set(s.x - this.camera.position.x, s.y + 60 - this.camera.position.y, s.z - this.camera.position.z);
      const dist = to.length();
      const aim = to.divideScalar(dist || 1).dot(camFwd);
      r.avatar.showTag(this.isTeammate(r.id) || dist < 380 || aim > 0.9985 || dropping);
    }
  }

  private updateHud(zoomed: boolean): void {
    const hud = this.hud;
    const s = this.me;
    const def = weaponDef(s.weapon);
    const now = this.serverNow();

    // timer + leaders
    if (this.match.phase === 'live') {
      const left = Math.max(0, this.match.endsAt - now);
      const sec = Math.ceil(left / 1000);
      hud.setTimer(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, `${this.map.name} · ${this.match.mode}`, sec <= 30);
      if (sec <= 10 && sec > 0 && sec !== this.lastBeep) {
        this.lastBeep = sec;
        this.sfx.beep(sec <= 3);
      }
    } else hud.setTimer('aquec.', 'esperando jogadores', false);

    const rows = this.ranked();
    const leaders: LeaderRow[] = rows.slice(0, 3).map((r, i) => ({ name: r.name, color: r.color, kills: r.kills, rank: i + 1, me: r.me }));
    const myIdx = rows.findIndex((r) => r.me);
    const meRow = myIdx >= 0 ? { name: rows[myIdx].name, color: rows[myIdx].color, kills: rows[myIdx].kills, rank: myIdx + 1, me: true } : null;
    const tdm = this.match.mode !== 'ffa';
    if (tdm) hud.setTeams(this.teamScores, this.match.limit, this.myTeam);
    else hud.setLeaders(leaders, meRow);
    hud.setTeamBadge(tdm ? this.myTeam : -1);
    const title = `${this.map.name} · ${MODE_LABEL[this.match.mode]} · ${rows.length} jogador${rows.length === 1 ? '' : 'es'}`;
    hud.showScoreboard(this.scoreboardOpen, rows, title, tdm ? this.teamScores : null);

    if (!this.alive) {
      const left = Math.max(0, RESPAWN_TICKS * TICK_MS - (performance.now() - this.deathAt));
      if (this.deathAt > 0) hud.setRespawn(left > 0 ? `voltando do céu em ${(left / 1000).toFixed(1)} s` : 'saltando…');
      hud.setCrosshair(0, 0, '', false);
      hud.setDrop(null);
      hud.setScope(false);
      hud.setProtect(false);
      this.sfx.setWind(0);
      hud.setMarkers(this.markers());
      return;
    }

    hud.setVitals(Math.max(0, Math.ceil(s.health)), Math.ceil(s.armor));
    const slots = [
      { key: '1', label: weaponDef(s.primary).tag, active: s.weapon === s.primary },
      { key: '2', label: 'FAÍSCA', active: s.weapon === WEAPON.PISTOL },
      { key: '3', label: 'MARTELO', active: s.weapon === WEAPON.HAMMER },
    ];
    hud.setWeapon(def.name, def.tag, s.mag[def.id], s.reserve[def.id], def.legendary, def.slot === 3, slots);
    hud.setReload(s.reload > 0 ? 1 - s.reload / def.reloadTicks : -1);
    hud.setScope(zoomed);
    hud.setProtect(s.protect > 0 || s.dropping);

    // dynamic crosshair: gap follows the real spread used by the simulation
    const showCh = !zoomed && !s.dropping && !(def.id === WEAPON.SNIPER);
    let gap = this.settings.crosshairGap;
    if (this.settings.dynamicCrosshair && def.slot !== 3) {
      const spread = computeSpread(s, def);
      const pxPerRad = this.renderer.domElement.clientHeight / 2 / Math.tan((this.camera.fov * DEG) / 2);
      gap = Math.max(gap, Math.min(80, spread * pxPerRad * 0.9));
    }
    hud.setCrosshair(gap, this.settings.crosshairSize, this.settings.crosshairColor, showCh);

    if (s.dropping) {
      const ground = this.collision.groundBelow(s.x, s.y, s.z, 16);
      hud.setDrop(s.y - Math.max(0, ground));
      this.sfx.setWind(clamp(-s.vy / 950, 0, 1));
    } else {
      hud.setDrop(null);
      this.sfx.setWind(0);
    }
    hud.setMarkers(this.markers());

    if (this.settings.showNet) {
      const kb = (this.net.bytesIn / 1024 / Math.max(1, this.elapsed)).toFixed(1);
      hud.setNetstat(`${this.fps} fps\nping ${Math.round(this.rtt)} ms\npred ${this.pending.length}\n${kb} KB/s`);
    } else hud.setNetstat(null);
  }

  private markers(): Marker[] {
    const out: Marker[] = [];
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const targets: { x: number; y: number; z: number; label: string }[] = [];
    for (const a of this.airdrops.values()) targets.push({ x: a.x, y: a.group.position.y + 70, z: a.z, label: a.label });
    for (const a of targets) {
      v3.set(a.x, a.y, a.z);
      const dist = v3.distanceTo(this.camera.position);
      v3.project(this.camera);
      const behind = v3.z > 1;
      let x = (v3.x * 0.5 + 0.5) * w;
      let y = (-v3.y * 0.5 + 0.5) * h;
      if (behind) {
        x = w - x;
        y = h - 40;
      }
      const off = behind || x < 30 || x > w - 30 || y < 70 || y > h - 30;
      x = clamp(x, 30, w - 30);
      y = clamp(y, 70, h - 30);
      out.push({ x, y, label: a.label, dist, offscreen: off });
    }
    return out;
  }

  ranked(): ScoreRow[] {
    const rows: ScoreRow[] = [];
    for (const id of this.online) {
      const n = this.nameOf(id);
      const sc = this.scores.get(id) ?? { kills: 0, deaths: 0, ping: 0, streak: 0, hs: 0 };
      rows.push({ id, name: n.name, color: n.color, team: n.team, bot: this.names.get(id)?.bot ?? false, kills: sc.kills, deaths: sc.deaths, hs: sc.hs, ping: sc.ping, me: id === this.myId });
    }
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    return rows;
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.dispose();
    this.sfx.dispose();
    this.world?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.hud.root.remove();
    this.net.close();
  }
}

export { PROTOCOL_VERSION };
