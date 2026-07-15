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
import { filterGames, sortGames, getUniqueGenres, getUniquePlatforms, getUniqueDemoparties } from './filters.js';
import { convertBinaryToWav } from './bin2wav-converter.js';

const DEBUG_SLOW_SCREENSHOT_LOAD = window.location.search.includes('slow=1');
const DEBUG_SLOW_SCREENSHOT_LOAD_DELAY = 1200; // миллисекунд

// Глобальные переменные состояния (будут передаваться как параметры)
let currentFilters = {};
let currentSort = { field: 'Название', dir: 'asc' };
let currentContext = 'games'; // 'games', 'software', 'demoscene'

/**
 * Устанавливает глобальные переменные состояния для модуля
 * @param {Object} filters - текущие фильтры
 * @param {Object} sort - текущая сортировка
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
export function setRenderingState(filters, sort, context = 'games') {
    currentFilters = filters;
    currentSort = sort;
    currentContext = context;
}

/**
 * Основная функция рендеринга таблицы игр
 * @param {Array} allGames - все игры
 * @param {Function} onGameClick - callback для клика по игре
 * @param {Function} onFilterClick - callback для клика по фильтру
 * @param {Function} [onClearFilter] - callback для сброса одного фильтра (field) при клике по × в блоке активных фильтров
 */
export function renderGamesTable(allGames, onGameClick, onFilterClick, onClearFilter) {
    const container = document.querySelector('.games-table-container');
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
    if (container && typeof onClearFilter === 'function') {
        renderActiveFilters(container.querySelector('.games-active-filters'), currentFilters, onClearFilter);
    }
    showGamesTable();
}

/**
 * Обновляет селектор жанров
 * @param {HTMLElement} genreSelect - элемент селектора жанров
 * @param {Array} filteredGames - отфильтрованные игры
 */
function updateGenreSelect(genreSelect, filteredGames) {
    const genres = getUniqueGenres(filteredGames);
    genreSelect.innerHTML = `<option value="">${window.t('ui.allGenres')}</option>`;
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
    platformSelect.innerHTML = `<option value="">${window.t('ui.allPlatforms')}</option>`;
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

/** Подписи полей фильтров для блока «Активные фильтры» */
var FILTER_LABELS = {
    letter: 'filters.letter',
    search: 'filters.search',
    platform: 'filters.platform',
    demoparty: 'filters.demoparty',
    genre: 'filters.genre',
    authors: 'filters.authors',
    publisher: 'filters.publisher',
    year: 'filters.year',
    hasSources: 'filters.hasSources'
};

/**
 * Рендерит блок активных фильтров: список применённых фильтров с кнопкой × для сброса каждого.
 * @param {HTMLElement|null} container - контейнер (.active-filters)
 * @param {Object} filters - объект текущих фильтров (currentFilters)
 * @param {Function} onClearFilter - callback(field) при клике по ×
 */
function renderActiveFilters(container, filters, onClearFilter) {
    if (!container || typeof onClearFilter !== 'function') return;

    var applied = [];
    Object.keys(FILTER_LABELS).forEach(function (field) {
        var val = filters[field];
        if (field === 'hasSources') {
            if (val === true) applied.push({ field: field, value: 'Да' });
        } else if (val && String(val).trim() !== '') {
            applied.push({ field: field, value: String(val).trim() });
        }
    });

    container.innerHTML = '';
    if (applied.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.setAttribute('aria-label', window.t('filters.search'));

    applied.forEach(function (item) {
        var labelKey = FILTER_LABELS[item.field] || item.field;
        var label = typeof window.t === 'function' ? window.t(labelKey) : labelKey;
        var displayValue = item.value.length > 30 ? item.value.substring(0, 27) + '…' : item.value;

        var chip = document.createElement('span');
        chip.className = 'active-filter-chip';
        chip.innerHTML = '<span class="active-filter-text">' + escapeHtml(label) + ': ' + escapeHtml(displayValue) + '</span> <button type="button" class="active-filter-remove" aria-label="' + escapeAttr(window.t ? window.t('filters.reset') : 'Сбросить фильтр') + '" title="' + escapeAttr(window.t ? window.t('filters.reset') : 'Сбросить фильтр') + '">×</button>';

        var btn = chip.querySelector('.active-filter-remove');
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            onClearFilter(item.field);
        });

        container.appendChild(chip);
    });
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
            ? `<img src="bk_games_small_screenshots/${escapeAttr(screenshot1)}" alt="${window.t('ui.screenshot')}" class="game-screenshot">`
            : '<div class="no-screenshot">—</div>';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="screenshot-cell" data-id="${escapeAttr(item['ID'])}">${screenshotHtml}</td>
            <td class="game-title-cell" data-id="${escapeAttr(item['ID'])}">${escapeHtml(item['Название'])}</td>
            <td class="filterable" data-field="authors" data-value="${escapeAttr(item['Авторы'])}">${escapeHtml(item['Авторы'] || '—')}</td>
            <td class="filterable" data-field="publisher" data-value="${escapeAttr(item['Издатель'])}">${escapeHtml(item['Издатель'] || '—')}</td>
            <td class="filterable" data-field="year" data-value="${escapeAttr(item['Год выпуска'])}">${escapeHtml(item['Год выпуска'] || '—')}</td>
            <td class="filterable" data-field="platform" data-value="${escapeAttr(item['Платформа'])}">${escapeHtml(item['Платформа'] || '—')}</td>
            <td class="filterable" data-field="genre" data-value="${escapeAttr(item['Жанр'])}">${escapeHtml(item['Жанр'] || '—')}</td>
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
    tbody.querySelectorAll('.screenshot-cell, .game-title-cell').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.style.textDecoration = 'underline';
        cell.style.color = '#cc0000';
    });

    // Избегаем накопления множества обработчиков при каждом рендере таблицы.
    // Снимаем старый обработчик, если он был установлен ранее, и вешаем новый.
    if (tbody._gameClickHandler) {
        tbody.removeEventListener('click', tbody._gameClickHandler);
    }

    const handler = (e) => {
        const cell = e.target.closest('.screenshot-cell, .game-title-cell');
        if (cell) {
            const id = cell.dataset.id;
            const game = games.find(g => g['ID'] === id);
            if (game) {
                onGameClick(game);
            }
        }
    };

    tbody._gameClickHandler = handler;
    tbody.addEventListener('click', handler);
}

/** Поля, в которых значение может быть перечислением через запятую (при клике показываем выбор) */
var MULTI_VALUE_FILTER_FIELDS = ['authors', 'publisher', 'genre'];

/**
 * Разбивает строку по запятым и возвращает массив непустых подстрок (trim).
 * @param {string} s
 * @returns {string[]}
 */
function splitFilterValue(s) {
    if (!s || typeof s !== 'string') return [];
    return s.split(',').map(function (part) { return part.trim(); }).filter(Boolean);
}

/**
 * Показывает всплывающее меню выбора одного значения и вызывает onFilterClick при выборе
 * @param {HTMLElement} anchor - ячейка, относительно которой позиционировать
 * @param {string} field - поле фильтра
 * @param {string[]} values - варианты значения
 * @param {Function} onFilterClick
 */
function showFilterChoicePopover(anchor, field, values, onFilterClick) {
    var existing = document.querySelector('.filter-choice-popover');
    if (existing) existing.remove();

    var pop = document.createElement('div');
    pop.className = 'filter-choice-popover';

    values.forEach(function (val) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-choice-option';
        btn.textContent = val;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            onFilterClick(field, val);
            pop.remove();
        });
        pop.appendChild(btn);
    });

    document.body.appendChild(pop);

    var rect = anchor.getBoundingClientRect();
    pop.style.left = rect.left + 'px';
    pop.style.top = (rect.bottom + 2) + 'px';

    function close() {
        pop.remove();
        document.removeEventListener('click', close);
    }
    document.addEventListener('click', close);
}

/**
 * Показывает всплывающее меню выбора одного автора для перехода на «страницу автора» (#author/...).
 * @param {HTMLElement} anchor - элемент, относительно которого позиционировать (например ссылка «Страница автора»)
 * @param {string[]} authorNames - массив имён авторов (уже разбитых по запятой)
 */
function showAuthorPageChoicePopover(anchor, authorNames) {
    var existing = document.querySelector('.filter-choice-popover');
    if (existing) existing.remove();

    var pop = document.createElement('div');
    pop.className = 'filter-choice-popover';

    authorNames.forEach(function (name) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-choice-option';
        btn.textContent = name;
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            window.location.hash = '#author/' + encodeURIComponent(name);
            pop.remove();
        });
        pop.appendChild(btn);
    });

    document.body.appendChild(pop);
    var rect = anchor.getBoundingClientRect();
    pop.style.left = rect.left + 'px';
    pop.style.top = (rect.bottom + 2) + 'px';

    function close() {
        pop.remove();
        document.removeEventListener('click', close);
    }
    setTimeout(function () {
        document.addEventListener('click', close);
    }, 0);
}

/**
 * Устанавливает обработчики кликов по фильтруемым ячейкам.
 * Для полей Авторы/Издатель/Жанр при значении через запятую показывается выбор одного значения.
 * @param {HTMLElement} tbody - элемент tbody таблицы
 * @param {Function} onFilterClick - callback для клика по фильтру
 */
function setupFilterableClickHandlers(tbody, onFilterClick) {
    tbody.querySelectorAll('.filterable').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.style.textDecoration = 'underline';
        cell.style.color = '#0066cc';
        cell.addEventListener('click', (e) => {
            e.stopPropagation();
            const field = cell.dataset.field;
            let value = (cell.dataset.value || '').trim();
            if (value === '' || value === '—') return;

            const isMultiValueField = MULTI_VALUE_FILTER_FIELDS.indexOf(field) !== -1;
            const parts = splitFilterValue(value);

            if (isMultiValueField && parts.length > 1) {
                showFilterChoicePopover(cell, field, parts, onFilterClick);
            } else {
                const chosen = parts.length ? parts[0] : value;
                onFilterClick(field, chosen);
            }
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
    document.querySelector('.software-table-container')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.demoscene-table-container')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.games-table-container')?.style.setProperty('display', 'block', 'important');
}

/**
 * Рендерит алфавитные фильтры
 * @param {Array} filteredGames - отфильтрованные игры
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
export function renderAlphabetFilters(filteredGames, context = 'games') {
    renderAlphabetFiltersForContext(filteredGames, context);
}


// ——— МОДАЛЬНОЕ ОКНО ИГРЫ ———

/**
 * Открывает модальное окно игры
 * @param {Object} game - объект игры
 * @param {Array} allGames - массив всех игр
 */
export function openGameModal(game, allGames) {
    openModalForContext(game, allGames, 'games');
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
            ${hasMultipleScreenshots ? `<button class="screenshot-nav-btn prev" title="${window.t('ui.previousScreenshot')}">‹</button>` : ''}
            <img src="" class="screenshot-enlarged" alt="${window.t('ui.enlargedScreenshot')}">
            <div class="screenshot-loader"></div>
            ${hasMultipleScreenshots ? `<button class="screenshot-nav-btn next" title="${window.t('ui.nextScreenshot')}">›</button>` : ''}
            ${hasMultipleScreenshots ? `<div class="screenshot-counter">${currentScreenshotIndex + 1} / ${screenshots.length}</div>` : ''}
        </div>
    `;

    document.body.appendChild(overlay);

    const img = overlay.querySelector('.screenshot-enlarged');
    const loader = overlay.querySelector('.screenshot-loader');
    const counter = overlay.querySelector('.screenshot-counter');
    const prevBtn = overlay.querySelector('.screenshot-nav-btn.prev');
    const nextBtn = overlay.querySelector('.screenshot-nav-btn.next');
    let isLoadingOverlay = false;
    let preloadImage = null;
    let preloadTimeoutId = null;

    function setOverlayLoading(loading) {
        isLoadingOverlay = loading;
        if (loader) {
            loader.style.display = loading ? 'flex' : 'none';
        }
        if (prevBtn) prevBtn.disabled = loading;
        if (nextBtn) nextBtn.disabled = loading;
    }

    function updateEnlargedScreenshot() {
        if (!img) return;
        const nextSrc = screenshots[currentScreenshotIndex];
        if (!nextSrc) return;

        setOverlayLoading(true);
        img.style.opacity = '0.3';

        if (preloadImage) {
            preloadImage.onload = null;
            preloadImage.onerror = null;
        }
        if (preloadTimeoutId) {
            clearTimeout(preloadTimeoutId);
            preloadTimeoutId = null;
        }

        preloadImage = new Image();
        preloadImage.onload = () => {
            img.src = nextSrc;
            img.style.opacity = '1';
            setOverlayLoading(false);
        };
        preloadImage.onerror = () => {
            setOverlayLoading(false);
            img.style.opacity = '0.6';
        };

        const loadNext = () => {
            preloadImage.src = nextSrc;
        };
        if (DEBUG_SLOW_SCREENSHOT_LOAD) {
            preloadTimeoutId = setTimeout(loadNext, DEBUG_SLOW_SCREENSHOT_LOAD_DELAY);
        } else {
            loadNext();
        }

        if (counter) {
            counter.textContent = `${currentScreenshotIndex + 1} / ${screenshots.length}`;
        }
    }

    // Обработчики навигации

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isLoadingOverlay || screenshots.length <= 1) return;
            currentScreenshotIndex = currentScreenshotIndex > 0 ? currentScreenshotIndex - 1 : screenshots.length - 1;
            updateEnlargedScreenshot();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isLoadingOverlay || screenshots.length <= 1) return;
            currentScreenshotIndex = currentScreenshotIndex < screenshots.length - 1 ? currentScreenshotIndex + 1 : 0;
            updateEnlargedScreenshot();
        });
    }

    // Первый скриншот
    updateEnlargedScreenshot();

    // Показываем с анимацией
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Обработчики закрытия
    const bg = overlay.querySelector('.screenshot-overlay-bg');

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
        } else if (!isLoadingOverlay && e.key === 'ArrowLeft' && screenshots.length > 1) {
            currentScreenshotIndex = currentScreenshotIndex > 0 ? currentScreenshotIndex - 1 : screenshots.length - 1;
            updateEnlargedScreenshot();
        } else if (!isLoadingOverlay && e.key === 'ArrowRight' && screenshots.length > 1) {
            currentScreenshotIndex = currentScreenshotIndex < screenshots.length - 1 ? currentScreenshotIndex + 1 : 0;
            updateEnlargedScreenshot();
        }
    };
    document.addEventListener('keydown', keyHandler);

    // Сохраняем ссылку на обработчик для возможности его удаления при открытии нового overlay
    overlay._keyHandler = keyHandler;
}

/**
 * Инициализирует модальное окно
 */
function adjustModalScale() {
    const modal = document.getElementById('game-modal');
    const modalContent = document.querySelector('.game-modal-content');
    if (!modal || !modalContent) return;

    // Получаем размеры видимой области (viewport)
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Получаем текущий размер модального окна
    const contentWidth = modalContent.offsetWidth;
    const contentHeight = modalContent.offsetHeight;
    
    // Резерв для отступов от краёв (в пикселях)
    const margin = 20;
    const maxAvailableWidth = viewportWidth - margin * 2;
    const maxAvailableHeight = viewportHeight - margin * 2;
    
    // Вычисляем коэффициенты масштабирования по ширине и высоте
    const scaleByWidth = maxAvailableWidth / contentWidth;
    const scaleByHeight = maxAvailableHeight / contentHeight;
    
    // Берём меньший коэффициент, чтобы окно вписалось по обеим осям
    const scale = Math.min(scaleByWidth, scaleByHeight, 1);
    
    // Применяем масштабирование
    modalContent.style.transform = `scale(${scale})`;
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

/**
 * Закрывает модальное окно
 */
export function closeModal() {
    const modal = document.getElementById('game-modal');
    if (modal && modal.classList.contains('active')) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        
        // Сбрасываем масштаб
        const modalContent = document.querySelector('.game-modal-content');
        if (modalContent) {
            modalContent.style.transform = 'scale(1)';
        }

        // Удаляем обработчик resize для модального окна
        if (window._modalResizeHandler) {
            window.removeEventListener('resize', window._modalResizeHandler);
            window._modalResizeHandler = null;
        }

        // Удаляем все обработчики клавиатуры для скриншотов
        if (window._screenshotKeyHandlers) {
            window._screenshotKeyHandlers.forEach(handler => {
                document.removeEventListener('keydown', handler);
            });
            window._screenshotKeyHandlers = [];
        }

        // Очищаем hash из URL (если это hash карточки)
        if (window.location.hash.match(/^#(game|software|demo)-/)) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }
}

// ——— ФУНКЦИИ ДЛЯ СОФТА ———

/**
 * Основная функция рендеринга таблицы софта
 * @param {Array} allSoftware - весь софт
 * @param {Function} onSoftwareClick - callback для клика по софту
 * @param {Function} onFilterClick - callback для клика по фильтру
 * @param {Function} [onClearFilter] - callback для сброса одного фильтра при клике по ×
 */
export function renderSoftwareTable(allSoftware, onSoftwareClick, onFilterClick, onClearFilter) {
    const container = document.querySelector('.software-table-container');
    const tbody = container.querySelector('#software-table-body');
    const genreSelect = container.querySelector('#genre-select');
    if (!tbody || !genreSelect) return;

    renderAlphabetFilters(allSoftware, 'software');

    const filtered = filterGames(allSoftware, currentFilters);
    const sorted = sortGames(filtered, currentSort.field, currentSort.dir);

    updateGenreSelectForContext(genreSelect, filtered, 'software');
    updatePlatformSelectForContext(filtered, 'software');
    updateCountForContext(sorted.length, 'software');
    renderTableRowsForContext(tbody, sorted, onSoftwareClick, onFilterClick, 'software');
    if (container && typeof onClearFilter === 'function') {
        renderActiveFilters(container.querySelector('.software-active-filters'), currentFilters, onClearFilter);
    }
    showSoftwareTable();
}

/**
 * Показывает таблицу софта и скрывает другие элементы
 */
function showSoftwareTable() {
    document.querySelector('.content-wrapper')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.footer-block')?.style.setProperty('display', 'none', 'important');
    document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.games-table-container')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.demoscene-table-container')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.software-table-container')?.style.setProperty('display', 'block', 'important');
}

/**
 * Открывает модальное окно софта
 * @param {Object} software - объект софта
 * @param {Array} allSoftware - массив всего софта
 */
export function openSoftwareModal(software, allSoftware) {
    openModalForContext(software, allSoftware, 'software');
}

// ——— ФУНКЦИИ ДЛЯ ДЕМОСЦЕНЫ ———

/**
 * Основная функция рендеринга таблицы демосцены
 * @param {Array} allDemoscene - вся демосцена
 * @param {Function} onDemosceneClick - callback для клика по демо
 * @param {Function} onFilterClick - callback для клика по фильтру
 */
export function renderDemosceneTable(allDemoscene, onDemosceneClick, onFilterClick, onClearFilter) {
    const container = document.querySelector('.demoscene-table-container');
    const tbody = container.querySelector('#demoscene-table-body');
    const genreSelect = container.querySelector('#genre-select');
    if (!tbody || !genreSelect) return;

    renderAlphabetFilters(allDemoscene, 'demoscene');

    const filtered = filterGames(allDemoscene, currentFilters);
    const sorted = sortGames(filtered, currentSort.field, currentSort.dir);

    updateGenreSelectForContext(genreSelect, filtered, 'demoscene');
    updateDemopartySelect(filtered);
    updateCountForContext(sorted.length, 'demoscene');
    renderTableRowsForContext(tbody, sorted, onDemosceneClick, onFilterClick, 'demoscene');
    if (container && typeof onClearFilter === 'function') {
        renderActiveFilters(container.querySelector('.demoscene-active-filters'), currentFilters, onClearFilter);
    }
    showDemosceneTable();
}

/**
 * Показывает таблицу демосцены и скрывает другие элементы
 */
function showDemosceneTable() {
    document.querySelector('.content-wrapper')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.footer-block')?.style.setProperty('display', 'none', 'important');
    document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.games-table-container')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.software-table-container')?.style.setProperty('display', 'none', 'important');
    document.querySelector('.demoscene-table-container')?.style.setProperty('display', 'block', 'important');
}

/**
 * Открывает модальное окно демосцены
 * @param {Object} demo - объект демо
 * @param {Array} allDemoscene - массив всей демосцены
 */
export function openDemosceneModal(demo, allDemoscene) {
    openModalForContext(demo, allDemoscene, 'demoscene');
}

// ——— УНИВЕРСАЛЬНЫЕ ФУНКЦИИ ———

/**
 * Обновляет селектор жанров для контекста
 * @param {HTMLElement} genreSelect - элемент селектора жанров
 * @param {Array} filteredItems - отфильтрованные элементы
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function updateGenreSelectForContext(genreSelect, filteredItems, context) {
    const genres = getUniqueGenres(filteredItems);
    const label = context === 'software' ? window.t('ui.allTypes') : window.t('ui.allGenres');
    genreSelect.innerHTML = `<option value="">${label}</option>`;
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
 * Обновляет селектор платформ для контекста
 * @param {Array} filteredItems - отфильтрованные элементы
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function updatePlatformSelectForContext(filteredItems, context) {
    const container = context === 'software' 
        ? document.querySelector('.software-table-container')
        : context === 'demoscene'
        ? document.querySelector('.demoscene-table-container')
        : null;
    
    const platformSelect = container ? container.querySelector('#platform-select') : null;
    if (!platformSelect) return;

    const platforms = getUniquePlatforms(filteredItems);
    platformSelect.innerHTML = `<option value="">${window.t('ui.allPlatforms')}</option>`;
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
 * Обновляет селектор «Фильтр по Демопати» в блоке Демосцена
 * @param {Array} filteredItems - отфильтрованные элементы
 */
function updateDemopartySelect(filteredItems) {
    const container = document.querySelector('.demoscene-table-container');
    const demopartySelect = container ? container.querySelector('#demoparty-select') : null;
    if (!demopartySelect) return;

    const demoparties = getUniqueDemoparties(filteredItems);
    demopartySelect.innerHTML = `<option value="">${window.t('ui.allDemos')}</option>`;
    [...demoparties].sort().forEach(demoparty => {
        const opt = document.createElement('option');
        opt.value = demoparty;
        opt.textContent = demoparty;
        demopartySelect.appendChild(opt);
    });

    if (currentFilters.demoparty && [...demoparties].includes(currentFilters.demoparty)) {
        demopartySelect.value = currentFilters.demoparty;
    } else {
        demopartySelect.value = '';
        currentFilters.demoparty = '';
    }
}

/**
 * Обновляет счетчик для контекста
 * @param {number} count - количество элементов
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function updateCountForContext(count, context) {
    const container = context === 'software' 
        ? document.querySelector('.software-table-container')
        : context === 'demoscene'
        ? document.querySelector('.demoscene-table-container')
        : null;
    
    const countEl = container ? container.querySelector('#count-value') : null;
    if (countEl) {
        countEl.textContent = count;
    }
}

/**
 * Рендерит строки таблицы для контекста
 * @param {HTMLElement} tbody - элемент tbody таблицы
 * @param {Array} items - массив элементов для отображения
 * @param {Function} onItemClick - callback для клика по элементу
 * @param {Function} onFilterClick - callback для клика по фильтру
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function renderTableRowsForContext(tbody, items, onItemClick, onFilterClick, context) {
    const screenshotFolder = context === 'software' 
        ? 'bk_small_screenshots'
        : context === 'demoscene'
        ? 'bk_small_screenshots'
        : 'bk_games_small_screenshots';

    tbody.innerHTML = '';
    items.forEach(item => {
        const screenshot1 = item['Скриншот 1'];
        const screenshotHtml = screenshot1 && screenshot1.trim()
            ? `<img src="${screenshotFolder}/${escapeAttr(screenshot1)}" alt="Screenshot" class="game-screenshot">`
            : '<div class="no-screenshot">—</div>';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="screenshot-cell" data-id="${escapeAttr(item['ID'])}">${screenshotHtml}</td>
            <td class="game-title-cell" data-id="${escapeAttr(item['ID'])}">${escapeHtml(item['Название'])}</td>
            <td class="filterable" data-field="authors" data-value="${escapeAttr(item['Авторы'])}">${escapeHtml(item['Авторы'] || '—')}</td>
            <td class="filterable" data-field="publisher" data-value="${escapeAttr(item['Издатель'])}">${escapeHtml(item['Издатель'] || '—')}</td>
            <td class="filterable" data-field="year" data-value="${escapeAttr(item['Год выпуска'])}">${escapeHtml(item['Год выпуска'] || '—')}</td>
            <td class="filterable" data-field="platform" data-value="${escapeAttr(item['Платформа'])}">${escapeHtml(item['Платформа'] || '—')}</td>
            <td class="filterable" data-field="genre" data-value="${escapeAttr(item['Жанр'])}">${escapeHtml(item['Жанр'] || '—')}</td>
        `;
        tbody.appendChild(row);
    });

    setupGameTitleClickHandlers(tbody, items, onItemClick);
    setupFilterableClickHandlers(tbody, onFilterClick);
}

/**
 * Рендерит алфавитные фильтры для контекста
 * @param {Array} filteredItems - отфильтрованные элементы
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
export function renderAlphabetFiltersForContext(filteredItems, context) {
    if (!Array.isArray(filteredItems) || filteredItems.length === 0) return;

    // Собираем начальные символы из отфильтрованных элементов
    const startsWith = new Set();
    filteredItems.forEach(item => {
        const title = (item['Название'] || '').trim();
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
    const containerSelector = context === 'software' 
        ? '.software-table-container'
        : context === 'demoscene'
        ? '.demoscene-table-container'
        : '.games-table-container';
    
    const mainContainer = document.querySelector(containerSelector);
    const container = mainContainer ? mainContainer.querySelector('#alphabet-filters') : null;
    if (!container) return;

    let html = '';

    // Латиница
    const latinLetters = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
    const latinAvailable = latinLetters.filter(l => startsWith.has(l));
    if (latinAvailable.length > 1 || latinAvailable.includes('#')) {
        html += `<div class="alphabet-filter latin"><span class="alphabet-label" data-i18n="filters.latin">${window.t('filters.latin')}:</span>`;
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
        html += `<div class="alphabet-filter cyrillic"><span class="alphabet-label" data-i18n="filters.cyrillic">${window.t('filters.cyrillic')}:</span>`;
        cyrillicAvailable.forEach(letter => {
            const active = currentFilters.letter === letter ? ' active' : '';
            html += `<button class="alpha-btn${active}" data-letter="${letter}">${letter}</button>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

/**
 * Открывает модальное окно для контекста
 * @param {Object} item - объект элемента
 * @param {Array} allItems - массив всех элементов
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function openModalForContext(item, allItems, context) {
    const modal = document.getElementById('game-modal');
    if (!modal) return;

    // Удаляем старые обработчики клавиатуры (если есть)
    if (window._screenshotKeyHandlers) {
        window._screenshotKeyHandlers.forEach(handler => {
            document.removeEventListener('keydown', handler);
        });
        window._screenshotKeyHandlers = [];
    }

    // Тип для hash и для идентификации текущей открытой карточки
    const hashType = context === 'software'
        ? 'software'
        : context === 'demoscene'
        ? 'demo'
        : 'game';

    // Сохраняем текущий тип и ID в data-атрибутах модального окна,
    // чтобы deep-link обработчик мог понять, открыта ли уже нужная карточка.
    modal.dataset.hashType = hashType;
    modal.dataset.itemId = item['ID'] || '';

    const screenshotFolder = context === 'software' 
        ? 'bk_screenshots'
        : context === 'demoscene'
        ? 'bk_screenshots'
        : 'bk_games_screenshots';

    const fileFolder = context === 'software' 
        ? 'bk_files'
        : context === 'demoscene'
        ? 'bk_files'
        : 'bk_games_files';

    // Заполняем данные (кнопка комментариев, заголовок, иконка «поделиться»)
    const unknown = window.t('common.unknown');
    const titleEl = document.querySelector('.game-modal .game-title');
    if (titleEl) {
        titleEl.innerHTML =
            escapeHtml(item['Название'] || unknown) +
            ' <span class="game-title-share-icon" aria-hidden="true">🔗</span>';
    }
    document.querySelector('.game-genre').textContent = item['Жанр'] || unknown;
    const authorsVal = (item['Авторы'] || '').trim();
    document.querySelector('.game-authors').textContent = authorsVal || unknown;
    const authorPageLink = document.querySelector('.game-modal .author-page-link');
    if (authorPageLink) {
        if (!authorsVal) {
            authorPageLink.style.display = 'none';
            authorPageLink.href = '#';
            authorPageLink.onclick = null;
        } else {
            authorPageLink.style.display = 'inline';
            const authorParts = splitFilterValue(authorsVal);
            if (authorParts.length > 1) {
                authorPageLink.href = '#';
                authorPageLink.onclick = function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    showAuthorPageChoicePopover(authorPageLink, authorParts);
                };
            } else {
                authorPageLink.href = '#author/' + encodeURIComponent(authorParts[0] || authorsVal);
                authorPageLink.onclick = null;
            }
        }
    }
    document.querySelector('.game-publisher').textContent = item['Издатель'] || unknown;
    document.querySelector('.game-date').textContent = item['Дата выхода'] || item['Год выпуска'] || unknown;
    document.querySelector('.game-platform').textContent = item['Платформа'] || unknown;
    document.querySelector('.game-graphics').textContent = item['Графика'] || unknown;
    document.querySelector('.game-music').textContent = item['Музыка'] || unknown;
    document.querySelector('.game-lang').textContent = item['Язык интерфейса'] || unknown;
    document.querySelector('.game-description').textContent = item['Описание'] || '';

    // Исходники и Видео — для игр и демосцены; Демопати/Издатель/Язык — только для демосцены
    const publisherRow = document.querySelector('.game-modal .game-publisher-row');
    const langRow = document.querySelector('.game-modal .game-lang-row');
    const demopartyRow = document.querySelector('.game-modal .game-demoparty-row');
    const sourcesRow = document.querySelector('.game-modal .game-sources-row');
    const videoRow = document.querySelector('.game-modal .game-video-row');
    const videoLink = document.querySelector('.game-modal .game-video-link');
    const demopartyLineEl = document.querySelector('.game-modal .game-demoparty-line');
    const sourcesEl = document.querySelector('.game-modal .game-sources');

    var sourcesVal = (item['Исходники'] || '').trim();
    var githubUrl = (item['ГитХаб'] || '').trim();
    var videoUrl = (item['Видео'] || '').trim();

    if (context === 'games' || context === 'demoscene') {
        if (sourcesRow && sourcesEl) {
            sourcesRow.style.display = '';
            if (sourcesVal === 'Ссылка' && githubUrl) {
                sourcesEl.innerHTML = '<a href="' + escapeAttr(githubUrl) + '" target="_blank" rel="noopener noreferrer">Ссылка</a>';
            } else {
                sourcesEl.textContent = sourcesVal || unknown;
            }
        }
        if (videoRow && videoLink) {
            if (videoUrl) {
                videoLink.href = videoUrl;
                videoRow.style.display = '';
            } else {
                videoLink.href = '#';
                videoRow.style.display = 'none';
            }
        }
    } else {
        if (sourcesRow) sourcesRow.style.display = 'none';
        if (videoRow) videoRow.style.display = 'none';
    }

    if (context === 'demoscene') {
        if (publisherRow) publisherRow.style.display = 'none';
        if (langRow) langRow.style.display = 'none';
        if (demopartyRow) {
            demopartyRow.style.display = '';
            const demopati = (item['Демопати'] || '').trim();
            const compo = (item['Компо'] || '').trim();
            const place = (item['Место'] || '').trim();
            const parts = [];
            if (demopati) parts.push(demopati);
            if (compo) parts.push(compo);
            if (place) parts.push(`${window.t('modal.place')}: ${place}`);
            if (demopartyLineEl) {
                demopartyLineEl.textContent = parts.length ? parts.join(', ') : unknown;
            }
        }
    } else {
        if (publisherRow) publisherRow.style.display = '';
        if (langRow) langRow.style.display = '';
        if (demopartyRow) demopartyRow.style.display = 'none';
    }

    // Выравниваем текст по левому краю
    document.querySelector('.game-meta').style.textAlign = 'left';

    // Скриншоты
    setupScreenshotsForContext(item, screenshotFolder);

    // Файлы
    setupFilesForContext(item, fileFolder);

    // Настраиваем кнопку "Поделиться"
    setupShareButton(item, context);

    // Настраиваем кнопку "Комментарии"
    setupCommentsButton();

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    initGameModal();
    
    // Масштабируем модальное окно, чтобы оно влезло в viewport
    // Используем setTimeout чтобы гарантировать что элемент уже отрендерен
    setTimeout(() => {
        adjustModalScale();
    }, 0);
    
    // Пересчитываем масштаб при изменении размера окна
    window.addEventListener('resize', adjustModalScale);
    // Сохраняем обработчик для удаления при закрытии
    window._modalResizeHandler = adjustModalScale;

    // Обновляем URL hash
    window.location.hash = `${hashType}-${item['ID']}`;
}

/**
 * Настраивает скриншоты в модальном окне для контекста
 * @param {Object} item - объект элемента
 * @param {string} screenshotFolder - папка со скриншотами
 */
function setupScreenshotsForContext(item, screenshotFolder) {
    const screenshots = [];
    for (let i = 1; i <= 12; i++) {
        const key = `Скриншот ${i}`;
        const val = item[key];
        if (val && val.trim()) {
            screenshots.push(`${screenshotFolder}/${val}`);
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

    // Добавляем индикатор загрузки для скриншотов, если нет
    let loaderEl = document.querySelector('.screenshot-loader');
    if (!loaderEl) {
        const viewer = document.querySelector('.screenshots-viewer');
        if (viewer) {
            loaderEl = document.createElement('div');
            loaderEl.className = 'screenshot-loader';
            viewer.appendChild(loaderEl);
        }
    }

    const imgEl = document.querySelector('.screenshot-current');
    const counterEl = document.querySelector('.screenshots-counter');
    let currentIndex = 0;
    let isLoading = false;
    let loadTimeoutId = null;

    function setLoading(loading) {
        isLoading = loading;
        if (loaderEl) {
            loaderEl.style.display = loading ? 'flex' : 'none';
        }
        const prevBtn = document.querySelector('.nav-btn.prev');
        const nextBtn = document.querySelector('.nav-btn.next');
        if (prevBtn) prevBtn.disabled = loading || screenshots.length <= 1;
        if (nextBtn) nextBtn.disabled = loading || screenshots.length <= 1;
    }

    function updateScreenshot() {
        if (screenshots.length === 0) {
            if (imgEl) {
                imgEl.src = '';
                imgEl.alt = window.t('ui.noScreenshots');
                imgEl.style.visibility = 'visible';
                imgEl.style.opacity = '0.5';
            }
            if (counterEl) counterEl.textContent = window.t('ui.noScreenshots');
            document.querySelector('.nav-btn.prev').disabled = true;
            document.querySelector('.nav-btn.next').disabled = true;
        } else {
            if (!imgEl) return;
            setLoading(true);
            imgEl.style.visibility = 'hidden';
            imgEl.style.opacity = '0';
            imgEl.alt = `${window.t('ui.screenshot')} ${currentIndex + 1}`;
            imgEl.onload = () => {
                setLoading(false);
                imgEl.style.visibility = 'visible';
                imgEl.style.opacity = '1';
            };
            imgEl.onerror = () => {
                setLoading(false);
                imgEl.style.visibility = 'visible';
                imgEl.style.opacity = '0.5';
            };
            if (loadTimeoutId) {
                clearTimeout(loadTimeoutId);
                loadTimeoutId = null;
            }
            const nextSrc = screenshots[currentIndex] || '';
            const loadImage = () => {
                imgEl.src = nextSrc;
            };
            if (DEBUG_SLOW_SCREENSHOT_LOAD) {
                loadTimeoutId = setTimeout(loadImage, DEBUG_SLOW_SCREENSHOT_LOAD_DELAY);
            } else {
                requestAnimationFrame(loadImage);
            }
            if (counterEl) counterEl.textContent = `${currentIndex + 1} / ${screenshots.length}`;
        }
    }

    // Кнопки навигации
    document.querySelector('.nav-btn.prev').onclick = () => {
        if (isLoading || screenshots.length <= 1) return;
        currentIndex = currentIndex > 0 ? currentIndex - 1 : screenshots.length - 1;
        updateScreenshot();
    };
    document.querySelector('.nav-btn.next').onclick = () => {
        if (isLoading || screenshots.length <= 1) return;
        currentIndex = currentIndex < screenshots.length - 1 ? currentIndex + 1 : 0;
        updateScreenshot();
    };

    // Обработчик клика для увеличения скриншота (только если есть скриншоты)
    if (screenshots.length > 0) {
        imgEl.addEventListener('click', () => {
            showEnlargedScreenshot(screenshots, currentIndex);
        });
    }

    // Обработчик клавиатуры для навигации по скриншотам
    const keyHandler = (e) => {
        // Проверяем, что модальное окно открыто
        const modal = document.getElementById('game-modal');
        if (!modal || !modal.classList.contains('active')) {
            return;
        }

        // Проверяем, что нет открытого overlay с увеличенным скриншотом
        const overlay = document.querySelector('.screenshot-overlay');
        if (overlay) {
            return;
        }

        if (isLoading || screenshots.length <= 1) {
            return;
        }

        if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            currentIndex = currentIndex > 0 ? currentIndex - 1 : screenshots.length - 1;
            updateScreenshot();
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            e.preventDefault();
            currentIndex = currentIndex < screenshots.length - 1 ? currentIndex + 1 : 0;
            updateScreenshot();
        }
    };

    // Добавляем обработчик клавиатуры
    document.addEventListener('keydown', keyHandler);

    // Сохраняем ссылку на обработчик для возможности его удаления
    if (!window._screenshotKeyHandlers) {
        window._screenshotKeyHandlers = [];
    }
    window._screenshotKeyHandlers.push(keyHandler);

    // Первый скриншот
    updateScreenshot();
    setTimeout(() => {
        if (imgEl) {
            imgEl.style.opacity = screenshots.length > 0 ? '1' : '0.5';
            imgEl.style.transition = 'opacity 0.3s ease';
        }
    }, 50);
}

function isTauriEnvironment() {
    return typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined';
}

/**
 * Возвращает класс WebviewWindow из глобального Tauri API.
 * Tauri 2: __TAURI__.webviewWindow.WebviewWindow
 * Tauri 1: __TAURI__.window.WebviewWindow
 * @returns {Function|null}
 */
function getTauriWebviewWindowClass() {
    const tauri = window.__TAURI__;
    if (!tauri) {
        return null;
    }

    if (typeof tauri.webviewWindow?.WebviewWindow === 'function') {
        return tauri.webviewWindow.WebviewWindow;
    }

    if (typeof tauri.window?.WebviewWindow === 'function') {
        return tauri.window.WebviewWindow;
    }

    return null;
}

/**
 * Создаёт окно эмулятора через Tauri API.
 * @param {string} label - уникальная метка окна
 * @param {Object} options - параметры окна
 * @returns {Promise<boolean>} true, если окно создано
 */
async function createTauriEmulatorWindow(label, options) {
    const WebviewWindow = getTauriWebviewWindowClass();

    if (WebviewWindow) {
        const webview = new WebviewWindow(label, options);
        webview.once('tauri://error', (event) => {
            const message = event?.payload ?? event;
            console.error('Ошибка создания окна эмулятора в Tauri:', message);
        });
        return true;
    }

    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === 'function') {
        try {
            await invoke('plugin:webview|create_webview_window', {
                options: { ...options, label }
            });
            return true;
        } catch (err) {
            console.warn('Не удалось создать окно через Tauri invoke:', err);
        }
    }

    return false;
}

async function openEmulatorWindow(emulatorUrl) {
    if (isTauriEnvironment()) {
        const tauriUrl = emulatorUrl.startsWith('/') ? emulatorUrl : `/${emulatorUrl}`;
        const label = `emulator-${Date.now()}`;
        const windowOptions = {
            url: tauriUrl,
            title: 'BK Emulator',
            width: 1280,
            height: 900
        };

        try {
            const created = await createTauriEmulatorWindow(label, windowOptions);
            if (created) {
                return;
            }

            console.warn('Tauri WebviewWindow API недоступен, fallback к window.open');
        } catch (err) {
            console.warn('Не удалось открыть эмулятор через Tauri WebviewWindow:', err);
        }
    }

    window.open(emulatorUrl, '_blank');
}

window.openEmulatorWindow = openEmulatorWindow;

/**
 * Настраивает файлы в модальном окне для контекста
 * @param {Object} item - объект элемента
 * @param {string} fileFolder - папка с файлами
 */
function setupFilesForContext(item, fileFolder) {
    const fileList = document.querySelector('.file-list');
    fileList.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const nameKey = `Имя файла ${i}`;
        const descKey = `Описание файла ${i}`;
        const name = item[nameKey];
        const desc = item[descKey];
        if (name && name.trim()) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = `${fileFolder}/${name}`;
            a.textContent = `${name} — ${desc || window.t('modal.download')}`;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);

            // Кнопка эмулятора только для файлов с подходящим расширением (.COD .BIN .BKD .IMG .ROM)
            // Для .ZIP кнопку добавляем в logZipContentsForFileList, если внутри архива есть такие файлы
            const isEmulatorFile = /\.(cod|bin|bkd|img|rom)$/i.test(name);
            if (isEmulatorFile) {
                const emulatorBtn = document.createElement('button');
                emulatorBtn.className = 'emulator-launch-btn';
                emulatorBtn.textContent = window.t('modal.runInEmulator');
                emulatorBtn.title = 'Open file in the BK emulator';
                emulatorBtn.style.marginLeft = '10px';

                emulatorBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const fileUrl = `../${fileFolder}/${encodeURIComponent(name)}`;
                    const emulatorUrl = `emulator/bk-emulator.html?URL=${fileUrl}`;
                    openEmulatorWindow(emulatorUrl);

                    if (typeof ym !== 'undefined') {
                        ym(105444555, 'reachGoal', 'emulator_launch', {
                            filename: name,
                            title: item['Название'],
                            authors: item['Авторы'],
                            platform: item['Платформа'],
                            year: item['Год выпуска'],
                            genre: item['Жанр']
                        });
                    }
                });

                li.appendChild(emulatorBtn);
            }

            fileList.appendChild(li);

            // Отправка события в Метрику при скачивании файла
            li.querySelector('a').addEventListener('click', (e) => {
                const filename = a.textContent.split(' — ')[0];
                if (typeof ym !== 'undefined') {
                    ym(105444555, 'reachGoal', 'file_download', {
                        filename: filename,
                        title: item['Название'],
                        authors: item['Авторы'],
                        platform: item['Платформа'],
                        year: item['Год выпуска'],
                        genre: item['Жанр']
                    });
                }
            });
        }
    }
    if (fileList.children.length === 0) {
        fileList.innerHTML = `<li>${window.t('modal.noFiles')}</li>`;
    } else {
        logZipContentsForFileList(fileList, fileFolder, item);
    }
}

/** Расширения файлов, подходящих для запуска в эмуляторе БК */
var EMULATOR_FILE_EXTENSIONS = /\.(cod|bin|bkd|img|rom|foc)$/i;

/**
 * Загружает и выводит в консоль содержимое ZIP‑архивов из списка файлов.
 * Для ZIP с подходящими для эмулятора файлами (.COD .BIN .BKD .IMG .ROM) добавляет кнопку «Запустить в эмуляторе».
 * @param {HTMLElement} fileList - элемент списка файлов (.file-list)
 * @param {string} fileFolder - папка с файлами
 * @param {Object} item - объект элемента карточки (для Метрики)
 */
function logZipContentsForFileList(fileList, fileFolder, item) {
    if (typeof JSZip === 'undefined') {
        console.warn('JSZip не загружен, невозможно прочитать ZIP архивы из file-list.');
        return;
    }

    const links = fileList.querySelectorAll(
        'a[href$=".zip"], a[href$=".ZIP"], a[href*=".zip?"], a[href*=".ZIP?"]'
    );

    if (!links.length) {
        return;
    }

    links.forEach(link => {
        const url = link.href;
        const displayName = (link.textContent || '').split(' — ')[0] || url;

        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.arrayBuffer();
            })
            .then(buffer => {
                if (typeof JSZip.loadAsync === 'function') {
                    return JSZip.loadAsync(buffer);
                }
                return new JSZip(buffer);
            })
            .then(zip => {
                const files = zip.file(/.+/);
                const fileNames = [];
                const audioEntryNames = [];
                let hasEmulatorFile = false;

                const isFocalPlatform = item && typeof item['Платформа'] === 'string' && item['Платформа'].indexOf('ФОКАЛ') >= 0;

                for (let i = 0; i < files.length; i++) {
                    const f = files[i];
                    const name = f.name || '';
                    fileNames.push(name);
                    const lower = name.toLowerCase();
                    if (!f.dir) {
                        if (lower.endsWith('.bin') || lower.endsWith('.ovl')) {
                            audioEntryNames.push(name);
                        }

                        const fileNameOnly = name.substring(name.lastIndexOf('/') + 1);
                        const hasNoExtension = fileNameOnly.length > 0 && fileNameOnly.indexOf('.') < 0;
                        if (EMULATOR_FILE_EXTENSIONS.test(name) || (isFocalPlatform && hasNoExtension)) {
                            hasEmulatorFile = true;
                        }
                    }
                }

                console.group(`Содержимое ZIP файла: ${displayName}`);
                fileNames.forEach(name => {
                    console.log(name);
                });
                console.groupEnd();

                if (audioEntryNames.length > 0) {
                    attachAudioButtonToZipLink(link, url, displayName, audioEntryNames);
                }

                if (hasEmulatorFile && fileFolder != null && item != null) {
                    attachEmulatorButtonToZipLink(link, fileFolder, displayName, item);
                }
            })
            .catch(error => {
                console.error(`Не удалось прочитать ZIP "${displayName}":`, error);
            });
    });
}

/**
 * Добавляет кнопку «Запустить в эмуляторе» к строке с ZIP-ссылкой (если в архиве есть .COD/.BIN/.BKD/.IMG/.ROM).
 * @param {HTMLAnchorElement} link - ссылка на ZIP
 * @param {string} fileFolder - папка с файлами
 * @param {string} fileName - имя ZIP-файла
 * @param {Object} item - объект элемента карточки
 */
function attachEmulatorButtonToZipLink(link, fileFolder, fileName, item) {
    const li = link.closest('li');
    if (!li || li.querySelector('.emulator-launch-btn')) {
        return;
    }

    const emulatorBtn = document.createElement('button');
    emulatorBtn.type = 'button';
    emulatorBtn.className = 'emulator-launch-btn';
    emulatorBtn.textContent = window.t('modal.runInEmulator');
    emulatorBtn.title = 'Open file in the BK emulator';
    emulatorBtn.style.marginLeft = '10px';

    emulatorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const fileUrl = `../${fileFolder}/${encodeURIComponent(fileName)}`;
        const platform = encodeURIComponent(item['Платформа'] || '');
        const emulatorUrl = `emulator/bk-emulator.html?URL=${fileUrl}&PLATFORM=${platform}`;
        openEmulatorWindow(emulatorUrl);

        if (typeof ym !== 'undefined') {
            ym(105444555, 'reachGoal', 'emulator_launch', {
                filename: fileName,
                title: item['Название'],
                authors: item['Авторы'],
                platform: item['Платформа'],
                year: item['Год выпуска'],
                genre: item['Жанр']
            });
        }
    });

    li.appendChild(emulatorBtn);
}

/**
 * Добавляет кнопку "кассеты" рядом с ZIP‑ссылкой и вешает обработчик открытия аудио‑модалки.
 * @param {HTMLAnchorElement} link
 * @param {string} zipUrl
 * @param {string} displayName
 * @param {string[]} entryNames
 */
function attachAudioButtonToZipLink(link, zipUrl, displayName, entryNames) {
    const li = link.closest('li');
    if (!li) return;

    // Не дублируем кнопку, если она уже есть
    if (li.querySelector('.zip-audio-btn')) {
        return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zip-audio-btn';
    btn.title = 'Показать аудиодорожки (BIN/OVL) из архива';
    btn.textContent = window.t('modal.cassette');
    btn.style.marginLeft = '8px';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openZipAudioModal(zipUrl, displayName, entryNames);
    });

    li.appendChild(btn);
}

/**
 * Открывает дополнительное модальное окно с <audio> элементами для BIN/OVL из ZIP.
 * WAV создаются по алгоритму bin2wav и (опционально) сохраняются в localStorage.
 * @param {string} zipUrl
 * @param {string} zipDisplayName
 * @param {string[]} entryNames
 */
function openZipAudioModal(zipUrl, zipDisplayName, entryNames) {
    // Создаём модал, если его ещё нет
    let modal = document.getElementById('audio-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'audio-modal';
        modal.className = 'game-modal audio-modal';
        modal.innerHTML = `
            <div class="game-modal-content">
                <button class="game-modal-close" type="button">&times;</button>
                <div class="game-header">
                    <h3 class="game-title audio-title"></h3>
                </div>
                <div class="audio-list"></div>
            </div>
        `;
        document.body.appendChild(modal);

        // Обработчики закрытия
        const closeBtn = modal.querySelector('.game-modal-close');
        if (closeBtn) {
            closeBtn.onclick = () => closeAudioModal();
        }
        modal.onclick = (e) => {
            if (e.target === modal) {
                closeAudioModal();
            }
        };
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) {
                closeAudioModal();
            }
        });
    }

    const titleEl = modal.querySelector('.audio-title');
    const listEl = modal.querySelector('.audio-list');
    if (!titleEl || !listEl) return;

    titleEl.textContent = `${window.t('modal.audioTracks')} ${zipDisplayName}`;
    listEl.innerHTML = `<div class="audio-loading">${window.t('modal.audioLoading')}</div>`;

    modal.classList.add('active');

    // Загружаем ZIP (ещё раз, независимо от логирования)
    fetch(zipUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            return response.arrayBuffer();
        })
        .then(buffer => {
            if (typeof JSZip.loadAsync === 'function') {
                return JSZip.loadAsync(buffer);
            }
            return new JSZip(buffer);
        })
        .then(async (zip) => {
            listEl.innerHTML = '';

            const items = [];

            for (const entryName of entryNames) {
                const fileObj = zip.file(entryName);
                if (!fileObj) continue;

                // Получаем бинарные данные файла из архива
                let binary;
                if (fileObj.asUint8Array) {
                    binary = fileObj.asUint8Array();
                } else if (fileObj._data && fileObj._data.getContent) {
                    binary = new Uint8Array(fileObj._data.getContent());
                } else if (fileObj.content) {
                    binary = new Uint8Array(fileObj.content);
                } else {
                    continue;
                }

                const baseName = entryName.replace(/^.*[\\/]/, '').replace(/\..*?$/, '') || 'NONAME';

                // Ключ в localStorage для возможного дальнейшего использования
                const storageKey = `bk-wav::${zipUrl}::${entryName}`;

                let wavBytes;

                // Если уже есть в localStorage — можно было бы читать, но для надёжности
                // всегда конвертируем свежие данные, а запись используем как кеш для будущего.
                try {
                    wavBytes = convertBinaryToWav(new Uint8Array(binary), baseName, {
                        model: '10',
                        speedBoost: false
                    });
                } catch (err) {
                    console.error(`Ошибка конвертации ${entryName} в WAV:`, err);
                    continue;
                }

                // Сохраняем в localStorage как base64 (по требованию задачи)
                try {
                    const b64 = uint8ToBase64(wavBytes);
                    localStorage.setItem(storageKey, b64);
                } catch (e) {
                    // localStorage может быть переполнен или запрещён — это не критично для проигрывания
                    console.warn('Не удалось сохранить WAV в localStorage:', e);
                }

                const blob = new Blob([wavBytes], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);

                items.push({ entryName, url });
            }

            if (!items.length) {
                listEl.innerHTML = `<div class="audio-empty">${window.t('modal.audioEmpty')}</div>`;
                return;
            }

            items.forEach(({ entryName, url }) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'audio-item';

                const label = document.createElement('div');
                label.className = 'audio-label';
                label.textContent = entryName;

                const audio = document.createElement('audio');
                audio.controls = true;
                audio.src = url;

                wrapper.appendChild(label);
                wrapper.appendChild(audio);
                listEl.appendChild(wrapper);
            });
        })
        .catch(error => {
            console.error(`Ошибка при подготовке аудио из ZIP "${zipDisplayName}":`, error);
            listEl.innerHTML = `<div class="audio-error">${window.t('modal.audioError')}</div>`;
        });
}

function closeAudioModal() {
    const modal = document.getElementById('audio-modal');
    if (!modal) return;
    if (modal.classList.contains('active')) {
        modal.classList.remove('active');
    }
}

/**
 * Преобразует Uint8Array в base64‑строку.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ToBase64(bytes) {
    let binary = '';
    const len = bytes.length;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Настраивает заголовок модального окна (.game-title) как кнопку «Поделиться».
 * Использует текущий URL из адресной строки в момент клика.
 * @param {Object} item - объект элемента (для Метрики)
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function setupShareButton(item, context) {
    const titleEl = document.querySelector('.game-modal .game-title');
    if (!titleEl) return;

    function doShare(e) {
        if (e) {
            e.preventDefault();
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            if (e.type === 'keydown') e.preventDefault();
        }
        try {
            const urlToCopy = window.location.href;

            function onSuccess() {
                showShareNotification('Ссылка скопирована в буфер обмена!');
                if (typeof ym !== 'undefined') {
                    const hashType = context === 'software' ? 'software' : context === 'demoscene' ? 'demo' : 'game';
                    ym(105444555, 'reachGoal', 'share_link', {
                        type: hashType,
                        id: item['ID'],
                        title: item['Название']
                    });
                }
            }

            function onFailure() {
                fallbackCopyToClipboard(urlToCopy, onSuccess);
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(urlToCopy).then(onSuccess).catch(onFailure);
            } else {
                fallbackCopyToClipboard(urlToCopy, onSuccess);
            }
        } catch (err) {
            console.error('Ошибка «Поделиться»:', err);
            showShareNotification('Не удалось скопировать ссылку');
        }
    }

    titleEl.onclick = doShare;
    titleEl.onkeydown = doShare;
}

/**
 * Конфигурация Giscus для комментариев к карточкам.
 * Работает через https://giscus.app и Discussions в репозитории.
 */
const GISCUS_CONFIG = {
    repo: 'kalininskiy/bk-catalog',
    repoId: 'R_kgDOQX7-LA',
    category: 'Announcements',
    categoryId: 'DIC_kwDOQX7-LM4C2MF5',
    theme: 'gruvbox_light',
    lang: 'ru',
    mapping: 'specific',
    reactionsEnabled: '1',
    emitMetadata: '0',
    inputPosition: 'top'
};

/**
 * Настраивает кнопку «Комментарии» в левом верхнем углу карточки.
 */
function setupCommentsButton() {
    const modal = document.getElementById('game-modal');
    if (!modal) return;

    const btn = modal.querySelector('.game-title-comment-btn');
    if (!btn) return;

    btn.replaceWith(btn.cloneNode(true));
    const newBtn = modal.querySelector('.game-title-comment-btn');
    newBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openCommentsModal();
    });
}

/**
 * Возвращает или создаёт модальное окно комментариев
 */
function getOrCreateCommentsModal() {
    let modal = document.getElementById('comments-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'comments-modal';
        modal.className = 'game-modal comments-modal';
        modal.innerHTML = `
            <div class="game-modal-content">
                <button class="game-modal-close" type="button" aria-label="${window.t('ui.close')}">&times;</button>
                <div class="game-header">
                    <h3 class="game-title comments-modal-title">Комментарии</h3>
                </div>
                <div class="comments-container"></div>
            </div>
        `;
        document.body.appendChild(modal);

        const closeBtn = modal.querySelector('.game-modal-close');
        if (closeBtn) closeBtn.onclick = closeCommentsModal;
        modal.onclick = (e) => {
            if (e.target === modal) closeCommentsModal();
        };
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('active')) closeCommentsModal();
        });
    }
    return modal;
}

/**
 * Открывает модальное окно с комментариями Giscus для текущей карточки (hash #game-123, #software-123, #demo-123).
 * Виджет каждый раз пересоздаётся с текущим term, чтобы новые комментарии попадали в обсуждение именно этой карточки.
 */
function openCommentsModal() {
    const hash = window.location.hash;
    if (!hash || !hash.match(/^#(game|software|demo)-/)) {
        return;
    }

    const modal = getOrCreateCommentsModal();
    const titleEl = modal.querySelector('.comments-modal-title');
    const container = modal.querySelector('.comments-container');
    if (!titleEl || !container) return;

    titleEl.textContent = window.t('ui.comments');
    const term = hash;

    if (!GISCUS_CONFIG.repoId || !GISCUS_CONFIG.categoryId) {
        container.innerHTML = '<p class="comments-setup-hint">Configure Giscus: provide <code>repoId</code> and <code>categoryId</code> in <code>GISCUS_CONFIG</code> (script rendering.js). You can obtain the values at <a href="https://giscus.app" target="_blank" rel="noopener">giscus.app</a>.</p>';
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        return;
    }

    document.querySelectorAll('script[src*="giscus.app"]').forEach(function (s) { s.remove(); });
    document.querySelectorAll('iframe.giscus-frame').forEach(function (f) { f.remove(); });

    container.innerHTML = '<p class="comments-loading">Загрузка комментариев…</p>';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    var script = document.createElement('script');
    script.className = 'giscus';
    script.setAttribute('data-repo', GISCUS_CONFIG.repo);
    script.setAttribute('data-repo-id', GISCUS_CONFIG.repoId);
    script.setAttribute('data-category', GISCUS_CONFIG.category);
    script.setAttribute('data-category-id', GISCUS_CONFIG.categoryId);
    script.setAttribute('data-mapping', GISCUS_CONFIG.mapping);
    script.setAttribute('data-term', term);
    script.setAttribute('data-reactions-enabled', GISCUS_CONFIG.reactionsEnabled);
    script.setAttribute('data-emit-metadata', GISCUS_CONFIG.emitMetadata);
    script.setAttribute('data-input-position', GISCUS_CONFIG.inputPosition);
    script.setAttribute('data-theme', GISCUS_CONFIG.theme);
    script.setAttribute('data-lang', GISCUS_CONFIG.lang);
    script.setAttribute('crossorigin', 'anonymous');
    script.async = true;
    script.src = 'https://giscus.app/client.js?t=' + Date.now();

    script.onload = function () {
        setTimeout(function () {
            var frame = document.querySelector('iframe.giscus-frame');
            if (frame) {
                frame.parentNode.removeChild(frame);
                container.innerHTML = '';
                container.appendChild(frame);
            } else {
                container.innerHTML = '<p class="comments-error">The comments widget did not load. Please try refreshing the page.</p>';
            }
            var giscusScript = document.querySelector('script[src*="giscus.app"]');
            if (giscusScript) giscusScript.remove();
        }, 1500);
    };
    script.onerror = function () {
        container.innerHTML = '<p class="comments-error">Unable to load the comments widget. Please check your internet connection.</p>';
    };

    document.body.appendChild(script);
}

function closeCommentsModal() {
    const modal = document.getElementById('comments-modal');
    if (!modal) return;
    if (modal.classList.contains('active')) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

/**
 * Показывает уведомление о копировании ссылки
 * @param {string} message - текст уведомления
 */
function showShareNotification(message) {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = 'share-notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #4CAF50;
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 100000;
        font-family: var(--font-main);
        font-size: 14px;
        animation: slideDown 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Удаляем через 3 секунды
    setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

/**
 * Fallback для копирования в буфер обмена (для старых браузеров или при отказе Clipboard API)
 * @param {string} text - текст для копирования
 * @param {Function} [onSuccess] - вызывается при успешном копировании (показать уведомление и т.д.)
 */
function fallbackCopyToClipboard(text, onSuccess) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful && typeof onSuccess === 'function') {
            onSuccess();
        } else if (successful) {
            showShareNotification('Ссылка скопирована в буфер обмена!');
        } else {
            showShareNotification('Не удалось скопировать ссылку');
        }
    } catch (err) {
        console.error('Ошибка при копировании:', err);
        showShareNotification('Не удалось скопировать ссылку');
    } finally {
        document.body.removeChild(textArea);
    }
}
