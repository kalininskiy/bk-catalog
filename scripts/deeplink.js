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
import { openGameModal, openSoftwareModal, openDemosceneModal, closeModal } from './rendering.js';

/**
 * Модуль для работы с deep linking через URL hash
 */

/**
 * Сбрасывает «страницу автора» в URL: удаляет __urlFilter и hash #author/...
 * Вызывать при «Сброс фильтров» или при сбросе фильтра «Авторы» (×).
 */
export function clearAuthorPageUrl() {
    if (window.__urlFilter) delete window.__urlFilter;
    if (window.location.hash && window.location.hash.match(/^#author\//)) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }
}

/**
 * Обрабатывает hash «страницы автора»: #author/Имя%20Автора
 * Устанавливает window.__urlFilter и диспатчит событие для открытия таблицы с фильтром.
 */
function handleAuthorPageLink() {
    const hash = window.location.hash;
    const match = hash.match(/^#author\/(.+)$/);
    if (!match) return;
    try {
        const authorName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        if (!authorName.trim()) return;
        closeModal();
        window.__urlFilter = { authors: authorName.trim() };
        window.dispatchEvent(new CustomEvent('openAuthorPage', { detail: { authorName: authorName.trim() } }));
    } catch (e) {
        console.warn('Некорректный hash страницы автора:', hash);
    }
}

/**
 * Разделы каталога и глобальные переменные, через которые модули таблиц
 * открывают свою таблицу (их выставляют games.js, software.js, demoscene.js).
 */
var CATALOG_SHOW_GLOBALS = {
    games: '__showGamesTable',
    software: '__showSoftwareTable',
    demoscene: '__showDemosceneTable'
};

/**
 * Обрабатывает hash вида #games?genre=...&year=... — каталог с переданными фильтрами.
 * Такую ссылку сайт пишет в адресную строку и копирует кнопкой в блоке «Активные фильтры».
 * @returns {boolean} true, если hash оказался ссылкой на отфильтрованный каталог
 */
function handleCatalogFilterLink() {
    const match = window.location.hash.match(/^#(games|software|demoscene)(?:\?(.*))?$/);
    if (!match) return false;

    const showTable = window[CATALOG_SHOW_GLOBALS[match[1]]];
    if (typeof showTable !== 'function') return false;

    // Фильтры применяются один раз при открытии таблицы, чтобы не переходили в другие разделы
    window.__urlFilter = Object.fromEntries(new URLSearchParams(match[2] || ''));
    showTable();
    delete window.__urlFilter;

    return true;
}

/**
 * Загружает и открывает карточку на основе hash в URL
 */
export async function handleDeepLink() {
    const hash = window.location.hash;
    if (!hash) return;

    // Каталог с фильтрами (#games?genre=..., #software?..., #demoscene?...)
    if (handleCatalogFilterLink()) return;

    // Страница автора (фильтр по колонке «Авторы»)
    if (hash.match(/^#author\//)) {
        handleAuthorPageLink();
        return;
    }

    // Парсим hash: #game-12345, #software-67890, #demo-11111
    const match = hash.match(/^#(game|software|demo)-(.+)$/);
    if (!match) return;

    const [, type, id] = match;

    try {
        let csvFile, openModalFunc;

        switch (type) {
            case 'game':
                csvFile = 'content/games.csv';
                openModalFunc = openGameModal;
                break;
            case 'software':
                csvFile = 'content/software.csv';
                openModalFunc = openSoftwareModal;
                break;
            case 'demo':
                csvFile = 'content/demoscene.csv';
                openModalFunc = openDemosceneModal;
                break;
            default:
                return;
        }

        // Загружаем данные
        const response = await fetch(csvFile);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const csvText = await response.text();
        const items = parseCSV(csvText);

        // Находим элемент по ID
        const item = items.find(i => i['ID'] === id);
        if (!item) {
            console.warn(`Элемент с ID ${id} не найден в ${csvFile}`);
            return;
        }

        // Если модальное окно уже открыто для этой же карточки, повторно не открываем
        const modal = document.getElementById('game-modal');
        if (modal && modal.classList.contains('active')) {
            const currentType = modal.dataset.hashType;
            const currentId = modal.dataset.itemId;
            if (currentType === type && currentId === id) {
                return;
            }
        }

        // Открываем модальное окно
        openModalFunc(item, items);

    } catch (err) {
        console.error('Ошибка при загрузке deep link:', err);
    }
}

/**
 * Инициализирует обработку deep links
 */
function initDeepLinking() {
    // Обработка при загрузке страницы
    setTimeout(() => {
        handleDeepLink();
    }, 100);

    // Обработка при изменении hash (кнопки назад/вперед)
    window.addEventListener('hashchange', () => {
        if (handleCatalogFilterLink()) {
            return;
        }
        const hash = window.location.hash;
        if (hash.match(/^#author\//)) {
            handleAuthorPageLink();
            return;
        }
        if (hash.match(/^#(game|software|demo)-/)) {
            handleDeepLink();
            return;
        }
        const modal = document.getElementById('game-modal');
        if (modal && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

// Инициализируем при загрузке
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeepLinking);
} else {
    initDeepLinking();
}
