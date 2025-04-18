// Cache variables
const cache = {
  servers: {},
  players: {},
  cursorHistory: {},
  recentlyJoinedServers: {},
  previousPages: {},
  friends: {},
  onlineFriends: [],
  friendsPlaying: {}
};

// State variables
let state = {
  randomJoinCooldown: false,
  showRecentlyJoined: false,
  serversPerPage: 100,
  currentPage: 1,
  cursor: null,
  currentFilter: null,
  userAgentSwitcherEnabled: false,
  userAgentSwitcherTimeout: null,
  serverRegionsByIp: {}
};

// Display settings with defaults
const displaySettings = {
  showServerId: true,
  showIP: true,
  showLocation: true,
  showPlayers: true,
  showFPS: true,
  showPing: true,
  joinLowServers: true,
};

// Save settings to Chrome storage
const saveSettings = () => {
  chrome.storage.sync.set({ displaySettings }, () => {
    showToast('Settings saved!');
  });
};

// Load settings from Chrome storage
const loadSettings = async () => {
  return new Promise(resolve => {
    chrome.storage.sync.get('displaySettings', (data) => {
      if (data.displaySettings) {
        Object.assign(displaySettings, data.displaySettings);
      }
      
      Object.entries(displaySettings).forEach(([key, value]) => {
        const element = document.querySelector(`input[name="${key}"]`);
        if (element) {
          if (element.type === 'checkbox') {
            element.checked = value;
          } else if (element.type === 'number') {
            element.value = value;
          }
        }
      });
      
      resolve();
    });
  });
};

// Get the Roblox security cookie
const getRobloxSecurityCookie = async () => {
  return new Promise((resolve, reject) => {
    chrome.cookies.get({ url: 'https://www.roblox.com', name: '.ROBLOSECURITY' }, (cookie) => {
      if (cookie) {
        resolve(cookie.value);
      } else {
        reject('ROBLOSECURITY cookie not found. Are you logged in to Roblox?');
      }
    });
  });
};

// Load server regions data from JSON file
const loadServerRegions = async () => {
  try {
    const response = await fetch(chrome.runtime.getURL('ServerList.json'));
    if (response.ok) {
      state.serverRegionsByIp = await response.json();
      return state.serverRegionsByIp;
    } else {
      console.error('Failed to load ServerList.json:', response.statusText);
      return {};
    }
  } catch (error) {
    console.error('Failed to load ServerList.json:', error);
    return {};
  }
};

// Load user info including avatar and follower count
const loadUserInfo = async () => {
  try {
    const cookie = await getRobloxSecurityCookie();
    const response = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'User-Agent': 'Roblox/WinInet',
      }
    });
    
    const data = await response.json();
    if (!data.id) {
      showError('Failed to get user info. Are you logged in to Roblox?');
      return;
    }
    
    const userId = data.id;
    const userName = data.name;
    
    // Update username
    document.getElementById('username').textContent = userName;
    
    // Fetch avatar in parallel
    const avatarPromise = fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`)
      .then(res => res.json())
      .then(avatarData => {
        if (avatarData.data && avatarData.data.length > 0) {
          document.getElementById('userAvatar').src = avatarData.data[0].imageUrl;
        }
      });
    
    // Fetch follower count in parallel
    const followerPromise = fetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`)
      .then(res => res.json())
      .then(followerData => {
        const followerCount = followerData.count;
        document.getElementById('followerCount').textContent = `${followerCount.toLocaleString()} followers`;
      });
    
    // Wait for both to complete
    await Promise.all([avatarPromise, followerPromise]);
    
  } catch (error) {
    console.error('Error fetching user info:', error);
    showError('Failed to load user information');
  }
};

// Request Place ID from content script
const requestPlaceIdFromContentScript = () => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        showError('No active tab found. Please navigate to a Roblox game page.');
        resolve(null);
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getPlaceId' }, (response) => {
        if (chrome.runtime.lastError) {
          showError('Content script not loaded. Make sure you are on a Roblox game page.');
          resolve(null);
          return;
        }
        
        if (!response || !response.placeId) {
          showError('Failed to get Place ID. Are you on a Roblox game page?');
          resolve(null);
          return;
        }
        
        resolve(response.placeId);
      });
    });
  });
};

// Fetch servers from Roblox API
const fetchServers = async (placeId, robloxSecurityCookie, pageCursor = null) => {
  const apiUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?excludeFullGames=true&limit=${state.serversPerPage}&cursor=${pageCursor || ''}`;
  
  try {
    showLoading(true);
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `.ROBLOSECURITY=${robloxSecurityCookie}`,
        'User-Agent': 'Roblox/WinInet',
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        showError('Rate limited by Roblox. Retrying in 3 seconds...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        return fetchServers(placeId, robloxSecurityCookie, pageCursor);
      }
      throw new Error(`Failed to fetch server details: ${response.status}`);
    }

    const serverData = await response.json();
    state.cursor = serverData.nextPageCursor || null;
    
    if (state.cursor) {
      cache.cursorHistory[state.currentPage + 1] = state.cursor;
    }
    
    return serverData.data;
  } catch (error) {
    console.error('Error fetching servers:', error);
    showError(`Error fetching servers: ${error.message}`);
    return [];
  } finally {
    showLoading(false);
  }
};

// Setup User-Agent headers for join requests
const setupUserAgentForJoinRequest = async () => {
  if (!state.userAgentSwitcherEnabled) {
    state.userAgentSwitcherEnabled = true;

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [9010],
      addRules: [{
        action: {
          type: "modifyHeaders",
          requestHeaders: [{
            header: "User-Agent",
            operation: "set",
            value: "Roblox/WinInet"
          }]
        },
        condition: {
          requestMethods: ["post"],
          urlFilter: "https://gamejoin.roblox.com/v1/join-game-instance",
          domains: [chrome.runtime.id]
        },
        id: 9010
      }]
    });

    clearTimeout(state.userAgentSwitcherTimeout);

    state.userAgentSwitcherTimeout = setTimeout(() => {
      state.userAgentSwitcherEnabled = false;

      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [9010]
      });
    }, 5000); // Reset after 5 seconds
  }
};

// Get server details including IP and geolocation
const getServerDetails = async (info, robloxSecurityCookie) => {
  const serverId = info.id;

  if (!serverId) {
    console.error(`Server ID is missing, skipping this server`);
    return null;
  }

  const cacheKey = serverId;
  const currentTime = Date.now();

  // Check cache
  if (cache.servers[cacheKey] && 
      (currentTime - cache.servers[cacheKey].timestamp) <= 300000) { // 5 minutes
    return cache.servers[cacheKey].data;
  }

  let ip = info.ip || 'Unknown';
  let geoData = null;

  // Fetch the server IP if not available
  if (!ip || ip === 'Unknown') {
    try {
      await setupUserAgentForJoinRequest();

      const res = await fetch(`https://gamejoin.roblox.com/v1/join-game-instance`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `.ROBLOSECURITY=${robloxSecurityCookie}; SameSite=None; Secure`,
          "User-Agent": "Roblox/WinInet"
        },
        body: JSON.stringify({
          placeId: info.placeId,
          gameId: serverId
        })
      });

      const json = await res.json();
      ip = json?.joinScript?.UdmuxEndpoints?.[0]?.Address ?? json?.joinScript?.MachineAddress;

      if (!ip) {
        const errorMessages = {
          22: "Server is full",
          12: "You do not have access to this place",
        };
        const errorMsg = errorMessages[json.status] || `Unknown status ${json.status}`;
        console.error(`Unable to fetch server location: ${errorMsg}`);
        return null;
      }

      // Lookup location based on IP
      const ipBase = ip.replace(/^(128\.116\.\d+)\.\d+$/, "$1.0");
      const location = state.serverRegionsByIp[ipBase];

      if (!location) {
        console.error(`Unknown server address ${ip}`);
        return null;
      }

      geoData = location;
    } catch (error) {
      console.error('Error fetching server IP:', error);
      return null;
    }
  }

  const serverDetails = {
    ...info,
    ip,
    geoData
  };

  // Update cache
  cache.servers[cacheKey] = {
    data: serverDetails,
    timestamp: currentTime
  };

  return serverDetails;
};

// Fetch and display servers
const fetchAndDisplayServers = async () => {
  try {
    showLoading(true);
    
    // Reset server list
    const serverListElement = document.getElementById('serverList');
    serverListElement.innerHTML = '';
    
    // Update UI to show current page
    document.getElementById('currentPage').textContent = state.currentPage;
    
    // Get PlaceID
    const placeId = await requestPlaceIdFromContentScript();
    if (!placeId) return;
    
    // Get security cookie
    let robloxSecurityCookie;
    try {
      robloxSecurityCookie = await getRobloxSecurityCookie();
    } catch (error) {
      showError('Failed to get Roblox security cookie. Are you logged in?');
      return;
    }

    // Fetch servers
    const servers = await fetchServers(placeId, robloxSecurityCookie, state.cursor);
    
    // Process servers in batches
    const batchSize = 10;
    const batches = Math.ceil(servers.length / batchSize);
    
    for (let i = 0; i < batches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, servers.length);
      const batch = servers.slice(start, end);
      
      await Promise.all(batch.map(async (server) => {
        try {
          const serverDetails = await getServerDetails({
            ...server,
            placeId
          }, robloxSecurityCookie);
          
          if (serverDetails) {
            displayServer(serverDetails);
          }
        } catch (error) {
          console.error('Error processing server:', error);
        }
      }));
      
      // Small delay between batches for UI responsiveness
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Apply current filter if set
    if (state.currentFilter !== null) {
      filterServersByRegion(state.currentFilter);
    }

    // Update pagination buttons
    document.getElementById('prevPage').disabled = state.currentPage === 1;
    document.getElementById('nextPage').disabled = state.cursor === null;
    
    // Show empty state if no servers found
    if (servers.length === 0) {
      showEmptyState('No servers found for this game.');
    }
    
  } catch (error) {
    console.error('Error fetching or displaying servers:', error);
    showError(`Failed to load servers: ${error.message}`);
  } finally {
    showLoading(false);
  }
};

// Display a server in the UI
const displayServer = (server) => {
  if (!server.id) {
    console.warn('Server ID is undefined, skipping this server.');
    return;
  }

  const serverListElement = document.getElementById('serverList');
  if (!serverListElement) {
    console.error('serverList element not found');
    return;
  }

  // Check if this server already exists
  const existingServerCard = document.querySelector(`.server-card[data-server-id="${server.id}"]`);
  if (existingServerCard) {
    return; // Don't duplicate cards
  }

  // Players text
  const playersText = server.playing !== undefined && server.maxPlayers !== undefined 
    ? `${server.playing}/${server.maxPlayers}`
    : '0/0';
    
  // Calculate player percentage for progress bar
  const playerPercentage = server.maxPlayers ? (server.playing / server.maxPlayers) * 100 : 0;
  const playerProgressColor = playerPercentage > 80 ? 'bg-danger' : 
                              playerPercentage > 50 ? 'bg-warning' : 'bg-success';

  // Location info
  let locationText = 'Unknown Location';
  let regionClass = '';

  if (server.geoData) {
    const city = server.geoData.city || 'Unknown City';
    const region = server.geoData.region?.name || 'Unknown Region';
    const country = server.geoData.country?.name || 'Unknown Country';
    locationText = `${city}, ${region}, ${country}`;
    regionClass = `region-${server.geoData.country?.code || 'unknown'}`.toLowerCase();
  }

  const ip = server.ip || 'Unknown IP';
  const ping = server.ping !== undefined ? `${server.ping} ms` : 'N/A';
  const fps = server.fps !== undefined ? server.fps : 'N/A';

  // Create server card element
  const serverCard = document.createElement('div');
  serverCard.className = `server-card ${regionClass}`;
  serverCard.setAttribute('data-server-id', server.id);
  
  // Build card HTML
  serverCard.innerHTML = `
    <div class="server-card-body">
      <div class="server-info">
        ${displaySettings.showServerId ? `
          <div class="info-item server-id">
            <span class="info-label"><i class="fas fa-hashtag"></i></span>
            <span class="info-value">${server.id}</span>
          </div>
        ` : ''}
        
        ${displaySettings.showPlayers ? `
          <div class="info-item players">
            <span class="info-label"><i class="fas fa-users"></i></span>
            <span class="info-value">${playersText}</span>
            <div class="progress">
              <div class="progress-bar ${playerProgressColor}" style="width: ${playerPercentage}%"></div>
            </div>
          </div>
        ` : ''}
        
        ${displaySettings.showFPS ? `
          <div class="info-item fps">
            <span class="info-label"><i class="fas fa-tachometer-alt"></i></span>
            <span class="info-value">${fps}</span>
          </div>
        ` : ''}
        
        ${displaySettings.showPing ? `
          <div class="info-item ping">
            <span class="info-label"><i class="fas fa-broadcast-tower"></i></span>
            <span class="info-value">${ping}</span>
          </div>
        ` : ''}
        
        ${displaySettings.showIP ? `
          <div class="info-item ip">
            <span class="info-label"><i class="fas fa-network-wired"></i></span>
            <span class="info-value">${ip}</span>
          </div>
        ` : ''}
        
        ${displaySettings.showLocation ? `
          <div class="info-item location">
            <span class="info-label"><i class="fas fa-map-marker-alt"></i></span>
            <span class="info-value">${locationText}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="server-actions">
        <button class="join-btn">Join Server</button>
      </div>
    </div>
  `;

  // Add server card to the list
  serverListElement.appendChild(serverCard);

  // Add event listener for join button
  const joinButton = serverCard.querySelector('.join-btn');
  joinButton.addEventListener('click', async () => {
    showLoading(true, 'Joining server...');
    await joinServer(server.placeId, server.id);
    setTimeout(() => showLoading(false), 2000);
  });
};

// Join a Roblox server
const joinServer = async (placeId, serverId) => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tabId = tabs[0].id;
        chrome.runtime.sendMessage({
          action: 'joinServer',
          serverId: serverId,
          placeId: placeId,
          tabId: tabId
        }, () => {
          showToast('Joining server...');
          resolve();
        });
      } else {
        console.error('No active tab found.');
        showError('No active tab found.');
        resolve();
      }
    });
  });
};

// Join a random server from available servers
const joinRandomServer = async () => {
  try {
    const loadingMessage = displaySettings.joinLowServers 
      ? 'Finding low population server...' 
      : 'Finding a random server...';
    
    showLoading(true, loadingMessage);
    
    // Get PlaceID
    const placeId = await requestPlaceIdFromContentScript();
    if (!placeId) {
      showLoading(false);
      return;
    }
    
    // Get security cookie
    let robloxSecurityCookie;
    try {
      robloxSecurityCookie = await getRobloxSecurityCookie();
    } catch (error) {
      showError('Failed to get Roblox security cookie. Are you logged in?');
      showLoading(false);
      return;
    }

    let tempCursor = null;
    let eligibleServers = [];
    let currentTime = Date.now();
    let attemptsRemaining = 5; // Maximum pages to check
    let currentPageNumber = 1;
    
    // Determine target page for low population servers
    // For random servers, we'll still use any page
    let targetPage = displaySettings.joinLowServers ? 3 : 1;
    
    // Always use Asc for sorting by player count (lowest first)
    const sortOrder = 'Asc';
    
    while (attemptsRemaining > 0) {
      showLoading(true, `Finding servers (page ${currentPageNumber}/5)...`);
      
      const apiUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?excludeFullGames=true&limit=${state.serversPerPage}&sortOrder=${sortOrder}&cursor=${tempCursor || ''}`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `.ROBLOSECURITY=${robloxSecurityCookie}`,
          'User-Agent': 'Roblox/WinInet',
        }
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          showError('Rate limited by Roblox. Waiting...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue; // Try again
        }
        throw new Error(`Failed to fetch servers: ${response.status}`);
      }
      
      const serverData = await response.json();
      const servers = serverData.data || [];
      
      tempCursor = serverData.nextPageCursor;
      
      if (servers.length === 0 || !tempCursor) {
        // If we can't go to the target page, use what we've got
        if (displaySettings.joinLowServers && eligibleServers.length > 0) {
          break;
        }
        attemptsRemaining = 0;
        continue;
      }
      
      // Filter out recently joined servers
      const pageServers = [];
      for (const server of servers) {
        const serverId = server.id;
        const recentJoin = cache.recentlyJoinedServers[serverId];
        
        if (!recentJoin || (currentTime - recentJoin.timestamp > 10 * 60 * 1000)) {
          pageServers.push({
            ...server,
            placeId
          });
        }
      }
      
      // For low population servers, we want to go to target page before selecting
      if (displaySettings.joinLowServers) {
        // If we've reached our target page, use these servers
        if (currentPageNumber >= targetPage || !tempCursor) {
          eligibleServers = pageServers;
          break;
        }
      } else {
        // For random servers, collect from all pages
        eligibleServers = [...eligibleServers, ...pageServers];
      }
      
      currentPageNumber++;
      attemptsRemaining--;
      
      // If we don't have a next cursor, we can't go further
      if (!tempCursor) {
        break;
      }
    }
    
    if (eligibleServers.length === 0) {
      showError(`No available servers found. Try again later.`);
      showLoading(false);
      return;
    }
    
    let selectedServer;
    
    if (displaySettings.joinLowServers) {
      // Select server with lowest player count from target page
      eligibleServers.sort((a, b) => a.playing - b.playing);
      selectedServer = eligibleServers[0];
      showToast(`Joining low population server from page ${currentPageNumber}...`);
    } else {
      // Select random server
      const randomIndex = Math.floor(Math.random() * eligibleServers.length);
      selectedServer = eligibleServers[randomIndex];
      showToast('Joining random server...');
    }
    
    // Add to recently joined servers
    addToRecentlyJoinedServers(selectedServer.id);
    
    // Join the selected server
    showLoading(true, 'Joining server...');
    await joinServer(placeId, selectedServer.id);
    
    // Set cooldown
    state.randomJoinCooldown = true;
    setTimeout(() => {
      state.randomJoinCooldown = false;
    }, 3000);
    
  } catch (error) {
    console.error('Error joining server:', error);
    showError(`Failed to join server: ${error.message}`);
  } finally {
    setTimeout(() => showLoading(false), 2000);
  }
};

// Add server to recently joined servers
const addToRecentlyJoinedServers = (serverId) => {
  const currentTime = Date.now();
  const expiryTime = currentTime + (10 * 60 * 1000); // 10 minutes
  
  cache.recentlyJoinedServers[serverId] = {
    timestamp: currentTime,
    expiry: expiryTime
  };
  
  // Save to local storage
  chrome.storage.local.set({ recentlyJoinedServers: cache.recentlyJoinedServers });
  
  // Update table if visible
  if (state.showRecentlyJoined) {
    updateRecentlyJoinedTable();
  }
};

// Load recently joined servers from storage
const loadRecentlyJoinedServers = async () => {
  return new Promise(resolve => {
    chrome.storage.local.get('recentlyJoinedServers', (data) => {
      if (data.recentlyJoinedServers) {
        cache.recentlyJoinedServers = data.recentlyJoinedServers;
      }
      
      // Clean expired entries
      cleanupRecentlyJoinedServers();
      
      resolve();
    });
  });
};

// Toggle the recently joined servers table
const toggleRecentlyJoinedTable = () => {
  const tableContainer = document.getElementById('recentlyJoinedServers');
  
  if (state.showRecentlyJoined) {
    tableContainer.classList.add('hidden');
    state.showRecentlyJoined = false;
  } else {
    updateRecentlyJoinedTable();
    tableContainer.classList.remove('hidden');
    state.showRecentlyJoined = true;
  }
};

// Update the recently joined servers table
const updateRecentlyJoinedTable = () => {
  const tableBody = document.querySelector('#recentServersTable tbody');
  tableBody.innerHTML = '';
  
  const currentTime = Date.now();
  
  // Sort by most recently joined
  const sortedServers = Object.entries(cache.recentlyJoinedServers)
    .sort(([, a], [, b]) => b.timestamp - a.timestamp);
  
  sortedServers.forEach(([serverId, joinInfo]) => {
    const row = document.createElement('tr');
    
    // Calculate time remaining
    const timeRemaining = Math.max(0, Math.floor((joinInfo.expiry - currentTime) / 1000));
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const timeRemainingText = `${minutes}m ${seconds}s`;
    
    // Format join time
    const joinDate = new Date(joinInfo.timestamp);
    const joinTimeText = joinDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    row.innerHTML = `
      <td>${serverId}</td>
      <td>${joinTimeText}</td>
      <td>${timeRemainingText}</td>
    `;
    
    tableBody.appendChild(row);
  });
  
  // Show message if no recently joined servers
  if (sortedServers.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3" style="text-align: center;">No recently joined servers</td>';
    tableBody.appendChild(row);
  }
};

// Clean up expired entries in recently joined servers
const cleanupRecentlyJoinedServers = () => {
  const currentTime = Date.now();
  let hasChanges = false;
  
  Object.keys(cache.recentlyJoinedServers).forEach(serverId => {
    const joinInfo = cache.recentlyJoinedServers[serverId];
    
    // Remove if expired (older than 10 minutes)
    if (currentTime > joinInfo.expiry) {
      delete cache.recentlyJoinedServers[serverId];
      hasChanges = true;
    }
  });
  
  // Save changes if any entries were removed
  if (hasChanges) {
    chrome.storage.local.set({ recentlyJoinedServers: cache.recentlyJoinedServers });
    
    if (state.showRecentlyJoined) {
      updateRecentlyJoinedTable();
    }
  }
};

// Fetch friends list from Roblox API
const fetchFriendsList = async (userId, robloxSecurityCookie) => {
  try {
    const response = await fetch(`https://friends.roblox.com/v1/users/${userId}/friends`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `.ROBLOSECURITY=${robloxSecurityCookie}`,
        'User-Agent': 'Roblox/WinInet',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch friends: ${response.status}`);
    }

    const friendsData = await response.json();
    return friendsData.data || [];
  } catch (error) {
    console.error('Error fetching friends list:', error);
    showError(`Error fetching friends list: ${error.message}`);
    return [];
  }
};

// Fetch presence data for users
const fetchUserPresence = async (userIds, robloxSecurityCookie) => {
  try {
    const response = await fetch('https://presence.roblox.com/v1/presence/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `.ROBLOSECURITY=${robloxSecurityCookie}`,
        'User-Agent': 'Roblox/WinInet',
      },
      body: JSON.stringify({
        userIds: userIds
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch presence data: ${response.status}`);
    }

    const presenceData = await response.json();
    return presenceData.userPresences || [];
  } catch (error) {
    console.error('Error fetching presence data:', error);
    showError(`Error fetching presence data: ${error.message}`);
    return [];
  }
};

// Find friends playing current game
const findFriendsPlayingGame = async (placeId) => {
  try {
    showLoading(true, 'Finding friends...');
    
    // Get user ID and security cookie
    const robloxSecurityCookie = await getRobloxSecurityCookie();
    const userResponse = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        'Cookie': `.ROBLOSECURITY=${robloxSecurityCookie}`,
        'User-Agent': 'Roblox/WinInet',
      }
    });
    
    const userData = await userResponse.json();
    const userId = userData.id;
    
    if (!userId) {
      showError('Failed to get user info. Are you logged in to Roblox?');
      return [];
    }
    
    // Fetch friends list
    const friends = await fetchFriendsList(userId, robloxSecurityCookie);
    
    if (friends.length === 0) {
      return [];
    }
    
    // Extract friend IDs
    const friendIds = friends.map(friend => friend.id);
    
    // Cache friends data
    friends.forEach(friend => {
      cache.friends[friend.id] = friend;
    });
    
    // Fetch presence data
    const presenceData = await fetchUserPresence(friendIds, robloxSecurityCookie);
    
    // Filter online friends
    const onlineFriends = presenceData.filter(presence => presence.userPresenceType !== 0);
    cache.onlineFriends = onlineFriends;
    
    // Filter friends playing this game
    const friendsPlaying = onlineFriends.filter(presence => {
      return presence.placeId === parseInt(placeId) && presence.gameId;
    });
    
    // Reset the cache
    cache.friendsPlaying = {};
    
    // Create Map for unique entries
    const uniqueFriendsMap = new Map();
    
    // Create detailed info for each friend
    friendsPlaying.forEach(presence => {
      const friendId = presence.userId;
      const friend = cache.friends[friendId];
      
      if (friend && !uniqueFriendsMap.has(friendId)) {
        const friendData = {
          id: friendId,
          name: friend.name,
          displayName: friend.displayName,
          serverId: presence.gameId,
          placeId: presence.placeId,
          lastLocation: presence.lastLocation,
          avatarUrl: friend.profilePictureUrl,
          presence: presence
        };
        
        uniqueFriendsMap.set(friendId, friendData);
        cache.friendsPlaying[friendId] = friendData;
      }
    });
    
    return Array.from(uniqueFriendsMap.values());
  } catch (error) {
    console.error('Error finding friends playing game:', error);
    showError(`Error finding friends: ${error.message}`);
    return [];
  } finally {
    showLoading(false);
  }
};

// Display friends playing current game
const displayFriendsPlaying = async () => {
  const friendsListElement = document.getElementById('friendsList');
  
  // Clear existing friend cards
  friendsListElement.innerHTML = '';
  
  const emptyState = document.getElementById('emptyFriendsState');
  
  // Get PlaceID
  const placeId = await requestPlaceIdFromContentScript();
  if (!placeId) return;
  
  // Find friends playing this game
  const friendsPlaying = await findFriendsPlayingGame(placeId);
  
  if (!friendsPlaying || friendsPlaying.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  
  emptyState.classList.add('hidden');
  
  // Display each friend
  friendsPlaying.forEach(friend => {
    const friendCard = document.createElement('div');
    friendCard.className = 'friend-card';
    friendCard.setAttribute('data-friend-id', friend.id);
    
    // Create avatar img
    const avatarImg = document.createElement('img');
    if (friend.avatarUrl) {
      avatarImg.src = friend.avatarUrl;
    } else {
      // Fetch avatar if not available
      fetchFriendAvatar(friend.id).then(url => {
        if (url) avatarImg.src = url;
      });
    }
    
    // Set server ID for joining
    friendCard.setAttribute('data-server-id', friend.serverId);
    friendCard.setAttribute('data-place-id', friend.placeId);
    
    // Build card HTML
    friendCard.innerHTML = `
      <div class="friend-avatar">
        <!-- Avatar will be set dynamically -->
      </div>
      <div class="friend-info">
        <div class="friend-name">${friend.displayName || friend.name}</div>
        <div class="friend-status">Playing right now</div>
        <div class="friend-server">
          Server: <span class="friend-server-id">${friend.serverId}</span>
        </div>
        <button class="join-friend-btn">Join Friend</button>
      </div>
    `;
    
    // Add avatar image
    const avatarContainer = friendCard.querySelector('.friend-avatar');
    avatarContainer.appendChild(avatarImg);
    
    // Add friend card to list
    friendsListElement.appendChild(friendCard);
  });
  
  // Add event listeners to join buttons
  document.querySelectorAll('.join-friend-btn').forEach(button => {
    // Clone to remove existing listeners
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    newButton.addEventListener('click', () => {
      const card = newButton.closest('.friend-card');
      const serverId = card.getAttribute('data-server-id');
      const placeId = card.getAttribute('data-place-id');
      
      joinServer(placeId, serverId);
      
      // Add to recently joined servers
      addToRecentlyJoinedServers(serverId);
    });
  });
};

// Fetch avatar URL for a friend
const fetchFriendAvatar = async (userId) => {
  try {
    const response = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const avatarUrl = data.data[0].imageUrl;
      
      // Update cache
      if (cache.friends[userId]) {
        cache.friends[userId].profilePictureUrl = avatarUrl;
      }
      
      if (cache.friendsPlaying[userId]) {
        cache.friendsPlaying[userId].avatarUrl = avatarUrl;
      }
      
      return avatarUrl;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching avatar for user ${userId}:`, error);
    return null;
  }
};

// Filter servers by region
const filterServersByRegion = (selectedRegion) => {
  state.currentFilter = selectedRegion;
  const serverItems = document.querySelectorAll('.server-card');
  let visibleCount = 0;
  
  serverItems.forEach(item => {
    const locationElement = item.querySelector('.location .info-value');
    if (locationElement) {
      const serverRegion = locationElement.textContent;
      const visible = selectedRegion === null || serverRegion.includes(selectedRegion);
      
      item.style.display = visible ? 'block' : 'none';
      if (visible) visibleCount++;
    }
  });

  // Update filter button appearance
  const filterBtn = document.getElementById('serverFilterBtn');
  if (selectedRegion === null) {
    filterBtn.classList.remove('active-filter');
    filterBtn.innerHTML = `<i class="fas fa-filter"></i>`;
  } else {
    filterBtn.classList.add('active-filter');
    const displayRegion = selectedRegion.split(',')[0].trim();
    const shortRegion = displayRegion.length > 15 ? displayRegion.substring(0, 15) + '...' : displayRegion;
    filterBtn.innerHTML = `<i class="fas fa-filter"></i> ${shortRegion}`;
  }

  // Close dropdown
  document.getElementById('serverFilterDropdown').style.display = 'none';
  
  // Show empty state if no servers match filter
  if (visibleCount === 0 && serverItems.length > 0) {
    showEmptyState(`No servers match the filter "${selectedRegion}"`);
  } else {
    hideEmptyState();
  }
};

// Populate server region filter dropdown
const populateServerRegions = () => {
  const dropdown = document.getElementById('serverFilterDropdown');
  dropdown.innerHTML = ''; // Clear previous options

  const uniqueRegions = new Set();

  // Collect unique regions
  for (const region of Object.values(state.serverRegionsByIp)) {
    if (!region.city || !region.country?.name) continue;
    
    const regionString = `${region.city}, ${region.region?.name || ''}, ${region.country.name}`.replace(/, ,/g, ',');
    uniqueRegions.add(regionString.trim());
  }

  // Add regions from visible servers
  document.querySelectorAll('.server-card .location .info-value').forEach(el => {
    if (el.textContent) {
      uniqueRegions.add(el.textContent.trim());
    }
  });
  
  // Sort alphabetically
  const sortedRegions = Array.from(uniqueRegions)
    .filter(r => r.length > 5) // Filter out empty/short regions
    .sort();

  // Add "All Regions" option
  const allRegionsOption = document.createElement('a');
  allRegionsOption.href = '#';
  allRegionsOption.className = 'dropdown-item';
  allRegionsOption.innerHTML = '<i class="fas fa-globe"></i> All Regions';
  allRegionsOption.addEventListener('click', (e) => {
    e.preventDefault();
    filterServersByRegion(null);
  });
  dropdown.appendChild(allRegionsOption);
  
  // Add separator
  const separator = document.createElement('div');
  separator.className = 'dropdown-divider';
  dropdown.appendChild(separator);

  // Add each region
  sortedRegions.forEach(regionString => {
    const option = document.createElement('a');
    option.href = '#';
    option.className = 'dropdown-item';
    option.innerHTML = `<i class="fas fa-map-marker-alt"></i> ${regionString}`;
    option.addEventListener('click', (e) => {
      e.preventDefault();
      filterServersByRegion(regionString);
    });
    dropdown.appendChild(option);
  });
};

// Show loading indicator
const showLoading = (show, message = 'Loading...') => {
  const loader = document.getElementById('loader');
  const loaderText = document.getElementById('loaderText');
  
  if (show) {
    loaderText.textContent = message;
    loader.style.display = 'flex';
  } else {
    loader.style.display = 'none';
  }
};

// Show empty state
const showEmptyState = (message) => {
  const emptyState = document.getElementById('emptyState');
  const emptyStateMessage = document.getElementById('emptyStateMessage');
  
  emptyStateMessage.textContent = message;
  emptyState.style.display = 'flex';
};

// Hide empty state
const hideEmptyState = () => {
  const emptyState = document.getElementById('emptyState');
  emptyState.style.display = 'none';
};

// Show error message
const showError = (message) => {
  const errorElement = document.getElementById('errorMessage');
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  
  setTimeout(() => {
    errorElement.style.display = 'none';
  }, 5000);
};

// Show toast notification
const showToast = (message) => {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  
  toastMessage.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
};

// Switch between tabs
const switchTab = (tabName) => {
  const tabs = ['servers', 'friends', 'settings'];
  
  tabs.forEach(tab => {
    const tabEl = document.getElementById(`${tab}Tab`);
    const contentEl = document.getElementById(`${tab}Content`);
    
    if (tab === tabName) {
      tabEl.classList.add('active');
      contentEl.style.display = 'block';
      
      // Refresh content when switching to tab
      if (tab === 'servers') {
        fetchAndDisplayServers();
      } else if (tab === 'friends') {
        // Clear the friends list
        const friendsListElement = document.getElementById('friendsList');
        if (friendsListElement) {
          friendsListElement.innerHTML = '';
        }
        displayFriendsPlaying();
      }
    } else {
      tabEl.classList.remove('active');
      contentEl.style.display = 'none';
    }
  });
};

// Set up all event listeners
const setupEventListeners = () => {
  // Tab switching
  document.getElementById('serversTab')?.addEventListener('click', () => switchTab('servers'));
  document.getElementById('settingsTab')?.addEventListener('click', () => switchTab('settings'));
  
  // Fix for friendsTab
  const friendsTab = document.getElementById('friendsTab');
  if (friendsTab) {
    const newFriendsTab = friendsTab.cloneNode(true);
    friendsTab.parentNode.replaceChild(newFriendsTab, friendsTab);
    newFriendsTab.addEventListener('click', () => switchTab('friends'));
  }
  
  // Server filter button
  document.getElementById('serverFilterBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('serverFilterDropdown');
    
    if (dropdown.style.display === 'none' || !dropdown.style.display) {
      populateServerRegions();
      dropdown.style.display = 'block';
    } else {
      dropdown.style.display = 'none';
    }
  });
  
  // Pagination
  document.getElementById('nextPage')?.addEventListener('click', () => {
    if (state.cursor) {
      state.currentPage++;
      fetchAndDisplayServers();
    }
  });
  
  document.getElementById('prevPage')?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      state.cursor = cache.cursorHistory[state.currentPage] || null;
      fetchAndDisplayServers();
    }
  });
  
  // Settings changes
  document.getElementById('settingsForm')?.addEventListener('change', (event) => {
    const setting = event.target.name;
    if (event.target.type === 'checkbox') {
      displaySettings[setting] = event.target.checked;
    } else if (event.target.type === 'number') {
      displaySettings[setting] = parseInt(event.target.value, 10);
    }
    saveSettings();
  });
  
  // Refresh button
  document.getElementById('refreshBtn')?.addEventListener('click', () => fetchAndDisplayServers());
  
  // Random join button
  const randomJoinBtn = document.getElementById('randomJoinBtn');
  if (randomJoinBtn) {
    randomJoinBtn.addEventListener('click', () => {
      if (!state.randomJoinCooldown) {
        joinRandomServer();
      }
    });
    
    // Right-click to show recently joined servers
    randomJoinBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggleRecentlyJoinedTable();
    });
  }
  
  // Close button for recently joined servers
  document.getElementById('closeRecentServers')?.addEventListener('click', () => {
    document.getElementById('recentlyJoinedServers').classList.add('hidden');
    state.showRecentlyJoined = false;
  });
  
  // Refresh friends button
  const refreshFriendsBtn = document.getElementById('refreshFriendsBtn');
  if (refreshFriendsBtn) {
    const newRefreshBtn = refreshFriendsBtn.cloneNode(true);
    refreshFriendsBtn.parentNode.replaceChild(newRefreshBtn, refreshFriendsBtn);
    newRefreshBtn.addEventListener('click', () => displayFriendsPlaying());
  }
  
  // Close dropdowns when clicking outside
  window.addEventListener('click', (event) => {
    const serverFilterDropdown = document.getElementById('serverFilterDropdown');
    if (serverFilterDropdown && !event.target.matches('#serverFilterBtn') && 
        !event.target.closest('#serverFilterDropdown')) {
      serverFilterDropdown.style.display = 'none';
    }
  });
  
  // Toast close button
  document.querySelector('.toast-close')?.addEventListener('click', () => {
    document.getElementById('toast').classList.remove('show');
  });
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  showLoading(true, 'Loading extension...');
  
  try {
    // Load everything in parallel
    await Promise.all([
      loadSettings(),
      loadServerRegions(),
      loadRecentlyJoinedServers()
    ]);
    
    // Load user info
    await loadUserInfo();
    
    // Set up event listeners
    setupEventListeners();
    
    // Clean up expired entries every minute
    setInterval(cleanupRecentlyJoinedServers, 60000);
    
    // Initial server fetch
    await fetchAndDisplayServers();
    
  } catch (error) {
    console.error('Error initializing extension:', error);
    showError(`Failed to initialize extension: ${error.message}`);
  } finally {
    showLoading(false);
  }
});