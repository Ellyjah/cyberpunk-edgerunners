/**
 * Netrunning 2070 (M4): conexión a neuropuertos, arquitectura personal, hackeos rápidos,
 * expulsión, desconexión y contador de acciones NET.
 */
import { MODULE_ID, getCapabilities } from "./schema.js";
import { netActionsForRank, parseDvList, neuroArchitecture, redD10, attackerWins, firewallRequired, quickhackBlocked, netActionBonus } from "./rules.js";
import { L, esc, gmExec, registerHandler, resolveActor, actorCapabilities, chat, getTurn, saveTurn, combatantOf, sameActor, chooseItems, eligibleItems } from "./effects.js";

const setting = (key) => game.settings.get(MODULE_ID, key);
// Aptitudes de Interface de RED que cuentan como acción NET (Escaneo incluida en los años 2070).
const NET_ABILITIES = new Set(["scanner", "backdoor", "cloak", "control", "eyedee", "pathfinder", "slide", "virus", "zap"]);

// ---------------------------------------------------------------- datos del actor

export function interfaceRank(actor) {
  const role = actor.itemTypes?.role?.find((r) => r.id === actor.system.roleInfo?.activeNetRole);
  return role ? Number.parseInt(role.system.rank, 10) || 0 : 0;
}
const hasNeuroport = (actor) => actorCapabilities(actor, "neuroport").length > 0;
const deckOf = (actor) => actor.getEquippedCyberdeck?.() ?? null;
// Un netrunner con ciberterminal equipado siempre sabe cuándo alguien entra en su neuropuerto.
const knowsIntrusions = (actor) => Boolean(deckOf(actor));

const getNet = (actor) => foundry.utils.deepClone(actor.getFlag(MODULE_ID, "state.net") ?? { connections: [], lockouts: [] });
registerHandler("setNet", async ({ actorUuid, state }) => resolveActor(actorUuid)?.setFlag(MODULE_ID, "state.net", state));
const saveNet = (actor, state) => (actor.isOwner ? actor.setFlag(MODULE_ID, "state.net", state) : gmExec("setNet", { actorUuid: actor.uuid, state }));

/** Arquitectura del neuropuerto del objetivo, calculada al vuelo. */
export function architectureOf(target) {
  const deck = deckOf(target);
  const viaPort = actorCapabilities(target, "deck-port").length > 0;
  const blackIce = viaPort && deck
    ? deck.system.installedItems.list.map((id) => target.items.get(id)).filter((p) => p?.type === "program" && p.system.class === "blackice").map((p) => p.name)
    : [];
  return neuroArchitecture({
    selfIce: actorCapabilities(target, "self-ice").length,
    blackIce,
    barrierDvs: parseDvList(setting("selfIceDv")),
    nodeDv: setting("controlNodeDv"),
  });
}

/** Alcance máximo (m) del netrunner contra neuropuertos según su equipo; null si no puede. */
function maxRange(actor, mode) {
  if (mode === "cable") return actorCapabilities(actor, "cable-link")[0]?.maxDistance ?? setting("cableDistance");
  const deck = deckOf(actor);
  if (!deck) return null;
  const port = actorCapabilities(actor, "deck-port")[0];
  if (port) return port.range?.neuroport ?? setting("rangePortNeuroport");
  const own = getCapabilities(deck).find((c) => c.type === "deck-range");
  return own?.range?.neuroport ?? own?.range?.net ?? setting("rangeExternal");
}

/** Máximo de acciones NET este turno. */
export function netActionsMax(actor, extra = 0) {
  const cable = getNet(actor).connections.some((c) => c.mode === "cable");
  return netActionsForRank(interfaceRank(actor)) + (cable ? 1 : 0) + netActionBonus(actorCapabilities(actor, "net-actions"), { cable }) + extra;
}

// ---------------------------------------------------------------- tablero

const tokenDocOf = (actor, preferred) => preferred ?? actor.token ?? actor.getActiveTokens(false, true)[0] ?? null;
// En el hook updateToken de V12 el documento aún tiene la posición anterior: aquí se guarda la nueva.
const movedTo = new Map();
function centerOf(doc) {
  const size = canvas.grid.size;
  const pos = movedTo.get(doc.uuid) ?? doc;
  return { x: pos.x + (doc.width * size) / 2, y: pos.y + (doc.height * size) / 2 };
}
const distance = (a, b) => canvas.grid.measurePath([centerOf(a), centerOf(b)]).distance;
function wallBetween(a, b) {
  try {
    return CONFIG.Canvas.polygonBackends.sight.testCollision(centerOf(a), centerOf(b), { type: "sight", mode: "any" });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- tiradas

async function d10() {
  const rolls = [await new Roll("1d10").evaluate()];
  if ([1, 10].includes(rolls[0].total)) rolls.push(await new Roll("1d10").evaluate());
  return { ...redD10(rolls.map((r) => r.total)), rolls };
}

/** Rango de Interface + 1d10 (+ modificadores y penalización por heridas). */
async function interfaceRoll(actor, mod = 0) {
  const r = await d10();
  const wound = actor.getWoundStateMods?.() ?? 0;
  return { ...r, value: interfaceRank(actor) + r.total + mod + wound, wound };
}

const skillLevel = (actor, names) => names.map((n) => actor.getSkillLevel?.(n) ?? 0).find((v) => v > 0) ?? 0;

const critText = (r) => (r.crit === "success" ? ` (${L("net.critSuccess")})` : r.crit === "fumble" ? ` (${L("net.critFumble")})` : "");

// ---------------------------------------------------------------- contador de acciones NET

async function countNetAction(actor) {
  if (setting("actionCounter") !== "auto" || !game.combat?.started) return;
  const c = combatantOf(actor);
  if (!c || game.combat.combatant !== c) return;
  const turn = getTurn(c);
  turn.used += 1;
  await saveTurn(c, turn);
  const max = netActionsMax(actor, turn.extra);
  if (turn.used > max) {
    ui.notifications.warn(L("net.tooManyActions", { used: turn.used, max }));
    await chat(actor, L("net.tooManyActions", { used: turn.used, max }), { whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
  }
}

// ---------------------------------------------------------------- acciones

function targetToken() {
  const t = [...game.user.targets][0];
  return t?.document ?? null;
}

async function connect(actor, ownToken, mode) {
  const tgtDoc = targetToken();
  const target = tgtDoc?.actor;
  const myDoc = tokenDocOf(actor, ownToken);
  if (!target) return ui.notifications.warn(L("net.noTarget"));
  if (target === actor) return ui.notifications.warn(L("net.selfTarget"));
  if (!hasNeuroport(target)) return ui.notifications.warn(L("net.noNeuroport", { actor: target.name }));
  if (!myDoc || myDoc.parent !== tgtDoc.parent) return ui.notifications.warn(L("net.noOwnToken"));
  const state = getNet(actor);
  if (state.connections.some((c) => c.target === target.uuid)) return ui.notifications.warn(L("net.alreadyConnected"));
  const lock = state.lockouts.find((l) => l.target === target.uuid && l.until > game.time.worldTime);
  if (lock) return ui.notifications.warn(L("net.lockedOut", { minutes: Math.ceil((lock.until - game.time.worldTime) / 60) }));
  if (mode === "cable" && !hasNeuroport(actor) && !actorCapabilities(actor, "cable-link").length) return ui.notifications.warn(L("net.noCable"));

  const range = maxRange(actor, mode);
  if (range === null) return ui.notifications.warn(L("net.noDeck"));
  const dist = distance(myDoc, tgtDoc);
  if (dist > range) return ui.notifications.warn(L("net.outOfRange", { distance: Math.round(dist), range }));
  if (mode === "remote" && wallBetween(myDoc, tgtDoc)) return ui.notifications.warn(L("net.noSight"));
  if (mode === "cable") {
    const ok = await Dialog.confirm({ title: L("net.connectCable"), content: `<p>${L("net.cableCondition", { actor: esc(target.name) })}</p>` });
    if (!ok) return;
  }

  await countNetAction(actor);
  const rank = interfaceRank(actor);
  const lines = [L("net.connectTry", { actor: esc(actor.name), target: esc(target.name), mode: L(`net.mode.${mode}`) })];
  const rolls = [];
  if (firewallRequired(rank, setting("firewallAutoRank"))) {
    const fw = await interfaceRoll(actor);
    rolls.push(...fw.rolls);
    const passed = fw.value >= setting("firewallDv");
    lines.push(L("net.firewall", { value: fw.value, dv: setting("firewallDv") }) + critText(fw) + " — " + L(passed ? "net.success" : "net.failure"));
    if (!passed) {
      lines.push(L("net.firewallFail"));
      return chat(actor, lines.map((l) => `<p>${l}</p>`).join(""), { rolls });
    }
  } else lines.push(L("net.firewallAuto"));

  let alerted;
  if (knowsIntrusions(target)) {
    alerted = true;
    lines.push(L("net.targetIsNetrunner"));
  } else if (mode === "cable") {
    alerted = !target.statuses?.has("unconscious");
    lines.push(L(alerted ? "net.cableAware" : "net.cableUnaware"));
  } else {
    const att = await interfaceRoll(actor);
    const def = await d10();
    rolls.push(...att.rolls, ...def.rolls);
    const will = target.system.stats.will.value;
    alerted = !attackerWins(att.value, will + def.total);
    lines.push(L("net.stealthRoll", { att: att.value, def: will + def.total }) + " — " + L(alerted ? "net.alerted" : "net.unnoticed"));
  }

  const floors = architectureOf(target);
  const skipped = mode === "cable" ? floors.filter((f) => f.kind === "barrier").length : 0;
  state.connections.push({ target: target.uuid, targetToken: tgtDoc.uuid, mode, alerted, floor: skipped, since: game.time.worldTime });
  await saveNet(actor, state);
  if (skipped) lines.push(L("net.cableSkips", { count: skipped }));
  lines.push(L("net.connected", { target: esc(target.name) }));
  // El objetivo solo recibe el mensaje si se ha dado cuenta.
  const whisper = alerted ? undefined : game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  await chat(actor, lines.map((l) => `<p>${l}</p>`).join(""), { rolls, whisper });
}

async function breach(actor, index) {
  const state = getNet(actor);
  const conn = state.connections[index];
  const target = conn && resolveActor(conn.target);
  if (!target) return;
  const floor = architectureOf(target)[conn.floor];
  if (floor?.kind !== "barrier") return;
  await countNetAction(actor);
  const r = await interfaceRoll(actor);
  const ok = r.value >= floor.dv;
  if (ok) conn.floor += 1;
  await saveNet(actor, state);
  await chat(actor, `<p>${L("net.breach", { actor: esc(actor.name), target: esc(target.name), value: r.value, dv: floor.dv })}${critText(r)} — ${L(ok ? "net.success" : "net.failure")}</p>`, { rolls: r.rolls });
}

async function passBlackIce(actor, index) {
  if (!game.user.isGM) return;
  const state = getNet(actor);
  const conn = state.connections[index];
  if (!conn) return;
  conn.floor += 1;
  await saveNet(actor, state);
}

/** Hackeos rápidos disponibles: Items del mundo con la capacidad `quickhack`. */
function quickhackCatalog() {
  return game.items.contents.flatMap((item) => getCapabilities(item).filter((c) => c.type === "quickhack").map((cap) => ({ item, cap })));
}

function chooseQuickhack(actor, target) {
  const rank = interfaceRank(actor);
  const catalog = quickhackCatalog().sort((a, b) => a.cap.minRank - b.cap.minRank || a.item.name.localeCompare(b.item.name));
  const options = catalog.map((h, i) => `<option value="${i}" ${h.cap.minRank > rank ? "disabled" : ""}>${esc(h.cap.label ?? h.item.name)} — ${L("net.dv")} ${h.cap.dv} (${L("net.minRank")} ${h.cap.minRank})</option>`);
  if (!options.length) {
    ui.notifications.warn(L("net.noQuickhacks"));
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    new Dialog({
      title: L("net.quickhackTitle", { target: target.name }),
      content: `<form class="er2070-form">
        <label>${L("net.quickhack")} <select name="hack">${options.join("")}</select></label>
        <label>${L("net.modifier")} <input type="number" name="mod" value="0"></label>
        <label>${L("net.luck")} <input type="number" name="luck" value="0" min="0" max="${actor.system.stats.luck.value}"></label>
      </form>`,
      buttons: {
        ok: {
          label: L("net.hack"),
          callback: (html) => {
            const f = (html[0] ?? html).querySelector("form");
            resolve({ ...catalog[Number(f.hack.value)], mod: Number(f.mod.value) || 0, luck: Math.max(0, Math.min(Number(f.luck.value) || 0, actor.system.stats.luck.value)) });
          },
        },
        cancel: { label: L("editor.cancel"), callback: () => resolve(null) },
      },
      default: "ok",
      close: () => resolve(null),
    }).render(true);
  });
}

async function quickhack(actor, index) {
  const state = getNet(actor);
  const conn = state.connections[index];
  const target = conn && resolveActor(conn.target);
  if (!target) return;
  const choice = await chooseQuickhack(actor, target);
  if (!choice) return;
  const { item, cap, mod, luck } = choice;
  const c = game.combat?.started ? combatantOf(actor) : null;
  const turn = c ? getTurn(c) : null;
  const blocked = quickhackBlocked({ connection: conn, floors: architectureOf(target).length, alreadyTried: Boolean(turn?.targets.includes(target.uuid)), hack: cap, rank: interfaceRank(actor) });
  if (blocked) return ui.notifications.warn(L(`net.blocked.${blocked}`));

  await countNetAction(actor);
  if (c) {
    const fresh = getTurn(c);
    fresh.targets.push(target.uuid);
    await saveTurn(c, fresh);
  }
  if (luck) await actor.update({ "system.stats.luck.value": actor.system.stats.luck.value - luck });
  const r = await interfaceRoll(actor, mod + luck);
  const ok = r.value >= cap.dv;
  const name = cap.label ?? item.name;
  await chat(actor, `<p>${L("net.hackRoll", { actor: esc(actor.name), name: esc(name), target: esc(target.name), value: r.value, dv: cap.dv })}${critText(r)} — ${L(ok ? "net.success" : "net.failure")}</p>`, { rolls: r.rolls });
  if (!ok) return;

  if (cap.alerts !== false) {
    const latest = getNet(actor);
    const live = latest.connections.find((x) => x.target === target.uuid);
    if (live) live.alerted = true;
    await saveNet(actor, latest);
  }
  // Las elecciones del atacante se hacen aquí; las del DJ, en su cliente.
  const picks = {};
  for (const [i, op] of (cap.operations ?? []).entries()) {
    if (op.pick === "attacker") picks[i] = await chooseItems(eligibleItems(target, op), op.op === "eject-chip" ? 1 : op.count ?? 1, name);
  }
  await gmExec("applyOperations", {
    sourceUuid: item.uuid, sourceActorUuid: actor.uuid, sourceName: actor.name, targetUuid: conn.targetToken ?? conn.target,
    label: name, operations: cap.operations ?? [], picks, gmConfirm: cap.gmConfirm,
  });
}

async function disconnect(actor, index, { unsafe = false, reason = "" } = {}) {
  const state = getNet(actor);
  const [conn] = state.connections.splice(index, 1);
  if (!conn) return;
  const target = resolveActor(conn.target);
  if (unsafe) state.lockouts = [...state.lockouts.filter((l) => l.until > game.time.worldTime), { target: conn.target, until: game.time.worldTime + 3600 }];
  else await countNetAction(actor);
  await saveNet(actor, state);
  await chat(actor, unsafe
    ? `<p>${L("net.unsafe", { actor: esc(actor.name), target: esc(target?.name), reason: esc(reason) })}</p>`
    : `<p>${L("net.disconnected", { actor: esc(actor.name), target: esc(target?.name) })}</p>`);
}
registerHandler("unsafeDisconnect", async ({ actorUuid, target, reason }) => {
  const actor = resolveActor(actorUuid);
  const index = actor ? getNet(actor).connections.findIndex((c) => c.target === target) : -1;
  if (index >= 0) await disconnect(actor, index, { unsafe: true, reason });
});

/** Netrunners conectados al neuropuerto de `actor`. */
function intrudersOf(actor) {
  const tokens = canvas.scene?.tokens.filter((t) => !t.actorLink && t.actor).map((t) => t.actor) ?? [];
  return [...game.actors.contents, ...tokens].flatMap((a) =>
    (a.getFlag(MODULE_ID, "state.net")?.connections ?? []).filter((c) => sameActor(resolveActor(c.target), actor)).map((conn) => ({ actor: a, conn })));
}

async function expel(defender, intruderUuid) {
  const intruder = resolveActor(intruderUuid);
  if (!intruder) return;
  const def = await d10();
  const att = await interfaceRoll(intruder);
  const wound = defender.getWoundStateMods?.() ?? 0;
  const defValue = defender.system.stats.will.value + skillLevel(defender, ["Concentration", "Concentración"]) + def.total + wound;
  const expelled = attackerWins(defValue, att.value);
  await chat(defender, `<p>${L("net.expelRoll", { actor: esc(defender.name), intruder: esc(intruder.name), def: defValue, att: att.value })} — ${L(expelled ? "net.expelled" : "net.notExpelled")}</p>`, { rolls: [...def.rolls, ...att.rolls] });
  const conn = getNet(intruder).connections.find((c) => sameActor(resolveActor(c.target), defender));
  if (expelled && conn) await gmExec("unsafeDisconnect", { actorUuid: intruder.uuid, target: conn.target, reason: L("net.reasonExpelled") });
}

/** Al mover un token, desconecta de forma insegura lo que quede fuera de alcance. */
async function checkRanges(actor) {
  const myDoc = tokenDocOf(actor);
  if (!myDoc) return;
  for (const conn of getNet(actor).connections) {
    const tgt = fromUuidSync(conn.targetToken ?? "");
    const range = maxRange(actor, conn.mode);
    if (!tgt || tgt.parent !== myDoc.parent || range === null) continue;
    if (distance(myDoc, tgt) > range) {
      const reason = L(conn.mode === "cable" ? "net.reasonCable" : "net.reasonRange");
      await gmExec("unsafeDisconnect", { actorUuid: actor.uuid, target: conn.target, reason });
    }
  }
}

// ---------------------------------------------------------------- consola

const consoles = new Set();
const refreshConsoles = () => consoles.forEach((c) => c.rendered && c.render(false));

class NetConsole extends Application {
  constructor(actor, token) {
    super({ title: L("net.consoleTitle", { actor: actor.name }) });
    this.actor = actor;
    this.token = token;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["er2070-console"], width: 560, height: "auto", resizable: true });
  }

  get id() {
    return `er2070-console-${this.actor.uuid.replaceAll(".", "-")}`;
  }

  floorText(target, conn) {
    const floors = architectureOf(target);
    const f = floors[conn.floor];
    const n = `${Math.min(conn.floor + 1, floors.length)}/${floors.length}`;
    if (!f) return L("net.floor.done");
    if (f.kind === "barrier") return L("net.floor.barrier", { n, dv: f.dv });
    if (f.kind === "blackice") return L("net.floor.blackice", { n, name: esc(f.name) });
    return L("net.floor.node", { n });
  }

  buildHtml() {
    const actor = this.actor;
    const rank = interfaceRank(actor);
    const c = game.combat?.started ? combatantOf(actor) : null;
    const turn = c ? getTurn(c) : null;
    const max = netActionsMax(actor, turn?.extra ?? 0);
    const counter = setting("actionCounter") === "auto" && turn ? L("net.actions", { used: turn.used, max }) : L("net.actionsMax", { max });
    const state = getNet(actor);
    const tgt = targetToken()?.actor;

    const conns = state.connections.map((conn, i) => {
      const target = resolveActor(conn.target);
      if (!target) return "";
      const floor = architectureOf(target)[conn.floor];
      const buttons = [
        floor?.kind === "barrier" ? `<button data-action="breach" data-index="${i}">${L("net.breachBtn")}</button>` : "",
        floor?.kind === "blackice" && game.user.isGM ? `<button data-action="blackice" data-index="${i}">${L("net.blackIceBtn")}</button>` : "",
        floor?.kind === "node" ? `<button data-action="hack" data-index="${i}">${L("net.hack")}</button>` : "",
        `<button data-action="disconnect" data-index="${i}">${L("net.disconnect")}</button>`,
      ].join("");
      return `<li><strong>${esc(target.name)}</strong> · ${L(`net.mode.${conn.mode}`)} · ${L(conn.alerted ? "net.isAlerted" : "net.isUnaware")}
        <div class="er2070-floor">${this.floorText(target, conn)}</div><div class="er2070-buttons">${buttons}</div></li>`;
    }).join("");

    const intruders = intrudersOf(actor)
      .filter(({ conn }) => game.user.isGM || conn.alerted)
      .map(({ actor: a, conn }) => `<li>${esc(a.name)} · ${L(`net.mode.${conn.mode}`)} <button data-action="expel" data-uuid="${a.uuid}">${L("net.expel")}</button></li>`)
      .join("");

    const locks = state.lockouts.filter((l) => l.until > game.time.worldTime)
      .map((l) => `<li>${esc(resolveActor(l.target)?.name)}: ${Math.ceil((l.until - game.time.worldTime) / 60)} min</li>`).join("");

    return `<div class="er2070-net">
      <p>${L("net.rank", { rank })} · ${counter}</p>
      <h3>${L("net.connectHeader")}</h3>
      <p>${tgt ? L("net.currentTarget", { target: esc(tgt.name) }) : L("net.noTarget")}</p>
      <div class="er2070-buttons">
        <button data-action="connect-remote">${L("net.connectRemote")}</button>
        <button data-action="connect-cable">${L("net.connectCable")}</button>
      </div>
      <h3>${L("net.connectionsHeader")}</h3>${conns ? `<ul>${conns}</ul>` : `<p>${L("net.none")}</p>`}
      <h3>${L("net.intrudersHeader")}</h3>${intruders ? `<ul>${intruders}</ul>` : `<p>${L("net.none")}</p>`}
      ${locks ? `<h3>${L("net.lockoutsHeader")}</h3><ul>${locks}</ul>` : ""}
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
      const index = Number(b.dataset.index);
      try {
        switch (b.dataset.action) {
          case "connect-remote": await connect(this.actor, this.token, "remote"); break;
          case "connect-cable": await connect(this.actor, this.token, "cable"); break;
          case "breach": await breach(this.actor, index); break;
          case "blackice": await passBlackIce(this.actor, index); break;
          case "hack": await quickhack(this.actor, index); break;
          case "disconnect": await disconnect(this.actor, index); break;
          case "expel": await expel(this.actor, b.dataset.uuid); break;
        }
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

// ---------------------------------------------------------------- registro

/** Las tiradas de Interface lanzadas desde la ficha de RED también cuentan como acción NET (lo llama el envoltorio de confirmRoll de gear.js). */
export function countInterfaceRoll(item, cprRoll) {
  if (item.type === "cyberdeck" && item.actor && NET_ABILITIES.has(cprRoll?.ability) && cprRoll?.constructor?.name === "CPRInterfaceRoll") countNetAction(item.actor);
}

export function registerNetHooks() {
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    if (!["character", "mook"].includes(sheet.actor?.type)) return;
    buttons.unshift({ label: L("net.console"), class: "er2070-net-open", icon: "fas fa-network-wired", onclick: () => new NetConsole(sheet.actor, sheet.token).render(true) });
  });

  Hooks.on("updateToken", async (doc, changes) => {
    if (game.user !== game.users.activeGM || !("x" in changes || "y" in changes) || !doc.actor) return;
    movedTo.set(doc.uuid, { x: changes.x ?? doc.x, y: changes.y ?? doc.y });
    try {
      // El estado puede estar en el actor del token o en su actor del mundo (según qué ficha abrió la consola).
      const own = [...new Set([doc.actor, game.actors.get(doc.actorId)].filter(Boolean))];
      for (const actor of own) await checkRanges(actor);
      for (const { actor } of intrudersOf(doc.actor)) await checkRanges(actor);
    } finally {
      movedTo.delete(doc.uuid);
    }
  });

  for (const hook of ["updateActor", "updateCombat", "updateCombatant", "targetToken", "deleteCombat"]) Hooks.on(hook, refreshConsoles);
}
