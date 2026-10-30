# CLAUDE.md · Ferrari Manager

Instructions permanentes pour toute session de travail sur ce dépôt. Les détails vivent ailleurs :
- **État réel** (fonctionnalités, règles métier, tests, branches, bugs) : `docs/ETAT_PROJET.md`
- **Prochaines interventions et décisions en attente** : `docs/ROADMAP.md`
- **Utilisateur / déploiement / garanties de persistance** : `README.md` (en partie ancien, voir ETAT_PROJET section 5)

Lire `docs/ETAT_PROJET.md` avant toute modification, puis vérifier l'état réel du dépôt (`git status`, `git log`, build servi en production) : ne jamais supposer que les références annoncées sont à jour.

## Le produit

Application de **prise de commandes** pour la Pizzeria Ferrari (Marseille), utilisée sur une **tablette Samsung en paysage** (doit rester utilisable sur PC et sur iPhone Safari). Clients, catalogue, panier, suivi des commandes, fidélité, suivi d'encaissement (moyens simples et mixtes), tickets **cuisine** et **livreur**, trajet de livraison en scooter, adresse de livraison ponctuelle, sauvegarde JSON, statistiques indicatives.

**Ce n'est pas une caisse** : aucun paiement réel, terminal, rendu de monnaie, facture ou comptabilité. Ne jamais en ajouter. Le paiement se fait sur la caisse habituelle ; l'application ne fait que suivre ce qui est encaissé. Seule exception validée par le gérant (30/10/2026) : le module facultatif *Statistiques* affiche des totaux **indicatifs** des commandes marquées encaissées, jamais présentés comme une comptabilité certifiée.

**Livraison toujours offerte** (règle définitive) : 0 €, sans exception, aucun réglage (`DELIVERY_FEE` dans `domain/pricing.ts`), quelle que soit la distance. Les anciennes commandes gardent leurs frais figés.

**Version de test** : données fictives, pas d'exploitation commerciale réelle tant que le gérant ne l'a pas décidé. Tablette Samsung (Galaxy TabPro S, Windows 10, Edge) testée manuellement sur les fonctions principales le 31/10, sans validation exhaustive ; impression thermique, restauration d'une sauvegarde, cycle complet de fidélité, coupure de connexion et parcours réel restent à valider (`docs/ETAT_PROJET.md`, section 4). Ne jamais présenter un test manuel partiel comme une validation complète.

## Stack

React 18 + TypeScript strict + Vite 5 + Vitest 2. Aucune autre dépendance d'exécution. CSS maison (pas de framework). Navigation par hash (`#/commandes`), `base: './'` : site 100 % statique hébergé sur GitHub Pages. Pas de backend, pas d'authentification.

## Organisation du code

| Dossier | Rôle |
| --- | --- |
| `src/domain/` | Règles métier en TS pur, **sans React**, testées : `pricing`, `cart`, `customers`, `loyalty`, `payment` (paiement prévu, encaissement détaillé), `orders`, `service` (historique des services), `ticket` (tickets cuisine et livreur), `delivery` (adresse de livraison propre à la commande), `trip` (validité et formats du trajet), `time`, `money`, `types` |
| `src/services/` | Appels réseau, isolés du domaine : `trajet.ts` (géocodage BAN + itinéraire Valhalla `motor_scooter`, constantes du serveur et contact de l'exploitant) |
| `src/state/store.ts` | Store applicatif : orchestre domaine + persistance, actions synchrones renvoyant `Result` |
| `src/storage/` | `schema.ts` (lecture/normalisation des données stockées), `repository.ts` (écritures par opération, `localStorage`), `export.ts` (sauvegarde JSON, lecture seule) |
| `src/data/` | Carte, paramètres par défaut et jeu de démonstration (fictifs) |
| `src/components/`, `src/pages/` | Interface uniquement : ne calcule aucune règle métier |
| `src/modules/statistiques/` | Module **facultatif** (masquable dans Paramètres, chargé à la demande) : calculs purs `calculs.ts` + interface. Lecture seule : n'écrit jamais, n'importe pas le store. Le cœur de l'application ne doit jamais dépendre de ce dossier (sauf le point d'entrée dans `App`) |
| `src/audio/` + `scripts/generate-sounds.mjs` | Sons d'encaissement (WAV originaux générés par le script) |
| `tests/` | Vitest, environnement Node (`tests/node-fs.d.ts` : déclaration minimale de `node:fs`, pas de `@types/node`) |

## Conventions

- Français partout (interface, commentaires, commits, documents). Le gérant préfère éviter les tirets longs dans les textes rédigés.
- Montants en **centimes entiers** ; totaux toujours recalculés depuis les lignes.
- Toute règle métier va dans `src/domain/` (fonction pure) **et** est appliquée par le store, pas seulement par un bouton désactivé. Exception : les calculs propres au module Statistiques restent dans son dossier pour qu'il reste supprimable.
- Les commandes gardent des **copies figées** (client, adresse de livraison effective, prix) : modifier une fiche ne change pas l'historique.
- Fidélité = **journal d'événements** + réconciliation idempotente (`reconcileOrderLoyalty`) : on n'écrit jamais un solde, seulement l'écart. Crédit à l'encaissement confirmé uniquement.
- Conserver la direction artistique (tokens dans `src/styles/tokens.css`), cibles tactiles ≥ 44 px, pas de refonte non demandée. Vérifier à chaque intervention que le panneau Commande tient sans défilement en **1440 px de large** (tablette Samsung réelle : échelle Windows 150 %, Edge maximisé, hauteur estimée 800 à 840 px, à confirmer) et en 1280×800, et que les actions restent accessibles en 844×340 (iPhone paysage) et 390×750.
- Les fichiers du dépôt sont en fins de ligne CRLF (Windows) : un script de remplacement doit les normaliser puis les restaurer. Les heredocs bash contenant des backticks échouent dans cet environnement : écrire les scripts de remplacement dans un fichier `.cjs` du scratchpad.

## Données existantes : précautions impératives

- Clés de production : `ferrari-manager:v1` (historique) et `ferrari-manager:v1:panier`. **Ne jamais les renommer** ni changer `SCHEMA_VERSION` (= 1) sans migration explicite validée.
- Toute nouvelle donnée doit être **facultative**, avoir une **valeur par défaut à la lecture** (`normalizeAppData` ou fonction `as…` du domaine) qui reproduit le comportement précédent, **sans réécrire** le stockage au chargement.
- **Retour arrière** : la version précédente doit pouvoir relire les nouvelles données sans perte. Exemple : `payment.method` reste limité à `especes | carte | non_precise` (une valeur inconnue ferait passer la commande en « Paiement non suivi » dans l'ancienne version, puis serait réécrite) ; le détail va dans des champs facultatifs (`payment.tenders`).
- Ne jamais supposer qu'une ancienne commande est encaissée, ni effacer de données. Les données illisibles ne sont jamais écrasées (seule *Paramètres → Réinitialiser* le peut).
- Écrire d'abord, afficher ensuite : une écriture qui échoue = action refusée.
- **Avant toute fusion touchant aux données** : test temporaire (fichier `tests/zz-*.test.ts`, **jamais commité**, supprimé après usage) qui charge (1) la sauvegarde réelle fournie par le gérant et (2) des données générées avec le code de `main` (worktree détaché dans le scratchpad, script `vite-node`), et compare avec le code de `main` : aucune réécriture, commandes, statistiques, tickets et fidélité identiques. La sauvegarde réelle reste **hors du dépôt** ; si elle n'est plus disponible, la redemander (Paramètres → « Sauvegarder mes données » sur l'appareil réel).
- Aucune vraie donnée client dans le dépôt ni dans les commits.

## Services externes (trajet en scooter)

- Seuls des services **gratuits, sans clé API** dans le code frontend : géocodage Base Adresse Nationale (Géoplateforme IGN, `data.geopf.fr/geocodage`) et itinéraire Valhalla profil `motor_scooter` sur le serveur public **FOSSGIS** `valhalla1.openstreetmap.de` (configurable au build par `VITE_ROUTING_URL`, pour changer de fournisseur sans toucher au code). Aucun service payant ni clé API sans accord du gérant.
- **Conditions FOSSGIS à respecter** (lues sur fossgis.de le 30/10) : attribution « © OpenStreetMap (ODbL) · signaler une erreur » avec liens (sous le résultat du trajet et dans Paramètres), **contact de l'exploitant visible** (`OPERATOR_CONTACT_EMAIL` = `ast.logistiques@gmail.com`, lien mailto sous le trajet et en clair dans Paramètres), **une requête d'itinéraire par seconde au plus** (imposé dans `services/trajet.ts`), une requête à la fois, usage non essentiel / non commercial. Ce contact n'apparaît jamais sur les tickets et n'est jamais envoyé aux services.
- Le trajet est **facultatif** : un échec ne bloque jamais la prise de commande, aucune distance ni durée n'est jamais inventée, les informations de trajet n'apparaissent que sur le ticket livreur.

## Tests et vérifications (obligatoires avant tout commit)

```bash
npm test          # Vitest (268 tests au 30/10/2026)
npm run build     # tsc --noEmit + build de production
```

Ajouter des tests métier pour chaque règle, y compris les tentatives de contournement (double clic, modification, données anciennes ou corrompues). Ne jamais déclarer testé ce qui ne l'a pas été (son jamais écouté, impression jamais sortie sur papier, tablette jamais utilisée). Pour l'interface : vérification dans le navigateur intégré (config `ferrari-manager-demo` du `.claude/launch.json` à la racine du workspace, `vite preview` port 5180 sur `dist/`), données fictives injectées puis effacées ; mesurer par JavaScript plutôt que par captures (souvent indisponibles).

## Déploiement

- **Production** : tout push sur `main` déclenche GitHub Actions (`.github/workflows/deploy-pages.yml` : tests, build, déploiement) → https://lupo1313.github.io/ferrari-manager/. Un simple commit de documentation poussé sur `main` redéploie donc l'application (même build) : ne pas pousser quand on demande de ne rien déployer.
- Après déploiement : attendre le statut **success** du déploiement `github-pages` (il peut rester « queued » plusieurs minutes alors que le site sert déjà le nouveau build), puis vérifier que la production sert le nouveau `assets/index-*.js` et se charge sans erreur. Contrôles en production en lecture seule : ne jamais modifier les données du navigateur.
- **Prévisualisation isolée** : `npm run build:apercu` (clés `ferrari-manager-apercu-i3:*`, libellé dans `.env.apercu`), puis copier `dist-apercu/` dans un clone du dépôt séparé `lupo1313/ferrari-manager-apercu` (scratchpad), commit avec l'identité Git du dépôt principal (`git config user.name` / `user.email`, passées par `-c`), push → https://lupo1313.github.io/ferrari-manager-apercu/
- Le jeton GitHub est celui du gestionnaire d'identifiants Git (`git credential fill`) ; `gh` n'est pas installé (API GitHub publique par `curl` pour suivre les déploiements).

## Règles pour les futures interventions

1. Travailler sur une **branche dédiée** (`feat/…`) ; ne jamais fusionner dans `main` ni déployer en production sans validation explicite du gérant. Fusion en `--no-ff`, message passé par fichier.
2. Faire valider sur la prévisualisation (le gérant teste sur Safari iPhone) avant toute mise en production.
3. Intervention ciblée : pas de fonctionnalité ni de refonte non demandée ; signaler les incertitudes et les décisions métier au lieu d'inventer ; arrêter et expliquer si un contrôle obligatoire échoue.
4. Mettre à jour `docs/ETAT_PROJET.md` (et `docs/ROADMAP.md` si besoin) à la fin de chaque intervention, et après chaque mise en production.
5. Ne pas supprimer les branches ni le dépôt d'aperçu sans accord.
6. Ne pas commencer une nouvelle intervention (intervention 7 et suivantes) sans demande explicite du gérant.
