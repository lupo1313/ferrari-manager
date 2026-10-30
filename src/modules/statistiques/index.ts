import { lazy } from 'react';

/**
 * Point d'entrée unique du module facultatif Statistiques.
 *
 * Le module LIT les commandes et l'historique des services, il n'écrit jamais rien.
 * Il est chargé à la demande (fichier séparé) : masqué dans Paramètres, il n'est même pas téléchargé.
 * Pour le retirer complètement : supprimer ce dossier, l'entrée « statistiques » de Sidebar et useRoute,
 * le bloc correspondant dans App et la carte « Modules facultatifs » de Paramètres.
 * L'historique des services (domain/service) reste : il fait partie du socle de l'application.
 */
export const StatistiquesPage = lazy(() => import('./StatistiquesPage'));
