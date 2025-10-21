/**
 * 内置函数库 - 提供与 MVU/SAM 兼容的基础函数
 *
 * MVU (MagVarUpdate) - 使用最广泛
 * SAM (Situational Awareness Manager) - FSM 状态管理
 */

/**
 * 生成内置函数列表
 * @returns {Array<import('./registry.js').FunctionDefinition>}
 */
export function getBuiltinFunctions() {
  return [
    // ==================== SET (MVU/SAM 通用) ====================
    {
      id: "builtin-set",
      name: "SET",
      type: "active",
      enabled: true,
      order: 10,
      builtin: true,
      description: '设置变量的值。语法: @.SET("path", value);',
      pattern: '@\\.SET\\(\\s*"([^"]+)"\\s*,\\s*(.+?)\\s*\\);?',
      executor: `
// SET(path, value) - 设置变量值
const [path, valueStr] = args;

// 解析值（JSON 格式）
let value;
try {
  value = JSON.parse(valueStr);
} catch (e) {
  // 解析失败，作为字符串处理（去掉引号）
  value = valueStr.replace(/^["']|["']$/g, '');
}

// 使用 lodash 的 set 方法
_.set(snapshot, path, value);

return snapshot;
`,
    },

    // ==================== ADD (MVU/SAM 通用) ====================
    {
      id: "builtin-add",
      name: "ADD",
      type: "active",
      enabled: true,
      order: 20,
      builtin: true,
      description:
        '数值加法或数组追加。如果目标是数组则追加，否则作数值加法。语法: @.ADD("path", value);',
      pattern: '@\\.ADD\\(\\s*"([^"]+)"\\s*,\\s*(.+?)\\s*\\);?',
      executor: `
// ADD(path, value) - 数值加法或数组追加（兼容 MVU/SAM）
const [path, valueStr] = args;

// 获取当前值
const currentValue = _.get(snapshot, path);

// 如果是数组，追加元素（SAM 行为）
if (Array.isArray(currentValue)) {
  let value;
  try {
    value = JSON.parse(valueStr);
  } catch (e) {
    value = valueStr.replace(/^["']|["']$/g, '');
  }
  currentValue.push(value);
  _.set(snapshot, path, currentValue);
  return snapshot;
}

// 否则作为数值加法（MVU 行为）
const num = parseFloat(valueStr);
if (isNaN(num)) {
  console.warn('[ST-VarSystem] ADD: 无效的数值参数:', valueStr);
  return snapshot;
}

const newValue = (parseFloat(currentValue) || 0) + num;
_.set(snapshot, path, newValue);

return snapshot;
`,
    },

    // ==================== SUB (MVU 特有) ====================
    {
      id: "builtin-sub",
      name: "SUB",
      type: "active",
      enabled: true,
      order: 30,
      builtin: true,
      description: '数值减法。语法: @.SUB("path", number);',
      pattern: '@\\.SUB\\(\\s*"([^"]+)"\\s*,\\s*([\\d.\\-]+)\\s*\\);?',
      executor: `
// SUB(path, number) - 数值减法
const [path, numStr] = args;
const num = parseFloat(numStr);

if (isNaN(num)) {
  console.warn('[ST-VarSystem] SUB: 无效的数值参数:', numStr);
  return snapshot;
}

const currentValue = _.get(snapshot, path, 0);
const newValue = (parseFloat(currentValue) || 0) - num;
_.set(snapshot, path, newValue);

return snapshot;
`,
    },

    // ==================== DEL (SAM 特有) ====================
    {
      id: "builtin-del",
      name: "DEL",
      type: "active",
      enabled: true,
      order: 35,
      builtin: true,
      description: '删除数组中指定索引的元素。语法: @.DEL("path", index);',
      pattern: '@\\.DEL\\(\\s*"([^"]+)"\\s*,\\s*(\\d+)\\s*\\);?',
      executor: `
// DEL(path, index) - 删除数组元素（SAM）
const [path, indexStr] = args;
const index = parseInt(indexStr);

if (isNaN(index) || index < 0) {
  console.warn('[ST-VarSystem] DEL: 无效的索引:', indexStr);
  return snapshot;
}

const arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] DEL: 目标不是数组:', path);
  return snapshot;
}

if (index >= arr.length) {
  console.warn('[ST-VarSystem] DEL: 索引超出范围:', index);
  return snapshot;
}

arr.splice(index, 1);
_.set(snapshot, path, arr);

return snapshot;
`,
    },

    // ==================== APPEND (MVU 特有) ====================
    {
      id: "builtin-append",
      name: "APPEND",
      type: "active",
      enabled: true,
      order: 40,
      builtin: true,
      description: '向数组末尾追加元素。语法: @.APPEND("path", value);',
      pattern: '@\\.APPEND\\(\\s*"([^"]+)"\\s*,\\s*(.+?)\\s*\\);?',
      executor: `
// APPEND(path, value) - 数组追加（MVU）
const [path, valueStr] = args;

// 解析值
let value;
try {
  value = JSON.parse(valueStr);
} catch (e) {
  value = valueStr.replace(/^["']|["']$/g, '');
}

// 获取当前数组
let arr = _.get(snapshot, path);

// 如果不存在或不是数组，创建新数组
if (!Array.isArray(arr)) {
  arr = [];
}

arr.push(value);
_.set(snapshot, path, arr);

return snapshot;
`,
    },

    // ==================== REMOVE (MVU 特有) ====================
    {
      id: "builtin-remove",
      name: "REMOVE",
      type: "active",
      enabled: true,
      order: 50,
      builtin: true,
      description:
        '从数组中移除元素（按索引或值）。语法: @.REMOVE("path", indexOrValue);',
      pattern: '@\\.REMOVE\\(\\s*"([^"]+)"\\s*,\\s*(.+?)\\s*\\);?',
      executor: `
// REMOVE(path, indexOrValue) - 数组删除（MVU）
const [path, targetStr] = args;

// 获取当前数组
let arr = _.get(snapshot, path);

if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] REMOVE: 目标不是数组:', path);
  return snapshot;
}

// 尝试解析为索引（数字）
const index = parseInt(targetStr);
if (!isNaN(index) && index >= 0 && index < arr.length) {
  // 按索引删除
  arr.splice(index, 1);
} else {
  // 按值删除
  let value;
  try {
    value = JSON.parse(targetStr);
  } catch (e) {
    value = targetStr.replace(/^["']|["']$/g, '');
  }
  
  const idx = arr.indexOf(value);
  if (idx !== -1) {
    arr.splice(idx, 1);
  }
}

_.set(snapshot, path, arr);

return snapshot;
`,
    },

    // ==================== SELECT_SET (SAM 特有) ====================
    {
      id: "builtin-select-set",
      name: "SELECT_SET",
      type: "active",
      enabled: true,
      order: 60,
      builtin: true,
      description:
        '在数组中查找对象并设置其属性。语法: @.SELECT_SET("path", "selectorKey", "selectorValue", "receiverKey", newValue);',
      pattern:
        '@\\.SELECT_SET\\(\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*(.+?)\\s*\\);?',
      executor: `
// SELECT_SET(path, selectorKey, selectorValue, receiverKey, newValue) - SAM
const [path, selectorKey, selectorValue, receiverKey, newValueStr] = args;

const arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] SELECT_SET: 目标不是数组:', path);
  return snapshot;
}

// 解析新值
let newValue;
try {
  newValue = JSON.parse(newValueStr);
} catch (e) {
  newValue = newValueStr.replace(/^["']|["']$/g, '');
}

// 查找匹配的对象
const targetObj = arr.find(item => 
  item && typeof item === 'object' && item[selectorKey] === selectorValue
);

if (targetObj) {
  targetObj[receiverKey] = newValue;
} else {
  console.warn(\`[ST-VarSystem] SELECT_SET: 未找到匹配对象 \${selectorKey}=\${selectorValue}\`);
}

return snapshot;
`,
    },

    // ==================== SELECT_ADD (SAM 特有) ====================
    {
      id: "builtin-select-add",
      name: "SELECT_ADD",
      type: "active",
      enabled: true,
      order: 70,
      builtin: true,
      description:
        '在数组中查找对象并增加其属性值。语法: @.SELECT_ADD("path", "selectorKey", "selectorValue", "receiverKey", valueToAdd);',
      pattern:
        '@\\.SELECT_ADD\\(\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*(.+?)\\s*\\);?',
      executor: `
// SELECT_ADD(path, selectorKey, selectorValue, receiverKey, valueToAdd) - SAM
const [path, selectorKey, selectorValue, receiverKey, valueToAddStr] = args;

const arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] SELECT_ADD: 目标不是数组:', path);
  return snapshot;
}

// 查找匹配的对象
const targetObj = arr.find(item => 
  item && typeof item === 'object' && item[selectorKey] === selectorValue
);

if (!targetObj) {
  console.warn(\`[ST-VarSystem] SELECT_ADD: 未找到匹配对象 \${selectorKey}=\${selectorValue}\`);
  return snapshot;
}

const currentValue = targetObj[receiverKey];

// 如果是数组，追加元素
if (Array.isArray(currentValue)) {
  let value;
  try {
    value = JSON.parse(valueToAddStr);
  } catch (e) {
    value = valueToAddStr.replace(/^["']|["']$/g, '');
  }
  currentValue.push(value);
} else {
  // 否则作为数值加法
  const num = parseFloat(valueToAddStr);
  if (isNaN(num)) {
    console.warn('[ST-VarSystem] SELECT_ADD: 无效的数值参数:', valueToAddStr);
    return snapshot;
  }
  targetObj[receiverKey] = (parseFloat(currentValue) || 0) + num;
}

return snapshot;
`,
    },

    // ==================== SELECT_DEL (SAM 特有) ====================
    {
      id: "builtin-select-del",
      name: "SELECT_DEL",
      type: "active",
      enabled: true,
      order: 80,
      builtin: true,
      description:
        '在数组中查找并删除匹配的对象。语法: @.SELECT_DEL("path", "selectorKey", "selectorValue");',
      pattern:
        '@\\.SELECT_DEL\\(\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*,\\s*"([^"]+)"\\s*\\);?',
      executor: `
// SELECT_DEL(path, selectorKey, selectorValue) - SAM
const [path, selectorKey, selectorValue] = args;

const arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] SELECT_DEL: 目标不是数组:', path);
  return snapshot;
}

// 查找匹配对象的索引
const index = arr.findIndex(item => 
  item && typeof item === 'object' && item[selectorKey] === selectorValue
);

if (index !== -1) {
  arr.splice(index, 1);
} else {
  console.warn(\`[ST-VarSystem] SELECT_DEL: 未找到匹配对象 \${selectorKey}=\${selectorValue}\`);
}

return snapshot;
`,
    },

    // ==================== INC (MVU 特有) ====================
    {
      id: "builtin-inc",
      name: "INC",
      type: "active",
      enabled: true,
      order: 90,
      builtin: true,
      description:
        '数值自增（默认 +1）。语法: @.INC("path") 或 @.INC("path", step);',
      pattern: '@\\.INC\\(\\s*"([^"]+)"(?:\\s*,\\s*([\\d.\\-]+))?\\s*\\);?',
      executor: `
// INC(path, step?) - 数值自增（MVU）
const [path, stepStr] = args;
const step = stepStr ? parseFloat(stepStr) : 1;

if (isNaN(step)) {
  console.warn('[ST-VarSystem] INC: 无效的步进值:', stepStr);
  return snapshot;
}

const currentValue = _.get(snapshot, path, 0);
const newValue = (parseFloat(currentValue) || 0) + step;
_.set(snapshot, path, newValue);

return snapshot;
`,
    },

    // ==================== DEC (MVU 特有) ====================
    {
      id: "builtin-dec",
      name: "DEC",
      type: "active",
      enabled: true,
      order: 100,
      builtin: true,
      description:
        '数值自减（默认 -1）。语法: @.DEC("path") 或 @.DEC("path", step);',
      pattern: '@\\.DEC\\(\\s*"([^"]+)"(?:\\s*,\\s*([\\d.\\-]+))?\\s*\\);?',
      executor: `
// DEC(path, step?) - 数值自减（MVU）
const [path, stepStr] = args;
const step = stepStr ? parseFloat(stepStr) : 1;

if (isNaN(step)) {
  console.warn('[ST-VarSystem] DEC: 无效的步进值:', stepStr);
  return snapshot;
}

const currentValue = _.get(snapshot, path, 0);
const newValue = (parseFloat(currentValue) || 0) - step;
_.set(snapshot, path, newValue);

return snapshot;
`,
    },

    // ==================== DELETE (MVU 特有) ====================
    {
      id: "builtin-delete",
      name: "DELETE",
      type: "active",
      enabled: true,
      order: 110,
      builtin: true,
      description: '删除变量。语法: @.DELETE("path");',
      pattern: '@\\.DELETE\\(\\s*"([^"]+)"\\s*\\);?',
      executor: `
// DELETE(path) - 删除变量（MVU）
const [path] = args;

_.unset(snapshot, path);

return snapshot;
`,
    },
  ];
}

/**
 * 初始化内置函数库到注册表
 * @param {import('./registry.js').FunctionRegistry} registry
 */
export function initBuiltinFunctions(registry) {
  const builtins = getBuiltinFunctions();

  for (const func of builtins) {
    registry.upsertGlobalFunction(func);
  }

  console.log("[ST-VarSystemExtension] 已注册", builtins.length, "个内置函数");
  console.log(
    "[ST-VarSystemExtension] MVU 兼容函数: SET, ADD, SUB, APPEND, REMOVE, INC, DEC, DELETE",
  );
  console.log(
    "[ST-VarSystemExtension] SAM 兼容函数: SET, ADD, DEL, SELECT_SET, SELECT_ADD, SELECT_DEL",
  );
}
