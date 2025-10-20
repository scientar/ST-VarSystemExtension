/**
 * 函数系统测试 - 验证注册表、解析和执行
 */

import { initBuiltinFunctions } from "../src/functions/builtins.js";
import { functionExecutor } from "../src/functions/executor.js";
import { functionRegistry } from "../src/functions/registry.js";

// 模拟 lodash（假设全局已加载）
window._ = {
  get: (obj, path, defaultValue) => {
    const keys = path.split(".");
    let result = obj;
    for (const key of keys) {
      if (result && typeof result === "object" && key in result) {
        result = result[key];
      } else {
        return defaultValue;
      }
    }
    return result;
  },
  set: (obj, path, value) => {
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
    return obj;
  },
  unset: (obj, path) => {
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) return;
      current = current[keys[i]];
    }
    delete current[keys[keys.length - 1]];
  },
};

console.log("========== 函数系统测试 ==========\n");

// 1. 初始化内置函数
console.log("1. 初始化内置函数");
initBuiltinFunctions(functionRegistry);
console.log("✓ 内置函数已加载\n");

// 2. 测试函数解析
console.log("2. 测试函数调用解析");
const testMessage = `
好的，我来更新你的状态。
@.SET("角色.名字", "张三");
你的名字现在是张三了。
@.ADD("角色.金币", 100);
获得了 100 金币！
@.APPEND("背包.物品", "治疗药水");
背包中增加了治疗药水。
`;

const parsedCalls = functionRegistry.parseFunctionCalls(testMessage);
console.log("解析到的函数调用:", parsedCalls.length);
for (const call of parsedCalls) {
  console.log(`  - ${call.functionDef.name}(${call.args.join(", ")})`);
}
console.log("✓ 解析成功\n");

// 3. 测试函数执行
console.log("3. 测试函数执行");

// 初始快照
const initialSnapshot = {
  角色: {
    名字: "匿名",
    金币: 50,
    生命值: 100,
  },
  背包: {
    物品: ["木剑", "面包"],
  },
};

console.log("初始快照:", JSON.stringify(initialSnapshot, null, 2));

// 获取被动函数（测试中没有）
const passiveFunctions = functionRegistry.getPassiveFunctions();

// 执行函数流程
const context = {
  messageId: 0,
  messageContent: testMessage,
  characterName: "测试角色",
  chatFile: "test.jsonl",
  timestamp: Date.now(),
};

const result = functionExecutor.executeAll(
  initialSnapshot,
  parsedCalls,
  passiveFunctions,
  context,
);

console.log("\n最终快照:", JSON.stringify(result.snapshot, null, 2));

if (result.errors.length > 0) {
  console.log("\n执行错误:");
  for (const err of result.errors) {
    console.log(`  - ${err.functionName}: ${err.error}`);
  }
} else {
  console.log("\n✓ 所有函数执行成功");
}

// 4. 验证结果
console.log("\n4. 验证结果");
const checks = [
  {
    name: "名字更新",
    pass: result.snapshot.角色.名字 === "张三",
  },
  {
    name: "金币增加",
    pass: result.snapshot.角色.金币 === 150,
  },
  {
    name: "物品追加",
    pass:
      result.snapshot.背包.物品.length === 3 &&
      result.snapshot.背包.物品[2] === "治疗药水",
  },
];

let allPassed = true;
for (const check of checks) {
  const status = check.pass ? "✓" : "✗";
  console.log(`  ${status} ${check.name}`);
  if (!check.pass) allPassed = false;
}

console.log("\n========== 测试", allPassed ? "通过" : "失败", "==========");
