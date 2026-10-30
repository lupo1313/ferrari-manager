# Feuille de route Ferrari Manager

Ordre de priorité décidé par le gérant le 30/10/2026. L'état actuel de chaque sujet est décrit dans `docs/ETAT_PROJET.md` ; ce document ne liste que ce qui reste à faire.
Chaque intervention suit les règles de `CLAUDE.md` : branche dédiée, tests, validation sur la prévisualisation, puis mise en production après accord.

## Priorité 1 · Stabiliser la version en production

1. **Vérification de la production** : parcours réel sur https://lupo1313.github.io/ferrari-manager/ après la mise en ligne du 30/10. Données déjà présentes conservées, anciennes commandes en « Paiement non suivi », son « caisse », choix et désactivation du son conservés après rechargement.
2. **Tests sur tablette Samsung en paysage** : lisibilité, tailles tactiles, clavier (téléphone et notes), son (volume, mode silencieux), « Ajouter à l'écran d'accueil », comportement après mise en veille et redémarrage.
3. **Validation du parcours complet** en conditions de service : ouvrir le service, commande téléphone avec livraison, commande comptoir, cadeau fidélité, modification, encaissement, annulation, fermeture du service.

Livrable attendu : une liste de corrections, sans nouvelle fonctionnalité.

## Priorité 2 · Ergonomie du service

1. **Simplification du suivi des commandes** : refonte des boutons de progression des statuts sur les cartes de la page Commandes.
2. **Personnalisation individuelle des pizzas identiques** : pouvoir modifier une seule pizza d'une ligne de plusieurs (aujourd'hui la personnalisation s'applique à toute la ligne). Attention aux règles de fusion des lignes et aux tests de prix.
3. **Gestion des horaires et retards** : alerte quand l'heure de retrait ou de livraison demandée est dépassée.

## Priorité 3 · Livraison, impression, fidélité

1. **Parcours des livraisons** : statuts propres à la livraison (gestion des livreurs exclue tant que le gérant livre lui-même).
2. **Impression des tickets** : imprimante thermique réelle. À décider : passerelle locale ESC/POS ou impression réseau. Le modèle `TicketModel` (`src/domain/ticket.ts`) est prévu pour ça. Éventuellement afficher le statut de paiement sur le ticket.
3. **Paramétrage des pizzas éligibles** : le réglage existe déjà dans Paramètres. Il reste à obtenir et saisir la **liste définitive du gérant**, et à vérifier si l'écran actuel lui suffit avant tout développement.

## Priorité 4 · Utilisation quotidienne réelle

1. **Préparer la persistance réelle et la synchronisation** : tablette et PC partagent les mêmes données, sauvegardes. Points techniques déjà identifiés : `README.md`, section *Persistance locale*, « À reprendre côté serveur en V2 ».
2. **Passage éventuel à Supabase** : réimplémenter `AppRepository` en asynchrone, calcul du prix et de la fidélité côté serveur, numérotation par séquence, unicité du téléphone. Migration des données locales existantes à concevoir sans perte.
3. **Préparer l'utilisation quotidienne** : remplacer la carte de démonstration par la vraie carte et les vrais prix, frais de livraison réels, authentification du personnel, conformité RGPD (conservation, suppression des fiches), sauvegardes. Ce n'est qu'à cette étape que de vraies données clients pourront être saisies.

## Hors périmètre (décisions prises)

Pas de caisse, de comptabilité, de statistiques de caisse, de gestion des stocks ou des DLC, ni de gestion des livreurs sans demande explicite.
