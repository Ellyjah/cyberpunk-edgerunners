import test from "node:test";
import assert from "node:assert/strict";
import { gmExec, listenSocket } from "../scripts/effects.js";

// Se ejercitan los manejadores reales, con dos remitentes DJ y una escritura asíncrona.
globalThis.Application = class {
  render() { this.renderedTitle = this.title; return this; }
};
globalThis.Handlebars = { escapeExpression: String };
const { openNetArchitecture } = await import("../scripts/netarch.js");
const delay = () => new Promise((resolve) => setTimeout(resolve, 5));

function fixture(uuid, { pack = null } = {}) {
  const primary = { id: "gm1", isGM: true }, secondary = { id: "gm2", isGM: true }, player = { id: "player", isGM: false };
  const users = new Map([[primary.id, primary], [secondary.id, secondary], [player.id, player]]);
  users.activeGM = primary;
  const player2 = { id: "player2", isGM: false }; users.set(player2.id, player2);
  users.filter = (fn) => [...users.values()].filter(fn);
  const data = { schemaVersion: 1, name: "Red de prueba", floors: Array.from({ length: 4 }, (_, i) => ({ type: "password", name: `Piso ${i}`, dv: 6 })), revealed: 0, audience: ["player"] };
  const writes = [], packets = [], warnings = [];
  const page = {
    uuid, documentName: "JournalEntryPage", pack, flags: { "edgerunners-2070": { netArchitecture: data } },
    async update(change) {
      await delay();
      if ("flags.edgerunners-2070.netArchitecture.audience" in change) { data.audience = change["flags.edgerunners-2070.netArchitecture.audience"]; return; }
      if ("flags.edgerunners-2070.netArchitecture" in change) { const next = change["flags.edgerunners-2070.netArchitecture"]; for (const k of Object.keys(data)) if (!(k in next)) delete data[k]; Object.assign(data, next); writes.push("save"); return; }
      const value = change["flags.edgerunners-2070.netArchitecture.revealed"];
      writes.push(value); data.revealed = value;
    },
  };
  let listener;
  globalThis.game = {
    user: primary, users,
    i18n: { localize: (k) => k, format: (k, d) => `${k}: ${d.name ?? ""}` },
    socket: { on: (channel, fn) => { listener = fn; }, emit: (channel, value) => packets.push(value) },
  };
  globalThis.ui = { notifications: { warn: (s) => warnings.push(s), error: (s) => warnings.push(s) } };
  globalThis.fromUuid = async (value) => { await delay(); return value === uuid ? page : null; };
  // El método que causaba el error no debe invocarse, ni siquiera para obtener el título.
  globalThis.fromUuidSync = () => { throw new Error("No se admite resolver una página de compendio síncronamente"); };
  listenSocket();
  return { data, page, writes, packets, warnings, send: (op, sender = "gm1") => listener({ name: "netArchCommand", data: { uuid, op } }, sender),
    audience: (list, sender = "gm1") => listener({ name: "netArchAudience", data: { uuid, users: list } }, sender),
    save: (draft, sender = "gm1") => listener({ name: "netArchSave", data: { uuid, data: draft, table: null } }, sender) };
}

test("A070-02: dos DJ simultáneos conservan sus dos avances", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.concurrent");
  await Promise.all([f.send("reveal", "gm1"), f.send("reveal", "gm2")]);
  assert.equal(f.data.revealed, 2);
  assert.deepEqual(f.writes, [1, 2]);
  assert.equal(f.packets.length, 2);
});

test("A070-02: revelar y ocultar concurrentes conservan el valor intermedio", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.mixed"); f.data.revealed = 2;
  await Promise.all([f.send("reveal", "gm2"), f.send("hide", "gm1")]);
  assert.equal(f.data.revealed, 2);
  assert.deepEqual(f.writes, [3, 2]);
});

test("las órdenes de jugador y las operaciones desconocidas no modifican la página", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.denied");
  await f.send("reveal", "player"); await f.send("desconocida", "gm2");
  assert.equal(f.data.revealed, 0);
  assert.deepEqual(f.writes, []); assert.equal(f.warnings.length, 2);
});

test("A070-03: página de compendio abre con título asíncrono y permanece de consulta", async () => {
  const f = fixture("Compendium.world.test.JournalEntry.test.JournalEntryPage.test", { pack: "world.test" });
  const w = await openNetArchitecture(f.page.uuid);
  assert.match(w.renderedTitle, /Red de prueba/);
  const html = await w.buildHtml();
  assert.equal((html.match(/ disabled/g) ?? []).length, 4); // 0.9.0: también «Mostrar a jugadores»
  await gmExec("netArchCommand", { uuid: f.page.uuid, op: "reveal" });
  assert.equal(f.data.revealed, 0); assert.deepEqual(f.writes, []);
  f.data.name = "Nombre actualizado";
  assert.match((await openNetArchitecture(f.page.uuid)).renderedTitle, /Nombre actualizado/);
});

test("0.9.0: revelar no abre la ventana y solo envía la vista al público", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.audience-reveal");
  await f.send("reveal");
  assert.equal(f.packets.length, 1);
  assert.deepEqual(f.packets[0].netArch.to, ["player"]);
  assert.equal(f.packets[0].netArch.open, false);
  assert.equal(f.packets[0].netArch.floors.length, 1);
  f.data.audience = [];
  await f.send("reveal");
  assert.equal(f.packets.length, 1); // sin público no sale nada
});

test("0.9.0: «Mostrar a jugadores» abre a los elegidos, cierra a los quitados y descarta ids ajenos", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.audience-show"); f.data.revealed = 2;
  await f.audience(["player2", "gm2", "fantasma", "player2"]);
  assert.deepEqual(f.data.audience, ["player2"]);
  const [closed, opened] = f.packets.map((p) => p.netArch);
  assert.deepEqual([closed.to, closed.close, closed.floors.length], [["player"], true, 0]);
  assert.deepEqual([opened.to, opened.open, opened.floors.length], [["player2"], true, 2]);
  await f.audience(["player"], "player");
  assert.deepEqual(f.data.audience, ["player2"]); // un jugador no puede cambiarlo
  assert.equal(f.warnings.length, 1);
});

const editorDraft = (n, name = "Editada") => ({ name, floors: Array.from({ length: n }, (_, i) => ({ type: "file", name: `Nuevo ${i}`, dv: 8 })) });

test("0.9.1 (H05): revelar y guardar el editor a la vez conserva la revelación", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.save-reveal");
  await Promise.all([f.send("reveal", "gm1"), f.save(editorDraft(4), "gm2")]);
  assert.equal(f.data.revealed, 1);
  assert.equal(f.data.name, "Editada");
  assert.equal(f.data.floors[0].name, "Nuevo 0");
});

test("0.9.1 (P02): cambiar el público y guardar el editor a la vez conserva el público nuevo", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.save-audience");
  await Promise.all([f.audience(["player2"], "gm1"), f.save(editorDraft(4), "gm2")]);
  assert.deepEqual(f.data.audience, ["player2"]);
  assert.equal(f.data.floors.length, 4);
});

test("0.9.1: guardar con menos pisos ajusta los revelados; un guardado de jugador se rechaza", async () => {
  const f = fixture("JournalEntry.test.JournalEntryPage.save-clamp"); f.data.revealed = 3;
  await f.save(editorDraft(2));
  assert.equal(f.data.revealed, 2);
  assert.equal(f.data.schemaVersion, 1);
  await f.save(editorDraft(1, "Jugador"), "player");
  assert.equal(f.data.name, "Editada");
  assert.equal(f.warnings.length, 1);
});
