const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

/** WebSocket endpoint of the authoritative game server. */
export const SERVER_WS: string =
  (import.meta.env.VITE_GAME_SERVER as string | undefined) ?? (local ? 'ws://127.0.0.1:7350/ws' : 'wss://game.example.invalid/ws');

export const SERVER_HTTP = SERVER_WS.replace(/^ws/, 'http').replace(/\/ws$/, '');
