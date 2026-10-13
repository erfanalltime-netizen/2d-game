// ULTRA ARENA v2 - LAN server (zero dependency, only Node.js needed)
// Run:  node server.js     then open  http://<your-ip>:3000  on every phone/PC on the same WiFi
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const AM = require('./map.js');
const MAP = AM.build(20260101);
const PORT = process.env.PORT || 3000;
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/three.min.js': 'three.min.js', '/map.js': 'map.js' };

const server = http.createServer((req, res) => {
  const f = FILES[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(__dirname, f), (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});

// ================= minimal WebSocket =================
const clients = new Map();
let nextId = 1;
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, id: nextId++, buf: Buffer.alloc(0), name: '', col: 0, state: 'new', party: null, p: null };
  clients.set(c.id, c);
  sock.on('data', d => { c.buf = Buffer.concat([c.buf, d]); parse(c); });
  sock.on('close', () => drop(c));
  sock.on('error', () => drop(c));
});
function parse(c) {
  while (c.buf.length >= 2) {
    const b = c.buf, op = b[0] & 15;
    let len = b[1] & 127, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const masked = b[1] & 128; if (masked) off += 4;
    if (b.length < off + len) return;
    const data = Buffer.from(b.subarray(off, off + len));
    if (masked) { const m = b.subarray(off - 4, off); for (let i = 0; i < len; i++) data[i] ^= m[i & 3]; }
    c.buf = b.subarray(off + len);
    if (op === 8) { c.sock.end(); return; }
    if (op === 9) { c.sock.write(Buffer.from([0x8A, 0])); continue; }
    if (op === 1) { try { onMsg(c, JSON.parse(data.toString())); } catch (e) { console.error(e.message); } }
  }
}
function frame(str) {
  const d = Buffer.from(str), l = d.length; let h;
  if (l < 126) h = Buffer.from([0x81, l]);
  else if (l < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(l, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(l), 2); }
  return Buffer.concat([h, d]);
}
const send = (c, o) => { if (!c.sock.destroyed) c.sock.write(frame(JSON.stringify(o))); };
function bcastAll(o) { const f = frame(JSON.stringify(o)); for (const c of clients.values()) if (c.state !== 'new' && !c.sock.destroyed) c.sock.write(f); }
function bcastMatch(o, except) { const f = frame(JSON.stringify(o)); for (const c of clients.values()) if (c.p && c !== except && !c.sock.destroyed) c.sock.write(f); }

// ================= parties / lobby =================
let partyId = 1;
const parties = new Map();
const newParty = c => { const p = { id: partyId++, leader: c.id, m: [c] }; parties.set(p.id, p); c.party = p; return p; };
function sendParty(p) { const o = { t: 'party', id: p.id, leader: p.leader, m: p.m.map(x => [x.id, x.name, x.col]) }; p.m.forEach(x => send(x, o)); }
function leaveParty(c) {
  const p = c.party; if (!p) return;
  p.m = p.m.filter(x => x !== c); c.party = null;
  if (!p.m.length) parties.delete(p.id);
  else { if (p.leader === c.id) p.leader = p.m[0].id; sendParty(p); }
}
function joinParty(c, p) { leaveParty(c); p.m.push(c); c.party = p; sendParty(p); }
let onlineTimer = null;
function online() {   // throttled
  if (onlineTimer) return;
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    bcastAll({ t: 'online', l: [...clients.values()].filter(c => c.state !== 'new').map(c => [c.id, c.name, c.state, c.party ? c.party.id : 0]) });
  }, 30);
}

// ================= match state =================
const DMG = [20, 13, 11, 70, 38];
let walls = [], wallId = 1, botNext = 1000;
const bots = new Map();
const PK = MAP.pk.map(k => ({ ...k }));
const num = v => Number.isFinite(+v) ? +v : 0;
const BNAMES = ['Rafi', 'Sakib', 'Tamim', 'Nayeem', 'Rocky', 'Hunter', 'Viper', 'Ghost', 'Shadow', 'Tiger', 'Joy', 'Sumon'];
const pub = p => ({ id: p.id, name: p.name, col: p.col, bot: p.bot ? 1 : 0, x: p.x, y: p.y, z: p.z, ry: p.ry, hp: p.hp, alive: p.alive, k: p.k, d: p.d });
const pubw = w => ({ id: w.id, o: w.o, x: w.x, z: w.z, ry: w.ry, hp: w.hp });
const matchPlayers = () => { const a = []; for (const c of clients.values()) if (c.p) a.push(c.p); for (const b of bots.values()) a.push(b); return a; };
const humans = () => { const a = []; for (const c of clients.values()) if (c.p) a.push(c.p); return a; };
const getP = id => { const c = clients.get(id); return (c && c.p) || bots.get(id) || null; };

function pickSpawn() {
  const all = matchPlayers().filter(p => p.alive);
  let best = MAP.spawns[0], bd = -1;
  for (let i = 0; i < 8; i++) {
    const s = MAP.spawns[(Math.random() * MAP.spawns.length) | 0];
    let md = 999; for (const p of all) md = Math.min(md, Math.hypot(p.x - s[0], p.z - s[1]));
    if (md > bd) { bd = md; best = s; }
  }
  return best;
}
function scores() {
  const l = matchPlayers().map(p => [p.id, p.name, p.k, p.d]).sort((a, b) => b[2] - a[2]);
  bcastMatch({ t: 'sc', l });
}
function mkPlayer(c, x, z) { return { id: c.id, name: c.name, col: c.col, x, y: 0, z, ry: Math.atan2(x, z), pt: 0, w: 0, hp: 100, alive: true, k: 0, d: 0, med: 2, dirty: true }; }

function enterMatch(c, x, z) {
  c.state = 'match';
  const p = c.p = mkPlayer(c, x, z);
  send(c, { t: 'match', me: { x, z, ry: p.ry, hp: 100, med: 2 }, pl: matchPlayers().filter(q => q !== p).map(pub), walls: walls.map(pubw), pk: PK.map(k => ({ id: k.id, x: k.x, z: k.z, on: k.on })) });
  bcastMatch({ t: 'j', p: pub(p) }, c);
}
function exitMatch(c) {
  if (!c.p) return;
  c.p.gone = true; const id = c.id; c.p = null; c.state = 'lobby';
  walls.filter(w => w.o === id).forEach(rmWall);
  bcastMatch({ t: 'l', id });
  adjustBots(); scores(); online();
}
function startParty(c) {
  const p = c.party; if (!p || p.leader !== c.id) return;
  const s = pickSpawn();
  p.m.forEach((m, i) => {
    if (m.p) return;
    enterMatch(m, s[0] + (i - (p.m.length - 1) / 2) * 1.9, s[1] + ((i % 2) ? 1.2 : -1.2));
  });
  adjustBots(); scores(); online();
}

function addBot() {
  const s = pickSpawn(), id = botNext++;
  const b = { id, bot: true, name: 'BOT ' + BNAMES[(Math.random() * BNAMES.length) | 0], col: (Math.random() * 8) | 0, x: s[0], y: 0, z: s[1], ry: 0, pt: 0, w: 0, hp: 100, alive: true, k: 0, d: 0, dirty: true,
    cd: 1 + Math.random(), st: 0, sd: 1, wx: s[0], wz: s[1], wt: 0, lx: s[0], lz: s[1], sk: 0, esc: 0, ex: 0, ez: 0 };
  bots.set(id, b);
  bcastMatch({ t: 'j', p: pub(b) });
}
function adjustBots() {
  const h = humans().length;
  const target = h ? Math.max(0, 8 - h * 2) : 0;
  while (bots.size < target) addBot();
  while (bots.size > target) { const id = [...bots.keys()].pop(); bots.get(id).gone = true; bots.delete(id); bcastMatch({ t: 'l', id }); }
  scores();
}
function rmWall(w) { walls = walls.filter(q => q !== w); bcastMatch({ t: 'wd', id: w.id }); }
function hurtWall(w, dmg) { w.hp -= dmg; if (w.hp <= 0) rmWall(w); else bcastMatch({ t: 'wu', id: w.id, hp: w.hp }); }

function damage(v, by, dmg, head) {
  if (!v.alive) return;
  v.hp = Math.max(0, v.hp - dmg);
  bcastMatch({ t: 'd', id: v.id, by: by.id, dmg, h: head ? 1 : 0, hp: v.hp });
  if (v.hp <= 0) kill(v, by);
}
function kill(v, k) {
  v.alive = false; v.hp = 0; v.d++; if (k && k !== v) k.k++;
  bcastMatch({ t: 'k', id: v.id, by: k ? k.id : 0, vn: v.name, bn: k ? k.name : '' });
  scores();
  setTimeout(() => {
    if (v.gone) return;
    const s = pickSpawn();
    v.x = s[0]; v.y = 0; v.z = s[1]; v.hp = 100; v.alive = true; v.med = 2; v.dirty = true; v.lx = v.x; v.lz = v.z;
    bcastMatch({ t: 'rs', id: v.id, x: v.x, y: 0, z: v.z, hp: 100, med: 2 });
  }, v.bot ? 4000 : 3000);
}

// ================= messages =================
function onMsg(c, m) {
  if (m.t === 'hello') {
    if (c.state !== 'new') return;
    c.name = String(m.name || 'Player').replace(/[<>&]/g, '').slice(0, 12) || 'Player';
    c.col = Math.max(0, Math.min(511, m.col | 0));
    c.state = 'lobby'; newParty(c);
    send(c, { t: 'welcome', id: c.id });
    sendParty(c.party); online(); return;
  }
  if (c.state === 'new') return;
  switch (m.t) {
    // ---------- lobby ----------
    case 'col': c.col = Math.max(0, Math.min(511, m.col | 0)); if (c.party) sendParty(c.party); break;
    case 'inv': {
      const to = clients.get(m.to | 0);
      if (!to || to === c || to.state !== 'lobby' || c.state !== 'lobby') { send(c, { t: 'toast', m: 'Invite pathano jay nai' }); break; }
      if (to.party === c.party) break;
      if (c.party.m.length >= 5) { send(c, { t: 'toast', m: 'Party full (max 5)' }); break; }
      send(to, { t: 'invited', from: c.id, fn: c.name, pid: c.party.id });
      send(c, { t: 'toast', m: to.name + ' ke invite pathano hoyeche' });
      break;
    }
    case 'acc': {
      const p = parties.get(m.pid | 0);
      if (!p || c.state !== 'lobby' || p.m.length >= 5 || p.m.some(x => x.state !== 'lobby')) { send(c, { t: 'toast', m: 'Party join kora gelo na' }); break; }
      joinParty(c, p); online();
      p.m.forEach(x => { if (x !== c) send(x, { t: 'toast', m: c.name + ' party te join korlo' }); });
      break;
    }
    case 'dec': { const l = clients.get(m.from | 0); if (l) send(l, { t: 'toast', m: c.name + ' invite decline korse' }); break; }
    case 'lp': if (c.state === 'lobby' && c.party.m.length > 1) { leaveParty(c); newParty(c); sendParty(c.party); online(); } break;
    case 'start': if (c.state === 'lobby') startParty(c); break;
    case 'exit': if (c.p) { exitMatch(c); send(c, { t: 'lobby' }); } break;
  }
  const p = c.p; if (!p) return;
  switch (m.t) {
    case 'u': if (!p.alive) break; p.x = num(m.x); p.y = num(m.y); p.z = num(m.z); p.ry = num(m.r); p.pt = num(m.p); p.w = m.w | 0; p.dirty = true; break;
    case 'f': if (p.alive) bcastMatch({ t: 'f', id: p.id, a: m.a, b: m.b, w: m.w | 0 }, c); break;
    case 'hit': {
      const v = getP(m.id | 0); if (!v || !v.alive || !p.alive || v === p) break;
      const w = m.w | 0; if (!(w >= 0 && w < DMG.length)) break;
      const n = Math.min(8, Math.max(1, m.n | 0));
      damage(v, p, DMG[w] * n * (m.h ? 2 : 1), m.h);
      break;
    }
    case 'wall': {
      if (!p.alive) break;
      const ry = num(m.ry), w = { id: wallId++, o: p.id, x: num(m.x), z: num(m.z), ry, th: ry + Math.PI, hp: 450 };
      walls.push(w); bcastMatch({ t: 'w', w: pubw(w) });
      const mine = walls.filter(q => q.o === p.id);
      while (mine.length > 3) rmWall(mine.shift());
      break;
    }
    case 'wh': {
      const w = walls.find(q => q.id === (m.id | 0)), wi = m.w | 0; if (!w || !(wi >= 0 && wi < DMG.length)) break;
      hurtWall(w, DMG[wi] * Math.min(8, Math.max(1, m.n | 0))); break;
    }
    case 'pk': {
      const k = PK[m.id | 0]; if (!k || !k.on || !p.alive || p.med >= 4 || Math.hypot(p.x - k.x, p.z - k.z) > 4) break;
      k.on = false; p.med++;
      bcastMatch({ t: 'pk', id: k.id, on: 0 }); send(c, { t: 'hp', id: p.id, hp: p.hp, med: p.med });
      setTimeout(() => { k.on = true; bcastMatch({ t: 'pk', id: k.id, on: 1 }); }, 20000);
      break;
    }
    case 'heal':
      if (!p.alive || p.med <= 0 || p.hp >= 100) break;
      p.med--; p.hp = Math.min(100, p.hp + 60); send(c, { t: 'hp', id: p.id, hp: p.hp, med: p.med }); break;
  }
}
function drop(c) {
  if (!clients.has(c.id)) return;
  if (c.p) { exitMatch(c); }
  clients.delete(c.id);
  leaveParty(c); online();
}

// ================= bot AI =================
function obstacle(ox, oy, oz, dx, dy, dz, maxT) {
  let bt = maxT, wall = null;
  for (const b of MAP.boxes) { const t = AM.rayAABB(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.top, b.z1); if (t >= 0 && t < bt) { bt = t; wall = null; } }
  for (const w of walls) { const t = AM.rayArc(ox, oy, oz, dx, dy, dz, bt, w); if (t >= 0 && t < bt) { bt = t; wall = w; } }
  return { t: bt, wall };
}
const BOT_SPEED = 5.6;
function botTick(b, dt) {
  if (!b.alive) return;
  b.cd -= dt;
  let best = null, bd = 1e9;
  for (const p of humans()) if (p.alive) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; best = p; } }
  let vx = 0, vz = 0;
  if (best && bd < 75) {
    const ey = 1.5, ty = best.y + 1.1, dx = best.x - b.x, dz = best.z - b.z, dy = ty - ey, dist = Math.hypot(dx, dy, dz);
    const o = obstacle(b.x, ey, b.z, dx / dist, dy / dist, dz / dist, dist);
    const seen = o.t >= dist - .4;
    const k = Math.min(1, dt * 9);
    b.ry += AM.wrapA(Math.atan2(-dx, -dz) - b.ry) * k; b.pt += (Math.asin(Math.max(-1, Math.min(1, dy / dist))) - b.pt) * k;
    const ux = dx / (bd || 1), uz = dz / (bd || 1);
    if (bd > 20 || !seen) { vx = ux; vz = uz; } else if (bd < 8) { vx = -ux; vz = -uz; }
    b.st -= dt; if (b.st <= 0) { b.st = 1 + Math.random() * 1.6; b.sd = Math.random() < .5 ? -1 : 1; }
    if (seen) { vx += -uz * b.sd * .9; vz += ux * b.sd * .9; }
    if (b.cd <= 0) {
      const sy = Math.sin(b.ry), cy = Math.cos(b.ry), mx = b.x - sy * .9 + cy * .3, mz = b.z - cy * .9 - sy * .3;
      if (seen && bd < 60) {
        b.cd = .32 + Math.random() * .45;
        const acc = Math.max(.1, .55 - bd / 120), hit = Math.random() < acc;
        const head = hit && Math.random() < .1;
        const ex = best.x + (hit ? 0 : (Math.random() - .5) * 3), ey2 = best.y + (head ? 1.62 : 1.0), ez = best.z + (hit ? 0 : (Math.random() - .5) * 3);
        bcastMatch({ t: 'f', id: b.id, a: [+mx.toFixed(1), 1.3, +mz.toFixed(1)], b: [+ex.toFixed(1), +ey2.toFixed(1), +ez.toFixed(1)], w: 0 });
        if (hit) damage(best, b, Math.round((6 + Math.random() * 4) * (head ? 2 : 1)), head);
      } else if (!seen && o.wall && bd < 40) {      // shoot the gloo wall that blocks us
        b.cd = .22;
        bcastMatch({ t: 'f', id: b.id, a: [+mx.toFixed(1), 1.3, +mz.toFixed(1)], b: [+(b.x + dx / dist * o.t).toFixed(1), +(ey + dy / dist * o.t).toFixed(1), +(b.z + dz / dist * o.t).toFixed(1)], w: 0 });
        hurtWall(o.wall, 10);
      }
    }
  } else {
    b.wt -= dt;
    if (b.wt <= 0 || Math.hypot(b.wx - b.x, b.wz - b.z) < 3) { const s = MAP.spawns[(Math.random() * MAP.spawns.length) | 0]; b.wx = s[0]; b.wz = s[1]; b.wt = 8 + Math.random() * 6; }
    const dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz) || 1; vx = dx / d; vz = dz / d;
    b.ry += AM.wrapA(Math.atan2(-vx, -vz) - b.ry) * Math.min(1, dt * 6); b.pt *= .9;
  }
  // stuck escape
  if (b.esc > 0) { b.esc -= dt; vx = b.ex; vz = b.ez; }
  const len = Math.hypot(vx, vz); if (len > 0) { vx /= len; vz /= len; }
  b.x += vx * BOT_SPEED * dt; b.z += vz * BOT_SPEED * dt;
  AM.collide(b, .4, MAP.boxes, walls); b.y = 0;
  b.sk += dt;
  if (b.sk > .6) { if (len > 0 && Math.hypot(b.x - b.lx, b.z - b.lz) < BOT_SPEED * .6 * .3) { b.esc = .8; const a = Math.random() * Math.PI * 2; b.ex = Math.cos(a); b.ez = Math.sin(a); } b.lx = b.x; b.lz = b.z; b.sk = 0; }
  b.dirty = true;
}

// ================= main tick (40 Hz) =================
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(.1, (now - lastTick) / 1000); lastTick = now;
  if (!bots.size && !humans().length) return;
  for (const b of bots.values()) botTick(b, dt);
  const arr = [];
  for (const p of matchPlayers()) if (p.dirty) { p.dirty = false; arr.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(3), +p.pt.toFixed(3), p.w]); }
  if (arr.length) bcastMatch({ t: 's', p: arr });
}, 16);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n=== ULTRA ARENA v2 server chalu ===');
  const nets = os.networkInterfaces();
  for (const k in nets) for (const n of nets[k]) if (n.family === 'IPv4' && !n.internal) console.log('  Shobai ei link e jan:  http://' + n.address + ':' + PORT);
  console.log('  (Sobai ek WiFi / hotspot e thakte hobe)\n');
});
