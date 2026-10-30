# Feuille de route Ferrari Manager

Mise à jour le 31/10/2026 : tests manuels sur la tablette Samsung intégrés (`docs/ETAT_PROJET.md`, section 4) et décisions produit du 31/10 enregistrées. L'état actuel de chaque sujet est décrit dans `docs/ETAT_PROJET.md` ; ce document ne liste que ce qui reste à faire et les décisions en attente.
Chaque intervention suit les règles de `CLAUDE.md` : branche dédiée, tests, validation sur la prévisualisation, puis mise en production après accord. **Aucune intervention n'est en cours** ; ne pas commencer l'intervention 7 sans demande explicite du gérant.

## Décisions produit du 31/10/2026 (non développées)

**Découpage validé le 31/10** : intervention 7 = barre latérale rétractable et mise en page selon la place disponible (+ mise à jour de l'aperçu) ; 8 = restauration d'une sauvegarde ; 9 = carte éditable (9a produits, 9b suppléments) ; 10 = rapport PDF et nouvelle clôture. **Intervention 7 développée** sur `feat/intervention-7-barre-laterale` (détail dans `docs/ETAT_PROJET.md`) : 300 tests, build OK, vérifiée dans Chromium ; aperçu préparé, à publier ; **à tester sur la Samsung (indicateur de taille de l'aperçu) et sur iPhone avant toute fusion**. Les interventions 8 à 10 ne sont pas commencées.

- **A · Barre latérale rétractable** : menu ouvert = logo principal ; menu fermé = monogramme PF et icônes seules ; dépliage/repliage manuel ; repli automatique après la sélection d'un client, sans saut de mise en page ; préférence mémorisée ; l'espace libéré profite aux trois colonnes. Logos existants (ne pas les recréer) : `Bureau/Pizza Ferrari/logo/` (le dossier s'appelle « Pizza Ferrari »). **Décision du 31/10 : on garde les deux fichiers déjà intégrés**, `src/assets/logo-ferrari.webp` (462×160, barre ouverte) et `src/assets/monogram-ferrari.webp` (512×512, monogramme PF avec le cercle doré, barre réduite).
- **B · Gestion de la carte depuis Paramètres** : ajouter, modifier (nom, ingrédients, catégorie, prix), désactiver et réactiver pizzas, boissons, desserts ; gérer les suppléments et leurs tarifs. Les commandes enregistrées ne doivent jamais être altérées. Carte actuelle provisoire, vraie carte fournie plus tard.
- **C · Rapport PDF de fin de service** : total encaissé, nombre de commandes, panier moyen, quantités, meilleures ventes, répartition par moyen de paiement, livraison / emporter, annulations, horaires d'activité ; lisible sur ordinateur, enregistrable sur clé USB.
- **D · Nouvelle clôture** : « Télécharger le rapport PDF et clôturer » ou « Clôturer sans télécharger » (téléchargement facultatif). Après clôture : CA et statistiques du nouveau service à zéro, aucune donnée financière du service précédent visible dans l'interface courante ; clients, fidélité (compteurs et récompenses), carte, paramètres et commandes non terminées conservés.
- **E · Infrastructure** : migration Supabase **reportée** ; l'architecture locale actuelle est conservée. Sauvegarde **et restauration** à fiabiliser avant l'utilisation quotidienne (l'import n'existe pas encore).

## Déjà en production (rappel)

Interventions 1 à 3.1 (stockage protégé, persistance, encaissement et fidélité, service ouvert/fermé, sons), sauvegarde JSON, intervention 4 (historique des services, livraison offerte, Statistiques), 4A (écran Commandes en cartes), 4B (client verrouillé pendant une modification, actions accessibles sur petit écran), 5 (tickets cuisine et livreur, paiement prévu, encaissements simples et mixtes, repères de livraison), 6 (trajet en scooter sur le ticket livreur, adresse de livraison ponctuelle, conformité FOSSGIS).

## Priorité 1 · Stabiliser la version en production

1. **Tests sur tablette Samsung en paysage** : *premier test manuel réussi* (Galaxy TabPro S, Windows 10, Edge : commandes, statuts, encaissement, statistiques, clôture/réouverture, clients, aperçu des tickets, impression PDF, export JSON sur clé USB ; détail dans `docs/ETAT_PROJET.md`, 4.2). Réglages confirmés : échelle Windows 150 %, zoom Edge 100 %, environ 1440 px CSS de large avec Edge maximisé. Restent : taille réelle de la fenêtre d'Edge (non mesurée), cycle complet de fidélité, clavier (téléphone, adresse, notes), son (volume, mode silencieux), mise en veille et redémarrage, coupure de connexion, trajet en scooter, adresse ponctuelle, paiements mixtes.
2. **Impression physique des tickets** : Microsoft Print to PDF réussi ; reste la sortie papier réelle des tickets cuisine et livreur (80 mm), « Imprimer les deux » (découpe entre les tickets selon l'imprimante), lisibilité en monochrome, réimpression.
3. **Validation du parcours complet** en conditions de service : ouvrir le service, commande téléphone avec livraison (adresse habituelle puis ponctuelle, trajet), commande comptoir, cadeau fidélité, paiement prévu, modification, encaissement simple et mixte, annulation, fermeture du service, sauvegarde JSON. Non réalisée à ce jour.
4. **Mettre à jour la prévisualisation** au niveau de la production (elle sert `a913a77`, sans le contact de l'exploitant) lors de la prochaine intervention.

Livrable attendu : une liste de corrections, sans nouvelle fonctionnalité.

## Décisions en attente du gérant

- **Consignes cuisine** : les consignes permanentes du client (ex. allergie) ne sont imprimées que sur le ticket livreur. Proposition : champ séparé « consignes cuisine » sur la fiche, imprimé sur le ticket cuisine.
- **Encaissement partiel** (ex. titres-restaurant maintenant, espèces au retour du livreur) : non pris en charge, l'encaissement reste « tout ou rien ».
- **Montant supérieur au total** (titres-restaurant sans rendu) : refusé aujourd'hui, seul le montant de la commande est enregistré.
- **Commande encaissée puis modifiée** : reste encaissée avec un écart affiché ; pas de « reste à encaisser » automatique.
- **Statistiques par moyen de paiement** : non développées.
- **Fournisseur de calcul de trajet pour une exploitation commerciale** : le serveur public FOSSGIS est réservé à un usage non essentiel et sans garantie. Option étudiée : Valhalla hébergé chez Stadia Maps (offre Starter, authentification par domaine, aucune clé dans le code), changement par `VITE_ROUTING_URL` et contact/attribution à adapter.
- **Liste définitive des pizzas et boissons éligibles** à la fidélité (le réglage existe déjà dans Paramètres).
- **Intérêt définitif du module Statistiques** (masquable en attendant).

## Intervention 4 · suites non développées

- **B3 · Reprendre un service fermé par erreur** (principe retenu, non développé) : à l'ouverture, choix « Démarrer un nouveau service » (principal) ou « Reprendre le service du … fermé il y a … » ; aucune décision automatique ni délai fixe ; seul le dernier service, si aucun autre n'a été démarré depuis ; reprises tracées ; numérotation reprise après le plus grand numéro du service.
- **B4 · Fermeture avec commandes restantes** (intervention séparée) : bouton « Examiner les commandes » dans la fenêtre de fermeture ; pas d'annulation groupée sans validation préalable ; commandes encaissées protégées.

## Priorité 2 · Ergonomie du service

1. **Personnalisation individuelle des pizzas identiques** : pouvoir modifier une seule pizza d'une ligne de plusieurs (aujourd'hui la personnalisation s'applique à toute la ligne). Attention aux règles de fusion des lignes et aux tests de prix.
2. **Gestion des horaires et retards** : alerte quand l'heure de retrait ou de livraison demandée est dépassée.
3. **Export USB** (évoqué le 30/10) : besoin à préciser par le gérant (complément de la sauvegarde JSON existante ?).

## Priorité 3 · Livraison, impression, fidélité

1. **Parcours des livraisons** : statuts propres à la livraison (gestion des livreurs exclue tant que le gérant livre lui-même). Le trajet en scooter existe déjà (intervention 6).
2. **Impression thermique directe** : passerelle locale ESC/POS ou impression réseau, à décider après les essais papier de la priorité 1. Les modèles `KitchenTicket` et `DeliveryTicket` (`src/domain/ticket.ts`) sont indépendants de l'affichage pour ça.
3. **Paramétrage des pizzas éligibles** : saisir la liste définitive du gérant et vérifier si l'écran actuel suffit avant tout développement.

## Priorité 4 · Utilisation quotidienne réelle

1. **Préparer la persistance réelle et la synchronisation** : tablette et PC partagent les mêmes données, sauvegardes automatiques. Points techniques déjà identifiés : `README.md`, section *Persistance locale*, « À reprendre côté serveur en V2 ».
2. **Saturation du stockage local** (environ 55 services de 50 commandes, quota partagé avec les autres sites `lupo1313.github.io`) : purge validée des anciennes commandes ou base distante ; import d'une sauvegarde JSON (non développé) ; conserver les bilans des services avant toute purge.
3. **Passage éventuel à Supabase** (**reporté**, décision du 31/10) : réimplémenter `AppRepository` en asynchrone, calcul du prix et de la fidélité côté serveur, numérotation par séquence, unicité du téléphone. Migration des données locales existantes à concevoir sans perte.
4. **Préparer l'utilisation quotidienne** : remplacer la carte de démonstration par la vraie carte et les vrais prix, authentification du personnel, conformité RGPD (conservation, suppression des fiches), fournisseur de trajet adapté à un usage commercial. Ce n'est qu'à cette étape que de vraies données clients pourront être saisies.
5. **Remettre à jour le README** (parcours de validation et « points à valider » de la V1 dépassés).

## Hors périmètre (décisions prises)

Pas de caisse, de comptabilité, de statistiques de caisse, de gestion des stocks ou des DLC, ni de gestion des livreurs, de carte interactive, de suivi GPS ou de géolocalisation du livreur sans demande explicite. Livraison toujours offerte, quelle que soit la distance.
