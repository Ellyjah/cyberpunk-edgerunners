// Pruebas del cálculo del veredicto (0.5.2). Datos inventados.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, DV_LEVELS } from "../scripts/verdict.js";

const adj = (o = {}) => ({ mod: 0, total: null, dvSet: false, dv: null, ...o });
const check = (o) => ({ kind: "check", nat: 5, total: 14, crit: null, dv: 13, target: null, adj: adj(), ...o });
const attack = (o) => ({ kind: "attack", nat: 5, total: 16, crit: null, ranged: true, target: { name: "T", ref: 6 }, range: { dv: 15 }, defense: null, adj: adj(), ...o });
const dv = { type: "dv" };

test("Tabla de dificultades del Libro de reglas", () => {
  assert.deepEqual(DV_LEVELS.map(([, v]) => v), [9, 13, 15, 17, 21, 24, 29]);
});

test("Tirada general: superar la VD; el empate falla", () => {
  assert.equal(evaluate(check({ total: 14 })).state, "success");
  assert.equal(evaluate(check({ total: 13 })).state, "failure");
  assert.equal(evaluate(check({ dv: null })).state, "open");
});

test("Casos mixtos de crítico y pifia", () => {
  assert.equal(evaluate(check({ crit: "success", total: 25 })).state, "critSuccess");
  assert.equal(evaluate(check({ crit: "success", total: 12, dv: 29 })).state, "critFailure");
  assert.equal(evaluate(check({ crit: "fail", total: 4 })).state, "fumble");
  assert.equal(evaluate(check({ crit: "fail", total: 10, dv: 9 })).state, "fumbleSuccess");
});

test("Ajustes del DJ: modificador, total final y VD (incluido «Sin VD»)", () => {
  assert.equal(evaluate(check({ total: 12, adj: adj({ mod: 2 }) })).state, "success");
  assert.equal(evaluate(check({ total: 12, adj: adj({ total: 20, mod: -5 }) })).total, 20);
  assert.equal(evaluate(check({ total: 14, adj: adj({ dvSet: true, dv: 15 }) })).state, "failure");
  assert.equal(evaluate(check({ adj: adj({ dvSet: true, dv: null }) })).state, "open");
  assert.equal(evaluate(check({ dv: null, adj: adj({ dvSet: true, dv: 9 }) })).state, "success");
});

test("Ataque: pendiente, VD por distancia y esquiva (el empate lo gana el defensor)", () => {
  assert.equal(evaluate(attack()).state, "pending");
  assert.equal(evaluate(attack({ defense: dv })).state, "success");
  assert.equal(evaluate(attack({ defense: dv, total: 15 })).state, "failure");
  assert.equal(evaluate(attack({ defense: { type: "dodge", total: 16 } })).state, "failure");
  assert.equal(evaluate(attack({ defense: { type: "dodge", total: 15 } })).vs, "dodge");
  assert.equal(evaluate(attack({ defense: dv, range: { dv: null, reason: "units" } })).state, "unknown");
  assert.equal(evaluate(attack({ defense: dv, range: { dv: null }, adj: adj({ dvSet: true, dv: 13 }) })).state, "success");
});

test("Ataque sin objetivo: abierto salvo que el DJ fije una VD", () => {
  assert.equal(evaluate(attack({ target: null, range: null })).state, "open");
  assert.equal(evaluate(attack({ target: null, range: null, adj: adj({ dvSet: true, dv: 17 }) })).state, "failure");
});
