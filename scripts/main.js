import { MODULE_ID, SCHEMA_VERSION, CAPABILITIES, validate, migrate, getCapabilities } from "./schema.js";
import { registerEffectHooks, listenSocket } from "./effects.js";
import { registerNetHooks } from "./net.js";

const RED_ID = "cyberpunk-red-core";
const TAB = "edgerunners-2070";
const L = (key, data) => (data ? game.i18n.format(`EDGERUNNERS2070.${key}`, data) : game.i18n.localize(`EDGERUNNERS2070.${key}`));
const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));
// Hojas con la pestaña 2070 abierta. Foundry reactiva las pestañas antes de que
// este módulo inyecte la suya, así que el estado se recuerda aquí.
const openTab = new WeakSet();

// Ajustes de mundo. Los valores por defecto siguen el Mission Kit para RED completo;
// el DJ puede cambiarlos. Se usarán a partir de M4.
const SETTINGS = {
  neuroportRequired: { type: Boolean, default: true },
  actionCounter: { type: String, default: "auto", choices: ["auto", "reminder"] },
  selfIceDv: { type: String, default: "6,8,10" },
  controlNodeDv: { type: Number, default: 10 },
  firewallDv: { type: Number, default: 6 },
  firewallAutoRank: { type: Number, default: 3 },
  rangeExternal: { type: Number, default: 6 },
  rangeExternalHardware: { type: Number, default: 8 },
  rangePortNet: { type: Number, default: 20 },
  rangePortNeuroport: { type: Number, default: 50 },
  cableDistance: { type: Number, default: 2 },
};

Hooks.once("init", () => {
  if (game.system.id !== RED_ID) return;
  for (const [key, def] of Object.entries(SETTINGS)) {
    game.settings.register(MODULE_ID, key, {
      name: `EDGERUNNERS2070.settings.${key}.name`,
      hint: `EDGERUNNERS2070.settings.${key}.hint`,
      scope: "world",
      config: true,
      type: def.type,
      default: def.default,
      choices: def.choices && Object.fromEntries(def.choices.map((c) => [c, `EDGERUNNERS2070.settings.${key}.${c}`])),
      requiresReload: false,
    });
  }
  game.modules.get(MODULE_ID).api = { schemaVersion: SCHEMA_VERSION, validate, migrate, getCapabilities };
});

// Los envoltorios de libWrapper se registran cuando RED ya ha configurado sus clases.
Hooks.once("setup", () => {
  if (game.system.id !== RED_ID) return;
  registerEffectHooks();
  registerNetHooks();
});
Hooks.once("ready", () => {
  if (game.system.id === RED_ID) listenSocket();
});

/** Traduce un mensaje de validación. */
function message(m) {
  return L(`validation.${m.code}`, { path: m.path, ...(m.args ?? {}) });
}

/** HTML de la pestaña: capacidades detectadas y resultado de la validación. */
function renderPanel(item, canEdit) {
  const data = item.flags?.[MODULE_ID];
  const { errors, warnings } = validate(item);
  const active = new Set(getCapabilities(item).map((c) => c.id));
  const caps = Array.isArray(data?.capabilities) ? data.capabilities : [];
  const rows = caps
    .map((cap) => {
      const known = Boolean(CAPABILITIES[cap?.type]);
      const state = active.has(cap?.id) ? "active" : known && cap?.enabled === false ? "disabled" : "inactive";
      return `<li class="er2070-cap er2070-${state}">
        <span class="er2070-type">${esc(cap?.type)}</span>
        <span class="er2070-id">${esc(cap?.id)}</span>
        ${cap?.label ? `<span class="er2070-label">${esc(cap.label)}</span>` : ""}
        <span class="er2070-state">${L(`state.${state}`)}</span>
      </li>`;
    })
    .join("");
  const list = (items, cls) => (items.length ? `<ul class="er2070-msgs ${cls}">${items.map((m) => `<li>${esc(message(m))}</li>`).join("")}</ul>` : "");
  return `<div class="er2070-panel">
    <p class="er2070-hint">${L("panel.hint")}</p>
    ${caps.length ? `<ul class="er2070-caps">${rows}</ul>` : `<p>${L("panel.empty")}</p>`}
    ${list(errors, "er2070-errors")}
    ${list(warnings, "er2070-warnings")}
    ${canEdit ? `<button type="button" data-action="er2070-edit"><i class="fas fa-code"></i> ${L("panel.edit")}</button>` : ""}
  </div>`;
}

/** Editor JSON de las capacidades (solo DJ). Valida antes de guardar. */
function openEditor(item, text) {
  const current = item.flags?.[MODULE_ID] ?? { schemaVersion: SCHEMA_VERSION, capabilities: [] };
  const value = text ?? JSON.stringify(current, null, 2);
  new Dialog({
    title: L("editor.title", { name: item.name }),
    content: `<p>${L("editor.hint")}</p><textarea class="er2070-json" spellcheck="false" style="width:100%;height:24em;font-family:monospace">${esc(value)}</textarea>`,
    buttons: {
      save: {
        icon: '<i class="fas fa-save"></i>',
        label: L("editor.save"),
        callback: async (html) => {
          const raw = (html[0] ?? html).querySelector(".er2070-json").value;
          let data;
          try {
            data = migrate(JSON.parse(raw));
          } catch (err) {
            ui.notifications.error(L("editor.badJson", { error: err.message }));
            return openEditor(item, raw);
          }
          const result = validate({ type: item.type, flags: { [MODULE_ID]: data } });
          if (!result.ok) {
            ui.notifications.error(L("editor.invalid", { first: message(result.errors[0]), count: result.errors.length }));
            return openEditor(item, raw);
          }
          if (result.warnings.length) ui.notifications.warn(L("editor.warnings", { count: result.warnings.length }));
          // Sustituye por completo los datos del módulo para que el editor sea fiel a lo guardado.
          await item.update({ [`flags.-=${MODULE_ID}`]: null });
          if (data.capabilities.length || Object.keys(data).length > 2) await item.update({ [`flags.${MODULE_ID}`]: data });
        },
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: L("editor.cancel") },
    },
    default: "save",
  }, { width: 600, resizable: true }).render(true);
}

Hooks.on("renderItemSheet", (sheet, html) => {
  if (game.system.id !== RED_ID) return;
  const root = html[0] ?? html;
  const nav = root.querySelector(".navtabs-item");
  const sibling = root.querySelector('.tab[data-tab="item-description"]');
  if (!nav || !sibling) return;

  nav.insertAdjacentHTML("beforeend", `<div class="tab-pink-underlay"><a class="tab-label text-small tab-indent" data-tab="${TAB}">${L("tab")}</a></div>`);
  const tab = document.createElement("div");
  tab.className = "tab er2070-tab";
  tab.dataset.group = "primary";
  tab.dataset.tab = TAB;
  tab.innerHTML = renderPanel(sheet.item, game.user.isGM && sheet.isEditable);
  sibling.parentElement.appendChild(tab);
  tab.querySelector('[data-action="er2070-edit"]')?.addEventListener("click", () => openEditor(sheet.item));

  nav.addEventListener("click", (event) => {
    const link = event.target.closest("[data-tab]");
    if (!link) return;
    if (link.dataset.tab === TAB) openTab.add(sheet);
    else openTab.delete(sheet);
  });
  // Si la hoja se vuelve a dibujar con esta pestaña abierta, reactivarla.
  if (openTab.has(sheet)) sheet._tabs?.[0]?.activate(TAB);
});
