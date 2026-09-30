/**
 * BK Emulator - WebSocket Bridge Transport (Emulator side)
 *
 * Подключает браузерный эмулятор к локальному процессу BK Emulator Bridge (MCP Server)
 * через стандартный протокол JSON-RPC:
 *   - Вызовы передаются напрямую в window.emulatorDebug.invoke(method, params)
 *   - Ответы отправляются обратно в Bridge с correlation ID:
 *     { "id": reqId, "ok": true/false, "result": ..., "error": "..." }
 *   - Автоматически переподключается при обрыве соединения
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
    'use strict';

    class BKEmulatorWebSocketBridge {
        constructor() {
            this.ws = null;
            this.isConnected = false;
            this.reconnectTimer = null;
            this.reconnectInterval = 2000;
            this.url = this._resolveUrl();
            this.enabled = this._checkEnabled();
        }

        _resolveUrl() {
            try {
                if (typeof window !== 'undefined' && window.location) {
                    var params = new URLSearchParams(window.location.search);
                    var customWs = params.get('bridgeWs') || (typeof window !== 'undefined' && window.BK_EMU_BRIDGE_WS_URL);
                    if (customWs) return customWs;
                }
            } catch (e) {}
            return 'ws://127.0.0.1:9091';
        }

        _checkEnabled() {
            try {
                if (typeof window !== 'undefined' && window.location) {
                    var params = new URLSearchParams(window.location.search);
                    // Автоматически включается если есть флаг ?bridge или ?bridgeWs, либо по умолчанию в режиме ожидания
                    if (params.has('bridge') || params.has('bridgeWs')) return true;
                }
                if (typeof window !== 'undefined' && window.BK_EMU_BRIDGE_ENABLED) return true;
            } catch (e) {}
            // По умолчанию пытаемся фоново подключиться к локальному Bridge (тихий режим)
            return true;
        }

        init() {
            if (!this.enabled) return;
            this.connect();
        }

        connect() {
            if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
                return;
            }

            try {
                this.ws = new WebSocket(this.url);
            } catch (err) {
                this._scheduleReconnect();
                return;
            }

            this.ws.onopen = () => {
                this.isConnected = true;
                console.log('[BK Emulator Bridge] Соединение с локальным Bridge установлено:', this.url);
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                // Отправляем handshake о готовности
                this._send({
                    type: 'EMULATOR_READY',
                    version: '2026.1',
                    platform: (typeof base !== 'undefined' && base.isM && base.isM()) ? 'BK0011M' : 'BK0010'
                });
            };

            this.ws.onmessage = (event) => {
                try {
                    var msg = JSON.parse(event.data);
                    this._handleMessage(msg);
                } catch (err) {
                    console.error('[BK Emulator Bridge] Ошибка разбора сообщения:', err);
                }
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                this._scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                // При ошибке сокета закрытие отработает через onclose
            };
        }

        _scheduleReconnect() {
            if (this.reconnectTimer) return;
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, this.reconnectInterval);
        }

        _send(payload) {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(payload));
            }
        }

        _handleMessage(req) {
            if (!req || typeof req !== 'object') return;

            var id = req.id;
            var method = req.method;
            var params = req.params;

            // Обработка прямого вызова через EmulatorDebug
            if (window.emulatorDebug && typeof window.emulatorDebug.invoke === 'function') {
                var res = window.emulatorDebug.invoke(method, params);
                this._send({
                    id: id,
                    ok: res.ok,
                    result: res.ok ? res.result : undefined,
                    error: res.ok ? undefined : res.error
                });
            } else {
                this._send({
                    id: id,
                    ok: false,
                    error: 'Эмулятор еще не инициализирован (emulatorDebug недоступен)'
                });
            }
        }
    }

    global.BKEmulatorWebSocketBridge = BKEmulatorWebSocketBridge;
    global.bkEmulatorWebSocketBridge = new BKEmulatorWebSocketBridge();

    // Запуск после загрузки DOM
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', function () {
                global.bkEmulatorWebSocketBridge.init();
            });
        } else {
            global.bkEmulatorWebSocketBridge.init();
        }
    }

})(typeof window !== 'undefined' ? window : this);
