import type { Cart, Catalog, Customer, LoyaltyEvent, Order } from '../domain/types';
import type { IdFactory } from '../domain/ids';
import type { AppData } from '../storage/schema';
import { SCHEMA_VERSION } from '../storage/schema';
import { addProduct, emptyCart } from '../domain/cart';
import { buildCustomer, EMPTY_CUSTOMER_INPUT, type CustomerInput } from '../domain/customers';
import { buildOrder, withStatus } from '../domain/orders';
import { reconcileOrderLoyalty } from '../domain/loyalty';
import { serviceIdFromStart } from '../domain/service';
import { defaultSettings } from './defaultSettings';

/**
 * Données de démonstration : toutes FICTIVES.
 * Ne jamais saisir de véritables données clients dans cette version de test.
 */

interface DemoCustomer {
  input: Partial<CustomerInput>;
  /** Historique de fidélité repris (pizzas déjà comptabilisées). */
  points: number;
}

const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    input: {
      firstName: 'Jean',
      lastName: 'Dupont',
      phone: '06 12 34 56 78',
      address: '15 rue de Rome',
      postalCode: '13001',
      complement: '2ème étage, interphone 12',
      instructions: 'Porte bleue. Sonner deux fois.',
    },
    points: 12, // 1 récompense disponible + 2/10 vers la suivante
  },
  {
    input: {
      firstName: 'Marie',
      lastName: 'Lambert',
      phone: '06 98 76 54 32',
      address: '42 boulevard Baille',
      postalCode: '13005',
      complement: 'Bât. B, code 4512',
      instructions: 'Appeler en arrivant, ne pas sonner (bébé).',
    },
    points: 8,
  },
  {
    input: {
      firstName: 'Karim',
      lastName: 'Benali',
      phone: '07 45 12 36 98',
      address: '7 rue Sainte',
      postalCode: '13001',
      complement: '4e étage sans ascenseur',
      instructions: '',
    },
    points: 23, // 2 récompenses disponibles
  },
  {
    input: {
      firstName: 'Sophie',
      lastName: 'Martin',
      phone: '06 23 45 67 89',
      address: '3 rue d’Endoume',
      postalCode: '13007',
      complement: '',
      instructions: 'Allergique aux noix.',
    },
    points: 0,
  },
  {
    input: {
      firstName: 'Lucas',
      lastName: 'Moreau',
      phone: '06 11 22 33 44',
    },
    points: 4,
  },
];

export function buildDemoData(catalog: Catalog, now: Date, newId: IdFactory): AppData {
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const settings = structuredClone(defaultSettings);

  const customers: Customer[] = DEMO_CUSTOMERS.map((d, i) =>
    buildCustomer({ ...EMPTY_CUSTOMER_INPUT, ...d.input }, newId('cus'), iso(60 * 24 * (30 - i))),
  );

  let events: LoyaltyEvent[] = DEMO_CUSTOMERS.flatMap((d, i) =>
    d.points > 0
      ? [{
          id: newId('loy'),
          at: iso(60 * 24 * 7),
          customerId: customers[i].id,
          orderId: null,
          type: 'points' as const,
          delta: d.points,
          reason: 'reprise_demo' as const,
          label: 'Historique fictif',
        }]
      : [],
  );

  const product = (id: string) => {
    const p = catalog.products.find((x) => x.id === id);
    if (!p) throw new Error(`Produit de démo introuvable : ${id}`);
    return p;
  };

  // Service de démonstration ouvert depuis deux heures.
  const serviceStartedAt = iso(120);
  const serviceId = serviceIdFromStart(serviceStartedAt);

  // Deux commandes en cours pour que l'écran de suivi ne soit pas vide.
  const orders: Order[] = [];

  let cart: Cart = { ...emptyCart(newId('ord')), customerId: customers[1].id, mode: 'livraison' };
  cart = addProduct(cart, product('reine'), newId('lin'));
  cart = addProduct(cart, product('coca-150'), newId('lin'));
  let order = buildOrder(cart, { id: cart.draftId, number: 1, nowIso: iso(18), customer: customers[1], serviceId });
  order = withStatus(order, 'en_preparation', iso(12));
  orders.push(order);

  let counter: Cart = { ...emptyCart(newId('ord')), counterName: 'Paul', mode: 'emporter' };
  counter = addProduct(counter, product('margarita'), newId('lin'));
  counter = addProduct(counter, product('margarita'), newId('lin'));
  orders.push(buildOrder(counter, { id: counter.draftId, number: 2, nowIso: iso(6), customer: null, serviceId }));

  for (const o of orders) {
    events = [...events, ...reconcileOrderLoyalty(events, o, { nowIso: o.createdAt, newId })];
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    customers,
    orders,
    loyaltyEvents: events,
    settings,
    counters: { nextOrderNumber: 3 },
    cart: emptyCart(newId('ord')),
    serviceStartedAt,
    serviceOpen: true,
    serviceClosedAt: null,
    services: [{ id: serviceId, openedAt: serviceStartedAt, closedAt: null }],
  };
}
