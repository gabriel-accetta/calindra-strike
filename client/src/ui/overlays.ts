import { PRIMARY_CHOICES, TEAMS, type WeaponId, weaponDef } from '@calindra-strike/shared';
import type { PodiumData, TeamState } from '../game/client.ts';
import { CROSSHAIR_COLORS, type Settings, saveSettings } from '../settings.ts';
import { gameLogo, h } from './dom.ts';

export interface OverlayHooks {
  resume(): void;
  leave(): void;
  switchTeam(): void;
  settingsChanged(s: Settings): void;
}

/** Click-to-play, pause/settings menu, podium results and disconnect overlays. */
export class Overlays {
  private readonly click: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly podium: HTMLElement;
  private readonly podiumCards = h('div', { class: 'podium-cards' });
  private readonly podiumNext = h('div', { class: 'podium-next' });
  private readonly podiumLabel = h('div', { class: 'label', text: 'fim de partida' });
  private readonly podiumTitle = h('h2', { text: 'pódio' });
  private readonly podiumScore = h('div', { class: 'podium-score hidden' });
  private readonly teamRow = h('div', { class: 'team-switch hidden' });
  private nextMap = '';
  private lastSeconds = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly hooks: OverlayHooks,
  ) {
    const play = h('button', { class: 'btn btn-primary', type: 'button', text: 'clique para jogar', onclick: () => hooks.resume() });
    this.click = h('div', { class: 'overlay' }, [
      h('div', { class: 'click-to-play' }, [
        gameLogo('game-logo cta-logo'),
        h('h2', { class: 'wordmark', text: 'pronto?' }),
        h('p', { text: 'WASD para mover · E para plantar ou desarmar no modo Defuse Bomb.' }),
        play,
        h('p', { class: 'label', text: 'esc solta o mouse · tab mostra o placar' }),
      ]),
    ]);
    this.menu = h('div', { class: 'overlay hidden' }, [this.buildMenu()]);
    this.podium = h('div', { class: 'podium-ui hidden' }, [
      h('div', { class: 'head' }, [gameLogo('game-logo podium-logo'), this.podiumLabel, this.podiumTitle, this.podiumScore]),
      h('div', {}, [this.podiumCards, this.podiumNext]),
    ]);
    root.append(this.podium, this.click, this.menu);
  }

  private buildMenu(): HTMLElement {
    const s = this.settings;
    const changed = () => {
      saveSettings(s);
      this.hooks.settingsChanged(s);
    };
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
      const out = h('output', { text: fmt(get()) });
      const input = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': label });
      input.addEventListener('input', () => {
        set(Number(input.value));
        out.textContent = fmt(get());
        changed();
      });
      return h('div', { class: 'row' }, [h('span', { text: label }), input, out]);
    };
    const seg = <T>(label: string, options: { v: T; label: string; style?: string }[], get: () => T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'seg' });
      const draw = () =>
        wrap.replaceChildren(
          ...options.map((o) =>
            h('button', {
              type: 'button',
              style: o.style,
              'aria-pressed': String(get() === o.v),
              text: o.label,
              onclick: () => {
                set(o.v);
                changed();
                draw();
              },
            }),
          ),
        );
      draw();
      return h('div', { class: 'row', style: 'grid-template-columns:150px 1fr' }, [h('span', { text: label }), wrap]);
    };

    return h('div', { class: 'menu glass' }, [
      h('h2', { text: 'pausado' }),
      h('p', { class: 'sub', text: 'O jogo continua rolando para os outros: volte logo.' }),
      this.teamRow,
      seg(
        'arma principal',
        PRIMARY_CHOICES.map((id: WeaponId) => ({ v: id, label: weaponDef(id).name })),
        () => s.primary,
        (v) => (s.primary = v),
      ),
      h('p', { class: 'label', style: 'margin:-4px 0 10px 162px', text: 'vale a partir do próximo spawn' }),
      slider('sensibilidade', 0.3, 8, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v), (v) => v.toFixed(2)),
      slider('volume', 0, 1, 0.05, () => s.volume, (v) => (s.volume = v), (v) => `${Math.round(v * 100)}%`),
      slider('campo de visão', 75, 110, 1, () => s.fov, (v) => (s.fov = v), (v) => `${v}°`),
      slider('mira: tamanho', 2, 14, 1, () => s.crosshairSize, (v) => (s.crosshairSize = v), (v) => `${v}px`),
      slider('mira: abertura', 0, 10, 1, () => s.crosshairGap, (v) => (s.crosshairGap = v), (v) => `${v}px`),
      seg(
        'cor da mira',
        CROSSHAIR_COLORS.map((c) => ({ v: c, label: '●', style: `color:${c}` })),
        () => s.crosshairColor,
        (v) => (s.crosshairColor = v),
      ),
      seg(
        'mira dinâmica',
        [
          { v: true, label: 'ligada' },
          { v: false, label: 'fixa' },
        ],
        () => s.dynamicCrosshair,
        (v) => (s.dynamicCrosshair = v),
      ),
      seg(
        'estatísticas',
        [
          { v: false, label: 'ocultas' },
          { v: true, label: 'fps + ping' },
        ],
        () => s.showNet,
        (v) => (s.showNet = v),
      ),
      h('div', { class: 'actions' }, [
        h('button', { class: 'btn btn-primary', type: 'button', text: 'voltar ao jogo', onclick: () => this.hooks.resume() }),
        h('button', { class: 'btn', type: 'button', text: 'sair da partida', onclick: () => this.hooks.leave() }),
      ]),
    ]);
  }

  showClick(v: boolean): void {
    this.click.classList.toggle('hidden', !v);
  }

  showMenu(v: boolean, team: TeamState | null = null): void {
    this.menu.classList.toggle('hidden', !v);
    if (v) this.click.classList.add('hidden');
    if (v) this.renderTeamRow(team);
  }

  private renderTeamRow(team: TeamState | null): void {
    this.teamRow.classList.toggle('hidden', !team);
    if (!team) return;
    const mine = TEAMS[team.team];
    const other = TEAMS[1 - team.team];
    this.teamRow.replaceChildren(
      h('div', { class: 'team-current', style: `--team:${mine.color}` }, [h('span', { class: 'label', text: 'seu time' }), h('b', { text: mine.name })]),
      h('button', {
        class: 'btn',
        type: 'button',
        style: `--team:${other.color}`,
        disabled: !team.canSwitch,
        title: team.canSwitch ? '' : 'O outro time já tem a mesma quantidade ou mais jogadores',
        text: team.canSwitch ? `ir para os ${other.name}` : `${other.name}: time cheio`,
        onclick: () => this.hooks.switchTeam(),
      }),
    );
  }

  showPodium(data: PodiumData | null, next: string): void {
    this.podium.classList.toggle('hidden', !data);
    if (!data) return;
    this.nextMap = next;
    this.lastSeconds = -1;
    const tdm = data.mode !== 'ffa';
    this.podiumScore.classList.toggle('hidden', !tdm);
    if (tdm) {
      const w = data.winner;
      this.podiumLabel.textContent = w < 0 ? 'fim de partida · team deathmatch' : w === data.myTeam ? 'seu time venceu!' : 'não foi dessa vez';
      this.podiumTitle.textContent = w < 0 ? 'empate' : `${TEAMS[w].name} venceram`;
      this.podiumTitle.style.color = w < 0 ? '' : TEAMS[w].color;
      this.podiumScore.replaceChildren(
        h('span', { style: `color:${TEAMS[0].color}`, text: TEAMS[0].name }),
        h('b', { text: `${data.teams[0] ?? 0} × ${data.teams[1] ?? 0}` }),
        h('span', { style: `color:${TEAMS[1].color}`, text: TEAMS[1].name }),
      );
    } else {
      this.podiumLabel.textContent = 'fim de partida';
      this.podiumTitle.textContent = 'pódio';
      this.podiumTitle.style.color = '';
    }
    const order = [1, 0, 2];
    const cls = ['first', 'second', 'third'];
    const place = tdm && data.winner >= 0 ? ['mvp do time', '2º do time', '3º do time'] : ['1º lugar', '2º lugar', '3º lugar'];
    this.podiumCards.replaceChildren(
      ...order.map((i) => {
        const r = data.featured[i];
        if (!r) return h('div');
        return h('div', { class: `pcard glass ${cls[i]}` }, [
          h('div', { class: 'place', text: place[i] }),
          h('div', { class: 'pname', style: `color:${data.colorFor(r)}`, text: r.name }),
          h('div', { class: 'stats', text: `${r.kills} kills · ${r.deaths} mortes · ${r.hs} hs` }),
        ]);
      }),
    );
  }

  podiumCountdown(seconds: number): void {
    if (seconds === this.lastSeconds) return;
    this.lastSeconds = seconds;
    this.podiumNext.replaceChildren('próxima partida em ', h('b', { text: `${seconds}s` }), this.nextMap ? ` · ${this.nextMap}` : '');
  }

  disconnected(reason: string, onBack: () => void): void {
    this.root.append(
      h('div', { class: 'overlay' }, [
        h('div', { class: 'toast glass' }, [
          h('h3', { text: 'desconectado' }),
          h('p', { text: reason }),
          h('button', { class: 'btn btn-primary', type: 'button', text: 'voltar ao lobby', onclick: onBack }),
        ]),
      ]),
    );
  }
}
