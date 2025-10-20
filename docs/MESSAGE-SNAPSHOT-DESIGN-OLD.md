# 楼层快照与回复解析系统 - 设计文档

**创建日期**: 2025-10-20  
**最后更新**: 2025-10-20  
**状态**: 已确认 - 待实现  
**相关**: 消息楼层快照、函数调用解析、函数库系统

---

## 1. 概述

### 1.1 目标

实现一个自动的消息楼层快照系统，能够：

1. **监听关键事件**：AI 回复完成、切换 swipe、开始新聊天
2. **追踪变量演化**：每条 AI 消息可绑定一个变量快照
3. **解析函数调用**：从 AI 回复中提取特定格式的函数调用，应用到变量块
4. **注入聊天变量**：将当前快照加载到 SillyTavern 的聊天变量系统中

### 1.2 核心流程

```
事件触发 → 查找最后一层 AI 消息 → 检查快照标识符
    ↓
  存在标识符 → 加载绑定快照 → 注入聊天变量
    ↓
  不存在 → 向上查找最近的锚点（有标识符的消息）
    ↓
  从锚点开始解析所有中间消息的函数调用
    ↓
  逐层应用函数调用，生成新快照
    ↓
  为最新消息绑定快照标识符 → 保存到数据库 → 注入聊天变量
    ↓
  若所有消息都无标识符 → 从角色模板（初始化快照）开始
```

---

## 2. 技术调研结果

### 2.1 聊天记录结构

**文件格式**: JSONL (每行一个 JSON 对象)

**消息对象结构**（基于 `SillyTavern/public/scripts/` 和 `JS-Slash-Runner/@types/`）:

```typescript
type ChatMessage = {
  name: string; // 发言者名称
  is_user: boolean; // 是否为用户消息
  is_system: boolean; // 是否为系统消息（隐藏，不发送给 LLM）
  mes: string; // 消息内容
  send_date: number; // 发送时间戳
  swipe_id?: number; // 当前激活的 swipe ID
  swipes?: string[]; // 所有 swipe 内容
  swipes_info?: Record<string, any>[]; // 每个 swipe 的元数据（JS-Slash-Runner 3.1.2+）
  extra?: {
    // 扩展字段（✅ 可用于存储快照 ID）
    type?: string; // 'narrator' = system role
    image?: string;
    file?: { url: string; text: string };
    bookmark_link?: string;
    // 🔑 我们的扩展字段
    st_var_system_snapshot_id?: string; // 快照标识符
    [key: string]: any;
  };
  variables?:
    | Record<string, any>[]
    | { [swipe_id: number]: Record<string, any> }; // 酒馆内置变量系统
};
```

### 2.2 事件系统

**来源**: `references/iframe/event.d.ts`

**可用事件**:

```typescript
tavern_events.MESSAGE_RECEIVED = "message_received"; // AI 回复完成（包括开场白）
tavern_events.MESSAGE_SWIPED = "message_swiped"; // 切换 swipe
tavern_events.CHAT_CHANGED = "chat_id_changed"; // 切换聊天（加载新聊天）

// 监听示例
eventOn(tavern_events.MESSAGE_RECEIVED, (message_id: number) => {
  console.log(`AI 回复完成，消息 ID: ${message_id}`);
});
```

**关键发现**:

- ✅ `MESSAGE_RECEIVED` 会在 AI 回复完成后触发，包括开场白生成
- ✅ `MESSAGE_SWIPED` 提供 `message_id` 参数
- ⚠️ 需要判断是否为 AI 消息（`!chat[message_id].is_user`）

### 2.3 聊天变量注入

**MVU 方案**（参考 `mvu示例.json`）:

- 将变量块拆分为两个部分：
  1. **内容块**（完整的变量对象）→ 注入到某个变量名（如 `{{mvu_data}}`）
  2. **Schema 块**（通过 `$meta` 生成的类型约束）→ 注入到另一个变量名（如 `{{mvu_schema}}`）
- 通过提示词告知 AI 只能按 schema 操作，防止预期外的函数调用

**SAM 方案**（参考 `ST_var_manager/sam_state_manager.js`）:

- 直接注入完整的状态对象到变量（如 `{{sam_state}}`）
- 通过 `__SAM_base_data__` 世界书词条加载基础数据
- 支持自定义函数（通过 `EVAL` 命令执行）

**我们的选择**:

- **初期**：简单方案，直接注入完整变量块到 `{{var_system}}` 或类似名称
- **进阶**：可选 schema 分离机制（用户可启用）
- **扩展**：支持世界书特殊词条加载自定义内容（类似 SAM）

**注入 API**:

```javascript
// 基于 JS-Slash-Runner 的实现（setChatMessages）
const messageId = chat.length - 1;
const currentSnapshot = {
  /* 变量块 */
};

// 方法 1：写入 variables 字段（酒馆原生变量）
chat[messageId].variables = {
  0: currentSnapshot, // swipe_id = 0 时的变量
};

// 方法 2：通过 substituteParams 动态替换（全局变量）
// 需要找到注入全局变量的 API（待确认）
```

### 2.4 消息持久化

**保存消息**:

```javascript
// 来自 st-context.js
import { saveChatConditional } from "sillytavern";

// 修改消息后保存
chat[messageId].extra.st_var_system_snapshot_id = snapshotId;
await saveChatConditional();
```

---

## 3. 数据结构设计

### 3.1 消息快照绑定

**消息 extra 字段**:

```typescript
message.extra = {
  st_var_system_snapshot_id: "msg_abc123_v1", // 快照唯一标识符
  // 其他字段...
};
```

**标识符格式**:

```
msg_{chatId}_{messageIndex}_{version}
示例: "msg_Character-2024-10-20_5_1"
```

### 3.2 插件数据库（已实现）

**`message_variables` 表**（参考 `ST-VarSystemPlugin/src/db/snapshots.ts`）:

```sql
CREATE TABLE message_variables (
  identifier TEXT PRIMARY KEY,      -- 快照标识符
  chat_file TEXT NOT NULL,          -- 聊天文件名
  message_id INTEGER,               -- 消息索引（可为 NULL，开场白前可能没有消息）
  structure_id INTEGER NOT NULL,    -- 引用 variable_structures
  created_at INTEGER NOT NULL
);
```

**值去重机制**（已实现）:

- 短值（< 64 字符）：直接内联
- 长值（≥ 64 字符）：存入 `value_pool`，引用为 `{"__vmRef": id}`

### 3.3 函数调用格式

**提示词约定**（参考 MVU/SAM）:

```
在你的回复中，你可以使用以下函数来更新游戏状态：

@.SET("path.to.variable", value);  // 设置变量
@.ADD("path.to.number", 5);        // 数值加法
@.APPEND("path.to.array", item);   // 数组追加
@.REMOVE("path.to.array", index);  // 数组删除

示例:
@.SET("世界.时间", "2024年10月20日 15:30");
@.ADD("角色.生命值", -10);
```

**解析正则**（初步）:

```javascript
const FUNCTION_CALL_PATTERN = /@\.(\w+)\(([^)]+)\);?/g;

function parseAIResponse(text) {
  const calls = [];
  let match;
  while ((match = FUNCTION_CALL_PATTERN.exec(text)) !== null) {
    const [fullMatch, funcName, argsString] = match;
    calls.push({
      function: funcName,
      args: parseArgs(argsString), // 需要处理 JSON 参数
      raw: fullMatch,
    });
  }
  return calls;
}
```

---

## 4. 函数系统设计

### 4.1 可插拔函数架构

**函数定义结构**:

```typescript
type VarFunction = {
  name: string; // 函数名（如 "SET", "ADD"）
  enabled: boolean; // 是否启用
  category: string; // 分类（"基础"/"高级"/"自定义"）
  description: string; // 使用说明（中文）
  syntax: string; // 语法示例
  parameters: {
    name: string;
    type: string;
    description: string;
  }[];
  executor: (snapshot: any, ...args: any[]) => any; // 执行函数
};
```

**函数注册表**:

```javascript
const functionRegistry = new Map();

// 注册内置函数
registerFunction({
  name: "SET",
  enabled: true,
  category: "基础",
  description: "设置指定路径的变量值",
  syntax: '@.SET("path.to.var", value);',
  parameters: [
    { name: "path", type: "string", description: "点记法路径" },
    { name: "value", type: "any", description: "新值" },
  ],
  executor: (snapshot, path, value) => {
    return _.set(_.cloneDeep(snapshot), path, value);
  },
});
```

### 4.2 内置函数列表（参考 MVU/SAM）

| 函数名   | 说明                   | 语法示例                             |
| -------- | ---------------------- | ------------------------------------ |
| `SET`    | 设置变量               | `@.SET("角色.名字", "张三");`        |
| `ADD`    | 数值加法               | `@.ADD("角色.金币", 100);`           |
| `SUB`    | 数值减法               | `@.SUB("角色.生命值", 10);`          |
| `APPEND` | 数组追加               | `@.APPEND("背包.物品", "治疗药水");` |
| `REMOVE` | 数组删除（按索引或值） | `@.REMOVE("背包.物品", 0);`          |
| `ASSIGN` | 对象合并（类似 MVU）   | `@.ASSIGN("角色", {"等级": 2});`     |
| `UNSET`  | 删除字段               | `@.UNSET("临时数据.flag");`          |
| `TIME`   | 更新时间（SAM 风格）   | `@.TIME("2024-10-20T15:30:00Z");`    |

### 4.3 自定义函数支持

**方案 1：配置文件（初期，安全）**

```json
// ST-VarSystemExtension/functions/custom.json
{
  "functions": [
    {
      "name": "HEAL",
      "enabled": true,
      "category": "自定义",
      "description": "完全恢复生命值",
      "syntax": "@.HEAL();",
      "parameters": [],
      "implementation": {
        "type": "composite", // 组合调用
        "steps": [{ "function": "SET", "args": ["角色.生命值", 100] }]
      }
    }
  ]
}
```

**方案 2：代码注入（进阶，需要安全沙箱）**

```javascript
// 类似 SAM 的 EVAL，但需要限制权限
function executeSandboxedFunction(code, context) {
  // 使用 VM2 或 Isolated-VM（需要额外依赖）
  // 或者使用 Function constructor + Proxy 限制访问
  const sandbox = {
    _: lodash,
    snapshot: context.snapshot,
    // 禁止访问危险 API（fetch, require, etc.）
  };

  const fn = new Function("ctx", `with(ctx) { return ${code}; }`);
  return fn(sandbox);
}
```

### 4.4 自动执行规则

**需求**：某些操作每回合自动执行（不需要 AI 显式调用）

**设计**:

```typescript
type AutoRule = {
  name: string;
  enabled: boolean;
  trigger: "before_parse" | "after_parse" | "every_message";
  condition?: (context: { chat; messageId; snapshot }) => boolean;
  actions: FunctionCall[];
};

// 示例：每回合时间自动推进 1 小时
const timeProgressRule = {
  name: "时间推进",
  enabled: true,
  trigger: "after_parse",
  condition: (ctx) => ctx.snapshot["世界"]?.["时间"],
  actions: [{ function: "TIME_ADD", args: ["世界.时间", { hours: 1 }] }],
};
```

---

## 5. 实现计划

### Phase 1: 基础架构（1-2 周）

#### 1.1 消息遍历与快照查找

- [ ] 实现 `findSnapshotAnchor(messageId)` - 向上查找最近的快照锚点
- [ ] 实现 `getMessageRange(startId, endId)` - 获取消息范围
- [ ] 实现 `isAIMessage(message)` - 判断是否为 AI 消息

#### 1.2 函数调用解析器

- [ ] 实现 `parseFunctionCalls(text)` - 正则提取函数调用
- [ ] 实现 `parseArguments(argsString)` - 解析参数（支持 JSON）
- [ ] 错误处理：非法语法、缺失参数

#### 1.3 快照标识符管理

- [ ] 实现 `generateSnapshotId(chatFile, messageId)` - 生成唯一标识符
- [ ] 实现 `saveMessageSnapshot(identifier, chatFile, messageId, payload)` - 调用插件 API
- [ ] 实现 `loadMessageSnapshot(identifier)` - 加载快照（带值查询）

### Phase 2: 函数系统（1 周）

#### 2.1 函数注册表

- [ ] 定义 `VarFunction` 接口
- [ ] 实现 `FunctionRegistry` 类
- [ ] 实现 `registerFunction`, `getFunction`, `isEnabled`

#### 2.2 内置函数实现

- [ ] `SET` - 使用 `lodash.set`
- [ ] `ADD` - 数值加法，数组追加（兼容 MVU）
- [ ] `SUB`, `APPEND`, `REMOVE`, `ASSIGN`, `UNSET`
- [ ] `TIME` - 时间更新（解析 ISO8601）

#### 2.3 函数执行引擎

- [ ] 实现 `applyFunctionCall(snapshot, call)` - 单次调用
- [ ] 实现 `applyFunctionCalls(snapshot, calls)` - 批量应用
- [ ] 错误捕获与回滚机制

### Phase 3: 事件集成（1 周）

#### 3.1 事件监听

- [ ] 监听 `MESSAGE_RECEIVED` - AI 回复完成
- [ ] 监听 `MESSAGE_SWIPED` - 切换 swipe
- [ ] 监听 `CHAT_CHANGED` - 加载新聊天（初始化）

#### 3.2 主流程实现

- [ ] 实现 `handleMessageReceived(messageId)` - 核心流程
  - 检查 `st_var_system.enabled`
  - 查找快照锚点
  - 解析中间消息
  - 应用函数调用
  - 保存快照
  - 注入聊天变量
- [ ] 实现 `handleMessageSwiped(messageId)` - 切换 swipe 时重新加载

#### 3.3 聊天变量注入

- [ ] 研究 SillyTavern 的全局变量注入机制
- [ ] 实现 `injectChatVariables(snapshot)` - 写入 `{{var_system}}`
- [ ] （可选）实现 schema 分离注入

### Phase 4: UI 与高级功能（1-2 周）

#### 4.1 函数管理界面

- [ ] 函数列表（勾选启用/禁用）
- [ ] 查看函数说明
- [ ] 生成提示词块（复制到剪贴板）

#### 4.2 自动规则管理

- [ ] 规则列表界面
- [ ] 添加/编辑/删除规则
- [ ] 触发条件配置

#### 4.3 自定义函数

- [ ] 配置文件加载（JSON）
- [ ] 简单的代码编辑器（Monaco Editor / CodeMirror）
- [ ] （可选）沙箱执行环境

#### 4.4 Schema 分离机制

- [ ] 实现 `generateSchema(snapshot)` - 参考 MVU
- [ ] 配置开关（用户可选）
- [ ] 注入 `{{var_system_schema}}`

### Phase 5: 测试与优化（1 周）

- [ ] 单元测试：函数执行、解析器、快照查找
- [ ] 集成测试：完整流程（模拟 AI 回复）
- [ ] 性能优化：大量消息时的查找效率
- [ ] 错误处理：非法函数调用、网络错误
- [ ] 文档完善：用户指南、开发者文档

---

## 6. 待确认问题

### 6.1 聊天变量注入 API

**问题**：如何将快照注入到 SillyTavern 的全局变量系统中？

**可能方案**:

1. 直接修改 `chat[messageId].variables` 字段（写入到消息）
2. 使用 `substituteParams` 或类似 API 注入全局变量
3. 通过世界书词条动态注入（类似 SAM 的 `__SAM_base_data__`）

**需要查阅**:

- `SillyTavern/public/scripts/variables.js` 或类似文件
- MVU/SAM 如何注入变量（查看源码）

### 6.2 函数调用格式

**问题**：AI 回复中的函数调用格式是否需要更灵活？

**当前方案**: `@.FUNCTION(arg1, arg2);`

**备选方案**:

1. JSON 格式: `{"function": "SET", "args": ["path", "value"]}`
2. XML 格式: `<set path="角色.名字">张三</set>`
3. 自然语言解析: "将角色名字设置为张三" → 函数调用

**建议**：初期使用 `@.FUNCTION()` 格式（简单、明确），后期可扩展

### 6.3 开场白处理

**问题**：开场白（first_mes）是如何生成的？是否触发 `MESSAGE_RECEIVED` 事件？

**需要测试**：

1. 新建聊天时，开场白是否触发事件
2. 开场白的 `message_id` 是多少（通常是 0 或 1）
3. 是否需要为开场白绑定初始快照（角色模板）

### 6.4 Swipe 机制

**问题**：切换 swipe 时，如何处理每个 swipe 的快照？

**可能方案**:

1. **每个 swipe 独立快照**：
   - `identifier = msg_abc123_swipe0_v1`, `msg_abc123_swipe1_v1`
   - 切换 swipe 时加载对应快照
2. **只保存最后激活的 swipe**：
   - 简化存储，但丢失其他 swipe 的状态
3. **使用 `swipes_info` 字段**（JS-Slash-Runner 3.1.2+）：
   - 每个 swipe 的元数据存储快照 ID

**建议**：方案 3（利用现有扩展字段）

### 6.5 插件可选性

**问题**：扩展可独立运行（模板存角色卡），但楼层快照必须用数据库？

**可能方案**:

1. **强制依赖插件**：楼层快照只在插件可用时启用
2. **降级存储**：将快照存储在 `message.extra` 中（体积问题）
3. **混合方案**：小快照内联，大快照存数据库

**建议**：方案 1（楼层快照是高级功能，要求插件可接受）

### 6.6 Schema 分离的必要性

**问题**：是否实现 MVU 的 `$meta` + schema 分离机制？

**权衡**:

- **优点**：防止 AI 执行预期外操作，类型安全
- **缺点**：增加复杂度，可能影响 AI 理解
- **用户说**："不强求，可以靠提示词工程规范"

**建议**：作为可选功能（配置开关），初期不实现

---

## 7. 兼容性考虑

### 7.1 与 MVU 互操作

- MVU 使用 `chat[messageId].variables[0]` 存储 `mvu_data`
- 我们可以共存：`variables[0] = mvu_data`, `variables[1] = var_system`
- 或使用不同字段名：`extra.mvu_data`, `extra.st_var_system`

### 7.2 与 SAM 互操作

- SAM 使用全局状态对象（不绑定到消息）
- 可以同时运行，但需要避免函数名冲突
- 考虑函数命名空间：`@.var.SET()` vs `@.sam.SET()`

### 7.3 与记忆增强互操作

- 记忆增强使用独立的数据表（Chat Sheets）
- 不冲突，但可以考虑集成（将记忆数据作为变量的一部分）

---

## 8. 文件结构规划

```
ST-VarSystemExtension/
  src/
    snapshots/
      messageSnapshot.js     // 消息快照管理
      snapshotResolver.js    // 快照查找与解析
      variableInjector.js    // 聊天变量注入
    functions/
      registry.js            // 函数注册表
      builtinFunctions.js    // 内置函数实现
      customFunctions.js     // 自定义函数加载
      executor.js            // 函数执行引擎
      parser.js              // 函数调用解析器
    rules/
      autoRules.js           // 自动执行规则
      ruleEngine.js          // 规则引擎
    ui/
      functionManager.js     // 函数管理界面
      promptGenerator.js     // 提示词生成器
      ruleManager.js         // 规则管理界面
  functions/
    custom.json              // 自定义函数配置
    rules.json               // 自动规则配置
  docs/
    MESSAGE-SNAPSHOT-DESIGN.md  // 本文档
    FUNCTION-REFERENCE.md       // 函数使用手册（未来）
```

---

## 9. 开发优先级建议

### 核心功能（必须）

1. ✅ Phase 1.1 - 消息遍历与快照查找
2. ✅ Phase 1.2 - 函数调用解析器
3. ✅ Phase 2.1-2.3 - 函数系统
4. ✅ Phase 3.1-3.3 - 事件集成

### 高优先级（重要）

5. ⭐ Phase 4.1 - 函数管理界面（勾选 + 提示词生成）
6. ⭐ Phase 4.2 - 自动规则管理
7. ⭐ Phase 1.3 - 快照标识符与插件集成

### 中优先级（有用）

8. 🔸 Phase 4.3 - 自定义函数（配置文件）
9. 🔸 Swipe 快照支持（每个 swipe 独立快照）
10. 🔸 世界书集成（类似 `__SAM_base_data__`）

### 低优先级（可选）

11. 🔹 Phase 4.4 - Schema 分离机制
12. 🔹 沙箱执行环境（自定义代码）
13. 🔹 可视化快照查看器（调试工具）

---

## 10. 风险与挑战

### 10.1 性能问题

- **挑战**：大量消息时，向上查找锚点可能很慢
- **缓解**：
  - 缓存最近的锚点位置
  - 限制查找范围（如最多向上 100 条消息）
  - 建议用户定期"提交"快照

### 10.2 AI 输出不稳定

- **挑战**：AI 可能输出格式错误的函数调用
- **缓解**：
  - 宽松的正则表达式（容忍空格、换行）
  - 错误提示（记录到控制台，不中断流程）
  - 提示词优化（提供明确的示例）

### 10.3 函数安全性

- **挑战**：自定义函数可能执行恶意代码
- **缓解**：
  - 初期只支持配置文件（组合调用）
  - 沙箱执行（VM2 或 Isolated-VM）
  - 权限限制（禁止网络请求、文件访问）

### 10.4 与其他系统冲突

- **挑战**：MVU/SAM/记忆增强可能同时使用
- **缓解**：
  - 使用独立的变量命名空间
  - 检测冲突并提示用户
  - 提供兼容模式配置

---

## 11. 待讨论问题

### 问题 1：函数调用格式

**当前**: `@.SET("path", value);`  
**备选**: JSON / XML / 自然语言  
**您的偏好**？

---

## 11. 已确认的设计决策

### ✅ 函数调用格式

- **决策**: 同时支持 MVU（`_.set()`）和 SAM（`@.SET()`）语法
- **理由**: 让作者复用现有世界书，无需修改
- **实现**: 内部统一映射到相同的执行逻辑

### ✅ 开场白快照

- **决策**: 自动解析开场白中的函数调用
- **流程**: 角色模板 + 开场白函数调用 → 生成消息 0 的快照
- **注意**: 开场白可能包含函数调用，需要解析

### ✅ Swipe 快照策略

- **决策**: 每个 swipe 独立快照标识符
- **存储**: 使用 `message.swipes_info[swipe_id].st_var_system_snapshot_id`
- **解析**: 侦测当前激活的 swipe，基于正确的上一层快照生成新快照

### ✅ Schema 分离

- **决策**: **不实现** MVU 的 `$meta` schema 分离机制
- **理由**: 校验可以在函数执行时处理，无需在变量结构中设置类型保护

### ✅ 插件依赖

- **决策**: 楼层快照**强制依赖插件**（数据库存储）
- **理由**: 快照必须存储在数据库中，扩展独立运行只支持角色模板功能

### ✅ 自定义函数安全性

- **决策**: 函数本质是操作变量块的规则，无安全风险
- **实现**: 支持自定义 JavaScript 函数，不需要严格沙箱限制

### ✅ 函数库系统（参考酒馆助手脚本库）

- **全局函数** + **局域函数**（每张角色卡各自配置）
- **主动函数**（AI 回复中调用）+ **被动函数**（每次自动执行）
- **执行顺序可配置**（拖拽排序）
- **存储位置**:
  - 全局：`extension_settings.st_var_system.functions`
  - 局域：`character.data.extensions.st_var_system.functions`

### ✅ 函数定义结构

```javascript
{
  id: "uuid",                      // 唯一标识符
  name: "时间推进",                // 函数名称
  type: "passive",                 // 'active' 或 'passive'
  enabled: true,                   // 是否启用
  order: 1,                        // 执行顺序
  description: "每回合时间推进1小时", // 提示词说明（给作者参考）
  pattern: "@\\.TIME_ADD\\((.+?)\\)", // 正则：匹配 AI 回复中的调用（仅主动函数）
  executor: `
    // JavaScript 代码，操作 snapshot 变量块
    const currentTime = _.get(snapshot, '世界.时间');
    const newTime = addHours(currentTime, 1);
    _.set(snapshot, '世界.时间', newTime);
    return snapshot;
  `
}
```

### ✅ 执行流程

1. AI 回复后触发解析
2. 按配置顺序遍历函数库：
   - 主动函数 A: 检查 AI 回复是否匹配 pattern → 若有则执行
   - 被动函数 B: 直接执行（无需匹配）
   - 主动函数 C: 检查 AI 回复是否匹配 pattern → 若有则执行
3. 生成快照 → 绑定标识符 → 注入聊天变量

**关键点**:

- 每次 AI 回复都执行完整流程（即使没有匹配到任何主动函数）
- 被动函数无条件执行，触发条件在函数代码内部实现（`if (condition) {...}`）

### ✅ 错误处理

- **策略**: 跳过失败的函数调用，继续处理其他调用
- **提示**: 使用 SillyTavern 弹窗 + 控制台日志

```javascript
toastr.warning("本次解析有 2 个函数调用失败，请检查控制台日志", "变量系统");
console.error("[ST-VarSystemExtension] 函数调用失败:", errorDetails);
```

### ✅ 快照清理机制

- **标识符丢失**: 清除该标识符，按"不存在"执行
- **数据库快照**: 保留（不同步删除）
- **手动清理**: UI 提供"清除未被引用的快照"按钮
- **重新解析**: 提供"清除最新消息标识符 + 重新解析"按钮

### ✅ 提示词生成器

- **格式**: 使用 `<variable_system_functions>` 或 `<game_state_functions>` 标签
- **内容**: 包含所有勾选函数的说明（供作者复制到角色卡/世界书）
- **示例**:

```xml
<variable_system_functions>
你可以使用以下函数来更新游戏状态：

@.SET("path.to.var", value); // 设置变量
示例：@.SET("角色.名字", "张三");

@.ADD("path.to.number", 5); // 数值加法
示例：@.ADD("角色.金币", 100);
</variable_system_functions>
```

---

## 12. 下一步行动

1. **创建任务清单**：使用 `manage_todo_list` 拆解开发任务
2. **开始 Phase 1 实现**：
   - 研究开场白处理和事件监听
   - 实现消息遍历和快照查找
   - 实现 MVU/SAM 双语法解析器
   - 实现函数注册表和执行引擎
