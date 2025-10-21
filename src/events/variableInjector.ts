/**
 * @file variableInjector.js
 * @description 变量注入模块，负责将快照数据注入到聊天变量作用域
 *
 * **关键设计**：
 * - 使用 JS-Slash-Runner (酒馆助手) 提供的 `TavernHelper.updateVariablesWith()` API
 * - 注入到 **chat 作用域**（`type: 'chat'`），确保变量是聊天级别而非全局
 * - 快照作为 **整体 JSON 对象** 注入到 `vs_stat_data` 变量中
 *
 * **变量结构**：
 * - `vs_stat_data`：完整快照对象（类似 MVU 的 stat_data 和 SAM 的 SAM_data）
 *
 * **在提示词中使用**：
 * ```
 * 角色状态：{{vs_stat_data}}
 * ```
 *
 * **与社区方案兼容**：
 * - MVU: 使用 `{{stat_data}}` 引用完整 JSON
 * - SAM: 使用 `{{SAM_data}}` 引用完整 JSON
 * - 本系统: 使用 `{{vs_stat_data}}` 引用完整 JSON
 *
 * @module events/variableInjector
 */

const MODULE_NAME = "[ST-VarSystemExtension/variableInjector]";

/**
 * 检查 TavernHelper API 是否可用
 * @returns {boolean} true 如果 TavernHelper.updateVariablesWith 可用
 */
function isTavernHelperAvailable() {
  return (
    typeof window !== "undefined" &&
    window.TavernHelper &&
    typeof window.TavernHelper.updateVariablesWith === "function"
  );
}

/**
 * 将快照数据注入到聊天变量作用域
 *
 * @param {Object} snapshot - 快照对象，如 { hp: 100, mp: 50, location: "森林" }
 * @returns {Promise<void>}
 *
 * @example
 * await injectSnapshotVariables({ hp: 100, mp: 50, location: "森林" });
 * // 提示词中可使用: {{vs_stat_data}}
 */
export async function injectSnapshotVariables(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    console.warn(MODULE_NAME, "快照数据无效，跳过注入:", snapshot);
    return;
  }

  // 检查酒馆助手 API
  if (!isTavernHelperAvailable()) {
    console.error(
      MODULE_NAME,
      "酒馆助手 (JS-Slash-Runner) 未安装或 API 不可用。",
      "变量系统依赖酒馆助手提供的 updateVariablesWith API。",
      "请安装扩展: https://github.com/ShinoKana/JS-Slash-Runner",
    );
    return;
  }

  try {
    // 使用 TavernHelper API 注入到 chat 作用域
    await window.TavernHelper.updateVariablesWith(
      (variables) => {
        // 将整个快照作为 vs_stat_data 变量注入
        // 类似 MVU 的 stat_data 和 SAM 的 SAM_data
        variables.vs_stat_data = snapshot;

        return variables;
      },
      { type: "chat" }, // 关键：必须是 chat 作用域，而非 global
    );

    console.log(MODULE_NAME, "快照已注入到 vs_stat_data 变量");
  } catch (error) {
    console.error(MODULE_NAME, "注入快照变量时发生错误:", error);
  }
}

/**
 * 获取当前聊天中的快照变量
 *
 * @returns {Promise<Object|null>} 快照对象，如果不存在则返回 null
 */
export async function getCurrentSnapshotVariables() {
  if (!isTavernHelperAvailable()) {
    console.warn(MODULE_NAME, "酒馆助手不可用，无法读取变量");
    return null;
  }

  try {
    const variables = window.TavernHelper.getVariables({ type: "chat" });

    // 直接返回 vs_stat_data
    return variables.vs_stat_data || null;
  } catch (error) {
    console.error(MODULE_NAME, "读取快照变量时发生错误:", error);
    return null;
  }
}
