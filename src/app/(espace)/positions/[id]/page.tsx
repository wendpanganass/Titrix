/**
 * Fiche position : situation à la date, opérations, échéancier et encaissements, grevages, relevé du conservateur.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { SelecteurDate } from "@/composants/client/Coquille";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { ChampsOperation } from "@/composants/FormOperation";
import { Historique } from "@/composants/Historique";
import { StatutEcheanceBadge, StatutGrevage, StatutOperation } from "@/composants/Statuts";
import { Badge, Carte, Champ, Indicateur, Message, TitreZone, Vide } from "@/composants/ui";
import { creerOperation } from "@/app/actions/operations";
import { bloquerPosition, enregistrerReleve, recalculerPosition } from "@/app/actions/positions";
import { analyser } from "@/donnees/portefeuille";
import { lire, lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, montant } from "@/lib/format";
import { LIBELLES_OPERATION, statutEcheance, type TypeOperation } from "@/moteur";

export default async function FichePosition(props: PageProps<"/positions/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  const q = await props.searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await lireUn<{
    id: string; instrument_id: string; code: string; libelle: string; devise: string; portefeuille: string; portefeuille_id: string;
    conservateur: string; compte_conservation: string; identifiant_position: string; statut: string; nominal_actuel: number;
    nominal_releve: number | null; date_releve: string | null; instrument_statut: string;
  }>(
    `select p.*, i.code_interne as code, i.libelle, i.devise_code as devise, i.statut as instrument_statut, f.libelle as portefeuille, c.nom as conservateur
       from positions p join instruments i on i.id = p.instrument_id join portefeuilles f on f.id = p.portefeuille_id
       join conservateurs c on c.id = p.conservateur_id where p.id = $1`,
    [id],
  );
  if (!p || (s.u.portefeuilles.length && !s.u.portefeuilles.includes(p.portefeuille_id))) notFound();
  const [a, operations, echeances, grevages, contreparties, destinations] = await Promise.all([
    analyser(s, typeof q.date === "string" ? q.date : null),
    lire<{ id: string; numero: number; type: TypeOperation; date_effet: string; nominal: number; statut: string; position_id: string; position_destination_id: string | null; initiateur: string | null; reference: string }>(
      `select o.id, o.numero, o.type, o.date_effet, o.nominal, o.statut, o.position_id, o.position_destination_id, u.nom as initiateur, o.reference
         from operations o left join utilisateurs u on u.id = o.initiateur_id
        where o.position_id = $1 or o.position_destination_id = $1 order by o.date_effet desc, o.numero desc`,
      [id],
    ),
    lire<{ id: string; date_contractuelle: string; date_reglement_prevue: string; crd_debut: number; capital_du: number; interet_brut: number; retenue: number; net_attendu: number; statut_manuel: "litige" | "annulee" | "remplacee" | null; recu: number; capital_recu: number; interet_recu: number; source: string; version_moteur: string }>(
      `select e.*, coalesce(x.recu, 0) as recu, coalesce(x.capital, 0) as capital_recu, coalesce(x.interet, 0) as interet_recu
         from echeances e
         left join (select echeance_id, sum(montant) as recu, sum(montant_capital) as capital, sum(montant_interet) as interet
                      from encaissements where statut = 'actif' group by echeance_id) x on x.echeance_id = e.id
        where e.position_id = $1 order by e.date_contractuelle`,
      [id],
    ),
    lire<{ id: string; beneficiaire: string; nominal_affecte: number; valeur_retenue: number | null; financement_obtenu: number | null; date_debut: string; date_fin: string | null; statut: string }>(
      "select g.*, b.nom as beneficiaire from grevages g join contreparties b on b.id = g.beneficiaire_id where g.position_id = $1 order by g.date_debut desc",
      [id],
    ),
    lire<{ id: string; nom: string }>("select id, nom from contreparties where actif order by nom"),
    lire<{ id: string; libelle: string }>(
      `select p.id, c.nom || ' · ' || f.libelle || coalesce(' · ' || nullif(p.compte_conservation, ''), '') as libelle
         from positions p join conservateurs c on c.id = p.conservateur_id join portefeuilles f on f.id = p.portefeuille_id
        where p.instrument_id = $1 and p.id <> $2`,
      [p.instrument_id, id],
    ),
  ]);
  const l = a.situation.lignes.find((x) => x.position.id === id);
  const tol = a.parametres.toleranceEncaissement;
  const dev = p.devise;
  const futures = echeances.filter((e) => e.date_contractuelle > a.date);

  return (
    <>
      <EnTete
        titre={`${p.code} · ${p.conservateur}`}
        sousTitre={<>{p.libelle} · {p.portefeuille}{p.compte_conservation && ` · compte ${p.compte_conservation}`} · <Badge ton={p.statut === "active" ? "bon" : p.statut === "bloquee" ? "erreur" : "gris"}>{p.statut === "active" ? "Active" : p.statut === "bloquee" ? "Bloquée" : "Soldée"}</Badge></>}
        droite={<SelecteurDate date={a.date} />}
      />
      <Contenu>
        <p className="petit noprint"><Link href="/positions">← Toutes les positions</Link> · <Link href={`/instruments/${p.instrument_id}`}>Fiche de l&apos;instrument</Link></p>
        {p.instrument_statut !== "valide" && <Message ton="alerte">Les caractéristiques de l&apos;instrument ne sont pas validées : l&apos;échéancier est provisoire.</Message>}
        {l?.erreurs.map((e) => <Message key={e} ton="erreur">{e}</Message>)}
        <div className="grid-kpi">
          <Indicateur libelle="Nominal détenu" valeur={compact(l?.nominal ?? 0)} unite={dev} icone="positions" detail={`Quantité ${montant(l?.quantite ?? 0, 0)} titre(s)`} />
          <Indicateur libelle="Capital restant dû contractuel" valeur={compact(l?.capitalContractuel ?? 0)} unite={dev} icone="echeancier"
            detail={l && l.capitalEchuNonRembourse > 0 ? `Échu non remboursé : ${montant(l.capitalEchuNonRembourse)}` : "Aucun capital échu en attente"} ton={l && l.capitalEchuNonRembourse > 0 ? "erreur" : "info"} />
          <Indicateur libelle="ICNE (coupon couru)" valeur={compact(l?.couponCouru ?? 0)} unite={dev} icone="monnaie" ton="bon" detail={`Au ${dateFr(a.date)}`} />
          <Indicateur libelle="Nominal disponible" valeur={compact(l?.nominalDisponible ?? 0)} unite={dev} icone="grevage" ton={(l?.nominalDisponible ?? 0) < 0 ? "erreur" : "alerte"} detail={`Grevé ${montant(l?.nominalGreve ?? 0)}`} />
        </div>

        <Carte titre="Opérations" sousTitre="Seules les opérations validées ou réglées modifient la position" flush
          action={<Link className="btn-sec btn-mini" href={`/operations?position=${id}`}>Toutes →</Link>}>
          {operations.length === 0 ? <Vide>Aucune opération : saisissez l&apos;acquisition ou la position d&apos;ouverture ci-dessous.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>N°</th><th>Type</th><th>Date d&apos;effet</th><th className="d">Nominal</th><th>Initiateur</th><th>Référence</th><th>Statut</th></tr></thead>
                <tbody>
                  {operations.map((o) => {
                    const sens = o.type === "transfert" ? (o.position_destination_id === id ? "+" : "−") : ["position_ouverture", "acquisition"].includes(o.type) ? "+" : "−";
                    return (
                      <tr key={o.id} className={o.statut === "annule" ? "annule" : ""}>
                        <td><Link href={`/operations/${o.id}`}>{o.numero}</Link></td>
                        <td>{LIBELLES_OPERATION[o.type]}{o.type === "transfert" && (o.position_destination_id === id ? " (entrant)" : " (sortant)")}</td>
                        <td className="nowrap">{dateFr(o.date_effet)}</td>
                        <td className={`d ${sens === "+" ? "pos" : "neg"}`}>{sens} {montant(o.nominal)}</td>
                        <td>{o.initiateur ?? "—"}</td>
                        <td className="petit">{o.reference || "—"}</td>
                        <td><StatutOperation s={o.statut} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Carte>

        <Carte titre="Échéancier de la position" sousTitre={`${echeances.length} échéance(s) enregistrée(s) · ${futures.length} à venir après le ${dateFr(a.date)} · projection depuis l'encours détenu`} flush
          action={s.peut("saisir_operation") ? <BoutonAction action={recalculerPosition} champs={{ id }} libelle="Recalculer" /> : null}>
          {echeances.length === 0 ? <Vide>Aucune échéance (position sans opération validée ou caractéristiques incomplètes).</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Date contractuelle</th><th>Règlement prévu</th><th className="d">CRD début</th><th className="d">Capital</th><th className="d">Intérêts</th><th className="d">Retenue</th><th className="d">Net attendu</th><th className="d">Capital reçu</th><th className="d">Intérêts reçus</th><th>Statut</th></tr></thead>
                <tbody>
                  {echeances.map((e) => {
                    const st = statutEcheance({ dateReglementPrevue: e.date_reglement_prevue, netAttendu: e.net_attendu, statutManuel: e.statut_manuel, montantRecu: e.recu }, a.aujourdhui, tol);
                    return (
                      <tr key={e.id} className={st === "remplacee" || st === "annulee" ? "annule" : ""}>
                        <td className="nowrap">{dateFr(e.date_contractuelle)}</td>
                        <td className="nowrap">{dateFr(e.date_reglement_prevue)}</td>
                        <td className="d">{montant(e.crd_debut)}</td>
                        <td className="d">{montant(e.capital_du)}</td>
                        <td className="d">{montant(e.interet_brut)}</td>
                        <td className="d">{montant(e.retenue)}</td>
                        <td className="d"><b>{montant(e.net_attendu)}</b></td>
                        <td className="d">{montant(e.capital_recu)}</td>
                        <td className="d">{montant(e.interet_recu)}</td>
                        <td><Link href={`/encaissements?echeance=${e.id}`}><StatutEcheanceBadge s={st} /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total à venir après le {dateFr(a.date)}</td>
                    <td className="d">{montant(futures.reduce((t, e) => t + e.capital_du, 0))}</td>
                    <td className="d">{montant(futures.reduce((t, e) => t + e.interet_brut, 0))}</td>
                    <td className="d">{montant(futures.reduce((t, e) => t + e.retenue, 0))}</td>
                    <td className="d">{montant(futures.reduce((t, e) => t + e.net_attendu, 0))}</td>
                    <td colSpan={3}></td>
                  </tr>
                  <tr>
                    <td colSpan={7}>Total encaissé (toutes dates)</td>
                    <td className="d">{montant(echeances.reduce((t, e) => t + e.capital_recu, 0))}</td>
                    <td className="d">{montant(echeances.reduce((t, e) => t + e.interet_recu, 0))}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="petit mut" style={{ padding: "10px 20px 16px", margin: 0 }}>
            Contrôle : capital futur ({montant(futures.reduce((t, e) => t + e.capital_du, 0))}) + capital échu non remboursé ({montant(l?.capitalEchuNonRembourse ?? 0)}) = nominal détenu ({montant(l?.nominal ?? 0)}) {dev}
            {" "}{Math.abs(futures.reduce((t, e) => t + e.capital_du, 0) + (l?.capitalEchuNonRembourse ?? 0) - (l?.nominal ?? 0)) < 1 ? "✔" : "✖ écart à expliquer"}.
          </p>
        </Carte>

        <div className="rangee deux">
          <Carte titre="Grevages" sousTitre="Affectations en garantie de cette position" flush
            action={s.peut("grever") ? <Link className="btn-sec btn-mini" href={`/grevages?position=${id}`}>+ Grevage</Link> : null}>
            {grevages.length === 0 ? <Vide>Aucun grevage.</Vide> : (
              <table className="tab">
                <thead><tr><th>Bénéficiaire</th><th className="d">Nominal affecté</th><th>Période</th><th>Statut</th></tr></thead>
                <tbody>
                  {grevages.map((g) => (
                    <tr key={g.id}>
                      <td><Link href={`/grevages/${g.id}`}>{g.beneficiaire}</Link></td>
                      <td className="d">{montant(g.nominal_affecte)}</td>
                      <td className="nowrap petit">{dateFr(g.date_debut)} → {g.date_fin ? dateFr(g.date_fin) : "…"}</td>
                      <td><StatutGrevage s={g.statut} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Carte>
          <Carte titre="Rapprochement avec le conservateur" sousTitre="Nominal figurant sur le dernier relevé reçu">
            <dl className="liste-def" style={{ marginBottom: 14 }}>
              <dt>Relevé du conservateur</dt><dd>{p.nominal_releve === null ? "—" : `${montant(p.nominal_releve)} ${dev} au ${dateFr(p.date_releve)}`}</dd>
              <dt>Nominal Titrix (toutes opérations validées)</dt><dd>{montant(p.nominal_actuel)} {dev}</dd>
              <dt>Écart</dt><dd className={p.nominal_releve !== null && Math.abs(p.nominal_releve - p.nominal_actuel) > 0.01 ? "neg" : ""}>{p.nominal_releve === null ? "—" : montant(p.nominal_releve - p.nominal_actuel)}</dd>
            </dl>
            {s.peut("rapprocher") && (
              <Formulaire action={enregistrerReleve} bouton="Enregistrer le relevé">
                <input type="hidden" name="id" value={id} />
                <div className="form-grille">
                  <Champ libelle="Nominal du relevé"><input className="champ" name="nominal_releve" inputMode="decimal" defaultValue={p.nominal_releve ?? ""} /></Champ>
                  <Champ libelle="Date du relevé"><input className="champ" type="date" name="date_releve" defaultValue={p.date_releve ?? ""} /></Champ>
                </div>
              </Formulaire>
            )}
            {s.peut("valider") && (
              <div style={{ marginTop: 12 }}>
                {p.statut === "bloquee" ? (
                  <BoutonAction action={bloquerPosition} champs={{ id, bloquer: "0" }} libelle="Débloquer la position" motif="Motif du déblocage :" />
                ) : (
                  <BoutonAction action={bloquerPosition} champs={{ id, bloquer: "1" }} libelle="Bloquer la position" classe="btn-danger btn-mini" motif="Motif du blocage :" />
                )}
              </div>
            )}
          </Carte>
        </div>

        {s.peut("saisir_operation") && (
          <>
            <TitreZone>Saisir une opération sur cette position</TitreZone>
            <Carte titre="Nouvelle opération" sousTitre="Enregistrez en brouillon ou soumettez directement : un validateur (autre que vous) l'approuvera.">
              <Formulaire action={creerOperation} bouton="Enregistrer" reinitialiser>
                <input type="hidden" name="position_id" value={id} />
                <ChampsOperation
                  contreparties={contreparties}
                  destinations={destinations}
                  echeances={echeances.filter((e) => e.capital_du > 0).map((e) => ({ id: e.id, libelle: `${dateFr(e.date_contractuelle)} · capital ${montant(e.capital_du)}` }))}
                  annulees={operations.filter((o) => o.statut === "annule").map((o) => ({ id: o.id, libelle: `N° ${o.numero} · ${LIBELLES_OPERATION[o.type]} · ${montant(o.nominal)}` }))}
                />
                <label className="case" style={{ marginTop: 10 }}><input type="checkbox" name="soumettre" value="1" defaultChecked /> Soumettre directement à validation</label>
              </Formulaire>
            </Carte>
          </>
        )}
        <Historique table="positions" id={id} />
      </Contenu>
    </>
  );
}
