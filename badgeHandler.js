(async function() {
	function formatNumber(n) { return n?.toLocaleString?.() || n || ""; }
	function formatDate(dateString) {
		if (!dateString) return "";
		const date = new Date(dateString);
		return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
	}
	async function getCurrentUserId() {
		let meta = document.querySelector('meta[name="user-data"]');
		if (meta) {
			try { return JSON.parse(meta.content).userId; } catch {}
		}
		let r = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include" });
		let data = await r.json();
		return data.id;
	}
	async function getUniverseIdFromPlaceId(placeId) {
		let res = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
		let json = await res.json();
		return json.universeId;
	}
	async function fetchBadges(universeId, cursor = null) {
		let url = `https://badges.roblox.com/v1/universes/${universeId}/badges?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
		let r = await fetch(url);
		let json = await r.json();
		return json;
	}
    async function fetchOwnedBadgeIds(userId, universeId, cursor = null, owned = new Set()) {
        try {
            let url = `https://badges.roblox.com/v1/users/${userId}/badges?universeId=${universeId}&limit=100${cursor ? `&cursor=${cursor}` : ''}`;
            let r = await fetch(url, { credentials: "include" });
            if (!r.ok) {
                console.warn(`Failed to fetch owned badges: ${r.status} ${r.statusText}`);
                return owned;
            }
            let json = await r.json();
            for (const badge of json.data || []) {
                owned.add(Number(badge.id));
            }
            if (json.nextPageCursor) {
                return fetchOwnedBadgeIds(userId, universeId, json.nextPageCursor, owned);
            }
        } catch (err) {
            console.error("Error fetching owned badges:", err);
        }
        return owned;
    }
	async function fetchBadgeIcons(badgeList) {
		if (!badgeList.length) return {};
		const badgeIds = badgeList.map(b => b.id).join(',');
		const url = `https://thumbnails.roblox.com/v1/badges/icons?badgeIds=${badgeIds}&size=150x150&format=Png`;
		const r = await fetch(url);
		const json = await r.json();
		let map = {};
		for (const data of (json.data || [])) {
			if (data && typeof data.targetId !== "undefined" && data.imageUrl) {
				map[data.targetId.toString()] = data.imageUrl;
			}
		}
		return map;
	}
	function renderBadgeCard(badge, iconUrl, owned, awardedDate, uniqueId) {
		return `
			<div class="badge-modern${owned ? " owned" : " locked"}" data-badge-id="${badge.id}" id="${uniqueId || ''}">
				<div class="badge-icon">
					<img src="${iconUrl}" alt="Badge Icon" style="width:100%;height:100%;object-fit:cover;border-radius:12px;display:block;">
				</div>
				<div class="badge-info">
					<div class="badge-name">${badge.name}${owned ? '<span class="badge-owned-label">Owned</span>' : ""}</div>
					<div class="badge-desc">${badge.description || ""}</div>
					<div class="badge-stats">
						<span><span class="badge-stat-label">Rarity:</span> ${badge.statistics?.winRatePercentage !== undefined ? (badge.statistics.winRatePercentage*100).toFixed(1) + "%" : "?"}</span>
						<span><span class="badge-stat-label">Won Yesterday:</span> ${formatNumber(badge.statistics?.pastDayAwardedCount)}</span>
						<span><span class="badge-stat-label">Won Ever:</span> ${formatNumber(badge.statistics?.awardedCount)}</span>
						${owned ? `<span class="badge-awarded-date">${awardedDate === "..." ? '<span style="opacity:0.4">Loading...</span>' : awardedDate ? `<span class="badge-stat-label">Awarded:</span> ${awardedDate}` : ""}</span>` : ""}
					</div>
				</div>
			</div>
		`;
	}
	function renderLoadingSpinner() {
		return `<div class="badge-modern-spinner"><div class="badge-modern-spinner-inner"></div></div>`;
	}
    async function replaceBadgesSection() {
        let badgeSection = document.querySelector('.badge-container.game-badges-list');
        if (!badgeSection) return;
        let header = badgeSection.querySelector('.container-header');
        if (!header) return;
        let placeMatch = window.location.pathname.match(/\/games\/(\d+)/);
        if (!placeMatch) return;
        let placeId = placeMatch[1];

        const renderedBadgeIds = new Set();

        let modernBadgeList = document.createElement("div");
        modernBadgeList.className = "badge-list-modern";
        badgeSection.appendChild(modernBadgeList);

        // Show spinner **before any async fetching**
        let spinnerElem = document.createElement('div');
        spinnerElem.innerHTML = renderLoadingSpinner();
        modernBadgeList.appendChild(spinnerElem.firstChild);

        // Now fetch everything else, after spinner is visible in DOM
        let userId = await getCurrentUserId();
        let universeId = await getUniverseIdFromPlaceId(placeId);
        let nextCursor = null;
        let allBadges = [];
        let seeMoreBtn = document.createElement("button");
        seeMoreBtn.type = "button";
        seeMoreBtn.className = "badge-modern-see-more";
        seeMoreBtn.innerHTML = `<span style="z-index:1;position:relative;">See More</span>`;
        seeMoreBtn.addEventListener("click", async () => {
            let existingSpinner = modernBadgeList.querySelector('.badge-modern-spinner');
            if (!existingSpinner) modernBadgeList.appendChild(createSpinnerElem());
            seeMoreBtn.disabled = true;
            await loadAndRender(nextCursor);
            seeMoreBtn.disabled = false;
        });
        let oldList = badgeSection.querySelector('.stack-list');
        if (oldList) oldList.remove();
        let anyOldSeeMore = badgeSection.querySelector('.badge-modern-see-more, .btn-control-md, .btn-full-width');
        if (anyOldSeeMore) anyOldSeeMore.remove();
        const ownedBadgeIds = await fetchOwnedBadgeIds(userId, universeId);

        function createSpinnerElem() {
            let spinner = document.createElement('div');
            spinner.innerHTML = renderLoadingSpinner();
            return spinner.firstChild;
        }

        async function loadAndRender(cursor = null) {
            let spinnerElem = modernBadgeList.querySelector('.badge-modern-spinner');
            if (!spinnerElem) {
                spinnerElem = createSpinnerElem();
                modernBadgeList.appendChild(spinnerElem);
            }

            let badgeData;
            try {
                badgeData = await fetchBadges(universeId, cursor);
            } catch (err) {
                console.error("Failed to fetch badges:", err);
                spinnerElem.remove();
                return;
            }

            let badgeList = badgeData.data || [];
            nextCursor = badgeData.nextPageCursor;

            let iconsMap = {};
            try {
                iconsMap = await fetchBadgeIcons(badgeList);
            } catch (err) {
                console.warn("Could not load badge icons:", err);
            }

            if (spinnerElem && spinnerElem.parentElement) {
                spinnerElem.remove();
            }

            for (let badge of badgeList) {
                if (renderedBadgeIds.has(badge.id)) continue;
                renderedBadgeIds.add(badge.id);
                allBadges.push(badge);

                let owned = ownedBadgeIds.has(Number(badge.id));
                let iconUrl = iconsMap[badge.id.toString()] || '';
                let uniqueId = `badge-${badge.id}`;
                modernBadgeList.insertAdjacentHTML('beforeend',
                    renderBadgeCard(badge, iconUrl, owned, owned ? "..." : null, uniqueId)
                );

                if (owned) {
                    try {
                        let r = await fetch(`https://badges.roblox.com/v1/users/${userId}/badges/${badge.id}/awarded-date`, { credentials: "include" });
                        if (r.status === 200) {
                            let data = await r.json();
                            let date = formatDate(data.awardedDate);
                            let el = document.getElementById(uniqueId);
                            if (el && date) {
                                let stat = el.querySelector('.badge-awarded-date');
                                if (stat) stat.innerHTML = `<span class="badge-stat-label">Awarded:</span> ${date}`;
                            }
                        }
                    } catch (err) {
                        console.warn(`Failed to fetch awarded date for badge ${badge.id}`, err);
                    }
                }
            }

            let existingSeeMore = modernBadgeList.querySelector('.badge-modern-see-more');
            if (existingSeeMore) existingSeeMore.remove();

            if (nextCursor) {
                modernBadgeList.appendChild(seeMoreBtn);
            } else if (seeMoreBtn.parentElement) {
                seeMoreBtn.remove();
            }
        }
        await loadAndRender();
    }

	function waitForBadgeSectionAndReplace() {
		let badgeSection = document.querySelector('.badge-container.game-badges-list');
		if (badgeSection) {
			replaceBadgesSection();
			return;
		}
		const observer = new MutationObserver(() => {
			let badgeSection = document.querySelector('.badge-container.game-badges-list');
			if (badgeSection) {
				observer.disconnect();
				replaceBadgesSection();
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}
	function observeBadgeTab() {
		let lastUrl = location.href;
		new MutationObserver(() => {
			if (location.href !== lastUrl) {
				lastUrl = location.href;
				setTimeout(waitForBadgeSectionAndReplace, 800);
			}
		}).observe(document, {subtree: true, childList: true});
	}
	waitForBadgeSectionAndReplace();
	observeBadgeTab();
})();
