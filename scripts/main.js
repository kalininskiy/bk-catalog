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
    console.log('main.js');

    const emulatorLink = document.getElementById('emulator-link');
    if (emulatorLink) {
        emulatorLink.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const href = emulatorLink.getAttribute('href');
            if (!href) {
                return;
            }

            if (typeof window.openEmulatorWindow === 'function') {
                await window.openEmulatorWindow(href);
            } else {
                window.open(href, '_blank');
            }
        });
    }
});
