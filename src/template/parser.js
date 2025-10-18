import { EXTENSIBLE_MARKER, DEFAULT_NOTE_FORMAT } from "./constants.js";

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function cloneValue(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  const cloned = {};
  for (const [key, val] of Object.entries(value)) {
    cloned[key] = cloneValue(val);
  }
  return cloned;
}

function normalizeMeta(meta) {
  if (!isPlainObject(meta)) {
    return null;
  }

  const normalized = {};

  for (const [key, value] of Object.entries(meta)) {
    normalized[key] = cloneValue(value);
  }

  if (Object.keys(normalized).length === 0) {
    return null;
  }

  return normalized;
}

function createPrimitiveNode(value) {
  return {
    type: "primitive",
    value,
    meta: null,
  };
}

function createDescribedNode(valueNode, note) {
  return {
    type: "described",
    value: valueNode,
    note,
    noteFormat: DEFAULT_NOTE_FORMAT,
    meta: valueNode?.meta ?? null,
  };
}

function createArrayNode(elements, markerIndex, metaOverrides = null) {
  let meta = null;
  if (markerIndex > -1) {
    meta = { extensible: true };
  }

  if (metaOverrides && isPlainObject(metaOverrides)) {
    meta = { ...(meta ?? {}), ...metaOverrides };
  }

  if (meta && Object.keys(meta).length === 0) {
    meta = null;
  }

  return {
    type: "array",
    elements,
    markerIndex: markerIndex > -1 ? markerIndex : undefined,
    meta,
  };
}

function parseArray(value) {
  // 判定是否为“值 + 说明”结构
  if (value.length === 2 && typeof value[1] === "string") {
    const note = value[1];
    const parsedValue = parseNode(value[0]);
    return createDescribedNode(parsedValue, note);
  }

  let markerIndex = -1;
  const elements = [];

  value.forEach((item, index) => {
    if (typeof item === "string" && item === EXTENSIBLE_MARKER) {
      if (markerIndex === -1) {
        markerIndex = index;
      }
      return;
    }

    elements.push(parseNode(item));
  });

  return createArrayNode(elements, markerIndex);
}

function parseObject(value) {
  const { $meta, ...rest } = value;
  const meta = normalizeMeta($meta);
  const entries = [];

  for (const [key, child] of Object.entries(rest)) {
    entries.push({ key, node: parseNode(child) });
  }

  return {
    type: "object",
    meta,
    entries,
  };
}

export function parseNode(value) {
  if (Array.isArray(value)) {
    return parseArray(value);
  }

  if (isPlainObject(value)) {
    return parseObject(value);
  }

  return createPrimitiveNode(value);
}

export function createEmptyObjectNode() {
  return {
    type: "object",
    meta: null,
    entries: [],
  };
}

export function parseRawTemplate(rawTemplate) {
  if (!isPlainObject(rawTemplate)) {
    throw new TypeError("模板必须是对象。");
  }

  const metadata = isPlainObject(rawTemplate.metadata)
    ? cloneValue(rawTemplate.metadata)
    : {};

  const variablesRaw = isPlainObject(rawTemplate.variables)
    ? rawTemplate.variables
    : {};

  const schemaVersion =
    typeof rawTemplate.templateSchemaVersion === "number"
      ? rawTemplate.templateSchemaVersion
      : null;

  const reservedKeys = new Set([
    "metadata",
    "variables",
    "templateSchemaVersion",
  ]);
  const extras = {};
  for (const [key, value] of Object.entries(rawTemplate)) {
    if (!reservedKeys.has(key)) {
      extras[key] = cloneValue(value);
    }
  }

  return {
    metadata,
    variables: parseObject(variablesRaw),
    schemaVersion,
    extras,
  };
}
