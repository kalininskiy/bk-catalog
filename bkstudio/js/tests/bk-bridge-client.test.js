/**
 * Тестирование логики bk-bridge-client в среде Node.js
 */

const assert = require('assert');

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

// Загружаем код bk-bridge-client
const fs = require('fs');
const path = require('path');
const clientCode = fs.readFileSync(path.join(__dirname, '..', 'bk-bridge-client.js'), 'utf8');

// Выполняем в контексте глобального scope
eval(clientCode);

console.log('--- Запуск тестов BKStudio Bridge Client ---');

const client = global.window.bkBridgeClient || global.bkBridgeClient;
assert(client, 'bkBridgeClient должен быть инициализирован');

// Тест 1: Проверка обработки URL-параметра ?GMPI=192.168.0.77
console.log('Тест 1: Проверка URL-параметра ?GMPI=...');
assert.strictEqual(client.getGryphonHost(), '192.168.0.77', 'IP должен быть получен из query-параметра');
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
console.log('  ✓ Настройки корректно сохраняются в localStorage');

// Тест 3: Base64 кодирование бинарных данных Uint8Array
console.log('Тест 3: Base64 кодирование данных .BIN');
const testBin = new Uint8Array([0o137, 0o000, 0o200, 0o000, 0o100, 0o000, 0o240, 0o000]); // 8 байт
// Проверяем вызов _uint8ArrayToBase64
const b64 = client._uint8ArrayToBase64(testBin);
const expectedB64 = Buffer.from(testBin).toString('base64');
assert.strictEqual(b64, expectedB64, 'Base64 представление должно совпадать');
console.log('  ✓ Base64 кодирование Uint8Array работает идентично Buffer.from');

// Тест 4: Имитация вызова callRpc при отключенном сокете
console.log('Тест 4: callRpc при отсутствии соединения с Bridge');
client.callRpc('bridge.status', {}, 500).catch(err => {
    assert(err.message.includes('не подключен'), 'Должна быть ошибка об отсутствии соединения');
    console.log('  ✓ Корректная обработка отключенного сокета:', err.message);
});

// Тест 5: Имитация отправки и ответа RPC через mock WebSocket
console.log('Тест 5: Mock JSON-RPC обмен');
let sentMessage = null;
client.ws = {
    readyState: 1, // OPEN
    send: (msg) => {
        sentMessage = JSON.parse(msg);
        // Эмулируем асинхронный ответ от Bridge
        setTimeout(() => {
            if (sentMessage.method === 'gryphon.deploy') {
                client._handleMessage({
                    jsonrpc: '2.0',
                    id: sentMessage.id,
                    result: {
                        success: true,
                        fileName: sentMessage.params.fileName,
                        size: sentMessage.params.size,
                        uploaded: true,
                        started: true,
                        message: 'OK'
                    }
                });
            }
        }, 10);
    }
};

client.runOnGryphon('DEMO.BIN', testBin).then(res => {
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.fileName, 'DEMO.BIN');
    assert.strictEqual(res.uploaded, true);
    assert.strictEqual(res.started, true);
    console.log('  ✓ Полный цикл RPC deploy/run успешно обработан через mock WebSocket');
    console.log('\nВСЕ ТЕСТЫ КЛИЕНТА УСПЕШНО ПРОЙДЕНЫ!');
}).catch(err => {
    console.error('Ошибка в тесте 5:', err);
    process.exit(1);
});
