/**
 * BKStudio - Bridge Client (WebSocket JSON-RPC Transport)
 *
 * Предоставляет полнодуплексный канал связи между средой BKStudio (в браузере)
 * и локальным внешним процессом BKStudio Bridge (CLI / MCP Сервер).
 *
 * Возможности:
 *   - Подключение к ws://127.0.0.1:9090 (или URL из window.BK_BRIDGE_WS_URL / ?bridgeWs=...)
 *   - Двусторонний JSON-RPC 2.0:
 *       1) Прием вызовов от Bridge/MCP (tools.list, tools.execute, system.ping);
 *       2) Отправка вызовов в Bridge (bridge.status, system.ready).
 *
 * Примечание: прямое взаимодействие с реальным БК через Gryphon-MPI перенесено
 * в модуль BKStudioGryphonClient (js/gryphon-client.js) и выполняется браузером напрямую
 * по HTTP REST API без участия BKStudio Bridge.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  class BKBridgeClient {
    constructor() {
      this.ws = null;
      this.isConnected = false;
      this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'error'
      this.reconnectTimer = null;
      this.reconnectInterval = 3000;
      this.wsUrl = this._resolveUrl();
      this.enabled = this._checkEnabled();

      // Управление исходящими RPC-вызовами
      this.requestId = 1;
      this.pendingRequests = new Map();
      this.statusListeners = [];
      this.bridgeInfo = null;
    }

    _resolveUrl() {
      try {
        if (typeof window !== 'undefined' && window.location) {
          const params = new URLSearchParams(window.location.search);
          const customWs = params.get('bridgeWs') || (typeof window !== 'undefined' && window.BK_BRIDGE_WS_URL);
          if (customWs) return customWs;
        }
      } catch (e) {
        // Игнорируем ошибки URLSearchParams
      }
      return 'ws://127.0.0.1:9090';
    }

    _checkEnabled() {
      try {
        if (typeof window !== 'undefined' && window.location) {
          const params = new URLSearchParams(window.location.search);
          if (params.get('bridge') === 'false') return false;
        }
      } catch (e) {
        // Игнорируем ошибки URLSearchParams
      }
      return true;
    }

    // Прокси-методы для обратной совместимости с настройками Gryphon
    isGryphonEnabled() {
      return global.bkGryphonClient ? global.bkGryphonClient.isEnabled() : false;
    }

    setGryphonEnabled(enabled) {
      if (global.bkGryphonClient) {
        global.bkGryphonClient.setEnabled(enabled);
      }
    }

    getGryphonHost() {
      return global.bkGryphonClient ? global.bkGryphonClient.getHost() : '192.168.0.92';
    }

    setGryphonHost(host) {
      if (global.bkGryphonClient) {
        global.bkGryphonClient.setHost(host);
      }
    }

    onStatusChange(callback) {
      if (typeof callback === 'function') {
        this.statusListeners.push(callback);
        // Немедленно вызываем с текущим статусом
        callback(this.status, this);
      }
    }

    _setStatus(status) {
      this.status = status;
      this.isConnected = (status === 'connected');
      for (const listener of this.statusListeners) {
        try {
          listener(status, this);
        } catch (e) {
          console.error('[BKStudio Bridge] Ошибка слушателя статуса:', e);
        }
      }
    }

    init() {
      if (!this.enabled) {
        global.startBKBridge = (url) => {
          if (url) this.wsUrl = url;
          this.enabled = true;
          this.connect();
        };
        return;
      }
      this.connect();
    }

    connect() {
      if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
        return;
      }

      this._setStatus('connecting');

      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err) {
        this._setStatus('error');
        this._scheduleReconnect();
        return;
      }

      this.ws.onopen = async () => {
        this._setStatus('connected');
        console.log(`[BKStudio Bridge] Соединение установлено: ${this.wsUrl}`);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Оповещаем мост о готовности
        this._send({
          jsonrpc: '2.0',
          method: 'system.ready',
          params: {
            app: 'BKStudio',
            version: '2026.1',
            toolsCount: global.bkAITools ? global.bkAITools.list().length : 0
          }
        });

        // Запрашиваем метаданные о мосте
        try {
          this.bridgeInfo = await this.callRpc('bridge.status', {}, 3000);
        } catch (_e) {
          this.bridgeInfo = { version: '1.0.0' };
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          await this._handleMessage(data);
        } catch (err) {
          console.error('[BKStudio Bridge] Ошибка парсинга сообщения:', err);
        }
      };

      this.ws.onclose = () => {
        this._setStatus('disconnected');
        this._rejectPendingRequests('Соединение с BKStudio Bridge закрыто');
        this._scheduleReconnect();
      };

      this.ws.onerror = (_err) => {
        this._setStatus('error');
      };
    }

    _rejectPendingRequests(reason) {
      for (const [id, req] of this.pendingRequests.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error(reason));
      }
      this.pendingRequests.clear();
    }

    _scheduleReconnect() {
      if (!this.enabled) return;
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

    /**
     * Отправляет JSON-RPC 2.0 запрос в BKStudio Bridge и возвращает Promise.
     *
     * @param {string} method - Имя метода (например 'gryphon.check', 'gryphon.deploy')
     * @param {Object} [params={}] - Параметры вызова
     * @param {number} [timeoutMs=15000] - Тайм-аут ожидания ответа в миллисекундах
     * @returns {Promise<any>}
     */
    callRpc(method, params = {}, timeoutMs = 15000) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('BKStudio Bridge не подключен (ws://127.0.0.1:9090)'));
      }

      const id = this.requestId++;
      const payload = {
        jsonrpc: '2.0',
        id: id,
        method: method,
        params: params
      };

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`Тайм-аут ожидания ответа от BKStudio Bridge на вызов ${method} (${timeoutMs} мс)`));
        }, timeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timer });
        this._send(payload);
      });
    }

    // Примечание: методы работы с Gryphon-MPI (check, upload, run, deploy)
    // перенесены в модуль js/gryphon-client.js (BKStudioGryphonClient).

    async _handleMessage(req) {
      if (!req || typeof req !== 'object') return;

      const { id, method, params, result, error } = req;

      // 1. Если это ответ на наш исходящий RPC-вызов (есть id в pendingRequests)
      if (id !== undefined && id !== null && this.pendingRequests.has(id)) {
        const pending = this.pendingRequests.get(id);
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);

        if (error) {
          const errMsg = (error && error.message) ? error.message : String(error);
          pending.reject(new Error(errMsg));
        } else {
          pending.resolve(result);
        }
        return;
      }

      // 2. Если это входящий запрос от Bridge/MCP сервера к BKStudio
      if (method) {
        try {
          let callResult = null;

          switch (method) {
            case 'tools.list': {
              if (!global.bkAITools) throw new Error('BKAIToolRegistry недоступен');
              callResult = (typeof global.bkAITools.getDefinitions === 'function')
                ? global.bkAITools.getDefinitions()
                : global.bkAITools.getSchemas('standard');
              break;
            }

            case 'tools.execute': {
              if (!global.bkAITools) throw new Error('BKAIToolRegistry недоступен');
              const toolName = params ? params.name : null;
              const toolArgs = (params && params.arguments) ? params.arguments : {};
              if (!toolName) throw new Error('Не указано имя инструмента (name)');

              callResult = await global.bkAITools.execute(toolName, toolArgs);
              break;
            }

            case 'system.ping': {
              callResult = { pong: true, timestamp: Date.now() };
              break;
            }

            default:
              throw { code: -32601, message: `Метод не найден: ${method}` };
          }

          if (id !== undefined && id !== null) {
            this._send({
              jsonrpc: '2.0',
              id: id,
              result: callResult
            });
          }
        } catch (err) {
          if (id !== undefined && id !== null) {
            const code = (err && typeof err.code === 'number') ? err.code : -32603;
            const message = (err && err.message) ? err.message : String(err);
            this._send({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: code,
                message: message
              }
            });
          }
        }
      }
    }
  }

  global.BKBridgeClient = BKBridgeClient;
  global.bkBridgeClient = new BKBridgeClient();

  // Автоматический запуск при инициализации страницы
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      global.bkBridgeClient.init();
    });
  }

})(typeof window !== 'undefined' ? window : this);
