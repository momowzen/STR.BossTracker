    // -------------------------
    // Data + constants (FULL BOSSES)
    // -------------------------
    let BOSSES = [];
    let LOCATIONS = {};
    // -------------------------
    // DOM refs
    // -------------------------
    // Layout breakpoints
    const TABLET_BREAKPOINT = 900;

    // Timezone configuration
    const TIME_ZONE = "Asia/Tokyo";
    const TIME_ZONE_LABEL = "UTC+9";
    const TIME_ZONE_ISO_SUFFIX = "+09:00";
    const TIME_ZONE_OFFSET_MS = 9 * 60 * 60 * 1000;
    const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    // Discord OAuth config (update these for your Discord application)
    const DISCORD_CLIENT_ID = "1518260560766963912";
    const DISCORD_REDIRECT_URI = "https://discord-auth-worker.arianthonyungsod.workers.dev/discord-callback";
    const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const timeOnlyFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const datetimeLocalFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const bossListEl = document.getElementById("bossList");
    const weeklyBossListEl = document.getElementById("weeklyBossList");
    const timerBossListEl = document.getElementById("timerBossList");
    const nextBossNameEl = document.querySelector("#nextBoss .boss-name");
    const nextTimeEl = document.getElementById("nextTime");
    const worldBossNameEl = document.querySelector("#worldBoss .boss-name");
    const worldBossTimeEl = document.getElementById("worldBossTime");
    const searchInput = document.getElementById("bossSearch");
    const clearSearch = document.getElementById("clearSearch");
    const modal = document.getElementById("timeModal");
    const modalName = document.getElementById("modalBossName");
    const killTimeInput = document.getElementById("killTimeInput");
    const cancelTimeBtn = document.getElementById("cancelTimeBtn");
    const saveTimeBtn = document.getElementById("saveTimeBtn");
    const loadingOverlay = document.getElementById("loadingOverlay");
    let hideOverlayTimer = null;
    function hideLoadingOverlay() {
      loadingOverlay.classList.add("hidden");
      hideOverlayTimer = setTimeout(() => {
        loadingOverlay.style.display = "none";
        hideOverlayTimer = null;
      }, 300);
    }
    function showLoadingOverlay() {
      if (hideOverlayTimer) { clearTimeout(hideOverlayTimer); hideOverlayTimer = null; }
      loadingOverlay.style.display = "flex";
      loadingOverlay.classList.remove("hidden");
    }
    const settingsBtn = document.getElementById("settingsBtn");
    const alarmBtn = document.getElementById("alarmBtn");
    
    const settingsDropdown = document.getElementById("settingsDropdown");
    const navDropdown = document.getElementById("navDropdown");
    const discordWebhookBtn = document.getElementById("discordWebhookBtn");
    const webhookBackdrop = document.getElementById("webhookModalBackdrop");
    const webhookInput = document.getElementById("webhookInput");
    const webhookSave = document.getElementById("webhookSave");
    const webhookTest = document.getElementById("webhookTest");
    const webhookClear = document.getElementById("webhookClear");
    if (killTimeInput) {
      killTimeInput.setAttribute(
        "aria-label",
        `Time of death in ${TIME_ZONE_LABEL}`
      );
      killTimeInput.setAttribute(
        "title",
        `All times are stored in ${TIME_ZONE_LABEL}`
      );
    }

    // -------------------------
    // State
    // -------------------------
    let firebaseLoaded = false;
    let appInitialized = false;
    let normalized = false;   // track whether init normalization has been applied to server-confirmed data
    let cachedWebhookUrl = null;
    let timers = {};          // { bossId: { endTime, startedAt, weekly?, cooldownUntil? } }
    let currentBossForTime = null;
    let deadLocks = {};       // in-memory map of boss dead-lock timestamps
    let currentSort = "time";
    let sortAsc = true;

    // Write dedupe: skip Firestore write when data unchanged
    const lastWriteCache = {};
    // Local notification flags (never persisted — purely in-memory for this session)
    const localNotifCache = {}; // { "bossId_soon": timestamp, "bossId_spawn": timestamp }
    const LOCK_DURATION_MS = 3 * 60 * 1000; // 3 min lock for mark-dead button

    const SPAWNED_DURATION_MS = 5 * 60 * 1000; // 5 min SPAWNED state for all bosses

    const ALARM_STORAGE_KEY = "bossTrackerAlarmEnabled";
    let alarmEnabled = localStorage.getItem(ALARM_STORAGE_KEY) === "true";
    let alarmAudioCtx = null;

    function updateAlarmButton() {
      if (!alarmBtn) return;
      alarmBtn.classList.toggle("on", alarmEnabled);
      alarmBtn.setAttribute("aria-pressed", alarmEnabled ? "true" : "false");
      alarmBtn.setAttribute(
        "aria-label",
        alarmEnabled
          ? "Boss respawn alarm enabled"
          : "Boss respawn alarm disabled"
      );
      alarmBtn.title = alarmEnabled
        ? "Boss respawn alarm on"
        : "Boss respawn alarm off";
    }

    async function requestNotificationPermission() {
      if (!("Notification" in window)) {
        showToast(
          "This browser does not support desktop notifications. Alarm sound will still work.",
          "info"
        );
        return true;
      }
      if (Notification.permission === "granted") return true;
      if (Notification.permission === "denied") {
        showToast(
          "Notifications are blocked. Enable them in your browser site settings to receive tray alerts.",
          "error"
        );
        return false;
      }
      const result = await Notification.requestPermission();
      return result === "granted";
    }

    function playAlarmSound() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!alarmAudioCtx) alarmAudioCtx = new Ctx();
        const ctx = alarmAudioCtx;
        if (ctx.state === "suspended") ctx.resume();

        const playBeep = (freq, start, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "square";
          const t0 = ctx.currentTime + start;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
          osc.start(t0);
          osc.stop(t0 + duration);
        };

        for (let i = 0; i < 8; i++) {
          playBeep(i % 2 === 0 ? 880 : 660, i * 0.38, 0.28);
        }
      } catch (e) {
        console.warn("Alarm sound failed:", e);
      }
    }

    function showBossTrayNotification(boss, endTimeMs) {
      if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
      }
      const formattedTime = formatShortDateTime(
        endTimeMs || timers[boss.id]?.endTime || Date.now()
      );
      const iconUrl =
        "https://raw.githubusercontent.com/momowzen/DFck.LordnineSpawnTracker/refs/heads/main/assets/images/logo.png";
      try {
        new Notification(`${boss.name} — respawns in 5 minutes`, {
          body: `Respawn time: ${formattedTime}`,
          icon: iconUrl,
          tag: `boss-alarm-${boss.id}`,
        });
      } catch (e) {
        console.warn("Tray notification failed:", e);
      }
    }

    function triggerBossAlarm(boss) {
      if (!alarmEnabled || !boss) return;
      playAlarmSound();
      showBossTrayNotification(boss, timers[boss.id]?.endTime);
      console.log(`🔔 Local alarm triggered for ${boss.name}`);
    }

    updateAlarmButton();

    if (alarmBtn) {
      alarmBtn.addEventListener("click", async () => {
        if (navDropdown) navDropdown.classList.add("hidden");
        settingsDropdown.classList.add("hidden");
        if (!alarmEnabled) {
          await requestNotificationPermission();
          alarmEnabled = true;
        } else {
          alarmEnabled = false;
        }
        localStorage.setItem(ALARM_STORAGE_KEY, alarmEnabled ? "true" : "false");
        updateAlarmButton();
      });
    }

    // -------------------------
    // Settings Dropdown Positioning
    // -------------------------
    function positionSettingsDropdown() {
      const btnRect = settingsBtn.getBoundingClientRect();
      settingsDropdown.style.top = (btnRect.bottom + 4) + "px";
      settingsDropdown.style.right = (window.innerWidth - btnRect.right) + "px";
    }

    // -------------------------
    // Helpers
    // -------------------------
    function formatSec(s) {
      if (s <= 0) return "Spawned";
      const d = Math.floor(s / 86400);
      s %= 86400;
      const h = Math.floor(s / 3600);
      s %= 3600;
      const m = Math.floor(s / 60);
      if (d > 0)
        return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(
          2,
          "0"
        )}m`;
      if (h > 0)
        return `${String(h).padStart(2, "0")}h ${String(m).padStart(
          2,
          "0"
        )}m`;
      return `${String(m).padStart(2, "0")}m`;
    }

    function formatTimeFull(ms) {
      if (ms <= 0) return "SPAWNED";
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }

    function formatWeeklyRespawnSlot(slot) {
      const day = WEEKDAY_LABELS[slot.day] ?? WEEKDAY_LABELS[0];
      return `${day} ${String(slot.hour).padStart(2, "0")}:${String(
        slot.minute
      ).padStart(2, "0")}`;
    }

    function ensureIsoHasSeconds(value) {
      if (!value) return "";
      if (/T\d{2}:\d{2}$/.test(value)) return `${value}:00`;
      return value;
    }

    function parseDatetimeLocalAsJst(value) {
      if (!value) return null;
      const normalized = ensureIsoHasSeconds(value);
      const hasZone = /([zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
      const iso = hasZone ? normalized : `${normalized}${TIME_ZONE_ISO_SUFFIX}`;
      const parsed = new Date(iso);
      return isNaN(parsed) ? null : parsed;
    }

    function formatDatetimeLocalJst(ms) {
      if (!Number.isFinite(ms)) return "";
      const parts = datetimeLocalFormatter
        .formatToParts(ms)
        .reduce((acc, part) => {
          if (part.type !== "literal") acc[part.type] = part.value;
          return acc;
        }, {});
      if (!parts.year) return "";
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    }

    function formatShortDateTime(ms) {
      return shortDateTimeFormatter.format(new Date(ms));
    }

    function formatTimeOnly(ms) {
      return timeOnlyFormatter.format(ms);
    }

    const confirmModalBackdrop = document.getElementById("confirmModalBackdrop");
    const confirmModalMessage = document.getElementById("confirmModalMessage");
    const confirmModalYes = document.getElementById("confirmModalYes");
    const confirmModalNo = document.getElementById("confirmModalNo");

    function showConfirmModal(message) {
      return new Promise((resolve) => {
        confirmModalMessage.textContent = message;
        confirmModalBackdrop.classList.remove("hidden");
        confirmModalBackdrop.classList.add("active");

        const cleanup = () => {
          confirmModalBackdrop.classList.remove("active");
          confirmModalBackdrop.classList.add("hidden");
          confirmModalYes.removeEventListener("click", onYes);
          confirmModalNo.removeEventListener("click", onNo);
          confirmModalBackdrop.removeEventListener("click", onBackdrop);
        };

        const onYes = () => { cleanup(); resolve(true); };
        const onNo = () => { cleanup(); resolve(false); };
        const onBackdrop = (e) => {
          if (e.target === confirmModalBackdrop) { cleanup(); resolve(false); }
        };

        confirmModalYes.addEventListener("click", onYes);
        confirmModalNo.addEventListener("click", onNo);
        confirmModalBackdrop.addEventListener("click", onBackdrop);
      });
    }

    function getNextWeeklyRespawn(respawns, fromTime = Date.now()) {
      const base = new Date(fromTime + TIME_ZONE_OFFSET_MS);
      let soonest = null;
      for (const { day, hour, minute } of respawns) {
        const candidate = new Date(base);
        const delta = (day + 7 - base.getUTCDay()) % 7;
        candidate.setUTCDate(base.getUTCDate() + delta);
        candidate.setUTCHours(hour, minute, 0, 0);
        const candidateUtc = candidate.getTime() - TIME_ZONE_OFFSET_MS;
        if (candidateUtc < fromTime) {
          candidate.setUTCDate(candidate.getUTCDate() + 7);
        }
        const adjustedUtc = candidate.getTime() - TIME_ZONE_OFFSET_MS;
        if (!soonest || adjustedUtc < soonest) soonest = adjustedUtc;
      }
      return soonest;
    }

    // ✅ Import Firebase core and services
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
    import {
      getFirestore,
      doc,
      setDoc,
      getDoc,
      updateDoc,
      deleteDoc,
      runTransaction,
      onSnapshot,
      serverTimestamp,
      collection,
      addDoc,
      query,
      orderBy,
      limit,
      getDocs,
      writeBatch,
    } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

    // ✅ Initialize Firebase app
    const firebaseConfig = {
      apiKey: "AIzaSyAho-BrXGOJlFD-LfhK7fXTpQ5OIajQXhY",
      authDomain: "bosstracker-a290e.firebaseapp.com",
      projectId: "bosstracker-a290e",
      storageBucket: "bosstracker-a290e.firebasestorage.app",
      messagingSenderId: "516477256941",
      appId: "1:516477256941:web:725c82f5da099fbb7ef8e4",
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // ✅ Auto-detect page updates by polling index.html + app.js + style.css hash
    let lastPageHash = null;

    async function fetchText(url) {
      const res = await fetch(url + "?t=" + Date.now());
      return res.text();
    }

    async function checkForUpdates() {
      try {
        const files = await Promise.all([
          fetchText("index.html"),
          fetchText("app.js"),
          fetchText("style.css"),
        ]);
        const combined = files.join("\n---\n");
        const enc = new TextEncoder().encode(combined);
        const buf = await crypto.subtle.digest("SHA-256", enc);
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
        if (lastPageHash === null) {
          lastPageHash = hash;
        } else if (hash !== lastPageHash) {
          console.log("🔄 Update detected, reloading...");
          location.reload();
        }
      } catch (e) {
        console.warn("Update check failed:", e);
      }
    }

    // ✅ Safe Firestore write helper — dot-path updates only (never replace whole timers map)
    async function safeWrite(ref, payload) {
      try {
        await updateDoc(ref, payload);
      } catch (err) {
        const code = err?.code || "";
        if (code === "not-found") {
          await setDoc(ref, { timers: {} }, { merge: true });
          await updateDoc(ref, payload);
          return;
        }
        console.warn("⚠️  safeWrite failed", err);
        throw err;
      }
    }

    // === TOAST ===
    function showToast(msg, type, duration) {
      if (type === undefined) type = "info";
      if (duration === undefined) duration = 3000;
      const container = document.getElementById("toastContainer");
      if (!container) return;
      const el = document.createElement("div");
      el.className = "toast toast-" + type;
      el.textContent = msg;
      container.appendChild(el);
      requestAnimationFrame(function () {
        el.classList.add("show");
      });
      setTimeout(function () {
        el.classList.remove("show");
        setTimeout(function () { el.remove(); }, 300);
      }, duration);
    }

    // --- Real-time Discord webhook listener (syncs across all users) ---
    let webhookUnsub = null;
    function autoLoadWebhook() {
      if (webhookUnsub) return;
      const docRef = doc(db, "config", "discordWebhook");
      webhookUnsub = onSnapshot(docRef, (snap) => {
        if (snap.metadata?.hasPendingWrites) return;
        if (snap.exists()) {
          const data = snap.data();
          cachedWebhookUrl = data.url || null;
          console.log("✅ Webhook synced from Firestore:", cachedWebhookUrl);
        } else {
          cachedWebhookUrl = null;
          console.log("ℹ No webhook in Firestore.");
        }
      }, (err) => {
        console.warn("Webhook snapshot error (non-fatal):", err.code);
      });
    }

    // -------------------------
    // Webhook save/clear
    // -------------------------
    function loadWebhookIntoInput() {
      webhookInput.value = cachedWebhookUrl || "";
    }

    async function saveWebhookToFirestore(url) {
      try {
        await setDoc(doc(db, "config", "discordWebhook"), { url });
        cachedWebhookUrl = url;
        webhookInput.value = url;
        console.log("✅ Webhook saved to Firestore.");
      } catch (e) {
        console.warn("save webhook err", e);
        showToast("Failed to save webhook.", "error");
      }
    }

    async function clearWebhookInFirestore() {
      try {
        await deleteDoc(doc(db, "config", "discordWebhook"));
        cachedWebhookUrl = null;
        webhookInput.value = "";
        showToast("Webhook cleared.", "success");
        console.log("✅ Webhook cleared from Firestore.");
      } catch (e) {
        console.warn("clear webhook err", e);
        showToast("Failed to clear webhook.", "error");
      }
    }

    // -------------------------
    // Discord send helpers
    // -------------------------
    async function sendDiscordMessage(message) {
      const webhook =
        cachedWebhookUrl ||
        (webhookInput && webhookInput.value.trim()) ||
        null;

      if (!webhook) {
        console.warn("⚠️ No Discord webhook configured.");
        return;
      }

      try {
        const payload = {
          content: message,
          allowed_mentions: {
            parse: ["everyone"]
          }
        };

        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          console.error(
            "❌ Discord webhook failed:",
            res.status,
            await res.text()
          );
        } else {
          console.log("✅ Discord message sent successfully.");
        }
      } catch (err) {
        console.error("⚠️ Discord webhook error:", err);
      }
    }

    // === patched sendDiscordEmbedOnce: dedupe by spawn cycle (not time window) ===
    async function sendDiscordEmbedOnce(type, boss) {
      let key = "";
      try {
        if (!boss || !type) return;

        // 🔔 Normalize Firestore key (handles spaces, punctuation)
        const safeId = encodeURIComponent(boss.id.trim());
        key = `${safeId}_${type}`;

        const now = Date.now();

        localNotifCache[key] = now;

        const ref = doc(db, "notifications", key);

        // Determine the unique cycle identifier for deduplication
        const thisEndTimeMs = timers[boss.id]?.endTime || 0;

        // Fast pre-check: if another user already wrote the same cycle, skip
        try {
          const preSnap = await getDoc(ref);
          if (preSnap.exists()) {
            const preData = preSnap.data();
            if (preData.lastEndTimeMs !== 0 && preData.lastEndTimeMs === thisEndTimeMs) {
              console.log(`⏸️ Pre-check dedupe: ${type} for ${boss.name} already notified`);
              return;
            }
          }
        } catch (_) { /* pre-check is optional; continue to transaction */ }

        let txResult;
        try {
          txResult = await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const data = snap.exists() ? snap.data() : {};

            const lastEndTimeMs = data.lastEndTimeMs || 0;

            // If this exact spawn cycle was already notified, skip
            if (lastEndTimeMs !== 0 && lastEndTimeMs === thisEndTimeMs) {
              console.log(
                `⏸️ Firestore dedupe prevented ${type} for ${boss.name} (same spawn cycle)`
              );
              return false;
            }

            tx.set(
              ref,
              {
                lastSent: serverTimestamp(),
                lastEndTimeMs: thisEndTimeMs,
                bossId: boss.id,
                type,
              },
              { merge: true }
            );

            return { endTimeMs: thisEndTimeMs };
          });
        } catch (txErr) {
          console.warn(`⚠️ Transaction failed for ${key}, using local dedupe only:`, txErr.message);
        }

        if (txResult === false) {
          console.log(
            `⏹️ sendDiscordEmbedOnce: server dedupe prevented sending ${type} for ${boss.name}`
          );
          return;
        }

        const endTimeMs = txResult?.endTimeMs || timers[boss.id]?.endTime || 0;
        const formattedTime = formatShortDateTime(
          endTimeMs || Date.now()
        );

        // 🔔 Build appropriate embed
        let message = "";

        switch (type) {
          case "killed":
            message =
              `${boss.name} has been defeated.\n` +
              `Next respawn: ${formattedTime}\n` +
              `@here`;
            break;

          case "soon":
            message =
              `${boss.name} will respawn soon!\n` +
              (boss.isWorldBoss ? "" : `Respawn time: ${formattedTime}\n`) +
              `@here`;
            break;

          case "spawn":
            message =
              `${boss.name} has respawned!\n` +
              `It's time to hunt!\n` +
              `@here`;
            break;

          case "manual":
            message =
              `${boss.name} timer manually updated.\n` +
              `Next respawn: ${formattedTime}\n` +
              `@here`;
            break;

          default:
            console.warn(`⚠️ Unknown notification type: ${type}`);
            return;
        }

        await sendDiscordMessage(message);
        console.log(`✅ Sent ${type} notification for ${boss.name}`);
      } catch (e) {
        if (e?.code === "ABORTED") {
          console.warn("ℹ Transaction aborted (expected):", e);
          return;
        }
        console.warn("⚠️  sendDiscordEmbedOnce error:", e);
        delete localNotifCache[key]; // allow retry if failed
      }
    }    

    async function testWebhook() {
      if (!cachedWebhookUrl && !webhookInput.value.trim()) {
        showToast("No webhook URL configured.", "error");
        return;
      }
      if (!cachedWebhookUrl) cachedWebhookUrl = webhookInput.value.trim();
      await sendDiscordMessage(
        "Webhook test successful!\n" +
        "Tracker notifications are working."
      );
      showToast("Test sent (check your Discord).", "success");
    }

    // -------------------------
    // Firestore save dedupe helpers
    // -------------------------
    async function saveTimersToFirestore() {
      try {
        // No merge: writes the entire timers map, dropping any stale sub-fields
        await setDoc(doc(db, "timers", "global"), { timers });
        console.log("✅ saveTimersToFirestore: saved timers document.");
      } catch (e) {
        console.warn("saveTimersToFirestore err", e);
      }
    }

    // Apply Firestore timers to local state and refresh UI (real-time sync)
    // Only cooldownUntil is preserved locally; all other fields come from Firestore
    const STALE_KEYS = ["notifiedSoon", "spawnAnnounced", "_updatedAt"];
    function applyTimersFromSnapshot(remoteTimersRaw) {
      const now = Date.now();
      const merged = JSON.parse(JSON.stringify(remoteTimersRaw || {}));

      for (const [id, remoteInfo] of Object.entries(merged)) {
        const boss = BOSSES.find((b) => b.id === id);
        if (!boss) continue;

        // Strip obsolete fields that may linger from older code
        for (const k of STALE_KEYS) delete merged[id][k];

        const localInfo = timers[id];

        // Preserve an active local cooldown if it is still valid,
        // but NOT when the remote data shows the timer was intentionally
        // reset (future endTime, no active cooldown) — e.g. another user
        // marked the boss dead, clearing the SPAWNED state.
        if (localInfo?.cooldownUntil && localInfo.cooldownUntil > now) {
          const remoteHasFutureEnd = remoteInfo.endTime && remoteInfo.endTime > now;
          const remoteHasNoCooldown = !(remoteInfo.cooldownUntil && remoteInfo.cooldownUntil > now);
          if (!(remoteHasFutureEnd && remoteHasNoCooldown)) {
            merged[id] = { ...remoteInfo, cooldownUntil: localInfo.cooldownUntil };
          }
        }

        // Prevent stale cached data from overwriting a valid future local timer.
        // If the local timer has a valid future endTime but the remote data is
        // expired (endTime in the past), the local state is the authoritative one.
        if (localInfo && localInfo.endTime > now && remoteInfo.endTime <= now) {
          merged[id] = { ...localInfo };
        }

        lastWriteCache[id] = JSON.stringify(merged[id] || {});
      }

      timers = merged;
      renderBossList();
      computeNextBoss();
    }

    // Save or update a single boss timer in Firestore safely, with dedupe
    async function saveTimerToFirestoreOnce(bossId) {
      try {
        const ref = doc(db, "timers", "global");
        const data = timers[bossId];
        if (!data) return;
        const json = JSON.stringify(data);
        if (lastWriteCache[bossId] === json) {
          console.log(`ℹ Skipping redundant write for ${bossId}`);
          return;
        }
        await safeWrite(ref, { [`timers.${bossId}`]: data });
        lastWriteCache[bossId] = json;
        console.log(`✅ saveTimerToFirestoreOnce: wrote timer for ${bossId}`);
      } catch (e) {
        console.warn("saveTimerToFirestoreOnce err", e);
        throw e;
      }
    }

    async function saveTimers() {
      try {
        await saveTimersToFirestore();
      } catch (e) {
        console.warn("saveTimers err", e);
      }
    }

    // -------------------------
    // Actions: start / clear / reset
    // -------------------------
    async function startTimer(bossId) {
      const boss = BOSSES.find((b) => b.id === bossId);
      if (!boss) return;
      const now = Date.now();
      const endTime = boss.weeklyRespawns
        ? getNextWeeklyRespawn(boss.weeklyRespawns, now + 1)
        : now + boss.respawn * 1000;

      timers[bossId] = {
        endTime,
        startedAt: now,
        weekly: !!boss.weeklyRespawns,
        cooldownUntil: null,
      };

      // Clear local notification flags so future notifications can fire on next cycle
      delete localNotifCache[`${boss.id}_soon`];
      delete localNotifCache[`${boss.id}_spawn`];

      await saveTimerToFirestoreOnce(bossId);
      renderBossList();

      logAction("mark_dead", { bossId: boss.id, bossName: boss.name, endTime });
      console.log(`startTimer: ${bossId} -> ${new Date(endTime).toISOString()}`);
      sendDiscordEmbedOnce("killed", boss);
    }

    async function resetAll() {
      const preserved = {};
      for (const [id, info] of Object.entries(timers)) {
        const boss = BOSSES.find((b) => b.id === id);
        if (boss && boss.weeklyRespawns) preserved[id] = info;
      }
      timers = preserved;

      try {
        await setDoc(doc(db, "timers", "global"), { timers }); // overwrite entire timers doc
        renderBossList();
        showToast("All non-weekly timers reset.", "success");
        console.log("🔁 resetAll: fully reset timers and updated Firestore.");
      } catch (e) {
        console.warn("❌ resetAll Firestore update failed", e);
        showToast("Failed to update Firestore.", "error");
      }
    }

    // -------------------------
    // Modal for manual time
    // -------------------------
    function openTimeModal(bossId) {
      const boss = BOSSES.find((b) => b.id === bossId);
      if (!boss) return;
      currentBossForTime = boss;
      modalName.textContent = boss.name;
      const nowJstValue = formatDatetimeLocalJst(Date.now());
      killTimeInput.value = nowJstValue || "";
      modal.classList.add("active");
    }

    function closeTimeModal() {
      modal.classList.remove("active");
      currentBossForTime = null;
    }

    cancelTimeBtn.addEventListener("click", closeTimeModal);

    saveTimeBtn.addEventListener("click", async () => {
      const input = killTimeInput.value;
      if (!currentBossForTime) return;
      if (!input) {
        showToast("Please set a date and time.", "error");
        return;
      }

      const parsed = parseDatetimeLocalAsJst(input);
      if (!parsed) {
        showToast("Invalid date format.", "error");
        return;
      }

      const killedAt = parsed.getTime();
      const boss = currentBossForTime;
      const bossId = boss.id;
      const endTime = boss.weeklyRespawns
        ? getNextWeeklyRespawn(boss.weeklyRespawns, killedAt + 1000)
        : killedAt + boss.respawn * 1000;

      if (boss.weeklyRespawns) {
        // Ensure next weekly is after kill time
        let t = endTime;
        while (t <= killedAt) t += 7 * 24 * 60 * 60 * 1000;
        timers[boss.id] = { endTime: t, startedAt: killedAt, weekly: true, cooldownUntil: null };
      } else {
        timers[boss.id] = { endTime, startedAt: killedAt, weekly: false, cooldownUntil: null };
      }

      delete localNotifCache[`${boss.id}_soon`];
      delete localNotifCache[`${boss.id}_spawn`];

      try {
        logAction("manual_time", { bossId: boss.id, bossName: boss.name, killedAt });
        if (!cachedWebhookUrl) await autoLoadWebhook();
        await saveTimerToFirestoreOnce(boss.id);
        closeTimeModal();
        renderBossList();
        sendDiscordEmbedOnce("manual", boss);
        console.log(`Manual time saved: ${boss.name}`);
        showToast(`Time saved for ${boss.name}.`, "success");
        showPartyPanel(bossId);
      } catch (err) {
        console.error("Failed to record manual time:", err);
        showToast("Failed to record manual time.", "error");
      }
    });

    // -------------------------
    // Render functions
    // -------------------------
    let _isFirstRender = true;

    function renderBossList() {
      // FLIP: capture old positions
      const oldRects = {};
      document.querySelectorAll(".boss").forEach(el => {
        const id = el.getAttribute("data-id");
        if (id) oldRects[id] = el.getBoundingClientRect();
      });

      weeklyBossListEl.innerHTML = "";
      timerBossListEl.innerHTML = "";
      const q = (searchInput.value || "").toLowerCase().trim();
      const now = Date.now();

      function getLevelColor(level) {
        if (!level) return "";
        if (level <= 75) return "background:var(--accent-green);color:#000;box-shadow:0 0 6px rgba(46,204,113,0.4)";
        if (level <= 90) return "background:var(--accent-blue);color:#fff;box-shadow:0 0 6px rgba(74,144,226,0.4)";
        if (level <= 100) return "background:var(--accent-purple);color:#fff;box-shadow:0 0 6px rgba(155,89,182,0.4)";
        if (level <= 145) return "background:var(--accent-orange);color:#000;box-shadow:0 0 6px rgba(243,156,18,0.4)";
        return "background:var(--accent-red);color:#fff;box-shadow:0 0 8px rgba(231,76,60,0.6)";
      }

      function buildBossCard(b) {
        const isWeekly = !!b.weeklyRespawns;
        if (q && !b.name.toLowerCase().includes(q)) return null;

        const subText = isWeekly
          ? "Schedule: " + b.weeklyRespawns.map(formatWeeklyRespawnSlot).join(", ")
          : "Interval: " + b.respawn / 3600 + " hr";

        const t = timers[b.id];
        // SPAWNED = timer expired, no active cooldown OR currently in cooldown
        const inCooldown = t?.cooldownUntil && t.cooldownUntil > now;
        const isExpired = t && t.endTime <= now && !inCooldown;
        const countingDown = t && t.endTime > now;

        let remainingText = "";
        let spawnTimeText = "";

        if (inCooldown || isExpired) {
          remainingText = "<span class=\"spawned-text\">SPAWNED</span>";
          spawnTimeText = t?.endTime ? `Spawn Time: ${formatShortDateTime(t.endTime)}` : "";
        } else if (countingDown) {
          const sec = Math.max(0, Math.round((t.endTime - now) / 1000));
          remainingText = "Respawning in <span class=\"time-value\">" + formatSec(sec) + "</span>";
          spawnTimeText = `Spawn Time: ${formatShortDateTime(t.endTime)}`;
        } else if (isWeekly) {
          const nextTime = getNextWeeklyRespawnTime(b);
          if (nextTime) {
            const sec = Math.max(0, Math.round((nextTime - now) / 1000));
            remainingText = "Respawning in <span class=\"time-value\">" + formatSec(sec) + "</span>";
            spawnTimeText = `Spawn Time: ${formatShortDateTime(nextTime)}`;
          }
        }

        const isDeadState = countingDown || (!inCooldown && isExpired);
        const isSpawned = inCooldown || isExpired;
        const node = document.createElement("div");
        node.className = (isDeadState ? "boss is-dead" : "boss is-alive") + (isSpawned ? " in-cooldown" : "");
        node.setAttribute("data-id", b.id);

        const nameClass = isDeadState ? "name dead" : "name";

        node.innerHTML = `
          <div class="meta">
            <div class="portrait-meta">
              <div class="portrait-wrap">
                <img class="boss-portrait" src="https://raw.githubusercontent.com/momowzen/DFck.LordnineSpawnTracker/refs/heads/main/assets/images/${b.id}.png" alt="${b.name}">
              </div>
              <div class="info">
                <div class="${nameClass}">${b.name}${b.level ? `<span class="level-badge" style="${isDeadState ? 'background:var(--text-muted);color:#555;box-shadow:none;border-color:transparent' : getLevelColor(b.level)}">${b.level}</span>` : ""}</div>
                <div class="sub">${subText}</div>
                <div class="location">${LOCATIONS[b.id] || ""}</div>
                <div class="spawn-time">${spawnTimeText}</div>
                <div class="time-remaining">${remainingText}</div>
            </div>
          </div>
          ${!isWeekly ? `
          <div class="actions">
            <div class="action-btn">
              <button class="kbtn icon-btn" title="Set date and time manually" data-action="set" data-id="${b.id}">
                <svg width="18" height="18" aria-hidden="true"><use href="#icon-clock"/></svg>
              </button>
              <span class="action-label">SET</span>
            </div>
            <div class="action-btn">
              <button class="kbtn icon-btn" title="Mark Dead" data-action="mark" data-id="${b.id}">
                <svg width="20" height="20" aria-hidden="true"><use href="#icon-skull"/></svg>
              </button>
              <span class="action-label">KILLED</span>
            </div>
            ${sessionStorage.getItem("userMode") === "admin" && t ? `
            <div class="action-btn">
              <button class="kbtn icon-btn" title="Clear timer" data-action="clear" data-id="${b.id}">
                <svg width="18" height="18" aria-hidden="true"><use href="#icon-trash"/></svg>
              </button>
              <span class="action-label">CLEAR</span>
            </div>` : ""}
          </div>` : `
          <div class="actions">
            <div class="action-btn">
              <button class="kbtn icon-btn" title="Mark Dead" data-action="mark" data-id="${b.id}">
                <svg width="20" height="20" aria-hidden="true"><use href="#icon-skull"/></svg>
              </button>
              <span class="action-label">KILLED</span>
            </div>
          </div>`}
        `;
        return node;
      }

      const getRemainingMs = (b) => {
        const info = timers[b.id];
        if (info?.endTime) return info.endTime - now;
        if (b.weeklyRespawns) {
          const t2 = getNextWeeklyRespawnTime(b);
          return t2 ? t2 - now : Infinity;
        }
        return Infinity;
      };

      function sortBosses(a, b) {
        const dir = sortAsc ? 1 : -1;
        if (currentSort === "name") return dir * a.name.localeCompare(b.name);
        if (currentSort === "level") return dir * (a.level - b.level);
        const diff = getRemainingMs(a) - getRemainingMs(b);
        return diff !== 0 ? dir * diff : dir * a.name.localeCompare(b.name);
      }

      const weeklyBosses = BOSSES.filter(b => b.weeklyRespawns && !b.isWorldBoss).sort(sortBosses);
      weeklyBosses.forEach((bb, i) => {
        const node = buildBossCard(bb);
        if (node) {
          if (_isFirstRender) {
            node.classList.add("stagger-enter");
            node.style.animationDelay = (i * 0.04) + "s";
          }
          weeklyBossListEl.appendChild(node);
        }
      });

      const timerBosses = BOSSES.filter(b => !b.weeklyRespawns && !b.isWorldBoss).sort(sortBosses);
      timerBosses.forEach((bb, i) => {
        const node = buildBossCard(bb);
        if (node) {
          if (_isFirstRender) {
            node.classList.add("stagger-enter");
            node.style.animationDelay = ((weeklyBosses.length + i) * 0.04) + "s";
          }
          timerBossListEl.appendChild(node);
        }
      });

      _isFirstRender = false;

      // FLIP: animate cards from old to new positions
      const moved = [];
      document.querySelectorAll(".boss").forEach(el => {
        const old = oldRects[el.getAttribute("data-id")];
        if (!old) return;
        const cur = el.getBoundingClientRect();
        const dx = old.left - cur.left;
        const dy = old.top - cur.top;
        if (dx === 0 && dy === 0) return;
        el.style.transition = "none";
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        moved.push(el);
      });
      if (moved.length) {
        void document.body.offsetHeight;
        moved.forEach(el => {
          el.style.transition = "transform 0.3s ease";
          el.style.transform = "";
        });
        setTimeout(() => moved.forEach(el => el.style.transition = ""), 350);
      }
    }

    // ✅ Firestore document for lock management
    const deadLockRef = doc(db, "meta", "deadLocks");

    // === Unified Boss List Click Handler with atomic deadlock attempt ===
    bossListEl.addEventListener("click", async (e) => {
      const btn = e.target.closest(".kbtn");
      if (!btn) return;

      // Prevent click event from bubbling to parent boss card
      e.stopPropagation();

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      if (!id) return;

      if (action === "mark") {
        const now = Date.now();
        const lockUntil = now + LOCK_DURATION_MS;

        // Immediate visual disable to give feedback
        btn.disabled = true;
        console.log(
          `🔒 mark clicked: attempting lock for ${id} (local visual disabled)`
        );

        try {
          // Try atomic transaction to set lock only if not locked
          const locked = await runTransaction(db, async (tx) => {
            const snap = await tx.get(deadLockRef);
            const data = snap.exists() ? snap.data() : {};
            const existing = data[id] || 0;
            const tsNow = Date.now();

            if (existing && existing > tsNow) {
              // someone else holds lock
              return false;
            }
            // set lock
            tx.set(deadLockRef, { [id]: lockUntil }, { merge: true });
            return true;
          });

          if (!locked) {
            // lock lost to another client: re-enable and warn
            console.warn(
              `⛔ markDead: failed to acquire lock for ${id} — another user locked it.`
            );
            // refresh deadLocks on next snapshot will correct disabled state, but re-enable for good UX
            btn.disabled = false;
            return;
          }

          // We acquired lock: update local memory immediately and disable all mark buttons for this boss
          deadLocks[id] = lockUntil;
          document
            .querySelectorAll(`.kbtn[data-id="${id}"][data-action="mark"]`)
            .forEach((b) => (b.disabled = true));
          console.log(
            `🔒 Acquired lock for ${id} until ${new Date(
              lockUntil
            ).toISOString()}`
          );

          // Animate the boss card
          const card = btn.closest(".boss");
          if (card) {
            card.classList.add("shake");
            card.addEventListener(
              "animationend",
              () => card.classList.remove("shake"),
              { once: true }
            );
          }

          // Start the timer (this writes timer and triggers Discord send)
          await startTimer(id);
          showPartyPanel(id);
        } catch (err) {
          console.error("⚠️  Error during mark dead transaction:", err);
          btn.disabled = false;
        }
        return;
      }

      if (action === "set") {
        openTimeModal(id);
      }

      if (action === "clear") {
        delete timers[id];
        await saveTimersToFirestore();
        renderBossList();
        logAction('clear_timer', { bossId: id });
      }
    });

    // -------------------------
    // Compute next boss helper
    // -------------------------
    // Function to calculate next weekly respawn time for a boss
    function getNextWeeklyRespawnTime(boss) {
      if (!boss.weeklyRespawns || boss.weeklyRespawns.length === 0) return null;
      return getNextWeeklyRespawn(boss.weeklyRespawns);
    }

    const WORLD_BOSS_NAMES = ["Ratan", "Parto", "Nedra"];

    function getNextWorldBossTime() {
      const now = Date.now();
      const jstNow = new Date(now + TIME_ZONE_OFFSET_MS);
      const jstMs = jstNow.getTime();

      const today12 = new Date(jstNow);
      today12.setUTCHours(12, 0, 0, 0);

      const today21 = new Date(jstNow);
      today21.setUTCHours(21, 0, 0, 0);

      if (jstMs < today12.getTime()) return today12.getTime() - TIME_ZONE_OFFSET_MS;
      if (jstMs < today21.getTime()) return today21.getTime() - TIME_ZONE_OFFSET_MS;

      const next12 = new Date(jstNow);
      next12.setUTCDate(next12.getUTCDate() + 1);
      next12.setUTCHours(12, 0, 0, 0);
      return next12.getTime() - TIME_ZONE_OFFSET_MS;
    }

    function updateWorldBossName() {
      if (!worldBossNameEl) return;
      worldBossNameEl.textContent = WORLD_BOSS_NAMES.join(" \u00B7 ");
    }

    function computeNextBoss() {
      const upcoming = [];

      // Add manual timer deaths (excluding world bosses)
      Object.entries(timers)
        .forEach(([id, info]) => {
          const boss = BOSSES.find((b) => b.id === id);
          if (boss && !boss.isWorldBoss) {
            upcoming.push({
              id,
              endTime: info.endTime,
              boss,
              isWeekly: false,
            });
          }
        });

      // Add weekly respawns for bosses not in timers (excluding world bosses)
      BOSSES.forEach((boss) => {
        if (!timers[boss.id] && boss.weeklyRespawns && !boss.isWorldBoss) {
          const nextWeeklyTime = getNextWeeklyRespawnTime(boss);
          if (nextWeeklyTime) {
            upcoming.push({
              id: boss.id,
              endTime: nextWeeklyTime,
              boss,
              isWeekly: true,
            });
          }
        }
      });

      // Sort by endTime
      upcoming.sort((a, b) => a.endTime - b.endTime);

      if (upcoming.length === 0) {
        nextBossNameEl.textContent = "Next Boss: —";
        nextTimeEl.textContent = "—";
        return;
      }

      const soon = upcoming[0];
      const now = Date.now();
      const remainingMs = Math.max(0, soon.endTime - now);

      nextBossNameEl.textContent = soon.boss.name;
      nextTimeEl.textContent = formatTimeFull(remainingMs);

    }

    // == MAIN TICKUPDATE (polling loop, no setTimeout races) == //
    async function tickUpdate() {
      const now = Date.now();
      const discordPromises = [];

      // Ensure weekly bosses always have in-memory timers (condition 5)
      for (const boss of BOSSES) {
        if (boss.weeklyRespawns && !timers[boss.id]) {
          const next = getNextWeeklyRespawnTime(boss);
          if (next) {
            timers[boss.id] = { endTime: next, startedAt: now, weekly: true, cooldownUntil: null };
          }
        }
      }

      for (const [id, info] of Object.entries(timers)) {
        const boss = BOSSES.find((b) => b.id === id);
        if (!boss || !info || !info.endTime) continue;

        const co = info.cooldownUntil;
        const remainingMs = info.endTime - now;

        // --- SPAWNED cooldown window ---
        if (co && now < co) {
          // boss is in the 3-minute SPAWNED window; no further processing
          continue;
        }

        // --- Cooldown just expired: auto-enter next cycle (condition 10) ---
        if (!normalized && co && now >= co && info.endTime <= now) continue;
        if (co && now >= co && info.endTime <= now) {
          const nextTime = boss.weeklyRespawns
            ? getNextWeeklyRespawn(boss.weeklyRespawns, now + 1)
            : now + boss.respawn * 1000;

          timers[id] = { endTime: nextTime, startedAt: now, weekly: !!boss.weeklyRespawns, cooldownUntil: null };

          // Clear local notification flags for new cycle
          delete localNotifCache[`${id}_soon`];
          delete localNotifCache[`${id}_spawn`];

          // Condition 3 exception: system write for auto-restart
          await saveTimerToFirestoreOnce(id);
          renderBossList();
          continue;
        }

        // --- Timer counting down ---
        if (remainingMs > 0) {
          // Condition 7: 5-min warning
          if (remainingMs <= 5 * 60 * 1000 && !localNotifCache[`${id}_soon`]) {
            localNotifCache[`${id}_soon`] = Date.now();
            triggerBossAlarm(boss);
            discordPromises.push(sendDiscordEmbedOnce("soon", boss));
          }
          continue;
        }

        // --- Timer just reached 0 (condition 8 + 10) ---
        // Note: remainingMs <= 0 here
        // Skip spawn transitions during initial load — stale cached data
        // could trigger false spawns for already-killed bosses.
        if (!normalized) continue;
        if (remainingMs <= 0 && !co) {
          // Condition 8: send spawn notification (firestore-deduped, condition 13)
          if (!localNotifCache[`${id}_spawn`]) {
            localNotifCache[`${id}_spawn`] = Date.now();
            discordPromises.push(sendDiscordEmbedOnce("spawn", boss));
          }

          // Condition 10: enter SPAWNED cooldown
          timers[id] = { ...info, cooldownUntil: now + SPAWNED_DURATION_MS };

          // Condition 3 exception: system write for cooldown state
          await saveTimerToFirestoreOnce(id);
          renderBossList();
          continue;
        }
      }

      // Fire all Discord notifications (Firestore dedupe prevents spam — condition 13)
      if (discordPromises.length) {
        await Promise.allSettled(discordPromises);
      }

      computeNextBoss();
    }

    // Lightweight visual update every second (no Firestore writes)
    function updateCountdownDisplay() {
      const now = Date.now();

      // Cache DOM boss elements once per tick instead of per-boss querySelector
      const bossEls = {};
      document.querySelectorAll(".boss").forEach(el => {
        bossEls[el.getAttribute("data-id")] = el;
      });

      // Update time remaining on boss cards
      for (const [bossId, info] of Object.entries(timers)) {
        const el = bossEls[bossId];
        if (!el || !info?.endTime) continue;

        const inCooldown = info.cooldownUntil && now < info.cooldownUntil;
        const remainingSec = inCooldown ? 0 : Math.max(0, Math.round((info.endTime - now) / 1000));

        const timeEl = el.querySelector(".time-remaining");
        if (timeEl) {
          timeEl.innerHTML = remainingSec === 0 ? "<span class=\"spawned-text\">SPAWNED</span>" : "Respawning in <span class=\"time-value\">" + formatSec(remainingSec) + "</span>";
        }
        const spawnEl = el.querySelector(".spawn-time");
        if (spawnEl && !spawnEl.dataset.spawnSet) {
          spawnEl.textContent = `Spawn Time: ${formatShortDateTime(info.endTime)}`;
          spawnEl.dataset.spawnSet = "1";
        }
      }

      // Update weekly-only bosses (those without a Firestore timer entry)
      for (const boss of BOSSES) {
        if (timers[boss.id]) continue;
        if (!boss.weeklyRespawns) continue;
        const el = bossEls[boss.id];
        if (!el) continue;
        const nextTime = getNextWeeklyRespawnTime(boss);
        if (!nextTime) continue;
        const remainingSec = Math.max(0, Math.round((nextTime - now) / 1000));
        const timeEl = el.querySelector(".time-remaining");
        if (timeEl) timeEl.innerHTML = "Respawning in <span class=\"time-value\">" + formatSec(remainingSec) + "</span>";
        const spawnEl = el.querySelector(".spawn-time");
        if (spawnEl && !spawnEl.dataset.spawnSet) {
          spawnEl.textContent = `Spawn Time: ${formatShortDateTime(nextTime)}`;
          spawnEl.dataset.spawnSet = "1";
        }
      }

      // Update world boss panel with soonest world boss timer
      updateWorldBossName();
      if (worldBossTimeEl) {
        let wbSoonest = null;
        for (const boss of BOSSES) {
          if (!boss.isWorldBoss) continue;
          const info = timers[boss.id];
          if (!info || !info.endTime) continue;
          if (info.cooldownUntil && now < info.cooldownUntil) {
            wbSoonest = { remaining: 0, spawned: true };
            break;
          }
          const remaining = info.endTime - now;
          if (remaining > 0 && (wbSoonest === null || remaining < wbSoonest.remaining)) {
            wbSoonest = { remaining, spawned: false };
          }
        }
        if (wbSoonest && wbSoonest.spawned) {
          worldBossTimeEl.textContent = "SPAWNED";
        } else if (wbSoonest && wbSoonest.remaining > 0) {
          worldBossTimeEl.textContent = formatTimeFull(wbSoonest.remaining);
        } else {
          const wbTime = getNextWorldBossTime();
          if (wbTime) {
            const wbMs = Math.max(0, wbTime - now);
            worldBossTimeEl.textContent = wbMs === 0 ? "SPAWNED" : formatTimeFull(wbMs);
          } else {
            worldBossTimeEl.textContent = "--";
          }
        }
      }

      // Update remaining boss count (includes timer-based + weekly schedule spawns)
      const activeCountEl = document.getElementById("activeCount");
      if (activeCountEl) {
        const jstNow = new Date(now + TIME_ZONE_OFFSET_MS);
        const todayStart = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate())).getTime() - TIME_ZONE_OFFSET_MS;
        const tomorrowStart = todayStart + 86400000;
        const counted = new Set();
        BOSSES.forEach(b => {
          if (b.isWorldBoss) return;
          const info = timers[b.id];
          let et = info?.endTime;
          if (et && et >= todayStart && et < tomorrowStart && et > now) {
            counted.add(b.id);
            return;
          }
          // Weekly boss without a timer — check if next spawn falls within today
          if (!info && b.weeklyRespawns) {
            const nextTime = getNextWeeklyRespawnTime(b);
            if (nextTime && nextTime >= todayStart && nextTime < tomorrowStart && nextTime > now) {
              counted.add(b.id);
            }
          }
        });
        activeCountEl.textContent = counted.size;
      }

      // Update next boss countdown
      computeNextBoss();
    }

    // fast visual refresh (every 1s, no overlapping tickUpdate calls)
    async function tickLoop() {
      updateCountdownDisplay();
      if (firebaseLoaded && Object.keys(timers).length) {
        await tickUpdate();
      }
      setTimeout(tickLoop, 1000);
    }
    tickLoop();

    // -------------------------
    // UI wiring
    // -------------------------
    // Function to update clear button visibility
    const updateClearButtonVisibility = () => {
      const hasText = !!searchInput.value;
      clearSearch.classList.toggle("visible", hasText);
    };

    searchInput.addEventListener("input", () => {
      searchInput.value = searchInput.value.toUpperCase();
      renderBossList();
      updateClearButtonVisibility();
    });

    // Keep clear button visible on focus/blur if text exists
    searchInput.addEventListener("focus", () => {
      updateClearButtonVisibility();
    });

    searchInput.addEventListener("blur", () => {
      updateClearButtonVisibility();
    });

    clearSearch.addEventListener("click", () => {
      searchInput.value = "";
      updateClearButtonVisibility();
      renderBossList();
    });

    // Initialize on page load
    updateClearButtonVisibility();

    // === VIEW TOGGLE (mobile: switch between WEEKLY and FIX) ===
    const viewToggle = document.getElementById("viewToggle");
    const bossListPanel = document.getElementById("bossListPanel");

    // === PANELS SLIDER (mobile: swipe left/right, auto-rotate every 3s) ===
    const panelsTrack = document.getElementById("panelsTrack");
    const panelsDots = document.getElementById("panelsDots");
    let currentPanel = 0;
    const panelCount = 2;
    let touchStartX = 0;
    let touchDiff = 0;
    let isDragging = false;

    function goToPanel(index) {
      if (index < 0 || index >= panelCount) return;
      currentPanel = index;
      panelsTrack.style.transform = `translateX(-${index * 50}%)`;
      const dots = panelsDots.querySelectorAll(".dot");
      dots.forEach((d, i) => d.classList.toggle("active", i === index));
    }

    if (panelsTrack && panelsDots) {
      panelsTrack.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].screenX;
        isDragging = true;
      }, { passive: true });

      panelsTrack.addEventListener("touchmove", (e) => {
        if (!isDragging) return;
        touchDiff = e.changedTouches[0].screenX - touchStartX;
      }, { passive: true });

      panelsTrack.addEventListener("touchend", () => {
        if (!isDragging) return;
        isDragging = false;
        const threshold = 30;
        if (touchDiff < -threshold && currentPanel < panelCount - 1) {
          goToPanel(currentPanel + 1);
        } else if (touchDiff > threshold && currentPanel > 0) {
          goToPanel(currentPanel - 1);
        } else {
          goToPanel(currentPanel);
        }
        touchDiff = 0;
      }, { passive: true });

      window.addEventListener("resize", () => {
        if (window.innerWidth > TABLET_BREAKPOINT) {
          panelsTrack.style.transform = "translateX(0)";
          currentPanel = 0;
          const dots = panelsDots.querySelectorAll(".dot");
          dots.forEach((d, i) => d.classList.toggle("active", i === 0));
        }
      });
    }

    // === SETTINGS BUTTON + MODAL TOGGLE ===
    settingsBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (navDropdown) navDropdown.classList.add("hidden");
      const userMode = sessionStorage.getItem("userMode");
      // Keep settings hidden for member mode
      if (userMode === "member") {
        settingsDropdown.classList.add("hidden");
        console.log(`⚙️ settings hidden for member mode`);
        return;
      }
      settingsDropdown.classList.toggle("hidden");
      if (!settingsDropdown.classList.contains("hidden")) {
        positionSettingsDropdown();
      }
      console.log(`⚙️ settings modal opened`);
    });

    document.addEventListener("click", (ev) => {
      if (
        !settingsBtn.contains(ev.target) &&
        !settingsDropdown.contains(ev.target)
      ) {
        settingsDropdown.classList.add("hidden");
      }
    });

    // Reposition dropdown on window resize
    window.addEventListener("resize", () => {
      if (!settingsDropdown.classList.contains("hidden")) {
        positionSettingsDropdown();
      }
    });

    // ─── Nav Menu Dropdown (mobile) ───
    const navMenuBtn = document.getElementById("navMenuBtn");

    function positionNavDropdown() {
      const btnRect = navMenuBtn.getBoundingClientRect();
      navDropdown.style.top = (btnRect.bottom + 4) + "px";
      navDropdown.style.right = (window.innerWidth - btnRect.right) + "px";
    }

    if (navMenuBtn) {
      navMenuBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        settingsDropdown.classList.add("hidden");
        navDropdown.classList.toggle("hidden");
        if (!navDropdown.classList.contains("hidden")) {
          positionNavDropdown();
        }
      });
    }

    document.addEventListener("click", (ev) => {
      if (
        navMenuBtn && !navMenuBtn.contains(ev.target) &&
        navDropdown && !navDropdown.contains(ev.target)
      ) {
        navDropdown.classList.add("hidden");
      }
    });

    window.addEventListener("resize", () => {
      if (navDropdown && !navDropdown.classList.contains("hidden")) {
        positionNavDropdown();
      }
    });

    // Tab clicks inside nav dropdown
    if (navDropdown) {
      navDropdown.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          navDropdown.classList.add("hidden");
          const tab = btn.dataset.tab;
          const panelId = 'panel' + tab.charAt(0).toUpperCase() + tab.slice(1);
          const panel = document.getElementById(panelId);
          // Sync active state with admin-nav
          document.querySelectorAll('.admin-nav .nav-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
          const desktopBtn = document.querySelector(`.admin-nav .nav-btn[data-tab="${tab}"]`);
          if (desktopBtn) desktopBtn.classList.add('active');
          if (panel) panel.classList.add('active');
          // use outer bossListPanel (declared at module level)
          const topRow = document.getElementById('topPanelsRow');
          if (tab !== 'bosslist') {
            if (bossListPanel) bossListPanel.style.display = 'none';
            if (topRow) topRow.style.display = 'none';
          } else {
            if (bossListPanel) bossListPanel.style.display = '';
            if (topRow) topRow.style.display = '';
          }
          if (typeof hidePartyPanel === 'function') hidePartyPanel();
        });
      });
    }

    // === SCHEDULE VIEW (inline toggle: normal list ↔ schedule) ===
    const scheduleBtn = document.getElementById("scheduleBtn");

    function getJSTStartOfDay(daysFromNow = 0) {
      const now = Date.now();
      const jstNow = new Date(now + TIME_ZONE_OFFSET_MS);
      const day = new Date(jstNow);
      day.setUTCDate(day.getUTCDate() + daysFromNow);
      day.setUTCHours(0, 0, 0, 0);
      return day.getTime() - TIME_ZONE_OFFSET_MS;
    }

    function getJSTEndOfDay(daysFromNow = 0) {
      const now = Date.now();
      const jstNow = new Date(now + TIME_ZONE_OFFSET_MS);
      const day = new Date(jstNow);
      day.setUTCDate(day.getUTCDate() + daysFromNow);
      day.setUTCHours(23, 59, 59, 999);
      return day.getTime() - TIME_ZONE_OFFSET_MS;
    }

    function getSpawnTimeForBoss(boss) {
      const info = timers[boss.id];
      if (info?.endTime) return info.endTime;
      if (boss.weeklyRespawns) return getNextWeeklyRespawnTime(boss);
      return null;
    }

    function getSpawnsInRange(boss, start, end) {
      const spawns = [];
      if (boss.weeklyRespawns) {
        for (let offset = 0; offset <= 14; offset++) {
          const day = new Date(Date.now() + TIME_ZONE_OFFSET_MS);
          day.setUTCDate(day.getUTCDate() + offset);
          const dayStart = new Date(day);
          dayStart.setUTCHours(0, 0, 0, 0);
          const dayEnd = new Date(day);
          dayEnd.setUTCHours(23, 59, 59, 999);
          const dayStartMs = dayStart.getTime() - TIME_ZONE_OFFSET_MS;
          const dayEndMs = dayEnd.getTime() - TIME_ZONE_OFFSET_MS;
          if (dayEndMs < start) continue;
          if (dayStartMs > end) break;
          for (const slot of boss.weeklyRespawns) {
            const slotDate = new Date(day);
            const delta = (slot.day - day.getUTCDay() + 7) % 7;
            slotDate.setUTCDate(slotDate.getUTCDate() + delta);
            slotDate.setUTCHours(slot.hour, slot.minute, 0, 0);
            const ms = slotDate.getTime() - TIME_ZONE_OFFSET_MS;
            if (ms >= start && ms <= end) {
              spawns.push({ boss, time: ms });
            }
          }
        }
      } else {
        const time = getSpawnTimeForBoss(boss);
        if (time && time >= start && time <= end) {
          spawns.push({ boss, time });
        }
      }
      return spawns;
    }

    function renderSchedule() {
      const now = Date.now();

      for (let day = 0; day <= 1; day++) {
        const start = getJSTStartOfDay(day);
        const end = getJSTEndOfDay(day);
        const el = document.getElementById("scheduleDay" + day + "List");
        if (!el) continue;

        const spawns = [];
        for (const boss of BOSSES) {
          if (boss.isWorldBoss) continue;
          const bossSpawns = getSpawnsInRange(boss, start, end);
          spawns.push(...bossSpawns);
        }

        const filtered = spawns.filter(s => s.time > now + 60000);
        filtered.sort((a, b) => a.time - b.time);

        if (filtered.length === 0) {
          el.innerHTML = '<div class="schedule-empty">No spawns</div>';
        } else {
          el.innerHTML = filtered.map(s =>
            `<div class="schedule-item">
              <span class="boss-label">${s.boss.name}</span>
              <span class="time-label">${formatTimeOnly(s.time)}</span>
            </div>`
          ).join("");
          el.querySelectorAll(".schedule-item").forEach((item, i) => {
            item.classList.add("stagger-enter");
            item.style.animationDelay = (i * 0.05) + "s";
          });
        }
      }
    }

    scheduleBtn.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      const enteringSchedule = !bossListPanel.classList.contains("view-schedule");
      bossListPanel.classList.toggle("view-schedule");
      if (enteringSchedule) {
        renderSchedule();
        bossListPanel.classList.remove("view-weekly");
        bossListPanel.classList.remove("view-schedule-day");
      } else {
        // Re-stagger boss cards per column so both animate simultaneously
        [weeklyBossListEl, timerBossListEl].forEach(list => {
          if (!list) return;
          const cards = list.querySelectorAll(".boss");
          cards.forEach((card, i) => {
            card.classList.remove("stagger-enter");
            void card.offsetHeight;
            card.classList.add("stagger-enter");
            card.style.animationDelay = (i * 0.04) + "s";
          });
        });
      }
    });

    // View-toggle (arrows): in schedule view toggles TODAY/TOMORROW,
    // in normal view toggles interval/weekly (mobile)
    if (viewToggle) {
      viewToggle.addEventListener("click", () => {
        if (bossListPanel.classList.contains("view-schedule")) {
          bossListPanel.classList.toggle("view-schedule-day");
        } else {
          bossListPanel.classList.toggle("view-weekly");
        }
      });
    }

    // === SORT BUTTONS ===
    const sortBtn = document.getElementById("sortBtn");
    const sortLabel = document.getElementById("sortLabel");
    const sortDirBtn = document.getElementById("sortDirBtn");
    const sortDropdown = document.getElementById("sortDropdown");
    const sortOptions = sortDropdown?.querySelectorAll(".sort-option");
    const sortContainer = document.getElementById("sortContainer");
    const sortLabels = { time: "Time", name: "Name", level: "Level" };

    function renderSortUI() {
      sortLabel.textContent = sortLabels[currentSort] || "Time";
      sortDirBtn.title = sortAsc ? "Ascending" : "Descending";
      sortDirBtn.innerHTML = sortAsc
        ? `<svg width="12" height="12" aria-hidden="true"><use href="#icon-sort-dir"/></svg>`
        : `<svg width="12" height="12" aria-hidden="true"><use href="#icon-sort-dir-desc"/></svg>`;
      sortOptions?.forEach(opt => {
        opt.style.display = opt.dataset.sort === currentSort ? "none" : "";
      });
    }

    let sortHoverTimer = null;
    function closeSortDropdown() {
      sortDropdown.classList.add("hidden");
      sortBtn.classList.remove("open");
    }
    if (sortBtn) {
      sortBtn.addEventListener("mouseenter", () => {
        clearTimeout(sortHoverTimer);
        sortDropdown.classList.remove("hidden");
        sortBtn.classList.add("open");
      });
      sortBtn.addEventListener("mouseleave", () => {
        sortHoverTimer = setTimeout(closeSortDropdown, 200);
      });
    }
    if (sortDropdown) {
      sortDropdown.addEventListener("mouseenter", () => clearTimeout(sortHoverTimer));
      sortDropdown.addEventListener("mouseleave", () => {
        sortHoverTimer = setTimeout(closeSortDropdown, 200);
      });
    }

    sortOptions?.forEach(opt => {
      opt.addEventListener("click", () => {
        currentSort = opt.dataset.sort;
        renderSortUI();
        renderBossList();
      });
    });

    if (sortDirBtn) {
      sortDirBtn.addEventListener("click", () => {
        sortAsc = !sortAsc;
        renderSortUI();
        renderBossList();
      });
    }

    renderSortUI();


    discordWebhookBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      settingsDropdown.classList.add("hidden");
      loadWebhookIntoInput();
      webhookBackdrop.classList.add("active");
    });

    webhookBackdrop.addEventListener("click", (ev) => {
      if (ev.target === webhookBackdrop)
        webhookBackdrop.classList.remove("active");
    });

    const exportBtn = document.getElementById("exportBtn");
    const importBtn = document.getElementById("importBtn");
    const resetBtn = document.getElementById("resetBtn");

    exportBtn.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      try {
        const blob = new Blob([JSON.stringify(timers, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "boss_timers_backup.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Timers exported.", "success");
        console.log("📤 Exported timers.json");
      } catch (e) {
        showToast("Failed to export timers.", "error");
      }
    });

    importBtn.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const imported = JSON.parse(text);
          if (await showConfirmModal("Import this JSON data? It will overwrite existing timers.")) {
            timers = imported;
            await saveTimers();
            renderBossList();
            showToast("Timers imported.", "success");
            logAction('import_timers', { count: Object.keys(imported).length });
            console.log("📥 Imported timers from file.");
          }
        } catch (e) {
          showToast("Invalid JSON file.", "error");
        }
      };
      input.click();
    });

    resetBtn.addEventListener("click", async () => {
      settingsDropdown.classList.add("hidden");
      if (await showConfirmModal("Are you sure you want to reset all timers?")) { resetAll(); logAction('reset_all_timers'); }
    });

    onSnapshot(deadLockRef, (snapshot) => {
      if (snapshot.metadata?.hasPendingWrites) return;
      deadLocks = snapshot.data() || {};
      const now = Date.now();

      document
        .querySelectorAll('.kbtn[data-action="mark"]')
        .forEach((btn) => {
          const bossId = btn.getAttribute("data-id");
          const lockedUntil = deadLocks[bossId] || 0;
          btn.disabled = now < lockedUntil;
        });

      if (firebaseLoaded) renderBossList();
      console.log("🔔 deadLocks updated from Firestore:", deadLocks);
    });

    webhookSave.addEventListener("click", async () => {
      const url = webhookInput.value.trim();
      if (!url) {
        showToast("Please paste a webhook URL", "error");
        return;
      }
      await saveWebhookToFirestore(url);
      showToast("Webhook saved", "success");
      logAction('webhook_save');
    });

    webhookTest.addEventListener("click", async () => {
      await testWebhook();
    });

    webhookClear.addEventListener("click", async () => {
      if (!(await showConfirmModal("Clear webhook from Firestore?"))) return;
      await clearWebhookInFirestore();
      logAction('webhook_clear');
    });

    // ─── Action Logs ──────────────────────────────────
    const actionLogsBtn = document.getElementById("actionLogsBtn");
    const actionLogsBackdrop = document.getElementById("actionLogsBackdrop");
    const actionLogsContainer = document.getElementById("actionLogsContainer");
    const actionLogsRefresh = document.getElementById("actionLogsRefresh");

    actionLogsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsDropdown.classList.add("hidden");
      actionLogsBackdrop.classList.add("active");
      loadActionLogs();
    });

    actionLogsBackdrop.addEventListener("click", (ev) => {
      if (ev.target === actionLogsBackdrop)
        actionLogsBackdrop.classList.remove("active");
    });

    if (actionLogsRefresh) actionLogsRefresh.addEventListener("click", loadActionLogs);

    function formatAction(action, details) {
      const fmt = (s) => escapeHtml(String(s ?? ""));
      switch (action) {
        case "mark_dead": return `Marked ${fmt(details.bossName || details.bossId)} dead`;
        case "manual_time": return `Set kill time for ${fmt(details.bossName || details.bossId)}`;
        case "clear_timer": return `Cleared timer for ${fmt(details.bossId || "?")}`;
        case "import_timers": return `Imported ${fmt(details.count)} timer(s)`;
        case "reset_all_timers": return `Reset all timers`;
        case "webhook_save": return `Saved webhook`;
        case "webhook_clear": return `Cleared webhook`;
        case "remove_member": return `Removed member ${fmt(details.name)}`;
        case "rename_member": return `Renamed ${fmt(details.oldName)} → ${fmt(details.newName)}`;
        case "add_member": return `Added member ${fmt(details.name)}`;
        case "add_member_scan": return `Added ${fmt(details.name)} via scan`;
        case "bulk_import": return `Bulk imported ${fmt(details.count)} member(s)`;
        case "boss_config": return `Set boss ${fmt(details.bossId)} points to ${fmt(details.points)}`;
        case "boss_config_reset": return `Reset all boss points`;
        case "leaderboard_reset": return `Reset leaderboard`;
        case "activity_cleared": return `Cleared activity logs`;
        case "award_points": return `Awarded ${fmt(details.points)} pts each for ${fmt(details.bossName || details.bossId || "?")}`;
        case "give_points": return `Gave ${fmt(details.points)} pts`;
        default: return fmt(action).replace(/_/g, " ");
      }
    }

    async function loadActionLogs() {
      actionLogsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">Loading...</div>`;
      try {
        const q = query(collection(db, "actionLogs"), orderBy("timestamp", "desc"), limit(50));
        const snap = await getDocs(q);
        if (snap.empty) {
          actionLogsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">No logs found.</div>`;
          return;
        }
        let html = "";
        snap.forEach((doc) => {
          const d = doc.data();
          const ts = d.timestamp?.toDate?.() || new Date(d.timestamp);
          const dateTime = isNaN(ts.getTime()) ? "—" : `${String(ts.getMonth()+1).padStart(2,'0')}/${String(ts.getDate()).padStart(2,'0')} ${ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
          html += `<div class="log-entry">
            <span class="log-date">${dateTime}</span>
            <span class="log-user">${escapeHtml(d.username || "?")}</span>
            <span class="log-action"><span class="act">${formatAction(d.action, d.details || {})}</span></span>
          </div>`;
        });
        actionLogsContainer.innerHTML = html;
      } catch (e) {
        actionLogsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:var(--accent-red)">Failed to load logs: ${escapeHtml(e.message)}</div>`;
      }
    }

    // -------------------------
    // Discord Auth Gate
    // -------------------------
    const loginOverlay = document.getElementById("discordLoginOverlay");
    const loginStatus = document.getElementById("loginStatus");
    const loginStartBtn = document.getElementById("loginStartBtn");

    loginStartBtn.addEventListener("click", startDiscordLogin);

    function startDiscordLogin() {
      const state = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      sessionStorage.setItem("discordOAuthState", state);
      const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify%20guilds&state=${state}`;
      window.open(url, "discord-auth", "width=600,height=700");
    }

    window.addEventListener("message", (event) => {
      if (event.data?.type === "discordAuth") {
        const d = event.data.data;
        d.timestamp = Date.now();
        sessionStorage.setItem("discordAuthData", JSON.stringify(d));
        onAuthResult(d);
      }
    });

    function isDiscordAdmin(d) {
      return d.isAdmin === true;
    }

    function onAuthResult(d) {
      if (d.inGuild) {
        document.documentElement.classList.add("auth-granted");
        if (isDiscordAdmin(d)) {
          sessionStorage.setItem("userMode", "admin");
        }
        loginOverlay.classList.add("hidden");
        updateDiscordBadge();
        updateAuthUI();
        init();
      } else {
        hideLoadingOverlay();
        loginOverlay.classList.remove("hidden");
        loginStatus.textContent = `Access Denied — ${d.displayName} is not a member of the STR4NG3RZ server.`;
        loginStartBtn.style.display = "none";
      }
    }

    function checkAuth() {
      const stored = sessionStorage.getItem("discordAuthData");
      if (stored) {
        try {
          const d = JSON.parse(stored);
          if (d.inGuild) {
            document.documentElement.classList.add("auth-granted");
            if (!sessionStorage.getItem("userMode") || sessionStorage.getItem("userMode") === "member") {
              if (isDiscordAdmin(d)) {
                sessionStorage.setItem("userMode", "admin");
              }
            }
            loginOverlay.classList.add("hidden");
            updateDiscordBadge();
            updateAuthUI();
            init();
            return;
          } else {
            hideLoadingOverlay();
            loginStatus.textContent = `Access Denied — ${d.displayName} is not a member of the STR4NG3RZ server.`;
            return;
          }
        } catch (e) {}
      }
      hideLoadingOverlay();
      loginOverlay.classList.remove("hidden");
      loginStatus.textContent = "Login with Discord to access the Command Center.";
      loginStartBtn.style.display = "inline-flex";
    }

    // ── Discord helpers ──────────────────────────────
    function getDiscordAuth() {
      try { return JSON.parse(sessionStorage.getItem("discordAuthData")); } catch { return null; }
    }

    function updateDiscordBadge() {
      const auth = getDiscordAuth();
      const badge = document.getElementById("discordBadgeBtn");
      const nameEl = document.getElementById("discordBadgeName");
      const iconEl = badge?.querySelector(".discord-badge-icon");
      if (auth && auth.inGuild) {
        const display = auth.displayName || auth.username;
        nameEl.textContent = display;
        badge.style.display = "flex";
        const len = display.length;
        nameEl.style.fontSize = (len >= 18 ? "10px" : len >= 14 ? "11px" : "12px");

        if (auth.avatar && iconEl && iconEl.tagName === "IMG") {
          iconEl.src = `https://cdn.discordapp.com/avatars/${auth.id}/${auth.avatar}.png`;
          iconEl.alt = `${display} avatar`;
        } else if (auth.avatar && iconEl) {
          const img = document.createElement("img");
          img.className = iconEl.getAttribute("class") || "discord-badge-icon";
          img.src = `https://cdn.discordapp.com/avatars/${auth.id}/${auth.avatar}.png`;
          img.alt = `${display} avatar`;
          iconEl.replaceWith(img);
        }
      } else {
        badge.style.display = "none";
      }
    }

    // ── Discord dropdown ────────────────────────────
    document.getElementById("discordBadgeBtn").addEventListener("click", () => {
      if (!getDiscordAuth()) return;
      document.getElementById("discordDropdown").classList.toggle("show");
    });
    document.getElementById("discordDisconnectBtn").addEventListener("click", () => {
      document.getElementById("discordDropdown").classList.remove("show");
      sessionStorage.removeItem("discordAuthData");
      sessionStorage.removeItem("discordOAuthState");
      sessionStorage.setItem("userMode", "member");
      document.documentElement.classList.remove("auth-granted");
      document.getElementById("discordLoginOverlay").classList.remove("hidden");
      document.getElementById("loginStatus").textContent = "Login with Discord to access the Command Center.";
      document.getElementById("loginStartBtn").style.display = "inline-flex";
      updateDiscordBadge();
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#discordBadgeBtn") || e.target.closest("#discordDropdown")) return;
      document.getElementById("discordDropdown").classList.remove("show");
    }, true);

    async function logAction(action, details = {}) {
      const auth = getDiscordAuth();
      if (!auth) return;
      try {
        await addDoc(collection(db, "actionLogs"), {
          username: auth.username,
          userId: auth.id,
          action,
          details,
          timestamp: serverTimestamp(),
        });
        const q = query(collection(db, "actionLogs"), orderBy("timestamp", "asc"));
        const snap = await getDocs(q);
        if (snap.docs.length > 50) {
          const batch = writeBatch(db);
          snap.docs.slice(0, snap.docs.length - 50).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      } catch (e) {
        console.warn("Failed to log action:", e);
      }
    }

    // -------------------------
    // Init sequence
    // -------------------------
    async function init() {
      if (appInitialized) return;
      showLoadingOverlay();

      // ✅ Wait until the DOM is fully loaded
      await new Promise((resolve) => {
        if (
          document.readyState === "complete" ||
          document.readyState === "interactive"
        )
          resolve();
        else
          document.addEventListener("DOMContentLoaded", resolve, {
            once: true,
          });
      });

      // Load boss data from external JSON
      try {
        const res = await fetch("./bosses_data.json?t=" + Date.now());
        const data = await res.json();
        BOSSES = data.bosses;
        LOCATIONS = data.locations;
      } catch (e) {
        console.warn("Failed to load bosses_data.json, using inline fallback.");
      }

      weeklyBossListEl.innerHTML = "";
      timerBossListEl.innerHTML = "";
      nextBossNameEl.textContent = "";
      nextTimeEl.textContent = "";

      try {
        // Condition 1+4: real-time listener — syncs when data is written to Firestore
        const docRef = doc(db, "timers", "global");
        onSnapshot(docRef, async (snap) => {
          if (!snap.exists()) {
            if (snap.metadata.fromCache) return;
            await setDoc(docRef, { timers: {} }, { merge: true });
            return;
          }

          if (snap.metadata?.hasPendingWrites) return;

          applyTimersFromSnapshot(snap.data().timers || {});

          // Condition 6: normalize expired timers silently on first snapshot.
          if (!normalized) {
            const now = Date.now();
            let changed = false;

            for (const [id, info] of Object.entries(timers)) {
              const boss = BOSSES.find((b) => b.id === id);
              if (!boss || !info || !info.endTime) continue;

              let cleaned = false;
              const clean = { ...info };
              for (const k of STALE_KEYS) {
                if (k in clean) { delete clean[k]; cleaned = true; }
              }

              if (info.cooldownUntil && info.cooldownUntil > now) {
                if (cleaned) { timers[id] = clean; changed = true; }
                continue;
              }

              if (info.endTime <= now) {
                if (boss.weeklyRespawns) {
                  const next = getNextWeeklyRespawn(boss.weeklyRespawns, now + 1);
                  timers[id] = { endTime: next, startedAt: now, weekly: true, cooldownUntil: null };
                } else {
                  // Account for the SPAWNED window at the start of each cycle
                  const respMs = boss.respawn * 1000;
                  const fullCycle = respMs + SPAWNED_DURATION_MS;
                  const elapsed = now - info.endTime;
                  const intoCycle = elapsed % fullCycle;

                  if (intoCycle < SPAWNED_DURATION_MS) {
                    // Still within the SPAWNED window
                    timers[id] = {
                      endTime: info.endTime,
                      startedAt: info.startedAt,
                      cooldownUntil: now + (SPAWNED_DURATION_MS - intoCycle),
                    };
                  } else {
                    // Past SPAWNED window — countdown is running
                    const countdownElapsed = intoCycle - SPAWNED_DURATION_MS;
                    const remaining = respMs - countdownElapsed;
                    timers[id] = { endTime: now + remaining, startedAt: now, cooldownUntil: null };
                  }
                }
                changed = true;
              } else {
                if ("cooldownUntil" in clean) { delete clean.cooldownUntil; cleaned = true; }
                if (cleaned) { timers[id] = clean; changed = true; }
              }
            }

            for (const boss of BOSSES) {
              if (boss.weeklyRespawns && !timers[boss.id]) {
                const next = getNextWeeklyRespawnTime(boss);
                if (next) {
                  timers[boss.id] = { endTime: next, startedAt: now, weekly: true, cooldownUntil: null };
                  changed = true;
                }
              }
            }

            if (changed) renderBossList();

            if (!snap.metadata.fromCache) {
              normalized = true;
              if (changed) {
                try { await saveTimers(); } catch (err) {
                  console.error("Failed to save normalized timers:", err);
                }
              }
              renderBossList();
            }
          }

          if (!firebaseLoaded) {
            firebaseLoaded = true;
            hideLoadingOverlay();
            appInitialized = true;
          }
        }, (err) => {
          console.warn("Timers snapshot error (non-fatal):", err.code);
        });
      } catch (e) {
        console.warn("Firestore load failed", e);
      }

      // ✅ Ensure Discord webhook is ready before any future notification
      await autoLoadWebhook();

      updateWorldBossName();

      console.log("✅ init completed successfully.");
    }

    // === AUTH: member by default, admin status from Discord OAuth worker ===

    if (!sessionStorage.getItem("userMode")) {
      sessionStorage.setItem("userMode", "member");
    }

    function updateAuthUI() {
      const isAdmin = sessionStorage.getItem("userMode") === "admin";
      document.documentElement.classList.toggle("is-admin", isAdmin);
      if (settingsBtn) {
        settingsBtn.classList.toggle("hidden", !isAdmin);
      }
      if (!isAdmin) {
        settingsDropdown.classList.add("hidden");
      }
    }

    updateAuthUI();



    window.addEventListener("load", () => {
      checkAuth();
      checkForUpdates();
      setInterval(checkForUpdates, 30000);
    });


    // ════════════════════════════════════════════
    // ADMIN FEATURES (Members, Boss Config, Leaderboard, Activity, Party)
    // ════════════════════════════════════════════

    const $ = (id) => document.getElementById(id);
    function escapeHtml(str) {
      const div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }
    const ADMIN_DOC = doc(db, "guildData", "admin");

    let ghMembers = [];
    let ghBossPoints = {};
    let ghMemberPoints = {};
    let ghWeaponMastery = {};
    let ghActivityLog = [];
    let ghSortMode = 'name';
    let ghSortOrder = 'asc';
    let ghAdminUnsub = null;

    // ─── DOM refs ───
    const ghMemberList = $('ghMemberList');
    const ghMemberSearch = $('ghMemberSearch');
    const clearMemberSearch = $('clearMemberSearch');
    const ghMemberCount = $('ghMemberCount');
    const ghSortBtn = $('ghSortBtn');
    const ghOrderBtn = $('ghOrderBtn');
    const ghOrderIcon = $('ghOrderIcon');
    const ghBossConfigList = $('ghBossConfigList');
    const ghBossConfigSearch = $('ghBossConfigSearch');
    const clearBossConfigSearch = $('clearBossConfigSearch');
    const ghLeaderboardList = $('ghLeaderboardList');
    const ghActivityLogEl = $('ghActivityLog');
    const ghMemberOverlay = $('ghMemberOverlay');
    const ghMemberPopup = $('ghMemberPopup');
    const ghMemberPopupClose = $('ghMemberPopupClose');
    const ghMemberNameInput = $('ghMemberNameInput');
    const ghAddMemberBtn = $('ghAddMemberBtn');
    const ghWmSelect = $('ghWmSelect');
    const ghBulkImportArea = $('ghBulkImportArea');
    const ghBulkImportBtn = $('ghBulkImportBtn');
    const ghToggleAddMember = $('ghToggleAddMember');
    const ghToggleGivePoints = $('ghToggleGivePoints');
    const ghResetBossConfig = $('ghResetBossConfig');
    const ghResetLeaderboard = $('ghResetLeaderboard');
    const ghClearActivity = $('ghClearActivity');

    // Party popup refs
    const partyOverlay = $('partyOverlay');
    const partyPanel = $('partyPanel');
    const partyPopupClose = $('partyPopupClose');
    const screenshotInput = $('screenshotInput');
    const screenshotUpload = $('screenshotUpload');
    const screenshotThumbs = $('screenshotThumbs');
    const ocrStatus = $('ocrStatus');
    const ocrStatusText = $('ocrStatusText');
    const selectedPillList = $('selectedPillList');
    const allMembersPanel = $('allMembersPanel');
    const partySearch = $('partySearch');
    const partySortBtn = $('partySortBtn');
    const partyOrderBtn = $('partyOrderBtn');
    const partyOrderIcon = $('partyOrderIcon');
    const unrecognizedList = $('unrecognizedList');
    const selectedCount = $('selectedCount');
    const confirmPointsEach = $('confirmPointsEach');
    const confirmKillBtn = $('confirmKillBtn');
    const panelHeaderText = $('panelHeaderText');
    const ghPointsSignToggle = $('ghPointsSignToggle');
    const ghPointsSignLabel = $('ghPointsSignLabel');
    const ghPointsInput = $('ghPointsInput');
    const partyModeSummary = $('partyModeSummary');
    const pointsModeInput = $('pointsModeInput');

    let ghScreenshotDataUrls = [];
    let ghOcrRunning = false;
    let ghScanResults = null;
    let ghSelectedMembers = new Set();
    let ghPartySortMode = 'default';
    let ghPartySortOrder = 'asc';
    let ghCurrentBossId = null;

    // ─── Firestore load/save ───
    async function loadAdminData() {
      try {
        const snap = await getDoc(ADMIN_DOC);
        if (snap.exists()) {
          const d = snap.data();
          ghMembers = d.members || [];
          ghBossPoints = d.bossPoints || {};
          ghMemberPoints = d.memberPoints || {};
          ghWeaponMastery = d.weaponMastery || {};
          ghActivityLog = d.activityLog || [];
        }
      } catch (e) { console.warn("loadAdminData:", e); }
    }

    async function saveAdminData() {
      try {
        await setDoc(ADMIN_DOC, {
          members: ghMembers,
          bossPoints: ghBossPoints,
          memberPoints: ghMemberPoints,
          weaponMastery: ghWeaponMastery,
          activityLog: ghActivityLog,
        });
      } catch (e) { console.warn("saveAdminData:", e); }
    }

    function subscribeAdminData() {
      if (ghAdminUnsub) { ghAdminUnsub(); ghAdminUnsub = null; }
      ghAdminUnsub = onSnapshot(ADMIN_DOC, (snap) => {
        if (snap.metadata?.hasPendingWrites) return;
        if (!snap.exists()) return;
        const d = snap.data();
        ghMembers = d.members || [];
        ghBossPoints = d.bossPoints || {};
        ghMemberPoints = d.memberPoints || {};
        ghWeaponMastery = d.weaponMastery || {};
        ghActivityLog = d.activityLog || [];
        ghRenderMemberList(ghMemberSearch.value);
        ghRenderBossConfig(ghBossConfigSearch.value);
        ghRenderLeaderboard();
        ghRenderActivity();
      });
    }

    // ─── Admin Tab Switching ───
    const adminNav = $('adminNav');
    document.querySelectorAll('.admin-nav .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-nav .nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = $('panel' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1));
        if (panel) panel.classList.add('active');
        if (btn.dataset.tab !== 'bosslist') {
          $('bossListPanel').style.display = 'none';
          $('topPanelsRow') && ($('topPanelsRow').style.display = 'none');
        } else {
          $('bossListPanel').style.display = '';
          $('topPanelsRow') && ($('topPanelsRow').style.display = '');
        }
        hidePartyPanel();
      });
    });

    // ─── Add Activity ───
    function ghAddActivity(message) {
      const now = new Date();
      const date = now.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
      const time = date + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ghActivityLog.unshift({ time, message });
      if (ghActivityLog.length > 50) ghActivityLog = ghActivityLog.slice(0, 50);
      saveAdminData();
      ghRenderActivity();
    }

    function ghRenderActivity() {
      let html = '';
      if (ghActivityLog.length === 0) {
        html += '<div class="log-entry"><span class="empty-state" style="padding:4px 0">No activity yet.</span></div>';
      } else {
        for (const entry of ghActivityLog) {
          html += `<div class="log-entry"><span class="log-time">${entry.time}</span><span class="log-msg">${escapeHtml(entry.message)}</span></div>`;
        }
      }
      ghActivityLogEl.innerHTML = html;
    }

    // ─── Members ───
    function ghRenderMemberList(filter) {
      const search = (filter || '').toLowerCase();
      let filtered = search ? ghMembers.filter(m => m.toLowerCase().includes(search)) : ghMembers;
      if (filtered.length === 0) {
        ghMemberList.innerHTML = '<div class="empty-state" style="padding:24px 0">' +
          (ghMembers.length === 0 ? 'No members yet.' : 'No members match your search.') + '</div>';
        ghMemberCount.textContent = '0';
        return;
      }
      ghMemberCount.textContent = ghMembers.length;
      let sorted = [...filtered];
      if (ghSortMode === 'name') sorted.sort((a,b) => a.localeCompare(b));
      else if (ghSortMode === 'weapon') sorted.sort((a,b) => ((ghWeaponMastery[a]||'')).localeCompare(ghWeaponMastery[b]||'') || a.localeCompare(b));
      if (ghSortOrder === 'desc') sorted.reverse();

      let html = '';
      for (const m of sorted) {
        const wm = ghWeaponMastery[m] || '';
        html += `<div class="member-item">
          <span class="member-name">${escapeHtml(m)}</span>
          <span class="member-wm">${wm ? escapeHtml(wm) : '<span style="color:var(--text-muted)">—</span>'}</span>
          <div style="display:flex;align-items:center;gap:4px">
            <button class="kbtn" data-action="edit" data-name="${escapeHtml(m)}" style="width:32px;min-width:32px;height:32px;padding:0"><svg width="14" height="14" aria-hidden="true"><use href="#icon-edit"/></svg></button>
            <button class="kbtn" data-action="remove" data-name="${escapeHtml(m)}" style="width:32px;min-width:32px;height:32px;padding:0;color:var(--accent-red)"><svg width="14" height="14" aria-hidden="true"><use href="#icon-x"/></svg></button>
          </div>
        </div>`;
      }
      ghMemberList.innerHTML = html;

      ghMemberList.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name;
          ghMembers = ghMembers.filter(m => m.toLowerCase() !== name.toLowerCase());
          delete ghMemberPoints[name];
          delete ghWeaponMastery[name];
          saveAdminData();
          logAction("remove_member", { name });
          ghRenderMemberList(ghMemberSearch.value);
          ghRenderLeaderboard();
        });
      });
      ghMemberList.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const item = btn.closest('.member-item');
          const nameEl = item.querySelector('.member-name');
          const wmEl = item.querySelector('.member-wm');
          const oldName = nameEl.textContent;
          const oldWm = ghWeaponMastery[oldName] || '';

          const input = document.createElement('input');
          input.type = 'text'; input.value = oldName;
          input.style.cssText = 'flex:1;min-width:0;padding:2px 6px;font-size:12px;font-family:var(--font-display);background:var(--bg-primary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);outline:none';
          nameEl.replaceWith(input);
          input.focus(); input.select();

          const select = document.createElement('select');
          select.style.cssText = 'padding:1px 20px 1px 6px;font-size:12px;font-family:var(--font-display);font-weight:500;flex:1;min-width:0;margin:0;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-primary);color:var(--text-primary);cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%236B7A8F\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;text-align:center;text-align-last:center';
          select.innerHTML = '<option value="">—</option>' + ['Bare Hands','Sword and Shield','Battle Staff','Battle Shield','Greatsword','Staff','Dual Daggers','Bow','Crossbow'].map(w => `<option value="${w}"${w===oldWm?' selected':''}>${w}</option>`).join('');
          wmEl.replaceWith(select);

          function finish(save) {
            const newName = input.value.trim() || oldName;
            const newWm = select.value;
            if (!save || (newName === oldName && newWm === oldWm)) {
              const sn = document.createElement('span'); sn.className = 'member-name'; sn.textContent = oldName; input.replaceWith(sn);
              const sw = document.createElement('span'); sw.className = 'member-wm'; sw.innerHTML = oldWm ? escapeHtml(oldWm) : '<span style="color:var(--text-muted)">—</span>'; select.replaceWith(sw);
              return;
            }
            if (newName !== oldName) {
              if (ghMembers.some(m => m.toLowerCase() !== oldName.toLowerCase() && m.toLowerCase() === newName.toLowerCase())) { showToast('Member exists', 'error'); finish(false); return; }
              const idx = ghMembers.indexOf(oldName);
              if (idx > -1) ghMembers[idx] = newName;
              if (ghMemberPoints[oldName] !== undefined) { ghMemberPoints[newName] = ghMemberPoints[oldName]; delete ghMemberPoints[oldName]; }
              if (ghWeaponMastery[oldName] !== undefined) { ghWeaponMastery[newName] = ghWeaponMastery[oldName]; delete ghWeaponMastery[oldName]; }
              logAction("rename_member", { oldName, newName });
            }
            if (newWm !== oldWm) { ghWeaponMastery[newName] = newWm || ''; }
            saveAdminData();
            ghRenderMemberList(ghMemberSearch.value);
            ghRenderLeaderboard();
            ghRenderAllMembers();
          }

          let blurTimer = null;
          input.addEventListener('blur', () => { blurTimer = setTimeout(() => { if (!item.contains(document.activeElement)) finish(true); }, 150); });
          input.addEventListener('keydown', e => { if (e.key==='Enter') finish(true); if (e.key==='Escape') finish(false); });
          select.addEventListener('change', () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } input.focus(); });
        });
      });
    }

    // ─── Add Member Popup ───
    function closeMemberPopup() {
      ghMemberPopup.style.display = 'none';
      ghMemberOverlay.style.display = 'none';
      ghMemberNameInput.value = '';
      ghBulkImportArea.value = '';
      ghWmSelect.value = '';
    }
    ghToggleAddMember.addEventListener('click', () => { ghMemberPopup.style.display = 'flex'; ghMemberOverlay.style.display = 'block'; });
    ghMemberPopupClose.addEventListener('click', closeMemberPopup);
    ghMemberOverlay.addEventListener('click', closeMemberPopup);

    function ghAddMember(name, wm) {
      name = name.trim().replace(/\s+/g, ' ');
      if (!name) return;
      if (ghMembers.some(m => m.toLowerCase() === name.toLowerCase())) { showToast('Member "' + name + '" already exists.', 'error'); return; }
      ghMembers.push(name);
      if (wm) ghWeaponMastery[name] = wm;
      saveAdminData();
      logAction("add_member", { name, weaponMastery: wm || null });
      ghRenderMemberList(ghMemberSearch.value);
      ghRenderAllMembers();
      ghRenderLeaderboard();
    }

    ghAddMemberBtn.addEventListener('click', () => {
      const name = ghMemberNameInput.value.trim();
      const wm = ghWmSelect.value;
      if (name) { ghAddMember(name, wm); ghMemberNameInput.value = ''; ghWmSelect.value = ''; ghMemberNameInput.focus(); }
    });
    ghMemberNameInput.addEventListener('keypress', e => { if (e.key === 'Enter') ghAddMemberBtn.click(); });

    ghBulkImportBtn.addEventListener('click', () => {
      const text = ghBulkImportArea.value.trim();
      if (!text) return;
      const names = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
      let added = 0;
      for (const n of names) {
        if (n && !ghMembers.some(m => m.toLowerCase() === n.toLowerCase())) {
          ghMembers.push(n);
          added++;
        }
      }
      if (added > 0) { saveAdminData(); ghRenderMemberList(ghMemberSearch.value); ghRenderAllMembers(); ghRenderLeaderboard(); showToast('Added ' + added + ' member(s)', 'success'); logAction('bulk_import', { count: added }); }
      ghBulkImportArea.value = '';
    });

    // ─── Member list sort ───
    ghSortBtn.addEventListener('click', () => {
      ghSortMode = ghSortMode === 'name' ? 'weapon' : 'name';
      ghSortBtn.textContent = ghSortMode === 'name' ? 'Name' : 'Weapon';
      ghRenderMemberList(ghMemberSearch.value);
    });
    ghOrderBtn.addEventListener('click', () => {
      ghSortOrder = ghSortOrder === 'asc' ? 'desc' : 'asc';
      ghOrderIcon.textContent = ghSortOrder === 'asc' ? '↑' : '↓';
      ghRenderMemberList(ghMemberSearch.value);
    });
    const updateMemberClear = () => clearMemberSearch.classList.toggle("visible", !!ghMemberSearch.value);
    ghMemberSearch.addEventListener("input", () => { ghRenderMemberList(ghMemberSearch.value); updateMemberClear(); });
    ghMemberSearch.addEventListener("focus", updateMemberClear);
    ghMemberSearch.addEventListener("blur", updateMemberClear);
    clearMemberSearch.addEventListener("click", () => { ghMemberSearch.value = ""; updateMemberClear(); ghRenderMemberList(""); });
    updateMemberClear();

    let panelMode = 'party';

    ghToggleGivePoints.addEventListener('click', () => {
      showPartyPanel(null, 'points');
    });

    ghPointsSignToggle.addEventListener('click', () => {
      const isNeg = ghPointsSignToggle.textContent === '-';
      ghPointsSignToggle.textContent = isNeg ? '+' : '-';
      ghPointsSignLabel.textContent = isNeg ? '+' : '-';
      ghPointsSignLabel.style.color = isNeg ? 'var(--accent-gold)' : 'var(--accent-red)';
      ghPointsSignToggle.style.color = isNeg ? '' : 'var(--accent-red)';
    });

    // ─── Boss Config ───
    function ghRenderBossConfig(filter) {
      const search = (filter || '').toLowerCase();
      const list = BOSSES.filter(b => search ? b.name.toLowerCase().includes(search) || String(b.level).includes(search) : true);
      let html = '';
      for (const b of list) {
        const pts = ghBossPoints[b.id] || 0;
        html += `<div class="boss-config-row">
          <div class="bc-name-wrap">
            <span class="bc-name">${escapeHtml(b.name)}</span>
            <span class="bc-level">Lv.${b.level}</span>
          </div>
          <div class="bc-points">
            <button class="kbtn" data-id="${b.id}" data-dir="down" style="width:24px;min-width:24px;height:24px;padding:0">−</button>
            <input type="number" min="0" max="100" value="${pts}" data-id="${b.id}" class="boss-config-input">
            <button class="kbtn" data-id="${b.id}" data-dir="up" style="width:24px;min-width:24px;height:24px;padding:0">+</button>
          </div>
        </div>`;
      }
      ghBossConfigList.innerHTML = html;

      ghBossConfigList.querySelectorAll('input[type="number"]').forEach(inp => {
        inp.addEventListener('change', () => {
          let v = parseInt(inp.value) || 0;
          v = Math.max(0, Math.min(100, v));
          inp.value = v;
          ghBossPoints[inp.dataset.id] = v;
          saveAdminData();
          logAction("boss_config", { bossId: inp.dataset.id, points: v });
        });
      });
      ghBossConfigList.querySelectorAll('[data-dir]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const dir = btn.dataset.dir;
          const inp = ghBossConfigList.querySelector(`input[data-id="${id}"]`);
          let v = parseInt(inp.value) || 0;
          v = Math.max(0, Math.min(100, v + (dir === 'up' ? 1 : -1)));
          inp.value = v;
          ghBossPoints[id] = v;
          saveAdminData();
          logAction("boss_config", { bossId: id, points: v });
        });
      });
    }

    const updateBossConfigClear = () => clearBossConfigSearch.classList.toggle("visible", !!ghBossConfigSearch.value);
    ghBossConfigSearch.addEventListener("input", () => { ghRenderBossConfig(ghBossConfigSearch.value); updateBossConfigClear(); });
    ghBossConfigSearch.addEventListener("focus", updateBossConfigClear);
    ghBossConfigSearch.addEventListener("blur", updateBossConfigClear);
    clearBossConfigSearch.addEventListener("click", () => { ghBossConfigSearch.value = ""; updateBossConfigClear(); ghRenderBossConfig(""); });
    updateBossConfigClear();
    ghResetBossConfig.addEventListener('click', async () => {
      if (!(await showConfirmModal("Reset all boss points to 0?"))) return;
      ghBossPoints = {}; saveAdminData(); ghRenderBossConfig(); logAction("boss_config_reset"); ghAddActivity('Reset all boss points'); showToast('Boss points reset.', 'success');
    });

    // ─── Leaderboard ───
    function ghRenderLeaderboard() {
      const entries = Object.entries(ghMemberPoints).filter(([name]) => ghMembers.some(m => m.toLowerCase() === name.toLowerCase()));
      entries.sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) {
        ghLeaderboardList.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--text-muted);font-size:12px;font-style:italic">No points recorded yet.</div>';
        return;
      }
      let html = '';
      entries.forEach(([name, pts], i) => {
        const rankClass = i === 0 ? 'top-1' : i === 1 ? 'top-2' : i === 2 ? 'top-3' : '';
        html += `<div class="lb-row"><span class="lb-rank ${rankClass}">${i + 1}</span><span class="lb-name">${escapeHtml(name)}</span><span class="lb-points">${pts} pts</span></div>`;
      });
      ghLeaderboardList.innerHTML = html;
    }

    ghResetLeaderboard.addEventListener('click', async () => {
      if (!(await showConfirmModal("Reset all member points to 0?"))) return;
      ghMemberPoints = {}; saveAdminData(); ghRenderLeaderboard(); ghAddActivity('Reset all member points'); showToast('All member points reset.', 'success'); logAction('leaderboard_reset');
    });

    ghClearActivity.addEventListener('click', async () => {
      if (!(await showConfirmModal("Clear all activity logs? This cannot be undone."))) return;
      ghActivityLog = []; saveAdminData(); ghRenderActivity(); showToast('Activity logs cleared.', 'success'); logAction('activity_cleared');
    });

    // ─── Party Popup ───
    function showPartyPanel(bossId, mode) {
      ghCurrentBossId = bossId;
      panelMode = mode || 'party';
      ghSelectedMembers.clear();
      ghScreenshotDataUrls = [];
      ghScanResults = null;
      screenshotThumbs.innerHTML = '';
      unrecognizedList.innerHTML = '';
      unrecognizedList.style.display = 'none';
      ocrStatus.className = 'ocr-status';
      ocrStatusText.textContent = 'Waiting for screenshot...';
      partySearch.value = '';
      partyOverlay.style.display = 'block';
      partyPanel.style.display = 'flex';
      partyPanel.style.animation = 'none';
      partyPanel.offsetHeight;
      partyPanel.style.animation = 'popIn 0.25s ease both';

      if (panelMode === 'party') {
        panelHeaderText.textContent = 'Party - Rally';
        partyModeSummary.style.display = 'flex';
        pointsModeInput.style.display = 'none';
      } else {
        panelHeaderText.textContent = 'ADD-DEDUCT POINTS';
        partyModeSummary.style.display = 'none';
        pointsModeInput.style.display = 'flex';
        ghPointsInput.value = '1';
        ghPointsSignToggle.textContent = '+';
        ghPointsSignLabel.textContent = '+';
        ghPointsSignLabel.style.color = 'var(--accent-gold)';
        ghPointsSignToggle.style.color = '';
      }

      ghRenderAllMembers();
      ghRenderSelectedMembers();
      ghUpdateConfirmSummary();
    }

    function hidePartyPanel() {
      partyOverlay.style.display = 'none';
      partyPanel.style.display = 'none';
    }

    partyPopupClose.addEventListener('click', hidePartyPanel);
    partyOverlay.addEventListener('click', hidePartyPanel);

    function ghRenderAllMembers() {
      const container = allMembersPanel;
      if (ghMembers.length === 0) {
        container.innerHTML = '<div class="empty-state">No members in guild.</div>';
        return;
      }
      const filter = (partySearch.value || '').toLowerCase();
      let filtered = filter ? ghMembers.filter(m => m.toLowerCase().includes(filter)) : ghMembers;
      if (ghPartySortMode === 'name') {
        filtered = [...filtered].sort((a, b) => a.localeCompare(b));
        if (ghPartySortOrder === 'desc') filtered.reverse();
      }
      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">No members match filter.</div>';
        return;
      }
      let html = '';
      for (const m of filtered) {
        const sel = ghSelectedMembers.has(m) ? ' selected' : '';
        html += `<span class="pill${sel}" data-name="${escapeHtml(m)}">${escapeHtml(m)}</span>`;
      }
      container.innerHTML = html;
      container.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
          const name = pill.dataset.name;
          if (ghSelectedMembers.has(name)) ghSelectedMembers.delete(name);
          else ghSelectedMembers.add(name);
          ghRenderAllMembers();
          ghRenderSelectedMembers();
          ghUpdateConfirmSummary();
        });
      });
    }

    function ghRenderSelectedMembers() {
      const list = selectedPillList;
      if (ghSelectedMembers.size === 0) {
        list.innerHTML = '<span class="empty-state">No members selected</span>';
        return;
      }
      let html = '';
      for (const name of ghSelectedMembers) {
        html += `<span class="pill selected" data-name="${escapeHtml(name)}">${escapeHtml(name)}<button class="pill-x" data-name="${escapeHtml(name)}">✕</button></span>`;
      }
      list.innerHTML = html;
      list.querySelectorAll('.pill-x').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          ghSelectedMembers.delete(btn.dataset.name);
          ghRenderAllMembers();
          ghRenderSelectedMembers();
          ghUpdateConfirmSummary();
        });
      });
    }

    function ghUpdateConfirmSummary() {
      const count = ghSelectedMembers.size;
      selectedCount.textContent = count;
      if (panelMode === 'party') {
        const ptsPer = ghCurrentBossId ? (ghBossPoints[ghCurrentBossId] || 0) : 0;
        confirmPointsEach.textContent = ptsPer;
        confirmKillBtn.disabled = count === 0 || !ghCurrentBossId;
      } else {
        confirmKillBtn.disabled = count === 0;
      }
    }

    partySearch.addEventListener('input', ghRenderAllMembers);
    partySortBtn.addEventListener('click', () => {
      ghPartySortMode = ghPartySortMode === 'name' ? 'default' : 'name';
      partySortBtn.textContent = ghPartySortMode === 'name' ? 'Name' : 'Default';
      ghRenderAllMembers();
    });
    partyOrderBtn.addEventListener('click', () => {
      ghPartySortOrder = ghPartySortOrder === 'asc' ? 'desc' : 'asc';
      partyOrderIcon.textContent = ghPartySortOrder === 'asc' ? '↑' : '↓';
      if (ghPartySortMode === 'name') ghRenderAllMembers();
    });

    // ─── Screenshot Upload ───
    screenshotInput.addEventListener('change', (e) => {
      for (const file of e.target.files) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          ghScreenshotDataUrls.push(ev.target.result);
          ghRenderThumbnails();
          ghRunOcr();
        };
        reader.readAsDataURL(file);
      }
      e.target.value = '';
    });

    screenshotUpload.addEventListener('dragover', (e) => { e.preventDefault(); screenshotUpload.classList.add('dragover'); });
    screenshotUpload.addEventListener('dragleave', () => { screenshotUpload.classList.remove('dragover'); });
    screenshotUpload.addEventListener('drop', (e) => {
      e.preventDefault(); screenshotUpload.classList.remove('dragover');
      for (const file of e.dataTransfer.files) {
        if (!file.type.startsWith('image/')) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          ghScreenshotDataUrls.push(ev.target.result);
          ghRenderThumbnails();
          ghRunOcr();
        };
        reader.readAsDataURL(file);
      }
    });

    function ghRenderThumbnails() {
      let html = '';
      ghScreenshotDataUrls.forEach((url, i) => {
        html += `<div class="screenshot-thumb"><img src="${url}"><button class="thumb-remove" data-idx="${i}">✕</button></div>`;
      });
      screenshotThumbs.innerHTML = html;
      screenshotThumbs.querySelectorAll('.thumb-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          ghScreenshotDataUrls.splice(idx, 1);
          ghRenderThumbnails();
          if (ghScreenshotDataUrls.length === 0) ghClearScreenshot();
        });
      });
    }

    function ghClearScreenshot() {
      if (ghScanResults) {
        for (const n of (ghScanResults.matched || [])) ghSelectedMembers.delete(n);
        ghScanResults = null;
      }
      ghScreenshotDataUrls = [];
      screenshotThumbs.innerHTML = '';
      ocrStatus.className = 'ocr-status';
      ocrStatusText.textContent = 'Waiting for screenshot...';
      ghRenderAllMembers();
      ghRenderSelectedMembers();
      ghUpdateConfirmSummary();
    }

    function ocrNormalizeChar(s) {
      return s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E').replace(/4/g, 'A').replace(/5/g, 'S').replace(/6/g, 'G').replace(/8/g, 'B').replace(/Q/g, 'O');
    }

    const CIRCLED_NUM_MAP = { '\u2460':'1','\u2461':'2','\u2462':'3','\u2463':'4','\u2464':'5','\u2465':'6','\u2466':'7','\u2467':'8','\u2468':'9' };
    const CIRCLED_NUM_RE = /[\u2460-\u2468]/g;

    function processOcrText(allText, members) {
      const tokens = allText.split(/[\s,]+/)
        .map(t => t.replace(CIRCLED_NUM_RE, m => CIRCLED_NUM_MAP[m]))
        .map(t => t.replace(/[^a-zA-Z0-9\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/g, ''))
        .filter(Boolean);

      const reCjkRun = /^[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]+$/;
      const merged = [];
      let cjkBuf = '';
      for (const t of tokens) {
        if (reCjkRun.test(t)) { cjkBuf += t; }
        else { if (cjkBuf) { merged.push(cjkBuf); cjkBuf = ''; } merged.push(t); }
      }
      if (cjkBuf) merged.push(cjkBuf);
      const unique = [...new Set(merged.map(t => t.toUpperCase()))];

      const memberMap = new Map();
      const normalizedMap = new Map();
      const looseMap = new Map();
      for (const m of members) {
        const key = m.toUpperCase();
        memberMap.set(key, m);
        const norm = ocrNormalizeChar(key);
        if (!normalizedMap.has(norm)) normalizedMap.set(norm, m);
        const loose = key.replace(/[^A-Z0-9]/g, '');
        if (loose && !looseMap.has(loose)) looseMap.set(loose, m);
      }

      function matchToken(token) {
        if (memberMap.has(token)) return memberMap.get(token);
        const norm = ocrNormalizeChar(token);
        if (normalizedMap.has(norm)) return normalizedMap.get(norm);
        const loose = token.replace(/[^A-Z0-9]/g, '');
        if (loose && looseMap.has(loose)) return looseMap.get(loose);
        return null;
      }

      const matched = new Set();
      const consumed = new Set();

      for (let i = 0; i < unique.length; i++) {
        if (consumed.has(i)) continue;
        const hit = matchToken(unique[i]);
        if (hit) { matched.add(hit); consumed.add(i); }
      }

      for (let i = 0; i < unique.length; i++) {
        if (consumed.has(i)) continue;
        if (i + 1 < unique.length && !consumed.has(i + 1)) {
          const c = unique[i] + unique[i + 1];
          const hit = matchToken(c);
          if (hit) { matched.add(hit); consumed.add(i); consumed.add(i + 1); continue; }
        }
        if (i + 2 < unique.length && !consumed.has(i + 1) && !consumed.has(i + 2)) {
          const c = unique[i] + unique[i + 1] + unique[i + 2];
          const hit = matchToken(c);
          if (hit) { matched.add(hit); consumed.add(i); consumed.add(i + 1); consumed.add(i + 2); continue; }
        }
      }

      const unrecognized = [];
      for (let i = 0; i < unique.length; i++) {
        if (!consumed.has(i)) unrecognized.push(unique[i]);
      }

      return { matched: [...matched], unrecognized };
    }

    function preprocessImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          let min = 255, max = 0;
          for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = data[i + 1] = data[i + 2] = gray;
            if (gray < min) min = gray;
            if (gray > max) max = gray;
          }
          const range = max - min;
          if (range > 0) {
            for (let i = 0; i < data.length; i += 4) {
              data[i] = data[i + 1] = data[i + 2] = (data[i] - min) / range * 255;
            }
          }
          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL());
        };
        img.onerror = reject;
        img.src = dataUrl;
      });
    }

    async function ghRunOcr() {
      if (ghOcrRunning) return;
      if (typeof Tesseract === 'undefined') {
        ocrStatus.className = 'ocr-status visible ocr-error';
        ocrStatusText.textContent = 'OCR library failed to load. Please refresh the page.';
        return;
      }
      ghOcrRunning = true;
      ocrStatus.className = 'ocr-status visible ocr-loading';
      ocrStatusText.textContent = 'Running OCR on ' + ghScreenshotDataUrls.length + ' screenshot(s)...';

      let allText = '';
      try {
        for (let idx = 0; idx < ghScreenshotDataUrls.length; idx++) {
          ocrStatusText.textContent = 'Screenshot ' + (idx + 1) + '/' + ghScreenshotDataUrls.length + '...';
          const processed = await preprocessImage(ghScreenshotDataUrls[idx]);
          const result = await Tesseract.recognize(processed, 'eng+jpn', { logger: m => {
            if (m.status === 'recognizing text') ocrStatusText.textContent = 'Screenshot ' + (idx + 1) + ' reading... ' + Math.round(m.progress * 100) + '%';
          }});
          allText += result.data.text + '\n';
        }
      } catch (err) {
        ocrStatus.className = 'ocr-status visible ocr-error';
        ocrStatusText.textContent = 'OCR failed: ' + err.message;
        ghOcrRunning = false;
        return;
      }

      const { matched, unrecognized } = processOcrText(allText, ghMembers);

      for (const name of matched) ghSelectedMembers.add(name);
      ghScanResults = { matched: [...matched], unrecognized };

      ocrStatus.className = 'ocr-status visible ' + (matched.length > 0 ? 'ocr-done' : 'ocr-warning');
      ocrStatusText.textContent = matched.length > 0
        ? 'Matched ' + matched.length + ' member(s)' + (unrecognized.length ? ' · ' + unrecognized.length + ' unrecognized' : '')
        : 'No recognizable names found.';

      if (unrecognized.length > 0) {
        let html = '';
        for (const name of unrecognized) {
          html += `<span class="pill" data-name="${escapeHtml(name)}">${escapeHtml(name)}<button class="pill-add" data-name="${escapeHtml(name)}">+</button></span>`;
        }
        unrecognizedList.innerHTML = html;
        unrecognizedList.style.display = 'block';
        unrecognizedList.querySelectorAll('.pill-add').forEach(btn => {
          btn.addEventListener('click', () => {
            const name = btn.dataset.name;
            if (!ghMembers.some(m => m.toLowerCase() === name.toLowerCase())) {
              ghMembers.push(name);
              saveAdminData();
              ghRenderMemberList(ghMemberSearch.value);
              ghRenderAllMembers();
              ghRenderLeaderboard();
              ghAddActivity('Added member from scan: ' + name);
              logAction("add_member_scan", { name });
              showToast('Added "' + name + '" to guild.', 'success');
              btn.closest('.pill').remove();
            }
          });
        });
      } else {
        unrecognizedList.style.display = 'none';
      }

      ghRenderAllMembers();
      ghRenderSelectedMembers();
      ghUpdateConfirmSummary();
      ghOcrRunning = false;
    }

    // ─── Confirm ───
    confirmKillBtn.addEventListener('click', () => {
      if (panelMode === 'party') {
        const ptsPer = ghCurrentBossId ? (ghBossPoints[ghCurrentBossId] || 0) : 0;
        if (ghSelectedMembers.size === 0) return;
        const bossObj = BOSSES.find(b => b.id === ghCurrentBossId);
        const bossName = bossObj ? bossObj.name : ghCurrentBossId;
        for (const name of ghSelectedMembers) {
          ghMemberPoints[name] = (ghMemberPoints[name] || 0) + ptsPer;
        }
        const names = [...ghSelectedMembers];
        saveAdminData();
        logAction("award_points", { bossName, bossId: ghCurrentBossId, points: ptsPer, members: names });
        ghAddActivity('Killed ' + bossName + '. Awarded ' + ptsPer + ' pts to ' + names.join(', '));
        showToast('Awarded ' + ptsPer + ' pts to ' + names.length + ' member(s)', 'success');
      } else {
        const selected = [...ghSelectedMembers];
        let pts = parseInt(ghPointsInput.value) || 0;
        if (ghPointsSignToggle.textContent === '-') pts = -Math.abs(pts);
        if (selected.length === 0) { showToast('Select at least one member.', 'error'); return; }
        if (pts === 0) { showToast('Points must not be 0.', 'error'); return; }
        for (const name of selected) {
          ghMemberPoints[name] = (ghMemberPoints[name] || 0) + pts;
        }
        saveAdminData();
        logAction("give_points", { members: selected, points: pts });
        const verb = pts > 0 ? 'awarded' : 'deducted';
        ghAddActivity('Manually ' + verb + ' ' + Math.abs(pts) + ' pts ' + (pts > 0 ? 'to' : 'from') + ' ' + selected.join(', '));
        showToast((pts > 0 ? 'Awarded' : 'Deducted') + ' ' + Math.abs(pts) + ' pts ' + (pts > 0 ? 'to' : 'from') + ' ' + selected.length + ' member(s)', 'success');
      }
      ghSelectedMembers.clear();
      hidePartyPanel();
      ghRenderMemberList(ghMemberSearch.value);
      ghRenderLeaderboard();
    });

    // ─── Init admin features ───
    async function ghInit() {
      await loadAdminData();
      subscribeAdminData();
      ghRenderMemberList();
      ghRenderBossConfig();
      ghRenderLeaderboard();
      ghRenderActivity();
      updateAuthUI();
    }

    // Patch init to also load admin data
    const origInit = init;
    init = function() {
      if (typeof origInit === 'function') origInit();
      ghInit();
    };

    // ─── Auth UI integration ───
    const origUpdateAuthUI = updateAuthUI;
    updateAuthUI = function() {
      if (typeof origUpdateAuthUI === 'function') origUpdateAuthUI();
      const isAdmin = sessionStorage.getItem("userMode") === "admin";
      if (navMenuBtn) {
        if (!isAdmin) navDropdown.classList.add('hidden');
      }
      if (!isAdmin) {
        document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.admin-nav .nav-btn').forEach(b => b.classList.remove('active'));
        const firstBtn = document.querySelector('.admin-nav .nav-btn[data-tab="bosslist"]');
        if (firstBtn) firstBtn.classList.add('active');
        $('bossListPanel').style.display = '';
        const topRow = $('topPanelsRow');
        if (topRow) topRow.style.display = '';
      }
    };
