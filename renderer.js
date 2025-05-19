// renderer.js
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  console.log('[Renderer.js] DOMContentLoaded event fired. Initializing...');

  // 1) Image Const & App Name
  const dittoBrowserURL = "https://media.discordapp.net/attachments/1370487101107339385/1370546206966812772/ditto-logo.png?ex=681fe41f&is=681e929f&hm=1708cd2cbcffb5c8ecc23fb42ed3da90b877d8b6bfa1cbe6042a4aeab2fb5dce&=&format=webp&quality=lossless&width=1032&height=1006";
  const APP_NAME = "DittoView";

  // --- showToast function ---
  function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) {
      console.error('Toast container (#toast-container) not found in HTML! Falling back to alert.');
      const fallbackAlert = window.alert;
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
  }

  // --- Custom Confirmation Modal Logic ---
  const modalOverlay = document.getElementById('custom-modal-overlay');
  const modalTitleElement = document.getElementById('custom-modal-title');
  const modalMessageElement = document.getElementById('custom-modal-message');
  const modalConfirmBtn = document.getElementById('custom-modal-confirm-btn');
  const modalCancelBtn = document.getElementById('custom-modal-cancel-btn');
  let currentModalResolve = null;

  function showCustomConfirm(message, title = "Confirm Action", confirmText = "Yes", cancelText = "No") {
    return new Promise((resolve) => {
      if (!modalOverlay || !modalMessageElement || !modalConfirmBtn || !modalCancelBtn || !modalTitleElement) {
        console.error("Custom modal elements not found! Falling back to native confirm.");
        resolve(confirm(message)); // Native confirm as a fallback
        return;
      }
      currentModalResolve = resolve;
      modalTitleElement.textContent = title;
      modalMessageElement.textContent = message;
      modalConfirmBtn.textContent = confirmText;
      modalCancelBtn.textContent = cancelText;

      modalOverlay.classList.remove('hidden');
      setTimeout(() => {
          modalOverlay.classList.add('visible');
      }, 10);
      setTimeout(() => modalConfirmBtn.focus(), 60); // Delay focus slightly more
    });
  }

  function closeModal(result) {
    if (currentModalResolve) {
      currentModalResolve(result);
      currentModalResolve = null;
    }
    modalOverlay.classList.remove('visible');
  }

  if (modalConfirmBtn) modalConfirmBtn.onclick = () => closeModal(true);
  if (modalCancelBtn) modalCancelBtn.onclick = () => closeModal(false);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('visible')) {
      closeModal(false);
    }
  });
  // --- End Custom Confirmation Modal Logic ---

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  let currentlyEditingProxyListName = null;
  let initialProxyListContentForEdit = "";

  const defaultWebsites = {
    Amazon: 'https://www.amazon.com/', BestBuy: 'https://www.bestbuy.com/',
    Costco: 'https://www.costco.com/', GameStop: 'https://www.gamestop.com/',
    'Pokemon Center': 'https://www.pokemoncenter.com/', Target: 'https://www.target.com/',
    Walmart: 'https://www.walmart.com/'
  };

  const LS = {
    loadObj: key => {
      const item = localStorage.getItem(key);
      try { return JSON.parse(item || '{}'); }
      catch (e) { console.error(`[LS.loadObj] ("${key}"):`, e); return {}; }
    },
    saveObj: (key, obj) => {
      try { localStorage.setItem(key, JSON.stringify(obj)); }
      catch (e) { console.error(`[LS.saveObj] ("${key}"):`, e); }
    },
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, String(value)),
    removeItem: key => localStorage.removeItem(key)
  };

 function sendDiscordNotification(data) {
    const hook = LS.getItem('discordWebhook');
    if (!hook) return;
    let payload;
    if (typeof data === 'string') { payload = { content: data }; }
    else if (typeof data === 'object' && data.embeds && Array.isArray(data.embeds)) {
      payload = data;
      payload.embeds.forEach(embed => {
        if (!embed.footer) embed.footer = { text: APP_NAME, icon_url: dittoBrowserURL };
        if (!embed.timestamp) embed.timestamp = new Date().toISOString();
        if (embed.color == null) embed.color = 0x2ECC71;
      });
    } else if (typeof data === 'object') {
      payload = {
        embeds: [{
          title: data.title || "Notification", description: data.description || "No details provided.",
          color: data.color != null ? data.color : 0x2ECC71,
          timestamp: data.timestamp !== false ? (data.timestamp || new Date().toISOString()) : undefined,
          fields: data.fields || [],
          footer: (data.footer && data.footer.text) ? { text: data.footer.text, icon_url: data.footer.icon_url || dittoBrowserURL } : { text: APP_NAME, icon_url: dittoBrowserURL }
        }]
      };
      if (data.content) payload.content = data.content;
    } else { console.error('[Renderer] Invalid data for sendDiscordNotification'); return; }

    fetch(hook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }).then(response => {
      if (!response.ok) console.error(`Discord HTTP error: ${response.status}`);
    }).catch(error => console.error(`Discord notification FAILED:`, error));
  }

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
    appVersionDisplay: document.getElementById('appVersionDisplay'),
    updateStatusDisplay: document.getElementById('updateStatusDisplay')
  };

  function resetProxyFormAndEditState() {
    if(refs.proxyName) refs.proxyName.value = '';
    if(refs.proxyText) refs.proxyText.value = '';
    currentlyEditingProxyListName = null;
    initialProxyListContentForEdit = "";
    if(refs.saveProxyBtn) refs.saveProxyBtn.textContent = 'Save Proxy List';
    if (refs.cancelProxyEditBtn) refs.cancelProxyEditBtn.style.display = 'none';
    // Focus is handled by the calling function after UI settles
  }

  function updateStatus(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.style.color = isError ? 'var(--color-danger)' : 'var(--color-success)';
    setTimeout(() => { if (element && element.textContent === message) element.textContent = ''; }, 3000);
  }

  function checkDockEmpty() {
    if (refs.noTabsMessage && refs.dock) {
        refs.noTabsMessage.style.display = refs.dock.children.length === 0 ? 'block' : 'none';
    }
  }

  function refreshProxyUI() {
    if (!refs.proxyUL || !refs.proxyDD) { console.error("Proxy UL/DD not found!"); return; }
    const lists = LS.loadObj('proxyLists');
    refs.proxyUL.innerHTML = '';
    refs.proxyUL.className = 'proxy-list-grid';
    refs.proxyDD.innerHTML = '<option value="">-- Select a Proxy List --</option>';

    if (Object.keys(lists).length === 0) {
        const p = document.createElement('p'); p.textContent = 'No proxy lists saved yet.'; p.className = 'empty-list-message'; refs.proxyUL.appendChild(p);
    } else {
        Object.entries(lists).forEach(([listName, rawProxyData]) => {
          const li = document.createElement('li'); li.className = 'proxy-list-item-box';
          const nameSpan = document.createElement('span'); nameSpan.className = 'proxy-list-name'; nameSpan.textContent = listName; nameSpan.title = listName; li.appendChild(nameSpan);
          const countSpan = document.createElement('span'); countSpan.className = 'proxy-list-count'; countSpan.textContent = `${rawProxyData.split('\n').filter(Boolean).length} Proxies`; li.appendChild(countSpan);
          const buttonWrapper = document.createElement('div'); buttonWrapper.className = 'list-item-buttons';
          const editBtn = document.createElement('button'); editBtn.innerHTML = '✏️'; editBtn.className = 'edit-list-btn icon-btn'; editBtn.title = `Edit proxy list "${listName}"`;
          editBtn.onclick = () => {
            if(refs.proxyName) refs.proxyName.value = listName;
            if(refs.proxyText) refs.proxyText.value = rawProxyData;
            currentlyEditingProxyListName = listName; initialProxyListContentForEdit = rawProxyData;
            if(refs.saveProxyBtn) refs.saveProxyBtn.textContent = 'Update List';
            if (refs.cancelProxyEditBtn) refs.cancelProxyEditBtn.style.display = 'inline-block';
            setTimeout(() => refs.proxyText?.focus(), 50);
          };
          buttonWrapper.appendChild(editBtn);
          const deleteBtn = document.createElement('button');
          const trashCanSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="proxy-delete-icon-svg"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
          deleteBtn.innerHTML = trashCanSVG; deleteBtn.className = 'delete-list-btn icon-btn'; deleteBtn.title = `Delete proxy list "${listName}"`;
          
          deleteBtn.onclick = async () => { // MODIFIED: Made async
            const userConfirmed = await showCustomConfirm(
              `Are you sure you want to delete the proxy list "${listName}"?`, "Delete Proxy List"
            );
            if (!userConfirmed) {
              setTimeout(() => refs.proxyName?.focus(), 50);
              return;
            }
            const currentLists = LS.loadObj('proxyLists');
            const deletedListData = currentLists[listName];
            const deletedProxyCount = deletedListData ? deletedListData.split('\n').filter(Boolean).length : 0;
            delete currentLists[listName];
            LS.saveObj('proxyLists', currentLists);
            sendDiscordNotification({ title: `🗑️ Proxy List Deleted: ${listName}`, description: `List **${listName}** deleted. Contained ${deletedProxyCount} proxies.`, color: 0xE74C3C });
            showToast(`Proxy list "${listName}" deleted.`, 'success');
            if (currentlyEditingProxyListName === listName) {
              resetProxyFormAndEditState();
            }
            refreshProxyUI();
            setTimeout(() => refs.proxyName?.focus(), 50);
          };
          buttonWrapper.appendChild(deleteBtn);
          li.appendChild(buttonWrapper);
          refs.proxyUL.appendChild(li);
          const opt = document.createElement('option'); opt.value = listName; opt.textContent = listName; refs.proxyDD.appendChild(opt);
        });
    }
  }

  function refreshWebsiteUI() {
    if (!refs.siteUL || !refs.siteDD) return;
    const customSites = LS.loadObj('websiteLists');
    refs.siteUL.innerHTML = '';
    refs.siteDD.innerHTML = '<option value="">-- Select a Website --</option>';
    Object.entries(defaultWebsites).forEach(([name, url]) => {
      const opt = document.createElement('option'); opt.value = url; opt.textContent = `${name} (Default)`; refs.siteDD.appendChild(opt);
    });
    Object.entries(customSites).forEach(([name, url]) => {
      const li = document.createElement('li'); li.textContent = `${name} → ${url}`;
      const btn = document.createElement('button'); btn.innerHTML = '&times;'; btn.className = 'icon-btn delete-list-btn'; btn.title = `Delete custom website "${name}"`;
      btn.onclick = async () => { // MODIFIED: Made async
        const userConfirmed = await showCustomConfirm(
            `Remove custom website "${name}"?`, "Delete Website"
        );
        if (!userConfirmed) {
          setTimeout(() => refs.newSiteName?.focus(), 50);
          return;
        }
        const updatedSites = LS.loadObj('websiteLists'); // Load fresh for modification
        delete updatedSites[name];
        LS.saveObj('websiteLists', updatedSites);
        sendDiscordNotification({ title: `🗑️ Website Deleted: ${name}`, description: `Custom website **${name}** deleted. URL: ${url}`, color: 0xE74C3C });
        showToast(`Website "${name}" has been deleted.`, 'success');
        refreshWebsiteUI();
        setTimeout(() => refs.newSiteName?.focus(), 50);
      };
      li.appendChild(btn);
      refs.siteUL.appendChild(li);
      const opt = document.createElement('option'); opt.value = url; opt.textContent = name; refs.siteDD.appendChild(opt);
    });
  }

  function refreshSettingsUI() {
    if (refs.webhookInput) refs.webhookInput.value = LS.getItem('discordWebhook') || '';
    if (refs.queueIntervalInput) refs.queueIntervalInput.value = LS.getItem('queueInterval') || '5000';
    const savedThumbnailStrategy = LS.getItem('thumbnailStrategy') || 'initial';
    let radioToSelect;
    switch (savedThumbnailStrategy) {
        case 'static': radioToSelect = refs.thumbnailStrategyStaticRadio; break;
        case 'live-fast': radioToSelect = refs.thumbnailStrategyLiveFastRadio; break;
        case 'live-slow': radioToSelect = refs.thumbnailStrategyLiveSlowRadio; break;
        case 'event-driven': radioToSelect = refs.thumbnailStrategyEventDrivenRadio; break;
        case 'initial': default: radioToSelect = refs.thumbnailStrategyInitialRadio; break;
    }
    if (radioToSelect) radioToSelect.checked = true;
    else if (refs.thumbnailStrategyInitialRadio) { // Fallback if specific radio ref is missing
        refs.thumbnailStrategyInitialRadio.checked = true;
        LS.setItem('thumbnailStrategy', 'initial'); // Correct the stored value if it was invalid
    }
    ipcRenderer.send('update-thumbnail-strategy', document.querySelector('input[name="thumbnailUpdateStrategy"]:checked')?.value || 'initial');
  }

  // --- Event Listeners ---
  ipcRenderer.on('app-version', (event, arg) => {
    if (refs.appVersionDisplay) refs.appVersionDisplay.textContent = `v${arg.version}`;
  });

  ipcRenderer.on('update-message', (event, arg) => {
    if (refs.updateStatusDisplay) {
      if (arg.text && arg.text.trim() !== '') {
        refs.updateStatusDisplay.textContent = arg.text;
        refs.updateStatusDisplay.classList.add('visible');
        refs.updateStatusDisplay.classList.toggle('error', !!arg.isError);
        if (!arg.text.toLowerCase().includes("ready") && !arg.text.toLowerCase().includes("downloaded")) {
          setTimeout(() => {
            if (refs.updateStatusDisplay.textContent === arg.text) {
              refs.updateStatusDisplay.classList.remove('visible');
              setTimeout(() => {
                if (!refs.updateStatusDisplay.classList.contains('visible')) {
                  refs.updateStatusDisplay.textContent = '';
                  refs.updateStatusDisplay.classList.remove('error');
                }
              }, 300);
            }
          }, 7000);
        }
      } else {
        refs.updateStatusDisplay.classList.remove('visible');
        setTimeout(() => {
          if (!refs.updateStatusDisplay.classList.contains('visible')) {
            refs.updateStatusDisplay.textContent = '';
            refs.updateStatusDisplay.classList.remove('error');
          }
        }, 300);
      }
    }
  });
  
  ipcRenderer.on('focus-default-element', () => {
    const activeView = document.querySelector('.view.active');
    let focusableElement;
    if (activeView) {
        if (activeView.id === 'view-proxies') focusableElement = refs.proxyName;
        else if (activeView.id === 'view-settings') focusableElement = refs.newSiteName;
        else if (activeView.id === 'view-browsers') focusableElement = refs.browserName;
    }
    if (focusableElement) setTimeout(() => focusableElement.focus(), 50);
    else if (refs.browserName) setTimeout(() => refs.browserName.focus(), 50); // General fallback to browser task setup
  });

  if (refs.cancelProxyEditBtn) {
    refs.cancelProxyEditBtn.addEventListener('click', () => {
      resetProxyFormAndEditState(); // Clears form, hides cancel button
      refreshProxyUI();
      if (refs.proxyFormStatus) updateStatus(refs.proxyFormStatus, 'Edit cancelled.', false);
      setTimeout(() => refs.proxyName?.focus(), 50); // Set focus after actions
    });
  }
  
  if (refs.saveProxyBtn) {
    refs.saveProxyBtn.addEventListener('click', async () => { // MODIFIED: Made async
      const newListName = refs.proxyName.value.trim();
      const newRawProxyData = refs.proxyText.value.trim();

      if (!newRawProxyData || !newListName) {
        showToast('Proxy list name and content cannot be empty.', 'error', 4500);
        setTimeout(() => refs.proxyName?.focus(), 50);
        return;
      }

      let allLists = LS.loadObj('proxyLists');
      let actionMessage = '';
      let successfullySavedOrUpdated = false;
      const proxyCount = newRawProxyData.split('\n').filter(Boolean).length;
      let notificationDetails = { title: '', description: '', color: 0x2ECC71 };

      if (currentlyEditingProxyListName) {
        const originalListName = currentlyEditingProxyListName;
        const nameChanged = newListName !== originalListName;
        const contentChanged = newRawProxyData !== initialProxyListContentForEdit;

        if (!nameChanged && !contentChanged) {
          showToast('No changes detected for proxy list "' + originalListName + '".', 'info');
          setTimeout(() => refs.proxyName?.focus(), 50);
          return;
        }

        if (newListName !== originalListName && allLists[newListName]) {
          const confirmOverwrite = await showCustomConfirm(
            `A list named "${newListName}" already exists. Overwrite it?`, "Confirm Overwrite"
          );
          if (!confirmOverwrite) { 
            setTimeout(() => refs.proxyName?.focus(), 50);
            return; 
          }
        }
        // Proceed with update/rename
        if (originalListName !== newListName) delete allLists[originalListName]; 
        allLists[newListName] = newRawProxyData;
        actionMessage = newListName === originalListName ? `Proxy list "${newListName}" updated.` : `Proxy list "${originalListName}" renamed to "${newListName}" and updated.`;
        notificationDetails.title = newListName === originalListName ? `🔄 Proxy List Updated: ${newListName}` : `🔄 Proxy List Renamed: ${newListName}`;
        notificationDetails.description = `List content ${nameChanged ? 'renamed and ' : ''}updated. Contains ${proxyCount} proxies.`;
        notificationDetails.color = newListName === originalListName ? 0x3498DB : 0xFFA500;
        successfullySavedOrUpdated = true;
      } else { // New list
        if (allLists[newListName]) {
          const confirmOverwriteNew = await showCustomConfirm(
            `Proxy list "${newListName}" already exists. Overwrite it?`, "Confirm Overwrite"
          );
          if (!confirmOverwriteNew) { 
            setTimeout(() => refs.proxyName?.focus(), 50);
            return; 
          }
        }
        allLists[newListName] = newRawProxyData;
        actionMessage = `Proxy list "${newListName}" ${allLists[newListName] && currentlyEditingProxyListName !== newListName ? 'overwritten' : 'saved'}.`;
        notificationDetails.title = `💾 Proxy List ${allLists[newListName] && currentlyEditingProxyListName !== newListName ? 'Overwritten' : 'Saved'}: ${newListName}`;
        notificationDetails.description = `Contains ${proxyCount} proxies.`;
        successfullySavedOrUpdated = true;
      }

      if (successfullySavedOrUpdated) {
        LS.saveObj('proxyLists', allLists);
        sendDiscordNotification({ ...notificationDetails, fields: [{ name: "Total Proxies", value: proxyCount.toString(), inline: true }] });
        resetProxyFormAndEditState();
        showToast(actionMessage, 'success');
      }
      refreshProxyUI();
      setTimeout(() => refs.proxyName?.focus(), 50); // Focus after all actions
    });
  }

  if (refs.addSiteBtn) {
    refs.addSiteBtn.addEventListener('click', async () => { // MODIFIED: Made async
      const name = refs.newSiteName.value.trim();
      let url = refs.newSiteURL.value.trim();

      if (!name || !url) {
        showToast('Website name and URL cannot be empty.', 'error', 4500);
        setTimeout(() => name ? refs.newSiteURL?.focus() : refs.newSiteName?.focus(), 50);
        return;
      }
      if (!url.match(/^https?:\/\//i) && !url.match(/^file:\/\/\//i)) url = 'https://' + url;
      try { new URL(url); } catch (_) {
        showToast('Invalid URL format. Please include http:// or https://', 'error', 4500);
        setTimeout(() => refs.newSiteURL?.focus(), 50);
        return;
      }
      const lists = LS.loadObj('websiteLists');
      if (lists[name] || defaultWebsites[name]) {
        showToast(`Website "${name}" already exists.`, 'error', 4500);
        setTimeout(() => refs.newSiteName?.focus(), 50);
        return;
      }
      lists[name] = url;
      LS.saveObj('websiteLists', lists);
      sendDiscordNotification({ title: `💾 Website Added: ${name}`, description: `Added: **${name}** (${url})`, color: 0x2ECC71 });
      refs.newSiteName.value = ''; refs.newSiteURL.value = '';
      refreshWebsiteUI();
      showToast(`Website "${name}" added.`, 'success');
      setTimeout(() => refs.newSiteName?.focus(), 50);
    });
  }

  // Settings Event Listeners
  if (refs.saveWebhookBtn) refs.saveWebhookBtn.addEventListener('click', () => {
    const url = refs.webhookInput.value.trim();
    if (!url) { LS.removeItem('discordWebhook'); showToast('Webhook cleared.', 'info'); }
    else {
      try { new URL(url); LS.setItem('discordWebhook', url); showToast('Webhook saved!', 'success'); }
      catch (e) { showToast('Invalid Webhook URL.', 'error', 4500); }
    }
    setTimeout(() => refs.webhookInput?.focus(), 50);
  });

  if (refs.testWebhookBtn) refs.testWebhookBtn.addEventListener('click', () => {
    const hook = LS.getItem('discordWebhook') || '';
    if (!hook) { showToast('No webhook saved to test.', 'error', 4500); return; }
    sendDiscordNotification({ author: { name: `🧪 Test Notification - ${APP_NAME}` }, description: `Test from ${APP_NAME}! Sent: ${new Date().toLocaleTimeString()}`, color: 0x3498DB });
    showToast('Test notification sent!', 'info');
  });

  if (refs.saveQueueIntervalBtn) refs.saveQueueIntervalBtn.addEventListener('click', () => {
    const v = parseInt(refs.queueIntervalInput.value, 10);
    if (isNaN(v) || v < 1000) { showToast('Minimum interval is 1000ms.', 'error', 4500); return; }
    LS.setItem('queueInterval', v);
    ipcRenderer.send('update-setting', 'queueInterval', v);
    showToast(`Interval set: ${v}ms.`, 'success');
    setTimeout(() => refs.queueIntervalInput?.focus(), 50);
  });

  if (refs.saveThumbnailStrategyBtn) refs.saveThumbnailStrategyBtn.addEventListener('click', () => {
    const selectedStrategy = document.querySelector('input[name="thumbnailUpdateStrategy"]:checked')?.value || 'initial';
    LS.setItem('thumbnailStrategy', selectedStrategy);
    ipcRenderer.send('update-thumbnail-strategy', selectedStrategy);
    showToast(`Thumbnail strategy set to: ${selectedStrategy.replace('-', ' ')}.`, 'success');
  });

  if (refs.launchBtn) {
    refs.launchBtn.addEventListener('click', async () => {
      const proxyListName = refs.proxyDD.value;
      const siteUrl = refs.siteDD.value;
      const prefix = refs.browserName.value.trim();
      if (!proxyListName || !siteUrl) {
        showToast('Please select a proxy list and a website.', 'error', 4500);
        setTimeout(() => proxyListName ? refs.siteDD?.focus() : refs.proxyDD?.focus(), 50);
        return;
      }
      const allProxyLists = LS.loadObj('proxyLists');
      const rawProxyData = allProxyLists[proxyListName];
      if (!rawProxyData) {
        showToast(`Proxy list "${proxyListName}" not found.`, 'error', 4500);
        setTimeout(() => refs.proxyDD?.focus(), 50);
        return;
      }
      const proxies = rawProxyData.split('\n').map(s => s.trim()).filter(Boolean);
      if (!proxies.length) {
        showToast('The selected proxy list is empty.', 'error', 4500);
        setTimeout(() => refs.proxyDD?.focus(), 50);
        return;
      }
      const count = parseInt(refs.tabCount.value, 10) || 1;
      if (count <= 0) {
        showToast('Number of tabs must be at least 1.', 'error', 4500);
        setTimeout(() => refs.tabCount?.focus(), 50);
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
          await ipcRenderer.invoke('create-proxied-tab', proxy, siteUrl, name);
        } catch (err) {
          showToast(`Error launching tab "${name}": ${err.message}.`, 'error', 5000);
        }
        if (count >= DELAY_THRESHOLD && i < count - 1) await sleep(LAUNCH_DELAY_MS);
      }
      refs.launchBtn.disabled = false;
      refs.launchBtn.textContent = 'Launch Browsers';
      setTimeout(() => refs.browserName?.focus(), 50);
    });
  }

  if (refs.closeAllBtn) {
    refs.closeAllBtn.addEventListener('click', async () => { // MODIFIED: Made async
      const userConfirmed = await showCustomConfirm(
        'Are you sure you want to close ALL open tabs?', 'Close All Tabs', 'Yes, Close All', 'Cancel'
      );
      if (!userConfirmed) return; // Focus will remain on the modal's cancel or be handled by window
      
      ipcRenderer.invoke('close-all-tabs'); // This is async in main but renderer doesn't wait
      showToast('Close all tabs request sent.', 'info');
      // No specific element to focus here, as context is general
    });
  }

  // IPC listeners from Main Process
  ipcRenderer.on('discord-embed-from-main', (event, embedData) => sendDiscordNotification(embedData));
  ipcRenderer.on('queue-pos', (e, { pos, label, id, fullResponse }) => { /* ... (as before, unchanged) ... */ });
  ipcRenderer.on('tab-minimized', (e, { id, label, thumbnail }) => { /* ... (as before, unchanged) ... */ });
  ipcRenderer.on('tab-thumbnail', (e, { id, src }) => { /* ... (as before, unchanged) ... */ });
  ipcRenderer.on('tab-closed', (e, { id }) => { /* ... (as before, unchanged) ... */ });
  ipcRenderer.on('task-creation-error', (event, { name, message }) => {
    showToast(`Error creating tab "${name || 'Unnamed'}": ${message}`, 'error', 5000);
  });
  ipcRenderer.on('live-thumbnail-failed', (event, { tabId, name, message }) => { /* ... (as before, unchanged) ... */ });


  // Sidebar view switching
  document.querySelectorAll('#sidebar ul li[data-view]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#sidebar ul li[data-view].active').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view.active').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      const viewId = 'view-' + tab.dataset.view;
      const viewElement = document.getElementById(viewId);
      if (viewElement) viewElement.classList.add('active');
      
      setTimeout(() => { // Set focus after view switch
        let focusableElement;
        if (viewId === 'view-proxies') focusableElement = refs.proxyName;
        else if (viewId === 'view-settings') focusableElement = refs.newSiteName; // or webhookInput if more primary
        else if (viewId === 'view-browsers') focusableElement = refs.browserName;
        focusableElement?.focus();
        adjustProxyListHeight(); // Also call adjust height for proxies view
      }, 100);
    });
  });

  // Local Time Clock
  let clockIntervalId = null;
  function updateLocalTime() {
    if (refs.localTimeClock) {
      const now = new Date();
      refs.localTimeClock.textContent = `${now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}`;
    }
  }
  if (refs.localTimeClock) {
    updateLocalTime();
    clockIntervalId = setInterval(updateLocalTime, 1000);
  }

  // Initial UI render and state
  try {
    refreshProxyUI();
    refreshWebsiteUI();
    refreshSettingsUI();
    checkDockEmpty();
    const initialViewTab = document.querySelector('#sidebar ul li[data-view="browsers"]');
    if (initialViewTab) initialViewTab.click(); // This will trigger focus logic in its click handler
    else if (refs.browserName) setTimeout(() => refs.browserName.focus(), 150); // Fallback initial focus

    if (refs.cancelProxyEditBtn) refs.cancelProxyEditBtn.style.display = 'none';
  } catch (error) {
    console.error('[Renderer.js] Error during initial UI render:', error);
    showToast('Error initializing UI. Please check console.', 'error', 5000);
  }
  console.log('[Renderer.js] DOMContentLoaded processing complete.');

  // --- adjustProxyListHeight function ---
  const PROXY_FORM_ESTIMATED_HEIGHT = 250; // You might need to fine-tune this
  const WINDOW_HEIGHT_THRESHOLD = 670;
  const PADDING_AND_MARGINS = 60;      // Buffer

  function adjustProxyListHeight() {
    const viewProxies = document.getElementById('view-proxies');
    const savedProxiesSection = viewProxies ? viewProxies.querySelector('.saved-proxies-section') : null;

    if (!savedProxiesSection || !viewProxies.classList.contains('active')) {
      if (savedProxiesSection) savedProxiesSection.style.maxHeight = '';
      return;
    }

    const windowHeight = window.innerHeight;
    const contentElement = document.getElementById('content'); // Assuming #content is the main area
    const contentTop = contentElement ? contentElement.offsetTop : 0; // Adjust if #content is not direct child of body
    
    let heightAboveList = 0;
    let currentElement = viewProxies.firstElementChild;
    while (currentElement && !currentElement.classList.contains('saved-proxies-section')) {
        if (currentElement.offsetParent !== null) { // Only count visible elements
            const style = window.getComputedStyle(currentElement);
            heightAboveList += currentElement.offsetHeight + parseInt(style.marginTop) + parseInt(style.marginBottom);
        }
        currentElement = currentElement.nextElementSibling;
    }
    const viewProxiesStyle = window.getComputedStyle(viewProxies);
    heightAboveList += parseInt(viewProxiesStyle.paddingTop) + parseInt(viewProxiesStyle.paddingBottom);

    if (windowHeight < WINDOW_HEIGHT_THRESHOLD) {
      let calculatedMaxHeight = windowHeight - contentTop - heightAboveList - PADDING_AND_MARGINS;
      if (calculatedMaxHeight < 100) calculatedMaxHeight = 100; // Ensure min-height like CSS
      savedProxiesSection.style.maxHeight = `${calculatedMaxHeight}px`;
    } else {
      savedProxiesSection.style.maxHeight = '';
    }
  }
  // Initial adjustment on load for adjustProxyListHeight is implicitly handled by sidebar click or direct call
  // if proxies is the default view. For safety, we can call it once if proxies view starts active.
  if (document.getElementById('view-proxies')?.classList.contains('active')) {
    adjustProxyListHeight();
  }
  window.addEventListener('resize', adjustProxyListHeight);
  // Sidebar links already call this via their click listener's setTimeout if they switch to proxies view

});