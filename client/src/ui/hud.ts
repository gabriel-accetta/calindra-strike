import { TEAMS } from '@calindra-strike/shared';
import { ICONS, h, svg } from './dom.ts';

export interface LeaderRow {
  name: string;
  color: string;
  kills: number;
  rank: number;
  me: boolean;
}

export interface ScoreRow {
  id: number;
  name: string;
  color: string;
  kills: number;
  deaths: number;
  hs: number;
  ping: number;
  me: boolean;
  team: number;
  bot: boolean;
}

export interface Marker {
  x: number;
  y: number;
  label: string;
  dist: number;
  offscreen: boolean;
}

const RANK_COLORS = ['#ffd23f', '#dfe4ea', '#e8a066'];

export class Hud {
  readonly root = h('div', { class: 'hud' });
  private readonly timerT = h('div', { class: 't', text: '--:--' });
  private readonly timerS = h('div', { class: 's', text: '' });
  private readonly timer = h('div', { class: 'timer glass' }, [this.timerT, this.timerS]);
  private readonly leadersLeft = h('div', { style: 'display:flex;gap:8px' });
  private readonly leadersRight = h('div', { style: 'display:flex;gap:8px' });
  private readonly feed = h('div', { class: 'killfeed' });
  private readonly hpV = h('div', { class: 'v', text: '100' });
  private readonly hpBar = h('i', { style: 'width:100%' });
  private readonly hp = h('div', { class: 'vital glass' }, [svg(ICONS.heart), h('div', {}, [this.hpV, h('div', { class: 'bar' }, [this.hpBar])])]);
  private readonly arV = h('div', { class: 'v', text: '0' });
  private readonly arBar = h('i', { style: 'width:0%' });
  private readonly armor = h('div', { class: 'vital armor glass' }, [svg(ICONS.shield), h('div', {}, [this.arV, h('div', { class: 'bar' }, [this.arBar])])]);
  private readonly wName = h('b', { text: '' });
  private readonly wTag = h('small', { text: '' });
  private readonly wBox = h('div', { class: 'wname' }, [this.wName, this.wTag]);
  private readonly ammoCount = h('div', { class: 'count' });
  private readonly slotsEl = h('div', { class: 'slots' });
  private readonly reloadI = h('i', { style: 'width:0%' });
  private readonly reloadBar = h('div', { class: 'reload-bar hidden' }, [this.reloadI]);
  private readonly ch = h('div', { class: 'crosshair' });
  private readonly chLines: HTMLElement[] = [];
  private readonly hitm = h('div', { class: 'hitmarker' });
  private readonly dmgRing = h('div', { class: 'dmg-ring' });
  private readonly vignette = h('div', { class: 'vignette' });
  private readonly protect = h('div', { class: 'protect-vignette' });
  private readonly scope = h('div', { class: 'scope hidden' });
  private readonly teamBadge = h('div', { class: 'team-badge hidden' });
  private readonly center = h('div', { class: 'center' });
  private readonly dropAlt = h('div', { class: 'alt', text: '' });
  private readonly drop = h('div', { class: 'drop-hud glass hidden' }, [
    h('div', { class: 'label', text: 'em queda livre' }),
    this.dropAlt,
    h('div', { class: 'hint' }, [h('span', { class: 'kbd', text: 'WASD' }), 'planar  ·  ', h('span', { class: 'kbd', text: 'Ctrl' }), 'mergulhar']),
  ]);
  private readonly deathBy = h('div', { class: 'by' });
  private readonly deathMeta = h('div', { class: 'meta' });
  private readonly deathRespawn = h('div', { class: 'respawn' });
  private readonly death = h('div', { class: 'death glass hidden' }, [h('div', { class: 'label', text: 'eliminado' }), this.deathBy, this.deathMeta, this.deathRespawn]);
  private readonly markersEl = h('div', { class: 'markers' });
  private readonly markerPool: HTMLElement[] = [];
  readonly chat = h('div', { class: 'chat' });
  readonly chatInput = h('input', { class: 'chat-input hidden', maxlength: 100, placeholder: 'mensagem para todos…', autocomplete: 'off', spellcheck: 'false' });
  private readonly sbBody = h('tbody');
  private readonly sbTitle = h('span', { class: 'label', text: '' });
  readonly scoreboard = h('div', { class: 'scoreboard glass hidden' }, [
    h('header', {}, [h('h2', { text: 'placar' }), this.sbTitle]),
    h('table', {}, [
      h('thead', {}, [h('tr', {}, ['#', 'jogador', 'kills', 'mortes', 'hs', 'ping'].map((t) => h('th', { text: t })))]),
      this.sbBody,
    ]),
  ]);
  private readonly netstat = h('div', { class: 'netstat hidden' });
  private dmgTimers = new Map<HTMLElement, number>();
  private last = new Map<string, string>();

  constructor(parent: HTMLElement) {
    for (let i = 0; i < 4; i++) {
      const l = h('i');
      this.chLines.push(l);
      this.ch.append(l);
    }
    this.ch.append(h('i', { class: 'dot hidden' }));
    for (let i = 0; i < 4; i++) {
      const l = h('i');
      l.style.transform = `rotate(${45 + i * 90}deg)`;
      this.hitm.append(l);
    }
    this.root.append(
      this.vignette,
      this.protect,
      this.scope,
      this.markersEl,
      h('div', { class: 'topbar' }, [this.leadersLeft, this.timer, this.leadersRight]),
      this.feed,
      h('div', { class: 'vitals' }, [this.teamBadge, this.hp, this.armor]),
      h('div', { class: 'ammo' }, [this.reloadBar, h('div', { class: 'main glass' }, [this.wBox, this.ammoCount]), this.slotsEl]),
      this.ch,
      this.hitm,
      this.dmgRing,
      this.center,
      this.drop,
      this.death,
      this.chat,
      this.scoreboard,
      this.netstat,
    );
    this.chat.append(this.chatInput);
    parent.append(this.root);
  }

  private set(key: string, v: string, apply: () => void): void {
    if (this.last.get(key) === v) return;
    this.last.set(key, v);
    apply();
  }

  setTimer(text: string, sub: string, urgent: boolean): void {
    this.set('timer', `${text}|${sub}|${urgent}`, () => {
      this.timerT.textContent = text;
      this.timerS.textContent = sub;
      this.timer.classList.toggle('urgent', urgent);
    });
  }

  setLeaders(rows: LeaderRow[], me: LeaderRow | null): void {
    const key = JSON.stringify([rows, me]);
    this.set('leaders', key, () => {
      const card = (r: LeaderRow | null, rank: number) => {
        if (!r) return h('div', { class: 'leader glass empty' }, [h('div', { class: 'rank', style: `background:${RANK_COLORS[rank - 1] ?? '#444'}`, text: String(rank) }), h('div', { class: 'who' }, [h('div', { class: 'name', text: '—' }), h('div', { class: 'k', text: '0 kills' })])]);
        return h('div', { class: `leader glass${r.me ? ' me' : ''}` }, [
          h('div', { class: 'rank', style: `background:${RANK_COLORS[r.rank - 1] ?? r.color}`, text: String(r.rank) }),
          h('div', { class: 'who' }, [h('div', { class: 'name', text: r.name }), h('div', { class: 'k', text: `${r.kills} kill${r.kills === 1 ? '' : 's'}` })]),
        ]);
      };
      this.leadersLeft.replaceChildren(card(rows[0] ?? null, 1), card(rows[1] ?? null, 2));
      const right = [card(rows[2] ?? null, 3)];
      if (me && me.rank > 3) right.push(card(me, me.rank));
      this.leadersRight.replaceChildren(...right);
    });
  }

  /** TDM top bar: Bulldogs score | timer | Martelos score. */
  setTeams(scores: number[], limit: number, myTeam: number): void {
    this.set('leaders', JSON.stringify(['tdm', scores, limit, myTeam]), () => {
      const card = (t: number) =>
        h('div', { class: `team-card glass${t === myTeam ? ' mine' : ''}`, style: `--team:${TEAMS[t].color}` }, [
          h('div', { class: 'team-meta' }, [h('div', { class: 'team-name', text: TEAMS[t].name }), h('div', { class: 'k', text: limit ? `meta ${limit}` : t === myTeam ? 'seu time' : '' })]),
          h('div', { class: 'team-score', text: String(scores[t] ?? 0) }),
        ]);
      this.leadersLeft.replaceChildren(card(0));
      this.leadersRight.replaceChildren(card(1));
    });
  }

  setTeamBadge(team: number): void {
    this.set('badge', String(team), () => {
      this.teamBadge.classList.toggle('hidden', team < 0);
      if (team < 0) return;
      this.teamBadge.textContent = TEAMS[team].name;
      this.teamBadge.style.setProperty('--team', TEAMS[team].color);
    });
  }

  killfeed(killer: string, kc: string, victim: string, vc: string, weapon: string, hs: boolean, mine: boolean): void {
    const el = h('div', { class: `kf glass${mine ? ' mine' : ''}` }, [
      h('span', { style: `color:${kc}`, text: killer }),
      h('span', { class: 'w', text: weapon }),
      hs ? h('span', { class: 'hs', text: 'HS' }) : null,
      h('span', { style: `color:${vc}`, text: victim }),
    ]);
    this.pushFeed(el);
  }

  info(text: string): void {
    this.pushFeed(h('div', { class: 'kf glass info', text }));
  }

  private pushFeed(el: HTMLElement): void {
    this.feed.append(el);
    while (this.feed.children.length > 6) this.feed.firstElementChild?.remove();
    setTimeout(() => el.remove(), 6500);
  }

  setVitals(hp: number, armor: number): void {
    this.set('vitals', `${hp}|${armor}`, () => {
      this.hpV.textContent = String(hp);
      this.hpBar.style.width = `${hp}%`;
      this.hp.classList.toggle('low', hp <= 25);
      this.arV.textContent = String(armor);
      this.arBar.style.width = `${armor}%`;
      this.armor.classList.toggle('hidden', armor <= 0);
      this.vignette.style.opacity = hp <= 25 ? '0.7' : '0';
    });
  }

  setWeapon(name: string, tag: string, mag: number, reserve: number, legendary: boolean, melee: boolean, slots: { key: string; label: string; active: boolean }[]): void {
    this.set('weapon', JSON.stringify([name, mag, reserve, slots]), () => {
      this.wName.textContent = name;
      this.wTag.textContent = legendary ? 'LENDÁRIA' : tag;
      this.wBox.classList.toggle('legendary', legendary);
      if (melee) this.ammoCount.replaceChildren('∞');
      else this.ammoCount.replaceChildren(String(mag), h('small', { text: ` / ${reserve}` }));
      this.ammoCount.classList.toggle('empty', !melee && mag === 0);
      this.slotsEl.replaceChildren(...slots.map((s) => h('div', { class: `slot glass${s.active ? ' active' : ''}`, text: `${s.key} ${s.label}` })));
    });
  }

  setReload(frac: number): void {
    const show = frac >= 0;
    this.reloadBar.classList.toggle('hidden', !show);
    if (show) this.reloadI.style.width = `${Math.round(frac * 100)}%`;
  }

  setCrosshair(gapPx: number, size: number, color: string, visible: boolean): void {
    const g = Math.round(gapPx);
    this.set('ch', `${g}|${size}|${color}|${visible}`, () => {
      this.ch.style.display = visible ? '' : 'none';
      this.ch.style.setProperty('--ch-color', color);
      const t = 2;
      const [up, down, left, right] = this.chLines;
      Object.assign(up.style, { width: `${t}px`, height: `${size}px`, left: `${-t / 2}px`, top: `${-g - size}px` });
      Object.assign(down.style, { width: `${t}px`, height: `${size}px`, left: `${-t / 2}px`, top: `${g}px` });
      Object.assign(left.style, { width: `${size}px`, height: `${t}px`, top: `${-t / 2}px`, left: `${-g - size}px` });
      Object.assign(right.style, { width: `${size}px`, height: `${t}px`, top: `${-t / 2}px`, left: `${g}px` });
    });
  }

  hit(kind: 'body' | 'head' | 'kill'): void {
    this.hitm.className = `hitmarker ${kind}`;
    void this.hitm.offsetWidth;
    this.hitm.classList.add('show');
  }

  damage(angle: number): void {
    const el = h('i');
    el.style.transform = `rotate(${angle}rad)`;
    el.style.opacity = '1';
    this.dmgRing.append(el);
    requestAnimationFrame(() => {
      setTimeout(() => (el.style.opacity = '0'), 350);
    });
    setTimeout(() => el.remove(), 1100);
    this.vignette.style.opacity = '0.8';
    const prev = this.dmgTimers.get(this.vignette);
    if (prev) clearTimeout(prev);
    this.dmgTimers.set(
      this.vignette,
      window.setTimeout(() => {
        this.last.delete('vitals');
        this.vignette.style.opacity = '0';
      }, 180),
    );
  }

  setProtect(on: boolean): void {
    this.protect.style.opacity = on ? '1' : '0';
  }

  setScope(on: boolean): void {
    this.scope.classList.toggle('hidden', !on);
  }

  announce(text: string, sub?: string, white = false): void {
    const nodes: Node[] = [h('div', { class: `announce${white ? ' white' : ''}`, text })];
    if (sub) nodes.push(h('div', { class: 'announce-sub glass', text: sub }));
    this.center.replaceChildren(...nodes);
  }

  setDrop(alt: number | null): void {
    this.drop.classList.toggle('hidden', alt === null);
    if (alt !== null) this.dropAlt.textContent = `${Math.max(0, Math.round(alt * 0.0254))} m`;
  }

  setDeath(info: { killer: string; color: string; weapon: string; hs: boolean } | null): void {
    this.death.classList.toggle('hidden', !info);
    if (!info) return;
    this.deathBy.replaceChildren('por ', h('span', { style: `color:${info.color}`, text: info.killer }));
    this.deathMeta.textContent = `${info.weapon}${info.hs ? ' · headshot' : ''}`;
  }

  setRespawn(text: string): void {
    this.deathRespawn.textContent = text;
  }

  setMarkers(list: Marker[]): void {
    while (this.markerPool.length < list.length) {
      const el = h('div', { class: 'marker' }, [h('div', { class: 'icon', text: '★' }), h('span'), h('span')]);
      this.markerPool.push(el);
      this.markersEl.append(el);
    }
    this.markerPool.forEach((el, i) => {
      const m = list[i];
      el.classList.toggle('hidden', !m);
      if (!m) return;
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.classList.toggle('offscreen', m.offscreen);
      const [, a, b] = el.children;
      a.textContent = m.label;
      b.textContent = `${Math.round(m.dist * 0.0254)} m`;
    });
  }

  chatLine(name: string, color: string, text: string): void {
    const line = h('div', { class: 'chat-line' }, [h('b', { style: `color:${color}`, text: name }), text]);
    this.chat.insertBefore(line, this.chatInput);
    const lines = this.chat.querySelectorAll('.chat-line');
    if (lines.length > 7) lines[0].remove();
  }

  openChat(open: boolean): void {
    this.chat.classList.toggle('open', open);
    this.chatInput.classList.toggle('hidden', !open);
    if (open) {
      this.chatInput.value = '';
      this.chatInput.focus();
    } else this.chatInput.blur();
  }

  showScoreboard(show: boolean, rows: ScoreRow[], title: string, teams: number[] | null, unit = 'kills'): void {
    this.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    this.set('sb', JSON.stringify([rows, title, teams, unit]), () => {
      this.sbTitle.textContent = title;
      const line = (r: ScoreRow, i: number) =>
        h('tr', { class: r.me ? 'me' : '' }, [
          h('td', { text: String(i + 1) }),
          h('td', {}, [h('span', { class: 'pdot', style: `background:${r.color}` }), r.name]),
          h('td', { text: String(r.kills) }),
          h('td', { text: String(r.deaths) }),
          h('td', { text: String(r.hs) }),
          h('td', { class: r.bot ? 'bot-tag' : '', text: r.bot ? 'bot' : String(r.ping) }),
        ]);
      if (!teams) {
        this.sbBody.replaceChildren(...rows.map(line));
        return;
      }
      const out: HTMLElement[] = [];
      for (const t of [0, 1]) {
        const mine = rows.filter((r) => r.team === t);
        out.push(
          h('tr', { class: 'team-row', style: `--team:${TEAMS[t].color}` }, [
            h('td', { colspan: 6 }, [h('span', { class: 'team-name', text: TEAMS[t].name }), h('span', { class: 'team-total', text: `${teams[t] ?? 0} ${unit} · ${mine.length} jogador${mine.length === 1 ? '' : 'es'}` })]),
          ]),
          ...mine.map(line),
        );
      }
      this.sbBody.replaceChildren(...out);
    });
  }

  setNetstat(text: string | null): void {
    this.netstat.classList.toggle('hidden', text === null);
    if (text !== null) this.netstat.textContent = text;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }
}
