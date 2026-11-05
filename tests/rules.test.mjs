// Pruebas de las reglas puras de netrunning. Valores de prueba inventados salvo donde se cita la progresión de RED.
import test from "node:test";
import assert from "node:assert/strict";
import { netActionsForRank, parseDvList, neuroArchitecture, redD10, attackerWins, firewallRequired, quickhackBlocked, turnKey, netActionBonus } from "../scripts/rules.js";

test("Acciones NET por rango siguen la progresión completa de RED", () => {
  assert.deepEqual([0, 1, 3, 4, 6, 7, 9, 10].map(netActionsForRank), [0, 2, 2, 3, 3, 4, 4, 5]);
});

test("Lista de VD", () => {
  assert.deepEqual(parseDvList("6, 8,10"), [6, 8, 10]);
  assert.deepEqual(parseDvList("x,7"), [7]);
  assert.deepEqual(parseDvList(""), []);
});

test("Arquitectura: solo nodo sin defensas", () => {
  assert.deepEqual(neuroArchitecture({ nodeDv: 11 }), [{ kind: "node", dv: 11 }]);
});

test("Arquitectura: todas las barreras usan la VD según el número total", () => {
  const floors = neuroArchitecture({ selfIce: 2, barrierDvs: [5, 7, 9], nodeDv: 11 });
  assert.deepEqual(floors, [{ kind: "barrier", dv: 7 }, { kind: "barrier", dv: 7 }, { kind: "node", dv: 11 }]);
});

test("Arquitectura: tope de Hielo personal, hielo negro antes del nodo", () => {
  const floors = neuroArchitecture({ selfIce: 5, blackIce: ["Perro ficticio"], barrierDvs: [5, 7, 9], maxSelfIce: 3, nodeDv: 11 });
  assert.deepEqual(floors.map((f) => f.kind), ["barrier", "barrier", "barrier", "blackice", "node"]);
  assert.equal(floors[0].dv, 9);
});

test("d10 de RED: crítico suma, pifia resta, normal usa un dado", () => {
  assert.deepEqual(redD10([10, 4]), { total: 14, crit: "success", used: 2 });
  assert.deepEqual(redD10([1, 6]), { total: -5, crit: "fumble", used: 2 });
  assert.deepEqual(redD10([7, 9]), { total: 7, crit: null, used: 1 });
});

test("Empate favorece al defensor", () => {
  assert.equal(attackerWins(12, 12), false);
  assert.equal(attackerWins(13, 12), true);
});

test("Cortafuegos según rango", () => {
  assert.equal(firewallRequired(2, 3), true);
  assert.equal(firewallRequired(3, 3), false);
});

test("Condiciones del hackeo rápido", () => {
  const hack = { minRank: 2, requiresUnaware: false };
  const base = { connection: { floor: 2, alerted: false }, floors: 3, alreadyTried: false, hack, rank: 2 };
  assert.equal(quickhackBlocked(base), null);
  assert.equal(quickhackBlocked({ ...base, connection: undefined }), "notConnected");
  assert.equal(quickhackBlocked({ ...base, rank: 1 }), "rankTooLow");
  assert.equal(quickhackBlocked({ ...base, connection: { floor: 1 } }), "floorsRemaining");
  assert.equal(quickhackBlocked({ ...base, alreadyTried: true }), "alreadyTried");
  assert.equal(quickhackBlocked({ ...base, hack: { ...hack, requiresUnaware: true }, connection: { floor: 2, alerted: true } }), "targetAware");
});

test("Clave de turno", () => {
  assert.equal(turnKey(null), null);
  assert.equal(turnKey({ id: "c1", round: 2, turn: 3 }), "c1:2:3");
});

test("Bonificación de acciones NET: condición de cable y piezas mínimas", () => {
  const caps = [
    { id: "a", bonus: 1, when: { connection: "cable" }, stackKey: "disco", minStack: 2 },
    { id: "b", bonus: 1, when: { connection: "cable" }, stackKey: "disco", minStack: 2 },
    { id: "c", bonus: 2 },
  ];
  assert.equal(netActionBonus(caps, { cable: true }), 3);
  assert.equal(netActionBonus(caps, { cable: false }), 2);
  assert.equal(netActionBonus(caps.slice(0, 1), { cable: true }), 0);
});
