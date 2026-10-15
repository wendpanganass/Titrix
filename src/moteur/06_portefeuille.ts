/**
 * Moteur financier — 06. Situation du portefeuille à une date d'arrêté.
 *
 * Toutes les vues d'un arrêté utilisent la même date de référence : cette fonction est
 * l'unique point de calcul utilisé par le tableau de bord, les analyses, les états et les arrêtés.
 */
import { ajouterJours, type DateIso } from "./01_dates";
import type { InstrumentCalc, LigneOfficielle } from "./02_echeancier";
import { arrondi2, situationPosition, type EcheanceCalculee, type OperationCalc } from "./03_position";
import { resteDu, statutEcheance, type StatutEcheance } from "./04_encaissements";
import { trancheMaturite, type Tranche, TRANCHES_DEFAUT } from "./05_indicateurs";

export interface InstrumentDonnees extends InstrumentCalc {
  code: string;
  isin: string | null;
  libelle: string;
  emetteur: string;
  pays: string;
  zone: string;
  type: string;
  devise: string;
  statut: string;
  classification: string;
  notation: string;
  officiel: LigneOfficielle[] | null;
}

export interface PositionDonnees {
  id: string;
  instrumentId: string;
  portefeuille: string;
  portefeuilleId: string;
  conservateur: string;
  compte: string;
  statut: string;
  classification: string;
  nominalReleve: number | null;
  dateReleve: DateIso | null;
}

export interface EcheanceDonnees {
  id: string;
  positionId: string;
  dateContractuelle: DateIso;
  dateReglementPrevue: DateIso;
  capitalDu: number;
  interetBrut: number;
  retenue: number;
  netAttendu: number;
  statutManuel: "litige" | "annulee" | "remplacee" | null;
  explicationEcart: string | null;
  montantRecu: number;
}

export interface GrevageDonnees {
  id: string;
  positionId: string;
  beneficiaire: string;
  nominalAffecte: number;
  valeurRetenue: number | null;
  financementObtenu: number | null;
  dateDebut: DateIso;
  dateFin: DateIso | null;
  statut: string;
}

export interface DonneesPortefeuille {
  instruments: InstrumentDonnees[];
  positions: PositionDonnees[];
  operations: OperationCalc[];
  echeances: EcheanceDonnees[];
  grevages: GrevageDonnees[];
  feries?: ReadonlySet<DateIso>;
}

export interface LignePosition {
  position: PositionDonnees;
  instrument: InstrumentDonnees;
  nominal: number;
  quantite: number;
  capitalContractuel: number;
  capitalEchuNonRembourse: number;
  couponCouru: number;
  nominalGreve: number;
  nominalDisponible: number;
  joursRestants: number | null;
  tranche: string;
  statutGrevage: "Libre" | "Partiellement grevé" | "Totalement grevé";
  projection: EcheanceCalculee[];
  erreurs: string[];
}

export interface EcheanceSuivie extends EcheanceDonnees {
  statut: StatutEcheance;
  reste: number;
  ligne: LignePosition | undefined;
}

export interface Situation {
  date: DateIso;
  lignes: LignePosition[];
  echeances: EcheanceSuivie[];
}

/** Un grevage est actif à une date s'il a été validé, a commencé, et n'est pas levé ou terminé. */
export function grevageActifA(g: GrevageDonnees, date: DateIso): boolean {
  if (g.statut !== "actif" && g.statut !== "leve") return false;
  if (g.dateDebut > date) return false;
  if (g.dateFin && g.dateFin <= date) return false;
  return true;
}

export function calculerSituation(
  d: DonneesPortefeuille,
  date: DateIso,
  options: { tranches?: Tranche[]; toleranceJours?: number; aujourdhui?: DateIso } = {},
): Situation {
  const instruments = new Map(d.instruments.map((i) => [i.id, i]));
  const opsParPosition = new Map<string, OperationCalc[]>();
  for (const op of d.operations) {
    for (const pid of [op.positionId, op.positionDestinationId]) {
      if (!pid) continue;
      const l = opsParPosition.get(pid) ?? [];
      l.push(op);
      opsParPosition.set(pid, l);
    }
  }

  const lignes: LignePosition[] = [];
  for (const p of d.positions) {
    const instrument = instruments.get(p.instrumentId);
    if (!instrument) continue;
    const ops = opsParPosition.get(p.id) ?? [];
    const s = situationPosition(instrument, ops, p.id, date, { officiel: instrument.officiel, feries: d.feries });
    const greve = arrondi2(
      d.grevages.filter((g) => g.positionId === p.id && grevageActifA(g, date)).reduce((t, g) => t + g.nominalAffecte, 0),
    );
    // Les positions sans aucun mouvement à la date sont ignorées (positions futures ou soldées depuis longtemps).
    const aEuMouvement = ops.some((o) => o.dateEffet <= date && (o.statut === "valide" || o.statut === "regle"));
    if (!aEuMouvement) continue;
    lignes.push({
      position: p,
      instrument,
      nominal: s.nominal,
      quantite: s.quantite,
      capitalContractuel: s.capitalContractuel,
      capitalEchuNonRembourse: s.capitalEchuNonRembourse,
      couponCouru: s.couponCouru,
      nominalGreve: greve,
      nominalDisponible: arrondi2(s.nominal - greve),
      joursRestants: s.joursRestants,
      tranche: s.nominal > 0 ? trancheMaturite(s.joursRestants, options.tranches ?? TRANCHES_DEFAUT) : "Soldé",
      statutGrevage: greve <= 0 ? "Libre" : greve >= s.nominal - 0.005 ? "Totalement grevé" : "Partiellement grevé",
      projection: s.projection,
      erreurs: s.erreurs,
    });
  }

  const parPosition = new Map(lignes.map((l) => [l.position.id, l]));
  const aujourdhui = options.aujourdhui ?? date;
  const tol = options.toleranceJours ?? 5;
  const echeances = d.echeances.map((e) => {
    const statut = statutEcheance(e, aujourdhui, tol);
    return { ...e, statut, reste: statut === "annulee" || statut === "remplacee" ? 0 : resteDu(e), ligne: parPosition.get(e.positionId) };
  });

  return { date, lignes, echeances };
}

/** Totaux par devise (les montants de devises différentes ne sont jamais additionnés). */
export function totauxParDevise(lignes: LignePosition[]) {
  const m = new Map<
    string,
    { devise: string; nominal: number; couru: number; greve: number; disponible: number; echu: number; positions: number }
  >();
  for (const l of lignes) {
    const t = m.get(l.instrument.devise) ?? {
      devise: l.instrument.devise,
      nominal: 0,
      couru: 0,
      greve: 0,
      disponible: 0,
      echu: 0,
      positions: 0,
    };
    t.nominal += l.nominal;
    t.couru += l.couponCouru;
    t.greve += l.nominalGreve;
    t.disponible += l.nominalDisponible;
    t.echu += l.capitalEchuNonRembourse;
    t.positions += l.nominal > 0 ? 1 : 0;
    m.set(l.instrument.devise, t);
  }
  return [...m.values()].sort((a, b) => b.nominal - a.nominal);
}

/** Flux futurs (capital et intérêts) entre deux dates, avec la part hors horizon. */
export function fluxProjetes(lignes: LignePosition[], debut: DateIso, horizonJours: number) {
  const fin = ajouterJours(debut, horizonJours);
  const dans: (EcheanceCalculee & { ligne: LignePosition })[] = [];
  const hors = { capital: 0, interet: 0 };
  for (const l of lignes)
    for (const e of l.projection) {
      if (e.dateContractuelle <= fin) dans.push({ ...e, ligne: l });
      else {
        hors.capital += e.capitalDu;
        hors.interet += e.interetBrut;
      }
    }
  dans.sort((a, b) => a.dateContractuelle.localeCompare(b.dateContractuelle));
  return { flux: dans, horsHorizon: { capital: arrondi2(hors.capital), interet: arrondi2(hors.interet) }, fin };
}
