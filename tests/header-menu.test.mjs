import test from "node:test";
import assert from "node:assert/strict";
import { groupHeaderButtons } from "../scripts/header-menu.js";

test("agrupa tres herramientas sin alterar los botones del sistema y otros módulos", () => {
  const edit = { class: "configure-sheet" }, external = { class: "other-module" }, close = { class: "close" };
  const humanity = { class: "er2070-humanity-open" }, gear = { class: "er2070-gear-open" }, net = { class: "er2070-net-open" };
  const menu = { class: "er2070-tools" };
  const input = [edit, humanity, external, gear, net, close];
  const result = groupHeaderButtons(input, menu);
  assert.deepEqual(result.buttons, [edit, menu, external, close]);
  assert.deepEqual(result.tools, [humanity, gear, net]);
  assert.equal(input.length, 6);
});

test("el menú de un jugador solo contiene las herramientas ya autorizadas", () => {
  const gear = { class: "er2070-gear-open", onclick: () => 7 }, net = { class: "er2070-net-open" };
  const { tools } = groupHeaderButtons([gear, net], {});
  assert.deepEqual(tools, [gear, net]);
  assert.equal(tools[0].onclick(), 7);
});

test("agrupa también la herramienta de tienda; no confunde prefijos ajenos", () => {
  const vendor = { class: "extra er2070-vendor-open" }, other = { class: "er2070-vendor-open-other" }, menu = {};
  assert.deepEqual(groupHeaderButtons([vendor, other], menu), { buttons: [menu, other], tools: [vendor] });
});

test("no añade un menú vacío en fichas sin herramientas propias", () => {
  const input = [{ class: "close" }, { label: "Sin clase" }];
  assert.deepEqual(groupHeaderButtons(input, {}), { buttons: input, tools: [] });
});
