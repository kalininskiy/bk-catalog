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
            nav: {
                home: 'Главная',
                games: 'Игры',
                software: 'Софт',
                demoscene: 'Демосцена',
                docs: 'Документация, статьи',
                emulator: 'Эмулятор'
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
                genre: 'Жанр',
                authors: 'Авторы',
                publisher: 'Издатель',
                releaseDate: 'Дата выхода',
                platform: 'Платформа',
                graphics: 'Графика',
                music: 'Музыка',
                language: 'Язык',
                sources: 'Исходники',
                video: 'Видео',
                demoparty: 'Демопати',
                place: 'Место',
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
            nav: {
                home: 'Home',
                games: 'Games',
                software: 'Software',
                demoscene: 'Demoscene',
                docs: 'Documentation, articles',
                emulator: 'Emulator'
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
                genre: 'Genre',
                authors: 'Authors',
                publisher: 'Publisher',
                releaseDate: 'Release date',
                platform: 'Platform',
                graphics: 'Graphics',
                music: 'Music',
                language: 'Language',
                sources: 'Sources',
                video: 'Video',
                demoparty: 'Demoparty',
                place: 'Place',
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
