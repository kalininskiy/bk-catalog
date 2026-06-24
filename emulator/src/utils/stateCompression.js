/**
 * Сжатие и распаковка файлов состояния эмулятора (GZIP)
 *
 * Использует Web API CompressionStream / DecompressionStream.
 * При загрузке поддерживаются как .json.gz, так и несжатые .json (version 1/2).
 *
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy
 */
var StateCompression = (function() {

    var GZIP_MAGIC_0 = 0x1f;
    var GZIP_MAGIC_1 = 0x8b;

    /**
     * Проверить поддержку GZIP в браузере
     * @returns {boolean}
     */
    function isGzipSupported() {
        return typeof CompressionStream !== 'undefined' &&
               typeof DecompressionStream !== 'undefined';
    }

    /**
     * Определить GZIP по сигнатуре (1F 8B)
     * @param {Uint8Array} bytes
     * @returns {boolean}
     */
    function isGzipData(bytes) {
        return bytes && bytes.length >= 2 &&
               bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
    }

    /**
     * Сжать строку в GZIP
     * @param {string} text
     * @returns {Promise<Uint8Array>}
     */
    function gzipCompress(text) {
        var stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        return new Response(stream).arrayBuffer().then(function(buffer) {
            return new Uint8Array(buffer);
        });
    }

    /**
     * Распаковать GZIP в строку UTF-8
     * @param {Uint8Array} bytes
     * @returns {Promise<string>}
     */
    function gzipDecompress(bytes) {
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).text();
    }

    /**
     * Подготовить JSON состояния к сохранению в файл
     * @param {string} jsonString - Компактный JSON (без отступов)
     * @returns {Promise<{data: Uint8Array|string, compressed: boolean}>}
     */
    function compressStateJson(jsonString) {
        if (!isGzipSupported()) {
            return Promise.resolve({ data: jsonString, compressed: false });
        }
        return gzipCompress(jsonString).then(function(compressed) {
            return { data: compressed, compressed: true };
        });
    }

    /**
     * Прочитать содержимое файла состояния (GZIP или plain JSON)
     * @param {ArrayBuffer} arrayBuffer - Сырые байты файла
     * @returns {Promise<string>} JSON-строка
     */
    function decompressStateFile(arrayBuffer) {
        var bytes = new Uint8Array(arrayBuffer);

        if (isGzipData(bytes)) {
            if (!isGzipSupported()) {
                return Promise.reject(new Error('Файл сжат GZIP, но браузер не поддерживает распаковку'));
            }
            return gzipDecompress(bytes);
        }

        return Promise.resolve(new TextDecoder('utf-8').decode(bytes));
    }

    return {
        isGzipSupported: isGzipSupported,
        isGzipData: isGzipData,
        compressStateJson: compressStateJson,
        decompressStateFile: decompressStateFile
    };
})();
