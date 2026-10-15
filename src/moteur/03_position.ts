/**
 * Moteur financier — 03. Position : encours, échéances, coupon couru, projection.
 *
 * Deux mesures de capital sont suivies pour chaque position :
 *  - N, le NOMINAL DÉTENU (comptable) : il ne baisse que lorsqu'une opération d'amortissement
 *    ou de remboursement est validée (l'arrivée à l'échéance ne suffit pas à rembourser un titre) ;
 *  - C, le CAPITAL RESTANT DÛ CONTRACTUEL : il baisse à chaque date d'échéance du montant de capital dû.
 * L'écart N − C est le capital échu non encore remboursé (créance), suivi séparément.
 * Ainsi : Σ capital futur projeté + capital échu non remboursé = encours nominal détenu.
 */
import { fractionAnnee, jourOuvreSuivant, versJour, type DateIso } from "./01_dates";
import { echeancierContractuel, type InstrumentCalc, type LigneOfficielle, VERSION_MOTEUR } from "./02_echeancier";

export const TYPES_OPERATION = [
  "position_ouverture",
  "acquisition",
  "cession",
  "transfert",
  "amortissement",
  "remboursement",
  "remboursement_anticipe",
] as const;
export type TypeOperation = (typeof TYPES_OPERATION)[number];

export const LIBELLES_OPERATION: Record<TypeOperation, string> = {
  position_ouverture: "Position d'ouverture (reprise)",
  acquisition: "Acquisition",
  cession: "Cession",
  transfert: "Transfert entre conservateurs",
  amortissement: "Amortissement constaté",
  remboursement: "Remboursement constaté",
  remboursement_anticipe: "Remboursement anticipé",
};

/** Statuts qui rendent une opération effective sur la position. */
export const STATUTS_EFFECTIFS = ["valide", "regle"] as const;

export interface OperationCalc {
  id: string;
  type: TypeOperation;
  statut: string;
  dateEffet: DateIso;
  nominal: number;
  quantite: number | null;
  positionId: string;
  positionDestinationId: string | null;
}

/** Effet d'une opération sur une position : ΔN (nominal détenu) et ΔC (capital contractuel). */
export function effetOperation(op: OperationCalc, positionId: string): { dN: number; dC: number; dQ: number } {
  if (!STATUTS_EFFECTIFS.includes(op.statut as (typeof STATUTS_EFFECTIFS)[number])) return { dN: 0, dC: 0, dQ: 0 };
  const q = op.quantite ?? 0;
  const source = op.positionId === positionId;
  const destination = op.positionDestinationId === positionId;
  switch (op.type) {
    case "position_ouverture":
    case "acquisition":
      return source ? { dN: op.nominal, dC: op.nominal, dQ: q } : { dN: 0, dC: 0, dQ: 0 };
    case "cession":
    case "remboursement_anticipe":
      return source ? { dN: -op.nominal, dC: -op.nominal, dQ: -q } : { dN: 0, dC: 0, dQ: 0 };
    case "transfert":
      if (source) return { dN: -op.nominal, dC: -op.nominal, dQ: -q };
      if (destination) return { dN: op.nominal, dC: op.nominal, dQ: q };
      return { dN: 0, dC: 0, dQ: 0 };
    case "amortissement":
    case "remboursement":
      // Réalisation d'une échéance déjà prise en compte dans C : seul N baisse.
      return source ? { dN: -op.nominal, dC: 0, dQ: 0 } : { dN: 0, dC: 0, dQ: 0 };
  }
}

/** Arrondi au centime (règlement). Les calculs intermédiaires restent en pleine précision. */
export function arrondi2(x: number): number {
  return Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
}

/** Nominal détenu, capital contractuel et quantité à une date (opérations dont la date d'effet ≤ date). */
export function encoursADate(ops: OperationCalc[], positionId: string, date: DateIso) {
  let n = 0;
  let q = 0;
  for (const op of ops) {
    if (op.dateEffet > date) continue;
    const e = effetOperation(op, positionId);
    n += e.dN;
    q += e.dQ;
  }
  return { nominal: arrondi2(n), quantite: q };
}

export interface EcheanceCalculee {
  dateContractuelle: DateIso;
  dateReglementPrevue: DateIso;
  debutPeriode: DateIso;
  finPeriode: DateIso;
  crdDebut: number;
  capitalDu: number;
  interetBrut: number;
  retenue: number;
  netAttendu: number;
  source: "genere" | "officiel";
  versionMoteur: string;
}

export interface ResultatEcheances {
  echeances: EcheanceCalculee[];
  erreurs: string[];
  /** Capital contractuel restant après la dernière échéance (doit être nul sauf anomalie). */
  reliquat: number;
}

/**
 * Échéances d'une position. Une opération datée d'un jour de paiement prend effet APRÈS
 * le paiement (le vendeur touche le coupon du jour). Aucune échéance n'est produite avant
 * la première opération : en mode « position d'ouverture », les périodes antérieures non
 * documentées ne sont pas présentées comme reconstituées.
 */
export function echeancesPosition(
  instrument: InstrumentCalc,
  ops: OperationCalc[],
  positionId: string,
  options: { officiel?: LigneOfficielle[] | null; feries?: ReadonlySet<DateIso>; jusquA?: DateIso } = {},
): ResultatEcheances {
  const ech = echeancierContractuel(instrument, options.officiel);
  if (ech.erreurs.length && ech.periodes.length === 0) return { echeances: [], erreurs: ech.erreurs, reliquat: 0 };

  const feries = options.feries ?? new Set<DateIso>();
  const effectives = ops
    .filter((o) => !options.jusquA || o.dateEffet <= options.jusquA)
    .map((o) => ({ o, e: effetOperation(o, positionId) }))
    .filter((x) => x.e.dC !== 0)
    .sort((a, b) => a.o.dateEffet.localeCompare(b.o.dateEffet));

  const parts = ech.periodes.map((p) => p.partCapital);
  const restantes = parts.map((_, k) => parts.slice(k).reduce((s, x) => s + x, 0));

  let c = 0;
  let idx = 0;
  const sortie: EcheanceCalculee[] = [];
  ech.periodes.forEach((p, k) => {
    // Opérations strictement antérieures à la date de paiement.
    while (idx < effectives.length && effectives[idx].o.dateEffet < p.fin) {
      c += effectives[idx].e.dC;
      idx++;
    }
    if (c <= 0.005) return;
    const derniere = restantes[k] > 0 && restantes.slice(k + 1).every((r) => r <= 1e-12);
    const capital = derniere ? arrondi2(c) : restantes[k] > 0 ? arrondi2((c * parts[k]) / restantes[k]) : 0;
    const interet = instrument.precompte
      ? 0
      : arrondi2(
          c *
            instrument.tauxCoupon *
            fractionAnnee(instrument.convention, p.debut, p.fin, {
              debut: p.debut,
              fin: p.fin,
              frequence: instrument.frequence,
            }),
        );
    const retenue = arrondi2(interet * (instrument.tauxRetenue || 0));
    sortie.push({
      dateContractuelle: p.fin,
      dateReglementPrevue: jourOuvreSuivant(p.fin, feries),
      debutPeriode: p.debut,
      finPeriode: p.fin,
      crdDebut: arrondi2(c),
      capitalDu: capital,
      interetBrut: interet,
      retenue,
      netAttendu: arrondi2(capital + interet - retenue),
      source: ech.source,
      versionMoteur: VERSION_MOTEUR,
    });
    c -= capital;
  });
  // Opérations postérieures à la dernière échéance (ne devraient pas exister).
  while (idx < effectives.length) c += effectives[idx++].e.dC;
  return { echeances: sortie, erreurs: ech.erreurs, reliquat: arrondi2(c) };
}

/** Coupon couru à une date : depuis la dernière date de coupon jusqu'à la date (exclue). */
export function couponCouru(
  instrument: InstrumentCalc,
  ops: OperationCalc[],
  positionId: string,
  date: DateIso,
  officiel?: LigneOfficielle[] | null,
): number {
  if (instrument.precompte || !(instrument.tauxCoupon > 0)) return 0;
  const ech = echeancierContractuel(instrument, officiel);
  const periode = ech.periodes.find((p) => p.debut < date && date < p.fin);
  if (!periode) return 0;
  const crd = capitalContractuelADate(instrument, ops, positionId, date, officiel);
  if (crd <= 0) return 0;
  const alpha = fractionAnnee(instrument.convention, periode.debut, date, {
    debut: periode.debut,
    fin: periode.fin,
    frequence: instrument.frequence,
  });
  return arrondi2(crd * instrument.tauxCoupon * alpha);
}

/** Capital contractuel restant dû à une date (C), après les échéances passées. */
export function capitalContractuelADate(
  instrument: InstrumentCalc,
  ops: OperationCalc[],
  positionId: string,
  date: DateIso,
  officiel?: LigneOfficielle[] | null,
): number {
  const { echeances } = echeancesPosition(instrument, ops, positionId, { officiel, jusquA: date });
  let c = 0;
  for (const op of ops) if (op.dateEffet <= date) c += effetOperation(op, positionId).dC;
  for (const e of echeances) if (e.dateContractuelle <= date) c -= e.capitalDu;
  return Math.max(0, arrondi2(c));
}

export interface SituationPosition {
  nominal: number;
  quantite: number;
  capitalContractuel: number;
  /** Capital échu non encore remboursé (N − C) : créance visible, jamais un remboursement fictif. */
  capitalEchuNonRembourse: number;
  couponCouru: number;
  /** Échéances futures projetées à partir de l'encours résiduel à la date. */
  projection: EcheanceCalculee[];
  /** Jours restants jusqu'à l'échéance de l'instrument (négatif si échu). */
  joursRestants: number | null;
  erreurs: string[];
}

/** Situation complète d'une position à une date (situation courante ou historique reconstituée). */
export function situationPosition(
  instrument: InstrumentCalc,
  ops: OperationCalc[],
  positionId: string,
  date: DateIso,
  options: { officiel?: LigneOfficielle[] | null; feries?: ReadonlySet<DateIso> } = {},
): SituationPosition {
  const { nominal, quantite } = encoursADate(ops, positionId, date);
  const res = echeancesPosition(instrument, ops, positionId, { ...options, jusquA: date });
  let c = 0;
  for (const op of ops) if (op.dateEffet <= date) c += effetOperation(op, positionId).dC;
  for (const e of res.echeances) if (e.dateContractuelle <= date) c -= e.capitalDu;
  const capitalContractuel = Math.max(0, arrondi2(c));
  return {
    nominal,
    quantite,
    capitalContractuel,
    capitalEchuNonRembourse: Math.max(0, arrondi2(nominal - capitalContractuel)),
    couponCouru: couponCouru(instrument, ops, positionId, date, options.officiel),
    projection: res.echeances.filter((e) => e.dateContractuelle > date),
    joursRestants: instrument.dateEcheance ? versJour(instrument.dateEcheance) - versJour(date) : null,
    erreurs: res.erreurs,
  };
}
