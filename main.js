// main.js

// ─────────────────────────────────────────────────────────────────────────────
// 1) MODULE IMPORTS & GLOBALS
// ─────────────────────────────────────────────────────────────────────────────
const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log'); // For logging update process

let mainWindow;
const popouts = new Map(); // Stores { popoutWindow, liveThumbnailIntervalId, captureFailures, initialTargetUrl, initialThumbnail, lastNotifiedUrl, currentEffectiveStrategy }
let tabCounter = 0;

// --- App Settings & State ---
let globalQueueInterval = 5000;
let currentThumbnailStrategy = 'initial'; // User's selected strategy

// --- Constants ---
const LIVE_THUMBNAIL_INTERVAL_SLOW = 20000; 
const LIVE_THUMBNAIL_INTERVAL_FAST = 5000;  // "Live-fast" is 5-second interval
const MAX_CAPTURE_FAILURES = 5;            
const CAPTURE_TIMEOUT_MS = 2000;           
const DEFAULT_APP_ICON_URL = "https://media.discordapp.net/attachments/1370487101107339385/1370546206966812772/ditto-logo.png?ex=681fe41f&is=681e929f&hm=1708cd2cbcffb5c8ecc23fb42ed3da90b877d8b6bfa1cbe6042a4aeab2fb5dce&=&format=webp&quality=lossless&width=1032&height=1006";

const DEGRADE_LIVE_FAST_THRESHOLD = 3; // If MINIMIZED popouts.size > this, 'live-fast' attempts become 'event-driven'.

console.log('[main.js] Initializing...');

// --- AutoUpdater Logging Configuration ---
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info'; // Log to file
log.info('App starting...'); // Initial log for this file
// -----------------------------------------

// ─────────────────────────────────────────────────────────────────────────────
// 2) HELPER FUNCTIONS (Thumbnail Management)
// ─────────────────────────────────────────────────────────────────────────────

// (NEW HELPER FUNCTION)
function sendStatusToWindow(channel, data) {
  log.info(`IPC Send: ${channel}`, data); // Use electron-log
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  } else {
    log.warn(`IPC Send Aborted: MainWindow or webContents not available for channel ${channel}`);
  }
}

const captureAndSendThumbnail = async (tabId, tabDetail) => {
    // console.log(`[CAPTURE ENTER] Tab ${tabId} attempting capture. Strategy: ${tabDetail?.currentEffectiveStrategy}`);
    if (!tabDetail || !tabDetail.popoutWindow || tabDetail.popoutWindow.isDestroyed()) {
        console.warn(`[CAPTURE SKIP] Tab ${tabId} (or its window) is invalid/destroyed. Effective strategy: ${tabDetail?.currentEffectiveStrategy}`);
        if (tabDetail && tabDetail.liveThumbnailIntervalId) {
            clearInterval(tabDetail.liveThumbnailIntervalId);
            tabDetail.liveThumbnailIntervalId = null;
        }
        return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    tabDetail.captureFailures = tabDetail.captureFailures || 0;
    // console.log(`[CAPTURE ATTEMPT] Tab ${tabId}. Failures: ${tabDetail.captureFailures}. Interval: ${tabDetail.liveThumbnailIntervalId}`);

    let captureTimeoutId = null;

    try {
        const capturePromise = tabDetail.popoutWindow.webContents.capturePage();
        const timeoutPromise = new Promise((_, reject) => { 
            captureTimeoutId = setTimeout(() => {
                reject(new Error(`capturePage timed out after ${CAPTURE_TIMEOUT_MS}ms`));
            }, CAPTURE_TIMEOUT_MS);
        });

        const image = await Promise.race([capturePromise, timeoutPromise]);
        clearTimeout(captureTimeoutId);

        // console.log(`[CAPTURE SUCCESS] Tab ${tabId}`);
        tabDetail.captureFailures = 0;

        if (mainWindow && !mainWindow.isDestroyed() &&
            tabDetail.popoutWindow && !tabDetail.popoutWindow.isDestroyed()) {
            mainWindow.webContents.send('tab-thumbnail', { id: tabId, src: image.toDataURL() });
        }
    } catch (err) {
        if (captureTimeoutId) clearTimeout(captureTimeoutId);
        tabDetail.captureFailures++;
        console.error(`[CAPTURE FAILED] Tab ${tabId} (Attempt #${tabDetail.captureFailures}). Error: ${err.message}`);

        if (tabDetail.captureFailures >= MAX_CAPTURE_FAILURES) {
            const isLiveInterval = tabDetail.liveThumbnailIntervalId !== null;
            if (isLiveInterval) {
                console.warn(`[CAPTURE] Tab ${tabId} (interval based): Too many failures. Stopping live updates. Now 'static'.`);
                clearInterval(tabDetail.liveThumbnailIntervalId);
                tabDetail.liveThumbnailIntervalId = null;
            } else if (tabDetail.currentEffectiveStrategy === 'event-driven') {
                 console.warn(`[CAPTURE] Tab ${tabId} (event-driven): Still failing after ${MAX_CAPTURE_FAILURES} attempts. Will only try on next event.`);
            }
            // Degrade to static on persistent failure if it was a form of live/event-driven
            if (tabDetail.currentEffectiveStrategy !== 'initial' && tabDetail.currentEffectiveStrategy !== 'static') {
                tabDetail.currentEffectiveStrategy = 'static';
                console.log(`[CAPTURE] Tab ${tabId} effective strategy set to 'static' due to repeated failures.`);
            }
            
            const tabNameForAlert = (tabDetail.popoutWindow && !tabDetail.popoutWindow.isDestroyed() && tabDetail.popoutWindow.tabName)
                                      ? tabDetail.popoutWindow.tabName
                                      : `Tab ${tabId}`;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('live-thumbnail-failed', {
                    tabId: tabId,
                    name: tabNameForAlert,
                    message: `Capture updates stopped after ${MAX_CAPTURE_FAILURES} errors. Effective mode: ${tabDetail.currentEffectiveStrategy}.`
                });
            }
        }
    }
};

function applyEffectiveStrategyToTab(tabId, tabDetail, strategyToApply) {
    // console.log(`[STRATEGY TAB - PRE-CHECK FOR APPLY] Tab ${tabId} ('${tabDetail?.popoutWindow?.tabName || 'Unnamed'}'):`);
    // console.log(`    - tabDetail exists: ${!!tabDetail}`);
    // if (tabDetail) {
    //     console.log(`    - tabDetail.popoutWindow exists: ${!!tabDetail.popoutWindow}`);
    //     if (tabDetail.popoutWindow) {
    //         const isWinDestroyed = tabDetail.popoutWindow.isDestroyed();
    //         console.log(`    - tabDetail.popoutWindow.isDestroyed(): ${isWinDestroyed}`);
    //         if (!isWinDestroyed && tabDetail.popoutWindow.webContents) {
    //              console.log(`    - tabDetail.popoutWindow.webContents.isDestroyed(): ${tabDetail.popoutWindow.webContents.isDestroyed()}`);
    //         } else if (!isWinDestroyed) {
    //              console.log(`    - tabDetail.popoutWindow.webContents is MISSING (Window ID: ${tabDetail.popoutWindow.id})`);
    //         }
    //     }
    // }

    if (!tabDetail || !tabDetail.popoutWindow || tabDetail.popoutWindow.isDestroyed()) {
        console.warn(`[STRATEGY TAB - INVALID] Tab ${tabId} or its window is invalid. Cannot apply strategy "${strategyToApply}".`);
        return;
    }

    if (tabDetail.liveThumbnailIntervalId !== null) {
        clearInterval(tabDetail.liveThumbnailIntervalId);
        tabDetail.liveThumbnailIntervalId = null;
    }
    tabDetail.captureFailures = 0; 
    tabDetail.currentEffectiveStrategy = strategyToApply;

    console.log(`[STRATEGY SET] Tab ${tabId} (${tabDetail.popoutWindow.tabName || 'Unnamed'}): Setting to "${strategyToApply}" (User selected: "${currentThumbnailStrategy}")`);

    switch (strategyToApply) {
        case 'static':
        case 'event-driven': // For 'event-driven', capture once when strategy is first applied. Subsequent are event-triggered.
            captureAndSendThumbnail(tabId, tabDetail);
            break;
        case 'live-fast':
            captureAndSendThumbnail(tabId, tabDetail); 
            tabDetail.liveThumbnailIntervalId = setInterval(() => captureAndSendThumbnail(tabId, tabDetail), LIVE_THUMBNAIL_INTERVAL_FAST);
            break;
        case 'live-slow':
            captureAndSendThumbnail(tabId, tabDetail);
            tabDetail.liveThumbnailIntervalId = setInterval(() => captureAndSendThumbnail(tabId, tabDetail), LIVE_THUMBNAIL_INTERVAL_SLOW);
            break;
        case 'initial':
            if (tabDetail.initialThumbnail && mainWindow && !mainWindow.isDestroyed()) {
               mainWindow.webContents.send('tab-thumbnail', { id: tabId, src: tabDetail.initialThumbnail });
            } else if (!tabDetail.initialThumbnail) {
                // console.log(`[STRATEGY SET] Tab ${tabId} ('initial' strategy) missing initialThumbnail, attempting capture.`);
                captureAndSendThumbnail(tabId, tabDetail);
            }
            break;
        default:
            console.warn(`[STRATEGY SET] Unknown strategy: "${strategyToApply}" for tab ${tabId}.`);
    }
}

function evaluateAndApplyGlobalThumbnailStrategy() {
    const minimizedTabsEntries = [];
    let minimizedCount = 0;

    popouts.forEach((detail, id) => {
        if (detail.popoutWindow && !detail.popoutWindow.isDestroyed()) {
            if (detail.popoutWindow.isMinimized()) {
                minimizedTabsEntries.push({ id, detail });
                minimizedCount++;
            } else if (detail.liveThumbnailIntervalId !== null) { 
                clearInterval(detail.liveThumbnailIntervalId);
                detail.liveThumbnailIntervalId = null;
                detail.currentEffectiveStrategy = 'initial'; 
                if (detail.initialThumbnail && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('tab-thumbnail', { id, src: detail.initialThumbnail });
                }
            }
        } else {
            if (detail.liveThumbnailIntervalId !== null) {
                clearInterval(detail.liveThumbnailIntervalId);
                detail.liveThumbnailIntervalId = null;
            }
        }
    });

    let actualGlobalStrategyToApplyToAllMinimized = currentThumbnailStrategy; 

    // Degradation: If user selected 'live-fast' AND there are too many minimized tabs,
    // then force 'event-driven' for all currently minimized tabs.
    if (currentThumbnailStrategy === 'live-fast' && minimizedCount > DEGRADE_LIVE_FAST_THRESHOLD) {
        console.warn(`[STRATEGY EVAL GLOBAL] ${minimizedCount} minimized tabs. User wants 'live-fast'. Count (${minimizedCount}) > threshold (${DEGRADE_LIVE_FAST_THRESHOLD}). Forcing ALL minimized to 'event-driven'.`);
        actualGlobalStrategyToApplyToAllMinimized = 'event-driven';
    }
    // If user selected 'event-driven' directly, actualGlobalStrategyToApplyToAllMinimized will be 'event-driven'.
    // If user selected 'live-slow', 'static', or 'initial', those will be used directly without this specific count-based downgrade.
    
    minimizedTabsEntries.forEach(tabEntry => {
        const { id, detail } = tabEntry;
        
        const needsUpdate = detail.currentEffectiveStrategy !== actualGlobalStrategyToApplyToAllMinimized ||
                            ((actualGlobalStrategyToApplyToAllMinimized === 'live-fast' || actualGlobalStrategyToApplyToAllMinimized === 'live-slow') && detail.liveThumbnailIntervalId === null && detail.popoutWindow.isMinimized()) ||
                            (actualGlobalStrategyToApplyToAllMinimized === 'static' && detail.currentEffectiveStrategy !== 'static') ||
                            (actualGlobalStrategyToApplyToAllMinimized === 'initial' && detail.currentEffectiveStrategy !== 'initial') ||
                            (actualGlobalStrategyToApplyToAllMinimized === 'event-driven' && detail.currentEffectiveStrategy !== 'event-driven'); 

        if (needsUpdate) {
            applyEffectiveStrategyToTab(id, detail, actualGlobalStrategyToApplyToAllMinimized);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) IPC HANDLERS 
// ─────────────────────────────────────────────────────────────────────────────



ipcMain.on('update-thumbnail-strategy', (event, strategy) => {
    console.log(`[SETTINGS] User changed thumbnail strategy to: ${strategy}`);
    // **** ADD 'event-driven' to valid strategies from UI ****
    if (['initial', 'static', 'live-fast', 'live-slow', 'event-driven'].includes(strategy)) { 
        currentThumbnailStrategy = strategy;
        evaluateAndApplyGlobalThumbnailStrategy(); 
    } else {
        console.warn(`[SETTINGS] Invalid thumbnail strategy received from UI: ${strategy}`);
    }
});

ipcMain.on('trigger-event-driven-capture', (event, tabId) => {
    const tabInfo = popouts.get(tabId);
    // console.log(`[IPC MAIN] Received 'trigger-event-driven-capture' for tab ${tabId}`);
    if (tabInfo && tabInfo.popoutWindow && !tabInfo.popoutWindow.isDestroyed() && tabInfo.popoutWindow.isMinimized()) {
        if (tabInfo.currentEffectiveStrategy === 'event-driven') {
            console.log(`[EVENT CAPTURE] Tab ${tabId} is minimized and 'event-driven'. Capturing thumbnail.`);
            captureAndSendThumbnail(tabId, tabInfo);
        }
    }
});

ipcMain.handle('get-tab-id', (event) => {
    const webContents = event.sender;
    const hostWebContents = webContents.hostWebContents;
    if (!hostWebContents) return null;
    const browserWindow = BrowserWindow.fromWebContents(hostWebContents);
    return (browserWindow && browserWindow.tabId) ? browserWindow.tabId : null;
});

ipcMain.handle('get-initial-target-url', (event) => {
    const webContents = event.sender;
    const hostWebContents = webContents.hostWebContents;
    if (!hostWebContents) return null;
    const browserWindow = BrowserWindow.fromWebContents(hostWebContents);
    if (browserWindow && browserWindow.tabId) {
        const tabInfo = popouts.get(browserWindow.tabId);
        if (tabInfo && tabInfo.initialTargetUrl) return tabInfo.initialTargetUrl;
        if (browserWindow.pendingViewInitializationData) return browserWindow.pendingViewInitializationData.targetUrl;
    }
    return null;
});

ipcMain.handle('get-setting', async (event, key) => {
    if (key === 'queueInterval') {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            try {
                const mainWinUrl = mainWindow.webContents.getURL();
                if (mainWinUrl && mainWinUrl.startsWith('file://') && !mainWindow.webContents.isLoading()) {
                    const value = await mainWindow.webContents.executeJavaScript('localStorage.getItem("queueInterval");', true);
                    return parseInt(value, 10) || globalQueueInterval;
                }
                return globalQueueInterval;
            } catch (err) { return globalQueueInterval; }
        }
        return globalQueueInterval;
    }
    return null;
});

ipcMain.on('send-discord-notification-from-preload', (event, { tabId, embedData }) => {
    console.log(`[Main Process] Received 'send-discord-notification-from-preload' for Tab ID: ${tabId}, Title: "${embedData.title}"`); // ADDED LOG
    const tabInfo = popouts.get(tabId);
    const tabLabel = tabInfo?.popoutWindow?.tabName || `Tab ${tabId}`;
    if (mainWindow && !mainWindow.isDestroyed() && embedData) {
        let finalTitle = embedData.title || "Notification";
        if (finalTitle.includes(`${tabId}`) && tabLabel !== `Tab ${tabId}`) {
            finalTitle = finalTitle.replace(`${tabId}`, tabLabel);
        } else if (!finalTitle.toLowerCase().includes(tabLabel.toLowerCase()) && !finalTitle.includes(`${tabId}`)) {
            finalTitle = `${finalTitle}: ${tabLabel}`;
        }
        const richEmbed = {
            embeds: [{
                title: finalTitle,
                description: embedData.description || "No specific details.",
                color: embedData.color != null ? embedData.color : 0x0099FF,
                timestamp: new Date().toISOString(),
                footer: { text: "DittoView Monitor", icon_url: DEFAULT_APP_ICON_URL },
                ...(embedData.fields && { fields: embedData.fields })
            }]
        };
        console.log(`[Main Process] Sending 'discord-embed-from-main' to renderer for Tab ID: ${tabId}, Final Title: "${finalTitle}"`); // ADDED LOG
        mainWindow.webContents.send('discord-embed-from-main', richEmbed);
    }
});

ipcMain.on('update-setting', (event, key, value) => { 
    if (key === 'queueInterval') {
        globalQueueInterval = parseInt(value, 10) || 5000;
        console.log(`[SETTINGS] Global queueInterval updated to: ${globalQueueInterval}`);
    }
});

ipcMain.on('request-initialize-view-data', (event) => {
    const popoutWin = BrowserWindow.fromWebContents(event.sender);
    if (popoutWin && popoutWin.pendingViewInitializationData) {
        event.sender.send('initialize-view', popoutWin.pendingViewInitializationData);
        delete popoutWin.pendingViewInitializationData;
    }
});

ipcMain.on('webview-navigated', (event, { guestTabId, url, title }) => {
    const tabInfo = popouts.get(guestTabId);
    if (tabInfo) {
        if (url === 'about:blank' && (!tabInfo.lastNotifiedUrl || tabInfo.lastNotifiedUrl === 'about:blank')) {
            return;
        }
        tabInfo.lastNotifiedUrl = url;
        // Event-driven capture for navigation is handled by browser-view-renderer.js sending 'trigger-event-driven-capture'
    }
});

ipcMain.on('webview-title-updated', (event, { guestTabId, title }) => {
    const tabInfo = popouts.get(guestTabId);
    if (tabInfo?.popoutWindow && !tabInfo.popoutWindow.isDestroyed()) {
        const baseName = tabInfo.popoutWindow.tabName || `Tab ${guestTabId}`;
        tabInfo.popoutWindow.setTitle(`${title} | ${baseName}`);
    }
});

ipcMain.on('queue-pos', (e, { tabId, pos, fullResponse }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const tabInfo = popouts.get(tabId);
        const tabLabel = tabInfo?.popoutWindow?.tabName || `Tab ${tabId}`;
        mainWindow.webContents.send('queue-pos', { pos, label: tabLabel, id: tabId, fullResponse });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) MAIN APPLICATION WINDOW SETUP
// ─────────────────────────────────────────────────────────────────────────────
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100, height: 730,
        minWidth: 900, minHeight: 600,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: { 
            nodeIntegration: true,
            contextIsolation: false, 
            devTools: true
        }
    });
    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools();
        mainWindow.webContents.on('did-finish-load', () => {
            log.info('[main.js] mainWindow did-finish-load.');
            sendStatusToWindow('app-version', { version: app.getVersion() });
            log.info('[main.js] Checking for updates after did-finish-load...');
            autoUpdater.checkForUpdatesAndNotify(); 
        mainWindow.webContents.send('app-version', { version: app.getVersion() });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5) APPLICATION LIFECYCLE EVENTS
// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────────────────────────────────────
// X) AUTO-UPDATER EVENT LISTENERS (NEW SECTION)
// ─────────────────────────────────────────────────────────────────────────────
autoUpdater.on('checking-for-update', () => {
  sendStatusToWindow('update-message', { text: 'Checking for updates...' });
});

autoUpdater.on('update-available', (info) => {
  sendStatusToWindow('update-message', { text: `Update available (v${info.version}). Downloading...` });
});

autoUpdater.on('update-not-available', (info) => {
  sendStatusToWindow('update-message', { text: 'You are on the latest version.' });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        sendStatusToWindow('update-message', { text: '' });
    }
  }, 7000);
});

autoUpdater.on('error', (err) => {
  sendStatusToWindow('update-message', { text: `Update error: ${err.message}`, isError: true });
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = progressObj.percent != null ? progressObj.percent.toFixed(2) : 'N/A';
  sendStatusToWindow('update-message', { text: `Downloading: ${percent}%` });
});

// main.js
autoUpdater.on('update-downloaded', (info) => {
  sendStatusToWindow('update-message', { text: `Update v${info.version} ready. Restart to install.` });
  
  if (mainWindow && !mainWindow.isDestroyed()) { // Check if mainWindow exists
    dialog.showMessageBox(mainWindow, { // Pass mainWindow as parent
      type: 'info',
      title: 'Update Ready to Install',
      message: `Version ${info.version} has been downloaded. Restart DittoView to apply the update?`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0, // "Restart Now" is the default button
      cancelId: 1   // "Later" is the cancel button
    }).then(result => {
      if (result.response === 0) { // User clicked "Restart Now"
        log.info('[AutoUpdater] User chose to restart. Quitting and installing...');
        autoUpdater.quitAndInstall();
      } else { // User clicked "Later" or closed the dialog
        log.info('[AutoUpdater] User chose to install update later.');
        // Explicitly try to refocus the main window after the native dialog closes
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus(); // Focus the window itself
          // mainWindow.webContents.focus(); // Optionally try this too
          
          // Consider sending an IPC to renderer if a specific element there needs focus
          // mainWindow.webContents.send('focus-default-element');
        }
      }
    }).catch(err => {
        log.error('[AutoUpdater] Error showing update downloaded dialog:', err);
    });
  } else {
    log.warn('[AutoUpdater] mainWindow not available to show update downloaded dialog.');
    // Fallback or just log if no window to show dialog on
    // You could potentially use a system notification as a fallback if no window is active
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) TAB MANAGEMENT (Creating and Controlling Popout Windows)
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('create-proxied-tab', async (e, rawProxy, targetUrl, windowName) => {
    let host, port, username = '', password = '';
    try {
        if (!rawProxy || typeof rawProxy !== 'string' || rawProxy.trim() === '') throw new Error('Proxy string is empty or invalid');
        rawProxy = rawProxy.trim();
        if (rawProxy.startsWith('http://') || rawProxy.startsWith('https://')) {
            const u = new URL(rawProxy);
            host = u.hostname; port = u.port; username = u.username; password = u.password;
        } else {
            const parts = rawProxy.split(':');
            if (parts.length < 2) throw new Error('Invalid host:port proxy format');
            host = parts[0]; port = parts[1];
            if (parts.length > 2) username = parts[2];
            if (parts.length > 3) password = parts[3];
        }
        if (!host || !port) throw new Error('Proxy parsing failed (missing host or port)');
        if (isNaN(parseInt(port, 10)) || parseInt(port, 10) <= 0 || parseInt(port, 10) > 65535) throw new Error('Proxy port invalid');
    } catch (error) {
        console.error('[TAB CREATE] Proxy parse error:', error.message);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('task-creation-error', { name: windowName, message: `Proxy error: ${error.message}` });
        }
        return null;
        
    }

    const id = `popout-tab-${Date.now()}-${tabCounter++}`;
    const assignedName = windowName || `Tab ${id.slice(-6)}`;
    const sessionPartition = `persist:${id}`;
    const tabSession = session.fromPartition(sessionPartition, { cache: true });

    const authHandler = (event, webContents, request, authInfo, callback) => {
        event.preventDefault();
        if (authInfo.isProxy && (username || password)) callback(username, password);
        else callback();
    };
    tabSession.on('login', authHandler);

    try {
        await tabSession.setProxy({ proxyRules: `${host}:${port}` });
        // console.log(`[TAB CREATE] Proxy ${host}:${port} set for session ${sessionPartition}`);
    } catch (error) {
        console.error(`[TAB CREATE] Set proxy error for tab ${id}:`, error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('task-creation-error', { name: assignedName, message: `Proxy set error: ${error.message}` });
        }
        tabSession.off('login', authHandler);
        return null;
    }

    const popoutWindow = new BrowserWindow({
        width: 900, height: 700,
        minWidth: 600, minHeight: 400,
        show: false,
        icon: path.join(__dirname, 'assets/icon.png'),
        webPreferences: { 
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,       
            devTools: true // Ensures DevTools can be opened for the webview content later
        },
        title: `Loading ${assignedName}...`
        
    });
    popoutWindow.tabId = id;
    popoutWindow.tabName = assignedName;
    
    // ADDED LINE TO OPEN DEVTOOLS FOR THE POPOUT WINDOW ITSELF:
    // popoutWindow.webContents.openDevTools(); 

    // console.log(`[TAB CREATE DEBUG] Created popoutWindow for ID: ${id}. Is destroyed immediately? ${popoutWindow.isDestroyed()}`);

    popoutWindow.pendingViewInitializationData = {
        targetUrl: targetUrl || 'about:blank',
        tabId: id,
        assignedName
    };

    popouts.set(id, {
        popoutWindow,
        liveThumbnailIntervalId: null,
        captureFailures: 0,
        lastNotifiedUrl: null,
        initialTargetUrl: popoutWindow.pendingViewInitializationData.targetUrl,
        initialThumbnail: null,
        currentEffectiveStrategy: 'initial' 
    });
    // const justSetTabInfo = popouts.get(id);
    // console.log(`[TAB CREATE DEBUG] Tab ${id} added to popouts. popoutWindow valid? ${!!justSetTabInfo?.popoutWindow}. Is destroyed? ${justSetTabInfo?.popoutWindow?.isDestroyed()}`);


    popoutWindow.loadFile(path.join(__dirname, 'browser-view.html'));
    // The line below was originally commented out, if you also want devtools for the guest page (pokemoncenter.com)
    // you might need a way to open it from within browser-view.html or via another IPC message.
    // popoutWindow.webContents.openDevTools(); // This was here, the one above is for the popout's own content.

    popoutWindow.once('ready-to-show', () => {
        // console.log(`[TAB LIFECYCLE DEBUG] Tab ${id} 'ready-to-show'. popoutWindow.isDestroyed()? ${popoutWindow.isDestroyed()}`);
        popoutWindow.show();
        // popoutWindow.focus(); 
        const tabInfo = popouts.get(id); 

        if (tabInfo && tabInfo.popoutWindow && !tabInfo.popoutWindow.isDestroyed()) {
            // console.log(`[TAB LIFECYCLE DEBUG] Tab ${id} ('${tabInfo.popoutWindow.tabName}') attempting initial capture for dock.`);
            tabInfo.popoutWindow.webContents.capturePage().then(image => {
                const dataURL = image.toDataURL();
                const currentTabInfo = popouts.get(id); 
                if (currentTabInfo) { 
                   currentTabInfo.initialThumbnail = dataURL;
                }
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('tab-minimized', { id, label: assignedName, thumbnail: dataURL });
                }
            }).catch(err => {
                 console.error(`[TAB CREATE ERROR] Capturing initial page for ${id} in 'ready-to-show':`, err);
                 if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('tab-minimized', { id, label: assignedName, thumbnail: null });
                 }
            });
        } else {
            // console.warn(`[TAB LIFECYCLE DEBUG] Tab ${id} or its window invalid/destroyed at 'ready-to-show' capture point.`);
        }
    });

    popoutWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame && validatedURL.includes('browser-view.html')) {
            console.error(`CRITICAL: PopoutWindow (tab ${id}) FAILED TO LOAD 'browser-view.html': ${errorDescription} (Code: ${errorCode})`);
            if (popoutWindow && !popoutWindow.isDestroyed()) popoutWindow.close(); // Triggers 'closed' event
        }
    });
    

    popoutWindow.on('minimize', () => {
        // console.log(`[TAB LIFECYCLE DEBUG] Tab ${id} ('${popoutWindow.tabName || 'Unnamed'}') 'minimize' event triggered.`);
        evaluateAndApplyGlobalThumbnailStrategy();
    });

    const onRestoreOrShow = () => { 
        // console.log(`[TAB LIFECYCLE DEBUG] Tab ${id} ('${popoutWindow.tabName || 'Unnamed'}') 'restore/show' event triggered.`);
        const tabInfo = popouts.get(id); 
        if (tabInfo && tabInfo.liveThumbnailIntervalId !== null) {
            clearInterval(tabInfo.liveThumbnailIntervalId);
            tabInfo.liveThumbnailIntervalId = null;
            tabInfo.currentEffectiveStrategy = 'initial'; 
        }
        evaluateAndApplyGlobalThumbnailStrategy();
    };

    popoutWindow.on('restore', onRestoreOrShow);
    popoutWindow.on('show', onRestoreOrShow);

    popoutWindow.on('closed', () => {
        const localTabId = id;
        // console.log(`[TAB LIFECYCLE DEBUG] Tab ${localTabId} 'closed' event.`);
        const tabInfo = popouts.get(localTabId);
        if (tabInfo && tabInfo.liveThumbnailIntervalId !== null) {
            clearInterval(tabInfo.liveThumbnailIntervalId);
        }
        if (tabSession) {
            tabSession.off('login', authHandler);
            tabSession.clearStorageData().catch(err => console.warn(`[SESSION] Fail to clear for ${localTabId}: ${err.message}`));
        }
        popouts.delete(localTabId);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tab-closed', { id: localTabId });
        }
        evaluateAndApplyGlobalThumbnailStrategy();
    });
    return id;
});

ipcMain.handle('close-tab', (e, id) => {
    const tabInfo = popouts.get(id);
    if (tabInfo?.popoutWindow && !tabInfo.popoutWindow.isDestroyed()) {
        tabInfo.popoutWindow.close(); 
    } else if (popouts.has(id)) { 
        const lingeringTabInfo = popouts.get(id);
        if (lingeringTabInfo?.liveThumbnailIntervalId) clearInterval(lingeringTabInfo.liveThumbnailIntervalId);
        popouts.delete(id);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tab-closed', { id });
        evaluateAndApplyGlobalThumbnailStrategy(); 
    }
});

ipcMain.handle('close-all-tabs', () => {
    const allTabIds = Array.from(popouts.keys());
    allTabIds.forEach(tabId => {
        const tabInfo = popouts.get(tabId);
        if (tabInfo?.popoutWindow && !tabInfo.popoutWindow.isDestroyed()) {
            tabInfo.popoutWindow.close();
        }
    });
    if (allTabIds.length === 0 && popouts.size === 0) { 
        evaluateAndApplyGlobalThumbnailStrategy();
    }
});

ipcMain.handle('show-tab', (e, id) => {
    const tabInfo = popouts.get(id);
    if (tabInfo?.popoutWindow && !tabInfo.popoutWindow.isDestroyed()) {
        if (tabInfo.popoutWindow.isMinimized()) tabInfo.popoutWindow.restore(); 
        else tabInfo.popoutWindow.show(); 
        
        tabInfo.popoutWindow.focus();
    } else if (popouts.has(id)) { 
        const lingeringTabInfo = popouts.get(id);
        if (lingeringTabInfo?.liveThumbnailIntervalId) clearInterval(lingeringTabInfo.liveThumbnailIntervalId);
        popouts.delete(id);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tab-closed', { id });
        evaluateAndApplyGlobalThumbnailStrategy();
    }
});

console.log("[main.js] Initialization and event listeners complete.");