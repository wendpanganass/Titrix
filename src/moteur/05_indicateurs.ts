/**
 * Moteur financier — 05. Indicateurs de portefeuille et tranches de maturité.
 *
 * Chaque indicateur a une fiche (formule, données d'entrée, unité, limites) : voir FICHES_INDICATEURS.
 * Un indicateur incalculable (encours nul…) renvoie null : l'écran affiche « non applicable »,
 * jamais une division par zéro.
 */
import type { DateIso } from "./01_dates";

export interface Tranche {
  libelle: string;
  /** Borne basse incluse, en jours restants. */
  min: number;
  /** Borne haute exclue, en jours restants (null = sans limite). */
  max: number | null;
}

/** Tranches reprises du classeur ; modifiables dans Référentiels → Tranches de maturité. */
export const TRANCHES_DEFAUT: Tranche[] = [
  { libelle: "Moins d'un mois", min: 1, max: 31 },
  { libelle: "1 à 3 mois", min: 31, max: 92 },
  { libelle: "3 à 6 mois", min: 92, max: 183 },
  { libelle: "6 à 12 mois", min: 183, max: 366 },
  { libelle: "1 à 2 ans", min: 366, max: 731 },
  { libelle: "Plus de 2 ans", min: 731, max: null },
];

export const LIBELLE_ECHU = "Échu";

/** Tranche de maturité d'un nombre de jours restants (≤ 0 = échu). */
export function trancheMaturite(joursRestants: number | null, tranches: Tranche[] = TRANCHES_DEFAUT): string {
  if (joursRestants === null) return "Sans échéance";
  if (joursRestants <= 0) return LIBELLE_ECHU;
  const t = tranches.find((x) => joursRestants >= x.min && (x.max === null || joursRestants < x.max));
  return t ? t.libelle : "Hors tranches";
}

/** Division protégée : null si le dénominateur est nul. */
export function ratio(num: number, den: number): number | null {
  return Math.abs(den) < 1e-9 ? null : num / den;
}

/** Moyenne pondérée (null si le total des poids est nul). */
export function moyennePonderee(lignes: { valeur: number; poids: number }[]): number | null {
  const p = lignes.reduce((s, l) => s + l.poids, 0);
  return ratio(
    lignes.reduce((s, l) => s + l.valeur * l.poids, 0),
    p,
  );
}

/** Regroupe et additionne des lignes selon une clé. */
export function ventiler<T>(
  lignes: T[],
  cle: (l: T) => string,
  mesures: (l: T) => Record<string, number>,
): { cle: string; nombre: number; mesures: Record<string, number> }[] {
  const m = new Map<string, { cle: string; nombre: number; mesures: Record<string, number> }>();
  for (const l of lignes) {
    const k = cle(l) || "Non renseigné";
    const v = mesures(l);
    const g = m.get(k) ?? { cle: k, nombre: 0, mesures: {} };
    g.nombre++;
    for (const [n, x] of Object.entries(v)) g.mesures[n] = (g.mesures[n] ?? 0) + x;
    m.set(k, g);
  }
  return [...m.values()];
}

/** Mois « AAAA-MM » et année d'une date, pour les synthèses de tombées. */
export function moisDe(d: DateIso): string {
  return d.slice(0, 7);
}
export function anneeDe(d: DateIso): string {
  return d.slice(0, 4);
}

export interface FicheIndicateur {
  nom: string;
  formule: string;
  entrees: string;
  unite: string;
  limites: string;
}

/** Fiches des indicateurs affichés (exigence 7.5 du cahier des charges). */
export const FICHES_INDICATEURS: FicheIndicateur[] = [
  {
    nom: "Encours nominal",
    formule: "Σ nominal détenu des positions (opérations validées ou réglées dont la date d'effet ≤ date d'arrêté)",
    entrees: "Opérations validées",
    unite: "Devise de l'instrument",
    limites: "Un titre échu reste dans l'encours tant que son remboursement n'est pas constaté par une opération.",
  },
  {
    nom: "Capital échu non remboursé",
    formule: "Nominal détenu − capital contractuel restant dû",
    entrees: "Opérations, échéancier contractuel",
    unite: "Devise",
    limites: "Créance à recouvrer : disparaît lorsque l'amortissement ou le remboursement est constaté.",
  },
  {
    nom: "Coupon couru",
    formule: "CRD × taux de coupon × α(dernière date de coupon, date d'arrêté) selon la convention de l'instrument",
    entrees: "Taux, convention, fréquence, échéancier, opérations",
    unite: "Devise",
    limites: "Nul pour les titres précomptés (rémunération incluse dans le prix d'acquisition).",
  },
  {
    nom: "Nominal disponible",
    formule: "Nominal résiduel détenu − nominal grevé actif",
    entrees: "Positions, grevages actifs",
    unite: "Devise",
    limites: "Le financement obtenu n'est jamais soustrait du nominal : ce n'est pas la même mesure.",
  },
  {
    nom: "Coupon moyen pondéré",
    formule: "Σ (nominal × taux de coupon) / Σ nominal, titres à coupon uniquement",
    entrees: "Positions, taux de coupon",
    unite: "%",
    limites:
      "Hypothèse de détention au pair. Ce n'est PAS un rendement de marché : il ignore le prix d'acquisition et les prix de marché.",
  },
  {
    nom: "Durée de vie résiduelle moyenne",
    formule: "Σ (nominal × jours restants) / Σ nominal / 365",
    entrees: "Positions, date d'échéance",
    unite: "Années",
    limites: "Calculée sur la date d'échéance finale ; ne tient pas compte de l'amortissement (ce n'est pas une duration).",
  },
  {
    nom: "Rendement actuariel, duration, sensibilité",
    formule: "Taux actuariel égalisant prix payé et flux futurs ; duration de Macaulay ; sensibilité = duration / (1 + r)",
    entrees: "Prix d'acquisition ou de marché, flux futurs",
    unite: "%, années",
    limites: "Extension prévue : non affiché tant que les prix de marché ne sont pas intégrés (cahier des charges §3.2).",
  },
];
