/** Parche de propiedad de Foundry que sustituye la instantánea completa sin tocar otros flags. */
export function ownershipPatch(current, original, players = [], owner = 3) {
  if (!original || typeof original !== "object") throw new Error("Missing original device ownership");
  const result = { ...original };
  for (const id of Object.keys(current)) {
    if (!Object.hasOwn(original, id)) result[`-=${id}`] = null;
  }
  for (const id of players) {
    delete result[`-=${id}`];
    result[id] = owner;
  }
  return result;
}
