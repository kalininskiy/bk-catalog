/**
 * Тестирование логики bk-bridge-client в среде Node.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Эмуляция окружения браузера
const mockLocalStorage = {};
global.localStorage = {
  getItem: (k) => (k in mockLocalStorage ? mockLocalStorage[k] : null),
  setItem: (k, v) => { mockLocalStorage[k] = String(v); },
  removeItem: (k) => { delete mockLocalStorage[k]; }
};

global.window = {
  location: {
    search: '?GMPI=192.168.0.77'
  },
  addEventListener: () => {}
};

// Загружаем сначала gryphon-client.js, затем bk-bridge-client.js (как в index.html)
const gryphonCode = fs.readFileSync(path.join(__dirname, '..', 'gryphon-client.js'), 'utf8');
eval(gryphonCode);

const clientCode = fs.readFileSync(path.join(__dirname, '..', 'bk-bridge-client.js'), 'utf8');
eval(clientCode);

console.log('--- Запуск тестов BKStudio Bridge Client ---');

const client = global.window.bkBridgeClient || global.bkBridgeClient;
assert(client, 'bkBridgeClient должен быть инициализирован');

// Тест 1: Проверка проксирования настроек Gryphon
console.log('Тест 1: Проверка проксирования настроек Gryphon к bkGryphonClient');
assert.strictEqual(client.getGryphonHost(), '192.168.0.77', 'IP должен быть получен из query-параметра через bkGryphonClient');
assert.strictEqual(client.isGryphonEnabled(), true, 'Флаг Gryphon должен быть включен из-за ?GMPI');
console.log('  ✓ URL-параметр GMPI успешно применился');

// Тест 2: Сохранение и загрузка настроек
console.log('Тест 2: Сохранение и загрузка настроек');
client.setGryphonHost('192.168.1.100');
assert.strictEqual(client.getGryphonHost(), '192.168.1.100');
assert.strictEqual(global.localStorage.getItem('bkstudio_gryphon_host'), '192.168.1.100');

client.setGryphonEnabled(false);
assert.strictEqual(client.isGryphonEnabled(), false);
assert.strictEqual(global.localStorage.getItem('bkstudio_gryphon_enabled'), 'false');
console.log('  ✓ Настройки корректно сохраняются через прокси');

// Тест 2.1: Проверка флага включения соединения с Bridge
console.log('Тест 2.1: Флаг соединения с Bridge (isEnabled / setEnabled / disconnect)');
assert.strictEqual(client.isEnabled(), false, 'По умолчанию Bridge должен быть отключен');
client.setEnabled(true);
assert.strictEqual(client.isEnabled(), true, 'Bridge должен включиться');
assert.strictEqual(global.localStorage.getItem('bk_bridge_enabled'), 'true', 'Состояние должно сохраниться в localStorage');
client.setEnabled(false);
assert.strictEqual(client.isEnabled(), false, 'Bridge должен выключиться');
assert.strictEqual(global.localStorage.getItem('bk_bridge_enabled'), 'false', 'Выключение должно сохраниться в localStorage');
console.log('  ✓ Управление флагом включения Bridge и localStorage работает корректно');

// Тест 3: Имитация вызова callRpc при отключенном сокете
console.log('Тест 3: callRpc при отсутствии соединения с Bridge');
client.callRpc('bridge.status', {}, 500).catch(err => {
  assert(err.message.includes('не подключен'), 'Должна быть ошибка об отсутствии соединения');
  console.log('  ✓ Корректная обработка отключенного сокета:', err.message);
});

// Тест 4: Имитация отправки и ответа RPC через mock WebSocket
console.log('Тест 4: Mock JSON-RPC обмен');
let sentMessage = null;
client.ws = {
  readyState: 1, // OPEN
  send: (msg) => {
    sentMessage = JSON.parse(msg);
    // Эмулируем асинхронный ответ от Bridge
    setTimeout(() => {
      if (sentMessage.method === 'bridge.status') {
        client._handleMessage({
          jsonrpc: '2.0',
          id: sentMessage.id,
          result: {
            connected: true,
            version: '2026.1'
          }
        });
      }
    }, 10);
  }
};

client.callRpc('bridge.status', {}).then(res => {
  assert.strictEqual(res.connected, true);
  assert.strictEqual(res.version, '2026.1');
  console.log('  ✓ Полный цикл RPC вызова bridge.status успешно обработан через mock WebSocket');
  console.log('\nВСЕ ТЕСТЫ BRIDGE КЛИЕНТА УСПЕШНО ПРОЙДЕНЫ!');
}).catch(err => {
  console.error('Ошибка в тесте 4:', err);
  process.exit(1);
});
