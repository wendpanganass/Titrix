/**
 * Proxy (anciennement « middleware ») : renvoie vers /connexion toute page demandée sans cookie de session.
 * La validité réelle de la session est vérifiée côté serveur (session.ts) à chaque page.
 */
import { NextResponse, type NextRequest } from "next/server";

const PUBLIQUES = ["/connexion", "/installation"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIQUES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("titrix_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Le chemin est transmis aux pages (utile pour imposer le changement de mot de passe).
  const h = new Headers(req.headers);
  h.set("x-titrix-chemin", pathname);
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|woff2?)$).*)"],
};
