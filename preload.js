// preload.js (for webview content)
const { ipcRenderer } = require('electron');
// console.log('[PRELOAD.JS] --- SCRIPT EXECUTION STARTED ---');
console.log('[PRELOAD.JS] --- SCRIPT EXECUTION STARTED AT VERY TOP ---'); // Early log

// --- Configuration ---
const POKEMON_CENTER_HOST = "www.pokemoncenter.com";
const INCAPSULA_RESOURCE_SUBSTRING = '_Incapsula_Resource';
const QUEUE_CHECK_INTERVAL = 3000;
const QUEUE_DETECTION_TIMEOUT = 30000;
const MAX_QUEUE_CHECKS = Math.floor(QUEUE_DETECTION_TIMEOUT / QUEUE_CHECK_INTERVAL);

const DOM_CHANGE_DEBOUNCE_MS = 1000; // Wait 1 second after last DOM change
let domChangeTimeoutId = null;

// --- State Variables ---
let currentTabId = null;
let initialTargetUrl = null;
let queuePollIntervalSetting = 5000;
let incapsulaNetworkSnifferIntervalId = null;
let queueDetectionIntervalId = null;
let queueDetectionAttempts = 0;
let hasSentQueueFoundNotification = false;
let isPokemonCenterSite = false;
let networkMonitoringActive = false;
let domChecksActive = false;
let mutationObserver = null;


// --- Logging Helper ---
function log(message, ...optionalParams) {
    const prefix = currentTabId ? `[Preload Tab: ${currentTabId.slice(-6)}]` : '[Preload Tab: UNKNOWN]';
    console.log(`${prefix} ${message}`, ...optionalParams);
}

// --- IPC Communication ---
function sendDiscordNotificationToMain(embedData) {
    if (currentTabId) {
        log(`Attempting to send Discord notification to main process: Title - "${embedData.title}"`); // ADDED LOG
        ipcRenderer.send('send-discord-notification-from-preload', { tabId: currentTabId, embedData });
    }
}

// --- DOM Mutation Observer Functionality ---
function handleDomMutation(mutationsList, observer) {
    // console.log(`[PRELOAD DOM MUTATION] Detected ${mutationsList.length} mutations for tab ${currentTabId}.`);
    clearTimeout(domChangeTimeoutId);
    domChangeTimeoutId = setTimeout(() => {
        // console.log(`[PRELOAD DOM MUTATION] Debounced: Sending 'significant-dom-change' for tab ${currentTabId}`);
        ipcRenderer.sendToHost('significant-dom-change'); // Send to browser-view-renderer.js
    }, DOM_CHANGE_DEBOUNCE_MS);
}

function startMutationObserver() {
    if (mutationObserver) { // Disconnect old one if exists (e.g. page reloaded within webview)
        mutationObserver.disconnect();
    }
    mutationObserver = new MutationObserver(handleDomMutation);

    // Wait for document.body to be available
    const attemptObserve = () => {
        if (document.body) {
            mutationObserver.observe(document.body, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: true
            });
            // console.log(`[PRELOAD DOM MUTATION] MutationObserver started for document.body on tab ${currentTabId}`);
        } else {
            // console.warn(`[PRELOAD DOM MUTATION] document.body not available yet for tab ${currentTabId}, retrying...`);
            setTimeout(attemptObserve, 100); // Retry shortly
        }
    };
    attemptObserve();
}

// --- Queue Detection Logic ---
function checkForQueuePresenceInDOM() {
    if (!isPokemonCenterSite || !domChecksActive) {
        if (queueDetectionIntervalId) {
            clearInterval(queueDetectionIntervalId);
            queueDetectionIntervalId = null;
        }
        return false;
    }
    queueDetectionAttempts++;
    log(`DOM Queue Check Attempt #${queueDetectionAttempts}`); // ADDED LOG
    const pageText = document.body ? document.body.innerText.toLowerCase() : "";
    let queueLikelyPresent = false;
    // IMPORTANT: This list is the OLDER one. You likely need to update this.
    const pokemonCenterQueuePhrases = [
        "you are in the virtual waiting room",      // Covers "...stay in the waiting room..." and similar
        "your estimated wait time is approximately", // A common generic queue phrase, good to keep
        "you are currently in line to enter pokémon center", // Very specific to the image you shared
        "you're in line!",                          // A common shorter variation
        "pokemon center virtual queue",             // Catches specific mentions of their queue system
        "we've set up a virtual queue",             // Specific phrase indicating a virtual queue is active
        "queue",
        "free shipping on orders over $20!" // - PKC Test phrase on homepage
    ];
    if (pokemonCenterQueuePhrases.some(phrase => pageText.includes(phrase))) {
        queueLikelyPresent = true;
    }

    if (queueLikelyPresent) {
        log("Pokémon Center queue DETECTED by DOM heuristics."); // MODIFIED LOG for emphasis
        domChecksActive = false;
        if (queueDetectionIntervalId) clearInterval(queueDetectionIntervalId);
        queueDetectionIntervalId = null;
        if (!hasSentQueueFoundNotification) {
            sendDiscordNotificationToMain({
                title: `🚦 Queue Detected (DOM)`,
                description: `Queue page detected on Pokémon Center. Activating network monitoring.`,
                color: 0xFFA500
            });
            hasSentQueueFoundNotification = true;
        }
        startNetworkMonitoring(); // This will log internally
        return true;
    }
    if (queueDetectionAttempts >= MAX_QUEUE_CHECKS) {
        log("Max DOM queue detection attempts reached. Queue NOT FOUND by DOM."); // MODIFIED LOG
        domChecksActive = false;
        if (queueDetectionIntervalId) clearInterval(queueDetectionIntervalId);
        queueDetectionIntervalId = null;
    }
    return false;
}

function startNetworkMonitoring() {
    if (networkMonitoringActive || !isPokemonCenterSite) return;
    networkMonitoringActive = true;
    log("Starting network monitoring for Incapsula queue position..."); // Existing good log

    if (!window._fetchPatched) {
        const _origFetch = window.fetch;
        window.fetch = (input, init) => {
            if (typeof _origFetch !== 'function') return Promise.reject(new Error("Original fetch NA"));
            return _origFetch(input, init).then(res => {
                const requestUrl = (typeof input === 'string' ? input : input?.url) || '';
                if (requestUrl.includes(INCAPSULA_RESOURCE_SUBSTRING)) {
                    res.clone().json().then(data => {
                        if (data && data.pos != null) {
                            log(`Incapsula data found via fetch: pos ${data.pos}`); // ADDED LOG
                            ipcRenderer.send('queue-pos', { tabId: currentTabId, pos: data.pos, fullResponse: data });
                        }
                    }).catch(() => {});
                }
                return res;
            });
        };
        window._fetchPatched = true;
    }

    if (!window._xhrPatched) {
        const _origXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) { this._url = url; return _origXHROpen.apply(this, arguments); };
        const _origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function() {
            this.addEventListener('load', () => {
                if (this.readyState === 4 && this._url?.includes(INCAPSULA_RESOURCE_SUBSTRING)) {
                    try {
                        const data = JSON.parse(this.responseText);
                        if (data && data.pos != null) {
                            log(`Incapsula data found via XHR: pos ${data.pos}`); // ADDED LOG
                            ipcRenderer.send('queue-pos', { tabId: currentTabId, pos: data.pos, fullResponse: data });
                        }
                    } catch (e) {}
                }
            });
            return _origXHRSend.apply(this, arguments);
        };
        window._xhrPatched = true;
    }

    if (incapsulaNetworkSnifferIntervalId === null && typeof window.fetch === 'function') {
        const fetchForPoll = window.fetch;
        incapsulaNetworkSnifferIntervalId = setInterval(() => {
            if (!networkMonitoringActive) {
                clearInterval(incapsulaNetworkSnifferIntervalId);
                incapsulaNetworkSnifferIntervalId = null; return;
            }
            const pollUrl = `/${INCAPSULA_RESOURCE_SUBSTRING}?cb=${Date.now()}`;
            fetchForPoll(pollUrl)
                .then(res => res.ok ? res.json() : Promise.reject())
                .then(data => {
                    if (data && data.pos != null) {
                        log(`Incapsula data found via polling: pos ${data.pos}`); // ADDED LOG
                        ipcRenderer.send('queue-pos', { tabId: currentTabId, pos: data.pos, fullResponse: data });
                    }
                })
                .catch(() => {});
        }, queuePollIntervalSetting);
    }
}
// --- END Queue Detection & Network Monitoring ---

// --- Initialization Sequence ---
async function initializePreload() {
    try {
        currentTabId = await ipcRenderer.invoke('get-tab-id');
        if (!currentTabId) {
            console.error('[PRELOAD.JS] CRITICAL: Failed to resolve Tab ID.');
            return;
        }
        // console.log(`[Preload Tab: ${currentTabId.slice(-6)}] Script started.`);

        initialTargetUrl = await ipcRenderer.invoke('get-initial-target-url');
        // log(`Initial Target URL: ${initialTargetUrl}`); // Covered by next log

        if (initialTargetUrl) {
            try {
                const urlObj = new URL(initialTargetUrl);
                isPokemonCenterSite = urlObj.hostname.toLowerCase().includes(POKEMON_CENTER_HOST);
                log(isPokemonCenterSite ? `PokemonCenter.com DETECTED for URL: ${initialTargetUrl}` : `Not a PokemonCenter.com site. URL: ${initialTargetUrl}`); // ADDED LOG
            } catch (e) {
                isPokemonCenterSite = false;
                log(`Error parsing initialTargetUrl (${initialTargetUrl}), assuming not a PokemonCenter.com site.`); // ADDED LOG
            }
        } else {
            log("InitialTargetUrl is null or undefined. Cannot determine if PokemonCenter.com site."); // ADDED LOG
        }

        if (isPokemonCenterSite) {
            const intervalValue = await ipcRenderer.invoke('get-setting', 'queueInterval');
            if (typeof intervalValue === 'number' && intervalValue >= 1000) {
                queuePollIntervalSetting = intervalValue;
            }
            const setupDomChecks = () => {
                domChecksActive = true;
                log("DOM queue phrase monitoring starting for PokemonCenter.com."); // ADDED LOG
                if (!checkForQueuePresenceInDOM()) { // This will log if queue found or max attempts reached
                    if (domChecksActive) { // If still active after initial check (meaning not found yet)
                        queueDetectionIntervalId = setInterval(checkForQueuePresenceInDOM, QUEUE_CHECK_INTERVAL);
                        setTimeout(() => {
                            if (queueDetectionIntervalId) { // If interval is still active, it means it timed out without finding a queue
                                clearInterval(queueDetectionIntervalId);
                                log("DOM queue detection interval TIMED OUT. Queue NOT FOUND by phrase checking during interval."); // ADDED LOG
                                queueDetectionIntervalId = null;
                                if(domChecksActive) domChecksActive = false; // Ensure this is set
                            }
                        }, QUEUE_DETECTION_TIMEOUT);
                    }
                }
            };
            if (document.readyState === 'loading') {
                window.addEventListener('DOMContentLoaded', setupDomChecks);
            } else {
                setupDomChecks();
            }
        }

        // Always start MutationObserver for event-driven thumbnail updates
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', startMutationObserver);
        } else {
            startMutationObserver();
        }

    } catch (err) {
        console.error('[PRELOAD.JS] Error during initialization:', err);
    }
}

initializePreload();