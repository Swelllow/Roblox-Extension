if (window.cachedPlaceId === undefined) window.cachedPlaceId = null;

function getPlaceIdFromUrl() {
  if (window.cachedPlaceId !== null) return window.cachedPlaceId;
  try {
    const url = new URL(window.location.href);
    const pathSegments = url.pathname.split('/');
    let placeId = pathSegments.find(segment => !isNaN(segment) && segment.length > 0);
    if (!placeId) {
      const urlParams = new URLSearchParams(window.location.search);
      placeId = urlParams.get('gameId');
    }
    if (!placeId) {
      const placeIdMeta = document.querySelector('meta[name="game-id"], meta[name="place-id"]');
      if (placeIdMeta) placeId = placeIdMeta.getAttribute('content');
    }
    window.cachedPlaceId = placeId ? parseInt(placeId, 10) : null;
    return window.cachedPlaceId;
  } catch {
    return null;
  }
}

function autoClickPlayButton() {
  let attempts = 0, maxAttempts = 50;
  function tryClick() {
    const playBtn = document.querySelector('[data-testid="play-button"], .btn-common-play-game-lg, .game-details-play-button');
    if (playBtn) {
      playBtn.click();
      history.replaceState(null, "", window.location.pathname + window.location.search); // Remove hash
    } else if (++attempts < maxAttempts) {
      setTimeout(tryClick, 200);
    }
  }
  tryClick();
}

(function() {
  const placeIdFromUrl = (() => {
    const url = new URL(window.location.href);
    const pathSegments = url.pathname.split('/');
    const pid = pathSegments.find(segment => /^\d+$/.test(segment));
    return pid ? parseInt(pid, 10) : null;
  })();
  if ((window.location.hash === "#quick-join" || window.location.hash === "#auto-join") && placeIdFromUrl) {
    autoClickPlayButton();
  }
})();




chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getPlaceId') {
    const placeId = getPlaceIdFromUrl();
    sendResponse({ placeId });
  }
  if (message.action === 'joinServer') {
    const expectedUrl = `https://www.roblox.com/games/${message.placeId}#quick-join`;
    if (window.location.href !== expectedUrl) {
      window.location.href = expectedUrl;
    }
    sendResponse({ success: true });
  }
  if (message.action === 'executeJoin') {
    chrome.storage.local.get(['placeId'], (result) => {
      const { placeId } = result;
      const expectedUrl = `https://www.roblox.com/games/${placeId}#quick-join`;
      if (placeId && window.location.href !== expectedUrl) {
        window.location.href = expectedUrl;
      }
    });
    sendResponse({ success: true });
  }
  return true;
});

(function() {
  getPlaceIdFromUrl();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      window.cachedPlaceId = null;
      getPlaceIdFromUrl();
    }
  }).observe(document, { subtree: true, childList: true });
})();
