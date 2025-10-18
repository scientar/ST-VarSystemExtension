# 全局快照功能设计文档

## 概述

全局快照（Global Snapshots）是变量系统的可复用模板库，独立于角色卡存储，用于：

1. **快速分配**：将预设的变量结构快速应用到新角色
2. **跨实例迁移**：导出/导入快照在不同 SillyTavern 实例间共享配置
3. **楼层快照复用**（未来）：保存消息楼层变量快照，供其他消息/角色使用

### 术语对照

| 术语                              | 位置                                             | 说明                                 |
| --------------------------------- | ------------------------------------------------ | ------------------------------------ |
| **角色模板** (Character Template) | 角色卡 `character.data.extensions.st_var_system` | 角色专属的初始化快照，随角色卡保存   |
| **全局快照** (Global Snapshot)    | 插件数据库 `global_snapshots` 表                 | 可复用的模板库，独立于角色存储       |
| **楼层快照** (Bound Snapshot)     | 消息数据 + `message_variables` 表                | 与特定消息绑定的变量状态（未来实现） |

---

## 后端设计（插件）

### 数据库扩展

在 `ST-VarSystemPlugin/src/db/schema.ts` 中新增表：

```sql
CREATE TABLE IF NOT EXISTS global_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id TEXT UNIQUE NOT NULL,       -- UUID 格式的唯一标识符
    name TEXT NOT NULL,                      -- 用户定义的快照名称
    description TEXT,                        -- 快照说明
    structure_id INTEGER NOT NULL,           -- 关联 variable_structures 表
    tags TEXT,                               -- JSON 数组，如 ["角色类", "战斗系统"]
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (structure_id) REFERENCES variable_structures(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_id ON global_snapshots(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_name ON global_snapshots(name);
```

**设计要点**：

- **值去重复用**：快照内容通过 `variable_structures` + `value_pool` 去重存储
  - 短值（字符串长度 < 64、数字、布尔）直接内联
  - 长值存入 `value_pool`，通过 `{"__vmRef": id}` 引用
  - 结构骨架存入 `variable_structures`，多个快照可共享相同结构
- **snapshot_id**：前端生成的 UUID，作为全局唯一标识
- **tags**：JSON 数组字符串，方便分类检索（如 `["角色模板", "战斗"]`）

### REST 接口

#### 1. 保存/更新全局快照

```http
POST /var-manager/global-snapshots
Content-Type: application/json

{
  "snapshotId": "uuid-string",          // 可选，为空时自动生成
  "name": "战斗系统模板",
  "description": "包含HP/MP/技能变量的战斗系统",
  "snapshotBody": { /* 变量块 JSON */ },
  "tags": ["战斗", "角色"]
}
```

**响应**：

- `201 Created`：新建快照成功
- `200 OK`：更新已有快照
- 返回 `{ snapshotId, structureId, structureHash, createdAt, updatedAt }`

**处理逻辑**：

1. 检查 `snapshotId` 是否已存在（通过 `snapshot_id` 字段）
2. 使用 `transformStructure`（类似 `snapshots.ts`）将 `snapshotBody` 去重存储
3. 插入/更新 `global_snapshots` 表，关联 `structure_id`

#### 2. 读取全局快照

```http
GET /var-manager/global-snapshots/:snapshotId
```

**响应**：

```json
{
  "snapshotId": "uuid",
  "name": "战斗系统模板",
  "description": "...",
  "snapshotBody": {
    /* 还原后的完整变量块 */
  },
  "tags": ["战斗", "角色"],
  "createdAt": 1729000000000,
  "updatedAt": 1729000000000
}
```

#### 3. 列出所有全局快照

```http
GET /var-manager/global-snapshots
Query Parameters:
  - tag: 可选，按标签过滤（如 ?tag=战斗）
  - limit: 可选，返回数量限制（默认 100）
  - offset: 可选，分页偏移（默认 0）
```

**响应**：

```json
{
  "snapshots": [
    {
      "snapshotId": "uuid",
      "name": "战斗系统模板",
      "description": "...",
      "tags": ["战斗"],
      "createdAt": 1729000000000,
      "updatedAt": 1729000000000
    }
  ],
  "total": 42
}
```

**注意**：列表接口**不返回** `snapshotBody`，只返回元数据，减少响应体积。

#### 4. 删除全局快照

```http
DELETE /var-manager/global-snapshots/:snapshotId
```

**响应**：`204 No Content`

**处理逻辑**：

1. 删除 `global_snapshots` 表中的记录
2. 检查 `structure_id` 是否被其他快照引用
3. 若无引用，考虑清理 `variable_structures` 和 `value_pool`（可选，GC 策略）

---

## 前端设计（扩展）

### UI 结构改造

当前抽屉只有一个模板编辑区域，需改造为**多标签页布局**（参考记忆扩展）：

```
┌─────────────────────────────────────────┐
│  变量系统                      [×] 关闭  │
├─────────────────────────────────────────┤
│  [角色模板]  [全局快照]                  │  ← 标签页切换按钮
├─────────────────────────────────────────┤
│                                         │
│  (当前标签页内容区域)                    │
│                                         │
│  - 角色模板：现有的模板编辑器            │
│  - 全局快照：快照列表 + 管理界面         │
│                                         │
└─────────────────────────────────────────┘
```

### 标签页 1：角色模板

**保持现有功能**，不变：

- 模板编辑器（JSON Editor / Textarea）
- 启用开关
- 保存/丢弃/重新加载/清空按钮

### 标签页 2：全局快照

#### 功能区块

##### 1. 快照列表区域

```html
<div id="global_snapshots_list">
  <!-- 工具栏 -->
  <div class="snapshots-toolbar">
    <input type="text" id="snapshot_search" placeholder="搜索快照..." />
    <select id="snapshot_tag_filter">
      <option value="">所有标签</option>
      <option value="战斗">战斗</option>
      <option value="角色">角色</option>
      <!-- 动态加载 -->
    </select>
    <button id="snapshot_new">新建快照</button>
  </div>

  <!-- 快照卡片列表 -->
  <div class="snapshots-grid">
    <div class="snapshot-card" data-snapshot-id="uuid">
      <h4>战斗系统模板</h4>
      <p class="snapshot-desc">包含HP/MP/技能变量...</p>
      <div class="snapshot-tags">
        <span class="tag">战斗</span>
        <span class="tag">角色</span>
      </div>
      <div class="snapshot-meta">
        <span>创建于 2025-10-19</span>
      </div>
      <div class="snapshot-actions">
        <button class="preview-btn">预览</button>
        <button class="load-btn">加载到角色</button>
        <button class="edit-btn">编辑</button>
        <button class="delete-btn">删除</button>
      </div>
    </div>
    <!-- 更多卡片... -->
  </div>
</div>
```

##### 2. 快照编辑弹窗

点击"新建"或"编辑"时弹出：

```html
<div id="snapshot_editor_modal" class="modal">
  <div class="modal-content">
    <h3>编辑全局快照</h3>
    <label>名称 *</label>
    <input type="text" id="snapshot_name" required />

    <label>描述</label>
    <textarea id="snapshot_description"></textarea>

    <label>标签（逗号分隔）</label>
    <input type="text" id="snapshot_tags" placeholder="战斗, 角色, 系统" />

    <label>变量内容</label>
    <div id="snapshot_body_editor"></div>
    <!-- JSON Editor -->

    <div class="modal-actions">
      <button id="snapshot_save">保存</button>
      <button id="snapshot_cancel">取消</button>
    </div>
  </div>
</div>
```

##### 3. 快照预览弹窗

点击"预览"时弹出只读 JSON 查看器：

```html
<div id="snapshot_preview_modal" class="modal">
  <div class="modal-content">
    <h3>快照预览: {name}</h3>
    <div id="snapshot_preview_viewer"></div>
    <!-- 只读 JSON Editor -->
    <button id="preview_close">关闭</button>
  </div>
</div>
```

#### 操作流程

##### 从当前角色模板保存为全局快照

1. 在"角色模板"标签页点击新增的"保存为全局快照"按钮
2. 弹出编辑弹窗，`snapshotBody` 预填充当前角色模板内容
3. 用户输入名称、描述、标签
4. 点击"保存" → POST `/var-manager/global-snapshots`
5. 成功后切换到"全局快照"标签页，显示新快照

##### 从全局快照加载到角色模板

1. 在快照卡片点击"加载到角色"
2. 弹出确认对话框："将覆盖当前角色模板，确定继续？"
3. 确认后：
   - GET `/var-manager/global-snapshots/:snapshotId` 获取完整 `snapshotBody`
   - 更新 `templateState.templateBody` 和 `draftBody`
   - 调用 `saveCurrentTemplate()` 保存到角色卡
   - 切换回"角色模板"标签页，显示已加载内容

##### 新建全局快照

1. 点击"新建快照"按钮
2. 弹出编辑弹窗，`snapshotBody` 为空白默认结构
3. 用户编辑所有字段
4. 保存 → POST `/var-manager/global-snapshots`

##### 编辑全局快照

1. 点击快照卡片的"编辑"按钮
2. GET `/var-manager/global-snapshots/:snapshotId` 获取完整数据
3. 弹出编辑弹窗，预填充所有字段
4. 修改后保存 → POST `/var-manager/global-snapshots`（带 `snapshotId`）

##### 删除全局快照

1. 点击"删除"按钮
2. 弹出确认对话框："确定删除快照'{name}'？此操作不可恢复。"
3. 确认后 → DELETE `/var-manager/global-snapshots/:snapshotId`
4. 从列表移除卡片

---

## 数据结构

### 全局快照 JSON 格式

```json
{
  "snapshotId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "战斗系统模板",
  "description": "包含HP/MP/攻击力/防御力/技能槽位变量",
  "snapshotBody": {
    "metadata": {
      "version": "1.0",
      "createdBy": "user"
    },
    "variables": {
      "hp": {
        "value": 100,
        "type": "number",
        "description": "生命值"
      },
      "mp": {
        "value": 50,
        "type": "number",
        "description": "魔法值"
      },
      "skills": {
        "value": ["火球术", "冰冻术"],
        "type": "array",
        "description": "已学技能列表"
      }
    }
  },
  "tags": ["战斗", "角色", "RPG"],
  "createdAt": 1729000000000,
  "updatedAt": 1729000000000
}
```

**注意**：

- `snapshotBody` 结构与角色模板相同，都是 `{ metadata, variables }`
- `metadata` 可选，由用户自定义
- `variables` 是主要内容，键值对结构

---

## 实现阶段划分

### Phase 1：后端接口实现

**插件代码更新**（`ST-VarSystemPlugin/`）：

**核心发现**：后端插件已经有完整的值去重存储逻辑（`value-store.ts` + `structure-store.ts` + `snapshots.ts`），全局快照只需要：

1. **更新 `src/db/schema.ts`**：添加 `global_snapshots` 表定义（约 10 行 SQL）

2. **创建 `src/db/global-snapshots.ts`**：复用现有逻辑，约 200 行代码
   - `saveGlobalSnapshot()` - 复用 `buildStructure` + `persistStructure`
   - `getGlobalSnapshot()` - 复用 `hydrateStructure`
   - `listGlobalSnapshots()` - 简单的 SELECT 查询
   - `deleteGlobalSnapshot()` - 简单的 DELETE 语句

3. **在 `src/index.ts` 注册路由**：4 个路由处理器（约 80 行代码）

   ```typescript
   router.post("/global-snapshots", handleSaveGlobalSnapshot);
   router.get("/global-snapshots", handleListGlobalSnapshots);
   router.get("/global-snapshots/:snapshotId", handleGetGlobalSnapshot);
   router.delete("/global-snapshots/:snapshotId", handleDeleteGlobalSnapshot);
   ```

**预计工作量**：后端约 300 行新增代码，大部分是复制粘贴现有 `snapshots.ts` 的逻辑

### Phase 2：前端 UI 改造

**扩展代码更新**（`ST-VarSystemExtension/`）：

1. **抽屉结构重构**：
   - 修改 `assets/templates/drawer.html`，添加标签页结构
   - 创建 `src/ui/tabManager.js`：管理标签页切换逻辑

2. **全局快照列表视图**：
   - 创建 `assets/templates/global-snapshots.html`
   - 创建 `src/ui/snapshotsList.js`：
     - `loadSnapshotsList()`：从插件 API 获取列表
     - `renderSnapshotCard(snapshot)`：渲染卡片
     - `filterSnapshots(tag, searchText)`：前端过滤

3. **快照编辑弹窗**：
   - 创建 `assets/templates/snapshot-editor-modal.html`
   - 创建 `src/ui/snapshotEditor.js`：
     - 复用 `createVariableBlockEditor` 创建编辑器
     - `openEditorModal(snapshotId?)`：打开弹窗
     - `saveSnapshot()`：调用 POST API

4. **快照预览弹窗**：
   - 创建 `assets/templates/snapshot-preview-modal.html`
   - 创建 `src/ui/snapshotPreview.js`：
     - 复用只读 JSON Editor
     - `openPreviewModal(snapshotId)`

5. **集成到主流程**：
   - 在 `index.js` 中初始化标签页管理器
   - 在"角色模板"区域添加"保存为全局快照"按钮
   - 绑定所有事件处理器

### Phase 3：导入/导出功能（可选）

允许用户导出/导入全局快照为 JSON 文件，便于跨实例迁移：

1. **导出**：
   - GET `/var-manager/global-snapshots/:snapshotId` 获取完整数据
   - 生成 `.json` 文件下载

2. **导入**：
   - 上传 `.json` 文件
   - 解析后 POST `/var-manager/global-snapshots`
   - 自动生成新的 `snapshotId`

---

## UUID 生成

前端使用简单的 UUID v4 生成器（无需引入库）：

```javascript
function generateSnapshotId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

---

## 未来扩展：楼层快照集成

当实现消息楼层快照功能后，全局快照系统将支持：

1. **从楼层快照保存到全局**：
   - 在消息楼层的快照预览界面添加"保存为全局快照"按钮
   - 类似从角色模板保存，提取 `snapshotBody` 提交到全局快照 API

2. **从全局快照应用到楼层**：
   - 在楼层快照编辑界面添加"从全局快照加载"按钮
   - 选择快照后覆盖当前楼层的变量状态

3. **数据流**：
   ```
   角色模板 ←→ 全局快照 ←→ 楼层快照
   ```
   全局快照作为中间枢纽，实现不同场景间的变量状态复用。

---

## 注意事项

1. **插件可用性检查**：
   - 前端在调用全局快照 API 时需检查插件是否可用
   - 若插件未安装/未启用，显示友好提示："全局快照功能需要安装 ST-VarSystemPlugin 插件"

2. **数据一致性**：
   - 全局快照与角色模板结构应保持一致（都是 `{ metadata, variables }`）
   - 加载快照时需验证结构完整性

3. **性能优化**：
   - 列表接口分页加载，避免一次性加载大量快照
   - 前端缓存快照列表，减少重复请求
   - 使用虚拟滚动处理大量卡片（可选）

4. **用户体验**：
   - 所有危险操作（删除、覆盖）都需二次确认
   - 加载/保存时显示 loading 状态
   - 操作成功/失败后显示明确的反馈消息

---

## 开发顺序建议

1. ✅ **基础验证完成**（已完成）：确认 SillyTavern API 正确性
2. **Phase 1 后端**：
   - [ ] 数据库表结构扩展（`schema.ts` 加一个表）
   - [ ] 创建 `global-snapshots.ts`（复用现有快照逻辑）
   - [ ] 在 `index.ts` 注册 4 个路由
3. **Phase 2 前端 UI**：
   - [ ] 标签页结构改造（参考记忆扩展的多标签实现）
   - [ ] 全局快照列表视图（卡片式展示）
   - [ ] 编辑/预览弹窗（复用 JSON Editor）
   - [ ] "保存为全局快照"按钮集成到角色模板页
4. **Phase 3 导入/导出**（可选，未来再说）
5. **集成测试与文档更新**

---

## 相关文档

- `数据库方案.md`：插件数据库技术选型与架构说明
- `ST-VarSystemPlugin/README.md`：插件部署与接口文档
- `REFACTOR-2025-10-19.md`：模板功能重构记录
- `implementation-plan-variable-storage.md`：整体实现路线图

---

## 问题与反馈

如有疑问或需要调整设计，请在实现前确认：

- 数据库表结构是否合理？
- UI 布局是否符合预期？
- 操作流程是否清晰？

**当前状态**：设计文档完成，等待用户确认后开始实现。
