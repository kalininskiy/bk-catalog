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
