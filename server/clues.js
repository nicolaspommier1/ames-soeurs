// Banque d'indices : familles > thèmes > mots.
// Les 3 premiers mots d'un thème sont « évidents », les suivants plus subtils.
// Deux partenaires reçoivent deux mots différents d'un même thème.
// Un imposteur reçoit un troisième mot d'un thème réellement utilisé par un duo (le « leurre »).
import { shuffle, pick, normalize } from './rng.js';

export const FAMILIES = {
  mer: { label: 'La mer', themes: {
    plage: ['Sable', 'Parasol', 'Crème solaire', 'Château de sable', 'Transat', 'Bronzage', 'Tongs'],
    ocean: ['Vague', 'Marée', 'Requin', 'Baleine', 'Abysses', 'Corail', 'Tempête'],
    port: ['Bateau', 'Phare', 'Ancre', 'Marin', 'Quai', 'Mouette', 'Filet de pêche'],
  } },
  montagne: { label: 'La montagne', themes: {
    ski: ['Télésiège', 'Piste noire', 'Moniteur', 'Chasse-neige', 'Forfait', 'Après-ski', 'Fondue'],
    randonnee: ['Sentier', 'Sac à dos', 'Boussole', 'Gourde', 'Sommet', 'Refuge', 'Ampoules'],
    hiver: ['Flocon', 'Bonhomme de neige', 'Moufles', 'Verglas', 'Cheminée', 'Écharpe', 'Luge'],
  } },
  cuisine: { label: 'La cuisine', themes: {
    petitdej: ['Croissant', 'Café', 'Confiture', 'Tartine', 'Céréales', "Jus d'orange", 'Brioche'],
    pizza: ['Mozzarella', 'Four à bois', 'Pâte', 'Basilic', 'Livreur', 'Calzone', 'Pepperoni'],
    patisserie: ['Éclair', 'Macaron', 'Fouet', 'Crème pâtissière', 'Meringue', 'Chou', 'Vitrine'],
    barbecue: ['Braise', 'Saucisse', 'Pince', 'Charbon', 'Merguez', 'Fumée', 'Marinade'],
  } },
  fete: { label: 'La fête', themes: {
    anniversaire: ['Bougies', 'Gâteau', 'Cadeau', 'Ballon de baudruche', 'Surprise', 'Confettis', 'Chapeau pointu'],
    mariage: ['Alliance', 'Témoin', 'Bouquet', 'Robe blanche', 'Pièce montée', 'Valse', 'Mairie'],
    noel: ['Sapin', 'Guirlande', 'Père Noël', 'Réveillon', 'Chaussette', 'Bûche', 'Traîneau'],
    halloween: ['Citrouille', 'Sorcière', 'Bonbons', 'Fantôme', 'Déguisement', 'Squelette', "Toile d'araignée"],
  } },
  spectacle: { label: 'Le spectacle', themes: {
    cinema: ['Popcorn', 'Grand écran', 'Bande-annonce', 'Réalisateur', 'Clap', 'Sous-titres', 'Avant-première'],
    cirque: ['Clown', 'Chapiteau', 'Jongleur', 'Trapèze', 'Dompteur', 'Acrobate', 'Nez rouge'],
    theatre: ['Rideau', 'Scène', 'Souffleur', 'Coulisses', 'Tragédie', 'Applaudissements', 'Entracte'],
    concert: ['Guitare', 'Ampli', 'Batteur', 'Foule', 'Rappel', 'Micro', 'Festival'],
  } },
  sport: { label: 'Le sport', themes: {
    football: ['Gardien', 'Penalty', 'Carton rouge', 'Stade', 'Corner', 'Arbitre', 'Hors-jeu'],
    tennis: ['Raquette', 'Balle jaune', 'Roland-Garros', 'Ace', 'Revers', 'Terre battue', 'Jeu décisif'],
    natation: ['Piscine', 'Bonnet de bain', 'Plongeoir', 'Crawl', 'Lunettes', 'Chlore', 'Longueur'],
    velo: ['Pédale', 'Guidon', 'Tour de France', 'Maillot jaune', 'Crevaison', 'Casque', 'Dérailleur'],
  } },
  science: { label: 'La science', themes: {
    espace: ['Fusée', 'Astronaute', 'Lune', 'Satellite', 'Galaxie', 'Comète', 'Apesanteur'],
    labo: ['Microscope', 'Éprouvette', 'Blouse', 'Expérience', 'Molécule', 'Pipette', 'Formule'],
    dinosaures: ['Fossile', 'T-Rex', 'Météorite', 'Paléontologue', 'Jurassique', 'Ossements', 'Volcan'],
  } },
  fantastique: { label: 'Le fantastique', themes: {
    magie: ['Baguette', 'Chapeau haut-de-forme', 'Lapin blanc', 'Abracadabra', 'Cape', 'Tour de cartes', 'Illusion'],
    chevalier: ['Armure', 'Épée', 'Château fort', 'Dragon', 'Bouclier', 'Tournoi', 'Donjon'],
    pirate: ['Trésor', 'Perroquet', 'Jambe de bois', 'Carte au trésor', 'Sabre', 'Drapeau noir', 'Île déserte'],
    vampire: ['Cercueil', 'Crocs', 'Ail', 'Chauve-souris', 'Transylvanie', 'Pieu', 'Pleine nuit'],
  } },
  transport: { label: 'Les transports', themes: {
    metro: ['Rame', 'Station', 'Correspondance', 'Heure de pointe', 'Plan du réseau', 'Tourniquet', 'Strapontin'],
    aeroport: ['Avion', 'Valise', 'Douane', 'Passeport', 'Décollage', 'Hôtesse', 'Escale'],
    train: ['Locomotive', 'Wagon', 'Contrôleur', 'Gare', 'Rails', 'TGV', 'Retard'],
  } },
  maison: { label: 'La maison', themes: {
    jardinage: ['Tondeuse', 'Arrosoir', 'Potager', 'Râteau', 'Graines', 'Serre', 'Nain de jardin'],
    salledebain: ['Baignoire', 'Savon', 'Brosse à dents', 'Miroir', 'Shampoing', 'Peignoir', 'Robinet'],
    demenagement: ['Cartons', 'Camion', 'Scotch', 'Étiquettes', 'Trousseau de clés', 'Voisins', 'Inventaire'],
    bricolage: ['Marteau', 'Perceuse', 'Vis', 'Tournevis', 'Établi', 'Mètre ruban', 'Clou'],
  } },
  animaux: { label: 'Les animaux', themes: {
    ferme: ['Vache', 'Tracteur', 'Poule', 'Foin', 'Fermier', 'Cochon', 'Étable'],
    jungle: ['Singe', 'Liane', 'Tigre', 'Serpent', 'Cascade', 'Machette', 'Panthère'],
    chat: ['Moustaches', 'Croquettes', 'Ronronnement', 'Litière', 'Pelote de laine', 'Griffes', 'Sieste'],
    zoo: ['Girafe', 'Soigneur', 'Enclos', 'Pingouin', 'Lion', 'Grillage', 'Safari'],
  } },
  travail: { label: "L'école et le travail", themes: {
    ecole: ['Cartable', 'Tableau noir', 'Récréation', 'Cantine', 'Dictée', 'Maîtresse', 'Craie'],
    bureau: ['Réunion', 'Ordinateur', 'Machine à café', 'Patron', 'Agrafeuse', 'Open space', 'E-mail'],
    hopital: ['Infirmière', 'Urgences', 'Stéthoscope', 'Brancard', 'Ambulance', 'Pansement', 'Seringue'],
  } },
  art: { label: "L'art", themes: {
    peinture: ['Pinceau', 'Toile', 'Chevalet', 'Palette', 'Musée', 'Aquarelle', 'Portrait'],
    danse: ['Tutu', 'Chorégraphie', 'Pointes', 'Tango', 'Salsa', 'Piste de danse', 'Boîte de nuit'],
    photo: ['Objectif', 'Flash', 'Pellicule', 'Selfie', 'Trépied', 'Album', 'Zoom'],
  } },
  nature: { label: 'La nature', themes: {
    camping: ['Tente', 'Sac de couchage', 'Feu de camp', 'Lampe torche', 'Moustique', 'Guimauve', 'Caravane'],
    desert: ['Dune', 'Chameau', 'Oasis', 'Mirage', 'Cactus', 'Scorpion', 'Sahara'],
    foret: ['Champignon', 'Écureuil', 'Chêne', 'Bûcheron', 'Mousse', 'Cerf', 'Clairière'],
  } },
  tech: { label: 'La technologie', themes: {
    jeuxvideo: ['Manette', 'Console', 'Boss final', 'Sauvegarde', 'Pixel', 'Niveau', 'Joystick'],
    telephone: ['Batterie', 'Écran tactile', 'Sonnerie', 'Chargeur', 'Application', 'SMS', 'Coque'],
    robot: ['Circuit', 'Androïde', 'Intelligence artificielle', 'Engrenage', 'Laser', 'Télécommande', 'Usine'],
  } },
};

// Liste à plat : [{ id, family, familyLabel, words }]
export const THEMES = Object.entries(FAMILIES).flatMap(([fam, f]) =>
  Object.entries(f.themes).map(([id, words]) => ({ id, family: fam, familyLabel: f.label, words })),
);

export const DIFFICULTIES = ['facile', 'normal', 'difficile'];

function pickThemes(count, difficulty, rng) {
  if (count > THEMES.length) throw new Error('Pas assez de thèmes');
  if (difficulty === 'facile') {
    // Un thème par famille tant que possible : les duos sont bien distincts.
    const byFamily = shuffle(Object.keys(FAMILIES), rng).map((fam) =>
      shuffle(THEMES.filter((t) => t.family === fam), rng),
    );
    const out = [];
    let layer = 0;
    while (out.length < count) {
      for (const list of byFamily) {
        if (out.length >= count) break;
        if (list[layer]) out.push(list[layer]);
      }
      layer++;
    }
    return out;
  }
  if (difficulty === 'difficile') {
    // On prend des familles entières : plusieurs duos partagent un univers voisin.
    const out = [];
    for (const fam of shuffle(Object.keys(FAMILIES), rng)) {
      for (const t of shuffle(THEMES.filter((x) => x.family === fam), rng)) {
        if (out.length < count) out.push(t);
      }
      if (out.length >= count) break;
    }
    return out;
  }
  return shuffle(THEMES, rng).slice(0, count);
}

/**
 * Génère les indices d'une partie.
 * @returns {{ duos: {themeId, family, familyLabel, words:[string,string]}[], decoys: {themeId, family, familyLabel, word}[] }}
 */
export function generateClues(duoCount, imposterCount, difficulty = 'normal', rng = Math.random) {
  const themes = pickThemes(duoCount, difficulty, rng);
  const duos = themes.map((t) => {
    const pool = difficulty === 'facile' ? t.words.slice(0, 4) : t.words;
    const [a, b] = shuffle(pool, rng);
    return { themeId: t.id, family: t.family, familyLabel: t.familyLabel, words: [a, b] };
  });
  // Chaque imposteur imite un duo différent (tant que possible).
  const targets = shuffle(duos.map((_, i) => i), rng);
  const decoys = [];
  for (let k = 0; k < imposterCount; k++) {
    const duo = duos[targets[k % targets.length]];
    const theme = THEMES.find((t) => t.id === duo.themeId);
    const used = new Set([...duo.words, ...decoys.map((d) => d.word)].map(normalize));
    const free = theme.words.filter((w) => !used.has(normalize(w)));
    decoys.push({ themeId: duo.themeId, family: duo.family, familyLabel: duo.familyLabel, word: pick(free, rng) });
  }
  return { duos, decoys };
}
