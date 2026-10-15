/**
 * Pastilles de statut (toujours un mot, jamais la couleur seule).
 */
import { Badge, type Ton } from "./ui";
import { LIBELLES_STATUT_ECHEANCE, type StatutEcheance } from "@/moteur";

const OPERATION: Record<string, [string, Ton]> = {
  brouillon: ["Brouillon", "gris"],
  soumis: ["Soumis", "alerte"],
  valide: ["Validé", "info"],
  rejete: ["Rejeté", "erreur"],
  regle: ["Réglé", "bon"],
  annule: ["Annulé", "gris"],
};
const GREVAGE: Record<string, [string, Ton]> = {
  brouillon: ["Brouillon", "gris"],
  soumis: ["Soumis", "alerte"],
  actif: ["Actif", "info"],
  rejete: ["Rejeté", "erreur"],
  leve: ["Levé", "bon"],
};
const INSTRUMENT: Record<string, [string, Ton]> = {
  a_valider: ["À valider", "alerte"],
  valide: ["Validé", "bon"],
  rejete: ["Rejeté", "erreur"],
};
const ARRETE: Record<string, [string, Ton]> = {
  ouvert: ["Ouvert", "alerte"],
  verrouille: ["Verrouillé", "bon"],
  rouvert: ["Rouvert", "erreur"],
};
const ECHEANCE: Record<StatutEcheance, Ton> = {
  prevue: "gris",
  a_encaisser: "alerte",
  partielle: "alerte",
  encaissee: "bon",
  en_retard: "erreur",
  litige: "erreur",
  annulee: "gris",
  remplacee: "gris",
};

function pastille(table: Record<string, [string, Ton]>, s: string) {
  const [l, t] = table[s] ?? [s, "gris"];
  return <Badge ton={t}>{l}</Badge>;
}
export const StatutOperation = ({ s }: { s: string }) => pastille(OPERATION, s);
export const StatutGrevage = ({ s }: { s: string }) => pastille(GREVAGE, s);
export const StatutInstrument = ({ s }: { s: string }) => pastille(INSTRUMENT, s);
export const StatutArrete = ({ s }: { s: string }) => pastille(ARRETE, s);
export const StatutEcheanceBadge = ({ s }: { s: StatutEcheance }) => <Badge ton={ECHEANCE[s]}>{LIBELLES_STATUT_ECHEANCE[s]}</Badge>;
export const LIBELLES_STATUT_OPERATION = Object.fromEntries(Object.entries(OPERATION).map(([k, v]) => [k, v[0]]));
export const LIBELLES_STATUT_GREVAGE = Object.fromEntries(Object.entries(GREVAGE).map(([k, v]) => [k, v[0]]));
