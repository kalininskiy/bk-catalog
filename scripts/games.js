// games.js
document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.nav-menu a');
    const gamesLink = Array.from(navLinks).find(a => a.textContent.includes('Игры БК-0010[-01]'));
    const games11Link = Array.from(navLinks).find(a => a.textContent.includes('Игры БК-0011[М]'));
    const homeLink = Array.from(navLinks).find(a => a.textContent === 'Главная');

    let allGames = [];
    let menuPlatform = null; // 'bk0010' или 'bk0011'
    // Текущие фильтры: genre, authors, publisher, year, platform, letter, search
    let currentFilters = {
        genre: '',
        authors: '',
        publisher: '',
        year: '',
        platform: '',
        letter: '',
        search: '',
    };
    let currentSort = { field: 'Название игры', dir: 'asc' };

    // ——— ЗАГРУЗКА И ПАРСИНГ CSV ———
    async function loadGamesData() {
        if (allGames.length) return allGames;
        try {
            const response = await fetch('content/games.csv');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const csvText = await response.text();
            allGames = parseCSV(csvText);
            return allGames;
        } catch (err) {
            console.error('Ошибка загрузки games.csv:', err);
            alert('Не удалось загрузить список игр.');
            return [];
        }
    }

    function parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (!lines.length) return [];

        const headers = parseCSVRow(lines[0]);
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVRow(lines[i]);
            if (row.length !== headers.length) continue;

            const obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = row[j] || '';
            }
            data.push(obj);
        }
        return data;
    }

    function parseCSVRow(str) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (c === '"' && !inQuotes) inQuotes = true;
            else if (c === '"' && inQuotes && str[i + 1] === '"') { current += '"'; i++; }
            else if (c === '"' && inQuotes) inQuotes = false;
            else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
            else current += c;
        }
        result.push(current.trim());
        return result;
    }

    // ——— ФИЛЬТРАЦИЯ ———
    function filterGames(games) {
        return games.filter(game => {
            // Фильтр по меню: БК-0010 vs БК-0011
            if (menuPlatform === 'bk0010') {
                if (/БК\s*0011|БК0011М/i.test(game['Платформа'])) return false;
            } else if (menuPlatform === 'bk0011') {
                if (!/БК\s*0011|БК0011М/i.test(game['Платформа'])) return false;
            }
            // Фильтр по конкретной платформе (клик в ячейке)
            if (currentFilters.platform && currentFilters.platform !== game['Платформа']) return false;
            // Жанр
            if (currentFilters.genre && currentFilters.genre !== game['Жанр']) return false;
            // Авторы
            if (currentFilters.authors && !game['Авторы'].includes(currentFilters.authors)) return false;
            // Издатель
            if (currentFilters.publisher && !game['Издатель'].includes(currentFilters.publisher)) return false;
            // Год
            if (currentFilters.year && currentFilters.year !== game['Год выпуска']) return false;
            // По букве
            if (currentFilters.letter) {
                const title = (game['Название игры'] || '').trim();
                if (!title) return false;

                if (currentFilters.letter === '#') {
                    // Начинается с цифры
                    if (!/^\d/.test(title)) return false;
                } else {
                    // Начинается с буквы
                    const firstChar = title.charAt(0).toUpperCase();
                    if (firstChar !== currentFilters.letter) return false;
                }
            }
            // По строке (включение подстроки)
            if (currentFilters.search) {
                const q = currentFilters.search.toLowerCase();
                if (!game['Название игры'].toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }

    // ——— СОРТИРОВКА ———
    function sortGames(games, field, dir = 'asc') {
        return [...games].sort((a, b) => {
            let valA = a[field] || '';
            let valB = b[field] || '';

            if (field === 'Год выпуска') {
                valA = parseInt(valA) || 0;
                valB = parseInt(valB) || 0;
                return dir === 'asc' ? valA - valB : valB - valA;
            }

            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
            if (valA < valB) return dir === 'asc' ? -1 : 1;
            if (valA > valB) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // ——— ОТОБРАЖЕНИЕ ———
    function renderGamesTable() {
        const tbody = document.getElementById('games-table-body');
        const genreSelect = document.getElementById('genre-select');
        if (!tbody || !genreSelect) return;

        const fullPlatformGames = allGames.filter(game => {
            if (menuPlatform === 'bk0010') {
                return !/БК\s*0011|БК0011М/i.test(game['Платформа']);
            } else if (menuPlatform === 'bk0011') {
                return /БК\s*0011|БК0011М/i.test(game['Платформа']);
            }
            return true;
        });

        renderAlphabetFilters(fullPlatformGames);

        const filtered = filterGames(allGames);
        const sorted = sortGames(filtered, currentSort.field, currentSort.dir);

        // Обновляем список жанров (только из отфильтрованных)
        const genres = new Set(filtered.map(g => g['Жанр']).filter(g => g));
        genreSelect.innerHTML = '<option value="">Все жанры</option>';
        [...genres].sort().forEach(genre => {
            const opt = document.createElement('option');
            opt.value = genre;
            opt.textContent = genre;
            genreSelect.appendChild(opt);
        });

        // Устанавливаем текущий жанр (если он есть в списке)
        if (currentFilters.genre && [...genres].includes(currentFilters.genre)) {
            genreSelect.value = currentFilters.genre;
        } else {
            genreSelect.value = '';
            currentFilters.genre = '';
        }

        // Обновляем счётчик
        const countEl = document.getElementById('count-value');
        if (countEl) {
            countEl.textContent = sorted.length;
        }

        // Рендерим строки
        tbody.innerHTML = '';
        sorted.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="game-title-cell" data-id="${escapeAttr(item['ID'])}">${escapeHtml(item['Название игры'])}</td>
                <td class="filterable" data-field="authors" data-value="${escapeAttr(item['Авторы'])}">${escapeHtml(item['Авторы'] || '—')}</td>
                <td class="filterable" data-field="publisher" data-value="${escapeAttr(item['Издатель'])}">${escapeHtml(item['Издатель'] || '—')}</td>
                <td class="filterable" data-field="year" data-value="${escapeAttr(item['Год выпуска'])}">${escapeHtml(item['Год выпуска'] || '—')}</td>
                <td class="filterable" data-field="platform" data-value="${escapeAttr(item['Платформа'])}">${escapeHtml(item['Платформа'] || '—')}</td>
                <td>${escapeHtml(item['Жанр'] || '—')}</td>
            `;
            tbody.appendChild(row);
        });

        // Назначаем обработчики клика по названию игры
        document.querySelectorAll('.game-title-cell').forEach(cell => {
            cell.style.cursor = 'pointer';
            cell.style.textDecoration = 'underline';
            cell.style.color = '#cc0000';
            cell.addEventListener('click', () => {
                const id = cell.dataset.id;
                const game = allGames.find(g => g['ID'] === id);
                if (game) {
                    // Отправляем событие в Метрику
                    if (typeof ym !== 'undefined') {
                        ym(105444555, 'reachGoal', 'game_open', {
                            title: game['Название игры'],
                            authors: game['Авторы'],
                            platform: game['Платформа'],
                            year: game['Год выпуска'],
                            genre: game['Жанр']
                        });
                    }
                    openGameModal(game);
                }
            });
        });

        // Назначаем обработчики кликов по ячейкам
        document.querySelectorAll('.filterable').forEach(cell => {
            cell.style.cursor = 'pointer';
            cell.style.textDecoration = 'underline';
            cell.style.color = '#0066cc';
            cell.addEventListener('click', () => {
                const field = cell.dataset.field;
                const value = cell.dataset.value;
                if (value === '—') return;

                if (field === 'platform') {
                    // Только фильтр, НЕ переключение меню
                    currentFilters.platform = value;
                } else {
                    currentFilters[field] = value;
                }
                renderGamesTable();
            });
        });


        // Показываем таблицу
        document.querySelector('.content-wrapper')?.style.setProperty('display', 'none', 'important');
        document.querySelector('.footer-block')?.style.setProperty('display', 'none', 'important');
        document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
        document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
        document.querySelector('.games-table-container')?.style.setProperty('display', 'block', 'important');
    }

    // Назначаем обработчики алфавита
    document.querySelectorAll('.alpha-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.closest('.alphabet-filter');
            const otherGroup = group.classList.contains('latin')
                ? document.querySelector('.cyrillic')
                : document.querySelector('.latin');

            group.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
            otherGroup?.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));

            btn.classList.add('active');

            currentFilters.letter = btn.dataset.letter;
            renderGamesTable();
        });
    });

    // Поиск по строке
    const searchInput = document.getElementById('search-input');
    const resetSearchBtn = document.getElementById('reset-search');

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentFilters.search = searchInput.value.trim();
            renderGamesTable();
        });
    }

    if (resetSearchBtn) {
        resetSearchBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            currentFilters.search = '';
            renderGamesTable();
        });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(str) {
        return String(str)
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    document.querySelector('.games-table-container thead').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;

        const field = th.dataset.sort;
        if (currentSort.field === field) {
            currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.field = field;
            currentSort.dir = 'asc';
        }

        document.querySelectorAll('.games-table th').forEach(el => {
            el.classList.remove('sort-asc', 'sort-desc');
        });
        th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');

        renderGamesTable();
    });

    document.getElementById('genre-select')?.addEventListener('change', (e) => {
        currentFilters.genre = e.target.value;
        renderGamesTable();
    });

    document.getElementById('reset-filters')?.addEventListener('click', () => {
        currentFilters = {
            genre: '',
            authors: '',
            publisher: '',
            year: '',
            platform: '',
            letter: '',
            search: '',
        };

        if (document.getElementById('genre-select')) {
            document.getElementById('genre-select').value = '';
        }

        document.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));

        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';

        renderGamesTable();
    });

    function showGamesTable(platformFilter) {
        menuPlatform = platformFilter;
        // Сбрасываем фильтры
        currentFilters = {
            genre: '',
            authors: '',
            publisher: '',
            year: '',
            platform: ''
        };

        // Сбрасываем значение селектора жанров (визуально)
        const genreSelect = document.getElementById('genre-select');
        if (genreSelect) genreSelect.value = '';

        // Перезагружаем данные и рендерим
        loadGamesData().then(() => {
            renderAlphabetFilters();
            renderGamesTable();
        });

        // Подсвечиваем таблицу
        const tableContainer = document.querySelector('.games-table-container');
        tableContainer.style.backgroundColor = '#fdfcf9';
        setTimeout(() => {
            tableContainer.style.backgroundColor = '';
        }, 15);
    }

    function renderAlphabetFilters(filteredGames) {
        if (!Array.isArray(filteredGames) || filteredGames.length === 0) return;

        // Собираем начальные символы из отфильтрованных игр
        const startsWith = new Set();
        filteredGames.forEach(game => {
            const title = (game['Название игры'] || '').trim();
            if (title) {
                const first = title.charAt(0).toUpperCase();
                if (/^[A-Z]$/.test(first)) {
                    startsWith.add(first);
                } else if (/^[А-ЯЁ]$/.test(first)) {
                    startsWith.add(first);
                } else if (/^\d/.test(title)) {
                    startsWith.add('#');
                }
            }
        });

        // Генерируем HTML
        const container = document.getElementById('alphabet-filters');
        if (!container) return;

        let html = '';

        // Латиница
        const latinLetters = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
        const latinAvailable = latinLetters.filter(l => startsWith.has(l));
        if (latinAvailable.length > 1 || latinAvailable.includes('#')) {
            html += `<div class="alphabet-filter latin"><span class="alphabet-label">Латиница:</span>`;
            latinAvailable.forEach(letter => {
                const active = currentFilters.letter === letter ? ' active' : '';
                html += `<button class="alpha-btn${active}" data-letter="${letter}">${letter}</button>`;
            });
            html += `</div>`;
        }

        // Кириллица
        const cyrillicLetters = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('');
        const cyrillicAvailable = cyrillicLetters.filter(l => startsWith.has(l));
        if (cyrillicAvailable.length > 0) {
            html += `<div class="alphabet-filter cyrillic"><span class="alphabet-label">Кириллица:</span>`;
            cyrillicAvailable.forEach(letter => {
                const active = currentFilters.letter === letter ? ' active' : '';
                html += `<button class="alpha-btn${active}" data-letter="${letter}">${letter}</button>`;
            });
            html += `</div>`;
        }

        container.innerHTML = html;

        // Назначаем обработчики
        document.querySelectorAll('.alpha-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = btn.closest('.alphabet-filter');
                const otherGroup = group.classList.contains('latin')
                    ? document.querySelector('.cyrillic')
                    : document.querySelector('.latin');

                group.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
                otherGroup?.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                currentFilters.letter = btn.dataset.letter;
                renderGamesTable();
            });
        });
    }

    if (gamesLink) {
        gamesLink.addEventListener('click', e => {
            e.preventDefault();
            showGamesTable('bk0010');
        });
    }

    if (games11Link) {
        games11Link.addEventListener('click', e => {
            e.preventDefault();
            showGamesTable('bk0011');
        });
    }

    if (homeLink) {
        homeLink.addEventListener('click', e => {
            e.preventDefault();
            document.querySelector('.content-wrapper').style.display = 'flex';
            document.querySelector('.footer-block').style.display = 'block';
            document.querySelector('.page-copyright').style.display = 'block';
            document.querySelector('.games-table-container').style.display = 'none';
            document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
            document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
        });
    }
});

// ——— МОДАЛЬНОЕ ОКНО ИГРЫ ———
function openGameModal(game) {
    const modal = document.getElementById('game-modal');
    if (!modal) return;

    // Заполняем данные
    document.querySelector('.game-title').textContent = game['Название игры'] || '—';
    document.querySelector('.game-genre').textContent = game['Жанр'] || '—';
    document.querySelector('.game-authors').textContent = game['Авторы'] || '—';
    document.querySelector('.game-publisher').textContent = game['Издатель'] || '—';
    document.querySelector('.game-date').textContent = game['Дата выхода'] || game['Год выпуска'] || '—';
    document.querySelector('.game-platform').textContent = game['Платформа'] || '—';
    document.querySelector('.game-graphics').textContent = game['Графика'] || '—';
    document.querySelector('.game-music').textContent = game['Музыка'] || '—';
    document.querySelector('.game-lang').textContent = game['Язык интерфейса'] || '—';
    // document.querySelector('.game-link').textContent = game['Ссылка на страницу с игрой'] || '—';
    document.querySelector('.game-description').textContent = game['Описание игры'] || '';

    // Выравниваем текст по левому краю
    document.querySelector('.game-meta').style.textAlign = 'left';

    // Скриншоты
    const screenshots = [];
    for (let i = 1; i <= 12; i++) {
        const key = `Скриншот ${i}`;
        const val = game[key];
        if (val && val.trim()) {
            screenshots.push(`bk_games_screenshots/${val}`);
        }
    }

    const imgEl = document.querySelector('.screenshot-current');
    if (imgEl) {
        imgEl.src = '';
        imgEl.style.opacity = '0';
    }
    imgEl.style.maxWidth = '100%';
    imgEl.style.maxHeight = '100%';
    imgEl.style.objectFit = 'contain';
    const counterEl = document.querySelector('.screenshots-counter');
    let currentIndex = 0;

    function updateScreenshot() {
        if (screenshots.length === 0) {
            imgEl.src = '';
            counterEl.textContent = 'Нет скриншотов';
            document.querySelector('.nav-btn.prev').disabled = true;
            document.querySelector('.nav-btn.next').disabled = true;
        } else {
            imgEl.src = screenshots[currentIndex] || '';
            counterEl.textContent = `${currentIndex + 1} / ${screenshots.length}`;
            document.querySelector('.nav-btn.prev').disabled = currentIndex === 0;
            document.querySelector('.nav-btn.next').disabled = currentIndex === screenshots.length - 1;
        }
    }

    // Кнопки навигации
    document.querySelector('.nav-btn.prev').onclick = () => {
        if (currentIndex > 0) {
            currentIndex--;
            updateScreenshot();
        }
    };
    document.querySelector('.nav-btn.next').onclick = () => {
        if (currentIndex < screenshots.length - 1) {
            currentIndex++;
            updateScreenshot();
        }
    };

    // Первый скриншот
    updateScreenshot();
    setTimeout(() => {
        if (imgEl) {
            imgEl.style.opacity = '1';
            imgEl.style.transition = 'opacity 0.3s ease';
        }
    }, 50);

    // Файлы
    const fileList = document.querySelector('.file-list');
    fileList.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const nameKey = `Имя файла ${i}`;
        const descKey = `Описание файла ${i}`;
        const name = game[nameKey];
        const desc = game[descKey];
        if (name && name.trim()) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `bk_games_files/${name}`;
            a.textContent = `${name} — ${desc || 'скачать'}`;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);
            fileList.appendChild(li);
            li.querySelector('a').addEventListener('click', (e) => {
                const filename = a.textContent.split(' — ')[0];
                if (typeof ym !== 'undefined') {
                    ym(105444555, 'reachGoal', 'file_download', {
                        filename: filename,
                        title: game['Название игры'],
                        authors: game['Авторы'],
                        platform: game['Платформа'],
                        year: game['Год выпуска'],
                        genre: game['Жанр']
                    });
                }
            });
        }
    }
    if (fileList.children.length === 0) {
        fileList.innerHTML = '<li>Нет файлов</li>';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    initGameModal();
}

function initGameModal() {
    const modal = document.getElementById('game-modal');
    if (!modal) return;

    // Закрытие по крестику
    const closeBtn = modal.querySelector('.game-modal-close');
    if (closeBtn) {
        closeBtn.onclick = () => closeModal();
    }

    // Закрытие по клику вне окна
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeModal();
        }
    };

    // Закрытие по ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

function closeModal() {
    const modal = document.getElementById('game-modal');
    if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}
