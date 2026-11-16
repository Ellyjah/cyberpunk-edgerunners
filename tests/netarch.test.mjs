// Pruebas de la lógica pura de la ventana «Arquitectura de Red» (0.7.0). Datos inventados.
import test from "node:test";
import assert from "node:assert/strict";
import { validateNetArchitecture, revealedCount, nextRevealed, playerView } from "../scripts/netarch.js";

const sample = () => ({
  schemaVersion: 1,
  name: "Red de prueba",
  floors: [
    { type: "password", name: "Clave", dv: 6 },
    { type: "blackIce", name: "Hielo ×2", iceUuids: ["Compendium.a.b.Item.x", "Compendium.a.b.Item.x"], notes: "secreto" },
    { type: "controlNode", name: "Torreta", dv: 10, deviceUuid: "Actor.abc", notes: "dispara" },
    { type: "file", name: "Archivo", dv: 8 },
  ],
  revealed: 0,
});

test("Validación: arquitectura correcta, con hielo repetido y piso sin VD", () => {
  assert.deepEqual(validateNetArchitecture(sample()), { ok: true, errors: [] });
});

test("Validación: errores con su ruta", () => {
  const d = sample();
  d.floors[0].type = "router";
  d.floors[1].dv = 0;
  d.floors[2].deviceUuid = "sin punto";
  d.revealed = 9;
  const codes = validateNetArchitecture(d).errors.map((e) => `${e.code}@${e.path}`);
  assert.deepEqual(codes, ["type@floors[0].type", "dv@floors[1].dv", "uuid@floors[2].deviceUuid", "revealed@revealed"]);
});

test("Validación: datos ausentes o sin pisos", () => {
  assert.equal(validateNetArchitecture(undefined).ok, false);
  assert.equal(validateNetArchitecture({ name: "x", floors: [] }).errors[0].code, "floors");
  assert.equal(validateNetArchitecture({ ...sample(), schemaVersion: 2 }).errors[0].code, "version");
});

test("Revelar, ocultar y reiniciar respetan los límites", () => {
  const d = sample();
  assert.equal(nextRevealed(d, "hide"), 0);
  d.revealed = 3;
  assert.equal(nextRevealed(d, "reveal"), 4);
  d.revealed = 4;
  assert.equal(nextRevealed(d, "reveal"), 4);
  assert.equal(nextRevealed(d, "hide"), 3);
  assert.equal(nextRevealed(d, "reset"), 0);
  assert.equal(revealedCount({ ...d, revealed: 99 }), 4);
  assert.equal(revealedCount({ ...d, revealed: "2" }), 0);
});

test("Vista del jugador: solo pisos revelados, sin notas ni enlaces", () => {
  const d = { ...sample(), revealed: 3 };
  assert.deepEqual(playerView(d), {
    name: "Red de prueba",
    total: 4,
    floors: [
      { type: "password", name: "Clave", dv: 6 },
      { type: "blackIce", name: "Hielo ×2" },
      { type: "controlNode", name: "Torreta", dv: 10 },
    ],
  });
  assert.deepEqual(playerView(sample()).floors, []);
});
