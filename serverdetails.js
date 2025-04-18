
"use strict";

async function fetchServerDetails(placeId) {
    const robloxSecurityCookie = await getRobloxSecurityCookie();
    const apiUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public?sortOrder=Asc&limit=100`;
    
    const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `.ROBLOSECURITY=${robloxSecurityCookie}`,
            'User-Agent': 'Roblox/WinInet'
        }
    });

    if (!response.ok) {
        throw new Error('Failed to fetch server details');
    }

    const serverData = await response.json();
    return serverData.data.map(server => ({
        id: server.id,
        ip: server.machineAddress,
        port: server.serverPort,
        dataCenterId: server.dataCenterId,
        maxPlayers: server.maxPlayers,
        playing: server.playing,
    }));
}

function displayServers(servers) {
    const serverListElement = document.getElementById('serverList');
    serverListElement.innerHTML = '';
    
    servers.forEach(server => {
        const serverItem = document.createElement('div');
        serverItem.className = 'server-item';
        serverItem.innerHTML = `
            <p>Server ID: ${server.id}</p>
            <p>IP Address: ${server.ip}</p>
            <p>Port: ${server.port}</p>
            <p>Data Center ID: ${server.dataCenterId}</p>
            <p>Players: ${server.playing}/${server.maxPlayers}</p>
        `;
        serverListElement.appendChild(serverItem);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const placeId = await requestPlaceIdFromContentScript();
        const servers = await fetchServerDetails(placeId);
        displayServers(servers);
    } catch (error) {
        console.error('Error fetching or displaying servers:', error);
    }
});
