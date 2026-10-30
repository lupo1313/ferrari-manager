import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestStore } from './helpers';
import { canChangeCartCustomer, EDIT_CUSTOMER_LOCKED_MESSAGE, orderToCart, SERVICE_CLOSED_MESSAGE } from '../src/domain/orders';
import { computeBalance } from '../src/domain/loyalty';
import { emptyCart } from '../src/domain/cart';
import { isPaid } from '../src/domain/payment';

/**
 * Scénario reproduit sur Safari iPhone (intervention 4B) : service fermé, commande encaissée en modification,
 * un produit retiré sans enregistrer, puis « Commander » pour un autre client depuis la page Clients.
 */
function setup() {
  const t = createTestStore();
  const jean = t.customer('Dupont');
  const autre = t.customer('Lambert');
  t.store.selectCustomer(jean.id);
  for (const id of ['reine', 'royale', 'margarita', 'coca-33']) t.store.addProduct(id);
  const created = t.store.validateCart();
  if (!created.ok) throw new Error(created.error);
  const id = created.value.id;
  expect(t.store.markOrderPaid(id, 'carte').ok).toBe(true);
  expect(t.store.closeService().ok).toBe(true);

  const get = () => t.store.getData().orders.find((o) => o.id === id)!;
  const points = (customerId: string) => computeBalance(t.store.getData().loyaltyEvents, customerId, t.store.getData().settings.loyalty).totalPoints;
  /** Ouvre la commande en modification et retire la Margarita, sans enregistrer. */
  const editAndRemove = () => {
    expect(t.store.startEditOrder(id).ok).toBe(true);
    const margarita = t.store.getData().cart.lines.find((l) => l.productId === 'margarita')!;
    t.store.removeLine(margarita.id);
  };
  return { ...t, jean, autre, id, get, points, editAndRemove };
}

describe('modification en cours : le client de la commande ne change jamais en silence', () => {
  it('1. « Commander » pour un autre client pendant une modification non enregistrée : refusé, rien ne bouge', () => {
    const t = setup();
    const saved = t.get();
    t.editAndRemove();
    const cartBefore = t.store.getData().cart;
    const rawBefore = t.repo.raw();

    const r = t.store.selectCustomer(t.autre.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(EDIT_CUSTOMER_LOCKED_MESSAGE);
    // Le panier garde son client, ses produits et le mode modification ; l'historique n'est pas réécrit.
    expect(t.store.getData().cart).toEqual(cartBefore);
    expect(t.store.getData().cart.customerId).toBe(t.jean.id);
    expect(t.store.getData().cart.editingOrderId).toBe(t.id);
    expect(t.repo.raw()).toBe(rawBefore);
    expect(t.get()).toEqual(saved);
  });

  it('aucun autre chemin ne change le client : retrait du client, nouvelle fiche sélectionnée, commande comptoir', () => {
    const t = setup();
    t.editAndRemove();
    expect(t.store.selectCustomer(null).ok).toBe(false);

    const created = t.store.createCustomer({ lastName: 'Nouveau', firstName: '', phone: '0677001122', address: '', postalCode: '', city: '', complement: '', instructions: '' }, { select: true });
    expect(created.ok).toBe(true);
    // La fiche est créée, mais la commande garde son client d'origine.
    expect(t.store.getData().customers.some((c) => c.lastName === 'Nouveau')).toBe(true);
    expect(t.store.getData().cart.customerId).toBe(t.jean.id);

    // Commande comptoir (sans client) : on ne peut pas non plus lui rattacher un client pendant la modification.
    const counter = { ...t.get(), customerId: null };
    expect(canChangeCartCustomer(orderToCart(counter), t.jean.id, counter)).toBe(false);
    expect(canChangeCartCustomer(orderToCart(counter), null, counter)).toBe(true);
    // Hors modification, changer de client reste possible, comme avant.
    expect(canChangeCartCustomer(emptyCart('x'), t.autre.id, undefined)).toBe(true);
  });

  it('2. annulation de la navigation : la modification continue et s’enregistre pour le client d’origine', () => {
    const t = setup();
    t.editAndRemove();
    t.store.selectCustomer(t.autre.id); // refusé : équivaut à « Annuler » puis « Continuer »
    const r = t.store.validateCart();
    expect(r.ok).toBe(true);
    const saved = t.get();
    expect(saved.customerId).toBe(t.jean.id);
    expect(saved.lines.map((l) => l.productId)).toEqual(['reine', 'royale', 'coca-33']);
    expect(saved.revision).toBe(2);
  });

  it('3. abandon volontaire (service ouvert) : nouvelle commande pour l’autre client, la commande enregistrée est intacte', () => {
    const t = setup();
    expect(t.store.openService().ok).toBe(true);
    const saved = t.get();
    const eventsBefore = t.store.getData().loyaltyEvents;
    t.editAndRemove();

    const r = t.store.abandonEditAndStartOrder(t.autre.id);
    expect(r.ok).toBe(true);
    const cart = t.store.getData().cart;
    expect(cart.editingOrderId).toBeNull();
    expect(cart.customerId).toBe(t.autre.id);
    expect(cart.lines).toEqual([]);
    expect(cart.draftId).not.toBe(t.id);
    // Rien de la modification abandonnée n'a été enregistré.
    expect(t.get()).toEqual(saved);
    expect(t.store.getData().loyaltyEvents).toEqual(eventsBefore);
    // Après rechargement, le panier est bien la nouvelle commande, la n° de la commande modifiée est inchangée.
    const reloaded = createTestStore(t.repo).store.getData();
    expect(reloaded.cart.customerId).toBe(t.autre.id);
    expect(reloaded.cart.editingOrderId).toBeNull();
    expect(reloaded.orders.find((o) => o.id === t.id)).toEqual(saved);
  });

  it('abandon par « Quitter » ou « Abandonner » dans le panier : la commande enregistrée reste telle qu’elle était', () => {
    const t = setup();
    const saved = t.get();
    t.editAndRemove();
    t.store.clearCart();
    expect(t.store.getData().cart.editingOrderId).toBeNull();
    expect(t.get()).toEqual(saved);
  });

  it('4. service fermé : abandonner pour commencer une nouvelle commande est refusé, la modification est conservée', () => {
    const t = setup();
    t.editAndRemove();
    const cartBefore = t.store.getData().cart;
    const r = t.store.abandonEditAndStartOrder(t.autre.id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe(SERVICE_CLOSED_MESSAGE);
    expect(t.store.getData().cart).toEqual(cartBefore);
    // Une nouvelle commande ne peut toujours pas être créée service fermé.
    const count = t.store.getData().orders.length;
    t.store.clearCart();
    t.store.selectCustomer(t.autre.id);
    t.store.addProduct('reine');
    const n = t.store.validateCart();
    expect(!n.ok && n.error).toBe(SERVICE_CLOSED_MESSAGE);
    expect(t.store.getData().orders).toHaveLength(count);
  });
});

describe('modification d’une commande encaissée, service fermé', () => {
  it('5. l’enregistrement est accepté : la commande reste encaissée, avec son montant recalculé', () => {
    const t = setup();
    const before = t.get();
    t.editAndRemove();
    const r = t.store.validateCart();
    expect(r.ok).toBe(true);
    const after = t.get();
    expect(isPaid(after)).toBe(true);
    expect(after.payment).toEqual(before.payment);
    expect(after.number).toBe(before.number);
    expect(after.status).toBe(before.status);
    expect(after.totals.total).toBeLessThan(before.totals.total);
    expect(t.store.getData().serviceOpen).toBe(false);
  });

  it('6. fidélité recalculée sans double crédit, même en enregistrant plusieurs fois', () => {
    const t = setup();
    const base = t.points(t.jean.id);
    const autreBase = t.points(t.autre.id);
    t.editAndRemove();
    expect(t.store.validateCart().ok).toBe(true);
    expect(t.points(t.jean.id)).toBe(base - 1); // 3 pizzas payantes → 2
    // Rouvrir et réenregistrer sans changement, deux fois : aucun crédit supplémentaire.
    for (let i = 0; i < 2; i++) {
      expect(t.store.startEditOrder(t.id).ok).toBe(true);
      expect(t.store.validateCart().ok).toBe(true);
    }
    expect(t.points(t.jean.id)).toBe(base - 1);
    // La tentative de commander pour un autre client n'a rien crédité à personne.
    t.store.startEditOrder(t.id);
    t.store.selectCustomer(t.autre.id);
    t.store.validateCart();
    expect(t.points(t.autre.id)).toBe(autreBase);
    expect(t.points(t.jean.id)).toBe(base - 1);
  });
});

describe('7. petit écran : les actions du panier restent accessibles (contrat CSS et structure)', () => {
  const css = readFileSync(new URL('../src/styles/order.css', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/components/order/OrderPanel.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/styles/layout.css', import.meta.url), 'utf8');
  const block = (query: string) => {
    const start = css.indexOf(query);
    expect(start, `bloc ${query} absent`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('\n}', start));
  };

  it('les boutons d’enregistrement sont hors de la liste des produits, dans une barre collée en bas sur écran peu haut', () => {
    const actions = panel.slice(panel.indexOf('className="order-panel__actions"'));
    expect(panel.indexOf('</footer>')).toBeLessThan(panel.indexOf('className="order-panel__actions"'));
    expect(actions).toContain('Enregistrer et imprimer');
    expect(actions).toContain('Enregistrer sans imprimer');
    const short = block('@media (max-height: 560px) {');
    expect(short).toMatch(/\.order-panel__actions \{[^}]*position: sticky;[^}]*bottom: 0;/);
    // La liste des produits n'a plus sa propre zone de défilement : tout le panneau défile.
    expect(short).toMatch(/\.order-panel__lines \{[^}]*overflow: visible;/);
  });

  it('le panneau défile au lieu de couper son contenu, et l’application évite l’encoche et la barre d’accueil', () => {
    expect(css).toMatch(/\.panel\.order-panel \{[^}]*overflow-y: auto;/);
    expect(layout).toMatch(/\.app \{[^}]*padding: env\(safe-area-inset-top, 0px\) env\(safe-area-inset-right, 0px\) env\(safe-area-inset-bottom, 0px\) env\(safe-area-inset-left, 0px\);/);
  });
});
