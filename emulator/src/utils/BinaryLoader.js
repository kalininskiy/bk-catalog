/**
 * Gbin - Модуль загрузки файлов в браузере
 * 
 * Возможности:
 * 1) Загрузка бинарных файлов по URL (?URL=...)
 * 2) Drag-and-drop файлов на элемент с id="dropfile"
 * 3) Автоматическое разархивирование ZIP файлов
 * 
 * Использование:
 *   Gbin.onGot = function(filename, bytes) {...};
 *   // bytes - это Uint8Array
 *   Gbin.getUrl(href); // загрузить файл сейчас
 */

/**
 * Преобразует имя ZIP файла в TXT для обхода ограничений хостинга Neocities
 * @param {string} filename - Имя файла
 * @returns {string} - Преобразованное имя файла
 */
function neocitiesConvertZipName(filename) {
	var zipIndex = filename.toUpperCase().indexOf(".ZIP");
	console.log(filename)
	if (zipIndex > 0 && !filename.includes("bk_games_files") && !filename.includes("bk_files")) {
		filename = filename.substr(0, zipIndex) + ".txt";
	}
	return filename;
}

/**
 * Декодирует данные из hex-формата Neocities обратно в бинарный формат
 * @param {ArrayBuffer} arrayBuffer - Буфер с данными (возможно в hex-формате)
 * @returns {Uint8Array|ArrayBuffer} - Декодированные данные или исходный буфер
 */
function neocitiesDecodeHex(arrayBuffer) {
	var uint8Array = new Uint8Array(arrayBuffer);
	
	// Проверяем, являются ли данные hex-строкой (ASCII коды 0-9, A-F, a-f)
	for (var i = 0; i < uint8Array.length; i++) {
		var charCode = uint8Array[i];
		// Если символ не hex-цифра (0-9: 48-57, A-F: 65-70, a-f: 97-102)
		if (charCode < 48 || charCode > 102) {
			return arrayBuffer; // Это обычные бинарные данные
		}
	}
	
	// Декодируем hex-строку в бинарные данные
	var decodedData = new Uint8Array(uint8Array.length >>> 1); // Длина в 2 раза меньше
	for (var srcIndex = 0, dstIndex = 0; srcIndex < uint8Array.length; ) {
		var highNibble = String.fromCharCode(uint8Array[srcIndex++]);
		var lowNibble = String.fromCharCode(uint8Array[srcIndex++]);
		decodedData[dstIndex++] = parseInt('0x' + highNibble + lowNibble);
	}
	
	return decodedData;
}

/**
 * Главный объект модуля Gbin
 */
Gbin = {
	/** @type {string} Имя последнего загруженного файла */
	name: "",
	
	/** @type {number} Счетчик попыток инициализации элемента dropfile */
	initRetryCount: 15,
	
	/** @type {boolean} Автоматически разархивировать ZIP файлы */
	unZip: true,
	
	/**
	 * Callback-функция, вызываемая при успешной загрузке файла
	 * Переопределите эту функцию для обработки загруженных файлов
	 * @param {string} filename - Имя файла
	 * @param {Uint8Array} bytes - Содержимое файла в виде массива байтов
	 */
	onGot: function(filename, bytes) {},
	
	/**
	 * Загружает файл по URL с помощью XMLHttpRequest
	 * @param {string} url - URL файла для загрузки
	 */
	getUrl: function(url) {
		var xhr = new XMLHttpRequest();
		
		xhr.onreadystatechange = function() {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					Gbin.processLoadedData(decodeURI(url), xhr.response);
				} else {
					Gbin.showError();
				}
			}
		};
		
		// xhr.open("GET", neocitiesConvertZipName(url), true);
		xhr.open("GET", url, true);
		xhr.responseType = "arraybuffer";
		xhr.send();
	},
	
	/**
	 * Инициализация при загрузке страницы
	 * Проверяет наличие параметра URL= в адресной строке
	 */
	autoInit: function() {
		Gbin.scheduleDropfileInit();
		
		var locationHref = document.location.href;
		var urlParamIndex = locationHref.indexOf("URL=");
		
		if (urlParamIndex > 0) {
			var fileUrl = locationHref.substr(urlParamIndex + 4);
			var ampersandIndex = fileUrl.indexOf('&');
			
			if (ampersandIndex >= 0) {
				fileUrl = fileUrl.substr(0, ampersandIndex);
			}
			
			if (fileUrl.length > 0) {
				Gbin.getUrl(fileUrl);
			}
		}
	},
	
	/**
	 * Проверяет, является ли файл ZIP-архивом по расширению
	 * @param {string} filename - Имя файла
	 * @returns {boolean} true, если это ZIP файл
	 */
	isZipFile: function(filename) {
		var length = filename.length;
		return (Gbin.unZip && length > 4 && 
		        filename.substr(length - 4).toUpperCase() === ".ZIP");
	},
	
	/**
	 * Разархивирует данные, если это ZIP файл
	 * @param {string} filename - Имя файла
	 * @param {ArrayBuffer} arrayBuffer - Данные файла
	 * @returns {ArrayBuffer|Uint8Array} - Разархивированные или исходные данные
	 */
	unzipIfNeeded: function(filename, arrayBuffer) {
		return Gbin.isZipFile(filename) ? Gbin.unzipData(arrayBuffer) : arrayBuffer;
	},
	
	/**
	 * Обрабатывает загруженные данные
	 * @param {string} filename - Имя файла
	 * @param {ArrayBuffer} response - Ответ от сервера
	 */
	processLoadedData: function(filename, response) {
		// Декодируем из формата Neocities если необходимо
		response = neocitiesDecodeHex(response);
		
		Gbin.name = filename;
		var processedData = new Uint8Array(Gbin.unzipIfNeeded(filename, response));
		Gbin.onGot(Gbin.name, processedData);
	},
	
	/**
	 * Получает элемент по ID
	 * @param {string} elementId - ID элемента
	 * @returns {HTMLElement|null} - Найденный элемент или null
	 */
	getElement: function(elementId) {
		return document.getElementById(elementId);
	},
	
	/**
	 * Планирует повторную попытку инициализации dropfile элемента
	 */
	scheduleDropfileInit: function() {
		setTimeout('Gbin.initDropfile()', 999);
	},
	
	/**
	 * Инициализирует drag-and-drop функциональность
	 * Вызывается с задержкой, пока элемент не будет найден
	 */
	initDropfile: function() {
		var dropfileElement = Gbin.getElement("dropfile");
		
		if (dropfileElement == null) {
			// Элемент еще не создан, пробуем снова
			if (--(Gbin.initRetryCount)) {
				Gbin.scheduleDropfileInit();
			}
		} else {
			// Элемент найден, добавляем обработчики событий
			dropfileElement.addEventListener('dragover', Gbin.handleDragOver, false);
			dropfileElement.addEventListener('drop', Gbin.handleDrop, false);
		}
	},
	
	/**
	 * Показывает сообщение об ошибке
	 */
	showError: function() {
		alert("Error: cannot read file");
	},
	
	/**
	 * Предотвращает действия браузера по умолчанию для события
	 * @param {Event} event - Событие браузера
	 */
	preventDefaultAction: function(event) {
		if (event.stopPropagation) {
			event.stopPropagation();
		}
		if (event.preventDefault) {
			event.preventDefault();
		}
	},
	
	/**
	 * Обработчик события dragover (наведение файла)
	 * @param {DragEvent} event - Событие перетаскивания
	 */
	handleDragOver: function(event) {
		Gbin.preventDefaultAction(event);
		event.dataTransfer.dropEffect = 'copy';
	},
	
	/**
	 * Обработчик события drop (сброс файла)
	 * @param {DragEvent} event - Событие сброса
	 */
	handleDrop: function(event) {
		Gbin.preventDefaultAction(event);
		var files = event.dataTransfer.files;
		
		if (files && files.length) {
			Gbin.readDroppedFile(files[0]);
		}
	},
	
	/**
	 * Читает файл, перенесенный пользователем
	 * @param {File} file - Файл для чтения
	 */
	readDroppedFile: function(file) {
		var reader = new FileReader();
		
		reader.onload = function(event) {
			Gbin.processLoadedData(file.name, event.target.result);
		};
		
		reader.onerror = Gbin.showError;
		reader.readAsArrayBuffer(file);
	},
	
	/**
	 * Разархивирует ZIP файл и возвращает содержимое первого файла
	 * @param {ArrayBuffer} buffer - Данные ZIP файла
	 * @returns {Uint8Array|ArrayBuffer} - Содержимое первого файла или исходный буфер
	 */
	unzipData: function(buffer) {
		var success = false;
		var zip, files, fileInfo;
		
		try {
			zip = new JSZip(buffer);
			success = true;
		} catch (error) {
			// Не удалось разархивировать
		}
		
		if (success && zip) {
			files = zip.file(/.+/); // Все файлы в архиве
			
			for (var fileName in files) {
				fileInfo = files[fileName];
				Gbin.name = fileInfo.name;
				
				// Возвращаем содержимое первого файла
				return (fileInfo.content ? fileInfo.content : fileInfo.asUint8Array());
			}
		}
		
		return buffer;
	}
};
