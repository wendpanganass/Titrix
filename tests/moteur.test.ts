/**
 * Tests de non-régression du moteur — reprennent les critères d'acceptation du cahier des charges (§12).
 * On contrôle ce qui produit un chiffre sur lequel l'établissement décide, pas les libellés.
 */
import { describe, expect, it } from "vitest";
import {
  ajouterMois,
  calculerSituation,
  controlerSituation,
  couponCouru,
  echeancesPosition,
  echeancierContractuel,
  fractionAnnee,
  jourOuvreSuivant,
  situationPosition,
  statutEcheance,
  trancheMaturite,
  type DonneesPortefeuille,
  type InstrumentCalc,
  type InstrumentDonnees,
  type OperationCalc,
} from "@/moteur";

const base: InstrumentCalc = {
  id: "I1",
  dateEmission: "2024-03-15",
  dateEcheance: "2029-03-15",
  tauxCoupon: 0.065,
  convention: "ACT/365",
  frequence: 1,
  profil: "in_fine",
  differeMois: 0,
  precompte: false,
  tauxRetenue: 0,
  nominalUnitaire: 10_000,
};

const op = (o: Partial<OperationCalc>): OperationCalc => ({
  id: Math.random().toString(36),
  type: "acquisition",
  statut: "valide",
  dateEffet: "2024-03-15",
  nominal: 1_000_000,
  quantite: 100,
  positionId: "P1",
  positionDestinationId: null,
  ...o,
});

describe("Dates et conventions", () => {
  it("ajoute des mois en respectant les fins de mois", () => {
    expect(ajouterMois("2024-01-31", 1)).toBe("2024-02-29");
    expect(ajouterMois("2023-02-28", 12)).toBe("2024-02-29"); // fin de mois conservée
    expect(ajouterMois("2024-03-15", -6)).toBe("2023-09-15");
  });
  it("calcule les fractions d'année selon la convention", () => {
    expect(fractionAnnee("ACT/365", "2024-01-01", "2025-01-01")).toBeCloseTo(366 / 365, 10);
    expect(fractionAnnee("ACT/360", "2024-01-01", "2024-07-01")).toBeCloseTo(182 / 360, 10);
    expect(fractionAnnee("30/360", "2024-01-31", "2024-07-31")).toBeCloseTo(0.5, 10);
    expect(
      fractionAnnee("ACT/ACT", "2024-01-15", "2024-07-15", { debut: "2024-01-15", fin: "2024-07-15", frequence: 2 }),
    ).toBeCloseTo(0.5, 10);
  });
  it("décale une date de règlement au jour ouvré suivant", () => {
    expect(jourOuvreSuivant("2026-03-14", new Set())).toBe("2026-03-16"); // samedi → lundi
    expect(jourOuvreSuivant("2026-03-16", new Set(["2026-03-16"]))).toBe("2026-03-17");
  });
});

describe("Recette — titre in fine", () => {
  it("génère l'échéancier avec remboursement à l'échéance", () => {
    const r = echeancesPosition(base, [op({})], "P1");
    expect(r.echeances).toHaveLength(5);
    expect(r.echeances.slice(0, 4).every((e) => e.capitalDu === 0)).toBe(true);
    expect(r.echeances[4].capitalDu).toBe(1_000_000);
    expect(r.echeances[4].dateContractuelle).toBe("2029-03-15");
    // Coupon annuel ACT/365 sur une année bissextile (2024-03-15 → 2025-03-15 = 365 jours).
    expect(r.echeances[0].interetBrut).toBe(65_000);
    expect(r.reliquat).toBe(0);
  });
});

describe("Recette — titre amortissable avec différé", () => {
  it("n'amortit rien pendant le différé et respecte le calendrier", () => {
    const i = { ...base, profil: "constant" as const, differeMois: 24 };
    const r = echeancesPosition(i, [op({})], "P1");
    const capitaux = r.echeances.map((e) => e.capitalDu);
    expect(capitaux).toEqual([0, 0, 333_333.33, 333_333.33, 333_333.34]);
    // Intérêts dus pendant le différé (pas d'absence d'intérêts supposée).
    expect(r.echeances[0].interetBrut).toBeGreaterThan(0);
    expect(r.echeances[3].crdDebut).toBe(666_666.67);
    expect(capitaux.reduce((s, x) => s + x, 0)).toBeCloseTo(1_000_000, 6);
  });
  it("ajuste la dernière échéance pour éviter tout reliquat artificiel", () => {
    const i = { ...base, profil: "constant" as const, frequence: 12, dateEcheance: "2025-03-15" };
    const r = echeancesPosition(i, [op({ nominal: 1_000_000 })], "P1");
    expect(r.echeances).toHaveLength(12);
    expect(r.echeances.reduce((s, e) => s + e.capitalDu, 0)).toBeCloseTo(1_000_000, 6);
    expect(r.reliquat).toBe(0);
  });
});

describe("Échéancier officiel", () => {
  it("a priorité sur l'échéancier généré", () => {
    const officiel = [
      { date: "2026-03-15", partCapital: 0.4 },
      { date: "2029-03-15", partCapital: 0.6 },
    ];
    const ech = echeancierContractuel(base, officiel);
    expect(ech.source).toBe("officiel");
    const r = echeancesPosition(base, [op({})], "P1", { officiel });
    expect(r.echeances.map((e) => e.capitalDu)).toEqual([400_000, 600_000]);
  });
});

describe("Recette — même instrument chez deux conservateurs", () => {
  it("calcule deux positions distinctes sur un seul référentiel", () => {
    const ops = [op({ positionId: "P1", nominal: 600_000 }), op({ positionId: "P2", nominal: 400_000 })];
    expect(situationPosition(base, ops, "P1", "2025-01-01").nominal).toBe(600_000);
    expect(situationPosition(base, ops, "P2", "2025-01-01").nominal).toBe(400_000);
  });
  it("traite un transfert sans achat ni vente", () => {
    const ops = [op({}), op({ type: "transfert", nominal: 250_000, dateEffet: "2025-06-01", positionDestinationId: "P2" })];
    expect(situationPosition(base, ops, "P1", "2025-07-01").nominal).toBe(750_000);
    expect(situationPosition(base, ops, "P2", "2025-07-01").nominal).toBe(250_000);
  });
});

describe("Recette — encours nul et titre échu", () => {
  it("ne divise jamais par zéro sur un encours nul", () => {
    const s = situationPosition(base, [], "P1", "2025-01-01");
    expect(s.nominal).toBe(0);
    expect(s.couponCouru).toBe(0);
    expect(Number.isFinite(s.capitalContractuel)).toBe(true);
  });
  it("laisse la créance visible sans remboursement automatique fictif", () => {
    const s = situationPosition(base, [op({})], "P1", "2029-04-01");
    expect(s.nominal).toBe(1_000_000); // aucun remboursement constaté
    expect(s.capitalContractuel).toBe(0);
    expect(s.capitalEchuNonRembourse).toBe(1_000_000);
    const apres = situationPosition(
      base,
      [op({}), op({ type: "remboursement", nominal: 1_000_000, dateEffet: "2029-03-20" })],
      "P1",
      "2029-04-01",
    );
    expect(apres.nominal).toBe(0);
    expect(apres.capitalEchuNonRembourse).toBe(0);
  });
});

describe("Projection à partir de l'encours résiduel", () => {
  it("Σ capital futur + capital échu non remboursé = encours nominal à l'arrêté", () => {
    const i = { ...base, profil: "constant" as const, frequence: 2, differeMois: 12 };
    const ops = [op({}), op({ type: "cession", nominal: 300_000, dateEffet: "2026-01-10" })];
    for (const date of ["2025-01-01", "2026-02-01", "2027-06-30", "2028-12-31"]) {
      const s = situationPosition(i, ops, "P1", date);
      const futur = s.projection.reduce((t, e) => t + e.capitalDu, 0);
      expect(futur + s.capitalEchuNonRembourse).toBeCloseTo(s.nominal, 2);
    }
  });
});

describe("Coupon couru", () => {
  it("court depuis la dernière date de coupon", () => {
    // 2025-03-15 → 2025-09-15 = 184 jours
    expect(couponCouru(base, [op({})], "P1", "2025-09-15")).toBe(32_767.12);
  });
  it("tient compte d'un changement de capital", () => {
    const ops = [op({}), op({ type: "cession", nominal: 500_000, dateEffet: "2025-06-01" })];
    expect(couponCouru(base, ops, "P1", "2025-09-15")).toBe(16_383.56);
  });
});

describe("Recette — titre à intérêts précomptés", () => {
  it("ne crée aucun coupon futur fictif", () => {
    const bt = { ...base, precompte: true, tauxCoupon: 0.05, frequence: 0, dateEcheance: "2025-03-14" };
    const r = echeancesPosition(bt, [op({ prix: undefined } as Partial<OperationCalc>)], "P1");
    expect(r.echeances).toHaveLength(1);
    expect(r.echeances[0].interetBrut).toBe(0);
    expect(r.echeances[0].capitalDu).toBe(1_000_000);
    expect(couponCouru(bt, [op({})], "P1", "2024-09-01")).toBe(0);
  });
});

describe("Recette — encaissement partiel", () => {
  it("conserve le solde restant dû", () => {
    const e = { dateReglementPrevue: "2025-03-17", netAttendu: 65_000, statutManuel: null, montantRecu: 40_000 };
    expect(statutEcheance(e, "2025-04-01", 5)).toBe("partielle");
    expect(statutEcheance({ ...e, montantRecu: 0 }, "2025-04-01", 5)).toBe("en_retard");
    expect(statutEcheance({ ...e, montantRecu: 0 }, "2025-03-20", 5)).toBe("a_encaisser");
    expect(statutEcheance({ ...e, montantRecu: 65_000 }, "2025-04-01", 5)).toBe("encaissee");
  });
});

describe("Recette — arrêté historique", () => {
  it("restitue la position applicable à la date", () => {
    const ops = [op({}), op({ type: "acquisition", nominal: 500_000, dateEffet: "2026-06-01" })];
    expect(situationPosition(base, ops, "P1", "2026-05-31").nominal).toBe(1_000_000);
    expect(situationPosition(base, ops, "P1", "2026-06-01").nominal).toBe(1_500_000);
  });
  it("ignore les opérations non validées", () => {
    const ops = [op({}), op({ statut: "soumis", nominal: 500_000, dateEffet: "2025-01-01" })];
    expect(situationPosition(base, ops, "P1", "2026-01-01").nominal).toBe(1_000_000);
  });
});

describe("Tranches de maturité", () => {
  it("classe les jours restants", () => {
    expect(trancheMaturite(0)).toBe("Échu");
    expect(trancheMaturite(10)).toBe("Moins d'un mois");
    expect(trancheMaturite(400)).toBe("1 à 2 ans");
    expect(trancheMaturite(1000)).toBe("Plus de 2 ans");
  });
});

describe("Contrôles — grevage et disponible", () => {
  const instrument: InstrumentDonnees = {
    ...base,
    code: "TEST-01",
    isin: null,
    libelle: "Obligation test",
    emetteur: "État démo",
    pays: "BF",
    zone: "UEMOA",
    type: "OBL",
    devise: "XOF",
    statut: "valide",
    classification: "",
    notation: "",
    officiel: null,
  };
  const donnees: DonneesPortefeuille = {
    instruments: [instrument],
    positions: [
      {
        id: "P1",
        instrumentId: "I1",
        portefeuille: "Trésorerie",
        portefeuilleId: "F1",
        conservateur: "Conservateur A",
        compte: "001",
        statut: "active",
        classification: "",
        nominalReleve: null,
        dateReleve: null,
      },
    ],
    operations: [op({})],
    echeances: [],
    grevages: [
      {
        id: "G1",
        positionId: "P1",
        beneficiaire: "Banque centrale",
        nominalAffecte: 1_200_000,
        valeurRetenue: null,
        financementObtenu: 900_000,
        dateDebut: "2024-04-01",
        dateFin: null,
        statut: "actif",
      },
    ],
  };
  it("calcule le disponible sur une base homogène et signale le dépassement", () => {
    const s = calculerSituation(donnees, "2025-01-01");
    expect(s.lignes[0].nominalDisponible).toBe(-200_000); // le financement n'est pas soustrait
    const c = controlerSituation(s, { aujourdhui: "2025-01-01", seuilsEcheance: [30, 15, 7, 0], toleranceJours: 5, limiteConcentration: null });
    expect(c.some((x) => x.famille.startsWith("Grevage dépassant") && x.niveau === "bloquant")).toBe(true);
  });
});

import { decouperCode, isinCorrige, isinValide } from "@/lib/codes";
import { cleImport, devinerCorrespondance, divergences, interpreterLigneTitre, lireDateBrute, lireTaux } from "@/lib/import-regles";
describe("Reprise des données", () => {
  const entetes = ["Code titre", "Libellé", "Date échéance", "Taux", "Conservateur", "Encours nominal", "Montant utilisé", "Bénéficiaire"];
  const corr = devinerCorrespondance("base_titres", entetes);
  it("devine la correspondance des colonnes", () => {
    expect(corr.code).toBe(0);
    expect(corr.date_echeance).toBe(2);
    expect(corr.nominal).toBe(5);
    expect(corr.nominal_greve).toBe(6);
  });
  it("lit les valeurs à la française", () => {
    expect(lireDateBrute("15/03/2029")).toBe("2029-03-15");
    expect(lireDateBrute(46000)).toBe("2025-12-09");
    expect(lireTaux("6,5 %")).toBeCloseTo(0.065, 10);
    expect(lireTaux(0.065)).toBeCloseTo(0.065, 10);
  });
  it("signale sans corriger : erreur de formule, disponible négatif", () => {
    const l = interpreterLigneTitre(3, ["X-1", "Titre", "15/03/2029", "#NUM!", "SGI", 100, 150, "BC"], corr, { devise: "XOF", portefeuille: "PF" });
    expect(l.erreurs.join(" ")).toMatch(/#NUM!/);
    expect(l.erreurs.join(" ")).toMatch(/disponible négatif/);
  });
  it("produit une clé d'import stable", () => {
    expect(cleImport("b", ["a", 1])).toBe(cleImport("b", [" A ", "1"]));
    expect(cleImport("b", ["a", 1])).not.toBe(cleImport("b", ["a", 2]));
  });
  it("détecte les divergences sans fusion", () => {
    const a = { dateEcheance: "2030-06-01", taux: 0.06, frequence: 1, profil: "in_fine", nominalUnitaire: 10000, dateEmission: null };
    expect(divergences(a, { ...a })).toEqual([]);
    expect(divergences(a, { ...a, taux: 0.065 })).toHaveLength(1);
  });
});
describe("Codes titres", () => {
  it("contrôle la clé ISIN", () => {
    expect(isinValide("US0378331005")).toBe(true);
    expect(isinValide("US0378331006")).toBe(false);
    expect(isinCorrige("BF0000001000")).toBe("BF0000001008");
  });
  it("sépare ISIN et suffixe de position", () => {
    expect(decouperCode("US0378331005-B")).toEqual({ isin: "US0378331005", codeInterne: "US0378331005", suffixe: "B" });
    expect(decouperCode("TPCI.6,5%.2029")).toMatchObject({ isin: null });
    expect(decouperCode("IMP-OAT-2030-A")).toEqual({ isin: null, codeInterne: "IMP-OAT-2030", suffixe: "A" });
    expect(decouperCode("BAT-2026")).toEqual({ isin: null, codeInterne: "BAT-2026", suffixe: "" });
    expect(decouperCode("OAT 2029 (SGI Nord)")).toEqual({ isin: null, codeInterne: "OAT2029", suffixe: "SGINORD" });
  });
});
