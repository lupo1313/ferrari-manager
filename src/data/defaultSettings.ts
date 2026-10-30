import type { Settings } from '../domain/types';

// Livraison : pas de réglage, elle est toujours offerte (voir DELIVERY_FEE dans domain/pricing).
export const defaultSettings: Settings = {
  pizzeria: {
    name: 'Pizzeria Ferrari',
    address: '178 rue Ferrari, 13005 Marseille',
    phone: '04 91 42 86 02',
  },
  ticketWidthMm: 80,
  paymentSound: true,
  paymentSoundKind: 'caisse',
  loyalty: {
    pizzasPerReward: 10,
    // Liste volontairement restreinte : toutes les pizzas ne sont pas éligibles.
    eligiblePizzaIds: ['margarita', 'reine', 'fromage', 'napolitaine', 'anchois'],
    eligibleDrinkIds: ['coca-150', 'fanta-150', 'sprite-150'],
  },
  modules: { statistiques: true },
};
