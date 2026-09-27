#!/usr/bin/env node
/**
 * BKStudio - Тесты модуля bk-ai-manager.js
 *
 * Проверяет:
 *   - создание глобального объекта bkAI и класса BKAIManager;
 *   - структуру конфигурации по умолчанию (provider, baseUrl, apiKey, model, temperature, maxTokens);
 *   - методы getConfig() и setConfig();
 *   - изоляцию хранения настроек в отдельном ключе localStorage ('bkstudio_ai_config');
 *   - неизменность хранилища проектов BKStudio ('bkstudio_project_data');
 *   - каркасные методы chat(), testConnection(), getModels();
 *   - события изменения конфигурации (onChange).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function check(name, ok) {
    if (ok) {
        console.log('PASS: ' + name);
        passed++;
    } else {
        console.error('FAIL: ' + name);
        failed++;
    }
}

// Фейковое localStorage
const storage = {};
const fakeLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
    setItem: (key, val) => { storage[key] = String(val); },
    removeItem: (key) => { delete storage[key]; },
    clear: () => {
        for (const k in storage) {
            delete storage[k];
        }
    }
};

const sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Error: Error
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// Загрузка модуля
const code = fs.readFileSync(path.join(JS_DIR, 'bk-ai-manager.js'), 'utf8');
vm.runInContext(code, sandbox, { filename: 'bk-ai-manager.js' });

const bkAI = sandbox.bkAI;
const BKAIManager = sandbox.BKAIManager;

// 1. Проверка глобальных объектов
check('Экспорт класса BKAIManager', typeof BKAIManager === 'function');
check('Экспорт экземпляра window.bkAI', typeof bkAI === 'object' && bkAI !== null);
check('Экземпляр принадлежит BKAIManager', bkAI instanceof BKAIManager);

// 2. Проверка начальной конфигурации
const initialConfig = bkAI.getConfig();
check('getConfig() возвращает объект', typeof initialConfig === 'object' && initialConfig !== null);
check('Конфигурация содержит provider', typeof initialConfig.provider === 'string');
check('Конфигурация содержит baseUrl', typeof initialConfig.baseUrl === 'string');
check('Конфигурация содержит apiKey', typeof initialConfig.apiKey === 'string');
check('Конфигурация содержит model', typeof initialConfig.model === 'string');
check('Конфигурация содержит temperature (число)', typeof initialConfig.temperature === 'number');
check('Конфигурация содержит maxTokens (число)', typeof initialConfig.maxTokens === 'number');

// 3. Иммутабельность возвращаемого getConfig()
initialConfig.provider = 'tampered';
check('getConfig() возвращает копию (состояние защищено от прямой мутации)', bkAI.getConfig().provider !== 'tampered');

// 4. Проверка setConfig() и сохранения в localStorage
let changeEventFired = false;
let changeEventData = null;
const unsubscribe = bkAI.onChange((event, data) => {
    if (event === 'config-changed') {
        changeEventFired = true;
        changeEventData = data;
    }
});

const updatedConfig = bkAI.setConfig({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test-secret-12345',
    model: 'deepseek-chat',
    temperature: 0.5,
    maxTokens: 4096
});

check('setConfig() обновляет provider', updatedConfig.provider === 'deepseek');
check('setConfig() обновляет baseUrl', updatedConfig.baseUrl === 'https://api.deepseek.com/v1');
check('setConfig() обновляет apiKey', updatedConfig.apiKey === 'sk-test-secret-12345');
check('setConfig() обновляет model', updatedConfig.model === 'deepseek-chat');
check('setConfig() обновляет temperature', updatedConfig.temperature === 0.5);
check('setConfig() обновляет maxTokens', updatedConfig.maxTokens === 4096);

check('Событие onChange сработало при setConfig()', changeEventFired === true);
check('Данные onChange содержат обновленный config', changeEventData && changeEventData.config && changeEventData.config.model === 'deepseek-chat');

// 5. Проверка отдельного ключа в localStorage и изоляции от хранилища проектов
check('Настройки сохранены в localStorage по ключу bkstudio_ai_config', typeof storage['bkstudio_ai_config'] === 'string');
check('Ключ хранилища проектов bkstudio_project_data не затронут', typeof storage['bkstudio_project_data'] === 'undefined');

const storedData = JSON.parse(storage['bkstudio_ai_config']);
check('Хранилище содержит корректный apiKey', storedData.apiKey === 'sk-test-secret-12345');
check('Хранилище содержит корректный provider', storedData.provider === 'deepseek');

// 6. Проверка отписки от событий
changeEventFired = false;
unsubscribe();
bkAI.setConfig({ model: 'deepseek-coder' });
check('После отписки onChange больше не вызывается', changeEventFired === false);
check('Конфигурация обновилась без подписчиков', bkAI.getConfig().model === 'deepseek-coder');

// 7. Проверка восстановления из localStorage при создании нового экземпляра
const newManager = new sandbox.BKAIManager();
const loadedConfig = newManager.getConfig();
check('Новый экземпляр загружает настройки из localStorage', loadedConfig.apiKey === 'sk-test-secret-12345');
check('Новый экземпляр восстановил model', loadedConfig.model === 'deepseek-coder');

// 8. Проверка сброса настроек resetConfig()
const resetCfg = bkAI.resetConfig();
check('resetConfig() возвращает provider по умолчанию', resetCfg.provider === 'openai');
check('resetConfig() очищает apiKey', resetCfg.apiKey === '');
check('resetConfig() обновляет localStorage', JSON.parse(storage['bkstudio_ai_config']).provider === 'openai');

// 9. Проверка асинхронных методов API
async function runAsyncTests() {
    // getModels()
    const modelsPromise = bkAI.getModels();
    check('getModels() возвращает Promise', modelsPromise instanceof sandbox.Promise || (modelsPromise && typeof modelsPromise.then === 'function'));
    const models = await modelsPromise;
    check('getModels() разрешается массивом', Array.isArray(models));

    // testConnection()
    let testConnError = null;
    try {
        await bkAI.testConnection();
    } catch (err) {
        testConnError = err;
    }
    check('testConnection() возвращает Promise и корректно отклоняется при незаполненном ключе или нереализованном провайдере',
        testConnError instanceof sandbox.Error || (testConnError && typeof testConnError.message === 'string'));

    // chat()
    let chatError = null;
    try {
        await bkAI.chat({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err) {
        chatError = err;
    }
    check('chat() возвращает Promise и отклоняется с информативным сообщением',
        Boolean(chatError && typeof chatError.message === 'string' &&
        (chatError.message.indexOf('не реализован') !== -1 || chatError.message.indexOf('разработке') !== -1)));

    console.log(`\nИтог: Пройдено: ${passed}, упало: ${failed}`);
    if (failed > 0) {
        process.exit(1);
    }
}

runAsyncTests().catch((err) => {
    console.error('Непредвиденная ошибка тестов:', err);
    process.exit(1);
});
