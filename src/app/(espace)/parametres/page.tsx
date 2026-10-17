/**
 * Paramètres généraux : seuils d'alerte, tolérances, devise de référence, limites, sessions.
 */
import { Formulaire } from "@/composants/client/Formulaire";
import { Contenu, EnTete } from "@/composants/EnTete";
import { Carte, Champ, Message } from "@/composants/ui";
import { enregistrerParametres, recalculerTout } from "@/app/actions/referentiels";
import { chargerDemonstration } from "@/app/actions/demonstration";
import { lireUn } from "@/lib/db";
import { lireParametres, listesReferentiels } from "@/donnees/referentiels";
import { exigerSession } from "@/lib/session";
import { CONVENTIONS, LIBELLES_CONVENTION, VERSION_MOTEUR } from "@/moteur";

export default async function Parametres() {
  const s = await exigerSession();
  const [p, r, nb] = await Promise.all([
    lireParametres(),
    listesReferentiels(),
    lireUn<{ n: number; demo: boolean }>(
      "select (select count(*)::int from instruments) as n, exists (select 1 from utilisateurs where email = 'validateur.demo@titrix.demo') as demo",
    ),
  ]);
  const tout = s.peut("gerer_referentiels");
  const limites = s.peut("parametrer");
  const v = (k: string) => p.brut[k]?.valeur ?? "";
  return (
    <>
      <EnTete titre="Paramètres" sousTitre={`Réglages généraux · moteur de calcul ${VERSION_MOTEUR}`} />
      <Contenu>
        {!limites && <Message ton="info">Consultation seule : les paramètres sont modifiés par l&apos;administrateur (et les seuils par les risques).</Message>}
        <Carte titre="Alertes et contrôles" sousTitre="Seuils et tolérances utilisés par les contrôles automatiques">
          <Formulaire action={enregistrerParametres} bouton={limites ? "Enregistrer" : null}>
            <div className="form-grille quatre">
              <Champ libelle="Seuils d'alerte d'échéance (jours)" aide={p.brut.seuils_alerte_echeance?.description}><input className="champ" name="seuils_alerte_echeance" defaultValue={v("seuils_alerte_echeance")} disabled={!limites} /></Champ>
              <Champ libelle="Tolérance d'encaissement (jours)" aide={p.brut.tolerance_encaissement?.description}><input className="champ" name="tolerance_encaissement" defaultValue={v("tolerance_encaissement")} disabled={!limites} /></Champ>
              <Champ libelle="Limite de concentration par émetteur (%)" aide="Vide = contrôle désactivé"><input className="champ" name="limite_concentration" defaultValue={v("limite_concentration")} disabled={!limites} /></Champ>
              {tout && (
                <>
                  <Champ libelle="Devise de référence">
                    <select className="champ" name="devise_reference" defaultValue={v("devise_reference")}>{r.devises.map((d) => <option key={d.code}>{d.code}</option>)}</select>
                  </Champ>
                  <Champ libelle="Horizon de l'échéancier (mois)"><input className="champ" name="horizon_projection_mois" defaultValue={v("horizon_projection_mois")} /></Champ>
                  <Champ libelle="Convention proposée par défaut" aide="Chaque instrument porte sa propre convention, qui prévaut">
                    <select className="champ" name="convention_defaut" defaultValue={v("convention_defaut")}>{CONVENTIONS.map((c) => <option key={c} value={c}>{LIBELLES_CONVENTION[c]}</option>)}</select>
                  </Champ>
                  <Champ libelle="Durée d'une session (heures)"><input className="champ" name="duree_session_heures" defaultValue={v("duree_session_heures")} /></Champ>
                  <Champ libelle="Nom de l'établissement" aide="Affiché dans le menu et sur les états"><input className="champ" name="nom_etablissement" defaultValue={v("nom_etablissement")} /></Champ>
                </>
              )}
            </div>
          </Formulaire>
        </Carte>
        {tout && (nb?.n === 0 || nb?.demo) && (
          <Carte titre="Données de démonstration" sousTitre="Jeu entièrement fictif (« Banque Démo », États et sociétés « Démo ») pour présenter Titrix">
            <Formulaire action={chargerDemonstration} bouton="Charger les données de démonstration" confirmation="Charger le jeu de démonstration fictif ? À faire uniquement sur une base de présentation, avant toute donnée réelle.">
              <p className="petit mut" style={{ margin: 0 }}>
                8 instruments, 10 positions chez 3 conservateurs, opérations validées à quatre yeux, échéanciers calculés, encaissements,
                grevages, un arrêté verrouillé et quelques anomalies volontaires (coupon en retard, titre échu non remboursé, écart
                d&apos;encaissement, écart de relevé). Deux comptes fictifs sont créés : « Gestionnaire Démo » et « Validateur Démo ».
                Disponible seulement tant qu&apos;aucun instrument n&apos;existe.
                {nb?.demo && " La démonstration est chargée : connectez-vous avec les comptes fictifs pour la présenter."}
              </p>
            </Formulaire>
          </Carte>
        )}
        {tout && (
          <Carte titre="Maintenance" sousTitre="Recalcule les échéances de toutes les positions (après une évolution du moteur ou des jours fériés)">
            <Formulaire action={recalculerTout} bouton="Recalculer toutes les échéances" boutonClasse="btn-sec" confirmation="Recalculer toutes les échéances ? Les échéances encaissées sont conservées.">
              <p className="petit mut" style={{ margin: 0 }}>Les échéances déjà encaissées ne sont jamais effacées ; celles qui ne sont plus dues passent « remplacées ».</p>
            </Formulaire>
          </Carte>
        )}
      </Contenu>
    </>
  );
}
