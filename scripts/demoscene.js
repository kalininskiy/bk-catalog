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
import { setRenderingState, renderDemosceneTable, renderAlphabetFilters, openDemosceneModal, closeModal } from './rendering.js';
import { initDemosceneEventHandlers, initAlphabetHandlers, setNavActive } from './events.js';
import { clearAuthorPageUrl } from './deeplink.js';

/**
 * Основной модуль для работы с каталогом демосцены БК-0010/0011
 */

document.addEventListener('DOMContentLoaded', () => {
    let allDemoscene = [];

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
    setRenderingState(currentFilters, currentSort, 'demoscene');

    // ——— ЗАГРУЗКА И ПАРСИНГ CSV ———
    async function loadDemosceneData() {
        if (allDemoscene.length) return allDemoscene;
        try {
            const response = await fetch('content/demoscene.csv');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const csvText = await response.text();
            allDemoscene = parseCSV(csvText);
            return allDemoscene;
        } catch (err) {
            console.error('Ошибка загрузки demoscene.csv:', err);
            alert('Не удалось загрузить список демосцены.');
            return [];
        }
    }

    // ——— ОБРАБОТЧИКИ СОБЫТИЙ ———

    /**
     * Обработчик клика по названию демо
     * @param {Object} demo - объект демо
     */
    function handleDemosceneClick(demo) {
        // Отправляем событие в Метрику
        if (typeof ym !== 'undefined') {
            ym(105444555, 'reachGoal', 'demoscene_open', {
                title: demo['Название'],
                authors: demo['Авторы'],
                platform: demo['Платформа'],
                year: demo['Год выпуска'],
                genre: demo['Жанр']
            });
        }
        openDemosceneModal(demo, allDemoscene);
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
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Сброс одного фильтра (при клике по × в блоке активных фильтров)
     */
    function handleClearFilter(field) {
        if (!currentFilters.hasOwnProperty(field)) return;
        if (field === 'authors') clearAuthorPageUrl();
        currentFilters[field] = '';
        const container = document.querySelector('.demoscene-table-container');
        if (container) {
            if (field === 'search') {
                const el = container.querySelector('#search-input');
                if (el) el.value = '';
            }
            if (field === 'genre') {
                const el = container.querySelector('#genre-select');
                if (el) el.value = '';
            }
            if (field === 'platform') {
                const el = container.querySelector('#platform-select');
                if (el) el.value = '';
            }
        }
        if (field === 'letter') {
            document.querySelectorAll('.demoscene-table-container .alpha-btn').forEach(b => b.classList.remove('active'));
        }
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик клика по ссылке демосцены
     */
    function handleDemosceneLinkClick() {
        showDemosceneTable();
    }

    /**
     * Обработчик клика по ссылке "Главная"
     */
    function handleHomeLinkClick() {
        // Сбрасываем сортировку при уходе с страницы демосцены
        resetSorting();

        document.querySelector('.content-wrapper').style.display = 'flex';
        document.querySelector('.footer-block').style.display = 'block';
        document.querySelector('.page-copyright').style.display = 'block';
        document.querySelector('.games-table-container').style.display = 'none';
        document.querySelector('.software-table-container').style.display = 'none';
        document.querySelector('.demoscene-table-container').style.display = 'none';
        document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
        document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
    }

    /**
     * Обработчик ввода в поле поиска
     * @param {string} value - значение поиска
     */
    function handleSearchInput(value) {
        currentFilters.search = value;
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик сброса поиска
     */
    function handleResetSearch() {
        currentFilters.search = '';
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
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

        document.querySelectorAll('.demoscene-table th').forEach(el => {
            el.classList.remove('sort-asc', 'sort-desc');
        });

        const th = document.querySelector('.demoscene-table th[data-sort="' + field + '"]');
        if (th) {
            th.classList.add(currentSort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
        }

        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик изменения жанра
     * @param {string} value - выбранный жанр
     */
    function handleGenreChange(value) {
        currentFilters.genre = value;
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик изменения платформы
     * @param {string} value - выбранная платформа
     */
    function handlePlatformChange(value) {
        currentFilters.platform = value;
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Сброс сортировки к начальному состоянию
     */
    function resetSorting() {
        currentSort = { field: 'Название', dir: 'asc' };
        // Сбрасываем визуальное состояние заголовков таблицы
        document.querySelectorAll('.demoscene-table th').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
        });
    }

    /**
     * Обработчик сброса всех фильтров
     */
    function handleResetFilters() {
        clearAuthorPageUrl();
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

        const container = document.querySelector('.demoscene-table-container');
        const genreSelect = container.querySelector('#genre-select');
        if (genreSelect) {
            genreSelect.value = '';
        }

        const platformSelect = container.querySelector('#platform-select');
        if (platformSelect) {
            platformSelect.value = '';
        }

        container.querySelectorAll('.alpha-btn').forEach(b => b.classList.remove('active'));

        const searchInput = container.querySelector('#search-input');
        if (searchInput) searchInput.value = '';

        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Обработчик клика по букве алфавита
     * @param {string} letter - выбранная буква
     */
    function handleAlphabetButtonClick(letter) {
        currentFilters.letter = letter;
        setRenderingState(currentFilters, currentSort, 'demoscene');
        renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
    }

    /**
     * Показывает таблицу демосцены
     */
    function showDemosceneTable() {
        setNavActive('demoscene');
        currentFilters = {
            genre: '', authors: '', publisher: '', year: '', platform: '', letter: '', search: ''
        };
        if (window.__urlFilter) Object.assign(currentFilters, window.__urlFilter);
        resetSorting();

        setRenderingState(currentFilters, currentSort, 'demoscene');

        const container = document.querySelector('.demoscene-table-container');

        // Сбрасываем значение селектора жанров (визуально)
        const genreSelect = container.querySelector('#genre-select');
        if (genreSelect) genreSelect.value = '';

        // Сбрасываем значение селектора платформ (визуально)
        const platformSelect = container.querySelector('#platform-select');
        if (platformSelect) platformSelect.value = '';

        // Перезагружаем данные и рендерим
        loadDemosceneData().then(() => {
            renderAlphabetFilters(allDemoscene, 'demoscene');
            initAlphabetHandlers(handleAlphabetButtonClick, 'demoscene');
            renderDemosceneTable(allDemoscene, handleDemosceneClick, handleFilterClick, handleClearFilter);
        });

        // Подсвечиваем таблицу
        const tableContainer = document.querySelector('.demoscene-table-container');
        tableContainer.style.backgroundColor = '#fdfcf9';
        setTimeout(() => {
            tableContainer.style.backgroundColor = '';
        }, 15);
    }

    // Инициализируем базовые обработчики событий (навигация, поиск)
    initDemosceneEventHandlers({
        onDemosceneLinkClick: handleDemosceneLinkClick,
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
