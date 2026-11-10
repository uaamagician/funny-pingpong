// 連線：兩台裝置用「房號」配對（4 位數字），之後資料直接在兩台裝置之間傳（WebRTC）。
//
// 預設使用 PeerJS 的公用配對伺服器（只負責幫兩台裝置找到彼此，之後的比賽資料不經過它）。
// 傳送的內容只有比賽用的資料：暱稱、角色外觀、擊球與球的位置，沒有任何個人資料。
// 測試用：網址加上 ?net=local，會改用同一個瀏覽器內的分頁互連（不需要網路）。
//
// 介面（兩種傳輸方式一致）：
//   const link = hostRoom({ onCode, onOpen, onMessage, onClose, onError })
//   const link = joinRoom(code, { onOpen, onMessage, onClose, onError })
//   link.send(obj)；link.close()
import Peer from 'peerjs';

const PREFIX = 'ppdm-room-';
const useLocal = () => new URLSearchParams(location.search).get('net') === 'local';
const randCode = () => String(Math.floor(1000 + Math.random() * 9000));
const uid = () => Math.random().toString(36).slice(2, 10);

// ───────── PeerJS（跨網路）─────────
function wireConn(conn, cb, state) {
  state.conn = conn;
  conn.on('open', () => { state.open = true; cb.onOpen?.(); });
  conn.on('data', (d) => { state.lastRecv = Date.now(); cb.onMessage?.(d); });
  conn.on('close', () => { if (!state.closed) { state.closed = true; cb.onClose?.('close'); } });
  conn.on('error', (e) => { cb.onError?.(e); });
}

function peerHost(cb) {
  const state = { open: false, closed: false, conn: null, lastRecv: Date.now(), peer: null };
  let tries = 0;
  const start = () => {
    const code = randCode();
    const peer = new Peer(PREFIX + code);
    state.peer = peer;
    peer.on('open', () => cb.onCode?.(code));
    peer.on('connection', (conn) => {
      if (state.conn) { conn.close(); return; } // 一個房間只接受一位對手
      wireConn(conn, cb, state);
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries < 6) { tries++; peer.destroy(); start(); return; } // 房號被用了，換一個
      cb.onError?.(e);
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* 略過 */ } });
  };
  start();
  return {
    send: (o) => { try { state.conn?.open && state.conn.send(o); } catch { /* 略過 */ } },
    close: () => { state.closed = true; try { state.conn?.close(); state.peer?.destroy(); } catch { /* 略過 */ } },
    state,
  };
}

function peerJoin(code, cb) {
  const state = { open: false, closed: false, conn: null, lastRecv: Date.now(), peer: null };
  const peer = new Peer();
  state.peer = peer;
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    wireConn(conn, cb, state);
  });
  peer.on('error', (e) => cb.onError?.(e));
  return {
    send: (o) => { try { state.conn?.open && state.conn.send(o); } catch { /* 略過 */ } },
    close: () => { state.closed = true; try { state.conn?.close(); peer.destroy(); } catch { /* 略過 */ } },
    state,
  };
}

// ───────── 同一個瀏覽器內的分頁互連（測試用）─────────
function localLink(role, code, cb) {
  const me = uid();
  const ch = new BroadcastChannel(`pp-local-${code}`);
  const state = { open: false, closed: false, peerId: null, lastRecv: Date.now() };
  const post = (m) => ch.postMessage({ from: me, ...m });
  const onOpen = (pid) => { state.peerId = pid; state.open = true; cb.onOpen?.(); };
  ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.from === me) return;
    if (m.kind === 'join' && role === 'host' && !state.peerId) { post({ kind: 'accept', to: m.from }); onOpen(m.from); return; }
    if (m.kind === 'accept' && role === 'guest' && m.to === me && !state.peerId) { onOpen(m.from); return; }
    if (m.kind === 'data' && m.from === state.peerId && (!m.to || m.to === me)) { state.lastRecv = Date.now(); cb.onMessage?.(m.data); return; }
    if (m.kind === 'bye' && m.from === state.peerId && !state.closed) { state.closed = true; cb.onClose?.('close'); }
  };
  if (role === 'guest') setTimeout(() => { if (!state.peerId) { post({ kind: 'join' }); setTimeout(() => { if (!state.peerId) cb.onError?.({ type: 'peer-unavailable' }); }, 1200); } }, 50);
  return {
    send: (o) => { if (state.open) post({ kind: 'data', data: o, to: state.peerId }); },
    close: () => { state.closed = true; try { post({ kind: 'bye' }); ch.close(); } catch { /* 略過 */ } },
    state,
  };
}

export function hostRoom(cb) {
  if (useLocal()) {
    const code = randCode();
    setTimeout(() => cb.onCode?.(code), 0);
    return localLink('host', code, cb);
  }
  return peerHost(cb);
}

export function joinRoom(code, cb) {
  return useLocal() ? localLink('guest', code, cb) : peerJoin(code, cb);
}

/** 把連線錯誤翻成玩家看得懂的話。 */
export function explainError(e) {
  const t = e?.type || '';
  if (t === 'peer-unavailable') return '找不到這個房間，請確認房號';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return '連不上配對伺服器，請檢查網路';
  if (t === 'webrtc') return '兩台裝置之間連不起來（網路環境可能不允許直連）';
  return '連線失敗，請再試一次';
}
