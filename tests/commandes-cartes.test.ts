import { describe, expect, it } from 'vitest';
import { createTestStore } from './helpers';
import {
  canCancelOrder,
  canEditOrder,
  canMarkPaidFromCard,
  primaryAction,
  secondaryActions,
  statusCorrections,
  STATUS_FLOW,
} from '../src/domain/orders';
import { elapsedLabel } from '../src/domain/time';
import { CARD_MIN_WIDTH, columnCount, distributeColumns, GRID_GAP } from '../src/components/orders/columns';
import type { Order, OrderStatus } from '../src/domain/types';

/** Commande enregistrée par le vrai store (client Jean Dupont, une Reine). */
function setup() {
  const t = createTestStore();
  const jean = t.customer('Dupont');
  const order = () => {
    t.store.selectCustomer(jean.id);
    t.store.addProduct('reine');
    const r = t.store.validateCart();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const get = (id: string) => t.store.getData().orders.find((o) => o.id === id)!;
  return { ...t, order, get };
}

const withStatus = (o: Order, status: OrderStatus): Order => ({ ...o, status });

describe('carte de commande : une seule action principale de préparation', () => {
  it('libellé et étape suivante selon le statut', () => {
    const t = setup();
    const o = t.order();
    expect(primaryAction(withStatus(o, 'a_preparer'))).toEqual({ to: 'en_preparation', label: 'Lancer la préparation' });
    expect(primaryAction(withStatus(o, 'en_preparation'))).toEqual({ to: 'prete', label: 'Marquer prête' });
    expect(primaryAction(withStatus(o, 'prete'))).toEqual({ to: 'terminee', label: 'Terminer la commande' });
    expect(primaryAction(withStatus(o, 'terminee'))).toBeNull();
    expect(primaryAction(withStatus(o, 'annulee'))).toBeNull();
    expect(primaryAction({ ...o, archivedAt: o.createdAt })).toBeNull();
  });

  it('parcours complet par l’action principale, accepté par le store à chaque étape', () => {
    const t = setup();
    const id = t.order().id;
    const labels: string[] = [];
    for (let step = primaryAction(t.get(id)); step; step = primaryAction(t.get(id))) {
      labels.push(step.label);
      expect(t.store.setOrderStatus(id, step.to).ok).toBe(true);
    }
    expect(labels).toEqual(['Lancer la préparation', 'Marquer prête', 'Terminer la commande']);
    expect(t.get(id).status).toBe('terminee');
  });
});

describe('carte de commande : correction d’un statut (menu secondaire)', () => {
  it('propose tous les autres statuts du flux, comme l’ancien sélecteur', () => {
    const t = setup();
    const o = t.order();
    for (const s of STATUS_FLOW) {
      expect(statusCorrections(withStatus(o, s))).toEqual(STATUS_FLOW.filter((x) => x !== s));
    }
    expect(statusCorrections(withStatus(o, 'annulee'))).toEqual([]);
    expect(statusCorrections({ ...o, archivedAt: o.createdAt })).toEqual([]);
  });

  it('une commande terminée par erreur peut être remise « Prête », puis « À préparer »', () => {
    const t = setup();
    const id = t.order().id;
    t.store.setOrderStatus(id, 'terminee');
    expect(statusCorrections(t.get(id))).toContain('prete');
    expect(t.store.setOrderStatus(id, 'prete').ok).toBe(true);
    expect(t.store.setOrderStatus(id, 'a_preparer').ok).toBe(true);
    expect(t.get(id).statusHistory.map((h) => h.status)).toEqual(['a_preparer', 'terminee', 'prete', 'a_preparer']);
  });
});

describe('carte de commande : aucune fonctionnalité perdue', () => {
  it('commande en cours non encaissée : préparation, encaissement, modification, ticket, correction, annulation', () => {
    const t = setup();
    const o = t.order();
    expect(primaryAction(o)).not.toBeNull();
    expect(canMarkPaidFromCard(o)).toBe(true);
    expect(canEditOrder(o)).toBe(true);
    expect(secondaryActions(o)).toEqual(['ticket', 'corriger_statut', 'annuler']);
  });

  it('commande encaissée : l’annulation de l’encaissement reste accessible, plus de bouton d’encaissement', () => {
    const t = setup();
    const id = t.order().id;
    t.store.markOrderPaid(id, 'carte');
    const o = t.get(id);
    expect(canMarkPaidFromCard(o)).toBe(false);
    expect(secondaryActions(o)).toEqual(['ticket', 'corriger_statut', 'annuler_encaissement', 'annuler']);
    // L'annulation d'une commande encaissée reste possible (confirmation et avertissement côté écran).
    expect(canCancelOrder(o)).toBe(true);
  });

  it('prête mais non encaissée, ou encaissée mais à préparer : les deux statuts restent indépendants', () => {
    const t = setup();
    const a = t.order().id;
    t.store.setOrderStatus(a, 'prete');
    expect(canMarkPaidFromCard(t.get(a))).toBe(true);
    expect(primaryAction(t.get(a))?.to).toBe('terminee');
    const b = t.order().id;
    t.store.markOrderPaid(b, 'especes');
    expect(t.get(b).status).toBe('a_preparer');
    expect(primaryAction(t.get(b))?.to).toBe('en_preparation');
  });

  it('commande terminée : plus de progression ni de modification, ticket et corrections disponibles', () => {
    const t = setup();
    const id = t.order().id;
    t.store.setOrderStatus(id, 'terminee');
    const o = t.get(id);
    expect(primaryAction(o)).toBeNull();
    expect(canEditOrder(o)).toBe(false);
    expect(secondaryActions(o)).toEqual(['ticket', 'corriger_statut', 'annuler']);
    expect(canMarkPaidFromCard(o)).toBe(true);
  });

  it('commande annulée ou archivée : lecture seule, ticket uniquement', () => {
    const t = setup();
    const id = t.order().id;
    t.store.markOrderPaid(id, 'carte');
    t.store.cancelOrder(id);
    const cancelled = t.get(id);
    expect(secondaryActions(cancelled)).toEqual(['ticket']);
    expect(canMarkPaidFromCard(cancelled)).toBe(false);
    expect(primaryAction(cancelled)).toBeNull();

    const other = t.order().id;
    t.store.markOrderPaid(other, 'carte');
    t.store.setOrderStatus(other, 'terminee');
    t.store.closeService();
    const archived = t.get(other);
    expect(archived.archivedAt).not.toBeNull();
    expect(secondaryActions(archived)).toEqual(['ticket']);
  });

  it('service fermé : les commandes restantes avancent et s’encaissent toujours', () => {
    const t = setup();
    const id = t.order().id;
    t.store.closeService();
    const o = t.get(id);
    expect(o.archivedAt).toBeNull();
    expect(primaryAction(o)).not.toBeNull();
    expect(t.store.setOrderStatus(id, primaryAction(o)!.to).ok).toBe(true);
    expect(canMarkPaidFromCard(t.get(id))).toBe(true);
    expect(t.store.markOrderPaid(id, 'non_precise').ok).toBe(true);
  });

  it('ancienne commande « Paiement non suivi » : encaissement toujours proposé', () => {
    const t = setup();
    const o = t.order();
    const legacy: Order = { ...o, payment: { status: 'a_encaisser', method: null, paidAt: null, legacy: true } };
    expect(canMarkPaidFromCard(legacy)).toBe(true);
    expect(secondaryActions(legacy)).not.toContain('annuler_encaissement');
  });
});

describe('ancienneté affichée', () => {
  const at = (hm: string) => new Date(`2026-10-30T${hm}:00`).toISOString();
  it('minutes puis heures, jamais négative', () => {
    expect(elapsedLabel(at('19:00'), at('19:00'))).toBe('< 1 min');
    expect(elapsedLabel(at('19:00'), at('19:18'))).toBe('18 min');
    expect(elapsedLabel(at('19:00'), at('20:05'))).toBe('1 h 05');
    expect(elapsedLabel(at('19:10'), at('19:00'))).toBe('< 1 min');
  });
});

describe('grille des commandes', () => {
  it('deux colonnes sur la tablette en paysage, trois seulement si chaque carte garde sa largeur minimale', () => {
    // 1280 px de large : 88 px de navigation et 32 px de marges, soit 1160 px pour les cartes.
    expect(columnCount(1160)).toBe(2);
    expect(columnCount(3 * CARD_MIN_WIDTH + 2 * GRID_GAP)).toBe(3);
    expect(columnCount(3 * CARD_MIN_WIDTH + 2 * GRID_GAP - 1)).toBe(2);
    expect(columnCount(700)).toBe(1);
    expect(columnCount(4000)).toBe(3);
  });

  it('répartition de gauche à droite : l’ordre des plus anciennes est conservé ligne par ligne', () => {
    expect(distributeColumns([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 3, 5],
      [2, 4],
    ]);
    expect(distributeColumns([1, 2, 3], 3)).toEqual([[1], [2], [3]]);
    expect(distributeColumns([1, 2], 0)).toEqual([[1, 2]]);
  });
});
