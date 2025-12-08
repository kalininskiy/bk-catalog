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

    // Обработчики навигационных ссылок
    setupNavigationHandlers(onGamesLinkClick, onHomeLinkClick);

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
 */
export function initAlphabetHandlers(onAlphabetButtonClick) {
    setupAlphabetHandlers(onAlphabetButtonClick);
}

/**
 * Устанавливает обработчики навигационных ссылок
 * @param {Function} onGamesLinkClick - callback для ссылки игр
 * @param {Function} onHomeLinkClick - callback для главной страницы
 */
function setupNavigationHandlers(onGamesLinkClick, onHomeLinkClick) {
    const navLinks = document.querySelectorAll('.nav-menu a');

    navLinks.forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            clearSearchField();

            const text = link.textContent;
            if (text.includes('Игры')) {
                onGamesLinkClick();
            } else if (text.includes('Главная')) {
                onHomeLinkClick();
            } else if (text.includes('Документация')) {
                window.location.hash = '#docs';
            }
        });
    });
}

/**
 * Устанавливает обработчики поиска
 * @param {Function} onSearchInput - callback для ввода в поиск
 * @param {Function} onResetSearch - callback для сброса поиска
 */
function setupSearchHandlers(onSearchInput, onResetSearch) {
    const searchInput = document.getElementById('search-input');
    const resetSearchBtn = document.getElementById('reset-search');

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
    // Обработчик клика по заголовкам таблицы для сортировки
    document.querySelector('.games-table-container thead').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        onTableHeaderClick(th.dataset.sort);
    });

    // Обработчик изменения селектора жанров
    const debouncedGenreChange = debounce((e) => {
        onGenreChange(e.target.value);
    }, 150);
    document.getElementById('genre-select')?.addEventListener('change', debouncedGenreChange);

    // Обработчик изменения селектора платформ
    const debouncedPlatformChange = debounce((e) => {
        onPlatformChange(e.target.value);
    }, 150);
    document.getElementById('platform-select')?.addEventListener('change', debouncedPlatformChange);

    // Обработчик сброса фильтров
    document.getElementById('reset-filters')?.addEventListener('click', onResetFilters);
}

/**
 * Устанавливает обработчики алфавитных фильтров
 * @param {Function} onAlphabetButtonClick - callback для клика по букве алфавита
 */
function setupAlphabetHandlers(onAlphabetButtonClick) {
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('alpha-btn')) {
            const btn = e.target;
            const group = btn.closest('.alphabet-filter');
            const otherGroup = group.classList.contains('latin')
                ? document.querySelector('.cyrillic')
                : document.querySelector('.latin');

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
    const searchInput = document.getElementById('search-input');
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
