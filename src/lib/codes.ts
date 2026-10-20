/**
 * Codes des titres : le code ISIN officiel, le code interne et l'identifiant de position sont séparés.
 * Le classeur d'origine contient des codes avec suffixes ou ponctuation : on les normalise ici.
 */

/** Normalise un code : majuscules, sans espaces ni ponctuation parasite. */
export function normaliserCode(v: string): string {
  return v.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9_\-./]/g, "");
}

/** Contrôle de l'ISIN : format (2 lettres pays + 9 caractères + clé) et clé de Luhn. */
export function isinValide(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const chiffres = isin
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let n = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somme += n;
  }
  return somme % 10 === 0;
}

/** Code ISIN corrigé (même début, clé de contrôle recalculée), ou null si le format est faux. */
export function isinCorrige(isin: string): string | null {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return null;
  for (let d = 0; d < 10; d++) if (isinValide(isin.slice(0, 11) + d)) return isin.slice(0, 11) + d;
  return null;
}

/**
 * Sépare un code du classeur en ISIN + suffixe éventuel (ex. « CI0000001234-B » ou « CI0000001234 (SGI) »).
 * Renvoie l'ISIN s'il est reconnu, le code interne nettoyé et le suffixe (identifiant de position).
 */
export function decouperCode(brut: string): { isin: string | null; codeInterne: string; suffixe: string } {
  const propre = brut.toUpperCase().trim();
  const m = propre.match(/([A-Z]{2}[A-Z0-9]{9}[0-9])/);
  if (m && isinValide(m[1])) {
    const suffixe = propre.replace(m[1], "").replace(/^[\s\-_./()]+|[\s\-_./()]+$/g, "");
    return { isin: m[1], codeInterne: m[1], suffixe };
  }
  // Suffixe de position reconnu : 1 à 3 lettres (« -A », « -SGI ») ou texte entre parenthèses.
  // Un nombre (« -2026 ») fait partie du code (souvent l'année d'échéance) : il n'est jamais retiré.
  const m2 = propre.match(/^(.*?)(?:\s*\(([^)]*)\)|[\s\-_/.]+([A-Z]{1,3}))$/);
  if (m2 && m2[1]) return { isin: null, codeInterne: normaliserCode(m2[1]), suffixe: normaliserCode(m2[2] ?? m2[3] ?? "") };
  return { isin: null, codeInterne: normaliserCode(propre), suffixe: "" };
}
