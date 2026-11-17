// Pruebas de la lógica pura del editor de arquitecturas de Red (0.8.0). Datos inventados.
import test from "node:test";
import assert from "node:assert/strict";
import { editFloors, normalizeArchitecture, iceLabel, architectureTable, validateNetArchitecture } from "../scripts/netarch.js";

const floors = () => [
  { type: "password", name: "A", dv: 6 },
  { type: "blackIce", name: "B", iceUuids: ["Item.x"] },
  { type: "file", name: "C", dv: 8 },
];
const names = (list) => list.map((f) => f.name).join("");

test("Editor: añadir al final, tras un piso y con índice fuera de rango", () => {
  assert.equal(names(editFloors(floors(), "add", undefined, { type: "file", name: "N" })), "ABCN");
  assert.equal(names(editFloors(floors(), "add", 0, { type: "file", name: "N" })), "ANBC");
  assert.equal(names(editFloors(floors(), "add", 9, { type: "file", name: "N" })), "ABCN");
});

test("Editor: subir, bajar, duplicar y borrar; los extremos no cambian nada", () => {
  assert.equal(names(editFloors(floors(), "up", 1)), "BAC");
  assert.equal(names(editFloors(floors(), "up", 0)), "ABC");
  assert.equal(names(editFloors(floors(), "down", 1)), "ACB");
  assert.equal(names(editFloors(floors(), "down", 2)), "ABC");
  assert.equal(names(editFloors(floors(), "duplicate", 1)), "ABBC");
  assert.equal(names(editFloors(floors(), "remove", 0)), "BC");
  assert.equal(names(editFloors(floors(), "remove", 7)), "ABC");
});

test("Editor: las operaciones no modifican la lista original ni comparten los hielos de un duplicado", () => {
  const original = floors();
  const list = editFloors(original, "duplicate", 1);
  list[2].iceUuids.push("Item.y");
  assert.deepEqual(original, floors());
  assert.deepEqual(list[1].iceUuids, ["Item.x"]);
});

test("Normalizar: VD de texto a número, vacíos fuera, enlaces solo en su tipo y nombres recortados", () => {
  const data = normalizeArchitecture({
    name: "  Red  ",
    floors: [
      { type: "password", name: " Clave ", dv: "8", notes: "  " },
      { type: "file", name: "Archivo", dv: "", iceUuids: ["Item.x"], deviceUuid: "Actor.y", _auto: "x" },
      { type: "blackIce", name: "Hielo", iceUuids: ["Item.x", "Item.x"], deviceUuid: "Actor.y" },
      { type: "controlNode", name: "Nodo", dv: 10, deviceUuid: "Actor.y", notes: "secreto", iceUuids: ["Item.x"] },
    ],
  }, 2);
  assert.deepEqual(data, {
    schemaVersion: 1, name: "Red", revealed: 2,
    floors: [
      { type: "password", name: "Clave", dv: 8 },
      { type: "file", name: "Archivo" },
      { type: "blackIce", name: "Hielo", iceUuids: ["Item.x", "Item.x"] },
      { type: "controlNode", name: "Nodo", dv: 10, notes: "secreto", deviceUuid: "Actor.y" },
    ],
  });
  assert.equal(validateNetArchitecture(data).ok, true);
});

test("Normalizar: los pisos revelados se ajustan si se borran pisos; una VD inválida la detecta el validador", () => {
  assert.equal(normalizeArchitecture({ name: "R", floors: floors() }, 5).revealed, 3);
  assert.equal(normalizeArchitecture({ name: "R", floors: floors() }, undefined).revealed, 0);
  const bad = normalizeArchitecture({ name: "R", floors: [{ type: "password", name: "A", dv: "seis" }] });
  assert.deepEqual(validateNetArchitecture(bad).errors.map((e) => e.path), ["floors[0].dv"]);
  assert.deepEqual(validateNetArchitecture(normalizeArchitecture({ name: "", floors: [] })).errors.map((e) => e.code), ["name", "floors"]);
});

test("Nombre de hielos: repetidos con ×n y distintos con +", () => {
  assert.equal(iceLabel(["Cuervo", "Cuervo"]), "Cuervo ×2");
  assert.equal(iceLabel(["Liche", "Cerbero"]), "Liche + Cerbero");
  assert.equal(iceLabel(["Liche", "Cerbero", "Liche"]), "Liche ×2 + Cerbero");
  assert.equal(iceLabel([]), "");
});

test("Tabla de la página: nivel, nombre escapado y VD (— sin VD)", () => {
  const html = architectureTable({ floors: [{ type: "password", name: "A<b>", dv: 6 }, { type: "blackIce", name: "Hielo & co" }] }, { level: "Nivel", content: "Contenido", dv: "VD" });
  assert.equal(html, '<table class="er2070-na-table"><thead><tr><th>Nivel</th><th>Contenido</th><th>VD</th></tr></thead><tbody>'
    + "<tr><td>1</td><td>A&lt;b&gt;</td><td>6</td></tr><tr><td>2</td><td>Hielo &amp; co</td><td>—</td></tr></tbody></table>");
});

test("0.9.0: público de la arquitectura: validación, lista sin repetidos y cambio", async () => {
  const { audienceOf, audienceChange } = await import("../scripts/netarch.js");
  const base = { name: "R", floors: [{ type: "file", name: "A" }] };
  assert.equal(validateNetArchitecture({ ...base, audience: ["u1"] }).ok, true);
  assert.deepEqual(validateNetArchitecture({ ...base, audience: "u1" }).errors.map((e) => e.code), ["audience"]);
  assert.deepEqual(audienceOf({ audience: ["a", "a", "b"] }), ["a", "b"]);
  assert.deepEqual(audienceOf({}), []);
  assert.deepEqual(audienceChange({ audience: ["a", "b"] }, ["b", "c", "x", "c"], ["a", "b", "c"]), { next: ["b", "c"], removed: ["a"] });
});
