// Pruebas de las utilidades del motor que no dependen de Foundry (R04: mutaciones en serie).
import test from "node:test";
import assert from "node:assert/strict";
import { serialize, own } from "../scripts/effects.js";

const tick = () => new Promise((r) => setTimeout(r, 1));

test("serialize: leer-modificar-escribir concurrente sobre la misma clave no pierde cambios", async () => {
  const actor = { hp: 40 };
  const damage = (n) => serialize("hp:actor", async () => {
    const before = actor.hp;
    await tick();
    actor.hp = before - n;
  });
  await Promise.all([damage(3), damage(3), damage(3)]);
  assert.equal(actor.hp, 31);
});

test("serialize: claves distintas no se bloquean entre sí y un fallo no detiene la cola", async () => {
  const order = [];
  const failing = serialize("k", async () => { order.push("a"); throw new Error("fallo"); });
  const next = serialize("k", async () => { order.push("b"); return 7; });
  const other = serialize("otra", async () => { order.push("c"); });
  await assert.rejects(failing);
  assert.equal(await next, 7);
  await other;
  assert.deepEqual(order.sort(), ["a", "b", "c"]);
});

test("own: un registro sin prototipo solo devuelve claves propias registradas (A050-01)", () => {
  const registry = Object.create(null);
  registry.activation = () => "ok";
  assert.equal(own(registry, "activation")(), "ok");
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "desconocido", "", undefined, null, 7, {}]) {
    assert.equal(own(registry, key), undefined, String(key));
  }
  // Aunque el registro fuera un objeto corriente, lo heredado no se devuelve.
  const plain = { activation: 1 };
  assert.equal(own(plain, "constructor"), undefined);
  assert.equal(own(plain, "activation"), 1);
});
