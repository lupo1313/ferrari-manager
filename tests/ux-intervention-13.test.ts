import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeliveryTicketView, KitchenTicketView } from '../src/components/ticket/TicketView';
import { describe, expect, it } from 'vitest';
import { createTestStore } from './helpers';
import { createMemoryRepository } from '../src/storage/repository';
import { buildDeliveryTicket, buildKitchenTicket } from '../src/domain/ticket';
import { normalizePizzeria, ticketCompanyLines } from '../src/domain/pizzeria';
import { dryRunLoad, emptyCartText, factsOf } from '../src/state/restoreDryRun';
import { backupToText, createBackup } from '../src/storage/export';
import { analyzeBackupText, performRestore, planFromSafetyCopy, restoreKeys, type StorageAccess } from '../src/storage/restore';

const extra = { siret: '000 000 000 00000', rcs: 'Ville TEST 000', vatNumber: 'FR00000000000', additionalMentions: 'Première ligne\nSeconde ligne', ticketFooter: 'Merci de votre visite !\nÀ bientôt' };
const make = () => {
  const t = createTestStore();
  t.store.selectCustomer(t.customer('Dupont').id);
  t.store.addProduct('reine');
  const r = t.store.validateCart();
  if (!r.ok) throw new Error(r.error);
  return { ...t, order: r.value };
};
function memory(initial: Record<string, string> = {}): StorageAccess {
  const map = new Map(Object.entries(initial));
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null, setItem: (k,v) => { map.set(k,v); }, removeItem: (k) => { map.delete(k); } };
}

describe('intervention 13 : mentions facultatives et données durables', () => {
  it('enregistre et recharge tous les champs sans changer commandes, clients ou fidélité', () => {
    const t = make(); const before = t.store.getData();
    expect(t.store.updateSettings({ pizzeria: { ...before.settings.pizzeria, ...extra } }).ok).toBe(true);
    const after = createTestStore(t.repo).store.getData();
    expect(after.settings.pizzeria).toMatchObject(extra);
    expect(after.orders).toEqual(before.orders); expect(after.customers).toEqual(before.customers);
    expect(after.loyaltyEvents).toEqual(before.loyaltyEvents); expect(factsOf(after)).toEqual(factsOf(before));
  });
  it('ancienne sauvegarde : aucune réécriture et tickets identiques si champs absents ou vides', () => {
    const t = make(); const before = t.store.getData(); const raw = t.repo.raw();
    const saves = t.repo.control.saves; const loaded = createTestStore(t.repo).store.getData();
    expect(t.repo.raw()).toBe(raw); expect(t.repo.control.saves).toBe(saves);
    const blank = { ...loaded.settings, pizzeria: { ...loaded.settings.pizzeria, siret: ' ', rcs: '', vatNumber: '', additionalMentions: '\n', ticketFooter: ' ' } };
    const delivery = { ...t.order, mode: 'livraison' as const };
    expect(buildKitchenTicket(t.order, blank)).toEqual(buildKitchenTicket(t.order, before.settings));
    expect(buildDeliveryTicket(delivery, blank)).toEqual(buildDeliveryTicket(delivery, before.settings));
  });
  it('mentions sur le livreur, pied sur les deux tickets, totaux et préparation conservés en 58 et 80 mm', () => {
    const t = make();
    for (const width of [58,80] as const) {
      const settings = { ...t.store.getData().settings, ticketWidthMm: width, pizzeria: { ...t.store.getData().settings.pizzeria, ...extra } };
      const kitchen = buildKitchenTicket(t.order, settings);
      const delivery = buildDeliveryTicket({ ...t.order, mode: 'livraison' }, settings)!;
      expect(kitchen.footer).toBe(extra.ticketFooter); expect(kitchen).not.toHaveProperty('companyLines');
      expect(kitchen.groups).toEqual(buildKitchenTicket(t.order, t.store.getData().settings).groups);
      expect(delivery.companyLines).toEqual(['SIRET : '+extra.siret, 'RCS : '+extra.rcs, 'TVA : '+extra.vatNumber, extra.additionalMentions]);
      expect(delivery.footer).toBe(extra.ticketFooter); expect(delivery.widthMm).toBe(width);
      expect(delivery.payment).toEqual(buildDeliveryTicket({ ...t.order, mode: 'livraison' }, t.store.getData().settings)!.payment);
    }
  });
  it('le rendu échappe les mentions et ne crée aucun pied vide', () => {
    const t = make(); const settings = t.store.getData().settings;
    expect(renderToStaticMarkup(createElement(KitchenTicketView, { ticket: buildKitchenTicket(t.order, settings) }))).not.toContain('ticket__footer');
    const printed = buildDeliveryTicket({ ...t.order, mode: 'livraison' }, { ...settings, pizzeria: { ...settings.pizzeria, additionalMentions: '<script>alert(1)</script>', ticketFooter: 'Merci & bienvenue' } })!;
    const html = renderToStaticMarkup(createElement(DeliveryTicketView, { ticket: printed }));
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('Merci &amp; bienvenue'); expect(html.match(/ticket__footer/g)).toHaveLength(1);
  });
  it('champs corrompus ignorés sans erreur et texte trop long refusé sans écriture', () => {
    const t = make(); const p = t.store.getData().settings.pizzeria;
    expect(normalizePizzeria({ ...p, ticketFooter: 123 as never }).ticketFooter).toBe('');
    expect(ticketCompanyLines({ ...p, siret: {} as never })).toEqual([]);
    const before = t.repo.raw();
    expect(t.store.updateSettings({ pizzeria: { ...p, ticketFooter: 'x'.repeat(251) } }).ok).toBe(false);
    expect(t.repo.raw()).toBe(before);
  });
  it('échec du stockage : les mentions affichées et persistées restent inchangées', () => {
    const t = make(); const before = t.store.getData().settings;
    t.repo.control.failOn = 'doc';
    expect(t.store.updateSettings({ pizzeria: { ...before.pizzeria, ...extra } }).ok).toBe(false);
    expect(t.store.getData().settings).toEqual(before);
  });
  it('ancienne préférence vente lisible sans réécriture au chargement', () => {
    const t = make(); const raw = JSON.parse(t.repo.raw()!); raw.settings.paymentSoundKind = 'vente';
    const repo = createMemoryRepository(raw); const before = repo.raw();
    expect(createTestStore(repo).store.isStorageLocked()).toBe(false); expect(repo.raw()).toBe(before);
  });
  it.each([false,true])('export, restauration et copie de sécurité avec nouveaux champs = %s', async (withFields) => {
    const t = make();
    if (withFields) t.store.updateSettings({ pizzeria: { ...t.store.getData().settings.pizzeria, ...extra } });
    const keys = restoreKeys('ferrari-manager');
    const source = memory({ [keys.doc]: t.repo.raw()! });
    const text = backupToText(await createBackup(source, { namespace: keys.namespace, now: new Date('2026-11-06T12:00:00Z'), origin: 'https://exemple.test' }));
    const analysis = await analyzeBackupText(text, keys.namespace);
    if (!analysis.ok) throw new Error(JSON.stringify(analysis.problems));
    const initial = make(); const original = initial.store.getData();
    const target = memory({ [keys.doc]: initial.repo.raw()! });
    const result = await performRestore(target, { mode: 'fichier', docText: analysis.docText, cartText: emptyCartText(), carte: 'conserver' }, { keys, now: new Date(), origin: 'https://exemple.test' });
    expect(result.ok).toBe(true);
    const restored = dryRunLoad(target.getItem(keys.doc)!, target.getItem(keys.cart));
    if (!restored.ok) throw new Error(restored.reason);
    expect(restored.data.settings.pizzeria).toEqual(t.store.getData().settings.pizzeria);
    expect(restored.data.orders).toEqual(t.store.getData().orders);
    expect(restored.data.customers).toEqual(t.store.getData().customers);
    expect(restored.facts).toEqual(factsOf(t.store.getData()));
    const safety = await analyzeBackupText(target.getItem(keys.safety)!, keys.namespace);
    if (!safety.ok) throw new Error('Copie invalide');
    const rollback = await performRestore(target, planFromSafetyCopy(target.getItem(keys.safety)!, keys)!, { keys, now: new Date(), origin: 'https://exemple.test' });
    expect(rollback.ok).toBe(true);
    const returned = dryRunLoad(target.getItem(keys.doc)!, target.getItem(keys.cart));
    if (!returned.ok) throw new Error(returned.reason);
    expect(returned.data.settings).toEqual(original.settings); expect(returned.facts).toEqual(factsOf(original));
  });
});
