/**
 * Espace connecté : exige une session, affiche le menu latéral rangé dans l'ordre du travail.
 */
import { redirect } from "next/navigation";
import { MenuLateral, type RubriqueMenu } from "@/composants/client/Coquille";
import { lireUn } from "@/lib/db";
import { exigerSession } from "@/lib/session";
import { lireParametres } from "@/donnees/referentiels";
import { headers } from "next/headers";

export default async function EspaceLayout({ children }: { children: React.ReactNode }) {
  const s = await exigerSession();
  // Mot de passe provisoire : il faut le changer avant d'aller plus loin.
  const chemin = (await headers()).get("x-titrix-chemin") ?? "";
  if (s.u.doitChangerMdp && !chemin.startsWith("/compte")) redirect("/compte?changer=1");

  const [p, attente] = await Promise.all([
    lireParametres(),
    lireUn<{ ops: number; grv: number; ins: number }>(
      `select (select count(*)::int from operations where statut = 'soumis' and initiateur_id <> $1) as ops,
              (select count(*)::int from grevages where statut = 'soumis' and initiateur_id <> $1) as grv,
              (select count(*)::int from instruments where statut = 'a_valider' and coalesce(modifie_par, cree_par) is distinct from $1) as ins`,
      [s.u.id],
    ),
  ]);
  const v = s.peut("valider");
  const rubriques: RubriqueMenu[] = [
    {
      titre: "Pilotage",
      liens: [
        { href: "/", libelle: "Tableau de bord", icone: "tableau" },
        { href: "/analyses", libelle: "Analyses", icone: "analyses" },
      ],
    },
    {
      titre: "Portefeuille",
      liens: [
        { href: "/instruments", libelle: "Instruments", icone: "instruments", compteur: v ? attente?.ins : 0 },
        { href: "/positions", libelle: "Positions", icone: "positions" },
        { href: "/operations", libelle: "Opérations", icone: "operations", compteur: v ? attente?.ops : 0 },
        { href: "/grevages", libelle: "Grevages", icone: "grevage", compteur: v ? attente?.grv : 0 },
      ],
    },
    {
      titre: "Flux",
      liens: [
        { href: "/echeancier", libelle: "Échéancier", icone: "echeancier" },
        { href: "/encaissements", libelle: "Encaissements", icone: "encaissements" },
      ],
    },
    {
      titre: "Contrôle",
      liens: [
        { href: "/controles", libelle: "Alertes et anomalies", icone: "controles" },
        { href: "/arretes", libelle: "Arrêtés", icone: "arretes" },
        { href: "/etats", libelle: "États et exports", icone: "etats" },
      ],
    },
    {
      titre: "Administration",
      liens: [
        ...(s.peut("importer") || s.peut("valider") ? [{ href: "/import", libelle: "Import et reprise", icone: "import" as const }] : []),
        { href: "/referentiels", libelle: "Référentiels", icone: "referentiels" },
        ...(s.peut("gerer_utilisateurs") ? [{ href: "/utilisateurs", libelle: "Utilisateurs", icone: "utilisateurs" as const }] : []),
        ...(s.peut("voir_journal") ? [{ href: "/journal", libelle: "Journal et audit", icone: "journal" as const }] : []),
        { href: "/parametres", libelle: "Paramètres", icone: "parametres" },
      ],
    },
  ];
  return (
    <div className="app">
      <MenuLateral rubriques={rubriques} etablissement={p.nomEtablissement} />
      <div className="principal">{children}</div>
    </div>
  );
}
