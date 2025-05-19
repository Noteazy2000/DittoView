// renderer.js
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  // console.log('[Renderer.js] DOMContentLoaded event fired. Initializing...');

  // 1) Image Const & App Name
  const dittoBrowserURL = "https://media.discordapp.net/attachments/1370487101107339385/1370546206966812772/ditto-logo.png?ex=681fe41f&is=681e929f&hm=1708cd2cbcffb5c8ecc23fb42ed3da90b877d8b6bfa1cbe6042a4aeab2fb5dce&=&format=webp&quality=lossless&width=1032&height=1006";
  const APP_NAME = "DittoView";

  // showToast function (as defined in the previous step)
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.error('Toast container (#toast-container) not found in HTML! Falling back to alert.');
      // Fallback alert if container is somehow missing
      const fallbackAlert = window.alert; // Use window.alert to avoid conflicts if alert is redefined
      fallbackAlert(`${type.toUpperCase()}: ${message}`);
      return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type.toLowerCase()}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    const dismissToast = () => {
      toast.classList.remove('show');
      toast.addEventListener('transitionend', () => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, { once: true });
    };

    const autoDismissTimer = setTimeout(dismissToast, duration);

    toast.addEventListener('click', () => {
      clearTimeout(autoDismissTimer);
      dismissToast();
    });

    const progressBar = toast.querySelector('.toast-progress'); // If you implement progress bar
    if (progressBar) {
      progressBar.style.animationDuration = `${duration / 1000}s`;
    }
  }


  // Helper function for delays
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // State variables for proxy editing
  let currentlyEditingProxyListName = null;
  let initialProxyListContentForEdit = "";
  // console.log('[Renderer.js] Initialized proxy edit state variables.');

  // 2) Built-in defaults & localStorage helpers
  const defaultWebsites = {
    Amazon: 'https://www.amazon.com/',
    BestBuy: 'https://www.bestbuy.com/',
    Costco: 'https://www.costco.com/',
    GameStop: 'https://www.gamestop.com/',
    'Pokemon Center': 'https://www.pokemoncenter.com/',
    Target: 'https://www.target.com/',
    Walmart: 'https://www.walmart.com/'
  };
  const LS = {
    loadObj: key => {
      const item = localStorage.getItem(key);
      console.log(`[LS.loadObj] Loading key "${key}". Found item:`, item ? item.substring(0, 70) + (item.length > 70 ? '...' : '') : 'null');
      try {
        return JSON.parse(item || '{}');
      } catch (e) {
        console.error(`[LS.loadObj] Error parsing JSON for key "${key}":`, e, "Item was:", item);
        return {};
      }
    },
    saveObj: (key, obj) => {
      try {
        const stringified = JSON.stringify(obj);
        console.log(`[LS.saveObj] Saving key "${key}". Value (first 70 chars):`, stringified.substring(0,70) + (stringified.length > 70 ? '...' : ''));
        localStorage.setItem(key, stringified);
      } catch (e) {
        console.error(`[LS.saveObj] Error stringifying object for key "${key}":`, e, "Object was:", obj);
      }
    },
    getItem: key => {
      const item = localStorage.getItem(key);
      console.log(`[LS.getItem] Getting key "${key}". Found value:`, item);
      return item;
    },
    setItem: (key, value) => {
      console.log(`[LS.setItem] Setting key "${key}" to value:`, value);
      localStorage.setItem(key, String(value)); // Ensure value is a string for setItem
      const verifyItem = localStorage.getItem(key);
      if (verifyItem !== String(value)) { // Compare with stringified value
          console.error(`[LS.setItem] VERIFICATION FAILED for key "${key}". Expected:`, String(value), "Got:", verifyItem);
      } else {
          // console.log(`[LS.setItem] Verification successful for key "${key}".`);
      }
    },
    removeItem: key => {
      console.log(`[LS.removeItem] Removing key "${key}".`);
      localStorage.removeItem(key);
    }
  };
  console.log('[Renderer.js] LS object initialized.');

  // 3) Discord webhook helper
 function sendDiscordNotification(data) {
    const hook = LS.getItem('discordWebhook');
    if (!hook) {
      console.warn('[Renderer Process] Discord webhook URL not set in LS. Notification not sent.');
      return;
    }
    let payload;
    if (typeof data === 'string') {
      payload = { content: data };
    } else if (typeof data === 'object' && data.embeds && Array.isArray(data.embeds)) {
      data.embeds.forEach(embed => {
        if (!embed.footer) embed.footer = { text: APP_NAME, icon_url: dittoBrowserURL };
        else {
          if (!embed.footer.text) embed.footer.text = APP_NAME;
          if (!embed.footer.icon_url) embed.footer.icon_url = dittoBrowserURL;
        }
        if (!embed.timestamp) embed.timestamp = new Date().toISOString();
        if (embed.color == null) embed.color = 0x2ECC71;
      });
      payload = data;
    } else if (typeof data === 'object') {
      payload = {
        embeds: [{
          title: data.title || "Notification",
          description: data.description || "No details provided.",
          color: data.color != null ? data.color : 0x2ECC71,
          timestamp: data.timestamp !== false ? (data.timestamp || new Date().toISOString()) : undefined,
          fields: data.fields || [],
          author: data.author ? { name: data.author.name, icon_url: data.author.icon_url, url: data.author.url } : undefined,
          thumbnail: data.thumbnail ? { url: data.thumbnail.url } : undefined,
          image: data.image ? { url: data.image.url } : undefined,
          footer: (data.footer && data.footer.text) ? { text: data.footer.text, icon_url: data.footer.icon_url || dittoBrowserURL } : { text: APP_NAME, icon_url: dittoBrowserURL }
        }]
      };
      if (data.content) payload.content = data.content;
    } else {
      console.error('[Renderer Process] Invalid data type for sendDiscordNotification:', data);
      return;
    }

    const notificationTitle = payload?.embeds?.[0]?.title || (typeof payload.content === 'string' ? 'Simple Message' : 'Notification');
    // console.log(`[sendDiscordNotification] Attempting to send notification to Discord. Title: "${notificationTitle}"`);

    fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(response => {
        if (!response.ok) {
            console.error(`[sendDiscordNotification] Discord HTTP error: ${response.status} ${response.statusText}. For title: "${notificationTitle}"`);
            response.text().then(text => console.error(`[sendDiscordNotification] Discord error response body: ${text}`));
        } else {
             console.log(`[sendDiscordNotification] Discord notification successfully sent. Title: "${notificationTitle}"`);
        }
    })
    .catch(error => {
        console.error(`[sendDiscordNotification] Discord notification FAILED. Title: "${notificationTitle}". Error:`, error);
    });
  }

  // 4) UI element references
  // console.log('[Renderer.js] Initializing UI element references (refs)...');
  const refs = {
    proxyText: document.getElementById('proxyList'),
    proxyName: document.getElementById('proxyListName'),
    saveProxyBtn: document.getElementById('saveProxyListBtn'),
    proxyUL: document.getElementById('savedProxyLists'),
    proxyDD: document.getElementById('proxyListDropdown'),
    cancelProxyEditBtn: document.getElementById('cancelProxyEditBtn'),
    proxyFormStatus: document.getElementById('proxyFormStatus'), 
    newSiteName: document.getElementById('newWebsiteNameInput'),
    newSiteURL: document.getElementById('newWebsiteInput'),
    addSiteBtn: document.getElementById('addWebsiteBtn'),
    siteUL: document.getElementById('savedWebsitesList'),
    siteDD: document.getElementById('websiteListDropdown'),
    webhookInput: document.getElementById('webhookUrlInput'),
    saveWebhookBtn: document.getElementById('saveWebhookBtn'),
    testWebhookBtn: document.getElementById('testWebhookBtn'),
    webhookStatus: document.getElementById('webhookStatus'),
    queueIntervalInput: document.getElementById('queueIntervalInput'),
    saveQueueIntervalBtn: document.getElementById('saveQueueIntervalBtn'),
    queueIntervalStatus: document.getElementById('queueIntervalStatus'),
    thumbnailStrategyInitialRadio: document.getElementById('thumbnailStrategyInitial'),
    thumbnailStrategyStaticRadio: document.getElementById('thumbnailStrategyStatic'),
    thumbnailStrategyLiveFastRadio: document.getElementById('thumbnailStrategyLiveFast'),
    thumbnailStrategyLiveSlowRadio: document.getElementById('thumbnailStrategyLiveSlow'),
    thumbnailStrategyEventDrivenRadio: document.getElementById('thumbnailStrategyEventDriven'),
    saveThumbnailStrategyBtn: document.getElementById('saveThumbnailStrategyBtn'),
    thumbnailStrategyStatus: document.getElementById('thumbnailStrategyStatus'),
    browserName: document.getElementById('browserNameInput'),
    launchBtn: document.getElementById('launchTaskBtn'),
    tabCount: document.getElementById('tabCount'),
    closeAllBtn: document.getElementById('closeAllTabsBtn'),
    dock: document.getElementById('minimizedTabs'),
    noTabsMessage: document.getElementById('noTabsMessage'),
    localTimeClock: document.getElementById('localTimeClock'),
    appVersionDisplay: document.getElementById('appVersionDisplay') 
  };
  // console.log('[Renderer.js] Refs initialized. Checking key settings and proxy refs:');
  // ... (console logs for refs can be kept or removed)

  // Helper function to reset the proxy form and edit state
  function resetProxyFormAndEditState() {
    // console.log('[resetProxyFormAndEditState] Resetting proxy form and edit state.');
    if(refs.proxyName) refs.proxyName.value = '';
    if(refs.proxyText) refs.proxyText.value = '';
    currentlyEditingProxyListName = null;
    initialProxyListContentForEdit = "";
    if(refs.saveProxyBtn) refs.saveProxyBtn.textContent = 'Save Proxy List';
    if (refs.cancelProxyEditBtn) {
        refs.cancelProxyEditBtn.style.display = 'none';
        // console.log('[resetProxyFormAndEditState] Cancel button hidden.');
    } else {
        // console.warn('[resetProxyFormAndEditState] Cancel button ref not found to hide.');
    }
    if(refs.proxyName) refs.proxyName.focus();
  }

  // updateStatus can still be used for inline messages if desired, or also switched to toasts
  function updateStatus(element, message, isError = false) {
    if (!element) {
      console.warn('[updateStatus] Attempted to update status for a null element. Message:', message);
      return;
    }
    // For consistency, you might want to change this to use showToast as well,
    // or keep it for very specific inline status messages.
    // For now, I'll leave it, assuming toasts are for more general "alert" replacements.
    element.textContent = message;
    element.style.color = isError ? '#e74c3c' : '#2ecc71';
    setTimeout(() => { if (element) element.textContent = ''; }, 3000);
  }

  function checkDockEmpty() {
    if (refs.noTabsMessage && refs.dock) {
        refs.noTabsMessage.style.display = refs.dock.children.length === 0 ? 'block' : 'none';
    }
  }

  // 5) UI-refresh functions
  function refreshProxyUI() {
    // console.log('[refreshProxyUI] Refreshing proxy UI.');
    if (!refs.proxyUL || !refs.proxyDD) {
        console.error("[refreshProxyUI] Proxy UL or Dropdown refs not found!");
        return;
    }
    const lists = LS.loadObj('proxyLists');
    // console.log('[refreshProxyUI] Loaded lists from LS:', JSON.stringify(lists)); 
    
    refs.proxyUL.innerHTML = ''; 
    // console.log('[refreshProxyUI] Cleared proxyUL innerHTML.'); 

    refs.proxyUL.className = 'proxy-list-grid';
    refs.proxyDD.innerHTML = '<option value="">-- Select a Proxy List --</option>';

    if (Object.keys(lists).length === 0) {
        // console.log('[refreshProxyUI] No lists found. Displaying empty message.'); 
        const noListsMessage = document.createElement('p');
        noListsMessage.textContent = 'No proxy lists saved yet.';
        noListsMessage.className = 'empty-list-message';
        refs.proxyUL.appendChild(noListsMessage);
    } else {
        // console.log(`[refreshProxyUI] Found ${Object.keys(lists).length} list(s). Starting to iterate...`); 
        Object.entries(lists).forEach(([listName, rawProxyData]) => {
          // console.log(`[refreshProxyUI] Iteration: Processing list "${listName}"`); 

          const li = document.createElement('li');
          li.className = 'proxy-list-item-box';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'proxy-list-name';
          nameSpan.textContent = listName;
          nameSpan.title = listName;
          li.appendChild(nameSpan);

          const proxyCount = rawProxyData.split('\n').map(p => p.trim()).filter(Boolean).length;
          const countSpan = document.createElement('span');
          countSpan.className = 'proxy-list-count';
          countSpan.textContent = `${proxyCount} Proxies`;
          li.appendChild(countSpan);

          const buttonWrapper = document.createElement('div');
          buttonWrapper.className = 'list-item-buttons';

          const editBtn = document.createElement('button');
          editBtn.innerHTML = '✏️'; 
          editBtn.className = 'edit-list-btn icon-btn';
          editBtn.title = `Edit proxy list "${listName}"`;
          editBtn.onclick = () => {
            // console.log(`[refreshProxyUI (editBtn.onclick)] Edit button clicked for list: "${listName}"`);
            if(refs.proxyName) refs.proxyName.value = listName;
            if(refs.proxyText) refs.proxyText.value = rawProxyData;
            currentlyEditingProxyListName = listName;
            initialProxyListContentForEdit = rawProxyData;
            if(refs.saveProxyBtn) refs.saveProxyBtn.textContent = 'Update List';
            if (refs.cancelProxyEditBtn) {
                refs.cancelProxyEditBtn.style.display = 'inline-block';
                // console.log('[refreshProxyUI (editBtn.onclick)] Cancel button displayed for edit.');
            }
            if(refs.proxyText) refs.proxyText.focus();
          };
          buttonWrapper.appendChild(editBtn);

          const deleteBtn = document.createElement('button');
          const trashCanSVG = `
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              stroke-width="2" 
              stroke-linecap="round" 
              stroke-linejoin="round" 
              class="proxy-delete-icon-svg"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>`;
          deleteBtn.innerHTML = trashCanSVG; // Set the SVG as the button's content
          deleteBtn.className = 'delete-list-btn icon-btn';
          deleteBtn.title = `Delete proxy list "${listName}"`;
          deleteBtn.onclick = () => {
            // console.log(`[refreshProxyUI (deleteBtn.onclick)] Delete button clicked for list: "${listName}"`);
            if (!confirm(`Are you sure you want to delete the proxy list "${listName}"?`)) return; // Keep confirm for delete
            
            const currentLists = LS.loadObj('proxyLists');
            const deletedListData = currentLists[listName];
            const deletedProxyCount = deletedListData ? deletedListData.split('\n').filter(Boolean).length : 0;
            
            delete currentLists[listName];
            LS.saveObj('proxyLists', currentLists);
            sendDiscordNotification({
              title: `🗑️ Proxy List Deleted: ${listName}`,
              description: `List **${listName}** deleted. Contained ${deletedProxyCount} proxies.`,
              color: 0xE74C3C
            });

            if (currentlyEditingProxyListName === listName) {
                // console.log('[refreshProxyUI (deleteBtn.onclick)] Deleted list was being edited, resetting form fully.');
                resetProxyFormAndEditState();
            }
            refreshProxyUI();
          };
          buttonWrapper.appendChild(deleteBtn);
          li.appendChild(buttonWrapper);
          refs.proxyUL.appendChild(li);
          // console.log(`[refreshProxyUI] Iteration: Appended item for "${listName}" to proxyUL.`); 

          const opt = document.createElement('option');
          opt.value = listName;
          opt.textContent = listName;
          refs.proxyDD.appendChild(opt);
        });
        // console.log('[refreshProxyUI] Finished iterating and appending lists.'); 
    }
    // console.log('[refreshProxyUI] refreshProxyUI function complete.'); 
  }

  function refreshWebsiteUI() {
    // console.log('[refreshWebsiteUI] Refreshing website UI.');
    if (!refs.siteUL || !refs.siteDD) {
        // console.error("[refreshWebsiteUI] Website UL or Dropdown refs not found!");
        return;
    }
    const customSites = LS.loadObj('websiteLists');
    refs.siteUL.innerHTML = '';
    refs.siteDD.innerHTML = '<option value="">-- Select a Website --</option>';
    Object.entries(defaultWebsites).forEach(([name, url]) => {
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = `${name} (Default)`;
      refs.siteDD.appendChild(opt);
    });
    Object.entries(customSites).forEach(([name, url]) => {
      const li = document.createElement('li');
      li.textContent = `${name} → ${url}`;
      const btn = document.createElement('button');
      btn.innerHTML = '&times;';
      btn.className = 'icon-btn delete-list-btn';
      btn.title = `Delete custom website "${name}"`;
      btn.onclick = () => {
        // console.log(`[refreshWebsiteUI] Delete button clicked for website: "${name}"`);
        if (!confirm(`Remove custom website "${name}"?`)) return; // Keep confirm for delete
        delete customSites[name];
        const updatedSites = LS.loadObj('websiteLists');
        delete updatedSites[name];
        LS.saveObj('websiteLists', updatedSites);
        sendDiscordNotification({
          title: `🗑️ Website Deleted: ${name}`,
          description: `Custom website **${name}** deleted.`,
          color: 0xE74C3C,
          fields: [{ name: "URL", value: `[Visit](${url})`, inline: true }]
        });
        showToast(`Website "${name}" has been deleted.`, 'success'); 
        refreshWebsiteUI();
      };
      li.appendChild(btn);
      refs.siteUL.appendChild(li);
      const opt = document.createElement('option');
      opt.value = url;
      opt.textContent = name;
      refs.siteDD.appendChild(opt);
    });
  }

  function refreshSettingsUI() {
    // console.log('[refreshSettingsUI] Refreshing settings UI.');
    if (refs.webhookInput) {
        refs.webhookInput.value = LS.getItem('discordWebhook') || '';
    }
    if (refs.queueIntervalInput) {
        refs.queueIntervalInput.value = LS.getItem('queueInterval') || '5000';
    }

    const savedThumbnailStrategy = LS.getItem('thumbnailStrategy') || 'initial';
    let radioToSelect;
    switch (savedThumbnailStrategy) {
        case 'static': radioToSelect = refs.thumbnailStrategyStaticRadio; break;
        case 'live-fast': radioToSelect = refs.thumbnailStrategyLiveFastRadio; break;
        case 'live-slow': radioToSelect = refs.thumbnailStrategyLiveSlowRadio; break;
        case 'event-driven': radioToSelect = refs.thumbnailStrategyEventDrivenRadio; break;
        case 'initial': default: radioToSelect = refs.thumbnailStrategyInitialRadio; break;
    }
    if (radioToSelect) {
        radioToSelect.checked = true;
    } else {
        if (refs.thumbnailStrategyInitialRadio) refs.thumbnailStrategyInitialRadio.checked = true;
    }
    
    const initialStrategyToSend = document.querySelector('input[name="thumbnailUpdateStrategy"]:checked')?.value || 'initial';
    ipcRenderer.send('update-thumbnail-strategy', initialStrategyToSend);
  }


  // 6) Event listeners
    ipcRenderer.on('app-version', (event, arg) => {
    console.log(`[Renderer.js] Received app-version: ${arg.version}`);
    if (refs.appVersionDisplay) {
      refs.appVersionDisplay.textContent = `v${arg.version}`;
    }
  });
  // console.log('[Renderer.js] Setting up event listeners...');

  // Proxy Form Cancel Button Listener
  if (refs.cancelProxyEditBtn) {
    refs.cancelProxyEditBtn.addEventListener('click', () => {
      // console.log('[Renderer.js] cancelProxyEditBtn clicked.');
      resetProxyFormAndEditState();
      refreshProxyUI();
      // console.log("[Renderer.js] refreshProxyUI called.");
      if (refs.proxyFormStatus) {
        updateStatus(refs.proxyFormStatus, 'Edit cancelled.', false); 
      }
    });
  }
  
  if (refs.saveProxyBtn) {
    // console.log('[Renderer.js] Adding event listener for saveProxyBtn.');
    refs.saveProxyBtn.addEventListener('click', () => {
      // console.log('[Renderer.js] saveProxyBtn clicked.');
      const newListName = refs.proxyName.value.trim();
      const newRawProxyData = refs.proxyText.value.trim();

      if (!newRawProxyData || !newListName) {
        showToast('Proxy list name and content cannot be empty.', 'error', 4500); // MODIFIED
        return;
      }

      let allLists = LS.loadObj('proxyLists');
      let actionMessage = '';
      let notificationTitle = '';
      let notificationColor = 0x2ECC71; 
      let notificationDescription = '';
      const proxyCount = newRawProxyData.split('\n').filter(Boolean).length;
      let successfullySavedOrUpdated = false;

      if (currentlyEditingProxyListName) { 
        // console.log(`[saveProxyBtn] Edit mode. Original: "${currentlyEditingProxyListName}", New: "${newListName}"`);
        const originalListName = currentlyEditingProxyListName;
        const nameChanged = newListName !== originalListName;
        const contentChanged = newRawProxyData !== initialProxyListContentForEdit;

        if (!nameChanged && !contentChanged) {
          showToast('No changes detected for proxy list "' + originalListName + '".', 'info'); // MODIFIED
          return;
        }

        if (newListName === originalListName) { 
          allLists[newListName] = newRawProxyData;
          actionMessage = `Proxy list "${newListName}" updated.`;
          notificationTitle = `🔄 Proxy List Updated: ${newListName}`;
          notificationDescription = `List content updated. Contains ${proxyCount} proxies.`;
          notificationColor = 0x3498DB;
          successfullySavedOrUpdated = true;
        } else { 
          if (allLists[newListName] && !confirm(`A list named "${newListName}" already exists. Overwrite?`)) { // Keep confirm
            return; 
          }
          delete allLists[originalListName]; 
          allLists[newListName] = newRawProxyData;
          actionMessage = `Proxy list "${originalListName}" was renamed to "${newListName}" and updated.`;
          notificationTitle = `🔄 Proxy List Renamed: ${newListName}`;
          notificationDescription = `Formerly "${originalListName}". Contains ${proxyCount} proxies.`;
          notificationColor = 0xFFA500; 
          successfullySavedOrUpdated = true;
        }
      } else { 
        // console.log(`[saveProxyBtn] New save mode. List name: "${newListName}"`);
        const isOverwrite = !!allLists[newListName];
        if (isOverwrite && !confirm(`Proxy list "${newListName}" already exists. Overwrite?`)) { // Keep confirm
          return;
        }
        allLists[newListName] = newRawProxyData;
        actionMessage = `Proxy list "${newListName}" ${isOverwrite ? 'overwritten' : 'saved'}.`;
        notificationTitle = `💾 Proxy List ${isOverwrite ? 'Overwritten' : 'Saved'}: ${newListName}`;
        notificationDescription = `Contains ${proxyCount} proxies.`;
        notificationColor = isOverwrite ? 0xFFA500 : 0x2ECC71;
        successfullySavedOrUpdated = true;
      }

      if (successfullySavedOrUpdated) {
        // console.log(`[saveProxyBtn] Performing save/update for "${newListName}".`);
        LS.saveObj('proxyLists', allLists);
        sendDiscordNotification({
          title: notificationTitle,
          description: notificationDescription,
          color: notificationColor,
          fields: [{ name: "Total Proxies", value: proxyCount.toString(), inline: true }]
        });
        
        resetProxyFormAndEditState();
        
        showToast(actionMessage, 'success'); // MODIFIED
      }
      
      refreshProxyUI();
    });
  } else {
    console.error('[Renderer.js] CRITICAL: saveProxyBtn not found in refs. Cannot attach listener.');
  }


  if (refs.addSiteBtn) {
    // console.log('[Renderer.js] Adding event listener for addSiteBtn.');
    refs.addSiteBtn.addEventListener('click', () => {
      // console.log('[Renderer.js] addSiteBtn clicked.');
      const name = refs.newSiteName.value.trim();
      let url = refs.newSiteURL.value.trim();
      if (!name || !url) { // Combined check
        showToast('Website name and URL cannot be empty.', 'error', 4500); // MODIFIED
        return;
      }
      if (!url.match(/^https?:\/\//i) && !url.match(/^file:\/\/\//i)) {
        url = 'https://' + url;
      }
      try { 
        new URL(url); 
      } catch (_) { 
        showToast('Invalid URL format. Please include http:// or https://', 'error', 4500); // MODIFIED
        return; 
      }

      const lists = LS.loadObj('websiteLists');
      if (lists[name] || defaultWebsites[name]) {
        showToast(`Website "${name}" already exists.`, 'error', 4500); // MODIFIED (was info/warning before, making it error for consistency)
        return;
      }
      lists[name] = url;
      LS.saveObj('websiteLists', lists);
      sendDiscordNotification({
        title: `💾 Website Added: ${name}`,
        description: `Added: **${name}** (${url.startsWith('file://') ? 'Local File' : `[Visit](${url})`})`,
        color: 0x2ECC71
      });
      refs.newSiteName.value = ''; refs.newSiteURL.value = '';
      refreshWebsiteUI();
      showToast(`Website "${name}" added.`, 'success'); // MODIFIED
    });
  } else {
    console.error('[Renderer.js] CRITICAL: addSiteBtn not found in refs. Cannot attach listener.');
  }

  // --- Settings Event Listeners with Diagnostics ---
  if (refs.saveWebhookBtn) {
    refs.saveWebhookBtn.addEventListener('click', () => {
      const url = refs.webhookInput.value.trim();
      if (!url) {
        LS.removeItem('discordWebhook');
        updateStatus(refs.webhookStatus, 'Webhook cleared.'); // Can keep updateStatus for inline, or change to toast
        // showToast('Webhook cleared.', 'info');
      } else {
        try {
          new URL(url);
          LS.setItem('discordWebhook', url);
          updateStatus(refs.webhookStatus, 'Webhook saved!');
          showToast('Webhook saved!', 'success');
        } catch (e) {
          updateStatus(refs.webhookStatus, 'Invalid Webhook URL.', true);
          showToast('Invalid Webhook URL.', 'error', 4500);
        }
      }
    });
  }

  if (refs.testWebhookBtn) {
    refs.testWebhookBtn.addEventListener('click', () => {
      const hook = LS.getItem('discordWebhook') || '';
      if (!hook) {
        // updateStatus(refs.webhookStatus, 'No webhook saved to test.', true);
        showToast('No webhook saved to test.', 'error', 4500); // MODIFIED (example of changing updateStatus target)
        return;
      }
      sendDiscordNotification({
        author: { name: `🧪 Test Notification - ${APP_NAME}` },
        description: `Test from ${APP_NAME}! Sent: ${new Date().toLocaleTimeString()}`,
        color: 0x3498DB
      });
      // updateStatus(refs.webhookStatus, 'Test notification sent!');
      showToast('Test notification sent!', 'info'); // MODIFIED (example)
    });
  }

  if (refs.saveQueueIntervalBtn) {
    refs.saveQueueIntervalBtn.addEventListener('click', () => {
      const v = parseInt(refs.queueIntervalInput.value, 10);
      if (isNaN(v) || v < 1000) {
        // updateStatus(refs.queueIntervalStatus, 'Min interval is 1000ms.', true);
        showToast('Minimum interval is 1000ms.', 'error', 4500); // MODIFIED (example)
        return;
      }
      LS.setItem('queueInterval', v);
      ipcRenderer.send('update-setting', 'queueInterval', v);
      // updateStatus(refs.queueIntervalStatus, `Interval set: ${v}ms.`);
      showToast(`Interval set: ${v}ms.`, 'success'); // MODIFIED (example)
    });
  }

  if (refs.saveThumbnailStrategyBtn) {
    refs.saveThumbnailStrategyBtn.addEventListener('click', () => {
        const selectedStrategyInput = document.querySelector('input[name="thumbnailUpdateStrategy"]:checked');
        const selectedStrategy = selectedStrategyInput ? selectedStrategyInput.value : 'initial';
        LS.setItem('thumbnailStrategy', selectedStrategy);
        ipcRenderer.send('update-thumbnail-strategy', selectedStrategy);
        // updateStatus(refs.thumbnailStrategyStatus, `Thumbnail strategy: ${selectedStrategy.replace('-', ' ')}.`);
        showToast(`Thumbnail strategy set to: ${selectedStrategy.replace('-', ' ')}.`, 'success'); // MODIFIED (example)
    });
  }


  if (refs.launchBtn) {
    refs.launchBtn.addEventListener('click', async () => {
      const proxyListName = refs.proxyDD.value;
      const siteUrl = refs.siteDD.value;
      const prefix = refs.browserName.value.trim();
      if (!proxyListName || !siteUrl) {
        showToast('Please select a proxy list and a website.', 'error', 4500); // MODIFIED
        return;
      }

      const allProxyLists = LS.loadObj('proxyLists');
      const rawProxyData = allProxyLists[proxyListName];
      if (!rawProxyData) {
        showToast(`Proxy list "${proxyListName}" not found.`, 'error', 4500); // MODIFIED
        return;
      }

      const proxies = rawProxyData.split('\n').map(s => s.trim()).filter(Boolean);
      if (!proxies.length) {
        showToast('The selected proxy list is empty.', 'error', 4500); // MODIFIED
        return;
      }

      const count = parseInt(refs.tabCount.value, 10) || 1;
      if (count <= 0) {
        showToast('Number of tabs must be at least 1.', 'error', 4500); // MODIFIED
        return;
      }

      const LAUNCH_DELAY_MS = 2000;
      const DELAY_THRESHOLD = 5;

      refs.launchBtn.disabled = true;
      refs.launchBtn.textContent = 'Launching...';

      for (let i = 0; i < count; i++) {
        const proxy = proxies[i % proxies.length];
        const name = prefix ? (count > 1 ? `${prefix} ${i + 1}` : prefix) : `Tab ${Date.now().toString().slice(-5)}-${i + 1}`;
        try {
          // console.log(`[launchBtn] Invoking 'create-proxied-tab' for: ${name}`);
          await ipcRenderer.invoke('create-proxied-tab', proxy, siteUrl, name);
        } catch (err) {
          console.error(`[renderer.js] Error invoking create-proxied-tab for ${name}:`, err);
          showToast(`Error launching tab "${name}": ${err.message}.`, 'error', 4500); // MODIFIED
        }
        if (count >= DELAY_THRESHOLD && i < count - 1) {
          await sleep(LAUNCH_DELAY_MS);
        }
      }
      refs.launchBtn.disabled = false;
      refs.launchBtn.textContent = 'Launch Browsers';
    });
  }

  if (refs.closeAllBtn) {
    refs.closeAllBtn.addEventListener('click', () => {
      if (!confirm('Are you sure you want to close ALL open tabs?')) return; // Keep confirm
      ipcRenderer.invoke('close-all-tabs');
      showToast(`All tabs have been successfully closed!`, 'success'); 

    });
  }


  // 7) IPC listeners from Main Process
  ipcRenderer.on('discord-embed-from-main', (event, embedData) => {
    sendDiscordNotification(embedData);
  });

  ipcRenderer.on('queue-pos', (e, { pos, label, id, fullResponse }) => {
    const tabDisplayName = label || `Tab ${id}`;
    let description = `Queue position: **${pos}**`;
    if (fullResponse?.ttw != null) description += `\nEst. Wait (TTW): ${fullResponse.ttw}`;
    sendDiscordNotification({
      title: `🎟️ Queue Update: ${tabDisplayName}`, description, color: 0xE67E22,
      fields: [{ name: "Tab", value: tabDisplayName, inline: true }, { name: "ID", value: id, inline: true }]
    });
    const tabWrapper = refs.dock.querySelector(`.minimized-tab-wrapper[data-id="${id}"]`);
    if (tabWrapper) {
        let statusEl = tabWrapper.querySelector('.tab-status-indicator');
        if (!statusEl) {
            statusEl = document.createElement('span'); statusEl.className = 'tab-status-indicator';
            tabWrapper.querySelector('.minimized-tab-header')?.appendChild(statusEl);
        }
        statusEl.textContent = `Q: ${pos}${fullResponse?.ttw != null ? ` (TTW:${fullResponse.ttw})` : ''}`;
    }
  });

  ipcRenderer.on('tab-minimized', (e, { id, label, thumbnail }) => {
    let w = refs.dock.querySelector(`.minimized-tab-wrapper[data-id="${id}"]`);
    if (w) {
        if (thumbnail) w.querySelector('img.minimized-tab-img')?.setAttribute('src', thumbnail);
        w.style.display = ''; checkDockEmpty(); return;
    }
    w = document.createElement('div'); w.className = 'minimized-tab-wrapper'; w.dataset.id = id;
    const header = document.createElement('div'); header.className = 'minimized-tab-header';
    const titleSpan = document.createElement('span'); titleSpan.textContent = label || `Tab ${id}`;
    const closeBtn = document.createElement('button'); closeBtn.className = 'minimized-tab-close';
    closeBtn.innerHTML = '&times;'; closeBtn.title = "Close Tab";
    closeBtn.onclick = (ev) => { ev.stopPropagation(); ipcRenderer.invoke('close-tab', id); };
    header.append(titleSpan, closeBtn);
    const img = document.createElement('img'); img.className = 'minimized-tab-img';
    img.src = thumbnail || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    img.alt = `Preview of ${label || id}`;
    w.onclick = () => ipcRenderer.invoke('show-tab', id);
    w.append(header, img);
    if (refs.dock) refs.dock.appendChild(w); else console.error("[tab-minimized] Dock ref not found!");
    checkDockEmpty();
  });

  ipcRenderer.on('tab-thumbnail', (e, { id, src }) => {
    if (refs.dock) {
        const img = refs.dock.querySelector(`.minimized-tab-wrapper[data-id="${id}"] img.minimized-tab-img`);
        if (img && src) img.src = src;
    }
  });

  ipcRenderer.on('tab-closed', (e, { id }) => {
    if (refs.dock) refs.dock.querySelector(`.minimized-tab-wrapper[data-id="${id}"]`)?.remove();
    checkDockEmpty();
  });

  ipcRenderer.on('task-creation-error', (event, { name, message }) => {
    showToast(`Error creating tab "${name || 'Unnamed'}":\n${message}`, 'error'), 4500; // MODIFIED
  });

  ipcRenderer.on('live-thumbnail-failed', (event, { tabId, name, message }) => {
    // This is more of a status update, could be a toast or inline as it is.
    // For now, keeping console.warn and the inline status indicator logic below.
    // If a toast is desired: showToast(`Live thumbnail failed for: ${name} - ${message}`, 'warning');
    console.warn(`[Renderer] Live thumbnail failed for: ${name} (${tabId}) - ${message}`);
    if (refs.dock) {
        const tabWrapper = refs.dock.querySelector(`.minimized-tab-wrapper[data-id="${tabId}"]`);
        if (tabWrapper) {
            let statusEl = tabWrapper.querySelector('.tab-status-indicator.error');
            if (!statusEl) {
                statusEl = document.createElement('span'); statusEl.className = 'tab-status-indicator error';
                tabWrapper.querySelector('.minimized-tab-header')?.appendChild(statusEl);
            }
            statusEl.textContent = '⚠️ Live Fail'; statusEl.title = message;
        }
    }
  });


  // 8) Sidebar view switching
  document.querySelectorAll('#sidebar ul li[data-view]').forEach(tab => {
    if (!tab) return;
    tab.addEventListener('click', () => {
      document.querySelectorAll('#sidebar ul li[data-view].active').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view.active').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      const viewId = 'view-' + tab.dataset.view;
      const viewElement = document.getElementById(viewId);
      if (viewElement) {
        viewElement.classList.add('active');
      } else {
        console.error(`[Renderer.js] View element not found: ${viewId}`);
      }
    });
  });

  // --- START: LOCAL TIME CLOCK LOGIC ---
  let clockIntervalId = null;
  function updateLocalTime() {
    if (refs.localTimeClock) {
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      const dateString = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      refs.localTimeClock.textContent = `${dateString} ${timeString}`;
    }
  }
  if (refs.localTimeClock) {
    updateLocalTime();
    if (clockIntervalId) clearInterval(clockIntervalId);
    clockIntervalId = setInterval(updateLocalTime, 1000);
  }
  // --- END: LOCAL TIME CLOCK LOGIC ---

  // 9) Initial UI render and state
  try {
    refreshProxyUI();
    refreshWebsiteUI();
    refreshSettingsUI();
    checkDockEmpty();
    const initialViewTab = document.querySelector('#sidebar ul li[data-view="browsers"]');
    if (initialViewTab) {
      initialViewTab.click();
    }
    if (refs.cancelProxyEditBtn) {
        refs.cancelProxyEditBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('[Renderer.js] Error during initial UI render:', error);
  }
  console.log('[Renderer.js] DOMContentLoaded processing complete.');


const PROXY_FORM_ESTIMATED_HEIGHT = 250; // pixels - ADJUST THIS VALUE!
                                          // This is an estimate of the height taken up by everything
                                          // in #view-proxies *above* the .saved-proxies-section.
                                          // (e.g., headings, textarea, input, buttons, hr).
                                          // You can find a more precise value using DevTools.

  const WINDOW_HEIGHT_THRESHOLD = 670; // pixels
  const PADDING_AND_MARGINS = 60;      // Extra pixels for padding/margins within #content and #view-proxies

  function adjustProxyListHeight() {
    const viewProxies = document.getElementById('view-proxies');
    const savedProxiesSection = viewProxies ? viewProxies.querySelector('.saved-proxies-section') : null;

    if (!savedProxiesSection || !viewProxies.classList.contains('active')) {
      // If the proxies view isn't active or element not found, reset any fixed height
      if (savedProxiesSection) {
        savedProxiesSection.style.maxHeight = ''; // Revert to CSS default (flex-grow)
      }
      return;
    }

    const windowHeight = window.innerHeight;
    const contentTop = document.getElementById('content').offsetTop; // Approx top of main content area

    // Calculate the height of elements *above* the saved-proxies-section within view-proxies
    let heightAboveList = 0;
    let currentElement = viewProxies.firstElementChild;
    while (currentElement && !currentElement.classList.contains('saved-proxies-section')) {
        if (currentElement.offsetParent !== null) { // Only count visible elements
            heightAboveList += currentElement.offsetHeight;
            const style = window.getComputedStyle(currentElement);
            heightAboveList += parseInt(style.marginTop) + parseInt(style.marginBottom);
        }
        currentElement = currentElement.nextElementSibling;
    }
    // Add padding of the #view-proxies container itself
    const viewProxiesStyle = window.getComputedStyle(viewProxies);
    heightAboveList += parseInt(viewProxiesStyle.paddingTop) + parseInt(viewProxiesStyle.paddingBottom);


    if (windowHeight < WINDOW_HEIGHT_THRESHOLD) {
      // Calculate desired max height for the saved-proxies-section
      // Total available for #view-proxies is roughly windowHeight - contentTop - some padding
      // Then subtract the height of the form elements above the list
      let calculatedMaxHeight = windowHeight - contentTop - heightAboveList - PADDING_AND_MARGINS;
      
      if (calculatedMaxHeight < 100) { // Ensure it's not smaller than min-height
        calculatedMaxHeight = 100;
      }
      savedProxiesSection.style.maxHeight = `${calculatedMaxHeight}px`;
      // console.log(`Window height < ${WINDOW_HEIGHT_THRESHOLD}px. Setting .saved-proxies-section maxHeight: ${calculatedMaxHeight}px`);
    } else {
      // If window is taller, let flexbox handle it (remove explicit max-height)
      savedProxiesSection.style.maxHeight = ''; // This will let flex-grow: 1 take over.
      // console.log(`Window height >= ${WINDOW_HEIGHT_THRESHOLD}px. Resetting .saved-proxies-section maxHeight.`);
    }
  }

  // Initial adjustment on load
  adjustProxyListHeight();

  // Adjust on window resize
  window.addEventListener('resize', adjustProxyListHeight);

  // Also adjust when the proxies view becomes active
  // (Assuming your view switching adds/removes 'active' class)
  const sidebarLinks = document.querySelectorAll('#sidebar ul li[data-view]');
  sidebarLinks.forEach(link => {
    link.addEventListener('click', () => {
      // Give a brief moment for the view to switch and become visible
      setTimeout(adjustProxyListHeight, 50);
    });
  });


});