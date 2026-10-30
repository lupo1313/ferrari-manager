# CLAUDE.md · Ferrari Manager

Instructions permanentes pour toute session de travail sur ce dépôt. Les détails vivent ailleurs :
- **État réel** (fonctionnalités, règles métier, tests, branches, bugs) : `docs/ETAT_PROJET.md`
- **Prochaines interventions** : `docs/ROADMAP.md`
- **Utilisateur / déploiement / garanties de persistance** : `README.md`

Lire `docs/ETAT_PROJET.md` avant toute modification.

## Le produit

Application de **prise de commandes** pour la Pizzeria Ferrari (Marseille), utilisée sur une **tablette Samsung en paysage** (doit rester utilisable sur PC). Clients, catalogue, panier, suivi des commandes, fidélité, suivi d'encaissement, ticket imprimable.

**Ce n'est pas une caisse** : aucun paiement, terminal, total encaissé, rendu de monnaie, facture ou comptabilité. Ne jamais en ajouter.

## Stack

React 18 + TypeScript strict + Vite 5 + Vitest 2. Aucune autre dépendance d'exécution. CSS maison (pas de framework). Navigation par hash (`#/commandes`), `base: './'` : site 100 % statique. Pas de backend, pas d'authentification (V1 de test, données fictives).

## Organisation du code

| Dossier | Rôle |
| --- | --- |
| `src/domain/` | Règles métier en TS pur, **sans React**, testées : `pricing`, `cart`, `customers`, `loyalty`, `payment`, `orders`, `service`, `ticket`, `types` |
| `src/state/store.ts` | Store applicatif : orchestre domaine + persistance, actions synchrones renvoyant `Result` |
| `src/storage/` | `schema.ts` (lecture/normalisation des données stockées), `repository.ts` (écritures par opération, `localStorage`) |
| `src/data/` | Carte, paramètres par défaut et jeu de démonstration (fictifs) |
| `src/components/`, `src/pages/` | Interface uniquement : ne calcule aucune règle métier |
| `src/audio/` + `scripts/generate-sounds.mjs` | Sons d'encaissement (WAV originaux générés par le script) |
| `tests/` | Vitest, environnement Node |

## Conventions

- Français partout (interface, commentaires, commits, documents). Le gérant préfère éviter les tirets longs dans les textes rédigés.
- Montants en **centimes entiers** ; totaux toujours recalculés depuis les lignes.
- Toute règle métier va dans `src/domain/` (fonction pure) **et** est appliquée par le store, pas seulement par un bouton désactivé.
- Les commandes gardent des **copies figées** (client, prix) : modifier une fiche ne change pas l'historique.
- Fidélité = **journal d'événements** + réconciliation idempotente (`reconcileOrderLoyalty`) : on n'écrit jamais un solde, seulement l'écart.
- Conserver la direction artistique (tokens dans `src/styles/tokens.css`), cibles tactiles ≥ 44 px, pas de refonte non demandée.
- Les fichiers du dépôt sont en fins de ligne CRLF (Windows) : un script de remplacement doit les normaliser puis les restaurer.

## Données existantes : précautions impératives

- Clés de production : `ferrari-manager:v1` (historique) et `ferrari-manager:v1:panier`. **Ne jamais les renommer** ni changer `SCHEMA_VERSION` sans migration explicite validée.
- Toute nouvelle donnée doit avoir une **valeur par défaut à la lecture** (`normalizeAppData`) qui reproduit le comportement précédent, **sans réécrire** le stockage au chargement.
- Ne jamais supposer qu'une ancienne commande est encaissée, ni effacer de données. Les données illisibles ne sont jamais écrasées (seule *Paramètres → Réinitialiser* le peut).
- Écrire d'abord, afficher ensuite : une écriture qui échoue = action refusée.
- Avant un déploiement touchant au schéma : charger dans un test temporaire (non commité) un instantané réel des données de production.

## Tests et vérifications (obligatoires avant tout commit)

```bash
npm test          # Vitest
npm run build     # tsc --noEmit + build de production
```

Ajouter des tests métier pour chaque règle, y compris les tentatives de contournement (double clic, modification, données anciennes ou corrompues). Ne jamais déclarer testé ce qui ne l'a pas été (par exemple un son jamais écouté).

## Déploiement

- **Production** : push sur `main` → GitHub Actions (`.github/workflows/deploy-pages.yml` : tests, build, déploiement) → https://lupo1313.github.io/ferrari-manager/
- **Prévisualisation isolée** : `npm run build:apercu` (clés `ferrari-manager-apercu-i3:*`, libellé « Prévisualisation »), puis copier `dist-apercu/` dans le dépôt séparé `lupo1313/ferrari-manager-apercu` et pousser → https://lupo1313.github.io/ferrari-manager-apercu/
- Après déploiement, vérifier que la production sert le nouveau `assets/index-*.js`.
- Le jeton GitHub est celui du gestionnaire d'identifiants Git (`git credential fill`) ; `gh` n'est pas installé.

## Règles pour les futures interventions

1. Travailler sur une **branche dédiée** ; ne jamais fusionner dans `main` ni déployer en production sans validation explicite du gérant.
2. Faire valider sur la prévisualisation avant toute mise en production.
3. Intervention ciblée : pas de fonctionnalité ni de refonte non demandée ; signaler les incertitudes au lieu d'inventer.
4. Mettre à jour `docs/ETAT_PROJET.md` (et `docs/ROADMAP.md` si besoin) à la fin de chaque intervention.
5. Ne pas supprimer les branches ni le dépôt d'aperçu sans accord.
