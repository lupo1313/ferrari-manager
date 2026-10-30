# État du projet Ferrari Manager

Dernière mise à jour : 31/10/2026, intégration des tests manuels réalisés sur la tablette Samsung (section 4.2), sans changement de code depuis la mise en production de l'intervention 6 (fusion `c8cf885`). **Aucune intervention en cours** ; la suite est dans `docs/ROADMAP.md`.
Ce document décrit ce qui existe **réellement** dans le code de `main`. Les règles ci-dessous sont couvertes par des tests sauf mention contraire. Version de test : pas encore prête pour une exploitation commerciale complète (voir la section 5).

## 1. En production

| Élément | Valeur |
| --- | --- |
| URL | https://lupo1313.github.io/ferrari-manager/ |
| Commit sur `main` | Code : `c8cf885` (fusion `--no-ff` de `feat/intervention-6-trajets-scooter`), suivi uniquement de commits de documentation |
| Build servi (vérifié le 30/10) | `assets/index-CvFZA6CO.js` (déploiement `github-pages` en succès, 6 modules contrôlés sans erreur JavaScript) |
| Déploiement | GitHub Actions `deploy-pages.yml` (tests, build, déploiement) à chaque push sur `main` |
| Prévisualisation | https://lupo1313.github.io/ferrari-manager-apercu/ (dépôt séparé `lupo1313/ferrari-manager-apercu`, build de la branche, stockage isolé). Conservée ; sert l'intervention 6 au commit `a913a77` (`index-CE0PYSFL.js`), c'est-à-dire **sans** le contact de l'exploitant ajouté ensuite : légèrement en retard sur la production. |

Historique des interventions sur `main` :

| Commit | Contenu |
| --- | --- |
| `77e8cd3` | V1 : prise de commandes, suivi, fidélité, tickets |
| `5143965` | Intervention 1 : données locales illisibles jamais écrasées |
| `096915b` | Intervention 2 : persistance par opération, panier dans une clé séparée |
| `9ac4bd1` → `c8ad4ca` | Intervention 3 : encaissement, fidélité à l'encaissement, cadeau avec achat, une récompense par commande, build d'aperçu |
| `0e440ce` → `f5e19aa` | Intervention 3.1 : service ouvert/fermé, sons d'encaissement, son « caisse » par défaut |
| `24bc9b2` | Fusion dans `main` des interventions 3 et 3.1 |
| `fbaf93b` → `7f9f392` | Sauvegarde des données (Paramètres → « Sauvegarder mes données ») |
| `98df805` → `cb49242` | Interventions 4 (services, livraison offerte, Statistiques), 4A (écran Commandes), 4B (navigation pendant une modification, petits écrans), libellé « Reste à encaisser » |
| `9ff6c85` → `02c62e7` | Intervention 5 : tickets cuisine et livreur, paiement prévu, encaissement détaillé (titres-restaurant, mixte), repères de livraison |
| `c09c075` → `c8cf885` | Intervention 6 : trajet en scooter sur le ticket livreur, adresse de livraison propre à la commande, conformité au serveur public FOSSGIS |

Branches distantes conservées (déjà intégrées) : `feat/intervention-6-trajets-scooter`, `feat/intervention-5-tickets-paiements`, `feat/commandes-cartes`, `feat/statistiques`, `feat/export-donnees`, `feat/encaissement-fidelite`, `fix/p0-2-stockage-local`, `refacto/persistance-panier` (anciennes, déjà intégrées).

### Intervention 4 (en production depuis le 30/10)

| Lot | Contenu | État |
| --- | --- | --- |
| B1 | Historique des services, rattachement des commandes (`serviceId`), livraison toujours offerte | En production |
| B2 | Module facultatif Statistiques (service, jour, semaine, mois) | En production |
| B3 | Reprendre un service fermé par erreur | **Non développé** (principe retenu, à faire après validation) |
| B4 | Fermeture avec commandes restantes (« Examiner les commandes ») | **Non développé** (intervention séparée) |

### Intervention 4A (en production depuis le 30/10)

Refonte de l'écran Commandes pour la tablette en paysage (cartes compactes), **sans changement de règle métier**.

Prévisualisation : build de la branche, libellé « Prévisualisation · statistiques », mêmes clés isolées `ferrari-manager-apercu-i3:*` (les données de test de l'intervention 3 y sont reprises, ce qui sert aussi de test de compatibilité).

### Intervention 4B (en production depuis le 30/10)

Deux problèmes relevés sur Safari iPhone, corrigés sans changer les règles de récompense, d'archivage, de paiement ni le stockage :
- **Changement de client pendant une modification** : « Commander » depuis la page Clients (ou un client de la recherche globale) remplaçait en silence le client de la commande en cours de modification, panier et mode « Modification n° X » conservés. Désormais une commande en modification reste rattachée à son client d'origine (règle `canChangeCartCustomer` dans `domain/orders.ts`, appliquée par le store : sélection, retrait du client, nouvelle fiche). « Commander » pendant une modification ouvre une fenêtre (`EditInProgressDialog`) : continuer la modification, abandonner et commander pour ce client (désactivé si le service est fermé, avec le message), ou annuler. Abandonner ne touche jamais la commande enregistrée (seul le panier est remplacé). Pendant la modification, la colonne Client n'affiche plus la recherche ni « Nouveau client » ; le bandeau de modification a un bouton « Quitter » et le bouton « Annuler » du panier devient « Abandonner ».
- **« Enregistrer » inaccessible sur iPhone en paysage** : le panneau Commande avait une hauteur fixe (`overflow: hidden`), seule la liste des produits défilait, avec une hauteur minimale de 120 px ; sur un écran d'environ 340 px de haut, le récapitulatif et les boutons sortaient du panneau sans pouvoir être atteints. Désormais le panneau défile s'il déborde, et sur un écran peu haut (`max-height: 560px`) tout le panneau défile d'un bloc avec les actions collées en bas (une seule ligne en pleine largeur). L'application évite aussi l'encoche et la barre d'accueil de l'iPhone (`viewport-fit=cover` était déjà actif sans marges de sécurité). Sans effet sur la tablette en 1280×800 (vérifié : aucun défilement du panneau, actions inchangées).
- Vérifié dans Chromium en émulation 844×340 (iPhone paysage), 375×660, 1024×700 et 1280×800, puis validé par le gérant sur un vrai iPhone avec Safari (prévisualisation). En 1024×700, une commande en modification dépasse légèrement : le panneau défile pour atteindre « Enregistrer sans imprimer ».

### Intervention 5 (en production depuis le 30/10)

- **Deux tickets** (`domain/ticket.ts`, `components/ticket/`) : *cuisine* (numéro et mode en gros, heure demandée, produits groupés pizzas / desserts / boissons, personnalisations en puces, notes, nombre de pizzas ; ni téléphone, ni adresse, ni prix, ni paiement ; nom du client seul) et *livreur* (livraisons uniquement : nom, téléphone, adresse, repères renseignés seulement, consignes, contenu du sac, total, bloc paiement encadré). À emporter : 1 ticket ; livraison : 2.
- **Impression** : après « Valider et imprimer », la commande est déjà enregistrée ; une fenêtre propose « Imprimer les deux » (une seule boîte de dialogue, un ticket par page), « Cuisine », « Livreur » ou « Terminer sans imprimer ». Même fenêtre depuis la carte (menu « ••• » → « Tickets cuisine et livreur » ou « Ticket cuisine »). Imprimer ne modifie que la trace `printRequests`. Aucune impression silencieuse : le navigateur demande toujours une confirmation.
- **Bloc paiement du livreur** : « COMMANDE DÉJÀ PAYÉE » + reste 0,00 € + détail payé ; ou « À ENCAISSER : X € » + « Mode prévu » (et « Non affecté ») ; ou « MODE DE PAIEMENT À CONFIRMER » ; « PAIEMENT NON SUIVI » pour les anciennes commandes ; écart signalé si une commande encaissée a été modifiée. Un paiement prévu n'est jamais présenté comme effectué.
- **Paiement prévu** (`paymentPlan`, intention du client) : dans le panier (bouton « Paiement prévu » à côté de l'heure) et depuis la carte (« Paiement prévu… ») ; moyen unique (suit le total) ou mixte (incomplet autorisé, supérieur au total refusé). Sans effet sur le statut de paiement, la fidélité ou les statistiques.
- **Encaissement confirmé** : Espèces, Carte bancaire, Titres-restaurant en un appui (montant = total), « Paiement mixte… » (montants par moyen, bouton « Reste », confirmation seulement si la somme égale le total), « Non précisé ». Détail enregistré dans `payment.tenders` ; **tout ou rien** (pas d'encaissement partiel, pas de rendu de monnaie). Fidélité, annulations et statistiques inchangées.
- **Compatibilité** : `payment.method` garde ses trois valeurs (espèces, carte, non précisé), seules relues par la version précédente (une valeur inconnue y ferait passer la commande en « Paiement non suivi », puis serait réécrite) ; titres-restaurant et mixte y sont résumés par « non_precise », le détail est dans `tenders`.
- **Fiche client** : bâtiment, étage, interphone, digicode (facultatifs), à côté du complément ; complétés à vide en mémoire pour les anciennes fiches, sans réécriture. Le texte existant du complément n'est pas découpé.
- Vérifié dans Chromium (1280×800, 844×340, 390×750, 1440×900), sur la sauvegarde réelle de l'iPhone et sur des données au format de la production `752d3f3` (tests temporaires : aucune réécriture, statistiques et fidélité identiques), puis validé par le gérant sur Safari iPhone (prévisualisation). Sur la tablette Samsung : aperçu des tickets et impression vers Microsoft Print to PDF réussis (section 4.2). **Impression thermique réelle, paiement mixte et titres-restaurant sur la tablette non vérifiés.**
- Décisions par défaut (réversibles) : pas d'encaissement partiel ; montant supérieur au total refusé (pas de rendu de monnaie) ; commande encaissée puis modifiée = reste encaissée, écart affiché ; consignes client sur le ticket livreur seulement ; pas de statistiques par moyen de paiement.

### Intervention 6 (en production depuis le 30/10)

- **But** : distance routière et durée estimée **en scooter** de la pizzeria à l'adresse du client, imprimées **uniquement sur le ticket livreur** (« TRAJET EN SCOOTER · DISTANCE · DURÉE ESTIMÉE », mention « Estimation sans trafic · données © OpenStreetMap »). Ticket cuisine inchangé. Livraison toujours offerte (ligne « Livraison offerte » ajoutée au ticket livreur).
- **Calcul** (`services/trajet.ts`) : géocodage par la Base Adresse Nationale (Géoplateforme IGN, `data.geopf.fr/geocodage`, service public gratuit, sans clé ; filtre sur le code postal ; correspondance refusée sous un score de 0,5 ; rue seule acceptée et signalée « numéro non trouvé ») puis itinéraire **Valhalla, profil `motor_scooter`** (deux-roues motorisé, vitesse plafonnée à 45 km/h, voies interdites aux cyclomoteurs évitées). Départ : adresse de la pizzeria des Paramètres (« 178 rue Ferrari, 13005 Marseille »), géocodée puis mémorisée pendant la session. Aucune clé API dans le code ; serveur Valhalla configurable au build (`VITE_ROUTING_URL`), par défaut le serveur public FOSSGIS `valhalla1.openstreetmap.de`.
- **Interface** : sous l'adresse de livraison du panier, « Calculer le trajet » (états « Calcul… », résultat « Scooter : 2,2 km · 13 min », « Recalculer », message d'erreur court + « Trajet facultatif »). Jamais bloquant : adresse incomplète ou introuvable, service indisponible, quota, hors ligne → message, commande enregistrable, ticket sans trajet. Aucune valeur inventée.
- **Données** : `cart.deliveryTrip` et `order.deliveryTrip` (distance en mètres, durée en secondes, clé de l'adresse utilisée, adresse reconnue, date, source). Le trajet n'est utilisé que si la commande est une livraison **et** que la clé correspond à l'adresse copiée sur la commande : adresse modifiée → trajet caduc (jamais réimprimé), recalcul possible ; passage à emporter → aucun trajet. Champ facultatif, absent des anciennes commandes, sans réécriture au chargement ; inclus dans la sauvegarde JSON.
- Vérifié en réel dans Chromium (calcul effectif depuis l'aperçu local, adresse introuvable, impression), 1280×800, 844×340, 390×750, et sur la sauvegarde réelle de l'iPhone (test temporaire). Validé par le gérant sur Safari iPhone (prévisualisation) ; compatibilité vérifiée avant fusion sur la sauvegarde réelle et sur des données au format de la production `de88a7c` (commandes, statistiques et tickets identiques). Décisions : profil `motor_scooter` sans distinction 50/125 cm³ ; serveur public FOSSGIS conservé pour la version de test. **Trajet et adresse ponctuelle non testés sur la tablette Samsung ; impression thermique non vérifiée.**
- **Adresse de livraison propre à la commande** (correctif du 30/10, `domain/delivery.ts`) : sous « Livraison », l'adresse effective est affichée avec « Modifier l'adresse » (formulaire dédié : adresse, code postal, ville, bâtiment, étage, interphone, digicode, complément, consignes de cette livraison ; mêmes contrôles que la fiche, **fiche client jamais modifiée**). Une adresse ponctuelle est signalée (« Adresse ponctuelle ») avec « Utiliser l'adresse habituelle ». Nouvelle adresse ponctuelle = formulaire vierge (aucun repère ni consigne du domicile repris par erreur) ; adresse ponctuelle déjà saisie = reprise pour correction. Saisir exactement l'adresse habituelle revient à l'adresse habituelle.
  - Modèle : `cart.deliveryAddress` (null = adresse habituelle) ; sur la commande, la copie client (`order.customer`) porte l'adresse et les consignes effectives, plus `addressOverridden: true` si ponctuelle. Aucun nouveau champ de commande : tickets, historique et anciennes versions lisent l'adresse au même endroit.
  - Trajet : calculé et validé sur l'adresse effective ; changement de rue, code postal ou ville = trajet retiré immédiatement (digicode, étage ou consignes seuls : trajet conservé, même itinéraire).
  - Commande rouverte : l'adresse réellement enregistrée est reprise (adresse ponctuelle si elle diffère de la fiche actuelle) ; abandon = commande inchangée. Changement de client : adresse ponctuelle et trajet remis à zéro (message) ; nouvelle commande : adresse habituelle.
  - Liste des produits du panneau : hauteur minimale 90 px (au lieu de 120) pour que l'adresse ponctuelle tienne sur la tablette 1280×800 sans défilement.
- **Conditions du serveur public FOSSGIS** (vérifiées le 30/10 sur fossgis.de) : attribution « © OpenStreetMap (ODbL) · signaler une erreur » avec les trois liens sous le résultat, et « données © contributeurs OpenStreetMap (ODbL) » sur le ticket ; au plus une requête d'itinéraire par seconde (espacement imposé dans `services/trajet.ts`) ; une requête à la fois ; User-Agent et Referer envoyés par le navigateur. Contact technique de l'exploitant (exigé) : `ast.logistiques@gmail.com`, lien « contact » (mailto) dans la mention sous le trajet et adresse en clair dans Paramètres → « Calcul des trajets de livraison » (avec la mention complète OpenStreetMap / FOSSGIS / BAN) ; jamais sur les tickets ni envoyée aux services ; usage commercial autorisé seulement si le service n'est pas une partie essentielle de l'offre.
- **Limites** : estimation sans trafic en temps réel ; vitesses urbaines du modèle prudentes (2,2 km ≈ 13 min en centre-ville, proche de la voiture) ; profil cyclomoteur 45 km/h (un 125 cm³ va plus vite) ; serveur public FOSSGIS sans garantie de disponibilité, 1 requête/s.

### Intervention 7 · barre latérale rétractable (branche `feat/intervention-7-barre-laterale`, NON fusionnée, NON déployée)

Navigation et mise en page uniquement : aucun fichier du domaine, du store ni du stockage métier modifié.
- **Barre latérale** : ouverte (176 px, logo, libellés) ou réduite (72 px, monogramme au cercle doré, icônes seules ; chaque entrée garde son nom accessible, info-bulle et badge des commandes actives). Un bouton unique en bas de la barre (« Réduire le menu » / « Déplier le menu », `aria-expanded`, `aria-controls`), collé en bas même quand la barre défile. Fenêtre de moins de 900 px : toujours réduite, sans bouton (iPhone : 72 px au lieu de 68). Pas d'animation de largeur.
- **Préférence** : clé `ferrari-manager-interface` (prévisualisation : `ferrari-manager-apercu-i3-interface`), **hors** du préfixe `ferrari-manager:` : jamais dans la sauvegarde JSON, jamais touchée par une restauration des deux clés métier ni par « Réinitialiser ». Valeur `{"v":1,"barreLaterale":"ouverte"|"reduite"}`, écrite seulement par le bouton ; illisible = valeur par défaut sans réécriture ; stockage refusé = choix gardé en mémoire. Sans préférence : ouverte à partir de 1400 px de fenêtre, réduite en dessous (`storage/interface.ts`).
- **Repli automatique** : quand le client de la commande change pour un client (liste, recherche, « Commander » depuis Clients, fiche créée ou retrouvée, « Abandonner et commander »), hors ouverture d'une commande à modifier, retrait du client, rechargement. Temporaire, jamais enregistré : la barre reste réduite jusqu'à un appui sur le bouton ou un rechargement (préférence). Il peut faire passer des onglets aux trois colonnes (décision du gérant). Le focus n'est jamais déplacé par la barre.
- **Disposition selon la place réellement disponible** (`components/layout/disposition.ts`, largeur de `<main>` mesurée par `ResizeObserver` et à chaque redimensionnement, attribut `data-disposition` sur `.app`) : trois colonnes si la Carte garde au moins deux cartes produit par ligne (marges, bordures et barre de défilement comprises), sinon Client et Carte en onglets avec la Commande visible (≥ 870 px disponibles), sinon trois onglets. Colonnes Client et Commande fixées par la largeur de la **fenêtre** (300/380 à partir de 1400 px, 268/340 en dessous, Commande aussi à 340 en onglets) : replier ou déplier ne change jamais la largeur du panier, seule la Carte s'élargit. Les trois colonnes restent toujours dans la page (masquées en onglets) : aucune saisie perdue.
- **Actions du panier collées en bas du panneau** dès qu'un panier long le fait défiler (auparavant seulement sous 560 px de haut ; en 960×700 et 1024×700, « Enregistrer » sortait de l'écran).
- **Mesures (Chromium, 1440×830)** : barre ouverte = Client 300 / Carte 528 / Commande 380 ; réduite = 300 / 632 / 380 ; deux cartes produit par ligne dans les deux états (trois ne tiendraient pas sans les comprimer). 1180×800 : onglets barre ouverte, trois colonnes barre réduite (Carte 444), panier 340 dans les deux cas. 1280×800 : onglets ouverte, trois colonnes réduite. 1080, 1024 et 960×700 : onglets Client/Carte. 844×340 et 390×750 : trois onglets, barre forcée, actions visibles.
- **Prévisualisation** : libellé « Prévisualisation · intervention 7 (barre latérale) » et indicateur discret en bas de la barre (largeur × hauteur réelles de la fenêtre en px CSS, densité d'écran), uniquement si `VITE_VIEWPORT_INDICATOR=1` (`.env.apercu`) ; absent du build de production.
- Vérifié dans Chromium (navigateur intégré, données fictives, mesures par JavaScript) : transitions réelles ouverte/réduite et onglets/trois colonnes, repli automatique à 1440 et 1180 px (note, panier, client et onglet actif conservés), réouverture manuelle, clavier (Entrée, Espace, focus conservé sur le bouton), mode modification (crayon, libellé), six pages sans débordement, faible hauteur (1180×500), aucune erreur console. **Non vérifié sur la tablette Samsung ni sur Safari iPhone.**

## 2. Fonctionnalités opérationnelles

### Prise de commande (écran principal, 3 colonnes ; onglets sur écran étroit)
- Recherche client par téléphone (partiel) ou par nom (sans accents), recherche globale clients + produits.
- Fiche client : création, modification, doublon de téléphone refusé, repères de livraison facultatifs (bâtiment, étage, interphone, digicode, complément), notes permanentes, historique des commandes.
- Commande comptoir sans fiche (nom facultatif, à emporter uniquement).
- Catalogue de démonstration (15 pizzas, 11 boissons dont 3 alcoolisées, 4 desserts, 12 suppléments), filtres par famille.
- Personnalisation : ingrédients retirés (sans effet sur le prix), suppléments payants, note de préparation, quantité. Les lignes identiques non personnalisées sont fusionnées.
- Livraison (**toujours offerte, 0 €**, adresse obligatoire) ou à emporter ; heure souhaitée ou « dès que possible ». Aucun réglage de frais ; les anciennes commandes gardent leurs frais figés (ticket compris), une commande modifiée est recalculée à 0 €.
- Livraison : adresse habituelle du client par défaut, ou **adresse ponctuelle** pour cette seule commande (« Modifier l'adresse », fiche client jamais modifiée, voir intervention 6) ; **trajet en scooter** facultatif (« Calculer le trajet ») imprimé sur le ticket livreur.
- **Paiement prévu** facultatif (à côté de l'heure souhaitée) : moyen unique ou mixte, simple information pour la cuisine et le livreur (voir intervention 5).
- Validation idempotente (double clic sans doublon) ; modification d'une commande enregistrée (même numéro, révision +1) ; pendant une modification, le client reste celui de la commande (intervention 4B).
- « Valider et imprimer » enregistre d'abord la commande, puis propose les tickets ; « Enregistrer sans imprimer » ne propose rien.

### Suivi des commandes (page Commandes)
- Statuts : À préparer → En préparation → Prête → Terminée, ou Annulée (définitif, avec confirmation).
- Cartes compactes (intervention 4A) : deux colonnes sur la tablette en paysage, trois seulement si chaque carte garde 380 px (`components/orders/columns.ts`), une sur écran étroit ; hauteur libre, ordre de traitement lu de gauche à droite (plus anciennes en premier).
- Carte : numéro, heure, statut, ancienneté (commandes en cours, rafraîchie toutes les 30 s) ; client, téléphone, mode, heure souhaitée, adresse complète avec complément et consignes de livraison ; produits avec quantité, personnalisations, suppléments, cadeau « Offert fidélité » et montant de ligne ; note ; total ; paiement.
- Une seule action principale par statut (`primaryAction`) : « Lancer la préparation », « Marquer prête », « Terminer la commande », aucune une fois terminée. « Marquer encaissée » directement sur la carte si non encaissée. « Modifier » (ou « Ticket » quand la commande ne se modifie plus). Paiement prévu (« Prévu : … ») et détail de l'encaissement (« Encaissée · Espèces 10,00 € + Carte bancaire 14,00 € ») affichés sur la carte ; écart signalé si une commande encaissée a été modifiée.
- Menu « ••• » (`components/ui/ActionMenu.tsx`, tactile et clavier, sans survol, liste simple sans sous-menu) : « Tickets cuisine et livreur » (ou « Ticket cuisine » à emporter), « Paiement prévu… », « Corriger le statut… », « Annuler l'encaissement », « Annuler la commande » (selon l'état de la commande). Confirmations et avertissements inchangés. Le menu ne se ferme jamais sur une simple perte de focus (correctif Safari, voir ci-dessous).
- **Corriger le statut** ouvre une petite fenêtre (`StatusDialog`) qui affiche les quatre statuts, le statut actuel signalé ; un appui applique le statut choisi (mêmes transitions qu'avant, ex. Terminée → En préparation). Seuls le statut et son historique changent ; un message indique l'onglet où retrouver la commande.
- Correctif Safari (30/10/2026) : sur Safari (macOS, iPad), « Corriger le statut » d'une commande terminée ne faisait rien. Cause : le menu se fermait sur toute perte de focus sans cible ; Safari en produit une quand on touche un bouton (il ne lui donne pas le focus) et quand l'élément qui a le focus disparaît (ici le premier élément du menu, remplacé par le sous-menu). Le sous-menu a été remplacé par la fenêtre ci-dessus et la fermeture sur perte de focus supprimée. Vérifié dans Chromium en rejouant la séquence d'événements de Safari ; le menu a ensuite été utilisé par le gérant sur Safari iPhone (réimpression des tickets, intervention 5), la correction de statut elle-même n'a pas été revérifiée explicitement sur Safari.
- « En préparation » passe en bleu (au lieu d'orange) pour ne plus se confondre avec « À encaisser ».
- Filtres : En cours / Terminées et annulées / Archives ; recherche par numéro, nom ou téléphone.
- Tickets cuisine et livreur : aperçu et impression via la boîte de dialogue du navigateur (largeur 58 ou 80 mm, réglage Paramètres). La demande d'impression est tracée (`printRequests`), jamais présentée comme une impression réussie ; réimprimer ne modifie rien d'autre.

### Encaissement (suivi uniquement, pas une caisse)
- Statut de paiement **À encaisser / Encaissée**, indépendant de la préparation.
- « Marquer encaissée » puis Espèces / Carte bancaire / Titres-restaurant / Paiement mixte / Non précisé (intervention 5, voir ci-dessus).
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
- Situations signalées à part : encaissements de services précédents, « Paiement non suivi », annulées après encaissement, anciennes commandes avec frais de livraison, bloc « Avant le suivi des services ». Sous « Reste à encaisser », le libellé distingue les commandes en attente de paiement et les anciennes au paiement non suivi ; « Tout est encaissé » n’apparaît que si toutes les commandes le sont (`dueHint`).
- Graphique SVG maison (sans bibliothèque) : commandes enregistrées et encaissements confirmés par heure, axe continu après minuit, pic d'activité. Tableau équivalent pour les lecteurs d'écran.
- Meilleures ventes : top 5 pizzas, boissons, desserts, par quantité ou montant (hors suppléments), « Voir tout ».
- Avertissement permanent : chiffres indicatifs, ni caisse ni comptabilité certifiée.
- **Module masquable** : Paramètres → Modules facultatifs. Masqué, l'onglet disparaît et `#/statistiques` ramène à la prise de commande ; aucune donnée n'est supprimée ni modifiée. Code isolé dans `src/modules/statistiques/`, chargé à la demande (fichier séparé), en lecture seule.
- Vérifié à l'écran (Chromium) en 1280×800 et 1024×700 avec une semaine fictive de 90 commandes ; consulté sur la tablette Samsung par le gérant (vue service, test manuel, section 4.2).

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
  - historique en retard sur l'état du service (ancienne version utilisée entre-temps) : rattrapé en mémoire ;
  - fiches sans repères de livraison (intervention 5) : bâtiment, étage, interphone, digicode vides, en mémoire seulement ;
  - panier sans paiement prévu, trajet ni adresse ponctuelle : `null` ; commandes sans `paymentPlan`, `deliveryTrip`, `payment.tenders` ni `customer.addressOverridden` : lues comme avant (champs facultatifs, jamais ajoutés au chargement).
- Compatibilité vérifiée le 30/10 avant chaque fusion (interventions 4, 5 et 6) par des tests temporaires non commités : sauvegarde réelle de l'iPhone (format d'avant l'intervention 3) et données générées avec le code de la production précédente (`752d3f3`, puis `de88a7c`) ; aucune alerte, aucune réécriture au chargement, commandes, fidélité, statistiques et tickets identiques à l'ancienne version. La sauvegarde réelle est conservée **hors du dépôt** (dossier temporaire de la session) : à redemander au gérant si nécessaire.
- Prévisualisation : clés `ferrari-manager-apercu-i3:*` (variable `VITE_STORAGE_NAMESPACE`), totalement séparées de la production, même origine.
- **Retour à l'ancienne version** possible : elle conserve les champs ajoutés (`services`, `serviceId`) car le dépôt réécrit le document en gardant les champs inconnus. Elle réafficherait toutefois 2 € de frais par défaut (son propre réglage).
- **Sauvegarde** (Paramètres → « Sauvegarder mes données », `src/storage/export.ts`) : fichier JSON nommé avec la date et l'heure, contenant le texte exact de chaque clé `ferrari-manager:*` (historique et panier), la longueur et l'empreinte SHA-256 de chacune, et un résumé (commandes, encaissées, clients, fidélité, prochain numéro, état du service). Lecture seule : aucune écriture ni suppression. Le fichier est vérifié avant d'être proposé (empreintes, résumé, identité avec le stockage), puis téléchargé par un appui sur « Télécharger le fichier » (ou « Partager » si le navigateur le permet). Pas de fonction d'import à ce stade : une restauration consisterait à remettre ces textes dans les deux clés.
- **Limites** : données propres à chaque appareil et à chaque navigateur, sans synchronisation ; perdues si le navigateur est vidé (sauf sauvegarde manuelle) ; deux onglets ouverts = le dernier qui écrit gagne.
- **Saturation** : environ 5 Mo par origine, partagés entre la production, la prévisualisation et les autres sites `lupo1313.github.io`. Environ 1,8 Ko par commande, soit environ 93 Ko par service de 50 commandes : saturation vers 55 services (environ 2 mois). Les commandes ne sont jamais supprimées automatiquement ; une écriture refusée bloque l'action avec un message. À traiter avant l'utilisation quotidienne (Priorité 4).

## 4. Tests

Trois niveaux à ne pas confondre : tests automatisés (4.1), tests manuels réalisés avec le gérant sur l'appareil réel (4.2), vérifications encore à faire (4.3). Un test manuel réussi ne vaut pas validation exhaustive de tous les scénarios.

### 4.1 Tests automatisés

268 tests Vitest sur `main`, tous réussis au 30/10 ; 300 sur la branche de l'intervention 7 (31/10) :

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
| `statistiques.test.ts` (26) | Indicateurs, libellé « Reste à encaisser » (encaissées, en attente, non suivies), quantités, cadeaux, annulations (dont après encaissement), modifications, encaissements tardifs, minuit, changement d'heure, anciennes données, jour/semaine/mois, lecture seule |
| `modification-navigation.test.ts` (10) | Intervention 4B : client verrouillé pendant une modification (tous les chemins), annulation, abandon sans toucher la commande enregistrée, service fermé, commande encaissée modifiée service fermé, fidélité sans double crédit, contrat CSS des actions sur petit écran |
| `commandes-cartes.test.ts` (19) | Action principale par statut, correction de statut (dont Terminée → En préparation : paiement, fidélité, produits préservés, retour dans « En cours »), actions secondaires (aucune perdue), encaissement depuis la carte, service fermé, ancienneté, colonnes |
| `tickets-paiements.test.ts` (33) | Intervention 5 : tickets cuisine et livreur (repères, champs absents, notes, personnalisations, payé, à encaisser, mode à confirmer, non affecté, anciennes commandes, frais historiques), réimpression sans modification, pas de doublon, espèces / carte / titres / mixte, montants incohérents, centimes, correction, modification et annulation d'une commande encaissée, fidélité sans double crédit, paiement prévu, service fermé, compatibilité (`method`, anciennes données, sauvegarde, clés, statistiques) |
| `trajets.test.ts` (19) | Intervention 6 : profil motor_scooter (jamais voiture), une requête par seconde au plus, contact de l'exploitant jamais envoyé ni imprimé, formats, adresse introuvable / incertaine / incomplète, service indisponible, coupure, quota, aucun itinéraire, hors ligne, commande enregistrable sans trajet, ticket livreur avec trajet et ticket cuisine sans, réimpression et rechargement, modification d'adresse (trajet caduc), calcul terminé après changement de client ou de mode, passage à emporter, anciennes commandes, aucun impact paiement / fidélité / statistiques, sauvegarde |
| `adresse-livraison.test.ts` (19) | Adresse de livraison propre à la commande : adresse habituelle, adresse exceptionnelle, fiche inchangée, rechargement, ticket livreur (repères et consignes de la livraison, jamais ceux du domicile), formulaire vierge, trajet recalculé et ancien trajet invalidé, retour à l'adresse habituelle, commande existante, abandon, changement de client, nouvelle commande, commandes historiques, ticket cuisine, paiement / fidélité / statistiques, sauvegarde |
| `sauvegarde.test.ts` (13) | Export à l'identique, aucune écriture (stockage espion), restauration possible, intégrité (fichier tronqué, modifié, résumé falsifié), données illisibles |
| `barre-laterale.test.ts` (32, branche de l'intervention 7) | Dispositions de 390 à 1920 px, seuils exacts, panier de largeur identique dans les deux états, deux cartes produit minimum, repli automatique avec le store réel (tous les chemins et exclusions), préférence (défaut, illisible, stockage refusé, séparation production/aperçu, absente de la sauvegarde, intacte après opérations, restauration et réinitialisation), contrats CSS (largeurs, seuils, actions et bouton collés, colonnes toujours présentes, accessibilité du bouton, indicateur réservé à l'aperçu) |

Aucun test d'interface automatisé (Playwright) : l'interface est vérifiée à la main dans le navigateur.

### 4.2 Tests manuels sur la tablette Samsung (production `c8cf885`)

Appareil : **Samsung Galaxy TabPro S, Windows 10, Microsoft Edge, orientation paysage**. Tests réalisés par le gérant avec l'utilisateur, signalés le 31/10/2026. Résultats déclarés, non mesurés par Claude (taille réelle de la fenêtre d'Edge non relevée).

| Domaine | Testé avec succès | Non couvert par ce test |
| --- | --- | --- |
| Prise de commande | Création d'une commande, sélection et création de clients, ajout de produits au panier, modification d'une commande existante, absence de doublon | Adresse ponctuelle, trajet en scooter, cadeau fidélité, paiement prévu |
| Commandes | Passage entre les statuts, préparation et finalisation, marquage « Encaissée », suivi des commandes | Détail des moyens testés (mixte, titres-restaurant) non précisé |
| Statistiques | Consultation du chiffre d'affaires, statistiques du service, cohérence après plusieurs opérations | Vues jour / semaine / mois non précisées |
| Clôture / réouverture | Clôture, ouverture d'un nouveau service, conservation des commandes en cours, comportement des archives et des statistiques | Reprise d'un service fermé (non développée) |
| Clients et fidélité | Clients conservés, compteurs de fidélité toujours visibles après clôture, informations clients conservées | **Cycle complet de fidélité** (progression jusqu'à 10, obtention puis utilisation d'une récompense) |
| Tickets | Aperçu des tickets, impression via **Microsoft Print to PDF** | **Impression sur une vraie imprimante thermique** |
| Sauvegarde | Export JSON, fichier ouvert dans le Bloc-notes, copie sur clé USB, contenu vérifié | **Restauration** : l'application n'a **aucune fonction d'import** ; aucune restauration n'a donc été testée |
| Tablette | Application utilisable dans Edge en paysage, navigation et interactions principales fonctionnelles | Mode portrait, clavier tactile, son d'encaissement, mise en veille, « Ajouter à l'écran d'accueil » |

### 4.3 Restent à vérifier

- Cycle complet de fidélité sur l'appareil réel : progression, obtention d'une récompense, utilisation, annulation.
- Restauration effective d'une sauvegarde JSON (fonction d'import à développer d'abord, voir `docs/ROADMAP.md`).
- Impression sur une véritable imprimante thermique (80 mm) : lisibilité, découpe entre les deux tickets, réimpression.
- Fonctionnement après une coupure de connexion (l'application est servie en ligne ; aucun mode hors ligne n'a été conçu ni testé) et après mise en veille de la tablette.
- Parcours complet en conditions réelles de service.
- Sur la tablette : trajet en scooter, adresse ponctuelle, paiements mixtes et titres-restaurant, son d'encaissement.
- **Taille réelle de la fenêtre d'Edge sur la tablette** : réglages confirmés par le gérant le 31/10 : écran 2160×1440, **échelle Windows 150 %**, zoom Edge 100 %, soit une largeur théorique d'environ **1440 px CSS** avec Edge maximisé (l'hypothèse précédente de 1080 px, fondée sur une échelle de 200 %, était fausse). La largeur et la hauteur réelles de la fenêtre (barre des tâches, barres d'Edge, fenêtre non maximisée ou ancrée) n'ont pas été mesurées ; hauteur estimée autour de 800 à 840 px. À ces 1440 px, l'application affiche les trois colonnes, la barre latérale complète (logo et libellés) et la colonne Commande de 380 px.

## 5. Bugs connus, limites et éléments absents

- **Non vérifié** : voir 4.3. La tablette Samsung a été testée manuellement sur les fonctions principales (4.2), sans validation exhaustive. Les interventions 4B, 5 et 6 ont été validées par le gérant sur Safari iPhone (prévisualisation).
- Personnaliser **une seule** pizza parmi plusieurs identiques est impossible : la personnalisation s'applique à toute la ligne (prévue initialement comme « 4B », numéro repris par le correctif de navigation du 30/10).
- Écran Commandes : vérifié à l'écran (Chromium, 1280×800, 1024×700, 800×1100, 375×812, 1440×900) avec un service fictif, puis utilisé par le gérant sur la tablette Samsung (statuts, encaissement, suivi : test manuel, section 4.2). Les consignes permanentes du client (ex. allergie) ne s'affichent que pour les livraisons, comme sur le ticket.
- Pas d'alerte sur les heures de retrait dépassées, pas de statuts propres à la livraison, pas de gestion des livreurs.
- Aucune imprimante thermique n'est pilotée : impression par la boîte de dialogue du navigateur ; la découpe entre les deux tickets dépend de l'imprimante et de son pilote.
- Trajet en scooter : estimation sans trafic, vitesses urbaines du modèle prudentes (proche de la voiture en centre-ville), profil cyclomoteur 45 km/h sans distinction 50/125 cm³ (décision du gérant) ; serveur public FOSSGIS sans garantie de disponibilité (en cas de panne, ticket sans trajet) et réservé à un usage non essentiel / non commercial : à réexaminer avant une exploitation commerciale (fournisseur payant possible, par exemple Valhalla hébergé chez Stadia Maps avec authentification par domaine). Changer seulement le digicode, l'étage ou les consignes ne recalcule pas le trajet (même itinéraire).
- Mise en page : en 1024×700, une commande en modification dépasse légèrement (le panneau défile) ; sur la tablette 1280×800, une commande en modification avec adresse ponctuelle fait défiler légèrement le panneau.
- La prévisualisation (`a913a77`) n'a pas le contact de l'exploitant ajouté ensuite en production.
- Les consignes permanentes du client (champ unique, ex. « Allergique aux noix » ou « Sonner deux fois ») figurent sur le ticket livreur, pas sur le ticket cuisine (décision à prendre : champ séparé « consignes cuisine »).
- Une commande encaissée puis modifiée reste « Encaissée » : un écart de montant se règle hors de l'appli.
- Carte figée dans le code (`src/data/catalog.ts`, prix de démonstration) ; l'entrée « Carte » de la maquette n'existe pas.
- Statistiques : une commande encaissée puis modifiée compte pour son nouveau montant (l'écart réel se règle hors de l'appli) ; le classement par montant ignore les suppléments ; la nuit du changement d'heure, les deux « 2 h » sont regroupées ; un bilan clôturé peut encore évoluer si une commande est encaissée après coup (affiché « après la clôture »).
- Pas d'authentification, pas de rôles, pas de suppression de fiche client (RGPD), sauvegarde manuelle uniquement (pas d'import ni de sauvegarde automatique). L'export a été testé sur la tablette (clé USB comprise) ; une restauration est aujourd'hui **impossible depuis l'application** : à développer et tester avant l'utilisation quotidienne.
- Le README contient encore le parcours de validation et les « points à valider » de la V1 et ne décrit pas les interventions 4 à 6 : à relire lors d'une future intervention (`CLAUDE.md` et ce document font foi).
- Décisions encore ouvertes (détail dans `docs/ROADMAP.md`) : liste définitive des pizzas éligibles ; reprise d'un service fermé par erreur (B3) ; intérêt définitif du module Statistiques ; champ « consignes cuisine » (allergies) ; encaissement partiel ; statistiques par moyen de paiement ; fournisseur de calcul de trajet pour une exploitation commerciale.
- Instantané réel testé le 30/10 (règle CLAUDE.md) : sauvegarde Safari iPhone de la production (14h15, 5 clients, 4 commandes au format d'avant l'intervention 3 : sans suivi de paiement, `awardOn`, frais de livraison 2 €, sans état du service). Test temporaire non commité sur la branche 4 + 4A + 4B : chargement sans alerte ni réécriture, données, montants et frais historiques conservés, soldes de fidélité identiques, 4 commandes « Paiement non suivi » dans les Statistiques, encaissement sans double crédit, modification, fermeture du service et rechargement corrects. À noter : modifier une ancienne commande avec frais de livraison la recalcule à 0 € (règle validée de la livraison offerte).
