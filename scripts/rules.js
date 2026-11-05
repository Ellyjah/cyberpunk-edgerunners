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

// ---------------------------------------------------------------- armas y ciberequipo (M5)

/** Agrupa capacidades por `stackKey` y devuelve solo las de grupos con al menos `minStack` piezas. */
export function stackSatisfied(caps) {
  const counts = new Map();
  for (const cap of caps) counts.set(cap.stackKey ?? cap.id, (counts.get(cap.stackKey ?? cap.id) ?? 0) + 1);
  return caps.filter((cap) => counts.get(cap.stackKey ?? cap.id) >= (cap.minStack ?? 1));
}

/**
 * Plan de consumo de un disparo.
 * @param {object} p
 * @param {number} p.magazine - balas en el cargador
 * @param {string} p.mode - single | aimed | autofire | suppressive
 * @param {object|null} p.perAttack - capacidad `ammo-per-attack` (o la del estado cargado)
 * @param {number|null} p.minToFire - capacidad `min-ammo-to-fire`
 * @returns {{blocked: string|null, consume: number|null, insufficientDamage: string|null}}
 *   `consume` null = consumo normal de RED.
 */
export function shotPlan({ magazine, mode, perAttack = null, minToFire = null }) {
  if (minToFire && magazine < minToFire) return { blocked: "minAmmo", consume: null, insufficientDamage: null };
  const modes = perAttack?.modes ?? ["single", "aimed"];
  if (!perAttack || !modes.includes(mode)) return { blocked: null, consume: null, insufficientDamage: null };
  if (magazine >= perAttack.count) return { blocked: null, consume: perAttack.count, insufficientDamage: null };
  const fallback = perAttack.ifInsufficient;
  if (!fallback || magazine < 1) return { blocked: "notEnoughAmmo", consume: null, insufficientDamage: null };
  return { blocked: null, consume: fallback.consumeAll === false ? 1 : magazine, insufficientDamage: fallback.damage ?? null };
}

/** Característica efectiva para una acción: la mayor entre la real y las capacidades que cubren ese ámbito. */
export function effectiveStat(base, caps, stat, scope) {
  const values = stackSatisfied(caps.filter((c) => c.stat === stat)).filter((c) => !scope || (c.scope ?? []).includes(scope)).map((c) => c.value);
  return Math.max(base, ...values);
}

/**
 * Evalúa una condición (CONTRATOS.md §6) con funciones de consulta sobre el actor.
 * @returns {{ok: boolean, unknown: boolean}}
 */
export function evaluateCondition(cond, facts, scope) {
  const res = (ok) => ({ ok: Boolean(ok), unknown: false });
  switch (cond?.type) {
    case "actorHasCapability": return res(facts.hasCapability(cond.capability));
    case "actorHasTag": return res(facts.hasTag(cond.tag));
    case "actorHasCyberwareType": return res(facts.hasCyberwareType(cond.cyberwareType, cond.foundational));
    case "statAtLeast": return res(facts.stat(cond.stat, cond.scope ?? scope) >= cond.value);
    case "roleRankAtLeast": return res(facts.roleRank(cond.role) >= cond.rank);
    case "targetUnaware": return facts.targetUnaware === undefined ? { ok: false, unknown: true } : res(facts.targetUnaware);
    case "connected": return res(facts.connected(cond.mode ?? "any"));
    case "anyOf": {
      const parts = (cond.conditions ?? []).map((c) => evaluateCondition(c, facts, scope));
      return { ok: parts.some((p) => p.ok), unknown: !parts.some((p) => p.ok) && parts.some((p) => p.unknown) };
    }
    case "allOf": {
      const parts = (cond.conditions ?? []).map((c) => evaluateCondition(c, facts, scope));
      return { ok: parts.every((p) => p.ok), unknown: parts.some((p) => p.unknown) };
    }
    default: return { ok: false, unknown: true };
  }
}

/** ¿Permite el segundo intento? Solo si falló (no superó la VD; el empate falla) por un margen no mayor que `maxMargin`. */
export function retryAllowed(result, dv, maxMargin) {
  return result <= dv && dv - result <= maxMargin;
}

/** Daño desarmado de RED según TCO (con ciberbrazo fundacional, el desarmado con TCO ≤ 4 hace 2d6). */
export function unarmedDamage(body, { martialArts = false, cyberArm = false } = {}) {
  if (body <= 4) return !martialArts && cyberArm ? "2d6" : "1d6";
  if (body <= 6) return "2d6";
  if (body <= 10) return "3d6";
  return "4d6";
}

/** Porcentaje de CP ignorado por RED a partir de un multiplicador de CP (0.5 → 50). */
export function ignoreArmorFromMultiplier(multiplier, current = 0) {
  if (typeof multiplier !== "number" || multiplier < 0 || multiplier >= 1) return current;
  return Math.max(current, Math.round((1 - multiplier) * 100));
}

/** Recámara que dispara: la activa si está cargada; si no, la primera cargada; -1 si ninguna. */
export function firingChamber(chambers, active = 0) {
  if (chambers[active]) return active;
  return chambers.findIndex(Boolean);
}

/** Modo de disparo a partir del nombre de la clase de tirada de RED. */
export function attackMode(className) {
  return { CPRAimedAttackRoll: "aimed", CPRAutofireRoll: "autofire", CPRSuppressiveFireRoll: "suppressive", CPRAttackRoll: "single" }[className] ?? null;
}

// ---------------------------------------------------------------- Humanidad, roles y economía (M6)

// Categorías de precio de RED (precio de mercado de referencia de cada una).
export const PRICE_TIERS = [["free", 0], ["dirtCheap", 5], ["cheap", 10], ["everyday", 20], ["costly", 50], ["premium", 100], ["expensive", 500], ["veryExpensive", 1000], ["luxury", 5000], ["superLuxury", 10000]];
const tierIndex = (key) => PRICE_TIERS.findIndex(([k]) => k === key);

/** Categoría de un precio: la más alta cuyo precio de referencia no supera el precio dado. */
export function priceCategory(market) {
  let found = PRICE_TIERS[0][0];
  for (const [key, min] of PRICE_TIERS) if (market >= min) found = key;
  return found;
}

/** ¿Es la categoría `a` igual o superior a `b`? */
export const categoryAtLeast = (a, b) => tierIndex(a) >= tierIndex(b);

/**
 * Aptitudes de rol que permiten conseguir un artículo de uno en uno aunque no esté disponible.
 * @param {object[]} rules - [{ ability, rank, maxCategory?, types?, note? }]
 * @param {object[]} roles - [{ ability, rank }] del comprador
 * @param {object} item - { category, kind } (kind = "tipo" o "tipo:subtipo")
 */
export function acquisitionMatches(rules, roles, item) {
  return rules.filter((r) => {
    const role = roles.find((x) => slugAbility(x.ability) === slugAbility(r.ability));
    if (!role || role.rank < r.rank) return false;
    if (r.types && !r.types.some((t) => t === item.kind || t === item.kind.split(":")[0])) return false;
    if (r.maxCategory && !categoryAtLeast(r.maxCategory, item.category)) return false;
    return true;
  });
}
const slugAbility = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Precio de compra en una tienda con recargo (redondeado al eurodólar). */
export function buyPrice(market, multiplier) {
  const m = Number(multiplier);
  return Number.isFinite(m) && m > 0 ? Math.round(market * m) : market;
}

/**
 * Evaluación mensual de Humanidad: fórmulas de pérdida y ganancia según los efectos ambientales.
 * @param {object} counts - { loss: [n1d6, n2d6, n3d6], gain: [n1d6, n2d6], goodLife: bool|undefined }
 * Sin indicar goodLife, se concede la ganancia de 3d6 si hay 4 o más efectos de ganancia y menos de 3 de pérdida.
 */
export function monthlyHumanity({ loss = [0, 0, 0], gain = [0, 0], goodLife } = {}) {
  const dice = (counts) => counts.map((n, i) => (n > 0 ? `${n * (i + 1)}d6` : null)).filter(Boolean).join(" + ");
  const lossCount = loss.reduce((a, b) => a + b, 0);
  const gainCount = gain.reduce((a, b) => a + b, 0);
  const good = goodLife ?? (gainCount >= 4 && lossCount < 3);
  const gainFormula = [dice(gain), good ? "3d6" : null].filter(Boolean).join(" + ");
  return { loss: dice(loss) || null, gain: gainFormula || null, goodLife: good, lossCount, gainCount };
}

/** Tirada enfrentada contra una VD: hay que superarla (el empate lo gana la VD). */
export const beatsDv = (total, dv) => total > dv;
