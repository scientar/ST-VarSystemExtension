# 楼层快照与回复解析系统 - 设计文档

**创建日期**: 2025-10-20  
**最后更新**: 2025-10-20  
**状态**: 设计阶段 - 待实现  
**相关**: 消息楼层快照、函数调用解析、函数库系统

---

## 1. 概述与核心流程

### 1.1 系统目标

实现一个**自动化的消息楼层快照系统**,追踪对话过程中变量的演化历程:

1. **监听触发事件**: AI 回复完成、切换 swipe、开始新聊天
2. **追踪变量演化**: 每条 AI 消息(每个 swipe)可绑定一个变量快照
3. **解析函数调用**: 从 AI 回复中识别并执行函数调用,更新变量块
4. **注入聊天变量**: 将最新快照以 `{{vs_stat_data}}` 变量名注入到 SillyTavern
5. **可视化管理**: 提供 UI 查看、编辑、导出楼层快照

### 1.2 统一处理流程

**设计原则**: 对于不同监听事件使用同一个处理流程,简化逻辑,提高稳定性。

**触发时机**:

- AI 回复消息完成时(流式输出完成后触发,不在中途反复解析)
- 切换当前 swipe 时
- 开始新对话时(检查开始新对话的具体触发事件)

**核心流程**(仅在 `st_var_system.enabled === true` 时执行):

```
1. 检查最后一层 AI 消息是否存在唯一标识符
   ├─ 存在 → 获取绑定快照 → 注入聊天变量 {{vs_stat_data}}
   └─ 不存在 → 执行步骤 2

2. 向上查找上一层 AI 消息
   ├─ 找到有标识符的 → 获取快照 → 执行步骤 3
   └─ 找到无标识符的 → 继续向上查找
       └─ 直到第 0 层(开场白) → 使用角色模板 → 执行步骤 3

3. 解析当前层 AI 消息中的函数调用
   ├─ 应用函数调用到快照 → 生成新快照
   ├─ 保存到数据库 → 生成唯一标识符 → 绑定到消息
   └─ 若还有后续层未处理 → 重复步骤 3
       └─ 直到最新一层 → 注入聊天变量 {{vs_stat_data}}
```

### 1.3 处理流程示例

**示例 1**: 部分消息有标识符

消息结构:

```
0-2 [AI消息] (无标识符) → 1-0 [用户消息] → 2-1 [AI消息] (有标识符,绑定快照A)
→ 3-0 [用户消息] → 4-1 [AI消息] (无标识符)
```

注: x-y 表示第 x 层的编号为 y 的 swipe

处理流程:

1. 触发事件,检查 4-1 层 AI 消息,发现无标识符
2. 向上寻找,发现 2-1 层 AI 消息有标识符,获取绑定的快照 A
3. 解析 4-1 层 AI 消息中的函数调用,作用在快照 A 上生成新快照 B
4. 保存快照 B 到数据库,为 4-1 层生成唯一标识符并绑定快照 B
5. 将快照 B 以 `{{vs_stat_data}}` 变量名存入酒馆聊天变量中

**示例 2**: 所有消息都无标识符

消息结构:

```
0-2 [AI消息] (无标识符) → 1-0 [用户消息] → 2-1 [AI消息] (无标识符)
→ 3-0 [用户消息] → 4-1 [AI消息] (无标识符)
```

处理流程:

1. 触发事件,检查 4-1 层 AI 消息,发现无标识符
2. 向上寻找,发现 2-1 层 AI 消息无标识符,继续向上
3. 发现 0-2 层 AI 消息(开场白)无标识符,此时不存在更早的 AI 消息,获取**角色模板**
4. 解析 0-2 层 AI 消息中的函数调用,作用在角色模板上生成快照 C,存入数据库,为 0-2 层生成唯一标识符并绑定快照 C
5. 解析 2-1 层 AI 消息中的函数调用,作用在快照 C 上生成快照 D,存入数据库,为 2-1 层生成唯一标识符并绑定快照 D
6. 解析 4-1 层 AI 消息中的函数调用,作用在快照 D 上生成快照 E,存入数据库,为 4-1 层生成唯一标识符并绑定快照 E
7. 将快照 E 以 `{{vs_stat_data}}` 变量名存入酒馆聊天变量中

### 1.4 重要注意事项

1. **启用状态检查**: 只有在角色卡的变量系统启用(`st_var_system.enabled === true`)时才进行上述处理
2. **Swipe 独立性**: 唯一标识符绑定在 swipe 上,不同 swipe 有不同的快照和标识符
3. **当前 swipe**: 处理流程只考虑当前启用的 swipe,例如第 0 层的 swipe id 为 2,则 2-1 层对应的快照基于 0-2 层,而不是 0-0 或 0-1 层
4. **标识符丢失**: 如果处理流程中出现某个楼层的唯一标识符无法在数据库中找到对应快照,则删除该唯一标识符,当作不存在该唯一标识符处理

---

## 2. 数据结构设计

### 2.1 唯一标识符存储位置

基于调研结果(`references/function/chat_message.d.ts`),唯一标识符存储在 **`message.swipes_info[swipe_id]`** 中:

```typescript
type ChatMessageSwiped = {
  message_id: number; // 消息楼层号
  swipe_id: number; // 当前激活的 swipe
  swipes: string[]; // 所有 swipe 的内容
  swipes_info: Record<string, any>[]; // 每个 swipe 的元数据
  // ... 其他字段
};

// 存储示例
message.swipes_info[0] = {
  send_date: 1729420800,
  gen_started: null,
  gen_finished: null,
  extra: {
    /* ... */
  },
  // 🔑 我们的扩展字段
  st_var_system_snapshot_id: "msg_Character-2024-10-20_5_0_v1",
};
```

**标识符格式**:

```
UUID v4 格式(真正唯一,不受删除/移动影响)
示例: "550e8400-e29b-41d4-a716-446655440000"
```

**为什么使用 UUID 而不是组合索引**:

- ❌ `msg_{chatId}_{messageId}_{swipeId}` - **会产生冲突!**
  - 删除消息后,后续消息的 messageId 会改变(索引移动)
  - 删除 swipe 后,后续 swipe 的 swipeId 会改变(`swipes.splice()` 导致数组索引移动)
  - 新的消息/swipe 可能占用相同的索引位置,导致标识符重复
- ✅ UUID - **真正唯一,永不重复**
  - 不依赖可变的索引
  - 删除操作不影响已生成的标识符
  - 即使 swipes_info 数组索引改变,标识符仍然有效

**访问方式**:

```javascript
// 获取当前 swipe 的标识符
const currentSwipeId = message.swipe_id || 0;
const snapshotId =
  message.swipes_info?.[currentSwipeId]?.st_var_system_snapshot_id;

// 设置标识符
if (!message.swipes_info) message.swipes_info = [];
if (!message.swipes_info[currentSwipeId])
  message.swipes_info[currentSwipeId] = {};
message.swipes_info[currentSwipeId].st_var_system_snapshot_id = snapshotId;
```

### 2.2 插件数据库表(已实现)

**`message_variables` 表**:

```sql
CREATE TABLE message_variables (
  identifier TEXT PRIMARY KEY,      -- 快照标识符
  chat_file TEXT NOT NULL,          -- 聊天文件名
  message_id INTEGER,               -- 消息索引
  structure_id INTEGER NOT NULL,    -- 引用 variable_structures
  created_at INTEGER NOT NULL
);
```

**值去重机制**(已实现):

- 短值(< 64 字符): 直接内联
- 长值(≥ 64 字符): 存入 `value_pool`,引用为 `{"__vmRef": id}`

### 2.3 快照数据结构

**快照就是变量对象**,不再包装 `{metadata: {}, variables: {}}`(参考 2025-10-19 重构):

```json
{
  "世界": {
    "时间": "2024年10月26日 20:00",
    "地点": "魔都"
  },
  "角色": {
    "名字": "张三",
    "生命值": 100,
    "金币": 500
  },
  "背包": ["治疗药水", "魔法卷轴"]
}
```

### 2.4 角色模板存储

角色模板存储在 `character.data.extensions.st_var_system.templateBody`,结构与快照一致。

---

## 3. 函数库系统设计

### 3.1 存储位置

基于调研(`JS-Slash-Runner` 的实现),我们使用类似方式:

- **全局函数**: `extension_settings.st_var_system.functions` (数组)
- **局域函数**: `character.data.extensions.st_var_system.functions` (数组)

保存到角色卡使用 `writeExtensionField(characterId, 'st_var_system', data)`.

### 3.2 函数定义结构

```typescript
type VarFunction = {
  id: string; // 唯一标识符(UUID)
  name: string; // 函数名称(用户可读)
  type: "active" | "passive"; // 主动函数(AI调用) | 被动函数(自动执行)
  enabled: boolean; // 是否启用
  order: number; // 执行顺序(数字越小越先执行)

  // 函数说明(用于生成提示词)
  description: string; // 说明文本(中文)

  // 主动函数特有字段
  pattern?: string; // 正则表达式(匹配 AI 回复中的调用)

  // 被动函数特有字段
  timing?: "before_active" | "after_active"; // 执行时机

  // 函数实现代码(JavaScript)
  executor: string; // 函数代码字符串
};
```

**executor 代码示例**:

```javascript
// 主动函数: SET(path, value)
// 输入: snapshot (快照对象), args (匹配到的参数数组)
const [path, value] = args;
_.set(snapshot, path, value);
return snapshot;
```

```javascript
// 被动函数: 时间推进
// 输入: snapshot (快照对象), context (上下文信息)
if (_.has(snapshot, "世界.时间")) {
  const currentTime = _.get(snapshot, "世界.时间");
  // 简单示例: 时间 +1 小时
  const newTime = addHours(currentTime, 1);
  _.set(snapshot, "世界.时间", newTime);
}
return snapshot;
```

### 3.3 函数执行流程

**解析阶段**: 从 AI 消息文本中识别函数调用

```
1. 获取当前层 AI 消息内容
2. 遍历所有启用的主动函数:
   - 使用 pattern 正则匹配消息内容
   - 提取参数(通过正则捕获组)
   - 将 {function, args} 加入"主动函数调用列表"(按出现顺序)
3. 将所有启用的被动函数按 timing 分类:
   - timing === 'before_active' → "被动函数前列表"
   - timing === 'after_active' → "被动函数后列表"
4. 两个列表内部按 order 排序(数字越小越先执行)
```

**执行阶段**: 顺序应用函数,生成新快照

```
输入快照 = 上一层 AI 消息的快照(或角色模板)

for (被动函数前列表中的每个函数):
  输入快照 = 执行函数(输入快照, context)
  if (执行错误):
    记录错误,跳过该函数,继续执行

for (主动函数调用列表中的每个调用):
  输入快照 = 执行函数(输入快照, args)
  if (执行错误):
    记录错误,跳过该函数,继续执行

for (被动函数后列表中的每个函数):
  输入快照 = 执行函数(输入快照, context)
  if (执行错误):
    记录错误,跳过该函数,继续执行

输出快照 = 输入快照
```

**错误处理**:

- 跳过失败的函数调用,继续处理其他调用
- 完成快照生成后,通过酒馆内部通知方法通知用户
- 提示错误函数名,记录详细日志到控制台

```javascript
toastr.warning("本次解析有 2 个函数调用失败,请检查控制台日志", "变量系统");
console.error("[ST-VarSystemExtension] 函数调用失败:", errorDetails);
```

### 3.4 内置函数参考(兼容 MVU/SAM)

| 函数名   | 类型 | 说明                 | 语法示例                             |
| -------- | ---- | -------------------- | ------------------------------------ |
| `SET`    | 主动 | 设置变量             | `@.SET("角色.名字", "张三");`        |
| `ADD`    | 主动 | 数值加法             | `@.ADD("角色.金币", 100);`           |
| `SUB`    | 主动 | 数值减法             | `@.SUB("角色.生命值", 10);`          |
| `APPEND` | 主动 | 数组追加             | `@.APPEND("背包.物品", "治疗药水");` |
| `REMOVE` | 主动 | 数组删除(按索引或值) | `@.REMOVE("背包.物品", 0);`          |
| `ASSIGN` | 主动 | 对象合并(类似 MVU)   | `@.ASSIGN("角色", {"等级": 2});`     |
| `UNSET`  | 主动 | 删除字段             | `@.UNSET("临时数据.flag");`          |
| `TIME`   | 主动 | 更新时间(SAM 风格)   | `@.TIME("2024-10-20T15:30:00Z");`    |

**pattern 正则示例**:

```javascript
// SET(path, value)
pattern: /@\.SET\("([^"]+)",\s*(.+?)\);?/g;

// ADD(path, number)
pattern: /@\.ADD\("([^"]+)",\s*(-?\d+(?:\.\d+)?)\);?/g;
```

---

## 4. 函数库管理界面

### 4.1 界面位置

在变量系统扩展菜单添加"**函数库**"标签页,与"角色模板"、"全局快照"、"楼层快照"、"设置"并列。

### 4.2 界面功能

**顶部工具栏**:

- **新增函数** 按钮: 打开函数编辑弹窗,创建新函数
- **导入函数** 按钮: 从 JSON 文件导入函数
- **导出函数** 按钮: 将选中的函数导出为 JSON 文件
- **生成提示词** 按钮: 生成函数说明提示词块(复制到剪贴板)
- **全局/局域** 切换: 切换查看全局函数或当前角色的局域函数

**函数列表**(可拖拽排序):

- 显示所有函数(全局或局域)
- 每个函数卡片显示:
  - 启用/禁用 复选框
  - 函数名称
  - 类型徽章(主动/被动)
  - 执行顺序(被动函数显示时机)
  - 简短说明
  - 编辑/删除 按钮
- 拖拽调整顺序(修改 order 值)
- 支持在全局和局域之间移动(右键菜单)

**函数编辑弹窗**:

- 函数名称 (输入框)
- 函数类型 (单选: 主动/被动)
- 启用状态 (复选框)
- 函数说明 (文本区域,支持多行)
- **主动函数**:
  - 正则表达式 (输入框,pattern)
  - 测试工具(输入示例文本,测试是否匹配)
- **被动函数**:
  - 执行时机 (单选: 主动函数前/主动函数后)
- 函数代码 (代码编辑器,Monaco Editor 或 textarea)
- 保存/取消 按钮

### 4.3 提示词生成器

点击"生成提示词"按钮后,弹窗显示:

**格式**:

```xml
<variable_system_functions>
你可以使用以下函数来更新游戏状态：

@.SET("path.to.var", value); // 设置变量
示例：@.SET("角色.名字", "张三");

@.ADD("path.to.number", 5); // 数值加法
示例：@.ADD("角色.金币", 100);

@.APPEND("path.to.array", item); // 数组追加
示例：@.APPEND("背包", "治疗药水");

(... 其他启用的函数 ...)
</variable_system_functions>
```

**按钮**:

- 复制到剪贴板
- 关闭

### 4.4 导入/导出功能

**导出格式** (JSON):

```json
{
  "version": "1.0",
  "functions": [
    {
      "id": "uuid-xxx",
      "name": "时间推进",
      "type": "passive",
      "enabled": true,
      "order": 1,
      "timing": "after_active",
      "description": "每回合时间自动推进1小时",
      "executor": "const currentTime = _.get(snapshot, '世界.时间');\n// ..."
    },
    {
      "id": "uuid-yyy",
      "name": "SET",
      "type": "active",
      "enabled": true,
      "order": 1,
      "pattern": "@\\.SET\\(\"([^\"]+)\",\\s*(.+?)\\);?",
      "description": "设置指定路径的变量值",
      "executor": "const [path, value] = args;\n_.set(snapshot, path, value);\nreturn snapshot;"
    }
  ]
}
```

**导入行为**:

- 导入时生成新的 UUID(避免冲突)
- 添加到当前选择的范围(全局或局域)
- 导入后默认禁用,用户手动启用

---

## 5. 楼层快照界面

### 5.1 界面位置

在变量系统扩展菜单添加"**楼层快照**"标签页,与"角色模板"、"全局快照"、"函数库"、"设置"并列。

### 5.2 界面功能

**顶部工具栏**:

- **楼层选择器** 下拉菜单:
  - 显示所有有快照的楼层(格式: "第 5 层 - AI 消息")
  - 按层号罗列,默认显示最新一层
  - 支持滚动(几百上千层)
- **直接跳转** 输入框:
  - 输入层号,点击"跳转"按钮
  - 若该层无快照,提示错误
- **刷新** 按钮: 重新加载当前层快照

**编辑器区域**:

- 使用 `vanilla-jsoneditor` 编辑器(与角色模板、全局快照相同)
- 支持查看和编辑快照内容
- 显示当前层信息(层号、swipe id、消息发送时间)

**操作按钮**:

- **保存快照** 按钮:
  - 编辑快照内容后点击保存
  - 更新数据库中该层快照的内容
  - 更新该层快照对应的唯一标识符绑定的快照内容(不生成新标识符)
  - 重新执行一遍处理流程(以保证加入酒馆聊天变量的快照是最新的)
- **保存为全局快照** 按钮:
  - 将当前显示的快照保存为全局快照
  - 弹窗输入标签
- **导出 JSON** 按钮:
  - 导出当前显示的快照为 JSON 文件
- **导入 JSON** 按钮:
  - 从 JSON 文件导入,覆盖当前编辑器内容(不自动保存)

### 5.3 导入 MVU JSON 块

在"导入 JSON"弹窗中,提供一个**复选框**:

```
☑ 移除 MVU 元数据(保留纯净的 stat_data)
```

勾选后,导入时自动处理:

1. 递归删除所有 `$meta` 字段
2. 删除数组中的 `"$__META_EXTENSIBLE__$"` 标记
3. 只保留纯净的变量数据

**实现逻辑**:

```javascript
function stripMvuMetadata(obj) {
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== "$__META_EXTENSIBLE__$")
      .map((item) => stripMvuMetadata(item));
  } else if (_.isObject(obj) && !_.isDate(obj)) {
    const result = {};
    for (const key in obj) {
      if (key !== "$meta" && key !== "$arrayMeta") {
        result[key] = stripMvuMetadata(obj[key]);
      }
    }
    return result;
  }
  return obj;
}
```

---

## 6. 删除/编辑消息时的处理

### 6.1 设计原则

由于使用 UUID 作为标识符,删除操作变得简单:

1. **UUID 不受删除影响** - 即使消息/swipe 被删除,标识符仍然有效
2. **保留孤立快照无害** - swipe 被删除但数据库快照还在,不影响功能
3. **按 chatFile 批量清理** - 删除聊天记录时,直接删除该 chatFile 的所有快照
4. **不需要逐个检查** - 无需遍历每个 swipe 检查标识符是否还在使用

### 6.2 删除聊天记录

**实现**:

- 监听聊天记录删除事件(如果存在)
- 调用插件 API 按 chatFile 批量删除:
  ```javascript
  async function cleanupChatSnapshots(chatFile) {
    await fetch("/api/plugins/var-manager/var-manager/snapshots/by-chat", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatFile }),
    });
  }
  ```

**插件端新增接口**(待实现):

```
DELETE /var-manager/snapshots/by-chat
Body: { "chatFile": "Character-2024-10-20" }
```

### 6.3 删除消息或 Swipe

**行为**:

- **不做任何处理** - UUID 标识符保留在 swipes_info 中
- 即使 swipe 被删除,数据库中的快照继续保留
- 这些"孤立快照"不影响功能,只是占用少量存储空间

### 6.4 手动清理未使用的快照

在"**设置**"标签页中,提供"**清理未使用的快照**"按钮:

**功能**:

- 用于清理特殊情况下的孤立快照:
  - 聊天记录文件被手动重命名
  - 用户想回收存储空间
- **只清理 chatFile** - 扫描所有聊天记录文件,收集所有使用的 chatFile
- 删除数据库中不对应任何现存聊天记录的快照

**实现逻辑**:

```javascript
async function cleanupOrphanedSnapshots() {
  // 1. 获取所有聊天记录文件名
  const activeChatFiles = await getAllChatFiles();

  // 2. 调用插件 API 清理不在列表中的快照
  await fetch("/api/plugins/var-manager/var-manager/snapshots/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeChatFiles }),
  });
}
```

**注意事项**:

- 点击前提示用户可能耗时较长
- 不需要扫描每个消息的每个 swipe
- 只需要获取聊天记录文件名列表

### 6.5 编辑消息

**行为**:

- 编辑消息及确认编辑**无需**执行处理流程

**重新处理变量**:
在输入框左侧的扩展菜单(包含"重新生成"、"继续"、"开始新聊天"等按钮的菜单)中,增加一个"**重新处理变量**"按钮:

**功能**:

1. 清除最新一层 AI 消息的快照标识符
2. 从数据库删除该标识符对应的快照(可选,也可以保留)
3. 执行处理流程,生成新的快照(新的 UUID)并绑定到消息

---

## 7. 聊天变量注入

### 7.1 注入目标

将最新快照注入到 SillyTavern 的聊天变量系统,变量名为 `{{vs_stat_data}}`.

### 7.2 注入方式(待调研)

**可能方案**:

1. **方案 1**: 写入 `message.extra` 字段

   ```javascript
   const messageId = chat.length - 1;
   chat[messageId].extra.vs_stat_data = currentSnapshot;
   await saveChatConditional();
   ```

2. **方案 2**: 使用全局变量注入 API
   - 查阅 `SillyTavern/public/scripts/variables.js`
   - 参考 MVU/SAM 的实现

3. **方案 3**: 通过世界书词条动态注入(类似 SAM 的 `__SAM_base_data__`)
   - 创建特殊词条 `__vs_stat_data__`
   - 内容为 `{{getvar::vs_stat_data}}`

**需要调研**:

- 查看 `SillyTavern/public/scripts/` 中 `variables.js` 或类似文件
- 查看 MVU/SAM 如何注入变量(查看源码)
- 确认最佳方案

---

## 8. 实现计划

### 8.1 Phase 1: 核心架构(2-3 周)

#### 1.1 消息遍历与快照查找

- [ ] 实现 `findSnapshotAnchor(messageId)` - 向上查找最近的快照锚点
  - 输入: 消息层号
  - 输出: `{ anchorMessageId, snapshotId, snapshot }` 或 `null`(需要使用角色模板)
- [ ] 实现 `getAIMessageRange(startId, endId)` - 获取 AI 消息范围
  - 只返回 AI 消息,跳过用户消息
- [ ] 实现 `isAIMessage(message)` - 判断是否为 AI 消息
  - 检查 `message.is_user === false` 或 `message.role === 'assistant'`

#### 1.2 函数调用解析器

- [ ] 实现 `parseFunctionCalls(text, activeFunctions)` - 正则提取函数调用
  - 输入: AI 消息文本,启用的主动函数列表
  - 输出: `[{ functionId, functionName, args }, ...]`(按出现顺序)
- [ ] 实现 `extractArgs(match, pattern)` - 从正则匹配提取参数
  - 支持字符串、数字、JSON 对象
- [ ] 错误处理: 非法语法、缺失参数

#### 1.3 快照标识符管理

- [ ] 实现 `generateSnapshotId(chatFile, messageId, swipeId)` - 生成唯一标识符
- [ ] 实现 `getSnapshotId(message)` - 从消息获取当前 swipe 的标识符
  - 访问 `message.swipes_info[message.swipe_id || 0].st_var_system_snapshot_id`
- [ ] 实现 `setSnapshotId(message, snapshotId)` - 设置标识符
  - 写入 `message.swipes_info[message.swipe_id || 0].st_var_system_snapshot_id`
  - 调用 `saveChatConditional()` 持久化
- [ ] 实现 `saveMessageSnapshot(identifier, chatFile, messageId, payload)` - 调用插件 API
- [ ] 实现 `loadMessageSnapshot(identifier)` - 加载快照(带值查询)

### 8.2 Phase 2: 函数系统(2 周)

#### 2.1 函数注册表

- [ ] 定义 `VarFunction` 接口
- [ ] 实现 `FunctionRegistry` 类
  - `loadGlobalFunctions()` - 从 `extension_settings.st_var_system.functions` 加载
  - `loadLocalFunctions(characterId)` - 从角色卡加载
  - `saveGlobalFunctions(functions)` - 保存全局函数
  - `saveLocalFunctions(characterId, functions)` - 保存局域函数
  - `getEnabledFunctions(type)` - 获取启用的函数(按 type 过滤)
  - `getFunctionById(id)` - 根据 ID 查询函数

#### 2.2 内置函数实现

- [ ] `SET` - 使用 `lodash.set`
- [ ] `ADD` - 数值加法
- [ ] `SUB` - 数值减法
- [ ] `APPEND` - 数组追加
- [ ] `REMOVE` - 数组删除
- [ ] `ASSIGN` - 对象合并
- [ ] `UNSET` - 删除字段
- [ ] `TIME` - 时间更新

#### 2.3 函数执行引擎

- [ ] 实现 `executeFunction(functionDef, snapshot, args, context)` - 执行单个函数
  - 使用 `Function` 构造器执行 executor 代码
  - 提供沙箱上下文: `{ snapshot, args, context, _, ... }`
  - 捕获错误,返回 `{ success, snapshot, error }`
- [ ] 实现 `applyFunctionCalls(snapshot, functionCalls, context)` - 批量应用函数调用
  - 按顺序执行: 被动函数前 → 主动函数调用 → 被动函数后
  - 收集所有错误,最后统一通知用户
- [ ] 错误收集与通知
  - 使用 `toastr.warning()` 弹窗提示
  - 使用 `console.error()` 记录详细日志

### 8.3 Phase 3: 事件集成(1-2 周)

#### 3.1 事件监听

- [ ] 监听 `MESSAGE_RECEIVED` - AI 回复完成
  - 检查是否为 AI 消息(`!message.is_user`)
- [ ] 监听 `MESSAGE_SWIPED` - 切换 swipe
- [ ] 监听 `CHAT_CHANGED` - 加载新聊天(初始化)

#### 3.2 主流程实现

- [ ] 实现 `handleMessageUpdate(messageId)` - 核心处理流程
  - 检查 `st_var_system.enabled`
  - 查找快照锚点
  - 解析中间消息
  - 应用函数调用
  - 保存快照
  - 注入聊天变量
- [ ] 实现 `handleSwipeChanged(messageId)` - 切换 swipe 时重新处理

#### 3.3 聊天变量注入

- [ ] 调研 SillyTavern 的全局变量注入机制
- [ ] 实现 `injectChatVariables(snapshot)` - 注入 `{{vs_stat_data}}`

### 8.4 Phase 4: UI 实现 ✅ **已完成 (2025-10-21)**

#### 4.1 函数库管理界面（参照酒馆助手脚本库实现） ✅

- ✅ 实现函数列表
  - ✅ 支持拖拽排序（使用 jQuery UI sortable，参照酒馆助手实现）
  - ✅ 每个函数卡片显示：拖拽手柄、启用/禁用复选框、函数名、类型徽章、简短说明、编辑/删除按钮
- ✅ 实现函数编辑弹窗
  - ✅ 基础表单（函数名、类型、启用状态、说明）
  - ✅ 简单 textarea 输入 pattern 和 executor（无代码高亮，无正则测试）
  - ✅ 主动函数显示 pattern 输入框，被动函数显示 timing 选择
- ✅ 实现全局/局域切换
- ✅ 实现导入/导出功能（JSON 格式）
- ✅ 实现提示词生成器（弹窗显示 + 复制到剪贴板）

#### 4.2 楼层快照界面 ✅

- ✅ 实现楼层选择器
  - ✅ 下拉菜单支持滚动（几百上千层）
  - ✅ **只显示有标识符的楼层**（从聊天记录中筛选）
  - ✅ 格式：`第 X 层 - AI 消息 (Swipe Y)`
  - ✅ 默认选中最新有快照的楼层
- ✅ 实现直接跳转输入框
  - ✅ 输入层号，点击"跳转"按钮
  - ✅ 若该层无快照，提示错误
- ✅ 实现快照编辑器
  - ✅ 复用 `VariableBlockEditor`（与角色模板/全局快照相同）
  - ✅ 显示当前层信息（层号、swipe id、消息发送时间）
- ✅ 实现操作按钮
  - ✅ 保存快照（更新数据库，重新注入聊天变量）
  - ✅ 保存为全局快照（弹窗输入标签）
  - ✅ 导出 JSON / 导入 JSON（含 MVU 元数据移除选项）
- ✅ 实现刷新按钮（重新加载当前层快照）

#### 4.3 API 集成 ✅

- ✅ FunctionRegistry 集成（`upsert`/`delete`/`export`/`load` 方法）
- ✅ 持久化实现（`extension_settings` + 角色卡 `writeExtensionField`）
- ✅ 插件 API 调用（`GET /snapshots/:id`, `PUT /snapshots/:id`）
- ✅ 主模块集成（`bindFunctionsSection`, `bindMessagesSection`）

**详细文档**: 见 `PHASE4-COMPLETION.md`

#### 4.4 设置界面 ✅ **已完成 (2025-10-21)**

- ✅ 实现"清理未使用的快照"功能
  - ✅ 前端：设置标签页 HTML + JavaScript
  - ✅ 后端：插件清理接口 `POST /snapshots/cleanup`
  - ✅ 清理逻辑：扫描所有聊天记录文件，删除孤立快照（chatFile 级别）
- [ ] 实现"重新处理变量"按钮（考虑集成位置）

### 8.5 Phase 5: 测试与优化(1-2 周)

- [ ] 单元测试: 函数执行、解析器、快照查找
- [ ] 集成测试: 完整流程(模拟 AI 回复)
- [ ] 性能优化: 大量消息时的查找效率
- [ ] 错误处理: 非法函数调用、网络错误
- [ ] 文档完善: 用户指南、开发者文档

---

## 9. 待调研问题

### 9.1 聊天变量注入 API

**问题**: 如何将快照注入到 SillyTavern 的全局变量系统中?

**需要查阅**:

- `SillyTavern/public/scripts/variables.js` 或类似文件
- MVU/SAM 如何注入变量(查看源码)

### 9.2 开场白处理

**问题**: 开场白(first_mes)是如何生成的?是否触发 `MESSAGE_RECEIVED` 事件?

**需要测试**:

1. 新建聊天时,开场白是否触发事件
2. 开场白的 `message_id` 是多少(通常是 0)
3. 是否需要为开场白绑定初始快照(角色模板)

### 9.3 删除消息时获取标识符

**问题**: 删除消息时,是否可以获取被删除的 swipe 的唯一标识符?

**需要调研**:

- SillyTavern 的消息删除 API
- 是否有删除前的钩子(hook)或事件

---

## 10. 兼容性考虑

### 10.1 与 MVU 互操作

- MVU 使用 `chat[messageId].variables` 或全局变量存储 `mvu_data`
- 我们使用 `{{vs_stat_data}}`,避免冲突
- 可以同时运行,互不干扰

### 10.2 与 SAM 互操作

- SAM 使用全局状态对象(不绑定到消息)
- 可以同时运行,但需要避免函数名冲突
- 考虑函数命名空间: `@.var.SET()` vs `@.sam.SET()`(可选)

### 10.3 与记忆增强互操作

- 记忆增强使用独立的数据表(Chat Sheets)
- 不冲突,可以集成(将记忆数据作为变量的一部分,未来功能)

---

## 11. 文件结构规划

```
ST-VarSystemExtension/
  src/
    snapshots/
      messageSnapshot.js        // 消息快照管理
      snapshotResolver.js       // 快照查找与解析
      variableInjector.js       // 聊天变量注入
    functions/
      registry.js               // 函数注册表
      builtinFunctions.js       // 内置函数实现
      executor.js               // 函数执行引擎
      parser.js                 // 函数调用解析器
    ui/
      functionManager.js        // 函数库管理界面
      snapshotViewer.js         // 楼层快照界面
      promptGenerator.js        // 提示词生成器
      settingsPanel.js          // 设置界面
    utils/
      mvuImporter.js            // MVU 元数据移除工具
  docs/
    MESSAGE-SNAPSHOT-DESIGN.md  // 本文档
    FUNCTION-REFERENCE.md       // 函数使用手册(未来)
    USER-GUIDE.md               // 用户指南(未来)
```

---

## 12. 风险与挑战

### 12.1 性能问题

- **挑战**: 大量消息时,向上查找锚点可能很慢
- **缓解**:
  - 缓存最近的锚点位置
  - 限制查找范围(如最多向上 100 条消息)
  - 建议用户定期"提交"快照(手动保存)

### 12.2 AI 输出不稳定

- **挑战**: AI 可能输出格式错误的函数调用
- **缓解**:
  - 宽松的正则表达式(容忍空格、换行)
  - 错误提示(记录到控制台,不中断流程)
  - 提示词优化(提供明确的示例)

### 12.3 函数安全性

- **挑战**: 自定义函数可能包含恶意代码
- **缓解**:
  - 函数本质是操作变量块的规则,风险可控
  - 不提供网络请求、文件访问等危险 API
  - 使用 `Function` 构造器执行,限制上下文

### 12.4 与其他系统冲突

- **挑战**: MVU/SAM/记忆增强可能同时使用
- **缓解**:
  - 使用独立的变量命名空间(`{{vs_stat_data}}`)
  - 检测冲突并提示用户
  - 提供兼容模式配置

---

## 13. 已确认的设计决策

### ✅ 函数调用格式

- **决策**: 使用 `@.FUNCTION()` 格式(参考 SAM)
- **理由**: 简单、明确,易于 AI 理解和生成

### ✅ 开场白快照

- **决策**: 自动解析开场白中的函数调用
- **流程**: 角色模板 + 开场白函数调用 → 生成消息 0 的快照

### ✅ Swipe 快照策略

- **决策**: 每个 swipe 独立快照标识符
- **存储**: 使用 `message.swipes_info[swipe_id].st_var_system_snapshot_id`

### ✅ Schema 分离

- **决策**: **不实现** MVU 的 `$meta` schema 分离机制
- **理由**: 校验可以在函数执行时处理,无需在变量结构中设置类型保护

### ✅ 插件依赖

- **决策**: 楼层快照**强制依赖插件**(数据库存储)
- **理由**: 快照必须存储在数据库中,扩展独立运行只支持角色模板功能

### ✅ 自定义函数安全性

- **决策**: 函数本质是操作变量块的规则,无严重安全风险
- **实现**: 支持自定义 JavaScript 函数,不需要严格沙箱限制

---

## 14. 下一步行动

1. **补充调研**:
   - 聊天变量注入 API(查看 `SillyTavern/public/scripts/variables.js`)
   - 开场白事件处理(测试 `MESSAGE_RECEIVED` 触发时机)
   - 删除消息时获取标识符(查看消息删除相关代码)

2. **开始实现 Phase 1**:
   - 消息遍历与快照查找
   - 函数调用解析器
   - 快照标识符管理

3. **创建开发任务清单**:
   - 使用 `manage_todo_list` 拆解开发任务
   - 按 Phase 逐步实现

---

**文档结束**
