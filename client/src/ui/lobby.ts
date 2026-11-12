import { PLAYER_COLORS, PRIMARY_CHOICES, WEAPON, type WeaponId, sanitizeName, weaponDef } from '@calindra-strike/shared';
import { SERVER_HTTP } from '../config.ts';
import { type Settings, saveSettings } from '../settings.ts';
import { ICONS, eitriLogo, gameLogo, h, svg } from './dom.ts';

interface Status {
  players: number;
  maxPlayers: number;
  map: string;
  phase: string;
  endsInMs: number | null;
  leaders: { name: string; kills: number }[];
  codeRequired: boolean;
  mode?: 'ffa' | 'tdm' | 'defuse';
  teams?: number[] | null;
}

const TILE_ICONS = [
  ICONS.crate,
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20l7-7M14 4l6 6-5 5-6-6zM9 9l-2 2"/></svg>',
  ICONS.shield,
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12a7 7 0 0 1 14 0M12 12v8M8 20h8M12 5V3"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
];

const WEAPON_INFO: Record<number, { icon: string; blurb: string }> = {
  [WEAPON.RIFLE]: { icon: ICONS.rifle, blurb: '1 tiro na cabeça. Spray que sobe.' },
  [WEAPON.SMG]: { icon: ICONS.smg, blurb: 'Rápida e precisa correndo.' },
  [WEAPON.SHOTGUN]: { icon: ICONS.shotgun, blurb: 'Rainha do corpo a corpo.' },
};

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function renderLobby(app: HTMLElement, settings: Settings, error: string, onPlay: (s: Settings) => void): () => void {
  let status: Status | null = null;
  let disposed = false;

  const tiles = h('div', { class: 'tile-grid', 'aria-hidden': 'true' });
  for (let i = 0; i < 160; i++) {
    const t = h('span');
    if (i % 3 !== 1) t.append(svg(TILE_ICONS[(i * 7) % TILE_ICONS.length]));
    tiles.append(t);
  }

  const dot = h('span', { class: 'dot' });
  const sTitle = h('div', { class: 'title', text: 'Procurando servidor…' });
  const sSub = h('div', { class: 'sub', text: 'arena da Calindra' });
  const sCount = h('div', { class: 'count', text: '' });
  const server = h('div', { class: 'server' }, [h('div', { class: 'info' }, [dot, h('div', { style: 'min-width:0' }, [sTitle, sSub])]), sCount]);
  const leaders = h('div', { class: 'leaders' });

  const nameInput = h('input', {
    class: 'input',
    id: 'nick',
    maxlength: 16,
    placeholder: 'seu apelido',
    autocomplete: 'nickname',
    spellcheck: 'false',
    value: settings.name,
  });

  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Cor do jogador' });
  const drawSwatches = () => {
    swatches.replaceChildren(
      ...PLAYER_COLORS.map((c, i) =>
        h('button', {
          class: 'swatch',
          type: 'button',
          style: `background:${c}`,
          'aria-label': `Cor ${i + 1}`,
          'aria-pressed': String(settings.color === i),
          onclick: () => {
            settings.color = i;
            drawSwatches();
          },
        }),
      ),
    );
  };
  drawSwatches();

  const weapons = h('div', { class: 'weapons', role: 'group', 'aria-label': 'Arma principal' });
  const drawWeapons = () => {
    weapons.replaceChildren(
      ...PRIMARY_CHOICES.map((id: WeaponId) => {
        const d = weaponDef(id);
        return h(
          'button',
          {
            class: 'weapon-card',
            type: 'button',
            'aria-pressed': String(settings.primary === id),
            onclick: () => {
              settings.primary = id;
              drawWeapons();
            },
          },
          [svg(WEAPON_INFO[id].icon), h('b', { text: d.name }), h('small', { text: WEAPON_INFO[id].blurb })],
        );
      }),
    );
  };
  drawWeapons();

  const codeInput = h('input', { class: 'input', maxlength: 64, placeholder: 'código do escritório', autocomplete: 'off', value: settings.code });
  const codeField = h('div', { class: 'field hidden' }, [h('label', { class: 'label', text: 'código de acesso' }), codeInput]);

  const err = h('p', { class: 'form-error', role: 'alert', text: error });
  const play = h('button', { class: 'btn btn-primary play', type: 'submit', text: 'jogar agora' });

  const footnote = h('p', { class: 'footnote', text: 'Partidas de 5 min · quem fizer mais kills sobe no pódio' });
  const form = h('form', { class: 'card', novalidate: true }, [
    server,
    h('div', { class: 'field' }, [h('label', { class: 'label', for: 'nick', text: 'apelido' }), nameInput]),
    h('div', { class: 'field' }, [h('span', { class: 'label', text: 'sua cor' }), swatches]),
    h('div', { class: 'field' }, [h('span', { class: 'label', text: 'arma principal' }), weapons]),
    codeField,
    play,
    err,
    leaders,
    h('p', { class: 'mobile-note', text: 'Calindra Strike precisa de mouse e teclado. Abra no computador.' }),
    footnote,
  ]);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sanitizeName(nameInput.value);
    if (!name) {
      err.textContent = 'Escolha um apelido (letras e números).';
      nameInput.focus();
      return;
    }
    if (status?.codeRequired && !codeInput.value.trim()) {
      err.textContent = 'Este servidor pede o código do escritório.';
      codeInput.focus();
      return;
    }
    settings.name = name;
    settings.code = codeInput.value.trim();
    saveSettings(settings);
    play.disabled = true;
    play.textContent = 'conectando…';
    onPlay(settings);
  });

  const key = (k: string, label: string) => h('div', {}, [h('span', { class: 'kbd', text: k }), label]);
  const hero = h('section', { class: 'hero' }, [
    h('div', { class: 'top' }, [
      gameLogo('game-logo hero-logo'),
      h('div', { class: 'lockup' }, [
        h('span', { class: 'label', text: 'arena do escritório' }),
        h('span', { class: 'powered' }, [eitriLogo(), 'calindra × eitri']),
      ]),
    ]),
    h('h1', { class: 'wordmark' }, ['calindra', h('br'), h('em', { text: 'strike' })]),
    h('p', { class: 'tagline' }, [
      'Tiro tático com alma de ',
      h('strong', { text: 'CS 1.6' }),
      ', direto no navegador. Salte do céu, pouse onde quiser e ',
      h('strong', { text: 'dispute o pódio' }),
      ' com o time.',
    ]),
    h('div', { class: 'features' }, [
      h('span', { class: 'chip' }, [h('i'), 'Team Deathmatch + todos contra todos']),
      h('span', { class: 'chip' }, [h('i'), 'AWP no airdrop']),
      h('span', { class: 'chip' }, [h('i'), 'Pódio dos 3 melhores']),
      h('span', { class: 'chip' }, [h('i'), 'Bunny hop liberado']),
    ]),
    h('div', { class: 'controls' }, [
      key('WASD', 'mover'),
      key('Espaço', 'pular'),
      key('Ctrl', 'agachar / mergulhar'),
      key('Shift', 'andar em silêncio'),
      key('1 2 3', 'armas · Q última'),
      key('R', 'recarregar'),
      key('Mouse 2', 'luneta da AWP'),
      key('Tab', 'placar · Y chat'),
    ]),
  ]);

  const lobby = h('div', { class: 'lobby' }, [tiles, h('div', { class: 'lobby-inner' }, [hero, form])]);
  app.replaceChildren(lobby);
  if (!settings.name) nameInput.focus();

  const poll = async () => {
    if (document.hidden) return;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${SERVER_HTTP}/status`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(to);
      if (!res.ok) throw new Error(String(res.status));
      status = (await res.json()) as Status;
    } catch {
      status = null;
    }
    if (disposed) return;
    server.classList.toggle('online', !!status);
    server.classList.toggle('offline', !status);
    if (!status) {
      sTitle.textContent = 'Servidor offline';
      sSub.textContent = 'tente de novo em instantes';
      sCount.textContent = '';
      leaders.replaceChildren();
      return;
    }
    footnote.textContent = status.mode === 'defuse'
      ? 'Rodadas sem respawn · spawns fixos · E para plantar ou desarmar'
      : 'Partidas de 5 min · quem fizer mais kills sobe no pódio';
    const mode = status.mode === 'defuse' ? 'defuse bomb · spawns fixos' : status.mode === 'tdm' ? `team deathmatch${status.teams ? ` ${status.teams[0]}×${status.teams[1]}` : ''}` : 'todos contra todos';
    const phase =
      status.phase === 'live' && status.endsInMs !== null
        ? `${status.map} · ${mode} · ${fmt(status.endsInMs)}`
        : status.phase === 'podium'
          ? `${status.map} · pódio`
          : `${status.map} · ${mode} · aquecimento`;
    sTitle.textContent = status.players > 0 ? 'Partida rolando' : 'Arena vazia: chegue primeiro';
    sSub.textContent = phase;
    sCount.textContent = `${status.players}/${status.maxPlayers} online`;
    codeField.classList.toggle('hidden', !status.codeRequired);
    leaders.replaceChildren(
      ...status.leaders
        .filter((l) => l.kills > 0)
        .map((l, i) => h('span', { class: 'chip' }, [`${['🥇', '🥈', '🥉'][i]} `, l.name, ` · ${l.kills}`])),
    );
  };
  void poll();
  const iv = setInterval(() => void poll(), 5000);

  return () => {
    disposed = true;
    clearInterval(iv);
  };
}
