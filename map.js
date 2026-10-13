// ULTRA ARENA - shared map + physics helpers (used by server.js AND index.html)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArenaMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const HALF = 120;                       // map is 240 x 240
  const WALL = { R: 2.1, L: 2.3, H: 2.9, T: 0.3 };   // gloo wall: radius, arc length (rad), height, thickness

  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hsl(h, s, l) { const a = s * Math.min(l, 1 - l); const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255); }
  function wrapA(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  function build(seed) {
    const R = rng(seed || 1), boxes = [], prims = [], occ = [];
    const B = (cx, cz, w, d, h, c, y0) => { y0 = y0 || 0; boxes.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, top: y0 + h }); prims.push({ k: 'b', x: cx, y: y0 + h / 2, z: cz, w, h, d, c }); };
    const V = (cx, cy, cz, w, h, d, c) => prims.push({ k: 'b', x: cx, y: cy, z: cz, w, h, d, c });
    const PAS = [0xf2b8a2, 0x9fd3c7, 0xf6d58e, 0xa9c4eb, 0xc9b6e4, 0xf4a6b8, 0xb5e0a0];
    const pick = () => PAS[(R() * PAS.length) | 0];
    const shade = (c, k) => ((((c >> 16) & 255) * k) << 16) | ((((c >> 8) & 255) * k) << 8) | ((c & 255) * k);
    const mark = (x, z, r) => occ.push([x, z, r]);
    const free = (x, z, r) => occ.every(o => Math.hypot(o[0] - x, o[1] - z) > o[2] + r);

    // roads + central plaza (soft light grey, no dark colours)
    V(0, .02, 0, 10, .04, HALF * 2, 0xd5d9e0); V(0, .025, 0, HALF * 2, .04, 10, 0xd5d9e0); V(0, .035, 0, 46, .04, 46, 0xe6e9ee);
    for (let t = -110; t <= 110; t += 12) if (Math.abs(t) > 28) { V(0, .05, t, .3, .02, 5, 0xffffff); V(t, .05, 0, 5, .02, .3, 0xffffff); }

    // stairs: every step rises < .35 so players simply walk up
    const stairs = (x, z, ax, dir, w, H) => { const n = Math.ceil(H / .34), st = .9; for (let i = 1; i <= n; i++) { const off = (n - i + .5) * st, h = H * i / n; if (ax === 'x') B(x + dir * off, z, st, w, h, 0xeee6d6); else B(x, z + dir * off, w, st, h, 0xeee6d6); } };

    // centre platform with cover on top
    B(0, 0, 20, 20, 3, 0xefe8d8);
    stairs(10, 0, 'x', 1, 6, 3); stairs(-10, 0, 'x', -1, 6, 3); stairs(0, 10, 'z', 1, 6, 3); stairs(0, -10, 'z', -1, 6, 3);
    for (const [x, z, w, d] of [[-6, -6, 5, .7], [6, 6, 5, .7], [-6, 6, .7, 5], [6, -6, .7, 5]]) B(x, z, w, d, 1.2, 0xd9cfe8, 3);
    V(0, 3.03, 0, 6, .06, 6, 0xf6d58e); mark(0, 0, 27);

    // shipping container (+ optional second one on top)
    const cont = (x, z, alongX, c, stack) => {
      const w = alongX ? 6.2 : 2.5, d = alongX ? 2.5 : 6.2;
      B(x, z, w, d, 2.6, c); V(x, 2.64, z, w - .3, .08, d - .3, shade(c, .88));
      if (stack) { B(x, z, w, d, 2.6, pick(), 2.6); }
    };
    // walled compound with 4 gaps
    const compound = (cx, cz) => {
      const c = 0xe9e2d6;
      for (const s of [-1, 1]) for (const o of [-8, 8]) { B(cx + o, cz + s * 13, 10, .6, 3.4, c); B(cx + s * 13, cz + o, .6, 10, 3.4, c); }
      cont(cx + 3, cz - 4, true, pick(), false); cont(cx - 5, cz + 4, false, pick(), false);
      B(cx - 5, cz - 6, 1.6, 1.6, 1.4, 0xe8c9a0); B(cx + 6, cz + 6, 1.6, 1.6, 1.4, 0xe8c9a0); B(cx + 2, cz + 6, 3, .7, 1.2, 0xd9cfe8);
      mark(cx, cz, 19);
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) compound(sx * 68, sz * 68);

    // simple buildings (flat roof, one door facing the centre)
    const bld = (cx, cz, w, d, c) => {
      const side = Math.abs(cx) > Math.abs(cz) ? (cx > 0 ? 3 : 2) : (cz > 0 ? 1 : 0), H = 3.6, t = .4, dw = 2.8;
      const wx = (z, door) => { if (!door) B(cx, z, w, t, H, c); else { const sg = (w - dw) / 2; B(cx - (dw + sg) / 2, z, sg, t, H, c); B(cx + (dw + sg) / 2, z, sg, t, H, c); B(cx, z, dw, t, H - 2.6, c, 2.6); } };
      const wz = (x, door) => { if (!door) B(x, cz, t, d, H, c); else { const sg = (d - dw) / 2; B(x, cz - (dw + sg) / 2, t, sg, H, c); B(x, cz + (dw + sg) / 2, t, sg, H, c); B(x, cz, t, dw, H - 2.6, c, 2.6); } };
      wx(cz + d / 2, side === 0); wx(cz - d / 2, side === 1); wz(cx + w / 2, side === 2); wz(cx - w / 2, side === 3);
      B(cx, cz, w + .8, d + .8, .4, shade(c, .9), H);
      for (const o of [-1, 1]) {
        if (side !== 0) V(cx + o * w / 4, 1.9, cz + d / 2, 1.6, 1.1, t + .1, 0xd4ebf8); if (side !== 1) V(cx + o * w / 4, 1.9, cz - d / 2, 1.6, 1.1, t + .1, 0xd4ebf8);
        if (side !== 2) V(cx + w / 2, 1.9, cz + o * d / 4, t + .1, 1.1, 1.6, 0xd4ebf8); if (side !== 3) V(cx - w / 2, 1.9, cz + o * d / 4, t + .1, 1.1, 1.6, 0xd4ebf8);
      }
      B(cx + (w / 2 - 1.4), cz + (d / 2 - 1.4), 1.2, 1.2, 1.1, 0xe8c9a0); B(cx - (w / 2 - 1.4), cz - (d / 2 - 1.4), 1.2, 1.2, 1.1, 0xe8c9a0);
      mark(cx, cz, Math.max(w, d) / 2 + 3);
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bld(sx * 44, sz * 44, 14, 12, pick());
    bld(90, 0, 10, 10, pick()); bld(-90, 0, 10, 10, pick()); bld(0, 90, 10, 10, pick()); bld(0, -90, 10, 10, pick());

    // spawns + medkits first, so cover never lands on them
    const spawns = [[-100, -100], [100, -100], [-100, 100], [100, 100], [-100, 30], [100, -30], [30, -100], [-30, 100], [-55, -20], [55, 20], [-20, 55], [20, -55], [-30, -30], [30, 30]];
    for (const s of spawns) mark(s[0], s[1], 5);
    const pk = []; let id = 0;
    for (const [x, z] of [[30, 0], [-30, 0], [0, 30], [0, -30], [55, 0], [-55, 0], [0, 55], [0, -55], [30, 30], [-30, 30], [30, -30], [-30, -30]]) { pk.push({ id: id++, x, z, on: true }); mark(x, z, 3); }

    // scattered cover: containers, crates, low barriers
    const place = (n, r, fn) => { for (let i = 0, k = 0; i < 400 && k < n; i++) { const x = (R() - .5) * 210, z = (R() - .5) * 210; if (Math.abs(x) < 9 || Math.abs(z) < 9) continue; if (!free(x, z, r)) continue; fn(x, z); mark(x, z, r); k++; } };
    place(16, 5, (x, z) => cont(x, z, R() < .5, pick(), R() < .3));
    place(14, 3, (x, z) => { B(x, z, 1.6, 1.6, 1.4, 0xe8c9a0); B(x + 1.7, z + .4, 1.4, 1.4, 1.2, 0xdcb98a); if (R() < .5) B(x + .8, z + .2, 1.2, 1.2, 1.2, 0xe8c9a0, 1.4); });
    place(14, 3.5, (x, z) => { const a = R() < .5; B(x, z, a ? 5 : .7, a ? .7 : 5, 1.2, pick()); });

    // soft border wall
    const E = HALF + 2;
    B(0, -E, HALF * 2 + 8, 4, 7, 0xdfe3ea); B(0, E, HALF * 2 + 8, 4, 7, 0xdfe3ea); B(-E, 0, 4, HALF * 2 + 8, 7, 0xdfe3ea); B(E, 0, 4, HALF * 2 + 8, 7, 0xdfe3ea);
    return { HALF, WALL, boxes, prims, spawns, pk };
  }

  // ---------- shared physics ----------
  // p: {x,y,z}. Pushes p out of obstacles, returns ground height under p.
  function collide(p, r, boxes, walls) {
    let g = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (p.x > b.x0 - r && p.x < b.x1 + r && p.z > b.z0 - r && p.z < b.z1 + r) {
        if (p.y >= b.top - .35) { if (b.top > g) g = b.top; }
        else if (p.y + 1.8 > b.y0) {
          const l = p.x - (b.x0 - r), rr = (b.x1 + r) - p.x, n = p.z - (b.z0 - r), f = (b.z1 + r) - p.z, mn = Math.min(l, rr, n, f);
          if (mn === l) p.x = b.x0 - r; else if (mn === rr) p.x = b.x1 + r; else if (mn === n) p.z = b.z0 - r; else p.z = b.z1 + r;
        }
      }
    }
    if (p.y < WALL.H) for (let i = 0; i < walls.length; i++) {
      const w = walls[i], dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz);
      if (d < .001 || d > WALL.R + 1.2) continue;
      if (Math.abs(wrapA(Math.atan2(dx, dz) - w.th)) <= WALL.L / 2 + r / WALL.R && Math.abs(d - WALL.R) < WALL.T / 2 + r) {
        const nd = d < WALL.R ? WALL.R - WALL.T / 2 - r : WALL.R + WALL.T / 2 + r;
        p.x = w.x + dx / d * nd; p.z = w.z + dz / d * nd;
      }
    }
    const lim = HALF - .6;
    if (p.x > lim) p.x = lim; else if (p.x < -lim) p.x = -lim;
    if (p.z > lim) p.z = lim; else if (p.z < -lim) p.z = -lim;
    return g;
  }
  function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    let tmin = 0, tmax = 1e9, a, b, t;
    if (Math.abs(dx) < 1e-9) { if (ox < x0 || ox > x1) return -1; } else { a = (x0 - ox) / dx; b = (x1 - ox) / dx; if (a > b) { t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
    if (Math.abs(dy) < 1e-9) { if (oy < y0 || oy > y1) return -1; } else { a = (y0 - oy) / dy; b = (y1 - oy) / dy; if (a > b) { t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
    if (Math.abs(dz) < 1e-9) { if (oz < z0 || oz > z1) return -1; } else { a = (z0 - oz) / dz; b = (z1 - oz) / dz; if (a > b) { t = a; a = b; b = t; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) return -1; }
    return tmin;
  }
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const x = ox - cx, y = oy - cy, z = oz - cz, b = x * dx + y * dy + z * dz, c = x * x + y * y + z * z - r * r, disc = b * b - c;
    if (disc < 0) return -1; const s = Math.sqrt(disc); let t = -b - s; if (t < 0) t = -b + s; return t < 0 ? -1 : t;
  }
  // ray vs gloo wall arc (w: {x,z,th}); returns t or -1
  function rayArc(ox, oy, oz, dx, dy, dz, maxT, w) {
    const px = ox - w.x, pz = oz - w.z, a = dx * dx + dz * dz;
    if (a < 1e-9) return -1;
    const b = 2 * (px * dx + pz * dz), c = px * px + pz * pz - WALL.R * WALL.R, disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    for (let k = 0; k < 2; k++) {
      const t = (-b + (k ? s : -s)) / (2 * a);
      if (t <= 0 || t >= maxT) continue;
      const y = oy + dy * t; if (y < 0 || y > WALL.H) continue;
      if (Math.abs(wrapA(Math.atan2(px + dx * t, pz + dz * t) - w.th)) <= WALL.L / 2) return t;
    }
    return -1;
  }
  return { HALF, WALL, build, collide, rayAABB, raySphere, rayArc, wrapA, rng };
});
