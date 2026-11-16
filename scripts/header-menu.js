/** Un único acceso a las herramientas del motor en la cabecera de cada ficha. */
import { L } from "./effects.js";

const TOOLS = new Set(["er2070-gear-open", "er2070-net-open", "er2070-humanity-open", "er2070-vendor-open"]);
const isTool = (button) => button.class?.split(/\s+/).some((c) => TOOLS.has(c));

/** Conserva el orden y los botones ajenos; solo agrupa las herramientas que ya son visibles. */
export function groupHeaderButtons(buttons, menuButton) {
  const tools = buttons.filter(isTool);
  let inserted = false;
  const grouped = buttons.flatMap((button) => {
    if (!isTool(button)) return [button];
    if (inserted) return [];
    inserted = true;
    return [menuButton];
  });
  return { buttons: grouped, tools };
}

let activeMenu;
const sheetTools = new WeakMap();

function openTools(sheet, trigger, tools) {
  if (!tools.length) return;
  if (activeMenu?.trigger === trigger) return activeMenu.close();
  activeMenu?.close(false);
  const menu = document.createElement("div");
  menu.id = `er2070-tools-${sheet.appId}`;
  menu.className = "er2070-tools-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", L("tools.label"));
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", menu.id);
  const listeners = new AbortController();
  const close = (focus = true) => {
    listeners.abort();
    menu.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-controls");
    activeMenu = undefined;
    if (focus && trigger.isConnected) trigger.focus();
  };
  activeMenu = { sheet, trigger, close };
  for (const tool of tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = tool.class;
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    const icon = document.createElement("i");
    icon.className = tool.icon;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon, document.createTextNode(` ${game.i18n.localize(tool.label)}`));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      close(false);
      tool.onclick?.call(sheet, event);
    });
    menu.appendChild(button);
  }
  // Fuera de la ficha para evitar recortes por overflow y por las cabeceras de RED.
  document.body.appendChild(menu);
  const rect = trigger.getBoundingClientRect();
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.right - bounds.width, innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - bounds.height - 8))}px`;
  const items = [...menu.querySelectorAll("button")];
  menu.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    const destination = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
    if (destination !== undefined) { event.preventDefault(); items[destination].focus(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") close();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target) && !trigger.contains(event.target)) close(false);
  }, { capture: true, signal: listeners.signal });
  window.addEventListener("resize", () => close(false), { signal: listeners.signal });
  items[0]?.focus();
}

export function registerHeaderMenuHooks() {
  // Registrar después de los hooks de Equipo, Red y Humanidad: mantienen sus permisos originales.
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const menuButton = { label: "2070 ▾", class: "er2070-tools", icon: "fas fa-bars", onclick: (event) => openTools(sheet, event.currentTarget, result.tools) };
    const result = groupHeaderButtons(buttons, menuButton);
    sheetTools.set(sheet, result.tools);
    buttons.splice(0, buttons.length, ...result.buttons);
  });
  Hooks.on("renderActorSheet", (sheet, html) => {
    if (activeMenu?.sheet === sheet) activeMenu.close(false);
    const trigger = (html[0] ?? html).querySelector(".window-header .er2070-tools");
    if (!trigger) return;
    trigger.setAttribute("role", "button");
    trigger.setAttribute("tabindex", "0");
    trigger.setAttribute("aria-label", L("tools.label"));
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.onkeydown = (event) => {
      if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      openTools(sheet, trigger, sheetTools.get(sheet) ?? []);
    };
  });
  Hooks.on("closeActorSheet", (sheet) => { if (activeMenu?.sheet === sheet) activeMenu.close(false); });
}
