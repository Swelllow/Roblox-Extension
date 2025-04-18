// Handles extension initialization and messaging
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    const defaultSettings = {
      displaySettings: {
        showServerId: true,
        showIP: true,
        showLocation: true,
        showPlayers: true,
        showFPS: true,
        showPing: true,
        joinLowServers: true,
      }
    };
    
    chrome.storage.sync.set(defaultSettings);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.url.match(/https:\/\/(www\.)?roblox\.com\/games\/.*/)) {
    chrome.tabs.sendMessage(details.tabId, { action: 'executeJoin' })
      .catch((error) => {
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          files: ['content.js']
        }).then(() => {
          chrome.tabs.sendMessage(details.tabId, { action: 'executeJoin' });
        }).catch(err => console.error('Error injecting content script:', err));
      });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'joinServer') {
    const { placeId, serverId, tabId } = message;
    
    chrome.storage.local.set({ placeId, serverId }, () => {
      chrome.tabs.sendMessage(tabId, { action: 'executeJoin' })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error('Failed to send join command:', error);
          sendResponse({ success: false, error: error.message });
        });
    });
    
    return true;
  }
});

chrome.runtime.onUpdateAvailable.addListener((details) => {
  console.log(`Update available: ${details.version}`);
});