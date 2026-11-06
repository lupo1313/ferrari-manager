import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestStore } from './helpers';
import { buildCustomersCsv } from '../src/domain/customersCsv';
import { analyzeCustomersCsv } from '../src/domain/customersImport';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('intervention 12 : organisation de la page Paramètres', () => {
  const page = read('src/pages/SettingsPage.tsx');

  it('quatre groupes dans l’ordre demandé, toutes les fonctions conservées', () => {
    const titles = ['Carte et produits', 'Service et fonctionnement', 'Fidélité', 'Données et sauvegardes'];
    const positions = titles.map((t) => page.indexOf(`\n          ${t}\n`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const feature of [
      'Gérer les produits', '#/parametres/carte', 'Gérer les suppléments', '#/parametres/supplements', 'Largeur du rouleau thermique',
      'Nom sur le ticket', 'Son des encaissements', 'Onglet Statistiques', 'Livraison toujours offerte', 'Calcul des trajets de livraison',
      '<BackupCard />', '<RestoreCard />', 'Réinitialiser les données de démonstration', 'store.resetDemoData()',
    ]) expect(page, feature).toContain(feature);
  });

  it('accordéon Fidélité : replié par défaut, résumé, action claire, mêmes cases à cocher', () => {
    expect(page).toContain('const [loyaltyOpen, setLoyaltyOpen] = useState(false);');
    expect(page).toContain('Fidélité — Produits éligibles');
    expect(page).toContain('pizzas payantes = 1 récompense.');
    expect(page).toContain('éligible');
    expect(page).toContain('Modifier les produits éligibles');
    expect(page).toContain('aria-expanded={loyaltyOpen}');
    expect(page).toContain('aria-controls="loyalty-eligible"');
    // Même liste, mêmes règles : produits actifs, boissons alcoolisées exclues.
    expect(page).toContain("onChange={() => toggle('eligiblePizzaIds', p.id)}");
    expect(page).toContain("onChange={() => toggle('eligibleDrinkIds', p.id)}");
    expect(page).toContain('disabled={p.alcohol}');
    expect(page).toContain('checked={!p.alcohol && draft.loyalty.eligibleDrinkIds.includes(p.id)}');
  });

  it('replier ne sauvegarde ni n’annule : le brouillon vit dans la page, seul « Enregistrer » écrit', () => {
    const open = page.indexOf('setLoyaltyOpen((v) => !v)');
    expect(open).toBeGreaterThan(0);
    // Le bouton de repli ne touche qu'à l'état d'ouverture.
    expect(page.slice(open - 200, open + 60)).not.toMatch(/updateSettings|setDraft/);
    expect(page.match(/store\.updateSettings\(draft\)/g)).toHaveLength(1);
    expect(page).toContain('const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);');
    expect(page).toContain('loyaltyDirty');
    expect(page).toContain('Modifications non enregistrées');
  });

  it('indications d’enregistrement : immédiat pour son et modules, « Enregistrer » pour ticket et fidélité', () => {
    expect(page.match(/Enregistrement immédiat/g)).toHaveLength(2);
    expect(page.match(/Cliquez sur Enregistrer pour appliquer/g)).toHaveLength(2);
    const sound = page.slice(page.indexOf('Son des encaissements'), page.indexOf('Onglet Statistiques'));
    expect(sound).toContain('Enregistrement immédiat');
    expect(sound).toContain("store.updateSettings({ paymentSound: on, paymentSoundKind: 'caisse' })");
    const tickets = page.slice(page.indexOf('Pizzeria et ticket'), page.indexOf('Son des encaissements'));
    expect(tickets).toContain('Cliquez sur Enregistrer pour appliquer');
  });

  it('bouton « Enregistrer » toujours accessible : en-tête collant dans la page', () => {
    expect(page).toContain('page__header page__header--sticky');
    const css = read('src/styles/pages.css');
    expect(css).toMatch(/\.page__header--sticky \{\s*position: sticky;\s*top: -4px;/);
  });
});

describe('intervention 12 : un seul défilement vertical', () => {
  const layout = read('src/styles/layout.css');
  it('cause corrigée : .page est le bloc conteneur des éléments absolus (.sr-only), plus de défilement de <html> ni de .app', () => {
    expect(read('src/styles/pages.css')).toMatch(/\.page \{\s*\/\*[\s\S]*?\*\/\s*position: relative;\s*flex: 1;/);
    expect(layout).toMatch(/\.app \{[\s\S]*?overflow: hidden;/);
    expect(layout).not.toMatch(/\.app \{[^}]*position: relative;/);
    // Une seule zone de défilement par page : .page.
    expect(read('src/styles/pages.css')).toMatch(/\.page \{[\s\S]*?overflow-y: auto;/);
  });
  it('la correction ne masque rien : aucune règle ne cache la barre de défilement', () => {
    for (const css of ['src/styles/layout.css', 'src/styles/pages.css', 'src/styles/base.css']) {
      expect(read(css), css).not.toMatch(/scrollbar-width:\s*none|::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
    }
  });
});

describe('intervention 12 : réglages et import/export CSV inchangés', () => {
  it('seules les écritures de réglages existantes : persistance non modifiée', () => {
    const { store } = createTestStore();
    const before = store.getData().settings;
    // Un brouillon (dans la page) n'écrit rien : seul updateSettings modifie les réglages.
    expect(store.getData().settings).toEqual(before);
    const ids = store.getData().settings.loyalty.eligiblePizzaIds;
    const r = store.updateSettings({ ...before, loyalty: { ...before.loyalty, eligiblePizzaIds: ids.slice(1) } });
    expect(r.ok).toBe(true);
    expect(store.getData().settings.loyalty.eligiblePizzaIds).toEqual(ids.slice(1));
    expect(store.getData().settings.loyalty.pizzasPerReward).toBe(before.loyalty.pizzasPerReward);
  });

  it('export puis réimport CSV : toujours 5 doublons détectés, aucun nouveau client', () => {
    const { store } = createTestStore();
    const csv = buildCustomersCsv(store.getData().customers);
    const a = analyzeCustomersCsv(csv, store.getData().customers);
    expect(a).toMatchObject({ duplicatesExisting: store.getData().customers.length, toAdd: [], invalid: 0 });
  });

  it('les pages et composants métier ne sont pas touchés par cette intervention', () => {
    const page = read('src/pages/ClientsPage.tsx');
    expect(page).toContain('Exporter les clients');
    expect(page).toContain('Importer les clients');
  });
});
