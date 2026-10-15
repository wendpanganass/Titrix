import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageConnexion } from "@/composants/PageConnexion";
import { FormInstallation } from "@/composants/client/FormConnexion";
import { installationPossible } from "@/app/actions/connexion";

export const metadata: Metadata = { title: "Installation" };
// Toujours calculée à la demande : dépend de l'état de la base.
export const dynamic = "force-dynamic";

/** Écran disponible uniquement tant qu'aucun compte n'existe (premier lancement). */
export default async function Installation() {
  if (!(await installationPossible())) redirect("/connexion");
  return (
    <PageConnexion titre="Installation" sousTitre="Créez le premier compte administrateur. Cet écran disparaît ensuite.">
      <FormInstallation />
    </PageConnexion>
  );
}
