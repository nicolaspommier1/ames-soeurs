# 💞 Les Âmes Sœurs

Jeu de déduction sociale multijoueur sur navigateur, de 6 à 30 joueurs (idéal 8–30). Chacun joue depuis son téléphone.
Chaque Âme Sœur cache la moitié d'un cœur, un mot ; une seule autre personne détient l'autre moitié. Les imposteurs ont des mots qui y ressemblent et veulent se faire choisir.

- Règles complètes : [`docs/REGLES.md`](docs/REGLES.md)
- Analyse de game design et équilibrage : [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- Captures : [`docs/captures/`](docs/captures/)

## Lancer le jeu

Prérequis : **Node.js 18 ou plus récent**. Rien d'autre : le projet n'a **aucune dépendance**, pas besoin de `npm install`.

```bash
cd ames-soeurs
npm start            # ou : node server/index.js
```

Le terminal affiche les adresses utiles :

```
  💞  LES ÂMES SŒURS — serveur prêt
  Sur cet ordinateur :  http://localhost:3000
  Même Wi-Fi         :  http://192.168.1.42:3000
```

Variables d'environnement : `PORT` (3000 par défaut), `HOST` (0.0.0.0), `PUBLIC_URL` (adresse publique utilisée dans les liens d'invitation et le QR code).

## Rejoindre depuis plusieurs téléphones

Le serveur doit être **joignable par tous les téléphones**. Trois situations :

### 1. Tout le monde sur le même Wi-Fi (le plus simple)
1. Lance `npm start` sur un ordinateur connecté au Wi-Fi de la soirée.
2. Sur cet ordinateur, ouvre `http://localhost:3000` et crée la partie. Le lien d'invitation et le QR code utilisent automatiquement l'adresse réseau locale (`http://192.168.x.x:3000`).
3. Les invités scannent le QR code ou tapent l'adresse puis le code à 4 lettres.

À vérifier si ça ne marche pas :
- Le **pare-feu** de l'ordinateur doit autoriser Node.js sur le port 3000 (Windows le demande au premier lancement : coche « réseaux privés »).
- Certains Wi-Fi publics ou d'entreprise **isolent les appareils** entre eux (« isolation client ») : ça ne marchera pas. Utilise alors le partage de connexion d'un téléphone, ou l'option 2.
- Si l'ordinateur a plusieurs cartes réseau, le terminal liste plusieurs adresses : choisis celle du Wi-Fi et lance avec `PUBLIC_URL=http://<cette-adresse>:3000 npm start` pour que le QR code l'utilise.

### 2. Réseaux différents, sans hébergement : un tunnel
Un tunnel donne une adresse publique HTTPS à ton serveur local :
```bash
npm start
# dans un autre terminal, au choix :
cloudflared tunnel --url http://localhost:3000      # Cloudflare (gratuit, sans compte)
ngrok http 3000                                       # ngrok (compte gratuit)
```
Relance ensuite avec `PUBLIC_URL=https://<adresse-du-tunnel> npm start` pour que le QR code pointe vers le tunnel (les invités peuvent aussi taper l'adresse du tunnel puis le code).

### 3. Hébergement permanent
N'importe quel hébergeur Node.js convient (Render, Railway, Fly.io, un VPS…) :
- commande de démarrage : `node server/index.js` ;
- le serveur lit `PORT` fourni par l'hébergeur ;
- définis `PUBLIC_URL=https://ton-domaine` ;
- **une seule instance** : l'état des parties est en mémoire. Ne pas activer la mise à l'échelle horizontale.
- Derrière un proxy (nginx…), désactive la mise en tampon pour `/api/stream` (le serveur envoie déjà `X-Accel-Buffering: no`).

> Un jeu lancé sur `localhost` n'est **pas** joignable depuis un téléphone sur un autre réseau. Il faut l'une des trois solutions ci-dessus.

## Installer l'appli sur son téléphone (sans store)

Le jeu est une **application web installable** (PWA). Elle s'ajoute à l'écran d'accueil depuis le navigateur, avec sa propre icône, et s'ouvre en plein écran sans barre d'adresse.

- **Android (Chrome, Edge, Samsung Internet)** : un bouton « Installer l'appli sur ce téléphone » apparaît sur l'accueil et dans le salon. Un appui ouvre la fenêtre d'installation du système. Sinon : menu ⋮ → « Installer l'application ».
- **iPhone / iPad (Safari)** : le même bouton affiche le guide : Partager → « Sur l'écran d'accueil » → Ajouter. Apple ne permet pas d'afficher une vraie fenêtre d'installation, c'est donc toujours cette manipulation.
- **Ordinateur (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Une fois installée, l'appli s'ouvre sur l'accueil : on touche « J'ai un code » pour rejoindre une partie. Ta place reste gardée si tu fermes l'appli en cours de partie. Sans réseau, un écran « Pas de connexion » s'affiche avec un bouton Réessayer.

**Condition indispensable : une adresse en https.** Les navigateurs n'installent une vraie appli que depuis une adresse sécurisée (ou `localhost`). Avec l'adresse Wi-Fi locale `http://192.168.x.x:3000`, le jeu reste jouable dans le navigateur, mais Android ne crée qu'un simple raccourci. De plus, l'appli installée est liée à l'adresse depuis laquelle on l'a installée : si cette adresse change (IP locale, tunnel temporaire), il faut la réinstaller. **Pour une appli que tes amis gardent, utilise un hébergement permanent** (option 3 ci-dessus) :

- **Render, en un clic** : envoie le dossier sur un dépôt GitHub, puis sur render.com choisis « New → Blueprint » et sélectionne le dépôt. Le fichier `render.yaml` fait le reste. Tu obtiens `https://ames-soeurs-xxxx.onrender.com`, installable directement. Le QR code utilise automatiquement cette adresse.
- **Docker** (VPS, Fly.io, Railway…) : `docker build -t ames-soeurs . && docker run -p 3000:3000 ames-soeurs`, derrière un proxy https.

Limite de l'offre gratuite de Render : le serveur se met en veille après une quinzaine de minutes sans visite. Le premier chargement prend alors environ une minute, et une veille efface les parties en cours. Une offre payante d'entrée de gamme supprime la veille.

Si tu veux un vrai fichier **.apk** à envoyer à tes amis Android (toujours sans store), [PWABuilder](https://www.pwabuilder.com) le génère gratuitement à partir de l'adresse https du jeu.

## Déroulement côté joueurs
1. Ouvrir le lien (ou scanner le QR code).
2. Saisir un pseudo (aucun compte).
3. Attendre dans le salon que l'hôte lance la partie.
4. Découvrir sa carte secrète.
5. Jouer : discussion → accusations → nuit (si rôles spéciaux) → formation des duos → révélation.

L'hôte (le créateur, transféré automatiquement s'il se déconnecte plus de 20 s) choisit le mode et les paramètres, peut exclure un joueur, passer une phase et relancer une partie avec les mêmes joueurs.

## Architecture

```
server/
  index.js    Serveur HTTP : fichiers statiques, API JSON, flux temps réel (SSE), QR code, nettoyage
  game.js     Moteur autoritaire : machine à états, rôles, actions, résolution, scores, vues filtrées
  config.js   Répartition des rôles, objectif, barème, préréglages des modes, validation des paramètres
  clues.js    Banque de 52 thèmes / 364 mots en 15 familles, génération des duos et des leurres
  qr.js       Encodeur QR code autonome (SVG)
  rng.js      Hasard initialisable (tests reproductibles)
public/       Client mobile-first sans framework (index.html, app.js, style.css)
              + appli installable : manifest.webmanifest, sw.js, offline.html, icons/
test/         Tests automatisés (node:test)
sim/          Simulations d'équilibrage par bots
e2e/          Test de bout en bout avec de vrais navigateurs (Playwright)
```

**Choix techniques.** Le brief suggérait React, TypeScript, Tailwind et Socket.IO. L'environnement de développement n'avait pas d'accès au registre npm. J'ai donc choisi une stack **sans aucune dépendance**, qui a deux avantages pour un jeu de soirée : le serveur démarre sur n'importe quelle machine avec Node, sans installation, et il n'y a rien à mettre à jour. Le temps réel passe par **Server-Sent Events** pour le flux serveur → client (reconnexion automatique native du navigateur, traverse proxys et tunnels) et par des **requêtes POST JSON** pour les actions. Le client est en JavaScript moderne sans étape de compilation. Passer à React ou Socket.IO plus tard ne toucherait pas au moteur `game.js`, qui est indépendant du transport.

**Serveur autoritaire.** Le client n'envoie que des intentions (`vote`, `choose`…). Le serveur valide la phase, les permissions et les cibles, résout tout, puis envoie à chaque joueur **une vue construite pour lui** (`viewFor`). Les mots, rôles et partenaires des autres ne quittent jamais le serveur avant la fin de partie. Des tests vérifient le contenu JSON de chaque vue, à chaque phase et pour chaque taille de partie.

**Ce qui est géré :** validation des entrées (longueur, caractères, JSON, taille), actions impossibles refusées avec un message clair, permissions de l'hôte, pseudos uniques (casse et accents ignorés), reconnexion par jeton stocké sur le téléphone (rechargement ou mise en veille), minuteries synchronisées sur l'horloge du serveur, avance anticipée quand tous les joueurs connectés ont agi (un joueur hors ligne ne bloque jamais la partie), abandon en cours de partie (le duo est dissous, le partenaire devient « orphelin », l'objectif est recalculé), vote unique (le dernier remplace le précédent), limitation de débit, nettoyage des salons (15 min sans connexion ou 6 h d'inactivité), parties simultanées isolées (codes de 4 lettres sans I ni O).

## Tests

```bash
npm test             # 89 tests : règles, confidentialité, pouvoirs, scores, victoire, réseau, déconnexions, fuzzing, simulations
npm run sim          # tableau d'équilibrage complet (16 200 parties simulées en ~15 s)
```

Test de bout en bout avec de vrais navigateurs (optionnel, nécessite Python et Playwright) :
```bash
PORT=3123 npm start &
pip install playwright && playwright install chromium
N=12 MODE=Classique python3 e2e/e2e.py
```

Résultats des tests réellement exécutés : [`docs/tests-resultats.txt`](docs/tests-resultats.txt) et [`docs/simulation-resultats.txt`](docs/simulation-resultats.txt).

## Limites connues
- **État en mémoire** : un redémarrage du serveur efface les parties en cours. Une seule instance serveur.
- **Polices** : les polices (Cormorant Garamond, Figtree) viennent de Google Fonts. Sans Internet, le navigateur utilise des polices système, le jeu reste jouable mais moins élégant.
- **Rejoindre en cours de partie** : impossible, on attend la partie suivante (l'hôte relance en un clic). Un joueur qui recharge sa page reprend sa place.
- **Équilibrage** : calibré par simulation sur un modèle simplifié du comportement humain. Il devra être confirmé par de vraies soirées (voir `docs/GAME_DESIGN.md`).
- **Bluff physique** : le jeu ne peut pas empêcher quelqu'un de montrer son écran. Les règles le rendent seulement contre-productif.
- **Pas d'écran « télé » dédié** : l'hôte joue aussi. Un mode spectateur pour vidéoprojecteur serait une bonne prochaine étape.
- **iOS** : maintenir l'écran allumé (Wake Lock) dépend de la version de Safari. La reconnexion automatique couvre les mises en veille. Sur iPhone, scanner le QR code ouvre Safari et non l'appli installée : dans l'appli, on tape le code.
- **Appli hors ligne** : l'appli s'ouvre sans réseau, mais une partie demande toujours une connexion au serveur.
