/**
 * Détail d'un arrêté : photographie figée, comparaison avec la situation recalculée aujourd'hui
 * à la même date (détection des opérations rétrodatées), verrouillage / réouverture.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonAction } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Historique } from "@/composants/Historique";
import { StatutArrete } from "@/composants/Statuts";
import { Carte, EnTeteImpression, Indicateur, Message, Vide } from "@/composants/ui";
import { changerStatutArrete } from "@/app/actions/arretes";
import type { Photographie } from "@/donnees/arretes";
import { analyser } from "@/donnees/portefeuille";
import { lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { compact, dateFr, dateHeureFr, montant } from "@/lib/format";

export default async function FicheArrete(props: PageProps<"/arretes/[id]">) {
  const s = await exigerSession();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const a = await lireUn<{ id: string; date_arrete: string; statut: string; resultat: Photographie; motif_reouverture: string | null; rouvert_par: string | null; rouvert_le: string | null }>(
    "select a.id, a.date_arrete, a.statut, a.resultat, a.motif_reouverture, u.nom as rouvert_par, a.rouvert_le from arretes a left join utilisateurs u on u.id = a.rouvert_par where a.id = $1",
    [id],
  );
  if (!a) notFound();
  const r = a.resultat;
  // Situation recalculée aujourd'hui à la même date : un écart révèle une opération rétrodatée.
  const actuel = await analyser(s, a.date_arrete);
  const ecarts = r.lignes
    .map((l) => {
      const x = actuel.situation.lignes.find((y) => y.position.id === l.positionId);
      return { l, nominalActuel: x?.nominal ?? 0, ecart: (x?.nominal ?? 0) - l.nominal };
    })
    .filter((e) => Math.abs(e.ecart) > 0.01);
  const nouvelles = actuel.situation.lignes.filter((x) => x.nominal !== 0 && !r.lignes.some((l) => l.positionId === x.position.id));

  return (
    <>
      <EnTete titre={`Arrêté du ${dateFr(a.date_arrete)}`} sousTitre={<><StatutArrete s={a.statut} /> · calculé le {dateHeureFr(r.calculeLe)} · {r.versionMoteur}</>} />
      <Contenu>
        <EnTeteImpression titre={`Situation à la date d'arrêté du ${dateFr(a.date_arrete)}`} sousTitre={`${actuel.parametres.nomEtablissement} · arrêté ${a.statut} · moteur ${r.versionMoteur}`} />
        <p className="petit noprint"><Link href="/arretes">← Tous les arrêtés</Link> · <a href={`/exports/situation?arrete=${id}`}>Exporter en Excel</a></p>
        {a.statut === "rouvert" && <Message ton="alerte">Rouvert par {a.rouvert_par} le {dateHeureFr(a.rouvert_le)} : {a.motif_reouverture}. Recalculez-le (écran Arrêtés) puis verrouillez-le.</Message>}
        {ecarts.length > 0 || nouvelles.length > 0 ? (
          <Message ton="erreur">
            {ecarts.length + nouvelles.length} position(s) diffèrent entre la photographie et la situation recalculée aujourd&apos;hui à la même date : des opérations rétrodatées ont été validées depuis.
            {a.statut === "verrouille" ? " L'arrêté verrouillé reste inchangé (aucune modification silencieuse)." : " Recalculez l'arrêté pour les intégrer."}
          </Message>
        ) : (
          <Message ton="bon">La photographie concorde avec la situation recalculée aujourd&apos;hui à la même date.</Message>
        )}
        <div className="grid-kpi">
          {r.totaux.slice(0, 2).map((t) => (
            <Indicateur key={t.devise} libelle={`Encours nominal ${t.devise}`} valeur={compact(t.nominal)} unite={t.devise} icone="positions" detail={`Couru ${compact(t.couru)} · grevé ${compact(t.greve)}`} />
          ))}
          <Indicateur libelle="Positions" valeur={r.lignes.length} icone="instruments" detail={`${new Set(r.lignes.map((l) => l.code)).size} instrument(s)`} />
          <Indicateur libelle="Contrôles à la date" valeur={r.controles.bloquant + r.controles.erreur} icone="controles" ton={r.controles.bloquant ? "erreur" : "alerte"} detail={`${r.controles.bloquant} bloquant(s), ${r.controles.alerte} alerte(s)`} />
        </div>
        <div className="actions noprint" style={{ marginBottom: 16 }}>
          {a.statut !== "verrouille" && s.peut("verrouiller_arrete") && (
            <BoutonAction action={changerStatutArrete} champs={{ id, statut: "verrouille" }} libelle="Verrouiller l'arrêté" classe="btn btn-mini" confirmation="Verrouiller ? La photographie sera figée et les opérations antérieures bloquées." />
          )}
          {a.statut === "verrouille" && s.peut("rouvrir_arrete") && (
            <BoutonAction action={changerStatutArrete} champs={{ id, statut: "rouvert" }} libelle="Rouvrir (procédure de réouverture)" classe="btn-danger btn-mini" motif="Motif de la réouverture (journalisé) :" />
          )}
        </div>
        {ecarts.length > 0 && (
          <Carte titre="Écarts avec la situation recalculée" flush>
            <table className="tab">
              <thead><tr><th>Instrument</th><th>Conservateur</th><th className="d">Nominal figé</th><th className="d">Nominal recalculé</th><th className="d">Écart</th></tr></thead>
              <tbody>
                {ecarts.map((e) => (
                  <tr key={e.l.positionId}><td>{e.l.code}</td><td>{e.l.conservateur}</td><td className="d">{montant(e.l.nominal)}</td><td className="d">{montant(e.nominalActuel)}</td><td className="d neg">{montant(e.ecart)}</td></tr>
                ))}
              </tbody>
            </table>
          </Carte>
        )}
        <Carte titre="Inventaire figé" sousTitre="Montants dans la devise de chaque instrument" flush>
          {r.lignes.length === 0 ? <Vide>Aucune position.</Vide> : (
            <div className="tab-wrap">
              <table className="tab">
                <thead><tr><th>Instrument</th><th>Portefeuille</th><th>Conservateur</th><th>Échéance</th><th className="d">Nominal</th><th className="d">Échu</th><th className="d">Couru</th><th className="d">Grevé</th><th className="d">Disponible</th><th>Tranche</th><th>Devise</th></tr></thead>
                <tbody>
                  {r.lignes.map((l) => (
                    <tr key={l.positionId}>
                      <td><b>{l.code}</b><div className="petit mut">{l.libelle}</div></td>
                      <td>{l.portefeuille}</td><td>{l.conservateur}</td><td className="nowrap">{dateFr(l.dateEcheance)}</td>
                      <td className="d">{montant(l.nominal)}</td><td className="d">{montant(l.echu)}</td><td className="d">{montant(l.couru)}</td>
                      <td className="d">{montant(l.greve)}</td><td className="d">{montant(l.disponible)}</td><td className="petit">{l.tranche}</td><td>{l.devise}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {r.totaux.map((t) => (
                    <tr key={t.devise}><td colSpan={4}>Total {t.devise}</td><td className="d">{montant(t.nominal)}</td><td className="d">{montant(t.echu)}</td><td className="d">{montant(t.couru)}</td><td className="d">{montant(t.greve)}</td><td className="d">{montant(t.disponible)}</td><td colSpan={2}>{t.devise}</td></tr>
                  ))}
                </tfoot>
              </table>
            </div>
          )}
        </Carte>
        <Historique table="arretes" id={id} />
      </Contenu>
    </>
  );
}
