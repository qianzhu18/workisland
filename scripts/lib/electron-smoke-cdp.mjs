import WebSocket from 'ws';
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, label) {
  for (let n = 0; n < 100; n++) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  throw new Error(`Timed out: ${label}`);
}
export async function connect(port, match = () => true) {
  const target = await until(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(match); }
    catch { return null; }
  }, `CDP target ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.once('open', resolve));
  let id = 0;
  const pending = new Map();
  socket.on('message', raw => {
    const message = JSON.parse(raw), item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject, timer: setTimeout(() => reject(new Error(`${method} timed out`)), 12000) });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return { target, call, evaluate, close: () => socket.close() };
}
export function terminalFrames(port) {
  const cache = new Map();
  return {
    async get(id) {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      const existing = cache.get(id);
      if (existing && targets.some(t => t.id === existing.targetId)) return existing;
      existing?.close(); cache.delete(id);
      for (const target of targets.filter(t => t.url.endsWith('/terminal.html'))) {
        const client = await connect(port, t => t.id === target.id);
        const identity = await client.evaluate('window.terminalBridge?.identity');
        if (identity?.id === id) { client.targetId = target.id; cache.set(id, client); return client; }
        client.close();
      }
      return null;
    },
    close() { for (const client of cache.values()) client.close(); cache.clear(); }
  };
}
