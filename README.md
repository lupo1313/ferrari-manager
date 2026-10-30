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
│   ├── service.ts     Service ouvert/fermé, historique des services, rattachement des commandes
│   ├── ticket.ts      Modèle de ticket indépendant de l'affichage
│   └── money.ts, time.ts, ids.ts
├── data/              Données de démonstration (à remplacer par la vraie carte)
│   ├── catalog.ts     Pizzas, boissons, desserts, suppléments
│   ├── defaultSettings.ts  Largeur de ticket, son, produits éligibles, modules facultatifs
│   └── seed.ts        Clients et commandes fictifs
├── storage/           Persistance abstraite (localStorage aujourd'hui, base de données demain)
├── state/             Store applicatif (orchestration domaine + persistance) et navigation
├── components/        Interface : layout, customer, catalog, order, orders, ticket, loyalty, ui
├── pages/             Prise de commande, Commandes, Clients, Fidélité, Paramètres
├── modules/
│   └── statistiques/  Module FACULTATIF : tableau de bord (calculs purs + interface), chargé à la demande
└── styles/            CSS organisé par zone (tokens, base, layout, colonnes, pages, ticket)
tests/                 Tests Vitest : prix, clients, fidélité, services, statistiques, scénario complet du store
```

### Choix d'architecture

- **Domaine isolé** : toutes les règles (prix, fidélité, statuts) sont des fonctions pures testables sans interface. Les composants React ne calculent rien eux-mêmes.
- **Montants en centimes** : aucun arrondi flottant. Le total est toujours recalculé depuis les lignes, jamais saisi.
- **Copies figées** : une commande garde une copie du client (nom, adresse…) et des prix au moment de la commande. Modifier une fiche ne change pas l'historique.
- **Fidélité par journal** : le solde n'est jamais stocké. Il est recalculé depuis un journal d'événements (`points`, `rewards_used`). À chaque validation, modification, changement de statut ou annulation, la commande est *réconciliée* : on écrit uniquement l'écart entre ce qu'elle devrait avoir crédité et ce qui est déjà dans le journal. Résultat : un double clic, une annulation ou une modification ne peuvent pas créer de points en double.
- **Validation idempotente** : chaque panier réserve l'identifiant de sa future commande. Une seconde validation du même panier est refusée, et le bouton est verrouillé pendant l'enregistrement.
- **Persistance par opération** (`AppRepository`) : `saveOrderWithLoyalty`, `upsertCustomer`, `saveSettings`, `saveService` (ouverture/fermeture du service), `saveCart`. Le panier a sa propre clé et ne réécrit jamais l'historique. Détails et garanties : section *Persistance locale* ci-dessous.
- **Navigation par hash** (`#/commandes`) : fonctionne sur n'importe quel hébergement statique, sans règle de réécriture.

---

## Persistance locale (V1) : garanties réelles

Deux clés `localStorage` :

| Clé | Contenu | Écrite quand |
| --- | --- | --- |
| `ferrari-manager:v1` | Historique : commandes, journal de fidélité, clients, paramètres, compteur, état et historique des services | Validation, modification, statut, encaissement, annulation, impression demandée, fiche client, paramètres, ouverture/fermeture du service |
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
- **Saturation du stockage.** `localStorage` est limité à environ 5 Mo par origine, et `lupo1313.github.io` est **une seule origine** partagée par la production, la prévisualisation et les autres sites GitHub Pages du compte. Une commande pèse environ 1,8 Ko : un service de 50 commandes ajoute environ 93 Ko, soit environ 55 services (2 mois à 6 services par semaine) avant saturation. Aucune commande n'est jamais supprimée automatiquement. Quand le stockage est plein, l'écriture échoue et l'action est refusée avec un message (rien n'est perdu de ce qui était déjà enregistré, mais plus rien ne peut l'être). À traiter avant une utilisation quotidienne réelle : export/sauvegarde, purge validée des anciennes commandes ou base distante.
- L'historique des services et les statistiques ajoutent très peu (environ 150 octets par service) : le risque de saturation vient des commandes, conservées indéfiniment.

À reprendre côté serveur en V2 (Supabase) :

- `saveOrderWithLoyalty` → une fonction Postgres en transaction, qui recalcule elle-même prix et fidélité. Le client ne doit plus envoyer d'événements de fidélité « de confiance ».
- Identifiant de commande généré par le client conservé (`on conflict do nothing`) pour garder la protection contre les doublons ; `revision` utilisée comme verrou contre les modifications concurrentes.
- Numérotation des commandes par une séquence serveur (doublons dès deux appareils sinon).
- Unicité du téléphone client par contrainte en base.
- Store asynchrone : les opérations du dépôt renverront des promesses ; le verrou du bouton de validation devra durer jusqu'à la réponse du serveur.
- Le panier peut rester local.

---

## Livraison

Règle définitive du gérant (30/10/2026) : **la livraison est toujours offerte, 0 €, sans exception.** Il n'existe plus aucun réglage de frais (`DELIVERY_FEE = 0` dans `domain/pricing.ts`) ; un ancien réglage stocké est ignoré à la lecture et un frais transmis à `updateSettings` est écarté. Les anciennes commandes enregistrées avec 2,00 € de frais **gardent leurs frais figés** (ticket compris) ; si l'une d'elles est modifiée, elle est recalculée à 0 €.

## Statistiques (module facultatif)

Onglet *Statistiques* : bilan par **service**, **jour**, **semaine** (lundi à dimanche) ou **mois**, avec flèches pour remonter l'historique. Les chiffres sont **indicatifs** : ils reposent sur les encaissements marqués à la main, ce n'est ni une caisse ni une comptabilité certifiée (avertissement permanent sur la page).

- **Historique des services** (socle, indépendant du module) : chaque ouverture crée un service (`services` dans l'historique), chaque fermeture le clôture. Un nouveau service commence à zéro ; les bilans précédents restent consultables, rien n'est effacé.
- **Rattachement** : une commande appartient au service où elle a été créée (`order.serviceId`, jamais modifié ensuite, même si elle est modifiée, encaissée ou annulée plus tard).
- **Encaissement tardif** : reste compté dans le service d'origine, affiché « après la clôture » ; le service en cours le signale à part sans l'ajouter à son total.
- **Montants** = somme des lignes : les frais de livraison, même anciens, ne sont jamais comptés.
- **Annulées** : exclues de tous les totaux et compteurs, affichées à part (y compris annulées après encaissement).
- **Cadeaux fidélité** : jamais comptés comme ventes ; comptés à part (« produits offerts »).
- **Paiement non suivi** (anciennes commandes) : ni encaissé ni à encaisser, inclus dans le total enregistré et signalé.
- **Avant le suivi des services** : commandes antérieures à la mise en place de l'historique, regroupées dans un bloc à part (vue Service), jamais mêlées aux jours, semaines et mois.
- **Après minuit** : un service reste rattaché au jour de son ouverture ; l'axe horaire suit l'ordre du service (23 h, 0 h, 1 h).
- **Classement** : top 5 des pizzas, boissons et desserts par quantité (ou par montant hors suppléments), sur les commandes non annulées.

**Module facultatif** : *Paramètres → Modules facultatifs → Onglet Statistiques : Affiché / Masqué*. Masquer l'onglet ne supprime ni ne modifie aucune donnée ; l'historique des services continue d'être tenu. Le module ne fait que LIRE les données (aucun appel au store qui écrit), il est chargé à la demande (fichier séparé). Pour le retirer complètement : voir l'en-tête de `src/modules/statistiques/index.ts`.

## Programme de fidélité (règles implémentées)

- 10 pizzas **payantes** = 1 récompense. Une pizza offerte ne rapporte aucun point.
- Récompense au choix : une **pizza** parmi une liste éligible, ou une **grande bouteille de soda** éligible. Les deux listes se règlent dans *Paramètres*.
- Jamais échangeable contre du vin, de l'alcool, un dessert ou un supplément. Ces garde-fous s'appliquent même si la configuration est erronée.
- La récompense n'est **jamais consommée automatiquement** : l'utilisateur choisit « Utiliser une récompense ».
- **Cadeau = achat obligatoire** : une récompense n'est utilisable qu'avec au moins une pizza payante dans la commande. Le cadeau s'ajoute à la commande, il ne rend jamais gratuite une pizza déjà choisie. Vérifié à l'ajout, après chaque suppression ou changement de quantité (alerte « Une pizza payante est nécessaire… » avec deux corrections : ajouter une pizza ou retirer le cadeau), à l'enregistrement, à la modification et à l'encaissement. Une commande à 0 € n'est pas bloquée en général : seule cette condition l'est.
- **Pizzas créditées à l'encaissement**, jamais à l'enregistrement. Une commande terminée n'est pas considérée comme payée.
- **Récompense réservée → consommée** : prise dès l'enregistrement (elle ne peut donc pas servir à une deuxième commande), consommée quand la commande est encaissée, restituée une seule fois si la commande est annulée (avant ou après encaissement).
- Affichage séparé : *récompenses disponibles*, *réservées*, *pizzas en attente d'encaissement* et *progression 0 à 9 / 10*. Le compteur n'affiche jamais 10/10.
- Annulation : les pizzas créditées sont retirées et la récompense restituée. Si une récompense a été utilisée grâce à des points ensuite annulés, aucun solde négatif n'est affiché : une « dette » est signalée et la prochaine récompense gagnée la compense.
- Journal consultable dans la page *Fidélité*.

## Suivi d'encaissement

Ferrari Manager reste une application de prise de commandes, **pas une caisse** : aucune ventilation par moyen de paiement, aucun rendu de monnaie, aucune facture. Seul le module facultatif *Statistiques* affiche un total des commandes marquées encaissées, présenté comme indicatif (voir plus bas).

- Chaque commande a un statut de paiement **À encaisser / Encaissée**, indépendant de son statut de préparation (une commande peut être prête et à encaisser, ou en préparation et encaissée).
- Sur la carte de la commande : **Marquer encaissée**, puis un appui sur *Espèces*, *Carte bancaire* ou *Non précisé*.
- **Annuler l'encaissement** (petit lien, avec confirmation) corrige une erreur de saisie : les pizzas sont retirées de la fidélité, puis recréditées au prochain encaissement, une seule fois.
- Annuler une commande encaissée demande une confirmation explicite : le remboursement éventuel est traité hors de Ferrari Manager.
- Modifier une commande encaissée est possible, après confirmation : la fidélité est recalculée sur la version finale, sans double crédit. La commande reste encaissée ; un écart de montant se règle hors de l'application.
- Fin de service : une commande terminée mais **non encaissée** reste affichée (signalée dans la fenêtre de clôture) ; seules les commandes terminées et encaissées, ou annulées, sont archivées.

### Commandes enregistrées avant le suivi des paiements

Ces commandes n'ont pas de statut de paiement. Elles ne sont **ni supposées encaissées, ni effacées** : à la lecture, elles sont marquées « Paiement non suivi » (rien n'est réécrit dans le stockage tant qu'elles ne sont pas modifiées).

- Leurs points, crédités à l'enregistrement par l'ancienne règle, sont **gelés tels quels** : ni retirés sans action explicite, ni complétés sans encaissement.
- *Marquer encaissée* les fait passer à la règle normale, sans double crédit. *Annuler* retire leurs points une seule fois.
- Une ancienne commande terminée est archivée en fin de service comme avant.
- Un bloc paiement illisible (données corrompues) est traité de la même façon prudente.

---

## Parcours de validation (critères de la V1)

1. Recherche client : taper `06 12 34` dans la colonne Client, puis sélectionner **Jean Dupont** (1 récompense disponible, 2/10).
2. Ajouter une **Royale** via le crayon : retirer *Œuf*. Ajouter une **Chèvre Miel** avec le supplément *Miel* (+0,50 €).
3. Ajouter un **Coca-Cola 1,5L**, choisir **Livraison** (adresse affichée, livraison « Offerte »).
4. Vérifier le total : 14,00 + 14,50 + 4,00 = **32,50 €** (livraison toujours offerte).
5. **Utiliser une récompense** → Grande bouteille → Fanta 1,5L (offert, le total ne change pas).
6. **Valider et imprimer** → aperçu du ticket → *Imprimer* ouvre la boîte de dialogue du navigateur.
7. **Commandes** : retrouver la commande, la faire avancer avec le bouton principal (« Lancer la préparation », « Marquer prête », « Terminer la commande ») ; corriger un statut via le menu « ••• ».
8. Page **Fidélité** : Jean a toujours 2/10 (pizzas en attente d'encaissement) et 1 récompense réservée.
9. Sur la commande : **Marquer encaissée** → *Carte bancaire*. Jean passe à 4/10, la récompense est consommée.
10. **Annuler** la commande (confirmation « remboursement traité ») : Jean revient à 2/10 avec 1 récompense disponible.
11. Fermer et rouvrir le navigateur : tout est conservé.
12. **Paramètres → Réinitialiser les données de démonstration**.

Ce parcours est aussi automatisé dans `tests/store.test.ts`. Les règles d'encaissement et de fidélité (20 scénarios) sont couvertes par `tests/payment-loyalty.test.ts`.

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
- L'entrée *Carte* de la maquette n'est pas développée. *Statistiques* existe sous forme de module facultatif (masquable dans Paramètres).
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
- ~~Frais de livraison~~ : **réglé le 30/10/2026**, la livraison est toujours offerte (0 €, sans exception, non modifiable).
- Liste des pizzas éligibles (actuellement Margarita, Reine, Fromage, Napolitaine, Anchois) et des grandes bouteilles (Coca, Fanta, Sprite 1,5 L).
- Numérotation des commandes remise à 1 à la fin de service, seulement s'il ne reste aucune commande affichée (en cours ou terminée non encaissée).
- Plusieurs récompenses dans une même commande : une seule pizza payante suffit actuellement (règle « au moins une pizza payante »). À confirmer si le gérant veut une pizza payante par cadeau.
