/**
 * 函数库管理界面
 *
 * 功能：
 * - 查看/编辑全局和局域函数
 * - 新增/删除函数
 * - 导入/导出函数（JSON 格式）
 * - 生成函数调用提示词
 *
 * 设计参照：酒馆助手脚本库（简洁风格，无复杂编辑器）
 */

import {
  extension_settings,
  getContext,
  writeExtensionField,
} from "@sillytavern/scripts/extensions";
import { saveSettingsDebounced } from "@sillytavern/script";
import { callGenericPopup, POPUP_TYPE } from "@sillytavern/scripts/popup";
import { functionRegistry } from "../functions/registry";
import {
  FunctionSearchFilter,
  filterFunctionCards,
  showNoResults,
  hideNoResults,
} from "./components/SearchFilter";

const MODULE_NAME = "[ST-VarSystemExtension/FunctionLibrary]";
const EXTENSION_SETTINGS_KEY = "st_var_system";

// 当前作用域（global 或 local）
let currentScope = "global";

// 搜索过滤器实例
let searchFilter = null;

/**
 * 初始化函数库界面
 */
export async function initFunctionLibrary() {
  console.log(MODULE_NAME, "初始化函数库界面");

  // 先从存储加载函数（这会清空当前注册表）
  await loadFunctionsFromStorage();

  // 然后注册内置函数（添加到已加载的函数中）
  const { initBuiltinFunctions } = await import('../functions/builtins.js');
  initBuiltinFunctions(functionRegistry);
  console.log(MODULE_NAME, "内置函数已注册");

  // 绑定事件处理器
  bindEventHandlers();

  // 加载当前作用域的函数列表
  await loadFunctionList();
}

/**
 * 绑定事件处理器
 */
function bindEventHandlers() {
  // 作用域切换
  $('input[name="function-scope"]').on("change", async (e) => {
    currentScope = e.target.value;
    await loadFunctionList();
  });

  // 新增函数
  $("#var-system-new-function-btn").on("click", async () => {
    await openFunctionEditor();
  });

  // 导入函数
  $("#var-system-import-functions-btn").on("click", async () => {
    await importFunctions();
  });

  // 导出函数
  $("#var-system-export-functions-btn").on("click", async () => {
    await exportFunctions();
  });

  // 生成提示词
  $("#var-system-generate-prompt-btn").on("click", async () => {
    await generatePrompt();
  });

  // 初始化搜索过滤器
  searchFilter = new FunctionSearchFilter((filters) => {
    handleFilterChange(filters);
  });
}

/**
 * 处理过滤器变化
 * @param {Object} filters - 过滤条件
 */
function handleFilterChange(filters) {
  const $cards = $(".var-system-function-card");
  const totalCount = $cards.length;

  if (totalCount === 0) {
    return;
  }

  // 应用过滤
  const { visible, hidden } = filterFunctionCards($cards, filters);

  // 显示/隐藏无结果提示
  hideNoResults();
  if (visible === 0 && hidden > 0) {
    showNoResults();
  }

  // 显示搜索结果信息
  if (searchFilter) {
    searchFilter.showResultsInfo(totalCount, visible);
  }
}

/**
 * 从存储加载函数到注册表
 */
async function loadFunctionsFromStorage() {
  try {
    // 加载全局函数
    const globalFunctions =
      extension_settings[EXTENSION_SETTINGS_KEY]?.functions || [];
    functionRegistry.loadGlobalFunctions(globalFunctions);

    // 加载局域函数
    const context = getContext();
    if (context.characterId !== undefined) {
      const character = context.characters[context.characterId];
      const localFunctions =
        character?.data?.extensions?.[EXTENSION_SETTINGS_KEY]?.functions || [];
      functionRegistry.loadLocalFunctions(localFunctions);
    }
  } catch (error) {
    console.error(MODULE_NAME, "加载函数失败:", error);
  }
}

/**
 * 加载函数列表
 */
async function loadFunctionList() {
  const listContainer = $("#var-system-function-list");
  listContainer.empty();

  // 获取当前作用域的函数
  const functions =
    currentScope === "global"
      ? functionRegistry.exportGlobalFunctions()
      : functionRegistry.exportLocalFunctions();

  if (!functions || functions.length === 0) {
    // 显示空状态
    const scopeText = currentScope === "global" ? "全局" : "局域";
    listContainer.html(`
      <div class="var-system-empty-state">
        <i class="fa-solid fa-inbox fa-3x"></i>
        <p>暂无${scopeText}函数</p>
        <p class="var-system-hint">点击下方按钮创建你的第一个${scopeText}函数</p>
        <button class="menu_button" onclick="$('#var-system-new-function-btn').click()">
          <i class="fa-solid fa-plus"></i>
          <span>立即创建</span>
        </button>
      </div>
    `);
    return;
  }

  // 渲染函数卡片
  for (const func of functions) {
    const card = createFunctionCard(func);
    listContainer.append(card);
  }

  // 设置拖拽排序
  setupDraggable();
}

/**
 * 设置拖拽排序
 */
function setupDraggable() {
  const listContainer = $("#var-system-function-list");

  // 销毁现有的 sortable 实例（如果存在）
  if (listContainer.sortable("instance")) {
    listContainer.sortable("destroy");
  }

  // 初始化拖拽排序
  listContainer.sortable({
    items: ".var-system-function-card",
    handle: ".drag-handle",
    cursor: "move",
    tolerance: "pointer",
    placeholder: "var-system-sortable-placeholder",
    stop: async () => {
      await handleDragStop();
    },
  });
}

/**
 * 拖拽停止时的处理
 */
async function handleDragStop() {
  // 获取新的顺序
  const $cards = $("#var-system-function-list .var-system-function-card");
  const newOrder = [];

  $cards.each(function (index) {
    const functionId = $(this).attr("data-function-id");
    newOrder.push({ id: functionId, order: index });
  });

  // 从注册表获取当前函数列表
  const functions =
    currentScope === "global"
      ? functionRegistry.exportGlobalFunctions()
      : functionRegistry.exportLocalFunctions();

  // 按新顺序重新排列
  const reordered = [];
  for (const item of newOrder) {
    const func = functions.find((f) => f.id === item.id);
    if (func) {
      func.order = item.order;
      reordered.push(func);
    }
  }

  // 重新加载到注册表（覆盖原顺序）
  if (currentScope === "global") {
    functionRegistry.loadGlobalFunctions(reordered);
  } else {
    functionRegistry.loadLocalFunctions(reordered);
  }

  // 持久化到存储
  await saveFunctions();

  console.log(MODULE_NAME, "函数顺序已更新");
}

/**
 * 创建函数卡片
 * @param {Object} func - 函数定义
 * @returns {jQuery} 函数卡片元素
 */
function createFunctionCard(func) {
  const template = $("#var-system-function-card-template").html();
  const $card = $(template);

  $card.attr("data-function-id", func.id);
  $card.attr("data-function-type", func.type);
  $card.attr("data-builtin", func.builtin || false);

  // 设置启用状态
  $card.find(".function-enabled-checkbox").prop("checked", func.enabled);
  $card.find(".function-enabled-checkbox").on("change", async (e) => {
    func.enabled = e.target.checked;
    await saveFunctions();
  });

  // 设置函数名称
  $card.find(".var-system-function-name").text(func.name);

  // 设置类型徽章
  const $badge = $card.find(".var-system-badge");
  if (func.type === "active") {
    $badge
      .removeClass("var-system-badge-passive")
      .addClass("var-system-badge-active")
      .text("主动");
  } else {
    $badge
      .removeClass("var-system-badge-active")
      .addClass("var-system-badge-passive")
      .text("被动");
  }

  // 设置说明
  $card
    .find(".var-system-function-description")
    .text(func.description || "无说明");

  // 设置元信息（被动函数显示执行时机）
  if (func.type === "passive") {
    const timingText =
      func.timing === "before_active" ? "主动函数前执行" : "主动函数后执行";
    $card.find(".var-system-function-order").text(timingText);
  } else {
    $card.find(".var-system-function-order").remove();
  }

  // 编辑按钮
  $card.find(".function-edit-btn").on("click", async () => {
    await openFunctionEditor(func);
  });

  // 删除按钮（内置函数不显示）
  if (!func.builtin) {
    $card.find(".function-delete-btn").on("click", async () => {
      await deleteFunction(func);
    });
  } else {
    $card.find(".function-delete-btn").hide();
  }

  return $card;
}

/**
 * 打开函数编辑器
 * @param {Object|null} func - 要编辑的函数（null 表示新建）
 */
async function openFunctionEditor(func = null) {
  const template = $("#var-system-function-editor-template").html();
  const $editor = $(template);

  // 如果是编辑现有函数，填充数据
  if (func) {
    $editor.find("#function-name-input").val(func.name);
    $editor.find("#function-type-select").val(func.type);
    $editor.find("#function-enabled-checkbox").prop("checked", func.enabled);
    $editor.find("#function-description-textarea").val(func.description || "");
    $editor.find("#function-pattern-input").val(func.pattern || "");
    $editor.find("#function-timing-select").val(func.timing || "before_active");
    $editor.find("#function-executor-textarea").val(func.executor || "");

    // 内置函数保护：设为只读
    if (func.builtin) {
      // 所有字段只读，除了启用状态
      $editor.find("input:not(#function-enabled-checkbox), select, textarea")
        .prop("readonly", true)
        .prop("disabled", true)
        .css("background-color", "#f5f5f5");  // 视觉提示

      // 添加提示文本
      $editor.prepend(`
        <div class="var-system-hint" style="background: #fff3cd; padding: 10px; margin-bottom: 15px; border-left: 4px solid #ffc107;">
          <i class="fa-solid fa-info-circle"></i>
          <strong>这是内置函数</strong>，只能查看实现和控制启用状态，不能修改其他内容。
        </div>
      `);
    }
  }

  // 类型切换时显示/隐藏相应字段
  const updateFieldsVisibility = () => {
    const type = $editor.find("#function-type-select").val();
    if (type === "active") {
      $editor.find(".var-system-active-only").show();
      $editor.find(".var-system-passive-only").hide();
    } else {
      $editor.find(".var-system-active-only").hide();
      $editor.find(".var-system-passive-only").show();
    }
  };

  $editor.find("#function-type-select").on("change", updateFieldsVisibility);
  updateFieldsVisibility();

  // 显示弹窗
  const result = await callGenericPopup(
    $editor,
    POPUP_TYPE.CONFIRM,
    func?.builtin ? "查看内置函数" : (func ? "编辑函数" : "新增函数"),
    {
      okButton: func?.builtin ? "关闭" : "保存",
      cancelButton: func?.builtin ? null : "取消",
    },
  );

  // 内置函数点击"关闭"后直接返回，不保存
  if (func?.builtin) {
    return;
  }

  if (result !== POPUP_RESULT.AFFIRMATIVE) {
    return;
  }

  // 收集表单数据
  const functionData = {
    id: func?.id || generateFunctionId(),
    name: $editor.find("#function-name-input").val().trim(),
    type: $editor.find("#function-type-select").val(),
    enabled: $editor.find("#function-enabled-checkbox").prop("checked"),
    description: $editor.find("#function-description-textarea").val().trim(),
    executor: $editor.find("#function-executor-textarea").val().trim(),
  };

  if (functionData.type === "active") {
    functionData.pattern = $editor.find("#function-pattern-input").val().trim();
  } else {
    functionData.timing = $editor.find("#function-timing-select").val();
  }

  // 验证必填字段
  if (!functionData.name) {
    toastr.error("请填写函数名称");
    return;
  }

  if (!functionData.executor) {
    toastr.error("请填写函数实现代码");
    return;
  }

  if (functionData.type === "active" && !functionData.pattern) {
    toastr.error("主动函数需要填写正则表达式");
    return;
  }

  // 保存函数
  if (func) {
    // 更新现有函数 - 直接修改对象，然后保存
    Object.assign(func, functionData);
  } else {
    // 添加新函数
    if (currentScope === "global") {
      functionRegistry.upsertGlobalFunction(functionData);
    } else {
      functionRegistry.upsertLocalFunction(functionData);
    }
  }

  await saveFunctions();
  await loadFunctionList();

  toastr.success(`函数"${functionData.name}"已${func ? "更新" : "创建"}`);
}

/**
 * 删除函数
 * @param {Object} func - 要删除的函数
 */
async function deleteFunction(func) {
  const confirmation = await callGenericPopup(
    `确定要删除函数"${func.name}"吗？`,
    POPUP_TYPE.CONFIRM,
    "",
    { okButton: "删除", cancelButton: "取消" },
  );

  if (confirmation !== POPUP_RESULT.AFFIRMATIVE) {
    return;
  }

  // 从注册表删除
  functionRegistry.deleteFunction(func.id, currentScope);

  await saveFunctions();
  await loadFunctionList();

  toastr.success(`函数"${func.name}"已删除`);
}

/**
 * 保存函数列表到存储
 */
async function saveFunctions() {
  try {
    if (currentScope === "global") {
      // 保存到 extension_settings
      if (!extension_settings[EXTENSION_SETTINGS_KEY]) {
        extension_settings[EXTENSION_SETTINGS_KEY] = {};
      }
      extension_settings[EXTENSION_SETTINGS_KEY].functions =
        functionRegistry.exportGlobalFunctions();
      await saveSettingsDebounced();
    } else {
      // 保存到角色卡
      const context = getContext();
      if (context.characterId === undefined) {
        console.warn(MODULE_NAME, "当前无角色，无法保存局域函数");
        return;
      }

      const character = context.characters[context.characterId];
      if (!character) {
        console.warn(MODULE_NAME, "角色数据不存在");
        return;
      }

      // 确保扩展数据结构存在
      if (!character.data.extensions) {
        character.data.extensions = {};
      }
      if (!character.data.extensions[EXTENSION_SETTINGS_KEY]) {
        character.data.extensions[EXTENSION_SETTINGS_KEY] = {};
      }

      character.data.extensions[EXTENSION_SETTINGS_KEY].functions =
        functionRegistry.exportLocalFunctions();

      await writeExtensionField(
        context.characterId,
        EXTENSION_SETTINGS_KEY,
        character.data.extensions[EXTENSION_SETTINGS_KEY],
      );
    }

    console.log(MODULE_NAME, `${currentScope} 函数已保存`);
  } catch (error) {
    console.error(MODULE_NAME, "保存函数失败:", error);
    toastr.error(`保存失败：${error.message}`);
  }
}

/**
 * 导入函数
 */
async function importFunctions() {
  const $input = $('<input type="file" accept=".json">');

  $input.on("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.version || !Array.isArray(data.functions)) {
        toastr.error("无效的函数库文件格式");
        return;
      }

      // 导入函数（生成新的 ID 避免冲突）
      let imported = 0;
      for (const func of data.functions) {
        const newFunc = {
          ...func,
          id: generateFunctionId(),
          enabled: false, // 导入后默认禁用
        };

        if (currentScope === "global") {
          functionRegistry.upsertGlobalFunction(newFunc);
        } else {
          functionRegistry.upsertLocalFunction(newFunc);
        }

        imported++;
      }

      await saveFunctions();
      await loadFunctionList();

      toastr.success(`成功导入 ${imported} 个函数到${currentScope === 'global' ? '全局函数库' : '当前角色的局域函数'}`);
    } catch (error) {
      console.error(MODULE_NAME, "导入函数失败:", error);
      toastr.error(`导入失败：${error.message}`);
    }
  });

  $input.trigger("click");
}

/**
 * 导出函数
 * 只导出当前作用域中已启用的非内置函数
 */
async function exportFunctions() {
  // 获取当前 scope 的所有函数
  const allFunctions =
    currentScope === "global"
      ? functionRegistry.exportGlobalFunctions()
      : functionRegistry.exportLocalFunctions();

  // 只导出启用的、非内置的函数
  const functionsToExport = allFunctions.filter(func =>
    func.enabled && !func.builtin
  );

  if (functionsToExport.length === 0) {
    toastr.warning(`当前${currentScope === 'global' ? '全局' : '局域'}作用域没有已启用的非内置函数可导出`);
    return;
  }

  // 移除运行时字段（如预编译的正则表达式）
  const cleanedFunctions = functionsToExport.map(func => {
    const { _compiledRegex, ...cleanFunc } = func;
    return cleanFunc;
  });

  const exportData = {
    version: "1.0",
    scope: currentScope,  // 标记来源
    functions: cleanedFunctions,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const $a = $("<a>");
  $a.attr("href", url);
  $a.attr(
    "download",
    `var-system-functions-${currentScope}-${Date.now()}.json`,
  );
  $a[0].click();

  URL.revokeObjectURL(url);

  toastr.success(`已导出 ${functionsToExport.length} 个${currentScope === 'global' ? '全局' : '局域'}函数`);
}

/**
 * 生成提示词
 */
async function generatePrompt() {
  const functions = await functionRegistry.getEnabledFunctions("active");

  if (!functions || functions.length === 0) {
    toastr.warning("没有启用的主动函数");
    return;
  }

  let prompt =
    "<variable_system_functions>\n你可以使用以下函数来更新游戏状态：\n\n";

  for (const func of functions) {
    prompt += `${func.name} // ${func.description || "无说明"}\n`;
    if (func.pattern) {
      // 简化的示例（从正则推断）
      const example = inferExampleFromPattern(func.pattern, func.name);
      prompt += `示例：${example}\n\n`;
    }
  }

  prompt += "</variable_system_functions>";

  // 显示提示词弹窗
  const template = $("#var-system-prompt-generator-template").html();
  const $dialog = $(template);

  $dialog.find("#generated-prompt-content").text(prompt);

  $dialog.find("#copy-prompt-btn").on("click", () => {
    navigator.clipboard.writeText(prompt);
    toastr.success("已复制到剪贴板");
  });

  await callGenericPopup($dialog, POPUP_TYPE.DISPLAY, "函数调用提示词", {
    wide: true,
  });
}

/**
 * 从正则推断示例调用
 * @param {string} _pattern - 正则表达式
 * @param {string} funcName - 函数名
 * @returns {string} 示例调用
 */
function inferExampleFromPattern(_pattern, funcName) {
  // 简化实现：直接使用函数名生成基本示例
  return `@.${funcName}("path.to.var", value);`;
}

/**
 * 生成函数 ID（UUID v4）
 * @returns {string} UUID
 */
function generateFunctionId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 导出用于弹窗的常量（如果需要）
const POPUP_RESULT = {
  AFFIRMATIVE: 1,
  NEGATIVE: 0,
  CANCELLED: -1,
};
