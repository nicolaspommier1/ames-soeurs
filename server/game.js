// Moteur de jeu autoritaire : un salon = une instance de Room.
// Aucune dépendance réseau : le serveur HTTP appelle handle()/tick()/viewFor().
import crypto from 'node:crypto';
import {
  MIN_PLAYERS, MAX_PLAYERS, NAME_MAX, DECLARATION_MAX, DECLARATIONS_PER_ROUND, MAX_SUSPECTS,
  POINTS, distribution, baseObjective, accusationThreshold, defaultSettings, sanitizeSettings,
} from './config.js';
import { generateClues } from './clues.js';
import { shuffle, pick, normalize } from './rng.js';

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, msg) => { throw new GameError(code, msg); };

export const PHASES = [
  'LOBBY', 'ROLE', 'DISCUSSION', 'ACCUSATION', 'ACCUSATION_RESULT',
  'ACTIONS', 'FORMATION', 'REVEAL', 'ROUND_END', 'GAME_OVER',
];
const READY_PHASES = new Set(['ROLE', 'DISCUSSION', 'ROUND_END']);
const ACCUSATION_RESULT_SECONDS = 8;
const HOST_GRACE_MS = 20_000; // hôte déconnecté depuis 20 s → transfert
const LOBBY_GRACE_MS = 90_000; // joueur déconnecté du salon depuis 90 s → retiré

export function cleanName(raw) {
  if (typeof raw !== 'string') fail('BAD_NAME', 'Pseudo invalide.');
  const name = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1) fail('BAD_NAME', 'Choisis un pseudo.');
  if ([...name].length > NAME_MAX) fail('BAD_NAME', `Pseudo trop long (${NAME_MAX} caractères max).`);
  return name;
}

function cleanText(raw, max) {
  if (typeof raw !== 'string') fail('BAD_TEXT', 'Texte invalide.');
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) fail('BAD_TEXT', 'Message vide.');
  if ([...t].length > max) fail('BAD_TEXT', `${max} caractères maximum.`);
  return t;
}

/** Vrai si le texte contient le mot (comparaison par mots entiers, sans accents ni casse). */
export function containsWord(text, word) {
  const t = ` ${normalize(text)} `;
  const w = normalize(word);
  return !!w && (t.includes(` ${w} `) || t.replace(/ /g, '').includes(w.replace(/ /g, '')) && w.length >= 5);
}

const EVENT_TYPES = ['speeddating', 'declaration', 'eclipse', 'foudre', 'indice', 'murmure'];

export class Room {
  constructor({ code, now = Date.now, rng = Math.random, onChange = () => {} } = {}) {
    this.code = code;
    this.now = now;
    this.rng = rng;
    this.onChange = onChange;
    this.players = new Map();
    this.order = [];
    this.hostId = null;
    this.settings = defaultSettings('classique');
    this.phase = 'LOBBY';
    this.phaseStartedAt = now();
    this.deadline = null;
    this.version = 0;
    this.createdAt = now();
    this.lastActivity = now();
    this.game = null;
    this.gamesPlayed = 0;
  }

  // ───────────────────────── utilitaires ─────────────────────────
  changed() {
    this.version++;
    this.lastActivity = this.now();
    this.onChange(this);
  }
  get playerList() { return this.order.map((id) => this.players.get(id)).filter(Boolean); }
  idx(id) { return this.order.indexOf(id); }
  name(id) { return this.players.get(id)?.name ?? '?'; }
  role(id) { return this.game?.roles.get(id); }
  isActive(id) { const r = this.role(id); return !!r && r.status !== 'left'; }
  isSearching(id) { return this.role(id)?.status === 'searching'; }
  canChoose(id) { return this.isSearching(id) && !this.game.quarantined.has(id); }
  activeIds() { return this.game ? this.order.filter((id) => this.isActive(id)) : []; }
  connected(id) { return !!this.players.get(id)?.connected; }
  assertHost(id) { if (id !== this.hostId) fail('NOT_HOST', "Seul l'hôte peut faire ça."); }
  assertPhase(...ph) { if (!ph.includes(this.phase)) fail('BAD_PHASE', "Cette action n'est pas possible maintenant."); }
  log(id, text) { this.role(id)?.privateLog.push({ round: this.game.round, text }); }
  addScore(id, pts) { const r = this.role(id); if (r) r.score += pts; }

  // ───────────────────────── salon ─────────────────────────
  addPlayer(rawName) {
    const name = cleanName(rawName);
    if (this.phase !== 'LOBBY') fail('IN_PROGRESS', 'La partie a déjà commencé. Attends la prochaine !');
    if (this.players.size >= MAX_PLAYERS) fail('FULL', `Salon complet (${MAX_PLAYERS} joueurs max).`);
    const key = normalize(name) || name.toLowerCase();
    if (this.playerList.some((p) => (normalize(p.name) || p.name.toLowerCase()) === key)) {
      fail('NAME_TAKEN', 'Ce pseudo est déjà pris dans ce salon.');
    }
    const p = {
      id: crypto.randomBytes(5).toString('hex'),
      token: crypto.randomBytes(18).toString('base64url'),
      name,
      connected: false,
      lastSeen: this.now(),
      totalScore: 0,
      wins: 0,
    };
    this.players.set(p.id, p);
    this.order.push(p.id);
    if (!this.hostId) this.hostId = p.id;
    this.changed();
    return p;
  }

  findByToken(token) {
    if (typeof token !== 'string') return null;
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    p.lastSeen = this.now();
    this.changed();
    if (!connected) this.checkEarly();
  }

  removePlayer(id) {
    this.players.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.hostId === id) this.transferHost();
  }

  transferHost() {
    const next = this.playerList.find((p) => p.connected && p.id !== this.hostId && (!this.game || this.isActive(p.id)))
      ?? this.playerList.find((p) => p.id !== this.hostId && (!this.game || this.isActive(p.id)));
    this.hostId = next ? next.id : null;
  }

  // ───────────────────────── point d'entrée des actions ─────────────────────────
  handle(playerId, action) {
    if (!this.players.has(playerId)) fail('UNKNOWN_PLAYER', 'Joueur inconnu.');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') fail('BAD_ACTION', 'Action invalide.');
    const a = action;
    switch (a.type) {
      case 'settings': this.assertHost(playerId); this.assertPhase('LOBBY');
        this.settings = sanitizeSettings(this.settings, a.settings); break;
      case 'start': this.start(playerId); return;
      case 'kick': this.kick(playerId, a.target); return;
      case 'leave': this.leave(playerId); return;
      case 'skip': this.assertHost(playerId);
        if (this.phase === 'LOBBY' || this.phase === 'GAME_OVER') fail('BAD_PHASE', 'Rien à passer.');
        this.advance(); return;
      case 'replay': this.assertHost(playerId); this.assertPhase('GAME_OVER'); this.backToLobby(); return;
      case 'ready': this.setReady(playerId, a.value !== false); break;
      case 'declare': this.declare(playerId, a.text); break;
      case 'suspect': this.suspect(playerId, a.target, a.value !== false); break;
      case 'vote': this.vote(playerId, a.target ?? null); break;
      case 'scan': case 'protect': case 'freeze': case 'poll': this.nightAction(playerId, a); break;
      case 'choose': this.choose(playerId, a.target ?? null, a.betray === true); break;
      case 'pronostic': this.pronostic(playerId, a.target ?? null); break;
      default: fail('BAD_ACTION', 'Action inconnue.');
    }
    this.changed();
    this.checkEarly();
  }

  kick(byId, targetId) {
    this.assertHost(byId);
    if (targetId === byId) fail('BAD_TARGET', 'Tu ne peux pas te bannir toi-même.');
    const p = this.players.get(targetId);
    if (!p) fail('BAD_TARGET', 'Joueur introuvable.');
    if (this.phase === 'LOBBY') {
      this.removePlayer(targetId);
    } else {
      if (!this.isActive(targetId)) fail('BAD_TARGET', 'Ce joueur a déjà quitté la partie.');
      this.markLeft(targetId);
      p.kicked = true;
    }
    p.kicked = true;
    this.changed();
    this.checkEarly();
  }

  leave(id) {
    if (this.phase === 'LOBBY' || this.phase === 'GAME_OVER' || !this.isActive(id)) {
      this.removePlayer(id);
    } else {
      this.markLeft(id);
      this.players.get(id).kicked = true;
    }
    this.changed();
    this.checkEarly();
  }

  /** Abandon en cours de partie : le duo est dissous, le partenaire devient « orphelin ». */
  markLeft(id) {
    const g = this.game;
    const r = g.roles.get(id);
    r.status = 'left';
    if (r.camp === 'ame') {
      const duo = g.duos[r.duoId];
      if (duo.status === 'open') {
        duo.status = 'dissolved';
        const partner = g.roles.get(r.partnerId);
        if (partner.status === 'searching') {
          partner.status = 'orphan';
          this.log(r.partnerId, "💔 Ton âme sœur a quitté la partie. Tu ne peux plus former de duo, mais tu peux encore marquer des points en accusant et en pronostiquant.");
        }
      }
    }
    for (const m of [g.votes, g.actions, g.polls, g.choices, g.pronostics]) m.delete(id);
    g.ready.delete(id);
    if (this.hostId === id) this.transferHost();
  }

  // ───────────────────────── démarrage ─────────────────────────
  start(byId) {
    this.assertHost(byId);
    this.assertPhase('LOBBY');
    // Les joueurs déconnectés au lancement sont retirés du salon.
    for (const p of this.playerList) if (!p.connected && p.id !== byId) this.removePlayer(p.id);
    const ids = this.order.slice();
    if (ids.length < MIN_PLAYERS) fail('NOT_ENOUGH', `Il faut au moins ${MIN_PLAYERS} joueurs.`);
    this.setupGame(ids);
    this.enter('ROLE', this.game.settings.durations.role);
  }

  setupGame(ids) {
    const s = structuredClone(this.settings);
    const n = ids.length;
    const { imposters, duos } = distribution(n);
    const shuffled = shuffle(ids, this.rng);
    const impIds = shuffled.slice(0, imposters);
    const soulIds = shuffled.slice(imposters);
    const clues = generateClues(duos, imposters, s.difficulty, this.rng);
    const roles = new Map();
    const mk = (o) => ({
      status: 'searching', score: 0, betrayalUsed: false, lastProtect: null, lastFreeze: null, privateLog: [],
      stats: { steals: 0, broken: 0, accRight: 0, accWrong: 0, accused: 0, suspected: 0, betrayals: 0, pronostics: 0, declarations: 0, frozen: 0, saves: 0 },
      ...o,
    });
    const duoList = clues.duos.map((c, i) => {
      const a = soulIds[2 * i];
      const b = soulIds[2 * i + 1];
      roles.set(a, mk({ camp: 'ame', role: 'ame', word: c.words[0], themeId: c.themeId, familyLabel: c.familyLabel, duoId: i, partnerId: b }));
      roles.set(b, mk({ camp: 'ame', role: 'ame', word: c.words[1], themeId: c.themeId, familyLabel: c.familyLabel, duoId: i, partnerId: a }));
      return { id: i, a, b, themeId: c.themeId, familyLabel: c.familyLabel, words: c.words, status: 'open', round: null };
    });
    impIds.forEach((id, k) => {
      const d = clues.decoys[k];
      roles.set(id, mk({ camp: 'imposteur', role: 'imposteur', word: d.word, themeId: d.themeId, familyLabel: d.familyLabel, duoId: null, partnerId: null }));
    });
    // Rôles spéciaux : capacités supplémentaires, ils ne changent jamais le camp ni le partenaire.
    if (s.roles.voyant && duos >= 2) roles.get(pick(soulIds, this.rng)).role = 'voyant';
    if (s.roles.protecteur && duos >= 2) {
      const voyant = soulIds.find((id) => roles.get(id).role === 'voyant');
      const avoid = voyant ? new Set([voyant, roles.get(voyant).partnerId]) : new Set();
      const pool = soulIds.filter((id) => !avoid.has(id));
      roles.get(pick(pool.length ? pool : soulIds.filter((id) => roles.get(id).role === 'ame'), this.rng)).role = 'protecteur';
    }
    if (s.roles.briseur) roles.get(pick(impIds, this.rng)).role = 'briseur';

    this.game = {
      gameNo: ++this.gamesPlayed,
      settings: s,
      round: 0,
      rounds: s.rounds,
      roles,
      duos: duoList,
      imposterIds: impIds,
      objectiveBase: baseObjective(duos, imposters),
      stolen: 0,
      unmaskedCount: 0,
      authentic: 0,
      ready: new Set(),
      votes: new Map(),
      accusation: null,
      actions: new Map(),
      polls: new Map(),
      nightRumor: null,
      choices: new Map(),
      pronostics: new Map(),
      protectTarget: null,
      freezeTarget: null,
      quarantined: new Set(),
      event: null,
      lastEvent: null,
      foudre: false,
      mustDeclare: null,
      declarations: [],
      suspicions: new Map(),
      reveal: null,
      history: [],
      winner: null,
      final: null,
    };
    for (const id of impIds) {
      const r = roles.get(id);
      const allies = impIds.filter((x) => x !== id).map((x) => this.name(x));
      r.privateLog.push({ round: 0, text: allies.length ? `🎭 Tes complices : ${allies.join(', ')}.` : '🎭 Tu es le seul imposteur.' });
    }
  }

  get objective() {
    const g = this.game;
    const available = g.duos.filter((d) => d.status !== 'dissolved').length;
    // Pas de plafond : si les vols font dépasser le nombre de duos encore possibles,
    // l'objectif devient inatteignable et les imposteurs gagnent. Chaque vol compte toujours.
    const raw = g.objectiveBase + g.stolen - g.unmaskedCount;
    return Math.max(Math.min(1, available), raw);
  }

  // ───────────────────────── machine à états ─────────────────────────
  enter(phase, seconds) {
    this.phase = phase;
    this.phaseStartedAt = this.now();
    this.deadline = seconds ? this.phaseStartedAt + seconds * 1000 : null;
    if (this.game) this.game.ready = new Set();
    this.changed();
  }

  advance() {
    const g = this.game;
    if (!g) return;
    const d = g.settings.durations;
    switch (this.phase) {
      case 'ROLE': return this.startRound();
      case 'DISCUSSION':
        this.endDiscussion();
        return g.settings.accusations ? this.enter('ACCUSATION', d.accusation) : this.afterAccusation();
      case 'ACCUSATION':
        this.resolveAccusation();
        return this.enter('ACCUSATION_RESULT', ACCUSATION_RESULT_SECONDS);
      case 'ACCUSATION_RESULT': return this.afterAccusation();
      case 'ACTIONS':
        this.resolveActions();
        return this.enter('FORMATION', d.formation);
      case 'FORMATION': {
        this.resolveFormation();
        const n = g.reveal.links.length;
        return this.enter('REVEAL', Math.min(75, 5 + n * 3.5 + 3));
      }
      case 'REVEAL': return this.enter('ROUND_END', d.roundEnd);
      case 'ROUND_END': return this.isGameFinished() ? this.finishGame() : this.startRound();
      default: return undefined;
    }
  }

  afterAccusation() {
    const d = this.game.settings.durations;
    return this.actors().length > 0 ? this.enter('ACTIONS', d.actions) : this.enter('FORMATION', d.formation);
  }

  /** Avance la phase dès que tous les joueurs connectés concernés ont agi. */
  checkEarly() {
    if (!this.game || this.phase === 'LOBBY' || this.phase === 'GAME_OVER') return;
    const g = this.game;
    const live = this.activeIds().filter((id) => this.connected(id));
    let required = [];
    let done = () => false;
    if (READY_PHASES.has(this.phase)) { required = live; done = (id) => g.ready.has(id); }
    else if (this.phase === 'ACCUSATION') { required = live; done = (id) => g.votes.has(id); }
    else if (this.phase === 'ACTIONS') {
      const actorIds = new Set(this.actors().map((x) => x.id));
      required = live;
      done = (id) => (actorIds.has(id) ? g.actions.has(id) : g.polls.has(id));
    } else if (this.phase === 'FORMATION') {
      required = live;
      done = (id) => (this.canChoose(id) ? g.choices.has(id) : g.pronostics.has(id));
    } else return;
    if (required.length > 0 && required.every(done)) this.advance();
  }

  tick() {
    const t = this.now();
    const host = this.players.get(this.hostId);
    if (host && !host.connected && t - host.lastSeen > HOST_GRACE_MS && this.playerList.some((p) => p.connected && p.id !== host.id)) {
      this.transferHost();
      this.changed();
    }
    if (this.phase === 'LOBBY') {
      const stale = this.playerList.filter((p) => !p.connected && t - p.lastSeen > LOBBY_GRACE_MS);
      if (stale.length) { stale.forEach((p) => this.removePlayer(p.id)); this.changed(); }
    }
    if (this.deadline && t >= this.deadline) this.advance();
  }

  // ───────────────────────── manche ─────────────────────────
  startRound() {
    const g = this.game;
    g.round++;
    Object.assign(g, {
      votes: new Map(), accusation: null, actions: new Map(), polls: new Map(), nightRumor: null,
      choices: new Map(), pronostics: new Map(), protectTarget: null, freezeTarget: null,
      quarantined: new Set(), event: null, foudre: false, mustDeclare: null, declarations: [],
      suspicions: new Map(), reveal: null,
    });
    if (g.settings.events) this.drawEvent();
    this.enter('DISCUSSION', g.settings.durations.discussion);
  }

  drawEvent() {
    const g = this.game;
    const searching = this.activeIds().filter((id) => this.isSearching(id));
    let type = pick(EVENT_TYPES.filter((t) => t !== g.lastEvent), this.rng);
    if (searching.length < 2 && type !== 'foudre') type = 'foudre';
    g.lastEvent = type;
    const souls = searching.filter((id) => this.role(id).camp === 'ame');
    switch (type) {
      case 'speeddating': {
        let a; let b; let tries = 0;
        do {
          [a, b] = shuffle(searching, this.rng);
          tries++;
        } while (tries < 20 && this.role(a).camp === 'imposteur' && this.role(b).camp === 'imposteur');
        const match = this.role(a).partnerId === b;
        for (const [x, y] of [[a, b], [b, a]]) {
          this.log(x, `💘 Speed dating avec ${this.name(y)} : ${match ? 'vous ÊTES âmes sœurs !' : "vous n'êtes PAS âmes sœurs."}`);
        }
        g.event = { type, title: 'Speed dating', icon: '💘', text: `${this.name(a)} et ${this.name(b)} ont eu un rendez-vous secret. Eux seuls savent si c'est le grand amour… ou s'ils mentent.` };
        break;
      }
      case 'declaration': {
        const x = pick(searching, this.rng);
        g.mustDeclare = x;
        g.event = { type, title: 'Déclaration publique', icon: '📣', text: `${this.name(x)} doit publier une déclaration sur son mot avant la fin de la discussion (mentir est permis, se taire coûte 1 point).` };
        break;
      }
      case 'eclipse': {
        for (const id of this.activeIds().filter((x) => this.role(x).camp === 'imposteur' && this.isSearching(x))) {
          const mine = this.role(id).themeId;
          const pool = souls.filter((s) => this.role(s).themeId !== mine);
          const s = pick(pool.length ? pool : souls, this.rng);
          if (s) this.log(id, `🌑 Éclipse : quelqu'un dans la salle possède le mot « ${this.role(s).word} ».`);
        }
        g.event = { type, title: 'Éclipse', icon: '🌑', text: 'Les imposteurs ont reçu une information secrète sur le mot d’une Âme Sœur…' };
        break;
      }
      case 'foudre':
        g.foudre = true;
        g.event = { type, title: 'Coup de foudre', icon: '⚡', text: 'Cette manche, tous les points de formation (gains ET pertes) sont doublés !' };
        break;
      case 'indice': {
        for (const id of searching) {
          const r = this.role(id);
          const pool = this.activeIds().filter((x) => x !== id && x !== r.partnerId);
          const x = pick(pool, this.rng);
          if (x) this.log(id, `🔎 Indice : ${this.name(x)} n'est PAS ton âme sœur.`);
        }
        g.event = { type, title: 'Indice', icon: '🔎', text: "Chacun a reçu en secret le nom d'une personne qui n'est PAS son âme sœur." };
        break;
      }
      case 'murmure':
        for (const id of searching) this.log(id, `🤫 Murmure : ton lien évoque l'univers « ${this.role(id).familyLabel} ».`);
        g.event = { type, title: 'Murmure', icon: '🤫', text: "Chacun connaît désormais l'univers de son lien… les imposteurs aussi." };
        break;
      default: break;
    }
  }

  setReady(id, value) {
    if (!READY_PHASES.has(this.phase)) fail('BAD_PHASE', "Ce n'est pas le moment.");
    if (!this.isActive(id)) fail('NOT_PLAYING', 'Tu ne participes pas à cette partie.');
    if (value) this.game.ready.add(id); else this.game.ready.delete(id);
  }

  declare(id, raw) {
    this.assertPhase('DISCUSSION');
    if (!this.isActive(id)) fail('NOT_PLAYING', 'Tu ne participes pas à cette partie.');
    const text = cleanText(raw, DECLARATION_MAX);
    const g = this.game;
    if (g.declarations.filter((d) => d.playerId === id).length >= DECLARATIONS_PER_ROUND) {
      fail('LIMIT', `${DECLARATIONS_PER_ROUND} déclarations maximum par manche.`);
    }
    if (containsWord(text, this.role(id).word)) {
      fail('OWN_WORD', 'Interdit : tu ne peux pas écrire ton propre mot. Sois plus subtil !');
    }
    g.declarations.push({ id: g.declarations.length + 1, playerId: id, text, at: this.now() });
    this.role(id).stats.declarations++;
  }

  suspect(id, target, value) {
    this.assertPhase('DISCUSSION', 'ACCUSATION');
    if (!this.isActive(id)) fail('NOT_PLAYING', 'Tu ne participes pas à cette partie.');
    if (target === id || !this.isActive(target)) fail('BAD_TARGET', 'Cible invalide.');
    const g = this.game;
    const set = g.suspicions.get(id) ?? new Set();
    if (value) {
      if (!set.has(target)) {
        if (set.size >= MAX_SUSPECTS) fail('LIMIT', `${MAX_SUSPECTS} soupçons maximum.`);
        set.add(target);
        this.role(target).stats.suspected++;
      }
    } else set.delete(target);
    g.suspicions.set(id, set);
  }

  endDiscussion() {
    const g = this.game;
    if (g.mustDeclare && this.isActive(g.mustDeclare) && !g.declarations.some((d) => d.playerId === g.mustDeclare)) {
      this.addScore(g.mustDeclare, POINTS.silentDeclaration);
      this.log(g.mustDeclare, `📣 Tu n'as pas fait ta déclaration : ${POINTS.silentDeclaration} point.`);
    }
  }

  // ───────────────────────── accusations ─────────────────────────
  isCandidate(id) { return this.isSearching(id); }

  vote(id, target) {
    this.assertPhase('ACCUSATION');
    if (!this.isActive(id)) fail('NOT_PLAYING', 'Tu ne participes pas à cette partie.');
    if (target !== null && (target === id || !this.isCandidate(target))) fail('BAD_TARGET', 'Tu ne peux pas accuser ce joueur.');
    this.game.votes.set(id, target);
  }

  resolveAccusation() {
    const g = this.game;
    const tally = new Map();
    const ballots = [];
    for (const [voter, target] of g.votes) {
      if (!this.isActive(voter)) continue;
      ballots.push({ voter, target });
      if (target && this.isCandidate(target)) tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    const voters = this.activeIds().filter((id) => this.connected(id) || g.votes.has(id)).length;
    const threshold = accusationThreshold(voters);
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] ?? 0;
    const leaders = sorted.filter(([, v]) => v === max);
    const res = { tally: sorted.map(([id, votes]) => ({ id, votes })), ballots, threshold, outcome: 'none', targetId: null };
    if (max > 0 && leaders.length > 1) res.outcome = 'tie';
    else if (max > 0 && max < threshold) res.outcome = 'weak';
    else if (max >= threshold) {
      const t = leaders[0][0];
      const r = this.role(t);
      res.targetId = t;
      r.stats.accused++;
      const supporters = ballots.filter((b) => b.target === t).map((b) => b.voter);
      if (r.camp === 'imposteur') {
        r.status = 'unmasked';
        g.unmaskedCount++;
        res.outcome = 'imposteur';
        res.role = r.role;
        for (const v of supporters) { this.addScore(v, POINTS.accuseRight); this.role(v).stats.accRight++; }
      } else {
        g.quarantined.add(t);
        res.outcome = 'innocent';
        for (const v of supporters) { this.addScore(v, POINTS.accuseWrong); this.role(v).stats.accWrong++; }
        for (const imp of g.imposterIds) if (this.isSearching(imp)) this.addScore(imp, POINTS.misdirection);
        this.log(t, '🚫 Tu es en quarantaine : tu ne peux pas former de duo cette manche (mais tu peux pronostiquer).');
      }
    }
    g.accusation = res;
  }

  // ───────────────────────── actions secrètes ─────────────────────────
  /** Joueurs disposant d'un pouvoir actif cette manche. */
  actors() {
    if (!this.game) return [];
    const out = [];
    for (const id of this.activeIds()) {
      const r = this.role(id);
      if (r.role === 'voyant') out.push({ id, power: 'scan' });
      else if (r.role === 'protecteur') out.push({ id, power: 'protect' });
      else if (r.role === 'briseur' && r.status === 'searching') out.push({ id, power: 'freeze' });
    }
    return out;
  }

  nightAction(id, a) {
    this.assertPhase('ACTIONS');
    if (!this.isActive(id)) fail('NOT_PLAYING', 'Tu ne participes pas à cette partie.');
    const g = this.game;
    const actor = this.actors().find((x) => x.id === id);
    const r = this.role(id);
    if (a.type === 'poll') {
      if (actor) fail('BAD_ACTION', 'Utilise ton pouvoir.');
      if (a.target === id || !this.isActive(a.target)) fail('BAD_TARGET', 'Cible invalide.');
      g.polls.set(id, a.target);
      return;
    }
    if (!actor || actor.power !== a.type) fail('NO_POWER', "Tu n'as pas ce pouvoir.");
    if (g.actions.has(id)) fail('ALREADY', 'Action déjà effectuée cette manche.');
    if (a.type === 'scan') {
      if (a.a === a.b || a.a === id || a.b === id || !this.isActive(a.a) || !this.isActive(a.b)) fail('BAD_TARGET', 'Choisis deux autres joueurs différents.');
      g.actions.set(id, { type: 'scan', a: a.a, b: a.b });
    } else if (a.type === 'protect') {
      if (!this.isActive(a.target)) fail('BAD_TARGET', 'Cible invalide.');
      if (a.target === r.lastProtect) fail('BAD_TARGET', 'Tu ne peux pas protéger la même personne deux manches de suite.');
      g.actions.set(id, { type: 'protect', target: a.target });
    } else if (a.type === 'freeze') {
      if (a.target === id || !this.isSearching(a.target)) fail('BAD_TARGET', 'Cible invalide.');
      if (a.target === r.lastFreeze) fail('BAD_TARGET', 'Tu ne peux pas viser la même personne deux manches de suite.');
      g.actions.set(id, { type: 'freeze', target: a.target });
    }
  }

  /** Priorité déterministe : Protection → Gel → Vision. */
  resolveActions() {
    const g = this.game;
    const acts = [...g.actions.entries()].filter(([id]) => this.isActive(id));
    const byType = (t) => acts.filter(([, a]) => a.type === t);
    for (const { id, power } of this.actors()) {
      if (power === 'protect' && !g.actions.has(id)) this.role(id).lastProtect = null;
      if (power === 'freeze' && !g.actions.has(id)) this.role(id).lastFreeze = null;
    }
    for (const [id, a] of byType('protect')) { g.protectTarget = a.target; this.role(id).lastProtect = a.target; }
    for (const [id, a] of byType('freeze')) { g.freezeTarget = a.target; this.role(id).lastFreeze = a.target; }
    for (const [id, a] of byType('scan')) {
      const ra = this.role(a.a);
      const match = ra.camp === 'ame' && ra.partnerId === a.b;
      this.log(id, `👁 Vision : ${this.name(a.a)} et ${this.name(a.b)} ${match ? 'SONT âmes sœurs.' : 'ne sont PAS âmes sœurs.'}`);
      if (match && g.duos[ra.duoId].status === 'open') this.addScore(id, POINTS.scanPair);
    }
    const tally = new Map();
    for (const [voter, t] of g.polls) if (this.isActive(voter) && this.isActive(t)) tally.set(t, (tally.get(t) ?? 0) + 1);
    const sorted = [...tally.entries()].sort((x, y) => y[1] - x[1]);
    if (sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1])) g.nightRumor = { id: sorted[0][0], votes: sorted[0][1] };
  }

  // ───────────────────────── formation des duos ─────────────────────────
  choose(id, target, betray) {
    this.assertPhase('FORMATION');
    if (!this.canChoose(id)) fail('CANNOT_CHOOSE', 'Tu ne peux pas choisir de partenaire cette manche.');
    if (target !== null && (target === id || !this.canChoose(target))) fail('BAD_TARGET', 'Ce joueur ne peut pas être choisi.');
    const r = this.role(id);
    if (betray && (!this.game.settings.betrayal || r.betrayalUsed)) fail('NO_BETRAYAL', 'Trahison indisponible.');
    this.game.choices.set(id, { target, betray: betray && target !== null });
  }

  pronostic(id, target) {
    this.assertPhase('FORMATION');
    if (!this.isActive(id) || this.canChoose(id)) fail('BAD_ACTION', 'Les pronostics sont réservés aux joueurs hors course.');
    if (target !== null && !this.canChoose(target)) fail('BAD_TARGET', 'Cible invalide.');
    this.game.pronostics.set(id, target);
  }

  resolveFormation() {
    const g = this.game;
    const mult = g.foudre ? 2 : 1;
    const links = [];
    let stolenThisRound = 0;
    const choosers = this.order.filter((id) => this.canChoose(id));
    for (const a of choosers) {
      const ca = g.choices.get(a);
      const b = ca?.target;
      if (!b || !this.canChoose(b) || this.idx(a) > this.idx(b)) continue;
      const cb = g.choices.get(b);
      if (cb?.target !== a) continue;
      const ra = this.role(a);
      const rb = this.role(b);
      const link = { a, b, verdict: null, betrayers: [] };
      const touched = g.freezeTarget === a || g.freezeTarget === b;
      const shielded = g.protectTarget === a || g.protectTarget === b;
      const authentic = ra.camp === 'ame' && rb.camp === 'ame' && ra.partnerId === b;
      if (touched && !shielded) {
        link.verdict = 'gele';
        for (const imp of g.imposterIds) {
          if (this.role(imp).role === 'briseur' && this.isActive(imp)) {
            this.addScore(imp, authentic ? POINTS.freezeHitAuthentic : POINTS.freezeHit);
            this.role(imp).stats.frozen++;
            this.log(imp, `❄️ Ton gel a frappé le lien ${this.name(a)} – ${this.name(b)} (${authentic ? 'un vrai duo !' : 'un faux lien'}).`);
          }
        }
        links.push(link);
        continue;
      }
      if (touched && shielded) {
        link.shielded = true;
        for (const id of this.activeIds()) {
          if (this.role(id).role === 'protecteur') {
            this.addScore(id, POINTS.shieldSave);
            this.role(id).stats.saves++;
            this.log(id, `🛡 Ta protection a bloqué un gel sur le lien ${this.name(a)} – ${this.name(b)} !`);
          }
        }
      }
      const betA = ca.betray && !ra.betrayalUsed && g.settings.betrayal;
      const betB = cb.betray && !rb.betrayalUsed && g.settings.betrayal;
      if (betA) { ra.betrayalUsed = true; ra.stats.betrayals++; link.betrayers.push(a); }
      if (betB) { rb.betrayalUsed = true; rb.stats.betrayals++; link.betrayers.push(b); }
      if (authentic) {
        const base = (POINTS.authentic + (g.round === 1 ? POINTS.firstRoundBonus : 0)) * mult;
        const bonus = (POINTS.betrayWin - POINTS.authentic) * mult;
        if (betA && betB) { this.addScore(a, POINTS.betrayBoth * mult); this.addScore(b, POINTS.betrayBoth * mult); }
        else if (betA) { this.addScore(a, base + bonus); this.addScore(b, POINTS.betrayVictim); }
        else if (betB) { this.addScore(b, base + bonus); this.addScore(a, POINTS.betrayVictim); }
        else { this.addScore(a, base); this.addScore(b, base); }
        ra.status = 'paired';
        rb.status = 'paired';
        g.duos[ra.duoId].status = 'reunited';
        g.duos[ra.duoId].round = g.round;
        g.authentic++;
        link.verdict = 'authentique';
        link.words = [ra.word, rb.word];
      } else {
        link.verdict = 'brise';
        const impA = ra.camp === 'imposteur';
        const impB = rb.camp === 'imposteur';
        if (impA !== impB) {
          const [imp, soul, betImp, betSoul] = impA ? [a, b, betA, betB] : [b, a, betB, betA];
          this.addScore(imp, (betImp ? POINTS.stealBetray : POINTS.steal) * mult);
          this.addScore(soul, (betSoul ? POINTS.betrayFail : POINTS.brokenLink) * mult);
          this.role(imp).stats.steals++;
          this.role(soul).stats.broken++;
          g.stolen++;
          stolenThisRound++;
          link.stolen = true; // conservé côté serveur, jamais envoyé par lien avant la fin
        } else if (!impA) {
          this.addScore(a, (betA ? POINTS.betrayFail : POINTS.brokenLink) * mult);
          this.addScore(b, (betB ? POINTS.betrayFail : POINTS.brokenLink) * mult);
          ra.stats.broken++;
          rb.stats.broken++;
        }
      }
      links.push(link);
    }
    const inAuthentic = new Set(links.filter((l) => l.verdict === 'authentique').flatMap((l) => [l.a, l.b]));
    const pronosticWinners = [];
    for (const [id, t] of g.pronostics) {
      if (t && inAuthentic.has(t) && this.isActive(id)) {
        this.addScore(id, POINTS.pronostic);
        this.role(id).stats.pronostics++;
        pronosticWinners.push(id);
      }
    }
    g.reveal = { round: g.round, links, pronosticWinners, stolenThisRound, foudre: g.foudre };
    g.history.push({
      round: g.round,
      authentic: links.filter((l) => l.verdict === 'authentique').length,
      broken: links.filter((l) => l.verdict === 'brise').length,
      frozen: links.filter((l) => l.verdict === 'gele').length,
      stolen: stolenThisRound,
      accusation: g.accusation ? { outcome: g.accusation.outcome, targetId: g.accusation.targetId } : null,
      event: g.event?.title ?? null,
      links: links.map((l) => ({ ...l })),
    });
  }

  isGameFinished() {
    const g = this.game;
    const openPairs = g.duos.filter((d) => d.status === 'open').length;
    return g.round >= g.rounds || openPairs === 0;
  }

  finishGame() {
    const g = this.game;
    for (const id of this.activeIds()) {
      const r = this.role(id);
      if (r.camp === 'ame' && r.status === 'searching') { this.addScore(id, POINTS.lonely); this.log(id, `💧 Cœur solitaire : ${POINTS.lonely} point.`); }
      if (r.camp === 'imposteur' && r.status === 'searching') this.addScore(id, POINTS.survivor);
    }
    const objective = this.objective;
    g.winner = g.authentic >= objective ? 'ames' : 'imposteurs';
    for (const [id, r] of g.roles) {
      const p = this.players.get(id);
      if (!p) continue;
      p.totalScore += r.score;
      if ((g.winner === 'ames') === (r.camp === 'ame') && r.status !== 'left') p.wins++;
    }
    g.final = this.buildFinal(objective);
    this.enter('GAME_OVER', null);
  }

  buildFinal(objective) {
    const g = this.game;
    const roles = [...g.roles.entries()].map(([id, r]) => ({ id, name: this.name(id), camp: r.camp, role: r.role, word: r.word, status: r.status, score: r.score, stats: r.stats }));
    const ranking = roles.slice().sort((a, b) => b.score - a.score);
    const best = (key, filter = () => true) => {
      const c = roles.filter((r) => filter(r) && r.stats[key] > 0).sort((a, b) => b.stats[key] - a.stats[key]);
      return c.length ? c[0] : null;
    };
    const awards = [];
    const add = (who, icon, title, text) => { if (who) awards.push({ id: who.id, icon, title, text }); };
    add(best('steals', (r) => r.camp === 'imposteur'), '🗡', 'Bourreau des cœurs', (r) => `${r.stats.steals} cœur(s) volé(s)`);
    add(best('broken'), '🥀', "Cœur d'artichaut", (r) => `${r.stats.broken} lien(s) brisé(s)`);
    add(best('accRight'), '🔍', 'Sherlock', (r) => `${r.stats.accRight} accusation(s) juste(s)`);
    add(best('suspected'), '👀', 'Suspect idéal', (r) => `soupçonné ${r.stats.suspected} fois`);
    add(best('betrayals'), '🐍', 'Judas', (r) => `${r.stats.betrayals} trahison(s)`);
    add(best('pronostics'), '🔮', 'Oracle', (r) => `${r.stats.pronostics} pronostic(s) juste(s)`);
    add(best('declarations'), '🗣', 'Grande gueule', (r) => `${r.stats.declarations} déclaration(s)`);
    add(best('frozen'), '❄️', 'Reine des neiges', (r) => `${r.stats.frozen} lien(s) gelé(s)`);
    add(best('saves'), '🛡', 'Ange gardien', (r) => `${r.stats.saves} gel(s) bloqué(s)`);
    const firstDuo = g.duos.filter((d) => d.status === 'reunited').sort((a, b) => a.round - b.round)[0];
    if (firstDuo) awards.push({ id: firstDuo.a, id2: firstDuo.b, icon: '💘', title: 'Coup de foudre', text: `réunis dès la manche ${firstDuo.round}` });
    return {
      winner: g.winner,
      objective,
      authentic: g.authentic,
      stolen: g.stolen,
      unmasked: g.unmaskedCount,
      duos: g.duos.map((d) => ({ a: d.a, b: d.b, words: d.words, familyLabel: d.familyLabel, status: d.status, round: d.round })),
      imposters: g.imposterIds.map((id) => ({ id, word: g.roles.get(id).word, role: g.roles.get(id).role, status: g.roles.get(id).status, steals: g.roles.get(id).stats.steals })),
      roles,
      ranking: ranking.map((r) => ({ id: r.id, score: r.score, camp: r.camp, role: r.role })),
      awards: awards.map((a) => ({ ...a, text: typeof a.text === 'function' ? a.text(roles.find((r) => r.id === a.id)) : a.text })),
      history: g.history.map((h) => ({ ...h, links: h.links.map((l) => ({ a: l.a, b: l.b, verdict: l.verdict, stolen: !!l.stolen, betrayers: l.betrayers })) })),
    };
  }

  backToLobby() {
    for (const p of this.playerList) if (p.kicked) this.removePlayer(p.id);
    this.game = null;
    this.enter('LOBBY', null);
  }

  // ───────────────────────── vues filtrées ─────────────────────────
  /** Construit l'état visible par un joueur. Ne contient JAMAIS les secrets des autres. */
  viewFor(viewerId) {
    const view = {
      code: this.code,
      phase: this.phase,
      version: this.version,
      serverNow: this.now(),
      phaseStartedAt: this.phaseStartedAt,
      deadline: this.deadline,
      hostId: this.hostId,
      you: viewerId,
      settings: this.settings,
      limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      preview: distribution(Math.max(MIN_PLAYERS, this.players.size)),
      players: this.playerList.map((p) => ({ id: p.id, name: p.name, connected: p.connected, totalScore: p.totalScore, wins: p.wins })),
      game: null,
      me: null,
    };
    const g = this.game;
    if (!g) return view;
    const ph = this.phase;
    const atLeast = (p) => PHASES.indexOf(ph) >= PHASES.indexOf(p);
    const actorIds = new Set(this.actors().map((x) => x.id));
    const submitted = (id) => {
      if (READY_PHASES.has(ph)) return g.ready.has(id);
      if (ph === 'ACCUSATION') return g.votes.has(id);
      if (ph === 'ACTIONS') return actorIds.has(id) ? g.actions.has(id) : g.polls.has(id);
      if (ph === 'FORMATION') return this.canChoose(id) ? g.choices.has(id) : g.pronostics.has(id);
      return false;
    };
    view.game = {
      gameNo: g.gameNo,
      round: g.round,
      rounds: g.rounds,
      mode: g.settings.mode,
      settings: g.settings,
      objective: this.objective,
      objectiveBase: g.objectiveBase,
      authentic: g.authentic,
      stolen: g.stolen,
      unmasked: g.unmaskedCount,
      duoCount: g.duos.length,
      imposterCount: g.imposterIds.length,
      players: this.order.filter((id) => g.roles.has(id)).map((id) => {
        const r = g.roles.get(id);
        const pub = { id, status: r.status, score: r.score, quarantined: g.quarantined.has(id), submitted: submitted(id), canChoose: this.canChoose(id) };
        if (r.status === 'unmasked') { pub.revealedCamp = 'imposteur'; }
        if (r.status === 'paired') { pub.revealedCamp = 'ame'; pub.partnerId = r.partnerId; pub.word = r.word; }
        if (r.status === 'orphan' || g.quarantined.has(id)) pub.revealedCamp = 'ame';
        return pub;
      }),
      event: g.event,
      mustDeclare: g.mustDeclare,
      declarations: g.declarations,
      suspicions: [...g.suspicions.entries()].flatMap(([from, set]) => [...set].map((to) => ({ from, to }))),
      accusation: atLeast('ACCUSATION_RESULT') ? g.accusation : null,
      nightRumor: atLeast('FORMATION') ? g.nightRumor : null,
      hasNight: this.actors().length > 0,
      reveal: g.reveal && (ph === 'REVEAL' || ph === 'ROUND_END' || ph === 'GAME_OVER')
        ? { round: g.reveal.round, foudre: g.reveal.foudre, stolenThisRound: g.reveal.stolenThisRound, pronosticWinners: g.reveal.pronosticWinners,
          links: g.reveal.links.map((l) => ({ a: l.a, b: l.b, verdict: l.verdict, betrayers: l.betrayers, shielded: !!l.shielded, words: l.words ?? null })) }
        : null,
      history: g.history.map((h) => ({ round: h.round, authentic: h.authentic, broken: h.broken, frozen: h.frozen, stolen: h.stolen, accusation: h.accusation, event: h.event })),
      finished: ph === 'ROUND_END' ? this.isGameFinished() : false,
      final: ph === 'GAME_OVER' ? g.final : null,
    };
    const r = g.roles.get(viewerId);
    if (r) {
      const act = g.actions.get(viewerId);
      view.me = {
        role: r.role,
        camp: r.camp,
        word: r.word,
        status: r.status,
        score: r.score,
        partnerId: r.status === 'paired' ? r.partnerId : null,
        allies: r.camp === 'imposteur' ? g.imposterIds.filter((x) => x !== viewerId).map((x) => ({ id: x, role: g.roles.get(x).role })) : null,
        privateLog: r.privateLog,
        betrayalUsed: r.betrayalUsed,
        canBetray: g.settings.betrayal && !r.betrayalUsed,
        power: this.actors().find((x) => x.id === viewerId)?.power ?? null,
        lastProtect: r.lastProtect,
        lastFreeze: r.lastFreeze,
        ready: g.ready.has(viewerId),
        vote: g.votes.has(viewerId) ? g.votes.get(viewerId) : undefined,
        action: act ?? null,
        poll: g.polls.get(viewerId) ?? null,
        choice: g.choices.get(viewerId) ?? null,
        pronostic: g.pronostics.has(viewerId) ? g.pronostics.get(viewerId) : undefined,
        canChoose: this.canChoose(viewerId),
        quarantined: g.quarantined.has(viewerId),
        mySuspects: [...(g.suspicions.get(viewerId) ?? [])],
      };
    }
    return view;
  }
}
