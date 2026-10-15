/**
 * Moteur financier de Titrix — point d'entrée.
 * Le moteur est indépendant de l'interface et de la base : il reçoit des données, rend un résultat.
 * Toute règle de calcul se change en trois temps : décision écrite → tests mis à jour → moteur modifié.
 * Aucun changement n'est accepté si `npm test` n'est pas au vert.
 */
export * from "./01_dates";
export * from "./02_echeancier";
export * from "./03_position";
export * from "./04_encaissements";
export * from "./05_indicateurs";
export * from "./06_portefeuille";
export * from "./07_controles";
