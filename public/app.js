// Client LES ÂMES SŒURS — aucune logique de jeu ici : le serveur décide de tout,
// le client affiche la vue filtrée qu'il reçoit et envoie des intentions.

// ───────────────────────── état local ─────────────────────────
const S = {
  session: load(),
  view: null,
  offset: 0,
  es: null,
  connState: 'idle',
  drafts: {},
  sel: {}, // sélections en cours (par phase)
  cardFlipped: false,
  peek: false,
  lastPhaseKey: null,
  revealStep: -1,
  homeMode: null,
  info: null,
  busy: false,
};
const app = document.getElementById('app');

function load() { try { return JSON.parse(localStorage.getItem('as-session')) || null; } catch { return null; } }
function save(s) { S.session = s; try { s ? localStorage.setItem('as-session', JSON.stringify(s)) : localStorage.removeItem('as-session'); } catch { /* stockage indisponible */ } }
const lastName = () => { try { return localStorage.getItem('as-name') || ''; } catch { return ''; } };

// ───────────────────────── utilitaires ─────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now() + S.offset;
const V = () => S.view;
const G = () => S.view?.game;
const ME = () => S.view?.me;
const isHost = () => V() && V().hostId === V().you;
const nm = (id) => esc(V()?.players.find((p) => p.id === id)?.name ?? V()?.game?.final?.roles.find((r) => r.id === id)?.name ?? '?');
const gp = (id) => G()?.players.find((p) => p.id === id);
const plural = (n, s, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
function avatar(id) {
  const p = V().players.find((x) => x.id === id);
  const n = p?.name ?? '?';
  return `<span class="avatar" style="background:hsl(${hue(n)} 62% 74%)">${esc([...n][0]?.toUpperCase() ?? '?')}</span>`;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) { const e = new Error(data.message || 'Erreur réseau'); e.code = data.error; throw e; }
  return data;
}

async function act(action, okMsg) {
  if (!S.session) return;
  try {
    await api('/api/action', { code: S.session.code, token: S.session.token, action });
    if (okMsg) toast(okMsg, 'ok');
    if (navigator.vibrate) navigator.vibrate(12);
    return true;
  } catch (e) {
    toast(e.message);
    if (e.code === 'BAD_TOKEN' || e.code === 'NO_ROOM') leaveSession();
    return false;
  }
}

// ───────────────────────── icônes (SVG maison) ─────────────────────────
const HL = (c = 'var(--rose)') => `<svg class="hl" viewBox="0 0 37 64" aria-hidden="true"><path d="M36 60C17 47 2 36 2 20A16 16 0 0 1 36 12z" fill="${c}"/><path d="M10 16a8 8 0 0 1 8-5" stroke="rgba(255,255,255,.45)" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
const HR = (c = 'var(--lilas)') => `<svg class="hr" viewBox="0 0 37 64" aria-hidden="true"><path d="M1 60C20 47 35 36 35 20A16 16 0 0 0 1 12z" fill="${c}"/></svg>`;
const halves = (l, r) => `<div class="halves">${HL(l)}${HR(r)}</div>`;
const I = {
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C6 16.5 2 13 2 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 10 2.5C22 13 18 16.5 12 21z"/></svg>',
  mask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 6c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v5c0 5-4 8-9 8s-9-3-9-8z"/><path d="M7 11c1-1 2.5-1 3.5 0M13.5 11c1-1 2.5-1 3.5 0" stroke-linecap="round"/><path d="M9 15.5c2 1.2 4 1.2 6 0" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2v1.5M5 4.5l1 1.2M19 4.5l-1 1.2" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M12 15.5c-2.5-1.8-4-3.2-4-5a2 2 0 0 1 4-.8 2 2 0 0 1 4 .8c0 1.8-1.5 3.2-4 5z" fill="currentColor" stroke="none"/></svg>',
  broken: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 21C6 16.5 2 13 2 8.5A4.5 4.5 0 0 1 12 6l-2 4 3 2.5-2 3.5 3-3-2.5-2.5L13.5 6A4.5 4.5 0 0 1 22 8.5C22 13 18 16.5 12 21z"/></svg>',
  snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 3.5l3 2 3-2M9 20.5l3-2 3 2"/></svg>',
  crown: '<svg class="crown" viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  seal: '<svg viewBox="0 0 64 64"><path d="M31 52C18 43 9 35 9 24a11 11 0 0 1 21-5z" fill="#ffd1dc"/><path d="M33 52c13-9 22-17 22-28a11 11 0 0 0-21-5z" fill="#ffe7ee"/></svg>',
  dagger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M14.5 3.5l6 6-9 9-3-3zM8.5 15.5l-5 5M6 13l5 5"/></svg>',
};
const ROLE_INFO = {
  ame: { name: 'Âme Sœur', icon: I.heart },
  voyant: { name: 'Voyant', icon: I.eye },
  protecteur: { name: 'Protecteur', icon: I.shield },
  imposteur: { name: 'Imposteur', icon: I.mask },
  briseur: { name: 'Briseur de cœurs', icon: I.broken },
};
const PHASE_NAME = {
  ROLE: 'Ta carte', DISCUSSION: 'Discussion', ACCUSATION: 'Accusations', ACCUSATION_RESULT: 'Verdict',
  ACTIONS: 'La nuit', FORMATION: 'Formation des duos', REVEAL: 'Révélation', ROUND_END: 'Fin de manche', GAME_OVER: 'Fin de partie',
};

// ───────────────────────── connexion temps réel ─────────────────────────
function connect() {
  if (!S.session) return;
  if (S.es) S.es.close();
  const { code, token } = S.session;
  const es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
  S.es = es;
  S.connState = 'connecting';
  es.addEventListener('state', (ev) => {
    const v = JSON.parse(ev.data);
    S.offset = v.serverNow - Date.now();
    const prev = S.view;
    S.view = v;
    S.connState = 'open';
    onViewChange(prev, v);
    render();
  });
  es.addEventListener('kicked', () => { es.close(); toast('Tu as quitté le salon.'); leaveSession(); });
  es.onerror = async () => {
    S.connState = 'lost';
    renderConn();
    // Vérifie si la session est encore valide (salon expiré ou joueur exclu ?)
    try { await api('/api/join', { code, token }); } catch (e) {
      if (e.code === 'NO_ROOM' || e.code === 'BAD_TOKEN' || e.code === 'IN_PROGRESS') { es.close(); toast(e.message); leaveSession(); }
    }
  };
}

function leaveSession() {
  if (S.es) S.es.close();
  S.es = null;
  save(null);
  S.view = null;
  history.replaceState(null, '', '/');
  render();
}

function onViewChange(prev, v) {
  const key = `${v.phase}:${v.game?.round ?? 0}:${v.game?.gameNo ?? 0}`;
  if (key !== S.lastPhaseKey) {
    S.lastPhaseKey = key;
    S.sel = {};
    S.revealStep = -1;
    S.peek = false;
    if (v.phase === 'ROLE') S.cardFlipped = false;
    if (prev && navigator.vibrate) navigator.vibrate([30, 40, 30]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.body.classList.toggle('night', v.phase === 'ACTIONS');
  document.body.classList.toggle('wide', window.innerWidth >= 900);
}

// ───────────────────────── rendu ─────────────────────────
function render() {
  // Préserve le champ en cours de saisie
  const ae = document.activeElement;
  const focusId = ae && ae.id && (ae.tagName === 'INPUT') ? ae.id : null;
  const selStart = focusId ? ae.selectionStart : null;
  const scrollFeed = document.querySelector('.feed')?.scrollTop;

  const v = V();
  let html;
  if (!S.session || !v) html = S.session ? loadingScreen() : homeScreen();
  else if (v.phase === 'LOBBY') html = lobbyScreen();
  else if (!ME() || ME().status === 'left') html = spectatorScreen();
  else html = gameScreen();
  app.innerHTML = html;

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { el.setSelectionRange(selStart, selStart); } catch { /* type sans sélection */ } }
  }
  const feed = document.querySelector('.feed');
  if (feed && scrollFeed !== undefined) feed.scrollTop = scrollFeed;
  renderConn();
  updateTimers();
}

function renderConn() {
  let el = document.getElementById('conn');
  const show = S.session && S.connState === 'lost';
  if (show && !el) { el = document.createElement('div'); el.id = 'conn'; el.className = 'conn'; el.textContent = 'Connexion perdue… reconnexion en cours'; document.body.appendChild(el); }
  if (!show && el) el.remove();
}

const loadingScreen = () => `<div class="home"><div class="emblem">${HL()}${HR()}</div><p class="center muted">Connexion au salon…</p></div>`;

// ───────────────────────── accueil ─────────────────────────
function homeScreen() {
  const params = new URLSearchParams(location.search);
  const invited = (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const name = S.drafts.name ?? lastName();
  const mode = invited ? 'join' : S.homeMode;
  return `<div class="home">
    <div class="emblem"><svg class="h-left" viewBox="0 0 37 64">${HL().replace(/<\/?svg[^>]*>/g, '')}</svg><svg class="h-right" viewBox="0 0 37 64">${HR().replace(/<\/?svg[^>]*>/g, '')}</svg></div>
    <h1 class="title"><span class="amp">les</span>Âmes Sœurs</h1>
    <p class="tagline">Chacun cache la moitié d'un cœur. Trouve l'autre avant qu'un imposteur ne te la vole.</p>
    <form class="home-form" onsubmit="return false">
      <label class="field"><span>Ton pseudo</span>
        <input id="name" class="input" maxlength="16" autocomplete="nickname" placeholder="ex. Camille" value="${esc(name)}" data-draft="name"></label>
      ${mode === 'join' ? `
        <label class="field"><span>Code du salon</span>
          <input id="code" class="input code" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc(S.drafts.code ?? invited)}" data-draft="code"></label>
        <button class="btn block" data-do="join">Rejoindre la partie</button>
        ${invited ? '' : '<button class="btn ghost block" data-do="home-back">Retour</button>'}
      ` : `
        <button class="btn block" data-do="create">Créer une partie</button>
        <div class="or">ou</div>
        <button class="btn ghost block" data-do="home-join">J'ai un code</button>
      `}
    </form>
    <div class="home-foot"><button class="link" data-do="rules">Comment jouer ?</button><br>${installChip()}</div>
  </div>`;
}

async function doCreate() {
  const name = (document.getElementById('name')?.value || '').trim();
  if (!name) return toast('Choisis un pseudo.');
  if (S.busy) return;
  S.busy = true;
  try {
    const r = await api('/api/create', { name });
    try { localStorage.setItem('as-name', name); } catch { /* */ }
    save({ code: r.code, token: r.token, playerId: r.playerId });
    history.replaceState(null, '', `/?r=${r.code}`);
    render();
    connect();
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}

async function doJoin() {
  const name = (document.getElementById('name')?.value || '').trim();
  const code = (document.getElementById('code')?.value || '').trim().toUpperCase();
  if (!name) return toast('Choisis un pseudo.');
  if (code.length !== 4) return toast('Le code fait 4 lettres.');
  if (S.busy) return;
  S.busy = true;
  try {
    const r = await api('/api/join', { code, name });
    try { localStorage.setItem('as-name', name); } catch { /* */ }
    save({ code: r.code, token: r.token, playerId: r.playerId });
    history.replaceState(null, '', `/?r=${r.code}`);
    render();
    connect();
  } catch (e) { toast(e.message); } finally { S.busy = false; }
}

// ───────────────────────── salon ─────────────────────────
function lobbyScreen() {
  const v = V();
  const host = isHost();
  const n = v.players.length;
  const s = v.settings;
  const d = v.preview;
  const inviteUrl = `${S.info?.inviteBase || location.origin}/?r=${v.code}`;
  if (!S.info) loadInfo();
  const players = v.players.map((p) => `
    <div class="ptile static ${p.id === v.you ? 'me' : ''}">
      ${avatar(p.id)}
      <div class="pinfo"><div class="pname">${esc(p.name)} ${p.id === v.hostId ? I.crown : ''}</div>
        <div class="pmeta"><span class="dot ${p.connected ? '' : 'off'}"></span>${p.connected ? 'connecté' : 'hors ligne'}${p.totalScore ? ` · ${p.totalScore} pts` : ''}</div></div>
      ${host && p.id !== v.you ? `<button class="icon-btn" title="Exclure ${esc(p.name)}" aria-label="Exclure ${esc(p.name)}" data-do="kick" data-id="${p.id}">${I.x}</button>` : ''}
    </div>`).join('');
  const enough = n >= v.limits.min;
  return `
  <div class="topbar"><div class="grow"><div class="phase-name">Salon</div><div class="round">${host ? 'Tu es l’hôte' : `Hôte : ${nm(v.hostId)}`}</div></div>
    <button class="btn ghost sm" data-do="rules">Règles</button></div>
  <div class="cols">
    <div class="stack">
      <div class="panel lobby-code">
        <div class="muted small">Code du salon</div>
        <div class="code">${esc(v.code)}</div>
        <img class="qr" src="/api/qr?code=${esc(v.code)}" alt="QR code pour rejoindre le salon ${esc(v.code)}">
        <div class="invite"><code>${esc(inviteUrl)}</code><button class="btn sm soft" data-do="share" data-url="${esc(inviteUrl)}">${navigator.share ? 'Partager' : 'Copier'}</button></div>
        ${S.info && /localhost|127\.0\.0\.1/.test(inviteUrl) ? '<p class="small muted">Ce lien ne marche que sur cet ordinateur. Voir le README pour jouer depuis des téléphones.</p>' : ''}
      </div>
      <div class="panel">
        <div class="panel-title"><h3>Joueurs</h3><span class="muted small">${n} / ${v.limits.max}</span></div>
        <div class="players">${players}</div>
        ${isStandalone() ? '' : '<div class="center">' + installChip() + '</div>'}
        <p class="small muted" style="margin-top:12px">${enough ? `Avec ${n} joueurs : ${plural(d.duos, 'duo')} d’Âmes Sœurs et ${plural(d.imposters, 'imposteur')}.` : `Encore ${plural(v.limits.min - n, 'joueur')} pour lancer (idéal : 8 à 30).`}</p>
      </div>
    </div>
    <div class="stack">${settingsPanel(s, host)}</div>
  </div>
  <div class="actionbar"><div class="inner">
    <button class="btn ghost" data-do="leave">Quitter</button>
    ${host ? `<button class="btn grow" data-do="start" ${enough ? '' : 'disabled'}>Lancer la partie</button>` : '<div class="grow center muted">En attente de l’hôte…</div>'}
  </div></div>`;
}

async function loadInfo() {
  S.info = {};
  try { S.info = await (await fetch('/api/info')).json(); render(); } catch { /* */ }
}

const MODE_DESC = {
  classique: 'Duos et imposteurs, rien d’autre. Idéal pour découvrir.',
  chaos: 'Rôles spéciaux, événements surprises et trahisons.',
  express: '3 manches courtes, indices plus faciles. 8 à 12 minutes.',
};
function settingsPanel(s, host) {
  const dis = host ? '' : 'disabled';
  const seg = (key, opts, val) => `<div class="seg" role="radiogroup" ${host ? '' : 'aria-disabled="true"'}>${opts.map(([k, l]) => `<button role="radio" aria-checked="${k === val}" class="${k === val ? 'on' : ''}" ${host ? `data-do="set" data-key="${key}" data-val="${k}"` : 'disabled'}>${l}</button>`).join('')}</div>`;
  const step = (key, val, unit, delta) => host
    ? `<div class="stepper"><button data-do="step" data-key="${key}" data-delta="${-delta}" aria-label="Moins">−</button><span>${val}${unit}</span><button data-do="step" data-key="${key}" data-delta="${delta}" aria-label="Plus">+</button></div>`
    : `<span class="badge">${val}${unit}</span>`;
  const sw = (key, val, label, sub) => `<div class="setting"><div class="lbl">${label}${sub ? `<small>${sub}</small>` : ''}</div><input type="checkbox" class="switch" ${val ? 'checked' : ''} ${dis} data-do="toggle" data-key="${key}" aria-label="${label}"></div>`;
  const fmt = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60}` : ''}` : `${sec} s`);
  return `<div class="panel">
    <div class="panel-title"><h3>Paramètres</h3>${host ? '' : '<span class="small muted">choisis par l’hôte</span>'}</div>
    <div class="stack">
      ${seg('mode', [['classique', 'Classique'], ['chaos', 'Chaos'], ['express', 'Express']], s.mode)}
      <p class="small muted" style="margin:6px 4px 0">${MODE_DESC[s.mode]}</p>
      <div>
        <div class="setting"><div class="lbl">Indices</div>${seg('difficulty', [['facile', 'Faciles'], ['normal', 'Normaux'], ['difficile', 'Retors']], s.difficulty)}</div>
        <div class="setting"><div class="lbl">Manches</div>${step('rounds', s.rounds, '', 1)}</div>
        <div class="setting"><div class="lbl">Discussion</div>${step('discussion', fmt(s.durations.discussion), '', 15)}</div>
        <div class="setting"><div class="lbl">Choix du partenaire</div>${step('formation', fmt(s.durations.formation), '', 5)}</div>
        ${sw('accusations', s.accusations, 'Accusations', 'Un vote pour démasquer un imposteur à chaque manche')}
        ${s.accusations ? `<div class="setting"><div class="lbl">Durée du vote</div>${step('accusation', fmt(s.durations.accusation), '', 5)}</div>` : ''}
        ${sw('roles.voyant', s.roles.voyant, 'Voyant', 'Vérifie chaque nuit si deux joueurs sont un vrai duo')}
        ${sw('roles.protecteur', s.roles.protecteur, 'Protecteur', 'Protège un joueur du gel')}
        ${sw('roles.briseur', s.roles.briseur, 'Briseur de cœurs', 'Imposteur qui peut geler un lien')}
        ${sw('events', s.events, 'Événements', 'Une surprise par manche')}
        ${sw('betrayal', s.betrayal, 'Trahison', 'Un coup de poker par joueur et par partie')}
      </div>
    </div></div>`;
}

function changeSetting(key, raw) {
  const s = V().settings;
  const patch = {};
  if (key === 'mode' || key === 'difficulty') patch[key] = raw;
  else if (key === 'rounds') patch.rounds = s.rounds + Number(raw);
  else if (['discussion', 'formation', 'accusation'].includes(key)) patch.durations = { [key]: s.durations[key] + Number(raw) };
  else if (key.startsWith('roles.')) patch.roles = { [key.slice(6)]: raw };
  else patch[key] = raw;
  act({ type: 'settings', settings: patch });
}

// ───────────────────────── écrans de partie ─────────────────────────
function topbar(title) {
  const g = G();
  const showTimer = V().deadline && V().phase !== 'GAME_OVER';
  return `<div class="topbar">
    <div class="grow"><div class="phase-name">${title ?? PHASE_NAME[V().phase]}</div>
      <div class="round">Manche ${Math.max(1, g.round)} sur ${g.rounds}${g.round ? ` · ${gauge(true)}` : ''}</div></div>
    ${showTimer ? `<div class="timer" data-timer><svg width="52" height="52"><circle class="track" cx="26" cy="26" r="22" stroke-width="5" fill="none"/><circle class="bar" cx="26" cy="26" r="22" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="138.2" stroke-dashoffset="0"/></svg><span class="t">–</span></div>` : ''}
  </div>`;
}

function gauge(inline = false) {
  const g = G();
  if (inline) return `${g.authentic} réuni${g.authentic > 1 ? 's' : ''} (objectif ${g.objective})`;
  const hearts = [];
  const total = Math.max(g.duoCount, g.objective);
  for (let i = 0; i < total; i++) {
    const on = i < g.authentic;
    hearts.push(`<svg class="${on ? 'on' : 'off'} ${i === g.objective - 1 ? 'goal' : ''}" viewBox="0 0 18 17"><path d="M9 16C4 12 1 9 1 5.5A4 4 0 0 1 9 4z" fill="var(--rose)"/><path d="M9 16c5-4 8-7 8-10.5A4 4 0 0 0 9 4z" fill="var(--lilas)"/></svg>`);
  }
  return `<div class="gauge"><div class="hearts" aria-hidden="true">${hearts.join('')}</div>
    <span class="small muted">${g.authentic} duo${g.authentic > 1 ? 's' : ''} réuni${g.authentic > 1 ? 's' : ''}, objectif ${g.objective}${g.objective > g.duoCount ? ' (hors d’atteinte !)' : ''}${g.stolen ? ` (${plural(g.stolen, 'cœur volé', 'cœurs volés')})` : ''}${g.unmasked ? `, ${plural(g.unmasked, 'imposteur démasqué', 'imposteurs démasqués')}` : ''}</span></div>`;
}

function peek() {
  const me = ME();
  const ri = ROLE_INFO[me.role];
  return `<div class="peek" data-do="peek" role="button" tabindex="0" aria-label="Afficher ou masquer mon mot">
    <span class="ico">${ri.icon}</span>
    <div class="grow"><div class="small muted">${S.peek ? `${ri.name}${me.status === 'paired' ? ' · duo réuni' : ''}` : 'Touche pour voir ton mot'}</div>
    <div class="w ${S.peek ? '' : 'blur'}">${S.peek ? esc(me.word) : 'xxxxxxxx'}</div></div>
    <span class="badge ${me.score >= 0 ? 'rose' : 'grenat'}">${me.score} pt${Math.abs(me.score) > 1 ? 's' : ''}</span>
  </div>`;
}

function secretsPanel() {
  const log = ME().privateLog;
  if (!log.length) return '';
  return `<div class="panel tight"><div class="small muted" style="margin-bottom:6px">Tes informations secrètes</div>
    <ul class="secrets">${log.slice().reverse().map((l) => `<li>${esc(l.text)}</li>`).join('')}</ul></div>`;
}

function statusBadges(p) {
  const b = [];
  if (p.status === 'paired') b.push(`<span class="badge rose">💞 ${esc(p.word)}</span>`);
  if (p.status === 'unmasked') b.push('<span class="badge grenat">Démasqué</span>');
  if (p.status === 'orphan') b.push('<span class="badge">Orphelin</span>');
  if (p.status === 'left') b.push('<span class="badge">Parti</span>');
  if (p.quarantined) b.push('<span class="badge lilas">Quarantaine</span>');
  return b.join(' ');
}

/** Grille de joueurs sélectionnables. */
function playerGrid({ ids, selected = [], action, meta, night = false, disabledIds = [], showCheck = false }) {
  const v = V();
  return `<div class="players">${ids.map((id) => {
    const p = gp(id);
    const pl = v.players.find((x) => x.id === id);
    const sel = selected.includes(id);
    const dis = disabledIds.includes(id);
    return `<button class="ptile ${sel ? 'sel' : ''} ${night ? 'night' : ''} ${id === v.you ? 'me' : ''} ${action ? '' : 'static'}" ${action && !dis ? `data-do="${action}" data-id="${id}"` : ''} ${dis || !action ? 'disabled' : ''} aria-pressed="${sel}">
      ${avatar(id)}<div class="pinfo"><div class="pname">${nm(id)}${id === v.you ? ' (toi)' : ''}</div>
      <div class="pmeta">${meta ? meta(id, p) : ''}${pl && !pl.connected ? ' <span class="dot off"></span>' : ''}</div></div>
      ${showCheck && p?.submitted ? '<span class="check" title="a joué">✓</span>' : ''}
    </button>`;
  }).join('')}</div>`;
}

function progress() {
  const g = G();
  const live = g.players.filter((p) => p.status !== 'left' && V().players.find((x) => x.id === p.id)?.connected);
  const done = live.filter((p) => p.submitted).length;
  return `${done}/${live.length}`;
}

function gameScreen() {
  switch (V().phase) {
    case 'ROLE': return roleScreen();
    case 'DISCUSSION': return discussionScreen();
    case 'ACCUSATION': return accusationScreen();
    case 'ACCUSATION_RESULT': return accusationResultScreen();
    case 'ACTIONS': return nightScreen();
    case 'FORMATION': return formationScreen();
    case 'REVEAL': return revealScreen();
    case 'ROUND_END': return roundEndScreen();
    case 'GAME_OVER': return gameOverScreen();
    default: return loadingScreen();
  }
}

function hostSkip(label = 'Passer') {
  return isHost() ? `<button class="btn ghost sm" data-do="skip" title="Hôte : passer à la suite">${label}</button>` : '';
}

// ROLE
function roleText(me) {
  const g = G();
  const obj = `Les Âmes Sœurs gagnent si au moins <b>${g.objective} duos</b> sont réunis à la fin des ${g.rounds} manches.`;
  const out = [];
  if (me.camp === 'ame') {
    out.push('<p>Quelqu’un ici a un mot lié au tien : c’est ton âme sœur. Retrouve-la et choisissez-vous mutuellement.</p>');
    out.push('<p>Attention : des imposteurs ont des mots qui y ressemblent.</p>');
  } else {
    out.push('<p>Tu n’as pas d’âme sœur. Ton mot ressemble à celui d’un vrai duo : sers-t’en pour te faire choisir.</p>');
    out.push('<p>Chaque cœur volé rend l’objectif des Âmes Sœurs plus difficile.</p>');
    if (me.allies?.length) out.push(`<p>Complices : <b>${me.allies.map((a) => `${nm(a.id)}${a.role === 'briseur' ? ' (Briseur)' : ''}`).join(', ')}</b></p>`);
  }
  if (me.role === 'voyant') out.push('<p><b>Pouvoir :</b> chaque nuit, choisis deux joueurs et découvre s’ils forment un vrai duo.</p>');
  if (me.role === 'protecteur') out.push('<p><b>Pouvoir :</b> chaque nuit, protège un joueur : le Briseur ne peut pas geler son lien.</p>');
  if (me.role === 'briseur') out.push('<p><b>Pouvoir :</b> chaque nuit, vise un joueur : si son duo se forme, le lien est gelé et ne compte pas.</p>');
  out.push(`<p class="muted small">${obj}</p>`);
  return out.join('');
}

function roleScreen() {
  const me = ME();
  const ri = ROLE_INFO[me.role];
  const g = G();
  const readyCount = g.players.filter((p) => p.submitted).length;
  return `${topbar('Ta carte secrète')}
  <p class="center muted small">Personne d’autre ne voit cette carte. Cache ton écran !</p>
  <div class="card-wrap"><div class="card3d ${S.cardFlipped ? 'flipped' : ''}" data-do="flip" role="button" tabindex="0" aria-label="Retourner ma carte">
    <div class="face back"><div class="seal">${I.seal}</div><div class="hint">Touche pour révéler</div></div>
    <div class="face front ${me.camp}">
      <div class="role-icon">${ri.icon}</div>
      <div class="role-name">${ri.name}</div>
      <div class="role-camp">${me.camp === 'ame' ? 'Camp des Âmes Sœurs' : 'Camp des Imposteurs'}</div>
      <div class="word-box"><small>${me.camp === 'ame' ? 'Ton mot' : 'Ton mot leurre'}</small><div class="word">${esc(me.word)}</div></div>
      <div class="role-text">${roleText(me)}</div>
    </div>
  </div></div>
  <div class="actionbar"><div class="status">${readyCount}/${g.players.filter((p) => p.status !== 'left').length} prêts</div><div class="inner">
    <button class="btn ghost" data-do="flip">${S.cardFlipped ? 'Masquer' : 'Afficher'}</button>
    <button class="btn grow ${me.ready ? 'done' : ''}" data-do="ready" ${me.ready ? 'disabled' : ''}>${me.ready ? 'Prêt ✓' : 'J’ai compris, je suis prêt'}</button>
    ${hostSkip()}
  </div></div>`;
}

// DISCUSSION
function discussionScreen() {
  const g = G();
  const me = ME();
  const v = V();
  const mine = g.declarations.filter((d) => d.playerId === v.you).length;
  const susCount = {};
  for (const s of g.suspicions) susCount[s.to] = (susCount[s.to] ?? 0) + 1;
  const ids = g.players.filter((p) => p.status !== 'left').map((p) => p.id);
  const mustMe = g.mustDeclare === v.you;
  return `${topbar()}
  <div class="cols"><div class="stack">
    ${g.event ? `<div class="event"><div class="ev-title">${g.event.icon} ${esc(g.event.title)}</div><p>${esc(g.event.text)}</p></div>` : ''}
    ${peek()}
    ${secretsPanel()}
    <div class="panel">
      <div class="panel-title"><h3>Déclarations</h3><span class="small muted">${mine}/3</span></div>
      <p class="small muted" style="margin-top:-4px">Parlez à voix haute. Ici, laissez une trace publique : un indice, un mensonge, un défi. Ton propre mot est interdit.</p>
      ${mustMe ? '<p class="badge or" style="margin:6px 0">📣 Tu dois faire une déclaration !</p>' : ''}
      <div class="composer" style="margin:10px 0">
        <input id="decl" class="input" maxlength="60" placeholder="Mon mot évoque…" value="${esc(S.drafts.decl ?? '')}" data-draft="decl" ${mine >= 3 || me.status === 'left' ? 'disabled' : ''}>
        <button class="btn sm" data-do="declare" ${mine >= 3 ? 'disabled' : ''}>Publier</button>
      </div>
      <ul class="feed">${g.declarations.length ? g.declarations.slice().reverse().map((d) => `<li>${avatar(d.playerId)}<div class="bubble"><b>${nm(d.playerId)}</b>${esc(d.text)}</div></li>`).join('') : '<li class="muted small">Aucune déclaration pour l’instant.</li>'}</ul>
    </div>
  </div><div class="stack">
    <div class="panel">
      <div class="panel-title"><h3>Soupçons</h3><span class="small muted">touche un joueur pour le soupçonner publiquement</span></div>
      ${gauge()}
      <div style="margin-top:12px">${playerGrid({
        ids,
        selected: me.mySuspects,
        action: 'suspect',
        disabledIds: [v.you],
        meta: (id, p) => `${statusBadges(p)}${susCount[id] ? ` <span class="badge grenat">👁 ${susCount[id]}</span>` : ''}`,
      })}</div>
    </div>
  </div></div>
  <div class="actionbar"><div class="status">${progress()} veulent passer au vote</div><div class="inner">
    <button class="btn grow ${me.ready ? 'done' : ''}" data-do="${me.ready ? 'unready' : 'ready'}">${me.ready ? 'En attente des autres… (annuler)' : (g.settings.accusations ? 'Passer au vote' : 'Passer à la suite')}</button>
    ${hostSkip()}
  </div></div>`;
}

// ACCUSATION
function accusationScreen() {
  const g = G();
  const me = ME();
  const v = V();
  const candidates = g.players.filter((p) => p.status === 'searching' && p.id !== v.you).map((p) => p.id);
  const sel = S.sel.vote !== undefined ? S.sel.vote : me.vote;
  const voters = g.players.filter((p) => p.status !== 'left' && V().players.find((x) => x.id === p.id)?.connected).length;
  const threshold = Math.max(2, Math.ceil(voters * 0.2));
  return `${topbar()}
  <div class="stack">
    <div class="center"><h2>Qui est un imposteur ?</h2>
    <p class="muted small">Vote secret. Il faut au moins ${threshold} votes et une majorité nette. Un imposteur démasqué ne peut plus voler de cœur ; un innocent accusé passe la manche en quarantaine.</p></div>
    ${playerGrid({ ids: candidates, selected: sel ? [sel] : [], action: 'pick-vote' })}
    ${me.vote !== undefined ? `<p class="center small muted">Ton vote : <b>${me.vote ? nm(me.vote) : 'abstention'}</b> (modifiable)</p>` : ''}
  </div>
  <div class="actionbar"><div class="status">${progress()} ont voté</div><div class="inner">
    <button class="btn ghost" data-do="vote-abstain">M’abstenir</button>
    <button class="btn danger grow" data-do="vote" ${sel ? '' : 'disabled'}>${sel ? `Accuser ${nm(sel)}` : 'Choisis un suspect'}</button>
    ${hostSkip()}
  </div></div>`;
}

function accusationResultScreen() {
  const a = G().accusation;
  let body;
  if (!a || a.outcome === 'none') body = `<div class="ico">${I.heart}</div><div class="big">Personne n’a été accusé</div><p class="muted">Le doute profite à tout le monde.</p>`;
  else if (a.outcome === 'tie') body = `<div class="ico">${I.eye}</div><div class="big">Égalité !</div><p class="muted">Les votes se sont dispersés : aucune accusation.</p>`;
  else if (a.outcome === 'weak') body = `<div class="ico">${I.eye}</div><div class="big">Pas assez de voix</div><p class="muted">Il fallait au moins ${a.threshold} votes.</p>`;
  else if (a.outcome === 'imposteur') body = `<div class="ico" style="color:#ff6b8a">${I.mask}</div><div class="big">${nm(a.targetId)} était ${a.role === 'briseur' ? 'le Briseur de cœurs' : 'un imposteur'} !</div><p class="muted">Démasqué : plus aucun cœur à voler. L’objectif baisse d’un duo.</p>`;
  else body = `<div class="ico" style="color:var(--rose-doux)">${I.heart}</div><div class="big">${nm(a.targetId)} est une Âme Sœur</div><p class="muted">Innocent·e, mais en quarantaine : pas de duo possible cette manche. Les imposteurs ricanent.</p>`;
  const ballots = a?.ballots?.filter((b) => b.target).map((b) => `<span class="badge">${nm(b.voter)} → ${nm(b.target)}</span>`).join('') ?? '';
  return `${topbar()}<div class="verdict">${body}</div>
    ${ballots ? `<div class="panel tight"><div class="small muted center" style="margin-bottom:8px">Les votes</div><div class="ballots">${ballots}</div></div>` : ''}
    <div class="actionbar"><div class="inner"><div class="grow center muted small">La suite arrive…</div>${hostSkip()}</div></div>`;
}

// ACTIONS (nuit) — tout le monde a un écran similaire pour ne trahir personne
function nightScreen() {
  const me = ME();
  const g = G();
  const v = V();
  const others = g.players.filter((p) => p.status !== 'left' && p.id !== v.you).map((p) => p.id);
  const power = me.power;
  let title; let sub; let ids = others; let max = 1; let btn; let disabled = [];
  if (power === 'scan') { title = 'Vision'; sub = 'Choisis deux joueurs : tu sauras s’ils forment un vrai duo.'; max = 2; btn = 'Sonder'; }
  else if (power === 'protect') { title = 'Protection'; sub = 'Protège un joueur : aucun gel ne pourra toucher son lien cette manche.'; ids = g.players.filter((p) => p.status !== 'left').map((p) => p.id); btn = 'Protéger'; if (me.lastProtect) disabled = [me.lastProtect]; }
  else if (power === 'freeze') { title = 'Gel'; sub = 'Vise un joueur : si son lien se forme cette manche, il sera gelé.'; ids = g.players.filter((p) => p.status === 'searching' && p.id !== v.you).map((p) => p.id); btn = 'Geler'; if (me.lastFreeze) disabled = [me.lastFreeze]; }
  else { title = 'Intuition'; sub = 'Qui a la tête de l’emploi ? Ton avis reste anonyme ; la rumeur sera publiée.'; btn = 'Murmurer'; }
  const doneAct = power ? !!me.action : !!me.poll;
  const sel = S.sel.night ?? [];
  const ready = sel.length === max;
  return `${topbar()}
  <div class="night-sky stack"><div class="moon"></div><h2>${title}</h2><p class="muted">${sub}</p></div>
  <div style="margin-top:14px">${doneAct
    ? `<div class="panel center"><p>Ton choix est enregistré.</p><p class="muted small">Les autres finissent… Garde un air innocent.</p></div>${power === 'scan' ? '' : ''}`
    : playerGrid({ ids, selected: sel, action: 'pick-night', night: true, disabledIds: disabled })}</div>
  <div class="actionbar"><div class="status">${progress()} ont joué</div><div class="inner">
    ${doneAct ? '<div class="grow center muted">En attente…</div>' : `<button class="btn night grow" data-do="night" ${ready ? '' : 'disabled'}>${ready ? `${btn} ${sel.map((id) => nm(id)).join(' et ')}` : (max === 2 ? 'Choisis deux joueurs' : 'Choisis un joueur')}</button>`}
    ${hostSkip()}
  </div></div>`;
}

// FORMATION
function formationScreen() {
  const g = G();
  const me = ME();
  const v = V();
  const rumor = g.nightRumor ? `<div class="panel tight center small">🌙 Rumeur de la nuit : beaucoup pensent que <b>${nm(g.nightRumor.id)}</b> cache quelque chose.</div>` : '';
  if (!me.canChoose) {
    const ids = g.players.filter((p) => p.canChoose).map((p) => p.id);
    const sel = S.sel.prono !== undefined ? S.sel.prono : me.pronostic;
    const reason = me.status === 'paired' ? 'Ton duo est réuni' : me.status === 'unmasked' ? 'Tu as été démasqué' : me.quarantined ? 'Tu es en quarantaine' : me.status === 'orphan' ? 'Ton âme sœur est partie' : 'Tu es hors course';
    return `${topbar()}<div class="stack">
      <div class="center"><h2>Pronostic</h2><p class="muted">${reason}. Devine qui va former un vrai duo cette manche : +1 point si tu as raison.</p></div>
      ${rumor}
      ${playerGrid({ ids, selected: sel ? [sel] : [], action: 'pick-prono', showCheck: true })}
      ${me.pronostic !== undefined ? `<p class="center small muted">Ton pronostic : <b>${me.pronostic ? nm(me.pronostic) : 'aucun'}</b></p>` : ''}
    </div>
    <div class="actionbar"><div class="status">${progress()} ont choisi</div><div class="inner">
      <button class="btn ghost" data-do="prono-skip">Passer</button>
      <button class="btn grow" data-do="prono" ${sel ? '' : 'disabled'}>${sel ? `Parier sur ${nm(sel)}` : 'Choisis un joueur'}</button>
      ${hostSkip()}
    </div></div>`;
  }
  const ids = g.players.filter((p) => p.canChoose && p.id !== v.you).map((p) => p.id);
  const sel = S.sel.choice !== undefined ? S.sel.choice : me.choice?.target;
  const betray = S.sel.betray ?? me.choice?.betray ?? false;
  return `${topbar()}<div class="stack">
    <div class="center"><h2>Qui est ton âme sœur ?</h2><p class="muted small">Choix secret. Le lien ne se forme que si vous vous choisissez mutuellement.${g.event?.type === 'foudre' ? ' ⚡ Points doublés cette manche !' : ''}</p></div>
    ${rumor}
    ${peek()}
    ${playerGrid({ ids, selected: sel ? [sel] : [], action: 'pick-choice' })}
    ${me.canBetray ? `<div class="panel tight"><div class="setting" style="padding:0"><div class="lbl">🐍 Trahir ce choix <small>Une fois par partie. Vrai duo : toi +5, ton partenaire 0 (si vous trahissez tous les deux : +1 chacun). Mauvais lien : −3.</small></div>
      <input type="checkbox" class="switch" data-do="betray" ${betray ? 'checked' : ''} aria-label="Trahir ce choix"></div></div>` : ''}
    ${me.choice ? `<p class="center small muted">Choix envoyé : <b>${me.choice.target ? nm(me.choice.target) : 'personne'}</b>${me.choice.betray ? ' 🐍' : ''} (modifiable jusqu’à la fin)</p>` : ''}
  </div>
  <div class="actionbar"><div class="status">${progress()} ont choisi</div><div class="inner">
    <button class="btn ghost" data-do="choose-none">Personne</button>
    <button class="btn grow" data-do="choose" ${sel ? '' : 'disabled'}>${sel ? `Choisir ${nm(sel)}` : 'Choisis un joueur'}</button>
    ${hostSkip()}
  </div></div>`;
}

// REVEAL — les liens se dévoilent un par un, synchronisés sur l'horloge du serveur
const REVEAL_LEAD = 2500;
const REVEAL_STEP = 3500;
function currentRevealStep() {
  const elapsed = now() - V().phaseStartedAt;
  return Math.floor((elapsed - REVEAL_LEAD) / REVEAL_STEP);
}
function linkCard(l, state) {
  const tag = { authentique: 'Âmes sœurs !', brise: 'Lien brisé', gele: 'Lien gelé' }[l.verdict];
  const sub = [];
  if (state !== 'pending') {
    if (l.verdict === 'authentique' && l.words) sub.push(`« ${esc(l.words[0])} » et « ${esc(l.words[1])} »`);
    if (l.verdict === 'brise') sub.push('Ce n’étaient pas les bonnes moitiés… ou l’un des deux ment.');
    if (l.verdict === 'gele') sub.push('Le Briseur de cœurs a frappé : verdict scellé, rien ne compte.');
    if (l.shielded) sub.push('🛡 Un gel a été bloqué par le Protecteur.');
    if (l.betrayers?.length) sub.push(`🐍 ${l.betrayers.map((id) => nm(id)).join(' et ')} ${l.betrayers.length > 1 ? 'ont' : 'a'} trahi !`);
  }
  return `<div class="link-card ${state === 'pending' ? 'pending' : l.verdict} ${state === 'now' ? 'now' : ''}">
    <div class="n l">${nm(l.a)}</div>${halves()}<div class="n">${nm(l.b)}</div>
    ${state === 'pending' ? '' : `<div class="verdict-tag">${tag}</div>${sub.length ? `<div class="sub">${sub.join('<br>')}</div>` : ''}`}
  </div>`;
}
function revealScreen() {
  const r = G().reveal;
  const step = currentRevealStep();
  S.revealStep = step;
  if (!r.links.length) {
    return `${topbar()}<div class="drumroll">${halves()}<h2>Aucun lien formé</h2><p class="muted">Personne ne s’est choisi mutuellement cette manche.</p></div>
      <div class="actionbar"><div class="inner"><div class="grow"></div>${hostSkip()}</div></div>`;
  }
  const allShown = step >= r.links.length;
  return `${topbar()}
  ${step < 0 ? `<div class="drumroll">${halves()}<h2>Les moitiés se cherchent…</h2><p class="muted">${plural(r.links.length, 'lien mutuel', 'liens mutuels')} cette manche</p></div>` : ''}
  <div class="links">${r.links.map((l, i) => linkCard(l, i < step ? 'done' : i === step ? 'now' : 'pending')).join('')}</div>
  ${allShown ? `<div class="panel tight center" style="margin-top:14px">${r.stolenThisRound ? `🗡 <b>${plural(r.stolenThisRound, 'cœur volé', 'cœurs volés')}</b> par les imposteurs cette manche.` : 'Aucun cœur volé cette manche.'}${r.pronosticWinners.length ? `<br>🔮 Pronostics gagnants : ${r.pronosticWinners.map((id) => nm(id)).join(', ')}` : ''}</div>` : ''}
  <div class="actionbar"><div class="inner"><div class="grow"></div>${hostSkip()}</div></div>`;
}

// ROUND_END
function rankList(entries) {
  const v = V();
  return `<ol class="rank">${entries.map((e, i) => `<li class="${e.id === v.you ? 'me' : ''}"><span class="pos">${i + 1}</span>${avatar(e.id)}<span class="grow">${nm(e.id)} ${e.badges ?? ''}</span><span class="pts">${e.score}</span></li>`).join('')}</ol>`;
}
function roundEndScreen() {
  const g = G();
  const me = ME();
  const ranking = g.players.filter((p) => p.status !== 'left').slice().sort((a, b) => b.score - a.score).map((p) => ({ id: p.id, score: p.score, badges: statusBadges(p) }));
  const h = g.history[g.history.length - 1];
  return `${topbar()}<div class="cols"><div class="stack">
    <div class="panel"><div class="panel-title"><h3>Manche ${g.round}</h3></div>
      <p>${plural(h?.authentic ?? 0, 'duo authentique', 'duos authentiques')}, ${plural(h?.broken ?? 0, 'lien brisé', 'liens brisés')}${h?.frozen ? `, ${plural(h.frozen, 'lien gelé', 'liens gelés')}` : ''}.</p>
      ${gauge()}
      ${g.finished ? '<p style="margin-top:10px"><b>C’était la dernière manche.</b> Place au verdict final !</p>' : ''}
    </div>
    ${secretsPanel()}
  </div><div class="stack">
    <div class="panel"><div class="panel-title"><h3>Scores</h3><span class="small muted">toi : ${me.score}</span></div>${rankList(ranking)}</div>
  </div></div>
  <div class="actionbar"><div class="status">${progress()} prêts</div><div class="inner">
    <button class="btn grow ${me.ready ? 'done' : ''}" data-do="ready" ${me.ready ? 'disabled' : ''}>${me.ready ? 'Prêt ✓' : (g.finished ? 'Voir le résultat' : 'Manche suivante')}</button>
    ${hostSkip('Continuer')}
  </div></div>`;
}

// GAME_OVER
function gameOverScreen() {
  const f = G().final;
  const me = ME();
  const v = V();
  const won = (f.winner === 'ames') === (me.camp === 'ame');
  const roleOf = (id) => f.roles.find((r) => r.id === id);
  const duoLines = f.duos.map((d) => `<div class="duo-line"><div class="l"><div>${nm(d.a)}</div><div class="w">${esc(d.words[0])}</div></div>
    <span class="badge ${d.status === 'reunited' ? 'rose' : ''}">${d.status === 'reunited' ? `💞 manche ${d.round}` : d.status === 'dissolved' ? 'dissous' : 'séparés'}</span>
    <div><div>${nm(d.b)}</div><div class="w">${esc(d.words[1])}</div></div></div>`).join('');
  const imps = f.imposters.map((i) => `<div class="duo-line"><div class="l">${nm(i.id)}</div><span class="badge grenat">${i.role === 'briseur' ? 'Briseur' : 'Imposteur'}</span><div><span class="w">${esc(i.word)}</span> <span class="small muted">${i.steals ? `${plural(i.steals, 'cœur volé', 'cœurs volés')}` : ''}${i.status === 'unmasked' ? ' · démasqué' : ''}</span></div></div>`).join('');
  const specials = f.roles.filter((r) => r.role === 'voyant' || r.role === 'protecteur').map((r) => `${nm(r.id)} (${ROLE_INFO[r.role].name})`).join(', ');
  const ranking = f.ranking.map((r) => ({ id: r.id, score: r.score, badges: `<span class="badge ${r.camp === 'ame' ? 'rose' : 'grenat'}">${ROLE_INFO[r.role].name}</span>` }));
  return `<div class="winner ${f.winner}">
    <div class="small muted">${won ? 'Victoire !' : 'Défaite…'}</div>
    <div class="who">${f.winner === 'ames' ? 'Les Âmes Sœurs l’emportent' : 'Les Imposteurs l’emportent'}</div>
    <p class="muted">${f.authentic} duo${f.authentic > 1 ? 's' : ''} réuni${f.authentic > 1 ? 's' : ''} pour un objectif de ${f.objective}${f.stolen ? ` · ${plural(f.stolen, 'cœur volé', 'cœurs volés')}` : ''}${f.unmasked ? ` · ${plural(f.unmasked, 'imposteur démasqué', 'imposteurs démasqués')}` : ''}</p>
  </div>
  <div class="cols"><div class="stack">
    <div class="panel"><div class="panel-title"><h3>Les vrais duos</h3></div><div class="stack" style="--g:8px">${duoLines}</div>${specials ? `<p class="small muted" style="margin-top:10px">Rôles spéciaux : ${specials}</p>` : ''}</div>
    <div class="panel"><div class="panel-title"><h3>Les imposteurs</h3></div><div class="stack">${imps}</div></div>
    ${f.awards.length ? `<div class="panel"><div class="panel-title"><h3>Distinctions</h3></div><div class="awards">${f.awards.map((a) => `<div class="award"><div class="e">${a.icon}</div><div class="t">${esc(a.title)}</div><div class="small">${nm(a.id)}${a.id2 ? ` et ${nm(a.id2)}` : ''}</div><div class="small muted">${esc(a.text)}</div></div>`).join('')}</div></div>` : ''}
  </div><div class="stack">
    <div class="panel"><div class="panel-title"><h3>Classement</h3><span class="small muted">toi : ${roleOf(v.you)?.score ?? 0} pts</span></div>${rankList(ranking)}</div>
    <div class="panel tight small">${f.history.map((h) => `<p><b>Manche ${h.round}</b>${h.event ? ` (${esc(h.event)})` : ''} : ${h.links.map((l) => `${nm(l.a)} & ${nm(l.b)} ${l.verdict === 'authentique' ? '💞' : l.verdict === 'gele' ? '❄️' : l.stolen ? '🗡' : '💔'}`).join(', ') || 'aucun lien'}</p>`).join('')}</div>
  </div></div>
  <div class="actionbar"><div class="inner">
    <button class="btn ghost" data-do="leave">Quitter</button>
    ${isHost() ? '<button class="btn grow" data-do="replay">Rejouer avec les mêmes joueurs</button>' : '<div class="grow center muted small">L’hôte peut relancer une partie</div>'}
  </div></div>`;
}

function spectatorScreen() {
  return `<div class="home"><div class="emblem">${HL()}${HR()}</div><h2 class="center">Partie en cours</h2>
    <p class="center muted">Tu ne participes pas à cette manche. Tu pourras rejoindre la prochaine partie quand l’hôte la relancera.</p>
    <button class="btn ghost block" data-do="leave">Quitter le salon</button></div>`;
}

// ───────────────────────── règles ─────────────────────────
function rulesModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-bg" data-do="close-modal"><div class="sheet" role="dialog" aria-modal="true" aria-label="Règles du jeu" onclick="event.stopPropagation()">
    <div class="row"><h2 class="grow">Comment jouer</h2><button class="icon-btn" data-do="close-modal" aria-label="Fermer">${I.x}</button></div>
    <p>Chaque Âme Sœur reçoit un mot. Quelque part dans la salle, une seule personne a un mot lié au sien : c’est son âme sœur. Les imposteurs reçoivent un mot qui ressemble à celui d’un vrai duo, et tentent de se faire choisir.</p>
    <h3>Une manche</h3>
    <ul>
      <li><b>Discussion</b> : parlez à voix haute, mentez si besoin. Publiez des déclarations (votre propre mot est interdit).</li>
      <li><b>Accusations</b> : vote secret. Imposteur démasqué : il ne peut plus voler de cœur et l’objectif baisse. Innocent accusé : quarantaine pour la manche.</li>
      <li><b>La nuit</b> (si rôles spéciaux) : pouvoirs secrets ; les autres donnent leur intuition.</li>
      <li><b>Formation</b> : choisissez en secret votre âme sœur. Un lien ne se forme que si le choix est mutuel.</li>
      <li><b>Révélation</b> : 💞 vrai duo, 💔 lien brisé, ❄️ lien gelé.</li>
    </ul>
    <h3>Victoire</h3>
    <p>Les Âmes Sœurs gagnent si, après la dernière manche, au moins autant de duos que l’objectif sont réunis. Chaque cœur volé par un imposteur augmente l’objectif d’un duo ; chaque imposteur démasqué le diminue d’un. Sinon, les Imposteurs gagnent.</p>
    <p>Un lien brisé ne dit pas pourquoi : deux Âmes Sœurs qui se sont trompées, ou un imposteur qui a menti. Le compteur de cœurs volés, lui, ne ment pas.</p>
    <h3>Rôles spéciaux</h3>
    <ul>
      <li><b>Voyant</b> (Âme Sœur) : chaque nuit, découvre si deux autres joueurs forment un vrai duo.</li>
      <li><b>Protecteur</b> (Âme Sœur) : chaque nuit, protège un joueur du gel (pas deux fois de suite le même).</li>
      <li><b>Briseur de cœurs</b> (Imposteur) : chaque nuit, vise un joueur ; si son lien se forme, il est gelé et ne compte pas.</li>
    </ul>
    <h3>Trahison (mode Chaos)</h3>
    <p>Une fois par partie, tu peux trahir ton choix. Si le duo est vrai : toi +5, ton partenaire 0. Si vous trahissez tous les deux : +1 chacun. Si le lien est brisé : −3. Le duo compte toujours pour l’équipe.</p>
    <h3>Points individuels</h3>
    <table>
      <tr><td>Vrai duo formé (manche 1 : +1 bonus)</td><td>+3</td></tr>
      <tr><td>Imposteur qui vole un cœur</td><td>+3</td></tr>
      <tr><td>Lien brisé (Âme Sœur)</td><td>−1</td></tr>
      <tr><td>Vote contre un imposteur démasqué</td><td>+1</td></tr>
      <tr><td>Vote contre un innocent mis en quarantaine</td><td>−1</td></tr>
      <tr><td>Pronostic juste (joueurs hors course)</td><td>+1</td></tr>
      <tr><td>Âme Sœur encore seule à la fin</td><td>−1</td></tr>
      <tr><td>Imposteur jamais démasqué</td><td>+1</td></tr>
    </table>
    <h3>Les règles d’or</h3>
    <ul><li>Ne montre jamais ton écran.</li><li>Ne lis pas ton mot à voix haute mot pour mot : les imposteurs n’attendent que ça pour dire « moi aussi ! ».</li><li>Tout le reste est permis : mentir, bluffer, accuser.</li></ul>
  </div></div>`;
}

// ───────────────────────── interactions ─────────────────────────
document.addEventListener('input', (e) => {
  const k = e.target.dataset?.draft;
  if (k) S.drafts[k] = e.target.value;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'decl') { e.preventDefault(); handleDo('declare', e.target); }
  if (e.key === 'Enter' && (e.target.id === 'name' || e.target.id === 'code')) { e.preventDefault(); handleDo(document.getElementById('code') ? 'join' : 'create', e.target); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-do]')) { e.preventDefault(); handleDo(e.target.dataset.do, e.target); }
  if (e.key === 'Escape') document.getElementById('modal-root').innerHTML = '';
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset?.do === 'toggle') changeSetting(el.dataset.key, el.checked);
  if (el.dataset?.do === 'betray') { S.sel.betray = el.checked; const me = ME(); if (me.choice?.target) act({ type: 'choose', target: me.choice.target, betray: el.checked }); }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-do]');
  if (!el || el.matches('input')) return;
  handleDo(el.dataset.do, el);
});

function handleDo(what, el) {
  const id = el?.dataset?.id;
  const me = ME();
  switch (what) {
    case 'create': return doCreate();
    case 'join': return doJoin();
    case 'home-join': S.homeMode = 'join'; return render();
    case 'home-back': S.homeMode = null; return render();
    case 'rules': return rulesModal();
    case 'install': return doInstall();
    case 'close-modal': document.getElementById('modal-root').innerHTML = ''; return undefined;
    case 'share': {
      const url = el.dataset.url;
      if (navigator.share) return navigator.share({ title: 'Les Âmes Sœurs', text: `Rejoins ma partie ! Code ${V().code}`, url }).catch(() => {});
      return navigator.clipboard?.writeText(url).then(() => toast('Lien copié !', 'ok'), () => toast(url));
    }
    case 'set': return changeSetting(el.dataset.key, el.dataset.val);
    case 'step': return changeSetting(el.dataset.key, el.dataset.delta);
    case 'kick': if (confirm(`Exclure ${nm(id).replace(/&[^;]+;/g, '')} ?`)) act({ type: 'kick', target: id }); return undefined;
    case 'start': return act({ type: 'start' });
    case 'leave': {
      const inGame = V() && !['LOBBY', 'GAME_OVER'].includes(V().phase) && me && me.status !== 'left';
      if (inGame && !confirm('Quitter la partie en cours ? Ton âme sœur se retrouvera seule.')) return undefined;
      return act({ type: 'leave' }).then(leaveSession);
    }
    case 'skip': return act({ type: 'skip' });
    case 'replay': return act({ type: 'replay' });
    case 'ready': return act({ type: 'ready' });
    case 'unready': return act({ type: 'ready', value: false });
    case 'flip': S.cardFlipped = !S.cardFlipped; document.querySelector('.card3d')?.classList.toggle('flipped', S.cardFlipped); return render();
    case 'peek':
      S.peek = !S.peek;
      clearTimeout(S.peekTimer);
      if (S.peek) S.peekTimer = setTimeout(() => { S.peek = false; render(); }, 5000);
      return render();
    case 'declare': {
      const input = document.getElementById('decl');
      const text = (input?.value || '').trim();
      if (!text) return toast('Écris quelque chose.');
      return act({ type: 'declare', text }).then((ok) => {
        if (!ok) return;
        S.drafts.decl = '';
        const i = document.getElementById('decl');
        if (i) i.value = '';
      });
    }
    case 'suspect': return act({ type: 'suspect', target: id, value: !me.mySuspects.includes(id) });
    case 'pick-vote': S.sel.vote = id; return render();
    case 'vote': return act({ type: 'vote', target: S.sel.vote ?? me.vote ?? null }, 'Vote enregistré');
    case 'vote-abstain': S.sel.vote = null; return act({ type: 'vote', target: null }, 'Abstention enregistrée');
    case 'pick-night': {
      const max = me.power === 'scan' ? 2 : 1;
      let sel = S.sel.night ?? [];
      if (sel.includes(id)) sel = sel.filter((x) => x !== id);
      else sel = max === 1 ? [id] : [...sel, id].slice(-2);
      S.sel.night = sel;
      return render();
    }
    case 'night': {
      const sel = S.sel.night ?? [];
      if (me.power === 'scan') return act({ type: 'scan', a: sel[0], b: sel[1] });
      if (me.power === 'protect') return act({ type: 'protect', target: sel[0] });
      if (me.power === 'freeze') return act({ type: 'freeze', target: sel[0] });
      return act({ type: 'poll', target: sel[0] });
    }
    case 'pick-choice': S.sel.choice = id; return render();
    case 'choose': return act({ type: 'choose', target: S.sel.choice ?? me.choice?.target, betray: !!(S.sel.betray ?? me.choice?.betray) }, 'Choix envoyé');
    case 'choose-none': S.sel.choice = null; return act({ type: 'choose', target: null }, 'Tu ne choisis personne');
    case 'pick-prono': S.sel.prono = id; return render();
    case 'prono': return act({ type: 'pronostic', target: S.sel.prono ?? me.pronostic }, 'Pronostic enregistré');
    case 'prono-skip': return act({ type: 'pronostic', target: null });
    default: return undefined;
  }
}

// ───────────────────────── minuteries ─────────────────────────
function updateTimers() {
  const v = V();
  if (!v?.deadline) return;
  const left = Math.max(0, v.deadline - now());
  const total = Math.max(1, v.deadline - v.phaseStartedAt);
  for (const el of document.querySelectorAll('[data-timer]')) {
    const s = Math.ceil(left / 1000);
    el.querySelector('.t').textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : String(s);
    el.querySelector('.bar').style.strokeDashoffset = String(138.2 * (1 - left / total));
    el.classList.toggle('low', s <= 10 && v.phase !== 'REVEAL');
  }
}
setInterval(() => {
  updateTimers();
  if (V()?.phase === 'REVEAL' && currentRevealStep() !== S.revealStep) render();
}, 200);

// Garde l'écran allumé pendant la partie (si le navigateur le permet)
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* refusé */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { keepAwake(); if (S.session && (!S.es || S.es.readyState === 2)) connect(); }
});
window.addEventListener('resize', () => document.body.classList.toggle('wide', window.innerWidth >= 900));
document.addEventListener('click', keepAwake, { once: true });

// ───────────────────────── installation (PWA) ─────────────────────────
const INSTALL = { prompt: null };
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
const ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/></svg>';

function installChip() {
  if (isStandalone()) return '';
  return `<button class="install-chip" data-do="install">${ICON_PHONE}Installer l’appli sur ce téléphone</button>`;
}

async function doInstall() {
  if (INSTALL.prompt) {
    const p = INSTALL.prompt;
    INSTALL.prompt = null;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') toast('Installation en cours… l’icône arrive sur ton écran d’accueil.', 'ok');
    render();
    return;
  }
  installModal();
}

function installModal() {
  let steps;
  if (isIOS && isIOSSafari) {
    steps = `<li><span>Touche le bouton <span class="kbd">${ICON_SHARE} Partager</span> en bas de Safari (en haut sur iPad).</span></li>
      <li><span>Fais défiler et choisis <span class="kbd">Sur l’écran d’accueil</span>.</span></li>
      <li><span>Touche <span class="kbd">Ajouter</span> : l’icône Âmes Sœurs apparaît avec tes applis.</span></li>`;
  } else if (isIOS) {
    steps = `<li><span>Touche le bouton <span class="kbd">${ICON_SHARE} Partager</span> de ton navigateur (iOS 16.4 ou plus récent), ou ouvre cette page dans <b>Safari</b>.</span></li>
      <li><span>Choisis <span class="kbd">Sur l’écran d’accueil</span>, puis <span class="kbd">Ajouter</span>.</span></li>`;
  } else if (isAndroid) {
    steps = `<li><span>Ouvre le menu du navigateur <span class="kbd">⋮</span> (en haut à droite dans Chrome).</span></li>
      <li><span>Choisis <span class="kbd">Installer l’application</span> ou <span class="kbd">Ajouter à l’écran d’accueil</span>.</span></li>
      <li><span>Confirme : l’icône apparaît dans tes applis.</span></li>`;
  } else {
    steps = `<li><span>Dans Chrome ou Edge, clique sur l’icône d’installation <span class="kbd">${ICON_PHONE}</span> à droite de la barre d’adresse.</span></li>
      <li><span>Sur téléphone, ouvre cette même adresse : un bouton d’installation t’y attend.</span></li>`;
  }
  const insecure = !window.isSecureContext;
  document.getElementById('modal-root').innerHTML = `<div class="modal-bg" data-do="close-modal"><div class="sheet" role="dialog" aria-modal="true" aria-label="Installer l’appli" onclick="event.stopPropagation()">
    <div class="row"><h2 class="grow">Installer l’appli</h2><button class="icon-btn" data-do="close-modal" aria-label="Fermer">${I.x}</button></div>
    <p>Pas besoin de store : le jeu s’installe directement depuis ton navigateur et s’ouvre ensuite en plein écran, comme une vraie appli.</p>
    <ol class="steps">${steps}</ol>
    ${insecure ? '<p class="note">Cette adresse n’est pas sécurisée (http). Android ne créera qu’un simple raccourci. Pour une vraie appli, l’hôte doit utiliser une adresse en https (tunnel ou hébergement, voir le README).</p>' : ''}
    <p class="note">Une fois installée, ouvre l’appli puis touche « J’ai un code » pour rejoindre une partie. Ta place est gardée si tu fermes l’appli en cours de route.</p>
    <button class="btn block" data-do="close-modal">J’ai compris</button>
  </div></div>`;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // on garde l'invitation pour notre propre bouton
  INSTALL.prompt = e;
});
window.addEventListener('appinstalled', () => {
  INSTALL.prompt = null;
  toast('Appli installée ! Tu la trouveras sur ton écran d’accueil.', 'ok');
});
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* navigation privée, etc. */ }));
}

// ───────────────────────── démarrage ─────────────────────────
(function boot() {
  document.body.classList.toggle('wide', window.innerWidth >= 900);
  const invited = new URLSearchParams(location.search).get('r')?.toUpperCase();
  if (S.session && invited && invited !== S.session.code) save(null); // lien vers un autre salon
  render();
  if (S.session) connect();
}());
