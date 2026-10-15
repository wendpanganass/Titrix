/**
 * Fiche instrument : caractéristiques, validation, échéancier contractuel, échéancier officiel,
 * classifications historisées, positions détenues, historique.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { ChampsInstrument } from "@/composants/FormInstrument";
import { Historique } from "@/composants/Historique";
import { StatutInstrument } from "@/composants/Statuts";
import { Badge, Carte, Champ, Message, Vide } from "@/composants/ui";
import { ajouterClassification, enregistrerEcheancierOfficiel, modifierInstrument, validerInstrument, validerEcheancierOfficiel } from "@/app/actions/instruments";
import { lire, lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, dateHeureFr, montant, pourcent } from "@/lib/format";
import { listesReferentiels, lireParametres } from "@/donnees/referentiels";
import { SQL_INSTRUMENTS, versInstrumentDonnees } from "@/donnees/portefeuille";
import { caracteristiquesManquantes, echeancesPosition, LIBELLES_CONVENTION, LIBELLES_FREQUENCE, LIBELLES_PROFIL } from "@/moteur";

const NOMINAL_EXEMPLE = 1_000_000;

export default async function FicheInstrument(props: PageProps<"/instruments/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const i = await lireUn<Record<string, unknown> & {
    id: string; code_interne: string; isin: string | null; libelle: string; statut: string; version: number; devise_code: string;
    taux_coupon: number; taux_retenue: number; convention: string; frequence: number; profil: string; precompte: boolean;
    date_emission: string | null; date_echeance: string | null; nominal_unitaire: number | null; differe_mois: number;
    emetteur: string | null; pays_code: string | null; type_libelle: string | null; zone: string; conditions_remboursement: string;
    echeancier_officiel_valide: boolean; motif_rejet: string | null; auteur: string | null; validateur: string | null; valide_le: string | null;
    cree_par: string | null; modifie_par: string | null;
  }>(
    `select i.*, e.nom as emetteur, t.libelle as type_libelle, coalesce(um.nom, uc.nom) as auteur, uv.nom as validateur
       from instruments i left join emetteurs e on e.id = i.emetteur_id left join types_instrument t on t.code = i.type_code
       left join utilisateurs uc on uc.id = i.cree_par left join utilisateurs um on um.id = i.modifie_par
       left join utilisateurs uv on uv.id = i.valide_par where i.id = $1`,
    [id],
  );
  if (!i) notFound();
  const [r, p, officiel, classes, positions, brut] = await Promise.all([
    listesReferentiels(),
    lireParametres(),
    lire<{ date_echeance: string; part_capital: number; source: string; importe_par: string | null; importe_le: string }>(
      "select o.date_echeance, o.part_capital, o.source, u.nom as importe_par, o.importe_le from echeancier_officiel o left join utilisateurs u on u.id = o.importe_par where instrument_id = $1 order by date_echeance",
      [id],
    ),
    lire<{ id: string; referentiel: string; valeur: string; date_effet: string; source: string; saisi_par: string | null; position: string | null }>(
      `select c.id, c.referentiel, c.valeur, c.date_effet, c.source, u.nom as saisi_par, cs.nom || ' · ' || f.code as position
         from classifications c left join utilisateurs u on u.id = c.saisi_par left join positions p on p.id = c.position_id
         left join conservateurs cs on cs.id = p.conservateur_id left join portefeuilles f on f.id = p.portefeuille_id
        where c.instrument_id = $1 order by c.referentiel, c.date_effet desc`,
      [id],
    ),
    lire<{ id: string; portefeuille: string; conservateur: string; compte_conservation: string; nominal_actuel: number; statut: string }>(
      `select p.id, f.libelle as portefeuille, c.nom as conservateur, p.compte_conservation, p.nominal_actuel, p.statut
         from positions p join portefeuilles f on f.id = p.portefeuille_id join conservateurs c on c.id = p.conservateur_id
        where p.instrument_id = $1 and (cardinality($2::uuid[]) = 0 or p.portefeuille_id = any($2::uuid[])) order by c.nom`,
      [id, s.u.portefeuilles],
    ),
    lireUn(`${SQL_INSTRUMENTS} where i.id = $1`, [id]),
  ]);
  const officielLignes = officiel.map((o) => ({ date: o.date_echeance, partCapital: o.part_capital }));
  const calc = versInstrumentDonnees(brut as Parameters<typeof versInstrumentDonnees>[0], officielLignes);
  const manque = caracteristiquesManquantes(calc);
  // Échéancier contractuel illustré pour un nominal de 1 000 000 détenu depuis l'émission.
  const exemple = echeancesPosition(
    calc,
    calc.dateEmission
      ? [{ id: "x", type: "acquisition", statut: "valide", dateEffet: calc.dateEmission, nominal: NOMINAL_EXEMPLE, quantite: null, positionId: "x", positionDestinationId: null }]
      : [],
    "x",
    { officiel: calc.officiel },
  );
  const auteur = i.modifie_par ?? i.cree_par;
  const peutValider = s.peut("valider") && i.statut !== "valide" && auteur !== s.u.id;

  return (
    <>
      <EnTete titre={`${i.code_interne} — ${i.libelle}`} sousTitre={<>Instrument · <StatutInstrument s={i.statut} /> · version {i.version}</>} />
      <Contenu>
        <p className="petit noprint"><Link href="/instruments">← Tous les instruments</Link></p>
        {i.statut === "a_valider" && (
          <Message ton="alerte">
            Caractéristiques en attente de validation (saisies par {i.auteur ?? "—"}). Les projections sont provisoires tant qu&apos;elles ne sont pas approuvées.
            {peutValider && (
              <div className="actions" style={{ marginTop: 10 }}>
                <BoutonAction action={validerInstrument} champs={{ id, decision: "valide" }} libelle="Valider les caractéristiques" classe="btn btn-mini" confirmation="Confirmez-vous avoir contrôlé les caractéristiques contractuelles ?" />
                <BoutonAction action={validerInstrument} champs={{ id, decision: "rejete" }} libelle="Rejeter" classe="btn-danger btn-mini" motif="Motif du rejet :" />
              </div>
            )}
            {s.peut("valider") && auteur === s.u.id && <div className="petit" style={{ marginTop: 6 }}>Vous êtes l&apos;auteur de cette version : une autre personne doit la valider.</div>}
          </Message>
        )}
        {i.statut === "rejete" && <Message ton="erreur">Rejeté : {i.motif_rejet}. Corrigez les caractéristiques pour le soumettre à nouveau.</Message>}
        {manque.length > 0 && <Message ton="erreur">Caractéristiques manquantes : {manque.join(", ")}. Aucun échéancier ne peut être calculé.</Message>}

        <div className="rangee deux">
          <Carte titre="Caractéristiques">
            <dl className="liste-def">
              <dt>Code ISIN</dt><dd>{i.isin ?? "—"}</dd>
              <dt>Émetteur</dt><dd>{i.emetteur ?? "—"} {i.pays_code && `(${i.pays_code})`} {i.zone && `· ${i.zone}`}</dd>
              <dt>Type</dt><dd>{i.type_libelle ?? "—"}</dd>
              <dt>Devise · nominal unitaire</dt><dd>{i.devise_code} · {montant(i.nominal_unitaire, 2)}</dd>
              <dt>Émission → échéance</dt><dd>{dateFr(i.date_emission)} → {dateFr(i.date_echeance)}</dd>
              <dt>Coupon</dt><dd>{i.precompte ? "Intérêts précomptés (aucun coupon)" : `${pourcent(i.taux_coupon, 4)} · ${LIBELLES_FREQUENCE[i.frequence]}`}</dd>
              <dt>Convention</dt><dd>{LIBELLES_CONVENTION[i.convention as keyof typeof LIBELLES_CONVENTION]}</dd>
              <dt>Amortissement</dt><dd>{LIBELLES_PROFIL[i.profil as keyof typeof LIBELLES_PROFIL]}{i.differe_mois > 0 && ` · différé de ${i.differe_mois} mois`}</dd>
              <dt>Retenue à la source</dt><dd>{pourcent(i.taux_retenue, 2)}</dd>
              <dt>Conditions</dt><dd>{i.conditions_remboursement || "—"}</dd>
              <dt>Validation</dt><dd>{i.validateur ? `${i.validateur}, le ${dateHeureFr(i.valide_le)}` : "—"}</dd>
            </dl>
          </Carte>
          <Carte titre="Positions détenues" sousTitre="Un même instrument peut être détenu chez plusieurs conservateurs" flush
            action={s.peut("saisir_operation") ? <Link className="btn-sec btn-mini" href={`/positions?instrument=${id}`}>+ Position</Link> : null}>
            {positions.length === 0 ? <Vide>Aucune position.</Vide> : (
              <table className="tab">
                <thead><tr><th>Portefeuille</th><th>Conservateur</th><th>Compte</th><th className="d">Nominal</th></tr></thead>
                <tbody>
                  {positions.map((x) => (
                    <tr key={x.id}>
                      <td><Link href={`/positions/${x.id}`}>{x.portefeuille}</Link></td>
                      <td>{x.conservateur}</td>
                      <td>{x.compte_conservation || "—"}</td>
                      <td className="d">{montant(x.nominal_actuel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Carte>
        </div>

        <Carte
          titre="Échéancier contractuel"
          sousTitre={`${exemple.echeances[0]?.source === "officiel" ? "Échéancier officiel validé (il fait foi)" : "Généré à partir des caractéristiques"} · illustré pour ${montant(NOMINAL_EXEMPLE)} ${i.devise_code} détenus depuis l'émission`}
          flush
        >
          {exemple.echeances.length === 0 ? (
            <Vide>{exemple.erreurs.join(" ") || "Renseignez la date d'émission pour illustrer l'échéancier."}</Vide>
          ) : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Période</th><th>Date de paiement</th><th>Règlement prévu</th><th className="d">Capital restant dû</th><th className="d">Capital</th><th className="d">Intérêts bruts</th><th className="d">Retenue</th><th className="d">Net</th></tr></thead>
                <tbody>
                  {exemple.echeances.map((e) => (
                    <tr key={e.dateContractuelle}>
                      <td className="nowrap petit">{dateFr(e.debutPeriode)} → {dateFr(e.finPeriode)}</td>
                      <td className="nowrap">{dateFr(e.dateContractuelle)}</td>
                      <td className="nowrap">{dateFr(e.dateReglementPrevue)}</td>
                      <td className="d">{montant(e.crdDebut, 2)}</td>
                      <td className="d">{montant(e.capitalDu, 2)}</td>
                      <td className="d">{montant(e.interetBrut, 2)}</td>
                      <td className="d">{montant(e.retenue, 2)}</td>
                      <td className="d"><b>{montant(e.netAttendu, 2)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Total</td>
                    <td className="d">{montant(exemple.echeances.reduce((t, e) => t + e.capitalDu, 0), 2)}</td>
                    <td className="d">{montant(exemple.echeances.reduce((t, e) => t + e.interetBrut, 0), 2)}</td>
                    <td className="d">{montant(exemple.echeances.reduce((t, e) => t + e.retenue, 0), 2)}</td>
                    <td className="d">{montant(exemple.echeances.reduce((t, e) => t + e.netAttendu, 0), 2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Carte>

        <div className="rangee deux">
          <Carte titre="Échéancier officiel" sousTitre="S'il est validé, il a priorité sur l'échéancier généré">
            {officiel.length > 0 ? (
              <>
                <p className="petit">
                  {officiel.length} échéance(s) · importé par {officiel[0].importe_par ?? "—"} le {dateHeureFr(officiel[0].importe_le)} ·{" "}
                  {i.echeancier_officiel_valide ? <Badge ton="bon">Validé</Badge> : <Badge ton="alerte">À valider</Badge>}
                </p>
                {!i.echeancier_officiel_valide && s.peut("valider") && (
                  <BoutonAction action={validerEcheancierOfficiel} champs={{ id }} libelle="Valider l'échéancier officiel" classe="btn btn-mini" confirmation="Valider cet échéancier officiel ? Il fera foi pour toutes les projections." />
                )}
              </>
            ) : (
              <p className="petit mut">Aucun échéancier officiel : l&apos;échéancier est généré à partir des caractéristiques.</p>
            )}
            {s.peut("gerer_instruments") && (
              <details className="depliant" style={{ marginTop: 12 }}>
                <summary>{officiel.length ? "Remplacer" : "Saisir"} l&apos;échéancier officiel</summary>
                <Formulaire action={enregistrerEcheancierOfficiel} bouton="Enregistrer">
                  <input type="hidden" name="id" value={id} />
                  <Champ libelle="Une ligne par échéance : date;part du capital remboursée en %" aide="Ex. 2027-03-15;20 (ou 15/03/2027;20). Somme = 100 %. Laisser vide pour retirer l'échéancier officiel.">
                    <textarea className="champ" name="lignes" rows={6} defaultValue={officiel.map((o) => `${o.date_echeance};${(o.part_capital * 100).toString().replace(".", ",")}`).join("\n")} />
                  </Champ>
                  <div style={{ marginTop: 10 }}>
                    <Champ libelle="Source (document d'émission, note d'information…)"><input className="champ" name="source" defaultValue={officiel[0]?.source ?? ""} /></Champ>
                  </div>
                </Formulaire>
              </details>
            )}
          </Carte>
          <Carte titre="Classifications et notations" sousTitre="Historisées : la valeur applicable est la dernière date d'effet ≤ date d'arrêté" flush>
            {classes.length === 0 ? <Vide>Aucune classification.</Vide> : (
              <table className="tab">
                <thead><tr><th>Référentiel</th><th>Valeur</th><th>Date d&apos;effet</th><th>Portée</th><th>Source</th></tr></thead>
                <tbody>
                  {classes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.referentiel === "comptable" ? "Comptable" : c.referentiel === "notation" ? "Notation" : "Autre"}</td>
                      <td><b>{c.valeur}</b></td>
                      <td className="nowrap">{dateFr(c.date_effet)}</td>
                      <td className="petit">{c.position ?? "Instrument"}</td>
                      <td className="petit">{c.source || "—"}{c.saisi_par && <div className="mut">{c.saisi_par}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {s.peut("gerer_instruments") && (
              <div style={{ padding: "12px 20px 20px" }}>
                <details className="depliant">
                  <summary>Ajouter une classification</summary>
                  <Formulaire action={ajouterClassification} bouton="Ajouter" reinitialiser>
                    <input type="hidden" name="id" value={id} />
                    <div className="form-grille">
                      <Champ libelle="Référentiel" obligatoire>
                        <select className="champ" name="referentiel"><option value="comptable">Classification comptable</option><option value="notation">Notation</option><option value="autre">Autre</option></select>
                      </Champ>
                      <Champ libelle="Valeur" obligatoire><input className="champ" name="valeur" placeholder="Coût amorti, JVOCI, BBB+…" required /></Champ>
                      <Champ libelle="Date d'effet" obligatoire><input className="champ" type="date" name="date_effet" required /></Champ>
                      <Champ libelle="Portée">
                        <select className="champ" name="position_id"><option value="">Tout l&apos;instrument</option>{positions.map((x) => <option key={x.id} value={x.id}>{x.portefeuille} · {x.conservateur}</option>)}</select>
                      </Champ>
                      <Champ libelle="Source" className="plein"><input className="champ" name="source" /></Champ>
                    </div>
                  </Formulaire>
                </details>
              </div>
            )}
          </Carte>
        </div>

        {s.peut("gerer_instruments") && (
          <Carte titre="Modifier les caractéristiques" sousTitre="Toute modification recalcule les échéanciers et remet l'instrument en attente de validation">
            <details className="depliant">
              <summary>Ouvrir le formulaire</summary>
              <div style={{ paddingTop: 14 }}>
                <Formulaire action={modifierInstrument} bouton="Enregistrer les modifications" confirmation="Enregistrer ? L'instrument devra être validé à nouveau.">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="version" value={i.version} />
                  <ChampsInstrument r={r} v={i} conventionDefaut={p.conventionDefaut} deviseDefaut={p.deviseReference} />
                </Formulaire>
              </div>
            </details>
          </Carte>
        )}
        <Historique table="instruments" id={id} />
      </Contenu>
    </>
  );
}
