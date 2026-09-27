const gamesContainer = document.querySelector('.games');
const truffledButton = document.querySelector('#truffled-button');
const cloudmoonButton = document.querySelector('#cloudmoon-button');
const localGamesButton = document.querySelector('#local-games-button');
const searchInput = document.querySelector('#game-search');
const gameViewer = document.querySelector('#game-viewer');
const gameFrame = gameViewer.querySelector('iframe');
const closeGameButton = document.querySelector('#close-game');
const gameStatus = document.querySelector('#game-status');
let availableGames = [];
let cloudMoonToken = null;
let cloudMoonLaunchId = 0;
let cloudMoonQueuedGame = null;

function renderGames(games) {
    availableGames = games;
    gamesContainer.replaceChildren();

    const query = searchInput.value.trim().toLowerCase();
    const filteredGames = availableGames.filter(game => game.name.toLowerCase().includes(query));

    for (const game of filteredGames) {
        const card = document.createElement('div');
        card.className = 'hi';

        const link = document.createElement('a');
        link.href = game.cloudMoonPackage ? '#' : game.url;
        link.target = '0';
        if (game.cloudMoonPackage) link.dataset.cloudMoonPackage = game.cloudMoonPackage;

        const image = document.createElement('img');
        image.src = game.image;
        image.alt = game.name;

        const title = document.createElement('h1');
        title.textContent = game.name;

        link.append(image, title);
        card.append(link);
        gamesContainer.append(card);
    }
}

async function loadLocalGames() {
    const response = await fetch('/games.json');
    if (!response.ok) throw new Error(`Could not load games: ${response.status}`);
    renderGames(await response.json());
}

async function loadTruffledGames() {
    truffledButton.disabled = true;

    try {
        const response = await fetch('/truffled.json');
        if (!response.ok) throw new Error(`Could not load truffled.json: ${response.status}`);

        const data = await response.json();
        if (!Array.isArray(data.games)) throw new Error('truffled.json has an unexpected format');

        renderGames(data.games.map(game => ({
            name: game.name,
            url: game.url,
            image: game.thumbnail
        })));
    } catch (error) {
        console.error('Unable to load Truffled games:', error);
        alert(`Could not load Truffled games: ${error.message}`);
    } finally {
        truffledButton.disabled = false;
    }
}

async function cloudMoonRequest(endpoint, { method = 'GET', body } = {}) {
    const url = new URL(`/${endpoint}`, 'https://api.cloudmoon.cloudbatata.com');
    url.searchParams.set('device_type', 'web');
    url.searchParams.set('query_uuid', crypto.randomUUID());
    url.searchParams.set('site', 'cm');

    let deviceId = sessionStorage.getItem('cloudmoon_device_id');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        sessionStorage.setItem('cloudmoon_device_id', deviceId);
    }
    url.searchParams.set('device_id', deviceId);

    const headers = { 'Content-Type': 'application/json' };
    if (cloudMoonToken) headers['X-User-Token'] = cloudMoonToken;
    headers['X-User-Language'] = navigator.language.split('-')[0] || 'en';
    headers['X-User-Locale'] = (navigator.language.split('-')[1] || navigator.language).toUpperCase();

    let response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (error) {
        throw new Error(`Could not reach CloudMoon directly: ${error.message}. CloudMoon may block browser requests from this site (CORS).`);
    }

    const responseText = await response.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch {
        throw new Error(`CloudMoon returned HTTP ${response.status} with a non-JSON response: ${responseText.slice(0, 120)}`);
    }
    if (!response.ok) throw new Error(data.message || `CloudMoon API request failed (${response.status})`);
    if (data.code !== undefined && Number(data.code) !== 0) {
        throw new Error(data.message || `CloudMoon API error ${data.code}`);
    }
    return data;
}

async function loadCloudMoonGames() {
    cloudmoonButton.disabled = true;

    try {
        const response = await cloudMoonRequest('game/guest_list');
        const games = response.data?.list;
        if (!Array.isArray(games)) throw new Error('CloudMoon returned an unexpected game list');

        renderGames(games.map(game => ({
            name: game.title,
            url: '#',
            image: game.icon_url,
            cloudMoonPackage: game.package_name
        })));
    } catch (error) {
        console.error('Unable to load CloudMoon games:', error);
        alert(`Could not load CloudMoon games: ${error.message}`);
    } finally {
        cloudmoonButton.disabled = false;
    }
}

async function signInCloudMoonGuest() {
    if (cloudMoonToken) return;

    const response = await cloudMoonRequest('login/pwd', {
        method: 'POST',
        body: { email: 'guestsynapse@gmail.com', password: 'Password!' }
    });
    cloudMoonToken = response.data?.token || response.token;
    if (!cloudMoonToken) throw new Error(response.message || 'CloudMoon guest login failed');
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function startCloudMoonGame(gamePackage) {
    const launchId = ++cloudMoonLaunchId;
    gameViewer.hidden = false;
    gameFrame.src = 'about:blank';
    gameStatus.hidden = false;
    gameStatus.textContent = 'Connecting to CloudMoon...';

    try {
        await signInCloudMoonGuest();
        if (launchId !== cloudMoonLaunchId) return;

        const phones = await cloudMoonRequest('phone/list');
        const device = phones.data?.list?.[0];
        if (!device?.android_id) throw new Error('CloudMoon has no available streaming devices');

        const payload = {
            android_id: device.android_id,
            game_name: gamePackage,
            screen_res: '720x1280',
            server_id: 23,
            params: JSON.stringify({ language: 'en', locale: 'us' }),
            ad_unblock: false
        };

        let connection = await cloudMoonRequest('phone/connect', { method: 'POST', body: payload });
        if (connection.code !== 0 || !connection.data) {
            throw new Error(connection.message || 'CloudMoon could not start this game');
        }

        if (connection.data.position) cloudMoonQueuedGame = gamePackage;
        while (!connection.data.android_instance_id) {
            if (launchId !== cloudMoonLaunchId) return;
            if (!connection.data.position) throw new Error('CloudMoon did not provide a game session');

            gameStatus.textContent = `Waiting in CloudMoon queue (position ${connection.data.position})...`;
            await wait(5000);
            if (launchId !== cloudMoonLaunchId) return;
            connection = await cloudMoonRequest('phone/connect', { method: 'POST', body: payload });
            if (connection.code !== 0 || !connection.data) {
                throw new Error(connection.message || 'CloudMoon queue request failed');
            }
        }

        const sid = connection.data.sid;
        if (!sid) throw new Error('CloudMoon returned no stream session ID');
        cloudMoonQueuedGame = null;
        gameStatus.hidden = true;
        gameFrame.src = `/cloudmoon-player.html?sid=${encodeURIComponent(sid)}&quality=SD`;
    } catch (error) {
        if (launchId !== cloudMoonLaunchId) return;
        console.error('Unable to start CloudMoon game:', error);
        gameStatus.textContent = `Could not start game: ${error.message}`;
    }
}

truffledButton.addEventListener('click', loadTruffledGames);
cloudmoonButton.addEventListener('click', loadCloudMoonGames);
localGamesButton.addEventListener('click', () => {
    loadLocalGames().catch(error => {
        console.error('Unable to load your games:', error);
        alert(`Could not load your games: ${error.message}`);
    });
});
searchInput.addEventListener('input', () => renderGames(availableGames));
gamesContainer.addEventListener('click', event => {
    const link = event.target.closest('a[target="0"]');
    if (!link) return;

    if (link.dataset.cloudMoonPackage) {
        event.preventDefault();
        startCloudMoonGame(link.dataset.cloudMoonPackage);
        return;
    }

    gameViewer.hidden = false;
});

closeGameButton.addEventListener('click', () => {
    cloudMoonLaunchId++;
    if (cloudMoonQueuedGame) {
        cloudMoonRequest('phone/disconnect', { method: 'POST', body: { game_name: cloudMoonQueuedGame } }).catch(() => {});
        cloudMoonQueuedGame = null;
    }
    gameStatus.hidden = true;
    gameFrame.src = 'about:blank';
    gameViewer.hidden = true;
});

loadLocalGames().catch(error => console.error('Unable to display games:', error));
