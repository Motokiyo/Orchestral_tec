// Crochet de chargement Node : remplace `import.meta.env` (propre à Vite) par un
// objet fixe quand on importe src/useStorage.js hors du navigateur. Aucun autre
// changement : le code testé est celui du dépôt, pas une copie.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.includes("/src/useStorage.js")) return result;
  const source = String(result.source).replace(
    /import\.meta\.env/g,
    '({ VITE_OWNER_EMAIL: "owner@test.invalid" })',
  );
  return { ...result, source, shortCircuit: true };
}
