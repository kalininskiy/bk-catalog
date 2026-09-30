# BK Emulator Debug RPC API

> Версия: 2026.1
> WebSocket: `ws://127.0.0.1:9091`
> Мост: `bk-emulator-bridge` (Kotlin/Native)

Протокол управления и отладки браузерного эмулятора БК.

## Архитектура

```text
MCP-клиент
    │
    │ MCP / STDIO
    ▼
bk-emulator-bridge
    │
    │ WebSocket :9091
    ▼
EmulatorBridgeWs.js
    │
    ▼
window.emulatorDebug
    │
    ▼
Эмулятор БК
```

`bk-emulator-bridge` — только транспортный адаптер. Логика эмулятора и отладки находится в `EmulatorDebug.js`.

---

## 1. WebSocket

Эмулятор подключается к:

```text
ws://127.0.0.1:9091
```

Адрес можно изменить через:

```text
?bridgeWs=ws://127.0.0.1:9091
```

или:

```javascript
window.BK_EMU_BRIDGE_WS_URL
```

Мост должен слушать только `127.0.0.1`.

### Сообщение готовности

После подключения эмулятор отправляет:

```json
{
  "type": "EMULATOR_READY",
  "version": "2026.1",
  "platform": "BK0010"
}
```

`platform` — текущая платформа эмулятора.

---

## 2. Запрос

```json
{
  "id": "123",
  "method": "getRegisters",
  "params": {}
}
```

Поля:

* `id` — идентификатор запроса;
* `method` — имя метода `EmulatorDebug`;
* `params` — параметры метода.

---

## 3. Ответ

Успешный:

```json
{
  "id": "123",
  "ok": true,
  "result": {}
}
```

Ошибка:

```json
{
  "id": "123",
  "ok": false,
  "error": {
    "code": "METHOD_ERROR",
    "message": "Unknown method"
  }
}
```

`id` ответа должен совпадать с `id` запроса.

---

# 4. Методы отладки

Все методы передаются непосредственно в:

```javascript
window.emulatorDebug.invoke(method, params)
```

### Состояние

| Метод                | Назначение          |
| -------------------- | ------------------- |
| `getStatus`          | Состояние эмулятора |
| `getRegisters`       | Регистры CPU        |
| `getPC`              | PC                  |
| `getSP`              | SP                  |
| `getSystemRegisters` | Системные регистры  |
| `Stack`              | Стек                |

### Управление выполнением

| Метод           | Назначение                    |
| --------------- | ----------------------------- |
| `pause`         | Остановить выполнение         |
| `continue`      | Продолжить выполнение         |
| `step`          | Выполнить одну инструкцию     |
| `reset`         | Сбросить эмулятор             |
| `resetAndClear` | Сбросить и очистить состояние |

### Точки останова

| Метод             | Назначение                |
| ----------------- | ------------------------- |
| `setBreakpoint`   | Установить точку останова |
| `clearBreakpoint` | Удалить точку останова    |

Пример:

```json
{
  "id": "10",
  "method": "setBreakpoint",
  "params": {
    "address": 4096
  }
}
```

### Память

| Метод         | Назначение        |
| ------------- | ----------------- |
| `readMemory`  | Читать память     |
| `writeMemory` | Записывать память |

Пример чтения:

```json
{
  "id": "20",
  "method": "readMemory",
  "params": {
    "address": 4096,
    "length": 32
  }
}
```

Пример записи:

```json
{
  "id": "21",
  "method": "writeMemory",
  "params": {
    "address": 4096,
    "data": [1, 2, 3, 4]
  }
}
```

### Дизассемблер

```text
disassemble
```

Дизассемблирует память начиная с указанного адреса.

Пример:

```json
{
  "id": "30",
  "method": "disassemble",
  "params": {
    "address": 4096,
    "count": 20
  }
}
```

---

# 5. Загрузка и управление эмулятором

| Метод           | Назначение             |
| --------------- | ---------------------- |
| `directLoadBIN` | Загрузить `.BIN`       |
| `setPlatform`   | Выбрать платформу      |
| `getScreenShot` | Получить снимок экрана |

Пример смены платформы:

```json
{
  "id": "40",
  "method": "setPlatform",
  "params": {
    "platform": "BK0011M"
  }
}
```

Для передачи бинарных данных через JSON используется безопасное для JSON представление, например Base64.

---

# 6. Ввод

При наличии соответствующих методов в `EmulatorDebug`:

| Метод         | Назначение            |
| ------------- | --------------------- |
| `keyPress`    | Нажатие клавиши       |
| `keyType`     | Ввод текста           |
| `joystickSet` | Управление джойстиком |

Список методов должен соответствовать фактическому API `EmulatorDebug.js`.

---

# 7. MCP

`bk-emulator-bridge` предоставляет эти операции MCP-клиентам.

Рекомендуемое соответствие:

| MCP-инструмент           | `EmulatorDebug`      |
| ------------------------ | -------------------- |
| `emulator.status`        | `getStatus`          |
| `emulator.load`          | `directLoadBIN`      |
| `emulator.reset`         | `reset`              |
| `emulator.run`           | `continue`           |
| `emulator.pause`         | `pause`              |
| `emulator.step`          | `step`               |
| `debug.registers`        | `getRegisters`       |
| `debug.pc`               | `getPC`              |
| `debug.sp`               | `getSP`              |
| `debug.system_registers` | `getSystemRegisters` |
| `debug.stack`            | `Stack`              |
| `debug.memory_read`      | `readMemory`         |
| `debug.memory_write`     | `writeMemory`        |
| `debug.disassemble`      | `disassemble`        |
| `debug.breakpoint_set`   | `setBreakpoint`      |
| `debug.breakpoint_clear` | `clearBreakpoint`    |
| `screen.get`             | `getScreenShot`      |

Инструменты должны иметь JSON Schema параметров.

MCP-слой не должен дублировать логику эмулятора.

---

# 8. Ошибки

Рекомендуемые коды:

```text
INVALID_REQUEST
INVALID_PARAMS
UNKNOWN_METHOD
EMULATOR_NOT_CONNECTED
BRIDGE_NOT_CONNECTED
TIMEOUT
METHOD_ERROR
INTERNAL_ERROR
```

Ошибки передаются в структурированном виде:

```json
{
  "id": "123",
  "ok": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "Invalid address"
  }
}
```

---

# 9. Таймаут

По умолчанию:

```text
5000 мс
```

По истечении таймаута запрос завершается ошибкой `TIMEOUT`.

---

# 10. STDIO

При работе как MCP-сервер:

```text
STDOUT → только MCP
STDERR → логи
```

Нельзя выводить диагностические сообщения в `STDOUT`, поскольку это нарушит MCP-протокол.

---

# 11. Безопасность

Мост работает локально и по умолчанию слушает только:

```text
127.0.0.1:9091
```

Мост не должен предоставлять:

* выполнение произвольного JavaScript;
* выполнение команд оболочки;
* произвольный доступ к файловой системе;
* произвольный сетевой прокси.

Все операции с эмулятором выполняются через `EmulatorDebug`.

---

## 12. Источник API

Основные файлы:

```text
emulator/src/ui/EmulatorDebug.js
emulator/src/ui/EmulatorBridgeWs.js
```

`EmulatorDebug.js` является источником истины для методов и их параметров.

`EmulatorBridgeWs.js` отвечает только за WebSocket.

`bk-emulator-bridge` отвечает за:

```text
MCP / STDIO
      ↕
WebSocket
```

и не содержит логики эмулятора.
