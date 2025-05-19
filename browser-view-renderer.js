// browser-view-renderer.js
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    const webview = document.getElementById('content-webview');
    const backButton = document.getElementById('back-button');
    const forwardButton = document.getElementById('forward-button');
    const reloadButton = document.getElementById('reload-button');
    const urlInput = document.getElementById('url-input');

    let guestTabId = null;

    ipcRenderer.on('initialize-view', (event, data) => {
        // console.log('[browser-view-renderer] Received initialize-view:', data);
        guestTabId = data.tabId;
        const targetUrl = data.targetUrl;
        const assignedName = data.assignedName;

        try {
            if (webview.partition !== `persist:${guestTabId}`) {
                webview.partition = `persist:${guestTabId}`;
            }
        } catch (e) {
            console.error('[browser-view-renderer] Error setting partition:', e.message);
        }

        if (assignedName) document.title = assignedName;

        if (targetUrl && webview.getURL() !== targetUrl) {
            webview.loadURL(targetUrl).catch(err => {
                console.error('[browser-view-renderer] Webview failed to load target URL:', targetUrl, err);
                urlInput.value = `Failed: ${targetUrl}`;
            });
        }
    });

    backButton.addEventListener('click', () => { if (webview.canGoBack()) webview.goBack(); });
    forwardButton.addEventListener('click', () => { if (webview.canGoForward()) webview.goForward(); });
    reloadButton.addEventListener('click', () => { 
        webview.reload(); 
        // Reload will trigger 'did-stop-loading'
    });

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            let url = urlInput.value.trim();
            if (url) {
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                webview.loadURL(url).catch(err => {
                    console.error('[browser-view-renderer] Webview failed to load URL from input:', url, err);
                });
            }
        }
    });

    webview.addEventListener('did-start-loading', () => {
        reloadButton.innerHTML = '&#10005;'; 
        reloadButton.title = 'Stop';
        reloadButton.onclick = () => webview.stop();
    });

    webview.addEventListener('did-stop-loading', () => {
        reloadButton.innerHTML = '&#x21bb;'; 
        reloadButton.title = 'Reload';
        reloadButton.onclick = () => webview.reload();
        if (guestTabId) {
            // console.log(`[BVR] did-stop-loading for ${guestTabId}, triggering capture.`);
            ipcRenderer.send('trigger-event-driven-capture', guestTabId);
        }
    });

    webview.addEventListener('dom-ready', () => {
        console.log(`[BVR] Webview DOM Ready. GuestTabId: ${guestTabId}, URL: ${webview.getURL()}`);
        webview.openDevTools(); 
    });

    webview.addEventListener('did-navigate', (e) => {
        if (!guestTabId) return;
        urlInput.value = e.url;
        backButton.disabled = !webview.canGoBack();
        forwardButton.disabled = !webview.canGoForward();
        ipcRenderer.send('webview-navigated', { guestTabId: guestTabId, url: e.url, title: webview.getTitle() });
        // console.log(`[BVR] did-navigate for ${guestTabId}, triggering capture.`);
        ipcRenderer.send('trigger-event-driven-capture', guestTabId);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        if (!guestTabId) return;
        urlInput.value = e.url;
        ipcRenderer.send('webview-navigated', { guestTabId: guestTabId, url: e.url, title: webview.getTitle() });
        // console.log(`[BVR] did-navigate-in-page for ${guestTabId}, triggering capture.`);
        ipcRenderer.send('trigger-event-driven-capture', guestTabId);
    });

    webview.addEventListener('page-title-updated', (e) => {
        if (!guestTabId) return;
        ipcRenderer.send('webview-title-updated', { guestTabId: guestTabId, title: e.title });
        // A title update might imply a DOM change worth capturing if visual
        // if (guestTabId) ipcRenderer.send('trigger-event-driven-capture', guestTabId); // Optional: can be too noisy
    });

    webview.addEventListener('did-fail-load', (e) => {
        console.error('[BVR] Webview did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL);
        if (e.isMainFrame && e.validatedURL !== "about:blank") {
            urlInput.value = `Failed: ${e.validatedURL} (Error ${e.errorCode})`;
        }
        reloadButton.innerHTML = '&#x21bb;';
        reloadButton.title = 'Reload';
        reloadButton.onclick = () => webview.reload();
    });

    webview.addEventListener('ipc-message', (event) => {
        if (event.channel === 'significant-dom-change' && guestTabId) {
            // console.log(`[BVR] Received 'significant-dom-change' from preload of ${guestTabId}, forwarding trigger.`);
            ipcRenderer.send('trigger-event-driven-capture', guestTabId);
        }
    });

    ipcRenderer.send('request-initialize-view-data');
});