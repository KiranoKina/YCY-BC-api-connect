// ==UserScript==
// @name         YCY BC 电击器事件联动（SDK加载兜底版）
// @namespace    https://example.local/ycy-bc-estim-helper
// @version      0.1.0
// @description  将 Bondage Club 事件转换为弹次元 Tencent IM game_cmd 指令
// @author       You
// @match        *://www.bondageprojects.com/club_game*
// @match        *://www.bondageprojects.elementfx.com/*
// @match        *://bondageprojects.elementfx.com/*
// @match        *://www.bondageprojects.elementfx.com/R*/BondageClub/*
// @match        *://bondageprojects.elementfx.com/R*/BondageClub/*
// @match        *://www.bondage-europe.com/*
// @match        *://bondage-europe.com/*
// @match        *://www.bondage-europe.com/R*/BondageClub/*
// @match        *://bondage-europe.com/R*/BondageClub/*
// @match        *://www.bondage-asia.com/*
// @match        *://bondage-asia.com/*
// @match        *://www.bondage-asia.com/club/R*/*
// @match        *://bondage-asia.com/club/R*/*
// @include      /^https:\/\/(www\.)?bondage(projects\.elementfx|-(europe|asia))\.com\/.*/
// @grant        GM_xmlhttpRequest
// @connect      suo.jiushu1234.com
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const 插件名 = "YCY BC 电击器事件联动";

  // 这个接口来自你提供的 IM_basic.md，用于用 connect_code 换取 Tencent IM 登录签名。
  const 签名接口 = "https://suo.jiushu1234.com/api.php/user/game_sign";

  // 你已确认目标统一使用 10086；全局只从这里取，避免散落多个目标 ID。
  const 全局目标用户 = "10086";

  // 兜底版会在页面没有 IM SDK 时尝试加载官方 npm 包的 ESM 文件。
  // 版本固定，避免 latest 变化导致脚本突然不可用。
  const 腾讯IMSDK地址 = "https://cdn.jsdelivr.net/npm/@tencentcloud/chat@3.6.6/index.es.js";

  // 第一版围绕电击器做事件映射，指令 ID 统一使用 ycy 前缀。
  const 指令 = {
    被打: "ycy_bc_hit",
    被电击: "ycy_bc_shock",
    被触摸: "ycy_bc_touch",
    玩具同步: "ycy_bc_toy_sync",
    停止全部: "_stop_all"
  };

  const 存储前缀 = "ycy_bc_estim_";

  let 聊天实例 = null;
  let 当前连接信息 = null;
  let SDK加载任务 = null;
  let 已处理消息 = new WeakSet();
  let 上次事件时间 = new Map();
  let 上次玩具同步签名 = "";

  const 默认设置 = {
    启用: false,
    本次会话授权: false,
    目标用户: 全局目标用户,
    最小间隔毫秒: 2000,
    事件强度: {
      被打: 1,
      被电击: 2,
      被触摸: 1,
      玩具同步: 1
    }
  };

  function 读设置(键, 默认值) {
    const 原始值 = localStorage.getItem(存储前缀 + 键);
    if (原始值 == null) return 默认值;
    try {
      return JSON.parse(原始值);
    } catch {
      return 默认值;
    }
  }

  function 写设置(键, 值) {
    localStorage.setItem(存储前缀 + 键, JSON.stringify(值));
  }

  function 取设置() {
    return {
      ...默认设置,
      ...读设置("settings", {})
    };
  }

  function 存设置(设置) {
    写设置("settings", 设置);
  }

  function 记录(...内容) {
    console.log(`[${插件名}]`, ...内容);
  }

  function 提示(文本) {
    if (typeof window.ChatRoomSendLocal === "function") {
      window.ChatRoomSendLocal(`[${插件名}] ${文本}`);
      return;
    }
    console.log(`[${插件名}] ${文本}`);
  }

  function 当前玩家编号() {
    return window.Player?.MemberNumber ? String(window.Player.MemberNumber) : "";
  }

  function 读取连接码() {
    const 参数 = new URLSearchParams(window.location.search);
    const 地址连接码 = 参数.get("connect_code");
    if (地址连接码) {
      写设置("connect_code", 地址连接码.trim());
      return 地址连接码.trim();
    }
    return 读设置("connect_code", "");
  }

  function 解析连接码(connectCode) {
    const 文本 = String(connectCode || "").trim();
    if (!文本) return null;

    // 文档说明 connect_code 是“UID 空格 Token”，这里兼容多空格和换行。
    const 片段 = 文本.split(/\s+/).filter(Boolean);
    if (片段.length < 2) return null;

    const uid = 片段[0].startsWith("game_") ? 片段[0] : `game_${片段[0]}`;
    const token = 片段.slice(1).join("");
    return { uid, token, connect_code: 文本 };
  }

  function 请求JSON(地址, 数据) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: 地址,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(数据),
        onload(响应) {
          try {
            const 结果 = JSON.parse(响应.responseText || "{}");
            if (响应.status >= 400) {
              reject(new Error(结果.msg || 结果.error || `HTTP ${响应.status}`));
              return;
            }
            resolve(结果);
          } catch (错误) {
            reject(错误);
          }
        },
        onerror: reject
      });
    });
  }

  async function 获取IM签名() {
    const 连接码 = 读取连接码();
    const 连接信息 = 解析连接码(连接码);
    if (!连接信息) {
      throw new Error("未找到有效 connect_code。请从弹次元 App 启动页面，或在面板里粘贴连接码。");
    }

    // 优先使用文档推荐的 connect_code，同时保留 uid/token 兼容旧接口。
    const 响应 = await 请求JSON(签名接口, {
      connect_code: 连接信息.connect_code,
      uid: 连接信息.uid,
      token: 连接信息.token
    });

    if (响应.code !== 1 || !响应.data?.appid || !响应.data?.sign) {
      throw new Error(响应.msg || "获取 IM 签名失败");
    }

    当前连接信息 = {
      ...连接信息,
      appid: Number(响应.data.appid),
      sign: 响应.data.sign
    };
    return 当前连接信息;
  }

  function 已有IMSDK() {
    // 你提供的文档示例使用 $TC；旧版常见 TIM；新版官方文档使用 TencentCloudChat。
    if (window.$TC) return window.$TC;
    if (window.TIM) return window.TIM;
    if (window.TencentCloudChat) return window.TencentCloudChat;
    return null;
  }

  function 拉取脚本文本(地址) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: 地址,
        onload(响应) {
          if (响应.status >= 400) {
            reject(new Error(`加载 Tencent IM SDK 失败：HTTP ${响应.status}`));
            return;
          }
          resolve(响应.responseText);
        },
        onerror: reject
      });
    });
  }

  async function 动态导入ESM(源码) {
    const blob = new Blob([源码], { type: "text/javascript" });
    const 地址 = URL.createObjectURL(blob);
    try {
      return await import(地址);
    } finally {
      URL.revokeObjectURL(地址);
    }
  }

  async function 获取IMSDK() {
    const 已有 = 已有IMSDK();
    if (已有) return 已有;

    if (!SDK加载任务) {
      SDK加载任务 = (async () => {
        提示("页面未发现 Tencent IM SDK，正在尝试加载兜底版 SDK。");
        const 源码 = await 拉取脚本文本(腾讯IMSDK地址);
        const 模块 = await 动态导入ESM(源码);
        const SDK = 模块.default || 模块.TencentCloudChat;
        if (!SDK?.create || !SDK?.TYPES) {
          throw new Error("Tencent IM SDK 已加载，但未找到 create/TYPES。");
        }
        window.TencentCloudChat = SDK;
        提示("兜底版 Tencent IM SDK 加载完成。");
        return SDK;
      })();
    }

    return SDK加载任务;
  }

  async function 登录IM() {
    if (聊天实例) return 聊天实例;

    const SDK = await 获取IMSDK();
    if (!SDK) {
      throw new Error("页面里没有找到 Tencent IM SDK，兜底加载也失败。");
    }

    const 登录信息 = await 获取IM签名();
    const chat = SDK.create({ SDKAppID: 登录信息.appid });

    await chat.login({
      userID: 登录信息.uid,
      userSig: 登录信息.sign
    });

    聊天实例 = chat;
    提示(`IM 登录成功：${登录信息.uid}`);
    return chat;
  }

  async function 创建文本消息(chat, 指令对象) {
    const SDK = await 获取IMSDK();
    const 目标 = 取设置().目标用户 || 全局目标用户;

    return chat.createTextMessage({
      to: String(目标),
      conversationType: SDK.TYPES.CONV_C2C,
      payload: {
        text: JSON.stringify(指令对象)
      }
    });
  }

  function 构建指令(id, payload = undefined) {
    if (!当前连接信息?.token) {
      const 连接信息 = 解析连接码(读取连接码());
      if (连接信息) 当前连接信息 = { ...当前连接信息, ...连接信息 };
    }

    const 指令对象 = {
      code: "game_cmd",
      id,
      token: 当前连接信息?.token || ""
    };

    if (payload && Object.keys(payload).length > 0) {
      指令对象.payload = payload;
    }

    return 指令对象;
  }

  function 允许发送(事件名, 是否紧急 = false) {
    const 设置 = 取设置();

    if (!设置.启用 && !是否紧急) {
      return { allowed: false, reason: "插件未启用" };
    }

    if (!设置.本次会话授权 && !是否紧急) {
      return { allowed: false, reason: "本次会话尚未授权" };
    }

    if (是否紧急) {
      return { allowed: true };
    }

    const 当前时间 = Date.now();
    const 上次时间 = 上次事件时间.get(事件名) || 0;
    if (当前时间 - 上次时间 < 设置.最小间隔毫秒) {
      return { allowed: false, reason: "触发过于频繁，已限流" };
    }

    上次事件时间.set(事件名, 当前时间);
    return { allowed: true };
  }

  async function 发送指令(id, payload = undefined, 选项 = {}) {
    const 检查 = 允许发送(id, Boolean(选项.紧急));
    if (!检查.allowed) {
      记录("跳过发送", id, 检查.reason);
      return;
    }

    const chat = await 登录IM();
    const 指令对象 = 构建指令(id, payload);
    const 消息 = await 创建文本消息(chat, 指令对象);
    await chat.sendMessage(消息);

    记录("已发送指令", 指令对象);
  }

  function 取消息文本(消息) {
    const 候选 = [
      消息?.Content,
      消息?.Type,
      消息?.Sender,
      消息?.Target,
      消息?.ActivityName,
      消息?.Dictionary && JSON.stringify(消息.Dictionary)
    ];
    return 候选.filter(Boolean).join(" ").toLowerCase();
  }

  function 是自己相关消息(消息) {
    const 编号 = 当前玩家编号();
    if (!编号) return true;

    const 文本 = 取消息文本(消息);
    const 字典文本 = JSON.stringify(消息?.Dictionary || {});

    // BC 的活动消息结构会随版本和语言变化，所以这里用“包含玩家编号”的保守判断。
    return 文本.includes(编号) || 字典文本.includes(编号);
  }

  function 识别事件(消息) {
    if (!消息 || 已处理消息.has(消息)) return null;
    已处理消息.add(消息);

    if (!是自己相关消息(消息)) return null;

    const 文本 = 取消息文本(消息);

    // 电击优先级最高，避免 “被电击玩具触发” 被归类为普通触摸。
    if (/(shock|electro|electric|zap|电击|触电|电刺激|estim)/i.test(文本)) {
      return { 类型: "被电击", id: 指令.被电击 };
    }

    if (/(spank|slap|hit|punch|whip|strike|打|拍|抽|鞭|击打)/i.test(文本)) {
      return { 类型: "被打", id: 指令.被打 };
    }

    if (/(touch|grope|fondle|caress|rub|摸|触摸|抚摸|揉)/i.test(文本)) {
      return { 类型: "被触摸", id: 指令.被触摸 };
    }

    return null;
  }

  function 玩具摘要() {
    const 外观 = Array.isArray(window.Player?.Appearance) ? window.Player.Appearance : [];
    const 关键词 = /(vibe|vibrator|shock|electro|estim|dildo|plug|电击|震动|玩具|按摩棒)/i;

    return 外观
      .filter(物品 => {
        const 名称 = [
          物品?.Asset?.Name,
          物品?.Asset?.Description,
          物品?.Asset?.Group?.Name,
          物品?.Asset?.Group?.Description
        ].filter(Boolean).join(" ");
        return 关键词.test(名称);
      })
      .map(物品 => ({
        group: 物品?.Asset?.Group?.Name || "",
        name: 物品?.Asset?.Name || "",
        property: 物品?.Property || {}
      }));
  }

  async function 同步玩具数据(原因 = "manual") {
    const 摘要 = 玩具摘要();
    const 签名 = JSON.stringify(摘要);
    if (签名 === 上次玩具同步签名 && 原因 !== "manual") return;

    上次玩具同步签名 = 签名;
    await 发送指令(指令.玩具同步, {
      reason: 原因,
      toys: 摘要
    });
  }

  async function 处理聊天消息(消息) {
    const 事件 = 识别事件(消息);
    if (!事件) return;

    const 设置 = 取设置();
    await 发送指令(事件.id, {
      source: "bondage_club_event",
      eventType: 事件.类型,
      strength: 设置.事件强度[事件.类型] || 1,
      playerMemberNumber: 当前玩家编号(),
      timestamp: Date.now()
    });
  }

  function 安装消息监听() {
    if (window.__ycyBcEstimHooked) return;
    window.__ycyBcEstimHooked = true;

    // 优先 hook BC 常见的 ChatRoomMessageAdd；如果不存在，再用轮询兜底。
    if (typeof window.ChatRoomMessageAdd === "function") {
      const 原函数 = window.ChatRoomMessageAdd;
      window.ChatRoomMessageAdd = function (...参数) {
        const 返回值 = 原函数.apply(this, 参数);
        const 消息 = 参数[0];
        处理聊天消息(消息).catch(错误 => 记录("处理消息失败", 错误));
        return 返回值;
      };
      记录("已 hook ChatRoomMessageAdd");
    }

    let 已读长度 = Array.isArray(window.ChatRoomMessage) ? window.ChatRoomMessage.length : 0;
    setInterval(() => {
      if (!Array.isArray(window.ChatRoomMessage)) return;
      const 新消息 = window.ChatRoomMessage.slice(已读长度);
      已读长度 = window.ChatRoomMessage.length;
      for (const 消息 of 新消息) {
        处理聊天消息(消息).catch(错误 => 记录("处理消息失败", 错误));
      }
    }, 1000);

    setInterval(() => {
      if (取设置().启用 && 取设置().本次会话授权) {
        同步玩具数据("periodic").catch(错误 => 记录("同步玩具失败", 错误));
      }
    }, 5000);
  }

  function 创建面板() {
    if (document.getElementById("ycy-bc-estim-panel")) return;

    const 设置 = 取设置();
    const 面板 = document.createElement("div");
    面板.id = "ycy-bc-estim-panel";
    面板.style.position = "fixed";
    面板.style.top = "78px";
    面板.style.right = "18px";
    面板.style.zIndex = "99999";
    面板.style.width = "260px";
    面板.style.padding = "10px";
    面板.style.background = "#202124";
    面板.style.color = "#fff";
    面板.style.border = "1px solid #555";
    面板.style.borderRadius = "8px";
    面板.style.font = "13px Arial, sans-serif";
    面板.style.boxShadow = "0 8px 24px rgba(0,0,0,.35)";

    面板.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">YCY BC 电击器联动</div>
      <label style="display:block;margin:6px 0">
        <input id="ycy-enable" type="checkbox"> 启用联动
      </label>
      <label style="display:block;margin:6px 0">
        <input id="ycy-consent" type="checkbox"> 本次会话授权
      </label>
      <label style="display:block;margin:6px 0">目标用户</label>
      <input id="ycy-target" style="width:100%;box-sizing:border-box" value="${设置.目标用户 || 全局目标用户}">
      <label style="display:block;margin:6px 0">connect_code</label>
      <textarea id="ycy-connect-code" rows="3" style="width:100%;box-sizing:border-box">${读取连接码()}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
        <button id="ycy-login">登录IM</button>
        <button id="ycy-sync">同步玩具</button>
        <button id="ycy-test-hit">测试被打</button>
        <button id="ycy-test-shock">测试电击</button>
      </div>
      <button id="ycy-stop" style="width:100%;margin-top:8px;background:#b00020;color:white;border:0;border-radius:6px;padding:8px">紧急停止</button>
      <div id="ycy-status" style="margin-top:8px;color:#ccc">目标：${设置.目标用户 || 全局目标用户}</div>
    `;

    document.body.appendChild(面板);

    const 启用 = 面板.querySelector("#ycy-enable");
    const 授权 = 面板.querySelector("#ycy-consent");
    const 目标 = 面板.querySelector("#ycy-target");
    const 连接码 = 面板.querySelector("#ycy-connect-code");
    const 状态 = 面板.querySelector("#ycy-status");

    启用.checked = Boolean(设置.启用);
    授权.checked = Boolean(设置.本次会话授权);

    function 保存面板设置() {
      const 新设置 = 取设置();
      新设置.启用 = 启用.checked;
      新设置.本次会话授权 = 授权.checked;
      新设置.目标用户 = String(目标.value || 全局目标用户).trim();
      存设置(新设置);
      写设置("connect_code", 连接码.value.trim());
      状态.textContent = `目标：${新设置.目标用户}`;
    }

    启用.addEventListener("change", 保存面板设置);
    授权.addEventListener("change", 保存面板设置);
    目标.addEventListener("change", 保存面板设置);
    连接码.addEventListener("change", 保存面板设置);

    面板.querySelector("#ycy-login").addEventListener("click", () => {
      保存面板设置();
      登录IM().catch(错误 => 提示(错误.message));
    });

    面板.querySelector("#ycy-sync").addEventListener("click", () => {
      保存面板设置();
      同步玩具数据("manual").catch(错误 => 提示(错误.message));
    });

    面板.querySelector("#ycy-test-hit").addEventListener("click", () => {
      保存面板设置();
      发送指令(指令.被打, { source: "manual_test", strength: 1 }).catch(错误 => 提示(错误.message));
    });

    面板.querySelector("#ycy-test-shock").addEventListener("click", () => {
      保存面板设置();
      发送指令(指令.被电击, { source: "manual_test", strength: 2 }).catch(错误 => 提示(错误.message));
    });

    面板.querySelector("#ycy-stop").addEventListener("click", () => {
      保存面板设置();
      发送指令(指令.停止全部, undefined, { 紧急: true }).catch(错误 => 提示(错误.message));
    });
  }

  function 等待游戏加载() {
    const 定时器 = setInterval(() => {
      if (typeof window.Player !== "undefined") {
        clearInterval(定时器);
        创建面板();
        安装消息监听();
        记录("已加载");
      }
    }, 1000);
  }

  等待游戏加载();
})();
