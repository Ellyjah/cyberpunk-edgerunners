/**
 * Humanidad, drogas, roles y economía 2070 (M6).
 * - Drogas: el efecto principal se aplica al consumir (también desde la ficha de RED) y el efecto
 *   secundario se tira al terminar su duración, como en RED.
 * - Humanidad: herramienta del DJ para incidentes y evaluación mensual (decide siempre el DJ).
 * - Compra: recargo por tienda sin tocar el precio del objeto ni la reventa; aviso de adquisición por rol.
 */
import { MODULE_ID, getCapabilities } from "./schema.js";
import { priceCategory, categoryAtLeast, acquisitionMatches, buyPrice, monthlyHumanity, beatsDv } from "./rules.js";
import { L, esc, chat, createCarrier, carriersOf, applyOperations, expireHandlers } from "./effects.js";

const setting = (key) => game.settings.get(MODULE_ID, key);
const timed = (e) => e.flags[MODULE_ID].timed;
const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

// ---------------------------------------------------------------- drogas

const drugCarrierOf = (actor, item) => carriersOf(actor).find((e) => timed(e).drug?.itemId === item.id);

/** Aplica la capacidad `drug` tras consumir una dosis. Varias dosis prolongan el efecto principal. */
async function takeDrug(actor, item) {
  const cap = getCapabilities(item).find((c) => c.type === "drug");
  if (!cap) return;
  const label = item.name;
  const ctx = (cap.primary?.length
    ? await applyOperations({ sourceUuid: item.uuid, sourceActorUuid: actor.uuid, sourceName: actor.name, targetUuid: actor.uuid, label, operations: cap.primary })
    : null) ?? {};
  const delta = ctx.humanityDelta ?? 0;
  const existing = drugCarrierOf(actor, item);
  if (existing) {
    // Reinicia la duración y acumula el cambio de Humanidad de esta dosis.
    const d = timed(existing).drug;
    await existing.update({
      "duration.startTime": game.time.worldTime,
      "duration.startRound": game.combat?.round ?? null,
      "duration.startTurn": game.combat?.turn ?? null,
      [`flags.${MODULE_ID}.timed.drug`]: { ...d, delta: (d.delta ?? 0) + delta, doses: (d.doses ?? 1) + 1 },
    });
    return chat(actor, L("life.drugProlonged", { actor: esc(actor.name), name: esc(label) }));
  }
  if (cap.duration || cap.secondary) {
    await createCarrier(actor, { label: L("life.drugEffect", { name: label }), sourceUuid: item.uuid, sourceActorUuid: actor.uuid },
      { duration: cap.duration, timed: { drug: { itemId: item.id, name: label, secondary: cap.secondary ?? null, delta, doses: 1 } }, img: "icons/svg/pill.svg" });
  }
  await chat(actor, L(cap.secondary ? "life.drugTakenSecondary" : "life.drugTaken", { actor: esc(actor.name), name: esc(label), dv: cap.secondary?.dv ?? "" }));
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

/** Al terminar el efecto principal: tirada de efecto secundario y fin de los efectos de RED de la droga. */
expireHandlers.push(async (actor, effect, t) => {
  const drug = t.drug;
  if (!drug) return;
  const item = actor.items.get(drug.itemId);
  // Los ActiveEffects propios de la droga en RED se activan al consumirla: se desactivan al terminar.
  if (item?.system?.usage === "snorted" && item.effects?.size) {
    await item.updateEmbeddedDocuments("ActiveEffect", item.effects.map((ae) => ({ _id: ae.id, disabled: true })));
  }
  const sec = drug.secondary;
  if (!sec?.dv) return;
  const skillName = sec.skill ?? "Resist Torture/Drugs";
  const skill = actor.items.find((i) => i.type === "skill" && i.name === skillName);
  const statKey = skill?.system.stat ?? "will";
  const stat = actor.system.stats?.[statKey]?.value ?? 0;
  const level = actor.getSkillLevel?.(skillName) ?? 0;
  const die = await d10Red();
  const total = stat + level + die.total;
  const pass = beatsDv(total, sec.dv);
  await chat(actor, `<p>${L("life.secondaryRoll", { actor: esc(actor.name), name: esc(drug.name), total, dv: sec.dv, stat, level, die: die.total })}</p>
    <p><strong>${L(pass ? "life.secondaryPass" : "life.secondaryFail")}</strong></p>`, { rolls: die.rolls });
  const operations = (pass ? sec.onPass : sec.onFail) ?? [];
  if (operations.length) {
    await applyOperations({ targetUuid: actor.uuid, sourceUuid: t.source, sourceActorUuid: actor.uuid, label: drug.name, operations, context: { revertDelta: drug.delta ?? 0 } });
  }
});

async function onSnort(wrapped, ...args) {
  const before = this.system.amount;
  const result = await wrapped(...args);
  try {
    if (this.actor && this.system.amount < before) await takeDrug(this.actor, this);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
  }
  return result;
}

// ---------------------------------------------------------------- Humanidad (DJ)

class HumanityTool extends Application {
  constructor(actor) {
    super({ title: L("life.humanityTitle", { actor: actor.name }) });
    this.actor = actor;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["er2070-console"], width: 520, height: "auto", resizable: true });
  }

  get id() {
    return `er2070-humanity-${this.actor.uuid.replaceAll(".", "-")}`;
  }

  buildHtml() {
    const hum = this.actor.system.derivedStats?.humanity ?? {};
    const months = this.actor.getFlag(MODULE_ID, "humanity.evaluations") ?? [];
    const last = months.at(-1);
    const sev = [1, 2, 3].map((n) => `<option value="${n}">${n}d6</option>`).join("");
    const num = (name) => `<input type="number" name="${name}" value="0" min="0" style="width:4em">`;
    return `<div class="er2070-net">
      <p>${L("life.humanityNow", { value: hum.value ?? "—", max: hum.max ?? "—" })}</p>
      <h3>${L("life.incidentHeader")}</h3>
      <div class="form-group"><select name="sign"><option value="loss">${L("life.loss")}</option><option value="gain">${L("life.gain")}</option></select>
        <select name="severity">${sev}</select></div>
      <div class="form-group"><input type="text" name="reason" placeholder="${L("life.reason")}" style="width:100%"></div>
      <div class="er2070-buttons"><button data-action="incident">${L("life.applyIncident")}</button></div>
      <h3>${L("life.monthlyHeader")}</h3>
      <p class="er2070-hint">${L("life.monthlyHint")}</p>
      <p>${L("life.lossEffects")}: 1d6 ${num("l1")} 2d6 ${num("l2")} 3d6 ${num("l3")}</p>
      <p>${L("life.gainEffects")}: 1d6 ${num("g1")} 2d6 ${num("g2")}</p>
      <p><label><input type="checkbox" name="good" data-auto="1"> ${L("life.goodLife")}</label></p>
      <div class="er2070-buttons"><button data-action="monthly">${L("life.applyMonthly")}</button></div>
      ${last ? `<p>${L("life.lastMonthly", { loss: last.loss ?? "—", gain: last.gain ?? "—", date: new Date(last.real).toLocaleDateString() })}</p>` : ""}
    </div>`;
  }

  async _renderInner() {
    return $(this.buildHtml());
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    const val = (n) => Math.max(0, Number(root.querySelector(`[name=${n}]`)?.value) || 0);
    const good = root.querySelector("[name=good]");
    // Propuesta automática de «buena vida», que el DJ puede cambiar.
    const suggest = () => {
      if (good.dataset.auto !== "1") return;
      good.checked = monthlyHumanity({ loss: [val("l1"), val("l2"), val("l3")], gain: [val("g1"), val("g2")] }).goodLife;
    };
    root.querySelectorAll("input[type=number]").forEach((i) => i.addEventListener("input", suggest));
    good.addEventListener("change", () => { good.dataset.auto = "0"; });
    root.querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        if (b.dataset.action === "incident") {
          const sign = root.querySelector("[name=sign]").value;
          const reason = root.querySelector("[name=reason]").value.trim() || L(sign === "loss" ? "life.incidentLoss" : "life.incidentGain");
          await applyHumanity(this.actor, [{ sign, formula: `${root.querySelector("[name=severity]").value}d6` }], reason);
        } else {
          const plan = monthlyHumanity({ loss: [val("l1"), val("l2"), val("l3")], gain: [val("g1"), val("g2")], goodLife: good.checked });
          if (!plan.loss && !plan.gain) return ui.notifications.info(L("life.nothingToApply"));
          await applyHumanity(this.actor, [plan.loss && { sign: "loss", formula: plan.loss }, plan.gain && { sign: "gain", formula: plan.gain }].filter(Boolean), L("life.monthlyReason"));
          const months = this.actor.getFlag(MODULE_ID, "humanity.evaluations") ?? [];
          await this.actor.setFlag(MODULE_ID, "humanity.evaluations", [...months, { worldTime: game.time.worldTime, real: Date.now(), loss: plan.loss, gain: plan.gain, goodLife: plan.goodLife }].slice(-24));
        }
      } finally {
        this.render(false);
      }
    }));
  }
}

/** Primero las pérdidas y después las ganancias (con el máximo de RED). */
function applyHumanity(actor, parts, reason) {
  const operations = parts.map((p) => ({ op: "humanity", formula: p.formula, sign: p.sign, respectMax: true }));
  return applyOperations({ targetUuid: actor.uuid, sourceActorUuid: actor.uuid, label: reason, operations });
}

// ---------------------------------------------------------------- compra: recargo y roles

/** Reglas de adquisición del ajuste de mundo; si el JSON no es válido, avisa y no se usa. */
function acquisitionRules() {
  try {
    const rules = JSON.parse(setting("roleAcquisition") || "[]");
    return Array.isArray(rules) ? rules : [];
  } catch {
    if (game.user.isGM) ui.notifications.warn(L("life.badAcquisition"));
    return [];
  }
}

function buyerOf(sheet) {
  const id = sheet.tradePartnerId || (!game.user.isGM ? game.user.character?.id : null);
  return id ? game.actors.get(id) : null;
}

/** Aviso (no bloquea) de si alguna aptitud de rol del comprador permite conseguir el artículo. */
async function acquisitionNotice(buyer, item, vendor) {
  if (!buyer) return;
  const category = priceCategory(item.system.price?.market ?? 0);
  const kind = item.system.type ? `${item.type}:${item.system.type}` : item.type;
  const rules = acquisitionRules();
  const relevant = categoryAtLeast(category, "expensive") || rules.some((r) => r.types?.some((t) => t === kind || t === item.type));
  if (!relevant) return;
  const roles = buyer.itemTypes.role.flatMap((r) => [
    { ability: r.system.mainRoleAbility, rank: Number(r.system.rank) || 0 },
    ...(r.system.abilities ?? []).map((a) => ({ ability: a.name, rank: Number(a.rank) || 0 })),
  ]);
  // Por cada aptitud, solo la regla de mayor rango que se cumple.
  const best = new Map();
  for (const m of acquisitionMatches(rules, roles, { category, kind })) if (!best.has(m.ability) || best.get(m.ability).rank < m.rank) best.set(m.ability, m);
  const matches = [...best.values()];
  const cat = game.i18n.localize(`CPR.global.priceCategory.${category}`);
  const text = matches.length
    ? L("life.acquisitionYes", { actor: esc(buyer.name), name: esc(item.name), category: esc(cat), abilities: matches.map((m) => esc(`${m.ability} ${m.rank}${m.note ? ` (${m.note})` : ""}`)).join(", ") })
    : L("life.acquisitionNo", { actor: esc(buyer.name), name: esc(item.name), category: esc(cat) });
  const whisper = [...new Set([...gmIds(), game.user.id])];
  await chat(vendor, `<p>${text}</p>`, { whisper });
}

async function onPurchase(wrapped, item, all, ...args) {
  const vendor = this.actor;
  const buyer = buyerOf(this);
  try {
    await acquisitionNotice(buyer, item, vendor);
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
  }
  const multiplier = Number(vendor.getFlag(MODULE_ID, "vendor")?.buyMultiplier ?? 1);
  if (!(multiplier > 0) || multiplier === 1) return wrapped(item, all, ...args);
  // RED cobra el precio de mercado preparado del objeto; el recargo solo vive durante esta compra.
  const base = item.system.price.market;
  const before = new Set(buyer?.items.map((i) => i.id) ?? []);
  item.system.price.market = buyPrice(base, multiplier);
  try {
    return await wrapped(item, all, ...args);
  } finally {
    item.system.price.market = base;
    // El objeto comprado conserva el precio original (la reventa no incluye el recargo).
    const fix = (buyer?.items ?? []).filter((i) => !before.has(i.id) && i.name === item.name && i.system.price && i.system.price.market !== base)
      .map((i) => ({ _id: i.id, "system.price.market": base }));
    if (fix.length) await buyer.updateEmbeddedDocuments("Item", fix);
  }
}

async function configureVendor(actor) {
  const current = actor.getFlag(MODULE_ID, "vendor")?.buyMultiplier ?? 1;
  const value = await Dialog.prompt({
    title: L("life.vendorTitle", { actor: actor.name }),
    content: `<p>${L("life.vendorHint", { corporate: setting("corporateMultiplier") })}</p>
      <div class="form-group"><label>${L("life.vendorMultiplier")}</label><input type="number" name="mult" step="0.1" min="0.1" value="${current}"></div>`,
    label: L("net.ok"),
    callback: (html) => Number((html[0] ?? html).querySelector("[name=mult]").value),
    rejectClose: false,
  });
  if (!(value > 0)) return;
  await actor.setFlag(MODULE_ID, "vendor", { buyMultiplier: value });
  ui.notifications.info(L("life.vendorSaved", { actor: actor.name, mult: value }));
}

// ---------------------------------------------------------------- registro

export function registerLifeHooks() {
  // La clase de droga de RED no está expuesta: se obtiene de un documento temporal y se publica
  // para que libWrapper pueda envolver su método de consumo.
  const DrugClass = new CONFIG.Item.documentClass({ name: "er2070", type: "drug" }).constructor;
  globalThis.ER2070_RED = { drug: DrugClass };
  libWrapper.register(MODULE_ID, "ER2070_RED.drug.prototype.snort", onSnort, "WRAPPER");
  libWrapper.register(MODULE_ID, "game.cpr.apps.CPRContainerActorSheet.prototype._purchaseItem", onPurchase, "WRAPPER");

  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!game.user.isGM) return;
    const type = sheet.actor?.type;
    if (["character", "mook"].includes(type)) {
      buttons.unshift({ label: L("life.humanityButton"), class: "er2070-humanity-open", icon: "fas fa-brain", onclick: () => new HumanityTool(sheet.actor).render(true) });
    }
    if (type === "container") {
      buttons.unshift({ label: L("life.vendorButton"), class: "er2070-vendor-open", icon: "fas fa-percent", onclick: () => configureVendor(sheet.actor) });
    }
  });
}

