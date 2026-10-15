/**
 * Moteur financier — 04. Statut des échéances et rapprochement des encaissements.
 *
 * Le statut est DÉDUIT des montants reçus et des dates, sauf décision manuelle tracée
 * (litige, annulation, remplacement). Un écart reste visible tant qu'il n'est pas expliqué.
 */
import { ajouterJours, type DateIso } from "./01_dates";
import { arrondi2 } from "./03_position";

export const STATUTS_ECHEANCE = [
  "prevue",
  "a_encaisser",
  "partielle",
  "encaissee",
  "en_retard",
  "litige",
  "annulee",
  "remplacee",
] as const;
export type StatutEcheance = (typeof STATUTS_ECHEANCE)[number];

export const LIBELLES_STATUT_ECHEANCE: Record<StatutEcheance, string> = {
  prevue: "Prévue",
  a_encaisser: "À encaisser",
  partielle: "Partiellement encaissée",
  encaissee: "Encaissée",
  en_retard: "En retard",
  litige: "En litige",
  annulee: "Annulée",
  remplacee: "Remplacée",
};

/** Tolérance d'écart (en unité de devise) en deçà de laquelle une échéance est considérée soldée. */
export const TOLERANCE_MONTANT = 0.01;

export interface EcheanceStatutEntree {
  dateReglementPrevue: DateIso;
  netAttendu: number;
  statutManuel: "litige" | "annulee" | "remplacee" | null;
  montantRecu: number;
}

/**
 * Statut d'une échéance au jour J.
 *  - prévue : date de règlement future ;
 *  - à encaisser : date atteinte, délai de tolérance non dépassé ;
 *  - en retard : délai de tolérance dépassé sans encaissement complet (et rien reçu) ;
 *  - partiellement encaissée : une partie reçue, solde restant dû conservé ;
 *  - encaissée : montant reçu ≥ attendu (à la tolérance près).
 */
export function statutEcheance(e: EcheanceStatutEntree, aujourdhui: DateIso, toleranceJours: number): StatutEcheance {
  if (e.statutManuel) return e.statutManuel;
  if (e.netAttendu <= TOLERANCE_MONTANT && e.montantRecu <= 0) return e.dateReglementPrevue <= aujourdhui ? "encaissee" : "prevue";
  if (e.montantRecu >= e.netAttendu - TOLERANCE_MONTANT) return "encaissee";
  if (e.montantRecu > 0) return "partielle";
  if (e.dateReglementPrevue > aujourdhui) return "prevue";
  if (ajouterJours(e.dateReglementPrevue, toleranceJours) >= aujourdhui) return "a_encaisser";
  return "en_retard";
}

/** Solde restant dû (positif) ou trop-perçu (négatif). */
export function resteDu(e: { netAttendu: number; montantRecu: number }): number {
  return arrondi2(e.netAttendu - e.montantRecu);
}

/** Un statut qui laisse un montant à recouvrer après la date prévue. */
export function estImpaye(s: StatutEcheance): boolean {
  return s === "en_retard" || s === "partielle" || s === "litige" || s === "a_encaisser";
}
