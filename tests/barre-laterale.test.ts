import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CARTE_MIN,
  COLUMN_WIDTHS,
  FORCED_REDUCED_BELOW,
  ONGLETS_CARTE_MIN,
  PRODUCT_CARD_MIN,
  PRODUCT_GAP,
  SIDEBAR_WIDTH,
  WORKSPACE_GAP,
  WORKSPACE_PADDING,
  carteWidth,
  columnWidths,
  displayedSidebarState,
  dispositionFor,
  productsPerRow,
  shouldAutoCollapse,
  sidebarAfterToggle,
  type CartIdentity,
  type SidebarState,
} from '../src/components/layout/disposition';
import { INTERFACE_KEY, interfaceKey, readSidebarPreference, writeSidebarPreference } from '../src/storage/interface';
import { createKeyValueRepository, DEFAULT_STORAGE_NAMESPACE, type KeyValueStore } from '../src/storage/repository';
import { readAppKeys } from '../src/storage/export';
import { createAppStore } from '../src/state/store';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import { createTestStore, sequentialIds } from './helpers';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Place disponible à côté de la barre pour une fenêtre donnée. */
const available = (windowWidth: number, state: SidebarState) => windowWidth - SIDEBAR_WIDTH[state];
const layout = (windowWidth: number, state: SidebarState) => dispositionFor(available(windowWidth, state), windowWidth);

/** Largeur de la colonne Commande telle que le CSS la produit (null : panier en onglet plein écran). */
function commandeWidth(windowWidth: number, state: SidebarState): number | null {
  return layout(windowWidth, state) === 'onglets' ? null : columnWidths(windowWidth).commande;
}

describe('1. disposition selon la place réellement disponible', () => {
  it('tablette Samsung (1440 px) : trois colonnes ouverte et réduite, panier de 380 px, la Carte récupère les 104 px', () => {
    expect(layout(1440, 'ouverte')).toBe('colonnes');
    expect(layout(1440, 'reduite')).toBe('colonnes');
    expect(commandeWidth(1440, 'ouverte')).toBe(380);
    expect(commandeWidth(1440, 'reduite')).toBe(380);
    expect(carteWidth(available(1440, 'ouverte'), 1440)).toBe(528);
    expect(carteWidth(available(1440, 'reduite'), 1440)).toBe(632);
  });

  it('1440 px : deux cartes produit par ligne dans les deux états (jamais trois cartes comprimées)', () => {
    expect(productsPerRow(carteWidth(available(1440, 'ouverte'), 1440))).toBe(2);
    expect(productsPerRow(carteWidth(available(1440, 'reduite'), 1440))).toBe(2);
    // Trois cartes n'apparaîtraient qu'avec au moins 190 px chacune, marges et barre de défilement comprises.
    expect(productsPerRow(3 * PRODUCT_CARD_MIN + 2 * PRODUCT_GAP + 51)).toBe(3);
    expect(productsPerRow(3 * PRODUCT_CARD_MIN + 2 * PRODUCT_GAP + 50)).toBe(2);
  });

  it('vers 1180 px : onglets barre ouverte, trois colonnes barre réduite', () => {
    expect(layout(1180, 'ouverte')).toBe('onglets-carte');
    expect(layout(1180, 'reduite')).toBe('colonnes');
    expect(productsPerRow(carteWidth(available(1180, 'reduite'), 1180))).toBe(2);
  });

  it('autres fenêtres : 1280, 1080, 960, iPhone paysage et portrait', () => {
    expect(layout(1280, 'reduite')).toBe('colonnes');
    expect(layout(1280, 'ouverte')).toBe('onglets-carte');
    expect(layout(1080, 'ouverte')).toBe('onglets-carte');
    expect(layout(1080, 'reduite')).toBe('onglets-carte');
    expect(layout(960, 'reduite')).toBe('onglets-carte');
    expect(layout(844, 'reduite')).toBe('onglets');
    expect(layout(390, 'reduite')).toBe('onglets');
  });

  it('trois colonnes seulement si la Carte garde deux cartes produit par ligne (seuil exact)', () => {
    for (const windowWidth of [1300, 1500]) {
      const { client, commande } = columnWidths(windowWidth);
      const minimum = 2 * WORKSPACE_PADDING + 2 * WORKSPACE_GAP + client + commande + CARTE_MIN;
      expect(dispositionFor(minimum, windowWidth)).toBe('colonnes');
      expect(dispositionFor(minimum - 1, windowWidth)).not.toBe('colonnes');
      expect(productsPerRow(carteWidth(minimum, windowWidth))).toBe(2);
    }
    expect(dispositionFor(ONGLETS_CARTE_MIN, 1000)).toBe('onglets-carte');
    expect(dispositionFor(ONGLETS_CARTE_MIN - 1, 1000)).toBe('onglets');
  });

  it('replier ou déplier ne change jamais la largeur du panier quand il est affiché en colonne (900 à 1920 px)', () => {
    for (let w = FORCED_REDUCED_BELOW; w <= 1920; w++) {
      const open = commandeWidth(w, 'ouverte');
      const reduced = commandeWidth(w, 'reduite');
      if (open !== null && reduced !== null) expect(open, `fenêtre ${w}`).toBe(reduced);
      // La barre réduite ne donne jamais moins de place que la barre ouverte.
      const rank = { onglets: 0, 'onglets-carte': 1, colonnes: 2 } as const;
      expect(rank[layout(w, 'reduite')]).toBeGreaterThanOrEqual(rank[layout(w, 'ouverte')]);
    }
  });

  it('la disposition ne dépend que de la place disponible : même mesure, même résultat (aucune oscillation)', () => {
    for (let a = 300; a <= 1900; a += 7) {
      const first = dispositionFor(a, a + 72);
      expect(dispositionFor(a, a + 72)).toBe(first);
    }
  });
});

describe('2. état de la barre : préférence, défaut, fenêtre étroite, repli automatique', () => {
  it('sans préférence : ouverte à partir de 1400 px, réduite en dessous (apparence d’avant)', () => {
    expect(displayedSidebarState({ preference: null, autoCollapsed: false, windowWidth: 1440 })).toBe('ouverte');
    expect(displayedSidebarState({ preference: null, autoCollapsed: false, windowWidth: 1399 })).toBe('reduite');
  });

  it('la préférence l’emporte sur le défaut ; la fenêtre étroite force la barre réduite', () => {
    expect(displayedSidebarState({ preference: 'reduite', autoCollapsed: false, windowWidth: 1440 })).toBe('reduite');
    expect(displayedSidebarState({ preference: 'ouverte', autoCollapsed: false, windowWidth: 1180 })).toBe('ouverte');
    expect(displayedSidebarState({ preference: 'ouverte', autoCollapsed: false, windowWidth: 899 })).toBe('reduite');
  });

  it('repli automatique : barre réduite affichée, préférence inchangée ; rechargement = préférence', () => {
    expect(displayedSidebarState({ preference: 'ouverte', autoCollapsed: true, windowWidth: 1440 })).toBe('reduite');
    // Au rechargement, le repli automatique (en mémoire seulement) a disparu.
    expect(displayedSidebarState({ preference: 'ouverte', autoCollapsed: false, windowWidth: 1440 })).toBe('ouverte');
  });

  it('appui sur le bouton : inverse l’état affiché et lève le repli automatique', () => {
    expect(sidebarAfterToggle('reduite')).toEqual({ preference: 'ouverte', autoCollapsed: false });
    expect(sidebarAfterToggle('ouverte')).toEqual({ preference: 'reduite', autoCollapsed: false });
  });
});

describe('3. repli automatique après la sélection effective d’un client (store réel)', () => {
  const identity = (t: ReturnType<typeof createTestStore>): CartIdentity => {
    const { customerId, editingOrderId } = t.store.getData().cart;
    return { customerId, editingOrderId };
  };
  /** Rejoue une action et dit si la barre se replierait. */
  const collapses = (t: ReturnType<typeof createTestStore>, action: () => unknown) => {
    const before = identity(t);
    action();
    return shouldAutoCollapse(before, identity(t));
  };
  const input = (lastName: string, phone: string) => ({ lastName, firstName: '', phone, address: '', postalCode: '', city: '', complement: '', instructions: '' });

  it('choix d’un client (liste, recherche, « Commander » depuis Clients) : repli', () => {
    const t = createTestStore();
    const [a, b] = t.store.getData().customers;
    expect(collapses(t, () => t.store.selectCustomer(a.id))).toBe(true);
    // Changement pour un autre client : repli aussi.
    expect(collapses(t, () => t.store.selectCustomer(b.id))).toBe(true);
  });

  it('fiche créée puis sélectionnée : repli ; fiche créée sans sélection : rien', () => {
    const t = createTestStore();
    expect(collapses(t, () => t.store.createCustomer(input('Nouveau', '0677001122'), { select: true }))).toBe(true);
    t.store.selectCustomer(null);
    expect(collapses(t, () => t.store.createCustomer(input('Autre', '0677001133')))).toBe(false);
  });

  it('numéro déjà connu, fiche existante sélectionnée : repli', () => {
    const t = createTestStore();
    const existing = t.store.getData().customers[0];
    const r = t.store.createCustomer(input('Doublon', existing.phone), { select: true });
    expect(r.ok).toBe(false);
    expect(collapses(t, () => t.store.selectCustomer(existing.id))).toBe(true);
  });

  it('pas de repli : chargement, retrait du client, même client, commande enregistrée, panier vidé', () => {
    const t = createTestStore();
    const c = t.store.getData().customers[0];
    // Au chargement, l'identité précédente est celle du panier restauré : aucun changement.
    t.store.selectCustomer(c.id);
    expect(shouldAutoCollapse(identity(t), identity(t))).toBe(false);
    expect(collapses(t, () => t.store.selectCustomer(c.id))).toBe(false);
    expect(collapses(t, () => t.store.selectCustomer(null))).toBe(false);
    t.store.selectCustomer(c.id);
    t.store.addProduct(demoCatalog.products[0].id);
    expect(collapses(t, () => t.store.validateCart())).toBe(false);
    t.store.selectCustomer(c.id);
    expect(collapses(t, () => t.store.clearCart())).toBe(false);
  });

  it('ouvrir une commande pour la modifier : pas de repli ; « Abandonner et commander » pour un client : repli', () => {
    const t = createTestStore();
    const [a, b] = t.store.getData().customers;
    t.store.selectCustomer(a.id);
    t.store.addProduct(demoCatalog.products[0].id);
    const order = t.store.validateCart();
    expect(order.ok).toBe(true);
    if (!order.ok) return;
    expect(collapses(t, () => t.store.startEditOrder(order.value.id))).toBe(false);
    expect(collapses(t, () => t.store.abandonEditAndStartOrder(b.id))).toBe(true);
  });

  it('le repli ne touche ni au panier, ni au client, ni au store (interface seulement)', () => {
    const t = createTestStore();
    const c = t.store.getData().customers[0];
    t.store.selectCustomer(c.id);
    t.store.addProduct(demoCatalog.products[0].id);
    t.store.setOrderNote('Bien cuite');
    const before = JSON.stringify(t.store.getData());
    shouldAutoCollapse({ customerId: null, editingOrderId: null }, identity(t));
    displayedSidebarState({ preference: 'ouverte', autoCollapsed: true, windowWidth: 1180 });
    expect(JSON.stringify(t.store.getData())).toBe(before);
  });
});

describe('4. préférence : petite clé séparée du stockage métier', () => {
  function memory(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    const writes: string[] = [];
    const kv = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        writes.push(k);
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
    };
    return { map, kv, writes };
  }

  it('clés : production et prévisualisation séparées, hors du préfixe des données', () => {
    expect(INTERFACE_KEY).toBe('ferrari-manager-interface');
    expect(interfaceKey(DEFAULT_STORAGE_NAMESPACE)).toBe('ferrari-manager-interface');
    expect(interfaceKey('ferrari-manager-apercu-i3')).toBe('ferrari-manager-apercu-i3-interface');
    expect(INTERFACE_KEY.startsWith('ferrari-manager:')).toBe(false);
  });

  it('lecture : absente ou illisible = aucune préférence, sans écriture', () => {
    for (const raw of [undefined, '', 'pas du json', '"ouverte"', '{"barreLaterale":"fermee"}', '{"v":1}', 'null']) {
      const m = memory(raw === undefined ? {} : { [INTERFACE_KEY]: raw });
      expect(readSidebarPreference(m.kv)).toBeNull();
      expect(m.writes).toEqual([]);
    }
    const m = memory({ [INTERFACE_KEY]: '{"v":1,"barreLaterale":"reduite"}' });
    expect(readSidebarPreference(m.kv)).toBe('reduite');
  });

  it('stockage inaccessible (navigation privée) : aucune erreur, choix gardé en mémoire par l’appelant', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readSidebarPreference(broken)).toBeNull();
    expect(writeSidebarPreference(broken, 'reduite')).toBe(false);
    expect(readSidebarPreference(null)).toBeNull();
    expect(writeSidebarPreference(null, 'ouverte')).toBe(false);
  });

  it('écriture : format versionné, relu à l’identique', () => {
    const m = memory();
    expect(writeSidebarPreference(m.kv, 'ouverte')).toBe(true);
    expect(JSON.parse(m.map.get(INTERFACE_KEY) ?? '')).toEqual({ v: 1, barreLaterale: 'ouverte' });
    expect(readSidebarPreference(m.kv)).toBe('ouverte');
  });

  it('jamais incluse dans la sauvegarde JSON (production ni prévisualisation)', () => {
    const m = memory({
      'ferrari-manager:v1': '{}',
      'ferrari-manager:v1:panier': '{}',
      'ferrari-manager-interface': '{"v":1,"barreLaterale":"reduite"}',
      'ferrari-manager-apercu-i3:v1': '{}',
      'ferrari-manager-apercu-i3-interface': '{"v":1,"barreLaterale":"ouverte"}',
    });
    expect(Object.keys(readAppKeys(m.kv, 'ferrari-manager'))).toEqual(['ferrari-manager:v1', 'ferrari-manager:v1:panier']);
    expect(Object.keys(readAppKeys(m.kv, 'ferrari-manager-apercu-i3'))).toEqual(['ferrari-manager-apercu-i3:v1']);
  });

  it('intacte après les opérations métier, une restauration des données et « Réinitialiser »', () => {
    const m = memory({ [INTERFACE_KEY]: '{"v":1,"barreLaterale":"reduite"}' });
    const kv: KeyValueStore = m.kv;
    const repo = createKeyValueRepository(kv, 'ferrari-manager:v1', 'ferrari-manager:v1:panier');
    const store = createAppStore({ repo, catalog: demoCatalog, seed: buildDemoData, now: () => new Date('2026-10-31T19:00:00'), newId: sequentialIds() });
    const c = store.getData().customers[0];
    store.selectCustomer(c.id);
    store.addProduct(demoCatalog.products[0].id);
    store.validateCart();
    store.closeService();
    store.openService();
    store.flushPendingWrites();
    // Restauration des données : seules les deux clés métier sont réécrites.
    repo.replaceAll(store.getData(), store.getData().cart);
    // Paramètres → Réinitialiser.
    store.resetDemoData();
    expect(m.writes).not.toContain(INTERFACE_KEY);
    expect(readSidebarPreference(m.kv)).toBe('reduite');
  });

  it('le store, le domaine et le stockage métier ne connaissent pas cette clé', () => {
    for (const path of ['src/state/store.ts', 'src/storage/repository.ts', 'src/storage/schema.ts', 'src/storage/export.ts']) {
      expect(read(path), path).not.toContain('storage/interface');
      expect(read(path), path).not.toContain('-interface');
    }
  });
});

describe('5. contrats CSS et structure', () => {
  const layoutCss = read('src/styles/layout.css');
  const tokens = read('src/styles/tokens.css');
  const catalogCss = read('src/styles/catalog.css');
  const orderCss = read('src/styles/order.css');

  it('largeurs de la barre identiques au calcul', () => {
    expect(tokens).toContain(`--sidebar-w: ${SIDEBAR_WIDTH.ouverte}px;`);
    expect(layoutCss).toMatch(new RegExp(`\\.app\\[data-sidebar='reduite'\\] \\{\\s*--sidebar-w: ${SIDEBAR_WIDTH.reduite}px;`));
    // Plus aucune largeur de barre décidée par la taille de l'écran.
    expect(tokens.match(/--sidebar-w/g)).toHaveLength(1);
  });

  it('colonnes, marges et cartes produit identiques au calcul', () => {
    expect(layoutCss).toContain(`--col-client: ${COLUMN_WIDTHS.large.client}px;`);
    expect(layoutCss).toContain(`--col-commande: ${COLUMN_WIDTHS.large.commande}px;`);
    expect(layoutCss).toContain(`--col-client: ${COLUMN_WIDTHS.compact.client}px;`);
    expect(layoutCss).toContain(`--col-commande: ${COLUMN_WIDTHS.compact.commande}px;`);
    expect(layoutCss).toMatch(/@media \(max-width: 1399px\) \{\s*\.workspace \{\s*--col-client/);
    expect(layoutCss).toMatch(new RegExp(`gap: ${WORKSPACE_GAP}px;\\s*padding: 0 ${WORKSPACE_PADDING}px ${WORKSPACE_PADDING}px;`));
    expect(catalogCss).toContain(`grid-template-columns: repeat(auto-fill, minmax(${PRODUCT_CARD_MIN}px, 1fr));\n  gap: ${PRODUCT_GAP}px;`);
    expect(catalogCss).toContain('.catalog-panel__body {\n  padding: 16px 16px 24px;');
  });

  it('les dispositions en onglets suivent la place disponible, plus la largeur de l’écran ; panier à la même largeur', () => {
    expect(layoutCss).not.toMatch(/max-width: 1179px|max-width: 959px|min-width: 960px/);
    expect(layoutCss).toContain(".app[data-disposition='onglets-carte'] .workspace {\n  grid-template-columns: minmax(0, 1fr) var(--col-commande);");
    expect(layoutCss).toContain(".app[data-disposition='onglets'] .workspace {");
    expect(orderCss).not.toContain('max-width: 959px');
    expect(orderCss).toContain(".app[data-disposition='onglets'] .order-panel__actions {");
  });

  it('faible hauteur : actions du panier et bouton de la barre collés en bas de leur zone de défilement', () => {
    expect(orderCss).toMatch(/\.order-panel__actions \{\s*position: sticky;\s*bottom: 0;/);
    expect(layoutCss).toMatch(/\.sidebar__bottom \{\s*position: sticky;\s*bottom: 0;/);
  });

  it('pas d’animation de largeur sur la barre ni la grille', () => {
    const sidebarSection = layoutCss.slice(layoutCss.indexOf('/* ---------- Barre latérale'), layoutCss.indexOf('/* ---------- Barre supérieure'));
    expect(sidebarSection).not.toContain('transition');
  });

  it('les trois colonnes restent toujours dans la page (aucune saisie perdue en changeant de disposition)', () => {
    const page = read('src/pages/OrderTakingPage.tsx');
    for (const col of ['workspace__col--client', 'workspace__col--carte', 'workspace__col--commande']) {
      // Rendu sans condition, directement dans la grille (pas de « && » ni de ternaire devant).
      expect(page).toMatch(new RegExp(`\\n {6}<div className="workspace__col ${col}">`));
    }
    expect(page).not.toMatch(/disposition/);
  });

  it('bouton de la barre : nommé selon son action, état indiqué, relié au menu ; un seul bouton dans les deux états', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).toContain("aria-label={open ? 'Réduire le menu' : 'Déplier le menu'}");
    expect(sidebar).toContain('aria-expanded={open}');
    expect(sidebar).toContain('aria-controls="sidebar-navigation"');
    expect(sidebar).toContain('id="sidebar-navigation"');
    expect(sidebar.match(/className="sidebar__toggle"/g)).toHaveLength(1);
    // Chaque entrée garde un nom accessible sans dépendre de l'info-bulle.
    expect(sidebar).toMatch(/className="sidebar__item"[\s\S]*aria-label=\{/);
  });

  it('indicateur de taille : prévisualisation seulement', () => {
    expect(read('.env.apercu')).toContain('VITE_VIEWPORT_INDICATOR=1');
    expect(read('src/App.tsx')).toContain("import.meta.env.VITE_VIEWPORT_INDICATOR === '1'");
  });
});
