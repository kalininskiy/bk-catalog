(function () {
    const translations = {
        ru: {
            siteTitle: 'Каталог ПО ПЭВМ Электроника БК',
            header: {
                ascii: `********************************************
*                                          *
*    КАТАЛОГ ПРОГРАММНОГО  ОБЕСПЕЧЕНИЯ     *
* ПЭВМ Электроника БК-0010(-01)/БК-0011(М) *
*                                          *
********************************************`
            },
            sidebar: {
                modelsHeader: 'Модели ПЭВМ Электроника БК'
            },
            models: {
                bk0010: 'БК-0010',
                bk0010_desc: `1985 год. Базовая модель с "плоской" клавиатурой и интерпретатором языка Фокал в ПЗУ`,
                specs_title: 'Характеристики:',
                specs_bk0010: `Разрядность 16 бит<br>Процессор К1801ВМ1 3 МГц<br>Оперативная память 32 КБ<br>Разрешение (чёрно-белый): 512х256<br>Разрешение (цветной): 256х256, 4 цвета<br>Звук: бипер<br>Устройства хранения данных: компакт-кассета`,

                bk0010_01: 'БК-0010-01',
                bk0010_01_desc: `1987 год. Улучшенный вариант с механической клавишной клавиатурой и транслятором языка Бейсик (Вильнюс, 1986) в ПЗУ. Интерпретатор языка Фокал перенесён во внешнее ПЗУ специального подключаемого модуля МСТД.`,
                specs_bk0010_01: `Разрядность 16 бит<br>Процессор К1801ВМ1 3 МГц<br>Оперативная память 32 КБ<br>Разрешение (чёрно-белый): 512х256<br>Разрешение (цветной): 256х256, 4 цвета<br>Звук: бипер<br>Устройства хранения данных: компакт-кассета`
                ,
                bk0011: 'БК-0011',
                bk0011_desc: `1989 год. Улучшенная модель с 128 Кбайт ОЗУ и повышеной частотой процессора. Добавлен выбор одной из 16 фиксированных палитр и второй кадровый буфер. Контроллер дисковода стал входить в стандартную поставку. А на разъёмы МПИ и УП выведено больше сигналов`,
                specs_bk0011: `Разрядность 16 бит<br>Процессор К1801ВМ1 4 МГц<br>Оперативная память 128 КБ<br>Разрешение (чёрно-белый): 512х256<br>Разрешение (цветной): 256х256, 4 цвета (из 16 палитр)<br>Звук: бипер<br>Устройства хранения данных: компакт-кассета, дисковод`,

                bk0011m: 'БК-0011М',
                bk0011m_desc: `1990 год. Исправленная версия БК-0011 (например: исправлена совместимость с БК-0010).`,
                specs_bk0011m: `Разрядность 16 бит<br>Процессор К1801ВМ1 4 МГц<br>Оперативная память 128 КБ<br>Разрешение (чёрно-белый): 512х256<br>Разрешение (цветной): 256х256, 4 цвета (из 16 палитр)<br>Звук: бипер<br>Устройства хранения данных: компакт-кассета, дисковод`
            },
            article: {
                title: 'БК (семейство компьютеров)',
                author: 'БК (сокращение от «Бытовой Компьютер») — семейство советских 16-разрядных\n                    домашних и учебных ЭВМ, совместимых по системе команд и частично по архитектуре с СМ ЭВМ, PDP-11 и\n                    ДВК.',
                p1: 'Семейство компьютеров БК-0010 было разработано в НИИ точной технологии НПО «Научный центр», г. Зеленоград. Главный конструктор от НИИТТ — Александр Н. Полосин, главный конструктор от завода «Экситон» — С. М. Косенков.',
                p2: 'Процессор К1801ВМ1, применяемый во всех моделях семейства, был совместим по системе команд с LSI-11/03 из семейства PDP-11 и работал на тактовой частоте 3 МГц (в БК-0011/БК-0011М повышена до 4 МГц).',
                p3: 'В январе 1985 года разработчики машины опубликовали статью с описанием БК в журнале «Микропроцессорные средства и системы» (печатный орган Государственного Комитета СССР по науке и технике, номер 1 за 1985 год). Окончательная разработка БК была осуществлена в 1983 г. на заводе «Экситон», г. Павловский Посад, где и было налажено первое серийное производство в 1985 году.',
                imageCaption: 'Обложка журнала «Микропроцессорные средства и системы», 1985, №1',
                p4: 'Впоследствии опытные партии модели БК-0010 выпускались на Казанском заводе радиокомпонентов (Завод №7) и «Нуклон» в городе Шяуляй (Литовская ССР). Последующие модели серийно производились также на заводах «Завод № 7», г. Казань, «Экситон», г. Павловский Посад, «Нуклон» в г. Шяуляй (Литовская ССР) (только модель БК-0010-01), в Армянской ССР (только модель БК-0010-01), а также на Заводе полупроводниковых приборов в Йошкар-Оле (только модель БК-0011). Полный спектр моделей БК производился только на заводе «Экситон».',
                p5: 'Всего было произведено более 162 000 единиц БК-0010/0011; завод «Экситон» в 1985—1992 годы изготовил около 125 000 машин: около 78 000 для розничной продажи и более 44 000 в составе школьных классов. Последние произведённые экземпляры БК относятся к 1993 году.',
                prices_html: 'Розничные цены на компьютеры составляли:<br>БК-0010: 600 рублей (1985—1988 год).<br>БК-0010-01: 650 рублей (1989 год), 750 рублей (1990 год).'
            },
            nav: {
                home: '[ Главная ]',
                games: '[ Игры ]',
                software: '[ Софт ]',
                demoscene: '[ Демосцена ]',
                docs: '[ Документация, статьи ]',
                emulator: '[ Эмулятор ]'
            },
            ui: {
                search: 'Расширенный поиск',
                searchPlaceholder: 'Поиск по названию, авторам, издателям...',
                resetSearch: 'Сброс поиска',
                resetFilters: 'Сброс фильтров',
                totalFound: 'Всего найдено',
                hasSources: 'Есть исходники',
                filterByPlatform: 'Фильтр по платформе',
                filterByGenre: 'Фильтр по жанру',
                filterByType: 'Фильтр по виду',
                filterByDemos: 'Фильтр по Демопати',
                allPlatforms: 'Все платформы',
                allGenres: 'Все жанры',
                allTypes: 'Все виды',
                allDemos: 'Все демопати',
                screenshot: 'Скриншот',
                previousScreenshot: 'Предыдущий скриншот',
                nextScreenshot: 'Следующий скриншот',
                noScreenshots: 'Нет скриншотов',
                enlargedScreenshot: 'Увеличенный скриншот',
                comments: 'Комментарии',
                shareLink: 'Поделиться ссылкой',
                close: 'Закрыть',
                backToMain: 'Вернуться на главную',
                downloadFiles: 'Файлы для скачивания',
                watch: 'смотреть',
                authorPage: 'Страница автора',
                authorPageTitle: 'Открыть страницу с фильтром по этому автору',
                files: 'Файлы',
                loadErrorGames: 'Не удалось загрузить список игр.',
                loadErrorSoftware: 'Не удалось загрузить список софта.',
                loadErrorDemoscene: 'Не удалось загрузить список демосцены.'
            },
            filters: {
                letter: 'Буква',
                search: 'Поиск',
                platform: 'Платформа',
                demoparty: 'Демопати',
                genre: 'Жанр',
                authors: 'Авторы',
                publisher: 'Издатель',
                year: 'Год',
                hasSources: 'Есть исходники',
                cyrillic: 'Кириллица',
                latin: 'Латиница',
                reset: 'Сбросить фильтр'
            },
            modal: {
                genre: 'Жанр:',
                authors: 'Авторы:',
                publisher: 'Издатель:',
                releaseDate: 'Дата выхода:',
                platform: 'Платформа:',
                graphics: 'Графика:',
                music: 'Музыка:',
                language: 'Язык:',
                sources: 'Исходники:',
                video: 'Видео:',
                demoparty: 'Демопати:',
                place: 'Место:',
                downloadLink: 'Ссылка',
                noFiles: 'Нет файлов',
                download: 'скачать',
                runInEmulator: '▶ Запустить в эмуляторе',
                cassette: 'Кассета',
                audioTracks: 'Аудиодорожки из',
                audioLoading: 'Загрузка и конвертация…',
                audioEmpty: 'BIN/OVL файлов в архиве не найдено или их не удалось конвертировать.',
                audioError: 'Ошибка при чтении архива или конвертации файлов.'
            },
            common: {
                yes: 'Да',
                no: 'Нет',
                unknown: '—'
            }
        },
        en: {
            siteTitle: 'BK software catalog for Elektronika BK computers',
            header: {
                ascii: `********************************************
*                                          *
*       SOFTWARE AND GAMES CATALOG         *
*   Electronika BK-0010(-01)/BK-0011(M)    *
*                                          *
********************************************`
            },
            sidebar: {
                modelsHeader: 'Electronika BK Models'
            },
            models: {
                bk0010: 'BK-0010',
                bk0010_desc: `The release date is 1985. The basic model with a "flat" keyboard and a Focus language interpreter in ROM`,
                specs_title: 'Specifications:',
                specs_bk0010: `The bit depth is 16 bits<br>Processor K1801VM1 3 MHz<br>RAM 32 KB<br>Resolution (black and white): 512x256<br>Resolution (color): 256x256, 4 colors<br>Sound: beeper<br>Data storage devices: compact cassette`,

                bk0010_01: 'BK-0010-01',
                bk0010_01_desc: `The release date is 1987. An improved version with a mechanical keyboard and a Basic language translator (Vilnius Basic, 1986) in ROM. The Focal language interpreter has been transferred to the external ROM - MSTD-cartridge.`,
                specs_bk0010_01: `The bit depth is 16 bits<br>Processor K1801VM1 3 MHz<br>RAM 32 KB<br>Resolution (black and white): 512x256<br>Resolution (color): 256x256, 4 colors<br>Sound: beeper<br>Data storage devices: compact cassette`
                ,
                bk0011: 'BK-0011',
                bk0011_desc: `The release date is 1989. Improved model with 128 KB of RAM and increased processor frequency. Added a selection of one of the 16 fixed palettes and a second framebuffer. The disk drive controller has become standard. And more signals are output to the MPI and UP connectors.`,
                specs_bk0011: `The bit depth is 16 bits<br>Processor K1801VM1 4 MHz<br>RAM 128 KB<br>Resolution (black and white): 512x256<br>Resolution (color): 256x256, 4 colors (from 16 palettes)<br>Sound: beeper<br>Data storage devices: compact cassette, floppy drive`,

                bk0011m: 'BK-0011M',
                bk0011m_desc: `The release date is 1990. The corrected version of BK-0011 (for example: fixed compatibility with BK-0010).`,
                specs_bk0011m: `The bit depth is 16 bits<br>Processor K1801VM1 4 MHz<br>RAM 128 KB<br>Resolution (black and white): 512x256<br>Resolution (color): 256x256, 4 colors (from 16 palettes)<br>Sound: beeper<br>Data storage devices: compact cassette, floppy drive`
            },
            article: {
                title: 'BK (computer family)',
                author: 'BK (short for "Home Computer") is a family of Soviet 16-bit home and educational computers that are compatible in terms of command system and partially in terms of architecture with the SM computer, PDP-11 (LSI-11/03), and DVK.',
                p1: 'The BK-0010 family of computers was developed at the Research Institute of Precision Technology of the Scientific Center, Zelenograd. The chief designer from the Research Institute of Precision Technology was Alexander N. Polosin, and the chief designer from the Eksiton plant was S. M. Kosenkov.',
                p2: 'The K1801BM1 processor, which was used in all models of the family, was compatible in terms of command system with the LSI-11/03 from the PDP-11 family and operated at a clock frequency of 3 MHz (increased to 4 MHz in the BK-0011/BK-0011M).',
                p3: 'In January 1985, the developers of the machine published an article describing the BK in the journal "Microprocessor Tools and Systems" (a publication of the State Committee of the USSR for Science and Technology, issue 1 for 1985). The final development of the BK was carried out in 1983 at the Eksiton plant in Pavlovsky Posad, where the first mass production was established in 1985.',
                imageCaption: 'Cover of the magazine "Microprocessor Tools and Systems", 1985, No. 1',
                p4: 'Subsequently, trial batches of the BK-0010 model were produced at the Kazan Radio Components Plant (Plant No. 7) and the Nuklon plant in Šiauliai (Lithuanian SSR). Subsequent models were also mass-produced at the Plant No. 7 in Kazan, the Eksiton plant in Pavlovsky Posad, the Nuklon plant in Šiauliai (Lithuanian SSR) (only the BK-0010-01 model), in the Armenian SSR (only the BK-0010-01 model), and at the Semiconductor Devices Plant in Yoshkar-Ola (only the BK-0011 model). The full range of BK models was produced only at the Eksiton plant.',
                p5: 'In total, more than 162,000 BK-0010/0011 units were produced; the Eksiton factory manufactured about 125,000 machines between 1985 and 1992, including about 78,000 for retail sale and more than 44,000 for use in school classrooms. The last BK computers were produced in 1993.',
                prices_html: 'The retail prices for these computers were as follows:<br>BK-0010: 600 rubles (1985-1988).<br>BK-0010-01: 650 rubles (1989), 750 rubles (1990).'
            },
            nav: {
                home: '[ Home ]',
                games: '[ Games ]',
                software: '[ Software ]',
                demoscene: '[ Demoscene ]',
                docs: '[ Documentation, articles ]',
                emulator: '[ Emulator ]'
            },
            ui: {
                search: 'Extended search',
                searchPlaceholder: 'Search by title, authors, publishers...',
                resetSearch: 'Reset search',
                resetFilters: 'Reset filters',
                totalFound: 'Found',
                hasSources: 'Has sources',
                filterByPlatform: 'Filter by platform',
                filterByGenre: 'Filter by genre',
                filterByType: 'Filter by type',
                filterByDemos: 'Filter by demoparty',
                allPlatforms: 'All platforms',
                allGenres: 'All genres',
                allTypes: 'All types',
                allDemos: 'All demoparties',
                screenshot: 'Screenshot',
                previousScreenshot: 'Previous screenshot',
                nextScreenshot: 'Next screenshot',
                noScreenshots: 'No screenshots',
                enlargedScreenshot: 'Enlarged screenshot',
                comments: 'Comments',
                shareLink: 'Share link',
                close: 'Close',
                backToMain: 'Back to main',
                downloadFiles: 'Files to download',
                watch: 'watch',
                authorPage: 'Author page',
                authorPageTitle: 'Open the page filtered by this author',
                files: 'Files',
                loadErrorGames: 'Failed to load the games list.',
                loadErrorSoftware: 'Failed to load the software list.',
                loadErrorDemoscene: 'Failed to load the demoscene list.'
            },
            filters: {
                letter: 'Letter',
                search: 'Search',
                platform: 'Platform',
                demoparty: 'Demoparty',
                genre: 'Genre',
                authors: 'Authors',
                publisher: 'Publisher',
                year: 'Year',
                hasSources: 'Has sources',
                cyrillic: 'Cyrillic',
                latin: 'Latin',
                reset: 'Reset filter'
            },
            modal: {
                genre: 'Genre:',
                authors: 'Authors:',
                publisher: 'Publisher:',
                releaseDate: 'Release date:',
                platform: 'Platform:',
                graphics: 'Graphics:',
                music: 'Music:',
                language: 'Language:',
                sources: 'Sources:',
                video: 'Video:',
                demoparty: 'Demoparty:',
                place: 'Place:',
                downloadLink: 'Link',
                noFiles: 'No files',
                download: 'download',
                runInEmulator: '▶ Run in emulator',
                cassette: 'Cassette',
                audioTracks: 'Audio tracks from',
                audioLoading: 'Loading and converting…',
                audioEmpty: 'No BIN/OVL files were found in the archive or they could not be converted.',
                audioError: 'Failed to read the archive or convert the files.'
            },
            common: {
                yes: 'Yes',
                no: 'No',
                unknown: '—'
            }
        }
    };

    const storageKey = 'siteLocale';
    let currentLocale = 'ru';

    function getStoredLocale() {
        const stored = localStorage.getItem(storageKey);
        return stored === 'en' ? 'en' : 'ru';
    }

    function getValue(obj, path) {
        return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    }

    function getLocale() {
        return currentLocale || 'ru';
    }

    function setLocale(locale) {
        currentLocale = locale === 'en' ? 'en' : 'ru';
        localStorage.setItem(storageKey, currentLocale);
        document.documentElement.lang = currentLocale;
        document.documentElement.setAttribute('data-locale', currentLocale);
        applyLocale();
        return currentLocale;
    }

    function t(key, fallback) {
        const locale = getLocale();
        const value = getValue(translations[locale], key);
        return value !== undefined ? value : (fallback || key);
    }

    function applyLocale() {
        document.documentElement.lang = currentLocale;
        document.documentElement.setAttribute('data-locale', currentLocale);

        document.querySelectorAll('[data-i18n-html]').forEach((el) => {
            const key = el.getAttribute('data-i18n-html');
            if (!key) return;
            const value = t(key);
            if (value !== undefined) {
                el.innerHTML = value;
            }
        });

        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            const value = t(key);
            if (value) {
                el.textContent = value;
            }
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) {
                el.setAttribute('placeholder', t(key));
            }
        });

        // Update common select first-empty option labels (apply immediately on language switch)
        try {
            document.querySelectorAll('select').forEach((sel) => {
                const first = sel.querySelector('option[value=""]');
                if (!first) return;
                let key = null;
                if (sel.id === 'platform-select') {
                    key = 'ui.allPlatforms';
                } else if (sel.id === 'demoparty-select') {
                    key = 'ui.allDemos';
                } else if (sel.id === 'genre-select') {
                    // genre-select used in multiple containers: detect software vs games vs demoscene
                    if (sel.closest('.software-table-container')) key = 'ui.allTypes';
                    else if (sel.closest('.demoscene-table-container')) key = 'ui.allDemos';
                    else key = 'ui.allGenres';
                }
                if (key) {
                    first.textContent = t(key);
                }
            });
        } catch (e) {
            // ignore if DOM queries fail
        }

        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            if (key) {
                el.setAttribute('title', t(key));
            }
        });

        document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
            const key = el.getAttribute('data-i18n-aria-label');
            if (key) {
                el.setAttribute('aria-label', t(key));
            }
        });

        document.querySelectorAll('[data-i18n-alt]').forEach((el) => {
            const key = el.getAttribute('data-i18n-alt');
            if (key) {
                el.setAttribute('alt', t(key));
            }
        });

        const langCheckbox = document.getElementById('lang-toggle-checkbox');
        if (langCheckbox) {
            langCheckbox.checked = currentLocale === 'en';
        }

        if (document.title) {
            const titleKey = document.body.getAttribute('data-page-title-key');
            if (titleKey) {
                document.title = t(titleKey, document.title);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        currentLocale = getStoredLocale();
        applyLocale();

        const langCheckbox = document.getElementById('lang-toggle-checkbox');
        if (langCheckbox) {
            langCheckbox.addEventListener('change', () => {
                setLocale(langCheckbox.checked ? 'en' : 'ru');
            });
        }

        // Observe DOM insertions and apply translations to newly added nodes
        try {
            const observer = new MutationObserver((mutations) => {
                let needsApply = false;
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        if (node.matches && (node.matches('[data-i18n]') || node.matches('[data-i18n-html]') || node.matches('[data-i18n-placeholder]') || node.querySelector('[data-i18n], [data-i18n-html], [data-i18n-placeholder]')) ) {
                            needsApply = true;
                            break;
                        }
                    }
                    if (needsApply) break;
                }
                if (needsApply) {
                    // small timeout to allow other scripts to finish modifications
                    setTimeout(applyLocale, 0);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        } catch (e) {
            // ignore if MutationObserver not supported
        }
    });

    window.i18n = {
        t,
        setLocale,
        getLocale,
        applyLocale,
        translations
    };
    window.t = t;
    window.setLocale = setLocale;
    window.applyLocale = applyLocale;
})();
