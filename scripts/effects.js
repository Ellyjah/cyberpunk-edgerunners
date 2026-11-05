/**
 * Motor de operaciones (CONTRATOS.md §5) y estado temporal.
 * Todo lo que modifica a otro actor se ejecuta en el cliente del DJ activo.
 */
import { MODULE_ID, getCapabilities } from "./schema.js";
import { turnKey } from "./rules.js";

const RED_ID = "cyberpunk-red-core";
export const L = (key, data) => (data ? game.i18n.format(`EDGERUNNERS2070.${key}`, data) : game.i18n.localize(`EDGERUNNERS2070.${key}`));
export const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));

// ---------------------------------------------------------------- DJ remoto

const HANDLERS = {};
export const registerHandler = (name, fn) => { HANDLERS[name] = fn; };
const isActiveGM = () => game.user === game.users.activeGM;

/** Ejecuta un manejador en el cliente del DJ activo (localmente si este cliente lo es). */
export async function gmExec(name, data) {
  if (isActiveGM()) return HANDLERS[name](data);
  if (!game.users.activeGM) return ui.notifications.error(L("net.noGM"));
  game.socket.emit(`module.${MODULE_ID}`, { name, data });
}

export function listenSocket() {
  game.socket.on(`module.${MODULE_ID}`, ({ name, data }) => {
    if (isActiveGM() && HANDLERS[name]) HANDLERS[name](data);
  });
}

// ---------------------------------------------------------------- utilidades

/** Actor a partir de un uuid de Actor o de Token (actores sintéticos incluidos). */
export function resolveActor(uuid) {
  const doc = fromUuidSync(uuid);
  return doc?.documentName === "Token" ? doc.actor : doc;
}

/** Capacidades activas de los Items instalados (ciberequipo) o equipados (ciberterminal, equipo). Un implante suspendido no aporta nada. */
export function actorCapabilities(actor, type) {
  return actor.items
    .filter((i) => (i.type === "cyberware" ? i.system.isInstalled && !isSuspended(i) : ["cyberdeck", "gear"].includes(i.type) ? i.system.equipped === "equipped" : false))
    .flatMap((item) => getCapabilities(item).filter((c) => c.type === type).map((c) => ({ ...c, item })));
}

const ownersOf = (actor) => game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);

export function chat(actor, content, { rolls = [], whisper } = {}) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="er2070-chat">${content}</div>`, rolls, whisper });
}

/** Contador del turno actual del combatiente (se reinicia solo al cambiar de turno). */
export function getTurn(combatant) {
  const key = turnKey(game.combat);
  const t = combatant?.getFlag(MODULE_ID, "turn");
  return t?.key === key ? t : { key, used: 0, extra: 0, targets: [] };
}
registerHandler("setTurn", async ({ combatantId, turn }) => game.combat?.combatants.get(combatantId)?.setFlag(MODULE_ID, "turn", turn));
export const saveTurn = (combatant, turn) =>
  combatant.isOwner ? combatant.setFlag(MODULE_ID, "turn", turn) : gmExec("setTurn", { combatantId: combatant.id, turn });
// Si la ficha abierta es la del actor del mundo y su token no está vinculado, se usa el combatiente de ese actor base.
export const combatantOf = (actor) =>
  game.combat?.combatants.find((c) => c.actor === actor) ?? (actor.isToken ? undefined : game.combat?.combatants.find((c) => c.actorId === actor.id));
/** Mismo personaje: idéntico, o actor del mundo frente a uno de sus tokens. */
export const sameActor = (a, b) => Boolean(a && b) && (a === b || (a.id === b.id && (!a.isToken || !b.isToken)));

// ---------------------------------------------------------------- portadores de efectos temporales

/** Convierte una duración del contrato en duración de ActiveEffect + datos de caducidad propios. */
function toDuration(duration, target) {
  if (!duration) return { aeDuration: {}, extra: {} };
  if (duration.rounds) {
    const inCombat = game.combat?.started && combatantOf(target);
    return { aeDuration: inCombat ? { rounds: duration.rounds } : { seconds: duration.rounds * 3 }, extra: {} };
  }
  if (duration.hours) return { aeDuration: { seconds: duration.hours * 3600 }, extra: {} };
  if (duration.untilEndOfTurn) return { aeDuration: {}, extra: { untilEndOfTurn: duration.untilEndOfTurn } };
  return { aeDuration: {}, extra: {} };
}

/** Crea el ActiveEffect que representa una operación temporal sobre el objetivo. */
export async function createCarrier(target, ctx, { changes = [], duration, timed = {}, img = "icons/svg/daze.svg" }) {
  const { aeDuration, extra } = toDuration(duration, target);
  const cats = {};
  const situational = {};
  changes.forEach((c, i) => {
    cats[i] = c.key.startsWith("system.stats.") ? "stat" : "misc";
    situational[i] = { isSituational: false, onByDefault: false };
  });
  // Se crea con la API de documento: el createEmbeddedDocuments de RED trata cualquier documento
  // como un Item arrastrado a la hoja de PNJ y falla con los ActiveEffects.
  const effect = await CONFIG.ActiveEffect.documentClass.create({
    name: ctx.label,
    img,
    origin: ctx.sourceUuid,
    duration: aeDuration,
    changes,
    flags: {
      [RED_ID]: { changes: { cats, situational } },
      [MODULE_ID]: { timed: { source: ctx.sourceUuid, sourceActor: ctx.sourceActorUuid, ...extra, ...timed } },
    },
  }, { parent: target });
  return effect;
}

/** Funciones de otros archivos que actúan al caducar un portador: (actor, effect, timed) => Promise. */
export const expireHandlers = [];

// Foundry lanza a la vez updateCombat y updateWorldTime al cambiar de asalto: evita retirar dos veces.
const expiring = new Set();

/** Retira un portador y todo lo que creó (Items temporales, estados, suspensiones). */
export async function expireCarrier(effect) {
  const actor = effect.parent;
  if (!actor?.effects.has(effect.id) || !ownsEffect(actor, effect.id) || expiring.has(effect.uuid)) return;
  expiring.add(effect.uuid);
  try {
    const timed = effect.flags[MODULE_ID]?.timed ?? {};
    const steps = [];
    const items = (timed.createdItems ?? []).filter((id) => actor.items.has(id));
    if (items.length) steps.push(() => actor.deleteEmbeddedDocuments("Item", items));
    for (const status of timed.statuses ?? []) steps.push(() => actor.toggleStatusEffect(status, { active: false }));
    for (const id of timed.suspended ?? []) {
      const item = actor.items.get(id);
      if (item) steps.push(() => item.setFlag(MODULE_ID, "suspendedBy", (item.getFlag(MODULE_ID, "suspendedBy") ?? []).filter((e) => e !== effect.id)));
    }
    // Operaciones diferidas (`on-expire`): se aplican al caducar, no si alguien retira el efecto a mano.
    if (timed.onExpire?.operations?.length) {
      steps.push(() => applyOperations({ targetUuid: actor.uuid, sourceUuid: timed.source, sourceActorUuid: timed.sourceActor, label: effect.name, operations: timed.onExpire.operations }));
    }
    for (const handler of expireHandlers) steps.push(() => handler(actor, effect, timed));
    // Al terminar una activación empieza su enfriamiento.
    if (timed.activation?.cooldown) {
      steps.push(() => createCarrier(actor, { label: L("gear.cooldownName", { name: timed.activation.name }), sourceUuid: timed.source },
        { duration: timed.activation.cooldown, timed: { cooldown: { itemId: timed.activation.itemId } }, img: "icons/svg/clockwork.svg" }));
    }
    // Un paso que falle no debe impedir retirar el efecto.
    for (const step of steps) {
      try { await step(); } catch (err) { console.error(`${MODULE_ID} |`, err); }
    }
    if (actor.effects.has(effect.id)) await effect.delete();
    await chat(actor, L("effects.expired", { name: esc(effect.name), actor: esc(actor.name) }), { whisper: ownersOf(actor) });
  } finally {
    expiring.delete(effect.uuid);
  }
}

/** Actores que pueden llevar portadores: del mundo y sintéticos de la escena activa. */
function carrierActors() {
  const tokens = canvas.scene?.tokens.filter((t) => !t.actorLink && t.actor).map((t) => t.actor) ?? [];
  return [...game.actors.contents, ...tokens];
}
export const carriersOf = (actor) => actor.effects.filter((e) => e.flags[MODULE_ID]?.timed);
// Un actor sintético (token no vinculado) también muestra los efectos de su actor base: para caducar
// se recorren solo los propios de cada documento, o se retiraría dos veces el mismo efecto.
// La colección de efectos del delta también incluye los heredados; sus datos fuente, solo los propios.
const ownsEffect = (actor, id) => {
  if (!actor?.isToken) return true;
  const own = actor.token?.delta?._source?.effects;
  return Array.isArray(own) ? own.some((e) => e._id === id) : !actor.token?.baseActor?.effects.has(id);
};
const ownCarriers = (actor) => carriersOf(actor).filter((e) => ownsEffect(actor, e.id));

async function expireDue() {
  for (const actor of carrierActors()) {
    for (const effect of ownCarriers(actor)) {
      const remaining = effect.duration?.remaining;
      if (typeof remaining === "number" && remaining <= 0) await expireCarrier(effect);
    }
  }
}

// ---------------------------------------------------------------- daño y elección de Items

/** Daño directo a PD: ignora blindaje y no lo desgasta; no produce críticos de arma. */
export async function directDamage(target, formula, label) {
  const roll = await new Roll(String(formula)).evaluate();
  const hp = target.system.derivedStats.hp.value;
  await target.update({ "system.derivedStats.hp.value": Math.max(0, hp - roll.total) });
  const note = hp <= 0 ? `<p>${L("effects.alreadyMortal")}</p>` : "";
  await chat(target, `<p>${L("effects.directDamage", { name: esc(label), actor: esc(target.name), damage: roll.total })}</p>${note}`, { rolls: [roll] });
}

/** Items del objetivo elegibles para suspender o expulsar, según la operación. */
export function eligibleItems(actor, op) {
  const exclude = new Set(op.exclude ?? []);
  return actor.items.filter((i) => {
    if (i.type !== "cyberware" || !i.system.isInstalled) return false;
    if (exclude.has(i.system.type)) return false;
    if (getCapabilities(i).some((c) => exclude.has(c.type))) return false;
    if (op.op === "eject-chip") return i.system.type === "neuralWare" && !i.system.isFoundational;
    return true;
  });
}

/** Diálogo para elegir hasta `count` Items. Devuelve sus ids. */
export function chooseItems(items, count, title) {
  if (!items.length) return Promise.resolve([]);
  const rows = items.map((i) => `<label class="er2070-pick"><input type="checkbox" value="${i.id}"> ${esc(i.name)}</label>`).join("");
  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<p>${L("effects.pick", { count })}</p><div class="er2070-picks">${rows}</div>`,
      buttons: {
        ok: { label: L("net.ok"), callback: (html) => resolve([...(html[0] ?? html).querySelectorAll("input:checked")].slice(0, count).map((e) => e.value)) },
        cancel: { label: L("editor.cancel"), callback: () => resolve([]) },
      },
      default: "ok",
      close: () => resolve([]),
    }).render(true);
  });
}

// ---------------------------------------------------------------- operaciones

const OPS = {
  "stat-mod": (target, op, ctx) => createCarrier(target, ctx, { changes: [{ key: op.key, mode: 2, value: String(op.value) }], duration: op.duration }),

  "move-mod": async (target, op, ctx) => {
    // `formula` es una reducción (p. ej. "1d6" reduce MOV en 1d6); `value` lleva su signo.
    let delta = op.value ?? 0;
    if (op.formula) delta = -(await new Roll(String(op.formula)).evaluate()).total;
    const move = target.system.stats.move.value;
    if (op.minZero !== false) delta = Math.max(delta, -move);
    await createCarrier(target, ctx, { changes: [{ key: "system.stats.move.value", mode: 2, value: String(delta) }], duration: op.duration });
    if (move + delta <= 0) await chat(target, L("effects.noMove", { actor: esc(target.name) }));
  },

  "temp-injury": async (target, op, ctx) => {
    const source = await fromUuid(op.injury);
    if (source?.type !== "criticalInjury") return ui.notifications.error(L("effects.badInjury", { uuid: op.injury }));
    const data = source.toObject();
    delete data._id;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.temporary`, true);
    const [item] = await target.createEmbeddedDocuments("Item", [data]);
    await createCarrier(target, ctx, { duration: op.duration, timed: { createdItems: [item.id] } });
  },

  "direct-damage": async (target, op, ctx) => {
    if (op.timing === "endOfTargetTurn") {
      await createCarrier(target, ctx, { duration: op.duration, timed: { periodic: { formula: op.formula, repeat: op.repeat !== false, stopAction: op.stopAction ?? "" } } });
      return chat(target, L("effects.periodicStart", { name: esc(ctx.label), actor: esc(target.name), stop: esc(op.stopAction ?? "") }));
    }
    return directDamage(target, op.formula, ctx.label);
  },

  "suspend-cyberware": async (target, op, ctx, pick) => {
    const ids = pick ?? (await chooseItems(eligibleItems(target, op), op.count ?? 1, L("effects.pickSuspend", { actor: target.name })));
    if (!ids.length) return;
    const effect = await createCarrier(target, ctx, { duration: op.duration, timed: { suspended: ids } });
    for (const id of ids) {
      const item = target.items.get(id);
      await item?.setFlag(MODULE_ID, "suspendedBy", [...(item.getFlag(MODULE_ID, "suspendedBy") ?? []), effect.id]);
    }
    const names = ids.map((id) => esc(target.items.get(id)?.name)).join(", ");
    await chat(target, L("effects.suspended", { actor: esc(target.name), items: names }));
  },

  control: (target, op, ctx) =>
    chat(target, L(op.scope === "move" ? "effects.controlMove" : "effects.controlAll", { source: esc(ctx.sourceName), actor: esc(target.name) }), { whisper: ownersOf(target) }),

  "eject-chip": async (target, op, ctx, pick) => {
    const ids = pick ?? (await chooseItems(eligibleItems(target, op), 1, L("effects.pickChip", { actor: target.name })));
    for (const id of ids) {
      const name = target.items.get(id)?.name;
      await target.uninstallCyberware(id, null, true);
      await chat(target, L("effects.ejected", { actor: esc(target.name), item: esc(name) }));
    }
  },

  unconscious: async (target, op, ctx) => {
    const statuses = ["unconscious", ...(op.prone ? ["prone"] : [])];
    for (const s of statuses) await target.toggleStatusEffect(s, { active: true });
    await createCarrier(target, ctx, { duration: op.duration, timed: { statuses, endsOnDamage: op.endsOnDamage !== false } });
  },

  "initiative-top": async (target) => {
    const c = combatantOf(target);
    if (!c) return;
    const best = Math.max(...game.combat.combatants.map((x) => x.initiative ?? 0));
    await c.update({ initiative: best + 1 });
  },

  humanity: async (target, op, ctx) => {
    const roll = await new Roll(String(op.formula)).evaluate();
    const hum = target.system.derivedStats?.humanity;
    if (!hum) return;
    const loss = op.sign === "loss";
    const before = Number.isInteger(hum.value) ? hum.value : hum.max;
    let value = before + (loss ? -roll.total : roll.total);
    // Las ganancias no superan la Humanidad máxima de RED (la que permite la terapia).
    if (!loss && op.respectMax !== false) value = Math.max(before, Math.min(value, hum.max));
    const amount = Math.abs(value - before);
    const sentence = L(loss ? "effects.humanityLossLedger" : "effects.humanityGainLedger", { amount, total: value });
    // Registro nativo de RED (derivedStats.humanity.transactions); la Humanidad máxima no cambia.
    await target.update({
      "system.derivedStats.humanity.value": value,
      "system.derivedStats.humanity.transactions": [...(hum.transactions ?? []), [sentence, ctx.label]],
    });
    await target.setMaxHumanity?.();
    if (loss) ctx.lastHumanityLoss = amount;
    ctx.humanityDelta = (ctx.humanityDelta ?? 0) + value - before;
    const note = value <= 0 ? `<p><strong>${L("effects.cyberpsychosis", { actor: esc(target.name) })}</strong></p>` : "";
    await chat(target, `<p>${L(loss ? "effects.humanityLoss" : "effects.humanityGain", { name: esc(ctx.label), actor: esc(target.name), amount, total: value })}</p>${note}`, { rolls: [roll] });
  },

  // Con Humanidad negativa, daño directo igual a la pérdida de la operación `humanity` anterior.
  "self-damage-from-humanity": async (target, op, ctx) => {
    const value = target.system.derivedStats?.humanity?.value ?? 0;
    if (value < 0 && ctx.lastHumanityLoss) await directDamage(target, String(ctx.lastHumanityLoss), ctx.label);
  },

  // Deshace el cambio neto de Humanidad que registró el portador (p. ej., una droga): `ctx.revertDelta`.
  "humanity-revert": async (target, op, ctx) => {
    const delta = ctx.revertDelta ?? 0;
    if (!delta) return;
    await OPS.humanity(target, { formula: String(Math.abs(delta)), sign: delta > 0 ? "loss" : "gain", respectMax: true }, ctx);
  },

  "on-expire": async (target, op, ctx) => {
    await createCarrier(target, ctx, { duration: op.duration, timed: { onExpire: { operations: op.operations ?? [] } }, img: "icons/svg/hazard.svg" });
    await chat(target, L("effects.onExpireStart", { name: esc(ctx.label), actor: esc(target.name) }), { whisper: ownersOf(target) });
  },

  "ignore-wound-state": (target, op, ctx) =>
    createCarrier(target, ctx, { duration: op.duration, timed: { ignoreWound: { states: op.states ?? ["seriouslyWounded", "mortallyWounded"], keepDeathSaves: op.keepDeathSaves !== false } }, img: "icons/svg/regen.svg" }),

  "extra-action": async (target, op) => {
    const c = combatantOf(target);
    if (!c) return;
    const turn = getTurn(c);
    await c.setFlag(MODULE_ID, "turn", { ...turn, extra: turn.extra + (op.count ?? 1) });
  },
};

/**
 * Aplica una lista de operaciones al objetivo (en el cliente del DJ).
 * @param {object} data - { sourceUuid, sourceActorUuid, sourceName, targetUuid, label, operations, picks, gmConfirm }
 */
export async function applyOperations(data) {
  const target = resolveActor(data.targetUuid);
  if (!target) return;
  if (data.gmConfirm) {
    const ok = await Dialog.confirm({ title: data.label, content: `<p>${L("effects.confirm", { name: esc(data.label), actor: esc(target.name) })}</p>` });
    if (!ok) return chat(target, L("effects.vetoed", { name: esc(data.label) }), { whisper: ownersOf(target) });
  }
  const ctx = { ...(data.context ?? {}), label: data.label, sourceUuid: data.sourceUuid, sourceActorUuid: data.sourceActorUuid, sourceName: data.sourceName };
  for (const [i, op] of (data.operations ?? []).entries()) {
    const fn = OPS[op.op];
    if (!fn) {
      ui.notifications.warn(L("effects.notImplemented", { op: op.op }));
      continue;
    }
    await fn(target, op, ctx, data.picks?.[i]);
  }
  return ctx;
}
registerHandler("applyOperations", applyOperations);

// ---------------------------------------------------------------- hooks

/** Envoltorio de supresión: un implante suspendido (o instalado en uno suspendido) no aplica efectos. */
function isSuspended(item) {
  for (let depth = 0; item && depth < 10; depth++) {
    if (item.documentName !== "Item") return false;
    if (item.flags?.[MODULE_ID]?.suspendedBy?.length) return true;
    const parentId = item.system?.installedIn?.[0];
    item = parentId && parentId !== item.actor?.id ? item.actor?.items.get(parentId) : null;
  }
  return false;
}

export function registerEffectHooks() {
  libWrapper.register(MODULE_ID, "CONFIG.ActiveEffect.documentClass.prototype.determineSuppression", function (wrapped, ...args) {
    const result = wrapped(...args);
    if (this.system && !this.system.isSuppressed && this.parent?.documentName === "Item" && isSuspended(this.parent)) this.system.isSuppressed = true;
    return result;
  }, "WRAPPER");

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!isActiveGM() || !("turn" in changed || "round" in changed)) return;
    const prev = combat.combatants.get(combat.previous?.combatantId)?.actor;
    if (prev) {
      for (const effect of carriersOf(prev)) {
        const t = effect.flags[MODULE_ID].timed;
        if (t.periodic) {
          await directDamage(prev, t.periodic.formula, effect.name);
          if (!t.periodic.repeat) await expireCarrier(effect);
        }
      }
    }
    for (const actor of carrierActors()) {
      for (const effect of ownCarriers(actor)) {
        const t = effect.flags[MODULE_ID].timed;
        const ended = (t.untilEndOfTurn === "target" && sameActor(actor, prev)) || (t.untilEndOfTurn === "self" && prev && sameActor(resolveActor(t.sourceActor ?? ""), prev));
        if (ended && actor.effects.has(effect.id)) await expireCarrier(effect);
      }
    }
    await expireDue();
  });

  Hooks.on("updateWorldTime", () => { if (isActiveGM()) expireDue(); });

  Hooks.on("preUpdateActor", (actor, changes, options) => {
    options.er2070Hp = actor.system?.derivedStats?.hp?.value;
  });
  Hooks.on("updateActor", async (actor, changes, options) => {
    if (!isActiveGM() || options.er2070Hp === undefined) return;
    const hp = foundry.utils.getProperty(changes, "system.derivedStats.hp.value");
    if (hp === undefined || hp >= options.er2070Hp) return;
    for (const effect of carriersOf(actor)) if (effect.flags[MODULE_ID].timed.endsOnDamage) await expireCarrier(effect);
  });
}
