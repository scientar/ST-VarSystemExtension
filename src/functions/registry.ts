/**
 * 函数注册表 - 管理全局和本地函数库
 *
 * 全局函数：存储在 extension_settings.st_var_system.functions (所有角色共享)
 * 本地函数：存储在 character.data.extensions.st_var_system.functions (角色专属)
 */

import { error, log, warn } from "../logger";

const EXTENSION_LOG_PREFIX = "[ST-VarSystemExtension]";

/**
 * 函数定义接口
 * @typedef {Object} FunctionDefinition
 * @property {string} id - 唯一标识符(UUID)
 * @property {string} name - 函数名称(用户可读)
 * @property {'active'|'passive'} type - 主动函数(AI调用) | 被动函数(自动执行)
 * @property {boolean} enabled - 是否启用
 * @property {number} order - 执行顺序(数字越小越先执行)
 * @property {string} description - 说明文本(用于生成提示词)
 * @property {boolean} [builtin] - 是否为内置函数（内置函数不可编辑/删除）
 * @property {string} [pattern] - 正则表达式(主动函数必需)
 * @property {'before_active'|'after_active'} [timing] - 执行时机(被动函数必需)
 * @property {string} executor - 函数代码字符串
 */

/**
 * 解析后的函数调用
 * @typedef {Object} ParsedFunctionCall
 * @property {FunctionDefinition} functionDef - 函数定义
 * @property {Array<string>} args - 参数数组
 * @property {number} index - 在原文中的位置
 * @property {string} fullMatch - 完整匹配文本
 */

/**
 * 函数注册表类
 */
export class FunctionRegistry {
  constructor() {
    /** @type {Map<string, FunctionDefinition>} */
    this.globalFunctions = new Map();

    /** @type {Map<string, FunctionDefinition>} */
    this.localFunctions = new Map();
  }

  /**
   * 加载全局函数库
   * @param {Array<FunctionDefinition>} functions
   */
  loadGlobalFunctions(functions) {
    this.globalFunctions.clear();

    if (!Array.isArray(functions)) {
      warn(`${EXTENSION_LOG_PREFIX} 全局函数库格式错误，应为数组`);
      return;
    }

    for (const func of functions) {
      if (this.validateFunction(func)) {
        // 性能优化：预编译主动函数的正则表达式
        if (func.type === 'active' && func.pattern && !func._compiledRegex) {
          try {
            func._compiledRegex = new RegExp(func.pattern, 'g');
          } catch (e) {
            warn(`${EXTENSION_LOG_PREFIX} 预编译正则失败:`, func.name, e);
          }
        }
        this.globalFunctions.set(func.id, func);
      } else {
        warn(`${EXTENSION_LOG_PREFIX} 跳过无效的全局函数:`, func);
      }
    }

    log(
      `${EXTENSION_LOG_PREFIX} 已加载 ${this.globalFunctions.size} 个全局函数`,
    );
  }

  /**
   * 加载本地函数库（角色专属）
   * @param {Array<FunctionDefinition>} functions
   */
  loadLocalFunctions(functions) {
    this.localFunctions.clear();

    if (!Array.isArray(functions)) {
      // 本地函数库可选，不存在不报警告
      return;
    }

    for (const func of functions) {
      if (this.validateFunction(func)) {
        // 性能优化：预编译主动函数的正则表达式
        if (func.type === 'active' && func.pattern && !func._compiledRegex) {
          try {
            func._compiledRegex = new RegExp(func.pattern, 'g');
          } catch (e) {
            warn(`${EXTENSION_LOG_PREFIX} 预编译正则失败:`, func.name, e);
          }
        }
        this.localFunctions.set(func.id, func);
      } else {
        warn(`${EXTENSION_LOG_PREFIX} 跳过无效的本地函数:`, func);
      }
    }

    log(
      `${EXTENSION_LOG_PREFIX} 已加载 ${this.localFunctions.size} 个本地函数`,
    );
  }

  /**
   * 验证函数定义
   * @param {any} func
   * @returns {boolean}
   */
  validateFunction(func) {
    if (!func || typeof func !== "object") {
      return false;
    }

    // 必需字段
    if (!func.id || typeof func.id !== "string") {
      return false;
    }
    if (!func.name || typeof func.name !== "string") {
      return false;
    }
    if (!["active", "passive"].includes(func.type)) {
      return false;
    }
    if (typeof func.enabled !== "boolean") {
      return false;
    }
    if (typeof func.order !== "number") {
      return false;
    }
    if (!func.executor || typeof func.executor !== "string") {
      return false;
    }

    // 类型特定字段
    if (func.type === "active") {
      if (!func.pattern || typeof func.pattern !== "string") {
        return false;
      }
      // 验证正则表达式是否有效
      try {
        new RegExp(func.pattern);
      } catch (e) {
        error(`${EXTENSION_LOG_PREFIX} 函数 ${func.name} 的正则表达式无效:`, e);
        return false;
      }
    }

    if (func.type === "passive") {
      if (!["before_active", "after_active"].includes(func.timing)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取所有启用的函数（全局 + 本地，本地优先）
   * @returns {Array<FunctionDefinition>}
   */
  getEnabledFunctions() {
    const allFunctions = new Map();

    // 先加载全局函数
    for (const [id, func] of this.globalFunctions) {
      if (func.enabled) {
        allFunctions.set(id, func);
      }
    }

    // 本地函数覆盖同名全局函数
    for (const [id, func] of this.localFunctions) {
      if (func.enabled) {
        allFunctions.set(id, func);
      }
    }

    return Array.from(allFunctions.values());
  }

  /**
   * 获取启用的主动函数列表
   * @returns {Array<FunctionDefinition>}
   */
  getActiveFunctions() {
    return this.getEnabledFunctions()
      .filter((f) => f.type === "active")
      .sort((a, b) => a.order - b.order);
  }

  /**
   * 获取启用的被动函数列表（按时机分组）
   * @returns {{before: Array<FunctionDefinition>, after: Array<FunctionDefinition>}}
   */
  getPassiveFunctions() {
    const passiveFunctions = this.getEnabledFunctions().filter(
      (f) => f.type === "passive",
    );

    const before = passiveFunctions
      .filter((f) => f.timing === "before_active")
      .sort((a, b) => a.order - b.order);

    const after = passiveFunctions
      .filter((f) => f.timing === "after_active")
      .sort((a, b) => a.order - b.order);

    return { before, after };
  }

  /**
   * 从 AI 消息文本中解析所有函数调用
   * @param {string} text - AI 消息文本
   * @returns {Array<ParsedFunctionCall>}
   */
  parseFunctionCalls(text) {
    const activeFunctions = this.getActiveFunctions();
    const allMatches = [];

    // 对每个启用的主动函数执行匹配
    for (const func of activeFunctions) {
      try {
        // 使用预编译的正则表达式（性能优化）
        const regex = func._compiledRegex || new RegExp(func.pattern, "g");
        let match = regex.exec(text);

        while (match !== null) {
          allMatches.push({
            functionDef: func,
            args: match.slice(1), // 捕获组作为参数
            index: match.index,
            fullMatch: match[0],
          });
          match = regex.exec(text);
        }
      } catch (e) {
        error(`${EXTENSION_LOG_PREFIX} 函数 ${func.name} 匹配失败:`, e);
      }
    }

    // 按位置排序，保证执行顺序
    allMatches.sort((a, b) => a.index - b.index);

    log(
      `${EXTENSION_LOG_PREFIX} 从消息中解析到 ${allMatches.length} 个函数调用`,
    );

    return allMatches;
  }

  /**
   * 根据 ID 获取函数
   * @param {string} id
   * @returns {FunctionDefinition|null}
   */
  getFunction(id) {
    return this.localFunctions.get(id) || this.globalFunctions.get(id) || null;
  }

  /**
   * 添加或更新函数（到全局库）
   * @param {FunctionDefinition} func
   */
  upsertGlobalFunction(func) {
    if (!this.validateFunction(func)) {
      throw new Error("函数定义无效");
    }
    this.globalFunctions.set(func.id, func);
  }

  /**
   * 添加或更新函数（到本地库）
   * @param {FunctionDefinition} func
   */
  upsertLocalFunction(func) {
    if (!this.validateFunction(func)) {
      throw new Error("函数定义无效");
    }
    this.localFunctions.set(func.id, func);
  }

  /**
   * 删除函数
   * @param {string} id
   * @param {'global'|'local'} scope
   */
  deleteFunction(id, scope) {
    if (scope === "global") {
      this.globalFunctions.delete(id);
    } else if (scope === "local") {
      this.localFunctions.delete(id);
    }
  }

  /**
   * 导出全局函数库（用于保存到 extension_settings）
   * @returns {Array<FunctionDefinition>}
   */
  exportGlobalFunctions() {
    return Array.from(this.globalFunctions.values());
  }

  /**
   * 导出本地函数库（用于保存到角色卡）
   * @returns {Array<FunctionDefinition>}
   */
  exportLocalFunctions() {
    return Array.from(this.localFunctions.values());
  }
}

/**
 * 全局单例实例
 */
export const functionRegistry = new FunctionRegistry();
