import type { Settings } from '../domain/types';
import { euros } from '../domain/money';

export const defaultSettings: Settings = {
  pizzeria: {
    name: 'Pizzeria Ferrari',
    address: '178 rue Ferrari, 13005 Marseille',
    phone: '04 91 42 86 02',
  },
  // Valeur de démonstration (maquette) : à ajuster dans Paramètres.
  deliveryFee: euros(2),
  ticketWidthMm: 80,
  loyalty: {
    pizzasPerReward: 10,
    // Liste volontairement restreinte : toutes les pizzas ne sont pas éligibles.
    eligiblePizzaIds: ['margarita', 'reine', 'fromage', 'napolitaine', 'anchois'],
    eligibleDrinkIds: ['coca-150', 'fanta-150', 'sprite-150'],
    awardOn: 'validation',
  },
};
