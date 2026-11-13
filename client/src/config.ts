const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const sameOrigin = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

/** Configure a remote backend at build time; otherwise use a local/same-origin server. */
export const SERVER_WS: string =
  (import.meta.env.VITE_GAME_SERVER as string | undefined)?.trim() || (local ? 'ws://127.0.0.1:7350/ws' : sameOrigin);

export const SERVER_HTTP = SERVER_WS.replace(/^ws/, 'http').replace(/\/ws$/, '');
