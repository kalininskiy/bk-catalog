/**
 * sharp-bilinear.frag - Шейдер субпиксельного масштабирования для БК
 * 
 * Принцип:
 * - Внутри каждого пикселя БК значение цвета строго постоянное (целочисленный прескейл).
 * - На границе между соседними пикселями выполняется линейный переход шириной ровно
 *   в 1 пиксель целевого экрана (target display pixel).
 * - Полностью устраняет ступенчатый алиасинг и дрожание (shimmering/wobble) строк и колонок,
 *   сохраняя предельную резкость шрифтов БК, одиночных пикселей и тонких линий.
 * - Учитывает независимые коэффициенты масштабирования scaleX и scaleY.
 */

precision highp float;

varying vec2 vTexCoord;

uniform sampler2D uTexture;
uniform vec2 uSourceRes;  // Разрешение исходного буфера: [512.0, 256.0]
uniform vec2 uTargetRes;  // Разрешение области вывода: [targetWidth, targetHeight]

void main() {
    // Независимый масштаб по осям X и Y
    vec2 scale = uTargetRes / uSourceRes;
    
    // Координаты в системе отсчета исходного изображения (0 .. 512, 0 .. 256)
    // Сдвиг на 0.5 соответствует центрам текселей
    vec2 pos = vTexCoord * uSourceRes - 0.5;
    vec2 posFloor = floor(pos);
    vec2 posFract = fract(pos);
    
    // Переход шириной ровно в 1 физический целевой пиксель экрана
    vec2 sharpFract = clamp((posFract - 0.5) * scale + 0.5, 0.0, 1.0);
    
    // Итоговая координата для аппаратной билинейной выборки
    vec2 sampleCoord = (posFloor + sharpFract + 0.5) / uSourceRes;
    
    gl_FragColor = texture2D(uTexture, sampleCoord);
}
