# Analyse de game design et équilibrage

## Ce que j'ai changé par rapport au brief initial, et pourquoi

| Point du brief | Problème | Décision |
|---|---|---|
| L'imposteur reçoit « une information partielle ou trompeuse » | Trop vague : sans prise sur les vrais duos, l'imposteur ne peut que deviner. | Il reçoit un **mot leurre tiré du thème d'un vrai duo**. Trois personnes peuvent donc revendiquer « la plage » : c'est le cœur du bluff. |
| Un duo formé avec un imposteur « fait gagner des points au camp adverse » | Si la révélation désigne l'imposteur, il est grillé et le jeu s'arrête pour lui. | Le verdict dit seulement **« Lien brisé »**. La victime sait qu'on lui a menti (ou qu'elle s'est trompée) ; la salle ne sait pas qui ment. Seul le compteur public de cœurs volés trahit qu'un imposteur était dans le lot. |
| Victoire par points | Les points individuels poussent à jouer perso et ne disent pas clairement qui a gagné. | **Victoire d'équipe** par objectif de duos ; points individuels seulement pour le classement. |
| « Pénaliser les mauvais votes sans éliminer » | Une élimination classique laisse des gens sur la touche. | **Personne n'est éliminé.** Imposteur démasqué : il reste à table (vote, intuition, pronostic). Innocent accusé : une seule manche de quarantaine. |
| Duos confirmés « retirés ou capacités limitées » | Les spectateurs s'ennuient. | Ils restent actifs : votes d'accusation, intuition nocturne, **pronostics** (+1). |
| Briseur : « perturber, brouiller, déclencher » | Trois pouvoirs flous, difficiles à expliquer. | Un seul pouvoir, testable : **geler** le lien d'un joueur ciblé. Contre direct : le Protecteur. |
| Voyant : « savoir si un joueur a un partenaire » | Révélerait directement les imposteurs : trop fort. | Il teste deux **autres** joueurs : « vrai duo ou pas ». Utile pour la table, inutile pour trouver son propre partenaire, et il peut mentir sur ce qu'il a vu. |
| Trahison | Risque de rendre absurde la recherche de l'âme sœur. | Dilemme du prisonnier **individuel** : le duo compte toujours pour l'équipe. On ne trahit que son partenaire au classement, jamais son camp. |

## Réponses aux questions du brief

**Comment éviter que les joueurs donnent simplement leur indice exact ?**
On ne l'interdit pas, on le rend risqué. Dire « j'ai Sable » à voix haute, c'est offrir à l'imposteur qui a « Bronzage » la réplique parfaite : « Parasol, c'est moi ! ». Les déclarations écrites refusent son propre mot (le serveur vérifie, accents et casse ignorés). En difficulté « retors », plusieurs duos partagent une même famille (ski, randonnée, hiver), ce qui brouille encore les pistes.

**Comment les imposteurs peuvent-ils réellement tromper ?**
Leur mot appartient vraiment au thème d'un duo. Ils peuvent aussi revendiquer n'importe quel thème entendu dans la salle, orienter les accusations vers des innocents (+1 par quarantaine, et l'innocent perd une manche) et profiter de l'ambiguïté du « lien brisé ».

**Comment empêcher les joueurs de montrer leur carte ?**
Aucun logiciel ne peut l'empêcher physiquement. On rend le geste inutile : montrer sa carte à un inconnu, c'est la montrer peut-être à un imposteur, qui sait ensuite exactement quoi mentir. La carte est masquée par défaut, le mot se floute à nouveau au bout de 5 secondes, et la règle d'or est affichée.

**Comment garder l'intérêt à 30 joueurs ?**
12 duos et 6 imposteurs : le volume rend la recherche dure. Les soupçons et les déclarations publiques structurent le brouhaha. Le passage au vote anticipé coupe les discussions qui tournent en rond. Les joueurs réunis restent actifs (pronostics).

**Comment éviter des discussions trop longues ?**
Minuterie (réglable), bouton « Passer au vote » : dès que tous les joueurs connectés sont prêts, on avance. L'hôte peut toujours passer une phase. Le mode Express tient en 8 minutes environ.

**Comment rendre les rôles utiles sans être trop puissants ?**
Chaque pouvoir agit sur une seule cible par nuit, avec interdiction de répéter la même cible deux nuits de suite pour le Protecteur et le Briseur. Le Voyant ne peut pas se tester lui-même. Le Briseur démasqué perd son pouvoir. Un gel ne fait que reporter un duo, il ne le détruit pas.

**Comment éviter les éliminations frustrantes ?**
Il n'y en a pas (voir plus haut). Le pire sort possible est une manche de quarantaine, pendant laquelle on fait un pronostic.

**Comment équilibrer les deux camps ?**
Avec un objectif d'équipe mobile, calibré par simulation (section suivante). Les imposteurs ne gagnent pas en restant silencieux : sans vol, l'objectif reste bas et les duos se forment. S'ils se cachent trop, rien ne les fait gagner. S'ils bluffent mal, ils se font démasquer et l'objectif baisse.

**Comment créer des retournements sans multiplier les règles ?**
Avec trois ressorts seulement : le lien brisé ambigu (« c'est elle l'imposteur ! » / « non, c'est lui »), l'objectif qui bouge en public après chaque vol ou démasquage, et en Chaos un événement par manche.

## Calibrage par simulation

`node sim/simulate.js` fait jouer des bots sur le **vrai moteur** (mêmes règles, mêmes validations). Le comportement humain est réduit à quatre probabilités :
- `find` : probabilité qu'une Âme Sœur désigne son partenaire (+0,12 par manche) ;
- `bluff` : probabilité qu'un imposteur convainque sa cible ;
- `detect` / `misfire` : issue d'une accusation.

Démarche :
1. Avec l'objectif de départ initial `ceil(0,6 × duos)`, le taux de victoire des Âmes Sœurs variait de 44 % à 76 % selon le nombre de joueurs. La cause : le ratio imposteurs/duos n'est pas constant (16 joueurs = 4 imposteurs pour 6 duos).
2. Pour chaque taille, j'ai mesuré la victoire des Âmes Sœurs à chaque objectif possible. Les valeurs donnant ≈ 55 % s'alignent sur **`duos − imposteurs + 1`**.
3. J'ai aussi supprimé le plafond de l'objectif : sinon, dans les petites parties, un vol de cœur ne changeait plus rien.

Résultat (300 parties par ligne, profil « équilibré ») : **48 % à 60 % de victoires des Âmes Sœurs**, quels que soient la taille (8 à 30) et le mode. Les profils extrêmes donnent le résultat attendu : de bons déducteurs gagnent (≈ 85-90 %), de bons bluffeurs aussi (6-30 % pour les Âmes Sœurs). Le talent compte, ce qui est le but. Le détail est dans [`simulation-resultats.txt`](simulation-resultats.txt).

> ⚠️ Ces chiffres repèrent des déséquilibres grossiers : un camp gagnant toujours, une taille cassée, une partie bloquée. Ils ne prouvent pas l'équilibre réel, qui dépend de la psychologie des joueurs, de la qualité des bluffs et de la dynamique de groupe. Les premières soirées de test diront s'il faut retoucher l'objectif ou les points.

Note : un premier passage donnait un mode Chaos absurde (8 à 28 % de victoires des Âmes Sœurs). L'enquête a montré que le simulateur sautait la phase de formation quand le moteur avait déjà avancé, parce que tout le monde avait joué. Le moteur était correct ; c'est le simulateur qui a été corrigé.
