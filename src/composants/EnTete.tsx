/**
 * En-tête de page : titre + sous-titre à gauche ; à droite, éléments propres à la page
 * (date d'arrêté…), imprimer, mode sombre, menu du compte.
 */
import type { ReactNode } from "react";
import { deconnecter } from "@/app/actions/connexion";
import { ROLES, type Role } from "@/lib/droits";
import { sessionCourante } from "@/lib/session";
import { BoutonImprimer, BoutonTheme, MenuUtilisateur } from "./client/Coquille";

export async function EnTete({ titre, sousTitre, droite }: { titre: string; sousTitre?: ReactNode; droite?: ReactNode }) {
  const s = await sessionCourante();
  return (
    <header className="entete">
      <div className="entete-in">
        <div className="ptitle">
          <h1>{titre}</h1>
          {sousTitre && <small>{sousTitre}</small>}
        </div>
        {droite}
        <BoutonImprimer />
        <BoutonTheme />
        {s && (
          <MenuUtilisateur
            nom={s.u.nom}
            email={s.u.email}
            roles={s.u.roles.map((r) => ROLES[r as Role] ?? r).join(" · ")}
            deconnexion={deconnecter}
          />
        )}
      </div>
    </header>
  );
}

/** Corps de page standard. */
export function Contenu({ children }: { children: ReactNode }) {
  return <main className="content">{children}</main>;
}
