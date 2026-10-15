/**
 * Profils et droits (cahier des charges §4).
 * Un compte peut cumuler plusieurs profils. La base applique en plus ses propres règles
 * (validation par une autre personne que l'initiateur, rôle validateur…) : ce fichier
 * sert à afficher les bons boutons et à refuser tôt, avec un message clair.
 */
export const ROLES = {
  gestionnaire: "Gestionnaire de portefeuille / trésorier",
  back_office: "Back-office titres",
  validateur: "Validateur",
  comptabilite: "Comptabilité",
  risques: "Risques / contrôle interne",
  direction: "Direction",
  admin: "Administrateur",
  auditeur: "Auditeur",
} as const;
export type Role = keyof typeof ROLES;
export const LISTE_ROLES = Object.keys(ROLES) as Role[];

export const PERMISSIONS = {
  saisir_operation: "Saisir des opérations",
  gerer_instruments: "Créer et modifier les instruments",
  valider: "Approuver ou rejeter (opérations, grevages, instruments)",
  regler: "Constater le règlement des opérations",
  encaisser: "Enregistrer et rapprocher les encaissements",
  grever: "Préparer des grevages",
  lever_grevage: "Lever ou réduire un grevage",
  importer: "Importer des fichiers",
  rapprocher: "Saisir les relevés des conservateurs",
  arreter: "Calculer un arrêté",
  verrouiller_arrete: "Verrouiller un arrêté",
  rouvrir_arrete: "Rouvrir un arrêté verrouillé",
  traiter_controles: "Traiter les alertes et anomalies",
  exporter: "Exporter les états",
  gerer_referentiels: "Administrer les référentiels",
  parametrer: "Modifier les paramètres",
  gerer_utilisateurs: "Gérer les comptes",
  voir_journal: "Consulter le journal et l'audit",
} as const;
export type Permission = keyof typeof PERMISSIONS;

const MATRICE: Record<Role, Permission[]> = {
  gestionnaire: ["saisir_operation", "gerer_instruments", "grever", "exporter"],
  back_office: ["saisir_operation", "gerer_instruments", "regler", "encaisser", "lever_grevage", "importer", "rapprocher", "traiter_controles", "exporter"],
  validateur: ["valider", "lever_grevage", "verrouiller_arrete", "rouvrir_arrete", "traiter_controles", "exporter"],
  comptabilite: ["arreter", "verrouiller_arrete", "rapprocher", "exporter"],
  risques: ["traiter_controles", "parametrer", "exporter"],
  direction: ["exporter"],
  admin: ["gerer_referentiels", "parametrer", "gerer_utilisateurs", "voir_journal", "exporter", "importer", "arreter"],
  auditeur: ["voir_journal", "exporter"],
};

export function permissionsDe(roles: readonly string[]): Set<Permission> {
  const s = new Set<Permission>();
  for (const r of roles) for (const p of MATRICE[r as Role] ?? []) s.add(p);
  return s;
}

export function peut(roles: readonly string[], p: Permission): boolean {
  return permissionsDe(roles).has(p);
}

export function matriceDroits() {
  return LISTE_ROLES.map((r) => ({ role: r, libelle: ROLES[r], permissions: MATRICE[r] }));
}
