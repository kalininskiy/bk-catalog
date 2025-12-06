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
 * Модуль для фильтрации и сортировки игр
 */

/**
 * Фильтрует игры по заданным критериям
 * @param {Array} games - массив игр
 * @param {Object} filters - объект с фильтрами
 * @param {string} menuPlatform - платформа меню ('bk0010' или 'bk0011')
 * @returns {Array} отфильтрованный массив игр
 */
export function filterGames(games, filters, menuPlatform) {
    return games.filter(game => {
        // Фильтр по меню: БК-0010 vs БК-0011
        if (menuPlatform === 'bk0010') {
            if (/БК\s*0011|БК0011М/i.test(game['Платформа'])) return false;
        } else if (menuPlatform === 'bk0011') {
            if (!/БК\s*0011|БК0011М/i.test(game['Платформа'])) return false;
        }
        // Фильтр по конкретной платформе (клик в ячейке)
        if (filters.platform && filters.platform !== game['Платформа']) return false;
        // Жанр
        if (filters.genre && filters.genre !== game['Жанр']) return false;
        // Авторы
        if (filters.authors && !game['Авторы'].includes(filters.authors)) return false;
        // Издатель
        if (filters.publisher && !game['Издатель'].includes(filters.publisher)) return false;
        // Год
        if (filters.year && filters.year !== game['Год выпуска']) return false;
        // По букве
        if (filters.letter) {
            const title = (game['Название игры'] || '').trim();
            if (!title) return false;

            if (filters.letter === '#') {
                // Начинается с цифры
                if (!/^\d/.test(title)) return false;
            } else {
                // Начинается с буквы
                const firstChar = title.charAt(0).toUpperCase();
                if (firstChar !== filters.letter) return false;
            }
        }
        // По строке (включение подстроки)
        if (filters.search) {
            const q = filters.search.toLowerCase();
            if (!game['Название игры'].toLowerCase().includes(q)) return false;
        }
        return true;
    });
}

/**
 * Сортирует игры по заданному полю
 * @param {Array} games - массив игр для сортировки
 * @param {string} field - поле для сортировки
 * @param {string} dir - направление сортировки ('asc' или 'desc')
 * @returns {Array} отсортированный массив игр
 */
export function sortGames(games, field, dir = 'asc') {
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

/**
 * Получает уникальные жанры из массива игр
 * @param {Array} games - массив игр
 * @returns {Set} множество уникальных жанров
 */
export function getUniqueGenres(games) {
    return new Set(games.map(g => g['Жанр']).filter(g => g));
}
