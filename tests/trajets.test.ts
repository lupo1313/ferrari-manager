import { beforeEach, describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { CART_KEY, STORAGE_KEY, createMemoryRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { computeBalance } from '../src/domain/loyalty';
import { buildDeliveryTicket, buildKitchenTicket } from '../src/domain/ticket';
import { deliveryAddressKey, formatDistance, formatDuration, validTripFor } from '../src/domain/trip';
import { computeScooterTrip, GEOCODING_URL, resetTripCache, SCOOTER_TOP_SPEED_KMH } from '../src/services/trajet';
import { availablePeriods, computePeriodStats } from '../src/modules/statistiques/calculs';
import { backupToText, createBackup, verifyBackupText, type ReadableStore } from '../src/storage/export';
import type { DeliveryTrip, Order } from '../src/domain/types';

const PIZZERIA = '178 rue Ferrari, 13005 Marseille';
const ROUTING = 'https://routage.test/route';

type Reply = { status: number; body: unknown } | 'network-error';
interface FakeNet {
  fetchFn: typeof fetch;
  calls: string[];
}

/** Réseau simulé : géocodage (pizzeria, client) et itinéraire, chacun réglable. */
function fakeNet(opts: { client?: Reply; route?: Reply; pizzeria?: Reply } = {}): FakeNet {
  const calls: string[] = [];
  const feature = (lon: number, lat: number, type = 'housenumber', score = 0.97, label = 'Adresse') => ({
    status: 200,
    body: { features: [{ geometry: { coordinates: [lon, lat] }, properties: { score, type, label } }] },
  });
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    let reply: Reply;
    if (url.startsWith(GEOCODING_URL)) {
      const q = new URL(url).searchParams.get('q') ?? '';
      reply = q.includes('Ferrari') ? (opts.pizzeria ?? feature(5.395221, 43.292395, 'housenumber', 0.975, '178 Rue Ferrari 13005 Marseille')) : (opts.client ?? feature(5.378, 43.297, 'housenumber', 0.96, '15 Rue de Rome 13001 Marseille'));
    } else {
      reply = opts.route ?? { status: 200, body: { trip: { summary: { length: 3.412, time: 512.4 } } } };
    }
    if (reply === 'network-error') throw new TypeError('Failed to fetch');
    const r = reply;
    return { status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

function setup(repo = createMemoryRepository()) {
  let n = 0;
  const store = createAppStore({ repo, catalog: demoCatalog, seed: buildDemoData, now: () => new Date('2026-10-30T19:00:00'), newId: (p) => `${p}_${++n}` });
  const jean = store.getData().customers.find((c) => c.lastName === 'Dupont')!;
  const get = (id: string) => store.getData().orders.find((o) => o.id === id)!;
  const deps = (net: FakeNet) => ({ fetchFn: net.fetchFn, routingUrl: ROUTING, now: () => new Date('2026-10-30T19:00:00') });
  /** Saisie d'une livraison pour Jean Dupont, trajet calculé par le service (réseau simulé). */
  const deliveryWithTrip = async (net = fakeNet()) => {
    store.selectCustomer(jean.id);
    store.setMode('livraison');
    store.addProduct('margarita');
    store.addProduct('margarita');
    store.addProduct('royale');
    const r = await computeScooterTrip(PIZZERIA, jean, deps(net));
    if (!r.ok) throw new Error(r.message);
    expect(store.setCartDeliveryTrip(r.trip).ok).toBe(true);
    const v = store.validateCart();
    if (!v.ok) throw new Error(v.error);
    return v.value;
  };
  return { store, repo, jean, get, deps, deliveryWithTrip };
}

beforeEach(() => resetTripCache());

describe('calcul du trajet en scooter', () => {
  it('adresse valide : distance et durée calculées avec le profil scooter (jamais voiture)', async () => {
    const t = setup();
    const net = fakeNet();
    const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(net));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trip).toMatchObject({ vehicle: 'scooter', distanceM: 3412, durationS: 512, approximate: false, source: 'valhalla-motor_scooter' });
    expect(r.trip.addressKey).toBe(deliveryAddressKey(t.jean));
    const route = net.calls.find((u) => u.startsWith(ROUTING))!;
    const request = JSON.parse(new URL(route).searchParams.get('json')!);
    expect(request.costing).toBe('motor_scooter');
    expect(request.costing_options.motor_scooter.top_speed).toBe(SCOOTER_TOP_SPEED_KMH);
    expect(JSON.stringify(request)).not.toContain('"auto"');
    // Géocodage du client filtré sur son code postal.
    const geo = net.calls.filter((u) => u.startsWith(GEOCODING_URL)).map((u) => new URL(u).searchParams);
    expect(geo.some((p) => p.get('postcode') === '13001' && p.get('q')!.includes('15 rue de Rome'))).toBe(true);
  });

  it('formats : kilomètres à une décimale, minutes arrondies au-dessus', () => {
    expect(formatDistance(3412)).toBe('3,4 km');
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDuration(512)).toBe('9 min');
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(3900)).toBe('1 h 05');
  });

  it('adresse introuvable ou trop incertaine : message clair, aucune valeur inventée', async () => {
    const t = setup();
    for (const client of [
      { status: 200, body: { features: [] } },
      { status: 200, body: { features: [{ geometry: { coordinates: [5.3, 43.2] }, properties: { score: 0.3, type: 'housenumber' } }] } },
      { status: 200, body: { features: [{ geometry: { coordinates: [5.3, 43.2] }, properties: { score: 0.9, type: 'municipality' } }] } },
    ] as Reply[]) {
      const net = fakeNet({ client });
      const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(net));
      expect(!r.ok && r.code).toBe('adresse_introuvable');
      expect(net.calls.some((u) => u.startsWith(ROUTING))).toBe(false);
    }
  });

  it('adresse incomplète : refusée sans appel réseau', async () => {
    const t = setup();
    const net = fakeNet();
    const r = await computeScooterTrip(PIZZERIA, { address: '', postalCode: '13001', city: 'Marseille' }, t.deps(net));
    expect(!r.ok && r.code).toBe('adresse_incomplete');
    expect(net.calls).toEqual([]);
  });

  it('service indisponible, coupure réseau, quota, aucun itinéraire, hors ligne : erreur sans trajet', async () => {
    const t = setup();
    const cases: [Parameters<typeof fakeNet>[0], string][] = [
      [{ route: 'network-error' }, 'service_indisponible'],
      [{ route: { status: 503, body: null } }, 'service_indisponible'],
      [{ route: { status: 429, body: null } }, 'quota'],
      [{ route: { status: 400, body: { error_code: 442, error: 'No path could be found for input' } } }, 'aucun_itineraire'],
      [{ route: { status: 200, body: { trip: {} } } }, 'service_indisponible'],
      [{ client: 'network-error' }, 'service_indisponible'],
      [{ pizzeria: { status: 200, body: { features: [] } } }, 'depart_introuvable'],
    ];
    for (const [opts, code] of cases) {
      resetTripCache();
      const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(fakeNet(opts)));
      expect(!r.ok && r.code).toBe(code);
      expect(!r.ok && r.message.length).toBeGreaterThan(10);
    }
    const offline = await computeScooterTrip(PIZZERIA, t.jean, { ...t.deps(fakeNet()), isOnline: () => false });
    expect(!offline.ok && offline.code).toBe('hors_ligne');
  });

  it('numéro de rue non trouvé : calcul sur la rue, signalé comme approximatif', async () => {
    const t = setup();
    const net = fakeNet({ client: { status: 200, body: { features: [{ geometry: { coordinates: [5.378, 43.297] }, properties: { score: 0.8, type: 'street', label: 'Rue de Rome 13001 Marseille' } }] } } });
    const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(net));
    expect(r.ok && r.trip.approximate).toBe(true);
  });
});

describe('commande et tickets', () => {
  it('service indisponible : la commande s’enregistre normalement, ticket livreur sans trajet', async () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    t.store.setMode('livraison');
    t.store.addProduct('reine');
    const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(fakeNet({ route: 'network-error' })));
    expect(r.ok).toBe(false);
    const v = t.store.validateCart();
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.deliveryTrip).toBeNull();
    const ticket = buildDeliveryTicket(v.value, t.store.getData().settings)!;
    expect(ticket.trip).toBeNull();
    expect(ticket.payment.headline).toContain('À ENCAISSER');
  });

  it('ticket livreur : distance et durée ; ticket cuisine : aucune information de trajet', async () => {
    const t = setup();
    const o = await t.deliveryWithTrip();
    const settings = t.store.getData().settings;
    expect(buildDeliveryTicket(o, settings)!.trip).toEqual({ distance: '3,4 km', duration: '9 min' });
    const kitchen = JSON.stringify(buildKitchenTicket(o, settings));
    expect(kitchen).not.toContain('km');
    expect(kitchen).not.toContain('3,4');
    expect(kitchen).not.toContain('9 min');
    expect(kitchen).not.toMatch(/trajet|scooter/i);
  });

  it('réimpression et rechargement du navigateur : trajet conservé', async () => {
    const t = setup();
    const o = await t.deliveryWithTrip();
    t.store.recordPrintRequest(o.id);
    expect(t.get(o.id).deliveryTrip).toEqual(o.deliveryTrip);
    const reloaded = setup(t.repo);
    const again = reloaded.get(o.id);
    expect(again.deliveryTrip).toEqual(o.deliveryTrip);
    expect(buildDeliveryTicket(again, reloaded.store.getData().settings)!.trip).toEqual({ distance: '3,4 km', duration: '9 min' });
  });

  it('trajet calculé mais pas encore validé : conservé dans le panier après rechargement', async () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    t.store.setMode('livraison');
    t.store.addProduct('reine');
    const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(fakeNet()));
    if (!r.ok) throw new Error(r.message);
    t.store.setCartDeliveryTrip(r.trip);
    const reloaded = setup(t.repo);
    expect(reloaded.store.getData().cart.deliveryTrip).toEqual(r.trip);
  });

  it('fiche modifiée après la commande : la commande garde son adresse et son trajet ; adresse habituelle = trajet caduc', async () => {
    const t = setup();
    const o = await t.deliveryWithTrip();
    const updated = t.store.updateCustomer(t.jean.id, {
      firstName: 'Jean',
      lastName: 'Dupont',
      phone: '0612345678',
      address: '40 rue Paradis',
      postalCode: '13001',
      city: 'Marseille',
      complement: '',
      instructions: '',
    });
    expect(updated.ok).toBe(true);
    expect(buildDeliveryTicket(t.get(o.id), t.store.getData().settings)!.trip).not.toBeNull();
    // Réouverture : l'adresse réellement enregistrée sur la commande est reprise, avec son trajet.
    t.store.startEditOrder(o.id);
    expect(t.store.getData().cart.deliveryAddress?.address).toBe('15 rue de Rome');
    const kept = t.store.validateCart();
    expect(kept.ok && kept.value.customer!.address).toBe('15 rue de Rome');
    expect(kept.ok && kept.value.deliveryTrip).toEqual(o.deliveryTrip);
    // « Utiliser l'adresse habituelle » : nouvelle adresse, l'ancien trajet est retiré immédiatement.
    t.store.startEditOrder(o.id);
    expect(t.store.setCartDeliveryAddress(null).ok).toBe(true);
    expect(t.store.getData().cart.deliveryTrip).toBeNull();
    const saved = t.store.validateCart();
    expect(saved.ok && saved.value.customer!.address).toBe('40 rue Paradis');
    expect(saved.ok && saved.value.deliveryTrip).toBeNull();
    expect(buildDeliveryTicket(t.get(o.id), t.store.getData().settings)!.trip).toBeNull();
    // Nouveau calcul pour la nouvelle adresse.
    t.store.startEditOrder(o.id);
    const jean = t.store.getData().customers.find((c) => c.id === t.jean.id)!;
    const r = await computeScooterTrip(PIZZERIA, jean, t.deps(fakeNet()));
    if (!r.ok) throw new Error(r.message);
    expect(t.store.setCartDeliveryTrip(r.trip).ok).toBe(true);
    const resaved = t.store.validateCart();
    expect(resaved.ok && resaved.value.deliveryTrip?.addressKey).toBe(deliveryAddressKey(jean));
    expect(validTripFor(t.get(o.id).deliveryTrip, 'livraison', t.get(o.id).customer)).not.toBeNull();
  });

  it('calcul terminé après un changement de client ou de mode : refusé, jamais rattaché à une autre adresse', async () => {
    const t = setup();
    t.store.selectCustomer(t.jean.id);
    t.store.setMode('livraison');
    const r = await computeScooterTrip(PIZZERIA, t.jean, t.deps(fakeNet()));
    if (!r.ok) throw new Error(r.message);
    t.store.selectCustomer(t.store.getData().customers.find((c) => c.lastName === 'Lambert')!.id);
    expect(t.store.setCartDeliveryTrip(r.trip).ok).toBe(false);
    t.store.selectCustomer(t.jean.id);
    t.store.setMode('emporter');
    expect(t.store.setCartDeliveryTrip(r.trip).ok).toBe(false);
  });

  it('passage en « À emporter » : aucun trajet enregistré ni imprimé', async () => {
    const t = setup();
    const o = await t.deliveryWithTrip();
    t.store.startEditOrder(o.id);
    t.store.setMode('emporter');
    const saved = t.store.validateCart();
    expect(saved.ok && saved.value.deliveryTrip).toBeNull();
    expect(buildDeliveryTicket(t.get(o.id), t.store.getData().settings)).toBeNull();
    // Même un trajet resté dans les données n'est jamais imprimé pour un retrait.
    const forced: Order = { ...t.get(o.id), deliveryTrip: o.deliveryTrip };
    expect(buildDeliveryTicket(forced, t.store.getData().settings)).toBeNull();
    expect(JSON.stringify(buildKitchenTicket(forced, t.store.getData().settings))).not.toContain('km');
  });

  it('ancienne commande (sans trajet) et trajet illisible : aucun dysfonctionnement', () => {
    const t = setup();
    // Commande au format d'avant l'intervention 6 : champ absent.
    const { deliveryTrip: _absent, ...old } = t.store.getData().orders.find((o) => o.mode === 'livraison')!;
    void _absent;
    const ticket = buildDeliveryTicket(old, t.store.getData().settings)!;
    expect(ticket.trip).toBeNull();
    expect(ticket.customer).not.toBeNull();
    const corrupted = { ...old, deliveryTrip: { vehicle: 'voiture', distanceM: 'beaucoup' } } as unknown as Order;
    expect(buildDeliveryTicket(corrupted, t.store.getData().settings)!.trip).toBeNull();
  });
});

describe('aucun impact sur le reste', () => {
  it('paiement, fidélité et statistiques identiques avec ou sans trajet', async () => {
    const a = setup();
    const b = setup();
    const withTrip = await a.deliveryWithTrip();
    b.store.selectCustomer(b.jean.id);
    b.store.setMode('livraison');
    for (const p of ['margarita', 'margarita', 'royale']) b.store.addProduct(p);
    const v = b.store.validateCart();
    if (!v.ok) throw new Error(v.error);
    const without = v.value;
    expect(withTrip.totals).toEqual(without.totals);
    expect(withTrip.totals.deliveryFee).toBe(0);
    for (const t of [a, b]) t.store.markOrderPaid(t.store.getData().orders[t.store.getData().orders.length - 1].id, [{ kind: 'especes', amount: withTrip.totals.total }]);
    const pts = (t: ReturnType<typeof setup>) => computeBalance(t.store.getData().loyaltyEvents, t.jean.id, t.store.getData().settings.loyalty);
    expect(pts(a)).toEqual(pts(b));
    const stats = (t: ReturnType<typeof setup>) => {
      const d = t.store.getData();
      return computePeriodStats(availablePeriods('service', d.services, false)[0], d.orders, d.services, '2026-10-30T19:30:00.000Z');
    };
    expect(stats(a)).toEqual(stats(b));
    const strip = (o: Order) => ({ ...o, deliveryTrip: null, id: '', lines: [] });
    expect(strip(a.get(withTrip.id))).toEqual({ ...strip(b.get(without.id)) });
  });

  it('sauvegarde JSON : le trajet est inclus et le fichier reste vérifiable ; clés inchangées', async () => {
    expect(STORAGE_KEY).toBe('ferrari-manager:v1');
    expect(CART_KEY).toBe('ferrari-manager:v1:panier');
    const t = setup();
    const o = await t.deliveryWithTrip();
    const entries: Record<string, string> = { [STORAGE_KEY]: t.repo.raw()!, [CART_KEY]: t.repo.rawCart()! };
    const keys = Object.keys(entries);
    const reader: ReadableStore = { length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => entries[k] ?? null };
    const backup = await createBackup(reader, { now: new Date(), origin: 'test' });
    expect((await verifyBackupText(backupToText(backup))).ok).toBe(true);
    const restored = setup(createMemoryRepository(undefined, backup.stockage[STORAGE_KEY], backup.stockage[CART_KEY]));
    expect(restored.get(o.id).deliveryTrip).toEqual(o.deliveryTrip as DeliveryTrip);
  });

  it('anciennes données sans trajet : chargées sans réécriture', () => {
    const seeded = setup();
    const raw = JSON.parse(seeded.repo.raw()!);
    for (const o of raw.orders) delete o.deliveryTrip;
    const cart = JSON.parse(seeded.repo.rawCart()!);
    delete cart.deliveryTrip;
    const doc = JSON.stringify(raw);
    const cartRaw = JSON.stringify(cart);
    const repo = createMemoryRepository(undefined, doc, cartRaw);
    const t = setup(repo);
    expect(t.store.getPersistError()).toBeNull();
    expect(repo.raw()).toBe(doc);
    expect(repo.rawCart()).toBe(cartRaw);
    expect(repo.control.saves + repo.control.cartSaves).toBe(0);
    expect(t.store.getData().cart.deliveryTrip).toBeNull();
  });
});
