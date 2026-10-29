# Ferrari Manager · V1 de test

Application de prise de commandes pour la **Pizzeria Ferrari** (Marseille, depuis 1980) : recherche client, catalogue, personnalisation des pizzas, commande active, suivi des commandes, programme de fidélité et ticket imprimable.

> ⚠️ **Version de test.** Données 100 % fictives, stockées uniquement dans le navigateur (`localStorage`). Ne pas saisir de véritables données clients. Cette V1 n'est pas prête pour une exploitation commerciale.

Ferrari Manager **n'est pas une caisse** : aucun paiement, encaissement, terminal bancaire ni clôture comptable. L'établissement garde sa caisse actuelle.

---

## Démarrage rapide

Prérequis : Node.js 18 ou plus récent (testé avec Node 24).

```bash
npm install          # installation des dépendances
npm run dev          # serveur de développement → http://localhost:5173
npm run dev:tablette # idem, accessible depuis la tablette sur le même Wi-Fi (http://IP-du-PC:5173)
npm test             # tests métier (Vitest)
npm run build        # vérification TypeScript + compilation dans dist/
npm run preview      # sert la version compilée localement
```

Les données d'un navigateur ne sont visibles que dans ce navigateur : la tablette et le PC ont chacun leurs propres données de test.

---

## Structure du projet

```
src/
├── domain/            Règles métier en TypeScript pur, sans React (testées)
│   ├── types.ts       Modèle : produits, clients, commandes, fidélité, paramètres
│   ├── pricing.ts     Calcul des prix et totaux (en centimes)
│   ├── cart.ts        Lignes de commande, personnalisations, fusion des lignes identiques
│   ├── customers.ts   Validation, normalisation du téléphone, recherche, doublons
│   ├── loyalty.ts     Fidélité : solde recalculé depuis un journal, réconciliation idempotente
│   ├── orders.ts      Statuts, validation de commande, modification, fin de service
│   ├── ticket.ts      Modèle de ticket indépendant de l'affichage
│   └── money.ts, time.ts, ids.ts
├── data/              Données de démonstration (à remplacer par la vraie carte)
│   ├── catalog.ts     Pizzas, boissons, desserts, suppléments
│   ├── defaultSettings.ts  Frais de livraison, largeur de ticket, produits éligibles
│   └── seed.ts        Clients et commandes fictifs
├── storage/           Persistance abstraite (localStorage aujourd'hui, base de données demain)
├── state/             Store applicatif (orchestration domaine + persistance) et navigation
├── components/        Interface : layout, customer, catalog, order, orders, ticket, loyalty, ui
├── pages/             Prise de commande, Commandes, Clients, Fidélité, Paramètres
└── styles/            CSS organisé par zone (tokens, base, layout, colonnes, pages, ticket)
tests/                 Tests Vitest : prix, clients, fidélité, scénario complet du store
```

### Choix d'architecture

- **Domaine isolé** : toutes les règles (prix, fidélité, statuts) sont des fonctions pures testables sans interface. Les composants React ne calculent rien eux-mêmes.
- **Montants en centimes** : aucun arrondi flottant. Le total est toujours recalculé depuis les lignes, jamais saisi.
- **Copies figées** : une commande garde une copie du client (nom, adresse…) et des prix au moment de la commande. Modifier une fiche ne change pas l'historique.
- **Fidélité par journal** : le solde n'est jamais stocké. Il est recalculé depuis un journal d'événements (`points`, `rewards_used`). À chaque validation, modification, changement de statut ou annulation, la commande est *réconciliée* : on écrit uniquement l'écart entre ce qu'elle devrait avoir crédité et ce qui est déjà dans le journal. Résultat : un double clic, une annulation ou une modification ne peuvent pas créer de points en double.
- **Validation idempotente** : chaque panier réserve l'identifiant de sa future commande. Une seconde validation du même panier est refusée, et le bouton est verrouillé pendant l'enregistrement.
- **Persistance par opération** (`AppRepository`) : `saveOrderWithLoyalty`, `upsertCustomer`, `saveSettings`, `closeService`, `saveCart`. Le panier a sa propre clé et ne réécrit jamais l'historique. Détails et garanties : section *Persistance locale* ci-dessous.
- **Navigation par hash** (`#/commandes`) : fonctionne sur n'importe quel hébergement statique, sans règle de réécriture.

---

## Persistance locale (V1) : garanties réelles

Deux clés `localStorage` :

| Clé | Contenu | Écrite quand |
| --- | --- | --- |
| `ferrari-manager:v1` | Historique : commandes, journal de fidélité, clients, paramètres, compteur, début de service | Validation, modification, statut, annulation, impression demandée, fiche client, paramètres, fin de service |
| `ferrari-manager:v1:panier` | Commande en cours de saisie | Immédiatement à chaque ajout, quantité, client, mode ou heure ; regroupée (au plus 300 ms) pendant la saisie d'une note ou d'un nom comptoir, et forcée quand l'onglet passe en arrière-plan ou se ferme (`pagehide`, `visibilitychange`) |

Ce qui est garanti :

- **Commande + fidélité = une seule écriture.** Une commande et ses événements de fidélité sont dans la même clé, écrite en une fois : on ne peut pas avoir l'une sans les autres.
- **Écrire d'abord, afficher ensuite.** Pour toute donnée durable, l'écran n'est mis à jour que si l'écriture a réussi. En cas d'échec (stockage plein ou bloqué), l'action est refusée avec un message, le panier reste intact et un nouvel essai est possible.
- **Écriture partielle entre les deux clés.** Si la commande est enregistrée mais que le panier n'a pas pu être vidé, le panier restant porte l'identifiant d'une commande déjà enregistrée : la validation le refuse, et au rechargement il est automatiquement vidé. Aucun doublon possible.
- **Pas d'écrasement.** Données illisibles ou version inconnue : rien n'est écrit tant que l'utilisateur ne choisit pas *Paramètres → Réinitialiser*.
- **Ancien format** (panier inclus dans l'historique) : repris automatiquement, copié dans sa clé, puis retiré de l'historique à la première écriture.

Limites assumées en V1 :

- L'historique reste un seul document JSON réécrit à chaque opération durable (`localStorage` ne sait pas modifier une partie d'une valeur). Coût mesuré : environ 40 ms et 1,2 Mo écrits par validation avec 500 commandes en historique (CPU bridé ×4).
- Une fermeture brutale (plantage du navigateur, batterie) dans les 300 ms qui suivent une frappe peut perdre ces derniers caractères de la note.
- Deux onglets ouverts sur l'application ne se synchronisent pas : le dernier qui écrit gagne.
- Un panier illisible est remplacé par un panier vide (l'historique, lui, reste protégé).

À reprendre côté serveur en V2 (Supabase) :

- `saveOrderWithLoyalty` → une fonction Postgres en transaction, qui recalcule elle-même prix et fidélité. Le client ne doit plus envoyer d'événements de fidélité « de confiance ».
- Identifiant de commande généré par le client conservé (`on conflict do nothing`) pour garder la protection contre les doublons ; `revision` utilisée comme verrou contre les modifications concurrentes.
- Numérotation des commandes par une séquence serveur (doublons dès deux appareils sinon).
- Unicité du téléphone client par contrainte en base.
- Store asynchrone : les opérations du dépôt renverront des promesses ; le verrou du bouton de validation devra durer jusqu'à la réponse du serveur.
- Le panier peut rester local.

---

## Programme de fidélité (règles implémentées)

- 10 pizzas **payantes** = 1 récompense. Une pizza offerte ne rapporte aucun point.
- Récompense au choix : une **pizza** parmi une liste éligible, ou une **grande bouteille de soda** éligible. Les deux listes se règlent dans *Paramètres*.
- Jamais échangeable contre du vin, de l'alcool, un dessert ou un supplément. Ces garde-fous s'appliquent même si la configuration est erronée.
- La récompense n'est **jamais consommée automatiquement** : l'utilisateur choisit « Utiliser une récompense ». Elle n'est décomptée qu'à la validation.
- Affichage séparé : *récompenses disponibles* et *progression 0 à 9 / 10*. Le compteur n'affiche jamais 10/10.
- Points crédités à la validation (V1). L'architecture prévoit déjà l'option « à la commande terminée » (`awardOn: 'terminee'`, testée).
- Annulation : les points sont retirés et la récompense restituée. Si une récompense a été utilisée grâce à des points ensuite annulés, aucun solde négatif n'est affiché : une « dette » est signalée et la prochaine récompense gagnée la compense.
- Journal consultable dans la page *Fidélité*.

---

## Parcours de validation (critères de la V1)

1. Recherche client : taper `06 12 34` dans la colonne Client, puis sélectionner **Jean Dupont** (1 récompense disponible, 2/10).
2. Ajouter une **Royale** via le crayon : retirer *Œuf*. Ajouter une **Chèvre Miel** avec le supplément *Miel* (+0,50 €).
3. Ajouter un **Coca-Cola 1,5L**, choisir **Livraison** (adresse affichée, frais 2,00 €).
4. Vérifier le total : 14,00 + 14,50 + 4,00 + 2,00 = **34,50 €**.
5. **Utiliser une récompense** → Grande bouteille → Fanta 1,5L (offert, le total ne change pas).
6. **Valider et imprimer** → aperçu du ticket → *Imprimer* ouvre la boîte de dialogue du navigateur.
7. **Commandes** : retrouver la commande, changer son statut (boutons de statut ou « Lancer la préparation »).
8. Page **Fidélité** : Jean a 4/10 et 0 récompense disponible.
9. **Annuler** la commande : Jean revient à 2/10 avec 1 récompense disponible.
10. Fermer et rouvrir le navigateur : tout est conservé.
11. **Paramètres → Réinitialiser les données de démonstration**.

Ce parcours est aussi automatisé dans `tests/store.test.ts`.

---

## Déploiement

La configuration (`base: './'` + navigation par hash) fonctionne telle quelle sur les deux hébergeurs.

### GitHub Pages

1. Créer un dépôt et pousser le projet sur la branche `main`.
2. *Settings → Pages → Source* : choisir **GitHub Actions**.
3. Le workflow `.github/workflows/deploy-pages.yml` lance les tests, compile et publie `dist/` à chaque push.

### Cloudflare Pages

1. *Workers & Pages → Create → Pages → Connect to Git*, puis sélectionner le dépôt.
2. Framework preset : **Vite** (ou None). Build command : `npm run build`. Output directory : `dist`.
3. Variable d'environnement conseillée : `NODE_VERSION = 20`.

Rappel : chaque URL déployée a ses propres données locales (aucune synchronisation entre appareils en V1).

---

## Remplacer la carte de démonstration

Les prix, compositions et produits viennent de la maquette et sont **provisoires**. Pour passer sur la vraie carte, modifier `src/data/catalog.ts` :

- garder des `id` stables (ils sont référencés par les listes de récompenses dans les paramètres) ;
- `ingredients` = ingrédients retirables, `tags` = familles de filtre (classique, spéciale, blanche, viande, végétarienne) ;
- `alcohol: true` exclut définitivement une boisson des récompenses.

Après un changement de carte, réinitialiser les données de démonstration (Paramètres).

---

## Limites connues (V1)

- Stockage local uniquement : pas de synchronisation entre la tablette et un autre poste, données perdues si le navigateur est vidé.
- Impression via la boîte de dialogue du navigateur. Aucune imprimante thermique n'est pilotée, et un ticket n'est jamais marqué « imprimé » (seule la demande d'impression est tracée).
- Pas d'authentification ni de rôles (tout le monde a accès à tout).
- Carte figée dans le code : pas d'écran d'édition des produits.
- Les entrées *Carte* et *Statistiques* de la maquette ne sont pas développées (hors périmètre V1, aucun bouton décoratif ajouté).
- Pas de suppression de fiche client (prévu avec la gestion RGPD en V2).
- Testé en navigateur (Chromium) aux formats 1280×800, 1024×700 et 800×1100. À valider sur la tablette Samsung réelle.

## Reste à faire avant une mise en production

1. Base de données distante (ex. Supabase) avec sauvegardes, en réimplémentant `AppRepository` de façon asynchrone.
2. Authentification du personnel et rôles.
3. Impression thermique réelle (ESC/POS via passerelle locale ou imprimante réseau), avec confirmation de sortie, à partir du modèle `TicketModel`.
4. Conformité RGPD : registre, durée de conservation, droit d'accès et de suppression, mentions d'information.
5. Édition de la carte et des prix depuis l'application.
6. Mode hors ligne robuste (PWA) et synchronisation.
7. Tests d'interface automatisés (Playwright) et recette sur la tablette en conditions de service.

### Points à valider avec le client

- Les suppléments ajoutés sur une pizza offerte restent payants (choix actuel).
- Frais de livraison : 2,00 € dans la maquette, alors que le site annonce la livraison offerte dans certains arrondissements. Valeur modifiable dans Paramètres.
- Liste des pizzas éligibles (actuellement Margarita, Reine, Fromage, Napolitaine, Anchois) et des grandes bouteilles (Coca, Fanta, Sprite 1,5 L).
- Numérotation des commandes remise à 1 à la fin de service, seulement s'il ne reste aucune commande en cours.
