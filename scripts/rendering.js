/*
 * Copyright (C) 2025 Иван "VDM" Kalininskiy <https://t.me/VanDamM>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Модуль для рендеринга элементов интерфейса
 */

import { escapeHtml, escapeAttr } from './utils.js';
import { filterGames, sortGames, getUniqueGenres, getUniquePlatforms } from './filters.js';

// Глобальные переменные состояния (будут передаваться как параметры)
let currentFilters = {};
let currentSort = { field: 'Название игры', dir: 'asc' };

/**
 * Устанавливает глобальные переменные состояния для модуля
 * @param {Object} filters - текущие фильтры
 * @param {Object} sort - текущая сортировка
 */
export function setRenderingState(filters, sort, platform) {
    currentFilters = filters;
    currentSort = sort;
}

/**
 * Основная функция рендеринга таблицы игр
 * @param {Array} allGames - все игры
 * @param {Function} onGameClick - callback для клика по игре
 * @param {Function} onFilterClick - callback для клика по фильтру
 */
export function renderGamesTable(allGames, onGameClick, onFilterClick) {
    const tbody = document.getElementById('games-table-body');
    const genreSelect = document.getElementById('genre-select');
    if (!tbody || !genreSelect) return;

    renderAlphabetFilters(allGames);

    const filtered = filterGames(allGames, currentFilters);
    const sorted = sortGames(filtered, currentSort.field, currentSort.dir);

    updateGenreSelect(genreSelect, filtered);
    updatePlatformSelect(filtered);
    updateGamesCount(sorted.length);
    renderTableRows(tbody, sorted, onGameClick, onFilterClick);
    showGamesTable();
}

/**
 * Обновляет селектор жанров
 * @param {HTMLElement} genreSelect - элемент селектора жанров
 * @param {Array} filteredGames - отфильтрованные игры
 */
function updateGenreSelect(genreSelect, filteredGames) {
    const genres = getUniqueGenres(filteredGames);
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
}

/**
 * Обновляет селектор платформ
 * @param {Array} filteredGames - отфильтрованные игры
 */
function updatePlatformSelect(filteredGames) {
    const platformSelect = document.getElementById('platform-select');
    if (!platformSelect) return;

    const platforms = getUniquePlatforms(filteredGames);
    platformSelect.innerHTML = '<option value="">Все платформы</option>';
    [...platforms].sort().forEach(platform => {
        const opt = document.createElement('option');
        opt.value = platform;
        opt.textContent = platform;
        platformSelect.appendChild(opt);
    });

    // Устанавливаем текущую платформу (если она есть в списке)
    if (currentFilters.platform && [...platforms].includes(currentFilters.platform)) {
        platformSelect.value = currentFilters.platform;
    } else {
        platformSelect.value = '';
        currentFilters.platform = '';
    }
}

/**
 * Обновляет счетчик игр
 * @param {number} count - количество игр
 */
function updateGamesCount(count) {
    const countEl = document.getElementById('count-value');
    if (countEl) {
        countEl.textContent = count;
    }
}

/**
 * Рендерит строки таблицы
 * @param {HTMLElement} tbody - элемент tbody таблицы
 * @param {Array} games - массив игр для отображения
 * @param {Function} onGameClick - callback для клика по игре
 * @param {Function} onFilterClick - callback для клика по фильтру
 */
function renderTableRows(tbody, games, onGameClick, onFilterClick) {
    tbody.innerHTML = '';
    games.forEach(item => {
        const screenshot1 = item['Скриншот 1'];
        const screenshotHtml = screenshot1 && screenshot1.trim()
            ? `<img src="bk_games_small_screenshots/${escapeAttr(screenshot1)}" alt="Screenshot" class="game-screenshot">`
            : '<div class="no-screenshot">—</div>';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="screenshot-cell">${screenshotHtml}</td>
            <td class="game-title-cell" data-id="${escapeAttr(item['ID'])}">${escapeHtml(item['Название игры'])}</td>
            <td class="filterable" data-field="authors" data-value="${escapeAttr(item['Авторы'])}">${escapeHtml(item['Авторы'] || '—')}</td>
            <td class="filterable" data-field="publisher" data-value="${escapeAttr(item['Издатель'])}">${escapeHtml(item['Издатель'] || '—')}</td>
            <td class="filterable" data-field="year" data-value="${escapeAttr(item['Год выпуска'])}">${escapeHtml(item['Год выпуска'] || '—')}</td>
            <td class="filterable" data-field="platform" data-value="${escapeAttr(item['Платформа'])}">${escapeHtml(item['Платформа'] || '—')}</td>
            <td>${escapeHtml(item['Жанр'] || '—')}</td>
        `;
        tbody.appendChild(row);
    });

    setupGameTitleClickHandlers(tbody, games, onGameClick);
    setupFilterableClickHandlers(tbody, onFilterClick);
}

/**
 * Устанавливает обработчики кликов по названиям игр
 * @param {HTMLElement} tbody - элемент tbody таблицы
 * @param {Array} games - массив игр
 * @param {Function} onGameClick - callback для клика по игре
 */
function setupGameTitleClickHandlers(tbody, games, onGameClick) {
    tbody.querySelectorAll('.game-title-cell').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.style.textDecoration = 'underline';
        cell.style.color = '#cc0000';
        cell.addEventListener('click', () => {
            const id = cell.dataset.id;
            const game = games.find(g => g['ID'] === id);
            if (game) {
                onGameClick(game);
            }
        });
    });
}

/**
 * Устанавливает обработчики кликов по фильтруемым ячейкам
 * @param {HTMLElement} tbody - элемент tbody таблицы
 * @param {Function} onFilterClick - callback для клика по фильтру
 */
function setupFilterableClickHandlers(tbody, onFilterClick) {
    tbody.querySelectorAll('.filterable').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.style.textDecoration = 'underline';
        cell.style.color = '#0066cc';
        cell.addEventListener('click', () => {
            const field = cell.dataset.field;
            const value = cell.dataset.value;
            if (value === '—') return;
            onFilterClick(field, value);
        });
    });
}

/**
 * Показывает таблицу игр и скрывает другие элементы
 */
function showGamesTable() {
    document.querySelector('.content-wrapper')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.footer-block')?.style.setProperty('display', 'none', 'important');
    document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.games-table-container')?.style.setProperty('display', 'block', 'important');
}

/**
 * Рендерит алфавитные фильтры
 * @param {Array} filteredGames - отфильтрованные игры
 */
export function renderAlphabetFilters(filteredGames) {
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
}


// ——— МОДАЛЬНОЕ ОКНО ИГРЫ ———

/**
 * Открывает модальное окно игры
 * @param {Object} game - объект игры
 * @param {Array} allGames - массив всех игр
 */
export function openGameModal(game, allGames) {
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
    document.querySelector('.game-description').textContent = game['Описание игры'] || '';

    // Выравниваем текст по левому краю
    document.querySelector('.game-meta').style.textAlign = 'left';

    // Скриншоты
    setupScreenshots(game);

    // Файлы
    setupFiles(game);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    initGameModal();
}

/**
 * Настраивает скриншоты в модальном окне
 * @param {Object} game - объект игры
 */
function setupScreenshots(game) {
    const screenshots = [];
    for (let i = 1; i <= 12; i++) {
        const key = `Скриншот ${i}`;
        const val = game[key];
        if (val && val.trim()) {
            screenshots.push(`bk_games_screenshots/${val}`);
        }
    }

    // Очищаем старые обработчики событий - заменяем элемент на новый
    const oldImgEl = document.querySelector('.screenshot-current');
    if (oldImgEl) {
        const newImgEl = oldImgEl.cloneNode(true);
        oldImgEl.parentNode.replaceChild(newImgEl, oldImgEl);

        // Настраиваем новый элемент
        newImgEl.src = '';
        newImgEl.style.opacity = '0';
        newImgEl.style.maxWidth = '100%';
        newImgEl.style.maxHeight = '100%';
        newImgEl.style.objectFit = 'contain';
        newImgEl.style.cursor = screenshots.length > 0 ? 'pointer' : 'default';
    }

    const imgEl = document.querySelector('.screenshot-current');
    const counterEl = document.querySelector('.screenshots-counter');
    let currentIndex = 0;

    function updateScreenshot() {
        if (screenshots.length === 0) {
            if (imgEl) {
                imgEl.src = '';
                imgEl.alt = 'Нет скриншотов';
                imgEl.style.opacity = '0.5';
            }
            if (counterEl) counterEl.textContent = 'Нет скриншотов';
            document.querySelector('.nav-btn.prev').disabled = true;
            document.querySelector('.nav-btn.next').disabled = true;
        } else {
            if (imgEl) {
                imgEl.src = screenshots[currentIndex] || '';
                imgEl.alt = `Скриншот ${currentIndex + 1}`;
                imgEl.style.opacity = '1';
            }
            if (counterEl) counterEl.textContent = `${currentIndex + 1} / ${screenshots.length}`;
            document.querySelector('.nav-btn.prev').disabled = false;
            document.querySelector('.nav-btn.next').disabled = false;
        }
    }

    // Кнопки навигации
    document.querySelector('.nav-btn.prev').onclick = () => {
        if (screenshots.length > 1) {
            currentIndex = currentIndex > 0 ? currentIndex - 1 : screenshots.length - 1;
            updateScreenshot();
        }
    };
    document.querySelector('.nav-btn.next').onclick = () => {
        if (screenshots.length > 1) {
            currentIndex = currentIndex < screenshots.length - 1 ? currentIndex + 1 : 0;
            updateScreenshot();
        }
    };

    // Обработчик клика для увеличения скриншота (только если есть скриншоты)
    if (screenshots.length > 0) {
        imgEl.addEventListener('click', () => {
            showEnlargedScreenshot(screenshots, currentIndex);
        });
    }

    // Первый скриншот
    updateScreenshot();
    setTimeout(() => {
        if (imgEl) {
            imgEl.style.opacity = screenshots.length > 0 ? '1' : '0.5';
            imgEl.style.transition = 'opacity 0.3s ease';
        }
    }, 50);
}

/**
 * Показывает увеличенный скриншот с возможностью навигации
 * @param {Array<string>} screenshots - массив путей к изображениям
 * @param {number} currentIndex - индекс текущего скриншота
 */
function showEnlargedScreenshot(screenshots, currentIndex) {
    // Не показываем overlay если нет скриншотов
    if (!screenshots || screenshots.length === 0) {
        return;
    }

    // Закрываем существующий overlay если он открыт
    const existingOverlay = document.querySelector('.screenshot-overlay');
    if (existingOverlay) {
        // Удаляем старый обработчик клавиш если он существует
        if (existingOverlay._keyHandler) {
            document.removeEventListener('keydown', existingOverlay._keyHandler);
        }
        existingOverlay.remove();
    }

    let currentScreenshotIndex = currentIndex;

    // Создаем overlay
    const overlay = document.createElement('div');
    overlay.className = 'screenshot-overlay';

    const hasMultipleScreenshots = screenshots.length > 1;

    overlay.innerHTML = `
        <div class="screenshot-overlay-bg"></div>
        <div class="screenshot-container">
            ${hasMultipleScreenshots ? '<button class="screenshot-nav-btn prev" title="Предыдущий скриншот">‹</button>' : ''}
            <img src="${screenshots[currentScreenshotIndex]}" class="screenshot-enlarged" alt="Увеличенный скриншот">
            ${hasMultipleScreenshots ? '<button class="screenshot-nav-btn next" title="Следующий скриншот">›</button>' : ''}
            ${hasMultipleScreenshots ? `<div class="screenshot-counter">${currentScreenshotIndex + 1} / ${screenshots.length}</div>` : ''}
        </div>
    `;

    document.body.appendChild(overlay);

    // Функция обновления скриншота
    const updateEnlargedScreenshot = () => {
        const img = overlay.querySelector('.screenshot-enlarged');
        const counter = overlay.querySelector('.screenshot-counter');
        const prevBtn = overlay.querySelector('.screenshot-nav-btn.prev');
        const nextBtn = overlay.querySelector('.screenshot-nav-btn.next');

        // Обновляем изображение
        img.style.opacity = '0';
        setTimeout(() => {
            img.src = screenshots[currentScreenshotIndex];
            img.style.opacity = '1';
        }, 150);

        // Обновляем счетчик
        if (counter) {
            counter.textContent = `${currentScreenshotIndex + 1} / ${screenshots.length}`;
        }

        // Обновляем состояние кнопок
        if (prevBtn) {
            prevBtn.disabled = false;
        }
        if (nextBtn) {
            nextBtn.disabled = false;
        }
    };

    // Обработчики навигации
    const prevBtn = overlay.querySelector('.screenshot-nav-btn.prev');
    const nextBtn = overlay.querySelector('.screenshot-nav-btn.next');

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (screenshots.length > 1) {
                currentScreenshotIndex = currentScreenshotIndex > 0 ? currentScreenshotIndex - 1 : screenshots.length - 1;
                updateEnlargedScreenshot();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (screenshots.length > 1) {
                currentScreenshotIndex = currentScreenshotIndex < screenshots.length - 1 ? currentScreenshotIndex + 1 : 0;
                updateEnlargedScreenshot();
            }
        });
    }

    // Показываем с анимацией
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Обработчики закрытия
    const bg = overlay.querySelector('.screenshot-overlay-bg');
    const img = overlay.querySelector('.screenshot-enlarged');

    const closeOverlay = () => {
        overlay.classList.remove('active');
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300);
    };

    bg.addEventListener('click', closeOverlay);
    img.addEventListener('click', closeOverlay);

    // Обработчики клавиш
    const keyHandler = (e) => {
        if (e.key === 'Escape') {
            closeOverlay();
            document.removeEventListener('keydown', keyHandler);
        } else if (e.key === 'ArrowLeft' && screenshots.length > 1) {
            currentScreenshotIndex = currentScreenshotIndex > 0 ? currentScreenshotIndex - 1 : screenshots.length - 1;
            updateEnlargedScreenshot();
        } else if (e.key === 'ArrowRight' && screenshots.length > 1) {
            currentScreenshotIndex = currentScreenshotIndex < screenshots.length - 1 ? currentScreenshotIndex + 1 : 0;
            updateEnlargedScreenshot();
        }
    };
    document.addEventListener('keydown', keyHandler);

    // Сохраняем ссылку на обработчик для возможности его удаления при открытии нового overlay
    overlay._keyHandler = keyHandler;
}

/**
 * Настраивает файлы в модальном окне
 * @param {Object} game - объект игры
 */
function setupFiles(game) {
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

            // Отправка события в Метрику при скачивании файла
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
}

/**
 * Инициализирует модальное окно
 */
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

/**
 * Закрывает модальное окно
 */
export function closeModal() {
    const modal = document.getElementById('game-modal');
    if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}
