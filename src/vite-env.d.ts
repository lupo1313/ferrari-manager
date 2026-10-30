/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Espace de noms des clés localStorage (prévisualisation isolée). Absent : « ferrari-manager ». */
  readonly VITE_STORAGE_NAMESPACE?: string;
  /** Libellé affiché dans la barre du haut pour distinguer une prévisualisation. */
  readonly VITE_PREVIEW_LABEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
