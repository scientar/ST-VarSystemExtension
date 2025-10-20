# 修复报告：缺失的 getContext 导入

**日期**: 2025-10-21  
**问题**: `processor.js` 中使用了 `getContext()` 但未导入

---

## 🐛 问题描述

在 `ST-VarSystemExtension/src/events/processor.js` 中：

```javascript
// ❌ 错误：使用了 getContext() 但未导入
export async function processMessage(targetMessageId, swipeId = null) {
  const context = getContext(); // ← 这里调用了 getContext
  const chat = context.chat;
  // ...
}

function getCharacterTemplate() {
  const context = getContext(); // ← 这里也调用了
  // ...
}
```

**文件顶部缺少导入语句**：

```javascript
// 缺少这一行！
import { getContext } from "/scripts/extensions.js";
```

---

## ✅ 修复方案

### 添加导入语句

```javascript
/**
 * @file processor.js
 * @description 快照生成核心处理流程
 */

import { getContext } from "/scripts/extensions.js"; // ✅ 新增
import { executeFunctionPipeline } from "../functions/executor.js";
import { functionRegistry } from "../functions/registry.js";
// ... 其他导入
```

---

## 📚 API 验证

### `getContext()` 的正确用法

**来源**：`/scripts/extensions.js`（SillyTavern 核心 API）

**返回值**：

```typescript
{
  characterId: number,        // 当前角色 ID
  characters: Array<Object>,  // 所有角色列表
  chat: Array<Object>,        // 当前聊天记录
  chatMetadata: Object,       // 聊天元数据
  eventSource: Object,        // 事件源
  eventTypes: Object,         // 事件类型枚举
  // ... 其他字段
}
```

**用法示例**（已在其他文件中使用）：

1. **reprocessButton.js**：

```javascript
import { getContext } from "/scripts/extensions.js";

function isReprocessButtonVisible() {
  const context = getContext();
  // ...
}
```

2. **messageSnapshots.js**：

```javascript
import { getContext } from "../../../../../../../scripts/extensions.js";

async function loadSnapshotsList() {
  const context = getContext();
  // ...
}
```

---

## 🔍 为什么之前没报错？

在修复过程中，我直接在代码里使用了 `getContext()`，但：

1. **静态检查不会报错**：JavaScript 是动态语言，静态分析工具不会强制检查未导入的全局函数
2. **运行时才会报错**：只有在 SillyTavern 实际运行时才会抛出 `ReferenceError: getContext is not defined`

---

## ✅ 验证结果

### 编译检查 ✅

```bash
# processor.js 无编译错误
No errors found
```

### 导入一致性 ✅

所有使用 `getContext()` 的文件现在都正确导入了：

| 文件                     | 导入路径                                     | 状态      |
| ------------------------ | -------------------------------------------- | --------- |
| `index.js`               | `/scripts/extensions.js`                     | ✅        |
| `ui/reprocessButton.js`  | `/scripts/extensions.js`                     | ✅        |
| `ui/messageSnapshots.js` | `../../../../../../../scripts/extensions.js` | ✅        |
| `events/processor.js`    | `/scripts/extensions.js`                     | ✅ 已修复 |

**注意**：路径差异是因为文件层级不同：

- 根目录文件使用 `/scripts/extensions.js`（绝对路径）
- 深层文件可能使用相对路径

---

## 📝 相关文档更新

### copilot-instructions.md

已记录 `getContext()` API：

```markdown
Verified APIs (2025-10-19)

- `getContext()` → `{ characterId, characters, chat, ... }` (来自 `extensions.js`)
```

**注意**：虽然 `getContext` 实际实现在 `st-context.js` 中，但扩展应该从 `/scripts/extensions.js` 导入（统一入口）。

---

## 🎯 经验教训

### 1. 导入检查清单

在使用任何 SillyTavern API 前，确保：

- ✅ 已添加正确的 import 语句
- ✅ 导入路径正确（绝对路径 vs 相对路径）
- ✅ 其他文件中有类似用法可参考

### 2. 代码审查要点

在代码审查时，除了逻辑正确性，还需检查：

- ✅ 所有使用的函数都已导入
- ✅ 导入的函数实际存在且可用
- ✅ 导入路径符合项目规范

### 3. 静态检查的局限性

JavaScript 的静态检查工具无法捕获所有问题：

- ❌ 不会检查未导入的全局函数
- ❌ 不会检查运行时才存在的 API
- ✅ 只能检查语法错误和类型错误（TypeScript）

**建议**：在实际环境中测试是必要的。

---

## ✅ 修复完成

- ✅ 添加 `getContext` 导入
- ✅ 验证无编译错误
- ✅ 确认与其他文件导入方式一致
- ✅ 文档已记录

**修改的文件**：

- `ST-VarSystemExtension/src/events/processor.js`

**新增文档**：

- `ST-VarSystemExtension/docs/FIX-GETCONTEXT-IMPORT.md`（本文件）
