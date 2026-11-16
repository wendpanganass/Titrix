/**
 * Filtres en listes déroulantes communs au tableau de bord, à l'échéancier, aux encaissements et aux états :
 * mêmes axes que les analyses, plus le bénéficiaire du grevage. Les choix circulent dans l'adresse (?pays=SN…).
 */
import "server-only";
import type { FiltreListe } from "@/composants/client/Filtres";
import { AXES, ORDRE_TRANCHES, VALEUR_VIDE } from "@/lib/axes";
import { lire } from "@/lib/db";
import type { Controle, LignePosition } from "@/moteur";

/** Filtres proposés, dans l'ordre d'affichage. */
export const FILTRES = ["portefeuille", "conservateur", "pays", "zone", "emetteur", "type", "classification", "notation", "maturite", "grevage", "beneficiaire", "instrument"] as const;
export type NomFiltre = (typeof FILTRES)[number];

export interface Filtrage {
  actifs: NomFiltre[];
  /** La position passe-t-elle tous les filtres (sauf éventuellement l'un d'eux, pour proposer ses options) ? */
  retenue: (l: LignePosition, sauf?: NomFiltre) => boolean;
  /** Listes à afficher, options calculées sur les lignes données. */
  listes: (lignes: LignePosition[]) => FiltreListe[];
  /** Paramètres d'adresse des filtres actifs (à conserver dans les liens et formulaires). */
  adresse: Record<string, string>;
  /** « Pays : SN · Conservateur : X » (en-têtes d'impression et d'export). */
  resume: string;
}

type Parametres = Record<string, string | string[] | undefined>;

export async function preparerFiltres(q: Parametres, date: string): Promise<Filtrage> {
  const choix = Object.fromEntries(FILTRES.map((k) => [k, typeof q[k] === "string" ? (q[k] as string) : ""])) as Record<NomFiltre, string>;
  const actifs = FILTRES.filter((k) => choix[k]);
  // Bénéficiaires des grevages actifs à la date d'arrêté, par position.
  const beneficiaires = new Map<string, Set<string>>();
  for (const g of await lire<{ position_id: string; nom: string }>(
    `select distinct g.position_id::text as position_id, b.nom from grevages g join contreparties b on b.id = g.beneficiaire_id
      where g.statut in ('actif','leve') and g.date_debut <= $1 and (g.date_fin is null or g.date_fin > $1)`,
    [date],
  ))
    beneficiaires.set(g.position_id, (beneficiaires.get(g.position_id) ?? new Set()).add(g.nom));
  const valeursDe = (k: NomFiltre, l: LignePosition): string[] =>
    k === "beneficiaire" ? [...(beneficiaires.get(l.position.id) ?? [VALEUR_VIDE])] : [AXES[k].cle(l) || VALEUR_VIDE];
  const retenue = (l: LignePosition, sauf?: NomFiltre) => actifs.every((k) => k === sauf || valeursDe(k, l).includes(choix[k]));
  const libelleFiltre = (k: NomFiltre) => (k === "beneficiaire" ? "Bénéficiaire du grevage" : AXES[k].libelle);
  const libelleValeur = (k: NomFiltre, v: string) => (v === VALEUR_VIDE ? (k === "beneficiaire" ? "Non grevé" : "Non renseigné") : v);
  // Options de chaque liste : valeurs présentes compte tenu des AUTRES filtres (nombre de positions entre parenthèses).
  const listes = (lignes: LignePosition[]): FiltreListe[] =>
    FILTRES.map((k) => {
      const compte = new Map<string, number>();
      for (const l of lignes) if (l.nominal > 0 && retenue(l, k)) for (const v of valeursDe(k, l)) compte.set(v, (compte.get(v) ?? 0) + 1);
      if (choix[k] && !compte.has(choix[k])) compte.set(choix[k], 0);
      const rang = (v: string) => (k === "maturite" ? (ORDRE_TRANCHES.indexOf(v) + 99) % 99 : 0);
      const options = [...compte.entries()]
        .sort(([a], [b]) => rang(a) - rang(b) || (a === VALEUR_VIDE ? 1 : 0) - (b === VALEUR_VIDE ? 1 : 0) || a.localeCompare(b, "fr"))
        .map(([v, n]) => ({ valeur: v, libelle: `${libelleValeur(k, v)} (${n})` }));
      return { nom: k, libelle: libelleFiltre(k), valeur: choix[k], options };
    });
  return {
    actifs,
    retenue,
    listes,
    adresse: Object.fromEntries(actifs.map((k) => [k, choix[k]])),
    resume: actifs.map((k) => `${k === "beneficiaire" ? "Bénéficiaire" : AXES[k].libelle} : ${libelleValeur(k, choix[k])}`).join(" · "),
  };
}

/**
 * Alertes rattachées aux positions, échéances ou instruments retenus par les filtres
 * (les alertes globales, comme la concentration, ne sont pas rattachables et sont écartées).
 */
export function controlesRetenus(controles: Controle[], r: { positions: Set<string>; echeances: Set<string>; instruments: Set<string> }): Controle[] {
  return controles.filter((c) => {
    const m = c.lien.match(/^\/(positions|instruments)\/([0-9a-f-]{36})|echeance=([0-9a-f-]{36})/);
    if (!m) return false;
    return m[1] === "positions" ? r.positions.has(m[2]) : m[1] === "instruments" ? r.instruments.has(m[2]) : r.echeances.has(m[3]);
  });
}
