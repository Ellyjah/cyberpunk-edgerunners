// Pruebas de las reglas puras de armas y ciberequipo (M5). Todos los valores son inventados.
import test from "node:test";
import assert from "node:assert/strict";
import { shotPlan, effectiveStat, evaluateCondition, retryAllowed, unarmedDamage, ignoreArmorFromMultiplier, firingChamber, attackMode, stackSatisfied } from "../scripts/rules.js";
import { validate } from "../scripts/schema.js";

test("Consumo normal si no hay capacidad o el modo no está incluido", () => {
  assert.deepEqual(shotPlan({ magazine: 7, mode: "single" }), { blocked: null, consume: null, insufficientDamage: null });
  assert.equal(shotPlan({ magazine: 20, mode: "autofire", perAttack: { count: 4 } }).consume, null);
});

test("Consumo por ataque: suficientes, insuficientes con daño reducido, o bloqueo", () => {
  const perAttack = { count: 4, ifInsufficient: { damage: "1d6", consumeAll: true } };
  assert.equal(shotPlan({ magazine: 9, mode: "single", perAttack }).consume, 4);
  assert.equal(shotPlan({ magazine: 9, mode: "aimed", perAttack }).consume, 4);
  assert.deepEqual(shotPlan({ magazine: 2, mode: "single", perAttack }), { blocked: null, consume: 2, insufficientDamage: "1d6" });
  assert.equal(shotPlan({ magazine: 2, mode: "single", perAttack: { count: 4 } }).blocked, "notEnoughAmmo");
  assert.equal(shotPlan({ magazine: 0, mode: "single", perAttack }).blocked, "notEnoughAmmo");
});

test("Munición mínima para disparar", () => {
  assert.equal(shotPlan({ magazine: 5, mode: "single", minToFire: 6 }).blocked, "minAmmo");
  assert.equal(shotPlan({ magazine: 6, mode: "single", minToFire: 6 }).blocked, null);
});

test("Característica efectiva solo en su ámbito y con las piezas necesarias", () => {
  const caps = [
    { id: "a", stat: "body", value: 9, scope: ["wieldWeapon"] },
    { id: "b", stat: "body", value: 9, scope: ["grapple"], stackKey: "par", minStack: 2 },
  ];
  assert.equal(effectiveStat(4, caps, "body", "wieldWeapon"), 9);
  assert.equal(effectiveStat(4, caps, "body", "grapple"), 4);
  assert.equal(effectiveStat(4, [...caps, { id: "c", stat: "body", value: 9, scope: ["grapple"], stackKey: "par", minStack: 2 }], "body", "grapple"), 9);
  assert.equal(effectiveStat(10, caps, "body", "wieldWeapon"), 10);
  assert.equal(effectiveStat(4, caps, "ref", "wieldWeapon"), 4);
});

test("Agrupación por stackKey", () => {
  const caps = [{ id: "x", stackKey: "k", minStack: 2 }, { id: "y" }];
  assert.deepEqual(stackSatisfied(caps).map((c) => c.id), ["y"]);
});

test("Condiciones: simples, compuestas y desconocidas", () => {
  const facts = {
    hasCapability: (t) => t === "cable-link",
    hasTag: (t) => t === "refuerzo",
    hasCyberwareType: (t, f) => t === "cyberArm" && f !== false,
    stat: (name, scope) => (name === "body" ? (scope === "wieldWeapon" ? 9 : 4) : 5),
    roleRank: () => 3,
    connected: (mode) => mode !== "cable",
  };
  assert.equal(evaluateCondition({ type: "actorHasCapability", capability: "cable-link" }, facts).ok, true);
  assert.equal(evaluateCondition({ type: "statAtLeast", stat: "body", value: 8 }, facts).ok, false);
  assert.equal(evaluateCondition({ type: "statAtLeast", stat: "body", value: 8 }, facts, "wieldWeapon").ok, true);
  assert.equal(evaluateCondition({ type: "anyOf", conditions: [{ type: "actorHasTag", tag: "otra" }, { type: "actorHasCyberwareType", cyberwareType: "cyberArm" }] }, facts).ok, true);
  assert.equal(evaluateCondition({ type: "allOf", conditions: [{ type: "roleRankAtLeast", role: "x", rank: 3 }, { type: "connected", mode: "cable" }] }, facts).ok, false);
  assert.deepEqual(evaluateCondition({ type: "inventada" }, facts), { ok: false, unknown: true });
  assert.deepEqual(evaluateCondition({ type: "targetUnaware" }, facts), { ok: false, unknown: true });
});

test("Segundo intento solo con fallo por margen permitido", () => {
  assert.equal(retryAllowed(10, 13, 3), true);
  assert.equal(retryAllowed(9, 13, 3), false);
  assert.equal(retryAllowed(13, 13, 3), false);
});

test("Daño desarmado por TCO", () => {
  assert.deepEqual([3, 5, 9, 12].map((b) => unarmedDamage(b)), ["1d6", "2d6", "3d6", "4d6"]);
  assert.equal(unarmedDamage(3, { cyberArm: true }), "2d6");
  assert.equal(unarmedDamage(3, { cyberArm: true, martialArts: true }), "1d6");
});

test("Multiplicador de CP a porcentaje ignorado de RED", () => {
  assert.equal(ignoreArmorFromMultiplier(0.5), 50);
  assert.equal(ignoreArmorFromMultiplier(0.5, 70), 70);
  assert.equal(ignoreArmorFromMultiplier(undefined, 10), 10);
  assert.equal(ignoreArmorFromMultiplier(1), 0);
});

test("Recámara que dispara", () => {
  assert.equal(firingChamber([{ id: "a" }, { id: "b" }], 1), 1);
  assert.equal(firingChamber([{ id: "a" }, null], 1), 0);
  assert.equal(firingChamber([null, null], 0), -1);
});

test("Modo de disparo según la clase de tirada de RED", () => {
  assert.equal(attackMode("CPRAimedAttackRoll"), "aimed");
  assert.equal(attackMode("CPRAttackRoll"), "single");
  assert.equal(attackMode("CPRDamageRoll"), null);
});

test("Esquema: ampliaciones de M5 válidas y errores detectados", () => {
  const ok = validate({ type: "weapon", flags: { "edgerunners-2070": { schemaVersion: 1, capabilities: [
    { id: "md", type: "mode-damage", modes: ["aimed"], damage: "4d6" },
    { id: "ch", type: "chargeable", chargeCost: "move", duration: { rounds: 5 }, release: "endOfTurn", whileCharged: { rof: 1, spMultiplier: 0.5 } },
    { id: "ur", type: "user-requirement", condition: { type: "anyOf", conditions: [{ type: "actorHasTag", tag: "t" }, { type: "statAtLeast", stat: "body", value: 7, scope: "wieldWeapon" }] } },
  ] } } });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const bad = validate({ type: "weapon", flags: { "edgerunners-2070": { capabilities: [
    { id: "ur", type: "user-requirement", condition: { type: "anyOf", conditions: [{ type: "inventada" }] } },
    { id: "ch", type: "chargeable", release: "nunca" },
  ] } } });
  assert.deepEqual(bad.errors.map((e) => e.code).sort(), ["badParam", "unknownCondition"]);
});
