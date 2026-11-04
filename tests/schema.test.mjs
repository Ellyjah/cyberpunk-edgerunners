// Pruebas de lógica pura del esquema v1. Datos sintéticos e inventados.
// Ejecutar: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, SCHEMA_VERSION, validate, migrate, getCapabilities } from "../scripts/schema.js";

const item = (type, data) => ({ type, flags: { [MODULE_ID]: data } });
const codes = (r) => r.errors.map((e) => e.code);

test("Item sin datos del módulo es válido y no tiene capacidades", () => {
  assert.deepEqual(validate({ type: "weapon", flags: {} }), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(getCapabilities({ type: "weapon", flags: {} }), []);
});

test("Capacidad válida se normaliza con valores por defecto", () => {
  const it = item("weapon", { schemaVersion: 1, capabilities: [{ id: "extra", type: "crit-bonus-damage", value: 3 }] });
  assert.equal(validate(it).ok, true);
  assert.deepEqual(getCapabilities(it), [{ enabled: true, gmConfirm: false, requires: [], id: "extra", type: "crit-bonus-damage", value: 3 }]);
});

test("Falta de parámetro obligatorio y tipo erróneo son errores", () => {
  const r = validate(item("weapon", { capabilities: [{ id: "a", type: "ammo-per-attack" }, { id: "b", type: "crit-bonus-damage", value: "x" }] }));
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), ["missingParam", "badParam"]);
});

test("Identificadores inválidos o repetidos", () => {
  const r = validate(item("gear", { capabilities: [{ id: "Mal ID", type: "bolt-action" }, { id: "x", type: "bolt-action" }, { id: "x", type: "bolt-action" }] }));
  assert.deepEqual(codes(r), ["badId", "duplicateId"]);
});

test("Tipo desconocido se conserva como aviso y no se aplica", () => {
  const it = item("gear", { capabilities: [{ id: "futuro", type: "algo-de-v2", foo: 1 }] });
  const r = validate(it);
  assert.equal(r.ok, true);
  assert.equal(r.warnings[0].code, "unknownType");
  assert.deepEqual(getCapabilities(it), []);
});

test("Anfitrión inesperado y parámetro desconocido son avisos", () => {
  const r = validate(item("armor", { capabilities: [{ id: "a", type: "bolt-action", extra: true }] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings.map((w) => w.code), ["unexpectedHost", "unknownParam"]);
});

test("Capacidad desactivada no se devuelve", () => {
  const it = item("weapon", { capabilities: [{ id: "a", type: "bolt-action", enabled: false }] });
  assert.equal(validate(it).ok, true);
  assert.deepEqual(getCapabilities(it), []);
});

test("Una capacidad con errores no impide usar las demás", () => {
  const it = item("weapon", { capabilities: [{ id: "mala", type: "min-ammo-to-fire" }, { id: "buena", type: "bolt-action" }] });
  assert.deepEqual(getCapabilities(it).map((c) => c.id), ["buena"]);
});

test("Operaciones de un hackeo ficticio: válidas, desconocidas y con duración errónea", () => {
  const ok = item("gear", {
    capabilities: [{
      id: "zumbido", type: "quickhack", minRank: 1, dv: 7, alerts: true,
      operations: [
        { op: "move-mod", value: -2, duration: { rounds: 3 } },
        { op: "direct-damage", formula: "1d6+1", timing: "endOfTargetTurn", repeat: true },
        { op: "temp-injury", injury: "Compendium.mundo.heridas.Item.abc123" },
      ],
    }],
  });
  assert.equal(validate(ok).ok, true);

  const bad = item("gear", {
    capabilities: [{ id: "malo", type: "quickhack", minRank: 1, dv: 7, operations: [{ op: "teleport" }, { op: "unconscious", duration: { rounds: 0 } }] }],
  });
  assert.deepEqual(codes(validate(bad)), ["unknownOperation", "badParam"]);
});

test("Fórmulas y referencias: se rechazan nombres y texto libre", () => {
  const r = validate(item("drug", {
    capabilities: [{ id: "d", type: "drug", primary: [{ op: "humanity", formula: "un montón", sign: "gain" }, { op: "temp-injury", injury: "Herida inventada" }] }],
  }));
  assert.deepEqual(codes(r), ["badParam", "badParam"]);
});

test("Condiciones en requires y en user-requirement", () => {
  const ok = item("weapon", {
    capabilities: [{
      id: "pesada", type: "user-requirement", condition: { type: "statAtLeast", stat: "body", value: 9 },
      requires: [{ type: "actorHasCapability", capability: "smart-interface" }],
    }],
  });
  assert.equal(validate(ok).ok, true);
  const bad = item("weapon", { capabilities: [{ id: "x", type: "user-requirement", condition: { type: "luna-llena" } }] });
  assert.deepEqual(codes(validate(bad)), ["unknownCondition"]);
});

test("Versión de esquema más nueva: error y ninguna capacidad aplicada", () => {
  const it = item("weapon", { schemaVersion: SCHEMA_VERSION + 1, capabilities: [{ id: "a", type: "bolt-action" }] });
  assert.deepEqual(codes(validate(it)), ["newerVersion"]);
  assert.deepEqual(getCapabilities(it), []);
  assert.throws(() => migrate(it.flags[MODULE_ID]));
});

test("migrate es idempotente, completa campos y conserva desconocidos", () => {
  const once = migrate({ propio: { x: 1 } });
  assert.deepEqual(once, { propio: { x: 1 }, schemaVersion: 1, capabilities: [] });
  assert.deepEqual(migrate(once), once);
  const src = { schemaVersion: 1, capabilities: [] };
  migrate(src).capabilities.push(1);
  assert.deepEqual(src.capabilities, [], "no modifica el original");
});

test("Duraciones admitidas", () => {
  const caps = [{ rounds: 20 }, { hours: 1 }, { untilEndOfTurn: "self" }, { untilFired: true }].map((duration, i) => ({ id: `c${i}`, type: "chargeable", duration }));
  assert.equal(validate(item("weapon", { capabilities: caps })).ok, true);
  const bad = [{ rounds: 1.5 }, { minutes: 1 }, { rounds: 2, hours: 1 }].map((duration, i) => ({ id: `c${i}`, type: "chargeable", duration }));
  assert.equal(validate(item("weapon", { capabilities: bad })).errors.length, 3);
});
