import '@fontsource-variable/inter';
import '@fontsource/fragment-mono';
import './styles.css';
import { PROTOCOL_VERSION, type ServerMsg } from '@calindra-strike/shared';
import { loadBrand } from './brand.ts';
import { SERVER_HTTP, SERVER_WS } from './config.ts';
import { ClientGame, type Welcome } from './game/client.ts';
import { Connection } from './game/net.ts';
import { type Settings, loadSettings } from './settings.ts';
import { h } from './ui/dom.ts';
import { renderLobby } from './ui/lobby.ts';
import { Overlays } from './ui/overlays.ts';

const app = document.getElementById('app') as HTMLElement;
const settings = loadSettings();
let stopLobby: (() => void) | null = null;

const TOKEN_KEY = 'calindra-strike:token';
/** Rejoin token lives in this tab only: a refresh or a dropped connection gets your score back. */
const token = {
  get(): string {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set(v: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, v);
    } catch {
      /* private mode: no rejoin, nothing else breaks */
    }
  },
};

class Rejected extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function lobby(error = ''): void {
  stopLobby?.();
  stopLobby = renderLobby(app, settings, error, (s) => void play(s));
}

function waitWelcome(net: Connection, ms: number): Promise<Welcome> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('O servidor não respondeu.'));
    }, ms);
    const off = net.onMessage((m: ServerMsg) => {
      if (m.t === 'welcome') {
        clearTimeout(timer);
        off();
        resolve(m);
      } else if (m.t === 'reject') {
        clearTimeout(timer);
        off();
        reject(new Rejected(m.reason, m.code ?? ''));
      }
    });
    net.onClose(() => {
      clearTimeout(timer);
      reject(new Error('Conexão recusada pelo servidor.'));
    });
  });
}

async function serverProtocol(): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${SERVER_HTTP}/status`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return null;
    const j = (await res.json()) as { protocol?: unknown };
    return typeof j.protocol === 'number' ? j.protocol : null;
  } catch {
    return null;
  }
}

async function connect(s: Settings): Promise<{ net: Connection; welcome: Welcome }> {
  const net = new Connection(SERVER_WS);
  try {
    await Promise.all([net.opened(), loadBrand()]);
    net.send({ t: 'hello', v: PROTOCOL_VERSION, name: s.name, color: s.color, primary: s.primary, code: s.code, token: token.get() });
    const welcome = await waitWelcome(net, 8000);
    token.set(welcome.token);
    return { net, welcome };
  } catch (e) {
    net.close();
    throw e;
  }
}

async function play(s: Settings): Promise<void> {
  try {
    const { net, welcome } = await connect(s);
    stopLobby?.();
    stopLobby = null;
    start(net, s, welcome);
  } catch (e) {
    if (e instanceof Rejected && e.code === 'version') {
      const proto = await serverProtocol();
      if (proto !== null && proto > PROTOCOL_VERSION) {
        location.reload(); // the site has a newer build than this tab
        return;
      }
      lobby('O servidor está sendo atualizado. Tente de novo em alguns segundos.');
      return;
    }
    lobby(e instanceof Error ? e.message : 'Falha ao conectar.');
  }
}

/** Close codes worth retrying: server restart (deploy), network drop, going away, server error. */
const TRANSIENT = new Set([1001, 1006, 1011, 1012]);

function start(net: Connection, s: Settings, welcome: Welcome): void {
  const root = h('div', { class: 'game' });
  app.replaceChildren(root);
  let game: ClientGame | null = null;
  let stopped = false;
  const leave = () => {
    stopped = true;
    game?.dispose();
    game = null;
    lobby();
  };

  const reconnect = async () => {
    for (let attempt = 1; attempt <= 60 && !stopped; attempt++) {
      overlays.reconnecting(attempt === 1 ? 'A conexão com o servidor caiu. Voltando…' : `Tentativa ${attempt}…`, leave);
      await new Promise((r) => setTimeout(r, Math.min(4000, 350 * attempt)));
      if (stopped) return;
      const proto = await serverProtocol();
      if (proto === null) continue; // server still restarting
      if (proto > PROTOCOL_VERSION) {
        overlays.reconnecting('Nova versão do jogo: atualizando a página…');
        location.reload();
        return;
      }
      if (proto < PROTOCOL_VERSION) {
        overlays.reconnecting('O servidor está sendo atualizado…', leave);
        continue;
      }
      try {
        const next = await connect(s);
        if (stopped) {
          next.net.close();
          return;
        }
        game?.dispose();
        game = null;
        start(next.net, s, next.welcome);
        return;
      } catch {
        /* keep trying */
      }
    }
    if (!stopped) overlays.disconnected('Não foi possível reconectar ao servidor.', leave);
  };

  const overlays = new Overlays(root, s, {
    resume: () => void game?.requestPlay(),
    leave,
    settingsChanged: (ns) => game?.applySettings(ns),
    switchTeam: () => {
      game?.switchTeam();
      void game?.requestPlay();
    },
    vote: (i) => game?.vote(i),
  });
  if (import.meta.env.DEV) (window as unknown as { __overlays: Overlays }).__overlays = overlays;
  game = new ClientGame(root, net, s, welcome, {
    showClickToPlay: (v) => overlays.showClick(v),
    showMenu: (v) => overlays.showMenu(v, game?.teamState() ?? null),
    showPodium: (r, next) => overlays.showPodium(r, next),
    updateVotes: (counts, mine) => overlays.updateVotes(counts, mine),
    updatePodiumCountdown: (sec) => overlays.podiumCountdown(sec),
    disconnected: (reason, code) => {
      if (TRANSIENT.has(code)) void reconnect();
      else overlays.disconnected(reason, leave);
    },
  });
}

void loadBrand();
lobby();
