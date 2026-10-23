/**
 * Analyses (§8.2) : ventilation de l'encours selon l'axe choisi, à la date d'arrêté.
 */
import Link from "next/link";
import { SelecteurDate } from "@/composants/client/Coquille";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Barres, Carte, EnTeteImpression, Vide } from "@/composants/ui";
import { analyser } from "@/donnees/portefeuille";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, montant, nombre, pourcent } from "@/lib/format";
import { FICHES_INDICATEURS, moyennePonderee, ratio, totauxParDevise, ventiler, type LignePosition } from "@/moteur";

const AXES: Record<string, { libelle: string; cle: (l: LignePosition) => string }> = {
  pays: { libelle: "Pays", cle: (l) => l.instrument.pays },
  zone: { libelle: "Zone", cle: (l) => l.instrument.zone },
  emetteur: { libelle: "Émetteur", cle: (l) => l.instrument.emetteur },
  conservateur: { libelle: "Conservateur", cle: (l) => l.position.conservateur },
  instrument: { libelle: "Instrument", cle: (l) => `${l.instrument.code} — ${l.instrument.libelle}` },
  type: { libelle: "Type d'instrument", cle: (l) => l.instrument.type },
  portefeuille: { libelle: "Portefeuille", cle: (l) => l.position.portefeuille },
  classification: { libelle: "Classification comptable", cle: (l) => l.position.classification || l.instrument.classification },
  notation: { libelle: "Notation", cle: (l) => l.instrument.notation },
  grevage: { libelle: "Statut de grevage", cle: (l) => l.statutGrevage },
  maturite: { libelle: "Tranche de maturité", cle: (l) => l.tranche },
};

export default async function Analyses(props: PageProps<"/analyses">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const axe = AXES[val("axe")] ? val("axe") : "pays";
  const a = await analyser(s, val("date") || null);
  const devises = totauxParDevise(a.situation.lignes).map((t) => t.devise);
  const devise = val("devise") || (devises.includes(a.parametres.deviseReference) ? a.parametres.deviseReference : devises[0] ?? a.parametres.deviseReference);
  const lignes = a.situation.lignes.filter((l) => l.instrument.devise === devise && l.nominal > 0);
  const total = lignes.reduce((t, l) => t + l.nominal, 0);
  const groupes = ventiler(lignes, AXES[axe].cle, (l) => ({
    nominal: l.nominal,
    greve: l.nominalGreve,
    disponible: l.nominalDisponible,
    couru: l.couponCouru,
    echu: l.capitalEchuNonRembourse,
  })).sort((x, y) => y.mesures.nominal - x.mesures.nominal);
  const indicateurs = (filtre: (l: LignePosition) => boolean) => {
    const ls = lignes.filter(filtre);
    return {
      coupon: moyennePonderee(ls.filter((l) => !l.instrument.precompte).map((l) => ({ valeur: l.instrument.tauxCoupon, poids: l.nominal }))),
      duree: moyennePonderee(ls.filter((l) => l.joursRestants !== null && l.joursRestants > 0).map((l) => ({ valeur: (l.joursRestants ?? 0) / 365, poids: l.nominal }))),
    };
  };
  const global = indicateurs(() => true);
  const lien = (extra: Record<string, string>) => `/analyses?${new URLSearchParams({ date: a.date, devise, axe, ...extra })}`;

  return (
    <>
      <EnTete titre="Analyses" sousTitre={`Ventilation de l'encours par ${AXES[axe].libelle.toLowerCase()} au ${dateFr(a.date)} · ${devise}`} droite={<SelecteurDate date={a.date} conserver={{ axe, devise }} />} />
      <Contenu>
        <EnTeteImpression titre={`Analyse par ${AXES[axe].libelle.toLowerCase()} au ${dateFr(a.date)}`} sousTitre={`${a.parametres.nomEtablissement} · ${devise}`} />
        <nav className="stknav noprint">
          {Object.entries(AXES).map(([k, v]) => <Link key={k} href={lien({ axe: k })} className={k === axe ? "on" : ""}>{v.libelle}</Link>)}
        </nav>
        {devises.length > 1 && (
          <nav className="stknav noprint">
            {devises.map((d) => <Link key={d} href={lien({ devise: d })} className={d === devise ? "on" : ""}>{d}</Link>)}
          </nav>
        )}
        <div className="rangee deux-un">
          <Carte titre={`Par ${AXES[axe].libelle.toLowerCase()}`} sousTitre={`Encours total ${montant(total)} ${devise} · coupon moyen pondéré ${pourcent(global.coupon)} · durée résiduelle moyenne ${nombre(global.duree, 2)} an(s)`} flush>
            {groupes.length === 0 ? <Vide>Aucune position.</Vide> : (
              <div className="tab-wrap">
                <table className="tab">
                  <thead><tr><th>{AXES[axe].libelle}</th><th className="d">Positions</th><th className="d">Nominal</th><th className="d">Part</th><th className="d">Grevé</th><th className="d">Disponible</th><th className="d" title="Intérêts courus non échus">ICNE</th><th className="d">Coupon moyen</th><th className="d">Durée rés. (ans)</th></tr></thead>
                  <tbody>
                    {groupes.map((g) => {
                      const ind = indicateurs((l) => (AXES[axe].cle(l) || "Non renseigné") === g.cle);
                      return (
                        <tr key={g.cle}>
                          <td>{g.cle}</td>
                          <td className="d">{g.nombre}</td>
                          <td className="d"><b>{montant(g.mesures.nominal)}</b></td>
                          <td className="d">{pourcent(ratio(g.mesures.nominal, total), 1)}</td>
                          <td className="d">{montant(g.mesures.greve)}</td>
                          <td className={`d ${g.mesures.disponible < 0 ? "neg" : ""}`}>{montant(g.mesures.disponible)}</td>
                          <td className="d">{montant(g.mesures.couru)}</td>
                          <td className="d">{pourcent(ind.coupon)}</td>
                          <td className="d">{nombre(ind.duree, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="d">{lignes.length}</td>
                      <td className="d">{montant(total)}</td>
                      <td className="d">{total > 0 ? "100,0 %" : "n.a."}</td>
                      <td className="d">{montant(lignes.reduce((t, l) => t + l.nominalGreve, 0))}</td>
                      <td className="d">{montant(lignes.reduce((t, l) => t + l.nominalDisponible, 0))}</td>
                      <td className="d">{montant(lignes.reduce((t, l) => t + l.couponCouru, 0))}</td>
                      <td className="d">{pourcent(global.coupon)}</td>
                      <td className="d">{nombre(global.duree, 2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Carte>
          <Carte titre="Répartition" sousTitre={`Nominal en ${devise}`}>
            {groupes.length ? <Barres lignes={groupes.slice(0, 15).map((g) => ({ nom: g.cle, valeur: g.mesures.nominal }))} format={compact} /> : <Vide>—</Vide>}
          </Carte>
        </div>
        <Carte titre="Fiches des indicateurs" sousTitre="Formule, données d'entrée, unité et limites de chaque indicateur affiché" flush>
          <div className="tab-wrap">
            <table className="tab">
              <thead><tr><th>Indicateur</th><th>Formule</th><th>Données</th><th>Unité</th><th>Limites</th></tr></thead>
              <tbody>
                {FICHES_INDICATEURS.map((f) => (
                  <tr key={f.nom}><td><b>{f.nom}</b></td><td className="petit">{f.formule}</td><td className="petit">{f.entrees}</td><td className="petit">{f.unite}</td><td className="petit">{f.limites}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Carte>
      </Contenu>
    </>
  );
}
