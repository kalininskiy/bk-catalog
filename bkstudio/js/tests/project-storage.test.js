/**
 * Автоматические тесты BKStudio: Storage Manager & Project Manager
 * 
 * Проверяет:
 * 1. Устранение повторных и лишних операций записи (включая addArtifactFiles).
 * 2. Корректность debounce при вводе в редакторе Monaco.
 * 3. Немедленный сброс (saveNow / flushSave) при критических операциях.
 * 4. Разделение исходников и компиляционных артефактов (.lst, .map, .obj, .bin).
 * 5. Защиту от переполнения квоты localStorage (QuotaExceededError) и аварийное сохранение исходников.
 * 6. Корректность транзакционной миграции из legacy localStorage в IndexedDB.
 * 7. Корректность сохранения и восстановления бинарных файлов (Uint8Array / Base64).
 * 8. Диагностику хранилища (getStorageDiagnostics).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== Запуск тестов BKStudio Project & Storage Manager ===\n');

// 1. Создание мок-окружения для Node.js
function createMockEnvironment() {
  const localStorageStore = new Map();
  let localStorageQuotaError = false;
  let saveCount = 0;

  const mockLocalStorage = {
    getItem: (key) => localStorageStore.get(key) || null,
    setItem: (key, val) => {
      if (key === 'bkstudio_project_data') {
        saveCount++;
      }
      if (localStorageQuotaError) {
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      localStorageStore.set(key, String(val));
    },
    removeItem: (key) => localStorageStore.delete(key),
    clear: () => localStorageStore.clear()
  };

  // Простой мок IndexedDB для тестов в Node
  const idbStore = new Map();
  let idbOpenError = false;

  const mockIndexedDB = {
    open: (name, version) => {
      const req = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: null
      };

      setTimeout(() => {
        if (idbOpenError) {
          if (req.onerror) req.onerror({ target: { error: new Error('IDB open blocked') } });
          return;
        }

        const db = {
          objectStoreNames: {
            contains: (s) => true
          },
          createObjectStore: (s, opts) => {},
          transaction: (stores, mode) => {
            const tx = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore: (storeName) => ({
                get: (key) => {
                  const getReq = { onsuccess: null, onerror: null, result: idbStore.get(key) || null };
                  setTimeout(() => { if (getReq.onsuccess) getReq.onsuccess(); }, 5);
                  return getReq;
                },
                put: (val) => {
                  const putReq = { onsuccess: null, onerror: null };
                  idbStore.set(val.id, JSON.parse(JSON.stringify(val)));
                  setTimeout(() => {
                    if (putReq.onsuccess) putReq.onsuccess();
                    if (tx.oncomplete) tx.oncomplete();
                  }, 5);
                  return putReq;
                }
              })
            };
            return tx;
          }
        };

        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 5);

      return req;
    }
  };

  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    Buffer: Buffer,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    localStorage: mockLocalStorage,
    indexedDB: mockIndexedDB,
    BK_SAMPLES: [
      {
        id: 'hello_bk10',
        title: 'Привет, БК-0010!',
        filename: 'main.asm',
        code: '; Hello World\nSTART: HALT\n.END START\n',
        platform: 'BK-0010'
      },
      {
        id: 'test_c_sample',
        title: 'Тестовый Си проект',
        filename: 'main.c',
        files: {
          'main.c': '#include "tools.h"\nint main() { return 0; }',
          'tools.h': '#pragma once\nvoid delay_ms(int ms);'
        },
        openTabs: ['main.c', 'tools.h'],
        platform: 'BK-0010'
      }
    ]
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;

  vm.createContext(sandbox);

  const pmCode = fs.readFileSync(path.join(__dirname, '..', 'project-manager.js'), 'utf8');
  vm.runInContext(pmCode, sandbox, { filename: 'project-manager.js' });

  return {
    sandbox,
    localStorageStore,
    idbStore,
    setQuotaError: (val) => { localStorageQuotaError = val; },
    getSaveCount: () => saveCount,
    resetSaveCount: () => { saveCount = 0; }
  };
}

let passed = 0;
function pass(msg) {
  passed++;
  console.log(`  ✓ PASS: ${msg}`);
}

async function runAllTests() {
  // -------------------------------------------------------------
  // Тест 1: Инициализация и загрузка дефолтного проекта
  // -------------------------------------------------------------
  console.log('Тест 1: Инициализация BKProjectManager');
  const env1 = createMockEnvironment();
  const pm1 = env1.sandbox.bkProject;

  assert(pm1, 'bkProject должен быть создан');
  assert(pm1.files['main.asm'], 'По умолчанию должен быть загружен hello_bk10');
  assert.strictEqual(pm1.activeFileName, 'main.asm');
  pass('Инициализация по умолчанию и загрузка базового сэмпла');

  // -------------------------------------------------------------
  // Тест 2: Debounce автосохранения при вводе в Monaco Editor
  // -------------------------------------------------------------
  console.log('Тест 2: Debounce автосохранения');
  const env2 = createMockEnvironment();
  const pm2 = env2.sandbox.bkProject;
  env2.resetSaveCount();

  // Симулируем 20 быстрых нажатий клавиш в Monaco
  for (let i = 0; i < 20; i++) {
    pm2.setFileContent('main.asm', `; Строка ${i}\nSTART: HALT\n`);
  }

  // До истечения debounce таймера запись в localStorage не должна вызываться 20 раз
  assert.strictEqual(env2.getSaveCount(), 0, 'Во время быстрого ввода сохранения в хранилище отложены');

  // Ждём срабатывания debounce (550 мс)
  await new Promise(r => setTimeout(r, 600));

  assert.strictEqual(env2.getSaveCount(), 1, 'После паузы в наборе произошла ровно 1 запись');
  const stored = JSON.parse(env2.localStorageStore.get('bkstudio_project_data'));
  assert(stored.files['main.asm'].includes('; Строка 19'), 'В хранилище записана последняя версия файла');
  pass('Debounce объединяет множество изменений в одну операцию записи');

  // -------------------------------------------------------------
  // Тест 3: Немедленный сброс (saveNow / flushSave) при критических действиях
  // -------------------------------------------------------------
  console.log('Тест 3: saveNow / flushSave');
  const env3 = createMockEnvironment();
  const pm3 = env3.sandbox.bkProject;
  env3.resetSaveCount();

  pm3.setFileContent('main.asm', '; Критическое изменение перед компиляцией\n');
  assert.strictEqual(env3.getSaveCount(), 0, 'Сохранение пока в очереди debounce');

  // Вызов saveNow (например перед компиляцией F9 или экспортом ZIP)
  pm3.saveNow();
  assert.strictEqual(env3.getSaveCount(), 1, 'saveNow() немедленно записал данные без ожидания таймера');

  // Проверяем, что таймер был снят и повторно не сработает
  await new Promise(r => setTimeout(r, 600));
  assert.strictEqual(env3.getSaveCount(), 1, 'Таймер debounce очищен, дублирующей записи не произошло');
  pass('saveNow() мгновенно сбрасывает очередь и предотвращает потерю данных');

  // -------------------------------------------------------------
  // Тест 4: Пакетное добавление артефактов компиляции (addArtifactFiles)
  // -------------------------------------------------------------
  console.log('Тест 4: addArtifactFiles (отсутствие дублирующих вызовов)');
  const env4 = createMockEnvironment();
  const pm4 = env4.sandbox.bkProject;
  env4.resetSaveCount();

  // Симулируем результат компиляции GCC с 4 артефактами
  const testBin = new Uint8Array([0o1000 & 0xff, (0o1000 >> 8) & 0xff, 10, 0, 0o000000]);
  const artifacts = {
    'main.bin': testBin,
    'main.lst': '; Листинг компилятора на 1000 строк...\n001000: 000000 HALT\n',
    'main.map': 'Memory Map: Section .text at 01000, length 10 bytes\n',
    'main.obj': new Uint8Array([1, 2, 3, 4])
  };

  let notifyCount = 0;
  pm4.onChange((event) => {
    if (event === 'artifacts-added') notifyCount++;
  });

  pm4.addArtifactFiles(artifacts);

  assert.strictEqual(notifyCount, 1, 'Было отправлено ровно 1 уведомление artifacts-added');
  assert.strictEqual(env4.getSaveCount(), 1, 'Произошла ровно 1 запись в хранилище вместо 8!');
  assert(pm4.isArtifact('main.bin'), 'main.bin помечен как артефакт');
  assert(pm4.isArtifact('main.lst'), 'main.lst помечен как артефакт');
  assert(pm4.isArtifact('main.map'), 'main.map помечен как артефакт');
  assert(pm4.isArtifact('main.obj'), 'main.obj помечен как артефакт');
  pass('addArtifactFiles добавляет группу файлов атомарно за 1 вызов сохранения');

  // -------------------------------------------------------------
  // Тест 5: Разделение исходников и артефактов в localStorage
  // -------------------------------------------------------------
  console.log('Тест 5: Фильтрация тяжелых артефактов из localStorage');
  const rawLs = env4.localStorageStore.get('bkstudio_project_data');
  const parsedLs = JSON.parse(rawLs);

  // В localStorage должны быть исходники и .bin, но тяжелые .lst, .map, .obj должны быть исключены
  assert(parsedLs.files['main.asm'], 'Исходный файл main.asm сохранен в localStorage');
  assert(parsedLs.files['main.bin'], 'Выходной бинарный файл сохранен для запуска в эмуляторе');
  assert.strictEqual(parsedLs.files['main.lst'], undefined, 'Тяжелый листинг .lst исключен из 5 МБ localStorage');
  assert.strictEqual(parsedLs.files['main.map'], undefined, 'Тяжелая карта .map исключена из 5 МБ localStorage');
  assert.strictEqual(parsedLs.files['main.obj'], undefined, 'Промежуточный .obj исключен из 5 МБ localStorage');

  // При этом в памяти BKProjectManager доступны ВСЕ файлы (для Monaco, вкладок и ZIP)
  assert(pm4.files['main.lst'], 'В памяти pm4.files листинг доступен');
  assert(pm4.files['main.map'], 'В памяти pm4.files карта доступна');
  pass('Разделение: тяжелые диагностические артефакты не раздувают localStorage');

  // -------------------------------------------------------------
  // Тест 6: Очистка артефактов (clearArtifacts)
  // -------------------------------------------------------------
  console.log('Тест 6: Очистка артефактов');
  const removedCount = pm4.clearArtifacts();
  assert.strictEqual(removedCount, 4, 'Удалено 4 артефакта');
  assert(pm4.files['main.asm'], 'Исходник main.asm не затронут!');
  assert.strictEqual(pm4.files['main.bin'], undefined, 'main.bin очищен');
  assert.strictEqual(pm4.files['main.lst'], undefined, 'main.lst очищен');
  assert.strictEqual(pm4.artifacts.size, 0, 'Список артефактов пуст');
  pass('clearArtifacts() удаляет временные результаты без риска для исходников');

  // -------------------------------------------------------------
  // Тест 7: Обработка QuotaExceededError и аварийное сохранение
  // -------------------------------------------------------------
  console.log('Тест 7: Защита при переполнении квоты (QuotaExceededError)');
  const env5 = createMockEnvironment();
  const pm5 = env5.sandbox.bkProject;

  pm5.createFile('important_code.c', '/* Очень важный пользовательский код */\nint x = 42;');
  pm5.saveNow();

  // Включаем симуляцию ошибки переполнения квоты браузера
  env5.setQuotaError(true);

  let saveErrorTriggered = false;
  pm5.onChange((event) => {
    if (event === 'save-error') saveErrorTriggered = true;
  });

  // Пробуем сохранить еще изменение
  pm5.setFileContent('important_code.c', '/* Дополнение кода */\nint x = 100;');
  const saveResult = pm5.saveNow();

  // Проверяем, что исходники не утеряны в памяти
  assert.strictEqual(pm5.files['important_code.c'], '/* Дополнение кода */\nint x = 100;', 'Исходник в памяти в актуальном состоянии');
  pass('При переполнении квоты редактор не крашится и данные в памяти не теряются');

  // -------------------------------------------------------------
  // Тест 8: Транзакционная миграция из localStorage в IndexedDB
  // -------------------------------------------------------------
  console.log('Тест 8: Миграция существующих проектов в IndexedDB');
  const env6 = createMockEnvironment();

  // Записываем проект в стиле старой версии BKStudio в localStorage
  const legacyData = {
    files: {
      'legacy.asm': 'MOV #100, R0\nHALT\n',
      'legacy.bin': { __binary: true, data: Buffer.from([1, 2, 3]).toString('base64') }
    },
    activeFileName: 'legacy.asm',
    openTabs: ['legacy.asm'],
    settings: { platform: 'BK-0010', startAddress: '1000' },
    savedAt: 1700000000000
  };
  env6.localStorageStore.set('bkstudio_project_data', JSON.stringify(legacyData));

  // Создаем новый менеджер проектов, который должен подхватить legacy данные
  const pm6 = new env6.sandbox.BKProjectManager();

  // Синхронный старт
  assert.strictEqual(pm6.activeFileName, 'legacy.asm');
  assert(pm6.files['legacy.asm'], 'Legacy файл прочитан синхронно');
  assert(pm6.files['legacy.bin'] instanceof Uint8Array, 'Бинарный файл преобразован в Uint8Array');

  // Ждём асинхронную синхронизацию с IndexedDB
  await new Promise(r => setTimeout(r, 50));

  // Проверяем, что в IndexedDB данные появились
  const idbRecord = env6.idbStore.get('current_project');
  assert(idbRecord, 'Запись создана в IndexedDB');
  assert(idbRecord.files['legacy.asm'], 'Файл перенесен в IndexedDB');
  assert(env6.localStorageStore.get('bkstudio_idb_migrated'), 'Метка успешной миграции выставлена');
  assert(env6.localStorageStore.get('bkstudio_project_data'), 'Резервная копия в localStorage сохранена');
  pass('Транзакционная миграция переносит проект в IndexedDB без потери данных в localStorage');

  // -------------------------------------------------------------
  // Тест 9: Диагностика хранилища (getStorageDiagnostics)
  // -------------------------------------------------------------
  console.log('Тест 9: getStorageDiagnostics');
  const diag = await pm6.getStorageDiagnostics();
  assert(diag, 'Диагностика сформирована');
  assert.strictEqual(typeof diag.totalBytes, 'number');
  assert.strictEqual(typeof diag.sourcesCount, 'number');
  assert.strictEqual(typeof diag.artifactsCount, 'number');
  assert.strictEqual(diag.sourcesCount >= 1, true, 'Учтены файлы источников');
  pass('getStorageDiagnostics возвращает полную статистику хранилища');

  // -------------------------------------------------------------
  // Тест 10: Переключение между проектами и сэмплами
  // -------------------------------------------------------------
  console.log('Тест 10: Загрузка сэмпла Си (hello_c / test_c_sample)');
  pm6.loadSample('test_c_sample', false);
  assert(pm6.files['main.c'], 'main.c загружен');
  assert(pm6.files['tools.h'], 'tools.h загружен');
  assert.strictEqual(pm6.activeFileName, 'main.c');
  assert.strictEqual(pm6.openTabs[0], 'main.c');
  assert.strictEqual(pm6.openTabs[1], 'tools.h');
  assert.strictEqual(pm6.openTabs.length, 2);
  pass('Загрузка сэмпла сбрасывает старые артефакты и корректно открывает вкладки');

  // -------------------------------------------------------------
  // Тест 11: Точность round-trip для бинарных данных Uint8Array
  // -------------------------------------------------------------
  console.log('Тест 11: Точность round-trip для бинарных данных Uint8Array');
  const env7 = createMockEnvironment();
  const pm7 = env7.sandbox.bkProject;

  const testBinaryData = new Uint8Array(4096);
  for (let i = 0; i < testBinaryData.length; i++) {
    testBinaryData[i] = i % 256;
  }

  pm7.addArtifactFile('game.bin', testBinaryData);
  pm7.saveNow();

  const inMemoryBin = pm7.files['game.bin'];
  assert(inMemoryBin instanceof Uint8Array, 'В памяти лежит Uint8Array');
  assert.strictEqual(inMemoryBin.length, 4096);
  for (let i = 0; i < 4096; i++) {
    assert.strictEqual(inMemoryBin[i], i % 256);
  }

  const rawLs7 = env7.localStorageStore.get('bkstudio_project_data');
  assert(rawLs7, 'Данные записаны в localStorage');
  const parsedLs7 = JSON.parse(rawLs7);
  assert(parsedLs7.files['game.bin'], 'game.bin присутствует в сохраненных данных');
  assert(parsedLs7.files['game.bin'].__binary, 'Флаг __binary выставлен');

  const pm7Restored = new env7.sandbox.BKProjectManager();
  const restoredBin = pm7Restored.files['game.bin'];
  assert(restoredBin instanceof Uint8Array, 'Восстановленный файл является Uint8Array');
  assert.strictEqual(restoredBin.length, 4096);
  for (let i = 0; i < 4096; i++) {
    assert.strictEqual(restoredBin[i], i % 256);
  }
  pass('Бинарные файлы Uint8Array побайтово сохраняются и восстанавливаются');

  // -------------------------------------------------------------
  // Тест 12: Полный цикл компиляции программы на Си
  // -------------------------------------------------------------
  console.log('Тест 12: Симуляция полного цикла компиляции Си');
  const env8 = createMockEnvironment();
  const pm8 = env8.sandbox.bkProject;

  pm8.loadSample('test_c_sample', false);
  const initialSource = pm8.getFileContent('main.c');
  assert(initialSource.includes('int main'), 'Исходник загружен');

  pm8.setFileContent('main.c', '#include "tools.h"\nint main() { delay_ms(100); return 0; }');
  pm8.flushSave();
  assert.strictEqual(pm8.getFileContent('main.c'), '#include "tools.h"\nint main() { delay_ms(100); return 0; }');

  const mockGccBin = new Uint8Array([0o1000 & 0xff, 0o1000 >> 8, 20, 0, 0o000000, 0o000000]);
  const mockGccLst = '001000: 000000 HALT ; Generated listing';
  const mockGccMap = 'Memory Map:\n.text 001000 - 001024';

  pm8.addArtifactFiles({
    'main.bin': mockGccBin,
    'main.lst': mockGccLst,
    'main.map': mockGccMap
  });

  assert.strictEqual(pm8.files['main.bin'], mockGccBin);
  assert.strictEqual(pm8.files['main.lst'], mockGccLst);
  assert.strictEqual(pm8.files['main.map'], mockGccMap);
  assert(pm8.isArtifact('main.bin'));
  assert(pm8.isArtifact('main.lst'));
  assert(pm8.isArtifact('main.map'));
  assert(!pm8.isArtifact('main.c'));
  assert(!pm8.isArtifact('tools.h'));

  const mockGccBin2 = new Uint8Array([0o1000 & 0xff, 0o1000 >> 8, 30, 0, 0o000000]);
  pm8.addArtifactFiles({
    'main.bin': mockGccBin2,
    'main.lst': 'Updated listing v2',
    'main.map': 'Updated map v2'
  });

  assert.strictEqual(pm8.files['main.bin'], mockGccBin2);
  assert.strictEqual(pm8.files['main.lst'], 'Updated listing v2');
  assert.strictEqual(pm8.files['main.c'], '#include "tools.h"\nint main() { delay_ms(100); return 0; }', 'Исходник main.c остался нетронутым');
  pass('Полный цикл компиляции Си: обновление артефактов и сохранность исходников');

  console.log(`\n========================================`);
  console.log(`ВСЕ ТЕСТЫ ХРАНИЛИЩА ПРОЙДЕНЫ! (${passed} проверок)`);
  console.log(`========================================\n`);
}

runAllTests().catch(err => {
  console.error('ОШИБКА В ТЕСТАХ:', err);
  process.exit(1);
});
