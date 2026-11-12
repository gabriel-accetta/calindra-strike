/**
 * Dev-only load/behaviour test: spawns simple bots that strafe around and shoot
 * at the nearest player. Usage:
 *   npx tsx tools/bots.ts [count=3] [ws://127.0.0.1:7350/ws] [origin=http://localhost:5173]
 */
import { BTN, PROTOCOL_VERSION, TICK_MS, WEAPON, encodeCmd } from '@calindra-strike/shared';
import WebSocket from 'ws';

const count = Number(process.argv[2] ?? 3);
const url = process.argv[3] ?? 'ws://127.0.0.1:7350/ws';
const origin = process.argv[4] ?? 'http://localhost:5173';
const NAMES = ['Brokkr', 'Sindri', 'Freya', 'Loki', 'Tyr', 'Skadi', 'Odin', 'Heimdall'];

function bot(i: number): void {
  const ws = new WebSocket(url, { headers: { Origin: origin } });
  let id = -1;
  let me: number[] | null = null;
  let others: number[][] = [];
  let seq = 0;
  let t = 0;
  let serverTime = 0;
  ws.on('open', () =>
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: `bot ${NAMES[i % NAMES.length]}`, color: (i * 5) % 12, primary: [WEAPON.RIFLE, WEAPON.SMG, WEAPON.SHOTGUN][i % 3] })),
  );
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'welcome') id = m.id;
    if (m.t === 'snap') {
      me = m.me;
      serverTime = m.time;
      others = m.ps.filter((p: number[]) => p[0] !== id);
    }
    if (m.t === 'reject') console.log('rejected', m.reason);
  });
  ws.on('close', (c, r) => console.log(`bot ${i} closed`, c, String(r)));
  setInterval(() => {
    if (ws.readyState !== ws.OPEN || id < 0) return;
    t++;
    const cmds = [];
    for (let k = 0; k < 2; k++) {
      let yaw = (t * 0.01 + i) % (Math.PI * 2);
      let pitch = 0;
      let buttons = (Math.floor(t / 40) + i) % 2 ? BTN.LEFT : BTN.RIGHT;
      if (t % 120 === 0) buttons |= BTN.JUMP;
      if (me) {
        const [x, y, z] = me;
        let best: number[] | null = null;
        let bd = 1e9;
        for (const o of others) {
          const dd = Math.hypot(o[1] - x, o[3] - z);
          if (dd < bd) {
            bd = dd;
            best = o;
          }
        }
        if (best && bd < 1500) {
          const dx = best[1] - x;
          const dz = best[3] - z;
          const dy = best[2] + 56 - (y + 64);
          yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.06;
          pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (Math.random() - 0.5) * 0.04;
          if (t % 50 < 20) buttons |= BTN.ATTACK;
        } else buttons |= BTN.FWD;
      }
      cmds.push(encodeCmd({ seq: ++seq, buttons, yaw, pitch, weapon: 0, interp: Math.max(0, serverTime - 100) }));
    }
    ws.send(JSON.stringify({ t: 'in', c: cmds }));
  }, TICK_MS * 2);
}

for (let i = 0; i < count; i++) setTimeout(() => bot(i), i * 300);
