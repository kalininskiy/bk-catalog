/**
 * Тестирование логики BKStudioGryphonClient и интеграции с bkAITools в среде Node.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Мокирование окружения браузера
const mockLocalStorage = {};
global.localStorage = {
  getItem: (k) => (k in mockLocalStorage ? mockLocalStorage[k] : null),
  setItem: (k, v) => { mockLocalStorage[k] = String(v); },
  removeItem: (k) => { delete mockLocalStorage[k]; }
};

global.window = {
  location: {
    protocol: 'http:',
    search: '?GMPI=192.168.0.92'
  },
  addEventListener: () => {}
};

// Загружаем код gryphon-client.js
const gryphonCode = fs.readFileSync(path.join(__dirname, '..', 'gryphon-client.js'), 'utf8');
eval(gryphonCode);

const client = global.window.bkGryphonClient || global.bkGryphonClient;
assert(client, 'bkGryphonClient должен быть инициализирован');

console.log('--- Запуск тестов BKStudio Gryphon-MPI Client ---');

// Тест 1: Проверка обработки URL-параметра ?GMPI=192.168.0.92
console.log('Тест 1: Проверка URL-параметра ?GMPI=...');
assert.strictEqual(client.getHost(), '192.168.0.92', 'IP должен быть получен из query-параметра GMPI');
assert.strictEqual(client.isEnabled(), true, 'Флаг должен быть включен из-за ?GMPI');
assert.strictEqual(client.getBaseUrl(), 'http://192.168.0.92/api', 'Базовый URL должен формироваться корректно');
console.log('  ✓ URL-параметр GMPI и базовый URL проверены');

// Тест 2: Сохранение и загрузка настроек
console.log('Тест 2: Сохранение и загрузка настроек');
client.setHost('192.168.1.55');
assert.strictEqual(client.getHost(), '192.168.1.55');
assert.strictEqual(global.localStorage.getItem('bkstudio_gryphon_host'), '192.168.1.55');

client.setEnabled(false);
assert.strictEqual(client.isEnabled(), false);
assert.strictEqual(global.localStorage.getItem('bkstudio_gryphon_enabled'), 'false');
console.log('  ✓ Настройки корректно сохраняются в localStorage');

// Тест 3: Проверка метода check() с прямым mock fetch
console.log('Тест 3: Прямая проверка check() через /api/version');
const capturedRequests = [];
global.fetch = async (url, options = {}) => {
  capturedRequests.push({ url, options });
  if (url.endsWith('/api/version')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ 'version-mpi': '1.4', 'version-net': '2.1' })
    };
  }
  if (url.endsWith('/api/bkinfo')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'БК-0010-01' })
    };
  }
  if (url.endsWith('/api/status')) {
    return {
      ok: true,
      status: 200,
      text: async () => 'READY'
    };
  }
  return { ok: false, status: 404, statusText: 'Not Found' };
};

(async () => {
  capturedRequests.length = 0;
  const checkRes = await client.check(3000, { host: '192.168.1.55' });
  assert.strictEqual(checkRes.ok, true, 'check() должен вернуть ok: true');
  assert.strictEqual(checkRes.host, '192.168.1.55');
  assert.strictEqual(checkRes.version['version-mpi'], '1.4');
  assert.strictEqual(checkRes.model, 'БК-0010-01');
  assert.strictEqual(checkRes.status, 'READY');
  assert(capturedRequests.some(r => r.url === 'http://192.168.1.55/api/version'), 'Запрос должен идти прямо на /api/version');
  console.log('  ✓ check() успешно выполнил прямой HTTP запрос');

  // Тест 4: Загрузка upload() через multipart/form-data
  console.log('Тест 4: Загрузка upload() через POST /api/upload');
  capturedRequests.length = 0;
  global.fetch = async (url, options = {}) => {
    capturedRequests.push({ url, options });
    if (url.endsWith('/api/upload')) {
      assert.strictEqual(options.method, 'POST');
      assert(options.body instanceof FormData, 'Тело запроса должно быть FormData');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, written: 8 })
      };
    }
    return { ok: false, status: 500 };
  };

  const sampleBin = new Uint8Array([0o137, 0o000, 0o200, 0o000, 0o100, 0o000, 0o240, 0o000]);
  const uploadRes = await client.upload('TEST.BIN', sampleBin, { host: '192.168.1.55' });
  assert.strictEqual(uploadRes.ok, true);
  assert.strictEqual(uploadRes.fileName, 'TEST.BIN');
  assert.strictEqual(uploadRes.storeas, '/BK_Uploads/TEST.BIN');
  assert.strictEqual(uploadRes.size, 8);
  console.log('  ✓ upload() успешно сформировал FormData и отправил на /api/upload');

  // Тест 5: Запуск run() через GET /api/run?dev=file&emu10=no&fname=...
  console.log('Тест 5: Запуск run() через GET /api/run');
  capturedRequests.length = 0;
  global.fetch = async (url, options = {}) => {
    capturedRequests.push({ url, options });
    if (url.includes('/api/run')) {
      assert.strictEqual(options.method, 'GET');
      assert(url.includes('fname=%2FBK_Uploads%2FTEST.BIN') || url.includes('fname=/BK_Uploads/TEST.BIN'));
      assert(url.includes('dev=file'));
      assert(url.includes('emu10=no'));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, started: true })
      };
    }
    return { ok: false, status: 500 };
  };

  const runRes = await client.run('TEST.BIN', { host: '192.168.1.55' });
  assert.strictEqual(runRes.ok, true);
  assert.strictEqual(runRes.fileName, 'TEST.BIN');
  console.log('  ✓ run() корректно сформировал query параметры и обратился к /api/run');

  // Тест 6: deploy() (upload -> run)
  console.log('Тест 6: Полный цикл deploy() (upload -> run)');
  capturedRequests.length = 0;
  global.fetch = async (url, options = {}) => {
    capturedRequests.push({ url, options });
    if (url.endsWith('/api/upload')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ uploaded: true }) };
    }
    if (url.includes('/api/run')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ started: true }) };
    }
    return { ok: false, status: 500 };
  };

  const deployRes = await client.deploy('DEMO.BIN', sampleBin, { host: '192.168.1.55' });
  assert.strictEqual(deployRes.ok, true);
  assert.strictEqual(deployRes.fileName, 'DEMO.BIN');
  assert(deployRes.upload && deployRes.upload.ok, 'Upload должен быть успешен');
  assert(deployRes.run && deployRes.run.ok, 'Run должен быть успешен');
  assert.strictEqual(capturedRequests.length, 2, 'Должно быть ровно 2 запроса (upload и run)');
  console.log('  ✓ deploy() успешно выполнил цепочку upload -> run');

  // Тест 7: Диагностика CORS и Mixed Content
  console.log('Тест 7: Диагностика сетевых ограничений браузера (CORS, Mixed Content)');
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  global.window.location.protocol = 'http:';
  const corsRes = await client.check(1000);
  assert.strictEqual(corsRes.ok, false);
  assert(corsRes.error.includes('CORS'), 'Ошибка должна указывать на возможную проблему CORS');
  console.log('  ✓ CORS ошибка распознана и понятно объяснена пользователю');

  global.window.location.protocol = 'https:';
  const mixedRes = await client.check(1000);
  assert.strictEqual(mixedRes.ok, false);
  assert(mixedRes.error.includes('Mixed Content'), 'Ошибка должна указывать на Mixed Content');
  console.log('  ✓ Mixed Content ошибка распознана');

  // Тест 8: Интеграция bkAITools с GryphonClient
  console.log('Тест 8: Интеграция bkAITools (gryphon.check, gryphon.deploy) без участия bridge');
  capturedRequests.length = 0;
  global.fetch = async (url, options = {}) => {
    capturedRequests.push({ url, options });
    if (url.includes('/api/version')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ version: '1.2.3' }) };
    }
    if (url.includes('/api/bkinfo')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ bk_type: '0010' }) };
    }
    if (url.includes('/api/status')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ running: true }) };
    }
    if (url.endsWith('/api/upload')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ uploaded: true }) };
    }
    if (url.includes('/api/run')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ started: true }) };
    }
    return { ok: false, status: 500 };
  };
  global.window.location.protocol = 'http:';

  // Загружаем bk-ai-tools.js
  require('../bk-ai-tools.js');
  assert(global.window.bkAITools, 'Реестр bkAITools должен существовать');
  assert(global.window.bkAITools.has('gryphon.check'), 'Инструмент gryphon.check должен быть зарегистрирован');
  assert(global.window.bkAITools.has('gryphon.deploy'), 'Инструмент gryphon.deploy должен быть зарегистрирован');

  const checkToolRes = await global.window.bkAITools.execute('gryphon.check', { host: '192.168.0.92' });
  assert.strictEqual(checkToolRes.success, true);
  assert.strictEqual(checkToolRes.host, '192.168.0.92');
  console.log('  ✓ bkAITools.execute("gryphon.check") работает напрямую через GryphonClient');

  const deployToolRes = await global.window.bkAITools.execute('gryphon.deploy', {
    fileName: 'GAME.BIN',
    binData: [0, 1, 2, 3, 4, 5, 6, 7],
    host: '192.168.0.92'
  });
  assert.strictEqual(deployToolRes.success, true);
  assert.strictEqual(deployToolRes.fileName, 'GAME.BIN');
  console.log('  ✓ bkAITools.execute("gryphon.deploy") выполняет загрузку и запуск на Gryphon');

  console.log('\nВСЕ ТЕСТЫ GRYPHON-КЛИЕНТА УСПЕШНО ПРОЙДЕНЫ!');
})().catch(err => {
  console.error('Ошибка выполнения тестов:', err);
  process.exit(1);
});
