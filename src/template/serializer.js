import { EXTENSIBLE_MARKER } from "./constants.js";
import { createEmptyObjectNode } from "./parser.js";

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

function serializeEntries(entries) {
  const result = {};

  entries.forEach(({ key, node }) => {
    result[key] = serializeTemplateNode(node);
  });

  return result;
}

function ensureMetaForSerialization(meta) {
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) {
      cleaned[key] = cloneValue(value);
    }
  }

  if (Object.keys(cleaned).length === 0) {
    return null;
  }

  return cleaned;
}

export function serializeTemplateNode(node) {
  if (!node) {
    return null;
  }

  switch (node.type) {
    case "primitive":
      return node.value;
    case "object": {
      const result = serializeEntries(node.entries ?? []);
      const meta = ensureMetaForSerialization(node.meta);
      if (meta) {
        result.$meta = meta;
      }
      return result;
    }
    case "array": {
      const list = (node.elements ?? []).map((child) =>
        serializeTemplateNode(child),
      );
      if (node.meta?.extensible) {
        const index =
          typeof node.markerIndex === "number" ? node.markerIndex : 0;
        const safeIndex = Math.min(Math.max(index, 0), list.length);
        list.splice(safeIndex, 0, EXTENSIBLE_MARKER);
      }
      return list;
    }
    case "described": {
      const serializedValue = serializeTemplateNode(node.value);
      const note = node.note ?? "";
      return [serializedValue, note];
    }
    default:
      throw new TypeError(`未知的节点类型: ${node.type}`);
  }
}

export function serializeTemplateModel(model) {
  if (!model || typeof model !== "object") {
    throw new TypeError("待序列化的模板模型必须是对象。");
  }

  const result = {
    metadata: cloneValue(model.metadata ?? {}),
    variables: serializeTemplateNode(
      model.variables ?? createEmptyObjectNode(),
    ),
  };

  if (typeof model.schemaVersion === "number") {
    result.templateSchemaVersion = model.schemaVersion;
  }

  if (model.extras && typeof model.extras === "object") {
    for (const [key, value] of Object.entries(model.extras)) {
      if (
        key === "metadata" ||
        key === "variables" ||
        key === "templateSchemaVersion"
      ) {
        continue;
      }
      result[key] = cloneValue(value);
    }
  }

  return result;
}
