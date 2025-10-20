/**
 * 函数系统 - 统一导出
 *
 * 包含:
 * - FunctionRegistry: 函数注册表
 * - FunctionExecutor: 函数执行引擎
 * - 内置函数库
 */

export { getBuiltinFunctions, initBuiltinFunctions } from "./builtins.js";
export { FunctionExecutor, functionExecutor } from "./executor.js";
export { FunctionRegistry, functionRegistry } from "./registry.js";
