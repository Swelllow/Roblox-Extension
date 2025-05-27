const requestCache = {};
const requestQueue = [];
let processingQueue = false;

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

function generateSessionId() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

let quickSearchSessionId = generateSessionId();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchGameThumbnail") {
    fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${message.universeId}&size=150x150&format=Png&isCircular=false`)
      .then(resp => resp.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ data: [] }));
    return true;
  }

  if (message.action === "fetchGameSearch") {
    const searchUrl = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(message.keyword)}&pageToken=&sessionId=${quickSearchSessionId}&pageType=Game`;
    fetch(searchUrl)
      .then(response => response.json())
      .then(data => {
        const games = [];
        if (data.searchResults) {
          for (const result of data.searchResults) {
            if (result.contentGroupType === "Game" && result.contents?.[0]) {
              const game = result.contents[0];
              games.push({
                name: game.name,
                creatorName: game.creatorName || (game.creator && game.creator.name) || "Unknown",
                rootPlaceId: game.rootPlaceId,
                thumbnail: `https://tr.rbxcdn.com/datastore/thumbs/t_${game.universeId}_128x128_Png_Regular.png`,
                playerCount: game.playerCount || 0,
                universeId: game.universeId
              });
            }
          }
        }
        sendResponse({ searchResults: games });
      })
      .catch(error => {
        sendResponse({ searchResults: [] });
      });
    return true;
  }

  if (message.action === 'quickSearchJoin') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        const currentTab = tabs[0];
        if (currentTab.url.includes('roblox.com/games/')) {
          chrome.tabs.sendMessage(currentTab.id, {
            action: 'joinServer',
            placeId: message.placeId,
            serverId: message.serverId
          });
        } else {
          chrome.tabs.update(currentTab.id, { url: `https://www.roblox.com/games/${message.placeId}/#quick-join` }, (updatedTab) => {
            setTimeout(() => {
              chrome.tabs.sendMessage(updatedTab.id, {
                action: 'joinServer',
                placeId: message.placeId,
                serverId: message.serverId
              });
            }, 2000);
          });
        }
      }
    });
    return true;
  }

  if (message.action === "robloxFetch") {
    fetch(message.url, {
      method: message.method || "GET",
      headers: message.headers || {},
      credentials: "include",
      body: message.body || undefined
    }).then(resp => resp.json())
      .then(data => sendResponse({data}))
      .catch(e => sendResponse({error: true, msg: e.toString()}));
    return true;
  }

  if (message.greeting === "GetURL" && message.url) {
    if (requestCache[message.url] && Date.now() - requestCache[message.url].ts < 5000) {
      sendResponse(requestCache[message.url].data);
      return true;
    }
    requestQueue.push({ url: message.url, sendResponse });
    processQueue();
    return true;
  }

  if (message.action === 'joinServer') {
    const { placeId, serverId, tabId } = message;
    chrome.storage.local.set({ placeId, serverId }, () => {
      chrome.tabs.sendMessage(tabId, { action: 'executeJoin' }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true });
        }
      });
    });
    return true;
  }
});

async function processQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (requestQueue.length) {
    const { url, sendResponse } = requestQueue.shift();
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      requestCache[url] = { ts: Date.now(), data };
      sendResponse(data);
    } catch (e) {
      sendResponse({ error: true, data: [] });
    }
    await new Promise(res => setTimeout(res, 650));
  }
  processingQueue = false;
}

chrome.runtime.onUpdateAvailable.addListener((details) => {
  chrome.runtime.reload();
});
