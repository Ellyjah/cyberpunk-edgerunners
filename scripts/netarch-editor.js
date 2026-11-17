/**
 * Editor de arquitecturas de Red (0.8.0). El DJ crea o edita sin código la bandera `netArchitecture` (NET-ARCH-1) de
 * una página de journal del mundo: tipo, nombre, VD y notas de cada piso, hielos negros y dispositivo arrastrándolos,
 * y, si quiere, la tabla de pisos escrita en la página. No cambia el contrato ni la ventana de los jugadores.
 * Entradas: menú contextual de la página en el journal, botón «Editar» de la ventana del DJ y la herramienta
 * «Nueva arquitectura de Red» de los controles de token (crea un journal nuevo).
 */
import { MODULE_ID } from "./schema.js";
import { L, esc } from "./effects.js";
import { FLOOR_TYPES, validateNetArchitecture, editFloors, normalizeArchitecture, iceLabel, architectureTable, saveNetArchitecture, revealedCount } from "./netarch.js";

const FLAG = "netArchitecture";
const LAUNCH = "[data-er2070-net], .av2070-net-launch";
const TABLES = "table.er2070-na-table, table.av2070-net-table";
const typeName = (t) => L(`netArch.type.${t}`);
// Un nombre se puede reescribir solo si está vacío, es el del tipo o lo puso el propio editor (hielos, dispositivo).
const isDefaultName = (f) => !String(f.name ?? "").trim() || FLOOR_TYPES.some((t) => f.name === typeName(t)) || (f._auto && f.name === f._auto);
const isBlackIce = (d) => d?.documentName === "Item" && d.type === "program" && d.system?.class === "blackice";

/** Pone la tabla en el HTML de la página: sustituye la que haya (conservando su clase, p. ej., la de Aventuras 2070)
 *  o la añade tras el sitio del botón, que se crea al final si no existe. */
function placeTable(html, table) {
  const parse = (s) => new DOMParser().parseFromString(`<body>${s}</body>`, "text/html").body;
  const body = parse(html), fresh = parse(table).firstElementChild;
  const old = body.querySelector(TABLES);
  if (old) {
    fresh.className = old.className;
    old.replaceWith(fresh);
  } else {
    let slot = body.querySelector(LAUNCH);
    if (!slot) {
      slot = document.createElement("p");
      slot.setAttribute("data-er2070-net", "");
      (body.querySelector("article") ?? body).append(slot);
    }
    slot.after(fresh);
  }
  return body.innerHTML;
}

const tableLabels = () => ({ level: L("netArch.editor.tableLevel"), content: L("netArch.editor.tableContent"), dv: L("netArch.editor.tableDv") });
const editors = new Map(); // uuid de la página (o «new») → editor abierto

class NetArchEditor extends (typeof Application === "undefined" ? Object : Application) {
  constructor(page) {
    super();
    this.page = page ?? null;
    const data = page?.flags?.[MODULE_ID]?.[FLAG];
    this.draft = data
      ? { name: data.name, floors: foundry.utils.deepClone(data.floors) }
      : { name: page?.name ?? "", floors: [{ type: "password", name: typeName("password") }] };
    this.writeTable = !page || page.type === "text";
    this.errors = [];
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["er2070-netarch", "er2070-na-editor"], width: 600, height: "auto", resizable: true,
      dragDrop: [{ dropSelector: ".er2070-na-ed-floor" }],
    });
  }

  get key() { return this.page?.uuid ?? "new"; }
  get id() { return `er2070-netarch-editor-${this.key.replaceAll(".", "-")}`; }
  get title() { return this.page ? L("netArch.editor.titleEdit", { name: this.draft.name || this.page.name }) : L("netArch.editor.titleNew"); }

  async chip(uuid, i, k, kind) {
    const d = await fromUuid(uuid).catch(() => null);
    return `<span class="er2070-na-chip">${esc(d?.name ?? L("netArch.editor.missing"))}<a data-unlink="${kind}" data-floor="${i}" data-index="${k}" title="${L("netArch.editor.unlink")}"><i class="fas fa-times"></i></a></span>`;
  }

  async _renderInner() {
    const tool = (op, icon) => `<a data-op="${op}" title="${L(`netArch.editor.${op}`)}"><i class="fas ${icon}"></i></a>`;
    const rows = [];
    for (const [i, f] of this.draft.floors.entries()) {
      const type = FLOOR_TYPES.includes(f.type) ? f.type : "password";
      const options = FLOOR_TYPES.map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${typeName(t)}</option>`).join("");
      let links = "";
      if (type === "blackIce") links = (await Promise.all((f.iceUuids ?? []).map((u, k) => this.chip(u, i, k, "ice")))).join("") + `<span class="er2070-na-hint">${L("netArch.editor.dropIce")}</span>`;
      if (type === "controlNode") links = (f.deviceUuid ? await this.chip(f.deviceUuid, i, 0, "device") : "") + `<span class="er2070-na-hint">${L("netArch.editor.dropDevice")}</span>`;
      rows.push(`<li class="er2070-na-ed-floor er2070-na-${type}" data-floor="${i}">
        <div class="er2070-na-ed-row">
          <span class="er2070-na-num">${i + 1}</span>
          <select name="type">${options}</select>
          <input type="text" name="name" value="${esc(f.name)}" placeholder="${L("netArch.editor.floorName")}">
          <input type="number" name="dv" min="1" step="1" value="${esc(f.dv ?? "")}" placeholder="${L("netArch.editor.dv")}">
          <span class="er2070-na-ed-tools">${tool("up", "fa-arrow-up")}${tool("down", "fa-arrow-down")}${tool("duplicate", "fa-copy")}${tool("remove", "fa-trash")}</span>
        </div>
        <textarea name="notes" rows="1" placeholder="${L("netArch.editor.notes")}">${esc(f.notes ?? "")}</textarea>
        ${links ? `<div class="er2070-na-ed-links">${links}</div>` : ""}
      </li>`);
    }
    const tableOk = !this.page || this.page.type === "text";
    const errors = this.errors.length ? `<ul class="er2070-na-ed-errors">${this.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "";
    return $(`<div class="er2070-na er2070-na-ed">
      <label class="er2070-na-ed-name">${L("netArch.editor.archName")} <input type="text" name="archName" value="${esc(this.draft.name)}"></label>
      <ol class="er2070-na-ed-floors">${rows.join("")}</ol>
      <button type="button" class="er2070-na-ed-add" data-op="add"><i class="fas fa-plus"></i> ${L("netArch.editor.add")}</button>
      <label class="er2070-na-ed-table"><input type="checkbox" name="table" ${this.writeTable && tableOk ? "checked" : ""} ${tableOk ? "" : "disabled"}> ${L("netArch.editor.table")}</label>
      ${errors}
      <div class="er2070-na-buttons">
        <button type="button" data-action="save"><i class="fas fa-save"></i> ${L("netArch.editor.save")}</button>
        <button type="button" data-action="cancel"><i class="fas fa-times"></i> ${L("netArch.editor.cancel")}</button>
      </div>
    </div>`);
  }

  /** Lleva al borrador lo escrito en los campos (antes de cualquier cambio de estructura o de guardar). */
  sync() {
    const root = this.element?.[0];
    if (!root) return;
    this.draft.name = root.querySelector('[name="archName"]')?.value ?? this.draft.name;
    const table = root.querySelector('[name="table"]');
    if (table && !table.disabled) this.writeTable = table.checked;
    root.querySelectorAll(".er2070-na-ed-floor").forEach((li) => {
      const f = this.draft.floors[Number(li.dataset.floor)];
      if (!f) return;
      f.name = li.querySelector('[name="name"]').value;
      f.dv = li.querySelector('[name="dv"]').value;
      f.notes = li.querySelector('[name="notes"]').value;
    });
  }

  /** Nombre automático de un piso de hielo negro con los nombres de sus hielos. */
  async autoIceName(f) {
    if (!isDefaultName(f)) return;
    const names = (await Promise.all((f.iceUuids ?? []).map((u) => fromUuid(u).catch(() => null)))).map((d) => d?.name).filter(Boolean);
    f.name = f._auto = names.length ? iceLabel(names) : typeName("blackIce");
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0] ?? html;
    root.querySelectorAll("[data-op]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.sync();
      const li = el.closest(".er2070-na-ed-floor");
      const op = el.dataset.op;
      this.draft.floors = editFloors(this.draft.floors, op, li ? Number(li.dataset.floor) : undefined, op === "add" ? { type: "password", name: typeName("password") } : undefined);
      this.render(false);
    }));
    root.querySelectorAll('select[name="type"]').forEach((el) => el.addEventListener("change", () => {
      this.sync();
      const f = this.draft.floors[Number(el.closest(".er2070-na-ed-floor").dataset.floor)];
      const rename = isDefaultName(f);
      f.type = el.value;
      if (rename) { f.name = typeName(f.type); delete f._auto; }
      this.render(false);
    }));
    root.querySelectorAll("[data-unlink]").forEach((el) => el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      this.sync();
      const f = this.draft.floors[Number(el.dataset.floor)];
      if (el.dataset.unlink === "ice") {
        f.iceUuids.splice(Number(el.dataset.index), 1);
        await this.autoIceName(f);
      } else {
        delete f.deviceUuid;
        if (isDefaultName(f)) { f.name = typeName("controlNode"); delete f._auto; }
      }
      this.render(false);
    }));
    root.querySelector('[data-action="save"]')?.addEventListener("click", (ev) => { ev.preventDefault(); this.save(); });
    root.querySelector('[data-action="cancel"]')?.addEventListener("click", (ev) => { ev.preventDefault(); this.close(); });
  }

  _canDragDrop() { return game.user.isGM; }

  /** Hielos negros (programas de clase hielo negro) en pisos de hielo negro; un actor en un nodo de control. */
  async _onDrop(event) {
    const li = event.target?.closest?.(".er2070-na-ed-floor");
    if (!li) return;
    this.sync();
    const f = this.draft.floors[Number(li.dataset.floor)];
    const data = TextEditor.getDragEventData(event);
    const doc = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    if (!f || !doc) return;
    if (f.type === "blackIce") {
      if (!isBlackIce(doc)) return ui.notifications.warn(L("netArch.editor.notIce"));
      f.iceUuids = [...(f.iceUuids ?? []), doc.uuid];
      await this.autoIceName(f);
    } else if (f.type === "controlNode") {
      if (doc.documentName !== "Actor") return ui.notifications.warn(L("netArch.editor.notDevice"));
      f.deviceUuid = doc.uuid;
      if (isDefaultName(f)) f.name = f._auto = `${typeName("controlNode")}: ${doc.name}`;
    } else return ui.notifications.warn(L("netArch.editor.dropWhere"));
    this.render(false);
  }

  async save() {
    this.sync();
    const current = this.page ? await fromUuid(this.page.uuid) : null;
    const data = normalizeArchitecture(this.draft, revealedCount(current?.flags?.[MODULE_ID]?.[FLAG]));
    const check = validateNetArchitecture(data);
    if (!check.ok) {
      const where = (path) => {
        const m = /^floors\[(\d+)\]/.exec(path);
        return m ? L("netArch.editor.floorN", { n: Number(m[1]) + 1 }) : path === "name" ? L("netArch.editor.archName") : path;
      };
      this.errors = check.errors.map((e) => `${where(e.path)}: ${L(`netArch.validation.${e.code}`, e.args ?? {})}`);
      return this.render(false);
    }
    try {
      const table = architectureTable(data, tableLabels());
      if (!current) {
        const name = L("netArch.editor.pageName", { name: data.name });
        const content = `<p data-er2070-net=""></p>${this.writeTable ? table : ""}`;
        const entry = await JournalEntry.create({ name, pages: [{ name, type: "text", text: { format: 1, content }, flags: { [MODULE_ID]: { [FLAG]: data } } }] });
        entry?.sheet.render(true);
      } else {
        const write = this.writeTable && current.type === "text";
        await saveNetArchitecture(current, data, write ? { content: placeTable(current.text?.content ?? "", table) } : {});
      }
      ui.notifications.info(L("netArch.editor.saved", { name: data.name }));
      this.close();
    } catch (err) {
      ui.notifications.error(err.message);
    }
  }

  render(force, options) {
    editors.set(this.key, this);
    return super.render(force, options);
  }

  close(options) {
    editors.delete(this.key);
    return super.close(options);
  }
}

/** API: abre el editor de una página (documento o uuid) o, sin página, el de una arquitectura nueva. Solo DJ. */
export async function openNetArchEditor(pageOrUuid) {
  if (!game.user.isGM) return;
  const page = typeof pageOrUuid === "string" ? await fromUuid(pageOrUuid) : pageOrUuid ?? null;
  if (page && (page.documentName !== "JournalEntryPage" || page.pack)) {
    ui.notifications.warn(L("netArch.editor.inCompendium"));
    return null;
  }
  const editor = editors.get(page?.uuid ?? "new") ?? new NetArchEditor(page);
  editor.render(true);
  return editor;
}

export function registerNetArchEditorHooks() {
  // Clic derecho en una página de la lista del journal.
  Hooks.on("getJournalSheetEntryContext", (app, options) => {
    const pageOf = (li) => app.document?.pages?.get(li.data("page-id"));
    options.push({
      name: "EDGERUNNERS2070.netArch.editor.menu",
      icon: '<i class="fas fa-network-wired"></i>',
      condition: (li) => game.user.isGM && !app.document?.pack && Boolean(pageOf(li)),
      callback: (li) => openNetArchEditor(pageOf(li)),
    });
  });

  // Botón «Editar» en la ventana del DJ (no en páginas de compendio).
  Hooks.on("renderNetArchWindow", (app, html) => {
    if (!game.user.isGM || app.uuid.startsWith("Compendium.")) return;
    const row = (html[0] ?? html).querySelector?.(".er2070-na-buttons");
    if (!row || row.querySelector('[data-action="edit"]')) return;
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = "edit";
    b.innerHTML = `<i class="fas fa-pen"></i> ${L("netArch.editor.edit")}`;
    b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openNetArchEditor(app.uuid); });
    row.append(b);
  });

  // Herramienta del DJ en los controles de token: arquitectura nueva en un journal nuevo.
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    controls.find((c) => c.name === "token")?.tools.push({
      name: "er2070-netarch-new",
      title: "EDGERUNNERS2070.netArch.editor.new",
      icon: "fas fa-sitemap",
      button: true,
      onClick: () => openNetArchEditor(null),
    });
  });
}
