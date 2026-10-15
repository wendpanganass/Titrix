/**
 * Échéancier et projections (§6.3) : flux futurs projetés à partir de l'encours résiduel à l'arrêté,
 * synthèses mensuelle et annuelle des tombées, flux hors horizon affichés à part.
 */
import Link from "next/link";
import { SelecteurDate } from "@/composants/client/Coquille";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Carte, EnTeteImpression, Indicateur, Message, Vide } from "@/composants/ui";
import { analyser } from "@/donnees/portefeuille";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, montant, moisFr } from "@/lib/format";
import { anneeDe, fluxProjetes, moisDe, totauxParDevise } from "@/moteur";

export default async function Echeancier(props: PageProps<"/echeancier">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const val = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const a = await analyser(s, val("date") || null);
  const devises = totauxParDevise(a.situation.lignes).map((t) => t.devise);
  const devise = val("devise") || (devises.includes(a.parametres.deviseReference) ? a.parametres.deviseReference : devises[0] ?? a.parametres.deviseReference);
  const horizonMois = Math.min(600, Math.max(1, Number(val("horizon")) || a.parametres.horizonMois));
  const vue = val("vue") === "detail" ? "detail" : val("vue") === "annuel" ? "annuel" : "mensuel";
  const lignes = a.situation.lignes.filter((l) => l.instrument.devise === devise && (!val("portefeuille") || l.position.portefeuilleId === val("portefeuille")));
  const { flux, horsHorizon, fin } = fluxProjetes(lignes, a.date, Math.round(horizonMois * 30.4375));
  const encours = lignes.reduce((t, l) => t + l.nominal, 0);
  const echu = lignes.reduce((t, l) => t + l.capitalEchuNonRembourse, 0);
  const capital = flux.reduce((t, e) => t + e.capitalDu, 0);
  const interet = flux.reduce((t, e) => t + e.interetBrut, 0);
  const ecart = encours - (capital + horsHorizon.capital + echu);

  const groupes = new Map<string, { capital: number; interet: number; retenue: number; net: number; n: number }>();
  for (const e of flux) {
    const k = vue === "annuel" ? anneeDe(e.dateContractuelle) : moisDe(e.dateContractuelle);
    const g = groupes.get(k) ?? { capital: 0, interet: 0, retenue: 0, net: 0, n: 0 };
    g.capital += e.capitalDu;
    g.interet += e.interetBrut;
    g.retenue += e.retenue;
    g.net += e.netAttendu;
    g.n++;
    groupes.set(k, g);
  }
  const lien = (extra: Record<string, string>) =>
    `/echeancier?${new URLSearchParams({ date: a.date, devise, horizon: String(horizonMois), vue, ...(val("portefeuille") ? { portefeuille: val("portefeuille") } : {}), ...extra })}`;

  return (
    <>
      <EnTete titre="Échéancier" sousTitre={`Projection des tombées depuis l'encours au ${dateFr(a.date)} · horizon ${horizonMois} mois · ${devise}`} droite={<SelecteurDate date={a.date} conserver={{ devise, horizon: String(horizonMois), vue }} />} />
      <Contenu>
        <EnTeteImpression titre={`Échéancier au ${dateFr(a.date)} — ${devise}`} sousTitre={`${a.parametres.nomEtablissement} · horizon jusqu'au ${dateFr(fin)}`} />
        <div className="barre-filtres noprint">
          <nav className="stknav" style={{ margin: 0 }}>
            <Link href={lien({ vue: "mensuel" })} className={vue === "mensuel" ? "on" : ""}>Synthèse mensuelle</Link>
            <Link href={lien({ vue: "annuel" })} className={vue === "annuel" ? "on" : ""}>Synthèse annuelle</Link>
            <Link href={lien({ vue: "detail" })} className={vue === "detail" ? "on" : ""}>Détail par position</Link>
          </nav>
          <form method="get" className="actions">
            <input type="hidden" name="date" value={a.date} />
            <input type="hidden" name="vue" value={vue} />
            <select className="champ" name="devise" defaultValue={devise}>{devises.map((d) => <option key={d}>{d}</option>)}</select>
            <select className="champ" name="horizon" defaultValue={String(horizonMois)}>
              {[3, 6, 12, 24, 36, 60, 120, 360].map((m) => <option key={m} value={m}>{m} mois</option>)}
            </select>
            <button className="btn-sec">Appliquer</button>
          </form>
        </div>
        <div className="grid-kpi">
          <Indicateur libelle="Encours nominal à l'arrêté" valeur={compact(encours)} unite={devise} icone="positions" detail={`${lignes.length} position(s)`} />
          <Indicateur libelle="Capital projeté dans l'horizon" valeur={compact(capital)} unite={devise} icone="echeancier" detail={`Au-delà : ${compact(horsHorizon.capital)}`} />
          <Indicateur libelle="Intérêts bruts dans l'horizon" valeur={compact(interet)} unite={devise} icone="monnaie" ton="bon" detail={`Au-delà : ${compact(horsHorizon.interet)}`} />
          <Indicateur libelle="Capital échu non remboursé" valeur={compact(echu)} unite={devise} icone="alerte" ton={echu > 0 ? "erreur" : "bon"} detail="Rapproché séparément" />
        </div>
        <Message ton={Math.abs(ecart) < 1 ? "bon" : "alerte"}>
          Bouclage : capital dans l&apos;horizon ({montant(capital)}) + capital au-delà ({montant(horsHorizon.capital)}) + capital échu non remboursé ({montant(echu)}) = {montant(capital + horsHorizon.capital + echu)} {devise}, pour un encours de {montant(encours)} {devise}{" "}
          {Math.abs(ecart) < 1 ? "✔" : `✖ écart de ${montant(ecart)} à expliquer (titres sans échéancier calculable, voir Alertes)`}.
        </Message>

        {vue !== "detail" ? (
          <Carte titre={vue === "annuel" ? "Tombées par année" : "Tombées par mois"} sousTitre="Montants contractuels attendus ; date contractuelle (avant ajustement au jour ouvré)" flush>
            {groupes.size === 0 ? <Vide>Aucun flux dans l&apos;horizon.</Vide> : (
              <div className="tab-wrap">
                <table className="tab">
                  <thead><tr><th>{vue === "annuel" ? "Année" : "Mois"}</th><th className="d">Échéances</th><th className="d">Capital</th><th className="d">Intérêts bruts</th><th className="d">Retenues</th><th className="d">Net attendu</th></tr></thead>
                  <tbody>
                    {[...groupes.entries()].map(([k, g]) => (
                      <tr key={k}>
                        <td>{vue === "annuel" ? k : moisFr(k)}</td>
                        <td className="d">{g.n}</td>
                        <td className="d">{montant(g.capital)}</td>
                        <td className="d">{montant(g.interet)}</td>
                        <td className="d">{montant(g.retenue)}</td>
                        <td className="d"><b>{montant(g.net)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td>Total dans l&apos;horizon</td><td className="d">{flux.length}</td><td className="d">{montant(capital)}</td><td className="d">{montant(interet)}</td><td className="d">{montant(flux.reduce((t, e) => t + e.retenue, 0))}</td><td className="d">{montant(flux.reduce((t, e) => t + e.netAttendu, 0))}</td></tr>
                    <tr><td>Au-delà du {dateFr(fin)}</td><td></td><td className="d">{montant(horsHorizon.capital)}</td><td className="d">{montant(horsHorizon.interet)}</td><td></td><td></td></tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Carte>
        ) : (
          <Carte titre={`${flux.length} flux projeté(s)`} flush>
            {flux.length === 0 ? <Vide>Aucun flux.</Vide> : (
              <div className="tab-wrap">
                <table className="tab">
                  <thead><tr><th>Date</th><th>Instrument</th><th>Conservateur · portefeuille</th><th className="d">CRD début</th><th className="d">Capital</th><th className="d">Intérêts</th><th className="d">Net</th><th>Source</th></tr></thead>
                  <tbody>
                    {flux.slice(0, 1500).map((e, k) => (
                      <tr key={`${e.ligne.position.id}-${e.dateContractuelle}-${k}`}>
                        <td className="nowrap">{dateFr(e.dateContractuelle)}</td>
                        <td><Link href={`/positions/${e.ligne.position.id}`}>{e.ligne.instrument.code}</Link></td>
                        <td>{e.ligne.position.conservateur} · {e.ligne.position.portefeuille}</td>
                        <td className="d">{montant(e.crdDebut)}</td>
                        <td className="d">{montant(e.capitalDu)}</td>
                        <td className="d">{montant(e.interetBrut)}</td>
                        <td className="d">{montant(e.netAttendu)}</td>
                        <td className="petit">{e.source === "officiel" ? "Officiel" : "Généré"} · {e.versionMoteur}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Carte>
        )}
      </Contenu>
    </>
  );
}
