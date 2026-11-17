// Serveur HTTP + temps réel (Server-Sent Events pour le flux descendant, POST JSON pour les actions).
// Zéro dépendance : fonctionne avec Node.js ≥ 18 sans « npm install ».
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Room, GameError } from './game.js';
import { qrSvg } from './qr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O (confusion avec 1/0)
const MAX_BODY = 8 * 1024;
const TICK_MS = 250;
const HEARTBEAT_MS = 15_000;
const IDLE_ROOM_MS = 15 * 60_000; // salon sans connexion depuis 15 min → supprimé
const MAX_ROOM_AGE_MS = 6 * 3600_000; // salon inactif depuis 6 h → supprimé
const MAX_ROOMS = 500;

export function createServer({ publicUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '', now = Date.now, log = console.log } = {}) {
  /** @type {Map<string, {room: Room, clients: Set<{res: http.ServerResponse, playerId: string}>, pending: boolean}>} */
  const rooms = new Map();
  const hits = new Map();

  function newCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(c)) return c;
    }
    throw new GameError('SERVER_FULL', 'Serveur saturé, réessaie.');
  }

  function scheduleBroadcast(entry) {
    if (entry.pending) return;
    entry.pending = true;
    setImmediate(() => {
      entry.pending = false;
      for (const client of entry.clients) sendState(entry, client);
    });
  }

  function sendState(entry, client) {
    const p = entry.room.players.get(client.playerId);
    if (!p || p.kicked) {
      client.res.write(`event: kicked\ndata: {}\n\n`);
      client.res.end();
      entry.clients.delete(client);
      return;
    }
    client.res.write(`event: state\ndata: ${JSON.stringify(entry.room.viewFor(client.playerId))}\n\n`);
  }

  function createRoom() {
    if (rooms.size >= MAX_ROOMS) throw new GameError('SERVER_FULL', 'Trop de parties en cours, réessaie plus tard.');
    const code = newCode();
    const entry = { room: null, clients: new Set(), pending: false };
    entry.room = new Room({ code, now, onChange: () => scheduleBroadcast(entry) });
    rooms.set(code, entry);
    return entry;
  }

  function getEntry(code) {
    const c = String(code ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const e = rooms.get(c);
    if (!e) throw new GameError('NO_ROOM', "Ce salon n'existe pas (ou a expiré).");
    return e;
  }

  function auth(entry, token) {
    const p = entry.room.findByToken(token);
    if (!p || p.kicked) throw new GameError('BAD_TOKEN', "Tu ne fais plus partie de ce salon.");
    return p;
  }

  function lanAddresses() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
    return out;
  }

  function inviteBase(req) {
    if (publicUrl) return publicUrl.replace(/\/$/, '');
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    let host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const [hn, port] = host.split(':');
    if (['localhost', '127.0.0.1', '[::1]'].includes(hn)) {
      const ip = lanAddresses()[0];
      if (ip) host = port ? `${ip}:${port}` : ip;
    }
    return `${proto}://${host}`;
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new GameError('TOO_BIG', 'Requête trop volumineuse.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
        catch { reject(new GameError('BAD_JSON', 'JSON invalide.')); }
      });
      req.on('error', reject);
    });
  }

  function rateLimited(req) {
    const ip = req.socket.remoteAddress || '?';
    const sec = Math.floor(now() / 1000);
    const h = hits.get(ip);
    if (!h || h.sec !== sec) { hits.set(ip, { sec, n: 1 }); return false; }
    h.n++;
    return h.n > 60;
  }

  const STATIC = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/offline.html': ['offline.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
    '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  };
  // Dossiers d'images publiques : seuls des noms simples sont acceptés (pas de « .. »).
  const ASSET_DIRS = { icons: true };
  const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  function staticFile(route) {
    if (STATIC[route]) return STATIC[route];
    const m = /^\/([a-z]+)\/([a-z0-9-]+\.(png|jpg|svg))$/.exec(route);
    if (m && ASSET_DIRS[m[1]]) return [`${m[1]}/${m[2]}`, TYPES[`.${m[3]}`], true];
    return null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname;
    try {
      const asset = req.method === 'GET' ? staticFile(route) : null;
      if (asset) {
        const [file, type, longCache] = asset;
        let data;
        try { data = await fs.promises.readFile(path.join(PUBLIC_DIR, file)); } catch { return json(res, 404, { error: 'NOT_FOUND', message: 'Fichier introuvable.' }); }
        const headers = { 'Content-Type': type, 'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' };
        if (route === '/sw.js') headers['Service-Worker-Allowed'] = '/';
        res.writeHead(200, headers);
        return res.end(data);
      }
      if (route.startsWith('/api/') && req.method === 'POST' && rateLimited(req)) {
        return json(res, 429, { error: 'RATE', message: 'Trop de requêtes, doucement !' });
      }
      if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });
      if (req.method === 'GET' && route === '/api/info') {
        return json(res, 200, { inviteBase: inviteBase(req), lan: lanAddresses(), publicUrl: publicUrl || null });
      }
      if (req.method === 'GET' && route === '/api/qr') {
        const entry = getEntry(url.searchParams.get('code'));
        const svg = qrSvg(`${inviteBase(req)}/?r=${entry.room.code}`);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return res.end(svg);
      }
      if (req.method === 'POST' && route === '/api/create') {
        const body = await readBody(req);
        const entry = createRoom();
        try {
          const p = entry.room.addPlayer(body.name);
          log(`[salon ${entry.room.code}] créé par ${p.name}`);
          return json(res, 200, { code: entry.room.code, token: p.token, playerId: p.id });
        } catch (e) { rooms.delete(entry.room.code); throw e; }
      }
      if (req.method === 'POST' && route === '/api/join') {
        const body = await readBody(req);
        const entry = getEntry(body.code);
        const existing = entry.room.findByToken(body.token);
        if (existing && !existing.kicked) return json(res, 200, { code: entry.room.code, token: existing.token, playerId: existing.id, reconnected: true });
        const p = entry.room.addPlayer(body.name);
        return json(res, 200, { code: entry.room.code, token: p.token, playerId: p.id });
      }
      if (req.method === 'POST' && route === '/api/action') {
        const body = await readBody(req);
        const entry = getEntry(body.code);
        const p = auth(entry, body.token);
        entry.room.handle(p.id, body.action);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === '/api/stream') {
        const entry = getEntry(url.searchParams.get('code'));
        const p = auth(entry, url.searchParams.get('token'));
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 1500\n\n');
        const client = { res, playerId: p.id };
        entry.clients.add(client);
        entry.room.setConnected(p.id, true);
        sendState(entry, client);
        const hb = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
        req.on('close', () => {
          clearInterval(hb);
          entry.clients.delete(client);
          const stillThere = [...entry.clients].some((c) => c.playerId === p.id);
          if (!stillThere && entry.room.players.has(p.id)) entry.room.setConnected(p.id, false);
        });
        return undefined;
      }
      if (route.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND', message: 'Route inconnue.' });
      // Toute autre URL renvoie l'application (liens d'invitation /?r=CODE)
      const data = await fs.promises.readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(data);
    } catch (e) {
      if (e instanceof GameError) return json(res, 400, { error: e.code, message: e.message });
      log('Erreur serveur', e);
      return json(res, 500, { error: 'SERVER', message: 'Erreur interne du serveur.' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.keepAliveTimeout = 65_000;

  const ticker = setInterval(() => {
    for (const entry of rooms.values()) {
      try { entry.room.tick(); } catch (e) { log('Erreur tick', e); }
    }
  }, TICK_MS);

  const cleaner = setInterval(() => cleanup(), 60_000);
  function cleanup() {
    const t = now();
    for (const [code, entry] of rooms) {
      const idle = entry.clients.size === 0 && t - entry.room.lastActivity > IDLE_ROOM_MS;
      const old = t - entry.room.lastActivity > MAX_ROOM_AGE_MS;
      if (idle || old) {
        for (const c of entry.clients) c.res.end();
        rooms.delete(code);
        log(`[salon ${code}] supprimé (inactif)`);
      }
    }
    hits.clear();
  }

  server.on('close', () => { clearInterval(ticker); clearInterval(cleaner); });
  return { server, rooms, cleanup, createRoom };
}

// Lancement direct : node server/index.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const { server } = createServer();
  server.listen(PORT, HOST, () => {
    console.log('\n  💞  LES ÂMES SŒURS — serveur prêt\n');
    console.log(`  Sur cet ordinateur :  http://localhost:${PORT}`);
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    for (const ip of ips) console.log(`  Même Wi-Fi         :  http://${ip}:${PORT}`);
    if (process.env.PUBLIC_URL) console.log(`  Adresse publique   :  ${process.env.PUBLIC_URL}`);
    console.log('');
  });
}
