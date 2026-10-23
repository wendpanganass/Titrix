/**
 * Règles de reprise des données (REF-03 à REF-07, §11) — fonctions pures, testées.
 *  - correspondance configurable des colonnes (devinée à partir des en-têtes, modifiable) ;
 *  - normalisation des valeurs (dates françaises ou Excel, pourcentages, fréquences, profils) ;
 *  - séparation du code ISIN officiel, du code interne et de l'identifiant de position ;
 *  - clé d'import stable : un import répété ne crée jamais deux fois la même opération ;
 *  - détection des divergences de caractéristiques : jamais de fusion automatique.
 */
import { createHash } from "node:crypto";
import { decouperCode } from "./codes";
import type { Brut } from "./lecture-fichier";

export type NatureImport = "base_titres" | "encaissements";

export interface ChampCible {
  cle: string;
  libelle: string;
  obligatoire?: boolean;
  synonymes: string[];
}

export const CHAMPS: Record<NatureImport, ChampCible[]> = {
  base_titres: [
    { cle: "code", libelle: "Code titre", obligatoire: true, synonymes: ["code", "code titre", "code isin", "isin", "titre", "code valeur", "reference titre"] },
    { cle: "isin", libelle: "Code ISIN (si colonne distincte)", synonymes: ["isin"] },
    { cle: "libelle", libelle: "Libellé", synonymes: ["libelle", "designation", "intitule", "nom du titre", "titre"] },
    { cle: "emetteur", libelle: "Émetteur", synonymes: ["emetteur", "emetteurs", "issuer"] },
    { cle: "pays", libelle: "Pays", synonymes: ["pays", "country"] },
    { cle: "zone", libelle: "Zone", synonymes: ["zone", "region"] },
    { cle: "type", libelle: "Type d'instrument", synonymes: ["type", "type de titre", "nature", "categorie", "instrument"] },
    { cle: "devise", libelle: "Devise", synonymes: ["devise", "monnaie", "currency"] },
    { cle: "nominal_unitaire", libelle: "Nominal unitaire", synonymes: ["nominal unitaire", "valeur nominale", "vn", "nominal par titre"] },
    { cle: "date_emission", libelle: "Date d'émission / jouissance", synonymes: ["date emission", "date d emission", "emission", "date jouissance", "jouissance"] },
    { cle: "date_echeance", libelle: "Date d'échéance", synonymes: ["date echeance", "echeance", "date d echeance", "maturite", "date maturite", "date de remboursement"] },
    { cle: "taux", libelle: "Taux de coupon", synonymes: ["taux", "taux coupon", "coupon", "taux facial", "taux d interet", "taux nominal"] },
    { cle: "frequence", libelle: "Fréquence / périodicité", synonymes: ["frequence", "periodicite", "periodicite coupon", "paiement"] },
    { cle: "profil", libelle: "Mode de remboursement", synonymes: ["profil", "mode de remboursement", "remboursement", "amortissement", "type amortissement"] },
    { cle: "differe", libelle: "Différé (années)", synonymes: ["differe", "differe annees", "differe d amortissement", "nombre d annees de differe"] },
    { cle: "convention", libelle: "Convention de calcul", synonymes: ["convention", "base", "base de calcul", "base jours"] },
    { cle: "conservateur", libelle: "Conservateur", obligatoire: true, synonymes: ["conservateur", "depositaire", "teneur de compte", "sgi", "custodian"] },
    { cle: "compte", libelle: "Compte de conservation", synonymes: ["compte", "compte titre", "compte de conservation", "numero de compte"] },
    { cle: "portefeuille", libelle: "Portefeuille", synonymes: ["portefeuille", "book"] },
    { cle: "quantite", libelle: "Quantité", synonymes: ["quantite", "nombre de titres", "nb titres", "qte"] },
    { cle: "nominal", libelle: "Encours nominal détenu", obligatoire: true, synonymes: ["encours", "encours nominal", "nominal", "montant nominal", "capital restant du", "crd", "encours actuel", "nominal residuel"] },
    { cle: "classification", libelle: "Classification comptable", synonymes: ["classification", "categorie comptable", "portefeuille comptable", "classement"] },
    { cle: "beneficiaire", libelle: "Bénéficiaire du grevage", synonymes: ["beneficiaire", "grevage beneficiaire", "garantie au profit de", "institution"] },
    { cle: "nominal_greve", libelle: "Nominal grevé", synonymes: ["montant greve", "nominal greve", "greve", "montant utilise", "utilise"] },
  ],
  encaissements: [
    { cle: "code", libelle: "Code titre", obligatoire: true, synonymes: ["code", "code titre", "isin", "titre"] },
    { cle: "conservateur", libelle: "Conservateur", obligatoire: true, synonymes: ["conservateur", "depositaire", "sgi"] },
    { cle: "compte", libelle: "Compte de conservation", synonymes: ["compte", "compte titre"] },
    { cle: "date_valeur", libelle: "Date de valeur", obligatoire: true, synonymes: ["date valeur", "date de valeur", "date", "date encaissement"] },
    // Capital et intérêts avant le montant total : « Montant capital » ne doit pas être pris pour le total.
    { cle: "capital", libelle: "Dont capital", synonymes: ["capital", "capital recu", "montant capital", "principal", "remboursement", "amortissement", "remboursement capital"] },
    { cle: "interet", libelle: "Dont intérêts (nets)", synonymes: ["interets", "interet", "interets recus", "montant interets", "coupon", "coupons", "coupon recu", "interets nets"] },
    { cle: "montant", libelle: "Montant total reçu", synonymes: ["montant", "montant recu", "montant encaisse", "montant total", "total", "credit"] },
    { cle: "reference", libelle: "Référence", synonymes: ["reference", "ref", "libelle operation"] },
  ],
};

/** Normalise un en-tête : minuscules, sans accents ni ponctuation. */
export function normaliserEntete(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Correspondance proposée : pour chaque champ, la colonne dont l'en-tête correspond le mieux. */
export function devinerCorrespondance(nature: NatureImport, entetes: string[]): Record<string, number | null> {
  const normes = entetes.map(normaliserEntete);
  const prises = new Set<number>();
  const res: Record<string, number | null> = {};
  for (const champ of CHAMPS[nature]) {
    let trouve: number | null = null;
    for (const syn of champ.synonymes) {
      const i = normes.findIndex((n, k) => !prises.has(k) && n === syn);
      if (i >= 0) {
        trouve = i;
        break;
      }
    }
    if (trouve === null)
      for (const syn of champ.synonymes) {
        const i = normes.findIndex((n, k) => !prises.has(k) && syn.length > 3 && n.includes(syn));
        if (i >= 0) {
          trouve = i;
          break;
        }
      }
    if (trouve !== null) prises.add(trouve);
    res[champ.cle] = trouve;
  }
  return res;
}

const ERREUR_FORMULE = /^#(NUM!|DIV\/0!|VALUE!|REF!|N\/A|NAME\?|NULL!)/;

export function estErreurFormule(v: Brut): boolean {
  return typeof v === "string" && ERREUR_FORMULE.test(v.trim());
}

/** Date : ISO, JJ/MM/AAAA, ou numéro de série Excel. */
export function lireDateBrute(v: Brut): string | null {
  if (v === null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const a = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

export function lireNombreBrut(v: Brut): number | null {
  if (v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[\s  ]/g, "").replace(/%$/, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Taux : « 6,5 % », « 6.5 », « 0,065 » → 0,065. */
export function lireTaux(v: Brut): number | null {
  const n = lireNombreBrut(v);
  if (n === null) return null;
  const pourcent = typeof v === "string" && v.includes("%");
  return pourcent || n > 1 ? n / 100 : n;
}

export function lireFrequence(v: Brut): number | null {
  if (v === null || v === "") return null;
  const s = normaliserEntete(String(v));
  if (/semest/.test(s) || s === "2") return 2;
  if (/annu/.test(s) || s === "1") return 1;
  if (/trimest/.test(s) || s === "4") return 4;
  if (/mensu/.test(s) || s === "12") return 12;
  if (/echeance|in fine|unique|0/.test(s)) return 0;
  return null;
}

export function lireProfil(v: Brut): "in_fine" | "constant" | null {
  if (v === null || v === "") return null;
  const s = normaliserEntete(String(v));
  if (/fine|bullet/.test(s)) return "in_fine";
  if (/constant|amorti|lineaire|differe/.test(s)) return "constant";
  return null;
}

export function lireConvention(v: Brut): "ACT/365" | "ACT/360" | "30/360" | "ACT/ACT" | null {
  if (v === null || v === "") return null;
  const s = String(v).toUpperCase().replace(/\s/g, "");
  if (s.includes("30/360") || s === "30E/360") return "30/360";
  if (s.includes("360")) return "ACT/360";
  if (s.includes("ACT/ACT") || s.includes("EXACT/EXACT")) return "ACT/ACT";
  if (s.includes("365")) return "ACT/365";
  return null;
}

/** Clé d'import stable : mêmes données sources ⇒ même clé ⇒ aucune opération créée deux fois. */
export function cleImport(nature: string, parties: (string | number | null | undefined)[]): string {
  return createHash("sha256")
    .update([nature, ...parties.map((p) => String(p ?? "").trim().toUpperCase())].join("|"))
    .digest("hex")
    .slice(0, 32);
}

export interface LigneTitre {
  numero: number;
  brut: Record<string, Brut>;
  isin: string | null;
  codeInterne: string;
  suffixe: string;
  libelle: string;
  emetteur: string;
  pays: string;
  zone: string;
  type: string;
  devise: string;
  nominalUnitaire: number | null;
  dateEmission: string | null;
  dateEcheance: string | null;
  taux: number | null;
  frequence: number | null;
  profil: "in_fine" | "constant" | null;
  differeMois: number;
  convention: string | null;
  conservateur: string;
  compte: string;
  portefeuille: string;
  quantite: number | null;
  nominal: number | null;
  classification: string;
  beneficiaire: string;
  nominalGreve: number | null;
  erreurs: string[];
}

/** Interprète une ligne du classeur « base titres » ; les problèmes sont listés, rien n'est corrigé. */
export function interpreterLigneTitre(
  numero: number,
  ligne: Brut[],
  corr: Record<string, number | null>,
  defauts: { devise: string; portefeuille: string },
): LigneTitre {
  const v = (cle: string): Brut => {
    const i = corr[cle];
    return i === null || i === undefined ? null : (ligne[i] ?? null);
  };
  const texte = (cle: string) => (v(cle) === null ? "" : String(v(cle)).trim());
  const erreurs: string[] = [];
  const brut: Record<string, Brut> = {};
  for (const k of Object.keys(corr)) if (corr[k] !== null) brut[k] = v(k);
  for (const [k, x] of Object.entries(brut)) if (estErreurFormule(x)) erreurs.push(`Erreur de formule « ${x} » dans la colonne ${k}`);

  const codeBrut = texte("code");
  const d = decouperCode(codeBrut);
  const isinColonne = texte("isin").toUpperCase();
  const isin = d.isin || (isinColonne ? decouperCode(isinColonne).isin : null) || null;
  if (!codeBrut) erreurs.push("Code titre manquant");
  const nominal = lireNombreBrut(v("nominal"));
  if (nominal === null && !estErreurFormule(v("nominal"))) erreurs.push("Encours nominal illisible ou manquant");
  if (nominal !== null && nominal < 0) erreurs.push("Encours nominal négatif");
  const greve = lireNombreBrut(v("nominal_greve"));
  if (greve !== null && nominal !== null && greve > nominal + 0.005)
    erreurs.push(`Montant grevé (${greve}) supérieur à l'encours (${nominal}) : disponible négatif`);
  const conservateur = texte("conservateur");
  if (!conservateur) erreurs.push("Conservateur manquant");
  const differeAnnees = lireNombreBrut(v("differe")) ?? 0;
  const dateEch = lireDateBrute(v("date_echeance"));
  if (v("date_echeance") !== null && !dateEch && !estErreurFormule(v("date_echeance"))) erreurs.push("Date d'échéance illisible");

  const dateEm = lireDateBrute(v("date_emission"));
  if (dateEm && dateEch && dateEm >= dateEch) erreurs.push("Date d'émission postérieure ou égale à l'échéance");
  const taux = lireTaux(v("taux"));
  if (taux !== null && (taux < 0 || taux >= 1)) erreurs.push(`Taux de coupon invraisemblable (${String(v("taux"))})`);
  const nu = lireNombreBrut(v("nominal_unitaire"));

  return {
    numero,
    brut,
    isin,
    codeInterne: isin ?? d.codeInterne,
    suffixe: d.suffixe,
    libelle: texte("libelle") || codeBrut,
    emetteur: texte("emetteur"),
    pays: texte("pays"),
    zone: texte("zone"),
    type: texte("type"),
    devise: (texte("devise") || defauts.devise).toUpperCase().slice(0, 3),
    nominalUnitaire: nu !== null && nu > 0 ? nu : null,
    dateEmission: dateEm,
    dateEcheance: dateEch,
    taux,
    frequence: lireFrequence(v("frequence")),
    profil: lireProfil(v("profil")) ?? (differeAnnees > 0 ? "constant" : null),
    differeMois: Math.round(differeAnnees * 12),
    convention: lireConvention(v("convention")),
    conservateur,
    compte: texte("compte"),
    portefeuille: texte("portefeuille") || defauts.portefeuille,
    quantite: lireNombreBrut(v("quantite")),
    nominal,
    classification: texte("classification"),
    beneficiaire: texte("beneficiaire"),
    nominalGreve: greve,
    erreurs,
  };
}

export interface CaracteristiquesComparees {
  dateEcheance: string | null;
  taux: number | null;
  frequence: number | null;
  profil: string | null;
  nominalUnitaire: number | null;
  dateEmission: string | null;
}

/** Divergences entre deux jeux de caractéristiques du même instrument (valeurs renseignées seulement). */
export function divergences(a: CaracteristiquesComparees, b: CaracteristiquesComparees): string[] {
  const sortie: string[] = [];
  const cmp = (nom: string, x: unknown, y: unknown, egal: (p: never, q: never) => boolean = (p, q) => p === q) => {
    if (x === null || x === undefined || y === null || y === undefined) return;
    if (!egal(x as never, y as never)) sortie.push(`${nom} : ${String(x)} ≠ ${String(y)}`);
  };
  cmp("échéance", a.dateEcheance, b.dateEcheance);
  cmp("date d'émission", a.dateEmission, b.dateEmission);
  cmp("taux", a.taux, b.taux, (p: number, q: number) => Math.abs(p - q) < 1e-7);
  cmp("fréquence", a.frequence, b.frequence);
  cmp("profil", a.profil, b.profil);
  cmp("nominal unitaire", a.nominalUnitaire, b.nominalUnitaire, (p: number, q: number) => Math.abs(p - q) < 1e-6);
  return sortie;
}
