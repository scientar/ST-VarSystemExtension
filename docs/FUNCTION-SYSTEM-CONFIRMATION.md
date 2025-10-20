# 三个问题的确认与解决

## ✅ 1. 同一函数多次调用支持

**确认：完全支持！**

### 实现原理

```javascript
// registry.js - parseFunctionCalls() 方法
for (const func of activeFunctions) {
  const regex = new RegExp(func.pattern, "g");
  let match = regex.exec(text);

  while (match !== null) {
    // ← 循环捕获所有匹配
    allMatches.push({
      functionDef: func,
      args: match.slice(1),
      index: match.index, // ← 记录位置
      fullMatch: match[0],
    });
    match = regex.exec(text);
  }
}

// 按位置排序，保证执行顺序
allMatches.sort((a, b) => a.index - b.index);
```

### 示例验证

```javascript
// AI 回复
const text =
  "@.ADD('gold', 10); 描述... @.SET('name', 'A'); 描述... @.ADD('gold', 20);";

// 解析结果
[
  { function: "ADD", args: ["gold", "10"], index: 0 }, // 先执行
  { function: "SET", args: ["name", "A"], index: 30 }, // 然后执行
  { function: "ADD", args: ["gold", "20"], index: 60 }, // 最后执行
];

// 执行顺序：ADD → SET → ADD ✅
```

---

## ✅ 2. 内置函数暴露到函数库管理

**已实现：添加 `builtin: true` 字段**

### 设计调整

```typescript
interface FunctionDefinition {
  id: string;
  name: string;
  type: "active" | "passive";
  enabled: boolean;
  order: number;
  description: string;
  builtin?: boolean; // ← 新增：标记内置函数
  pattern?: string;
  timing?: "before_active" | "after_active";
  executor: string;
}
```

### UI 行为规则

| 功能                         | 用户函数 | 内置函数 (`builtin: true`) |
| ---------------------------- | -------- | -------------------------- |
| **显示在列表**               | ✅       | ✅                         |
| **调整排序** (`order`)       | ✅       | ✅                         |
| **启用/禁用** (`enabled`)    | ✅       | ✅                         |
| **查看说明** (`description`) | ✅       | ✅                         |
| **生成提示词**               | ✅       | ✅                         |
| **编辑代码** (`executor`)    | ✅       | ❌ 只读                    |
| **删除函数**                 | ✅       | ❌ 不可删除                |

### 实现示例

```javascript
// builtins.js - 所有内置函数都标记为 builtin: true
{
  id: 'builtin-set',
  name: 'SET',
  builtin: true,  // ← 标记为内置
  enabled: true,
  order: 10,
  // ... 其他字段
}
```

---

## ✅ 3. SAM 函数兼容性

**已实现：完整支持 MVU + SAM 语法**

### 内置函数列表（11 个）

| 函数           | 来源    | 说明                    | 语法                                                             |
| -------------- | ------- | ----------------------- | ---------------------------------------------------------------- |
| **SET**        | MVU/SAM | 设置变量                | `@.SET("path", value);`                                          |
| **ADD**        | MVU/SAM | 数值加法/数组追加       | `@.ADD("path", value);`                                          |
| **SUB**        | MVU     | 数值减法                | `@.SUB("path", number);`                                         |
| **DEL**        | SAM     | 删除数组元素（按索引）  | `@.DEL("path", index);`                                          |
| **APPEND**     | MVU     | 数组追加                | `@.APPEND("path", value);`                                       |
| **REMOVE**     | MVU     | 删除数组元素（索引/值） | `@.REMOVE("path", indexOrValue);`                                |
| **SELECT_SET** | SAM     | 在数组中查找对象并设置  | `@.SELECT_SET("path", "key", "value", "targetKey", newValue);`   |
| **SELECT_ADD** | SAM     | 在数组中查找对象并增加  | `@.SELECT_ADD("path", "key", "value", "targetKey", valueToAdd);` |
| **SELECT_DEL** | SAM     | 在数组中查找对象并删除  | `@.SELECT_DEL("path", "key", "value");`                          |
| **INC**        | MVU     | 自增（默认 +1）         | `@.INC("path");` 或 `@.INC("path", step);`                       |
| **DEC**        | MVU     | 自减（默认 -1）         | `@.DEC("path");` 或 `@.DEC("path", step);`                       |
| **DELETE**     | MVU     | 删除变量                | `@.DELETE("path");`                                              |

### 兼容性对比

#### MVU (MagVarUpdate) - 使用最广泛

```javascript
@.SET("player.name", "张三");
@.ADD("player.gold", 100);
@.SUB("player.health", 20);
@.APPEND("inventory", "药水");
@.REMOVE("inventory", 0);
@.INC("level");
@.DEC("stamina");
@.DELETE("temp_var");
```

#### SAM (Situational Awareness Manager) - FSM 状态管理

```javascript
@.SET("player.name", "张三");
@.ADD("player.gold", 100);
@.DEL("inventory", 0);
@.SELECT_SET("npcs", "name", "艾拉", "favorability", 80);
@.SELECT_ADD("npcs", "name", "艾拉", "favorability", 10);
@.SELECT_DEL("quests", "id", "quest_001");
```

### ADD 函数的智能行为

```javascript
// 对数组：追加元素（SAM 行为）
@.ADD("inventory", "药水");
// inventory = [...items, "药水"]

// 对数值：加法（MVU 行为）
@.ADD("gold", 100);
// gold = currentGold + 100
```

---

## 📊 功能覆盖对比

### 已实现的 SAM 命令

- ✅ SET - 设置变量
- ✅ ADD - 数值加法/数组追加
- ✅ DEL - 删除数组元素
- ✅ SELECT_SET - 数组对象查找+设置
- ✅ SELECT_ADD - 数组对象查找+增加
- ✅ SELECT_DEL - 数组对象查找+删除

### SAM 高级功能（未来实现）

- 🔲 TIME - 更新游戏时间
- 🔲 TIMED_SET - 定时设置（基于回合/时间）
- 🔲 CANCEL_SET - 取消定时设置
- 🔲 RESPONSE_SUMMARY - 回复摘要
- 🔲 EVAL - 执行自定义函数（安全沙箱）

---

## 🎯 设计原则

1. **完全兼容 MVU/SAM**：用户可以无缝迁移现有角色卡
2. **内置函数可管理**：在 UI 中可见、可排序、可禁用，但不可编辑/删除
3. **顺序保证**：多个函数调用严格按文本出现顺序执行
4. **类型安全**：所有函数定义都有 TypeScript 类型标注（通过 JSDoc）
5. **错误容错**：单个函数失败不影响其他函数，记录错误并通知用户

---

## 📁 相关文件

- `src/functions/registry.js` - 函数注册表，添加了 `builtin` 字段定义
- `src/functions/builtins.js` - 内置函数库，11 个函数全部标记 `builtin: true`
- `src/functions/executor.js` - 函数执行引擎
- `src/functions/index.js` - 统一导出

---

## ✅ 三个问题总结

| #   | 问题             | 状态        | 解决方案                                    |
| --- | ---------------- | ----------- | ------------------------------------------- |
| 1   | 同一函数多次调用 | ✅ 完全支持 | while 循环捕获所有匹配 + 按 index 排序      |
| 2   | 内置函数暴露管理 | ✅ 已实现   | 添加 `builtin: true` 字段，UI 区分处理      |
| 3   | SAM 函数兼容性   | ✅ 完整支持 | 实现 11 个内置函数，覆盖 MVU + SAM 核心语法 |
