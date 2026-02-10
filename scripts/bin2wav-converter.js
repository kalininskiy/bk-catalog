/*
 * Вспомогательный модуль для конвертации BK .BIN/.OVL в WAV (браузерная версия).
 *
 * (c) Ivan "VDM" Kalininskiy
 */

const LEVEL_1 = 255;
const LEVEL_1_TUNE = 248;
const LEVEL_0 = 128;

const BIT_0 = [
    LEVEL_1, LEVEL_1,
    LEVEL_0, LEVEL_0
];

const BIT_1 = [
    LEVEL_1, LEVEL_1, LEVEL_1, LEVEL_1,
    LEVEL_0, LEVEL_0, LEVEL_0, LEVEL_0
];

const TUNE = [
    LEVEL_1_TUNE, LEVEL_1_TUNE,
    LEVEL_0, LEVEL_0
];

const AFTER_TUNE = [
    LEVEL_1, LEVEL_1, LEVEL_1, LEVEL_1, LEVEL_1, LEVEL_1, LEVEL_1, LEVEL_1,
    LEVEL_0, LEVEL_0, LEVEL_0, LEVEL_0, LEVEL_0, LEVEL_0, LEVEL_0, LEVEL_0
];

const SYNCHRO_SHORT = [
    LEVEL_1_TUNE, LEVEL_1_TUNE,
    LEVEL_0
];

const SYNCHRO_LONG = [
    LEVEL_1_TUNE, LEVEL_1_TUNE,
    LEVEL_0, LEVEL_0
];

export const SAMPLE_RATE_10 = 21428; // Для БК-0010[-01]
export const SAMPLE_RATE_11 = 25000; // Для БК-0011[М] - быстрее на 17%

const TUNE_COUNT = 4096;
const TUNE_COUNT_SECOND = 10;
const TUNE_COUNT_END = 200;

/**
 * Упрощения кода вставки
 * @param {number[]} arr
 * @returns {(bytes:number[])=>void}
 */
const getPushFunction = (arr) => {
    const push = Array.prototype.push;
    return function (bytes) {
        push.apply(arr, bytes);
    };
};

/**
 * Преобразует бинарные данные в тело WAV‑файла (массив байт без заголовка WAV).
 * @param {Uint8Array} binary
 * @param {boolean} speedBoost - Дополнительное ускорение на 11% (короткий синхроимпульс)
 * @returns {number[]} массив байт (0–255)
 */
const binaryToSoundBytes = (binary, speedBoost) => {
    const soundBytes = [];
    const push = getPushFunction(soundBytes);

    for (let i = 0; i < TUNE_COUNT; i++) {
        push(TUNE);
    }
    push(AFTER_TUNE);
    push(BIT_1);
    for (let i = 0; i < TUNE_COUNT_SECOND; i++) {
        push(TUNE);
    }
    push(AFTER_TUNE);
    push(BIT_1);

    let synchro = speedBoost ? SYNCHRO_SHORT : SYNCHRO_LONG;

    for (let i = 0; i < binary.length; i++) {
        if (i === 20) {
            // после заголовков
            for (let j = 0; j < TUNE_COUNT_SECOND; j++) {
                push(TUNE);
            }
            push(AFTER_TUNE);
            push(BIT_1);
        } else if (i === binary.length - 2) {
            // для контрольной суммы - длинный синхроимпульс
            synchro = SYNCHRO_LONG;
        }
        const byte = binary[i];
        for (let bit = 1; bit < 255; bit <<= 1) {
            push(synchro);
            push(byte & bit ? BIT_1 : BIT_0);
        }
    }

    for (let i = 0; i < TUNE_COUNT_END; i++) {
        push(TUNE);
    }

    return soundBytes;
};

/**
 * Добавление заголовков WAV‑файла к телу
 * @param {number[]} soundBytes
 * @param {number} sampleRate
 * @returns {number[]} полный WAV (RIFF‑заголовок + данные)
 */
const toWavFile = (soundBytes, sampleRate) => {
    const channelCount = 1;
    const bitsPerSample = 8;
    const subChunk1Size = 16;
    const subChunk2Size = soundBytes.length;
    const chunkSize = 4 + (8 + subChunk1Size) + (8 + subChunk2Size);
    const blockAlign = channelCount * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;

    return [
        82, 73, 70, 70,               // "RIFF"
        chunkSize & 0xff,
        (chunkSize >> 8) & 0xff,
        (chunkSize >> 16) & 0xff,
        (chunkSize >> 24) & 0xff,
        87, 65, 86, 69,               // "WAVE"
        102, 109, 116, 32,            // "fmt "
        subChunk1Size, 0, 0, 0,
        1, 0,                         // PCM
        channelCount & 0xff,
        (channelCount >> 8) & 0xff,
        sampleRate & 0xff,
        (sampleRate >> 8) & 0xff,
        (sampleRate >> 16) & 0xff,
        (sampleRate >> 24) & 0xff,
        byteRate & 0xff,
        (byteRate >> 8) & 0xff,
        (byteRate >> 16) & 0xff,
        (byteRate >> 24) & 0xff,
        blockAlign & 0xff,
        (blockAlign >> 8) & 0xff,
        bitsPerSample & 0xff,
        (bitsPerSample >> 8) & 0xff,
        100, 97, 116, 97,             // "data"
        subChunk2Size & 0xff,
        (subChunk2Size >> 8) & 0xff,
        (subChunk2Size >> 16) & 0xff,
        (subChunk2Size >> 24) & 0xff
    ].concat(soundBytes);
};

/**
 * Преобразует имя файла в 16‑байтовое KOI8‑массив (как в оригинальном конвертере).
 * @param {string} name
 * @returns {Uint8Array}
 */
const convertFileNameToBytes = (name) => {
    // Побеждаем глюк файловой системы macOS с буквами Й и Ё
    name = name
        .replace(/И\u0306/g, 'Й')
        .replace(/и\u0306/g, 'й')
        .replace(/Е\u0308/g, 'Ё')
        .replace(/е\u0308/g, 'ё');
    name = name.substr(0, 16);
    if (name.length < 16) {
        for (let i = name.length; i < 16; i++) {
            name += ' ';
        }
    }
    return new Uint8Array(getKOI8Bytes(name));
};

const getKOI8Bytes = (text) => {
    const charsList = 'юабцдефгхийклмнопярстужвьызшэщчъЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ';
    const bytes = [];
    let code, char, index;
    for (let i = 0; i < text.length; i++) {
        code = text.charCodeAt(i);
        if (code < 32) {
            code = 32;
        } else if (code > 127) {
            char = text[i];
            index = charsList.indexOf(char);
            if (index > -1) {
                code = 192 + index;
            } else if (char === 'Ё') {
                code = 229; // Е
            } else if (char === 'ё') {
                code = 197; // е
            } else {
                code = 32;
            }
        }
        bytes.push(code);
    }
    return bytes;
};

/**
 * Внедрение имени файла и контрольной суммы в бинарные данные.
 * @param {Uint8Array} binary
 * @param {string} fileName без расширения
 * @returns {Uint8Array}
 */
const insertFileNameAndChekSum = (binary, fileName) => {
    const newBinary = new Uint8Array(binary.length + 16 + 2);
    newBinary.set(binary.subarray(0, 4));
    newBinary.set(convertFileNameToBytes(fileName), 4);
    const body = binary.subarray(4);
    newBinary.set(body, 20);
    let checkSum = 0;
    for (let i = 0; i < body.length; i++) {
        checkSum += body[i];
        if (checkSum > 65535) { // переполнение
            checkSum -= 65536;
            checkSum++;
        }
    }
    newBinary.set(
        new Uint8Array([
            checkSum & 0xff,
            (checkSum >> 8) & 0xff
        ]),
        20 + body.length
    );
    return newBinary;
};

/**
 * Основная функция: принимает бинарные данные BK‑файла и возвращает Uint8Array WAV.
 *
 * Шаги:
 * 1) Внедряет имя файла и контрольную сумму
 * 2) Переводит бинарь в "звуковые" байты
 * 3) Добавляет WAV‑заголовок
 *
 * @param {Uint8Array} binary исходный .BIN/.OVL
 * @param {string} baseName имя файла без пути и расширения
 * @param {{model?: '10'|'11', speedBoost?: boolean}} [options]
 * @returns {Uint8Array} WAV‑файл
 */
export function convertBinaryToWav(binary, baseName, options = {}) {
    const { model = '10', speedBoost = false } = options;
    const withHeader = insertFileNameAndChekSum(binary, baseName || 'NONAME');
    const soundBytes = binaryToSoundBytes(withHeader, speedBoost);
    const sampleRate = model === '10' ? SAMPLE_RATE_10 : SAMPLE_RATE_11;
    const wavArray = toWavFile(soundBytes, sampleRate);
    return new Uint8Array(wavArray);
}
