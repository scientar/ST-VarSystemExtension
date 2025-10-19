import { event_types, eventSource } from "/scripts/events.js";
import {
  getContext,
  renderExtensionTemplateAsync,
  writeExtensionField,
} from "/scripts/extensions.js";
import { callGenericPopup, POPUP_TYPE } from "/scripts/popup.js";
import { createVariableBlockEditor } from "./src/editor/variableBlockEditor.js";

const EXTENSION_NAMESPACE = "st-var-system";
const EXTENSION_LOG_PREFIX = "[ST-VarSystemExtension]";
const TEMPLATE_EXTENSION_KEY = "st_var_system";
const TEMPLATE_EDITOR_CONTAINER_ID = "var_system_template_editor";
const TEMPLATE_STATUS_ID = "var_system_template_status";
const TEMPLATE_SAVE_ID = "var_system_template_save";
const TEMPLATE_SAVE_AS_GLOBAL_ID = "var_system_template_save_as_global";
const TEMPLATE_DISCARD_ID = "var_system_template_discard";
const TEMPLATE_RELOAD_ID = "var_system_template_reload";
const TEMPLATE_CLEAR_ID = "var_system_template_clear";
const TEMPLATE_ENABLED_TOGGLE_ID = "var_system_template_enabled";

// 简化后的模板状态：只保留最小必要字段
const templateState = {
  editorController: null,
  currentCharacterId: null,
  templateBody: null, // 角色卡中保存的模板 JSON
  draftBody: null, // 编辑器中的副本
  enabled: false, // 是否启用变量系统
  dirty: false, // 是否有未保存修改
  hasErrors: false, // JSON 编辑器是否有错误
  loading: false, // 是否正在加载
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
    saveAsGlobal: rootElement.querySelector(`#${TEMPLATE_SAVE_AS_GLOBAL_ID}`),
    discard: rootElement.querySelector(`#${TEMPLATE_DISCARD_ID}`),
    reload: rootElement.querySelector(`#${TEMPLATE_RELOAD_ID}`),
    status: rootElement.querySelector(`#${TEMPLATE_STATUS_ID}`),
    clear: rootElement.querySelector(`#${TEMPLATE_CLEAR_ID}`),
    enableToggle: rootElement.querySelector(`#${TEMPLATE_ENABLED_TOGGLE_ID}`),
  };

  templateButtons.save?.addEventListener("click", () => {
    void saveCurrentTemplate();
  });

  templateButtons.saveAsGlobal?.addEventListener("click", () => {
    void saveTemplateAsGlobalSnapshot();
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

  templateButtons.enableToggle?.addEventListener("change", (event) => {
    const isChecked = Boolean(event.target?.checked);
    void setEnabledForActiveCharacter(isChecked);
  });

  updateTemplateStatus("尚未加载模板", "info");
  updateTemplateControls();
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

  const hasTemplate = templateState.templateBody !== null;
  const disableAll = templateState.loading || !templateState.draftBody;

  if (templateButtons.save) {
    templateButtons.save.disabled =
      disableAll || templateState.hasErrors || !templateState.dirty;
  }

  if (templateButtons.discard) {
    templateButtons.discard.disabled =
      disableAll || !hasTemplate || !templateState.dirty;
  }

  if (templateButtons.reload) {
    templateButtons.reload.disabled = templateState.loading;
  }

  if (templateButtons.clear) {
    templateButtons.clear.disabled = templateState.loading || !hasTemplate;
  }

  updateEnableToggleUI();
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

function scheduleTemplateRefresh(force = false) {
  if (pendingTemplateRefresh !== null) {
    clearTimeout(pendingTemplateRefresh);
  }

  pendingTemplateRefresh = setTimeout(() => {
    pendingTemplateRefresh = null;
    void refreshTemplateForActiveCharacter(force);
  }, 0);
}

function cloneJSON(value) {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function buildDefaultTemplate(character) {
  return {
    metadata: {
      name: character?.name ?? "",
      createdAt: new Date().toISOString(),
    },
    variables: {},
  };
}

async function ensureEditorInstance({ readOnly = false } = {}) {
  const container = document.getElementById(TEMPLATE_EDITOR_CONTAINER_ID);

  if (!container) {
    return null;
  }

  if (!templateState.editorController) {
    templateState.editorController = createVariableBlockEditor({
      container,
      initialValue: templateState.draftBody ?? {},
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
    console.error(EXTENSION_LOG_PREFIX, "初始化编辑器失败", error);
    return null;
  }

  return templateState.editorController;
}

function handleEditorChange(content, _previousContent, metadata) {
  const hasErrors =
    Boolean(metadata?.contentErrors?.length) || content?.json === undefined;

  templateState.hasErrors = hasErrors;
  templateState.dirty = true;

  if (!hasErrors && content?.json !== undefined) {
    templateState.draftBody = cloneJSON(content.json);
  }

  updateTemplateControls();
  updateTemplateStatus(
    hasErrors ? "JSON 无法解析，请检查错误。" : "模板已修改，尚未保存。",
    hasErrors ? "error" : "warn",
  );
}

async function discardTemplateChanges() {
  if (!templateState.templateBody) {
    updateTemplateStatus("没有可恢复的模板版本。", "warn");
    return;
  }

  templateState.draftBody = cloneJSON(templateState.templateBody);
  templateState.dirty = false;
  templateState.hasErrors = false;

  const controller = await ensureEditorInstance();
  if (controller) {
    controller.setValue(templateState.draftBody ?? {}, { silent: true });
  }

  updateTemplateControls();
  updateTemplateStatus("已恢复为最后保存的模板。", "info");
}

async function refreshTemplateForActiveCharacter(force = false) {
  const context = getContext();
  const activeCharacterId = context.characterId;

  if (activeCharacterId == null) {
    templateState.currentCharacterId = null;
    templateState.templateBody = null;
    templateState.draftBody = null;
    templateState.enabled = false;
    templateState.dirty = false;
    templateState.hasErrors = false;
    templateState.loading = false;

    if (templateState.editorController) {
      templateState.editorController.setValue({}, { silent: true });
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
    const loadedBody = hasTemplate
      ? extensionData.templateBody
      : buildDefaultTemplate(character);

    templateState.currentCharacterId = activeCharacterId;
    templateState.templateBody = hasTemplate ? cloneJSON(loadedBody) : null;
    templateState.draftBody = cloneJSON(loadedBody);
    templateState.enabled = Boolean(extensionData?.enabled);
    templateState.dirty = !hasTemplate;
    templateState.hasErrors = false;

    if (controller) {
      controller.setValue(templateState.draftBody ?? {}, { silent: true });
    }

    const statusMessage = hasTemplate
      ? "模板已加载。"
      : "已为该角色准备默认模板，请完善后保存。";

    updateTemplateStatus(statusMessage, hasTemplate ? "info" : "warn");
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "加载模板失败", error);
    updateTemplateStatus(`加载模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
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
    const payload = {
      enabled: templateState.enabled,
    };

    if (templateState.templateBody) {
      payload.templateBody = cloneJSON(templateState.templateBody);
    }

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

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

  if (!templateState.templateBody) {
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
    const payload = {
      enabled: templateState.enabled,
    };

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    const character = context.characters?.[characterId];
    const controller = await ensureEditorInstance();
    const defaultTemplate = buildDefaultTemplate(character);

    templateState.templateBody = null;
    templateState.draftBody = cloneJSON(defaultTemplate);
    templateState.dirty = true;
    templateState.hasErrors = false;

    if (controller) {
      controller.setValue(defaultTemplate, { silent: false });
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

  const controller = await ensureEditorInstance();
  if (!controller) {
    updateTemplateStatus("编辑器尚未准备就绪。", "error");
    return;
  }

  const content = controller.get();
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

  templateState.loading = true;
  updateTemplateControls();
  updateTemplateStatus("模板保存中……", "info");

  try {
    const payload = {
      templateBody: json,
      enabled: templateState.enabled,
    };

    await writeExtensionField(characterId, TEMPLATE_EXTENSION_KEY, payload);

    templateState.templateBody = cloneJSON(json);
    templateState.draftBody = cloneJSON(json);
    templateState.dirty = false;
    templateState.hasErrors = false;

    updateTemplateStatus("模板已保存。", "success");
  } catch (error) {
    console.error(EXTENSION_LOG_PREFIX, "保存模板失败", error);
    updateTemplateStatus(`保存模板失败：${error?.message ?? error}`, "error");
  } finally {
    templateState.loading = false;
    updateTemplateControls();
  }
}

/**
 * 将当前角色模板保存为全局快照
 */
async function saveTemplateAsGlobalSnapshot() {
  const context = getContext();
  if (!context.characterId) {
    await callGenericPopup("请先选择一个角色", POPUP_TYPE.TEXT, "", {
      okButton: "确定",
    });
    return;
  }

  // 检查是否有有效的模板内容
  const controller = await ensureEditorInstance();
  if (!controller) {
    updateTemplateStatus("编辑器尚未准备就绪。", "error");
    return;
  }

  const content = controller.get();
  const json = content?.json;

  if (json === undefined || !json) {
    await callGenericPopup(
      "当前模板为空或有错误，无法保存为全局快照",
      POPUP_TYPE.TEXT,
      "",
      { okButton: "确定" },
    );
    return;
  }

  // 获取角色名称作为默认快照名称
  const character = context.characters?.[context.characterId];
  const defaultName = character?.name ? `${character.name}的模板` : "角色模板";

  // 请求用户输入快照名称
  const snapshotName = await callGenericPopup(
    "请输入全局快照的名称：",
    POPUP_TYPE.INPUT,
    defaultName,
    { okButton: "保存", cancelButton: "取消" },
  );

  if (!snapshotName) {
    return; // 用户取消
  }

  try {
    updateTemplateStatus("正在保存为全局快照...", "info");

    // 调用插件 API 保存
    const payload = {
      name: snapshotName,
      description: `从角色"${character?.name || "未知"}"的模板创建`,
      tags: ["角色模板", character?.name].filter(Boolean),
      snapshotBody: json,
    };

    await callPluginAPI("/global-snapshots", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    updateTemplateStatus(`已保存为全局快照："${snapshotName}"`, "success");

    console.log(
      `${EXTENSION_LOG_PREFIX} 角色模板已保存为全局快照:`,
      snapshotName,
    );

    // 提示用户并询问是否切换到全局快照标签页
    const switchTab = await callGenericPopup(
      `全局快照"${snapshotName}"已创建成功！\n\n是否切换到全局快照标签页查看？`,
      POPUP_TYPE.CONFIRM,
      "",
      { okButton: "查看", cancelButton: "留在这里" },
    );

    if (switchTab) {
      // 切换到全局快照标签页
      document.getElementById("var_system_tab_global")?.click();
      // 刷新快照列表
      await loadGlobalSnapshots();
    }
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 保存为全局快照失败:`, error);

    let errorMsg = "保存失败";
    if (error.message.includes("插件未安装")) {
      errorMsg =
        "插件未安装或未启用。\n\n全局快照功能需要安装 ST-VarSystemPlugin 插件。";
    } else {
      errorMsg = `保存失败: ${error.message}`;
    }

    updateTemplateStatus(errorMsg, "error");

    await callGenericPopup(errorMsg, POPUP_TYPE.TEXT, "", {
      okButton: "关闭",
    });
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
}

// ============================================================================
// 标签页切换功能
// ============================================================================

let currentTab = "character";

function switchTab(tabName) {
  if (currentTab === tabName) return;

  currentTab = tabName;

  // 更新标签按钮样式
  document.querySelectorAll(".var-system-tab").forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    if (isActive) {
      btn.classList.add("active");
      btn.style.borderBottomColor = "var(--SmartThemeQuoteColor, #4a9eff)";
      btn.style.color = "var(--SmartThemeQuoteColor, #4a9eff)";
    } else {
      btn.classList.remove("active");
      btn.style.borderBottomColor = "transparent";
      btn.style.color = "var(--SmartThemeBodyColor, inherit)";
    }
  });

  // 切换内容区域
  document.querySelectorAll(".var-system-tab-content").forEach((content) => {
    if (content.dataset.tab === tabName) {
      content.style.display = "flex";
    } else {
      content.style.display = "none";
    }
  });

  console.log(`${EXTENSION_LOG_PREFIX} 切换到标签页: ${tabName}`);

  // 如果切换到全局快照标签页，自动加载快照列表
  if (tabName === "global") {
    void loadGlobalSnapshots();
  }
}

function bindTabSwitching(rootElement) {
  const tabButtons = rootElement.querySelectorAll(".var-system-tab");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });
}

// ============================================================================
// 全局快照功能
// ============================================================================

const PLUGIN_BASE_URL = "/api/plugins/var-manager/var-manager";

const snapshotsState = {
  snapshots: [],
  filteredSnapshots: [],
  searchQuery: "",
  selectedTag: "",
  loading: false,
  // 编辑器状态
  viewMode: "list", // "list" | "editor"
  editorController: null,
  editingSnapshotId: null, // null 表示新建，否则是编辑现有快照
  draftSnapshot: null, // 编辑中的快照数据
};

let snapshotButtons = null;
let snapshotEditorButtons = null;

/**
 * 调用插件 API
 */
async function callPluginAPI(endpoint, options = {}) {
  const url = `${PLUGIN_BASE_URL}${endpoint}`;

  // 尝试获取 SillyTavern 的请求头（包含 CSRF token）
  let authHeaders = {};
  try {
    // getRequestHeaders 可能在全局作用域中
    if (typeof window.getRequestHeaders === "function") {
      authHeaders = window.getRequestHeaders();
    } else if (typeof globalThis.getRequestHeaders === "function") {
      authHeaders = globalThis.getRequestHeaders();
    }
  } catch (e) {
    console.warn(`${EXTENSION_LOG_PREFIX} 无法获取认证头，继续尝试...`, e);
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("插件未安装或未启用");
      }
      throw new Error(
        `API 请求失败: ${response.status} ${response.statusText}`,
      );
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} API 调用失败:`, endpoint, error);
    throw error;
  }
}

/**
 * 加载全局快照列表
 */
/**
 * 切换全局快照视图模式
 */
function switchSnapshotView(mode) {
  if (snapshotsState.viewMode === mode) return;

  snapshotsState.viewMode = mode;

  const listView = document.getElementById("var_system_snapshots_list_view");
  const editorView = document.getElementById("var_system_snapshot_editor_view");

  if (mode === "list") {
    listView.style.display = "flex";
    editorView.style.display = "none";
  } else {
    listView.style.display = "none";
    editorView.style.display = "flex";
  }

  console.log(`${EXTENSION_LOG_PREFIX} 快照视图切换到: ${mode}`);
}

/**
 * 初始化快照编辑器
 */
async function ensureSnapshotEditorInstance() {
  if (snapshotsState.editorController) {
    return;
  }

  const container = document.getElementById("var_system_snapshot_body_editor");
  if (!container) {
    console.error(`${EXTENSION_LOG_PREFIX} 找不到快照编辑器容器`);
    return;
  }

  try {
    snapshotsState.editorController = createVariableBlockEditor({
      container,
      initialValue: {},
      styleUrl: JSON_EDITOR_STYLE_URL,
      scriptUrl: JSON_EDITOR_SCRIPT_URL,
      readOnly: false,
      onChange: () => {
        // onChange callback - 内容变化时更新状态
        updateSnapshotEditorStatus("已修改，未保存", "warn");
      },
      onFallback: () => {
        console.warn(
          `${EXTENSION_LOG_PREFIX} 快照编辑器 JSON 资源加载失败，已降级为纯文本模式`,
        );
        updateSnapshotEditorStatus("编辑器已降级为纯文本模式", "warn");
      },
    });

    // 关键：必须调用 ensureReady() 来实际初始化编辑器 UI
    await snapshotsState.editorController.ensureReady();

    console.log(`${EXTENSION_LOG_PREFIX} 快照编辑器已初始化`);
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 快照编辑器初始化失败:`, error);
  }
}

/**
 * 更新快照编辑器状态显示
 */
function updateSnapshotEditorStatus(message, type = "info") {
  const statusElement = document.getElementById(
    "var_system_snapshot_editor_status",
  );
  if (!statusElement) return;

  statusElement.textContent = message;
  statusElement.style.color = STATUS_COLORS[type] || STATUS_COLORS.info;
}

async function loadGlobalSnapshots() {
  if (snapshotsState.loading) {
    console.log(`${EXTENSION_LOG_PREFIX} 快照正在加载中，跳过重复请求`);
    return;
  }

  snapshotsState.loading = true;
  updateSnapshotsListUI("加载中...");

  try {
    console.log(`${EXTENSION_LOG_PREFIX} 开始加载全局快照...`);
    const data = await callPluginAPI("/global-snapshots");
    snapshotsState.snapshots = data.snapshots || [];

    console.log(
      `${EXTENSION_LOG_PREFIX} 已加载 ${snapshotsState.snapshots.length} 个全局快照`,
      snapshotsState.snapshots,
    );

    applySnapshotFilters();
    renderSnapshotsList();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 加载全局快照失败:`, error);

    // 清空快照列表
    snapshotsState.snapshots = [];
    snapshotsState.filteredSnapshots = [];

    // 根据错误类型显示不同的提示
    let errorMessage = "加载失败";
    if (error.message.includes("插件未安装")) {
      errorMessage =
        "插件未安装或未启用<br><br>全局快照功能需要安装 ST-VarSystemPlugin 插件";
    } else if (error.message.includes("Failed to fetch")) {
      errorMessage =
        "无法连接到插件 API<br><br>请确保 SillyTavern 服务器正在运行";
    } else {
      errorMessage = `加载失败: ${error.message}`;
    }

    updateSnapshotsListUI(errorMessage);
    renderSnapshotsList(); // 确保显示空列表
  } finally {
    snapshotsState.loading = false;
    console.log(`${EXTENSION_LOG_PREFIX} 加载全局快照完成，loading = false`);
  }
}

/**
 * 应用搜索和过滤
 */
function applySnapshotFilters() {
  let filtered = [...snapshotsState.snapshots];

  // 搜索过滤
  if (snapshotsState.searchQuery) {
    const query = snapshotsState.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description?.toLowerCase().includes(query),
    );
  }

  // 标签过滤
  if (snapshotsState.selectedTag) {
    filtered = filtered.filter((s) =>
      s.tags?.includes(snapshotsState.selectedTag),
    );
  }

  snapshotsState.filteredSnapshots = filtered;
}

/**
 * 渲染快照列表
 */
function renderSnapshotsList() {
  const listContainer = document.getElementById("var_system_snapshots_list");
  const emptyState = document.getElementById("var_system_snapshots_empty");

  if (!listContainer) return;

  // 清空现有内容（保留空状态元素）
  listContainer.querySelectorAll(".snapshot-card").forEach((card) => {
    card.remove();
  });

  if (snapshotsState.filteredSnapshots.length === 0) {
    // 恢复空状态的原始 HTML 内容
    emptyState.innerHTML = `
      <i class="fa-solid fa-inbox fa-3x" style="margin-bottom: 10px; opacity: 0.5"></i>
      <p data-i18n="No snapshots yet">暂无全局快照</p>
      <p style="font-size: 12px" data-i18n="Click New to create one">点击"新建快照"创建第一个快照</p>
    `;
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";

  snapshotsState.filteredSnapshots.forEach((snapshot) => {
    const card = createSnapshotCard(snapshot);
    listContainer.insertBefore(card, emptyState);
  });
}

/**
 * 创建快照卡片
 */
function createSnapshotCard(snapshot) {
  const card = document.createElement("div");
  card.className = "snapshot-card";
  card.dataset.snapshotId = snapshot.snapshotId;
  card.style.cssText = `
    border: 1px solid var(--SmartThemeBorderColor, #333);
    border-radius: 6px;
    padding: 12px;
    background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.2));
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  // 标题
  const title = document.createElement("h4");
  title.textContent = snapshot.name;
  title.style.cssText = "margin: 0; font-size: 16px;";
  card.appendChild(title);

  // 描述
  if (snapshot.description) {
    const desc = document.createElement("p");
    desc.textContent = snapshot.description;
    desc.style.cssText =
      "margin: 0; font-size: 13px; color: var(--SmartThemeBodyColor, #aaa); line-height: 1.4;";
    card.appendChild(desc);
  }

  // 标签
  if (snapshot.tags && snapshot.tags.length > 0) {
    const tagsContainer = document.createElement("div");
    tagsContainer.style.cssText = "display: flex; gap: 6px; flex-wrap: wrap;";
    snapshot.tags.forEach((tag) => {
      const tagSpan = document.createElement("span");
      tagSpan.textContent = tag;
      tagSpan.style.cssText = `
        padding: 2px 8px;
        font-size: 11px;
        border-radius: 3px;
        background: var(--SmartThemeQuoteColor, #4a9eff);
        color: white;
      `;
      tagsContainer.appendChild(tagSpan);
    });
    card.appendChild(tagsContainer);
  }

  // 元信息
  const meta = document.createElement("div");
  meta.style.cssText =
    "font-size: 11px; color: var(--SmartThemeBodyColor, #888);";
  const createdDate = new Date(snapshot.createdAt).toLocaleString("zh-CN");
  meta.textContent = `创建于 ${createdDate}`;
  card.appendChild(meta);

  // 操作按钮
  const actions = document.createElement("div");
  actions.style.cssText =
    "display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px;";

  const buttons = [
    {
      text: "查看/编辑",
      icon: "fa-pen-to-square",
      action: () => editSnapshot(snapshot.snapshotId),
    },
    {
      text: "应用到角色",
      icon: "fa-download",
      action: () => loadSnapshotToCharacter(snapshot.snapshotId),
    },
    {
      text: "删除",
      icon: "fa-trash",
      action: () => deleteSnapshot(snapshot.snapshotId),
    },
  ];

  buttons.forEach((btnDef) => {
    const btn = document.createElement("button");
    btn.className = "menu_button interactable";
    btn.style.cssText = "padding: 4px 8px; font-size: 12px;";
    btn.innerHTML = `<i class="fa-solid ${btnDef.icon} fa-fw"></i> ${btnDef.text}`;
    btn.addEventListener("click", btnDef.action);
    actions.appendChild(btn);
  });

  card.appendChild(actions);

  return card;
}

/**
 * 更新快照列表 UI（加载中/错误状态）
 */
function updateSnapshotsListUI(message) {
  const emptyState = document.getElementById("var_system_snapshots_empty");
  if (emptyState) {
    emptyState.innerHTML = `<p style="text-align: center; padding: 20px;">${message}</p>`;
    emptyState.style.display = "block";
  }
}

/**
 * 将快照应用到当前角色
 */
async function loadSnapshotToCharacter(snapshotId) {
  const context = getContext();
  if (!context.characterId) {
    await callGenericPopup("请先选择一个角色", POPUP_TYPE.TEXT, "", {
      okButton: "确定",
    });
    return;
  }

  try {
    const snapshot = await callPluginAPI(`/global-snapshots/${snapshotId}`);

    // 确认是否要覆盖当前模板
    const confirmed = await callGenericPopup(
      `将快照 "${snapshot.name}" 应用到当前角色会覆盖现有模板内容。\n\n是否继续？`,
      POPUP_TYPE.CONFIRM,
      "",
      { okButton: "应用", cancelButton: "取消" },
    );

    if (!confirmed) return;

    // 将快照内容写入角色模板
    templateState.draftBody = snapshot.snapshotBody;
    templateState.dirty = true;

    // 更新编辑器显示
    if (templateState.editorController) {
      templateState.editorController.set({ json: templateState.draftBody });
    }

    updateTemplateStatus(
      `已加载快照 "${snapshot.name}"，请保存以应用`,
      "success",
    );
    updateTemplateControls();

    // 切换回角色模板标签页
    switchTab("character");

    console.log(
      `${EXTENSION_LOG_PREFIX} 已将快照 ${snapshotId} 加载到角色模板`,
    );
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 加载快照失败:`, error);
    await callGenericPopup(
      `加载快照失败: ${error.message}`,
      POPUP_TYPE.TEXT,
      "",
      { okButton: "关闭" },
    );
  }
}

/**
 * 编辑快照
 */
async function editSnapshot(snapshotId) {
  console.log(`${EXTENSION_LOG_PREFIX} 编辑快照:`, snapshotId);

  try {
    // 从插件加载完整快照数据
    const snapshot = await callPluginAPI(`/global-snapshots/${snapshotId}`);

    // 设置编辑状态
    snapshotsState.editingSnapshotId = snapshotId;
    snapshotsState.draftSnapshot = { ...snapshot };

    // 先切换到编辑视图（这样容器才可见）
    switchSnapshotView("editor");

    // 更新标题
    const title = document.getElementById("var_system_snapshot_editor_title");
    if (title) {
      title.textContent = `编辑快照: ${snapshot.name}`;
    }

    // 填充表单
    document.getElementById("var_system_snapshot_name").value =
      snapshot.name || "";
    document.getElementById("var_system_snapshot_description").value =
      snapshot.description || "";
    document.getElementById("var_system_snapshot_tags").value = snapshot.tags
      ? snapshot.tags.join(", ")
      : "";

    // 在视图切换后初始化编辑器
    await ensureSnapshotEditorInstance();

    // 设置编辑器内容
    if (snapshotsState.editorController) {
      snapshotsState.editorController.set({ json: snapshot.snapshotBody });
    } else {
      console.error(`${EXTENSION_LOG_PREFIX} 编辑器未能初始化`);
    }

    updateSnapshotEditorStatus("编辑快照，修改后点击保存", "info");
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 加载快照失败:`, error);
    await callGenericPopup(
      `加载快照失败: ${error.message}`,
      POPUP_TYPE.TEXT,
      "",
      { okButton: "关闭" },
    );
  }
}

/**
 * 保存当前编辑的快照
 */
async function saveCurrentSnapshot() {
  try {
    // 获取表单数据
    const name = document
      .getElementById("var_system_snapshot_name")
      .value.trim();
    const description = document
      .getElementById("var_system_snapshot_description")
      .value.trim();
    const tagsInput = document
      .getElementById("var_system_snapshot_tags")
      .value.trim();

    // 验证必填字段
    if (!name) {
      await callGenericPopup("请输入快照名称", POPUP_TYPE.TEXT, "", {
        okButton: "确定",
      });
      return;
    }

    // 获取编辑器内容
    let snapshotBody = null;
    if (snapshotsState.editorController) {
      try {
        const content = snapshotsState.editorController.get();
        snapshotBody = content.json;
      } catch (error) {
        console.error(`${EXTENSION_LOG_PREFIX} 获取编辑器内容失败:`, error);
        await callGenericPopup(
          "编辑器内容有误，请检查 JSON 格式",
          POPUP_TYPE.TEXT,
          "",
          { okButton: "确定" },
        );
        return;
      }
    }

    // 解析标签
    const tags = tagsInput
      ? tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t)
      : [];

    // 构建保存数据
    const payload = {
      snapshotId: snapshotsState.editingSnapshotId || undefined,
      name,
      description,
      tags,
      snapshotBody,
    };

    updateSnapshotEditorStatus("保存中...", "info");

    // 调用插件 API 保存
    await callPluginAPI("/global-snapshots", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    console.log(
      `${EXTENSION_LOG_PREFIX} 快照已保存:`,
      snapshotsState.editingSnapshotId || "new",
    );

    // 返回列表视图并刷新
    switchSnapshotView("list");
    await loadGlobalSnapshots();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 保存快照失败:`, error);
    updateSnapshotEditorStatus(`保存失败: ${error.message}`, "error");
    await callGenericPopup(`保存失败: ${error.message}`, POPUP_TYPE.TEXT, "", {
      okButton: "关闭",
    });
  }
}

/**
 * 取消编辑并返回列表
 */
async function cancelSnapshotEditor() {
  // 检查是否有未保存的修改
  const nameChanged =
    document.getElementById("var_system_snapshot_name").value.trim() !==
    (snapshotsState.draftSnapshot?.name || "");
  const descChanged =
    document.getElementById("var_system_snapshot_description").value.trim() !==
    (snapshotsState.draftSnapshot?.description || "");

  if (nameChanged || descChanged) {
    const confirmed = await callGenericPopup(
      "有未保存的修改，确定要放弃吗？",
      POPUP_TYPE.CONFIRM,
      "",
      { okButton: "放弃", cancelButton: "继续编辑" },
    );

    if (!confirmed) return;
  }

  // 清理状态
  snapshotsState.editingSnapshotId = null;
  snapshotsState.draftSnapshot = null;

  // 返回列表视图
  switchSnapshotView("list");

  // 确保列表正确显示
  renderSnapshotsList();
}

/**
 * 删除快照
 */
async function deleteSnapshot(snapshotId) {
  const snapshot = snapshotsState.snapshots.find(
    (s) => s.snapshotId === snapshotId,
  );
  if (!snapshot) return;

  const confirmed = await callGenericPopup(
    `确定要删除快照 "${snapshot.name}" 吗？\n\n此操作不可撤销。`,
    POPUP_TYPE.CONFIRM,
    "",
    { okButton: "删除", cancelButton: "取消" },
  );

  if (!confirmed) return;

  try {
    await callPluginAPI(`/global-snapshots/${snapshotId}`, {
      method: "DELETE",
    });

    console.log(`${EXTENSION_LOG_PREFIX} 已删除快照:`, snapshotId);

    // 从列表中移除
    snapshotsState.snapshots = snapshotsState.snapshots.filter(
      (s) => s.snapshotId !== snapshotId,
    );

    applySnapshotFilters();
    renderSnapshotsList();
  } catch (error) {
    console.error(`${EXTENSION_LOG_PREFIX} 删除快照失败:`, error);
    await callGenericPopup(`删除失败: ${error.message}`, POPUP_TYPE.TEXT, "", {
      okButton: "关闭",
    });
  }
}

/**
 * 新建快照
 */
async function createNewSnapshot() {
  console.log(`${EXTENSION_LOG_PREFIX} 新建快照`);

  // 重置编辑状态
  snapshotsState.editingSnapshotId = null;
  snapshotsState.draftSnapshot = {
    name: "",
    description: "",
    tags: [],
    snapshotBody: { metadata: {}, variables: {} },
  };

  // 先切换到编辑视图（这样容器才可见）
  switchSnapshotView("editor");

  // 更新标题
  const title = document.getElementById("var_system_snapshot_editor_title");
  if (title) {
    title.textContent = "新建快照";
  }

  // 填充表单
  document.getElementById("var_system_snapshot_name").value = "";
  document.getElementById("var_system_snapshot_description").value = "";
  document.getElementById("var_system_snapshot_tags").value = "";

  // 在视图切换后初始化编辑器
  await ensureSnapshotEditorInstance();

  // 设置编辑器内容
  if (snapshotsState.editorController) {
    snapshotsState.editorController.set({
      json: snapshotsState.draftSnapshot.snapshotBody,
    });
  } else {
    console.error(`${EXTENSION_LOG_PREFIX} 编辑器未能初始化`);
  }

  updateSnapshotEditorStatus("新建快照，填写信息后点击保存", "info");
}

/**
 * 绑定全局快照区域的事件
 */
function bindSnapshotsSection(rootElement) {
  if (!rootElement || snapshotButtons) {
    return;
  }

  // 列表视图按钮
  snapshotButtons = {
    search: rootElement.querySelector("#var_system_snapshot_search"),
    tagFilter: rootElement.querySelector("#var_system_snapshot_tag_filter"),
    newBtn: rootElement.querySelector("#var_system_snapshot_new"),
    refreshBtn: rootElement.querySelector("#var_system_snapshot_refresh"),
  };

  // 编辑器视图按钮
  snapshotEditorButtons = {
    back: rootElement.querySelector("#var_system_snapshot_editor_back"),
    save: rootElement.querySelector("#var_system_snapshot_editor_save"),
    cancel: rootElement.querySelector("#var_system_snapshot_editor_cancel"),
  };

  // 搜索
  snapshotButtons.search?.addEventListener("input", (e) => {
    snapshotsState.searchQuery = e.target.value;
    applySnapshotFilters();
    renderSnapshotsList();
  });

  // 标签过滤
  snapshotButtons.tagFilter?.addEventListener("change", (e) => {
    snapshotsState.selectedTag = e.target.value;
    applySnapshotFilters();
    renderSnapshotsList();
  });

  // 新建快照
  snapshotButtons.newBtn?.addEventListener("click", () => {
    void createNewSnapshot();
  });

  // 刷新列表
  snapshotButtons.refreshBtn?.addEventListener("click", () => {
    void loadGlobalSnapshots();
  });

  // 编辑器：返回列表
  snapshotEditorButtons.back?.addEventListener("click", () => {
    void cancelSnapshotEditor();
  });

  // 编辑器：保存
  snapshotEditorButtons.save?.addEventListener("click", () => {
    void saveCurrentSnapshot();
  });

  // 编辑器：取消
  snapshotEditorButtons.cancel?.addEventListener("click", () => {
    void cancelSnapshotEditor();
  });
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

  const rootElement = $drawer.get(0);
  bindTemplateSection(rootElement);
  bindTabSwitching(rootElement);
  bindSnapshotsSection(rootElement);

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
