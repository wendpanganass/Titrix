/**
 * Fiche opération : détail, circuit de validation, pièces justificatives, historique complet.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonAction, Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { ChampsOperation } from "@/composants/FormOperation";
import { Historique } from "@/composants/Historique";
import { Pieces } from "@/composants/Pieces";
import { StatutOperation } from "@/composants/Statuts";
import { Carte, Champ, Message } from "@/composants/ui";
import { changerStatutOperation, modifierOperation, supprimerBrouillon } from "@/app/actions/operations";
import { lire, lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { dateFr, dateHeureFr, montant } from "@/lib/format";
import { LIBELLES_OPERATION, type TypeOperation } from "@/moteur";

export default async function FicheOperation(props: PageProps<"/operations/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const o = await lireUn<{
    id: string; numero: number; type: TypeOperation; statut: string; version: number; position_id: string; position_destination_id: string | null;
    date_effet: string; date_negociation: string | null; date_reglement: string | null; quantite: number | null; nominal: number; prix: number | null;
    unite_cotation: string; coupon_couru: number; frais: number; montant_regle: number | null; contrepartie_id: string | null; contrepartie: string | null;
    echeance_id: string | null; reference: string; commentaire: string; initiateur_id: string; initiateur: string | null; cree_le: string; soumis_le: string | null;
    validateur: string | null; valide_le: string | null; motif_rejet: string | null; regle_par_nom: string | null; regle_le: string | null;
    annule_par_nom: string | null; annule_le: string | null; motif_annulation: string | null; impact_retroactif: string | null;
    operation_annulee_id: string | null; code: string; libelle: string; devise: string; conservateur: string; portefeuille: string;
    destination: string | null; instrument_id: string; portefeuille_id: string; corrigee_numero: number | null;
  }>(
    `select o.*, ct.nom as contrepartie, ui.nom as initiateur, uv.nom as validateur, ur.nom as regle_par_nom, ua.nom as annule_par_nom,
            i.code_interne as code, i.libelle, i.devise_code as devise, c.nom as conservateur, f.libelle as portefeuille, p.instrument_id,
            p.portefeuille_id, cd.nom as destination, oc.numero as corrigee_numero
       from operations o join positions p on p.id = o.position_id join instruments i on i.id = p.instrument_id
       join conservateurs c on c.id = p.conservateur_id join portefeuilles f on f.id = p.portefeuille_id
       left join positions pd on pd.id = o.position_destination_id left join conservateurs cd on cd.id = pd.conservateur_id
       left join contreparties ct on ct.id = o.contrepartie_id left join utilisateurs ui on ui.id = o.initiateur_id
       left join utilisateurs uv on uv.id = o.validateur_id left join utilisateurs ur on ur.id = o.regle_par
       left join utilisateurs ua on ua.id = o.annule_par left join operations oc on oc.id = o.operation_annulee_id
      where o.id = $1`,
    [id],
  );
  if (!o || (s.u.portefeuilles.length && !s.u.portefeuilles.includes(o.portefeuille_id))) notFound();
  const [correctives, contreparties, destinations] = await Promise.all([
    lire<{ id: string; numero: number; statut: string }>("select id, numero, statut from operations where operation_annulee_id = $1", [id]),
    lire<{ id: string; nom: string }>("select id, nom from contreparties where actif order by nom"),
    lire<{ id: string; libelle: string }>(
      `select p.id, c.nom || ' · ' || f.libelle as libelle from positions p join conservateurs c on c.id = p.conservateur_id
         join portefeuilles f on f.id = p.portefeuille_id where p.instrument_id = $1 and p.id <> $2`,
      [o.instrument_id, o.position_id],
    ),
  ]);
  const estInitiateur = o.initiateur_id === s.u.id;
  const champs = { id };

  return (
    <>
      <EnTete titre={`Opération n° ${o.numero} — ${LIBELLES_OPERATION[o.type]}`} sousTitre={<>{o.code} · {o.conservateur}{o.destination && ` → ${o.destination}`} · <StatutOperation s={o.statut} /></>} />
      <Contenu>
        <p className="petit noprint"><Link href="/operations">← Toutes les opérations</Link> · <Link href={`/positions/${o.position_id}`}>Position</Link></p>
        {o.impact_retroactif && <Message ton="alerte">{o.impact_retroactif}</Message>}
        {o.statut === "rejete" && <Message ton="erreur">Rejetée par {o.validateur} le {dateHeureFr(o.valide_le)} : {o.motif_rejet}</Message>}
        {o.statut === "annule" && (
          <Message ton="info">
            Annulée par {o.annule_par_nom} le {dateHeureFr(o.annule_le)} : {o.motif_annulation}.{" "}
            {correctives.length ? <>Opération(s) corrective(s) : {correctives.map((c) => <Link key={c.id} href={`/operations/${c.id}`}>n° {c.numero} </Link>)}</> : "Aucune opération corrective saisie."}
          </Message>
        )}
        {o.corrigee_numero && <Message ton="info">Cette opération corrige l&apos;opération annulée <Link href={`/operations/${o.operation_annulee_id}`}>n° {o.corrigee_numero}</Link>.</Message>}

        <div className="rangee deux">
          <Carte titre="Détail">
            <dl className="liste-def">
              <dt>Instrument</dt><dd><Link href={`/instruments/${o.instrument_id}`}>{o.code}</Link> — {o.libelle}</dd>
              <dt>Position</dt><dd>{o.portefeuille} · {o.conservateur}{o.destination && ` → ${o.destination}`}</dd>
              <dt>Date d&apos;effet</dt><dd>{dateFr(o.date_effet)}</dd>
              <dt>Négociation · règlement</dt><dd>{dateFr(o.date_negociation)} · {dateFr(o.date_reglement)}</dd>
              <dt>Nominal</dt><dd><b>{montant(o.nominal, 2)} {o.devise}</b></dd>
              <dt>Quantité</dt><dd>{o.quantite === null ? "—" : montant(o.quantite, 0)}</dd>
              <dt>Prix</dt><dd>{o.prix === null ? "—" : `${montant(o.prix, 4)} ${o.unite_cotation === "pourcentage" ? "% du pair" : o.devise + " par titre"}`}</dd>
              <dt>Coupon couru · frais</dt><dd>{montant(o.coupon_couru, 2)} · {montant(o.frais, 2)}</dd>
              <dt>Montant réglé</dt><dd>{o.montant_regle === null ? "—" : montant(o.montant_regle, 2)}</dd>
              <dt>Contrepartie</dt><dd>{o.contrepartie ?? "—"}</dd>
              <dt>Référence</dt><dd>{o.reference || "—"}</dd>
              <dt>Commentaire</dt><dd>{o.commentaire || "—"}</dd>
            </dl>
          </Carte>
          <Carte titre="Circuit de validation">
            <dl className="liste-def">
              <dt>Saisie</dt><dd>{o.initiateur ?? "—"}, {dateHeureFr(o.cree_le)}</dd>
              <dt>Soumission</dt><dd>{o.soumis_le ? dateHeureFr(o.soumis_le) : "—"}</dd>
              <dt>Validation / rejet</dt><dd>{o.validateur ? `${o.validateur}, ${dateHeureFr(o.valide_le)}` : "—"}</dd>
              <dt>Règlement constaté</dt><dd>{o.regle_par_nom ? `${o.regle_par_nom}, ${dateHeureFr(o.regle_le)}` : "—"}</dd>
              <dt>Annulation</dt><dd>{o.annule_par_nom ? `${o.annule_par_nom}, ${dateHeureFr(o.annule_le)}` : "—"}</dd>
            </dl>
            <div className="actions noprint" style={{ marginTop: 18 }}>
              {o.statut === "brouillon" && estInitiateur && <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "soumis" }} libelle="Soumettre à validation" classe="btn btn-mini" />}
              {o.statut === "brouillon" && estInitiateur && <BoutonAction action={supprimerBrouillon} champs={champs} libelle="Supprimer le brouillon" classe="btn-danger btn-mini" confirmation="Supprimer ce brouillon ?" />}
              {o.statut === "soumis" && s.peut("valider") && !estInitiateur && (
                <>
                  <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "valide" }} libelle="Valider" classe="btn btn-mini" confirmation="Valider cette opération ? Elle modifiera la position." />
                  <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "rejete" }} libelle="Rejeter" classe="btn-danger btn-mini" motif="Motif du rejet :" />
                </>
              )}
              {o.statut === "soumis" && estInitiateur && <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "brouillon" }} libelle="Reprendre en brouillon" />}
              {o.statut === "rejete" && estInitiateur && <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "brouillon" }} libelle="Corriger (repasser en brouillon)" />}
              {(o.statut === "valide" || o.statut === "regle") && s.peut("valider") && !estInitiateur && (
                <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "annule" }} libelle="Annuler l'opération" classe="btn-danger btn-mini" motif="Motif de l'annulation (l'opération reste visible, barrée) :" />
              )}
              {["brouillon", "soumis", "rejete"].includes(o.statut) && (estInitiateur || s.peut("valider")) && (
                <BoutonAction action={changerStatutOperation} champs={{ ...champs, statut: "annule" }} libelle="Abandonner" motif="Motif de l'abandon :" />
              )}
            </div>
            {o.statut === "soumis" && estInitiateur && <p className="petit mut">Vous êtes l&apos;initiateur : la validation doit être faite par une autre personne.</p>}
            {o.statut === "valide" && s.peut("regler") && (
              <div style={{ marginTop: 16 }}>
                <Formulaire action={changerStatutOperation} bouton="Constater le règlement" boutonClasse="btn-sec">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="statut" value="regle" />
                  <div className="form-grille">
                    <Champ libelle="Date de règlement effective" obligatoire><input className="champ" type="date" name="date_reglement" defaultValue={o.date_reglement ?? ""} required /></Champ>
                    <Champ libelle="Montant réglé"><input className="champ" name="montant_regle" inputMode="decimal" defaultValue={o.montant_regle ?? ""} /></Champ>
                  </div>
                </Formulaire>
              </div>
            )}
          </Carte>
        </div>

        {o.statut === "brouillon" && estInitiateur && (
          <Carte titre="Modifier le brouillon">
            <Formulaire action={modifierOperation}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="version" value={o.version} />
              <input type="hidden" name="position_id" value={o.position_id} />
              <ChampsOperation v={o} contreparties={contreparties} destinations={destinations} />
            </Formulaire>
          </Carte>
        )}
        <Pieces objet="operation" id={id} />
        <Historique table="operations" id={id} />
      </Contenu>
    </>
  );
}
