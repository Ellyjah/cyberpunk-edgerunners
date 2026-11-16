import test from "node:test";
import assert from "node:assert/strict";
import { ownershipPatch } from "../scripts/device-control.js";

// Simula la fusión de Document.update de Foundry, incluidas las claves de borrado.
function apply(current, patch) {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith("-=")) delete result[key.slice(2)];
    else result[key] = value;
  }
  return result;
}

test("A060-02: A -> B -> retirada restaura exactamente la propiedad original", () => {
  const original = { default: 0, gm: 3, observer: 1 };
  const a = apply(original, ownershipPatch(original, original, ["a"]));
  const b = apply(a, ownershipPatch(a, original, ["b"]));
  assert.deepEqual(b, { ...original, b: 3 });
  assert.deepEqual(apply(b, ownershipPatch(b, original)), original);
  assert.deepEqual(original, { default: 0, gm: 3, observer: 1 });
});

test("restauración de un control 0.6.0 elimina también concesiones antiguas no registradas en players", () => {
  const original = { default: 0, gm: 3 };
  const legacy = { ...original, a: 3, b: 3, stale: 3 };
  assert.deepEqual(apply(legacy, ownershipPatch(legacy, original)), original);
});

test("preserva propietarios previos, observadores y nivel heredado; admite beneficiarios compartidos", () => {
  const original = { default: 1, owner: 3, observer: 1, inherited: -1 };
  const granted = apply(original, ownershipPatch(original, original, ["owner", "observer", "a", "b"]));
  assert.equal(granted.observer, 3);
  assert.deepEqual(apply(granted, ownershipPatch(granted, original)), original);
});

test("no inventa una instantánea si falta la propiedad original", () => {
  assert.throws(() => ownershipPatch({ default: 0, a: 3 }, undefined), /Missing original/);
});
