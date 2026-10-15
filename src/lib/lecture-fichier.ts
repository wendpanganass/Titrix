/**
 * Lecture des fichiers importés (Excel .xlsx ou CSV) en lignes brutes.
 * Les valeurs sont conservées telles que lues ; les erreurs de formule (#NUM!, #DIV/0!…)
 * restent visibles sous forme de texte et seront signalées dans le registre de reprise.
 */
import "server-only";
import ExcelJS from "exceljs";

export type Brut = string | number | boolean | null;
export interface FichierLu {
  feuille: string;
  entetes: string[];
  lignes: Brut[][];
  feuilles: string[];
}

function valeurCellule(v: ExcelJS.CellValue): Brut {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("error" in v) return String((v as ExcelJS.CellErrorValue).error);
    if ("result" in v) {
      const r = (v as ExcelJS.CellFormulaValue).result;
      if (r instanceof Date) return r.toISOString().slice(0, 10);
      if (r && typeof r === "object" && "error" in r) return String((r as ExcelJS.CellErrorValue).error);
      return (r as Brut) ?? null;
    }
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    return null;
  }
  return v as Brut;
}

/** Ligne d'en-tête : la première ligne (parmi les 15 premières) qui contient au moins 3 textes. */
function trouverEntete(lignes: Brut[][]): number {
  for (let i = 0; i < Math.min(15, lignes.length); i++) {
    if (lignes[i].filter((x) => typeof x === "string" && x.trim()).length >= 3) return i;
  }
  return 0;
}

export async function lireXlsx(contenu: ArrayBuffer, feuilleVoulue?: string): Promise<FichierLu> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(contenu);
  const noms = wb.worksheets.map((w) => w.name);
  // Par défaut : la feuille qui contient le plus de lignes (souvent la « base titres »).
  const ws =
    (feuilleVoulue && wb.getWorksheet(feuilleVoulue)) ||
    [...wb.worksheets].sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
  if (!ws) throw new Error("Classeur vide.");
  const toutes: Brut[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const valeurs: Brut[] = [];
    for (let c = 1; c <= ws.actualColumnCount; c++) valeurs.push(valeurCellule(row.getCell(c).value));
    toutes.push(valeurs);
  });
  const k = trouverEntete(toutes);
  return {
    feuille: ws.name,
    feuilles: noms,
    entetes: (toutes[k] ?? []).map((x, i) => (x === null || x === "" ? `Colonne ${i + 1}` : String(x).trim())),
    lignes: toutes.slice(k + 1).filter((l) => l.some((x) => x !== null && x !== "")),
  };
}

/** CSV : séparateur détecté (« ; », « , » ou tabulation), guillemets gérés. */
export function lireCsv(texte: string): FichierLu {
  const t = texte.replace(/^﻿/, "");
  const premiere = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].sort((a, b) => premiere.split(b).length - premiere.split(a).length)[0];
  const lignes: Brut[][] = [];
  let ligne: Brut[] = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (guillemets) {
      if (ch === '"' && t[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (ch === '"') guillemets = false;
      else champ += ch;
    } else if (ch === '"') guillemets = true;
    else if (ch === sep) {
      ligne.push(champ);
      champ = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += ch;
  }
  if (champ || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  const propres = lignes.map((l) => l.map((x) => (x === "" ? null : x))).filter((l) => l.some((x) => x !== null));
  return {
    feuille: "CSV",
    feuilles: ["CSV"],
    entetes: (propres[0] ?? []).map((x, i) => (x ? String(x).trim() : `Colonne ${i + 1}`)),
    lignes: propres.slice(1),
  };
}
