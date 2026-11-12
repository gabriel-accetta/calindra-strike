import '@fontsource-variable/inter';
import '@fontsource/fragment-mono';
import './styles.css';
import { PROTOCOL_VERSION, type ServerMsg } from '@calindra-strike/shared';
import { loadBrand } from './brand.ts';
import { SERVER_WS } from './config.ts';
import { ClientGame, type Welcome } from './game/client.ts';
import { Connection } from './game/net.ts';
import { type Settings, loadSettings } from './settings.ts';
import { h } from './ui/dom.ts';
import { renderLobby } from './ui/lobby.ts';
import { Overlays } from './ui/overlays.ts';

const app = document.getElementById('app') as HTMLElement;
const settings = loadSettings();
let stopLobby: (() => void) | null = null;

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
        reject(new Error(m.reason));
      }
    });
    net.onClose(() => {
      clearTimeout(timer);
      reject(new Error('Conexão recusada pelo servidor.'));
    });
  });
}

async function play(s: Settings): Promise<void> {
  const net = new Connection(SERVER_WS);
  try {
    await Promise.all([net.opened(), loadBrand()]);
    net.send({ t: 'hello', v: PROTOCOL_VERSION, name: s.name, color: s.color, primary: s.primary, code: s.code });
    const welcome = await waitWelcome(net, 8000);
    stopLobby?.();
    stopLobby = null;
    start(net, s, welcome);
  } catch (e) {
    net.close();
    lobby(e instanceof Error ? e.message : 'Falha ao conectar.');
  }
}

function start(net: Connection, s: Settings, welcome: Welcome): void {
  const root = h('div', { class: 'game' });
  app.replaceChildren(root);
  let game: ClientGame | null = null;
  const leave = () => {
    game?.dispose();
    game = null;
    lobby();
  };
  const overlays = new Overlays(root, s, {
    resume: () => void game?.requestPlay(),
    leave,
    settingsChanged: (ns) => game?.applySettings(ns),
  });
  game = new ClientGame(root, net, s, welcome, {
    showClickToPlay: (v) => overlays.showClick(v),
    showMenu: (v) => overlays.showMenu(v),
    showPodium: (r, next) => overlays.showPodium(r, next),
    updatePodiumCountdown: (sec) => overlays.podiumCountdown(sec),
    disconnected: (reason) => overlays.disconnected(reason, leave),
  });
}

void loadBrand();
lobby();
