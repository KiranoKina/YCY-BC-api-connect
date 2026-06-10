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
// @grant        unsafeWindow
// @connect      suo.jiushu1234.com
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const MOD_NAME = "YCY_BC_Estim_Link";
  const MOD_VERSION = "0.1.0";
  const GAME_UNIQUE_CODE = "bondage club";
  const SIGN_URL = "https://suo.jiushu1234.com/api.php/user/game_sign";
  const TC_SDK_URL = "https://cdn.jsdelivr.net/npm/@tencentcloud/chat@3.6.6/index.es.js";
  const TARGET_USER = "10086";
  const STORE_PREFIX = "ycy_bcx_style_";
  const COMMAND_PREFIXES = ["/ycy"];
  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const IGNORE_CONTENT = new Set(["BCXMsg", "BCEMsg", "Preference", "Wardrobe", "SlowLeaveAttempt", "ServerUpdateRoom", "bctMsg"]);
  const IGNORE_TYPES = new Set(["Status", "Hidden"]);
  const IDS = {
    hit: "hit",
    shock: "shock",
    touch: "touch",
    toySync: "toy_sync",
    stop: "_stop_all"
  };
  const intensityModifiers = new Map();

  let modApi = null;
  let chat = null;
  let sdkTask = null;
  let loginTask = null;
  let sdkReadyTask = null;
  let sdkReady = false;
  let loginInfo = null;
  let lastToySignature = "";
  let inputElement = null;
  let loadedMessageShown = false;
  let socketHooked = false;
  let intensityRulesReady = false;
  let processedSocketMessages = new WeakSet();
  const stats = {
    seen: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    lastEvent: null,
    lastSend: null,
    lastMessageText: "",
    lastSkip: null,
    lastError: null
  };
  const cooldowns = new Map();
  const itemStates = new Map();
  const shockHistory = [];

  function initModApi() {
    if (modApi) return modApi;
    try {
      if (W.bcModSdk?.registerMod) {
        modApi = W.bcModSdk.registerMod({
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
    const original = W[name];
    if (typeof original !== "function") return false;
    if (original.__ycyWrapped) return true;
    const wrapped = function (...args) {
      return handler(args, nextArgs => original.apply(this, nextArgs));
    };
    wrapped.__ycyWrapped = true;
    W[name] = wrapped;
    return true;
  }

  function addModifier(key, modifier) {
    if (!intensityModifiers.has(key)) intensityModifiers.set(key, []);
    intensityModifiers.get(key).push(modifier);
    intensityModifiers.get(key).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  function addAction(actions, modifier) {
    const list = Array.isArray(actions) ? actions : [actions];
    for (const action of list) addModifier(`action:${action}`, modifier);
  }

  function addTarget(targets, modifier) {
    const list = Array.isArray(targets) ? targets : [targets];
    for (const target of list) addModifier(`target:${target}`, modifier);
  }

  function addItem(items, modifier) {
    const list = Array.isArray(items) ? items : [items];
    for (const item of list) addModifier(`item:${item}`, modifier);
  }

  function setupIntensityRules() {
    if (intensityRulesReady) return;
    intensityRulesReady = true;
    addAction(["Spank", "SpankItem", "Slap", "LSCG_Bap", "LSCG_SlapPenis"], { priority: 30, effect: () => 0.3 });
    addAction(["Kick", "Pinch", "LSCG_Flick", "轻弹额头", "弹阴蒂"], { priority: 30, effect: () => 0.2 });
    addAction("Bite", { priority: 30, effect: () => 0.3 });
    addAction("Nibble", { priority: 30, effect: () => 0.15 });
    addAction(["Caress", "MassageHands", "Grope", "Pinch", "Lick", "Kiss", "XSAct_头蹭", "XSAct_脸蹭", "XSAct_鼻子蹭", "Cuddle", "摇晃手臂", "LSCG_Nuzzle", "LSCG_Hug"], { priority: 30, effect: () => 0.1 });
    addAction(["TriggerShock0", "ShockLow"], { priority: 30, effect: () => 0.4 });
    addAction(["TriggerShock1", "ShockMed"], { priority: 30, effect: () => 0.6 });
    addAction(["TriggerShock2", "ShockHigh"], { priority: 30, effect: () => 0.8 });
    addAction("ShockItem", { priority: 30, effect: () => 0.6 });
    addAction(["Masturbate", "MasturbateHand", "MasturbateItem", "MasturbateFist", "MasturbateTongue", "MasturbateFoot"], { priority: 30, effect: () => 0.5 });
    addAction(["PenetrateSlow", "PenetrateFast"], { priority: 30, effect: () => 0.55 });
    addAction(["Rub", "RubItem"], { priority: 30, effect: () => 0.35 });
    addAction(["Tickle", "TickleItem"], { priority: 30, effect: () => 0.3 });
    addAction("RollItem", { priority: 30, effect: () => 0.3 });
    addTarget("ItemBreast", { priority: 20, effect: intensity => intensity * 1.2 });
    addTarget("ItemNipples", { priority: 20, effect: intensity => intensity * 1.2 });
    addTarget("ItemTorso", { priority: 20, effect: intensity => intensity * 1.3 });
    addTarget("ItemVulvaPiercings", { priority: 20, effect: intensity => intensity * 1.5 });
    addItem(["HeartCrop", "WhipPaddle", "Whip", "Crop", "Belt", "Flogger"], { priority: 10, effect: intensity => intensity * 1.3 });
    addItem(["Ruler", "Gavel", "Paddle", "TennisRacket", "Spatula"], { priority: 10, effect: intensity => intensity * 1.2 });
    addItem(["Cane", "Broom", "Baguette", "Sword", "AnimeGirlWand", "PetToy"], { priority: 10, effect: intensity => intensity * 1.1 });
  }

  function calculateIntensity(action, target, item) {
    const modifiers = [];
    if (intensityModifiers.has(`action:${action}`)) modifiers.push(...intensityModifiers.get(`action:${action}`));
    if (target && intensityModifiers.has(`target:${target}`)) modifiers.push(...intensityModifiers.get(`target:${target}`));
    if (item && intensityModifiers.has(`item:${item}`)) modifiers.push(...intensityModifiers.get(`item:${item}`));
    modifiers.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    let intensity = 0;
    for (const modifier of modifiers) {
      intensity = modifier.effect(intensity);
    }
    return Math.max(0, Math.min(1, intensity));
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

  function rawSettings() {
    return storeGet("settings", {});
  }

  function settings() {
    const stored = rawSettings();
    const current = Object.assign({
      enabled: false,
      autoStart: true,
      debug: false,
      payloadMode: "simple",
      target: "",
      targetMode: "auto",
      minIntervalMs: 2000,
      commandIds: {
        hit: IDS.hit,
        shock: IDS.shock,
        touch: IDS.touch,
        toySync: IDS.toySync
      },
      waveforms: {
        hit: "",
        shock: "",
        touch: "",
        toySync: ""
      },
      strengths: {
        hit: 1,
        shock: 2,
        touch: 1,
        toySync: 1
      }
    }, stored);
    if (!current.commandIds) current.commandIds = {};
    if (!current.waveforms) current.waveforms = {};
    for (const key of ["hit", "shock", "touch", "toySync"]) {
      if (/^(on|true|yes|开)$/i.test(String(current.waveforms[key] || ""))) current.waveforms[key] = "";
    }
    const legacy = {
      ycy_bc_hit: IDS.hit,
      ycy_bc_shock: IDS.shock,
      ycy_bc_touch: IDS.touch,
      ycy_bc_toy_sync: IDS.toySync
    };
    for (const key of ["hit", "shock", "touch", "toySync"]) {
      const value = current.commandIds[key];
      if (legacy[value]) current.commandIds[key] = legacy[value];
    }
    if (stored.target && !Object.prototype.hasOwnProperty.call(stored, "targetMode")) {
      current.target = "";
      current.targetMode = "auto";
      saveSettings(current);
    }
    return current;
  }

  function saveSettings(nextSettings) {
    storeSet("settings", nextSettings);
  }

  function local(text, timeout) {
    if (typeof W.ChatRoomSendLocal === "function") {
      W.ChatRoomSendLocal(text, timeout);
    } else {
      console.log(`[${MOD_NAME}] ${text}`);
    }
  }

  function localHtml(html, timeout) {
    if (typeof W.ChatRoomMessage === "function" && typeof W.Player !== "undefined") {
      W.ChatRoomMessage({
        Type: "LocalMessage",
        Sender: W.Player.MemberNumber,
        Content: html,
        Timeout: timeout
      });
      return;
    }
    local(String(html).replace(/<[^>]+>/g, ""), timeout);
  }

  function localNode(node, timeout) {
    if (typeof W.ChatRoomSendLocal === "function") {
      W.ChatRoomSendLocal(node, timeout);
    } else {
      console.log(`[${MOD_NAME}] ${node.textContent || ""}`);
    }
  }

  function loadMessage() {
    if (loadedMessageShown) return;
    if (W.CurrentScreen !== "ChatRoom") return;
    loadedMessageShown = true;
    localHtml(`<font color="Black">[YCY Link] 已就绪 v0.1.0<br>输入 /ycy help 打开联动说明。</font>`, 60000);
  }

  function scheduleLoadMessage() {
    let attempts = 0;
    const tick = () => {
      attempts++;
      loadMessage();
      if (!loadedMessageShown && attempts < 120) setTimeout(tick, 500);
    };
    tick();
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
    if (Array.isArray(W.ChatRoomLastMessage)) {
      W.ChatRoomLastMessage.push(text);
      W.ChatRoomLastMessageIndex = W.ChatRoomLastMessage.length;
    }
  }

  function urlConnectCode() {
    const params = new URLSearchParams(W.location.search);
    const code = params.get("connect_code");
    if (code) {
      const parsed = saveConnectCode(code.trim());
      return parsed?.connect_code || code.trim();
    }
    return "";
  }

  function connectCode() {
    return urlConnectCode() || storeGet("connectCode", "");
  }

  function extractConnectCode(value) {
    const text = String(value || "").trim();
    if (!text) return urlConnectCode();
    try {
      const url = new URL(text, W.location.href);
      const code = url.searchParams.get("connect_code");
      if (code) return code.trim();
    } catch {
    }
    const match = text.match(/(?:^|[?&])connect_code=([^&#]+)/i) || text.match(/connect_code\s*[:=]\s*(.+)$/i);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
    return text;
  }

  function parseConnectCode(value) {
    const text = String(value || "").trim();
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    const uid = parts[0].startsWith("game_") ? parts[0] : `game_${parts[0]}`;
    const target = uid.replace(/^game_/, "");
    return {
      uid,
      target,
      token: parts.slice(1).join(""),
      connect_code: text
    };
  }

  function saveConnectCode(value) {
    const parsed = parseConnectCode(value);
    if (!parsed) return null;
    storeSet("connectCode", parsed.connect_code);
    const current = settings();
    if (current.targetMode !== "manual") {
      current.target = "";
      current.targetMode = "auto";
      saveSettings(current);
    }
    return parsed;
  }

  function autoTargetUser() {
    return parseConnectCode(connectCode())?.target || TARGET_USER;
  }

  function targetUser() {
    const current = settings();
    return current.targetMode === "manual" && current.target ? current.target : autoTargetUser();
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

  function requestForm(method, url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: new URLSearchParams(data).toString(),
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

  async function requestSign(parsed) {
    try {
      return await requestJson("POST", SIGN_URL, {
        connect_code: parsed.connect_code,
        uid: parsed.uid,
        token: parsed.token
      });
    } catch (error) {
      debugLog("sign json failed, retry form", error);
      return requestForm("POST", SIGN_URL, {
        uid: parsed.uid,
        token: parsed.token
      });
    }
  }

  async function getSign() {
    const parsed = parseConnectCode(connectCode());
    if (!parsed) throw new Error("没有有效 connect_code。请使用 /ycy code UID Token");
    const response = await requestSign(parsed);
    if (response.code !== 1 || !response.data?.appid || !response.data?.sign) {
      throw new Error(response.msg || "获取 IM 签名失败");
    }
    loginInfo = {
      uid: parsed.uid,
      target: parsed.target,
      token: parsed.token,
      appid: Number(response.data.appid),
      sign: response.data.sign
    };
    return loginInfo;
  }

  function existingTcSdk() {
    return W.$TC || W.TIM || W.TencentCloudChat || null;
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
        W.TencentCloudChat = sdk;
        return sdk;
      })();
    }
    return sdkTask;
  }

  function waitForSdkReady(instance, sdk) {
    if (sdkReady) return Promise.resolve();
    if (sdkReadyTask) return sdkReadyTask;
    const eventName = sdk?.EVENT?.SDK_READY || sdk?.EVENT?.READY || "sdkStateReady";
    sdkReadyTask = new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sdkReady = true;
        resolve();
      };
      const fail = error => {
        if (done) return;
        done = true;
        sdkReadyTask = null;
        reject(error);
      };
      try {
        if (typeof instance.on === "function") {
          instance.on(eventName, finish);
          if (sdk?.EVENT?.SDK_NOT_READY) {
            instance.on(sdk.EVENT.SDK_NOT_READY, () => {
              sdkReady = false;
            });
          }
        }
      } catch (error) {
        fail(error);
        return;
      }
      setTimeout(() => fail(new Error("Tencent IM SDK_READY 等待超时")), 15000);
    });
    return sdkReadyTask;
  }

  async function login() {
    if (chat) {
      await waitForSdkReady(chat, await tcSdk());
      return chat;
    }
    if (loginTask) return loginTask;
    loginTask = (async () => {
      const sdk = await tcSdk();
      const info = await getSign();
      const instance = sdk.create({ SDKAppID: info.appid });
      sdkReady = false;
      sdkReadyTask = null;
      await instance.login({ userID: info.uid, userSig: info.sign });
      chat = instance;
      await waitForSdkReady(instance, sdk);
      local(`YCY：IM 登录成功 ${info.uid}`);
      return chat;
    })();
    try {
      return await loginTask;
    } finally {
      loginTask = null;
    }
  }

  function commandIdValue(id) {
    const text = String(id);
    if (/^\d+$/.test(text)) return Number(text);
    return id;
  }

  function commandObject(id, payload, options) {
    const parsed = loginInfo || parseConnectCode(connectCode());
    const result = {
      code: "game_cmd",
      id: options?.stringId ? String(id) : commandIdValue(id)
    };
    if (!options?.omitToken) result.token = parsed?.token || "";
    const mode = settings().payloadMode || "simple";
    const hasControlPayload = Boolean(payload && payload.reset_strength);
    const shouldSendPayload = options?.forcePayload || mode === "full" || hasControlPayload;
    if (shouldSendPayload && payload && Object.keys(payload).length > 0) result.payload = payload;
    return result;
  }

  function debugLog(...args) {
    if (settings().debug) console.log("[YCY]", ...args);
  }

  function rememberEvent(source, data) {
    stats.seen += 1;
    stats.lastEvent = {
      source,
      time: new Date().toLocaleTimeString(),
      type: data?.Type || data?.type || "",
      content: data?.Content || data?.actionName || data?.event || ""
    };
    debugLog("event", source, data);
  }

  function canSend(key, urgent) {
    const current = settings();
    if (!urgent && !current.enabled) return "联动未启用";
    if (urgent) return "";
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < current.minIntervalMs) return "冷却中";
    cooldowns.set(key, now);
    return "";
  }

  async function sendTo(targetOverride, id, payload, options) {
    const urgent = Boolean(options?.urgent);
    const blocked = canSend(id, urgent);
    if (blocked) {
      stats.skipped += 1;
      stats.lastSkip = {
        id,
        reason: blocked,
        time: new Date().toLocaleTimeString()
      };
      debugLog("skip", stats.lastSkip, payload);
      return false;
    }
    try {
      const sdk = await tcSdk();
      const instance = await login();
      const target = String(targetOverride || targetUser());
      const messageText = JSON.stringify(commandObject(id, payload, options));
      const message = instance.createTextMessage({
        to: target,
        conversationType: sdk.TYPES.CONV_C2C,
        payload: {
          text: messageText
        }
      });
      await instance.sendMessage(message);
      stats.sent += 1;
      stats.lastMessageText = messageText;
      stats.lastSend = {
        id,
        target,
        time: new Date().toLocaleTimeString()
      };
      debugLog("send", stats.lastSend, payload);
      return true;
    } catch (error) {
      if (!urgent) cooldowns.delete(id);
      stats.failed += 1;
      stats.lastError = {
        id,
        message: error?.message || String(error),
        time: new Date().toLocaleTimeString()
      };
      debugLog("send failed", stats.lastError, payload);
      throw error;
    }
  }

  async function send(id, payload, options) {
    return sendTo(null, id, payload, options);
  }

  async function startLink(reason) {
    const parsed = parseConnectCode(connectCode());
    if (!parsed) {
      local("YCY：没有检测到连接码，请从 App 启动游戏或使用 /ycy link 连接码");
      return false;
    }
    updateSetting(s => {
      s.enabled = true;
      if (s.targetMode !== "manual") {
        s.target = "";
        s.targetMode = "auto";
      }
    });
    await login();
    syncToys(reason || "start", true).catch(error => console.warn(MOD_NAME, error));
    local(`YCY：联动已启动，目标用户 ${targetUser()}，指令ID 使用默认 hit/shock/touch/toy_sync`);
    return true;
  }

  function searchMsgDictionary(msg, tag, subKey = null) {
    if (!msg || !Array.isArray(msg.Dictionary)) return null;
    for (let i = 0; i < msg.Dictionary.length; i++) {
      const entry = msg.Dictionary[i];
      if (!entry || typeof entry !== "object") continue;
      const keys = Object.keys(entry);
      const values = Object.values(entry);
      if (keys[0] === tag) return values[0];
      const subKeyIndex = keys.indexOf(subKey);
      if (keys[0] === "Tag" && values[0] === tag && subKeyIndex >= 0) {
        return values[subKeyIndex];
      }
    }
    return null;
  }

  function playerAssetByName(assetName) {
    return W.Player?.Appearance?.find(item => item?.Asset?.Name === assetName) || null;
  }

  function playerAssetBySlot(slotName) {
    return W.Player?.Appearance?.find(item => item?.Asset?.DynamicGroupName === slotName || item?.Asset?.Group?.Name === slotName) || null;
  }

  function shockLevelFromMsg(data) {
    if (data?.Content === "TriggerShock0") return 0;
    if (data?.Content === "TriggerShock1") return 1;
    if (data?.Content === "TriggerShock2") return 2;
    return -1;
  }

  function classifyAction(...values) {
    const text = values.map(value => String(value || "")).join(" ").toLowerCase();
    if (/shock|zap|electro|electric/.test(text)) return "shock";
    if (/triggershock|电击|触电|电刺激/.test(text)) return "shock";
    if (/spank|slap|hit|punch|whip|strike|kick|crop|cane|flog|paddle|impact/.test(text)) return "hit";
    if (/打|拍|抽|鞭|踢|击打|掌掴|拍打/.test(text)) return "hit";
    return "touch";
  }

  function idForEventType(type) {
    const current = settings();
    if (type === "shock") return current.commandIds?.shock || IDS.shock;
    if (type === "hit") return current.commandIds?.hit || IDS.hit;
    return current.commandIds?.touch || IDS.touch;
  }

  function commandId(type) {
    const current = settings();
    if (type === "toySync") return current.commandIds?.toySync || IDS.toySync;
    return idForEventType(type);
  }

  function eventPayload(type, payload) {
    const current = settings();
    const waveform = current.waveforms?.[type] || "";
    const result = {
      event: type,
      ...payload
    };
    if (waveform) result.waveform = waveform;
    return result;
  }

  async function sendGameEvent(type, payload, options) {
    return send(commandId(type), eventPayload(type, payload), options);
  }

  function defaultIntensity(type, action, target, item) {
    if (type === "shock") return 0.6;
    if (type === "hit") return 0.35;
    if (/penetrate|masturbate/i.test(String(action || ""))) return 0.45;
    if (/vulva|butt|pelvis|nipples|breast/i.test(String(target || ""))) return 0.24;
    if (item) return 0.2;
    return 0.15;
  }

  async function sendActivityLike(type, payload) {
    const action = payload?.actionName || payload?.type || "";
    const target = payload?.assetGroupName || "";
    const item = payload?.assetName || "";
    let intensity = calculateIntensity(action, target, item);
    if (intensity <= 0) intensity = defaultIntensity(type, action, target, item);
    await sendGameEvent(type, {
      ...payload,
      intensity,
      intensityPercent: Math.round(intensity * 100)
    });
  }

  function setItemState(slot, itemName, effect, level) {
    if (!slot || level == null || itemName == null) return false;
    if (!itemStates.has(slot)) itemStates.set(slot, { itemName: null, effects: new Map() });
    const state = itemStates.get(slot);
    state.itemName = itemName;
    if (state.effects.get(effect) === level) return false;
    state.effects.set(effect, level);
    return true;
  }

  async function sendToyState(effect, slot, itemName, level, source) {
    if (!setItemState(slot, itemName, effect, level)) return;
    await sendGameEvent("toySync", {
      source,
      effect,
      assetGroupName: slot,
      itemName,
      level
    });
  }

  function propertyLevelEntries(property, prefix = "") {
    if (!property || typeof property !== "object") return [];
    const entries = [];
    for (const [key, value] of Object.entries(property)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
        if (/intensity|level|power|mode|inflate|vibrat|shock|suction|tight|state/i.test(path)) {
          entries.push([path, value]);
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        entries.push(...propertyLevelEntries(value, path));
      }
    }
    return entries;
  }

  async function updateOngoingItemDetails(item, source) {
    if (!item?.Asset) return;
    const slot = item.Asset.DynamicGroupName || item.Asset.Group?.Name;
    const itemName = item.Asset.Name;
    if (item.Property?.Intensity != null) {
      await sendToyState("Vibration", slot, itemName, Number(item.Property.Intensity) + 1, source);
    }
    if (item.Property?.InflateLevel != null) {
      await sendToyState("Inflation", slot, itemName, Number(item.Property.InflateLevel), source);
    }
    for (const [effect, value] of propertyLevelEntries(item.Property)) {
      if (effect === "Intensity" || effect === "InflateLevel") continue;
      await sendToyState(effect, slot, itemName, value, source);
    }
  }

  function clearOldShocks() {
    const now = Date.now();
    while (shockHistory.length > 0 && now - shockHistory[0][0] > 500) {
      shockHistory.shift();
    }
  }

  function hasRecentShock(slot, level) {
    clearOldShocks();
    return shockHistory.some(row => row[1] === slot && row[2] === level);
  }

  async function sendShockEvent(slot, level, assetName, source) {
    if (slot == null || level < 0 || level > 2) return;
    if (hasRecentShock(slot, level)) return;
    shockHistory.push([Date.now(), slot, level, assetName]);
    const actionName = ["ShockLow", "ShockMed", "ShockHigh"][level];
    const intensity = calculateIntensity(actionName, slot, assetName);
    await sendGameEvent("shock", {
      source,
      assetGroupName: slot,
      actionName,
      rawActionName: ["TriggerShock0", "TriggerShock1", "TriggerShock2"][level],
      assetName,
      level,
      intensity,
      intensityPercent: Math.round(intensity * 100)
    });
  }

  function helpText() {
    const current = settings();
    return [
      "YCY 电击器联动",
      "/ycy start：一键载入、启用、登录、同步",
      "/ycy help：显示说明",
      "/ycy status：查看接入状态",
      "/ycy code UID Token：保存 connect_code",
      "/ycy link 链接或链接码：载入 connect_code",
      "/ycy load：从当前网址载入 connect_code",
      "/ycy on / off：启用或关闭联动",
      "/ycy pause / resume：暂停或恢复联动",
      "/ycy map hit|shock|touch|toy 指令ID [波形]：连接游戏事件与 App 指令",
      "/ycy map all hitID shockID touchID toyID [波形]：批量连接指令",
      "/ycy waveform hit|shock|touch|toy|all 波形|off：设置事件波形",
      "/ycy payload simple / full：切换发送格式，simple 更接近 YCY 示例",
      "/ycy target auto：自动读取连接码 UID 作为目标用户",
      "/ycy autostart on / off：从 App 启动时自动启用",
      "/ycy login：登录 Tencent IM",
      "/ycy reconnect：重新登录 Tencent IM",
      "/ycy sync：同步角色身上的玩具数据",
      "/ycy test hit|shock|touch：发送测试事件",
      "/ycy probe shock|hit|touch|toy|指令ID：发送多种兼容包测试 App 识别方式",
      "/ycy rawshock [波形]：发送最小电击器测试包",
      "/ycy reset hit|shock|touch：重置对应指令强度递增",
      "/ycy intensity Action Group Item：预览强度",
      "/ycy debug on / off：打开或关闭控制台调试",
      "/ycy stop：紧急停止",
      `目标用户：${targetUser()}${current.targetMode === "manual" ? "（手动）" : "（自动）"}`,
      `状态：${current.enabled ? "已启用" : "未启用"}，自动启动：${current.autoStart ? "开" : "关"}`
    ].join("\n");
  }

  function statusText() {
    const current = settings();
    const parsed = parseConnectCode(connectCode());
    const imState = chat ? sdkReady ? "已就绪" : "已登录未就绪" : loginTask ? "登录中" : "未登录";
    const lastEvent = stats.lastEvent ? `${stats.lastEvent.time} ${stats.lastEvent.source} ${stats.lastEvent.type || ""} ${stats.lastEvent.content || ""}` : "无";
    const lastSend = stats.lastSend ? `${stats.lastSend.time} ${stats.lastSend.id} -> ${stats.lastSend.target}` : "无";
    const lastSkip = stats.lastSkip ? `${stats.lastSkip.time} ${stats.lastSkip.id}：${stats.lastSkip.reason}` : "无";
    const lastError = stats.lastError ? `${stats.lastError.time} ${stats.lastError.id}：${stats.lastError.message}` : "无";
    const lastMessage = stats.lastMessageText || "无";
    const waveformLine = current.payloadMode === "full"
      ? `波形：hit=${current.waveforms?.hit || "默认"}；shock=${current.waveforms?.shock || "默认"}；touch=${current.waveforms?.touch || "默认"}；toy=${current.waveforms?.toySync || "默认"}`
      : `波形：simple模式普通事件不发送波形；full/raw/reset 时使用 hit=${current.waveforms?.hit || "默认"}；shock=${current.waveforms?.shock || "默认"}；touch=${current.waveforms?.touch || "默认"}；toy=${current.waveforms?.toySync || "默认"}`;
    return [
      "YCY 接入状态",
      `游戏唯一码：${GAME_UNIQUE_CODE}`,
      `联动：${current.enabled ? "已启用" : "未启用"}；自动启动：${current.autoStart ? "开" : "关"}；调试：${current.debug ? "开" : "关"}`,
      `目标用户：${targetUser()}${current.targetMode === "manual" ? "（手动）" : "（自动，从连接码UID读取）"}`,
      `指令ID：hit=${current.commandIds?.hit || IDS.hit}；shock=${current.commandIds?.shock || IDS.shock}；touch=${current.commandIds?.touch || IDS.touch}；toy=${current.commandIds?.toySync || IDS.toySync}`,
      `发送格式：${current.payloadMode === "full" ? "full（带payload）" : "simple（仅code/id/token）"}`,
      waveformLine,
      `connect_code：${parsed ? "已设置" : "未设置"}；IM：${imState}；SDK：${existingTcSdk() ? "已加载" : sdkTask ? "加载中/已缓存" : "未加载"}`,
      `房间：${W.CurrentScreen || "未知"}；玩家：${playerNumber() || "未知"}；socket监听：${socketHooked ? "是" : "否"}`,
      `事件：看见 ${stats.seen}，发送 ${stats.sent}，跳过 ${stats.skipped}，失败 ${stats.failed}`,
      `最后事件：${lastEvent}`,
      `最后发送：${lastSend}`,
      `最后包体：${lastMessage}`,
      `最后跳过：${lastSkip}`,
      `最后错误：${lastError}`
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

  function normalizeEventKey(value) {
    const text = String(value || "").toLowerCase();
    if (text === "all" || text === "全部") return "all";
    if (text === "toy" || text === "toys" || text === "toysync" || text === "sync") return "toySync";
    if (text === "shock" || text === "hit" || text === "touch") return text;
    return "";
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
    if (sub === "start" || sub === "启动") {
      await startLink("command_start");
      return true;
    }
    if (sub === "status" || sub === "stat" || sub === "状态") {
      local(statusText(), 30000);
      return true;
    }
    if (sub === "code" || sub === "link" || sub === "load" || sub === "链接" || sub === "载入") {
      const value = extractConnectCode(body.replace(/^(code|link|load|链接|载入)\s*/i, "").trim());
      if (!parseConnectCode(value)) {
        local("YCY：链接码格式不正确。可以粘贴 UID Token，或带 connect_code= 的完整链接");
        return true;
      }
      const parsed = saveConnectCode(value);
      loginInfo = null;
      chat = null;
      local(`YCY：链接码已载入，目标用户自动识别为 ${parsed.target}。接下来可使用 /ycy login 登录`);
      return true;
    }
    if (sub === "on" || sub === "resume") {
      updateSetting(s => { s.enabled = true; });
      local("YCY：联动已启用");
      return true;
    }
    if (sub === "off" || sub === "pause") {
      updateSetting(s => { s.enabled = false; });
      local("YCY：联动已关闭");
      return true;
    }
    if (sub === "autostart") {
      const value = (argv[2] || "on").toLowerCase();
      updateSetting(s => { s.autoStart = !(value === "off" || value === "false" || value === "0" || value === "关"); });
      local(`YCY：自动启动已${settings().autoStart ? "开启" : "关闭"}`);
      return true;
    }
    if (sub === "consent") {
      local("YCY：现在不再需要二次授权。使用 /ycy on 即可启用联动");
      return true;
    }
    if (sub === "map") {
      const key = normalizeEventKey(argv[2]);
      if (key === "all") {
        const hitId = argv[3] || "";
        const shockId = argv[4] || "";
        const touchId = argv[5] || "";
        const toyId = argv[6] || "";
        const waveform = argv.slice(7).join(" ").trim();
        const waveformIsDefault = /^(on|true|yes|开)$/i.test(waveform);
        if (!hitId || !shockId || !touchId || !toyId) {
          local("YCY：用法 /ycy map all hitID shockID touchID toyID [波形]");
          return true;
        }
        updateSetting(s => {
          if (!s.commandIds) s.commandIds = {};
          if (!s.waveforms) s.waveforms = {};
          s.commandIds.hit = hitId;
          s.commandIds.shock = shockId;
          s.commandIds.touch = touchId;
          s.commandIds.toySync = toyId;
          if (waveform && !waveformIsDefault) {
            s.waveforms.hit = waveform;
            s.waveforms.shock = waveform;
            s.waveforms.touch = waveform;
            s.waveforms.toySync = waveform;
          }
        });
        local(`YCY：已批量连接 hit=${hitId}，shock=${shockId}，touch=${touchId}，toy=${toyId}${waveform && !waveformIsDefault ? `，统一波形 ${waveform}` : ""}`);
        return true;
      }
      const id = argv[3] || "";
      if (!key || !id) {
        local("YCY：用法 /ycy map hit|shock|touch|toy 指令ID [波形]，或 /ycy map all hitID shockID touchID toyID [波形]");
        return true;
      }
      const waveform = argv.slice(4).join(" ").trim();
      const waveformIsDefault = /^(on|true|yes|开)$/i.test(waveform);
      updateSetting(s => {
        if (!s.commandIds) s.commandIds = {};
        if (!s.waveforms) s.waveforms = {};
        s.commandIds[key] = id;
        if (waveform && !waveformIsDefault) s.waveforms[key] = waveform;
      });
      local(`YCY：${key} 已连接到 App 指令 ${id}${waveform && !waveformIsDefault ? `，波形 ${waveform}` : ""}`);
      return true;
    }
    if (sub === "waveform") {
      const key = normalizeEventKey(argv[2]);
      const waveform = argv.slice(3).join(" ").trim();
      if (!key || !waveform) {
        local("YCY：用法 /ycy waveform hit|shock|touch|toy|all 波形|off");
        return true;
      }
      updateSetting(s => {
        if (!s.waveforms) s.waveforms = {};
        const value = /^(off|none|default|默认|on|true|yes|开)$/i.test(waveform) ? "" : waveform;
        if (key === "all") {
          s.waveforms.hit = value;
          s.waveforms.shock = value;
          s.waveforms.touch = value;
          s.waveforms.toySync = value;
        } else {
          s.waveforms[key] = value;
        }
      });
      if (key === "all") {
        local(`YCY：全部事件波形已设为 ${settings().waveforms?.shock || "App 默认波形"}`);
      } else {
        local(`YCY：${key} 波形已设为 ${settings().waveforms?.[key] || "App 默认波形"}`);
      }
      return true;
    }
    if (sub === "payload") {
      const value = (argv[2] || "simple").toLowerCase();
      if (!["simple", "full"].includes(value)) {
        local("YCY：用法 /ycy payload simple|full");
        return true;
      }
      updateSetting(s => { s.payloadMode = value; });
      local(value === "full" ? "YCY：发送格式已改为 full，会附带事件 payload" : "YCY：发送格式已改为 simple，仅发送 code/id/token");
      return true;
    }
    if (sub === "target") {
      const value = argv[2] || "auto";
      if (value.toLowerCase() === "auto") {
        updateSetting(s => {
          s.target = "";
          s.targetMode = "auto";
        });
        local(`YCY：目标用户已改为自动读取连接码 UID：${targetUser()}`);
      } else {
        updateSetting(s => {
          s.target = value;
          s.targetMode = "manual";
        });
        local(`YCY：目标用户已手动设为 ${value}`);
      }
      return true;
    }
    if (sub === "debug") {
      const value = (argv[2] || "").toLowerCase();
      updateSetting(s => { s.debug = value === "on" || value === "yes" || value === "true" || value === "1"; });
      local(`YCY：控制台调试已${settings().debug ? "开启" : "关闭"}`);
      return true;
    }
    if (sub === "login") {
      await login();
      return true;
    }
    if (sub === "reconnect" || sub === "relogin") {
      if (chat?.logout) {
        try {
          await chat.logout();
        } catch (error) {
          console.warn("[YCY] logout failed", error);
        }
      }
      chat = null;
      loginTask = null;
      sdkReadyTask = null;
      sdkReady = false;
      loginInfo = null;
      await login();
      local("YCY：已重新登录 Tencent IM");
      return true;
    }
    if (sub === "sync") {
      const ok = await syncToys("command", true);
      local(ok ? "YCY：已请求同步玩具数据" : `YCY：同步未发送，原因：${stats.lastSkip?.reason || "未知"}`);
      return true;
    }
    if (sub === "stop") {
      const ok = await send(IDS.stop, undefined, { urgent: true });
      local(ok ? "YCY：已发送紧急停止" : `YCY：紧急停止未发送，原因：${stats.lastSkip?.reason || "未知"}`);
      return true;
    }
    if (sub === "reset") {
      const key = normalizeEventKey(argv[2] || "shock");
      if (!key || key === "toySync") {
        local("YCY：用法 /ycy reset hit|shock|touch");
        return true;
      }
      const ok = await send(commandId(key), eventPayload(key, {
        source: "command_reset",
        reset_strength: true
      }), { forcePayload: true });
      local(ok ? `YCY：已发送 ${key} 强度重置` : `YCY：强度重置未发送，原因：${stats.lastSkip?.reason || "未知"}`);
      return true;
    }
    if (sub === "rawshock") {
      const waveform = argv.slice(2).join(" ").trim() || settings().waveforms?.shock || "";
      const payload = { reset_strength: true };
      if (waveform) payload.waveform = waveform;
      const ok = await send(commandId("shock"), payload, { urgent: true, forcePayload: true });
      local(ok ? `YCY：已发送最小电击器测试包${waveform ? `，波形 ${waveform}` : ""}` : `YCY：最小测试包未发送，原因：${stats.lastSkip?.reason || "未知"}`);
      return true;
    }
    if (sub === "probe" || sub === "诊断") {
      const raw = argv[2] || "shock";
      const key = normalizeEventKey(raw);
      const id = key ? commandId(key) : raw;
      const rawTarget = String(targetUser());
      const gameTarget = rawTarget.startsWith("game_") ? rawTarget : `game_${rawTarget}`;
      const variants = [
        ["A", rawTarget, id, { urgent: true }],
        ["B", rawTarget, id, { urgent: true, stringId: true }],
        ["C", gameTarget, id, { urgent: true }],
        ["D", rawTarget, id, { urgent: true, omitToken: true }]
      ];
      const lines = [];
      for (const [label, target, variantId, options] of variants) {
        try {
          const ok = await sendTo(target, variantId, undefined, options);
          lines.push(`${label} ${ok ? "已发" : "未发"}：to=${target} id=${options.stringId ? `"${variantId}"` : commandIdValue(variantId)}${options.omitToken ? " 无token" : ""}`);
          await new Promise(resolve => setTimeout(resolve, 250));
        } catch (error) {
          lines.push(`${label} 失败：${error?.message || error}`);
        }
      }
      local(`YCY：probe 完成，请看 App 哪一次有反应\n${lines.join("\n")}`, 30000);
      return true;
    }
    if (sub === "intensity" || sub === "强度") {
      const action = argv[2] || "TriggerShock1";
      const target = argv[3] || "ItemVulva";
      const item = argv[4] || "";
      const type = classifyAction(action, target, item);
      let intensity = calculateIntensity(action, target, item);
      if (intensity <= 0) intensity = defaultIntensity(type, action, target, item);
      local(`YCY：${action} / ${target} / ${item || "无物品"} = ${Math.round(intensity * 100)}%（${type}）`);
      return true;
    }
    if (sub === "test") {
      const type = (argv[2] || "shock").toLowerCase();
      const key = normalizeEventKey(type) || "shock";
      const actionName = type === "shock" ? "TriggerShock1" : type === "hit" ? "Spank" : "Caress";
      const intensity = calculateIntensity(actionName, "ItemVulva", "");
      const ok = await sendGameEvent(key, {
        source: "command_test",
        type: key,
        actionName,
        assetGroupName: "ItemVulva",
        strength: key === "shock" ? 2 : 1,
        intensity,
        intensityPercent: Math.round(intensity * 100)
      });
      local(ok ? `YCY：已发送测试 ${key}` : `YCY：测试未发送，原因：${stats.lastSkip?.reason || "未知"}`);
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
        if (typeof W.CommandCombine === "function") {
          W.CommandCombine([{
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
    if (typeof W.ChatRoomCommand === "function") {
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
    hookFunction("ChatRoomSync", 0, (args, next) => {
      const result = next(args);
      setTimeout(loadMessage, 500);
      return result;
    });
    hookFunction("CommonSetScreen", 0, (args, next) => {
      const result = next(args);
      setTimeout(loadMessage, 500);
      return result;
    });
  }

  function playerNumber() {
    return typeof W.Player?.MemberNumber === "number" ? W.Player.MemberNumber : null;
  }

  function sameMember(a, b) {
    if (a == null || b == null) return false;
    return String(a) === String(b);
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
    await handleBcMessage(data);
    const ignored = !data || data.Content == null || IGNORE_CONTENT.has(data.Content) || data.Type == null || IGNORE_TYPES.has(data.Type);
    if (ignored) return;
    const type = eventFromMessage(data);
    if (!type) return;
    const current = settings();
    await sendGameEvent(type, {
      source: "ChatRoomMessage",
      type,
      strength: current.strengths[type] || 1,
      player: playerNumber(),
      time: Date.now()
    });
  }

  async function handleActivities(data) {
    if (data?.Type !== "Activity") return;
    const activityGroup = searchMsgDictionary(data, "FocusAssetGroup", "FocusGroupName");
    const activityName = searchMsgDictionary(data, "ActivityName");
    const activityAsset = searchMsgDictionary(data, "ActivityAsset", "AssetName");
    const targetChar = searchMsgDictionary(data, "TargetCharacter", "MemberNumber");
    const sourceChar = searchMsgDictionary(data, "SourceCharacter", "MemberNumber");
    if (activityGroup == null || activityName == null) return;
    const type = classifyAction(activityName);
    if (sameMember(targetChar, playerNumber())) {
      await sendActivityLike(type, {
        source: "Activity",
        target: "self",
        assetGroupName: activityGroup,
        actionName: activityName,
        assetName: activityAsset
      });
    } else if (sameMember(sourceChar, playerNumber())) {
      await sendActivityLike(type, {
        source: "Activity",
        target: "other",
        assetGroupName: activityGroup,
        actionName: activityName,
        assetName: activityAsset
      });
    }
  }

  async function handlePortalLink(data) {
    if (data?.Type !== "Action") return;
    const activityGroup = searchMsgDictionary(data, "FocusAssetGroup", "FocusGroupName");
    const activityAsset = searchMsgDictionary(data, "AssetName", "AssetName");
    const targetChar = searchMsgDictionary(data, "TargetCharacter");
    const sourceChar = searchMsgDictionary(data, "SourceCharacter");
    let activityName = null;
    if (data.Content === "PortalLinkFunctionActivityCaress") activityName = "Caress";
    if (data.Content === "PortalLinkFunctionActivityKiss") activityName = "Kiss";
    if (data.Content === "PortalLinkFunctionActivityMasturbateHand") activityName = "MasturbateHand";
    if (data.Content === "PortalLinkFunctionActivitySlap") activityName = "Slap";
    if (data.Content === "PortalLinkFunctionActivityMasturbateTongue") activityName = "MasturbateTongue";
    if (activityGroup == null || activityName == null || activityAsset !== "PortalPanties") return;
    const type = classifyAction(activityName);
    if (sameMember(targetChar, playerNumber())) {
      await sendActivityLike(type, { source: "PortalLink", target: "self", assetGroupName: activityGroup, actionName: activityName, assetName: activityAsset });
    } else if (sameMember(sourceChar, playerNumber())) {
      await sendActivityLike(type, { source: "PortalLink", target: "other", assetGroupName: activityGroup, actionName: activityName, assetName: activityAsset });
    }
  }

  async function handleItemEquip(data) {
    if (data?.Type !== "Action") return;
    if (!sameMember(searchMsgDictionary(data, "DestinationCharacter", "MemberNumber"), playerNumber())) return;
    if (sameMember(searchMsgDictionary(data, "SourceCharacter", "MemberNumber"), playerNumber())) return;
    const slot = searchMsgDictionary(data, "FocusAssetGroup", "FocusGroupName");
    if (!slot) return;
    if (data.Content === "ActionUse") {
      const itemName = searchMsgDictionary(data, "NextAsset", "AssetName");
      if (!itemName) return;
      await sendGameEvent("toySync", { source: "ActionUse", itemEvent: "itemAdded", assetName: itemName, assetGroupName: slot });
      await sendActivityLike("touch", { source: "ActionUse", target: "self", itemEvent: "itemAdded", assetName: itemName, assetGroupName: slot, actionName: "ItemAdded" });
      await updateOngoingItemDetails(playerAssetByName(itemName), "ActionUse");
    } else if (data.Content === "ActionRemove") {
      const itemName = searchMsgDictionary(data, "PrevAsset", "AssetName");
      if (!itemName) return;
      itemStates.delete(slot);
      await sendGameEvent("toySync", { source: "ActionRemove", itemEvent: "itemRemoved", assetName: itemName, assetGroupName: slot });
      await sendActivityLike("touch", { source: "ActionRemove", target: "self", itemEvent: "itemRemoved", assetName: itemName, assetGroupName: slot, actionName: "ItemRemoved" });
    } else if (data.Content === "ActionSwap") {
      const itemName = searchMsgDictionary(data, "NextAsset", "AssetName");
      const prevItemName = searchMsgDictionary(data, "PrevAsset", "AssetName");
      if (!itemName || !prevItemName) return;
      itemStates.delete(slot);
      await sendGameEvent("toySync", { source: "ActionSwap", itemEvent: "itemSwapped", assetName: itemName, prevAssetName: prevItemName, assetGroupName: slot });
      await sendActivityLike("touch", { source: "ActionSwap", target: "self", itemEvent: "itemSwapped", assetName: itemName, prevAssetName: prevItemName, assetGroupName: slot, actionName: "ItemSwapped" });
      await updateOngoingItemDetails(playerAssetByName(itemName), "ActionSwap");
    }
  }

  async function handleGenericAction(data) {
    if (data?.Type !== "Action") return;
    const content = String(data.Content || "");
    if (!content || content === "ActionUse" || content === "ActionRemove" || content === "ActionSwap") return;
    if (/PortalLinkFunctionActivity/.test(content)) return;
    const slot = searchMsgDictionary(data, "FocusAssetGroup", "FocusGroupName")
      || searchMsgDictionary(data, "AssetGroupName")
      || searchMsgDictionary(data, "GroupName");
    const assetName = searchMsgDictionary(data, "ActivityAsset", "AssetName")
      || searchMsgDictionary(data, "AssetName", "AssetName")
      || searchMsgDictionary(data, "NextAsset", "AssetName")
      || searchMsgDictionary(data, "PrevAsset", "AssetName")
      || "";
    const targetChar = searchMsgDictionary(data, "TargetCharacter", "MemberNumber")
      || searchMsgDictionary(data, "DestinationCharacter", "MemberNumber")
      || searchMsgDictionary(data, "TargetCharacterName", "MemberNumber");
    const sourceChar = searchMsgDictionary(data, "SourceCharacter", "MemberNumber");
    const player = playerNumber();
    const type = classifyAction(content, assetName, slot);
    if (sameMember(targetChar, player) || (!targetChar && messageTargetsPlayer(data))) {
      await sendActivityLike(type, { source: "GenericAction", target: "self", assetGroupName: slot || "", actionName: content, assetName });
    } else if (sameMember(sourceChar, player)) {
      await sendActivityLike(type, { source: "GenericAction", target: "other", assetGroupName: slot || "", actionName: content, assetName });
    }
  }

  async function handleToyEvents(data) {
    if (data?.Type !== "Action") return;
    const targetMatches = sameMember(searchMsgDictionary(data, "DestinationCharacter", "MemberNumber"), playerNumber())
      || sameMember(searchMsgDictionary(data, "DestinationCharacterName", "MemberNumber"), playerNumber())
      || sameMember(searchMsgDictionary(data, "TargetCharacterName", "MemberNumber"), playerNumber());
    if (!targetMatches) return;
    const assetName = searchMsgDictionary(data, "AssetName", "AssetName");
    const currentAsset = playerAssetByName(assetName);
    const activityGroup = currentAsset?.Asset?.DynamicGroupName || currentAsset?.Asset?.Group?.Name;
    if (!activityGroup || !currentAsset || !assetName) return;
    await updateOngoingItemDetails(currentAsset, "ToyAction");
    await sendShockEvent(activityGroup, shockLevelFromMsg(data), assetName, "ToyAction");
  }

  async function handleCustomTextItems(data) {
    if (data?.Type !== "Action") return;
    if (!sameMember(searchMsgDictionary(data, "DestinationCharacter", "MemberNumber"), playerNumber())) return;
    const checks = [
      ["ItemNipples", "LactationPump", /LactationPumpPower/i, [/ToOff/i, /LowSuction/i, /MediumSuction/i, /HighSuction/i, /MaximumSuction/i]],
      ["ItemNipples", "NippleSuctionCups", /NipSuc/i, [/ToLoose/i, /ToLight/i, /ToMedium/i, /ToHeavy/i, /ToMaximum/i]],
      ["ItemNipples", "PlateClamps", /ItemNipplesPlate/i, [/ClampsLoose/i, /ClampsLoose/i, /ClampsLoose/i, /ClampsLoose/i, /ClampsTight/i]],
      ["ItemButt", "ButtPump", /BPumps/i, [/ToEmpty/i, /ToLight/i, /ToInflated/i, /ToBloated/i, /ToMaximum/i]]
    ];
    for (const [slot, itemName, itemRegex, levels] of checks) {
      if (!itemRegex.test(data.Content)) continue;
      const level = levels.findIndex(regex => regex.test(data.Content));
      if (level >= 0) await sendToyState("Vibration", slot, itemName, level, "CustomTextItem");
    }
  }

  async function handleBcMessage(data) {
    if (data && typeof data === "object") {
      if (processedSocketMessages.has(data)) return;
      processedSocketMessages.add(data);
    }
    if (!data || data.Content == null || IGNORE_CONTENT.has(data.Content) || data.Type == null || IGNORE_TYPES.has(data.Type)) return;
    rememberEvent("ChatRoomMessage", data);
    await handlePortalLink(data);
    await handleActivities(data);
    await handleItemEquip(data);
    await handleToyEvents(data);
    await handleCustomTextItems(data);
    await handleGenericAction(data);
  }

  function hookMessages() {
    hookFunction("ChatRoomMessage", 9, (args, next) => {
      const data = args[0];
      handleMessage(data).catch(error => console.warn(MOD_NAME, error));
      return next(args);
    });
    if (!socketHooked && W.ServerSocket?.on) {
      socketHooked = true;
      W.ServerSocket.on("ChatRoomMessage", data => {
        handleBcMessage(data).catch(error => console.warn(MOD_NAME, error));
      });
    }
  }

  function toys() {
    const appearance = Array.isArray(W.Player?.Appearance) ? W.Player.Appearance : [];
    return appearance.filter(item => item?.Asset?.Name && (item?.Asset?.DynamicGroupName || item?.Asset?.Group?.Name)).map(item => ({
      group: item?.Asset?.DynamicGroupName || item?.Asset?.Group?.Name || "",
      name: item?.Asset?.Name || "",
      description: item?.Asset?.Description || "",
      property: item?.Property || {},
      effects: Object.fromEntries(propertyLevelEntries(item?.Property || {}))
    }));
  }

  async function syncToys(reason, force) {
    const data = toys();
    const signature = JSON.stringify(data);
    if (!force && signature === lastToySignature) return null;
    lastToySignature = signature;
    return sendGameEvent("toySync", { source: "Player.Appearance", reason, toys: data });
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
      if (args[0] === W.Player) scheduleToySync("CharacterRefresh");
      return result;
    });
    hookFunction("PropertyShockPublishAction", 3, (args, next) => {
      const shockItem = args?.[1]?.Property ? args[1] : W.DialogFocusItem?.Property ? W.DialogFocusItem : null;
      if (shockItem) {
        const level = shockItem.Property?.ShockLevel == null ? 1 : Number(shockItem.Property.ShockLevel);
        sendShockEvent(shockItem.Asset?.DynamicGroupName || shockItem.Asset?.Group?.Name, level, shockItem.Asset?.Name, "PropertyShockPublishAction")
          .catch(error => console.warn(MOD_NAME, error));
      }
      return next(args);
    });
    hookFunction("ExtendedItemSetOption", 7, (args, next) => {
      const result = next(args);
      if (args?.length >= 6 && args[1]?.MemberNumber === playerNumber()) {
        updateOngoingItemDetails(args[2], "ExtendedItemSetOption").catch(error => console.warn(MOD_NAME, error));
      }
      return result;
    });
    hookFunction("InventoryRemove", 3, (args, next) => {
      if (args?.[0]?.MemberNumber === playerNumber()) {
        const item = playerAssetBySlot(args[1]);
        const name = item?.Asset?.Name;
        const slot = item?.Asset?.DynamicGroupName || item?.Asset?.Group?.Name;
        if (name && slot) {
          itemStates.delete(slot);
          sendGameEvent("toySync", { source: "InventoryRemove", itemEvent: "itemRemoved", assetName: name, assetGroupName: slot })
            .then(() => sendActivityLike("touch", { source: "InventoryRemove", target: "self", itemEvent: "itemRemoved", assetName: name, assetGroupName: slot, actionName: "ItemRemoved" }))
            .catch(error => console.warn(MOD_NAME, error));
        }
      }
      return next(args);
    });
    hookFunction("InventoryWear", 8, (args, next) => {
      const result = next(args);
      if (args?.[0]?.MemberNumber === playerNumber()) {
        const item = playerAssetByName(args[1]);
        const name = item?.Asset?.Name;
        const slot = item?.Asset?.DynamicGroupName || item?.Asset?.Group?.Name;
        if (name && slot) {
          sendGameEvent("toySync", { source: "InventoryWear", itemEvent: "itemAdded", assetName: name, assetGroupName: slot })
            .then(() => sendActivityLike("touch", { source: "InventoryWear", target: "self", itemEvent: "itemAdded", assetName: name, assetGroupName: slot, actionName: "ItemAdded" }))
            .then(() => updateOngoingItemDetails(item, "InventoryWear"))
            .catch(error => console.warn(MOD_NAME, error));
        }
      }
      return result;
    });
    hookFunction("VibratorModePublish", 3, (args, next) => {
      const result = next(args);
      if (args?.[1]?.MemberNumber === playerNumber()) {
        const slot = args[2]?.Asset?.DynamicGroupName || args[2]?.Asset?.Group?.Name;
        const item = playerAssetBySlot(slot);
        updateOngoingItemDetails(item, "VibratorModePublish").catch(error => console.warn(MOD_NAME, error));
      }
      return result;
    });
    hookFunction("InventoryItemPelvisFuturisticTrainingBeltUpdateVibeMode", 4, (args, next) => {
      const result = next(args);
      const item = args?.[3];
      if (item?.Asset?.Name === "FuturisticTrainingBelt" && item?.Property?.Intensity != null) {
        sendToyState("Vibration", "ItemPelvis", "FuturisticTrainingBelt", Number(item.Property.Intensity) + 1, "FuturisticTrainingBelt")
          .catch(error => console.warn(MOD_NAME, error));
      }
      return result;
    });
    hookFunction("AssetsItemPelvisFuturisticChastityBeltScriptTrigger", 3, (args, next) => {
      const result = next(args);
      if (typeof args?.[2] === "string" && ["Struggle", "StruggleOther", "Orgasm", "Standup", "Speech", "RequiredSpeech", "ProhibitedSpeech"].includes(args[2])) {
        sendShockEvent("ItemPelvis", 1, "FuturisticTrainingBelt", "FuturisticChastityBelt")
          .catch(error => console.warn(MOD_NAME, error));
      }
      return result;
    });
  }

  function initFromUrl() {
    const code = urlConnectCode();
    if (code && settings().autoStart) {
      setTimeout(() => {
        startLink("url_connect_code").catch(error => {
          stats.failed += 1;
          stats.lastError = {
            id: "start",
            message: error?.message || String(error),
            time: new Date().toLocaleTimeString()
          };
          console.warn(MOD_NAME, error);
        });
      }, 1000);
    }
  }

  function load() {
    if (W.__YCY_BCX_STYLE_LOADED) return;
    W.__YCY_BCX_STYLE_LOADED = true;
    console.log("[YCY] script loaded in page context", W.location.href);
    setupIntensityRules();
    initFromUrl();
    registerSlashCommand();
    hookCommands();
    hookMessages();
    hookToySync();
    scheduleLoadMessage();
  }

  function wait() {
    const timer = setInterval(() => {
      if (typeof W.Player !== "undefined") {
        clearInterval(timer);
        load();
      }
    }, 1000);
  }

  wait();
})();
