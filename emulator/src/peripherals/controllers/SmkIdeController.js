/**
 * SmkIdeController - Эмулятор IDE контроллера жесткого диска СМК-512
 * 
 * Точная реализация на основе референсного эмулятора bkemu-android (Java):
 * @link https://github.com/3cky/bkemu-android
 * 
 * Регистры (в адресах БК):
 * - 177740 (65504): REG_COMP_0 (чтение: Status | (DAR << 8); запись: Command)
 * - 177742 (65506): REG_COMP_1 (чтение: Drive/Head | (AltStatus << 8); запись 177742: Drive/Head; запись 177743: Device Control)
 * - 177744 (65508): REG_CYLINDER_HIGH (ст. байт номера цилиндра)
 * - 177746 (65510): REG_CYLINDER_LOW (мл. байт номера цилиндра)
 * - 177750 (65512): REG_SECTOR_NUMBER (номер сектора)
 * - 177752 (65514): REG_SECTOR_COUNT (счётчик секторов)
 * - 177754 (65516): REG_ERROR (чтение: Error; запись: Features)
 * - 177756 (65518): REG_DATA (чтение/запись 16-битных слов данных)
 * 
 * Особенность контроллера СМК-512:
 * Все данные на шине аппаратно инвертированы (побитовая инверсия ~value & 0xFFFF).
 * 
 * (c) 2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
class SmkIdeController {
    constructor() {
        // Константы адресов регистров (восьмеричные)
        this.REG_COMP_0        = 0o177740; // 65504: Status / Command
        this.REG_COMP_1        = 0o177742; // 65506: Drive/Head / Alt Status
        this.REG_CYLINDER_HIGH = 0o177744; // 65508: Cylinder High
        this.REG_CYLINDER_LOW  = 0o177746; // 65510: Cylinder Low
        this.REG_SECTOR_NUMBER = 0o177750; // 65512: Sector Number
        this.REG_SECTOR_COUNT  = 0o177752; // 65514: Sector Count
        this.REG_ERROR         = 0o177754; // 65516: Error / Features
        this.REG_DATA          = 0o177756; // 65518: Data

        // Размер сектора в байтах
        this.SECTOR_SIZE = 512;

        // Константы битов состояния (Status Register)
        this.SR_ERR  = 0x01; // Ошибка
        this.SR_DRQ  = 0x08; // Готовность к передаче данных (DRQ)
        this.SR_DSC  = 0x10; // Поиск завершён
        this.SR_DRDY = 0x40; // Готовность накопителя (DRDY)
        this.SR_BSY  = 0x80; // Занят (BSY)

        // Константы ошибок (Error Register)
        this.ER_NONE = 0x00;
        this.ER_ABRT = 0x04; // Команда прервана

        // Биты регистра накопителя и головки (Drive/Head)
        this.DHR_DRV = 0x10; // Выбор привода: 0=Master, 1=Slave
        this.DHR_L   = 0x40; // Режим LBA
        this.DHR_HS0 = 0x01;
        this.DHR_HS1 = 0x02;
        this.DHR_HS2 = 0x04;
        this.DHR_HS3 = 0x08;

        // Биты регистра адреса привода (Drive Address Register, DAR)
        this.DAR_DS0 = 0x01;
        this.DAR_DS1 = 0x02;
        this.DAR_WTG = 0x30;

        // Биты регистра управления (Device Control)
        this.CR_SRST = 0x04; // Программный сброс

        // Команды ATA
        this.CMD_RECALIBRATE       = 0x10;
        this.CMD_READ              = 0x20;
        this.CMD_READ_ONCE         = 0x21;
        this.CMD_WRITE             = 0x30;
        this.CMD_WRITE_ONCE        = 0x31;
        this.CMD_VERIFY            = 0x40;
        this.CMD_VERIFY_ONCE       = 0x41;
        this.CMD_EXEC_DIAGNOSTIC   = 0x90;
        this.CMD_INIT_DRIVE_PARAMS = 0x91;
        this.CMD_READ_MULTIPLE     = 0xC4;
        this.CMD_WRITE_MULTIPLE    = 0xC5;
        this.CMD_SET_MULTIPLE      = 0xC6;
        this.CMD_STANDBY_IMMEDIATE = 0xE0;
        this.CMD_IDLE_IMMEDIATE    = 0xE1;
        this.CMD_CHECK_POWER_MODE  = 0xE5;
        this.CMD_FLUSH_CACHE       = 0xE7;
        this.CMD_IDENTIFY          = 0xEC;

        // Режимы завершения передачи данных
        this.ETF_NONE  = 0;
        this.ETF_READ  = 1;
        this.ETF_WRITE = 2;

        // Геометрия диска по умолчанию
        this.DEFAULT_HEADS = 16;
        this.DEFAULT_SECTORS = 63;
        this.DEFAULT_CYLINDERS = 65;
        this.DEFAULT_TOTAL_SECTORS = 65536;

        this.numHeads = this.DEFAULT_HEADS;
        this.numSectors = this.DEFAULT_SECTORS;
        this.numCylinders = this.DEFAULT_CYLINDERS;
        this.totalSectors = this.DEFAULT_TOTAL_SECTORS;

        // Образ диска (null если диск не подключен, как в bkemu-android)
        this.diskImage = null;
        this.imageName = '';
        this.imageHeaderSize = 0;

        // Регистры задачи ATA
        this.features = 0;
        this.sectorCount = 1;
        this.sectorNumber = 1;
        this.cylinderLow = 0;
        this.cylinderHigh = 0;
        this.driveAndHead = 0xA0;
        this.status = this.SR_DRDY | this.SR_DSC;
        this.error = this.ER_NONE;
        this.lastControlData = 0;

        // Буфер передачи данных
        this.dataBuffer = new Uint8Array(this.SECTOR_SIZE * 16);
        this.dataBufferOffset = 0;
        this.dataBufferEnd = 0;
        this.endTransferFunction = this.ETF_NONE;
        this.requiredSectors = 1;
        this.multipleSectorCount = 0;

        this.reset();
    }

    /**
     * Проверка, подключен ли диск
     * @returns {boolean}
     */
    isDriveAttached() {
        return this.diskImage !== null && this.diskImage.length > 0;
    }

    /**
     * Сброс контроллера в исходное состояние
     */
    reset() {
        this.sectorCount = 1;
        this.sectorNumber = 1;
        this.cylinderLow = 0;
        this.cylinderHigh = 0;
        this.driveAndHead = 0xA0;
        this.status = this.SR_DRDY | this.SR_DSC;
        this.error = 1; // Код самодиагностики: нет ошибок
        this.multipleSectorCount = 0;
        this.endTransfer();
    }

    init(isHardwareReset = false) {
        if (isHardwareReset) {
            this.reset();
        }
    }

    /**
     * Проверка, относится ли адрес к регистрам IDE контроллера
     * @param {number} addr 
     * @returns {boolean}
     */
    isIdeAddress(addr) {
        const a = addr & 0o177776;
        return (a >= this.REG_COMP_0 && a <= this.REG_DATA);
    }

    /**
     * Подключение внешнего образа жесткого диска (.hds, .hdi, .img)
     * @param {string} name - Имя файла
     * @param {Uint8Array|Array} bytes - Содержимое файла
     */
    attachImage(name, bytes) {
        this.imageName = name;
        let data = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);

        // Проверка формата HDI (512-байтный заголовок Anex86 / PC-98 / BK)
        if (name && name.toLowerCase().endsWith('.hdi') && data.length > this.SECTOR_SIZE) {
            this.imageHeaderSize = this.SECTOR_SIZE;
            this.numCylinders = data[2] | (data[3] << 8);
            this.numHeads = data[6] | (data[7] << 8);
            this.numSectors = data[12] | (data[13] << 8);
            this.totalSectors = Math.floor((data.length - this.imageHeaderSize) / this.SECTOR_SIZE);
            this.diskImage = data;
            this.reset();
            return;
        }

        this.imageHeaderSize = 0;
        this.diskImage = data;
        this.totalSectors = Math.floor(data.length / this.SECTOR_SIZE);

        // Проверяем таблицу разделов АльтПро в секторе 7
        if (!this.setupAltProGeometry()) {
            this.numHeads = this.DEFAULT_HEADS;
            this.numSectors = this.DEFAULT_SECTORS;
            this.numCylinders = Math.min(Math.floor(this.totalSectors / (this.numHeads * this.numSectors)), 16383);
            if (this.numCylinders < 1) this.numCylinders = 1;
        }

        this.reset();
    }

    /**
     * Отключение жесткого диска
     */
    detachDrive() {
        this.diskImage = null;
        this.imageName = '';
        this.reset();
    }

    /**
     * Чтение параметров геометрии из таблицы разделов АльтПро (сектор 7)
     * В точности по su.comp.bk.arch.io.disk.IdeController#setupAltProGeometry
     * @returns {boolean} true если таблица разделов найдена и валидна
     */
    setupAltProGeometry() {
        if (!this.diskImage) return false;
        const ptSectorPos = this.imageHeaderSize + 7 * this.SECTOR_SIZE;
        if (ptSectorPos + this.SECTOR_SIZE > this.diskImage.length) {
            return false;
        }

        // Вспомогательная функция чтения 16-битного слова из сектора с инверсией
        const readWordInv = (offset) => {
            const p = ptSectorPos + offset;
            const w = this.diskImage[p] | (this.diskImage[p + 1] << 8);
            return (~w) & 0xFFFF;
        };

        const numLogicalDisks = readWordInv(0o770) & 0xFF;
        if (numLogicalDisks > 125) {
            return false;
        }

        let checksumPos = 0o770 - numLogicalDisks * 4 - 2;
        let checksum = readWordInv(checksumPos);
        while (checksumPos < 0o776) {
            checksumPos += 2;
            checksum = (checksum - readWordInv(checksumPos)) & 0xFFFF;
        }

        // Контрольная сумма таблицы разделов АльтПро = 012701
        if (checksum !== 0o12701) {
            return false;
        }

        this.numSectors = readWordInv(0o772);
        this.numHeads = readWordInv(0o774) & 0xFF;
        this.numCylinders = readWordInv(0o776);
        return true;
    }

    /**
     * Получение текущего линейного номера сектора (LBA)
     * @returns {number}
     */
    getCurrentLba() {
        if ((this.driveAndHead & this.DHR_L) !== 0) {
            return ((this.driveAndHead & 0x0F) * 0x1000000) +
                   (this.cylinderHigh * 0x10000) +
                   (this.cylinderLow * 0x100) +
                   this.sectorNumber;
        } else {
            const cyl = (this.cylinderHigh << 8) | this.cylinderLow;
            const head = this.driveAndHead & 0x0F;
            const sec = this.sectorNumber - 1;
            return (cyl * this.numHeads * this.numSectors) + (head * this.numSectors) + sec;
        }
    }

    /**
     * Установка текущего сектора по номеру LBA
     * @param {number} lba 
     */
    setCurrentLba(lba) {
        if ((this.driveAndHead & this.DHR_L) !== 0) {
            this.driveAndHead = (this.driveAndHead & 0xF0) | ((lba >>> 24) & 0x0F);
            this.cylinderHigh = (lba >>> 16) & 0xFF;
            this.cylinderLow = (lba >>> 8) & 0xFF;
            this.sectorNumber = lba & 0xFF;
        } else {
            const sectorsPerCyl = this.numHeads * this.numSectors;
            const cyl = Math.floor(lba / sectorsPerCyl);
            const remainder = lba % sectorsPerCyl;
            const head = Math.floor(remainder / this.numSectors);
            const sec = (remainder % this.numSectors) + 1;

            this.cylinderHigh = (cyl >>> 8) & 0xFF;
            this.cylinderLow = cyl & 0xFF;
            this.driveAndHead = (this.driveAndHead & 0xF0) | (head & 0x0F);
            this.sectorNumber = sec & 0xFF;
        }
    }

    startTransfer(size, etf) {
        this.endTransferFunction = etf;
        this.dataBufferEnd = size;
        this.dataBufferOffset = 0;
        this.status |= this.SR_DRQ;
    }

    endTransfer() {
        this.endTransferFunction = this.ETF_NONE;
        this.dataBufferEnd = 0;
        this.dataBufferOffset = 0;
        this.status &= ~this.SR_DRQ;
    }

    readNextDataWord() {
        if (this.dataBufferOffset >= this.dataBufferEnd) {
            return 0;
        }
        const low = this.dataBuffer[this.dataBufferOffset++];
        const high = this.dataBuffer[this.dataBufferOffset++];
        const w = low | (high << 8);

        if (this.dataBufferOffset >= this.dataBufferEnd) {
            if (this.endTransferFunction === this.ETF_READ) {
                this.readSector();
            } else {
                this.endTransfer();
            }
        }
        return w;
    }

    writeNextDataWord(data) {
        if (this.dataBufferOffset < this.dataBuffer.length) {
            this.dataBuffer[this.dataBufferOffset++] = data & 0xFF;
            this.dataBuffer[this.dataBufferOffset++] = (data >>> 8) & 0xFF;
        }

        if (this.dataBufferOffset >= this.dataBufferEnd) {
            if (this.endTransferFunction === this.ETF_WRITE) {
                this.writeSector();
            } else {
                this.endTransfer();
            }
        }
    }

    readSector() {
        this.status = this.SR_DRDY | this.SR_DSC;
        this.error = this.ER_NONE;

        if (this.sectorCount === 0 || !this.diskImage) {
            this.endTransfer();
            return;
        }

        const count = Math.min(this.sectorCount, this.requiredSectors);
        const lba = this.getCurrentLba();
        const startPos = this.imageHeaderSize + lba * this.SECTOR_SIZE;

        for (let i = 0; i < count * this.SECTOR_SIZE; i++) {
            const imgPos = startPos + i;
            this.dataBuffer[i] = (imgPos < this.diskImage.length) ? this.diskImage[imgPos] : 0;
        }

        this.startTransfer(count * this.SECTOR_SIZE, this.ETF_READ);
        this.setCurrentLba(lba + count);
        this.sectorCount -= count;
    }

    writeSector() {
        if (!this.diskImage) {
            this.endTransfer();
            return;
        }
        this.status = this.SR_DRDY | this.SR_DSC;
        const count = Math.min(this.sectorCount, this.requiredSectors);
        const lba = this.getCurrentLba();
        const startPos = this.imageHeaderSize + lba * this.SECTOR_SIZE;

        if (startPos + count * this.SECTOR_SIZE > this.diskImage.length) {
            const newImage = new Uint8Array(startPos + count * this.SECTOR_SIZE);
            newImage.set(this.diskImage);
            this.diskImage = newImage;
        }

        for (let i = 0; i < count * this.SECTOR_SIZE; i++) {
            this.diskImage[startPos + i] = this.dataBuffer[i];
        }

        this.sectorCount -= count;
        this.setCurrentLba(lba + count);

        if (this.sectorCount === 0) {
            this.endTransfer();
        } else {
            const nextCount = Math.min(this.sectorCount, this.requiredSectors);
            this.startTransfer(nextCount * this.SECTOR_SIZE, this.ETF_WRITE);
        }
    }

    identify() {
        this.dataBuffer.fill(0);
        const buf = this.dataBuffer;

        const putWord = (offset, value) => {
            buf[offset] = value & 0xFF;
            buf[offset + 1] = (value >>> 8) & 0xFF;
        };

        const putString = (offset, length, str) => {
            for (let i = 0; i < length; i++) {
                const charCode = (i < str.length) ? str.charCodeAt(i) : 32;
                buf[(offset + i) ^ 1] = charCode;
            }
        };

        putWord(0, 0x0040);                        // Несъёмный диск
        putWord(2, this.numCylinders);             // Число цилиндров
        putWord(6, this.numHeads);                 // Число головок
        putWord(8, this.numSectors * this.SECTOR_SIZE); // Байт на дорожку
        putWord(10, this.SECTOR_SIZE);             // Байт на сектор
        putWord(12, this.numSectors);              // Секторов на дорожку
        putString(20, 20, 'SMK512-HDD-001');       // Серийный номер
        putWord(40, 3);                            // Тип буфера
        putWord(42, this.SECTOR_SIZE);             // Размер буфера
        putWord(44, 4);                            // Число байт ECC
        putString(46, 8, 'v2.05');                 // Версия прошивки
        putString(54, 40, 'BKEMU SMK512 IDE DRIVE'); // Модель
        putWord(94, 0x8000 | 16);                  // Максимум секторов для Multiple
        putWord(96, 1);                            // Поддержка LBA
        putWord(98, 1 << 9);
        putWord(106, 1);
        putWord(108, this.numCylinders);
        putWord(110, this.numHeads);
        putWord(112, this.numSectors);
        const capacity = this.numCylinders * this.numHeads * this.numSectors;
        putWord(114, capacity & 0xFFFF);
        putWord(116, (capacity >>> 16) & 0xFFFF);
        putWord(120, this.totalSectors & 0xFFFF);
        putWord(122, (this.totalSectors >>> 16) & 0xFFFF);
    }

    handleCommand(cmd) {
        if (!this.isDriveAttached()) {
            return;
        }

        switch (cmd) {
            case this.CMD_IDENTIFY:
                this.identify();
                this.status = this.SR_DRDY | this.SR_DSC;
                this.startTransfer(this.SECTOR_SIZE, this.ETF_NONE);
                break;

            case this.CMD_READ:
            case this.CMD_READ_ONCE:
                if (this.sectorCount === 0) this.sectorCount = 256;
                this.requiredSectors = 1;
                this.readSector();
                break;

            case this.CMD_WRITE:
            case this.CMD_WRITE_ONCE:
                if (this.sectorCount === 0) this.sectorCount = 256;
                this.error = this.ER_NONE;
                this.status = this.SR_DRDY | this.SR_DSC;
                this.requiredSectors = 1;
                this.startTransfer(this.SECTOR_SIZE, this.ETF_WRITE);
                break;

            case this.CMD_SET_MULTIPLE:
                this.multipleSectorCount = this.sectorCount;
                this.status = this.SR_DRDY;
                break;

            case this.CMD_READ_MULTIPLE:
                if (this.sectorCount === 0) this.sectorCount = 256;
                this.requiredSectors = this.multipleSectorCount || 1;
                this.readSector();
                break;

            case this.CMD_WRITE_MULTIPLE:
                if (this.sectorCount === 0) this.sectorCount = 256;
                this.error = this.ER_NONE;
                this.status = this.SR_DRDY | this.SR_DSC;
                this.requiredSectors = this.multipleSectorCount || 1;
                this.startTransfer(this.SECTOR_SIZE * Math.min(this.sectorCount, this.requiredSectors), this.ETF_WRITE);
                break;

            case this.CMD_INIT_DRIVE_PARAMS:
            case this.CMD_RECALIBRATE:
                this.error = this.ER_NONE;
                this.status = this.SR_DRDY | this.SR_DSC;
                break;

            case this.CMD_CHECK_POWER_MODE:
                this.sectorCount = 0xFF;
                this.status = this.SR_DRDY;
                break;

            case this.CMD_VERIFY:
            case this.CMD_VERIFY_ONCE:
            case this.CMD_FLUSH_CACHE:
            case this.CMD_STANDBY_IMMEDIATE:
            case this.CMD_IDLE_IMMEDIATE:
                this.status = this.SR_DRDY;
                break;

            case this.CMD_EXEC_DIAGNOSTIC:
                this.status = 0;
                this.error = 1;
                break;

            default:
                this.status = this.SR_DRDY | this.SR_ERR;
                this.error = this.ER_ABRT;
                break;
        }
    }

    readDriveAddressRegister() {
        if (!this.isDriveAttached()) {
            return 0;
        }
        let driveAddress = this.DAR_WTG;
        if ((this.driveAndHead & this.DHR_DRV) === 0) {
            driveAddress |= this.DAR_DS1;
        } else {
            driveAddress |= this.DAR_DS0;
        }
        driveAddress |= ((this.driveAndHead & (this.DHR_HS3 | this.DHR_HS2 | this.DHR_HS1 | this.DHR_HS0)) << 2);
        return driveAddress & 0xFF;
    }

    readAltStatusRegister() {
        return this.isDriveAttached() ? (this.status & 0xFF) : 0;
    }

    writeControlRegister(data) {
        if (((this.lastControlData & this.CR_SRST) === 0) && ((data & this.CR_SRST) !== 0)) {
            this.status = this.SR_BSY;
        } else if (((this.lastControlData & this.CR_SRST) !== 0) && ((data & this.CR_SRST) === 0)) {
            this.reset();
        }
        this.lastControlData = data & 0xFF;
    }

    /**
     * Чтение 16-битного слова из регистров IDE
     * В точности su.comp.bk.arch.io.disk.SmkIdeController#read
     * @param {number} addr 
     * @param {Object} result 
     * @returns {boolean}
     */
    readWord(addr, result) {
        const wordAddr = addr & 0o177776;

        // Если диск не подключен, все регистры возвращают 0xFFFF (~0 & 0xFFFF)
        if (!this.isDriveAttached()) {
            result.value = 0xFFFF;
            return true;
        }

        let val = 0;
        switch (wordAddr) {
            case this.REG_DATA:
                val = this.readNextDataWord();
                break;
            case this.REG_ERROR:
                val = this.error & 0xFF;
                break;
            case this.REG_SECTOR_COUNT:
                val = this.sectorCount & 0xFF;
                break;
            case this.REG_SECTOR_NUMBER:
                val = this.sectorNumber & 0xFF;
                break;
            case this.REG_CYLINDER_LOW:
                val = this.cylinderLow & 0xFF;
                break;
            case this.REG_CYLINDER_HIGH:
                val = this.cylinderHigh & 0xFF;
                break;
            case this.REG_COMP_1:
                val = (this.driveAndHead & 0xFF) | (this.readAltStatusRegister() << 8);
                break;
            case this.REG_COMP_0:
                val = (this.status & 0xFF) | (this.readDriveAddressRegister() << 8);
                break;
            default:
                return false;
        }

        // Аппаратная побитовая инверсия данных
        result.value = (~val) & 0xFFFF;
        return true;
    }

    /**
     * Запись 16-битного слова в регистры IDE
     * В точности su.comp.bk.arch.io.disk.SmkIdeController#write
     * @param {number} addr 
     * @param {number} value 
     * @returns {boolean}
     */
    writeWord(addr, value) {
        const wordAddr = addr & 0o177776;
        const invVal = (~value) & 0xFFFF;
        const byteVal = invVal & 0xFF;

        switch (wordAddr) {
            case this.REG_DATA:
                this.writeNextDataWord(invVal);
                break;
            case this.REG_ERROR: // Features
                this.features = byteVal;
                break;
            case this.REG_SECTOR_COUNT:
                this.sectorCount = byteVal;
                break;
            case this.REG_SECTOR_NUMBER:
                this.sectorNumber = byteVal;
                break;
            case this.REG_CYLINDER_LOW:
                this.cylinderLow = byteVal;
                break;
            case this.REG_CYLINDER_HIGH:
                this.cylinderHigh = byteVal;
                break;
            case this.REG_COMP_1:
                if (addr === this.REG_COMP_1) {
                    this.driveAndHead = byteVal | 0xA0;
                } else {
                    this.writeControlRegister(invVal >>> 8);
                }
                break;
            case this.REG_COMP_0:
                if (addr === this.REG_COMP_0) {
                    this.handleCommand(byteVal);
                }
                break;
            default:
                return false;
        }

        return true;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmkIdeController;
}
