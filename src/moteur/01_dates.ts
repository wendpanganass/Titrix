/**
 * Moteur financier — 01. Dates et conventions de décompte des jours.
 *
 * Toutes les dates du moteur sont des chaînes ISO « AAAA-MM-JJ » (sans heure ni fuseau) :
 * on évite ainsi les décalages d'un jour liés aux fuseaux horaires.
 * Le moteur ne connaît ni la base ni l'interface : il reçoit des données et rend un résultat.
 */

export type DateIso = string;

/** Conventions de décompte des jours prises en charge (choisies instrument par instrument). */
export const CONVENTIONS = ["ACT/365", "ACT/360", "30/360", "ACT/ACT"] as const;
export type Convention = (typeof CONVENTIONS)[number];

export const LIBELLES_CONVENTION: Record<Convention, string> = {
  "ACT/365": "Exact/365 (jours réels / 365, année bissextile comprise)",
  "ACT/360": "Exact/360 (jours réels / 360)",
  "30/360": "30/360 européen (mois de 30 jours, année de 360 jours)",
  "ACT/ACT": "Exact/Exact ICMA (jours réels / jours réels de la période × fréquence)",
};

const MS_JOUR = 86_400_000;

/** Convertit une date ISO en numéro de jour (jours depuis le 1er janvier 1970). */
export function versJour(d: DateIso): number {
  const [a, m, j] = d.split("-").map(Number);
  return Math.round(Date.UTC(a, m - 1, j) / MS_JOUR);
}

/** Convertit un numéro de jour en date ISO. */
export function depuisJour(n: number): DateIso {
  return new Date(n * MS_JOUR).toISOString().slice(0, 10);
}

/** Vérifie qu'une chaîne est une date ISO valide (ex. 2026-02-30 est refusée). */
export function estDateIso(d: unknown): d is DateIso {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return depuisJour(versJour(d)) === d;
}

/** Nombre de jours réels entre deux dates (fin exclue, début inclus). */
export function joursEntre(debut: DateIso, fin: DateIso): number {
  return versJour(fin) - versJour(debut);
}

export function ajouterJours(d: DateIso, n: number): DateIso {
  return depuisJour(versJour(d) + n);
}

export function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0;
}

function joursDansMois(annee: number, mois1a12: number): number {
  return new Date(Date.UTC(annee, mois1a12, 0)).getUTCDate();
}

function estFinDeMois(d: DateIso): boolean {
  const [a, m, j] = d.split("-").map(Number);
  return j === joursDansMois(a, m);
}

/**
 * Ajoute (ou retire) des mois. Le jour est ramené au dernier jour du mois si besoin
 * (31 janvier + 1 mois = 28 ou 29 février). Si la date d'origine est une fin de mois,
 * le résultat l'est aussi (règle « fin de mois »).
 */
export function ajouterMois(d: DateIso, mois: number): DateIso {
  const [a, m, j] = d.split("-").map(Number);
  const total = a * 12 + (m - 1) + mois;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const max = joursDansMois(na, nm);
  const nj = estFinDeMois(d) ? max : Math.min(j, max);
  return `${na}-${String(nm).padStart(2, "0")}-${String(nj).padStart(2, "0")}`;
}

/**
 * Fraction d'année α entre deux dates selon la convention.
 * Pour ACT/ACT (ICMA), il faut la période de coupon qui contient l'intervalle et la fréquence :
 * α = jours(debut, fin) / (jours de la période × fréquence).
 */
export function fractionAnnee(
  convention: Convention,
  debut: DateIso,
  fin: DateIso,
  periode?: { debut: DateIso; fin: DateIso; frequence: number },
): number {
  if (versJour(fin) <= versJour(debut)) return 0;
  switch (convention) {
    case "ACT/365":
      return joursEntre(debut, fin) / 365;
    case "ACT/360":
      return joursEntre(debut, fin) / 360;
    case "30/360": {
      // 30/360 européen (30E/360) : le 31 devient le 30.
      const [a1, m1, j1] = debut.split("-").map(Number);
      const [a2, m2, j2] = fin.split("-").map(Number);
      const d1 = Math.min(j1, 30);
      const d2 = Math.min(j2, 30);
      return (360 * (a2 - a1) + 30 * (m2 - m1) + (d2 - d1)) / 360;
    }
    case "ACT/ACT": {
      if (!periode || periode.frequence <= 0) {
        // Sans période de référence (coupon unique) : décompte exact année par année (ISDA).
        return fractionActActIsda(debut, fin);
      }
      const jp = joursEntre(periode.debut, periode.fin);
      if (jp <= 0) return 0;
      return joursEntre(debut, fin) / (jp * periode.frequence);
    }
  }
}

/** ACT/ACT ISDA : chaque jour compte 1/366 en année bissextile, 1/365 sinon. */
function fractionActActIsda(debut: DateIso, fin: DateIso): number {
  let total = 0;
  let courant = debut;
  while (versJour(courant) < versJour(fin)) {
    const annee = Number(courant.slice(0, 4));
    const finAnnee = `${annee + 1}-01-01`;
    const borne = versJour(finAnnee) < versJour(fin) ? finAnnee : fin;
    total += joursEntre(courant, borne) / (estBissextile(annee) ? 366 : 365);
    courant = borne;
  }
  return total;
}

/** Jour ouvré : ni samedi, ni dimanche, ni jour férié déclaré dans le référentiel. */
export function estJourOuvre(d: DateIso, feries: ReadonlySet<DateIso>): boolean {
  const jour = new Date(versJour(d) * MS_JOUR).getUTCDay();
  return jour !== 0 && jour !== 6 && !feries.has(d);
}

/** Date de règlement ajustée : jour ouvré suivant (convention « Following »). */
export function jourOuvreSuivant(d: DateIso, feries: ReadonlySet<DateIso>): DateIso {
  let n = d;
  for (let i = 0; i < 15 && !estJourOuvre(n, feries); i++) n = ajouterJours(n, 1);
  return n;
}

export function min(a: DateIso, b: DateIso): DateIso {
  return a <= b ? a : b;
}

export function max(a: DateIso, b: DateIso): DateIso {
  return a >= b ? a : b;
}
