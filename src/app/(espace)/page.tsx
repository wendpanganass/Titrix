/**
 * Tableau de bord principal (cahier des charges §8.1) — tout est calculé à la même date d'arrêté.
 */
import Link from "next/link";
import { SelecteurDate } from "@/composants/client/Coquille";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Badge, Barres, Carte, EnTeteImpression, Indicateur, Message, TitreZone, Vide } from "@/composants/ui";
import { analyser, fluxEncaisses } from "@/donnees/portefeuille";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, montant, moisFr, pourcent } from "@/lib/format";
import {
  ajouterJours,
  estImpaye,
  fluxProjetes,
  LIBELLES_NIVEAU,
  LIBELLES_STATUT_ECHEANCE,
  moyennePonderee,
  totauxParDevise,
  ventiler,
} from "@/moteur";

export default async function TableauDeBord(props: PageProps<"/">) {
  const s = await exigerSession();
  const q = await props.searchParams;
  const { situation, controles, parametres, date } = await analyser(s, typeof q.date === "string" ? q.date : null);
  const totaux = totauxParDevise(situation.lignes);
  const devise = typeof q.devise === "string" ? q.devise : (totaux.find((t) => t.devise === parametres.deviseReference)?.devise ?? totaux[0]?.devise ?? parametres.deviseReference);
  const lignes = situation.lignes.filter((l) => l.instrument.devise === devise && l.nominal > 0);
  const t = totaux.find((x) => x.devise === devise);
  const instruments = new Set(lignes.map((l) => l.instrument.id));
  const { flux, horsHorizon } = fluxProjetes(lignes, date, 365);
  const capital12 = flux.reduce((x, e) => x + e.capitalDu, 0);
  const interets12 = flux.reduce((x, e) => x + e.interetBrut, 0);
  const echeancesDevise = situation.echeances.filter((e) => e.ligne?.instrument.devise === devise);
  const impayes = echeancesDevise.filter((e) => estImpaye(e.statut) && e.dateReglementPrevue <= date && e.reste > 0);
  const enRetard = impayes.filter((e) => e.statut !== "a_encaisser");
  const retard = enRetard.reduce((x, e) => x + e.reste, 0);
  const retardCapital = enRetard.reduce((x, e) => x + Math.max(0, e.resteCapital), 0);
  const retardInteret = enRetard.reduce((x, e) => x + Math.max(0, e.resteInteret), 0);
  const echuCapital = impayes.reduce((x, e) => x + Math.max(0, e.resteCapital), 0);
  const echuInteret = impayes.reduce((x, e) => x + Math.max(0, e.resteInteret), 0);
  // Flux réellement encaissés depuis le 1er janvier de l'année de l'arrêté.
  const debutAnnee = `${date.slice(0, 4)}-01-01`;
  const encaisse = (await fluxEncaisses(s, debutAnnee, date)).find((x) => x.devise === devise) ?? { capital: 0, interet: 0, nombre: 0 };
  const prochaines = echeancesDevise
    .filter((e) => e.dateReglementPrevue >= date && e.dateReglementPrevue <= ajouterJours(date, 30) && e.statut !== "encaissee")
    .sort((a, b) => a.dateReglementPrevue.localeCompare(b.dateReglementPrevue));
  const ouvertes = controles.filter((c) => c.niveau !== "info");
  const coupon = moyennePonderee(lignes.filter((l) => !l.instrument.precompte).map((l) => ({ valeur: l.instrument.tauxCoupon, poids: l.nominal })));

  // Tombées mensuelles sur 12 mois (capital et intérêts).
  const mois: string[] = [];
  for (let k = 0; k < 12; k++) {
    const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + k);
    mois.push(d.toISOString().slice(0, 7));
  }
  const parMois = new Map(mois.map((m) => [m, { capital: 0, interet: 0 }]));
  for (const e of flux) {
    const m = parMois.get(e.dateContractuelle.slice(0, 7));
    if (m) {
      m.capital += e.capitalDu;
      m.interet += e.interetBrut;
    }
  }
  const maxMois = Math.max(...[...parMois.values()].map((m) => m.capital + m.interet), 1);
  const parPays = ventiler(lignes, (l) => l.instrument.pays, (l) => ({ n: l.nominal }))
    .sort((a, b) => b.mesures.n - a.mesures.n)
    .slice(0, 8);
  const parTranche = ventiler(lignes, (l) => l.tranche, (l) => ({ n: l.nominal }));
  const ordreTranches = ["Échu", "Moins d'un mois", "1 à 3 mois", "3 à 6 mois", "6 à 12 mois", "1 à 2 ans", "Plus de 2 ans"];
  parTranche.sort((a, b) => (ordreTranches.indexOf(a.cle) + 99) % 99 - (ordreTranches.indexOf(b.cle) + 99) % 99);
  const parConservateur = ventiler(lignes, (l) => l.position.conservateur, (l) => ({ n: l.nominal })).sort((a, b) => b.mesures.n - a.mesures.n);

  return (
    <>
      <EnTete
        titre="Tableau de bord"
        sousTitre={`Situation du portefeuille au ${dateFr(date)} · montants en ${devise}`}
        droite={<SelecteurDate date={date} conserver={{ devise: typeof q.devise === "string" ? q.devise : undefined }} />}
      />
      <Contenu>
        <EnTeteImpression titre={`Tableau de bord au ${dateFr(date)}`} sousTitre={`${parametres.nomEtablissement} · ${devise}`} />
        {totaux.length > 1 && (
          <div className="stknav noprint">
            {totaux.map((x) => (
              <Link key={x.devise} href={`/?devise=${x.devise}&date=${date}`} className={x.devise === devise ? "on" : ""}>
                {x.devise} · {compact(x.nominal)}
              </Link>
            ))}
          </div>
        )}
        {situation.lignes.length === 0 && (
          <Message ton="info">
            Aucune position à cette date. Commencez par <Link href="/instruments">créer les instruments</Link>, puis{" "}
            <Link href="/positions">les positions</Link> et leurs opérations, ou <Link href="/import">importez votre classeur</Link>.
          </Message>
        )}
        <div className="grid-kpi">
          <Indicateur libelle="Encours nominal" valeur={compact(t?.nominal ?? 0)} unite={devise} icone="positions"
            detail={`${instruments.size} instrument(s) · ${lignes.length} position(s)`} />
          <Indicateur libelle="Tombées à 12 mois" valeur={compact(capital12 + interets12)} unite={devise} icone="echeancier"
            detail={`Capital ${compact(capital12)} · intérêts ${compact(interets12)}`} />
          <Indicateur libelle="ICNE (coupons courus)" valeur={compact(t?.couru ?? 0)} unite={devise} icone="monnaie" ton="bon"
            detail={`Coupon moyen pondéré ${pourcent(coupon)}`} />
          <Indicateur libelle="Nominal grevé" valeur={compact(t?.greve ?? 0)} unite={devise} icone="grevage" ton="alerte"
            detail={`Disponible ${compact(t?.disponible ?? 0)} ${devise}`} />
          <Indicateur libelle="Échéances à 30 jours" valeur={prochaines.length} icone="horloge"
            detail={`${compact(prochaines.reduce((x, e) => x + e.netAttendu, 0))} ${devise} attendus`} />
          <Indicateur libelle="Montants en retard" valeur={compact(retard)} unite={devise} icone="encaissements" ton={retard > 0 ? "erreur" : "bon"}
            detail={`Capital ${compact(retardCapital)} · intérêts ${compact(retardInteret)}`} />
          <Indicateur libelle="Capital échu à recouvrer" valeur={compact(t?.echu ?? 0)} unite={devise} icone="alerte"
            ton={(t?.echu ?? 0) > 0 ? "erreur" : "bon"} detail="Sans remboursement constaté" />
          <Indicateur libelle="Anomalies non résolues" valeur={ouvertes.length} icone="controles" ton={ouvertes.some((c) => c.niveau === "bloquant") ? "erreur" : ouvertes.length ? "alerte" : "bon"}
            detail={`${ouvertes.filter((c) => c.niveau === "bloquant").length} bloquante(s)`} />
        </div>

        <div className="rangee deux-un">
          <Carte titre="Tombées des 12 prochains mois" sousTitre={`Capital et intérêts bruts projetés à partir de l'encours au ${dateFr(date)}`}
            action={<Link className="btn-sec btn-mini" href={`/echeancier?date=${date}`}>Échéancier →</Link>}>
            <div className="histo">
              {[...parMois.entries()].map(([m, v]) => (
                <div className="col" key={m} title={`${moisFr(m)} : capital ${montant(v.capital)}, intérêts ${montant(v.interet)}`}>
                  <div className="pile" style={{ height: `${((v.capital + v.interet) / maxMois) * 100}%` }}>
                    <i style={{ height: `${(v.capital / Math.max(v.capital + v.interet, 1e-9)) * 100}%`, background: "var(--viz-1)" }} />
                    <i style={{ height: `${(v.interet / Math.max(v.capital + v.interet, 1e-9)) * 100}%`, background: "var(--viz-2)" }} />
                  </div>
                  <span className="et">{moisFr(m).split(" ")[0]}</span>
                </div>
              ))}
            </div>
            <div className="legende">
              <span><i style={{ background: "var(--viz-1)" }} />Capital</span>
              <span><i style={{ background: "var(--viz-2)" }} />Intérêts</span>
              {horsHorizon.capital > 0 && <span>Au-delà de 12 mois : {compact(horsHorizon.capital)} {devise} de capital</span>}
            </div>
          </Carte>
          <Carte titre="À surveiller" sousTitre="Points bloquants, erreurs et alertes du jour"
            action={<Link className="btn-sec btn-mini" href="/controles">Tout voir →</Link>}>
            {ouvertes.length === 0 ? (
              <Vide>✔ Aucun point ouvert.</Vide>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ouvertes.slice(0, 6).map((c) => (
                  <Link key={c.cle} href={c.lien} style={{ display: "block", color: "inherit" }}>
                    <Badge ton={c.niveau === "alerte" ? "alerte" : "erreur"}>{LIBELLES_NIVEAU[c.niveau]}</Badge>{" "}
                    <b className="petit">{c.famille}</b>
                    <div className="petit mut" style={{ marginTop: 2 }}>{c.libelle}</div>
                  </Link>
                ))}
              </div>
            )}
          </Carte>
        </div>

        <TitreZone>Capital et intérêts</TitreZone>
        <div className="rangee deux">
          <Carte titre={`Encaissé depuis le ${dateFr(debutAnnee)}`} sousTitre={`Flux reçus jusqu'au ${dateFr(date)}, ventilés à la saisie`}
            action={<Link className="btn-sec btn-mini" href="/encaissements?vue=encaissees">Détail →</Link>}>
            <dl className="liste-def">
              <dt>Capital remboursé</dt><dd>{montant(encaisse.capital)} {devise}</dd>
              <dt>Intérêts reçus (nets)</dt><dd>{montant(encaisse.interet)} {devise}</dd>
              <dt>Total encaissé</dt><dd><b>{montant(encaisse.capital + encaisse.interet)} {devise}</b></dd>
              <dt>Nombre d&apos;encaissements</dt><dd>{encaisse.nombre}</dd>
            </dl>
          </Carte>
          <Carte titre={`Restant à recevoir au ${dateFr(date)}`} sousTitre="Échu non reçu, intérêts courus et encours en capital">
            <dl className="liste-def">
              <dt>Encours en capital</dt><dd>{montant(t?.nominal ?? 0)} {devise}</dd>
              <dt>Capital échu non reçu</dt><dd className={echuCapital > 0.01 ? "neg" : ""}>{montant(echuCapital)} {devise}</dd>
              <dt>Intérêts échus non reçus</dt><dd className={echuInteret > 0.01 ? "neg" : ""}>{montant(echuInteret)} {devise}</dd>
              <dt>ICNE (intérêts courus non échus)</dt><dd>{montant(t?.couru ?? 0)} {devise}</dd>
            </dl>
          </Carte>
        </div>

        <TitreZone>Répartition de l&apos;encours</TitreZone>
        <div className="rangee trois">
          <Carte titre="Par tranche de maturité" sousTitre="Jours restants jusqu'à l'échéance finale">
            {parTranche.length ? <Barres lignes={parTranche.map((x) => ({ nom: x.cle, valeur: x.mesures.n }))} format={compact} /> : <Vide>—</Vide>}
          </Carte>
          <Carte titre="Par pays de l'émetteur" sousTitre="8 premiers pays">
            {parPays.length ? <Barres lignes={parPays.map((x) => ({ nom: x.cle, valeur: x.mesures.n }))} format={compact} couleur="var(--viz-3)" /> : <Vide>—</Vide>}
          </Carte>
          <Carte titre="Par conservateur" sousTitre="Nominal détenu">
            {parConservateur.length ? <Barres lignes={parConservateur.map((x) => ({ nom: x.cle, valeur: x.mesures.n }))} format={compact} couleur="var(--viz-4)" /> : <Vide>—</Vide>}
          </Carte>
        </div>

        <Carte titre="Échéances des 30 prochains jours" sousTitre="Montants nets attendus (après retenue)" flush
          action={<Link className="btn-sec btn-mini" href="/encaissements">Encaissements →</Link>}>
          {prochaines.length === 0 ? (
            <Vide>Aucune échéance dans les 30 prochains jours.</Vide>
          ) : (
            <div className="tab-wrap">
              <table className="tab">
                <thead>
                  <tr><th>Date prévue</th><th>Instrument</th><th>Conservateur</th><th className="d">Capital</th><th className="d">Intérêts</th><th className="d">Net attendu</th><th>Statut</th></tr>
                </thead>
                <tbody>
                  {prochaines.slice(0, 15).map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap">{dateFr(e.dateReglementPrevue)}</td>
                      <td><Link href={`/positions/${e.positionId}`}>{e.ligne?.instrument.code}</Link> <span className="mut">{e.ligne?.instrument.libelle}</span></td>
                      <td>{e.ligne?.position.conservateur}</td>
                      <td className="d">{montant(e.capitalDu)}</td>
                      <td className="d">{montant(e.interetBrut)}</td>
                      <td className="d"><b>{montant(e.netAttendu)}</b></td>
                      <td><Badge ton={e.statut === "a_encaisser" ? "alerte" : "info"}>{LIBELLES_STATUT_ECHEANCE[e.statut]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Carte>
      </Contenu>
    </>
  );
}
