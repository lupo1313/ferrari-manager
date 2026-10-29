import type { Catalog, Product, Topping } from '../domain/types';
import { euros } from '../domain/money';

/**
 * CARTE DE DÉMONSTRATION.
 * Noms, compositions et prix sont provisoires (repris de la maquette validée).
 * Pour passer sur la vraie carte : remplacer ces tableaux, en conservant des `id` stables
 * (ils sont référencés par la liste des récompenses fidélité dans les paramètres).
 */

const pizza = (
  id: string,
  name: string,
  price: number,
  ingredients: string[],
  tags: Product['tags'],
): Product => ({
  id,
  name,
  category: 'pizza',
  price: euros(price),
  ingredients,
  description: ingredients.join(', '),
  tags,
});

const pizzas: Product[] = [
  pizza('margarita', 'Margarita', 10, ['Tomate', 'Mozzarella', 'Basilic'], ['classique', 'vegetarienne']),
  pizza('reine', 'Reine', 12, ['Tomate', 'Mozzarella', 'Jambon', 'Champignons'], ['classique', 'viande']),
  pizza('quatre-fromages', '4 fromages', 13, ['Tomate', 'Mozzarella', 'Chèvre', 'Gorgonzola', 'Parmesan'], ['classique', 'vegetarienne']),
  pizza('napolitaine', 'Napolitaine', 12, ['Tomate', 'Mozzarella', 'Anchois', 'Câpres', 'Olives'], ['classique']),
  pizza('chevre-miel', 'Chèvre Miel', 14, ['Tomate', 'Mozzarella', 'Chèvre', 'Miel', 'Noix'], ['speciale', 'vegetarienne']),
  pizza('royale', 'Royale', 14, ['Tomate', 'Mozzarella', 'Jambon', 'Champignons', 'Œuf'], ['speciale', 'viande']),
  pizza('calzone', 'Calzone (fermée)', 13, ['Tomate', 'Mozzarella', 'Jambon', 'Œuf'], ['speciale', 'viande']),
  pizza('burrata', 'Burrata', 15, ['Tomate', 'Burrata', 'Roquette', 'Tomates cerises'], ['speciale', 'vegetarienne']),
  pizza('pizza-burger', 'Pizza Burger', 15, ['Tomate', 'Mozzarella', 'Viande hachée', 'Oignons', 'Cheddar'], ['speciale', 'viande']),
  pizza('vegetarienne', 'Végétarienne', 13, ['Tomate', 'Mozzarella', 'Poivrons', 'Courgettes', 'Oignons', 'Olives'], ['vegetarienne']),
  pizza('fromage', 'Fromage', 13, ['Tomate', 'Mozzarella'], ['classique', 'vegetarienne']),
  pizza('anchois', 'Anchois', 13, ['Tomate', 'Mozzarella', 'Anchois', 'Olives'], ['classique']),
  pizza('blanche-lardons', 'Savoyarde', 14, ['Crème fraîche', 'Mozzarella', 'Pommes de terre', 'Lardons', 'Reblochon'], ['blanche', 'viande']),
  pizza('blanche-saumon', 'Saumon', 15, ['Crème fraîche', 'Mozzarella', 'Saumon fumé', 'Aneth', 'Citron'], ['blanche']),
  pizza('blanche-chevre', 'Chèvre Crème', 13, ['Crème fraîche', 'Mozzarella', 'Chèvre', 'Olives'], ['blanche', 'vegetarienne']),
];

const drink = (id: string, name: string, price: number, description: string, alcohol = false): Product => ({
  id,
  name,
  category: 'boisson',
  price: euros(price),
  description,
  alcohol,
});

const drinks: Product[] = [
  drink('coca-33', 'Coca-Cola 33cl', 2.5, 'Canette 33 cl'),
  drink('coca-150', 'Coca-Cola 1,5L', 4, 'Bouteille 1,5 L'),
  drink('fanta-33', 'Fanta 33cl', 2.5, 'Canette 33 cl'),
  drink('fanta-150', 'Fanta 1,5L', 4, 'Bouteille 1,5 L'),
  drink('sprite-33', 'Sprite 33cl', 2.5, 'Canette 33 cl'),
  drink('sprite-150', 'Sprite 1,5L', 4, 'Bouteille 1,5 L'),
  drink('icetea-150', 'Ice Tea 1,5L', 4, 'Bouteille 1,5 L'),
  drink('eau-50', 'Eau minérale 50cl', 1.5, 'Bouteille 50 cl'),
  drink('biere-33', 'Bière italienne 33cl', 3.5, 'Bouteille 33 cl · alcool', true),
  drink('vin-rose-75', 'Vin rosé 75cl', 14, 'Bouteille 75 cl · alcool', true),
  drink('vin-rouge-75', 'Vin rouge 75cl', 15, 'Bouteille 75 cl · alcool', true),
];

const dessert = (id: string, name: string, price: number, description: string): Product => ({
  id,
  name,
  category: 'dessert',
  price: euros(price),
  description,
});

const desserts: Product[] = [
  dessert('tiramisu', 'Tiramisu maison', 5, 'Mascarpone, café, cacao'),
  dessert('panna-cotta', 'Panna cotta', 4.5, 'Coulis de fruits rouges'),
  dessert('fondant', 'Fondant au chocolat', 5, 'Cœur coulant'),
  dessert('pizza-nutella', 'Pizza Nutella', 9, 'Pâte à pizza, Nutella, sucre glace'),
];

const topping = (id: string, name: string, price: number): Topping => ({ id, name, price: euros(price) });

const toppings: Topping[] = [
  topping('oeuf', 'Œuf', 1),
  topping('mozzarella', 'Mozzarella', 1),
  topping('jambon', 'Jambon', 1.5),
  topping('champignons', 'Champignons', 1),
  topping('olives', 'Olives', 1),
  topping('anchois', 'Anchois', 1.5),
  topping('chevre', 'Chèvre', 1.5),
  topping('miel', 'Miel', 0.5),
  topping('oignons', 'Oignons', 0.5),
  topping('poivrons', 'Poivrons', 0.5),
  topping('viande-hachee', 'Viande hachée', 2),
  topping('chorizo', 'Chorizo', 1.5),
];

export const demoCatalog: Catalog = {
  products: [...pizzas, ...drinks, ...desserts],
  toppings,
};
