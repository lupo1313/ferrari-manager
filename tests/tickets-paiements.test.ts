import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { CART_KEY, STORAGE_KEY, createMemoryRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { computeBalance } from '../src/domain/loyalty';
import { parseEuros } from '../src/domain/money';
import { orderToCart } from '../src/domain/orders';
import {
  canPlanPayment,
  isPaid,
  paidGap,
  paidLabel,
  paidTenders,
  planBreakdown,
  planLabel,
  tendersProblem,
} from '../src/domain/payment';
import { buildDeliveryTicket, buildKitchenTicket, ticketKindsFor } from '../src/domain/ticket';
import { availablePeriods, computePeriodStats } from '../src/modules/statistiques/calculs';
import { backupToText, createBackup, verifyBackupText, type ReadableStore } from '../src/storage/export';
import { partsFromSplit } from '../src/components/orders/TenderSplit';
import type { CustomerInput } from '../src/domain/customers';
import type { Order, PaymentPart } from '../src/domain/types';

/** Store de test réel (dépôt mémoire), horloge réglable. */
function setup(repo = createMemoryRepository()) {
  let n = 0;
  const clock = { time: new Date('2026-10-30T19:00:00') };
  const store = createAppStore({ repo, catalog: demoCatalog, seed: buildDemoData, now: () => clock.time, newId: (p) => `${p}_${++n}` });
  const customer = (lastName: string) => store.getData().customers.find((c) => c.lastName === lastName)!;
  const get = (id: string) => store.getData().orders.find((o) => o.id === id)!;
  const points = (customerId: string) => computeBalance(store.getData().loyaltyEvents, customerId, store.getData().settings.loyalty).totalPoints;
  /** Commande enregistrée par le vrai store. */
  const order = (opts: { customerId?: string | null; mode?: 'livraison' | 'emporter'; products?: string[]; plan?: Parameters<typeof store.setCartPaymentPlan>[0]; extra?: () => void } = {}) => {
    store.selectCustomer(opts.customerId === undefined ? customer('Dupont').id : opts.customerId);
    store.setMode(opts.mode ?? 'emporter');
    for (const p of opts.products ?? ['reine']) store.addProduct(p);
    opts.extra?.();
    if (opts.plan !== undefined) {
      const r = store.setCartPaymentPlan(opts.plan);
      if (!r.ok) throw new Error(r.error);
    }
    const r = store.validateCart();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  return { store, repo, clock, customer, get, points, order };
}

const settingsOf = (t: ReturnType<typeof setup>) => t.store.getData().settings;
const cents = (euros: number) => Math.round(euros * 100);

/** Client fictif avec tous les repères de livraison renseignés. */
const fullAddress: CustomerInput = {
  firstName: 'Claire',
  lastName: 'Fabre',
  phone: '06 55 44 33 22',
  address: '128 boulevard de la Libération',
  postalCode: '13004',
  city: 'Marseille',
  complement: 'Résidence Les Jardins, porte gauche',
  building: 'C',
  floor: '5e',
  intercom: 'Fabre',
  doorCode: '4B27A',
  instructions: 'Sonner deux fois.',
};

describe('tickets : un ticket cuisine pour une commande à emporter', () => {
  it('cuisine seulement, sans coordonnées ni paiement, numéro et mode bien visibles', () => {
    const t = setup();
    const o = t.order({ mode: 'emporter', products: ['reine', 'coca-150'] });
    expect(ticketKindsFor(o)).toEqual(['cuisine']);
    expect(buildDeliveryTicket(o, settingsOf(t))).toBeNull();
    const k = buildKitchenTicket(o, settingsOf(t));
    expect(k.headline).toBe(`COMMANDE N° ${o.number} · À EMPORTER`);
    expect(k.groups.map((g) => g.title)).toEqual(['PIZZAS', 'BOISSONS']);
    expect(k.pizzaCount).toBe(1);
    const text = JSON.stringify(k);
    expect(text).not.toContain('€');
    expect(text).not.toContain('0612345678');
    expect(text).not.toContain('06 12 34 56 78');
    expect(text).not.toContain('rue de Rome');
    expect(k.customerName).toBe('Jean Dupont');
  });

  it('personnalisations, ingrédients retirés, suppléments, notes de ligne et de commande', () => {
    const t = setup();
    const o = t.order({
      products: ['reine', 'margarita'],
      extra: () => {
        const lines = t.store.getData().cart.lines;
        const mozza = demoCatalog.toppings.find((x) => x.id === 'mozzarella')!;
        t.store.updateLine(lines[0].id, { removedIngredients: ['Champignons'], addedToppings: [{ ...mozza }], quantity: 2 });
        t.store.updateLine(lines[1].id, { note: 'Bien cuite' });
        t.store.setOrderNote('Couper en 8');
      },
    });
    const k = buildKitchenTicket(o, settingsOf(t));
    const pizzas = k.groups[0].lines;
    expect(pizzas[0]).toEqual({ quantity: 2, name: 'REINE', details: ['Sans champignons', '+ Mozzarella'] });
    expect(pizzas[1]).toEqual({ quantity: 1, name: 'MARGARITA', details: ['Note : Bien cuite'] });
    expect(k.note).toBe('Couper en 8');
    expect(k.pizzaCount).toBe(3);
  });
});

describe('tickets : deux tickets pour une livraison', () => {
  it('cuisine et livreur ; adresse complète et tous les repères renseignés', () => {
    const t = setup();
    const c = t.store.createCustomer(fullAddress);
    if (!c.ok) throw new Error(c.error);
    const o = t.order({ customerId: c.value.id, mode: 'livraison', products: ['reine', 'tiramisu', 'coca-150'] });
    expect(ticketKindsFor(o)).toEqual(['cuisine', 'livreur']);
    const d = buildDeliveryTicket(o, settingsOf(t))!;
    expect(d.headline).toBe(`COMMANDE N° ${o.number} · LIVRAISON`);
    expect(d.customer).toEqual({
      name: 'Claire Fabre',
      phone: '06 55 44 33 22',
      addressLines: ['128 boulevard de la Libération', '13004 Marseille'],
      details: [
        { label: 'Bâtiment', value: 'C' },
        { label: 'Étage', value: '5e' },
        { label: 'Interphone', value: 'Fabre' },
        { label: 'Digicode', value: '4B27A' },
        { label: 'Complément', value: 'Résidence Les Jardins, porte gauche' },
      ],
      instructions: 'Sonner deux fois.',
    });
    expect(d.itemCount).toBe(3);
    expect(d.total).toBe('21,00 €');
    expect(d.historicFee).toBeNull();
    // Le ticket cuisine de la même commande reste sans adresse.
    expect(JSON.stringify(buildKitchenTicket(o, settingsOf(t)))).not.toContain('Libération');
  });

  it('champs facultatifs absents : aucune ligne vide (ancienne fiche sans repères)', () => {
    const t = setup();
    const lambert = t.customer('Lambert'); // fiche de démonstration : complément seul
    const o = t.order({ customerId: lambert.id, mode: 'livraison' });
    const d = buildDeliveryTicket(o, settingsOf(t))!;
    expect(d.customer!.details).toEqual([{ label: 'Complément', value: 'Bât. B, code 4512' }]);
    // Instantané d'une commande d'avant l'intervention 5 (sans champs de repères) : même résultat.
    const old: Order = { ...o, customer: { ...o.customer!, building: undefined, floor: undefined, intercom: undefined, doorCode: undefined } };
    expect(buildDeliveryTicket(old, settingsOf(t))!.customer!.details).toEqual([{ label: 'Complément', value: 'Bât. B, code 4512' }]);
  });
});

describe('ticket livreur : bloc paiement', () => {
  it('commande à encaisser sans mode renseigné : « MODE DE PAIEMENT À CONFIRMER »', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison', products: ['reine', 'reine', 'coca-150'] });
    const p = buildDeliveryTicket(o, settingsOf(t))!.payment;
    expect(p.headline).toBe('À ENCAISSER : 28,00 €');
    expect(p.rows).toEqual([]);
    expect(p.notes).toEqual(['MODE DE PAIEMENT À CONFIRMER']);
  });

  it('répartition prévue : affichée comme « Mode prévu », jamais comme un paiement effectué', () => {
    const t = setup();
    const o = t.order({
      mode: 'livraison',
      products: ['reine', 'reine', 'coca-150'],
      plan: { type: 'mixte', parts: [{ kind: 'especes', amount: 1000 }, { kind: 'carte', amount: 1800 }] },
    });
    expect(isPaid(o)).toBe(false);
    const p = buildDeliveryTicket(o, settingsOf(t))!.payment;
    expect(p.headline).toBe('À ENCAISSER : 28,00 €');
    expect(p.rowsTitle).toBe('Mode prévu');
    expect(p.rows).toEqual([
      { label: 'Espèces', amount: '10,00 €' },
      { label: 'Carte bancaire', amount: '18,00 €' },
    ]);
    expect(p.notes).toEqual([]);
    expect(JSON.stringify(p)).not.toContain('PAYÉE');
  });

  it('répartition incomplète : le montant non affecté est affiché, rien n’est inventé', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison', products: ['reine', 'reine', 'coca-150'], plan: { type: 'mixte', parts: [{ kind: 'titres_restaurant', amount: 1000 }] } });
    const p = buildDeliveryTicket(o, settingsOf(t))!.payment;
    expect(p.rows).toEqual([
      { label: 'Titres-restaurant', amount: '10,00 €' },
      { label: 'Non affecté', amount: '18,00 €' },
    ]);
  });

  it('commande déjà encaissée : « COMMANDE DÉJÀ PAYÉE », reste 0,00 €, détail de l’encaissement', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison', products: ['reine', 'reine', 'coca-150'] });
    t.store.markOrderPaid(o.id, [
      { kind: 'especes', amount: 1000 },
      { kind: 'carte', amount: 1800 },
    ]);
    const p = buildDeliveryTicket(t.get(o.id), settingsOf(t))!.payment;
    expect(p.headline).toBe('COMMANDE DÉJÀ PAYÉE');
    expect(p.dueLine).toBe('Reste à encaisser : 0,00 €');
    expect(p.rowsTitle).toBe('Payé');
    expect(p.rows).toEqual([
      { label: 'Espèces', amount: '10,00 €' },
      { label: 'Carte bancaire', amount: '18,00 €' },
    ]);
  });

  it('commande annulée, ancienne commande sans suivi, frais de livraison historiques', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison' });
    t.store.cancelOrder(o.id);
    expect(buildDeliveryTicket(t.get(o.id), settingsOf(t))!.payment.headline).toBe('COMMANDE ANNULÉE');

    const legacy: Order = { ...o, status: 'a_preparer', payment: { status: 'a_encaisser', method: null, paidAt: null, legacy: true }, totals: { subtotal: 1200, deliveryFee: 200, total: 1400 } };
    const d = buildDeliveryTicket(legacy, settingsOf(t))!;
    expect(d.payment.headline).toBe('PAIEMENT NON SUIVI');
    expect(d.payment.notes[0]).toContain('vérifier avec le gérant');
    expect(d.total).toBe('14,00 €');
    expect(d.historicFee).toBe('2,00 €');
  });
});

describe('impression : réimprimer ou annuler la boîte de dialogue ne change rien', () => {
  it('réimpression : seule la trace de demande d’impression s’ajoute', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison', products: ['reine', 'margarita'] });
    t.store.markOrderPaid(o.id, 'carte');
    t.store.setOrderStatus(o.id, 'en_preparation');
    const before = t.get(o.id);
    const events = t.store.getData().loyaltyEvents;
    t.store.recordPrintRequest(o.id);
    t.store.recordPrintRequest(o.id);
    const after = t.get(o.id);
    expect({ ...after, printRequests: [] }).toEqual({ ...before, printRequests: [] });
    expect(after.printRequests).toHaveLength(before.printRequests.length + 2);
    expect(t.store.getData().loyaltyEvents).toEqual(events);
  });

  it('une seule commande créée, que l’impression soit faite, annulée ou relancée', () => {
    const t = setup();
    const count = t.store.getData().orders.length;
    t.store.selectCustomer(t.customer('Dupont').id);
    t.store.setMode('livraison');
    t.store.addProduct('reine');
    const r = t.store.validateCart();
    expect(r.ok).toBe(true);
    // Boîte d'impression ouverte puis annulée, puis nouvel appui sur « Valider » (double clic, retour arrière).
    if (r.ok) t.store.recordPrintRequest(r.value.id);
    expect(t.store.validateCart().ok).toBe(false);
    expect(t.store.getData().orders).toHaveLength(count + 1);
  });
});

describe('paiements : moyens uniques', () => {
  for (const [kind, method] of [
    ['especes', 'especes'],
    ['carte', 'carte'],
    ['titres_restaurant', 'non_precise'],
  ] as const) {
    it(`${kind} : encaissement du total, résumé compatible « ${method} », fidélité créditée une fois`, () => {
      const t = setup();
      const o = t.order({ products: ['reine', 'margarita'] });
      const before = t.points(o.customerId!);
      const r = t.store.markOrderPaid(o.id, [{ kind, amount: o.totals.total }]);
      expect(r.ok && r.value.pointsCredited).toBe(2);
      const paid = t.get(o.id);
      expect(paid.payment).toMatchObject({ status: 'encaissee', method, tenders: [{ kind, amount: o.totals.total }] });
      expect(paidTenders(paid)).toEqual([{ kind, amount: o.totals.total }]);
      // Deuxième confirmation : aucun crédit en plus.
      t.store.markOrderPaid(o.id, [{ kind, amount: o.totals.total }]);
      expect(t.points(o.customerId!)).toBe(before + 2);
    });
  }

  it('« Non précisé » reste possible, sans détail inventé', () => {
    const t = setup();
    const o = t.order();
    t.store.markOrderPaid(o.id, 'non_precise');
    expect(t.get(o.id).payment.tenders).toBeUndefined();
    expect(paidLabel(t.get(o.id))).toBeNull();
  });
});

describe('paiements : paiement mixte', () => {
  it('répartition exacte : acceptée, fidélité créditée une seule fois', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'reine', 'margarita'], extra: () => t.store.addProduct('coca-150') }); // 38 €
    const parts: PaymentPart[] = [
      { kind: 'titres_restaurant', amount: 1000 },
      { kind: 'especes', amount: 1500 },
      { kind: 'carte', amount: 1300 },
    ];
    const r = t.store.markOrderPaid(o.id, parts);
    expect(r.ok && r.value.pointsCredited).toBe(3);
    const paid = t.get(o.id);
    expect(paid.payment.method).toBe('non_precise');
    // Ordre fixe : espèces, carte, titres-restaurant.
    expect(paid.payment.tenders).toEqual([
      { kind: 'especes', amount: 1500 },
      { kind: 'carte', amount: 1300 },
      { kind: 'titres_restaurant', amount: 1000 },
    ]);
    expect(paidLabel(paid)).toBe('Espèces 15,00 € + Carte bancaire 13,00 € + Titres-restaurant 10,00 €');
  });

  it('montants incohérents : refusés sans rien écrire (reste, dépassement, négatif, centimes invalides, zéro)', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'margarita'] }); // 22 €
    const saves = t.repo.control.saves;
    const events = t.store.getData().loyaltyEvents;
    const cases: [PaymentPart[], string][] = [
      [[{ kind: 'especes', amount: 1000 }], 'Il reste 12,00 €'],
      [[{ kind: 'especes', amount: 1500 }, { kind: 'carte', amount: 1500 }], 'dépasse le total de 8,00 €'],
      [[{ kind: 'especes', amount: -200 }, { kind: 'carte', amount: 2400 }], 'Montant invalide'],
      [[{ kind: 'especes', amount: 1000.5 }, { kind: 'carte', amount: 1199.5 }], 'Montant invalide'],
      [[], 'au moins un montant'],
    ];
    for (const [parts, message] of cases) {
      const r = t.store.markOrderPaid(o.id, parts);
      expect(!r.ok && r.error).toContain(message);
    }
    expect(t.get(o.id).payment.status).toBe('a_encaisser');
    expect(t.repo.control.saves).toBe(saves);
    expect(t.store.getData().loyaltyEvents).toEqual(events);
  });

  it('centimes : saisie convertie en entiers, aucune erreur d’arrondi', () => {
    expect(parseEuros('0,10')! + parseEuros('0,20')!).toBe(30);
    const parts = partsFromSplit({ especes: '10,10', carte: '13,40', titres_restaurant: '' })!;
    expect(parts).toEqual([
      { kind: 'especes', amount: 1010 },
      { kind: 'carte', amount: 1340 },
    ]);
    expect(tendersProblem(parts, 2350)).toBeNull();
    expect(partsFromSplit({ especes: '10,105', carte: '', titres_restaurant: '' })).toBeNull();
    expect(partsFromSplit({ especes: '-5', carte: '', titres_restaurant: '' })).toBeNull();
    expect(partsFromSplit({ especes: 'abc', carte: '', titres_restaurant: '' })).toBeNull();
    // Total à centimes : 3 × 7,77 € réparti au centime près.
    expect(tendersProblem([{ kind: 'especes', amount: cents(11.65) }, { kind: 'carte', amount: cents(11.66) }], cents(23.31))).toBeNull();
  });

  it('correction de la répartition d’une commande déjà encaissée : date d’origine conservée, aucun point en plus', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'margarita'] });
    t.store.markOrderPaid(o.id, [{ kind: 'especes', amount: 2200 }]);
    const paidAt = t.get(o.id).payment.paidAt;
    const pts = t.points(o.customerId!);
    t.clock.time = new Date('2026-10-30T19:30:00');
    expect(t.store.markOrderPaid(o.id, [{ kind: 'especes', amount: 1200 }, { kind: 'carte', amount: 1000 }]).ok).toBe(true);
    expect(t.get(o.id).payment.paidAt).toBe(paidAt);
    expect(t.get(o.id).payment.tenders).toEqual([
      { kind: 'especes', amount: 1200 },
      { kind: 'carte', amount: 1000 },
    ]);
    expect(t.points(o.customerId!)).toBe(pts);
  });
});

describe('paiements : modification, annulation, fidélité', () => {
  it('modifier une commande encaissée en mixte : reste encaissée, écart signalé, fidélité recalculée sans double crédit', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'margarita'] }); // 22 €
    t.store.markOrderPaid(o.id, [{ kind: 'especes', amount: 1000 }, { kind: 'carte', amount: 1200 }]);
    const pts = t.points(o.customerId!);
    t.store.startEditOrder(o.id);
    t.store.addProduct('reine'); // +12 €
    expect(t.store.validateCart().ok).toBe(true);
    const after = t.get(o.id);
    expect(isPaid(after)).toBe(true);
    expect(after.payment.tenders).toEqual([{ kind: 'especes', amount: 1000 }, { kind: 'carte', amount: 1200 }]);
    expect(paidGap(after)).toBe(1200);
    expect(buildDeliveryTicket({ ...after, mode: 'livraison' }, settingsOf(t))!.payment.notes[0]).toContain('écart de 12,00 €');
    expect(t.points(o.customerId!)).toBe(pts + 1);
    // Réenregistrée sans changement : rien de plus.
    t.store.startEditOrder(o.id);
    t.store.validateCart();
    expect(t.points(o.customerId!)).toBe(pts + 1);
  });

  it('annuler une commande encaissée (mixte) : points retirés, paiement conservé pour la trace', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'margarita'] });
    const before = t.points(o.customerId!);
    t.store.markOrderPaid(o.id, [{ kind: 'titres_restaurant', amount: 1200 }, { kind: 'especes', amount: 1000 }]);
    const r = t.store.cancelOrder(o.id);
    expect(r.ok && r.value).toMatchObject({ pointsReverted: 2, wasPaid: true });
    expect(t.points(o.customerId!)).toBe(before);
    expect(t.get(o.id).payment.tenders).toHaveLength(2);
  });

  it('annuler l’encaissement : le détail disparaît, les points sont retirés', () => {
    const t = setup();
    const o = t.order({ products: ['reine'] });
    t.store.markOrderPaid(o.id, [{ kind: 'carte', amount: 1200 }]);
    t.store.markOrderUnpaid(o.id);
    expect(t.get(o.id).payment).toEqual({ status: 'a_encaisser', method: null, paidAt: null });
    expect(paidTenders(t.get(o.id))).toEqual([]);
  });
});

describe('paiement prévu : une intention, jamais un encaissement', () => {
  it('copié sur la commande, sans effet sur le paiement ni la fidélité', () => {
    const t = setup();
    const before = t.points(t.customer('Dupont').id);
    const o = t.order({ products: ['reine', 'margarita'], plan: { type: 'unique', kind: 'especes' } });
    expect(o.paymentPlan).toEqual({ type: 'unique', kind: 'especes' });
    expect(o.payment.status).toBe('a_encaisser');
    expect(t.points(o.customerId!)).toBe(before);
    expect(planLabel(o.paymentPlan, o.totals.total)).toBe('Espèces');
  });

  it('moyen unique : suit le total si la commande est modifiée', () => {
    const t = setup();
    const o = t.order({ products: ['reine'], plan: { type: 'unique', kind: 'carte' } });
    t.store.startEditOrder(o.id);
    expect(t.store.getData().cart.paymentPlan).toEqual({ type: 'unique', kind: 'carte' });
    t.store.addProduct('margarita');
    t.store.validateCart();
    const after = t.get(o.id);
    expect(after.paymentPlan).toEqual({ type: 'unique', kind: 'carte' });
    expect(planBreakdown(after.paymentPlan!, after.totals.total).parts).toEqual([{ kind: 'carte', amount: 2200 }]);
  });

  it('répartition supérieure au total : refusée à la saisie, et à la validation si le total a baissé', () => {
    const t = setup();
    t.store.selectCustomer(t.customer('Dupont').id);
    t.store.addProduct('reine');
    t.store.addProduct('margarita');
    expect(t.store.setCartPaymentPlan({ type: 'mixte', parts: [{ kind: 'especes', amount: 3000 }] }).ok).toBe(false);
    expect(t.store.setCartPaymentPlan({ type: 'mixte', parts: [{ kind: 'especes', amount: 2000 }] }).ok).toBe(true);
    t.store.removeLine(t.store.getData().cart.lines[1].id); // total 12 € < 20 € prévus
    const r = t.store.validateCart();
    expect(!r.ok && r.error).toContain('dépasse le total de 8,00 €');
  });

  it('depuis la carte de commande : modifiable tant que la commande attend un encaissement suivi', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison' });
    expect(canPlanPayment(o)).toBe(true);
    const r = t.store.setOrderPaymentPlan(o.id, { type: 'mixte', parts: [{ kind: 'especes', amount: 500 }, { kind: 'carte', amount: 700 }] });
    expect(r.ok).toBe(true);
    expect(t.get(o.id).payment.status).toBe('a_encaisser');
    expect(buildDeliveryTicket(t.get(o.id), settingsOf(t))!.payment.rows).toHaveLength(2);
    t.store.markOrderPaid(o.id, 'carte');
    expect(t.store.setOrderPaymentPlan(o.id, null).ok).toBe(false);
    const legacy: Order = { ...o, payment: { status: 'a_encaisser', method: null, paidAt: null, legacy: true } };
    expect(canPlanPayment(legacy)).toBe(false);
  });

  it('aller-retour panier ↔ commande : le paiement prévu est conservé', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'reine'], plan: { type: 'mixte', parts: [{ kind: 'titres_restaurant', amount: 1000 }, { kind: 'especes', amount: 1400 }] } });
    expect(orderToCart(o).paymentPlan).toEqual(o.paymentPlan);
  });
});

describe('service fermé', () => {
  it('encaissement, paiement prévu et correction de statut possibles ; nouvelle commande refusée', () => {
    const t = setup();
    const o = t.order({ mode: 'livraison' });
    t.store.closeService();
    expect(t.store.setOrderPaymentPlan(o.id, { type: 'unique', kind: 'titres_restaurant' }).ok).toBe(true);
    expect(t.store.markOrderPaid(o.id, [{ kind: 'titres_restaurant', amount: o.totals.total }]).ok).toBe(true);
    expect(t.store.setOrderStatus(o.id, 'prete').ok).toBe(true);
    t.store.selectCustomer(t.customer('Martin').id);
    t.store.addProduct('reine');
    expect(t.store.validateCart().ok).toBe(false);
  });
});

describe('compatibilité', () => {
  it('le résumé « method » reste dans les valeurs que la version précédente sait relire', () => {
    const t = setup();
    const a = t.order();
    const b = t.order();
    const c = t.order();
    t.store.markOrderPaid(a.id, [{ kind: 'titres_restaurant', amount: a.totals.total }]);
    t.store.markOrderPaid(b.id, [{ kind: 'especes', amount: 600 }, { kind: 'carte', amount: b.totals.total - 600 }]);
    t.store.markOrderPaid(c.id, [{ kind: 'carte', amount: c.totals.total }]);
    const stored = JSON.parse(t.repo.raw()!);
    // Liste de la version précédente (storage/schema.ts de main avant l'intervention 5).
    for (const o of stored.orders) expect(['especes', 'carte', 'non_precise', null]).toContain(o.payment.method ?? null);
  });

  it('ancien encaissement (« carte » sans détail) : détail déduit, aucun écart supposé', () => {
    const t = setup();
    const o = t.order();
    const old: Order = { ...o, payment: { status: 'encaissee', method: 'carte', paidAt: o.createdAt }, totals: { ...o.totals, total: 1500 } };
    expect(paidTenders(old)).toEqual([{ kind: 'carte', amount: 1500 }]);
    expect(paidGap(old)).toBe(0);
  });

  it('anciennes données : chargées sans réécriture, fiches complétées en mémoire seulement', () => {
    const seeded = setup();
    const raw = JSON.parse(seeded.repo.raw()!);
    for (const c of raw.customers) for (const k of ['building', 'floor', 'intercom', 'doorCode']) delete c[k];
    for (const o of raw.orders) {
      delete o.paymentPlan;
      if (o.customer) for (const k of ['building', 'floor', 'intercom', 'doorCode']) delete o.customer[k];
    }
    const doc = JSON.stringify(raw);
    const repo = createMemoryRepository(undefined, doc, seeded.repo.rawCart()!);
    const t = setup(repo);
    expect(t.store.getPersistError()).toBeNull();
    expect(repo.raw()).toBe(doc);
    expect(repo.control.saves).toBe(0);
    expect(t.store.getData().customers.every((c) => c.building === '' && c.doorCode === '')).toBe(true);
    expect(t.store.getData().orders.map((o) => o.totals)).toEqual(raw.orders.map((o: Order) => o.totals));
  });

  it('clés de stockage inchangées et sauvegarde JSON toujours fonctionnelle avec les nouveaux champs', async () => {
    expect(STORAGE_KEY).toBe('ferrari-manager:v1');
    expect(CART_KEY).toBe('ferrari-manager:v1:panier');
    const t = setup();
    const o = t.order({ mode: 'livraison', plan: { type: 'unique', kind: 'especes' } });
    t.store.markOrderPaid(o.id, [{ kind: 'especes', amount: 500 }, { kind: 'titres_restaurant', amount: o.totals.total - 500 }]);
    const entries: Record<string, string> = { [STORAGE_KEY]: t.repo.raw()!, [CART_KEY]: t.repo.rawCart()! };
    const keys = Object.keys(entries);
    const store: ReadableStore = { length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => entries[k] ?? null };
    const backup = await createBackup(store, { now: new Date(), origin: 'test' });
    expect((await verifyBackupText(backupToText(backup))).ok).toBe(true);
    const restored = setup(createMemoryRepository(undefined, backup.stockage[STORAGE_KEY], backup.stockage[CART_KEY]));
    expect(restored.get(o.id)).toEqual(t.get(o.id));
  });

  it('statistiques : un paiement mixte compte une fois, pour le montant de la commande', () => {
    const t = setup();
    const o = t.order({ products: ['reine', 'margarita'] });
    t.store.markOrderPaid(o.id, [{ kind: 'especes', amount: 1000 }, { kind: 'titres_restaurant', amount: 1200 }]);
    const d = t.store.getData();
    const period = availablePeriods('service', d.services, false)[0];
    const s = computePeriodStats(period, d.orders, d.services, '2026-10-30T19:30:00.000Z');
    expect(s.paidCount).toBe(1);
    expect(s.paid).toBe(2200);
  });
});
