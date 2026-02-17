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

import { createSearchVariants } from './utils.js';

/**
 * Модуль для фильтрации и сортировки игр
 */

/**
 * Фильтрует игры по заданным критериям
 * @param {Array} games - массив игр
 * @param {Object} filters - объект с фильтрами
 * @returns {Array} отфильтрованный массив игр
 */
export function filterGames(games, filters) {
    return games.filter(game => {
        // Фильтр по конкретной платформе (клик в ячейке)
        if (filters.platform && filters.platform !== game['Платформа']) return false;
        // Фильтр по Демопати (в разделе Демосцена)
        if (filters.demoparty && (game['Демопати'] || '').trim() !== filters.demoparty) return false;
        // Жанр (в поле может быть перечисление через запятую)
        if (filters.genre && !(game['Жанр'] || '').includes(filters.genre)) return false;
        // Авторы (в поле может быть перечисление через запятую)
        if (filters.authors && !(game['Авторы'] || '').includes(filters.authors)) return false;
        // Издатель (в поле может быть перечисление через запятую)
        if (filters.publisher && !(game['Издатель'] || '').includes(filters.publisher)) return false;
        // Год
        if (filters.year && filters.year !== game['Год выпуска']) return false;
        // По букве
        if (filters.letter) {
            const title = (game['Название'] || '').trim();
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
        // Расширенный поиск (включение подстроки с транслитерацией)
        if (filters.search) {
            const searchVariants = createSearchVariants(filters.search);

            // Проверяем все указанные поля на соответствие поисковому запросу
            const searchFields = [
                game['Название'],
                game['Описание'],
                game['Авторы'],
                game['Графика'],
                game['Музыка'],
                game['Язык'],
                game['Платформа'],
                game['Издатель'],
                game['Год выпуска']
            ];

            // Проверяем, содержит ли хотя бы одно поле хотя бы один из вариантов поиска
            const found = searchVariants.some(variant =>
                searchFields.some(field =>
                    field && field.toLowerCase().includes(variant)
                )
            );

            if (!found) return false;
        }
        // Демосцена: фильтр «Есть исходники» — оставляем только записи с непустым полем Исходники
        if (filters.hasSources && !(game['Исходники'] || '').trim()) return false;
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
    // Если поле сортировки не задано — возвращаем элементы в исходном порядке
    if (!field) {
        return [...games];
    }

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
 * Разбивает строку на части по запятой (trim), для полей «Авторы», «Издатель», «Жанр».
 * @param {string} s - строка или null/undefined
 * @returns {string[]}
 */
function splitByComma(s) {
    if (!s || typeof s !== 'string') return [];
    return s.split(',').map(part => part.trim()).filter(Boolean);
}

/**
 * Получает уникальные жанры из массива игр (каждое значение из перечислений через запятую учитывается отдельно).
 * @param {Array} games - массив игр
 * @returns {Set} множество уникальных жанров
 */
export function getUniqueGenres(games) {
    const set = new Set();
    games.forEach(g => {
        const raw = g['Жанр'];
        splitByComma(raw).forEach(genre => set.add(genre));
    });
    return set;
}

/**
 * Получает уникальные платформы из массива игр
 * @param {Array} games - массив игр
 * @returns {Set} множество уникальных платформ
 */
export function getUniquePlatforms(games) {
    return new Set(games.map(g => g['Платформа']).filter(g => g));
}

/**
 * Получает уникальные значения поля «Демопати» из массива записей
 * @param {Array} items - массив записей (демосцена)
 * @returns {Set} множество уникальных значений Демопати
 */
export function getUniqueDemoparties(items) {
    return new Set(
        items.map(g => (g['Демопати'] || '').trim()).filter(Boolean)
    );
}
