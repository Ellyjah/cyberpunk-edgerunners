// Pruebas de las reglas puras de Humanidad, roles y economía (M6). Valores de prueba inventados
// salvo las categorías de precio de RED.
import test from "node:test";
import assert from "node:assert/strict";
import { priceCategory, categoryAtLeast, acquisitionMatches, buyPrice, monthlyHumanity, beatsDv } from "../scripts/rules.js";
import { validate } from "../scripts/schema.js";

test("Categoría de precio de RED", () => {
  assert.deepEqual([0, 7, 100, 499, 500, 999, 1000, 20000].map(priceCategory), ["free", "dirtCheap", "premium", "premium", "expensive", "expensive", "veryExpensive", "superLuxury"]);
  assert.equal(categoryAtLeast("luxury", "expensive"), true);
  assert.equal(categoryAtLeast("premium", "expensive"), false);
});

test("Adquisición por aptitud de rol: rango, categoría máxima y tipos", () => {
  const rules = [
    { ability: "Alfa", rank: 2, maxCategory: "expensive" },
    { ability: "Alfa", rank: 5, maxCategory: "luxury" },
    { ability: "Beta", rank: 1, types: ["vehicle", "itemUpgrade:vehicle"] },
  ];
  const caro = { category: "expensive", kind: "gear" };
  const lujoso = { category: "luxury", kind: "gear" };
  assert.equal(acquisitionMatches(rules, [{ ability: "alfa", rank: 1 }], caro).length, 0);
  assert.equal(acquisitionMatches(rules, [{ ability: "Alfa", rank: 2 }], caro).length, 1);
  assert.equal(acquisitionMatches(rules, [{ ability: "Alfa", rank: 2 }], lujoso).length, 0);
  assert.equal(acquisitionMatches(rules, [{ ability: "Alfa", rank: 6 }], lujoso).length, 1);
  assert.equal(acquisitionMatches(rules, [{ ability: "Beta", rank: 1 }], { category: "superLuxury", kind: "vehicle" }).length, 1);
  assert.equal(acquisitionMatches(rules, [{ ability: "Beta", rank: 1 }], { category: "cheap", kind: "itemUpgrade:vehicle" }).length, 1);
  assert.equal(acquisitionMatches(rules, [{ ability: "Beta", rank: 1 }], { category: "cheap", kind: "itemUpgrade:weapon" }).length, 0);
});

test("Precio con recargo", () => {
  assert.equal(buyPrice(500, 2), 1000);
  assert.equal(buyPrice(55, 1.5), 83);
  assert.equal(buyPrice(500, 0), 500);
  assert.equal(buyPrice(500, "x"), 500);
});

test("Evaluación mensual: fórmulas y buena vida", () => {
  assert.deepEqual(monthlyHumanity({ loss: [1, 0, 1], gain: [1, 0] }), { loss: "1d6 + 3d6", gain: "1d6", goodLife: false, lossCount: 2, gainCount: 1 });
  const good = monthlyHumanity({ loss: [2, 0, 0], gain: [3, 1] });
  assert.equal(good.goodLife, true);
  assert.equal(good.gain, "3d6 + 2d6 + 3d6");
  assert.equal(monthlyHumanity({ loss: [3, 0, 0], gain: [4, 0] }).goodLife, false);
  assert.equal(monthlyHumanity({ loss: [0, 0, 0], gain: [4, 0], goodLife: false }).gain, "4d6");
  assert.deepEqual(monthlyHumanity({}), { loss: null, gain: null, goodLife: false, lossCount: 0, gainCount: 0 });
});

test("Contra una VD hay que superarla", () => {
  assert.equal(beatsDv(16, 15), true);
  assert.equal(beatsDv(15, 15), false);
});

test("Esquema: droga con efecto secundario y operaciones de M6", () => {
  const ok = validate({ type: "drug", flags: { "edgerunners-2070": { schemaVersion: 1, capabilities: [
    { id: "d", type: "drug", duration: { hours: 2 }, primary: [{ op: "humanity", formula: "1d6", sign: "gain" }],
      secondary: { dv: 12, onFail: [{ op: "humanity-revert" }, { op: "on-expire", duration: { rounds: 3 }, operations: [{ op: "humanity", formula: "1d6", sign: "loss" }] }] } },
  ] } } });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const bad = validate({ type: "drug", flags: { "edgerunners-2070": { capabilities: [
    { id: "d", type: "drug", secondary: { onFail: [{ op: "inventada" }] } },
  ] } } });
  assert.deepEqual(bad.errors.map((e) => e.code).sort(), ["missingParam", "unknownOperation"]);
});
