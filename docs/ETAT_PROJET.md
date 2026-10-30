# État du projet Ferrari Manager

Dernière mise à jour : 30/10/2026, après la mise en production des interventions 3 et 3.1.
Ce document décrit ce qui existe **réellement** dans le code. Les règles ci-dessous sont couvertes par des tests sauf mention contraire.

## 1. En production

| Élément | Valeur |
| --- | --- |
| URL | https://lupo1313.github.io/ferrari-manager/ |
| Commit sur `main` | `24bc9b2` (fusion `--no-ff` de `feat/encaissement-fidelite`) |
| Build servi (vérifié le 30/10) | `assets/index-BSbE7ay4.js` |
| Déploiement | GitHub Actions `deploy-pages.yml` (tests, build, déploiement) à chaque push sur `main` |
| Prévisualisation | https://lupo1313.github.io/ferrari-manager-apercu/ (dépôt séparé `lupo1313/ferrari-manager-apercu`, build de la branche, stockage isolé). Conservée, n'est plus à jour par rapport à `main` après `f5e19aa` (son par défaut). |

Historique des interventions sur `main` :

| Commit | Contenu |
| --- | --- |
| `77e8cd3` | V1 : prise de commandes, suivi, fidélité, tickets |
| `5143965` | Intervention 1 : données locales illisibles jamais écrasées |
| `096915b` | Intervention 2 : persistance par opération, panier dans une clé séparée |
| `9ac4bd1` → `c8ad4ca` | Intervention 3 : encaissement, fidélité à l'encaissement, cadeau avec achat, une récompense par commande, build d'aperçu |
| `0e440ce` → `f5e19aa` | Intervention 3.1 : service ouvert/fermé, sons d'encaissement, son « caisse » par défaut |
| `24bc9b2` | Fusion dans `main` |

Branches distantes conservées : `feat/encaissement-fidelite` (= contenu de `main`), `fix/p0-2-stockage-local`, `refacto/persistance-panier` (anciennes, déjà intégrées).

## 2. Fonctionnalités opérationnelles

### Prise de commande (écran principal, 3 colonnes ; onglets sur écran étroit)
- Recherche client par téléphone (partiel) ou par nom (sans accents), recherche globale clients + produits.
- Fiche client : création, modification, doublon de téléphone refusé, notes permanentes, historique des commandes.
- Commande comptoir sans fiche (nom facultatif, à emporter uniquement).
- Catalogue de démonstration (15 pizzas, 11 boissons dont 3 alcoolisées, 4 desserts, 12 suppléments), filtres par famille.
- Personnalisation : ingrédients retirés (sans effet sur le prix), suppléments payants, note de préparation, quantité. Les lignes identiques non personnalisées sont fusionnées.
- Livraison (frais configurables, 2,00 € par défaut, adresse obligatoire) ou à emporter ; heure souhaitée ou « dès que possible ».
- Validation idempotente (double clic sans doublon) ; modification d'une commande enregistrée (même numéro, révision +1).

### Suivi des commandes (page Commandes)
- Statuts : À préparer → En préparation → Prête → Terminée, ou Annulée (définitif, avec confirmation).
- Filtres : En cours / Terminées et annulées / Archives ; recherche par numéro, nom ou téléphone.
- Ticket : aperçu et impression via la boîte de dialogue du navigateur (58 ou 80 mm). La demande d'impression est tracée, jamais présentée comme une impression réussie.

### Encaissement (suivi uniquement, pas une caisse)
- Statut de paiement **À encaisser / Encaissée**, indépendant de la préparation.
- « Marquer encaissée » puis Espèces / Carte bancaire / Non précisé (moyen facultatif).
- « Annuler l'encaissement » (correction d'erreur, avec confirmation).
- Annuler une commande encaissée : confirmation « remboursement traité hors de Ferrari Manager ».
- Modifier une commande encaissée : confirmation ; elle reste encaissée.

### Fidélité
- 10 pizzas **payantes** = 1 récompense ; progression affichée de 0 à 9 sur 10 (jamais 10/10).
- Pizzas créditées **à l'encaissement uniquement**. Une pizza offerte ne rapporte rien.
- Cadeau au choix : une pizza éligible **ou** une grande bouteille éligible (soda 1,5 L). Jamais d'alcool, de dessert ni de supplément, même si la configuration le permettait par erreur.
- Le cadeau **s'ajoute** à la commande : il ne rend jamais gratuite une pizza déjà choisie. Les suppléments posés sur une pizza offerte restent payants.
- **Au moins une pizza payante** est exigée pour utiliser un cadeau. C'est vérifié à l'ajout, à l'enregistrement, à la modification et à l'encaissement. Si la dernière pizza payante est supprimée : alerte, cadeau conservé, enregistrement bloqué, deux corrections proposées (ajouter une pizza ou retirer le cadeau).
- **Une seule récompense par commande**, même si le client en possède plusieurs ; vérifié aussi en modification.
- Cycle d'une récompense : **réservée** dès l'enregistrement (impossible de la réutiliser dans une autre commande), **consommée** à l'encaissement, **restituée une seule fois** si la commande est annulée, avant ou après paiement.
- Page Fidélité : soldes (pizzas comptées, en attente d'encaissement, disponibles, réservées, utilisées) et journal des événements.
- Pizzas et boissons éligibles réglables dans Paramètres (liste par défaut : Margarita, Reine, Fromage, Napolitaine, Anchois ; Coca, Fanta, Sprite 1,5 L). **Liste définitive du gérant non encore fournie.**

### Service ouvert / fermé
- Voyant vert « Service ouvert / Fermer le service », gris « Service fermé / Ouvrir le service ». État persisté.
- Fermeture : confirmation détaillée, archivage des commandes soldées (terminées **et** encaissées, ou annulées), conservation des commandes en cours et des terminées non encaissées. Aucun nouveau service n'est ouvert automatiquement. Double fermeture sans effet.
- Service fermé : **nouvelle commande refusée par le store** (message et bouton « Ouvrir le service » dans le panier) ; encaissement, modification et annulation des commandes existantes toujours possibles ; fidélité inchangée.
- Numérotation remise à 1 seulement si plus aucune commande n'est affichée.

### Son d'encaissement
- Joué uniquement sur une vraie transition vers « Encaissée » enregistrée avec succès ; jamais au rechargement, au double clic, au changement de moyen ni à l'annulation d'un encaissement. Un échec audio ne bloque jamais l'encaissement.
- Deux sons au choix, avec un bouton « Écouter » chacun : **Caisse enregistreuse** (`caisse.wav`, son B retenu, **par défaut**) et Notification de vente (`vente.wav`). Réglage Activé/Désactivé, activé par défaut, préférences existantes conservées.
- Fichiers WAV originaux générés par `scripts/generate-sounds.mjs` (synthèse procédurale, aucune source externe, aucune licence tierce). Le rendu a été validé à l'oreille par le gérant ; Claude ne les a jamais écoutés.

## 3. Stockage local et compatibilité

- `localStorage`, deux clés : `ferrari-manager:v1` (historique durable) et `ferrari-manager:v1:panier` (brouillon). Garanties et limites détaillées : `README.md`, section *Persistance locale*.
- `SCHEMA_VERSION = 1`. Les champs ajoutés depuis la V1 sont complétés **à la lecture**, sans réécriture :
  - commande sans bloc paiement : `payment.legacy = true`, affichée « Paiement non suivi ». Ses points historiques sont gelés (ni retirés ni ajoutés sans encaissement ou annulation) ;
  - service sans état : considéré ouvert ;
  - réglages absents : valeurs par défaut (son activé, « caisse ») ; l'ancien réglage `awardOn` est ignoré.
- Compatibilité vérifiée le 30/10 sur un instantané réel de l'ancienne production : aucune alerte, aucune réécriture au chargement, commandes et points intacts.
- Prévisualisation : clés `ferrari-manager-apercu-i3:*` (variable `VITE_STORAGE_NAMESPACE`), totalement séparées de la production, même origine.
- **Limites** : données propres à chaque appareil et à chaque navigateur, sans synchronisation ni sauvegarde ; perdues si le navigateur est vidé ; deux onglets ouverts = le dernier qui écrit gagne.

## 4. Tests

112 tests Vitest, tous réussis au 30/10 :

| Fichier | Sujet |
| --- | --- |
| `pricing.test.ts` (9) | Prix, suppléments, fusion de lignes, montants |
| `customers.test.ts` (5) | Téléphone, recherche, doublons |
| `loyalty.test.ts` (14) | Solde, éligibilité, réconciliation (non encaissée, double encaissement, annulation, modification, dette) |
| `payment-loyalty.test.ts` (29) | Les 20 scénarios de l'intervention 3, une seule récompense par commande, anciennes données |
| `service-sound.test.ts` (20) | Service ouvert/fermé, sons (déclenchement, réglages, échecs audio, fichiers WAV) |
| `store.test.ts` (9) | Parcours complet de validation |
| `persistence.test.ts` (12), `storage.test.ts` (10) | Persistance, échecs d'écriture, données corrompues |
| `apercu-isolation.test.ts` (4) | Isolation des clés de la prévisualisation |

Aucun test d'interface automatisé (Playwright) : l'interface est vérifiée à la main dans le navigateur.

## 5. Bugs connus, limites et éléments absents

- **Non vérifié par Claude** : utilisation réelle sur la tablette Samsung (seulement en émulation 1280×800, 1024×700 et 800×1100) et parcours complet en production après la mise en ligne du 30/10.
- Personnaliser **une seule** pizza parmi plusieurs identiques est impossible : la personnalisation s'applique à toute la ligne.
- Pas d'alerte sur les heures de retrait dépassées, pas de statuts propres à la livraison, pas de gestion des livreurs.
- Le ticket n'affiche pas le statut de paiement ; aucune imprimante thermique n'est pilotée.
- Une commande encaissée puis modifiée reste « Encaissée » : un écart de montant se règle hors de l'appli.
- Carte figée dans le code (`src/data/catalog.ts`, prix de démonstration) ; les entrées « Carte » et « Statistiques » de la maquette n'existent pas.
- Pas d'authentification, pas de rôles, pas de suppression de fiche client (RGPD), pas de sauvegarde.
- Le README contient encore le parcours de validation et les « points à valider » de la V1 : à relire lors d'une future intervention.
- Décisions encore ouvertes : liste définitive des pizzas éligibles, frais de livraison réels (le site annonce une livraison gratuite dans certains arrondissements).
