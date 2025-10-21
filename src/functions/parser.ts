/**
 * 函数调用解析器
 * 负责从 AI 消息中提取函数调用
 */

/**
 * 从文本中解析函数调用
 * 支持格式: @.FUNCTION_NAME(arg1, arg2, ...);
 * @param {string} text - 要解析的文本(AI 消息内容)
 * @param {Array<Object>} activeFunctions - 启用的主动函数列表
 * @returns {Array<Object>} 函数调用数组,每个元素包含 {functionId, functionName, pattern, args, raw}
 */
export function parseFunctionCalls(text, activeFunctions) {
  if (!text || typeof text !== "string") {
    return [];
  }

  if (!Array.isArray(activeFunctions) || activeFunctions.length === 0) {
    return [];
  }

  const calls = [];

  // 遍历所有启用的主动函数
  for (const func of activeFunctions) {
    if (func.type !== "active" || !func.enabled || !func.pattern) {
      continue;
    }

    try {
      // 使用预编译的正则表达式（性能优化）
      const regex = func._compiledRegex || new RegExp(func.pattern, "g");

      // 查找所有匹配
      while (true) {
        const match = regex.exec(text);
        if (match === null) {
          break;
        }

        // 提取参数(捕获组从索引 1 开始)
        const args = match.slice(1);

        calls.push({
          functionId: func.id,
          functionName: func.name,
          pattern: func.pattern,
          args,
          raw: match[0], // 完整的匹配文本
          index: match.index, // 在文本中的位置
        });
      }
    } catch (error) {
      console.error(
        `[ST-VarSystemExtension] 解析函数调用失败: ${func.name}`,
        error,
      );
    }
  }

  // 按出现顺序排序(根据 index)
  calls.sort((a, b) => a.index - b.index);

  if (calls.length > 0) {
    console.log(
      `[ST-VarSystemExtension] 解析到 ${calls.length} 个函数调用:`,
      calls,
    );
  }

  return calls;
}

/**
 * 解析参数字符串
 * 尝试将参数字符串转换为 JavaScript 值
 * @param {string} argString - 参数字符串
 * @returns {any} 解析后的值
 */
export function parseArgument(argString) {
  if (argString === undefined || argString === null) {
    return null;
  }

  // 去除首尾空格
  const trimmed = String(argString).trim();

  if (trimmed === "") {
    return "";
  }

  // 尝试解析为 JSON
  // 1. 字符串字面量(带引号)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      // 将单引号替换为双引号(JSON 标准)
      const jsonString = trimmed.replace(/^'|'$/g, '"');
      return JSON.parse(jsonString);
    } catch {
      // 解析失败,返回去除引号的字符串
      return trimmed.slice(1, -1);
    }
  }

  // 2. 数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // 3. 布尔值
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // 4. null
  if (trimmed === "null") return null;

  // 5. 对象或数组
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 解析失败,返回原始字符串
      return trimmed;
    }
  }

  // 默认返回原始字符串
  return trimmed;
}

/**
 * 解析参数数组
 * 将参数字符串数组转换为 JavaScript 值数组
 * @param {Array<string>} args - 参数字符串数组
 * @returns {Array<any>} 解析后的值数组
 */
export function parseArguments(args) {
  if (!Array.isArray(args)) {
    return [];
  }

  return args.map(parseArgument);
}

/**
 * 验证函数调用的参数数量
 * @param {Object} call - 函数调用对象
 * @param {Object} functionDef - 函数定义
 * @returns {boolean} 参数数量是否有效
 */
export function validateArgumentCount(call, functionDef) {
  if (!call || !functionDef) {
    return false;
  }

  // 如果函数定义没有 parameters 字段,不验证
  if (!Array.isArray(functionDef.parameters)) {
    return true;
  }

  const expectedCount = functionDef.parameters.length;
  const actualCount = call.args ? call.args.length : 0;

  if (actualCount !== expectedCount) {
    console.warn(
      `[ST-VarSystemExtension] 函数 ${functionDef.name} 参数数量不匹配: ` +
        `期望 ${expectedCount}, 实际 ${actualCount}`,
    );
    return false;
  }

  return true;
}
