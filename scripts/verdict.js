/**
 * Veredicto de tiradas (0.5.2).
 * - Tiradas generales (característica, habilidad, rol): desplegable de VD en la ventana de RED.
 * - Ataques con un objetivo: VD por distancia y defensa elegida por el propietario del objetivo
 *   (usar la VD o esquivar); «Tirar daño» queda oculto hasta que hay impacto.
 * - Herramientas del DJ en todas estas tarjetas: asignar objetivo y ajustar la tirada.
 * El estado vive en la bandera del mensaje de chat; RED no se modifica.
 */
import { MODULE_ID, rollSafeMode } from "./schema.js";
import { beatsDv, retryAllowed } from "./rules.js";
import { L, esc, gmExec, registerHandler, userOwns, denied } from "./effects.js";

const RED_ID = "cyberpunk-red-core";
const FLAG = "verdict";
const PATH = `flags.${MODULE_ID}.${FLAG}`;
// Tabla de dificultades del Libro de reglas (VD genérica que asigna el DJ).
export const DV_LEVELS = [["simple", 9], ["everyday", 13], ["difficult", 15], ["professional", 17], ["heroic", 21], ["incredible", 24], ["legendary", 29]];
const DEFAULT_DV = 13;
const CHECKS = new Set(["CPRStatRoll", "CPRSkillRoll", "CPRRoleRoll", "CPRInterfaceRoll"]);
const ATTACKS = { CPRAttackRoll: "single", CPRAimedAttackRoll: "aimed", CPRAutofireRoll: "autofire" };
const METERS = new Set(["m", "mt", "mts", "metro", "metros", "meter", "meters", "metre", "metres"]);
const HIT = new Set(["success", "critSuccess", "fumbleSuccess"]);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const num = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const levelKey = (dv) => DV_LEVELS.find(([, v]) => v === dv)?.[0] ?? null;
const dvName = (dv) => (levelKey(dv) ? `${dv} (${L(`verdict.dv.${levelKey(dv)}`)})` : String(dv));
const blankAdj = () => ({ mod: 0, total: null, dvSet: false, dv: null });

// La esquiva la lanza este módulo: la siguiente tirada creada es la del defensor.
let nextDodge = null;

function kindOf(roll) {
  const cls = roll?.constructor?.name;
  if (nextDodge && cls === "CPRSkillRoll") return "dodge";
  if (ATTACKS[cls]) return "attack";
  return CHECKS.has(cls) ? "check" : null;
}

// ---------------------------------------------------------------- distancia y VD

let tables = null;
async function dvTables() {
  if (!tables) {
    const pack = game.packs.get(game.settings.get(RED_ID, "dvRollTableCompendium"));
    tables = pack ? await pack.getDocuments() : [];
  }
  return tables;
}

function tokenOf(actor) {
  return actor?.token?.object
    ?? canvas.tokens?.controlled.find((t) => t.actor?.id === actor?.id)
    ?? actor?.getActiveTokens?.()[0]
    ?? null;
}

/** VD por distancia con la tabla del arma (la misma que usa la regla de RED). */
async function rangeOf(attacker, target, tableName, autofire) {
  const range = { distance: null, units: canvas.scene?.grid?.units ?? "", table: null, dv: null, reason: null };
  if (!attacker || !target || attacker.document?.parent !== target.document?.parent || target.document?.parent !== canvas.scene) return { ...range, reason: "noAttacker" };
  range.distance = Math.round(canvas.grid.measurePath([attacker.center, target.center]).distance * 10) / 10;
  if (!METERS.has(norm(range.units))) return { ...range, reason: "units" };
  const all = await dvTables();
  const base = String(tableName ?? "");
  const table = autofire ? all.find((t) => t.name.includes(base) && t.name.includes("Autofire")) : all.find((t) => t.name === base);
  if (!base || !table) return { ...range, reason: "noTable" };
  range.table = table.name;
  const d = Number.parseInt(range.distance, 10);
  const row = table.results.find((r) => r.range[0] <= d && d <= r.range[1]);
  const dv = Number.parseInt(row?.text, 10);
  if (row && String(row.text).trim() === "") return { ...range, reason: "noTable" };
  if (!Number.isFinite(dv)) return { ...range, reason: "outOfRange" };
  return { ...range, dv };
}

/** Objetivo, distancia y defensa inicial de un ataque. */
async function aimAt(d, attacker, targetToken) {
  const actor = targetToken.actor;
  const ref = Number(actor?.system?.stats?.ref?.value) || 0;
  d.target = { uuid: targetToken.document.uuid, name: targetToken.name, actorUuid: actor?.uuid ?? null, ref };
  d.range = d.ranged ? await rangeOf(attacker, targetToken, d.dvTable, d.mode === "autofire") : null;
  // A distancia y con REF menor de 8 no se pueden esquivar balas: se usa la VD sin preguntar.
  d.defense = d.ranged && ref < 8 ? defense("dv", { auto: true }) : null;
}

const defense = (type, { total = null, nat = null, crit = null, by = null, auto = false } = {}) => ({ type, total, nat, crit, by, auto });

// ---------------------------------------------------------------- creación de la tirada

/** Lo llaman los envoltorios createRoll del motor (gear.js). */
export function tagRoll(roll, actor, item) {
  const kind = kindOf(roll);
  if (!kind || !actor || roll.er2070Verdict) return;
  roll.er2070Verdict = { kind, dv: undefined, parent: kind === "dodge" ? nextDodge : null };
  if (kind === "dodge") nextDodge = null;
  const original = roll.roll;
  roll.roll = async function (...args) {
    delete this.roll;
    const out = await original.apply(this, args);
    try {
      queue(actor, await build(this, actor, item));
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
    }
    return out;
  };
}

/**
 * 0.5.5: segundo intento de la munición inteligente mejorada (Mission Kit). Lo marca gear.js al preparar el ataque;
 * la franja lo ofrece solo si el ataque falla por el margen o menos (contra la VD o la esquiva).
 */
export function markRetry(roll, cfg) {
  if (roll?.er2070Verdict?.kind === "attack") roll.er2070Verdict.retry = cfg;
}

/** Suma de las penalizaciones (modificadores negativos) de la tirada: se conservan en el segundo intento. */
function penaltiesOf(roll) {
  const mods = (roll.mods ?? []).map((m) => Number(m.value) || 0);
  const extra = (roll.additionalMods ?? []).map((v) => Number.parseInt(v, 10) || 0);
  return [...mods, ...extra].filter((v) => v < 0).reduce((a, b) => a + b, 0);
}

function critOf(roll) {
  if (roll.calculateCritical === false) return null;
  if (roll.wasCritSuccess?.()) return "success";
  return roll.wasCritFail?.() ? "fail" : null;
}

async function build(roll, actor, item) {
  const v = roll.er2070Verdict;
  const d = {
    v: 1, kind: v.kind, title: String(roll.rollTitle ?? ""), nat: roll.initialRoll, total: roll.resultTotal, crit: critOf(roll),
    actorUuid: actor.uuid, dv: null, parent: v.parent, mode: null, ranged: false, dvTable: null, attackerToken: null,
    targetCount: 0, target: null, range: null, defense: null, adj: blankAdj(), damageRolled: false,
  };
  if (v.kind === "check") d.dv = num(v.dv);
  if (v.kind === "attack") {
    if (v.retry) d.retry = { base: v.retry.base, maxMargin: v.retry.maxMargin, ignoreVisibility: v.retry.ignoreVisibility, penalties: penaltiesOf(roll), used: false, result: null };
    d.mode = ATTACKS[roll.constructor.name];
    d.ranged = Boolean(item?.system?.isRanged);
    d.dvTable = item?.system?.dvTable || null;
    const attacker = tokenOf(actor);
    d.attackerToken = attacker?.document?.uuid ?? null;
    const targets = [...game.user.targets];
    d.targetCount = targets.length;
    if (targets.length === 1) await aimAt(d, attacker, targets[0]);
  }
  return d;
}

// La tarjeta de RED se crea justo después de la tirada: se le añade la bandera antes de guardarla.
const pending = [];
function queue(actor, data) {
  const entry = { actorId: actor.id, data };
  pending.push(entry);
  setTimeout(() => pending.includes(entry) && pending.splice(pending.indexOf(entry), 1), 5000);
}

function onPreCreate(message, source, options, userId) {
  if (userId !== game.user.id || !pending.length) return;
  const content = String(source.content ?? "");
  if (!content.includes("rollcard") || content.includes("er2070-chat")) return;
  const i = pending.findIndex((p) => p.actorId === message.speaker?.actor);
  if (i < 0) return;
  const [entry] = pending.splice(i, 1);
  message.updateSource({ [PATH]: entry.data });
}

// ---------------------------------------------------------------- ventana de tirada de RED

function onRenderDialog(app, html) {
  const v = app.rollData?.er2070Verdict;
  if (!v) return;
  const root = html[0] ?? html;
  const list = root.querySelector?.(".dialog-list");
  if (!list || list.querySelector(".er2070-dv-row")) return;
  if (v.kind === "check") {
    if (v.dv === undefined) v.dv = DEFAULT_DV;
    const opts = [`<option value="">${L("verdict.dv.none")}</option>`]
      .concat(DV_LEVELS.map(([k, dv]) => `<option value="${dv}" ${num(v.dv) === dv ? "selected" : ""}>${L(`verdict.dv.${k}`)} (${dv})</option>`));
    list.insertAdjacentHTML("beforeend", `<li class="dialog-item flexrow er2070-dv-row">
      <div class="dialog-item-name text-nowrap">${L("verdict.dialog.dv")}:</div>
      <div class="dialog-item-input text-nowrap"><select class="er2070-dv-select">${opts.join("")}</select></div></li>`);
    // Se guarda al momento: RED resuelve la tirada antes de volver a enviar el formulario.
    list.querySelector(".er2070-dv-select").addEventListener("change", (e) => { v.dv = e.target.value === "" ? null : Number(e.target.value); });
    return;
  }
  if (v.kind === "dodge") {
    list.insertAdjacentHTML("beforeend", `<li class="dialog-item er2070-dv-row er2070-dv-info">${L("verdict.dialog.dodge")}</li>`);
    return;
  }
  // Ataque: información de objetivo, distancia y VD.
  list.insertAdjacentHTML("beforeend", `<li class="dialog-item er2070-dv-row er2070-dv-info">…</li>`);
  const row = list.querySelector(".er2070-dv-row");
  previewAttack(app).then((text) => { row.innerHTML = text; }).catch(() => row.remove());
}

async function previewAttack(app) {
  const targets = [...game.user.targets];
  if (targets.length !== 1) return L(targets.length ? "verdict.dialog.manyTargets" : "verdict.dialog.noTarget");
  const d = { ranged: Boolean(app.item?.system?.isRanged), dvTable: app.item?.system?.dvTable, mode: ATTACKS[app.rollData.constructor.name] };
  await aimAt(d, tokenOf(app.actor), targets[0]);
  return `${L("verdict.target")}: <strong>${esc(d.target.name)}</strong> · ${rangeText(d)}`;
}

// ---------------------------------------------------------------- cálculo del veredicto

function baseDv(d) {
  return d.kind === "attack" ? d.range?.dv ?? null : d.dv;
}
function effDv(d) {
  return d.adj?.dvSet ? d.adj.dv : baseDv(d);
}
function effTotal(d) {
  return num(d.adj?.total) ?? d.total + (num(d.adj?.mod) ?? 0);
}

/** Estado: open (sin comparación), pending (esperando defensa), unknown (falta la VD) o un resultado. */
export function evaluate(d) {
  const total = effTotal(d);
  let against = null;
  let vs = "dv";
  if (d.kind === "check") {
    against = effDv(d);
    if (against === null) return { state: "open", total };
  } else if (d.kind === "attack") {
    if (d.defense?.type === "dodge") {
      against = num(d.defense.total);
      vs = "dodge";
    } else if (d.defense?.type === "dv" || (!d.target && d.adj?.dvSet)) {
      against = effDv(d);
      if (against === null) return { state: d.target || d.adj?.dvSet ? "unknown" : "open", total };
    } else if (d.target) return { state: "pending", total };
    else return { state: "open", total };
  } else return { state: "open", total };
  if (against === null) return { state: "unknown", total };
  if (d.retry?.result) {
    const t = d.retry.result.total;
    const ok = beatsDv(t, against);
    return { state: ok ? "success" : "failure", total: t, against, vs, hit: ok, retried: true, first: total };
  }
  const hit = beatsDv(total, against);
  const state = d.crit === "success" ? (hit ? "critSuccess" : "critFailure") : d.crit === "fail" ? (hit ? "fumbleSuccess" : "fumble") : hit ? "success" : "failure";
  return { state, total, against, vs, hit };
}

// ---------------------------------------------------------------- tarjeta

function rangeText(d) {
  if (!d.ranged) return L("verdict.melee");
  const r = d.range;
  if (!r) return "";
  const dist = r.distance !== null ? `${r.distance} ${esc(r.units)}` : "";
  const why = r.reason ? L(`verdict.range.${r.reason}`) : `${L("verdict.dvShort")} ${r.dv}${r.table ? ` (${esc(tableName(r.table))})` : ""}`;
  return [dist, why].filter(Boolean).join(" · ");
}

/** Nombre de la tabla de VD de RED, traducido si hay texto para ella. */
function tableName(name) {
  const key = `EDGERUNNERS2070.verdict.table.${String(name).replace(/^DV /, "").replace(/[^A-Za-z]/g, "")}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : String(name).replace(/^DV /, "");
}

function totalText(d) {
  const total = effTotal(d);
  const mod = num(d.adj?.mod) ?? 0;
  if (num(d.adj?.total) !== null) return `${total} (${d.total} → ${total})`;
  if (mod) return `${total} (${d.total} ${mod > 0 ? "+" : "−"}${Math.abs(mod)})`;
  return String(total);
}

function canDefend(d) {
  const token = d.target?.uuid ? fromUuidSync(d.target.uuid) : null;
  return userOwns(game.user, token?.actor ?? (d.target?.actorUuid ? fromUuidSync(d.target.actorUuid) : null));
}

function defenseButtons(d) {
  const mine = canDefend(d);
  const dis = mine ? "" : "disabled";
  const btn = (action, label, extra = "") => `<button type="button" class="er2070-v-btn" data-er2070-verdict="${action}" ${dis} ${extra}>${label}</button>`;
  const buttons = d.ranged
    ? [btn("use-dv", L("verdict.btn.useDv")), btn("dodge", L("verdict.btn.dodge"))]
    : [btn("dodge", L("verdict.btn.defend"))];
  if (!d.ranged && game.user.isGM) buttons.push(`<button type="button" class="er2070-v-btn" data-er2070-verdict="gm-dv">${L("verdict.btn.gmDv")}</button>`);
  const wait = mine ? "" : `<div class="er2070-v-wait">${L("verdict.waiting", { name: esc(d.target.name) })}</div>`;
  return `<div class="er2070-v-buttons">${buttons.join("")}</div>${wait}`;
}

/** «Tirar daño» en la franja: sustituye a la gota de RED (que queda oculta) y la pulsa por debajo. */
function damageButton(d) {
  if (!game.user.isGM && !userOwns(game.user, fromUuidSync(d.actorUuid))) return "";
  return `<div class="er2070-v-buttons"><button type="button" class="er2070-v-btn er2070-v-damage" data-er2070-verdict="roll-damage"><i class="fas fa-droplet"></i> ${L("verdict.btn.rollDamage")}</button></div>`;
}

/** ¿Se puede ofrecer el segundo intento? Falla por el margen o menos; sin VD conocida, se pedirá a mano. */
function retryOffer(d, ev) {
  if (d.kind !== "attack" || !d.retry || d.retry.used) return false;
  if (!game.user.isGM && !userOwns(game.user, fromUuidSync(d.actorUuid))) return false;
  if (ev.state === "open" || ev.state === "unknown") return true;
  if (ev.hit || ev.against === undefined || ev.against === null) return false;
  return retryAllowed(ev.total, ev.against, d.retry.maxMargin);
}

function retryHtml(d, ev) {
  const parts = [];
  if (d.retry?.result) {
    const r = d.retry.result;
    parts.push(`<div class="er2070-v-detail">${L("verdict.retry.done", { first: ev.first ?? d.total, total: r.total, base: d.retry.base, die: r.die, luck: r.luck, penalties: d.retry.penalties })}</div>`);
  } else if (retryOffer(d, ev)) {
    parts.push(`<div class="er2070-v-buttons"><button type="button" class="er2070-v-btn" data-er2070-verdict="retry"><i class="fas fa-crosshairs"></i> ${L("verdict.retry.btn", { base: d.retry.base, margin: d.retry.maxMargin })}</button></div>`);
  }
  return parts.join("");
}

function bannerHtml(d) {
  const tools = game.user.isGM && d.kind !== "dodge"
    ? `<span class="er2070-v-tools">
        <a data-er2070-verdict="target" data-tooltip="${L("verdict.tool.target")}"><i class="fas fa-bullseye"></i></a>
        <a data-er2070-verdict="adjust" data-tooltip="${L("verdict.tool.adjust")}"><i class="fas fa-sliders"></i></a>
      </span>`
    : "";
  if (d.kind === "dodge") return `<div class="er2070-verdict er2070-v-note">${L("verdict.dodgeCard")}</div>`;
  const ev = evaluate(d);
  const lines = [];
  if (d.kind === "attack") {
    if (d.target) lines.push(`${L("verdict.target")}: <strong>${esc(d.target.name)}</strong>${rangeText(d) ? ` · ${rangeText(d)}` : ""}`);
    else lines.push(L(d.targetCount > 1 ? "verdict.manyTargets" : "verdict.noTarget"));
  } else if (d.target) lines.push(`${L("verdict.target")}: <strong>${esc(d.target.name)}</strong>`);

  // Tirada general sin VD (Ctrl + clic): sin franja; el DJ conserva sus herramientas.
  if (ev.state === "open" && d.kind === "check" && !d.target) return tools ? `<div class="er2070-verdict er2070-v-bare">${tools}</div>` : "";

  let body = "";
  if (ev.state === "pending") body = `<div class="er2070-v-detail">${L("verdict.total")} ${totalText(d)}</div>${defenseButtons(d)}`;
  else if (ev.state === "unknown") body = `<div class="er2070-v-detail">${L("verdict.total")} ${totalText(d)} · ${L("verdict.noDv")}</div>${retryHtml(d, ev)}`;
  else if (ev.state === "open") body = d.kind === "attack" ? `${retryHtml(d, ev)}${damageButton(d)}` : `<div class="er2070-v-detail">${L("verdict.total")} ${totalText(d)}</div>`;
  else {
    const before = baseDv(d);
    const dvChanged = d.adj?.dvSet && before !== d.adj.dv;
    // En los ataques la VD sale de la tabla de distancia: solo el número.
    const dvText = d.kind === "attack" ? String(ev.against) : dvName(ev.against);
    const vs = ev.vs === "dodge"
      ? L(d.ranged ? "verdict.vsDodge" : "verdict.vsDefense", { value: ev.against, name: esc(d.target?.name ?? "") })
      : `${L("verdict.dvShort")} ${dvText}${dvChanged ? ` · ${L("verdict.before", { value: before ?? L("verdict.dv.none") })}` : ""}`;
    const margin = d.mode === "autofire" && ev.hit ? ` · ${L("verdict.margin", { value: ev.total - ev.against })}` : "";
    const label = L(`verdict.${d.kind === "attack" ? "attack" : "check"}.${ev.state}`);
    const warn = d.kind === "attack" && d.damageRolled && !ev.hit ? `<div class="er2070-v-warn">${L("verdict.damageWarning")}</div>` : "";
    const shown = ev.retried ? `${ev.total} (${L("verdict.retry.label")})` : totalText(d);
    body = `<div class="er2070-v-result">${label}</div><div class="er2070-v-detail">${L("verdict.total")} ${shown} · ${vs}${margin}</div>${retryHtml(d, ev)}${warn}${d.kind === "attack" && ev.hit ? damageButton(d) : ""}`;
  }
  return `<div class="er2070-verdict er2070-v-${ev.state}">${tools}${lines.map((l) => `<div class="er2070-v-line">${l}</div>`).join("")}${body}</div>`;
}

/** «Tirar daño» solo tras un impacto, cuando el ataque se resuelve con el veredicto. */
function damageLocked(d) {
  if (d.kind !== "attack") return false;
  const ev = evaluate(d);
  if (ev.state === "open") return false;
  return !HIT.has(ev.state);
}

function onRender(message, html) {
  const d = message.getFlag(MODULE_ID, FLAG);
  if (!d) return;
  const root = html[0] ?? html;
  const content = root.querySelector(".message-content") ?? root;
  content.querySelector(".er2070-verdict")?.remove();
  const banner = bannerHtml(d);
  if (banner) content.insertAdjacentHTML("beforeend", banner);
  root.querySelectorAll("[data-er2070-verdict]").forEach((el) => el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    act(message, el.dataset.er2070Verdict, event);
  }));
  if (d.kind !== "attack") return;
  const locked = damageLocked(d);
  root.querySelectorAll('[data-action="rollDamage"]').forEach((el) => {
    el.style.display = "none";
    if (!locked && !d.damageRolled) el.addEventListener("click", () => gmExec("verdict", { messageId: message.id, action: "damage" }));
  });
}

// ---------------------------------------------------------------- acciones

const write = (message, d) => message.update({ [PATH]: d });

async function act(message, action, event) {
  const d = foundry.utils.deepClone(message.getFlag(MODULE_ID, FLAG));
  if (!d) return;
  switch (action) {
    case "use-dv": return gmExec("verdict", { messageId: message.id, action: "dv" });
    case "roll-damage": {
      if (damageLocked(d)) return;
      const link = event.target.closest(".message")?.querySelector('[data-action="rollDamage"]');
      return link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }));
    }
    case "dodge": return rollDodge(message, d, event);
    case "gm-dv": return game.user.isGM && openAdjust(message, d, { defenseType: "dv" });
    case "adjust": return game.user.isGM && openAdjust(message, d);
    case "target": return game.user.isGM && assignTarget(message, d);
    case "retry": return rollRetry(message, d);
  }
}

/** 1d10 con las reglas de RED (10 explota hacia arriba, 1 hacia abajo). */
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

/** Segundo intento: base (14) + 1d10 + SUE + penalizaciones del primer disparo, contra la misma VD o esquiva. */
async function rollRetry(message, d) {
  const ev = evaluate(d);
  if (!retryOffer(d, ev)) return;
  const actor = fromUuidSync(d.actorUuid);
  if (!actor || (!game.user.isGM && !userOwns(game.user, actor))) return;
  const needDv = ev.state === "open" || ev.state === "unknown";
  const luckMax = actor.system.stats?.luck?.value ?? 0;
  const form = await Dialog.prompt({
    title: L("verdict.retry.title"),
    content: `<p>${L("verdict.retry.hint", { first: d.total, base: d.retry.base, penalties: d.retry.penalties, margin: d.retry.maxMargin })}</p>
      ${needDv ? `<div class="form-group"><label>${L("verdict.dialog.dv")}</label><input type="number" name="dv" value="15"></div>` : ""}
      <div class="form-group"><label>${L("verdict.retry.luck", { max: luckMax })}</label><input type="number" name="luck" value="0" min="0" max="${luckMax}"></div>`,
    label: L("verdict.retry.roll"),
    callback: (html) => {
      const root = html[0] ?? html;
      return { dv: needDv ? num(root.querySelector("[name=dv]").value) : null, luck: Math.max(0, Math.min(luckMax, num(root.querySelector("[name=luck]").value) ?? 0)) };
    },
    rejectClose: false,
  });
  if (!form) return;
  if (needDv && (form.dv === null || !retryAllowed(d.total, form.dv, d.retry.maxMargin))) return ui.notifications.warn(L("verdict.retry.notAllowed", { margin: d.retry.maxMargin }));
  const die = await d10Red();
  const total = d.retry.base + die.total + form.luck + d.retry.penalties;
  if (form.luck) await actor.update({ "system.stats.luck.value": luckMax - form.luck });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="er2070-chat"><p>${L("verdict.retry.card", { total, base: d.retry.base, die: die.total, luck: form.luck, penalties: d.retry.penalties })}</p></div>`, rolls: die.rolls });
  return gmExec("verdict", { messageId: message.id, action: "retry", total, die: die.total, luck: form.luck, dv: form.dv });
}

/** DJ: el objetivo es el token que tiene marcado ahora. */
async function assignTarget(message, d) {
  const targets = [...game.user.targets];
  if (targets.length !== 1) return ui.notifications.warn(L("verdict.assignOne"));
  if (d.kind === "attack") {
    const fromUuid = d.attackerToken ? fromUuidSync(d.attackerToken)?.object : null;
    const attacker = fromUuid ?? tokenOf(fromUuidSync(d.actorUuid));
    d.targetCount = 1;
    await aimAt(d, attacker, targets[0]);
    d.adj = { ...blankAdj(), mod: d.adj?.mod ?? 0, total: d.adj?.total ?? null };
  } else {
    const t = targets[0];
    d.target = { uuid: t.document.uuid, name: t.name, actorUuid: t.actor?.uuid ?? null, ref: Number(t.actor?.system?.stats?.ref?.value) || 0 };
  }
  return write(message, d);
}

/** Esquiva o defensa: la tirada normal de RED de DES + Evasión del defensor. */
async function rollDodge(message, d, event) {
  const token = fromUuidSync(d.target?.uuid);
  const actor = token?.actor;
  if (!actor || !userOwns(game.user, actor)) return;
  const skill = actor.itemTypes?.skill?.find((s) => norm(s.name) === "evasion");
  if (!skill) return ui.notifications.warn(L("verdict.noEvasion", { name: actor.name }));
  nextDodge = message.id;
  let roll;
  try {
    roll = skill.createRoll("skill", actor);
  } finally {
    nextDodge = null;
  }
  if (!roll) return;
  const keep = await roll.handleRollDialog(event, actor, skill);
  if (!keep) return;
  roll = await skill.confirmRoll(roll);
  await roll.roll();
  if (Number.isInteger(roll.luck) && roll.luck > 0) {
    const luck = actor.system.stats.luck.value;
    await actor.update({ "system.stats.luck.value": luck - Math.min(roll.luck, luck) });
  }
  roll.entityData = { actor: actor.id, token: token.id, tokens: [] };
  const { default: CPRChat } = await import(foundry.utils.getRoute(`systems/${RED_ID}/modules/chat/cpr-chat.js`));
  await CPRChat.RenderRollCard(roll);
  return gmExec("verdict", { messageId: message.id, action: "dodge", total: roll.resultTotal, nat: roll.initialRoll, crit: critOf(roll) });
}

// Defensa y marca de daño: se escriben en el cliente del DJ tras comprobar quién lo pide.
registerHandler("verdict", async (data, userId) => {
  const user = game.users.get(userId);
  const message = game.messages.get(data?.messageId);
  const d = foundry.utils.deepClone(message?.getFlag(MODULE_ID, FLAG) ?? null);
  if (!d || d.kind !== "attack") return denied(user, "verdict", "message");
  if (data.action === "damage") {
    if (!user.isGM && message.author?.id !== userId) return denied(user, "verdict", "damage");
    if (d.damageRolled) return;
    d.damageRolled = true;
    return write(message, d);
  }
  if (data.action === "retry") {
    const attacker = fromUuidSync(d.actorUuid);
    if (!d.retry || d.retry.used || !userOwns(user, attacker)) return denied(user, "verdict", "retry");
    const total = num(data.total), die = num(data.die), luck = num(data.luck) ?? 0;
    if (total === null || die === null || die < -9 || die > 20 || luck < 0 || total !== d.retry.base + die + luck + d.retry.penalties) return denied(user, "verdict", "retry");
    const ev = evaluate(d);
    if (ev.state === "open" || ev.state === "unknown") {
      const dv = num(data.dv);
      if (dv === null || !retryAllowed(d.total, dv, d.retry.maxMargin)) return denied(user, "verdict", "retry");
      d.adj = { ...blankAdj(), ...(d.adj ?? {}), dvSet: true, dv };
      if (d.target && !d.defense) d.defense = defense("dv", { by: user.name });
    } else if (ev.hit || !retryAllowed(ev.total, ev.against, d.retry.maxMargin)) return denied(user, "verdict", "retry");
    d.retry = { ...d.retry, used: true, result: { total, die, luck, by: user.name } };
    return write(message, d);
  }
  const token = d.target?.uuid ? fromUuidSync(d.target.uuid) : null;
  if (!token || !userOwns(user, token.actor)) return denied(user, "verdict", "owner");
  if (d.defense) return;
  if (data.action === "dv" && d.ranged) d.defense = defense("dv", { by: user.name });
  else if (data.action === "dodge" && (!d.ranged || d.target.ref >= 8)) {
    const total = num(data.total);
    const nat = num(data.nat);
    if (total === null || total < -60 || total > 200 || nat === null || nat < 1 || nat > 10) return denied(user, "verdict", "dodge");
    d.defense = defense("dodge", { total, nat, crit: ["success", "fail"].includes(data.crit) ? data.crit : null, by: user.name });
  } else return denied(user, "verdict", data.action);
  return write(message, d);
});

/** DJ: modificador o total final, VD y (en ataques) la defensa. */
function openAdjust(message, d, { defenseType } = {}) {
  const adj = { ...blankAdj(), ...(d.adj ?? {}) };
  const auto = baseDv(d);
  const current = adj.dvSet ? adj.dv : auto;
  const mode = !adj.dvSet ? "auto" : adj.dv === null ? "none" : levelKey(adj.dv) ? String(adj.dv) : "custom";
  const sel = (v) => (mode === v ? "selected" : "");
  const autoLabel = L("verdict.adjust.auto", { value: auto ?? L("verdict.dv.none") });
  const levels = DV_LEVELS.map(([k, v]) => `<option value="${v}" ${sel(String(v))}>${L(`verdict.dv.${k}`)} (${v})</option>`).join("");
  const isAttack = d.kind === "attack";
  const defType = defenseType ?? d.defense?.type ?? "pending";
  const dsel = (v) => (defType === v ? "selected" : "");
  const content = `<form class="er2070-adjust">
    <p class="notes">${L("verdict.adjust.hint", { nat: d.nat, total: d.total })}</p>
    <div class="form-group"><label>${L("verdict.adjust.mod")}</label><input type="number" name="mod" value="${num(adj.mod) ?? 0}"></div>
    <div class="form-group"><label>${L("verdict.adjust.total")}</label><input type="number" name="total" value="${num(adj.total) ?? ""}" placeholder="${L("verdict.adjust.computed")}"></div>
    <div class="form-group"><label>${L("verdict.dialog.dv")}</label>
      <select name="dvMode"><option value="auto" ${sel("auto")}>${autoLabel}</option><option value="none" ${sel("none")}>${L("verdict.dv.none")}</option>${levels}<option value="custom" ${sel("custom")}>${L("verdict.adjust.custom")}</option></select>
      <input type="number" name="dvCustom" value="${mode === "custom" ? current : ""}" style="max-width:5em"></div>
    ${isAttack ? `<div class="form-group"><label>${L("verdict.adjust.defense")}</label>
      <select name="defense"><option value="pending" ${dsel("pending")}>${L("verdict.adjust.defPending")}</option><option value="dv" ${dsel("dv")}>${L("verdict.adjust.defDv")}</option><option value="dodge" ${dsel("dodge")}>${L("verdict.adjust.defDodge")}</option></select>
      <input type="number" name="dodge" value="${num(d.defense?.total) ?? ""}" style="max-width:5em"></div>` : ""}
  </form>`;
  new Dialog({
    title: L("verdict.adjust.title", { title: d.title }),
    content,
    buttons: {
      save: {
        icon: '<i class="fas fa-check"></i>',
        label: L("verdict.adjust.save"),
        callback: async (html) => {
          const f = (html[0] ?? html).querySelector("form");
          const val = (n) => f.elements[n]?.value ?? "";
          const next = { mod: num(val("mod")) ?? 0, total: num(val("total")), dvSet: false, dv: null };
          const m = val("dvMode");
          if (m === "none") next.dvSet = true;
          else if (m === "custom") Object.assign(next, { dvSet: num(val("dvCustom")) !== null, dv: num(val("dvCustom")) });
          else if (m !== "auto") Object.assign(next, { dvSet: true, dv: num(m) });
          d.adj = next;
          if (isAttack) {
            const t = val("defense");
            if (t === "pending") d.defense = null;
            else if (t === "dv") d.defense = defense("dv", { by: game.user.name });
            else {
              const total = num(val("dodge"));
              if (total === null) return ui.notifications.warn(L("verdict.adjust.needDodge"));
              d.defense = defense("dodge", { total, nat: d.defense?.nat ?? null, crit: d.defense?.crit ?? null, by: game.user.name });
            }
          }
          await write(message, d);
        },
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: L("verdict.adjust.cancel") },
    },
    default: "save",
  }, { classes: ["dialog", "er2070-adjust-dialog"], width: 420 }).render(true);
}

// ---------------------------------------------------------------- registro

export function registerVerdictHooks() {
  // Modo seguro: sin desplegable de VD ni banner; la gota de daño de RED vuelve a verse.
  Hooks.on("renderCPRRollDialog", (...a) => (rollSafeMode() ? undefined : onRenderDialog(...a)));
  Hooks.on("preCreateChatMessage", (...a) => (rollSafeMode() ? undefined : onPreCreate(...a)));
  Hooks.on("renderChatMessage", (...a) => (rollSafeMode() ? undefined : onRender(...a)));
}
