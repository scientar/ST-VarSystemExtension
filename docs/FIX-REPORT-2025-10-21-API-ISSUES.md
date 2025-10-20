# API 使用问题修复报告 (2025-10-21)

## 问题概述

在 `src/events/listeners.js` 中发现以下 API 使用问题：

### 1. `event_types` 未导入

**问题代码**：

```javascript
eventOn(event_types.MESSAGE_RECEIVED, handleMessageReceived);
```

**问题**：`event_types` 在 listeners.js 中未导入，会导致运行时错误。

**正确使用方式**（根据 references 和现有代码）：

#### 选项 A：使用全局 `tavern_events`（适用于 iframe/脚本库）

```javascript
eventOn(tavern_events.MESSAGE_RECEIVED, handleMessageReceived);
```

- 来源：`references/iframe/event.d.ts` 定义 `declare const tavern_events`
- 适用场景：运行在 iframe 或脚本库中的代码

#### 选项 B：从模块导入（适用于扩展）

```javascript
// 在文件顶部添加
import { event_types } from "/scripts/events.js";
// 或
import { event_types } from "../../index.js"; // 从父模块传递

// 然后使用
eventOn(event_types.MESSAGE_RECEIVED, handleMessageReceived);
```

- 来源：`SillyTavern/public/scripts/events.js` export const event_types
- 适用场景：扩展代码（有模块系统）

**推荐方案**：选项 B，因为变量系统扩展使用模块系统。

### 2. `getContext()` 未导入

**问题代码**：

```javascript
function isVariableSystemEnabled() {
  try {
    const context = getContext();  // ❌ getContext 未定义
    // ...
  }
}
```

**正确使用方式**：

#### 在扩展中应使用：

```javascript
const context = SillyTavern.getContext();
```

- 来源：`SillyTavern/public/scripts/st-context.js` 导出到全局对象
- processor.js 已正确使用此方式

### 3. `eventOn` 和 `eventRemoveListener` 的使用

**当前代码**（正确）：

```javascript
eventOn(event_types.MESSAGE_RECEIVED, handleMessageReceived);
eventRemoveListener(event_types.MESSAGE_RECEIVED, handleMessageReceived);
```

**验证**：

- `references/iframe/event.d.ts` 定义为全局函数：
  ```typescript
  declare function eventOn<T extends EventType>(
    event_type: T,
    listener: ListenerType[T],
  ): void;
  declare function eventRemoveListener<T extends EventType>(
    event_type: T,
    listener: ListenerType[T],
  ): void;
  ```
- 这两个函数无需导入，已正确使用

## 修复方案

### 方案 1：从 index.js 传递（最小改动）

**修改 src/events/index.js**：

```javascript
import { event_types } from "/scripts/events.js";

export function registerEventListeners() {
  // 传递 event_types 给 listeners
  listeners.registerEventListeners(event_types);
}
```

**修改 src/events/listeners.js**：

```javascript
// 接收 event_types 参数
export function registerEventListeners(event_types) {
  eventOn(event_types.MESSAGE_RECEIVED, handleMessageReceived);
  // ...
}

// 修改 getContext() 调用
function isVariableSystemEnabled() {
  const context = SillyTavern.getContext();
  // ...
}
```

### 方案 2：直接导入（推荐）

**修改 src/events/listeners.js**：

```javascript
// 在文件顶部添加导入
// （根据构建配置，可能需要从不同路径导入）

import { processMessage, reprocessFromMessage } from "./processor.js";

// 使用全局对象（扩展运行时 SillyTavern 已初始化）
// 或者创建一个辅助函数
function getEventTypes() {
  // 尝试从全局获取
  if (typeof tavern_events !== "undefined") {
    return tavern_events;
  }
  // 或者直接使用字符串（与 tavern_events 定义一致）
  return {
    MESSAGE_RECEIVED: "message_received",
    MESSAGE_SWIPED: "message_swiped",
    CHAT_CHANGED: "chat_id_changed",
    MESSAGE_DELETED: "message_deleted",
    CHAT_DELETED: "chat_deleted",
  };
}

const EVENT_TYPES = getEventTypes();

// 使用时
eventOn(EVENT_TYPES.MESSAGE_RECEIVED, handleMessageReceived);
```

### 方案 3：直接使用字符串（最简单但不推荐）

```javascript
eventOn("message_received", handleMessageReceived);
eventOn("message_swiped", handleMessageSwiped);
// ...
```

优点：无需导入
缺点：失去类型安全，易出错

## 推荐实施方案

**选择方案 2 的变体**：利用全局 `tavern_events`

```javascript
// src/events/listeners.js

import { processMessage, reprocessFromMessage } from "./processor.js";

const MODULE_NAME = "[ST-VarSystemExtension/listeners]";

// 使用全局的 tavern_events（在扩展加载时已定义）
const event_types = tavern_events;

// 其余代码保持不变，只需修改 getContext() 调用
function isVariableSystemEnabled() {
  try {
    const context = SillyTavern.getContext(); // 使用全局对象
    const character = context.characters[context.characterId];
    return character?.data?.extensions?.st_var_system?.enabled === true;
  } catch (error) {
    console.error(MODULE_NAME, "检查启用状态时发生错误:", error);
    return false;
  }
}

// 其他函数中的 getContext() 也需要类似修改
```

## 验证清单

修复完成后需验证：

- [ ] `eventOn(event_types.MESSAGE_RECEIVED, ...)` 不报错
- [ ] `SillyTavern.getContext()` 正确返回上下文
- [ ] 事件监听器能正确触发
- [ ] 所有五个事件都能正常工作
- [ ] 错误处理正常工作

## 参考文档

- `references/iframe/event.d.ts` - 事件系统类型定义（酒馆助手整理）
- `SillyTavern/public/scripts/events.js` - event_types 定义
- `SillyTavern/public/scripts/st-context.js` - getContext 实现
- `st-memory-enhancement/services/appFuncManager.js` - 其他扩展的导入示例
