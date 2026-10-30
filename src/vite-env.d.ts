/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Espace de noms des clés localStorage (prévisualisation isolée). Absent : « ferrari-manager ». */
  readonly VITE_STORAGE_NAMESPACE?: string;
  /** Libellé affiché dans la barre du haut pour distinguer une prévisualisation. */
  readonly VITE_PREVIEW_LABEL?: string;
  /** Service Valhalla pour le trajet en scooter (absent : serveur public FOSSGIS, voir services/trajet.ts). */
  readonly VITE_ROUTING_URL?: string;
  /** « 1 » : affiche la taille réelle de la fenêtre dans la barre latérale (prévisualisation seulement). */
  readonly VITE_VIEWPORT_INDICATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
