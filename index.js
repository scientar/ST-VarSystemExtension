import { event_types, eventSource } from "/scripts/events.js";
import {
  getContext,
  renderExtensionTemplateAsync,
  writeExtensionField,
} from "/scripts/extensions.js";
import { parseRawTemplate } from "./src/template/parser.js";
import { serializeTemplateModel } from "./src/template/serializer.js";
import { createVariableBlockEditor } from "./src/editor/variableBlockEditor.js";

const EXTENSION_NAMESPACE = "st-var-system";
const EXTENSION_LOG_PREFIX = "[ST-VarSystemExtension]";
const TEMPLATE_EXTENSION_KEY = "st_var_system";
const TEMPLATE_EDITOR_CONTAINER_ID = "var_system_template_editor";
const TEMPLATE_STATUS_ID = "var_system_template_status";
const TEMPLATE_SAVE_ID = "var_system_template_save";
const TEMPLATE_DISCARD_ID = "var_system_template_discard";
const TEMPLATE_RELOAD_ID = "var_system_template_reload";
const TEMPLATE_CLEAR_ID = "var_system_template_clear";
const TEMPLATE_ENABLED_TOGGLE_ID = "var_system_template_enabled";
const TEMPLATE_RESET_ID = "var_system_template_reset";
const TEMPLATE_REPARSE_ID = "var_system_template_reparse";
const TEMPLATE_SCHEMA_INFO_ID = "var_system_template_schema";
const DEFAULT_TEMPLATE_SCHEMA_VERSION = 1;

const templateState = {
  editorController: null,
  editorContainer: null,
  dirty: false,
  hasErrors: false,
  loading: false,
  currentDraft: null,
  currentModel: null,
  loadedTemplate: null,
  loadedModel: null,
  templateMeta: null,
  currentCharacterId: null,
  enabled: false,
  parserError: null,
  schemaVersion: null,
};

const JSON_EDITOR_VERSION = "3.10.0";
const JSON_EDITOR_STYLE_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@${JSON_EDITOR_VERSION}/themes/jse-theme-dark.css`;
const JSON_EDITOR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/vanilla-jsoneditor@${JSON_EDITOR_VERSION}/standalone.js`;
let templateButtons = null;
let pendingTemplateRefresh = null;

const STATUS_COLORS = {
  success: "#6ee7b7",
  error: "#fca5a5",
  warn: "#fbbf24",
  info: "var(--SmartThemeBodyColor, #aaa)",
};

function bindTemplateSection(rootElement) {
  if (!rootElement || templateButtons) {
    return;
  }

  templateButtons = {
    save: rootElement.querySelector(`#${TEMPLATE_SAVE_ID}`),
    discard: rootElement.querySelector(`#${TEMPLATE_DISCARD_ID}`),
    reload: rootElement.querySelector(`#${TEMPLATE_RELOAD_ID}`),
    status: rootElement.querySelector(`#${TEMPLATE_STATUS_ID}`),
    clear: rootElement.querySelector(`#${TEMPLATE_CLEAR_ID}`),
    enableToggle: rootElement.querySelector(`#${TEMPLATE_ENABLED_TOGGLE_ID}`),
    reset: rootElement.querySelector(`#${TEMPLATE_RESET_ID}`),
    reparse: rootElement.querySelector(`#${TEMPLATE_REPARSE_ID}`),
    schema: rootElement.querySelector(`#${TEMPLATE_SCHEMA_INFO_ID}`),
  };

  templateButtons.save?.addEventListener("click", () => {
    void saveCurrentTemplate();
  });

  templateButtons.discard?.addEventListener("click", () => {
    void discardTemplateChanges();
  });

  templateButtons.reload?.addEventListener("click", () => {
    void refreshTemplateForActiveCharacter(true);
  });

  templateButtons.clear?.addEventListener("click", () => {
    void clearTemplateForActiveCharacter();
  });

  templateButtons.reset?.addEventListener("click", () => {
    void resetTemplateToDefault();
  });

  templateButtons.reparse?.addEventListener("click", () => {
    void reparseCurrentDraft();
  });

  templateButtons.enableToggle?.addEventListener("change", (event) => {
    const isChecked = Boolean(event.target?.checked);
    void setEnabledForActiveCharacter(isChecked);
  });

  updateTemplateStatus("尚未加载模板", "info");
  updateTemplateControls();
  updateEnableToggleUI();
  updateSchemaInfo();
}

function updateTemplateStatus(message, level = "info") {
  const element =
    templateButtons?.status || document.getElementById(TEMPLATE_STATUS_ID);
  if (!element) {
    return;
  }

  element.textContent = message ?? "";
  element.style.color = STATUS_COLORS[level] ?? STATUS_COLORS.info;
}

function updateTemplateControls() {
  if (!templateButtons) {
    return;
  }

  const disableAll = templateState.loading || !templateState.currentDraft;

  if (templateButtons.save) {
    templateButtons.save.disabled =
      disableAll ||
      templateState.hasErrors ||
      templateState.parserError ||
      !templateState.dirty;
  }

  if (templateButtons.discard) {
    templateButtons.discard.disabled =
      disableAll || !templateState.loadedTemplate || !templateState.dirty;
  }

  if (templateButtons.reload) {
    templateButtons.reload.disabled = templateState.loading;
  }

  if (templateButtons.clear) {
    templateButtons.clear.disabled =
      templateState.loading || !templateState.loadedTemplate;
  }

  if (templateButtons.reset) {
    templateButtons.reset.disabled =
      templateState.loading || !templateState.currentCharacterId;
  }

  if (templateButtons.reparse) {
    templateButtons.reparse.disabled =
      templateState.loading || !templateState.currentDraft;
  }

  updateEnableToggleUI();
  updateSchemaInfo();
}

function updateEnableToggleUI() {
  if (!templateButtons?.enableToggle) {
    return;
  }

  const shouldDisable =
    templateState.loading || !templateState.currentCharacterId;
  templateButtons.enableToggle.disabled = shouldDisable;
  templateButtons.enableToggle.checked = Boolean(templateState.enabled);
}

function updateSchemaInfo() {
  const element =
    templateButtons?.schema || document.getElementById(TEMPLATE_SCHEMA_INFO_ID);
  if (!element) {
    return;
  }

  let text = "Schema: —";
  let color = STATUS_COLORS.info;

  if (templateState.loading) {
    text = "Schema: 加载中…";
  } else if (templateState.parserError) {
    const reason =
      templateState.parserError?.message ?? String(templateState.parserError);
    text = `Schema: 解析失败（${reason}）`;
    color = STATUS_COLORS.warn;
  } else if (typeof templateState.schemaVersion === "number") {
    text = `Schema: v${templateState.schemaVersion}`;
    color = STATUS_COLORS.success;
  } else if (templateState.dirty) {
    text = "Schema: 未解析";
    color = STATUS_COLORS.warn;
  }

  element.textContent = text;
  element.style.color = color;
}

function scheduleTemplateRefresh(force = false) {
  if (pendingTemplateRefresh !== null) {
    clearTimeout(pendingTemplateRefresh);
  }

  pendingTemplateRefresh = setTimeout(() => {
    pendingTemplateRefresh = null;
    void refreshTemplateForActiveCharacter(force);
  }, 0);
}

function refreshEditorRendering() {
  if (!templateState.currentDraft) {
    return;
  }

  const applyContent = () =>
    setEditorContent(cloneTemplate(templateState.currentDraft), {
      silent: true,
    });

  if (!templateState.editorController) {
    void ensureEditorInstance().then((controller) => {
      if (!controller) {
        return;
      }
      applyContent();
    });
    return;
  }

  applyContent();
}

function cloneTemplate(value) {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeTemplate(rawTemplate) {
  const source =
    rawTemplate === undefined || rawTemplate === null
      ? {}
      : cloneTemplate(rawTemplate);

  try {
    const parsed = parseRawTemplate(source);
    if (typeof parsed.schemaVersion !== "number") {
      parsed.schemaVersion = DEFAULT_TEMPLATE_SCHEMA_VERSION;
    }

    const normalized = serializeTemplateModel(parsed);
    return {
      parsed,
      normalized,
      schemaVersion: parsed.schemaVersion,
      error: null,
    };
  } catch (error) {
    return {
      parsed: null,
      normalized: source,
      schemaVersion: null,
      error,
    };
  }
}

function applyTemplateResult(result, { markAsLoaded = false } = {}) {
  templateState.currentDraft = cloneTemplate(result.normalized);
  templateState.currentModel = result.parsed
    ? cloneTemplate(result.parsed)
    : null;
  templateState.schemaVersion = result.schemaVersion;
  templateState.parserError = result.error ?? null;

  if (markAsLoaded) {
    templateState.loadedTemplate = cloneTemplate(result.normalized);
    templateState.loadedModel = result.parsed
      ? cloneTemplate(result.parsed)
      : null;
  }

  if (result.error) {
    console.warn(
      EXTENSION_LOG_PREFIX,
      "模板解析失败，将以原始 JSON 编辑",
      result.error,
    );
  }
}

function buildExtensionPayload({
  templateBody = templateState.loadedTemplate,
  templateId = templateState.templateMeta?.templateId ?? null,
  updatedAt = templateState.templateMeta?.updatedAt ?? null,
  enabled = templateState.enabled,
  includeTemplate = templateBody !== null && templateBody !== undefined,
} = {}) {
  const payload = {
    enabled: Boolean(enabled),
  };

  if (templateId) {
    payload.templateId = templateId;
  }

  if (includeTemplate && templateBody !== undefined && templateBody !== null) {
    payload.templateBody = cloneTemplate(templateBody);
  }

  if (includeTemplate && updatedAt !== undefined && updatedAt !== null) {
    payload.updatedAt = updatedAt;
  }

  return payload;
}

function buildDefaultTemplate(character) {
  return {
    metadata: {
      name: character?.name ?? "",
      createdAt: new Date().toISOString(),
      version: 1,
    },
    variables: {},
  };
}

function generateTemplateId(character) {
  if (character?.avatar) {
    return `avatar:${character.avatar}`;
  }

  if (character?.name) {
    return `name:${character.name}`;
  }

  if (globalThis.crypto?.randomUUID) {
    return `uuid:${globalThis.crypto.randomUUID()}`;
  }

  return `uuid:${Date.now().toString(36)}`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }

  try {
    return new Date(timestamp).toLocaleString();
  } catch (_error) {
    return String(timestamp);
  }
}

async function ensureEditorInstance({ readOnly = false } = {}) {
  const container = document.getElementById(TEMPLATE_EDITOR_CONTAINER_ID);

  if (!container) {
    templateState.editorContainer = null;
    return null;
  }

  templateState.editorContainer = container;

  if (!templateState.editorController) {
    templateState.editorController = createVariableBlockEditor({
      container,
      initialValue: templateState.currentDraft ?? {},
      styleUrl: JSON_EDITOR_STYLE_URL,
      scriptUrl: JSON_EDITOR_SCRIPT_URL,
      readOnly,
      onChange: handleEditorChange,
      onFallback: () => {
        updateTemplateStatus(
          "JSON 编辑器资源加载失败，已降级为纯文本模式。",
          "warn",
        );
        updateTemplateControls();
      },
    });
  } else {
    templateState.editorController.setContainer(container);
  }

  try {
    await templateState.editorController.ensureReady();
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "初始化变量块编辑器失败", error);
    return null;
  }

  return templateState.editorController;
}

function setEditorContent(json, { silent = false } = {}) {
  if (!templateState.editorController) {
    return;
  }

  const normalized =
    json === undefined || json === null ? {} : cloneTemplate(json);

  templateState.editorController.setValue(normalized, { silent });
}

function getEditorContent() {
  if (!templateState.editorController) {
    return null;
  }

  return templateState.editorController.getValue();
}

function handleEditorChange(content, _previousContent, metadata) {
  const hasErrors =
    Boolean(metadata?.contentErrors?.length) || content?.json === undefined;

  templateState.hasErrors = hasErrors;
  templateState.dirty = true;

  if (!hasErrors && content?.json !== undefined) {
    templateState.currentDraft = cloneTemplate(content.json);
    templateState.parserError = null;
    templateState.schemaVersion = null;
    templateState.currentModel = null;
  }

  updateTemplateControls();
  updateTemplateStatus(
    hasErrors ? "JSON 无法解析，请检查错误。" : "模板已修改，尚未保存。",
    hasErrors ? "error" : "warn",
  );
}

async function discardTemplateChanges() {
  if (!templateState.loadedTemplate) {
    updateTemplateStatus("没有可恢复的模板版本。", "warn");
    return;
  }

  const result = normalizeTemplate(templateState.loadedTemplate);
  applyTemplateResult(result, { markAsLoaded: true });

  templateState.dirty = false;
  templateState.hasErrors = Boolean(result.error);
  templateState.parserError = result.error ?? null;
  templateState.templateMeta = {
    ...templateState.templateMeta,
    templateSchemaVersion: result.schemaVersion ?? null,
  };

  const controller = await ensureEditorInstance();
  if (controller) {
    setEditorContent(templateState.currentDraft ?? {}, { silent: true });
  }

  updateTemplateControls();
  updateTemplateStatus("已恢复为最后保存的模板。", "info");
}

async function refreshTemplateForActiveCharacter(force = false) {
  const context = getContext();
  const activeCharacterId = context.characterId;

  if (activeCharacterId == null) {
    templateState.currentCharacterId = null;
    templateState.loadedTemplate = null;
    templateState.loadedModel = null;
    templateState.currentDraft = null;
    templateState.currentModel = null;
    templateState.templateMeta = null;
    templateState.enabled = false;
    templateState.dirty = false;
    templateState.hasErrors = false;
    templateState.parserError = null;
    templateState.schemaVersion = null;
    templateState.loading = false;

    if (templateState.editorController) {
      setEditorContent({}, { silent: true });
    }

    updateTemplateStatus("请选择角色后再编辑模板。", "warn");
    updateTemplateControls();
    return;
  }

  if (!force && templateState.currentCharacterId === activeCharacterId) {
    return;
  }

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("模板加载中……", "info");

  try {
    const controller = await ensureEditorInstance();

    const character = context.characters?.[activeCharacterId];
    const extensionData =
      character?.data?.extensions?.[TEMPLATE_EXTENSION_KEY] ?? null;

    const hasTemplate = Boolean(extensionData?.templateBody);
    const templateId =
      extensionData?.templateId || generateTemplateId(character);
    const sourceTemplate = hasTemplate
      ? extensionData.templateBody
      : buildDefaultTemplate(character);
    const normalizationResult = normalizeTemplate(sourceTemplate);

    templateState.currentCharacterId = activeCharacterId;
    applyTemplateResult(normalizationResult, { markAsLoaded: hasTemplate });

    if (!hasTemplate) {
      templateState.loadedTemplate = null;
      templateState.loadedModel = null;
    }

    templateState.templateMeta = {
      templateId,
      updatedAt: extensionData?.updatedAt ?? null,
      templateSchemaVersion: normalizationResult.schemaVersion ?? null,
    };

    const resolvedEnabled =
      typeof extensionData?.enabled === "boolean"
        ? extensionData.enabled
        : hasTemplate;
    templateState.enabled = Boolean(resolvedEnabled);
    templateState.dirty = Boolean(normalizationResult.error) || !hasTemplate;
    templateState.hasErrors = Boolean(normalizationResult.error);

    if (controller && templateState.currentDraft) {
      setEditorContent(templateState.currentDraft, { silent: true });
    }

    let statusMessage;
    let statusLevel = "info";

    if (normalizationResult.error) {
      const reason =
        normalizationResult.error?.message || String(normalizationResult.error);
      statusMessage = `模板已加载，但解析失败：${reason}`;
      statusLevel = "warn";
    } else if (hasTemplate) {
      statusMessage = `模板已加载（最后更新：${formatTimestamp(extensionData?.updatedAt) || "未知"}）。`;
    } else {
      statusMessage = "已为该角色准备默认模板，请完善后保存。";
      statusLevel = "warn";
    }

    updateTemplateStatus(statusMessage, statusLevel);
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "加载模板失败", error);
    updateTemplateStatus(`加载模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

async function persistTemplateToPlugin(templateId, templateBody) {
  const context = getContext();
  const headers = {
    ...context.getRequestHeaders(),
    "Content-Type": "application/json",
  };

  const response = await fetch(
    "/api/plugins/var-manager/var-manager/templates",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        characterName: templateId,
        template: templateBody,
      }),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }

  return response.json().catch(() => null);
}

async function setEnabledForActiveCharacter(nextEnabled) {
  const context = getContext();
  const characterId = context.characterId;

  if (characterId == null) {
    updateTemplateStatus("未选择角色，无法修改启用状态。", "error");
    updateEnableToggleUI();
    return;
  }

  if (templateState.loading) {
    updateEnableToggleUI();
    return;
  }

  const previousValue = templateState.enabled;
  templateState.enabled = Boolean(nextEnabled);
  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus(
    templateState.enabled ? "正在启用变量系统……" : "正在停用变量系统……",
    "info",
  );

  try {
    const includeTemplate = templateState.loadedTemplate !== null;
    const payload = buildExtensionPayload({
      includeTemplate,
      enabled: templateState.enabled,
    });

    if (!payload.templateId) {
      const character = context.characters?.[characterId];
      payload.templateId =
        templateState.templateMeta?.templateId ?? generateTemplateId(character);
    }

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    templateState.templateMeta = {
      templateId: payload.templateId ?? null,
      updatedAt: templateState.templateMeta?.updatedAt ?? null,
    };

    updateTemplateStatus(
      templateState.enabled
        ? "变量系统已为该角色启用。"
        : "变量系统已为该角色停用。",
      "success",
    );
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "更新启用状态失败", error);
    templateState.enabled = previousValue;
    updateTemplateStatus(
      `更新启用状态失败：${error?.message ?? error}`,
      "error",
    );
  } finally {
    templateState.loading = false;
    updateEnableToggleUI();
    updateTemplateControls();
  }
}

async function clearTemplateForActiveCharacter() {
  const context = getContext();
  const characterId = context.characterId;

  if (characterId == null) {
    updateTemplateStatus("未选择角色，无法清空模板。", "error");
    return;
  }

  if (!templateState.loadedTemplate) {
    updateTemplateStatus("当前没有保存的模板，无需清空。", "info");
    return;
  }

  const confirmationMessage =
    "确定要清空模板吗？这会从角色卡中移除模板字段，但不会改变启用状态。";
  const confirmed =
    window.confirm?.(confirmationMessage) ?? confirm(confirmationMessage);

  if (!confirmed) {
    updateTemplateStatus("已取消清空模板。", "info");
    return;
  }

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("正在清空模板……", "info");

  try {
    const payload = buildExtensionPayload({
      includeTemplate: false,
      enabled: templateState.enabled,
      templateId: templateState.templateMeta?.templateId ?? null,
    });

    if (!payload.templateId) {
      const character = context.characters?.[characterId];
      payload.templateId = generateTemplateId(character);
    }

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    const character = context.characters?.[characterId];
    const editor = await ensureEditorInstance();
    const defaultTemplate = buildDefaultTemplate(character);

    templateState.loadedTemplate = null;
    templateState.currentDraft = cloneTemplate(defaultTemplate);
    templateState.templateMeta = {
      templateId: payload.templateId,
      updatedAt: null,
    };
    templateState.dirty = true;
    templateState.hasErrors = false;

    if (editor) {
      setEditorContent(cloneTemplate(defaultTemplate));
    }

    updateTemplateStatus(
      "模板字段已清空，编辑器已恢复默认骨架，请视需要重新保存。",
      "warn",
    );
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "清空模板失败", error);
    updateTemplateStatus(`清空模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

async function saveCurrentTemplate() {
  if (templateState.hasErrors) {
    updateTemplateStatus("存在未解决的 JSON 错误，无法保存。", "error");
    return;
  }

  const editor = await ensureEditorInstance();

  if (!editor) {
    updateTemplateStatus("编辑器尚未准备就绪。", "error");
    return;
  }

  const content = editor.get();
  const json = content?.json;

  if (json === undefined) {
    updateTemplateStatus("请修复模板中的错误后再保存。", "error");
    return;
  }

  const context = getContext();
  const characterId = context.characterId;

  if (characterId == null) {
    updateTemplateStatus("未选择角色，无法保存模板。", "error");
    return;
  }

  const character = context.characters?.[characterId];
  const templateId =
    templateState.templateMeta?.templateId || generateTemplateId(character);
  const payload = {
    templateId,
    templateBody: json,
    updatedAt: Date.now(),
    enabled: templateState.enabled,
  };

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("模板保存中……", "info");

  try {
    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    let pluginFailed = false;

    try {
      await persistTemplateToPlugin(templateId, json);
    } catch (pluginError) {
      console.warn(EXTENSION_LOG_PREFIX, "模板写入服务器失败", pluginError);
      updateTemplateStatus(
        `模板已保存到角色卡，但写入服务器失败：${pluginError?.message ?? pluginError}`,
        "warn",
      );
      pluginFailed = true;
    }

    templateState.loadedTemplate = cloneTemplate(json);
    templateState.currentDraft = cloneTemplate(json);
    templateState.templateMeta = {
      templateId,
      updatedAt: payload.updatedAt,
    };
    templateState.dirty = false;
    templateState.hasErrors = false;

    if (!pluginFailed) {
      updateTemplateStatus("模板已保存。", "success");
    }
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "保存模板失败", error);
    updateTemplateStatus(`保存模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

function onContextChanged() {
  scheduleTemplateRefresh(true);
}

function animateDrawer(element, shouldOpen) {
  const editor = window.EDITOR;
  if (editor?.slideToggle) {
    const options = {
      ...(editor.getSlideToggleOptions?.() ?? {}),
      onAnimationEnd: (el) => {
        el.closest(".drawer-content")?.classList.remove("resizing");
      },
    };
    element.classList.add("resizing");
    editor.slideToggle(element, options);
    return;
  }

  const $el = $(element);
  if (shouldOpen) {
    $el.stop(true, true).slideDown(200);
  } else {
    $el.stop(true, true).slideUp(200);
  }
}

function closeDrawer($icon, $content) {
  if (!$icon.hasClass("openIcon")) {
    return;
  }

  $icon.toggleClass("openIcon closedIcon");
  $content.toggleClass("openDrawer closedDrawer");
  animateDrawer($content.get(0), false);
}

function openDrawer($icon, $content) {
  if ($icon.hasClass("openIcon")) {
    return;
  }

  // 关闭其他已经打开的抽屉，保持与主题样式一致
  $(".drawer-icon.openIcon")
    .not($icon)
    .each((_, icon) => {
      const $otherIcon = $(icon);
      const $otherContent = $otherIcon
        .closest(".drawer")
        .find(".drawer-content")
        .first();
      closeDrawer($otherIcon, $otherContent);
    });

  $icon.toggleClass("closedIcon openIcon");
  $content.toggleClass("closedDrawer openDrawer");
  animateDrawer($content.get(0), true);

  setTimeout(() => {
    refreshEditorRendering();
  }, 250);
}

async function injectAppHeaderEntry() {
  if (document.querySelector("#var_system_drawer")) {
    return;
  }

  let templateHtml = null;
  try {
    templateHtml = await renderExtensionTemplateAsync(
      "third-party/ST-VarSystemExtension/assets/templates",
      "appHeaderVarSystemDrawer",
    );
  } catch (error) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} 模板 appHeaderVarSystemDrawer 加载失败`,
      error,
    );
    return;
  }

  if (!templateHtml) {
    console.warn(
      `${EXTENSION_LOG_PREFIX} 模板 appHeaderVarSystemDrawer 返回空内容`,
    );
    return;
  }

  const $drawer = $(templateHtml);
  const $anchor = $("#extensions-settings-button");
  if ($anchor.length === 0) {
    console.warn(`${EXTENSION_LOG_PREFIX} 找不到扩展设置按钮，无法插入入口`);
    return;
  }

  $anchor.after($drawer);

  const $icon = $drawer.find("#var_system_drawer_icon");
  const $content = $drawer.find("#var_system_drawer_content");

  $content.hide();

  $drawer.find(".drawer-toggle").on("click", () => {
    if ($icon.hasClass("openIcon")) {
      closeDrawer($icon, $content);
    } else {
      openDrawer($icon, $content);
    }
  });

  bindTemplateSection($drawer.get(0));

  scheduleTemplateRefresh(true);

  console.log(`${EXTENSION_LOG_PREFIX} 自定义入口已注入`);
}

async function initExtension() {
  console.log(`${EXTENSION_LOG_PREFIX} (${EXTENSION_NAMESPACE}) 初始化`);
  await injectAppHeaderEntry();
  eventSource.on(event_types.CHAT_CHANGED, onContextChanged);
  eventSource.on(event_types.CHARACTER_EDITOR_OPENED, onContextChanged);
}

async function shutdownExtension() {
  console.log(`${EXTENSION_LOG_PREFIX} 卸载`);
  eventSource.removeListener(event_types.CHAT_CHANGED, onContextChanged);
  eventSource.removeListener(
    event_types.CHARACTER_EDITOR_OPENED,
    onContextChanged,
  );
}

// 允许外部在需要时显式调用
window.STVarSystemExtension = {
  init: initExtension,
  exit: shutdownExtension,
};

// 自动初始化
$(async () => {
  try {
    await initExtension();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 初始化失败`, error);
  }
});
