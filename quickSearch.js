let searchTimeout = null;
let gameQueryCache = {};
let userQueryCache = {};
let currentSearchInput = null;

async function fetchGameSearch(query) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'fetchGameSearch',
      keyword: query
    }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ searchResults: [] });
        return;
      }
      resolve(response || { searchResults: [] });
    });
  });
}

function fetchUserSearch(query) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      greeting: "GetURL",
      url: `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(query)}&limit=10`
    }, resolve);
  });
}

function getUserPresence(userId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: "robloxFetch",
      url: "https://presence.roblox.com/v1/presence/users",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [userId] })
    }, (response) => {
      if (response && response.data && response.data.userPresences && response.data.userPresences[0]) {
        resolve(response.data.userPresences[0]);
      } else {
        resolve(null);
      }
    });
  });
}

function joinGameInstance(placeId, serverId) {
  console.log('[quicksearch] joinGameInstance called with', placeId, serverId);
  window.location.href = 'roblox://placeId=' + placeId + '&gameInstanceId=' + serverId;
}


function getUserAvatarFromAutocompleteResult(result) {
  return result.thumbnailUrl || "https://tr.rbxcdn.com/6ba8f1b5d191b443d51f5b7756ef74b6/100/100/AvatarHeadshot/Png/circular/";
}

async function getGameThumbnail(universeId) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { action: 'fetchGameThumbnail', universeId: universeId },
      (data) => {
        if (chrome.runtime.lastError || !data || !data.data || !data.data[0] || !data.data[0].imageUrl) {
          resolve("https://t3.rbxcdn.com/da787ba5e7a6de1bcf1f15d29c246c41");
        } else {
          resolve(data.data[0].imageUrl);
        }
      }
    );
  });
}

async function getUserAvatar(userId) {
  return new Promise((resolve) => {
    fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=100x100&format=Png&isCircular=true`)
      .then(resp => resp.json())
      .then(data => {
        if (data && data.data && data.data[0] && data.data[0].imageUrl) {
          resolve(data.data[0].imageUrl);
        } else {
          resolve("https://tr.rbxcdn.com/6ba8f1b5d191b443d51f5b7756ef74b6/100/100/AvatarHeadshot/Png/circular/");
        }
      })
      .catch(() => resolve("https://tr.rbxcdn.com/6ba8f1b5d191b443d51f5b7756ef74b6/100/100/AvatarHeadshot/Png/circular/"));
  });
}

function stripTags(str) {
  return (str || '').replace(/<\/?[^>]+(>|$)/g, "");
}

async function insertQuickSearchResults({game, user}) {
  const dropdown = document.querySelector('.navbar-search .dropdown-menu');
  if (!dropdown) return;
  Array.from(dropdown.querySelectorAll('.quick-game-search, .quick-user-search')).forEach(e => e.remove());

  let userHtml = '';
  let gameHtml = '';

  let joinBtnEvent = null;
  let playBtnEvent = null;

  if (user) {
    const [avatarUrl, presence] = await Promise.all([
      getUserAvatar(user.id),
      getUserPresence(user.id)
    ]);
    let borderClass = "offline";
    let joinBtnHtml = '';

    if (presence) {
      if (presence.userPresenceType === 1) borderClass = "online";
      if (presence.userPresenceType === 2) borderClass = "ingame";
      if (presence.userPresenceType === 3) borderClass = "online";
      if (presence.userPresenceType === 0) borderClass = "offline";

      if (presence.userPresenceType === 2 && presence.placeId && presence.gameId) {
        joinBtnHtml = `<button class="quick-play-btn" style="
          margin-left:auto;
          height:28px;
          width:70px;
          background:#00a2ff;
          color:#fff;
          border:none;
          border-radius:7px;
          font-size:13px;
          font-weight:700;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          box-shadow:0 1px 4px rgba(0,162,255,0.10);
          transition:background .13s, transform .13s;
        ">Join</button>`;
        joinBtnEvent = function(e) {
          console.log('[quicksearch] Join button handler fired!');
          joinGameInstance(presence.placeId, presence.gameId);
        };
      }
    }

    userHtml = `
      <li class="navbar-search-option quick-user-search" style="display:flex; align-items:center; border-radius:0px; padding:8px 14px; margin:0px 0; background:transparent; cursor:pointer;">
        <div class="quick-user-avatar ${borderClass}">
          <img src="${avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
        </div>
        <div style="flex:1 1 0; min-width:0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:700; font-size:15px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${stripTags(user.displayName)}
          </div>
          <div style="font-size:12px; color:#a9b8cc; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            @${stripTags(user.name)}
          </div>
        </div>
        ${joinBtnHtml}
      </li>
    `;
  }

  if (game) {
    const thumbnailUrl = await getGameThumbnail(game.universeId);
    gameHtml = `
      <li class="navbar-search-option rbx-clickable-li quick-game-search" style="display:flex; align-items:center; border-radius:0px; padding:8px 14px; margin:0px 0; background:transparent;">
        <div style="width:40px; height:40px; flex-shrink:0; border-radius:0px; overflow:hidden; background:#23272a; margin-right:14px; display:flex; align-items:center; justify-content:center;">
          <img src="${stripTags(thumbnailUrl)}" alt="Game Icon" style="width:100%;height:100%;object-fit:cover;">
        </div>
        <div style="flex:1 1 0; min-width:0; display:flex; flex-direction:column; justify-content:center;">
          <div style="font-weight:700; font-size:15px; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${stripTags(game.name)}
          </div>
          <div style="font-size:12px; color:#a9b8cc; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            by ${stripTags(game.creatorName || "Unknown")} · 
            <span style="color:#00a2ff;font-weight:600;">${game.playerCount ? game.playerCount.toLocaleString() + ' playing' : 'No players'}</span>
          </div>
        </div>
        <button class="quick-play-btn" title="Quick Join"
          style="
            margin-left:auto;
            height:28px;
            width:70px;
            background:#00a2ff;
            color:#fff;
            border:none;
            border-radius:7px;
            font-size:13px;
            font-weight:700;
            cursor:pointer;
            display:flex;
            align-items:center;
            justify-content:center;
            box-shadow:0 1px 4px rgba(0,162,255,0.10);
            transition:background .13s, transform .13s;
          ">
          <i class="fas fa-play" style="margin-right:5px; font-size:13px"></i>Play
        </button>
      </li>
    `;
    playBtnEvent = function(e) {
      if (game.rootPlaceId && game.serverId) {
        console.log('[quicksearch] Play button handler fired! Joining specific server.');
        joinGameInstance(game.rootPlaceId, game.serverId);
      } else {
        console.log('[quicksearch] Play button handler fired! Joining normal game page.');
        chrome.storage.local.set({
          quickSearchJoin: Date.now(),
          quickSearchPlaceId: game.rootPlaceId
        }, () => {
          window.location.href = `https://www.roblox.com/games/${game.rootPlaceId}#quick-join`;
        });
      }
    };
  }

  if (gameHtml) dropdown.insertAdjacentHTML('afterbegin', gameHtml);
  if (userHtml) dropdown.insertAdjacentHTML('afterbegin', userHtml);

  setTimeout(() => {
    // User join button
    const userElem = dropdown.querySelector('.quick-user-search');
    userElem && userElem.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-play-btn')) return;
      window.location.href = `https://www.roblox.com/users/${user.id}/profile`;
    });
    const joinUserBtn = dropdown.querySelector('.quick-user-search .quick-play-btn');
    if (joinUserBtn && typeof joinBtnEvent === "function") {
      joinUserBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        joinBtnEvent(e);
      });
    }

    // Game play button
    const gameElem = dropdown.querySelector('.quick-game-search');
    gameElem && gameElem.addEventListener('click', (e) => {
      if (e.target.classList.contains('quick-play-btn')) return;
      window.location.href = `https://www.roblox.com/games/${game.rootPlaceId}`;
    });
    const playBtn = dropdown.querySelector('.quick-game-search .quick-play-btn');
    if (playBtn && typeof playBtnEvent === "function") {
      playBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        playBtnEvent(e);
      });
    }
  }, 0);
}

async function handleSearchInput(e) {
  const query = e.target.value.trim();
  if (searchTimeout) clearTimeout(searchTimeout);
  if (!query) {
    Array.from(document.querySelectorAll('.quick-game-search, .quick-user-search')).forEach(e => e.remove());
    return;
  }
  searchTimeout = setTimeout(async () => {
    let gameData = gameQueryCache[query];
    if (!gameData) {
      gameData = await fetchGameSearch(query);
      if (gameData.searchResults && gameData.searchResults.length > 0) {
        gameQueryCache[query] = gameData;
      }
    }
    let userData = userQueryCache[query];
    if (!userData) {
      userData = await fetchUserSearch(query);
      if (userData.data && userData.data.length > 0) {
        userQueryCache[query] = userData;
      }
    }
    const game = gameData && gameData.searchResults && gameData.searchResults.length > 0 ? gameData.searchResults[0] : null;
    const user = userData && userData.data && userData.data.length > 0 ? userData.data[0] : null;
    if (!game && !user) {
      Array.from(document.querySelectorAll('.quick-game-search, .quick-user-search')).forEach(e => e.remove());
      return;
    }
    insertQuickSearchResults({game, user});
  }, 250);
}

function initQuickIntegratedSearch() {
  const observer = new MutationObserver(() => {
    const searchInput = document.getElementById('navbar-search-input');
    if (searchInput && searchInput !== currentSearchInput) {
      currentSearchInput = searchInput;
      searchInput.removeEventListener('input', handleSearchInput);
      searchInput.addEventListener('input', handleSearchInput);
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  const searchInput = document.getElementById('navbar-search-input');
  if (searchInput) {
    currentSearchInput = searchInput;
    searchInput.addEventListener('input', handleSearchInput);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initQuickIntegratedSearch);
} else {
  initQuickIntegratedSearch();
}
