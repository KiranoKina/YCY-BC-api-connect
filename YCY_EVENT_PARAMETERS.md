# YCY 与 Bondage Club 事件参数说明

本文档说明当前 userscript 如何把 Bondage Club 游戏事件转换成役次元 YCY/YOKONEX 的 `game_cmd` 指令。

## 协议来源

参考 YCY-YOKONEX 开源文档中的 Tencent IM 控制协议：

- IM 消息内容放在腾讯 IM 文本消息的 `payload.text` 中。
- 新的开发游戏指令使用 `code: "game_cmd"`。
- `id` 是在役次元 App 内配置的指令 ID。
- `token` 来自玩家连接码，连接码格式为 `UID Token`。
- 电击器可选参数包括 `payload.reset_strength` 与 `payload.waveform`。

## 玩家最少操作

```text
/ycy link 玩家连接码或完整链接
/ycy map shock App内电击指令ID 波形名称
/ycy on
/ycy login
```

如果游戏是从役次元 App 启动，并且网址中带有 `connect_code`，脚本会自动读取。玩家也可以手动使用：

```text
/ycy load
```

二次授权已经取消。现在只需要 `/ycy on` 启用联动，不再需要 `/ycy consent on`。

## 事件到 App 指令的映射

默认指令 ID 如下，可以在游戏内修改：

| BC 事件 | 默认指令 ID | 修改指令 |
| --- | --- | --- |
| 被打、拍打、鞭打、踢等 | `ycy_bc_hit` | `/ycy map hit 指令ID [波形]` |
| 被电击、震击、电刺激等 | `ycy_bc_shock` | `/ycy map shock 指令ID [波形]` |
| 被触摸、抚摸、亲吻、舔等 | `ycy_bc_touch` | `/ycy map touch 指令ID [波形]` |
| 身上玩具穿戴、移除、替换、震动、充气等 | `ycy_bc_toy_sync` | `/ycy map toy 指令ID [波形]` |
| 紧急停止 | `_stop_all` | 固定全局指令 |

如果 App 内已经创建了不同名称的指令 ID，例如 `bc_shock_high`，就执行：

```text
/ycy map shock bc_shock_high
```

如果需要绑定 App 内置波形：

```text
/ycy map shock bc_shock_high 电击波形名
/ycy waveform shock 电击波形名
```

取消某类事件的波形覆盖：

```text
/ycy waveform shock off
```

## 发送到 IM 的基础格式

```json
{
  "code": "game_cmd",
  "id": "App内配置的指令ID",
  "token": "玩家Token",
  "payload": {
    "event": "shock",
    "source": "Activity",
    "waveform": "可选波形名"
  }
}
```

`payload.waveform` 只有在玩家通过 `/ycy map` 或 `/ycy waveform` 设置后才会发送；未设置时由 App 的指令配置决定。

## 通用 payload 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `event` | string | 当前脚本归类后的事件：`hit`、`shock`、`touch`、`toySync` |
| `source` | string | 事件来源，例如 `Activity`、`ChatRoomMessage`、`PropertyShockPublishAction` |
| `type` | string | 文字消息识别出的事件类型，常见为 `hit`、`shock`、`touch` |
| `target` | string | 事件方向，`self` 表示玩家被作用，`other` 表示玩家作用别人 |
| `assetGroupName` | string | BC 身体部位或物品栏位，例如 `ItemVulva`、`ItemNipples`、`ItemPelvis` |
| `actionName` | string | BC 原始动作名，例如 `Spank`、`Caress`、`TriggerShock1` |
| `displayActionName` | string | 脚本生成的可读动作名，例如 `ShockMed` |
| `assetName` | string | 参与动作的道具或玩具名 |
| `strength` | number | 简单文字触发时使用的基础强度标记 |
| `intensity` | number | 归一化强度，范围 `0` 到 `1` |
| `intensityPercent` | number | 百分比强度，范围 `0` 到 `100` |
| `waveform` | string | App 内置波形名称，可选 |
| `reset_strength` | boolean | 为 `true` 时请求 App 重置该指令的强度递增 |
| `time` | number | 触发时间戳，仅部分文字事件携带 |
| `player` | number | 当前玩家的 BC MemberNumber，仅部分文字事件携带 |

## 被打事件

触发来源：

- `Activity` 消息中的 `Spank`、`SpankItem`、`Slap`、`Kick`、`Bite` 等动作。
- 聊天室文字中包含打击类关键词时的兜底识别。

示例：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_hit",
  "token": "玩家Token",
  "payload": {
    "event": "hit",
    "source": "Activity",
    "target": "self",
    "assetGroupName": "ItemButt",
    "actionName": "Spank",
    "assetName": "Paddle",
    "intensity": 0.36,
    "intensityPercent": 36
  }
}
```

## 电击事件

触发来源：

- `TriggerShock0`、`TriggerShock1`、`TriggerShock2`。
- `PropertyShockPublishAction`。
- 训练带、未来贞操带等脚本触发的惩罚电击。
- 聊天室文字中包含电击类关键词时的兜底识别。

示例：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_shock",
  "token": "玩家Token",
  "payload": {
    "event": "shock",
    "source": "PropertyShockPublishAction",
    "assetGroupName": "ItemPelvis",
    "actionName": "TriggerShock1",
    "displayActionName": "ShockMed",
    "assetName": "FuturisticTrainingBelt",
    "level": 1,
    "intensity": 0.6,
    "intensityPercent": 60,
    "waveform": "玩家设置的波形名"
  }
}
```

## 触摸事件

触发来源：

- `Activity` 消息中的 `Caress`、`Grope`、`Kiss`、`Lick`、`MassageHands` 等动作。
- Portal Link Panties 的部分互动。
- 聊天室文字中包含触摸类关键词时的兜底识别。

示例：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_touch",
  "token": "玩家Token",
  "payload": {
    "event": "touch",
    "source": "Activity",
    "target": "self",
    "assetGroupName": "ItemBreast",
    "actionName": "Caress",
    "assetName": "",
    "intensity": 0.12,
    "intensityPercent": 12
  }
}
```

## 玩具同步事件

触发来源：

- `ActionUse`、`ActionRemove`、`ActionSwap`。
- `InventoryWear`、`InventoryRemove`。
- `CharacterRefresh` 后同步当前角色身上玩具。
- `ExtendedItemSetOption`、`VibratorModePublish`、充气或吸力状态变化。

示例：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_toy_sync",
  "token": "玩家Token",
  "payload": {
    "event": "toySync",
    "source": "VibratorModePublish",
    "effect": "Vibration",
    "assetGroupName": "ItemVulva",
    "itemName": "VibratingDildo",
    "level": 3
  }
}
```

穿戴、移除、替换时使用 `itemEvent`：

```json
{
  "event": "toySync",
  "source": "ActionUse",
  "itemEvent": "itemAdded",
  "assetName": "VibratingDildo",
  "assetGroupName": "ItemVulva"
}
```

## 强度重置

YCY 文档中的电击器支持 `payload.reset_strength`。脚本提供：

```text
/ycy reset shock
```

发送示例：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_shock",
  "token": "玩家Token",
  "payload": {
    "event": "shock",
    "source": "command_reset",
    "reset_strength": true
  }
}
```

## 排障指令

```text
/ycy status
/ycy test shock
/ycy debug on
/ycy stop
```

`/ycy status` 会显示当前指令 ID 映射、波形设置、IM 登录状态、最近事件、最近发送、最近跳过原因和最近错误。
