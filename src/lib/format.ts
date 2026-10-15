/**
 * Mise en forme française des nombres, montants, pourcentages et dates.
 * La précision de calcul (moteur) et l'arrondi d'affichage sont distincts : on n'arrondit qu'ici.
 */
const nf = (dec: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const cacheNf = new Map<number, Intl.NumberFormat>();
function formateur(dec: number) {
  let f = cacheNf.get(dec);
  if (!f) cacheNf.set(dec, (f = nf(dec)));
  return f;
}

/** Montant avec séparateur de milliers ; « – » pour zéro, « n.a. » si non applicable. */
export function montant(x: number | null | undefined, decimales = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n.a.";
  if (Math.abs(x) < 0.005) return "–";
  return formateur(decimales).format(x).replace(/ /g, " ");
}

/** Montant compact pour les indicateurs (12,5 Md, 340 M…). */
export function compact(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n.a.";
  const a = Math.abs(x);
  if (a >= 1e9) return `${formateur(2).format(x / 1e9)} Md`;
  if (a >= 1e6) return `${formateur(1).format(x / 1e6)} M`;
  if (a >= 1e4) return `${formateur(0).format(x / 1e3)} k`;
  return formateur(0).format(x);
}

export function pourcent(x: number | null | undefined, decimales = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n.a.";
  return `${formateur(decimales).format(x * 100)} %`;
}

export function nombre(x: number | null | undefined, decimales = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "n.a.";
  return formateur(decimales).format(x);
}

/** « 2026-03-15 » → « 15/03/2026 ». */
export function dateFr(d: string | null | undefined): string {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [a, m, j] = s.split("-");
  return j ? `${j}/${m}/${a}` : s;
}

export function dateHeureFr(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Africa/Abidjan" });
}

/** Date du jour au format ISO (fuseau GMT, celui de la zone UEMOA). */
export function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function moisFr(m: string): string {
  const [a, mm] = m.split("-");
  return `${MOIS[Number(mm) - 1]} ${a}`;
}

/** Lit un nombre saisi à la française (« 1 250 000,50 ») ; null si vide ou invalide. */
export function lireNombre(v: FormDataEntryValue | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\s  ]/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function lireTexte(v: FormDataEntryValue | null | undefined): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

export function lireDate(v: FormDataEntryValue | null | undefined): string | null {
  const s = lireTexte(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
