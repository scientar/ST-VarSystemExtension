import type { DEFAULT_NOTE_FORMAT } from "./constants";

declare module "./parser.js" {
  export interface TemplateMeta {
    extensible?: boolean;
    required?: string[];
    recursiveExtensible?: boolean;
    template?: unknown;
    [key: string]: unknown;
  }

  export interface BaseTemplateNode {
    id?: string;
    meta?: TemplateMeta | null;
  }

  export interface PrimitiveTemplateNode extends BaseTemplateNode {
    type: "primitive";
    value: string | number | boolean | null;
  }

  export interface ObjectTemplateEntry {
    key: string;
    node: TemplateNode;
  }

  export interface ObjectTemplateNode extends BaseTemplateNode {
    type: "object";
    entries: ObjectTemplateEntry[];
  }

  export interface ArrayTemplateNode extends BaseTemplateNode {
    type: "array";
    elements: TemplateNode[];
    markerIndex?: number;
  }

  export interface DescribedTemplateNode extends BaseTemplateNode {
    type: "described";
    value: TemplateNode;
    note: string;
    noteFormat: typeof DEFAULT_NOTE_FORMAT | string;
  }

  export type TemplateNode =
    | PrimitiveTemplateNode
    | ObjectTemplateNode
    | ArrayTemplateNode
    | DescribedTemplateNode;

  export interface ParsedTemplate {
    metadata: Record<string, unknown>;
    variables: ObjectTemplateNode;
    schemaVersion: number | null;
    extras: Record<string, unknown>;
  }
}

declare module "./serializer.js" {
  import type {
    TemplateNode,
    ObjectTemplateNode,
    ParsedTemplate,
  } from "./parser";

  export function serializeTemplateNode(node: TemplateNode): unknown;
  export function serializeTemplateModel(
    model: ParsedTemplate,
  ): Record<string, unknown>;
  export function createEmptyObjectNode(): ObjectTemplateNode;
}
