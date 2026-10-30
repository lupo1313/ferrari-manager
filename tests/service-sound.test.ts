import { describe, expect, it } from 'vitest';
import { createAppStore } from '../src/state/store';
import { createMemoryRepository } from '../src/storage/repository';
import { normalizeAppData } from '../src/storage/schema';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { defaultSettings } from '../src/data/defaultSettings';
import { computeBalance } from '../src/domain/loyalty';
import { SERVICE_CLOSED_MESSAGE } from '../src/domain/orders';
import { serviceIndicator } from '../src/domain/service';
import { createPaymentSound } from '../src/audio/paymentSound';

/** Store de test avec un compteur de sons joués (effet injecté). */
function setup(repo = createMemoryRepository(), prefix = 's') {
  let n = 0;
  const sounds = { count: 0, fail: false };
  const store = createAppStore({
    repo,
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => new Date('2026-10-30T22:30:00'),
    newId: (p) => `${p}_${prefix}${++n}`,
    effects: {
      playPaymentSound: () => {
        if (sounds.fail) throw new Error('audio indisponible');
        sounds.count++;
      },
    },
  });
  const jean = store.getData().customers.find((c) => c.lastName === 'Dupont')!;
  const balance = () => computeBalance(store.getData().loyaltyEvents, jean.id, store.getData().settings.loyalty);
  const newOrder = (products = ['reine']) => {
    store.selectCustomer(jean.id);
    for (const p of products) store.addProduct(p);
    return store.validateCart();
  };
  return { store, repo, sounds, jean, balance, newOrder };
}

describe('Service ouvert / fermé', () => {
  it('1-2. la fermeture passe réellement le service à fermé (voyant gris) sans rouvrir de service', () => {
    const t = setup();
    expect(t.store.getData().serviceOpen).toBe(true);
    const startedAt = t.store.getData().serviceStartedAt;
    const r = t.store.closeService();
    expect(r.ok && r.value.alreadyClosed).toBe(false);
    expect(t.store.getData().serviceOpen).toBe(false);
    expect(t.store.getData().serviceClosedAt).toBe(new Date('2026-10-30T22:30:00').toISOString());
    expect(t.store.getData().serviceStartedAt).toBe(startedAt); // pas de nouveau service démarré
    expect(serviceIndicator(t.store.getData().serviceOpen)).toEqual({ tone: 'grey', label: 'Service fermé', action: 'Ouvrir le service' });
  });

  it('3. l’état fermé est conservé après rechargement', () => {
    const t = setup();
    t.store.closeService();
    const reloaded = setup(t.repo, 'r');
    expect(reloaded.store.getData().serviceOpen).toBe(false);
    expect(reloaded.store.getData().serviceClosedAt).toBe(t.store.getData().serviceClosedAt);
  });

  it('4. service fermé : aucune nouvelle commande, y compris dans la logique métier', () => {
    const t = setup();
    t.store.closeService();
    const before = t.store.getData().orders.length;
    const r = t.newOrder(['reine', 'royale']);
    expect(!r.ok && r.error).toBe(SERVICE_CLOSED_MESSAGE);
    expect(t.store.getData().orders).toHaveLength(before);
    // Le panier saisi est conservé pour la réouverture.
    expect(t.store.getData().cart.lines).toHaveLength(2);
  });

  it('5-6. commandes non encaissées conservées et encore encaissables après la fermeture', () => {
    const t = setup();
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    t.store.setOrderStatus(o.value.id, 'terminee');
    t.store.closeService();
    const kept = t.store.getData().orders.find((x) => x.id === o.value.id)!;
    expect(kept.archivedAt).toBeNull();
    const pay = t.store.markOrderPaid(o.value.id, 'carte');
    expect(pay.ok && pay.value.pointsCredited).toBe(1);
  });

  it('corrections toujours possibles service fermé : modifier et annuler une commande existante', () => {
    const t = setup();
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    t.store.closeService();
    expect(t.store.startEditOrder(o.value.id).ok).toBe(true);
    t.store.addProduct('coca-150');
    expect(t.store.validateCart().ok).toBe(true);
    expect(t.store.cancelOrder(o.value.id).ok).toBe(true);
  });

  it('7. la fermeture ne modifie pas la fidélité', () => {
    const t = setup();
    const o = t.newOrder(['reine', 'royale']);
    if (!o.ok) throw new Error(o.error);
    t.store.markOrderPaid(o.value.id, 'especes');
    const events = t.store.getData().loyaltyEvents.length;
    const bal = t.balance();
    t.store.closeService();
    t.store.openService();
    expect(t.store.getData().loyaltyEvents).toHaveLength(events);
    expect(t.balance()).toEqual(bal);
  });

  it('8-10. ouverture : voyant vert, nouveau début de service, commandes à nouveau autorisées, rien n’est perdu', () => {
    const t = setup();
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    const customers = t.store.getData().customers.length;
    t.store.closeService();
    const r = t.store.openService();
    expect(r.ok && r.value.alreadyOpen).toBe(false);
    expect(t.store.getData()).toMatchObject({ serviceOpen: true, serviceClosedAt: null, serviceStartedAt: new Date('2026-10-30T22:30:00').toISOString() });
    expect(serviceIndicator(true)).toEqual({ tone: 'green', label: 'Service ouvert', action: 'Fermer le service' });
    expect(t.store.getData().orders.find((x) => x.id === o.value.id)!.archivedAt).toBeNull();
    expect(t.store.getData().customers).toHaveLength(customers);
    expect(t.newOrder(['royale']).ok).toBe(true);
    // Ouvrir un service déjà ouvert ne change rien.
    const again = t.store.openService();
    expect(again.ok && again.value.alreadyOpen).toBe(true);
  });

  it('11. double fermeture sans effet indésirable (date conservée, aucune écriture inutile)', () => {
    const t = setup();
    t.store.closeService();
    const closedAt = t.store.getData().serviceClosedAt;
    const saves = t.repo.saves;
    const second = t.store.closeService();
    expect(second.ok && second.value).toMatchObject({ alreadyClosed: true, archived: 0 });
    expect(t.repo.saves).toBe(saves);
    expect(t.store.getData().serviceOpen).toBe(false);
    expect(t.store.getData().serviceClosedAt).toBe(closedAt);
  });

  it('anciennes données sans état de service : considérées ouvertes (comportement d’avant), sans réécriture', () => {
    const data = buildDemoData(demoCatalog, new Date('2026-10-30T10:00:00'), (p) => p + Math.random());
    const old = JSON.parse(JSON.stringify(data));
    delete old.serviceOpen;
    delete old.serviceClosedAt;
    const r = normalizeAppData(old, { settings: defaultSettings, newCartId: () => 'c', nowIso: 'x' });
    expect(r.ok && r.data).toMatchObject({ serviceOpen: true, serviceClosedAt: null });
    expect(r.ok && r.data.orders).toHaveLength(2);
    const raw = JSON.stringify(old);
    const repo = createMemoryRepository(null, raw);
    setup(repo, 'o');
    expect(repo.raw()).toBe(raw);
  });

  it('17. protections du stockage conservées : écriture refusée → service inchangé ; données illisibles intactes', () => {
    const t = setup();
    t.repo.control.failOn = 'doc';
    expect(t.store.closeService().ok).toBe(false);
    expect(t.store.getData().serviceOpen).toBe(true);
    t.repo.control.failOn = null;
    t.store.closeService();
    t.repo.control.failOn = 'doc';
    expect(t.store.openService().ok).toBe(false);
    expect(t.store.getData().serviceOpen).toBe(false);

    const broken = createMemoryRepository(null, '{"schemaVersion":1,"serviceOpen":');
    const locked = setup(broken, 'b');
    expect(locked.store.getPersistError()).toBeTruthy();
    locked.store.closeService();
    expect(broken.raw()).toBe('{"schemaVersion":1,"serviceOpen":');
  });
});

describe('Son de confirmation d’encaissement', () => {
  it('12. un son après chaque encaissement réussi (espèces, carte, non précisé)', () => {
    const t = setup();
    for (const method of ['especes', 'carte', 'non_precise'] as const) {
      const o = t.newOrder();
      if (!o.ok) throw new Error(o.error);
      expect(t.store.markOrderPaid(o.value.id, method).ok).toBe(true);
    }
    expect(t.sounds.count).toBe(3);
  });

  it('13. aucun son : encaissement refusé, déjà effectué (double clic), changement de moyen, annulation d’encaissement', () => {
    const t = setup();
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    t.store.markOrderPaid(o.value.id, 'especes');
    expect(t.sounds.count).toBe(1);
    t.store.markOrderPaid(o.value.id, 'especes'); // double clic
    t.store.markOrderPaid(o.value.id, 'carte'); // simple correction du moyen
    t.store.markOrderUnpaid(o.value.id);
    expect(t.sounds.count).toBe(1);

    const c = t.newOrder();
    if (!c.ok) throw new Error(c.error);
    t.store.cancelOrder(c.value.id);
    expect(t.store.markOrderPaid(c.value.id).ok).toBe(false); // refusé (annulée)
    t.repo.control.failOn = 'doc';
    const d = t.store.getData().orders.find((x) => x.status !== 'annulee' && x.payment.status === 'a_encaisser')!;
    expect(t.store.markOrderPaid(d.id).ok).toBe(false); // écriture impossible
    expect(t.sounds.count).toBe(1);
  });

  it('14. aucun son au rechargement, même avec des commandes encaissées', () => {
    const t = setup();
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    t.store.markOrderPaid(o.value.id, 'carte');
    const reloaded = setup(t.repo, 'r');
    expect(reloaded.sounds.count).toBe(0);
    expect(reloaded.store.getData().orders.find((x) => x.id === o.value.id)!.payment.status).toBe('encaissee');
  });

  it('15. le réglage est respecté et conservé après rechargement (activé par défaut)', () => {
    const t = setup();
    expect(t.store.getData().settings.paymentSound).toBe(true);
    t.store.updateSettings({ paymentSound: false });
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    t.store.markOrderPaid(o.value.id);
    expect(t.sounds.count).toBe(0);
    expect(setup(t.repo, 'r').store.getData().settings.paymentSound).toBe(false);
    t.store.updateSettings({ paymentSound: true });
    const p = t.newOrder();
    if (!p.ok) throw new Error(p.error);
    t.store.markOrderPaid(p.value.id);
    expect(t.sounds.count).toBe(1);
  });

  it('16. audio indisponible ou en erreur : l’encaissement réussit quand même', () => {
    const t = setup();
    t.sounds.fail = true;
    const o = t.newOrder();
    if (!o.ok) throw new Error(o.error);
    const r = t.store.markOrderPaid(o.value.id, 'carte');
    expect(r.ok && r.value.pointsCredited).toBe(1);
    expect(t.store.getData().orders.find((x) => x.id === o.value.id)!.payment.status).toBe('encaissee');

    // Le lecteur lui-même ne lève jamais d'exception.
    expect(createPaymentSound(() => undefined).play()).toBe(false);
    const Broken = class {
      constructor() {
        throw new Error('NotAllowedError');
      }
    } as unknown as new () => AudioContext;
    expect(createPaymentSound(() => Broken).play()).toBe(false);
  });

  it('signature sonore : deux notes courtes et montantes, volume discret', () => {
    const calls = { oscillators: [] as number[], started: 0, gains: [] as number[] };
    const param = () => ({ value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined });
    const Fake = class {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createGain() {
        const g = { gain: param(), connect: () => undefined };
        return new Proxy(g, {
          set(target, key, value) {
            (target as Record<string, unknown>)[key as string] = value;
            return true;
          },
          get(target, key) {
            if (key === 'gain') return new Proxy(target.gain, { set: (gt, k, v) => ((gt as Record<string, unknown>)[k as string] = v, calls.gains.push(v), true) });
            return (target as Record<string, unknown>)[key as string];
          },
        });
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime: (f: number) => void calls.oscillators.push(f) },
          connect: () => undefined,
          start: () => void calls.started++,
          stop: () => undefined,
        };
      }
    } as unknown as new () => AudioContext;
    expect(createPaymentSound(() => Fake).play()).toBe(true);
    // 2 notes × (fondamentale + harmonique) ; fondamentales montantes.
    expect(calls.started).toBe(4);
    expect(calls.oscillators[0]).toBeLessThan(calls.oscillators[2]);
    expect(Math.max(...calls.gains)).toBeLessThanOrEqual(0.2);
  });
});
