# YCY BC Estim Link BCX Style

这是 Bondage Club 到役次元 YCY/YOKONEX 的 `game_cmd` 联动脚本。当前版本按 BCX/XToys 的事件监听思路整理，不覆盖旧脚本。

## 文件

- `userscript/ycy-bc-estim-bcx-style.user.js`：Tampermonkey 用户脚本
- `YCY_EVENT_PARAMETERS.md`：YCY 协议、指令 ID、payload 说明
- `DG_LAB_BC_ACTION_RULES_V2.md`：XToys/DG-Lab 风格动作规则说明
- `DG_LAB_XTOYS_FULL_COVERAGE_CONFIG.json`：可用于 XToys 配置的全覆盖 JSON

## 固定开发逻辑

之后写 Bondage Club 插件时，沿用这套逻辑：

- Tampermonkey 使用 `unsafeWindow` 访问游戏页面上下文。
- 斜杠命令使用 `CommandCombine` 注册。
- `bcModSdk` 只作为 hook 增强；没有 SDK 时也要保证基础功能能启动。
- 本地提示使用 `ChatRoomMessage({ Type: "LocalMessage" })`，并等 `CurrentScreen === "ChatRoom"` 后再显示。
- 聊天室 hook 优先使用 `ChatRoomMessage`、`ChatRoomSendChat`、`ChatRoomKeyDown`、`ChatRoomSync`。
- 主程序尽量不写普通说明注释，说明放到 README 或 `.md` 文档。

## 游戏唯一码

役次元 App 内创建开发游戏时，游戏唯一码填写：

```text
bondage club
```

## 最少使用流程

如果从役次元 App 启动游戏，并且网址里带 `connect_code`，脚本会自动：

- 读取连接码
- 自动识别目标用户
- 启用联动
- 登录 Tencent IM
- 同步角色身上道具

进入聊天室后可以用：

```text
/ycy status
```

确认 `IM：已就绪`。

如果不是从 App 启动，手动执行：

```text
/ycy link UID Token
/ycy start
```

也可以粘贴带 `connect_code=` 的完整链接。

## 游戏内命令

命令前缀只使用 `/ycy`。

| 命令 | 作用 |
| --- | --- |
| `/ycy help` | 显示游戏内说明 |
| `/ycy start` | 一键载入、启用、登录、同步 |
| `/ycy status` | 查看接入状态 |
| `/ycy link UID Token` | 保存连接码 |
| `/ycy load` | 从当前网址读取 `connect_code` |
| `/ycy on` | 启用联动 |
| `/ycy off` | 关闭联动 |
| `/ycy autostart on/off` | 开关从 App 启动时自动启用 |
| `/ycy target auto` | 自动读取连接码 UID 作为目标用户 |
| `/ycy target 用户ID` | 手动设置目标用户 |
| `/ycy map hit|shock|touch|toy 指令ID [波形]` | 设置单类事件指令 ID |
| `/ycy map all hitID shockID touchID toyID [波形]` | 批量设置四类事件指令 ID |
| `/ycy waveform hit|shock|touch|toy|all 波形|off` | 设置或取消波形 |
| `/ycy payload simple` | 使用简洁发送格式 |
| `/ycy payload full` | 使用带 payload 的调试格式 |
| `/ycy login` | 登录 Tencent IM |
| `/ycy reconnect` | 重新登录 Tencent IM |
| `/ycy sync` | 同步角色身上所有道具 |
| `/ycy test hit|shock|touch` | 发送测试事件 |
| `/ycy probe shock|hit|touch|toy|指令ID` | 发送多种兼容包，诊断 App 吃哪种格式 |
| `/ycy rawshock [波形]` | 发送最小电击器测试包 |
| `/ycy reset hit|shock|touch` | 重置对应指令强度递增 |
| `/ycy debug on/off` | 开关控制台调试 |
| `/ycy stop` | 发送 `_stop_all` 紧急停止 |

二次授权已取消。旧命令 `/ycy consent` 只会提示现在不再需要二次授权。

## 指令 ID

默认指令 ID：

| 事件 | 默认 game_cmd id |
| --- | --- |
| 被打、拍打、鞭打、踢等 | `hit` |
| 被电击、震击、电刺激等 | `shock` |
| 被触摸、抚摸、亲吻、舔等 | `touch` |
| 道具穿戴、移除、替换、震动、充气等 | `toy_sync` |
| 紧急停止 | `_stop_all` |

可以改成 App 内实际配置的 ID，也可以使用数字 ID。

示例：

```text
/ycy map shock 4
/ycy map all 9 4 7 1
/ycy map all 99 99 99 99
```

## 发送格式

当前默认发送格式是 `simple`，更接近 `YCY-DungeonTest` 示例：

```json
{
  "code": "game_cmd",
  "id": 4,
  "token": "玩家Token"
}
```

如果指令 ID 是纯数字，脚本发送时会自动转成 JSON 数字；如果是英文或混合字符，则按字符串发送。

如果 IM 显示发送成功但 App 没反应，可以用：

```text
/ycy probe shock
```

它会依次测试 raw UID 数字 ID、raw UID 字符串 ID、`game_UID` 数字 ID、无 token 数字 ID，用来定位 App 实际识别哪种格式。

如果切换到 `full`：

```text
/ycy payload full
```

会附带事件 payload，方便调试动作来源、部位、道具和强度。

在 `simple` 模式下，普通自动事件永远只发送 `code`、`id`、`token`。只有 `/ycy rawshock`、`/ycy reset` 这类手动控制命令会强制带 payload。

`on`、`true`、`yes`、`开` 不会当成波形名发送，会被视为使用 App 默认波形。只有在 `full` 模式或手动控制命令中填写真实波形名称时，才会发送 `payload.waveform`。

## 目标用户

目标用户默认自动从连接码第一段 UID 读取，并在发送 IM 时去掉 `game_` 前缀。

例如：

- 连接码以 `52578` 开头，目标用户是 `52578`
- 连接码以 `game_52578` 开头，目标用户仍然是 `52578`

恢复自动目标：

```text
/ycy target auto
```

## 事件接入

脚本会尽量直接监听 BC 事件，而不是只靠关键词。

已接入：

- `Activity`：读取 `FocusAssetGroup`、`ActivityName`、`ActivityAsset`、`TargetCharacter`、`SourceCharacter`
- `ActionUse` / `ActionRemove` / `ActionSwap`：同步物品穿脱和替换
- 通用 `Action`：未知动作会自动归类为 `shock`、`hit` 或 `touch`
- `PropertyShockPublishAction`：捕获电击发布
- `ExtendedItemSetOption` / `VibratorModePublish`：捕获震动、充气等属性变化
- `InventoryWear` / `InventoryRemove`：捕获自己穿脱物品
- `FuturisticTrainingBelt` / `FuturisticChastityBelt`：捕获训练带震动和惩罚电击
- Portal Link Panties 的远程互动动作
- `CharacterRefresh`：同步玩家身上的所有外观道具

普通未知动作默认按 `touch` 轻量触发，避免事件被丢掉。

## 签名接口

签名接口：

```text
POST https://suo.jiushu1234.com/api.php/user/game_sign
```

脚本优先使用 JSON 请求：

```json
{
  "connect_code": "UID Token",
  "uid": "game_UID",
  "token": "Token"
}
```

如果失败，会按 `YCY-DungeonTest` 示例里的表单格式重试：

```text
uid=game_UID&token=Token
```

## 安装

把 `userscript/ycy-bc-estim-bcx-style.user.js` 安装到 Tampermonkey。

进入聊天室时会显示本地载入提示：

```text
[YCY Link] 已就绪 v0.1.0
输入 /ycy help 打开联动说明。
```
