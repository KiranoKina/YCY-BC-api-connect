// ==UserScript==
// @name         YCY BC Estim Link BCX Style
// @namespace    https://example.local/ycy-bc-estim-bcx-style
// @version      0.1.0
// @description  Bondage Club event bridge for YCY game_cmd
// @author       You
// @match        https://www.bondageprojects.com/club_game/*
// @match        https://bondageprojects.elementfx.com/club_game/*
// @include      /^https:\/\/(www\.)?bondage(projects\.elementfx|-(europe|asia))\.com\/.*/
// @grant        GM_xmlhttpRequest
// @connect      suo.jiushu1234.com
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const MOD_NAME = "YCY_BC_Estim_Link";
  const MOD_VERSION = "0.1.0";
  const SIGN_URL = "https://suo.jiushu1234.com/api.php/user/game_sign";
  const TC_SDK_URL = "https://cdn.jsdelivr.net/npm/@tencentcloud/chat@3.6.6/index.es.js";
  const TARGET_USER = "10086";
  const STORE_PREFIX = "ycy_bcx_style_";
  const COMMAND_PREFIXES = ["/ycy"];
  const IDS = {
    hit: "ycy_bc_hit",
    shock: "ycy_bc_shock",
    touch: "ycy_bc_touch",
    toySync: "ycy_bc_toy_sync",
    stop: "_stop_all"
  };

  let modApi = null;
  let chat = null;
  let sdkTask = null;
  let loginInfo = null;
  let lastToySignature = "";
  let inputElement = null;
  const cooldowns = new Map();

  function initModApi() {
    if (modApi) return modApi;
    try {
      if (window.bcModSdk?.registerMod) {
        modApi = window.bcModSdk.registerMod({
          name: MOD_NAME,
          fullName: "YCY BC Estim Link",
          version: MOD_VERSION,
          repository: ""
        }, { allowReplace: true });
      }
    } catch (error) {
      console.warn("[YCY] bcModSdk unavailable", error);
    }
    return modApi;
  }

  function hookFunction(name, priority, handler) {
    const api = initModApi();
    if (api?.hookFunction) {
      api.hookFunction(name, priority, handler);
      return true;
    }
    const original = window[name];
    if (typeof original !== "function") return false;
    if (original.__ycyWrapped) return true;
    const wrapped = function (...args) {
      return handler(args, nextArgs => original.apply(this, nextArgs));
    };
    wrapped.__ycyWrapped = true;
    window[name] = wrapped;
    return true;
  }

  function storeGet(key, fallback) {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function storeSet(key, value) {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  }

  function settings() {
    return Object.assign({
      enabled: false,
      consent: false,
      target: TARGET_USER,
      minIntervalMs: 2000,
      strengths: {
        hit: 1,
        shock: 2,
        touch: 1,
        toySync: 1
      }
    }, storeGet("settings", {}));
  }

  function saveSettings(nextSettings) {
    storeSet("settings", nextSettings);
  }

  function local(text, timeout) {
    if (typeof window.ChatRoomSendLocal === "function") {
      window.ChatRoomSendLocal(text, timeout);
    } else {
      console.log(`[${MOD_NAME}] ${text}`);
    }
  }

  function localHtml(html, timeout) {
    if (typeof window.ChatRoomMessage === "function" && typeof window.Player !== "undefined") {
      window.ChatRoomMessage({
        Type: "LocalMessage",
        Sender: Player.MemberNumber,
        Content: html,
        Timeout: timeout
      });
      return;
    }
    local(String(html).replace(/<[^>]+>/g, ""), timeout);
  }

  function localNode(node, timeout) {
    if (typeof window.ChatRoomSendLocal === "function") {
      window.ChatRoomSendLocal(node, timeout);
    } else {
      console.log(`[${MOD_NAME}] ${node.textContent || ""}`);
    }
  }

  function loadMessage() {
    localHtml(`<font color="Black">[YCY] 电击器联动工具 v0.1.0 载入！ 使用 /ycy help 查看说明</font>`, 60000);
  }

  function input() {
    return document.getElementById("InputChat");
  }

  function inputText() {
    const element = input();
    return typeof element?.value === "string" ? element.value : "";
  }

  function clearInput() {
    const element = input();
    if (element) element.value = "";
  }

  function rememberCommand(text) {
    if (Array.isArray(window.ChatRoomLastMessage)) {
      window.ChatRoomLastMessage.push(text);
      window.ChatRoomLastMessageIndex = window.ChatRoomLastMessage.length;
    }
  }

  function urlConnectCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("connect_code");
    if (code) {
      storeSet("connectCode", code.trim());
      return code.trim();
    }
    return "";
  }

  function connectCode() {
    return urlConnectCode() || storeGet("connectCode", "");
  }

  function parseConnectCode(value) {
    const text = String(value || "").trim();
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    const uid = parts[0].startsWith("game_") ? parts[0] : `game_${parts[0]}`;
    return {
      uid,
      token: parts.slice(1).join(""),
      connect_code: text
    };
  }

  function requestJson(method, url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Content-Type": "application/json" },
        data: data === undefined ? undefined : JSON.stringify(data),
        onload(response) {
          try {
            const parsed = JSON.parse(response.responseText || "{}");
            if (response.status >= 400) {
              reject(new Error(parsed.msg || parsed.error || `HTTP ${response.status}`));
            } else {
              resolve(parsed);
            }
          } catch (error) {
            reject(error);
          }
        },
        onerror: reject
      });
    });
  }

  async function getSign() {
    const parsed = parseConnectCode(connectCode());
    if (!parsed) throw new Error("没有有效 connect_code。请使用 /ycy code UID Token");
    const response = await requestJson("POST", SIGN_URL, {
      connect_code: parsed.connect_code,
      uid: parsed.uid,
      token: parsed.token
    });
    if (response.code !== 1 || !response.data?.appid || !response.data?.sign) {
      throw new Error(response.msg || "获取 IM 签名失败");
    }
    loginInfo = {
      uid: parsed.uid,
      token: parsed.token,
      appid: Number(response.data.appid),
      sign: response.data.sign
    };
    return loginInfo;
  }

  function existingTcSdk() {
    return window.$TC || window.TIM || window.TencentCloudChat || null;
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload(response) {
          if (response.status >= 400) {
            reject(new Error(`加载 Tencent IM SDK 失败：HTTP ${response.status}`));
          } else {
            resolve(response.responseText);
          }
        },
        onerror: reject
      });
    });
  }

  async function importFromSource(source) {
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      return await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function tcSdk() {
    const existing = existingTcSdk();
    if (existing) return existing;
    if (!sdkTask) {
      sdkTask = (async () => {
        const source = await fetchText(TC_SDK_URL);
        const module = await importFromSource(source);
        const sdk = module.default || module.TencentCloudChat;
        if (!sdk?.create || !sdk?.TYPES) throw new Error("Tencent IM SDK 加载后不可用");
        window.TencentCloudChat = sdk;
        return sdk;
      })();
    }
    return sdkTask;
  }

  async function login() {
    if (chat) return chat;
    const sdk = await tcSdk();
    const info = await getSign();
    const instance = sdk.create({ SDKAppID: info.appid });
    await instance.login({ userID: info.uid, userSig: info.sign });
    chat = instance;
    local(`YCY：IM 登录成功 ${info.uid}`);
    return chat;
  }

  function commandObject(id, payload) {
    const parsed = loginInfo || parseConnectCode(connectCode());
    const result = {
      code: "game_cmd",
      id,
      token: parsed?.token || ""
    };
    if (payload && Object.keys(payload).length > 0) result.payload = payload;
    return result;
  }

  function canSend(key, urgent) {
    const current = settings();
    if (!urgent && !current.enabled) return false;
    if (!urgent && !current.consent) return false;
    if (urgent) return true;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < current.minIntervalMs) return false;
    cooldowns.set(key, now);
    return true;
  }

  async function send(id, payload, options) {
    const urgent = Boolean(options?.urgent);
    if (!canSend(id, urgent)) return;
    const sdk = await tcSdk();
    const instance = await login();
    const message = instance.createTextMessage({
      to: String(settings().target || TARGET_USER),
      conversationType: sdk.TYPES.CONV_C2C,
      payload: {
        text: JSON.stringify(commandObject(id, payload))
      }
    });
    await instance.sendMessage(message);
  }

  function helpText() {
    const current = settings();
    return [
      "YCY 电击器联动",
      "/ycy help：显示说明",
      "/ycy code UID Token：保存 connect_code",
      "/ycy on / off：启用或关闭联动",
      "/ycy consent on / off：本次会话授权",
      "/ycy login：登录 Tencent IM",
      "/ycy sync：同步角色身上的玩具数据",
      "/ycy test hit|shock|touch：发送测试事件",
      "/ycy stop：紧急停止",
      `目标用户：${current.target || TARGET_USER}`,
      `状态：${current.enabled ? "已启用" : "未启用"}，授权：${current.consent ? "已授权" : "未授权"}`
    ].join("\n");
  }

  function splitCommand(text) {
    return String(text || "").trim().match(/".*?(?:"|$)|'.*?(?:'|$)|[^ ]+/g)?.map(part => {
      if ((part.startsWith("\"") && part.endsWith("\"")) || (part.startsWith("'") && part.endsWith("'"))) {
        return part.slice(1, -1);
      }
      return part;
    }) || [];
  }

  function updateSetting(mutator) {
    const current = settings();
    mutator(current);
    saveSettings(current);
  }

  function commandPrefix(text) {
    const lower = String(text || "").trimStart().toLowerCase();
    return COMMAND_PREFIXES.find(prefix => lower === prefix || lower.startsWith(`${prefix} `)) || null;
  }

  function commandBody(text, prefix) {
    return String(text || "").trimStart().slice(prefix.length).trimStart();
  }

  async function runCommand(text) {
    const prefix = commandPrefix(text);
    if (!prefix) return false;
    const body = commandBody(text, prefix);
    const argv = splitCommand(`${prefix} ${body}`);
    const sub = (argv[1] || "help").toLowerCase();
    if (sub === "help" || sub === "heklp" || sub === "帮助") {
      local(helpText(), 20000);
      return true;
    }
    if (sub === "code") {
      const value = body.replace(/^code\s+/i, "").trim();
      if (!parseConnectCode(value)) {
        local("YCY：connect_code 格式应为 UID Token");
        return true;
      }
      storeSet("connectCode", value);
      loginInfo = null;
      chat = null;
      local("YCY：connect_code 已保存");
      return true;
    }
    if (sub === "on") {
      updateSetting(s => { s.enabled = true; });
      local("YCY：联动已启用");
      return true;
    }
    if (sub === "off") {
      updateSetting(s => { s.enabled = false; });
      local("YCY：联动已关闭");
      return true;
    }
    if (sub === "consent") {
      const value = (argv[2] || "").toLowerCase();
      updateSetting(s => { s.consent = value === "on" || value === "yes" || value === "true"; });
      local(`YCY：本次会话授权 ${settings().consent ? "已开启" : "已关闭"}`);
      return true;
    }
    if (sub === "target") {
      const value = argv[2] || TARGET_USER;
      updateSetting(s => { s.target = value; });
      local(`YCY：目标用户已设为 ${value}`);
      return true;
    }
    if (sub === "login") {
      await login();
      return true;
    }
    if (sub === "sync") {
      await syncToys("command", true);
      local("YCY：已请求同步玩具数据");
      return true;
    }
    if (sub === "stop") {
      await send(IDS.stop, undefined, { urgent: true });
      local("YCY：已发送紧急停止");
      return true;
    }
    if (sub === "test") {
      const type = (argv[2] || "shock").toLowerCase();
      const map = { hit: IDS.hit, shock: IDS.shock, touch: IDS.touch };
      const id = map[type] || IDS.shock;
      await send(id, { source: "command_test", type, strength: type === "shock" ? 2 : 1 });
      local(`YCY：已发送测试 ${type}`);
      return true;
    }
    local("YCY：未知命令，使用 /ycy help");
    return true;
  }

  function runCommandBody(text) {
    return runCommand(`/ycy ${String(text || "").trim()}`);
  }

  function markCommandSent(text) {
    rememberCommand(text);
    clearInput();
  }

  function commandFromChatRoomCommandArgs(args) {
    const values = args.filter(value => typeof value === "string").map(value => value.trim()).filter(Boolean);
    if (values.length === 0) return "";
    const first = values[0].toLowerCase();
    if (first === "ycy" || first === "/ycy") {
      return ["/ycy"].concat(values.slice(1)).join(" ");
    }
    if (first.startsWith("/ycy ")) return values[0];
    return "";
  }

  function registerSlashCommand() {
    let attempts = 0;
    const register = () => {
      attempts++;
      try {
        if (typeof window.CommandCombine === "function") {
          window.CommandCombine([{
            Tag: "ycy",
            Description: "YCY 电击器联动",
            Action: text => {
              runCommandBody(text).catch(error => local(`YCY：${error.message || error}`));
            }
          }]);
          console.log("[YCY] /ycy command registered");
          return;
        }
      } catch (error) {
        console.warn("[YCY] register command failed", error);
      }
      if (attempts < 30) setTimeout(register, 1000);
    };
    register();
  }

  function hookCommands() {
    if (typeof window.ChatRoomCommand === "function") {
      hookFunction("ChatRoomCommand", 100, (args, next) => {
        const text = commandFromChatRoomCommandArgs(args);
        if (!text) return next(args);
        runCommand(text).catch(error => local(`YCY：${error.message || error}`));
        markCommandSent(inputText().trim() || text);
        return true;
      });
    }
    hookFunction("ChatRoomSendChat", 10, (args, next) => {
      const text = inputText().trim();
      if (!commandPrefix(text)) return next(args);
      runCommand(text).catch(error => local(`YCY：${error.message || error}`));
      markCommandSent(text);
      return;
    });
    hookFunction("ChatRoomKeyDown", 10, (args, next) => {
      const event = args[0];
      const text = inputText().trim();
      if (event?.key === "Enter" && commandPrefix(text)) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        runCommand(text).catch(error => local(`YCY：${error.message || error}`));
        markCommandSent(text);
        return true;
      }
      return next(args);
    });
    hookFunction("ChatRoomCreateElement", 0, (args, next) => {
      const result = next(args);
      inputElement = input();
      return result;
    });
    hookFunction("ChatRoomClearAllElements", 0, (args, next) => {
      inputElement = null;
      return next(args);
    });
  }

  function playerNumber() {
    return typeof Player?.MemberNumber === "number" ? Player.MemberNumber : null;
  }

  function messageText(data) {
    return [
      data?.Type,
      data?.Content,
      data?.Sender,
      data?.Target,
      data?.Dictionary && JSON.stringify(data.Dictionary)
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function messageTargetsPlayer(data) {
    const number = playerNumber();
    if (number == null) return true;
    const text = messageText(data);
    return text.includes(String(number));
  }

  function eventFromMessage(data) {
    if (!data || data.Type === "Hidden") return null;
    if (!messageTargetsPlayer(data)) return null;
    const text = messageText(data);
    if (/(shock|electro|electric|zap|estim|电击|触电|电刺激)/i.test(text)) return "shock";
    if (/(spank|slap|hit|punch|whip|strike|打|拍|抽|鞭|击打)/i.test(text)) return "hit";
    if (/(touch|grope|fondle|caress|rub|摸|触摸|抚摸|揉)/i.test(text)) return "touch";
    return null;
  }

  async function handleMessage(data) {
    const type = eventFromMessage(data);
    if (!type) return;
    const current = settings();
    const id = type === "shock" ? IDS.shock : type === "hit" ? IDS.hit : IDS.touch;
    await send(id, {
      source: "ChatRoomMessage",
      type,
      strength: current.strengths[type] || 1,
      player: playerNumber(),
      time: Date.now()
    });
  }

  function hookMessages() {
    hookFunction("ChatRoomMessage", 9, (args, next) => {
      const data = args[0];
      handleMessage(data).catch(error => console.warn(MOD_NAME, error));
      return next(args);
    });
  }

  function toys() {
    const appearance = Array.isArray(Player?.Appearance) ? Player.Appearance : [];
    const pattern = /(vibe|vibrator|shock|electro|estim|dildo|plug|电击|震动|玩具|按摩棒)/i;
    return appearance.filter(item => {
      const text = [
        item?.Asset?.Name,
        item?.Asset?.Description,
        item?.Asset?.Group?.Name,
        item?.Asset?.Group?.Description
      ].filter(Boolean).join(" ");
      return pattern.test(text);
    }).map(item => ({
      group: item?.Asset?.Group?.Name || "",
      name: item?.Asset?.Name || "",
      property: item?.Property || {}
    }));
  }

  async function syncToys(reason, force) {
    const data = toys();
    const signature = JSON.stringify(data);
    if (!force && signature === lastToySignature) return;
    lastToySignature = signature;
    await send(IDS.toySync, { source: "Player.Appearance", reason, toys: data });
  }

  let refreshTimer = null;

  function scheduleToySync(reason) {
    if (refreshTimer != null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      syncToys(reason, false).catch(error => console.warn(MOD_NAME, error));
    }, 300);
  }

  function hookToySync() {
    hookFunction("CharacterRefresh", 0, (args, next) => {
      const result = next(args);
      if (args[0] === Player) scheduleToySync("CharacterRefresh");
      return result;
    });
  }

  function initFromUrl() {
    urlConnectCode();
  }

  function load() {
    if (window.__YCY_BCX_STYLE_LOADED) return;
    window.__YCY_BCX_STYLE_LOADED = true;
    initFromUrl();
    registerSlashCommand();
    hookCommands();
    hookMessages();
    hookToySync();
    loadMessage();
  }

  function wait() {
    const timer = setInterval(() => {
      if (typeof window.Player !== "undefined") {
        clearInterval(timer);
        load();
      }
    }, 1000);
  }

  wait();
})();
