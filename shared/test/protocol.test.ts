import { describe, expect, it } from 'vitest';
import { BTN, parseClientMessage, sanitizeChat, sanitizeName } from '../src/index.ts';

describe('parseClientMessage', () => {
  it('accepts a valid hello and input packet', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'hello', v: 3, name: 'Gabi', color: 2, primary: 2 }))).toMatchObject({ t: 'hello', code: '' });
    const m = parseClientMessage(JSON.stringify({ t: 'in', c: [[1, 129, 0.5, -0.1, 0, 12345]] }));
    expect(m).toEqual({ t: 'in', c: [{ seq: 1, buttons: 129, yaw: 0.5, pitch: -0.1, weapon: 0, interp: 12345 }] });
  });

  it.each([
    'not json',
    '[]',
    'null',
    '{"t":"nope"}',
    '{"t":"in","c":[]}',
    '{"t":"in","c":[[1,99999,0,0,0,0]]}',
    '{"t":"in","c":[[1,1,"NaN",0,0,0]]}',
    '{"t":"in","c":[[1,1,0,0,9,0]]}',
    '{"t":"in","c":[[1.5,1,0,0,0,0]]}',
    '{"t":"hello","v":3,"name":"x","color":99,"primary":2}',
    '{"t":"hello","v":3,"name":"x","color":1,"primary":5}',
    '{"t":"loadout","primary":6}',
    '{"t":"chat","text":""}',
    '{"t":"__proto__"}',
  ])('rejects %s', (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it('accepts the bomb interaction button but rejects unknown button bits', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'in', c: [[1, BTN.USE, 0, 0, 0, 0]] }))).not.toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'in', c: [[1, 2048, 0, 0, 0, 0]] }))).toBeNull();
  });

  it('rejects oversized payloads and too many commands', () => {
    expect(parseClientMessage('x'.repeat(5000))).toBeNull();
    const c = Array.from({ length: 13 }, (_, i) => [i, 0, 0, 0, 0, 0]);
    expect(parseClientMessage(JSON.stringify({ t: 'in', c }))).toBeNull();
  });
});

describe('sanitizers', () => {
  it('strips control, bidi and markup characters from names', () => {
    expect(sanitizeName('  <b>Gabi</b>‮\u0000  ')).toBe('bGabib');
    expect(sanitizeName('José Ação')).toBe('José Ação');
    expect(sanitizeName('a'.repeat(40)).length).toBe(16);
    expect(sanitizeName('Z͓͑͒algo')).toBe('Zalgo');
  });

  it('keeps chat readable but bounded', () => {
    expect(sanitizeChat('gg wp!! 🔥')).toBe('gg wp!! 🔥');
    expect(sanitizeChat('a\nb\tc')).toBe('abc');
    expect(sanitizeChat('x'.repeat(500)).length).toBe(100);
  });
});
