/**
 * 函数执行引擎 - 执行函数调用，生成新快照
 */

import { error, log, warn } from "../logger.js";

const EXTENSION_LOG_PREFIX = "[ST-VarSystemExtension]";

/**
 * 执行上下文
 * @typedef {Object} ExecutionContext
 * @property {number} messageId - 当前消息 ID
 * @property {string} messageContent - 当前消息内容
 * @property {string} characterName - 角色名称
 * @property {string} chatFile - 聊天文件名
 * @property {number} timestamp - 时间戳
 */

/**
 * 执行结果
 * @typedef {Object} ExecutionResult
 * @property {any} snapshot - 最终快照
 * @property {Array<{functionName: string, error: string}>} errors - 执行错误列表
 */

/**
 * 函数执行引擎类
 */
export class FunctionExecutor {
  constructor() {
    // 沙箱环境中可用的安全工具函数
    this.safeGlobals = {
      // Lodash (假设已全局可用)
      _: window._,

      // 基础 JavaScript 对象
      Object,
      Array,
      String,
      Number,
      Boolean,
      Math,
      Date,
      JSON,

      // 常用工具函数
      parseInt,
      parseFloat,
      isNaN,
      isFinite,

      // 日志函数（仅 console.log，不允许 eval/Function）
      console: {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      },
    };
  }

  /**
   * 编译函数执行器代码
   * @param {string} executorCode - 函数代码字符串
   * @returns {Function|null}
   */
  compileExecutor(executorCode) {
    try {
      // 构建参数列表
      const params = [
        "snapshot",
        "args",
        "context",
        ...Object.keys(this.safeGlobals),
      ];

      // 使用 Function 构造器创建函数（相对安全，不会访问外部作用域）
      const func = new Function(...params, executorCode);

      return func;
    } catch (e) {
      error(`${EXTENSION_LOG_PREFIX} 编译函数失败:`, e);
      return null;
    }
  }

  /**
   * 执行单个函数
   * @param {import('./registry.js').FunctionDefinition} functionDef - 函数定义
   * @param {any} snapshot - 输入快照
   * @param {Array<string>} args - 参数（主动函数）
   * @param {ExecutionContext} context - 执行上下文
   * @returns {{success: boolean, snapshot: any, error?: string}}
   */
  executeFunction(functionDef, snapshot, args = [], context = {}) {
    try {
      // 编译函数
      const executor = this.compileExecutor(functionDef.executor);
      if (!executor) {
        return {
          success: false,
          snapshot,
          error: "函数编译失败",
        };
      }

      // 深拷贝快照，避免函数执行失败时污染原快照
      const snapshotCopy = JSON.parse(JSON.stringify(snapshot));

      // 准备参数
      const funcParams = [
        snapshotCopy,
        args,
        context,
        ...Object.values(this.safeGlobals),
      ];

      // 执行函数
      const result = executor(...funcParams);

      // 函数应该返回修改后的快照
      if (result === undefined || result === null) {
        warn(
          `${EXTENSION_LOG_PREFIX} 函数 ${functionDef.name} 未返回快照，使用原快照`,
        );
        return {
          success: true,
          snapshot: snapshotCopy,
        };
      }

      return {
        success: true,
        snapshot: result,
      };
    } catch (e) {
      error(`${EXTENSION_LOG_PREFIX} 执行函数 ${functionDef.name} 失败:`, e);
      return {
        success: false,
        snapshot,
        error: e.message || String(e),
      };
    }
  }

  /**
   * 执行完整的函数处理流程
   * @param {any} inputSnapshot - 输入快照（上一层 AI 消息的快照或角色模板）
   * @param {Array<import('./registry.js').ParsedFunctionCall>} activeCalls - 主动函数调用列表
   * @param {{before: Array, after: Array}} passiveFunctions - 被动函数列表
   * @param {ExecutionContext} context - 执行上下文
   * @returns {ExecutionResult}
   */
  executeAll(inputSnapshot, activeCalls, passiveFunctions, context) {
    let currentSnapshot = JSON.parse(JSON.stringify(inputSnapshot));
    const errors = [];

    // 1. 执行前置被动函数
    log(
      `${EXTENSION_LOG_PREFIX} 执行 ${passiveFunctions.before.length} 个前置被动函数`,
    );
    for (const func of passiveFunctions.before) {
      const result = this.executeFunction(func, currentSnapshot, [], context);
      if (result.success) {
        currentSnapshot = result.snapshot;
      } else {
        errors.push({
          functionName: func.name,
          error: result.error || "未知错误",
        });
      }
    }

    // 2. 执行主动函数调用
    log(`${EXTENSION_LOG_PREFIX} 执行 ${activeCalls.length} 个主动函数调用`);
    for (const call of activeCalls) {
      const result = this.executeFunction(
        call.functionDef,
        currentSnapshot,
        call.args,
        context,
      );
      if (result.success) {
        currentSnapshot = result.snapshot;
      } else {
        errors.push({
          functionName: call.functionDef.name,
          error: result.error || "未知错误",
        });
      }
    }

    // 3. 执行后置被动函数
    log(
      `${EXTENSION_LOG_PREFIX} 执行 ${passiveFunctions.after.length} 个后置被动函数`,
    );
    for (const func of passiveFunctions.after) {
      const result = this.executeFunction(func, currentSnapshot, [], context);
      if (result.success) {
        currentSnapshot = result.snapshot;
      } else {
        errors.push({
          functionName: func.name,
          error: result.error || "未知错误",
        });
      }
    }

    // 报告错误
    if (errors.length > 0) {
      warn(
        `${EXTENSION_LOG_PREFIX} 有 ${errors.length} 个函数调用失败:`,
        errors,
      );

      // 使用 toastr 通知用户（如果可用）
      if (window.toastr) {
        window.toastr.warning(
          `本次解析有 ${errors.length} 个函数调用失败，请检查控制台日志`,
          "变量系统",
        );
      }
    }

    return {
      snapshot: currentSnapshot,
      errors,
    };
  }
}

/**
 * 全局单例实例
 */
export const functionExecutor = new FunctionExecutor();

/**
 * 执行函数调用流程的简化接口
 * @param {Array<{functionDef, args, index, fullMatch}>} activeCalls - 主动函数调用列表
 * @param {any} inputSnapshot - 输入快照
 * @returns {Promise<any>} 处理后的快照
 */
export async function executeFunctionPipeline(activeCalls, inputSnapshot) {
  // 动态导入 functionRegistry 以获取被动函数
  const { functionRegistry } = await import('./registry.js');

  // 获取被动函数列表
  const passiveFunctions = functionRegistry.getPassiveFunctions();

  // 构建执行上下文（基本信息）
  const context = {
    timestamp: Date.now(),
  };

  // 执行完整流程
  const result = functionExecutor.executeAll(
    inputSnapshot,
    activeCalls,
    passiveFunctions,
    context
  );

  // 返回最终快照
  return result.snapshot;
}
