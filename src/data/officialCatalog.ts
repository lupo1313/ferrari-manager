import type { Catalog, Product } from '../domain/types';
import { demoCatalog } from './catalog';

/** Carte transmise et validée par le gérant le 06/11/2026. Prix en centimes. */
export const OFFICIAL_EDITION = 'ferrari-2026-11';
const rows = [
  {
    "name": "Fromage",
    "price": 1050,
    "ingredients": [
      "Sauce tomate",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "fromage"
  },
  {
    "name": "Anchois",
    "price": 1050,
    "ingredients": [
      "Sauce tomate",
      "anchois",
      "olives",
      "persillade"
    ],
    "pizzaBase": "tomate",
    "id": "anchois"
  },
  {
    "name": "Fromage/Anchois",
    "price": 1050,
    "ingredients": [
      "Sauce tomate",
      "emmental",
      "anchois",
      "olives",
      "persillade"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-fromage-anchois"
  },
  {
    "name": "Mozzarella",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "emmental",
      "mozzarella",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-mozzarella"
  },
  {
    "name": "Jambon",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "jambon",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-jambon"
  },
  {
    "name": "Chorizo",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "chorizo",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-chorizo"
  },
  {
    "name": "Figatelli",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "figatelli",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-figatelli"
  },
  {
    "name": "Thon",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "thon",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-thon"
  },
  {
    "name": "Chèvre",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "chèvre",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-chevre"
  },
  {
    "name": "Champignons",
    "price": 1100,
    "ingredients": [
      "Sauce tomate",
      "champignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-champignons"
  },
  {
    "name": "Royale",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "jambon",
      "champignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "royale"
  },
  {
    "name": "Pesto",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "pesto",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-pesto"
  },
  {
    "name": "Corse",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "figatelli",
      "brousse",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-corse"
  },
  {
    "name": "Parmesane",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "aubergines marinées",
      "parmesan",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-parmesane"
  },
  {
    "name": "Napolitaine",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "anchois",
      "câpres",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "napolitaine"
  },
  {
    "name": "3 Fromages",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "roquefort",
      "mozzarella",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-3-fromages"
  },
  {
    "name": "4 Fromages",
    "price": 1300,
    "ingredients": [
      "Sauce tomate",
      "roquefort",
      "chèvre",
      "mozzarella",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "quatre-fromages"
  },
  {
    "name": "Végétarienne",
    "price": 1300,
    "ingredients": [
      "Sauce tomate",
      "aubergines",
      "poivrons",
      "oignons",
      "champignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "vegetarienne"
  },
  {
    "name": "Provençale",
    "price": 1300,
    "ingredients": [
      "Sauce tomate",
      "pesto",
      "tomates fraîches",
      "ail",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-provencale"
  },
  {
    "name": "Mexicaine",
    "price": 1300,
    "ingredients": [
      "Sauce tomate",
      "poivrons",
      "oignons",
      "chorizo",
      "emmental",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-mexicaine"
  },
  {
    "name": "Arménienne",
    "price": 1400,
    "ingredients": [
      "Sauce tomate",
      "viande",
      "poivrons",
      "oignons",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-armenienne"
  },
  {
    "name": "Méditerranéenne",
    "price": 1400,
    "ingredients": [
      "Sauce tomate",
      "fruits de mer",
      "ail",
      "persil",
      "huile d'olive",
      "olives"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-mediterraneenne"
  },
  {
    "name": "Corsica",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "chorizo",
      "brousse",
      "emmental"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-corsica"
  },
  {
    "name": "Italienne",
    "price": 1200,
    "ingredients": [
      "Sauce tomate",
      "tomates fraîches",
      "oignons",
      "poivrons",
      "jambon",
      "mozzarella"
    ],
    "pizzaBase": "tomate",
    "id": "ferrari-tomate-italienne"
  },
  {
    "name": "Chèvre Miel",
    "price": 1200,
    "ingredients": [
      "Crème fraîche",
      "chèvre",
      "miel",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "chevre-miel"
  },
  {
    "name": "Lorraine",
    "price": 1200,
    "ingredients": [
      "Crème fraîche",
      "lardons",
      "oignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-lorraine"
  },
  {
    "name": "Ferrari",
    "price": 1200,
    "ingredients": [
      "Crème fraîche",
      "jambon",
      "brousse",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-ferrari"
  },
  {
    "name": "Poulet",
    "price": 1200,
    "ingredients": [
      "Crème fraîche",
      "poulet",
      "champignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-poulet"
  },
  {
    "name": "3 Fromages",
    "price": 1200,
    "ingredients": [
      "Crème fraîche",
      "roquefort",
      "mozzarella",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-3-fromages"
  },
  {
    "name": "Curry",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "curry",
      "oignons",
      "emmental",
      "poulet"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-curry"
  },
  {
    "name": "Kebab",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "kebab",
      "oignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-kebab"
  },
  {
    "name": "Crémière",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "jambon",
      "champignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-cremiere"
  },
  {
    "name": "Fermière",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "lardons",
      "champignons",
      "oignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-fermiere"
  },
  {
    "name": "Tartiflette",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "lardons",
      "oignons",
      "reblochon",
      "pommes de terre",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-tartiflette"
  },
  {
    "name": "Paysanne",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "lardons",
      "brousse",
      "oignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-paysanne"
  },
  {
    "name": "Corsoise",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "figatelli",
      "brousse",
      "oignons",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-corsoise"
  },
  {
    "name": "4 Fromages",
    "price": 1300,
    "ingredients": [
      "Crème fraîche",
      "roquefort",
      "chèvre",
      "mozzarella",
      "emmental",
      "olives"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-4-fromages"
  },
  {
    "name": "Milano",
    "price": 1000,
    "ingredients": [
      "Crème fraîche",
      "lardons",
      "oignons",
      "emmental"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-milano"
  },
  {
    "name": "Carmela",
    "price": 1000,
    "ingredients": [
      "Crème fraîche",
      "viande hachée",
      "reblochon",
      "mozzarella",
      "emmental"
    ],
    "pizzaBase": "creme",
    "id": "ferrari-creme-carmela"
  }
] as const;

export const officialPizzas: Product[] = rows.map((p) => ({
  ...p, category: 'pizza', ingredients: [...p.ingredients], description: p.ingredients.join(', '),
  tags: p.pizzaBase === 'creme' ? ['blanche'] : [],
  ...(['Arménienne', 'Méditerranéenne'].includes(p.name) ? { notice: 'À commander avant 12 h' } : {}),
}));
export const officialCatalog: Catalog = {
  products: [...officialPizzas, ...demoCatalog.products.filter((p) => p.category !== 'pizza')],
  toppings: demoCatalog.toppings,
};
