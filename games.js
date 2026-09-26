const gamesContainer = document.querySelector('.games');
const searchInput = document.querySelector('#game-search');
const gameViewer = document.querySelector('#game-viewer');
const gameFrame = gameViewer.querySelector('iframe');
const closeGameButton = document.querySelector('#close-game');
const gameStatus = document.querySelector('#game-status');
let availableGames = [];

function renderGames(games) {
    availableGames = games;
    gamesContainer.replaceChildren();

    const query = searchInput.value.trim().toLowerCase();
    const filteredGames = availableGames.filter(game => game.name.toLowerCase().includes(query));

    for (const game of filteredGames) {
        const card = document.createElement('div');
        card.className = 'hi';

        const link = document.createElement('a');
        link.href = game.url;
        link.target = '0';

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

searchInput.addEventListener('input', () => renderGames(availableGames));
gamesContainer.addEventListener('click', event => {
    const link = event.target.closest('a[target="0"]');
    if (!link) return;

    gameViewer.hidden = false;
});

closeGameButton.addEventListener('click', () => {
    gameStatus.hidden = true;
    gameFrame.src = 'about:blank';
    gameViewer.hidden = true;
});

loadLocalGames().catch(error => console.error('Unable to display games:', error));
