import test from "node:test";
import assert from "node:assert/strict";
import { parseRawTemplate } from "../src/template/parser.js";
import { serializeTemplateModel } from "../src/template/serializer.js";

const SAMPLE_TEMPLATE = {
  metadata: {
    name: "测试角色",
    createdAt: "2024-10-26T12:00:00.000Z",
  },
  variables: {
    $meta: {
      extensible: true,
      required: ["世界", "{{user}}", "神将", "封神之战", "新闻"],
    },
    世界: {
      $meta: {
        extensible: false,
      },
      时间: [
        "2024年10月26日 20:00",
        "记录当前的游戏内时间。根据剧情发展进行更新。",
      ],
      地点: ["魔都", "记录角色当前所处的主要地理位置。根据剧情移动而更新。"],
    },
    "{{user}}": {
      $meta: {
        extensible: false,
        required: ["外貌", "符节", "宏愿", "背包"],
      },
      外貌: [
        {
          $meta: {
            extensible: true,
          },
          详细外貌: "未设定",
        },
        "契主的外貌描述。",
      ],
      符节: [
        {
          $meta: {
            extensible: false,
          },
          剩余次数: 3,
        },
        "记录契主绝对命令权的剩余次数。",
      ],
      宏愿: ["", "记录契主参加封神之战的核心愿望。"],
      背包: [["$__META_EXTENSIBLE__$"], "契主的持有物品列表。"],
    },
    神将: {
      $meta: {
        extensible: false,
      },
      姓名: ["未召唤", "格式为 [仙将真名] ([根脚])。"],
      外貌描写: [
        {
          $meta: {
            extensible: false,
          },
          法身印象: "",
          体态样貌: "",
          发式鬓色: "",
          眼眸神光: "",
          异象特征: "",
        },
        "神将的法身外貌。",
      ],
      镇洞法宝: [["$__META_EXTENSIBLE__$"], "神将持有的法宝列表。"],
    },
    封神之战: {
      $meta: {
        extensible: false,
      },
      已淘汰契主: [["$__META_EXTENSIBLE__$"], "记录淘汰的契主姓名。"],
      持有碎片: [1, "记录持有碎片数量。"],
    },
    新闻: [
      [
        "东方明珠塔宣布进行景观照明系统升级。",
        "华亭集团股价午后异常波动。",
        "古生物学家发现恐龙足迹化石群。",
        "新晋流量偶像‘宸’的粉丝会门票售罄。",
        "气象部门发布新一轮强对流预警。",
      ],
      "每日更新的五条新闻。",
    ],
  },
};

test("MVU 模板解析与序列化往返一致", () => {
  const parsed = parseRawTemplate(SAMPLE_TEMPLATE);
  const roundTripped = serializeTemplateModel(parsed);
  assert.deepStrictEqual(roundTripped, SAMPLE_TEMPLATE);
});
