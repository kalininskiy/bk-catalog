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

import { parseCSV } from './utils.js';
import { setRenderingState, renderGamesTable, renderAlphabetFilters, openGameModal, closeModal } from './rendering.js';
import { initEventHandlers, initAlphabetHandlers } from './events.js';

/**
 * Основной модуль для работы с каталогом игр БК-0010/0011
 */

document.addEventListener('DOMContentLoaded', () => {
    let allGames = [];

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

    let currentSort = { field: 'Название', dir: 'asc' };

    // Устанавливаем состояние для модуля рендеринга
    setRenderingState(currentFilters, currentSort);

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

    // ——— ОБРАБОТЧИКИ СОБЫТИЙ ———

    /**
     * Обработчик клика по названию игры
     * @param {Object} game - объект игры
     */
    function handleGameClick(game) {
        // Отправляем событие в Метрику
        if (typeof ym !== 'undefined') {
            ym(105444555, 'reachGoal', 'game_open', {
                title: game['Название'],
                authors: game['Авторы'],
                platform: game['Платформа'],
                year: game['Год выпуска'],
                genre: game['Жанр']
            });
        }
        openGameModal(game, allGames);
    }

    /**
     * Обработчик клика по фильтруемой ячейке
     * @param {string} field - поле фильтра
     * @param {string} value - значение фильтра
     */
    function handleFilterClick(field, value) {
        if (field === 'platform') {
            currentFilters.platform = value;
        } else {
            currentFilters[field] = value;
        }
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Сброс одного фильтра (вызывается при клике по × в блоке активных фильтров)
     * @param {string} field - поле фильтра (letter, search, platform, genre, authors, publisher, year)
     */
    function handleClearFilter(field) {
        if (!currentFilters.hasOwnProperty(field)) return;
        currentFilters[field] = '';
        if (field === 'search') {
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = '';
        }
        if (field === 'genre') {
            const genreSelect = document.getElementById('genre-select');
            if (genreSelect) genreSelect.value = '';
        }
        if (field === 'platform') {
            const platformSelect = document.getElementById('platform-select');
            if (platformSelect) platformSelect.value = '';
        }
        if (field === 'letter') {
            document.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));
        }
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик клика по ссылке игр
     */
    function handleGamesLinkClick() {
        showGamesTable();
    }

    /**
     * Обработчик клика по ссылке "Главная"
     */
    function handleHomeLinkClick() {
        // Сбрасываем сортировку при уходе с страницы игр
        resetSorting();

        document.querySelector('.content-wrapper').style.display = 'flex';
        document.querySelector('.footer-block').style.display = 'block';
        document.querySelector('.page-copyright').style.display = 'block';
        document.querySelector('.games-table-container').style.display = 'none';
        document.querySelector('.software-table-container').style.display = 'none';
        document.querySelector('.demoscene-table-container').style.display = 'none';
        document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
    }

    /**
     * Обработчик ввода в поле поиска
     * @param {string} value - значение поиска
     */
    function handleSearchInput(value) {
        currentFilters.search = value;
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик сброса поиска
     */
    function handleResetSearch() {
        currentFilters.search = '';
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик клика по заголовку столбца таблицы
     * @param {string} field - поле для сортировки
     */
    function handleTableHeaderClick(field) {
        if (currentSort.field === field) {
            currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.field = field;
            currentSort.dir = 'asc';
        }

        document.querySelectorAll('.games-table th').forEach(el => {
            el.classList.remove('sort-asc', 'sort-desc');
        });

        const th = document.querySelector(`th[data-sort="${field}"]`);
        if (th) {
            th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        }

        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик изменения жанра
     * @param {string} value - выбранный жанр
     */
    function handleGenreChange(value) {
        currentFilters.genre = value;
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик изменения платформы
     * @param {string} value - выбранная платформа
     */
    function handlePlatformChange(value) {
        currentFilters.platform = value;
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Сброс сортировки к начальному состоянию
     */
    function resetSorting() {
        currentSort = { field: 'Название', dir: 'asc' };
        // Сбрасываем визуальное состояние заголовков таблицы
        document.querySelectorAll('.games-table th').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
        });
    }

    /**
     * Обработчик сброса всех фильтров
     */
    function handleResetFilters() {
        currentFilters = {
            genre: '',
            authors: '',
            publisher: '',
            year: '',
            platform: '',
            letter: '',
            search: '',
        };

        // Сбрасываем сортировку
        resetSorting();

        const genreSelect = document.getElementById('genre-select');
        if (genreSelect) {
            genreSelect.value = '';
        }

        const platformSelect = document.getElementById('platform-select');
        if (platformSelect) {
            platformSelect.value = '';
        }

        document.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));

        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.value = '';

        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик клика по букве алфавита
     * @param {string} letter - выбранная буква
     */
    function handleAlphabetButtonClick(letter) {
        currentFilters.letter = letter;
        setRenderingState(currentFilters, currentSort);
        renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Показывает таблицу игр
     */
    function showGamesTable() {
        // Сбрасываем фильтры и сортировку
        currentFilters = {
            genre: '',
            authors: '',
            publisher: '',
            year: '',
            platform: '',
            letter: '',
            search: ''
        };
        resetSorting();

        // Устанавливаем обновленное состояние для модуля рендеринга
        setRenderingState(currentFilters, currentSort);

        // Сбрасываем значение селектора жанров (визуально)
        const genreSelect = document.getElementById('genre-select');
        if (genreSelect) genreSelect.value = '';

        // Сбрасываем значение селектора платформ (визуально)
        const platformSelect = document.getElementById('platform-select');
        if (platformSelect) platformSelect.value = '';

        // Перезагружаем данные и рендерим
        loadGamesData().then(() => {
            renderAlphabetFilters(allGames);
            initAlphabetHandlers(handleAlphabetButtonClick);
            renderGamesTable(allGames, handleGameClick, handleFilterClick, handleClearFilter);
        });

        // Подсвечиваем таблицу
        const tableContainer = document.querySelector('.games-table-container');
        tableContainer.style.backgroundColor = '#fdfcf9';
        setTimeout(() => {
            tableContainer.style.backgroundColor = '';
        }, 15);
    }

    // Инициализируем базовые обработчики событий (навигация, поиск)
    initEventHandlers({
        onGamesLinkClick: handleGamesLinkClick,
        onHomeLinkClick: handleHomeLinkClick,
        onSearchInput: handleSearchInput,
        onResetSearch: handleResetSearch,
        onTableHeaderClick: handleTableHeaderClick,
        onGenreChange: handleGenreChange,
        onPlatformChange: handlePlatformChange,
        onResetFilters: handleResetFilters,
        onAlphabetButtonClick: handleAlphabetButtonClick
    });
});
