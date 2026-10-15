/**
 * Moteur financier — 02. Échéancier contractuel d'un instrument.
 *
 * L'échéancier contractuel est exprimé en PARTS du nominal d'origine (somme = 1).
 * Il ne dépend pas de ce que l'établissement détient : la projection des montants
 * se fait ensuite position par position (fichier 03), à partir de l'encours réellement détenu.
 *
 * Priorité : un échéancier officiel validé (importé) l'emporte toujours sur l'échéancier généré.
 */
import { ajouterMois, estDateIso, versJour, type Convention, type DateIso } from "./01_dates";

/** Version du moteur, gravée sur chaque échéance produite (traçabilité). */
export const VERSION_MOTEUR = "titrix-moteur-1.0";

export const PROFILS = ["in_fine", "constant"] as const;
export type Profil = (typeof PROFILS)[number];

export const LIBELLES_PROFIL: Record<Profil, string> = {
  in_fine: "In fine (capital remboursé à l'échéance)",
  constant: "Amortissement constant",
};

/** Fréquences de paiement acceptées (nombre de paiements par an ; 0 = paiement unique à l'échéance). */
export const FREQUENCES = [0, 1, 2, 4, 12] as const;
export const LIBELLES_FREQUENCE: Record<number, string> = {
  0: "À l'échéance",
  1: "Annuelle",
  2: "Semestrielle",
  4: "Trimestrielle",
  12: "Mensuelle",
};

/** Caractéristiques d'un instrument nécessaires au calcul. */
export interface InstrumentCalc {
  id: string;
  dateEmission: DateIso | null;
  dateEcheance: DateIso | null;
  /** Taux de coupon annuel en fraction (0,065 = 6,5 %). */
  tauxCoupon: number;
  convention: Convention;
  frequence: number;
  profil: Profil;
  /** Différé d'amortissement en mois depuis l'émission (aucun remboursement de capital pendant ce délai). */
  differeMois: number;
  /** Titre à intérêts précomptés (bon du Trésor) : aucun coupon futur n'est créé. */
  precompte: boolean;
  /** Taux de retenue à la source sur les intérêts (fraction). */
  tauxRetenue: number;
  nominalUnitaire: number;
}

/** Ligne d'échéancier officiel importé (part du nominal d'origine remboursée à la date). */
export interface LigneOfficielle {
  date: DateIso;
  partCapital: number;
}

export interface Periode {
  debut: DateIso;
  fin: DateIso;
  /** Part du nominal d'origine remboursée à la fin de la période. */
  partCapital: number;
}

export interface EcheancierContractuel {
  periodes: Periode[];
  source: "genere" | "officiel";
  /** Messages expliquant pourquoi un calcul est impossible (caractéristique manquante…). */
  erreurs: string[];
}

/** Contrôle des caractéristiques obligatoires avant tout calcul. */
export function caracteristiquesManquantes(i: InstrumentCalc): string[] {
  const manque: string[] = [];
  if (!i.dateEcheance || !estDateIso(i.dateEcheance)) manque.push("date d'échéance");
  if (!(i.nominalUnitaire > 0)) manque.push("nominal unitaire");
  if (!i.precompte && !(i.tauxCoupon >= 0)) manque.push("taux de coupon");
  if (!i.precompte && i.frequence > 0 && !i.dateEmission) manque.push("date d'émission");
  if (i.dateEmission && i.dateEcheance && i.dateEmission >= i.dateEcheance)
    manque.push("dates d'émission et d'échéance incohérentes");
  return manque;
}

/**
 * Dates de fin de période : on part de l'échéance et on remonte de 12/fréquence mois.
 * La première période (depuis l'émission) peut être courte ou longue : période irrégulière.
 * Une première période de moins de 7 jours est fusionnée avec la suivante (période longue).
 */
export function datesDePaiement(i: InstrumentCalc): DateIso[] {
  if (!i.dateEcheance) return [];
  if (i.precompte || i.frequence <= 0) return [i.dateEcheance];
  const pas = 12 / i.frequence;
  const dates: DateIso[] = [];
  const debut = i.dateEmission ?? ajouterMois(i.dateEcheance, -pas);
  for (let k = 0; k < 2400; k++) {
    const d = ajouterMois(i.dateEcheance, -k * pas);
    if (d <= debut) break;
    dates.unshift(d);
  }
  if (dates.length > 1 && versJour(dates[0]) - versJour(debut) < 7) dates.shift();
  return dates;
}

/** Construit l'échéancier contractuel (généré, ou officiel s'il est fourni et validé). */
export function echeancierContractuel(
  i: InstrumentCalc,
  officiel?: LigneOfficielle[] | null,
): EcheancierContractuel {
  const manque = caracteristiquesManquantes(i);
  if (manque.length) {
    return { periodes: [], source: "genere", erreurs: [`Caractéristiques manquantes : ${manque.join(", ")}`] };
  }

  // 1. Échéancier officiel validé : il fait foi (dates et parts de capital).
  if (officiel && officiel.length) {
    const lignes = [...officiel].sort((a, b) => a.date.localeCompare(b.date));
    const somme = lignes.reduce((s, l) => s + l.partCapital, 0);
    const erreurs: string[] = [];
    if (Math.abs(somme - 1) > 1e-6)
      erreurs.push(`Échéancier officiel : la somme des parts de capital vaut ${(somme * 100).toFixed(4)} % au lieu de 100 %.`);
    const debutPremiere = i.dateEmission ?? lignes[0].date;
    const periodes = lignes.map((l, k) => ({
      debut: k === 0 ? debutPremiere : lignes[k - 1].date,
      fin: l.date,
      partCapital: l.partCapital,
    }));
    return { periodes, source: "officiel", erreurs };
  }

  // 2. Échéancier généré à partir des caractéristiques.
  const dates = datesDePaiement(i);
  const debut = i.dateEmission ?? ajouterMois(dates[0], -(i.frequence > 0 ? 12 / i.frequence : 12));
  const finDiffere = i.dateEmission && i.differeMois > 0 ? ajouterMois(i.dateEmission, i.differeMois) : null;

  const parts = dates.map(() => 0);
  if (i.profil === "in_fine" || dates.length === 1) {
    parts[parts.length - 1] = 1;
  } else {
    // Amortissement constant : parts égales sur les périodes après le différé.
    const indices = dates.map((d, k) => k).filter((k) => !finDiffere || dates[k] > finDiffere);
    if (indices.length === 0) parts[parts.length - 1] = 1;
    else indices.forEach((k) => (parts[k] = 1 / indices.length));
  }

  return {
    periodes: dates.map((fin, k) => ({ debut: k === 0 ? debut : dates[k - 1], fin, partCapital: parts[k] })),
    source: "genere",
    erreurs: [],
  };
}
