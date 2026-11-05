/**
 * Armas, conversiones, munición y ciberequipo 2070 (M5).
 * Se engancha a RED con libWrapper: creación y confirmación de tiradas de Item, instalación de
 * ciberequipo, Humanidad máxima, penalización por estado de heridas y tiradas de característica.
 */
import { MODULE_ID, getCapabilities } from "./schema.js";
import { shotPlan, effectiveStat, evaluateCondition, retryAllowed, unarmedDamage, ignoreArmorFromMultiplier, firingChamber, attackMode, stackSatisfied } from "./rules.js";
import { L, esc, gmExec, registerHandler, resolveActor, actorCapabilities, chat, createCarrier, carriersOf, applyOperations } from "./effects.js";
import { countInterfaceRoll } from "./net.js";

const RED_ID = "cyberpunk-red-core";
const setting = (key) => game.settings.get(MODULE_ID, key);
const WEAPON_HOSTS = new Set(["weapon", "cyberware"]);
const WOUND_STATES = ["seriouslyWounded", "mortallyWounded"];
// Capacidades que se muestran en la sección de armas de la consola.
const WEAPON_CAPS = new Set(["crit-bonus-damage", "ricochet", "smart-weapon", "chargeable", "ammo-per-attack", "min-ammo-to-fire", "multi-chamber", "bolt-action", "user-requirement", "crit-choose", "mode-damage"]);
const isGM = () => game.user.isGM;
const timed = (e) => e.flags[MODULE_ID].timed;

// ---------------------------------------------------------------- datos

const getState = (item) => foundry.utils.deepClone(item.getFlag(MODULE_ID, "state") ?? {});
const setState = (item, patch) => item.setFlag(MODULE_ID, "state", { ...getState(item), ...patch });

/** Capacidades del arma y de las mejoras (itemUpgrade) instaladas en ella. */
function weaponCaps(item) {
  const upgrades = (item.system.installedItems?.list ?? []).map((id) => item.actor?.items.get(id)).filter((i) => i?.type === "itemUpgrade");
  return [item, ...upgrades].flatMap((src) => getCapabilities(src).map((c) => ({ ...c, item: src })));
}
const find = (caps, type) => caps.find((c) => c.type === type);
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Consultas sobre el actor para evaluar condiciones (CONTRATOS.md §6). */
function factsOf(actor) {
  return {
    hasCapability: (type) => actorCapabilities(actor, type).length > 0,
    hasTag: (tag) => actorCapabilities(actor, "tag").some((c) => c.tags.includes(tag)),
    hasCyberwareType: (type, foundational) => actor.itemTypes.cyberware.some((c) => c.system.isInstalled && c.system.type === type && (foundational === undefined || c.system.isFoundational === foundational)),
    stat: (name, scope) => effectiveStat(actor.system.stats?.[name]?.value ?? 0, actorCapabilities(actor, "effective-stat"), name, scope),
    roleRank: (role) => Number.parseInt(actor.itemTypes.role.find((r) => slug(r.name) === slug(role))?.system.rank, 10) || 0,
    targetUnaware: undefined,
    connected: (mode) => (actor.getFlag(MODULE_ID, "state.net")?.connections ?? []).some((c) => mode === "any" || c.mode === mode),
  };
}
const conditionsMet = (conds, actor, scope) => (conds ?? []).every((c) => evaluateCondition(c, factsOf(actor), scope).ok);
/** Capacidades cuyo `requires` se cumple (las demás quedan inactivas). */
const activeCaps = (caps, actor) => caps.filter((c) => c.type === "smart-weapon" || conditionsMet(c.requires, actor, "wieldWeapon"));

// Un arma inteligente se usa con cable personal o empuñadura (o lo que diga su `requires`).
const SMART_DEFAULT = [{ type: "anyOf", conditions: ["smart-interface", "cable-link", "neuroport"].map((capability) => ({ type: "actorHasCapability", capability })) }];
const smartOk = (cap, actor) => conditionsMet(cap.requires?.length ? cap.requires : SMART_DEFAULT, actor, "wieldWeapon");

const chargeOf = (actor, item) => carriersOf(actor).find((e) => timed(e).charge?.itemId === item.id);
const activationOf = (actor, item) => carriersOf(actor).find((e) => timed(e).activation?.itemId === item.id);
const cooldownOf = (actor, item) => carriersOf(actor).find((e) => timed(e).cooldown?.itemId === item.id);
// En un token no vinculado, un efecto heredado se modifica en el actor base que lo contiene.
const realEffect = (actor, effect) => (effect && actor.isToken && actor.token?.baseActor?.effects.get(effect.id)) || effect;

const rollClass = (roll) => roll?.constructor?.name;
const isAttack = (roll) => attackMode(rollClass(roll)) !== null;
const isDamage = (roll) => rollClass(roll) === "CPRDamageRoll";

/** Munición cargada como datos: la de la recámara (multirecámara) o la instalada por RED. */
function ammoSnapshot(ammo) {
  const pick = ["type", "variety", "overrides", "ablationValue"];
  return { id: ammo.id, name: ammo.name, system: Object.fromEntries(pick.map((k) => [k, foundry.utils.deepClone(ammo.system[k])])), flags: foundry.utils.deepClone(ammo.flags?.[MODULE_ID] ?? null) };
}
/** Hace que RED lea la munición de la recámara en lugar de la munición instalada. */
const useChamberAmmo = (item, snap) => { if (snap) item._getLoadedAmmoProp = (prop) => foundry.utils.getProperty(snap.system, prop); };

/** Detiene una tirada antes del diálogo de RED. */
function block(roll, text) {
  ui.notifications.warn(text);
  roll.handleRollDialog = async () => false;
  return roll;
}

// ---------------------------------------------------------------- mensajes tras la tarjeta de RED

const pendingCards = [];
function runPending(entry) {
  if (entry.done) return;
  entry.done = true;
  pendingCards.splice(pendingCards.indexOf(entry), 1);
  entry.fn();
}
/** Ejecuta `fn` después de que RED publique la tarjeta de la tirada (o a los 3 s). */
function afterCard(actor, fn) {
  const entry = { actorId: actor.id, fn, done: false };
  pendingCards.push(entry);
  setTimeout(() => runPending(entry), 3000);
}
/** Llama a `fn(roll)` cuando la tirada de RED ya se ha resuelto. */
function afterRoll(roll, actor, fn) {
  const original = roll.roll;
  roll.roll = async function (...args) {
    delete this.roll;
    const out = await original.apply(this, args);
    afterCard(actor, () => fn(this));
    return out;
  };
}

// ---------------------------------------------------------------- preparación de tiradas (createRoll)

function prepareAttack(item, actor, roll, caps, state) {
  const mode = attackMode(rollClass(roll));
  const active = activeCaps(caps, actor);
  const name = item.name;
  const smart = find(active, "smart-weapon");
  if (smart && !smartOk(smart, actor)) return block(roll, L("gear.smartNeedsLink", { name }));
  if (state.boltLocked && find(active, "bolt-action")) return block(roll, L("gear.boltLocked", { name }));

  let chamber = null;
  if (find(active, "multi-chamber")) {
    chamber = firingChamber(state.chambers ?? [], state.activeChamber ?? 0);
    if (chamber < 0) return block(roll, L("gear.chambersEmpty", { name }));
  }

  const chargeCap = find(active, "chargeable");
  const whileCharged = chargeCap && chargeOf(actor, item) ? chargeCap.whileCharged ?? {} : null;
  const perAttack = whileCharged?.ammoPerAttack
    ? { count: whileCharged.ammoPerAttack, ifInsufficient: { consumeAll: true } }
    : find(active, "ammo-per-attack") ?? null;
  const plan = item.system.isRanged
    ? shotPlan({ magazine: item.system.magazine?.value ?? 0, mode, perAttack, minToFire: find(active, "min-ammo-to-fire")?.count ?? null })
    : { blocked: null, consume: null, insufficientDamage: null };
  if (plan.blocked) return block(roll, L(`gear.${plan.blocked}`, { name }));

  const rico = find(active, "ricochet");
  const ricochet = Boolean(rico && state.ricochetArmed);
  if (ricochet && !(mode === "aimed" && rico.aimedIgnoresMod !== false)) {
    roll.addMod([{ value: rico.attackMod ?? -4, source: L("gear.ricochetMod"), id: "er2070-ricochet" }]);
  }
  roll.er2070 = { mode, consume: plan.consume, insufficientDamage: plan.insufficientDamage, chamber, charged: Boolean(whileCharged), ricochet };
  return roll;
}

/** Ajustes de daño; idempotente (se aplica al crear y otra vez al confirmar, por si el diálogo cambió algo). */
function applyDamageMods(item, actor, roll, caps, state) {
  const active = activeCaps(caps, actor);
  const shot = state.lastShot ?? null;
  roll.er2070Base ??= { formula: roll.formula, bonus: roll.bonusDamage, ignore: roll.rollCardExtraArgs.ignoreArmorPercent ?? 0 };
  const base = roll.er2070Base;

  if (!roll.isAutofire) {
    let formula = base.formula;
    const mode = roll.isAimed ? "aimed" : "single";
    const byMode = active.find((c) => c.type === "mode-damage" && c.modes.includes(mode));
    if (shot?.insufficientDamage) formula = String(shot.insufficientDamage);
    else if (byMode) formula = String(byMode.damage);
    // TCO efectiva en el cuerpo a cuerpo (daño desarmado con cálculo automático de RED).
    if (["unarmed", "martialArts"].includes(item.system.weaponType) && item.system.unarmedAutomaticCalculation) {
      const body = factsOf(actor).stat("body", "melee");
      if (body > (actor.system.stats.body?.value ?? 0)) {
        const cyberArm = actor.itemTypes.cyberware.some((c) => c.system.type === "cyberArm" && c.system.isInstalled && c.system.isFoundational);
        formula = unarmedDamage(body, { martialArts: item.system.weaponType === "martialArts", cyberArm });
      }
    }
    roll.formula = formula;
  }
  // Daño adicional de herida crítica: el +5 de RED más las capacidades, una vez por crítico.
  roll.bonusDamage = base.bonus + active.filter((c) => c.type === "crit-bonus-damage").reduce((n, c) => n + c.value, 0);
  roll.rollCardExtraArgs.ignoreArmorPercent = ignoreArmorFromMultiplier(shot?.spMultiplier, base.ignore);
  if (shot?.ammo) useChamberAmmo(item, shot.ammo);
}

/** Característica efectiva preparada desde la consola para la próxima tirada de esa característica. */
function applyArmedStat(actor, roll, stat) {
  const armed = actor.getFlag(MODULE_ID, "state.effArmed");
  if (!armed || armed.stat !== stat) return;
  const base = actor.system.stats?.[stat]?.value ?? 0;
  const eff = factsOf(actor).stat(stat, armed.scope);
  if (eff > base) roll.addMod([{ value: eff - base, source: L("gear.effectiveMod", { value: eff }), id: "er2070-effective" }]);
  actor.setFlag(MODULE_ID, "state.effArmed", null);
}

function onCreateRoll(wrapped, type, actor, extraData = []) {
  const item = this;
  const weapon = actor && WEAPON_HOSTS.has(item.type) && item.actor;
  let caps = [];
  let state = {};
  if (weapon) {
    caps = weaponCaps(item);
    state = getState(item);
    if (find(caps, "multi-chamber")) {
      const attack = ["attack", "aimed", "autofire", "suppressive"].includes(type);
      const i = attack ? firingChamber(state.chambers ?? [], state.activeChamber ?? 0) : -1;
      useChamberAmmo(item, attack ? state.chambers?.[i] : state.lastShot?.ammo);
    }
  }
  const roll = wrapped(type, actor, extraData);
  if (!roll) return roll;
  try {
    if (weapon && isAttack(roll)) return prepareAttack(item, actor, roll, caps, state);
    if (weapon && isDamage(roll)) applyDamageMods(item, actor, roll, caps, state);
    if (item.type === "skill" && actor) applyArmedStat(actor, roll, item.system.stat);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
  }
  return roll;
}

// ---------------------------------------------------------------- después de confirmar (confirmRoll)

async function applyUserRequirements(item, actor, caps) {
  for (const cap of caps.filter((c) => c.type === "user-requirement")) {
    if (evaluateCondition(cap.condition, factsOf(actor), "wieldWeapon").ok) continue;
    const uuid = cap.onFail?.criticalInjury;
    const source = uuid ? await fromUuid(uuid) : null;
    if (source?.type !== "criticalInjury") {
      await chat(actor, L("gear.requirementFailed", { actor: esc(actor.name), name: esc(item.name) }));
      continue;
    }
    const already = actor.itemTypes.criticalInjury.some((i) => i.name === source.name || i.flags?.core?.sourceId === uuid);
    if (already && cap.onFail.unlessAlready !== false) {
      await chat(actor, L("gear.requirementAlready", { actor: esc(actor.name), name: esc(item.name), injury: esc(source.name) }));
      continue;
    }
    const data = source.toObject();
    delete data._id;
    foundry.utils.setProperty(data, "flags.core.sourceId", uuid);
    await actor.createEmbeddedDocuments("Item", [data]);
    await chat(actor, L("gear.requirementInjury", { actor: esc(actor.name), name: esc(item.name), injury: esc(source.name) }));
  }
}

async function afterAttack(item, actor, roll, info) {
  const caps = activeCaps(weaponCaps(item), actor);
  const state = getState(item);
  const patch = { lastShot: { insufficientDamage: info.insufficientDamage ?? null, spMultiplier: null, ammo: null } };
  const notes = [];

  if (find(caps, "bolt-action")) patch.boltLocked = true;
  if (info.chamber !== null && info.chamber >= 0) {
    const chambers = [...(state.chambers ?? [])];
    patch.lastShot.ammo = chambers[info.chamber] ?? null;
    chambers[info.chamber] = null;
    patch.chambers = chambers;
  }
  if (info.insufficientDamage) notes.push(L("gear.insufficient", { damage: esc(info.insufficientDamage) }));

  const chargeCap = find(caps, "chargeable");
  if (info.charged && chargeCap) {
    const w = chargeCap.whileCharged ?? {};
    patch.lastShot.spMultiplier = w.spMultiplier ?? null;
    notes.push(L("gear.chargedShot", {
      rof: w.rof ?? "—",
      cover: w.coverPierce ? L(`gear.cover.${w.coverPierce}`) : "—",
      sp: w.spMultiplier ?? 1,
    }) + (w.silhouettes ? ` ${L("gear.silhouettes")}` : ""));
    const charge = realEffect(actor, chargeOf(actor, item));
    if (charge) {
      if (chargeCap.release === "endOfTurn" && game.combat?.started) {
        await charge.update({ [`flags.${MODULE_ID}.timed.untilEndOfTurn`]: "self", [`flags.${MODULE_ID}.timed.sourceActor`]: actor.uuid });
      } else await charge.delete();
    }
  }
  if (info.ricochet) {
    patch.ricochetArmed = false;
    const rico = find(caps, "ricochet");
    notes.push(L("gear.ricochetShot", { radius: rico?.spreadRadius ?? "—" }));
  }
  await setState(item, patch);
  if (notes.length) await chat(actor, `<p><strong>${esc(item.name)}</strong></p>${notes.map((n) => `<p>${n}</p>`).join("")}`);
  await applyUserRequirements(item, actor, caps);

  // Munición inteligente mejorada: segundo intento si el arma es inteligente.
  const smart = find(caps, "smart-weapon");
  const ammo = patch.lastShot.ammo ?? (item.getInstalledItems?.("ammo")?.[0] ? ammoSnapshot(item.getInstalledItems("ammo")[0]) : null);
  const enhanced = ammo ? getCapabilities({ flags: { [MODULE_ID]: ammo.flags } }).find((c) => c.type === "enhanced-smart-ammo") : null;
  if (smart && enhanced && smartOk(smart, actor) && item.system.isRanged) afterRoll(roll, actor, (r) => postRetry(actor, item, r, enhanced));
}

async function afterDamage(item, actor, roll) {
  const caps = activeCaps(weaponCaps(item), actor);
  if (getState(item).lastShot) await setState(item, { lastShot: null });
  const crit = find(caps, "crit-choose");
  if (!crit) return;
  const targets = [...game.user.targets].map((t) => t.document.uuid);
  afterRoll(roll, actor, (r) => {
    if (r.wasCritSuccess?.()) postCritChoose(actor, item, crit.rolls ?? 2, targets, r.location);
  });
}

async function onConfirmRoll(wrapped, cprRoll, ...args) {
  const item = this;
  const actor = item.actor;
  const weapon = actor && WEAPON_HOSTS.has(item.type);
  const info = cprRoll?.er2070;
  try {
    if (weapon && info && isAttack(cprRoll)) {
      if (info.chamber !== null && info.chamber >= 0) useChamberAmmo(item, getState(item).chambers?.[info.chamber]);
      // RED gasta 1 bala (10 en autofuego): se sustituye solo para este disparo.
      if (info.consume !== null) item.bulletConsumption = () => info.consume;
    }
    if (weapon && isDamage(cprRoll)) applyDamageMods(item, actor, cprRoll, weaponCaps(item), getState(item));
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
  }
  const result = await wrapped(cprRoll, ...args);
  countInterfaceRoll(item, cprRoll);
  try {
    if (weapon && info && isAttack(cprRoll)) await afterAttack(item, actor, cprRoll, info);
    else if (weapon && isDamage(cprRoll)) await afterDamage(item, actor, cprRoll);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
  }
  return result;
}

// ---------------------------------------------------------------- segundo intento y elección de crítico

function penaltiesOf(roll) {
  const mods = (roll.mods ?? []).map((m) => Number(m.value) || 0);
  const extra = (roll.additionalMods ?? []).map((v) => Number.parseInt(v, 10) || 0);
  return [...mods, ...extra].filter((v) => v < 0).reduce((a, b) => a + b, 0);
}

function postRetry(actor, item, roll, cap) {
  const retry = { actorUuid: actor.uuid, base: cap.retry?.base ?? 14, maxMargin: cap.retry?.maxMargin ?? 5, penalties: penaltiesOf(roll), first: roll.resultTotal, used: false };
  const visibility = cap.ignoreVisibility ? `<p>${L("gear.ignoreVisibility")}</p>` : "";
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="er2070-chat"><p>${L("gear.retryOffer", { name: esc(item.name), margin: retry.maxMargin, base: retry.base, penalties: retry.penalties })}</p>${visibility}
      <button type="button" data-er2070-action="retry">${L("gear.retryBtn")}</button></div>`,
    flags: { [MODULE_ID]: { retry } },
  });
}

async function d10Red() {
  const first = await new Roll("1d10").evaluate();
  const rolls = [first];
  let total = first.total;
  if (first.total === 10 || first.total === 1) {
    const second = await new Roll("1d10").evaluate();
    rolls.push(second);
    total += first.total === 10 ? second.total : -second.total;
  }
  return { total, rolls };
}

async function doRetry(message) {
  const retry = message.getFlag(MODULE_ID, "retry");
  const actor = resolveActor(retry?.actorUuid);
  if (!retry || retry.used || !actor?.isOwner) return;
  const luckMax = actor.system.stats?.luck?.value ?? 0;
  const form = await Dialog.prompt({
    title: L("gear.retryBtn"),
    content: `<p>${L("gear.retryFirst", { first: retry.first })}</p>
      <div class="form-group"><label>${L("gear.retryDv")}</label><input type="number" name="dv" value="15"></div>
      <div class="form-group"><label>${L("net.luck", { max: luckMax })}</label><input type="number" name="luck" value="0" min="0" max="${luckMax}"></div>`,
    label: L("net.ok"),
    callback: (html) => {
      const root = html[0] ?? html;
      return { dv: Number(root.querySelector("[name=dv]").value), luck: Math.max(0, Math.min(luckMax, Number(root.querySelector("[name=luck]").value) || 0)) };
    },
    rejectClose: false,
  });
  if (!form) return;
  if (!retryAllowed(retry.first, form.dv, retry.maxMargin)) return ui.notifications.warn(L("gear.retryNotAllowed", { margin: retry.maxMargin }));
  await message.setFlag(MODULE_ID, "retry", { ...retry, used: true });
  const die = await d10Red();
  const total = retry.base + die.total + form.luck + retry.penalties;
  if (form.luck) await actor.update({ "system.stats.luck.value": luckMax - form.luck });
  await chat(actor, `<p>${L("gear.retryResult", { total, dv: form.dv, base: retry.base, die: die.total, luck: form.luck, penalties: retry.penalties })}</p>
    <p><strong>${L(total >= form.dv ? "gear.hit" : "gear.miss")}</strong></p>`, { rolls: die.rolls });
}

function postCritChoose(actor, item, rolls, targets, location) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="er2070-chat"><p>${L("gear.critChooseOffer", { name: esc(item.name), rolls })}</p>
      <button type="button" data-er2070-action="crit-roll">${L("gear.critRollBtn", { rolls })}</button></div>`,
    flags: { [MODULE_ID]: { critChoose: { actorUuid: actor.uuid, rolls, targets, location, used: false } } },
  });
}

async function critTables() {
  const pack = game.packs.get(game.settings.get(RED_ID, "criticalInjuryRollTableCompendium"));
  return pack ? pack.getDocuments() : [];
}

async function doCritRoll(message) {
  const data = message.getFlag(MODULE_ID, "critChoose");
  const actor = resolveActor(data?.actorUuid);
  if (!data || data.used || !(actor?.isOwner || isGM())) return;
  const tables = await critTables();
  if (!tables.length) return ui.notifications.warn(L("gear.noCritTables"));
  const head = data.location === "head";
  const preferred = tables.find((t) => /head|cabeza/i.test(t.name) === head) ?? tables[0];
  const options = tables.map((t) => `<option value="${t.id}" ${t === preferred ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const tableId = await Dialog.prompt({
    title: L("gear.critRollBtn", { rolls: data.rolls }),
    content: `<div class="form-group"><label>${L("gear.critTable")}</label><select name="table">${options}</select></div>`,
    label: L("net.ok"),
    callback: (html) => (html[0] ?? html).querySelector("[name=table]").value,
    rejectClose: false,
  });
  const table = tables.find((t) => t.id === tableId);
  if (!table) return;
  await message.setFlag(MODULE_ID, "critChoose", { ...data, used: true });
  const results = [];
  const rolls = [];
  for (let i = 0; i < data.rolls; i++) {
    const draw = await table.roll();
    rolls.push(draw.roll);
    results.push(draw.results[0]?.text ?? "?");
  }
  const buttons = results.map((name) => `<li>${esc(name)} <button type="button" data-er2070-action="crit-pick" data-name="${esc(name)}">${L("gear.critPick")}</button></li>`).join("");
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="er2070-chat"><p>${L("gear.critResults", { table: esc(table.name) })}</p><ul>${buttons}</ul></div>`,
    rolls,
    flags: { [MODULE_ID]: { critPick: { actorUuid: data.actorUuid, targets: data.targets, table: table.name, used: false } } },
  });
}

async function doCritPick(message, name) {
  const data = message.getFlag(MODULE_ID, "critPick");
  const actor = resolveActor(data?.actorUuid);
  if (!data || data.used || !(actor?.isOwner || isGM())) return;
  await message.setFlag(MODULE_ID, "critPick", { ...data, used: true });
  await chat(actor, L("gear.critChosen", { actor: esc(actor.name), injury: esc(name) }));
  for (const targetUuid of data.targets ?? []) await gmExec("applyInjury", { targetUuid, table: data.table, name });
}

// Como RED: la herida se busca en el compendio cuya etiqueta coincide con el nombre de la tabla.
registerHandler("applyInjury", async ({ targetUuid, table, name }) => {
  const target = resolveActor(targetUuid);
  const pack = game.packs.find((p) => p.metadata.label === table);
  const entry = pack?.index.find((i) => i.name === name);
  if (!target || !entry) return ui.notifications.warn(L("gear.injuryNotFound", { name }));
  const injury = await pack.getDocument(entry._id);
  const data = injury.toObject();
  delete data._id;
  await target.createEmbeddedDocuments("Item", [data]);
  await chat(target, L("gear.injuryApplied", { actor: esc(target.name), injury: esc(name) }));
});

// ---------------------------------------------------------------- acciones de la consola

async function chargeWeapon(actor, item) {
  const cap = find(activeCaps(weaponCaps(item), actor), "chargeable");
  if (!cap || chargeOf(actor, item)) return;
  await createCarrier(actor, { label: L("gear.chargedName", { name: item.name }), sourceUuid: item.uuid, sourceActorUuid: actor.uuid },
    { duration: cap.duration, timed: { charge: { itemId: item.id } }, img: "icons/svg/lightning.svg" });
  await chat(actor, L(cap.chargeCost === "none" ? "gear.chargedFree" : "gear.chargedMove", { actor: esc(actor.name), name: esc(item.name) }));
}

async function workBolt(actor, item) {
  await setState(item, { boltLocked: false });
  await chat(actor, L("gear.boltWorked", { actor: esc(actor.name), name: esc(item.name) }));
}

registerHandler("approveRicochet", async ({ actorUuid, itemId, user }) => {
  const actor = resolveActor(actorUuid);
  const item = actor?.items.get(itemId);
  if (!item) return;
  const ok = await Dialog.confirm({ title: L("gear.ricochetMod"), content: `<p>${L("gear.ricochetAsk", { user: esc(user), actor: esc(actor.name), name: esc(item.name) })}</p>` });
  await setState(item, { ricochetArmed: ok });
  await chat(actor, L(ok ? "gear.ricochetApproved" : "gear.ricochetVetoed", { actor: esc(actor.name), name: esc(item.name) }));
});

async function toggleRicochet(actor, item) {
  if (getState(item).ricochetArmed) return setState(item, { ricochetArmed: false });
  // El rebote siempre lo valida el DJ (trayecto despejado desde el punto de rebote).
  if (isGM()) return setState(item, { ricochetArmed: true });
  ui.notifications.info(L("gear.ricochetRequested"));
  return gmExec("approveRicochet", { actorUuid: actor.uuid, itemId: item.id, user: game.user.name });
}

function pickAmmo(actor, item) {
  const ammo = actor.itemTypes.ammo.filter((a) => (item.system.ammoVariety ?? []).includes(a.system.variety) && a.system.amount > 0);
  if (!ammo.length) {
    ui.notifications.warn(L("gear.noAmmo"));
    return Promise.resolve(null);
  }
  const options = ammo.map((a) => `<option value="${a.id}">${esc(a.name)} [x${a.system.amount}]</option>`).join("");
  return Dialog.prompt({
    title: L("gear.loadChamber"),
    content: `<div class="form-group"><select name="ammo">${options}</select></div>`,
    label: L("net.ok"),
    callback: (html) => actor.items.get((html[0] ?? html).querySelector("[name=ammo]").value),
    rejectClose: false,
  });
}

/** Carga o vacía una recámara. RED ve en el cargador el total de recámaras cargadas. */
async function setChamber(actor, item, index, load) {
  const cap = find(weaponCaps(item), "multi-chamber");
  const chambers = Array.from({ length: cap.chambers }, (_, i) => getState(item).chambers?.[i] ?? null);
  if (load) {
    const ammo = await pickAmmo(actor, item);
    if (!ammo) return;
    await ammo.update({ "system.amount": ammo.system.amount - 1 });
    chambers[index] = ammoSnapshot(ammo);
  } else {
    const back = actor.items.get(chambers[index]?.id);
    if (back) await back.update({ "system.amount": back.system.amount + 1 });
    chambers[index] = null;
  }
  await item.update({ "system.magazine.value": chambers.filter(Boolean).length, [`flags.${MODULE_ID}.state.chambers`]: chambers });
}

async function activate(actor, item, cap) {
  const name = item.name;
  if (activationOf(actor, item)) return ui.notifications.warn(L("gear.alreadyActive", { name }));
  if (cooldownOf(actor, item)) return ui.notifications.warn(L("gear.onCooldown", { name }));
  if (cap.exclusiveGroup && carriersOf(actor).some((e) => timed(e).activation?.group === cap.exclusiveGroup)) return ui.notifications.warn(L("gear.exclusiveActive", { name }));
  if (!conditionsMet(cap.requires, actor)) return ui.notifications.warn(L("gear.requiresUnmet", { name }));
  const ctx = { label: name, sourceUuid: item.uuid, sourceActorUuid: actor.uuid };
  const activation = { itemId: item.id, name, group: cap.exclusiveGroup ?? null, cooldown: cap.cooldown ?? null };
  if (cap.duration) await createCarrier(actor, { ...ctx, label: L("gear.activeName", { name }) }, { duration: cap.duration, timed: { activation }, img: "icons/svg/aura.svg" });
  else if (cap.cooldown) await createCarrier(actor, { ...ctx, label: L("gear.cooldownName", { name }) }, { duration: cap.cooldown, timed: { cooldown: { itemId: item.id } }, img: "icons/svg/clockwork.svg" });
  await chat(actor, L(cap.action === "action" ? "gear.activatedAction" : "gear.activatedFree", { actor: esc(actor.name), name: esc(name) }));
  const operations = [...(cap.humanityCost ? [{ op: "humanity", formula: cap.humanityCost, sign: "loss" }] : []), ...(cap.onActivate ?? [])];
  if (!operations.length) return;
  const data = { sourceUuid: item.uuid, sourceActorUuid: actor.uuid, sourceName: actor.name, targetUuid: actor.uuid, label: name, operations, gmConfirm: cap.gmConfirm };
  return actor.isOwner && !cap.gmConfirm ? applyOperations(data) : gmExec("applyOperations", data);
}

// ---------------------------------------------------------------- consola de equipo

const consoles = new Set();
const refreshConsoles = () => consoles.forEach((c) => c.rendered && c.render(false));
const remaining = (effect) => {
  const r = effect?.duration?.remaining;
  if (typeof r !== "number") return "";
  return effect.duration.rounds ? ` (${Math.ceil(r)} ${L("gear.rounds")})` : ` (${Math.ceil(r / 60)} min)`;
};

class GearConsole extends Application {
  constructor(actor) {
    super({ title: L("gear.consoleTitle", { actor: actor.name }) });
    this.actor = actor;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["er2070-console"], width: 560, height: "auto", resizable: true });
  }

  get id() {
    return `er2070-gear-${this.actor.uuid.replaceAll(".", "-")}`;
  }

  weaponRow(item) {
    const actor = this.actor;
    const caps = weaponCaps(item);
    const active = activeCaps(caps, actor);
    const state = getState(item);
    const badges = [];
    const buttons = [];
    const mag = item.system.isRanged ? ` · ${item.system.magazine?.value ?? 0}/${item.system.magazine?.max ?? 0}` : "";
    const smart = find(active, "smart-weapon");
    if (smart) badges.push(L(smartOk(smart, actor) ? "gear.smartLinked" : "gear.smartNotLinked"));
    if (find(active, "crit-bonus-damage")) badges.push(L("gear.critBonus", { value: active.filter((c) => c.type === "crit-bonus-damage").reduce((n, c) => n + c.value, 0) }));
    if (find(active, "crit-choose")) badges.push(L("gear.critChoose", { rolls: find(active, "crit-choose").rolls ?? 2 }));
    const charge = find(active, "chargeable");
    if (charge) {
      const effect = chargeOf(actor, item);
      if (effect) badges.push(L("gear.charged") + remaining(effect));
      else buttons.push(`<button data-action="charge" data-item="${item.id}">${L("gear.chargeBtn")}</button>`);
    }
    if (find(active, "bolt-action") && state.boltLocked) {
      badges.push(L("gear.boltLockedBadge"));
      buttons.push(`<button data-action="bolt" data-item="${item.id}">${L("gear.boltBtn")}</button>`);
    }
    if (find(active, "ricochet")) buttons.push(`<button data-action="ricochet" data-item="${item.id}">${L(state.ricochetArmed ? "gear.ricochetCancel" : "gear.ricochetArm")}</button>`);
    if (state.ricochetArmed) badges.push(L("gear.ricochetArmed"));
    let chambers = "";
    const multi = find(active, "multi-chamber");
    if (multi) {
      chambers = Array.from({ length: multi.chambers }, (_, i) => {
        const ch = state.chambers?.[i];
        const current = (state.activeChamber ?? 0) === i;
        return `<li>${L("gear.chamber", { n: i + 1 })}: ${ch ? esc(ch.name) : L("gear.empty")} ${current ? `· <strong>${L("gear.activeChamber")}</strong>` : `<button data-action="chamber-active" data-item="${item.id}" data-index="${i}">${L("gear.useChamber")}</button>`}
          <button data-action="${ch ? "chamber-unload" : "chamber-load"}" data-item="${item.id}" data-index="${i}">${L(ch ? "gear.unload" : "gear.load")}</button></li>`;
      }).join("");
      chambers = `<ul>${chambers}</ul>`;
    }
    const inactive = caps.length - active.length;
    if (inactive) badges.push(L("gear.inactiveCaps", { count: inactive }));
    return `<li><strong>${esc(item.name)}</strong>${mag}${badges.length ? `<div class="er2070-floor">${badges.join(" · ")}</div>` : ""}${chambers}
      ${buttons.length ? `<div class="er2070-buttons">${buttons.join("")}</div>` : ""}</li>`;
  }

  buildHtml() {
    const actor = this.actor;
    const weapons = actor.items.filter((i) => (i.type === "weapon" || (i.type === "cyberware" && i.system.isInstalled)) && weaponCaps(i).some((c) => WEAPON_CAPS.has(c.type)))
      .map((i) => this.weaponRow(i)).join("");

    const implants = actorCapabilities(actor, "activation").map((cap) => {
      const item = cap.item;
      const on = activationOf(actor, item);
      const cd = cooldownOf(actor, item);
      const status = on ? L("gear.active") + remaining(on) : cd ? L("gear.cooldown") + remaining(cd) : L("gear.ready");
      return `<li><strong>${esc(item.name)}</strong> · ${status}
        ${!on && !cd ? `<button data-action="activate" data-item="${item.id}" data-cap="${cap.id}">${L("gear.activateBtn")}</button>` : ""}</li>`;
    }).join("");

    const armed = actor.getFlag(MODULE_ID, "state.effArmed");
    const effective = stackSatisfied(actorCapabilities(actor, "effective-stat")).map((cap) => {
      const statName = game.i18n.localize(`CPR.global.stats.${cap.stat}`);
      const scopes = (cap.scope ?? []).map((s) => L(`gear.scope.${s}`)).join(", ");
      const rollable = (cap.scope ?? []).some((s) => ["grapple", "forceObject"].includes(s));
      const isArmed = armed?.stat === cap.stat;
      return `<li>${L("gear.effectiveLine", { stat: esc(statName), value: cap.value, scopes, item: esc(cap.item.name) })}
        ${rollable ? `<button data-action="${isArmed ? "eff-disarm" : "eff-arm"}" data-stat="${cap.stat}" data-scope="${(cap.scope ?? []).find((s) => ["grapple", "forceObject"].includes(s))}">${L(isArmed ? "gear.effDisarm" : "gear.effArm")}</button>` : ""}</li>`;
    }).join("");

    const none = `<p>${L("net.none")}</p>`;
    return `<div class="er2070-net">
      <h3>${L("gear.weaponsHeader")}</h3>${weapons ? `<ul>${weapons}</ul>` : none}
      <h3>${L("gear.implantsHeader")}</h3>${implants ? `<ul>${implants}</ul>` : none}
      <h3>${L("gear.effectiveHeader")}</h3>${effective ? `<ul>${effective}</ul>` : none}
    </div>`;
  }

  async _renderInner() {
    return $(this.buildHtml());
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    root.querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const actor = this.actor;
      const item = actor.items.get(b.dataset.item);
      const index = Number(b.dataset.index);
      try {
        switch (b.dataset.action) {
          case "charge": await chargeWeapon(actor, item); break;
          case "bolt": await workBolt(actor, item); break;
          case "ricochet": await toggleRicochet(actor, item); break;
          case "chamber-load": await setChamber(actor, item, index, true); break;
          case "chamber-unload": await setChamber(actor, item, index, false); break;
          case "chamber-active": await setState(item, { activeChamber: index }); break;
          case "activate": await activate(actor, item, getCapabilities(item).find((c) => c.id === b.dataset.cap)); break;
          case "eff-arm": await actor.setFlag(MODULE_ID, "state.effArmed", { stat: b.dataset.stat, scope: b.dataset.scope }); break;
          case "eff-disarm": await actor.setFlag(MODULE_ID, "state.effArmed", null); break;
        }
      } catch (err) {
        console.error(`${MODULE_ID} |`, err);
      } finally {
        this.render(false);
      }
    }));
  }

  render(force, options) {
    consoles.add(this);
    return super.render(force, options);
  }

  close(options) {
    consoles.delete(this);
    return super.close(options);
  }
}

// ---------------------------------------------------------------- instalación y estado del actor

async function onInstallCyberware(wrapped, itemId, ...args) {
  const item = this.getOwnedItem(itemId);
  if (!item) return wrapped(itemId, ...args);
  const caps = getCapabilities(item);
  const has = (type) => caps.some((c) => c.type === type);
  // Para instalar ciberequipo que no sea de grado médico hace falta un neuropuerto.
  if (setting("neuroportRequired") && !has("neuroport") && !has("medical-grade") && !actorCapabilities(this, "neuroport").length) {
    ui.notifications.warn(L("gear.needsNeuroport", { name: item.name }));
    return false;
  }
  if (!conditionsMet(caps.flatMap((c) => c.requires ?? []), this)) {
    ui.notifications.warn(L("gear.requiresUnmet", { name: item.name }));
    return false;
  }
  const group = find(caps, "activation")?.exclusiveGroup;
  if (group && actorCapabilities(this, "activation").some((c) => c.exclusiveGroup === group && c.item.id !== item.id)) {
    ui.notifications.warn(L("gear.exclusiveInstalled", { name: item.name }));
    return false;
  }
  const port = caps.find((c) => c.type === "neuroport" && c.creationFree);
  const creation = port && (await Dialog.confirm({ title: item.name, content: `<p>${L("gear.creationQuestion")}</p>` }));
  let ok;
  if (creation && item.system.isFoundational) {
    // Neuropuerto de creación: gratuito y sin pérdida de Humanidad (se instala sin el diálogo de RED).
    ok = await this.installItems([item]);
  } else ok = await wrapped(itemId, ...args);
  if (ok) {
    await item.setFlag(MODULE_ID, "install", { mode: creation ? "creation" : "later", at: game.time.worldTime });
    if (creation) {
      await this.setMaxHumanity();
      await chat(this, L("gear.creationInstalled", { actor: esc(this.name), name: esc(item.name) }));
    }
  }
  return ok;
}

/** Humanidad máxima: devuelve lo que RED resta por un neuropuerto instalado en la creación. */
function onCalcMaxHumanity(wrapped, ...args) {
  let max = wrapped(...args);
  for (const cw of this.itemTypes?.cyberware ?? []) {
    if (!cw.system.isInstalledInActor || cw.flags?.[MODULE_ID]?.install?.mode !== "creation") continue;
    if (!getCapabilities(cw).some((c) => c.type === "neuroport" && c.creationFree)) continue;
    if (cw.system.type === "borgware") max += 4;
    else if (Number.parseInt(cw.system.humanityLoss?.static, 10) > 0) max += 2;
  }
  return max;
}

function onWoundStateMods(wrapped, ...args) {
  const mod = wrapped(...args);
  if (!mod) return mod;
  const state = this.getWoundState();
  const fromEffects = carriersOf(this).some((e) => timed(e).ignoreWound?.states?.includes(state));
  const fromCyberware = actorCapabilities(this, "ignore-wound-state").some((c) => (c.states?.length ? c.states : WOUND_STATES).includes(state));
  return fromEffects || fromCyberware ? 0 : mod;
}

function onActorCreateRoll(wrapped, type, name, ...args) {
  const roll = wrapped(type, name, ...args);
  try {
    if (type === "stat" && roll) applyArmedStat(this, roll, name);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
  }
  return roll;
}

// ---------------------------------------------------------------- registro

export function registerGearHooks() {
  const item = "CONFIG.Item.documentClass.prototype";
  const actor = "CONFIG.Actor.documentClass.prototype";
  libWrapper.register(MODULE_ID, `${item}.createRoll`, onCreateRoll, "WRAPPER");
  libWrapper.register(MODULE_ID, `${item}.confirmRoll`, onConfirmRoll, "WRAPPER");
  libWrapper.register(MODULE_ID, `${actor}.installCyberware`, onInstallCyberware, "MIXED");
  libWrapper.register(MODULE_ID, `${actor}._calcMaxHumanity`, onCalcMaxHumanity, "WRAPPER");
  libWrapper.register(MODULE_ID, `${actor}.getWoundStateMods`, onWoundStateMods, "WRAPPER");
  libWrapper.register(MODULE_ID, `${actor}.createRoll`, onActorCreateRoll, "WRAPPER");

  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!["character", "mook"].includes(sheet.actor?.type)) return;
    buttons.unshift({ label: L("gear.console"), class: "er2070-gear-open", icon: "fas fa-crosshairs", onclick: () => new GearConsole(sheet.actor).render(true) });
  });

  Hooks.on("createChatMessage", (message) => {
    if (message.author?.id !== game.user.id || message.content?.includes("er2070-chat")) return;
    const entry = pendingCards.find((p) => !p.done && message.speaker?.actor === p.actorId);
    if (entry) runPending(entry);
  });

  Hooks.on("renderChatMessage", (message, html) => {
    const root = html[0] ?? html;
    root.querySelectorAll("[data-er2070-action]").forEach((b) => b.addEventListener("click", async (event) => {
      event.preventDefault();
      b.disabled = true;
      switch (b.dataset.er2070Action) {
        case "retry": await doRetry(message); break;
        case "crit-roll": await doCritRoll(message); break;
        case "crit-pick": await doCritPick(message, b.dataset.name); break;
      }
    }));
  });

  for (const hook of ["updateActor", "updateItem", "createActiveEffect", "deleteActiveEffect", "updateActiveEffect", "updateCombat"]) Hooks.on(hook, refreshConsoles);
}
