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