/**
 * 函数调用解析器
 * 负责从 AI 消息中提取函数调用
 */

import * as characterParser from "character-parser";

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
    if (func.type !== "active" || !func.enabled || !func.name) {
      continue;
    }

    try {
      // 创建简单的正则表达式，只匹配函数名和左括号
      // 例如：@.ADD( 或 @.SET(
      const funcNameRegex = new RegExp(`@\\.${func.name}\\s*\\(`, "g");

      // 查找所有匹配
      while (true) {
        const match = funcNameRegex.exec(text);
        if (match === null) {
          break;
        }

        // 匹配的起始位置
        const startIndex = match.index;
        // 左括号后的位置
        const afterOpenParen = match.index + match[0].length;

        // 使用 character-parser 提取完整的参数字符串
        const { argsString, endIndex } = extractFunctionArgs(
          text.slice(afterOpenParen),
        );

        if (endIndex === -1) {
          console.warn(
            `[ST-VarSystemExtension] 无法找到函数 ${func.name} 的结束括号`,
          );
          continue;
        }

        // 分割参数
        const argStrings = splitArguments(argsString);

        // 计算完整匹配的文本
        const fullMatchLength = afterOpenParen - startIndex + endIndex + 1;
        const raw = text.substr(startIndex, fullMatchLength);

        calls.push({
          functionId: func.id,
          functionName: func.name,
          pattern: func.pattern, // 保留原有的 pattern 以保持兼容性
          args: argStrings,
          raw, // 完整的匹配文本
          index: startIndex, // 在文本中的位置
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

/**
 * 提取函数调用的参数字符串（正确处理引号和括号）
 * @param {string} text - 函数调用后面的文本（从左括号后开始）
 * @returns {Object} { argsString: 参数字符串, endIndex: 结束位置（右括号的位置） }
 */
export function extractFunctionArgs(text) {
  try {
    const result = characterParser.parseUntil(text, ")");
    return {
      argsString: result.src.trim(),
      endIndex: result.end, // 右括号的位置
    };
  } catch (error) {
    console.error(
      "[ST-VarSystemExtension] 提取函数参数失败:",
      error,
    );
    // 回退到简单匹配
    const simpleMatch = text.match(/^([^)]*)\)/);
    if (simpleMatch) {
      return {
        argsString: simpleMatch[1].trim(),
        endIndex: simpleMatch[0].length - 1,
      };
    }
    return { argsString: "", endIndex: -1 };
  }
}

/**
 * 分割参数字符串为数组（正确处理引号内的逗号）
 * @param {string} argsString - 参数字符串，如 '"a","b(c)",123'
 * @returns {Array<string>} 参数数组
 */
export function splitArguments(argsString) {
  if (!argsString || argsString.trim() === "") {
    return [];
  }

  const args = [];
  let current = "";
  let depth = 0; // 括号深度
  let inString = false; // 是否在字符串内
  let stringChar = null; // 当前字符串的引号类型
  let escaped = false; // 上一个字符是否是转义符

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if (escaped) {
      // 转义字符，直接添加
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      // 转义符
      current += char;
      escaped = true;
      continue;
    }

    if (!inString) {
      // 不在字符串内
      if (char === '"' || char === "'") {
        // 进入字符串
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === "(" || char === "[" || char === "{") {
        // 进入括号
        depth++;
        current += char;
      } else if (char === ")" || char === "]" || char === "}") {
        // 退出括号
        depth--;
        current += char;
      } else if (char === "," && depth === 0) {
        // 顶层逗号，分割参数
        args.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    } else {
      // 在字符串内
      if (char === stringChar) {
        // 退出字符串
        inString = false;
        stringChar = null;
        current += char;
      } else {
        current += char;
      }
    }
  }

  // 添加最后一个参数
  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}
