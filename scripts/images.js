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
    // Создаём модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <button class="modal-close">&times;</button>
            <img src="" alt="">
            <div class="modal-caption"></div> <!-- Подпись -->
        </div>
    `;
    document.body.appendChild(modal);

    const modalImg = modal.querySelector('img');
    const modalCaption = modal.querySelector('.modal-caption');
    const modalClose = modal.querySelector('.modal-close');

    function openModal(src, alt = '', caption = '') {
        modalImg.src = src;
        modalImg.alt = alt;
        modalCaption.textContent = alt;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.classList.remove('active');
        setTimeout(() => {
            modalImg.src = '';
            modalCaption.textContent = '';
        }, 300);
        document.body.style.overflow = '';
    }

    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    modalClose.addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Подписываемся на клик по ЛЮБОМУ изображению с нужным классом
    document.querySelectorAll('.article-image, .featured-image-thumb').forEach(img => {
        img.addEventListener('click', () => {
            const wrapper = img.closest('.image-wrapper');
            const caption = wrapper ? wrapper.querySelector('.image-caption')?.textContent || '' : '';
            openModal(img.src, img.alt, caption);
        });
    });
});
