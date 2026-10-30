import { beforeEach, describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { CART_KEY, STORAGE_KEY, createMemoryRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { computeBalance } from '../src/domain/loyalty';
import { buildDeliveryTicket, buildKitchenTicket } from '../src/domain/ticket';
import { deliveryAddressKey, validTripFor } from '../src/domain/trip';
import { effectiveDeliveryAddress, emptyDeliveryAddress } from '../src/domain/delivery';
import { computeScooterTrip, GEOCODING_URL, resetTripCache } from '../src/services/trajet';
import { availablePeriods, computePeriodStats } from '../src/modules/statistiques/calculs';
import { backupToText, createBackup, verifyBackupText, type ReadableStore } from '../src/storage/export';
import type { DeliveryAddressInput, Order } from '../src/domain/types';

const PIZZERIA = '178 rue Ferrari, 13005 Marseille';

/** Réseau simulé : la distance renvoyée dépend de l'adresse géocodée (pour distinguer les trajets). */
const fetchFn = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith(GEOCODING_URL)) {
    const q = new URL(url).searchParams.get('q') ?? '';
    const lon = q.includes('Ferrari') ? 5.395 : q.includes('Sainte') ? 5.37 : 5.40;
    return { status: 200, json: async () => ({ features: [{ geometry: { coordinates: [lon, 43.29] }, properties: { score: 0.95, type: 'housenumber', label: q } }] }) } as Response;
  }
  const json = JSON.parse(new URL(url).searchParams.get('json')!);
  const km = Math.abs(json.locations[1].lon - json.locations[0].lon) * 100;
  return { status: 200, json: async () => ({ trip: { summary: { length: km, time: km * 240 } } }) } as Response;
}) as typeof fetch;

/** Adresse exceptionnelle : chez un ami, avec ses propres repères et consignes. */
const FRIEND: DeliveryAddressInput = {
  address: '22 boulevard Chave',
  postalCode: '13005',
  city: 'Marseille',
  building: 'A',
  floor: '3e',
  intercom: 'Leroy',
  doorCode: '1234',
  complement: 'Au fond de la cour',
  instructions: 'Appeler Karim en arrivant',
};

function setup(repo = createMemoryRepository()) {
  let n = 0;
  const store = createAppStore({ repo, catalog: demoCatalog, seed: buildDemoData, now: () => new Date('2026-10-30T19:00:00'), newId: (p) => `${p}_${++n}` });
  const byName = (lastName: string) => store.getData().customers.find((c) => c.lastName === lastName)!;
  const karim = byName('Benali');
  const get = (id: string) => store.getData().orders.find((o) => o.id === id)!;
  const startDelivery = (customerId = karim.id) => {
    store.selectCustomer(customerId);
    store.setMode('livraison');
    store.addProduct('reine');
    store.addProduct('margarita');
  };
  const trip = async () => {
    const customer = store.getData().customers.find((c) => c.id === store.getData().cart.customerId)!;
    const r = await computeScooterTrip(PIZZERIA, effectiveDeliveryAddress(store.getData().cart, customer), { fetchFn, routingUrl: 'https://r.test/route', minIntervalMs: 0 });
    if (!r.ok) throw new Error(r.message);
    const saved = store.setCartDeliveryTrip(r.trip);
    if (!saved.ok) throw new Error(saved.error);
    return r.trip;
  };
  const validate = () => {
    const r = store.validateCart();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  return { store, repo, karim, byName, get, startDelivery, trip, validate };
}

beforeEach(() => resetTripCache());

describe('adresse habituelle et adresse exceptionnelle', () => {
  it('1. client existant : son adresse habituelle est proposée et utilisée', () => {
    const t = setup();
    t.startDelivery();
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
    expect(effectiveDeliveryAddress(t.store.getData().cart, t.karim)!.address).toBe('7 rue Sainte');
    const o = t.validate();
    expect(o.customer!.address).toBe('7 rue Sainte');
    expect(o.customer!.addressOverridden).toBeUndefined();
  });

  it('2 et 3. livraison à une adresse exceptionnelle ; fiche client inchangée après validation', () => {
    const t = setup();
    const before = JSON.stringify(t.store.getData().customers);
    t.startDelivery();
    expect(t.store.setCartDeliveryAddress(FRIEND).ok).toBe(true);
    const o = t.validate();
    expect(o.customer).toMatchObject({ ...FRIEND, addressOverridden: true, name: 'Karim Benali', phone: t.karim.phone });
    expect(JSON.stringify(t.store.getData().customers)).toBe(before);
    expect(t.byName('Benali').address).toBe('7 rue Sainte');
  });

  it('nouvelle adresse saisie sur le formulaire vierge : aucun repère ni consigne du domicile repris', () => {
    const t = setup();
    t.store.updateCustomer(t.karim.id, {
      firstName: 'Karim',
      lastName: 'Benali',
      phone: t.karim.phone,
      address: '7 rue Sainte',
      postalCode: '13001',
      city: 'Marseille',
      complement: '4e étage sans ascenseur',
      doorCode: '0000',
      instructions: 'Chien méchant au domicile',
    });
    t.startDelivery();
    const blank = emptyDeliveryAddress(effectiveDeliveryAddress(t.store.getData().cart, t.byName('Benali'))!.city);
    expect(blank).toEqual({ address: '', postalCode: '', city: 'Marseille', building: '', floor: '', intercom: '', doorCode: '', complement: '', instructions: '' });
    t.store.setCartDeliveryAddress({ ...blank, address: '22 boulevard Chave', postalCode: '13005' });
    const o = t.validate();
    expect(o.customer).toMatchObject({ address: '22 boulevard Chave', complement: '', doorCode: '', instructions: '' });
    const text = JSON.stringify(buildDeliveryTicket(o, t.store.getData().settings));
    for (const old of ['4e étage', '0000', 'Chien méchant']) expect(text).not.toContain(old);
  });

  it('adresse incomplète ou trop longue : refusée, rien ne change', () => {
    const t = setup();
    t.startDelivery();
    const r = t.store.setCartDeliveryAddress({ ...FRIEND, postalCode: '130' });
    expect(!r.ok && r.fieldErrors?.postalCode).toBeTruthy();
    const r2 = t.store.setCartDeliveryAddress({ ...FRIEND, address: ' ' });
    expect(!r2.ok && r2.fieldErrors?.address).toBeTruthy();
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
  });

  it('4. adresse exceptionnelle conservée après rechargement (panier et commande enregistrée)', () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    expect(setup(t.repo).store.getData().cart.deliveryAddress).toEqual(FRIEND);
    const o = t.validate();
    expect(setup(t.repo).get(o.id).customer).toMatchObject(FRIEND);
  });

  it('5 et 6. ticket livreur : adresse exceptionnelle, ses repères et ses consignes, jamais celles du domicile', () => {
    const t = setup();
    t.store.updateCustomer(t.karim.id, {
      firstName: 'Karim',
      lastName: 'Benali',
      phone: t.karim.phone,
      address: '7 rue Sainte',
      postalCode: '13001',
      city: 'Marseille',
      complement: '4e étage sans ascenseur',
      intercom: 'Benali',
      instructions: 'Chien méchant au domicile',
    });
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    const o = t.validate();
    const d = buildDeliveryTicket(o, t.store.getData().settings)!;
    expect(d.customer!.addressLines).toEqual(['22 boulevard Chave', '13005 Marseille']);
    expect(d.customer!.details).toEqual([
      { label: 'Bâtiment', value: 'A' },
      { label: 'Étage', value: '3e' },
      { label: 'Interphone', value: 'Leroy' },
      { label: 'Digicode', value: '1234' },
      { label: 'Complément', value: 'Au fond de la cour' },
    ]);
    expect(d.customer!.instructions).toBe('Appeler Karim en arrivant');
    const text = JSON.stringify(d);
    for (const old of ['rue Sainte', '4e étage', 'Chien méchant']) expect(text).not.toContain(old);
  });

  it('7 et 8. trajet calculé pour la nouvelle adresse ; l’ancien est invalidé dès le changement', async () => {
    const t = setup();
    t.startDelivery();
    const home = await t.trip();
    expect(home.addressKey).toBe(deliveryAddressKey(t.karim));
    t.store.setCartDeliveryAddress(FRIEND);
    expect(t.store.getData().cart.deliveryTrip).toBeNull();
    // Un calcul lancé pour l'ancienne adresse et terminé après coup est refusé.
    expect(t.store.setCartDeliveryTrip(home).ok).toBe(false);
    const friend = await t.trip();
    expect(friend.addressKey).toBe(deliveryAddressKey(FRIEND));
    expect(friend.distanceM).not.toBe(home.distanceM);
    const o = t.validate();
    expect(o.deliveryTrip).toEqual(friend);
    expect(buildDeliveryTicket(o, t.store.getData().settings)!.trip).not.toBeNull();
  });

  it('modifier seulement le digicode ou les consignes : le trajet (même rue) reste valable', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    const trip = await t.trip();
    t.store.setCartDeliveryAddress({ ...FRIEND, doorCode: '9999', instructions: 'Sonner 2 fois' });
    expect(t.store.getData().cart.deliveryTrip).toEqual(trip);
  });

  it('9. retour à l’adresse habituelle : adresse et consignes de la fiche, trajet exceptionnel retiré', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    await t.trip();
    const r = t.store.setCartDeliveryAddress(null);
    expect(r.ok && r.value.usesHabitual).toBe(true);
    expect(t.store.getData().cart.deliveryTrip).toBeNull();
    const o = t.validate();
    expect(o.customer!.address).toBe('7 rue Sainte');
    expect(o.customer!.addressOverridden).toBeUndefined();
    // Saisir exactement l'adresse habituelle revient au même : rien de ponctuel n'est retenu.
    t.startDelivery();
    const same = t.store.setCartDeliveryAddress({ ...effectiveDeliveryAddress(t.store.getData().cart, t.karim)! });
    expect(same.ok && same.value.usesHabitual).toBe(true);
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
  });
});

describe('commandes existantes', () => {
  it('10. modification : l’adresse réellement enregistrée est reprise, même si la fiche a changé depuis', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    const trip = await t.trip();
    const o = t.validate();
    t.store.startEditOrder(o.id);
    expect(t.store.getData().cart.deliveryAddress).toEqual(FRIEND);
    expect(validTripFor(t.store.getData().cart.deliveryTrip, 'livraison', FRIEND)).toEqual(trip);
    t.store.addProduct('coca-150');
    const saved = t.validate();
    expect(saved.customer).toMatchObject({ ...FRIEND, addressOverridden: true });
    expect(saved.deliveryTrip).toEqual(trip);
    // Changer l'adresse de la commande existante : trajet caduc.
    t.store.startEditOrder(o.id);
    t.store.setCartDeliveryAddress({ ...FRIEND, address: '5 place Castellane', postalCode: '13006' });
    const moved = t.validate();
    expect(moved.customer!.address).toBe('5 place Castellane');
    expect(moved.deliveryTrip).toBeNull();
    expect(buildDeliveryTicket(moved, t.store.getData().settings)!.trip).toBeNull();
  });

  it('commande à l’adresse habituelle, rouverte sans changement : reste à l’adresse habituelle', () => {
    const t = setup();
    t.startDelivery();
    const o = t.validate();
    t.store.startEditOrder(o.id);
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
  });

  it('11. abandon de la modification : la commande enregistrée ne change pas', async () => {
    const t = setup();
    t.startDelivery();
    await t.trip();
    const o = t.validate();
    const before = t.get(o.id);
    const raw = t.repo.raw();
    t.store.startEditOrder(o.id);
    t.store.setCartDeliveryAddress(FRIEND);
    t.store.clearCart();
    expect(t.get(o.id)).toEqual(before);
    expect(t.repo.raw()).toBe(raw);
  });

  it('passage en « À emporter » : ni adresse exceptionnelle ni trajet sur la commande', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    await t.trip();
    t.store.setMode('emporter');
    const o = t.validate();
    expect(o.customer!.address).toBe('7 rue Sainte');
    expect(o.customer!.addressOverridden).toBeUndefined();
    expect(o.deliveryTrip).toBeNull();
    expect(buildDeliveryTicket(o, t.store.getData().settings)).toBeNull();
  });
});

describe('changement de client et nouvelle commande', () => {
  it('12. changement de client avant validation : adresse et trajet de Karim jamais transférés', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    await t.trip();
    const marie = t.byName('Lambert');
    const r = t.store.selectCustomer(marie.id);
    expect(r.ok && r.value.addressReset).toBe(true);
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
    expect(t.store.getData().cart.deliveryTrip).toBeNull();
    const o = t.validate();
    expect(o.customer!.address).toBe(marie.address);
    expect(JSON.stringify(o)).not.toContain('Chave');
  });

  it('13. nouvelle commande après validation : l’adresse exceptionnelle précédente n’est pas réutilisée', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    await t.trip();
    t.validate();
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
    expect(t.store.getData().cart.deliveryTrip).toBeNull();
    t.startDelivery(); // même client, nouvelle commande
    const o = t.validate();
    expect(o.customer!.address).toBe('7 rue Sainte');
    expect(o.deliveryTrip).toBeNull();
  });
});

describe('compatibilité et absence d’impact', () => {
  it('14. commandes historiques : chargées sans réécriture, rouvertes à leur adresse enregistrée', () => {
    const seeded = setup();
    const raw = JSON.parse(seeded.repo.raw()!);
    const cart = JSON.parse(seeded.repo.rawCart()!);
    delete cart.deliveryAddress;
    for (const o of raw.orders) if (o.customer) delete o.customer.addressOverridden;
    const doc = JSON.stringify(raw);
    const cartRaw = JSON.stringify(cart);
    const repo = createMemoryRepository(undefined, doc, cartRaw);
    const t = setup(repo);
    expect(t.store.getPersistError()).toBeNull();
    expect(repo.raw()).toBe(doc);
    expect(repo.control.saves + repo.control.cartSaves).toBe(0);
    expect(t.store.getData().cart.deliveryAddress).toBeNull();
    const old = t.store.getData().orders.find((o) => o.mode === 'livraison')!;
    expect(buildDeliveryTicket(old, t.store.getData().settings)!.customer!.addressLines[0]).toBe(old.customer!.address);
    t.store.startEditOrder(old.id);
    expect(effectiveDeliveryAddress(t.store.getData().cart, t.store.getData().customers.find((c) => c.id === old.customerId)!)!.address).toBe(old.customer!.address);
  });

  it('15. ticket cuisine inchangé : ni adresse, ni consignes, ni trajet', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    await t.trip();
    const o = t.validate();
    const kitchen = JSON.stringify(buildKitchenTicket(o, t.store.getData().settings));
    for (const s of ['Chave', '13005', 'Leroy', '1234', 'Appeler Karim', 'km', 'TRAJET']) expect(kitchen).not.toContain(s);
  });

  it('16. paiements, fidélité et statistiques identiques avec ou sans adresse exceptionnelle', async () => {
    const a = setup();
    const b = setup();
    a.startDelivery();
    a.store.setCartDeliveryAddress(FRIEND);
    await a.trip();
    const oa = a.validate();
    b.startDelivery();
    const ob = b.validate();
    expect(oa.totals).toEqual(ob.totals);
    for (const [t, o] of [[a, oa], [b, ob]] as const) t.store.markOrderPaid(o.id, [{ kind: 'carte', amount: o.totals.total }]);
    const pts = (t: ReturnType<typeof setup>) => computeBalance(t.store.getData().loyaltyEvents, t.karim.id, t.store.getData().settings.loyalty);
    expect(pts(a)).toEqual(pts(b));
    const stats = (t: ReturnType<typeof setup>) => {
      const d = t.store.getData();
      return computePeriodStats(availablePeriods('service', d.services, false)[0], d.orders, d.services, '2026-10-30T19:30:00.000Z');
    };
    expect(stats(a)).toEqual(stats(b));
    expect(a.get(oa.id).payment).toEqual(b.get(ob.id).payment);
  });

  it('sauvegarde JSON : adresse exceptionnelle incluse, fichier vérifiable, restauration identique', async () => {
    const t = setup();
    t.startDelivery();
    t.store.setCartDeliveryAddress(FRIEND);
    const o = t.validate();
    const entries: Record<string, string> = { [STORAGE_KEY]: t.repo.raw()!, [CART_KEY]: t.repo.rawCart()! };
    const keys = Object.keys(entries);
    const reader: ReadableStore = { length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => entries[k] ?? null };
    const backup = await createBackup(reader, { now: new Date(), origin: 'test' });
    expect((await verifyBackupText(backupToText(backup))).ok).toBe(true);
    const restored = setup(createMemoryRepository(undefined, backup.stockage[STORAGE_KEY], backup.stockage[CART_KEY]));
    expect(restored.get(o.id).customer).toEqual(o.customer as Order['customer']);
  });
});
