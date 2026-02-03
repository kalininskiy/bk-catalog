/**
 * Инструмент для читерства в играх БК-0010
 * Содержит известные адреса памяти для различных игр
 */

/**
 * Поиск счетчика жизней в играх
 * Инструкция по использованию:
 * 1. Начните игру (посмотрите количество жизней), нажмите Ctrl+L
 * 2. Умрите (жизней стало на 1 меньше), снова нажмите Ctrl+L
 * 3. Умрите еще раз (жизней стало на 2 меньше), нажмите Ctrl+L в третий раз
 * Инструмент найдет адрес счетчика жизней и восстановит начальное значение
 */

cheatings = new function() {
    
    var self = this;
    
    // Константы для автоматического поиска адреса жизней
    var REQUIRED_DUMPS = 3; // Количество необходимых снимков памяти
    var CHEATING_INTERVAL = 8000; // Интервал проверки читов (в миллисекундах)
    
    // Данные для поиска счетчика жизней
    var livesDumpData = {
        count: 0,           // Счетчик сделанных снимков памяти
        snapshots: []       // Массив снимков памяти
    };
    
    // Найденные адреса счетчиков жизней
    var livesCheatList = [];
    
    /**
     * Показывает справку по инструменту поиска жизней
     */
    this.cheathelp = function() {
        alert(
            "Инструмент поиска жизней:\n" +
            "1. Начните игру (все жизни на месте), нажмите Ctrl+L\n" +
            "2. Умрите (жизней -1), снова нажмите Ctrl+L\n" +
            "3. Умрите еще раз (жизней -2) и нажмите Ctrl+L в третий раз\n" +
            "Инструмент найдет счетчик жизней и восстановит начальное значение."
        );
    };
    
    /**
     * Автоматический поиск счетчика жизней в памяти
     * Анализирует 3 снимка памяти для нахождения адреса, где хранятся жизни
     */
    this.livesfinder = function() {
        var dumpData = livesDumpData;
        
        // Добавляем текущий снимок памяти
        dumpData.snapshots[dumpData.count++] = read16dump();
        
        // Когда собраны все 3 снимка, анализируем их
        if (dumpData.count == REQUIRED_DUMPS) {
            var foundCount = 0;
            var resultMessage = "\n";
            livesCheatList = [];
            
            // Ищем адреса, где значение уменьшается на 1 в каждом снимке
            for (var i = 0; i < dumpData.snapshots[0].length; i++) {
                var value0 = dumpData.snapshots[0][i]; // Начальное количество жизней
                var value1 = dumpData.snapshots[1][i]; // После первой смерти
                var value2 = dumpData.snapshots[2][i]; // После второй смерти
                
                // Проверяем, что значения уменьшаются последовательно на 1
                if (value0 == value1 + 1 && value1 == value2 + 1) {
                    var memoryAddress = i << 1; // Умножаем на 2 (сдвиг влево)
                    
                    livesCheatList[foundCount++] = {
                        adr: memoryAddress,
                        val: value0
                    };
                    
                    resultMessage += 'addr=' + memoryAddress + ' values=' + value0 + ',' + value1 + ',' + value2 + '(now)\n';
                    console.log(resultMessage);
                }
            }
            
            if (foundCount) {
                alert("Найдено " + foundCount + " адресов, читерство активировано!" + resultMessage);
            }
            
            dumpData.count = 0; // Сбрасываем счетчик для следующего поиска
        }
    };
    
    /**
     * Применяет чит - восстанавливает найденные счетчики жизней
     */
    function applyLivesCheat() {
        for (var i in livesCheatList) {
            base.writeWord(livesCheatList[i].adr, livesCheatList[i].val);
        }
    }
    
    /**
     * Основная функция читерства
     * Применяет известные читы для различных игр
     */
    this.hack = function() {
        
        // Проверка инициализации эмулятора
        if (typeof base === 'undefined' || base === null || !base.FakeTape) {
            return;
        }
        
        var tape = base.FakeTape;
        var filename = tape.filename;
        var drives = fdc.drives;
        var diskA = (drives.length > 0 ? drives[0].imageName : "");
        var diskB = (drives.length > 1 ? drives[1].imageName : "");
        
        // Применяем читы только при первой загрузке (не при восстановлении)
        if (!tape.prep) {
            // Читы для игр с кассет (BIN файлы)
            if (filename == "VALLEY.BIN")   base.writeWord(3140, 9 << 8);   // Жизни = 9
            if (filename == "DIGGER.BIN")   base.writeWord(2226, 8);        // Жизни = 8
            if (filename == "NAVVY.BIN")    base.writeWord(15872, 65535);   // Жизни = 3
            if (filename == "AFRICA.BIN")   base.writeWord(5792, 99);       // Жизни = 99
            if (filename == "PANGO.BIN")    base.writeWord(8770, 51);       // Жизни = 3
            if (filename == "CIRCLER.BIN")  base.writeWord(8066, 8);        // Жизни = 8
            if (filename == "BOLDER.BIN")   base.writeWord(2120, 100);      // Жизни = 3
            if (filename == "LODERUN.BIN")  base.writeWord(1006, 10);       // Жизни = 3
            if (filename == "KLADJ.BIN")    base.writeWord(7966, 7);        // Жизни = 7
            if (filename == "TARZAN.BIN")   base.writeWord(1006, 5);        // Жизни = 5
            if (filename == "JETMAN.BIN")   base.writeWord(4240, 9);        // Жизни = 9
            if (filename == "F15.BIN")      base.writeWord(844, 8);         // Жизни = 8
            
            // Читы для игр с дискет (BKD файлы)
            if (diskB == "revolt.bkd") {
                if (base.readWORD(596) == 2) {
                    base.writeWord(596, 3); // Жизни = 3
                }
            }
            
            if (diskA == "PRNCE.BKD") {
                if (base.readWORD(11572) < 10) {
                    base.writeWord(11572, 6);       // Здоровье = 6
                    base.writeWord(14020, 512);     // Время = 59 минут
                }
            }
        }
        
        // Применяем автоматически найденные читы
        applyLivesCheat();
    };
    
    return this;
};

// Запускаем проверку читов каждые 8 секунд
setInterval(function() { 
    cheatings.hack(); 
}, 8000);
