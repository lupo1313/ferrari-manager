/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Espace de noms des clés localStorage (prévisualisation isolée). Absent : « ferrari-manager ». */
  readonly VITE_STORAGE_NAMESPACE?: string;
  /** Libellé affiché dans la barre du haut pour distinguer une prévisualisation. */
  readonly VITE_PREVIEW_LABEL?: string;
  /** Service Valhalla pour le trajet en scooter (absent : serveur public FOSSGIS, voir services/trajet.ts). */
  readonly VITE_ROUTING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
