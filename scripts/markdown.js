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

document.addEventListener('DOMContentLoaded', () => {

    function parseWikiLinks(md) {
        let result = '';
        let i = 0;
        md = md.replace(/_\((RL)\)/g, '_%28RL%29');

        while (i < md.length) {
            // Ищем начало вики-ссылки: "[["
            const openPos = md.indexOf('[[', i);
            if (openPos === -1) {
                result += md.slice(i);
                break;
            }

            result += md.slice(i, openPos);
            i = openPos + 2; // за "[[""

            // Ищем конец текста: "]]"
            const closeTextPos = md.indexOf(']]', i);
            if (closeTextPos === -1) {
                result += '[[' + md.slice(i);
                break;
            }

            const text = md.slice(i, closeTextPos);
            i = closeTextPos + 2; // за "]]"

            // Проверяем, есть ли сразу "(url"
            if (md.slice(i, i + 1) !== '(') {
                result += `[[${text}]]`;
                continue;
            }

            i++; // за "("
            let depth = 1;
            let urlStart = i;

            // Ищем закрывающую ")" с учётом вложенности
            while (i < md.length && md[i] !== ')') {
                i++;
            }

            if (i >= md.length) {
                // Не нашли ')', возвращаем как есть
                result += `[[${text}]](${md.slice(urlStart)}`;
                break;
            }

            const url = md.slice(urlStart, i);
            i++; // за ")"

            // Экранируем только url (text уже безопасен)
            const safeUrl = url.replace(/"/g, '&quot;');
            result += `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        }

        return result;
    }

    // ——— Markdown → HTML ———
    function markdownToHTML(md) {
        // 1. Заменяем вики-ссылки [[текст]](url) → <a>
        md = parseWikiLinks(md);

        // 2. Стандартные ссылки [текст](url) — на случай, если остались
        md = md.replace(/\[([^\]]+)\]\(([^)\n]+?)\)/g, (match, text, url) => {
            return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        });

        // 3. Жирный и курсив
        md = md
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');

        // 4. Заголовки
        md = md
            .replace(/^## (.*$)/gm, (m, t) => {
                const id = t.toLowerCase().replace(/[^\wа-яё0-9]+/g, '-').replace(/^-+|-+$/g, '');
                return `<h2 id="${id}">${t}</h2>`;
            })
            .replace(/^### (.*$)/gm, (m, t) => {
                const id = t.toLowerCase().replace(/[^\wа-яё0-9]+/g, '-').replace(/^-+|-+$/g, '');
                return `<h3 id="${id}">${t}</h3>`;
            });

        // 5. Списки и параграфы
        md = md
            .replace(/^- (.*$)/gm, '<li>$1</li>')
            .replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>')
            .replace(/\n{2,}/g, '</p><p>')
            .replace(/^<p>/, '').replace(/<\/p>$/, '');

        return `<p>${md}</p>`;
    }

    const docsLink = Array.from(document.querySelectorAll('.nav-menu a'))
        .find(a => a.textContent.includes('Документация, статьи'));

    const backLink = document.getElementById('back-to-main');

    // Загружаем и отображаем документацию
    async function loadAndRenderDocs() {
        try {
            const response = await fetch('content/bkpress.md');
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const mdText = await response.text(); // автоматически UTF-8
            const html = markdownToHTML(mdText);

            const contentDiv = document.getElementById('docs-content');
            if (contentDiv) {
                contentDiv.innerHTML = html;
            }
        } catch (err) {
            console.error('[ERROR] Не удалось загрузить bkpress.md:', err);
            document.getElementById('docs-content').innerHTML =
                `<p style="color:#c00;">Ошибка загрузки документации: ${err.message}.<br>Убедитесь, что файл <code>bkpress.md</code> лежит в той же папке.</p>`;
        }
    }

    if (docsLink) {
        docsLink.addEventListener('click', e => {
            e.preventDefault();
            document.querySelector('.content-wrapper').style.display = 'none';
            document.querySelector('.footer-block').style.display = 'none';
            document.getElementById('docs-page').style.display = 'block';
            document.querySelector('.games-table-container').style.display = 'none';
            document.querySelector('.software-table-container').style.display = 'none';
            document.querySelector('.demoscene-table-container').style.display = 'none';

            // Загружаем и рендерим (только при первом открытии или если пусто)
            const contentDiv = document.getElementById('docs-content');
            if (!contentDiv.innerHTML.trim()) {
                loadAndRenderDocs();
            }
        });
    }

    if (backLink) {
        backLink.addEventListener('click', e => {
            e.preventDefault();
            document.querySelector('.content-wrapper').style.display = 'flex';
            document.querySelector('.footer-block').style.display = 'block';
            document.getElementById('docs-page')?.style.setProperty('display', 'none', 'important');
            document.querySelector('.docs-page')?.style.setProperty('display', 'none', 'important');
            document.querySelector('.games-table-container').style.display = 'none';
            document.querySelector('.software-table-container').style.display = 'none';
            document.querySelector('.demoscene-table-container').style.display = 'none';
        });
    }
});
