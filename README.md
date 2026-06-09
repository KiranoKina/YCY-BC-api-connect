# YCY BC 电击器事件联动

这是重新生成的新项目，没有覆盖旧 starter。

目标：把 Bondage Club 里的事件转换为弹次元 Tencent IM 新协议指令，并发送给统一目标用户 `10086`。

## 当前版本

文件：

- `userscript/ycy-bc-estim-helper.user.js`
- `userscript/ycy-bc-estim-helper.sdk-loader.user.js`

第一版只做 userscript，不额外做本地后端，因为你提供的接口地址已经是：

```text
https://suo.jiushu1234.com/api.php/user/game_sign
```

## 两个脚本版本怎么选

优先使用：

```text
userscript/ycy-bc-estim-helper.user.js
```

这个版本假设页面或 App 已经注入 Tencent IM SDK，并暴露为 `$TC`、`TIM` 或 `TencentCloudChat`。

如果页面没有 SDK，使用备用版：

```text
userscript/ycy-bc-estim-helper.sdk-loader.user.js
```

备用版会在页面没有 SDK 时，尝试从 jsDelivr 加载官方 npm 包：

```text
https://cdn.jsdelivr.net/npm/@tencentcloud/chat@3.6.6/index.es.js
```

加载成功后会使用新版官方命名空间 `TencentCloudChat`。这个方式需要浏览器允许 Tampermonkey 请求 `cdn.jsdelivr.net`。

## 协议

使用新协议：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_shock",
  "token": "用户token"
}
```

停止全部设备：

```json
{
  "code": "game_cmd",
  "id": "_stop_all",
  "token": "用户token"
}
```

## 指令 ID

当前预设：

| Bondage Club 事件 | 指令 ID |
| --- | --- |
| 被打 | `ycy_bc_hit` |
| 被电击 | `ycy_bc_shock` |
| 被触摸 | `ycy_bc_touch` |
| 玩具数据同步 | `ycy_bc_toy_sync` |
| 紧急停止 | `_stop_all` |

后续你在弹次元 App 里配置事件时，可以围绕这些 ID 配置电击器波形、强度和安全阈值。

## connect_code

脚本会优先从页面 URL 读取：

```text
?connect_code=UID%20Token
```

如果 URL 中有新的 `connect_code`，脚本会自动覆盖本地缓存。也可以在脚本右上角面板里手动粘贴。

脚本会调用：

```text
POST https://suo.jiushu1234.com/api.php/user/game_sign
```

请求体会同时带上：

```json
{
  "connect_code": "UID Token",
  "uid": "game_xxx",
  "token": "..."
}
```

其中 `connect_code` 是优先字段，`uid/token` 用于兼容旧接口。

## 目标用户

你确认目标使用 `10086`。脚本里有全局常量 `全局目标用户 = "10086"`，面板里也可以显示和修改，但所有默认值都从这个常量开始。

## 事件监听

脚本会尝试监听：

- `ChatRoomMessageAdd`
- `ChatRoomMessage` 数组轮询兜底

识别事件时会用关键词和 BC 消息结构做保守判断：

- 被打：`spank/slap/hit/punch/whip/打/拍/抽/鞭`
- 被电击：`shock/electro/electric/zap/电击/触电/电刺激/estim`
- 被触摸：`touch/grope/fondle/caress/rub/摸/触摸/抚摸/揉`

因为 Bondage Club 的活动消息会随版本、语言和插件变化，第一版属于“可跑通的保守识别”。后续拿到实际消息样本后，可以把识别逻辑改得更准确。

## 玩具数据同步

脚本会从 `Player.Appearance` 中扫描可能的玩具类物品，生成摘要并发送：

```json
{
  "code": "game_cmd",
  "id": "ycy_bc_toy_sync",
  "token": "...",
  "payload": {
    "reason": "periodic",
    "toys": []
  }
}
```

目前会每 5 秒检查一次；只有摘要变化时才自动同步。面板里的“同步玩具”按钮会强制同步一次。

## 安全设置

脚本默认不会自动发送，需要手动勾选：

- 启用联动
- 本次会话授权

普通事件有 2 秒限流。紧急停止 `_stop_all` 不受限流和授权开关影响，方便随时停止。

## 安装

1. 打开 Tampermonkey。
2. 新建脚本。
3. 粘贴 `userscript/ycy-bc-estim-helper.user.js`。
4. 从弹次元 App 启动 Bondage Club 页面，或手动把 `connect_code` 粘贴到面板。
5. 点击“登录IM”测试签名和 IM 登录。
6. 点击“测试电击”确认目标 `10086` 能收到 `ycy_bc_shock`。

## 重要限制

普通版脚本假设页面里已经有 Tencent IM SDK，并暴露为 `$TC`、`TIM` 或 `TencentCloudChat`。如果实际页面没有 SDK，可以先用备用版 `ycy-bc-estim-helper.sdk-loader.user.js`。

所有代码注释已使用中文。
