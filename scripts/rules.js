/**
 * Reglas de netrunning 2070 como funciones puras (sin Foundry), para probarlas con Node.
 * Los valores concretos (VD, alcances) llegan como parámetros desde los ajustes o los Items.
 */

/** Acciones NET por turno según el rango de Interface (progresión completa de RED). */
export function netActionsForRank(rank) {
  if (rank >= 10) return 5;
  if (rank >= 7) return 4;
  if (rank >= 4) return 3;
  if (rank >= 1) return 2;
  return 0;
}

/** "6,8,10" → [6, 8, 10]. Ignora valores no numéricos. */
export function parseDvList(text) {
  return String(text ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter(Number.isFinite);
}

/**
 * Pisos de la arquitectura personal de un neuropuerto (estructura propia del módulo).
 * Barreras por Hielo personal (todas con la VD según el número instalado), hielo negro
 * del ciberterminal conectado y nodo de control al final.
 */
export function neuroArchitecture({ selfIce = 0, blackIce = [], barrierDvs = [6, 8, 10], maxSelfIce = 3, nodeDv = 10 }) {
  const count = Math.min(selfIce, maxSelfIce, barrierDvs.length || maxSelfIce);
  const dv = barrierDvs[Math.max(0, count - 1)] ?? null;
  const floors = [];
  for (let i = 0; i < count; i++) floors.push({ kind: "barrier", dv });
  for (const name of blackIce) floors.push({ kind: "blackice", name });
  floors.push({ kind: "node", dv: nodeDv });
  return floors;
}

/**
 * Tirada de 1d10 con críticos de RED: un 10 suma otro d10; un 1 resta otro d10.
 * @param {number[]} dice - resultados de d10 ya tirados (se usan los que hagan falta)
 */
export function redD10(dice) {
  const [first, second] = dice;
  if (first === 10) return { total: 10 + second, crit: "success", used: 2 };
  if (first === 1) return { total: 1 - second, crit: "fumble", used: 2 };
  return { total: first, crit: null, used: 1 };
}

/** En una tirada enfrentada de RED el empate favorece al defensor. */
export function attackerWins(attackTotal, defenseTotal) {
  return attackTotal > defenseTotal;
}

/** ¿Tiene que tirar contra el cortafuegos? Desde cierto rango se supera sin tirar. */
export function firewallRequired(rank, autoRank) {
  return rank < autoRank;
}

/**
 * Motivo por el que no se puede intentar un hackeo rápido, o null si se puede.
 * @param {object} p
 * @param {object|undefined} p.connection - conexión con el objetivo
 * @param {number} p.floors - número de pisos de la arquitectura del objetivo
 * @param {boolean} p.alreadyTried - ya se intentó un hackeo contra este objetivo en este turno
 * @param {object} p.hack - capacidad quickhack
 * @param {number} p.rank - rango de Interface del netrunner
 */
export function quickhackBlocked({ connection, floors, alreadyTried, hack, rank }) {
  if (!connection) return "notConnected";
  if (rank < hack.minRank) return "rankTooLow";
  if ((connection.floor ?? 0) < floors - 1) return "floorsRemaining";
  if (alreadyTried) return "alreadyTried";
  if (hack.requiresUnaware && connection.alerted) return "targetAware";
  return null;
}

/** Clave única del turno actual de combate (para contadores que se reinician solos). */
export function turnKey(combat) {
  return combat ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

/** Acciones NET extra por capacidades `net-actions` que cumplen su condición. */
export function netActionBonus(caps, { cable }) {
  const groups = new Map();
  for (const cap of caps) {
    const when = cap.when?.connection;
    if (when === "cable" && !cable) continue;
    const key = cap.stackKey ?? cap.id;
    const g = groups.get(key) ?? { count: 0, bonus: cap.bonus, minStack: cap.minStack ?? 1 };
    g.count += 1;
    groups.set(key, g);
  }
  let total = 0;
  for (const g of groups.values()) if (g.count >= g.minStack) total += g.bonus;
  return total;
}
