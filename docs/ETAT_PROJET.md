# État du projet Ferrari Manager

Dernière mise à jour : 30/10/2026, intervention 4A (refonte de l'écran Commandes) sur la branche `feat/commandes-cartes`, partie de `feat/statistiques` (intervention 4) ; **les deux en prévisualisation, non fusionnées**.
Ce document décrit ce qui existe **réellement** dans le code de cette branche. La production (`main`) reste à l'état des interventions 3 et 3.1 tant que la fusion n'est pas validée. Les règles ci-dessous sont couvertes par des tests sauf mention contraire.

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

### Intervention 4 en cours de validation (branche `feat/statistiques`)

| Lot | Contenu | État |
| --- | --- | --- |
| B1 | Historique des services, rattachement des commandes (`serviceId`), livraison toujours offerte | Développé, testé, en prévisualisation |
| B2 | Module facultatif Statistiques (service, jour, semaine, mois) | Développé, testé, en prévisualisation |
| B3 | Reprendre un service fermé par erreur | **Non développé** (principe retenu, à faire après validation) |
| B4 | Fermeture avec commandes restantes (« Examiner les commandes ») | **Non développé** (intervention séparée) |

### Intervention 4A en cours de validation (branche `feat/commandes-cartes`)

Refonte de l'écran Commandes pour la tablette en paysage (cartes compactes), **sans changement de règle métier**. Branche créée à partir de `feat/statistiques` (dernière version en prévisualisation) : la fusionner suppose d'avoir validé l'intervention 4, ou de la rebaser sur `main` si l'intervention 4 était refusée.

Prévisualisation : build de la branche, libellé « Prévisualisation · statistiques », mêmes clés isolées `ferrari-manager-apercu-i3:*` (les données de test de l'intervention 3 y sont reprises, ce qui sert aussi de test de compatibilité).

## 2. Fonctionnalités opérationnelles

### Prise de commande (écran principal, 3 colonnes ; onglets sur écran étroit)
- Recherche client par téléphone (partiel) ou par nom (sans accents), recherche globale clients + produits.
- Fiche client : création, modification, doublon de téléphone refusé, notes permanentes, historique des commandes.
- Commande comptoir sans fiche (nom facultatif, à emporter uniquement).
- Catalogue de démonstration (15 pizzas, 11 boissons dont 3 alcoolisées, 4 desserts, 12 suppléments), filtres par famille.
- Personnalisation : ingrédients retirés (sans effet sur le prix), suppléments payants, note de préparation, quantité. Les lignes identiques non personnalisées sont fusionnées.
- Livraison (**toujours offerte, 0 €**, adresse obligatoire) ou à emporter ; heure souhaitée ou « dès que possible ». Aucun réglage de frais ; les anciennes commandes gardent leurs frais figés (ticket compris), une commande modifiée est recalculée à 0 €.
- Validation idempotente (double clic sans doublon) ; modification d'une commande enregistrée (même numéro, révision +1).

### Suivi des commandes (page Commandes)
- Statuts : À préparer → En préparation → Prête → Terminée, ou Annulée (définitif, avec confirmation).
- Cartes compactes (intervention 4A) : deux colonnes sur la tablette en paysage, trois seulement si chaque carte garde 380 px (`components/orders/columns.ts`), une sur écran étroit ; hauteur libre, ordre de traitement lu de gauche à droite (plus anciennes en premier).
- Carte : numéro, heure, statut, ancienneté (commandes en cours, rafraîchie toutes les 30 s) ; client, téléphone, mode, heure souhaitée, adresse complète avec complément et consignes de livraison ; produits avec quantité, personnalisations, suppléments, cadeau « Offert fidélité » et montant de ligne ; note ; total ; paiement.
- Une seule action principale par statut (`primaryAction`) : « Lancer la préparation », « Marquer prête », « Terminer la commande », aucune une fois terminée. « Marquer encaissée » directement sur la carte si non encaissée. « Modifier » (ou « Ticket » quand la commande ne se modifie plus).
- Menu « ••• » (`components/ui/ActionMenu.tsx`, tactile et clavier, sans survol) : Ticket, Corriger le statut (tous les autres statuts du flux, comme l'ancien sélecteur), Annuler l'encaissement, Annuler la commande. Confirmations et avertissements inchangés.
- « En préparation » passe en bleu (au lieu d'orange) pour ne plus se confondre avec « À encaisser ».
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

### Historique des services (socle, intervention 4)
- Chaque ouverture ajoute un service à l'historique (`services`), chaque fermeture le clôture (date d'origine conservée en cas de double fermeture). Tenu dans la même écriture que l'ouverture ou la fermeture.
- Une nouvelle commande reçoit l'identifiant du service en cours (`serviceId`), jamais modifié ensuite (modification, encaissement, annulation, service suivant).
- Commande sans `serviceId` (anciennes données) : rattachée au service ouvert au moment de sa création ; avant le premier service suivi, « Avant le suivi des services ».
- Indépendant du module Statistiques : il continue d'être tenu même module masqué.

### Statistiques (module facultatif, intervention 4)
- Onglet *Statistiques* entre Fidélité et Paramètres. Vues **Service / Jour / Semaine / Mois**, flèches pour remonter l'historique, retour au plus récent. Service clôturé consultable sans le rouvrir ; un nouveau service part de zéro.
- Indicateurs : total encaissé (dominant, avec « avant / après la clôture »), commandes enregistrées et montant total, reste à encaisser, pizzas vendues (payantes, produits offerts à part), panier moyen, boissons, desserts, livraisons, à emporter, annulées.
- Situations signalées à part : encaissements de services précédents, « Paiement non suivi », annulées après encaissement, anciennes commandes avec frais de livraison, bloc « Avant le suivi des services ».
- Graphique SVG maison (sans bibliothèque) : commandes enregistrées et encaissements confirmés par heure, axe continu après minuit, pic d'activité. Tableau équivalent pour les lecteurs d'écran.
- Meilleures ventes : top 5 pizzas, boissons, desserts, par quantité ou montant (hors suppléments), « Voir tout ».
- Avertissement permanent : chiffres indicatifs, ni caisse ni comptabilité certifiée.
- **Module masquable** : Paramètres → Modules facultatifs. Masqué, l'onglet disparaît et `#/statistiques` ramène à la prise de commande ; aucune donnée n'est supprimée ni modifiée. Code isolé dans `src/modules/statistiques/`, chargé à la demande (fichier séparé), en lecture seule.
- Vérifié à l'écran (Chromium) en 1280×800 et 1024×700 avec une semaine fictive de 90 commandes ; **pas encore sur la tablette Samsung**.

### Son d'encaissement
- Joué uniquement sur une vraie transition vers « Encaissée » enregistrée avec succès ; jamais au rechargement, au double clic, au changement de moyen ni à l'annulation d'un encaissement. Un échec audio ne bloque jamais l'encaissement.
- Deux sons au choix, avec un bouton « Écouter » chacun : **Caisse enregistreuse** (`caisse.wav`, son B retenu, **par défaut**) et Notification de vente (`vente.wav`). Réglage Activé/Désactivé, activé par défaut, préférences existantes conservées.
- Fichiers WAV originaux générés par `scripts/generate-sounds.mjs` (synthèse procédurale, aucune source externe, aucune licence tierce). Le rendu a été validé à l'oreille par le gérant ; Claude ne les a jamais écoutés.

## 3. Stockage local et compatibilité

- `localStorage`, deux clés : `ferrari-manager:v1` (historique durable) et `ferrari-manager:v1:panier` (brouillon). Garanties et limites détaillées : `README.md`, section *Persistance locale*.
- `SCHEMA_VERSION = 1`. Les champs ajoutés depuis la V1 sont complétés **à la lecture**, sans réécriture :
  - commande sans bloc paiement : `payment.legacy = true`, affichée « Paiement non suivi ». Ses points historiques sont gelés (ni retirés ni ajoutés sans encaissement ou annulation) ;
  - service sans état : considéré ouvert ;
  - réglages absents : valeurs par défaut (son activé, « caisse », module Statistiques affiché) ; les anciens réglages `awardOn` et `deliveryFee` sont ignorés ;
  - historique des services absent : un service est reconstitué en mémoire à partir de `serviceStartedAt`, avec un identifiant déterministe (`svc-<date d'ouverture>`), sans réécriture ; enregistré à la prochaine ouverture ou fermeture ;
  - historique en retard sur l'état du service (ancienne version utilisée entre-temps) : rattrapé en mémoire.
- Compatibilité vérifiée le 30/10 sur un instantané réel de l'ancienne production : aucune alerte, aucune réécriture au chargement, commandes et points intacts.
- Prévisualisation : clés `ferrari-manager-apercu-i3:*` (variable `VITE_STORAGE_NAMESPACE`), totalement séparées de la production, même origine.
- **Retour à l'ancienne version** possible : elle conserve les champs ajoutés (`services`, `serviceId`) car le dépôt réécrit le document en gardant les champs inconnus. Elle réafficherait toutefois 2 € de frais par défaut (son propre réglage).
- **Limites** : données propres à chaque appareil et à chaque navigateur, sans synchronisation ni sauvegarde ; perdues si le navigateur est vidé ; deux onglets ouverts = le dernier qui écrit gagne.
- **Saturation** : environ 5 Mo par origine, partagés entre la production, la prévisualisation et les autres sites `lupo1313.github.io`. Environ 1,8 Ko par commande, soit environ 93 Ko par service de 50 commandes : saturation vers 55 services (environ 2 mois). Les commandes ne sont jamais supprimées automatiquement ; une écriture refusée bloque l'action avec un message. À traiter avant l'utilisation quotidienne (Priorité 4).

## 4. Tests

165 tests Vitest, tous réussis au 30/10 (branche `feat/commandes-cartes`) :

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
| `services.test.ts` (17) | Historique des services, rattachement, anciennes données sans réécriture, livraison offerte, module masquable |
| `statistiques.test.ts` (22) | Indicateurs, quantités, cadeaux, annulations (dont après encaissement), modifications, encaissements tardifs, minuit, changement d'heure, anciennes données, jour/semaine/mois, lecture seule |
| `commandes-cartes.test.ts` (14) | Action principale par statut, correction de statut, actions secondaires (aucune perdue), encaissement depuis la carte, service fermé, ancienneté, colonnes |

Aucun test d'interface automatisé (Playwright) : l'interface est vérifiée à la main dans le navigateur.

## 5. Bugs connus, limites et éléments absents

- **Non vérifié par Claude** : utilisation réelle sur la tablette Samsung (seulement en émulation 1280×800, 1024×700 et 800×1100) et parcours complet en production après la mise en ligne du 30/10.
- Personnaliser **une seule** pizza parmi plusieurs identiques est impossible : la personnalisation s'applique à toute la ligne (intervention 4B).
- Écran Commandes : vérifié à l'écran (Chromium, 1280×800, 1024×700, 800×1100, 375×812, 1440×900) avec un service fictif ; **pas encore sur la tablette Samsung**. Les consignes permanentes du client (ex. allergie) ne s'affichent que pour les livraisons, comme sur le ticket.
- Pas d'alerte sur les heures de retrait dépassées, pas de statuts propres à la livraison, pas de gestion des livreurs.
- Le ticket n'affiche pas le statut de paiement ; aucune imprimante thermique n'est pilotée.
- Une commande encaissée puis modifiée reste « Encaissée » : un écart de montant se règle hors de l'appli.
- Carte figée dans le code (`src/data/catalog.ts`, prix de démonstration) ; l'entrée « Carte » de la maquette n'existe pas.
- Statistiques : une commande encaissée puis modifiée compte pour son nouveau montant (l'écart réel se règle hors de l'appli) ; le classement par montant ignore les suppléments ; la nuit du changement d'heure, les deux « 2 h » sont regroupées ; un bilan clôturé peut encore évoluer si une commande est encaissée après coup (affiché « après la clôture »).
- Pas d'authentification, pas de rôles, pas de suppression de fiche client (RGPD), pas de sauvegarde.
- Le README contient encore le parcours de validation et les « points à valider » de la V1 : à relire lors d'une future intervention.
- Décisions encore ouvertes : liste définitive des pizzas éligibles ; reprise d'un service fermé par erreur (B3) ; intérêt définitif du module Statistiques (masquable en attendant).
- Avant la fusion de l'intervention 4 : charger un instantané réel des données de la tablette dans un test temporaire (règle CLAUDE.md), non encore fait.
