// Paramètres d'équilibrage et préréglages des modes.
import { DIFFICULTIES } from './clues.js';

export const MIN_PLAYERS = 6; // jouable dès 6, idéal 8–30
export const MAX_PLAYERS = 30;
export const NAME_MAX = 16;
export const DECLARATION_MAX = 60;
export const DECLARATIONS_PER_ROUND = 3;
export const MAX_SUSPECTS = 3;

/** Répartition : ~1 imposteur pour 5 joueurs (min 2), parité ajustée pour que tout le monde ait un partenaire. */
export function distribution(n) {
  let imposters = Math.max(2, Math.floor(n / 5));
  if ((n - imposters) % 2 !== 0) imposters += 1;
  return { imposters, duos: (n - imposters) / 2 };
}

/**
 * Objectif de départ des Âmes Sœurs : nombre de duos à réunir.
 * « duos − imposteurs + 1 », calibré par simulation (voir docs/EQUILIBRAGE.md) :
 * plus il y a d'imposteurs, plus ils volent de cœurs (+1 chacun), donc la base est plus basse.
 */
export function baseObjective(duos, imposters = 2) {
  return Math.max(1, duos - imposters + 1);
}

/** Seuil de votes pour qu'une accusation aboutisse. */
export function accusationThreshold(voters) {
  return Math.max(2, Math.ceil(voters * 0.2));
}

export const POINTS = {
  authentic: 3, // duo authentique formé
  firstRoundBonus: 1, // bonus « coup de foudre immédiat » en manche 1
  brokenLink: -1, // lien brisé (pour une Âme Sœur)
  steal: 3, // imposteur qui vole un cœur
  betrayWin: 5, // trahison réussie (partenaire fidèle)
  betrayBoth: 1, // les deux se trahissent
  betrayVictim: 0, // victime d'une trahison
  betrayFail: -3, // trahison sur un lien brisé
  stealBetray: 5, // imposteur qui « trahit » en volant un cœur
  accuseRight: 1, // a voté contre un imposteur démasqué
  accuseWrong: -1, // a voté contre une Âme Sœur mise en quarantaine
  misdirection: 1, // chaque imposteur actif quand un innocent est mis en quarantaine
  pronostic: 1, // pronostic correct (joueurs hors course)
  freezeHit: 1, // Briseur : gel réussi
  freezeHitAuthentic: 2, // Briseur : gel d'un duo authentique
  shieldSave: 2, // Protecteur : a bloqué un gel
  scanPair: 1, // Voyant : a découvert un vrai duo
  survivor: 1, // imposteur jamais démasqué
  lonely: -1, // Âme Sœur encore seule à la fin
  silentDeclaration: -1, // n'a pas fait la déclaration imposée par l'événement
};

export const MODES = {
  classique: {
    label: 'Classique',
    rounds: 3,
    durations: { role: 25, discussion: 180, accusation: 45, actions: 30, formation: 45, roundEnd: 25 },
    roles: { voyant: false, protecteur: false, briseur: false },
    accusations: true,
    events: false,
    betrayal: false,
    difficulty: 'normal',
  },
  chaos: {
    label: 'Chaos',
    rounds: 3,
    durations: { role: 30, discussion: 150, accusation: 40, actions: 30, formation: 40, roundEnd: 25 },
    roles: { voyant: true, protecteur: true, briseur: true },
    accusations: true,
    events: true,
    betrayal: true,
    difficulty: 'normal',
  },
  express: {
    label: 'Express',
    rounds: 3,
    durations: { role: 15, discussion: 75, accusation: 20, actions: 20, formation: 25, roundEnd: 12 },
    roles: { voyant: false, protecteur: false, briseur: false },
    accusations: true,
    events: false,
    betrayal: false,
    difficulty: 'facile',
  },
};

const LIMITS = {
  role: [5, 120], discussion: [20, 900], accusation: [10, 180],
  actions: [10, 120], formation: [10, 180], roundEnd: [5, 120],
};

export function defaultSettings(mode = 'classique') {
  return structuredClone({ mode, ...MODES[mode] });
}

const clampInt = (v, [lo, hi], dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Applique un patch de paramètres en validant chaque champ. Les champs inconnus sont ignorés. */
export function sanitizeSettings(current, patch) {
  if (!patch || typeof patch !== 'object') return current;
  let s = structuredClone(current);
  if (typeof patch.mode === 'string' && MODES[patch.mode] && patch.mode !== s.mode) {
    s = defaultSettings(patch.mode); // changer de mode recharge son préréglage
  }
  if (patch.rounds !== undefined) s.rounds = clampInt(patch.rounds, [1, 6], s.rounds);
  if (patch.durations && typeof patch.durations === 'object') {
    for (const k of Object.keys(LIMITS)) {
      if (patch.durations[k] !== undefined) s.durations[k] = clampInt(patch.durations[k], LIMITS[k], s.durations[k]);
    }
  }
  if (patch.roles && typeof patch.roles === 'object') {
    for (const k of ['voyant', 'protecteur', 'briseur']) {
      if (typeof patch.roles[k] === 'boolean') s.roles[k] = patch.roles[k];
    }
  }
  for (const k of ['accusations', 'events', 'betrayal']) {
    if (typeof patch[k] === 'boolean') s[k] = patch[k];
  }
  if (typeof patch.difficulty === 'string' && DIFFICULTIES.includes(patch.difficulty)) s.difficulty = patch.difficulty;
  return s;
}
