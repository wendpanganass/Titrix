/**
 * Photographie d'un arrêté : situation complète figée, conservée telle quelle en base (jsonb).
 */
import "server-only";
import type { Analyse } from "./portefeuille";
import { totauxParDevise, VERSION_MOTEUR } from "@/moteur";

export interface LigneArrete {
  positionId: string;
  code: string;
  isin: string | null;
  libelle: string;
  emetteur: string;
  pays: string;
  portefeuille: string;
  conservateur: string;
  compte: string;
  devise: string;
  classification: string;
  dateEcheance: string | null;
  tauxCoupon: number;
  nominal: number;
  capitalContractuel: number;
  echu: number;
  couru: number;
  greve: number;
  disponible: number;
  tranche: string;
  capitalFutur: number;
  interetsFuturs: number;
}

export interface Photographie {
  date: string;
  versionMoteur: string;
  calculeLe: string;
  parametres: { tolerance: number; seuils: number[]; deviseReference: string };
  totaux: ReturnType<typeof totauxParDevise>;
  lignes: LigneArrete[];
  controles: { bloquant: number; erreur: number; alerte: number };
}

export function photographie(a: Analyse): Photographie {
  const lignes = a.situation.lignes.filter((l) => l.nominal !== 0 || l.couponCouru !== 0);
  return {
    date: a.date,
    versionMoteur: VERSION_MOTEUR,
    calculeLe: new Date().toISOString(),
    parametres: { tolerance: a.parametres.toleranceEncaissement, seuils: a.parametres.seuilsAlerte, deviseReference: a.parametres.deviseReference },
    totaux: totauxParDevise(lignes),
    lignes: lignes.map((l) => ({
      positionId: l.position.id,
      code: l.instrument.code,
      isin: l.instrument.isin,
      libelle: l.instrument.libelle,
      emetteur: l.instrument.emetteur,
      pays: l.instrument.pays,
      portefeuille: l.position.portefeuille,
      conservateur: l.position.conservateur,
      compte: l.position.compte,
      devise: l.instrument.devise,
      classification: l.position.classification || l.instrument.classification,
      dateEcheance: l.instrument.dateEcheance,
      tauxCoupon: l.instrument.tauxCoupon,
      nominal: l.nominal,
      capitalContractuel: l.capitalContractuel,
      echu: l.capitalEchuNonRembourse,
      couru: l.couponCouru,
      greve: l.nominalGreve,
      disponible: l.nominalDisponible,
      tranche: l.tranche,
      capitalFutur: l.projection.reduce((t, e) => t + e.capitalDu, 0),
      interetsFuturs: l.projection.reduce((t, e) => t + e.interetBrut, 0),
    })),
    controles: {
      bloquant: a.controles.filter((c) => c.niveau === "bloquant").length,
      erreur: a.controles.filter((c) => c.niveau === "erreur").length,
      alerte: a.controles.filter((c) => c.niveau === "alerte").length,
    },
  };
}
