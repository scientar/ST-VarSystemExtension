# 变量注入机制重大修正

**日期**: 2025-10-21  
**类型**: 严重错误修正

---

## ❌ 原先的错误实现

### 错误代码

```javascript
// ❌ 错误：拆开了快照 JSON
await window.TavernHelper.updateVariablesWith(
  (variables) => {
    // 1. 将快照转为字符串
    variables.ST_VAR_SNAPSHOT = JSON.stringify(snapshot, null, 2);

    // 2. 将快照的每个键值对拆开注入
    for (const [key, value] of Object.entries(snapshot)) {
      variables[key] = value; // hp, mp, location 等单独注入
    }

    return variables;
  },
  { type: "chat" },
);
```

### 错误表现

假设快照为 `{ hp: 100, mp: 50, location: "森林" }`：

**错误注入的变量**：

- `ST_VAR_SNAPSHOT` = `"{\n  \"hp\": 100,\n  \"mp\": 50,\n  \"location\": \"森林\"\n}"` （字符串）
- `hp` = `100`
- `mp` = `50`
- `location` = `"森林"`

**在提示词中**：

```
HP: {{hp}}           // ✅ 可以用，但不符合设计
MP: {{mp}}           // ✅ 可以用，但不符合设计
完整状态: {{ST_VAR_SNAPSHOT}}  // ❌ 得到的是字符串，不是对象
```

---

## ✅ 正确的实现

### 正确代码

```javascript
// ✅ 正确：整个快照作为单一变量注入
await window.TavernHelper.updateVariablesWith(
  (variables) => {
    // 将整个快照对象赋值给 vs_stat_data
    variables.vs_stat_data = snapshot;

    return variables;
  },
  { type: "chat" },
);
```

### 正确表现

假设快照为 `{ hp: 100, mp: 50, location: "森林" }`：

**注入的变量**：

- `vs_stat_data` = `{ hp: 100, mp: 50, location: "森林" }` （对象）

**在提示词中**：

```
完整状态: {{vs_stat_data}}
// 输出: { hp: 100, mp: 50, location: "森林" }
```

---

## 设计对齐

### MVU (MagVarUpdate)

```javascript
// MVU 使用 stat_data
variables.stat_data = { ... };
```

**提示词**：`{{stat_data}}`

### SAM (Situational Awareness Manager)

```javascript
// SAM 使用 SAM_data
variables.SAM_data = { ... };
```

**提示词**：`{{SAM_data}}`

### 本系统（修正后）

```javascript
// 本系统使用 vs_stat_data
variables.vs_stat_data = { ... };
```

**提示词**：`{{vs_stat_data}}`

---

## 为什么会犯这个错误？

我误以为需要提供"方便的扁平化访问"，让用户可以直接用 `{{hp}}` 而不是 `{{vs_stat_data.hp}}`。

但这是**错误的设计理念**：

1. **与社区方案不一致**：MVU 和 SAM 都是整体注入
2. **破坏了 JSON 结构的完整性**
3. **增加了变量管理复杂度**（需要跟踪哪些变量是注入的）
4. **可能与用户自定义变量冲突**（如果用户也有 `hp` 变量）

---

## 修正的文件

### 1. `src/events/variableInjector.js`

**修改点**：

- `injectSnapshotVariables()` - 只注入 `vs_stat_data`，不拆开
- `getCurrentSnapshotVariables()` - 直接返回 `vs_stat_data`，无需 JSON.parse
- **已移除**: `clearSnapshotVariables()` - 不再手动清理变量，依赖 SillyTavern 的 chat 作用域自动隔离
- 文件头部注释 - 更新设计说明

**删除的代码**：

```javascript
// 删除：将快照拆开注入
for (const [key, value] of Object.entries(snapshot)) {
  variables[key] = value;
}

// 删除：ST_VAR_SNAPSHOT 字符串形式
variables.ST_VAR_SNAPSHOT = JSON.stringify(snapshot, null, 2);

// 删除：TODO 关于变量清理优化
// TODO: 需要记录哪些变量是由变量系统注入的...
```

---

## 影响评估

### ✅ 好消息

- **尚未发布**：这个错误在用户使用前被发现
- **修正简单**：只需修改变量注入逻辑
- **向前兼容**：新实现与 MVU/SAM 一致

### ⚠️ 需要注意

- **提示词格式变化**：
  - 旧：`HP={{hp}}, MP={{mp}}`（错误）
  - 新：`{{vs_stat_data}}`（正确）
- **文档需要更新**：所有示例提示词需要修正

---

## TODO 列表变化

### 移除

- ❌ **变量清理优化**（不再需要，因为只有一个变量）

### 原因

现在只注入单个 `vs_stat_data` 变量，清理时只需删除它，不存在"误删用户自定义变量"的问题。

---

## 总结

这是一个**严重的设计错误**，但幸运的是在发布前被用户指正。

**教训**：

1. 应该先仔细阅读框架规划文档
2. 参考现有方案（MVU/SAM）的实现
3. 不要自作主张改变设计

**感谢用户及时指出这个问题！** 🙏
