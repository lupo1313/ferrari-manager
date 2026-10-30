/** Affichage de l'état du service : vert = ouvert, gris = fermé (état normal, pas une erreur). */
export interface ServiceIndicator {
  tone: 'green' | 'grey';
  label: string;
  action: string;
}

export function serviceIndicator(open: boolean): ServiceIndicator {
  return open
    ? { tone: 'green', label: 'Service ouvert', action: 'Fermer le service' }
    : { tone: 'grey', label: 'Service fermé', action: 'Ouvrir le service' };
}
