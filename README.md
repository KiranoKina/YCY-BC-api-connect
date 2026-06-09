# YCY BC Estim Link BCX Style

这是按 BCX 思路重新生成的新版本，不覆盖之前的脚本。

## 文件

- `userscript/ycy-bc-estim-bcx-style.user.js`

## 结构

这个版本优先使用 `bondage-club-mod-sdk`，如果页面没有 SDK，也会用本地包装函数继续启动，确保 `/ycy` 命令先注册成功。

## 后续 BC 插件固定逻辑

之后写 Bondage Club 插件时，沿用这套逻辑：

- Tampermonkey 使用 `unsafeWindow` 访问游戏页面上下文。
- 斜杠命令使用 `CommandCombine` 正式注册，不只依赖聊天发送 hook。
- `bcModSdk` 只作为 hook 增强；没有 SDK 时也要保证基础功能能启动。
- 本地提示使用 `ChatRoomMessage({ Type: "LocalMessage" })`，并等 `CurrentScreen === "ChatRoom"` 后再显示。
- 聊天室相关 hook 优先使用 `ChatRoomMessage`、`ChatRoomSendChat`、`ChatRoomKeyDown`、`ChatRoomSync`。
- 主程序尽量不写普通注释，说明放到 README。

主要 hook 点：

- `ChatRoomSendChat`：处理 `/ycy` 游戏内命令
- `CommandCombine`：正式注册 `/ycy` 斜杠命令
- `ChatRoomMessage`：监听聊天室事件
- `ChatRoomCreateElement`：记录聊天室输入框
- `ChatRoomClearAllElements`：清理输入框引用
- `CharacterRefresh`：角色外观刷新后同步玩具数据

主程序里不写普通注释，避免注释影响 userscript 或压缩后的运行。说明都放在这个 README。

## 游戏内命令

命令前缀只使用 `/ycy`。

| 命令 | 作用 |
| --- | --- |
| `/ycy help` | 显示游戏内说明 |
| `/ycy code UID Token` | 保存 connect_code |
| `/ycy on` | 启用联动 |
| `/ycy off` | 关闭联动 |
| `/ycy consent on` | 开启本次会话授权 |
| `/ycy consent off` | 关闭本次会话授权 |
| `/ycy target 10086` | 设置目标用户 |
| `/ycy login` | 登录 Tencent IM |
| `/ycy sync` | 同步角色身上的玩具数据 |
| `/ycy test hit` | 测试被打事件 |
| `/ycy test shock` | 测试电击事件 |
| `/ycy test touch` | 测试触摸事件 |
| `/ycy stop` | 发送 `_stop_all` 紧急停止 |

## 指令 ID

| 事件 | game_cmd id |
| --- | --- |
| 被打 | `ycy_bc_hit` |
| 被电击 | `ycy_bc_shock` |
| 被触摸 | `ycy_bc_touch` |
| 玩具同步 | `ycy_bc_toy_sync` |
| 紧急停止 | `_stop_all` |

发送给设备端的消息格式：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_shock",
  "token": "用户token",
  "payload": {
    "source": "ChatRoomMessage",
    "type": "shock",
    "strength": 2
  }
}
```

## 接口

签名接口：

```text
POST https://suo.jiushu1234.com/api.php/user/game_sign
```

请求会带：

```json
{
  "connect_code": "UID Token",
  "uid": "game_UID",
  "token": "Token"
}
```

目标用户默认全局固定为 `10086`，也可以用 `/ycy target 10086` 设置。

## 安装

把 `userscript/ycy-bc-estim-bcx-style.user.js` 安装到 Tampermonkey。

第一次进入游戏后：

```text
/ycy code UID Token
/ycy consent on
/ycy on
/ycy login
/ycy test shock
```

如果页面 URL 里有 `connect_code`，脚本会自动保存，不需要手动执行 `/ycy code`。

进入聊天室时会显示一条粉色本地载入提示：

```text
[YCY] 电击器联动工具 v0.1.0 载入！ 使用 /ycy help 查看说明
```
