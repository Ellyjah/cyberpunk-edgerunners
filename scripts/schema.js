/**
 * Esquema v1 de capacidades (ver 03-coordinacion/CONTRATOS.md).
 * Lógica pura: sin dependencias de Foundry, para poder probarla con Node.
 * Los mensajes se devuelven como códigos; la interfaz los traduce.
 */

export const MODULE_ID = "edgerunners-2070";

/**
 * Modo seguro de tiradas (0.5.4): con el ajuste activo, el módulo deja las tiradas exactamente como las hace
 * RED (sin modificadores, veredicto, munición especial ni efectos tras atacar o dañar). Lo demás sigue igual.
 */
export function rollSafeMode() {
  try { return game.settings.get(MODULE_ID, "rollSafeMode") === true; } catch { return false; }
}
export const SCHEMA_VERSION = 1;

// Notación de parámetros: tipo + "!" si es obligatorio.
// Tipos: int, number, bool, string, formula, uuid, duration, range, object,
// operations, condition, list, enum:a|b|c
const OPERATIONS = {
  "stat-mod": { key: "string!", value: "int!", duration: "duration" },
  "move-mod": { value: "int", formula: "formula", duration: "duration", minZero: "bool" },
  "temp-injury": { injury: "uuid!", duration: "duration", bonusDamage: "bool" },
  "direct-damage": { formula: "formula!", timing: "enum:now|endOfTargetTurn", repeat: "bool", stopAction: "string" },
  "suspend-cyberware": { pick: "enum:gm|attacker", count: "int", exclude: "list", duration: "duration" },
  control: { scope: "enum:move|move+action", usesTargetStats: "bool" },
  "eject-chip": { pick: "enum:gm|attacker" },
  unconscious: { duration: "duration", endsOnDamage: "bool", prone: "bool" },
  humanity: { formula: "formula!", sign: "enum:loss|gain!", respectMax: "bool" },
  "initiative-top": {},
  "extra-action": { kind: "enum:move|any", count: "int" },
  "self-damage-from-humanity": {},
  "ignore-wound-state": { states: "list", keepDeathSaves: "bool", duration: "duration" },
  // M6: deshace el cambio de Humanidad de una droga; aplica operaciones al caducar.
  "humanity-revert": {},
  "on-expire": { duration: "duration!", operations: "operations!" },
};

const CONDITIONS = {
  actorHasCapability: { capability: "string!", installed: "bool" },
  statAtLeast: { stat: "string!", value: "int!", scope: "string" },
  roleRankAtLeast: { role: "string!", rank: "int!" },
  targetUnaware: {},
  connected: { mode: "enum:any|remote|cable" },
  // Ampliaciones compatibles de v1 (M5).
  actorHasTag: { tag: "string!" },
  actorHasCyberwareType: { cyberwareType: "string!", foundational: "bool" },
  anyOf: { conditions: "conditions!" },
  allOf: { conditions: "conditions!" },
};

const ANY_HOST = ["cyberware", "weapon", "itemUpgrade", "gear", "cyberdeck", "ammo", "armor", "clothing", "drug", "program"];

// Tipo de capacidad → { hosts: tipos de Item de RED, params }.
export const CAPABILITIES = {
  neuroport: { hosts: ["cyberware"], params: { creationFree: "bool" } },
  "medical-grade": { hosts: ["cyberware"], params: {} },
  "self-ice": { hosts: ["cyberware"], params: {} },
  "deck-port": { hosts: ["cyberware"], params: { range: "range", allowsHardware: "bool" } },
  "deck-range": { hosts: ["cyberdeck"], params: { range: "range" } },
  "extra-hardware-slot": { hosts: ["cyberware"], params: { slots: "int" } },
  "cable-link": { hosts: ["cyberware"], params: { maxDistance: "number" } },
  "smart-interface": { hosts: ["cyberware", "gear"], params: {} },
  activation: {
    hosts: ["cyberware"],
    params: { action: "enum:none|action", humanityCost: "formula", duration: "duration", cooldown: "duration", exclusiveGroup: "string", onActivate: "operations" },
  },
  "effective-stat": { hosts: ["cyberware"], params: { stat: "string!", value: "int!", scope: "list", stackKey: "string", minStack: "int" } },
  "crit-choose": { hosts: ["cyberware", "weapon"], params: { rolls: "int" } },
  "ignore-wound-state": { hosts: ["cyberware"], params: { states: "list", keepDeathSaves: "bool" } },
  // Marca genérica para condiciones (`actorHasTag`), sin efecto propio.
  tag: { hosts: ANY_HOST, params: { tags: "list!" } },
  quickhack: {
    hosts: ["gear"],
    params: { minRank: "int!", dv: "int!", alerts: "bool", requiresUnaware: "bool", operations: "operations" },
  },
  "net-actions": { hosts: ["cyberware", "cyberdeck"], params: { bonus: "int!", when: "object", stackKey: "string", minStack: "int" } },
  "crit-bonus-damage": { hosts: ["weapon", "itemUpgrade"], params: { value: "int!" } },
  ricochet: { hosts: ["weapon", "itemUpgrade"], params: { attackMod: "int", aimedIgnoresMod: "bool", spreadRadius: "number" } },
  "smart-weapon": { hosts: ["weapon", "itemUpgrade"], params: {} },
  "enhanced-smart-ammo": { hosts: ["ammo"], params: { retry: "object", ignoreVisibility: "bool" } },
  chargeable: { hosts: ["weapon", "itemUpgrade"], params: { chargeCost: "enum:move|none", duration: "duration", whileCharged: "object", release: "enum:fire|endOfTurn" } },
  "mode-damage": { hosts: ["weapon", "itemUpgrade"], params: { modes: "list!", damage: "formula!" } },
  "ammo-per-attack": { hosts: ["weapon"], params: { count: "int!", modes: "list", ifInsufficient: "object" } },
  "min-ammo-to-fire": { hosts: ["weapon"], params: { count: "int!" } },
  "multi-chamber": { hosts: ["weapon"], params: { chambers: "int!" } },
  "bolt-action": { hosts: ["weapon"], params: {} },
  "user-requirement": { hosts: ["weapon", "cyberware"], params: { condition: "condition!", onFail: "object" } },
  drug: { hosts: ["drug"], params: { primary: "operations", duration: "duration", secondary: "object" } },
};

const COMMON = new Set(["id", "type", "enabled", "gmConfirm", "requires", "label"]);
const ID_RE = /^[a-z0-9-]{1,32}$/;
const FORMULA_RE = /^[0-9dD+\-*/() ]+$/;
const UUID_RE = /^(Compendium|Item|Actor)\.\S+$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Comprueba un valor contra la notación de tipo. Devuelve true si es válido. */
function checkKind(kind, value, path, out) {
  if (kind.startsWith("enum:")) return kind.slice(5).split("|").includes(value);
  switch (kind) {
    case "int": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "bool": return typeof value === "boolean";
    case "string": return typeof value === "string";
    case "formula": return (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && FORMULA_RE.test(value) && /\d/.test(value));
    case "uuid": return typeof value === "string" && UUID_RE.test(value);
    case "object": return isObj(value);
    case "list": return Array.isArray(value);
    case "range":
      return isObj(value) && Object.values(value).every((n) => typeof n === "number" && n >= 0);
    case "duration": {
      if (!isObj(value) || Object.keys(value).length !== 1) return false;
      const [k, v] = Object.entries(value)[0];
      if (k === "rounds") return Number.isInteger(v) && v > 0;
      if (k === "hours") return typeof v === "number" && v > 0;
      if (k === "untilEndOfTurn") return ["self", "target"].includes(v);
      if (k === "untilFired") return v === true;
      return false;
    }
    case "operations":
      if (!Array.isArray(value)) return false;
      value.forEach((op, i) => checkEntry(OPERATIONS, "op", op, `${path}[${i}]`, out, "unknownOperation"));
      return true;
    case "condition":
      checkEntry(CONDITIONS, "type", value, path, out, "unknownCondition");
      return isObj(value);
    case "conditions":
      if (!Array.isArray(value)) return false;
      value.forEach((c, i) => checkEntry(CONDITIONS, "type", c, `${path}[${i}]`, out, "unknownCondition"));
      return true;
    default: return false;
  }
}

/** Valida los parámetros de un objeto según su especificación. */
function checkParams(spec, obj, path, out, skip = new Set()) {
  for (const [name, notation] of Object.entries(spec)) {
    const required = notation.endsWith("!");
    const kind = required ? notation.slice(0, -1) : notation;
    if (obj[name] === undefined) {
      if (required) out.errors.push({ code: "missingParam", path: `${path}.${name}` });
      continue;
    }
    if (!checkKind(kind, obj[name], `${path}.${name}`, out)) {
      out.errors.push({ code: "badParam", path: `${path}.${name}`, args: { kind } });
    }
  }
  for (const name of Object.keys(obj)) {
    if (!(name in spec) && !skip.has(name)) out.warnings.push({ code: "unknownParam", path: `${path}.${name}` });
  }
}

/** Valida una operación o condición identificada por su campo discriminante. */
function checkEntry(catalog, field, entry, path, out, unknownCode) {
  if (!isObj(entry)) {
    out.errors.push({ code: "notObject", path });
    return;
  }
  const spec = catalog[entry[field]];
  if (!spec) {
    out.errors.push({ code: unknownCode, path: `${path}.${field}`, args: { value: String(entry[field]) } });
    return;
  }
  checkParams(spec, entry, path, out, new Set([field]));
}

/** Extrae los datos del módulo de un Item (o acepta directamente el objeto de flags). */
function extract(itemOrData) {
  if (isObj(itemOrData?.flags) || typeof itemOrData?.getFlag === "function") {
    return { data: itemOrData.flags?.[MODULE_ID], itemType: itemOrData.type };
  }
  return { data: itemOrData, itemType: undefined };
}

/**
 * Valida los datos v1 sin modificarlos.
 * @returns {{ok: boolean, errors: object[], warnings: object[]}}
 */
export function validate(itemOrData) {
  const { data, itemType } = extract(itemOrData);
  const out = { errors: [], warnings: [] };
  if (data === undefined || data === null) return { ok: true, ...out };
  if (!isObj(data)) {
    out.errors.push({ code: "notObject", path: "" });
    return { ok: false, ...out };
  }
  const version = data.schemaVersion ?? SCHEMA_VERSION;
  if (!Number.isInteger(version) || version < 1) out.errors.push({ code: "badVersion", path: "schemaVersion" });
  else if (version > SCHEMA_VERSION) out.errors.push({ code: "newerVersion", path: "schemaVersion", args: { version, supported: SCHEMA_VERSION } });

  const caps = data.capabilities ?? [];
  if (!Array.isArray(caps)) {
    out.errors.push({ code: "badParam", path: "capabilities", args: { kind: "list" } });
    return { ok: false, ...out };
  }
  const seen = new Set();
  caps.forEach((cap, i) => {
    const path = `capabilities[${i}]`;
    if (!isObj(cap)) {
      out.errors.push({ code: "notObject", path });
      return;
    }
    if (typeof cap.id !== "string" || !ID_RE.test(cap.id)) out.errors.push({ code: "badId", path: `${path}.id` });
    else if (seen.has(cap.id)) out.errors.push({ code: "duplicateId", path: `${path}.id`, args: { id: cap.id } });
    else seen.add(cap.id);

    const def = CAPABILITIES[cap.type];
    if (!def) {
      out.warnings.push({ code: "unknownType", path: `${path}.type`, args: { value: String(cap.type) } });
      return;
    }
    if (itemType && !def.hosts.includes(itemType)) {
      out.warnings.push({ code: "unexpectedHost", path: `${path}.type`, args: { type: cap.type, hosts: def.hosts.join(", ") } });
    }
    for (const flag of ["enabled", "gmConfirm"]) {
      if (cap[flag] !== undefined && typeof cap[flag] !== "boolean") out.errors.push({ code: "badParam", path: `${path}.${flag}`, args: { kind: "bool" } });
    }
    if (cap.requires !== undefined) {
      if (!Array.isArray(cap.requires)) out.errors.push({ code: "badParam", path: `${path}.requires`, args: { kind: "list" } });
      else cap.requires.forEach((c, j) => checkEntry(CONDITIONS, "type", c, `${path}.requires[${j}]`, out, "unknownCondition"));
    }
    checkParams(def.params, cap, path, out, COMMON);
    // Efecto secundario de droga: { dv, skill, onFail[], onPass[] }.
    if (cap.type === "drug" && isObj(cap.secondary)) {
      checkParams({ dv: "int!", skill: "string", onFail: "operations", onPass: "operations" }, cap.secondary, `${path}.secondary`, out);
    }
  });
  return { ok: out.errors.length === 0, ...out };
}

/**
 * Lleva los datos a la versión actual sin perder campos desconocidos.
 * Idempotente. Lanza un error si los datos son de una versión más nueva.
 */
export function migrate(data) {
  if (!isObj(data)) return data;
  const copy = structuredClone(data);
  const version = copy.schemaVersion ?? SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) throw new Error(`${MODULE_ID}: schemaVersion ${version} > ${SCHEMA_VERSION}`);
  copy.schemaVersion = SCHEMA_VERSION;
  if (copy.capabilities === undefined) copy.capabilities = [];
  return copy;
}

/**
 * Capacidades activas y normalizadas de un Item: solo tipos conocidos,
 * sin errores propios y con enabled distinto de false.
 */
export function getCapabilities(itemOrData) {
  const { data } = extract(itemOrData);
  if (!isObj(data) || !Array.isArray(data.capabilities)) return [];
  const { errors } = validate(itemOrData);
  if (errors.some((e) => e.path === "schemaVersion")) return [];
  const broken = new Set(errors.map((e) => e.path.match(/^capabilities\[(\d+)\]/)?.[1]).filter(Boolean).map(Number));
  return data.capabilities
    .map((cap, i) => ({ cap, i }))
    .filter(({ cap, i }) => isObj(cap) && CAPABILITIES[cap.type] && !broken.has(i) && cap.enabled !== false)
    .map(({ cap }) => ({ enabled: true, gmConfirm: false, requires: [], ...cap }));
}
