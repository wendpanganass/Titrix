import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageConnexion } from "@/composants/PageConnexion";
import { FormConnexion } from "@/composants/client/FormConnexion";
import { installationPossible } from "@/app/actions/connexion";
import { sessionCourante } from "@/lib/session";

export const metadata: Metadata = { title: "Connexion" };

export default async function Connexion() {
  if (await installationPossible()) redirect("/installation");
  if (await sessionCourante().catch(() => null)) redirect("/");
  return (
    <PageConnexion titre="Connexion" sousTitre="Accédez à l'espace de gestion des titres.">
      <FormConnexion />
      <p className="oubli">Mot de passe oublié ? Demandez à un administrateur de Titrix de le réinitialiser.</p>
    </PageConnexion>
  );
}
