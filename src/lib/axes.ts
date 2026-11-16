/**
 * Axes de ventilation et de filtre de l'encours (Analyses, tableau de bord).
 * Une même définition sert à ventiler (Analyses) et à filtrer (tableau de bord).
 */
import type { LignePosition } from "@/moteur";

export const AXES: Record<string, { libelle: string; cle: (l: LignePosition) => string }> = {
  pays: { libelle: "Pays", cle: (l) => l.instrument.pays },
  zone: { libelle: "Zone", cle: (l) => l.instrument.zone },
  emetteur: { libelle: "Émetteur", cle: (l) => l.instrument.emetteur },
  conservateur: { libelle: "Conservateur", cle: (l) => l.position.conservateur },
  instrument: { libelle: "Instrument", cle: (l) => `${l.instrument.code} — ${l.instrument.libelle}` },
  type: { libelle: "Type d'instrument", cle: (l) => l.instrument.type },
  portefeuille: { libelle: "Portefeuille", cle: (l) => l.position.portefeuille },
  classification: { libelle: "Classification comptable", cle: (l) => l.position.classification || l.instrument.classification },
  notation: { libelle: "Notation", cle: (l) => l.instrument.notation },
  grevage: { libelle: "Statut de grevage", cle: (l) => l.statutGrevage },
  maturite: { libelle: "Tranche de maturité", cle: (l) => l.tranche },
};

/** Valeur de filtre désignant « non renseigné » (une valeur vide ne peut pas circuler dans l'adresse). */
export const VALEUR_VIDE = "_vide";

/** Ordre d'affichage des tranches de maturité (les autres valeurs suivent, par ordre alphabétique). */
export const ORDRE_TRANCHES = ["Échu", "Moins d'un mois", "1 à 3 mois", "3 à 6 mois", "6 à 12 mois", "1 à 2 ans", "Plus de 2 ans", "Soldé"];
