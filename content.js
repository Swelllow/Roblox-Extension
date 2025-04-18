// Content script for Roblox game pages
let cachedPlaceId = null;

function getPlaceIdFromUrl() {
  if (cachedPlaceId !== null) {
    return cachedPlaceId;
  }
  
  try {
    const url = new URL(window.location.href);
    
    // Try path segments first
    const pathSegments = url.pathname.split('/');
    let placeId = pathSegments.find(segment => !isNaN(segment) && segment.length > 0);
    
    // Try query parameters
    if (!placeId) {
      const urlParams = new URLSearchParams(window.location.search);
      placeId = urlParams.get('gameId');
    }
    
    // Try page metadata
    if (!placeId) {
      const placeIdMeta = document.querySelector('meta[name="game-id"], meta[name="place-id"]');
      if (placeIdMeta) {
        placeId = placeIdMeta.getAttribute('content');
      }
    }
    
    cachedPlaceId = placeId ? parseInt(placeId, 10) : null;
    return cachedPlaceId;
  } catch (error) {
    console.error('Error extracting Place ID:', error);
    return null;
  }
}

function executeInPageContext(func, args) {
  try {
    const script = document.createElement('script');
    script.textContent = `(${func.toString()})(${args.map(arg => JSON.stringify(arg)).join(', ')})`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch (error) {
    console.error('Error executing in page context:', error);
  }
}

function joinGameInstance(placeId, serverId) {
  executeInPageContext((placeId, serverId) => {
    try {
      if (typeof Roblox !== 'undefined' && Roblox.GameLauncher) {
        Roblox.GameLauncher.joinGameInstance(placeId, String(serverId));
      } else {
        console.error('Roblox GameLauncher not available');
      }
    } catch (error) {
      console.error('Error joining game:', error);
    }
  }, [placeId, serverId]);
}

function performServerJoin(placeId, serverId) {
  try {
    // Create and trigger a temporary button with the join command
    const button = document.createElement("button");
    button.setAttribute("onclick", `Roblox.GameLauncher.joinGameInstance(${placeId}, "${serverId}")`);
    document.body.appendChild(button);
    button.click();
    button.remove();
  } catch (error) {
    // Fallback method if button approach fails
    try {
      if (typeof Roblox !== 'undefined' && Roblox.GameLauncher) {
        Roblox.GameLauncher.joinGameInstance(placeId, String(serverId));
      }
    } catch (fallbackError) {
      console.error('All join attempts failed');
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPlaceId') {
    const placeId = getPlaceIdFromUrl();
    sendResponse({ placeId });
  }
  
  if (message.action === 'joinServer') {
    const { placeId, serverId } = message;
    joinGameInstance(placeId, serverId);
    sendResponse({ success: true });
  }
  
  if (message.action === 'executeJoin') {
    chrome.storage.local.get(['placeId', 'serverId'], (result) => {
      const { placeId, serverId } = result;
      
      if (!placeId || !serverId) {
        console.error('Missing placeId or serverId');
        return;
      }
      
      setTimeout(() => {
        performServerJoin(placeId, serverId);
      }, 100);
    });
    sendResponse({ success: true });
  }
  
  return true;
});

// Initialize and watch for URL changes
(function() {
  getPlaceIdFromUrl();
  
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cachedPlaceId = null;
      getPlaceIdFromUrl();
    }
  }).observe(document, { subtree: true, childList: true });
})();