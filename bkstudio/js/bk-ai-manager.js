/**
 * BKStudio - AI Manager (Интеграция с AI)
 * 
 * Менеджер для работы с искусственным интеллектом в BKStudio.
 * Обеспечивает хранение настроек подключения к AI-провайдерам,
 * управление конфигурацией и единый фасад для взаимодействия с LLM.
 *
 * Настройки хранятся отдельно от проектов в localStorage под собственным ключом
 * и никогда не включаются в состав экспортируемых проектов или ZIP-архивов.
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
(function (global) {
  'use strict';

  /** Ключ для хранения конфигурации AI в localStorage */
  const STORAGE_KEY = 'bkstudio_ai_config';

  /**
   * Готовые профили AI-серверов.
   * Все профили используют OpenAI-совместимый эндпоинт (POST {baseUrl}/chat/completions).
   */
  const AI_PROFILES = Object.freeze({
    'openai': Object.freeze({
      id: 'openai',
      name: 'OpenAI',
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      description: 'Официальный API OpenAI',
      maxTokens: 65536
    }),
    'gemini': Object.freeze({
      id: 'gemini',
      name: 'Gemini (OpenAI-compatible)',
      provider: 'openai-compatible',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      description: 'Google Gemini OpenAI-compatible API',
      maxTokens: 65536
    }),
    'llamacpp': Object.freeze({
      id: 'llamacpp',
      name: 'llama.cpp',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8080/v1',
      description: 'Локальный сервер llama.cpp',
      maxTokens: 65536
    }),
    'ollama': Object.freeze({
      id: 'ollama',
      name: 'Ollama',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      description: 'Локальный сервис Ollama',
      maxTokens: 65536
    }),
    'lmstudio': Object.freeze({
      id: 'lmstudio',
      name: 'LM Studio',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      description: 'Локальный сервер LM Studio',
      maxTokens: 65536
    }),
    'anthropic': Object.freeze({
      id: 'anthropic',
      name: 'Anthropic Claude',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      description: 'Официальный API Anthropic Claude (Messages API)',
      maxTokens: 65536
    })
  });

  /** Конфигурация по умолчанию */
  const DEFAULT_CONFIG = Object.freeze({
    provider: 'openai',
    profile: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 65536
  });

  /** Список Skills по умолчанию для программирования и графики БК-0010 / БК-0011М */
  const DEFAULT_SKILLS = Object.freeze([
    'bk0010code',
    'bk0010emt',
    'bkgraphics'
  ]);

  /**
   * Класс менеджера AI для BKStudio
   */
  class BKAIManager {
    constructor() {
      /** @type {Object} Текущая конфигурация */
      this.config = Object.assign({}, DEFAULT_CONFIG);

      /** @type {Function[]} Подписчики на изменение конфигурации */
      this.listeners = [];

      /** @type {Map<string, Object>} Зарегистрированные AI-провайдеры */
      this.providers = new Map();

      /** @type {string|null} Кэш содержимого системного промпта из bkstudio/ai/system.md */
      this._systemPromptCache = null;
      /** @type {Promise<string>|null} Активный промис загрузки system.md */
      this._systemPromptPromise = null;

      /** @type {Set<string>} Реестр зарегистрированных Skills */
      this.registeredSkills = new Set(DEFAULT_SKILLS);
      /** @type {string[]} Список активных Skills для текущей сессии */
      this.enabledSkills = [...DEFAULT_SKILLS];
      /** @type {Map<string, string>} Кэш загруженных Skills в оперативной памяти */
      this._skillsCache = new Map();
      /** @type {Map<string, Promise<string>>} Активные промисы загрузки Skills */
      this._skillsPromises = new Map();

      this.loadFromStorage();
      this._autoRegisterKnownProviders(global);
    }

    /**
     * Автоматически регистрирует провайдеры, если они уже объявлены в глобальной области.
     * @private
     * @param {Object} root
     */
    _autoRegisterKnownProviders(root) {
      if (!root) return;
      if (root.bkOpenAICompatibleProvider) {
        const p = root.bkOpenAICompatibleProvider;
        const aliases = [
          'openai-compatible',
          'openai',
          'gemini',
          'llamacpp',
          'llama.cpp',
          'ollama',
          'lmstudio',
          'openrouter',
          'custom'
        ];
        aliases.forEach(alias => this.registerProvider(alias, p));
      }
      if (root.bkAnthropicProvider) {
        this.registerProvider('anthropic', root.bkAnthropicProvider);
        this.registerProvider('claude', root.bkAnthropicProvider);
      }
    }

    /**
     * Регистрирует провайдер AI в менеджере.
     * @param {string} name - Идентификатор провайдера (например, 'openai', 'ollama', 'openai-compatible').
     * @param {Object} providerInstance - Экземпляр провайдера с методами chat(), testConnection(), getModels().
     */
    registerProvider(name, providerInstance) {
      if (!name || typeof name !== 'string') {
        throw new Error('Имя провайдера должно быть непустой строкой');
      }
      if (!providerInstance || typeof providerInstance.chat !== 'function') {
        throw new Error(`Провайдер "${name}" должен реализовывать метод chat()`);
      }
      this.providers.set(name.toLowerCase().trim(), providerInstance);
    }

    /**
     * Возвращает зарегистрированный экземпляр провайдера по имени.
     * Если прямое имя не найдено, проверяет соответствие профилю или возвращает openai-compatible.
     * @param {string} name - Имя провайдера или профиля.
     * @returns {Object|null}
     */
    getProvider(name) {
      if (!name || typeof name !== 'string') {
        return null;
      }
      const key = name.toLowerCase().trim();
      let provider = this.providers.get(key);
      if (provider) {
        return provider;
      }

      // Если имя совпадает с профилем (например, 'gemini' или 'llama.cpp')
      const profile = this.getProfile(key);
      if (profile && profile.provider) {
        provider = this.providers.get(profile.provider.toLowerCase().trim());
        if (provider) {
          return provider;
        }
      }

      // Все профили используют OpenAI-compatible provider
      return this.providers.get('openai-compatible') || null;
    }

    /**
     * Возвращает список всех готовых профилей.
     * @returns {Array<{id: string, name: string, provider: string, baseUrl: string, description: string}>}
     */
    getProfiles() {
      return Object.keys(AI_PROFILES).map(k => Object.assign({}, AI_PROFILES[k]));
    }

    /**
     * Возвращает профиль по его идентификатору.
     * @param {string} id - Идентификатор профиля (например, 'openai', 'gemini', 'ollama', 'lmstudio', 'llamacpp').
     * @returns {Object|null}
     */
    getProfile(id) {
      if (!id || typeof id !== 'string') return null;
      const clean = id.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      for (const key of Object.keys(AI_PROFILES)) {
        if (key === id.toLowerCase().trim() || key.replace(/[^a-z0-9]/g, '') === clean) {
          return Object.assign({}, AI_PROFILES[key]);
        }
      }
      return null;
    }

    /**
     * Применяет готовый профиль к текущей конфигурации.
     * Пользователь может переопределить baseUrl, apiKey, model и другие параметры через overrides.
     * Не зашивает API ключи.
     *
     * @param {string} profileId - Идентификатор профиля ('openai', 'gemini', 'ollama', 'lmstudio', 'llamacpp').
     * @param {Object} [overrides] - Пользовательские переопределения (baseUrl, apiKey, model и др.).
     * @returns {Object} Обновленная конфигурация.
     */
    applyProfile(profileId, overrides = {}) {
      const profile = this.getProfile(profileId);
      if (!profile) {
        throw new Error(`Профиль AI "${profileId}" не найден.`);
      }

      const patch = Object.assign({
        profile: profile.id,
        provider: profile.id,
        baseUrl: profile.baseUrl
      }, overrides);

      return this.setConfig(patch);
    }

    /**
     * Загружает сохранённую конфигурацию из localStorage.
     */
    loadFromStorage() {
      try {
        if (typeof localStorage === 'undefined') {
          return;
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            this.config = this._sanitizeConfig(Object.assign({}, DEFAULT_CONFIG, parsed));
          }
        }
      } catch (err) {
        console.warn('[BKAIManager] Не удалось загрузить конфигурацию из localStorage:', err);
      }
    }

    /**
     * Сохраняет текущую конфигурацию в localStorage отдельно от проекта.
     */
    saveToStorage() {
      try {
        if (typeof localStorage === 'undefined') {
          return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
      } catch (err) {
        console.warn('[BKAIManager] Ошибка сохранения конфигурации в localStorage:', err);
      }
    }

    /**
     * Очищает и нормализует переданные параметры конфигурации.
     * Позволяет пользователю свободно изменять baseUrl, apiKey, model.
     * @private
     * @param {Object} rawConfig
     * @returns {Object}
     */
    _sanitizeConfig(rawConfig) {
      const cfg = Object.assign({}, DEFAULT_CONFIG, rawConfig);

      let profileId = typeof cfg.profile === 'string' && cfg.profile.trim()
        ? cfg.profile.trim().toLowerCase()
        : '';

      if (!profileId && typeof cfg.provider === 'string') {
        const found = this.getProfile(cfg.provider);
        if (found) profileId = found.id;
      }
      if (!profileId) {
        profileId = DEFAULT_CONFIG.profile;
      }

      let baseUrl = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : '';
      if (!baseUrl && profileId) {
        const prof = this.getProfile(profileId);
        if (prof) {
          baseUrl = prof.baseUrl;
        }
      }

      return {
        provider: typeof cfg.provider === 'string' ? cfg.provider.trim() : DEFAULT_CONFIG.provider,
        profile: profileId,
        baseUrl: baseUrl,
        apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '',
        model: typeof cfg.model === 'string' ? cfg.model.trim() : '',
        temperature: (typeof cfg.temperature === 'number' && !isNaN(cfg.temperature))
          ? Math.max(0, Math.min(2, cfg.temperature))
          : DEFAULT_CONFIG.temperature,
        maxTokens: (typeof cfg.maxTokens === 'number' && !isNaN(cfg.maxTokens) && cfg.maxTokens > 0)
          ? Math.floor(cfg.maxTokens)
          : DEFAULT_CONFIG.maxTokens
      };
    }

    /**
     * Возвращает копию текущей конфигурации AI.
     * @returns {Object} { provider, baseUrl, apiKey, model, temperature, maxTokens }
     */
    getConfig() {
      return Object.assign({}, this.config);
    }

    /**
     * Обновляет конфигурацию AI и сохраняет её в localStorage.
     * @param {Object} newConfig - Частичная или полная новая конфигурация.
     * @returns {Object} Обновлённая копия конфигурации.
     */
    setConfig(newConfig) {
      if (!newConfig || typeof newConfig !== 'object') {
        throw new Error('Параметр config должен быть объектом');
      }

      this.config = this._sanitizeConfig(Object.assign({}, this.config, newConfig));
      this.saveToStorage();
      this._notifyChange();
      return this.getConfig();
    }

    /**
     * Сбрасывает конфигурацию к значениям по умолчанию.
     * @returns {Object} Конфигурация по умолчанию.
     */
    resetConfig() {
      this.config = Object.assign({}, DEFAULT_CONFIG);
      this.saveToStorage();
      this._notifyChange();
      return this.getConfig();
    }

    /**
     * Подписка на изменение конфигурации AI.
     * @param {Function} callback - Функция обратного вызова (event, data).
     * @returns {Function} Функция для отписки.
     */
    onChange(callback) {
      if (typeof callback === 'function') {
        this.listeners.push(callback);
      }
      return () => {
        const idx = this.listeners.indexOf(callback);
        if (idx !== -1) {
          this.listeners.splice(idx, 1);
        }
      };
    }

    /**
     * Уведомляет подписчиков об изменении конфигурации.
     * @private
     */
    _notifyChange() {
      const cfg = this.getConfig();
      for (const listener of this.listeners) {
        try {
          listener('config-changed', { config: cfg });
        } catch (err) {
          console.error('[BKAIManager] Ошибка в подписчике onChange:', err);
        }
      }
    }

    /**
     * Загружает и возвращает системный промпт из \bkstudio\ai\system.md.
     * Загрузка выполняется относительно приложения через fetch() (в браузере)
     * или файловую систему (в тестах).
     * Результат кэшируется в памяти, исключая повторные запросы.
     * При ошибке загрузки выбрасывает понятное исключение.
     *
     * @returns {Promise<string>} Содержимое system.md
     */
    async getSystemPrompt() {
      if (typeof this._systemPromptCache === 'string' && this._systemPromptCache.trim().length > 0) {
        return this._systemPromptCache;
      }
      if (this._systemPromptPromise) {
        return this._systemPromptPromise;
      }

      this._systemPromptPromise = (async () => {
        let text = null;
        let lastError = null;

        // 1. Попытка загрузки через fetch() (в среде браузера)
        if (typeof fetch === 'function') {
          const candidatePaths = [
            'ai/system.md',
            'bkstudio/ai/system.md',
            '/bkstudio/ai/system.md',
            '../bkstudio/ai/system.md'
          ];

          for (const p of candidatePaths) {
            try {
              const resp = await fetch(p);
              if (resp && resp.ok && typeof resp.text === 'function') {
                const body = await resp.text();
                if (typeof body === 'string' && body.trim().length > 0) {
                  text = body;
                  break;
                }
              } else if (resp && resp.status) {
                lastError = new Error(`HTTP ${resp.status} ${resp.statusText || ''}`);
              }
            } catch (err) {
              lastError = err;
            }
          }
        }

        // 2. Попытка загрузки через Node.js fs (в тестах)
        if (!text && typeof process !== 'undefined' && process.versions && process.versions.node) {
          try {
            const fs = typeof require === 'function' ? require('fs') : null;
            const pathMod = typeof require === 'function' ? require('path') : null;
            if (fs && pathMod) {
              const candidateFilePaths = [
                pathMod.resolve(__dirname, '..', 'ai', 'system.md'),
                pathMod.resolve(__dirname, 'ai', 'system.md'),
                pathMod.resolve(process.cwd(), 'ai', 'system.md'),
                pathMod.resolve(process.cwd(), 'bkstudio', 'ai', 'system.md')
              ];
              for (const fp of candidateFilePaths) {
                if (fs.existsSync(fp)) {
                  text = fs.readFileSync(fp, 'utf-8');
                  break;
                }
              }
            }
          } catch (e) {
            if (!lastError) lastError = e;
          }
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
          this._systemPromptPromise = null;
          const detail = lastError ? (lastError.message || String(lastError)) : 'файл не найден или пуст';
          throw new Error(`Не удалось загрузить системный промпт BKStudio AI (\\bkstudio\\ai\\system.md): ${detail}`);
        }

        this._systemPromptCache = text;
        return this._systemPromptCache;
      })();

      try {
        return await this._systemPromptPromise;
      } catch (err) {
        this._systemPromptPromise = null;
        throw err;
      }
    }

    /**
     * Устанавливает кэшированное содержимое системного промпта (для тестов или динамического обновления).
     * @param {string} content
     */
    setSystemPrompt(content) {
      this._systemPromptCache = content;
      this._systemPromptPromise = Promise.resolve(content);
    }

    /**
     * Сбрасывает кэш системного промпта для повторной загрузки.
     */
    clearSystemPromptCache() {
      this._systemPromptCache = null;
      this._systemPromptPromise = null;
    }

    /**
     * Возвращает список всех зарегистрированных Skills.
     * @returns {string[]}
     */
    getRegisteredSkills() {
      return Array.from(this.registeredSkills);
    }

    /**
     * Регистрирует имя доступного Skill в системе.
     * @param {string} skillName
     */
    registerSkill(skillName) {
      if (typeof skillName === 'string' && skillName.trim().length > 0) {
        this.registeredSkills.add(skillName.trim());
      }
    }

    /**
     * Возвращает список активных Skills для текущей сессии.
     * @returns {string[]}
     */
    getEnabledSkills() {
      return [...this.enabledSkills];
    }

    /**
     * Задаёт список активных Skills.
     * @param {string[]} skills
     */
    setEnabledSkills(skills) {
      if (!Array.isArray(skills)) {
        throw new Error('Параметр skills должен быть массивом строк.');
      }
      this.enabledSkills = skills.map(s => String(s).trim()).filter(Boolean);
    }

    /**
     * Включает указанный Skill.
     * @param {string} skillName
     */
    enableSkill(skillName) {
      if (typeof skillName === 'string' && skillName.trim()) {
        const name = skillName.trim();
        this.registerSkill(name);
        if (!this.enabledSkills.includes(name)) {
          this.enabledSkills.push(name);
        }
      }
    }

    /**
     * Отключает указанный Skill.
     * @param {string} skillName
     */
    disableSkill(skillName) {
      if (typeof skillName === 'string') {
        const name = skillName.trim();
        this.enabledSkills = this.enabledSkills.filter(s => s !== name);
      }
    }

    /**
     * Устанавливает содержимое Skill напрямую в кэш (для тестов или динамических инъекций).
     * @param {string} skillName
     * @param {string} content
     */
    setSkillContent(skillName, content) {
      if (!skillName || typeof skillName !== 'string') return;
      const name = skillName.trim();
      this.registerSkill(name);
      this._skillsCache.set(name, String(content || ''));
      this._skillsPromises.set(name, Promise.resolve(String(content || '')));
    }

    /**
     * Очищает кэш для указанного Skill или всех Skills.
     * @param {string} [skillName]
     */
    clearSkillsCache(skillName) {
      if (skillName) {
        const name = String(skillName).trim();
        this._skillsCache.delete(name);
        this._skillsPromises.delete(name);
      } else {
        this._skillsCache.clear();
        this._skillsPromises.clear();
      }
    }

    /**
     * Загружает конкретный Skill по имени из ai/skills/<name>/
     * Поддерживает:
     *   - Одиночные файлы SKILL.md (например, bk0010emt);
     *   - Модульные Skills со связанными документами SKILL.*.md (например, bk0010code).
     * Кэширует результат в оперативной памяти.
     * При ошибке выбрасывает понятное исключение с описанием проблемы.
     *
     * @param {string} skillName
     * @returns {Promise<string>} Содержимое Skill
     */
    async loadSkill(skillName) {
      if (!skillName || typeof skillName !== 'string') {
        throw new Error('Имя Skill должно быть непустой строкой.');
      }
      const name = skillName.trim();

      if (this._skillsCache.has(name)) {
        return this._skillsCache.get(name);
      }
      if (this._skillsPromises.has(name)) {
        return this._skillsPromises.get(name);
      }

      const loadPromise = (async () => {
        let indexText = null;
        let workingBasePath = null;
        let workingBaseDir = null;
        let lastError = null;

        // 1. Попытка загрузки через fetch (в среде браузера)
        if (typeof fetch === 'function') {
          const candidateBases = [
            `ai/skills/${name}/`,
            `bkstudio/ai/skills/${name}/`,
            `/bkstudio/ai/skills/${name}/`,
            `../bkstudio/ai/skills/${name}/`
          ];

          for (const base of candidateBases) {
            try {
              const resp = await fetch(`${base}SKILL.md`);
              if (resp && resp.ok && typeof resp.text === 'function') {
                const body = await resp.text();
                if (typeof body === 'string' && body.trim().length > 0) {
                  indexText = body;
                  workingBasePath = base;
                  break;
                }
              } else if (resp && resp.status) {
                lastError = new Error(`HTTP ${resp.status} ${resp.statusText || ''}`);
              }
            } catch (err) {
              lastError = err;
            }
          }
        }

        // 2. Попытка загрузки через Node.js fs (в тестах)
        if (!indexText && typeof process !== 'undefined' && process.versions && process.versions.node) {
          try {
            const fs = typeof require === 'function' ? require('fs') : null;
            const pathMod = typeof require === 'function' ? require('path') : null;
            if (fs && pathMod) {
              const candidateDirs = [
                pathMod.resolve(__dirname, '..', 'ai', 'skills', name),
                pathMod.resolve(__dirname, 'ai', 'skills', name),
                pathMod.resolve(process.cwd(), 'ai', 'skills', name),
                pathMod.resolve(process.cwd(), 'bkstudio', 'ai', 'skills', name)
              ];
              for (const dir of candidateDirs) {
                const skillFile = pathMod.join(dir, 'SKILL.md');
                if (fs.existsSync(skillFile)) {
                  indexText = fs.readFileSync(skillFile, 'utf-8');
                  workingBaseDir = dir;
                  break;
                }
              }
            }
          } catch (e) {
            if (!lastError) lastError = e;
          }
        }

        if (!indexText || typeof indexText !== 'string' || indexText.trim().length === 0) {
          this._skillsPromises.delete(name);
          const detail = lastError ? (lastError.message || String(lastError)) : 'файл SKILL.md не найден или пуст';
          throw new Error(`Не удалось загрузить Skill "${name}" (ai/skills/${name}/SKILL.md): ${detail}`);
        }

        // Поиск ссылок на связанные документы тем SKILL.*.md
        const topicMatches = Array.from(indexText.matchAll(/\[.*?\]\((SKILL\.[a-zA-Z0-9._-]+\.md)\)/g));
        const uniqueTopicFiles = Array.from(new Set(topicMatches.map(m => m[1])));

        const parts = [
          `# Skill: ${name}\n\n${indexText.trim()}`
        ];

        for (const topicFile of uniqueTopicFiles) {
          let topicText = null;
          let topicError = null;

          if (workingBasePath && typeof fetch === 'function') {
            try {
              const resp = await fetch(`${workingBasePath}${topicFile}`);
              if (resp && resp.ok) {
                const body = await resp.text();
                if (typeof body === 'string' && body.trim().length > 0) {
                  topicText = body;
                }
              } else if (resp && resp.status) {
                topicError = new Error(`HTTP ${resp.status}`);
              }
            } catch (err) {
              topicError = err;
            }
          }

          if (!topicText && workingBaseDir && typeof process !== 'undefined') {
            try {
              const fs = typeof require === 'function' ? require('fs') : null;
              const pathMod = typeof require === 'function' ? require('path') : null;
              if (fs && pathMod) {
                const fp = pathMod.join(workingBaseDir, topicFile);
                if (fs.existsSync(fp)) {
                  topicText = fs.readFileSync(fp, 'utf-8');
                }
              }
            } catch (e) {
              topicError = e;
            }
          }

          if (!topicText) {
            this._skillsPromises.delete(name);
            const detail = topicError ? (topicError.message || String(topicError)) : 'файл темы не найден';
            throw new Error(`Не удалось загрузить связанный документ "${topicFile}" для Skill "${name}": ${detail}`);
          }

          parts.push(`\n\n---\n\n## [${name}] ${topicFile}\n\n${topicText.trim()}`);
        }

        const fullSkillContent = parts.join('\n');
        this._skillsCache.set(name, fullSkillContent);
        return fullSkillContent;
      })();

      this._skillsPromises.set(name, loadPromise);

      try {
        return await loadPromise;
      } catch (err) {
        this._skillsPromises.delete(name);
        throw err;
      }
    }

    /**
     * Загружает и объединяет активные Skills в единый системный контекст.
     * @param {string[]} [skillNames] - Список Skills (по умолчанию this.getEnabledSkills())
     * @returns {Promise<string>}
     */
    async getSkillsPrompt(skillNames) {
      const list = Array.isArray(skillNames) ? skillNames : this.getEnabledSkills();
      if (!list || list.length === 0) {
        return '';
      }

      const loadedContents = [];
      for (const name of list) {
        const content = await this.loadSkill(name);
        if (content && typeof content === 'string' && content.trim().length > 0) {
          loadedContents.push(content.trim());
        }
      }

      if (loadedContents.length === 0) {
        return '';
      }

      return [
        '# Specialized Skills Knowledge Base',
        'Ниже приведена специализированная база проверенных знаний и правил программирования для БК-0010:',
        ...loadedContents
      ].join('\n\n');
    }

    /**
     * Отправляет запрос к AI-модели в рамках чата / генерации кода.
     * Возвращает нормализованный результат единого формата BKStudio:
     *   - { type: "text", text: "..." }
     *   - { type: "tool_call", name: "...", arguments: {...} }
     *   - { type: "error", error: {...} }
     *
     * Streaming-события onChunk также передаются в нормализованном формате:
     *   - { type: "text", delta: "...", text: "..." }
     *
     * @param {Object} options - Параметры запроса (messages, prompt, systemPrompt, skills, stream, onChunk и др.).
     * @returns {Promise<Object>} Нормализованный результат ответа AI.
     */
    async chat(options) {
      options = options || {};
      const providerName = this.config.provider;
      const provider = this.getProvider(providerName);
      if (!provider) {
        return Promise.reject(
          new Error(`Провайдер AI "${providerName}" не зарегистрирован или пока не реализован.`)
        );
      }

      // 1. Загрузка базового системного промпта из bkstudio/ai/system.md
      const baseSystemPrompt = await this.getSystemPrompt();

      // 2. Загрузка специализированного контекста Skills (bk0010code, bk0010emt)
      const skillsToLoad = Array.isArray(options.skills)
        ? options.skills
        : (options.skills === false ? [] : this.getEnabledSkills());
      const skillsPrompt = await this.getSkillsPrompt(skillsToLoad);

      // 3. Формирование объединенного системного контекста в строгом порядке:
      // system.md -> Skills context (bk0010code, bk0010emt) -> Project/IDE context (options.systemPrompt)
      let combinedSystemPrompt = baseSystemPrompt;
      if (skillsPrompt && !combinedSystemPrompt.includes(skillsPrompt)) {
        combinedSystemPrompt = `${combinedSystemPrompt}\n\n${skillsPrompt}`;
      }
      const extraSystem = typeof options.systemPrompt === 'string' ? options.systemPrompt.trim() : '';
      if (extraSystem && !combinedSystemPrompt.includes(extraSystem)) {
        combinedSystemPrompt = `${combinedSystemPrompt}\n\n${extraSystem}`;
      }

      // 3. Формирование результирующего массива messages с единственным role: "system" в начале
      const rawMessages = Array.isArray(options.messages) ? options.messages : [];
      const nonSystemMessages = [];

      for (const m of rawMessages) {
        if (!m) continue;
        if (m.role === 'system') {
          const sysContent = String(m.content || '').trim();
          if (sysContent && !combinedSystemPrompt.includes(sysContent)) {
            combinedSystemPrompt = `${combinedSystemPrompt}\n\n${sysContent}`;
          }
        } else {
          nonSystemMessages.push(m);
        }
      }

      if (nonSystemMessages.length === 0 && options.prompt && typeof options.prompt === 'string') {
        nonSystemMessages.push({ role: 'user', content: options.prompt });
      }

      const finalMessages = [
        {
          role: 'system',
          content: combinedSystemPrompt
        },
        ...nonSystemMessages
      ];

      const Normalizer = global.bkAINormalizer || (typeof BKAINormalizer !== 'undefined' ? BKAINormalizer : null);

      // Оборачиваем onChunk / onToken для приведения потоковых чанков к единому формату
      const userOnChunk = options.onChunk || options.onToken;
      const userOnReasoning = options.onReasoning;
      let callOptions = Object.assign({}, options, {
        messages: finalMessages,
        systemPrompt: combinedSystemPrompt
      });

      if (typeof userOnChunk === 'function') {
        callOptions = Object.assign({}, callOptions, {
          onChunk: (delta, accumulated) => {
            const normalizedChunk = Normalizer
              ? Normalizer.normalizeStreamChunk(delta, accumulated)
              : { type: 'text', delta: delta, text: accumulated };

            try {
              userOnChunk(normalizedChunk, accumulated);
            } catch (err) {
              console.error('[BKAIManager] Ошибка в пользовательском onChunk:', err);
            }
          }
        });
      }

      if (typeof userOnReasoning === 'function') {
        callOptions = Object.assign({}, callOptions, {
          onReasoning: (delta, accumulated) => {
            try {
              userOnReasoning(delta, accumulated);
            } catch (err) {
              console.error('[BKAIManager] Ошибка в пользовательском onReasoning:', err);
            }
          }
        });
      }

      const rawResult = await provider.chat(callOptions, this.getConfig());

      if (Normalizer) {
        return Normalizer.normalizeResponse(rawResult);
      }

      return rawResult;
    }

    /**
     * Проверяет подключение к настроенному провайдеру AI.
     *
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async testConnection() {
      const providerName = this.config.provider;
      const provider = this.getProvider(providerName);
      if (!provider) {
        return Promise.reject(
          new Error(`Проверка соединения для провайдера "${providerName}" не реализована или провайдер не найден.`)
        );
      }
      return provider.testConnection(this.getConfig());
    }

    /**
     * Возвращает список доступных моделей от настроенного провайдера.
     *
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async getModels() {
      const providerName = this.config.provider;
      const provider = this.getProvider(providerName);
      if (!provider || typeof provider.getModels !== 'function') {
        return Promise.resolve([]);
      }
      return provider.getModels(this.getConfig());
    }

    /**
     * Возвращает поставщик контекста BKAIContext.
     *
     * @returns {Object} Экземпляр BKAIContext
     */
    getContext() {
      return global.bkAIContext || (typeof BKAIContext !== 'undefined' ? new BKAIContext() : null);
    }
  }

  // Создание экземпляра и экспорт в глобальную область видимости
  const bkAI = new BKAIManager();
  BKAIManager.PROFILES = AI_PROFILES;
  global.BKAIManager = BKAIManager;
  global.bkAI = bkAI;
  global.bkAIProfiles = AI_PROFILES;

})(typeof window !== 'undefined' ? window : this);
