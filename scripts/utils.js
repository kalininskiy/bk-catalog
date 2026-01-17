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
 * Утилитарные функции для работы с каталогом игр
 */

/**
 * Создает debounced версию функции
 * @param {Function} func - функция для debounce
 * @param {number} wait - задержка в миллисекундах
 * @returns {Function} debounced функция
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Экранирует HTML символы
 * @param {string} str - строка для экранирования
 * @returns {string} экранированная строка
 */
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Экранирует атрибуты HTML
 * @param {string} str - строка для экранирования
 * @returns {string} экранированная строка
 */
export function escapeAttr(str) {
    return String(str)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Парсит CSV строку в массив объектов
 * @param {string} text - CSV текст
 * @returns {Array<Object>} массив объектов с данными
 */
export function parseCSV(text) {
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

/**
 * Парсит одну строку CSV
 * @param {string} str - CSV строка
 * @returns {Array<string>} массив значений
 */
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

/**
 * Создает варианты поиска с транслитерацией и альтернативными буквами
 * @param {string} query - поисковый запрос
 * @returns {Array<string>} массив вариантов для поиска
 */
export function createSearchVariants(query) {
    const variants = new Set();
    const lowerQuery = query.toLowerCase();

    // Добавляем оригинальный запрос
    variants.add(lowerQuery);

    // Ограничение на длину для предотвращения зависания
    const MAX_QUERY_LENGTH = 20;
    if (lowerQuery.length > MAX_QUERY_LENGTH) {
        // Для очень длинных строк используем простой подход без комбинаторики
        const simpleAlternatives = {
            'a': 'а', 'b': 'б', 'c': 'с', 'd': 'д', 'e': 'е', 'f': 'ф', 'g': 'г', 'h': 'х',
            'i': 'и', 'j': 'дж', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п',
            'q': 'кв', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у', 'v': 'в', 'w': 'в', 'x': 'кс',
            'y': 'й', 'z': 'з',
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
            'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
            'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c',
            'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
        };

        let simpleVariant = '';
        for (const char of lowerQuery) {
            simpleVariant += simpleAlternatives[char] || char;
        }
        variants.add(simpleVariant);
        return Array.from(variants);
    }

    // Ограниченные альтернативы для предотвращения экспоненциального роста
    // Берем только наиболее вероятные замены (1-2 варианта максимум)
    const alternatives = {
        'a': ['а'],
        'b': ['б'],
        'c': ['с', 'ц'], // самые частые замены
        'd': ['д'],
        'e': ['е', 'э'],
        'f': ['ф'],
        'g': ['г'],
        'h': ['х'],
        'i': ['и'],
        'j': ['дж'],
        'k': ['к'],
        'l': ['л'],
        'm': ['м'],
        'n': ['н'],
        'o': ['о'],
        'p': ['п'],
        'q': ['кв'],
        'r': ['р'],
        's': ['с'],
        't': ['т'],
        'u': ['у'],
        'v': ['в'],
        'w': ['в'],
        'x': ['кс'],
        'y': ['й'],
        'z': ['з'],
        'а': ['a'],
        'б': ['b'],
        'в': ['v'],
        'г': ['g'],
        'д': ['d'],
        'е': ['e'],
        'ё': ['e'],
        'ж': ['zh'],
        'з': ['z'],
        'и': ['i'],
        'й': ['y'],
        'к': ['k'],
        'л': ['l'],
        'м': ['m'],
        'н': ['n'],
        'о': ['o'],
        'п': ['p'],
        'р': ['r'],
        'с': ['s'],
        'т': ['t'],
        'у': ['u'],
        'ф': ['f'],
        'х': ['h'],
        'ц': ['c'],
        'ч': ['ch'],
        'ш': ['sh'],
        'щ': ['sch'],
        'ъ': [],
        'ы': ['y'],
        'ь': [],
        'э': ['e'],
        'ю': ['yu'],
        'я': ['ya']
    };

    // Итеративная функция для генерации вариантов с ограничением
    function generateVariantsIterative(query) {
        let currentVariants = [''];

        for (const char of query) {
            const newVariants = [];

            for (const variant of currentVariants) {
                // Добавляем вариант без замены
                newVariants.push(variant + char);

                // Добавляем варианты с заменами (максимум 2 замены для предотвращения роста)
                if (alternatives[char] && alternatives[char].length > 0) {
                    const maxAlts = Math.min(alternatives[char].length, 2); // ограничиваем до 2 альтернатив
                    for (let i = 0; i < maxAlts; i++) {
                        newVariants.push(variant + alternatives[char][i]);
                    }
                }
            }

            // Ограничиваем количество вариантов для предотвращения роста
            currentVariants = newVariants.slice(0, 1000); // максимум 1000 вариантов
        }

        return currentVariants;
    }

    // Генерируем варианты
    const generatedVariants = generateVariantsIterative(lowerQuery.split(''));

    // Добавляем все сгенерированные варианты
    for (const variant of generatedVariants) {
        variants.add(variant);
    }

    return Array.from(variants);
}
