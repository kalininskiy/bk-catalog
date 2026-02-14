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
 * Модуль для обработки событий интерфейса
 */

import { debounce } from './utils.js';

/**
 * Инициализирует базовые обработчики событий (навигация, поиск, таблица)
 * @param {Object} config - конфигурация с callback функциями
 */
export function initEventHandlers(config) {
    const {
        onGamesLinkClick,
        onHomeLinkClick,
        onSearchInput,
        onResetSearch,
        onTableHeaderClick,
        onGenreChange,
        onPlatformChange,
        onResetFilters,
        onAlphabetButtonClick
    } = config;

    // Очистка поля поиска при загрузке страницы
    clearSearchField();

    // Обработчики навигационных ссылок (только если передан callback)
    if (onGamesLinkClick) {
        setupNavigationHandlers(onGamesLinkClick, onHomeLinkClick, null, null);
    }

    // Обработчик переключателя шрифтов
    setupFontToggleHandler();

    // Обработчики поиска
    setupSearchHandlers(onSearchInput, onResetSearch);

    // Обработчики таблицы
    setupTableHandlers(onTableHeaderClick, onGenreChange, onPlatformChange, onResetFilters);

    // Обработчики алфавитных фильтров инициализируются отдельно после рендеринга
}

/**
 * Инициализирует обработчики алфавитных фильтров
 * @param {Function} onAlphabetButtonClick - callback для клика по букве алфавита
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
export function initAlphabetHandlers(onAlphabetButtonClick, context = 'games') {
    setupAlphabetHandlers(onAlphabetButtonClick, context);
}

/**
 * Инициализирует базовые обработчики событий для софта
 * @param {Object} config - конфигурация с callback функциями
 */
export function initSoftwareEventHandlers(config) {
    const {
        onSoftwareLinkClick,
        onHomeLinkClick,
        onSearchInput,
        onResetSearch,
        onTableHeaderClick,
        onGenreChange,
        onPlatformChange,
        onResetFilters,
        onAlphabetButtonClick
    } = config;

    // Очистка поля поиска при загрузке страницы
    clearSearchFieldForContext('software');

    // Обработчики навигационных ссылок
    setupNavigationHandlers(null, onHomeLinkClick, onSoftwareLinkClick, null);

    // Обработчик переключателя шрифтов (если еще не инициализирован)
    setupFontToggleHandler();

    // Обработчики поиска
    setupSearchHandlersForContext(onSearchInput, onResetSearch, 'software');

    // Обработчики таблицы
    setupTableHandlersForContext(onTableHeaderClick, onGenreChange, onPlatformChange, onResetFilters, 'software');
}

/**
 * Инициализирует базовые обработчики событий для демосцены
 * @param {Object} config - конфигурация с callback функциями
 */
export function initDemosceneEventHandlers(config) {
    const {
        onDemosceneLinkClick,
        onHomeLinkClick,
        onSearchInput,
        onResetSearch,
        onTableHeaderClick,
        onGenreChange,
        onPlatformChange,
        onResetFilters,
        onAlphabetButtonClick
    } = config;

    // Очистка поля поиска при загрузке страницы
    clearSearchFieldForContext('demoscene');

    // Обработчики навигационных ссылок
    setupNavigationHandlers(null, onHomeLinkClick, null, onDemosceneLinkClick);

    // Обработчик переключателя шрифтов (если еще не инициализирован)
    setupFontToggleHandler();

    // Обработчики поиска
    setupSearchHandlersForContext(onSearchInput, onResetSearch, 'demoscene');

    // Обработчики таблицы
    setupTableHandlersForContext(onTableHeaderClick, onGenreChange, onPlatformChange, onResetFilters, 'demoscene');
}

/**
 * Убирает hash #docs из URL (при переходе в другие разделы)
 */
function clearDocsHash() {
    if (window.location.hash === '#docs') {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}

/**
 * Устанавливает активный пункт меню
 * @param {string} section - 'home' | 'games' | 'software' | 'demoscene' | 'docs'
 */
export function setNavActive(section) {
    const navLinks = document.querySelectorAll('.nav-menu a');
    const map = {
        home: 'Главная',
        games: 'Игры',
        software: 'Софт',
        demoscene: 'Демосцена',
        docs: 'Документация'
    };
    const match = map[section];
    navLinks.forEach(link => {
        link.classList.remove('nav-item-active');
        if (match && link.textContent.includes(match)) {
            link.classList.add('nav-item-active');
        }
    });
}
// Доступ для скриптов без модулей (например markdown.js)
if (typeof window !== 'undefined') window.setNavActive = setNavActive;

/**
 * Устанавливает обработчики навигационных ссылок
 * @param {Function} onGamesLinkClick - callback для ссылки игр
 * @param {Function} onHomeLinkClick - callback для главной страницы
 * @param {Function} onSoftwareLinkClick - callback для ссылки софта (опционально)
 * @param {Function} onDemosceneLinkClick - callback для ссылки демосцены (опционально)
 */
function setupNavigationHandlers(onGamesLinkClick, onHomeLinkClick, onSoftwareLinkClick, onDemosceneLinkClick) {
    // Проверяем, не были ли обработчики уже установлены
    if (window._navigationHandlersSetup) {
        // Обновляем callback'и
        if (onGamesLinkClick) window._navCallbacks.onGamesLinkClick = onGamesLinkClick;
        if (onHomeLinkClick) window._navCallbacks.onHomeLinkClick = onHomeLinkClick;
        if (onSoftwareLinkClick) window._navCallbacks.onSoftwareLinkClick = onSoftwareLinkClick;
        if (onDemosceneLinkClick) window._navCallbacks.onDemosceneLinkClick = onDemosceneLinkClick;
        return;
    }

    // Инициализируем хранилище callback'ов
    window._navCallbacks = {
        onGamesLinkClick,
        onHomeLinkClick,
        onSoftwareLinkClick,
        onDemosceneLinkClick
    };

    const navLinks = document.querySelectorAll('.nav-menu a');

    navLinks.forEach(link => {
        link.addEventListener('click', e => {
            const text = link.textContent;
            // Ссылка «Эмулятор» открывается в новом окне — не перехватываем
            if (text.includes('Эмулятор')) return;

            e.preventDefault();
            clearSearchField();

            if (text.includes('Игры') && window._navCallbacks.onGamesLinkClick) {
                clearDocsHash();
                setNavActive('games');
                window._navCallbacks.onGamesLinkClick();
            } else if (text.includes('Софт') && window._navCallbacks.onSoftwareLinkClick) {
                clearDocsHash();
                setNavActive('software');
                window._navCallbacks.onSoftwareLinkClick();
            } else if (text.includes('Демосцена') && window._navCallbacks.onDemosceneLinkClick) {
                clearDocsHash();
                setNavActive('demoscene');
                window._navCallbacks.onDemosceneLinkClick();
            } else if (text.includes('Главная') && window._navCallbacks.onHomeLinkClick) {
                clearDocsHash();
                setNavActive('home');
                window._navCallbacks.onHomeLinkClick();
            } else if (text.includes('Документация')) {
                setNavActive('docs');
                window.location.hash = '#docs';
            }
        });
    });

    setNavActive('home');
    window._navigationHandlersSetup = true;
}

/**
 * Устанавливает обработчики поиска
 * @param {Function} onSearchInput - callback для ввода в поиск
 * @param {Function} onResetSearch - callback для сброса поиска
 */
function setupSearchHandlers(onSearchInput, onResetSearch) {
    setupSearchHandlersForContext(onSearchInput, onResetSearch, 'games');
}

/**
 * Устанавливает обработчики поиска для контекста
 * @param {Function} onSearchInput - callback для ввода в поиск
 * @param {Function} onResetSearch - callback для сброса поиска
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function setupSearchHandlersForContext(onSearchInput, onResetSearch, context) {
    const containerSelector = context === 'software' 
        ? '.software-table-container'
        : context === 'demoscene'
        ? '.demoscene-table-container'
        : '.games-table-container';
    
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const searchInput = container.querySelector('#search-input');
    const resetSearchBtn = container.querySelector('#reset-search');

    if (searchInput) {
        const debouncedSearch = debounce(() => {
            onSearchInput(searchInput.value.trim());
        }, 300);
        searchInput.addEventListener('input', debouncedSearch);
    }

    if (resetSearchBtn) {
        resetSearchBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            onResetSearch();
        });
    }
}

/**
 * Устанавливает обработчики таблицы
 * @param {Function} onTableHeaderClick - callback для клика по заголовку столбца
 * @param {Function} onGenreChange - callback для изменения жанра
 * @param {Function} onPlatformChange - callback для изменения платформы
 * @param {Function} onResetFilters - callback для сброса фильтров
 */
function setupTableHandlers(onTableHeaderClick, onGenreChange, onPlatformChange, onResetFilters) {
    setupTableHandlersForContext(onTableHeaderClick, onGenreChange, onPlatformChange, onResetFilters, 'games');
}

/**
 * Устанавливает обработчики таблицы для контекста
 * @param {Function} onTableHeaderClick - callback для клика по заголовку столбца
 * @param {Function} onGenreChange - callback для изменения жанра
 * @param {Function} onPlatformChange - callback для изменения платформы
 * @param {Function} onResetFilters - callback для сброса фильтров
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function setupTableHandlersForContext(onTableHeaderClick, onGenreChange, onPlatformChange, onResetFilters, context) {
    const containerSelector = context === 'software' 
        ? '.software-table-container'
        : context === 'demoscene'
        ? '.demoscene-table-container'
        : '.games-table-container';
    
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const tableClass = context === 'software' 
        ? '.software-table'
        : context === 'demoscene'
        ? '.demoscene-table'
        : '.games-table';

    // Обработчик клика по заголовкам таблицы для сортировки
    const thead = container.querySelector(`${tableClass} thead`);
    if (thead) {
        thead.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort]');
            if (!th) return;
            onTableHeaderClick(th.dataset.sort);
        });
    }

    // Обработчик изменения селектора жанров
    const genreSelect = container.querySelector('#genre-select');
    if (genreSelect) {
        const debouncedGenreChange = debounce((e) => {
            onGenreChange(e.target.value);
        }, 150);
        genreSelect.addEventListener('change', debouncedGenreChange);
    }

    // Обработчик изменения селектора платформ
    const platformSelect = container.querySelector('#platform-select');
    if (platformSelect) {
        const debouncedPlatformChange = debounce((e) => {
            onPlatformChange(e.target.value);
        }, 150);
        platformSelect.addEventListener('change', debouncedPlatformChange);
    }

    // Обработчик сброса фильтров
    const resetFiltersBtn = container.querySelector('#reset-filters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', onResetFilters);
    }
}

/**
 * Устанавливает обработчики алфавитных фильтров
 * @param {Function} onAlphabetButtonClick - callback для клика по букве алфавита
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function setupAlphabetHandlers(onAlphabetButtonClick, context = 'games') {
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('alpha-btn')) {
            const btn = e.target;
            const group = btn.closest('.alphabet-filter');
            const otherGroup = group.classList.contains('latin')
                ? group.parentNode.querySelector('.cyrillic')
                : group.parentNode.querySelector('.latin');

            group.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
            otherGroup?.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));

            btn.classList.add('active');
            const letter = btn.dataset.letter;
            onAlphabetButtonClick(letter);
        }
    });
}

/**
 * Очищает поле поиска
 */
function clearSearchField() {
    clearSearchFieldForContext('games');
}

/**
 * Очищает поле поиска для контекста
 * @param {string} context - контекст ('games', 'software', 'demoscene')
 */
function clearSearchFieldForContext(context) {
    const containerSelector = context === 'software' 
        ? '.software-table-container'
        : context === 'demoscene'
        ? '.demoscene-table-container'
        : '.games-table-container';
    
    const container = document.querySelector(containerSelector);
    const searchInput = container ? container.querySelector('#search-input') : null;
    if (searchInput) {
        searchInput.value = '';
    }
}

/**
 * Устанавливает обработчик переключателя шрифтов
 */
function setupFontToggleHandler() {
    const fontToggleCheckbox = document.getElementById('font-toggle-checkbox');

    if (fontToggleCheckbox) {
        // Восстанавливаем состояние из localStorage
        const savedFontPreference = localStorage.getItem('fontPreference');
        if (savedFontPreference === 'standard') {
            fontToggleCheckbox.checked = true;
            document.body.classList.add('standard-font');
        }

        // Обработчик изменения
        fontToggleCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.body.classList.add('standard-font');
                localStorage.setItem('fontPreference', 'standard');
            } else {
                document.body.classList.remove('standard-font');
                localStorage.setItem('fontPreference', 'dot-matrix');
            }
        });
    }
}
