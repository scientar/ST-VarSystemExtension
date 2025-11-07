/**
 * 内置函数库 - 为文本游戏提供核心变量操作功能
 *
 * 设计原则：
 * - 精简实用：只保留最常用的 10 个核心函数
 * - 避免冗余：功能相近的函数合并或删除
 * - 智能操作：函数根据目标类型自动选择行为
 */

/**
 * 生成内置函数列表
 * @returns {Array<import('./registry.js').FunctionDefinition>}
 */
export function getBuiltinFunctions() {
  return [
    // ==================== 1. SET - 完全覆盖变量 ====================
    {
      id: 'builtin-set',
      name: 'SET',
      type: 'active',
      enabled: true,
      order: 10,
      builtin: true,
      description: `SET - 设置变量的值（完全覆盖）

参数：
- path (字符串): 变量路径，使用点号分隔，如 "player.hp"
- value (任意类型): 新的值（字符串、数字、对象、数组等）

示例：
#set("player.name", "Alice")
#set("player.hp", 100)
#set("player.stats", {"str": 10, "agi": 8})

注意：此操作会完全覆盖目标变量。如果只想更新对象的部分键，请使用 UPDATE 函数`,
      executor: `
const [path, rawValue] = args;

// 如果已经是对象/数组/数字等（parser 已解析），直接使用
let value = rawValue;

// 如果是字符串，尝试解析
if (typeof rawValue === 'string') {
  try {
    value = JSON.parse(rawValue);
  } catch (e) {
    // 解析失败，去掉引号作为普通字符串
    value = rawValue.replace(/^["']|["']$/g, '');
  }
}

// 使用 lodash 的 set 方法
_.set(snapshot, path, value);

return snapshot;
`,
    },

    // ==================== 2. UPDATE - 部分更新对象 ====================
    {
      id: 'builtin-update',
      name: 'UPDATE',
      type: 'active',
      enabled: true,
      order: 20,
      builtin: true,
      description: `UPDATE - 部分更新对象（只修改指定的键，保留其他键）

参数：
- path (字符串): 目标对象的路径
- updates (对象): 要更新的键值对

示例：
#update("player.stats", {"hp": 100, "mp": 50})
// 假设原 stats = {hp: 80, mp: 30, exp: 1200}
// 结果：stats = {hp: 100, mp: 50, exp: 1200}  ← exp 被保留

#update("npc.alice", {"mood": "happy", "relationship": 75})

注意：如果目标路径不存在或不是对象，会初始化为空对象。此函数只做浅合并（一层深度）`,
      executor: `
const [path, updates] = args;

// 获取当前对象
let currentObj = _.get(snapshot, path);

// 如果不存在或不是对象，初始化为空对象
if (!currentObj || typeof currentObj !== 'object' || Array.isArray(currentObj)) {
  currentObj = {};
}

// 浅合并（只更新指定的键）
Object.assign(currentObj, updates);
_.set(snapshot, path, currentObj);

return snapshot;
`,
    },

    // ==================== 3. ADD - 数值加法或数组追加 ====================
    {
      id: 'builtin-add',
      name: 'ADD',
      type: 'active',
      enabled: true,
      order: 30,
      builtin: true,
      description: `ADD - 数值加法或数组追加（智能判断目标类型）

参数：
- path (字符串): 目标变量的路径
- value (数字|任意类型): 要添加的值

行为：
- 如果目标是数组：追加元素到末尾
- 如果目标是数字：执行加法运算（可传负数当减法用）

示例：
#add("player.gold", 50)          // 金币 +50
#add("player.gold", -30)         // 金币 -30（传负数当减法）
#add("inventory.items", "sword") // 数组追加新物品
#add("party.members", {"name": "Bob", "level": 5})

注意：可以传负数来实现减法效果，无需单独的 SUB 函数`,
      executor: `
const [path, rawValue] = args;

// 获取当前值
const currentValue = _.get(snapshot, path);

// 如果是数组，追加元素
if (Array.isArray(currentValue)) {
  let value = rawValue;

  // 如果是字符串，尝试解析
  if (typeof rawValue === 'string') {
    try {
      value = JSON.parse(rawValue);
    } catch (e) {
      value = rawValue.replace(/^["']|["']$/g, '');
    }
  }

  currentValue.push(value);
  _.set(snapshot, path, currentValue);
  return snapshot;
}

// 否则作为数值加法
let num;
if (typeof rawValue === 'number') {
  num = rawValue;
} else if (typeof rawValue === 'string') {
  num = parseFloat(rawValue);
} else {
  num = NaN;
}

if (isNaN(num)) {
  console.warn('[ST-VarSystem] ADD: 无效的数值参数:', rawValue);
  return snapshot;
}

const newValue = (parseFloat(currentValue) || 0) + num;
_.set(snapshot, path, newValue);

return snapshot;
`,
    },

    // ==================== 4. DELETE - 删除变量 ====================
    {
      id: 'builtin-delete',
      name: 'DELETE',
      type: 'active',
      enabled: true,
      order: 40,
      builtin: true,
      description: `DELETE - 删除变量

参数：
- path (字符串): 要删除的变量路径

示例：
#delete("temp.battle_data")
#delete("player.buffs.poison")

注意：删除后该路径将不存在，访问会返回 undefined`,
      executor: `
const [path] = args;

_.unset(snapshot, path);

return snapshot;
`,
    },

    // ==================== 5. SELECT_SET - 在数组中查找对象并设置属性 ====================
    {
      id: 'builtin-select-set',
      name: 'SELECT_SET',
      type: 'active',
      enabled: true,
      order: 50,
      builtin: true,
      description: `SELECT_SET - 在数组中查找对象并设置其属性

参数：
- arrayPath (字符串): 目标数组的路径
- selectorKey (字符串): 用于匹配的键名
- selectorValue (任意类型): 用于匹配的值
- targetKey (字符串): 要修改的键名
- newValue (任意类型): 新的值

示例：
#select_set("npcs", "name", "Alice", "hp", 100)
// 在 npcs 数组中找到 name="Alice" 的对象，设置其 hp=100

#select_set("party", "id", "player1", "status", "ready")

注意：此函数会完全覆盖目标键的值。如果要部分更新对象，使用 SELECT_UPDATE`,
      executor: `
const [path, selectorKey, selectorValue, receiverKey, rawNewValue] = args;

const arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] SELECT_SET: 目标不是数组:', path);
  return snapshot;
}

// 解析新值（如果已经是对象/数组/数字等，直接使用）
let newValue = rawNewValue;

if (typeof rawNewValue === 'string') {
  try {
    newValue = JSON.parse(rawNewValue);
  } catch (e) {
    newValue = rawNewValue.replace(/^["']|["']$/g, '');
  }
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

    // ==================== 6. SELECT_ADD - 在数组中查找对象并增加属性 ====================
    {
      id: 'builtin-select-add',
      name: 'SELECT_ADD',
      type: 'active',
      enabled: true,
      order: 60,
      builtin: true,
      description: `SELECT_ADD - 在数组中查找对象并增加其属性值

参数：
- arrayPath (字符串): 目标数组的路径
- selectorKey (字符串): 用于匹配的键名
- selectorValue (任意类型): 用于匹配的值
- targetKey (字符串): 要修改的键名
- valueToAdd (数字|任意类型): 要添加的值

行为：
- 如果目标属性是数组：追加元素
- 如果目标属性是数字：执行加法（可传负数）

示例：
#select_add("party", "name", "Alice", "exp", 200)
// 给 Alice 的经验 +200

#select_add("party", "name", "Alice", "exp", -50)
// 给 Alice 的经验 -50（传负数）

#select_add("npcs", "id", "merchant_01", "items", "rare_sword")
// 给商人的物品列表追加新物品

注意：支持传负数来实现减法效果`,
      executor: `
const [path, selectorKey, selectorValue, receiverKey, rawValueToAdd] = args;

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
  let value = rawValueToAdd;

  // 如果是字符串，尝试解析
  if (typeof rawValueToAdd === 'string') {
    try {
      value = JSON.parse(rawValueToAdd);
    } catch (e) {
      value = rawValueToAdd.replace(/^["']|["']$/g, '');
    }
  }

  currentValue.push(value);
} else {
  // 否则作为数值加法
  let num;
  if (typeof rawValueToAdd === 'number') {
    num = rawValueToAdd;
  } else if (typeof rawValueToAdd === 'string') {
    num = parseFloat(rawValueToAdd);
  } else {
    num = NaN;
  }

  if (isNaN(num)) {
    console.warn('[ST-VarSystem] SELECT_ADD: 无效的数值参数:', rawValueToAdd);
    return snapshot;
  }
  targetObj[receiverKey] = (parseFloat(currentValue) || 0) + num;
}

return snapshot;
`,
    },

    // ==================== 7. SELECT_UPDATE - 在数组中查找对象并部分更新 ====================
    {
      id: 'builtin-select-update',
      name: 'SELECT_UPDATE',
      type: 'active',
      enabled: true,
      order: 70,
      builtin: true,
      description: `SELECT_UPDATE - 在数组中查找对象并部分更新其属性

参数：
- arrayPath (字符串): 目标数组的路径
- selectorKey (字符串): 用于匹配的键名
- selectorValue (任意类型): 用于匹配的值
- updates (对象): 要更新的键值对

示例：
#select_update("npcs", "name", "Alice", {"hp": 50, "status": "injured", "mood": "angry"})
// 在 npcs 数组中找到 name="Alice" 的对象，一次性更新多个属性

#select_update("quests", "id", "main_001", {"progress": 75, "step": "find_artifact"})

注意：此函数只更新指定的键，保留对象的其他属性。适合一次性更新多个属性`,
      executor: `
const [path, selectorKey, selectorValue, updates] = args;

const arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] SELECT_UPDATE: 目标不是数组:', path);
  return snapshot;
}

// 查找匹配的对象
const targetObj = arr.find(item =>
  item && typeof item === 'object' && item[selectorKey] === selectorValue
);

if (targetObj) {
  // 浅合并更新
  Object.assign(targetObj, updates);
} else {
  console.warn(\`[ST-VarSystem] SELECT_UPDATE: 未找到匹配对象 \${selectorKey}=\${selectorValue}\`);
}

return snapshot;
`,
    },

    // ==================== 8. SELECT_DEL - 在数组中查找并删除对象 ====================
    {
      id: 'builtin-select-del',
      name: 'SELECT_DEL',
      type: 'active',
      enabled: true,
      order: 80,
      builtin: true,
      description: `SELECT_DEL - 在数组中查找并删除匹配的对象

参数：
- arrayPath (字符串): 目标数组的路径
- selectorKey (字符串): 用于匹配的键名
- selectorValue (任意类型): 用于匹配的值

示例：
#select_del("enemies", "id", "goblin_001")
// 从 enemies 数组中删除 id="goblin_001" 的对象

#select_del("party", "name", "Bob")
// 从队伍中移除 name="Bob" 的角色

注意：只删除第一个匹配的对象。如果需要删除数组中所有匹配的值，使用 PULL 函数`,
      executor: `
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

    // ==================== 9. PUSH_UNIQUE - 去重追加到数组 ====================
    {
      id: 'builtin-push-unique',
      name: 'PUSH_UNIQUE',
      type: 'active',
      enabled: true,
      order: 90,
      builtin: true,
      description: `PUSH_UNIQUE - 只在数组中不存在时才追加元素（去重）

参数：
- arrayPath (字符串): 目标数组的路径
- value (任意类型): 要添加的值

示例：
#push_unique("achievements", "dragon_slayer")
// 只有当 "dragon_slayer" 不在数组中时才添加

#push_unique("unlocked_areas", "dark_forest")
#push_unique("inventory.keys", {"id": "rusty_key", "name": "生锈的钥匙"})

注意：使用深度比较判断是否存在。对于对象，会比较所有字段`,
      executor: `
const [path, rawValue] = args;

let arr = _.get(snapshot, path);

// 如果不存在或不是数组，初始化
if (!Array.isArray(arr)) {
  arr = [];
}

// 解析值
let value = rawValue;
if (typeof rawValue === 'string') {
  try {
    value = JSON.parse(rawValue);
  } catch (e) {
    value = rawValue.replace(/^["']|["']$/g, '');
  }
}

// 检查是否已存在（深度比较）
const exists = arr.some(item => _.isEqual(item, value));

if (!exists) {
  arr.push(value);
  _.set(snapshot, path, arr);
}

return snapshot;
`,
    },

    // ==================== 10. PULL - 从数组移除所有匹配值 ====================
    {
      id: 'builtin-pull',
      name: 'PULL',
      type: 'active',
      enabled: true,
      order: 100,
      builtin: true,
      description: `PULL - 从数组中移除所有匹配的值（不是索引）

参数：
- arrayPath (字符串): 目标数组的路径
- value (任意类型): 要移除的值

示例：
#pull("inventory.consumables", "health_potion")
// 移除所有 "health_potion"（如果有多个会全部删除）

#pull("player.buffs", "poison")
// 移除 poison buff

#pull("quest_log", {"id": "quest_001", "status": "completed"})
// 移除特定对象（深度比较）

注意：这是 SELECT_DEL 的通用版本，可作用于任意类型的数组，不限于对象数组`,
      executor: `
const [path, rawValueToRemove] = args;

let arr = _.get(snapshot, path);
if (!Array.isArray(arr)) {
  console.warn('[ST-VarSystem] PULL: 目标不是数组:', path);
  return snapshot;
}

// 解析要移除的值
let valueToRemove = rawValueToRemove;
if (typeof rawValueToRemove === 'string') {
  try {
    valueToRemove = JSON.parse(rawValueToRemove);
  } catch (e) {
    valueToRemove = rawValueToRemove.replace(/^["']|["']$/g, '');
  }
}

// 移除所有匹配的值（深度比较）
const filtered = arr.filter(item => !_.isEqual(item, valueToRemove));
_.set(snapshot, path, filtered);

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

  console.log('[ST-VarSystemExtension] 已注册', builtins.length, '个内置函数');
  console.log('[ST-VarSystemExtension] 核心函数: SET, UPDATE, ADD, DELETE');
  console.log('[ST-VarSystemExtension] SELECT 系列: SELECT_SET, SELECT_ADD, SELECT_UPDATE, SELECT_DEL');
  console.log('[ST-VarSystemExtension] 数组操作: PUSH_UNIQUE, PULL');
}
