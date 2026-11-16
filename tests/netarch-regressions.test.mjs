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
  const data = { schemaVersion: 1, name: "Red de prueba", floors: Array.from({ length: 4 }, (_, i) => ({ type: "password", name: `Piso ${i}`, dv: 6 })), revealed: 0 };
  const writes = [], packets = [], warnings = [];
  const page = {
    uuid, documentName: "JournalEntryPage", pack, flags: { "edgerunners-2070": { netArchitecture: data } },
    async update(change) {
      await delay();
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
  return { data, page, writes, packets, warnings, send: (op, sender = "gm1") => listener({ name: "netArchCommand", data: { uuid, op } }, sender) };
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
  assert.equal((html.match(/ disabled/g) ?? []).length, 3);
  await gmExec("netArchCommand", { uuid: f.page.uuid, op: "reveal" });
  assert.equal(f.data.revealed, 0); assert.deepEqual(f.writes, []);
  f.data.name = "Nombre actualizado";
  assert.match((await openNetArchitecture(f.page.uuid)).renderedTitle, /Nombre actualizado/);
});
