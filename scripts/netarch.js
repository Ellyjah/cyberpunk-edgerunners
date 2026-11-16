/**
 * Ventana «Arquitectura de Red» (0.7.0, contrato NET-ARCH-1 de CONTRATOS.md).
 * Los datos van en la bandera `netArchitecture` de una página de journal; el motor no trae ninguna arquitectura.
 * El DJ revela los pisos de uno en uno; a los jugadores les llegan por socket solo los pisos revelados.
 */
import { MODULE_ID } from "./schema.js";
import { L, esc, registerHandler, gmExec, serialize, denied } from "./effects.js";

export const NET_ARCH_VERSION = 1;
export const FLOOR_TYPES = ["password", "blackIce", "controlNode", "file"];
const FLAG = "netArchitecture";
const CHANNEL = `module.${MODULE_ID}`;

// ---------------------------------------------------------------- lógica pura (probada en tests/netarch.test.mjs)

const isText = (v) => typeof v === "string" && v.trim() !== "";
const isUuid = (v) => typeof v === "string" && /^[A-Za-z0-9_.-]+$/.test(v) && v.includes(".");

/** Valida los datos de una arquitectura. Devuelve { ok, errors: [{ code, path, args }] }. */
export function validateNetArchitecture(data) {
  const errors = [];
  const err = (code, path, args) => errors.push({ code, path, args });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    err("notObject", FLAG);
    return { ok: false, errors };
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== NET_ARCH_VERSION) err("version", "schemaVersion", { version: NET_ARCH_VERSION });
  if (!isText(data.name)) err("name", "name");
  if (!Array.isArray(data.floors) || !data.floors.length) {
    err("floors", "floors");
    return { ok: false, errors };
  }
  data.floors.forEach((f, i) => {
    const p = `floors[${i}]`;
    if (!f || typeof f !== "object") return err("floor", p);
    if (!FLOOR_TYPES.includes(f.type)) err("type", `${p}.type`, { types: FLOOR_TYPES.join(", ") });
    if (!isText(f.name)) err("name", `${p}.name`);
    if (f.dv !== undefined && f.dv !== null && !(Number.isInteger(f.dv) && f.dv > 0)) err("dv", `${p}.dv`);
    if (f.notes !== undefined && typeof f.notes !== "string") err("notes", `${p}.notes`);
    if (f.iceUuids !== undefined && !(Array.isArray(f.iceUuids) && f.iceUuids.every(isUuid))) err("uuid", `${p}.iceUuids`);
    if (f.deviceUuid !== undefined && f.deviceUuid !== null && !isUuid(f.deviceUuid)) err("uuid", `${p}.deviceUuid`);
  });
  const r = data.revealed;
  if (r !== undefined && !(Number.isInteger(r) && r >= 0 && r <= data.floors.length)) err("revealed", "revealed", { max: data.floors.length });
  return { ok: !errors.length, errors };
}

/** Pisos revelados, ya acotados al número de pisos. */
export const revealedCount = (data) => Math.max(0, Math.min(Number.isInteger(data?.revealed) ? data.revealed : 0, data?.floors?.length ?? 0));

/** Nuevo número de pisos revelados tras una orden del DJ. */
export function nextRevealed(data, op) {
  const n = revealedCount(data);
  const total = data?.floors?.length ?? 0;
  if (op === "reveal") return Math.min(total, n + 1);
  if (op === "hide") return Math.max(0, n - 1);
  if (op === "reset") return 0;
  return n;
}

/** Lo único que ven los jugadores: nombre, tipo y VD de los pisos revelados (sin notas ni enlaces). */
export function playerView(data) {
  const floors = (data?.floors ?? []).slice(0, revealedCount(data)).map((f) => ({ type: f.type, name: String(f.name), ...(Number.isInteger(f.dv) ? { dv: f.dv } : {}) }));
  return { name: String(data?.name ?? ""), floors, total: data?.floors?.length ?? 0 };
}

// ---------------------------------------------------------------- dibujo

// Circuito esquemático por tipo de piso: trazas comunes y un símbolo central. Usa currentColor (el color del tipo).
const TRACES = `<path d="M2 20 H34 M86 20 H118 M14 20 V8 H30 M106 20 V32 H90" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <circle cx="2" cy="20" r="2" fill="currentColor"/><circle cx="118" cy="20" r="2" fill="currentColor"/>
  <circle cx="30" cy="8" r="1.8" fill="currentColor"/><circle cx="90" cy="32" r="1.8" fill="currentColor"/>`;
const SYMBOLS = {
  password: `<rect x="48" y="16" width="24" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M53 16 V11 a7 7 0 0 1 14 0 V16" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="60" cy="24" r="2.4" fill="currentColor"/>`,
  blackIce: `<path d="M34 20 L42 8 L50 32 L58 8 L66 32 L74 8 L82 32 L86 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
  controlNode: `<rect x="44" y="8" width="32" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M50 4 V8 M58 4 V8 M66 4 V8 M74 4 V8 M50 32 V36 M58 32 V36 M66 32 V36 M74 32 V36" stroke="currentColor" stroke-width="1.6"/>
    <circle cx="60" cy="20" r="4" fill="currentColor"/>`,
  file: `<path d="M48 10 H58 L62 14 H74 V32 H48 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M53 21 H69 M53 26 H65" stroke="currentColor" stroke-width="1.4"/>`,
};
const circuit = (type) => `<svg class="er2070-na-circuit" viewBox="0 0 120 40" aria-hidden="true">${TRACES}${SYMBOLS[type] ?? ""}</svg>`;

/** Tarjeta de un piso. `extra` es HTML del DJ (notas y enlaces) ya preparado. */
function card(f, i, { current = false, hidden = false, extra = "" } = {}) {
  const cls = ["er2070-na-floor", `er2070-na-${FLOOR_TYPES.includes(f.type) ? f.type : "password"}`, current ? "er2070-na-current" : "", hidden ? "er2070-na-hidden" : ""].filter(Boolean).join(" ");
  const dv = Number.isInteger(f.dv) ? `<span class="er2070-na-dv">${L("netArch.dv", { dv: f.dv })}</span>` : "";
  return `<li class="${cls}">
    <div class="er2070-na-head"><span class="er2070-na-num">${i + 1}</span><span class="er2070-na-type">${L(`netArch.type.${f.type}`)}</span>${dv}</div>
    <div class="er2070-na-name">${esc(f.name)}</div>
    ${circuit(f.type)}${extra}
  </li>`;
}

// ---------------------------------------------------------------- estado en los clientes

const playerStates = new Map(); // uuid de la página → vista de jugador recibida del DJ
const windows = new Map(); // uuid de la página → ventana abierta en este cliente

// Fuera de Foundry (pruebas con Node) no hay Application: la lógica pura se importa igual.
// En Foundry es una declaración de clase global, no una propiedad de globalThis: hay que usar typeof.
class NetArchWindow extends (typeof Application === "undefined" ? Object : Application) {
  constructor(uuid) {
    super();
    this.uuid = uuid;
    this.architectureName = "";
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { classes: ["er2070-netarch"], width: 420, height: "auto", resizable: true });
  }

  get id() {
    return `er2070-netarch-${this.uuid.replaceAll(".", "-")}`;
  }

  get title() {
    const name = game.user.isGM ? this.architectureName : playerStates.get(this.uuid)?.name;
    return L("netArch.title", { name: name ?? "" });
  }

  async buildHtml() {
    if (!game.user.isGM) {
      const s = playerStates.get(this.uuid);
      const floors = s?.floors ?? [];
      const list = floors.map((f, i) => card(f, i, { current: i === floors.length - 1 })).join("");
      return `<div class="er2070-na">
        <p class="er2070-na-progress">${L("netArch.progress", { n: floors.length, total: s?.total ?? 0 })}</p>
        ${list ? `<ol class="er2070-na-floors">${list}</ol>` : `<p>${L("netArch.nothing")}</p>`}
      </div>`;
    }
    const page = await fromUuid(this.uuid);
    const data = page?.flags?.[MODULE_ID]?.[FLAG];
    const { ok, errors } = validateNetArchitecture(data);
    if (!ok) return `<div class="er2070-na"><p>${L("netArch.invalid")}</p><ul>${errors.map((e) => `<li>${esc(e.path)}: ${L(`netArch.validation.${e.code}`, e.args ?? {})}</li>`).join("")}</ul></div>`;
    const n = revealedCount(data);
    const cards = [];
    for (const [i, f] of data.floors.entries()) {
      const links = [...(f.iceUuids ?? []), ...(f.deviceUuid ? [f.deviceUuid] : [])].map((u) => `@UUID[${u}]`).join(" ");
      const notes = f.notes ? `<p class="er2070-na-notes">${esc(f.notes)}</p>` : "";
      const enriched = links ? `<p class="er2070-na-links">${await TextEditor.enrichHTML(links, { async: true })}</p>` : "";
      cards.push(card(f, i, { current: i === n - 1, hidden: i >= n, extra: notes + enriched }));
    }
    const locked = page.pack ? `<p class="er2070-na-warn">${L("netArch.inCompendium")}</p>` : "";
    return `<div class="er2070-na er2070-na-gm">
      <p class="er2070-na-progress">${L("netArch.progress", { n, total: data.floors.length })}</p>
      ${locked}
      <div class="er2070-na-buttons">
        <button type="button" data-action="reveal" ${n >= data.floors.length || page.pack ? "disabled" : ""}><i class="fas fa-eye"></i> ${L("netArch.reveal")}</button>
        <button type="button" data-action="hide" ${n === 0 || page.pack ? "disabled" : ""}><i class="fas fa-eye-slash"></i> ${L("netArch.hide")}</button>
        <button type="button" data-action="reset" ${n === 0 || page.pack ? "disabled" : ""}><i class="fas fa-rotate-left"></i> ${L("netArch.reset")}</button>
      </div>
      <ol class="er2070-na-floors">${cards.join("")}</ol>
    </div>`;
  }

  async _renderInner() {
    return $(await this.buildHtml());
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    root.querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await command(this.uuid, b.dataset.action); } finally { this.render(false); }
    }));
  }

  render(force, options) {
    windows.set(this.uuid, this);
    return super.render(force, options);
  }

  close(options) {
    windows.delete(this.uuid);
    return super.close(options);
  }
}

/** Abre (o trae al frente) la ventana de una página. */
async function show(uuid) {
  // Las páginas incrustadas de compendio solo se pueden resolver asíncronamente en V12.
  const name = game.user.isGM ? pageData(await fromUuid(uuid))?.name ?? "" : "";
  const w = windows.get(uuid) ?? new NetArchWindow(uuid);
  if (game.user.isGM) w.architectureName = name;
  w.render(true);
  return w;
}

// ---------------------------------------------------------------- DJ

const pageData = (page) => page?.flags?.[MODULE_ID]?.[FLAG];

/** Envía a los jugadores la vista de una página. `to`: lista de usuarios (todos si falta). */
function broadcast(page, { open = false, to } = {}) {
  const data = pageData(page);
  if (!data) return;
  game.socket.emit(CHANNEL, { netArch: { uuid: page.uuid, revealed: revealedCount(data), open, ...playerView(data), ...(to ? { to } : {}) } });
}

/** Los DJ remiten las órdenes a una única autoridad, también cuando hay varios conectados. */
async function command(uuid, op) {
  if (!game.user.isGM) return;
  return gmExec("netArchCommand", { uuid, op });
}

registerHandler("netArchCommand", async ({ uuid, op }, userId) => {
  const user = game.users.get(userId);
  if (!user?.isGM || typeof uuid !== "string" || !["reveal", "hide", "reset"].includes(op)) return denied(user, "netArchCommand");
  return serialize(`netarch:${uuid}`, async () => {
    if (game.user !== game.users.activeGM || !game.users.get(userId)?.isGM) return denied(user, "netArchCommand");
    const page = await fromUuid(uuid);
    if (page?.documentName !== "JournalEntryPage") return denied(user, "netArchCommand");
    const data = pageData(page);
    if (!validateNetArchitecture(data).ok) return ui.notifications.error(L("netArch.invalid"));
    if (page.pack) return ui.notifications.warn(L("netArch.inCompendium"));
    const before = revealedCount(data);
    const value = nextRevealed(data, op);
    if (value === before) return;
    await page.update({ [`flags.${MODULE_ID}.${FLAG}.revealed`]: value });
    // Al revelar se abre en todas las pantallas; al ocultar solo se actualiza la que esté abierta.
    broadcast(page, { open: value > before });
  });
});

/** Páginas del mundo con algún piso revelado. */
const activePages = () => game.journal.contents.flatMap((j) => j.pages.contents).filter((p) => revealedCount(pageData(p)) > 0);

// Un jugador que entra tarde (o cuyo DJ acaba de entrar) pide el estado actual.
registerHandler("netArchSync", (data, userId) => {
  for (const page of activePages()) broadcast(page, { open: true, to: [userId] });
});

/** Mensajes del DJ a los jugadores. Solo se aceptan si los envía un DJ. */
function receive(message, userId) {
  const s = message?.netArch;
  if (!s || typeof s.uuid !== "string" || !game.users.get(userId)?.isGM) return;
  if (game.user.isGM) return windows.get(s.uuid)?.render(false); // otro DJ ha pulsado: refrescar
  if (Array.isArray(s.to) && !s.to.includes(game.user.id)) return;
  const w = windows.get(s.uuid);
  if (!(s.revealed > 0)) {
    playerStates.delete(s.uuid);
    return w?.close();
  }
  playerStates.set(s.uuid, { name: String(s.name ?? ""), floors: Array.isArray(s.floors) ? s.floors : [], total: Number(s.total) || 0 });
  if (s.open) show(s.uuid);
  else w?.render(false);
}

/** API: abre la ventana de una página (documento o uuid). El DJ ve la versión completa; un jugador, la suya si ya hay pisos revelados. */
export async function openNetArchitecture(pageOrUuid) {
  const uuid = typeof pageOrUuid === "string" ? pageOrUuid : pageOrUuid?.uuid;
  if (!uuid) return;
  if (!game.user.isGM) {
    if (playerStates.has(uuid)) return show(uuid);
    return ui.notifications.info(L("netArch.nothing"));
  }
  const data = pageData(await fromUuid(uuid));
  if (!data) return ui.notifications.warn(L("netArch.noData"));
  return show(uuid);
}

// ---------------------------------------------------------------- registro

const LAUNCH = "[data-er2070-net], .av2070-net-launch";

export function registerNetArchHooks() {
  // Botón en la página (solo DJ y en modo lectura).
  Hooks.on("renderJournalPageSheet", (sheet, html) => {
    if (!game.user.isGM || sheet.isEditable || !pageData(sheet.document)) return;
    const els = (html?.toArray?.() ?? [html]).filter((e) => e?.nodeType === 1);
    const slot = els.map((e) => (e.matches(LAUNCH) ? e : e.querySelector(LAUNCH))).find(Boolean);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "er2070-na-launch";
    button.innerHTML = `<i class="fas fa-network-wired"></i> ${L("netArch.open")}`;
    button.addEventListener("click", (ev) => { ev.preventDefault(); openNetArchitecture(sheet.document); });
    if (slot) slot.replaceChildren(button);
    else (els.find((e) => e.matches(".journal-page-content")) ?? els[0])?.prepend(button);
  });

  // Herramienta en los controles de token: el jugador vuelve a abrir lo revelado; el DJ, las arquitecturas activas.
  Hooks.on("getSceneControlButtons", (controls) => {
    controls.find((c) => c.name === "token")?.tools.push({
      name: "er2070-netarch",
      title: "EDGERUNNERS2070.netArch.tool",
      icon: "fas fa-network-wired",
      button: true,
      onClick: () => {
        const uuids = game.user.isGM ? activePages().map((p) => p.uuid) : [...playerStates.keys()];
        if (!uuids.length) return ui.notifications.info(L("netArch.nothing"));
        uuids.forEach((uuid) => show(uuid));
      },
    });
  });

  // Otro DJ cambia una página: refrescar su ventana.
  Hooks.on("updateJournalEntryPage", (page) => {
    const w = windows.get(page.uuid);
    if (game.user.isGM && w) {
      w.architectureName = pageData(page)?.name ?? "";
      w.render(false);
    }
  });
}

/** Se llama en «ready», cuando el socket ya está disponible. */
export function startNetArch() {
  game.socket.on(CHANNEL, receive);
  if (!game.user.isGM) { if (game.users.activeGM) gmExec("netArchSync", {}); }
  // Un DJ que entra (o recarga) después que los jugadores les reenvía el estado, sin abrirles nada.
  else if (game.user === game.users.activeGM) for (const page of activePages()) broadcast(page);
}
