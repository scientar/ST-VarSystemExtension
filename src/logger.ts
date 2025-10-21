/**
 * @file logger.js
 * @description 日志工具模块
 * 提供统一的日志输出接口，带有扩展前缀
 */

const PREFIX = '[ST-VarSystemExtension]';

/**
 * 输出普通日志
 * @param {...any} args - 要输出的内容
 */
export const log = (...args) => console.log(PREFIX, ...args);

/**
 * 输出警告日志
 * @param {...any} args - 要输出的内容
 */
export const warn = (...args) => console.warn(PREFIX, ...args);

/**
 * 输出错误日志
 * @param {...any} args - 要输出的内容
 */
export const error = (...args) => console.error(PREFIX, ...args);
