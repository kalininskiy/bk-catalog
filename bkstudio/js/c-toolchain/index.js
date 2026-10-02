/**
 * BKStudio - GNU GCC 14.2.0 (WASM) Pipeline Orchestrator
 * 
 * Связывает оригинальные WebAssembly модули для БК-0010/11М:
 * - cc1.wasm (ядро GNU GCC 14.2.0 с патчем КР1801ВМ1)
 * - as.wasm (GNU Assembler из Binutils 2.43 target pdp11-aout)
 * - ld.wasm (GNU Linker из Binutils 2.43 target pdp11-aout)
 * - aout2bin.wasm (конвертер a.out в загрузочный BIN БК-0010)
 * 
 * (c) 2025-2026 - BKStudio / Ivan "VDM" Kalininskiy
 */

import createCc1Module from '../../wasm/cc1.js';
import createAsModule from '../../wasm/as.js';
import createLdModule from '../../wasm/ld.js';
import createAout2BinModule from '../../wasm/aout2bin.js';
import { BUILTIN_HEADERS, CRT0_SOURCE, LDSCRIPT_SOURCE } from './builtin-headers.js';

export class BKCToolchain {
  /**
   * @param {Object} [options]
   * @param {string} [options.wasmBaseUrl="wasm/"] Базовый URL для загрузки .wasm файлов
   */
  constructor(options = {}) {
    if (options.wasmBaseUrl) {
      this.wasmBaseUrl = options.wasmBaseUrl.endsWith('/') ? options.wasmBaseUrl : options.wasmBaseUrl + '/';
    } else {
      this.wasmBaseUrl = 'wasm/';
    }
  }

  locateWasm(path) {
    return this.wasmBaseUrl + path;
  }

  parseDiagnostics(stderr) {
    const diagnostics = [];
    const lines = stderr.split('\n');
    const diagRegex = /^([^:\n]+):(\d+)(?::(\d+))?:\s*(error|warning|note|fatal error):\s*(.*)$/i;

    for (const line of lines) {
      const match = line.match(diagRegex);
      if (match) {
        diagnostics.push({
          file: match[1].replace(/^\//, ''),
          line: parseInt(match[2], 10),
          column: match[3] ? parseInt(match[3], 10) : 1,
          severity: match[4].toLowerCase().includes('error') ? 'error' : (match[4].toLowerCase() === 'warning' ? 'warning' : 'info'),
          message: match[5]
        });
      }
    }
    return diagnostics;
  }

  parseMapSymbols(mapContent) {
    const symbols = [];
    const lines = mapContent.split('\n');
    let currentSection = 'text';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('.text')) currentSection = 'text';
      else if (trimmed.startsWith('.data')) currentSection = 'data';
      else if (trimmed.startsWith('.bss')) currentSection = 'bss';

      const match = line.match(/^\s*0x([0-9a-fA-F]+)\s+([A-Za-z0-9_]+)\s*$/);
      if (match) {
        const addr = parseInt(match[1], 16);
        const rawName = match[2];
        const cleanName = rawName.startsWith('_') && !rawName.startsWith('___') ? rawName.slice(1) : rawName;
        if (!rawName.startsWith('__bss') && !rawName.startsWith('__data') && rawName !== '_start') {
          symbols.push({
            name: cleanName,
            rawName,
            type: currentSection,
            address: '0o' + addr.toString(8).padStart(6, '0'),
            hexAddress: '0x' + addr.toString(16).padStart(4, '0'),
            decAddress: addr
          });
        }
      }
    }
    return symbols;
  }

  async compile(options = {}) {
    const stdoutArr = [];
    const stderrArr = [];
    const diagnostics = [];

    const log = (msg) => {
      stdoutArr.push(msg);
      if (typeof options.onLog === 'function') options.onLog(msg, 'info');
      else if (typeof console !== 'undefined') console.log(msg);
    };
    const logErr = (msg) => {
      stderrArr.push(msg);
      if (typeof options.onLog === 'function') options.onLog(msg, 'error');
      else if (typeof console !== 'undefined') console.error(msg);
    };

    const files = options.files || {};
    const platform = options.platform || 'BK0010';
    const optFlag = `-${options.optimization || 'Os'}`;
    const isDebug = !!options.debug;

    log(`[BK C Toolchain] Сборка проекта (Target: КР1801ВМ1 / ${platform}, Opt: ${optFlag})...`);

    const fileNames = Object.keys(files);
    const cFiles = fileNames.filter(f => f.endsWith('.c'));

    if (cFiles.length === 0) {
      const errMsg = 'В проекте отсутствуют исходные файлы на языке Си (*.c)';
      logErr(`Ошибка: ${errMsg}`);
      diagnostics.push({ file: 'project', line: 1, column: 1, severity: 'error', message: errMsg });
      return {
        success: false,
        bin: null,
        listing: '',
        map: '',
        symbols: [],
        diagnostics,
        stdout: stdoutArr.join('\n'),
        stderr: stderrArr.join('\n')
      };
    }

    try {
      const headers = { ...BUILTIN_HEADERS };
      for (const f of fileNames) {
        if (f.endsWith('.h')) {
          headers[f] = files[f];
        }
      }

      const allCompilationCFiles = fileNames.filter(f => f.endsWith('.c'));

      log(`[1/4] Компиляция Си-файлов через GNU GCC 14.2.0 (cc1.wasm)...`);
      const asmFiles = {};
      let combinedListing = '';

      for (const cFile of allCompilationCFiles) {
        const cCode = files[cFile];
        const baseName = cFile.replace(/\.c$/, '');
        const asmName = `${baseName}.s`;

        let cc1Out = '', cc1Err = '';
        const cc1Args = [
          '-quiet',
          '-std=gnu23',
          optFlag,
          '-m10',
          '-m1801vm1',
          '-msoft-float',
          '-fno-common',
          '-fomit-frame-pointer',
          '-fcprop-registers',
          '-fno-reorder-blocks',
          '-fno-caller-saves',
          '-fno-if-conversion',
          '-DVERSION=1.2',
          '-DBUILD_DATE=01.01.2026',
          '-I/include',
          '-I/',
          `/${cFile}`,
          '-o',
          `/${asmName}`
        ];
        if (isDebug) cc1Args.push('-DDEBUG');

        let cc1;
        try {
          cc1 = await createCc1Module({
            arguments: cc1Args,
            locateFile: (p) => this.locateWasm(p),
            preRun: [(mod) => {
              try { mod.FS.mkdir('/include'); } catch (e) {}
              for (const [hName, hContent] of Object.entries(headers)) {
                const parts = hName.split('/');
                if (parts.length > 1) {
                  let cur = '/include';
                  for (let i = 0; i < parts.length - 1; i++) {
                    cur += '/' + parts[i];
                    try { mod.FS.mkdir(cur); } catch (e) {}
                  }
                  let curRoot = '';
                  for (let i = 0; i < parts.length - 1; i++) {
                    curRoot += '/' + parts[i];
                    try { mod.FS.mkdir(curRoot); } catch (e) {}
                  }
                }
                try { mod.FS.writeFile(`/include/${hName}`, hContent); } catch (e) {}
                try { mod.FS.writeFile(`/${hName}`, hContent); } catch (e) {}
              }
              mod.FS.writeFile(`/${cFile}`, cCode);
            }],
            print: (t) => { cc1Out += t + '\n'; },
            printErr: (t) => { cc1Err += t + '\n'; }
          });
        } catch (e) {
          if (cc1Err) {
            logErr(cc1Err);
            diagnostics.push(...this.parseDiagnostics(cc1Err));
          } else {
            logErr(`Ошибка запуска cc1: ${e.message}`);
          }
          return {
            success: false,
            bin: null,
            listing: '',
            map: '',
            symbols: [],
            diagnostics,
            stdout: stdoutArr.join('\n'),
            stderr: stderrArr.join('\n')
          };
        }

        if (cc1Err) {
          const diags = this.parseDiagnostics(cc1Err);
          if (diags.length > 0) diagnostics.push(...diags);
          const hasErrors = diags.some(d => d.severity === 'error') || cc1Err.includes('error:');
          if (hasErrors) {
            logErr(cc1Err);
            return {
              success: false,
              bin: null,
              listing: '',
              map: '',
              symbols: [],
              diagnostics,
              stdout: stdoutArr.join('\n'),
              stderr: stderrArr.join('\n')
            };
          }
        }

        const asmCode = cc1.FS.readFile(`/${asmName}`, { encoding: 'utf8' });
        asmFiles[asmName] = asmCode;
        combinedListing += `\n/* === Файл: ${cFile} -> ${asmName} === */\n` + asmCode;
        log(`    ✓ ${cFile} -> ${asmName} (${asmCode.length} байт ассемблера)`);
      }

      log(`[2/4] Ассемблирование через GNU Assembler 2.43 (as.wasm)...`);
      const objFiles = {};

      let asCrt0Err = '';
      const asCrt0 = await createAsModule({
        arguments: ['-o', '/crt0.o', '/crt0.s'],
        locateFile: (p) => this.locateWasm(p),
        preRun: [(mod) => {
          mod.FS.writeFile('/crt0.s', CRT0_SOURCE);
        }],
        printErr: (t) => { asCrt0Err += t + '\n'; }
      });
      const crt0Obj = asCrt0.FS.readFile('/crt0.o');
      log(`    ✓ crt0.s -> crt0.o (${crt0Obj.length} байт)`);

      for (const f of fileNames) {
        if (f.endsWith('.s') || f.endsWith('.asm')) {
          asmFiles[f] = files[f];
        }
      }

      for (const [asmName, asmCode] of Object.entries(asmFiles)) {
        const objName = asmName.replace(/\.(s|asm)$/, '.o');
        let asErr = '';
        const asMod = await createAsModule({
          arguments: ['-o', `/${objName}`, `/${asmName}`],
          locateFile: (p) => this.locateWasm(p),
          preRun: [(mod) => {
            mod.FS.writeFile(`/${asmName}`, asmCode);
          }],
          printErr: (t) => { asErr += t + '\n'; }
        });

        if (asErr && asErr.includes('Error')) {
          logErr(asErr);
          diagnostics.push(...this.parseDiagnostics(asErr));
          return {
            success: false,
            bin: null,
            listing: combinedListing,
            map: '',
            symbols: [],
            diagnostics,
            stdout: stdoutArr.join('\n'),
            stderr: stderrArr.join('\n')
          };
        }

        const objBytes = asMod.FS.readFile(`/${objName}`);
        objFiles[objName] = objBytes;
        log(`    ✓ ${asmName} -> ${objName} (${objBytes.length} байт)`);
      }

      log(`[3/4] Компоновка бинарного образа через GNU Linker 2.43 (ld.wasm)...`);
      let ldOut = '', ldErr = '';
      const ldArgs = [
        '-T', '/a.out.ld',
        '-Map', '/output.map',
        '-o', '/a.out',
        '/crt0.o',
        ...Object.keys(objFiles).map(o => `/${o}`)
      ];

      let ldMod;
      try {
        ldMod = await createLdModule({
          arguments: ldArgs,
          locateFile: (p) => this.locateWasm(p),
          preRun: [(mod) => {
            mod.FS.writeFile('/a.out.ld', LDSCRIPT_SOURCE);
            mod.FS.writeFile('/crt0.o', crt0Obj);
            for (const [oName, oBytes] of Object.entries(objFiles)) {
              mod.FS.writeFile(`/${oName}`, oBytes);
            }
          }],
          print: (t) => { ldOut += t + '\n'; },
          printErr: (t) => { ldErr += t + '\n'; }
        });
      } catch (e) {
        if (ldErr) {
          logErr(ldErr);
          diagnostics.push(...this.parseDiagnostics(ldErr));
        } else {
          logErr(`Ошибка линковщика ld: ${e.message}`);
        }
        return {
          success: false,
          bin: null,
          listing: combinedListing,
          map: '',
          symbols: [],
          diagnostics,
          stdout: stdoutArr.join('\n'),
          stderr: stderrArr.join('\n')
        };
      }

      if (ldErr && (ldErr.includes('undefined reference') || ldErr.includes('error'))) {
        logErr(ldErr);
        diagnostics.push({
          file: 'linker',
          line: 1,
          column: 1,
          severity: 'error',
          message: ldErr.trim()
        });
        return {
          success: false,
          bin: null,
          listing: combinedListing,
          map: '',
          symbols: [],
          diagnostics,
          stdout: stdoutArr.join('\n'),
          stderr: stderrArr.join('\n')
        };
      }

      const aoutBytes = ldMod.FS.readFile('/a.out');
      const mapContent = ldMod.FS.readFile('/output.map', { encoding: 'utf8' });
      const symbols = this.parseMapSymbols(mapContent);
      log(`    ✓ a.out сформирован (${aoutBytes.length} байт), символов: ${symbols.length}`);

      log(`[4/4] Конвертация a.out в загрузочный BIN БК (aout2bin.wasm)...`);
      let a2bErr = '';
      const a2bMod = await createAout2BinModule({
        arguments: ['/a.out', '/OUTPUT.BIN'],
        locateFile: (p) => this.locateWasm(p),
        preRun: [(mod) => {
          mod.FS.writeFile('/a.out', aoutBytes);
        }],
        printErr: (t) => { a2bErr += t + '\n'; }
      });

      const binBytes = a2bMod.FS.readFile('/OUTPUT.BIN');
      const loadAddr = binBytes[0] | (binBytes[1] << 8);
      const binLen = binBytes[2] | (binBytes[3] << 8);

      log(`    ✓ УСПЕХ: Сформирован образ БК (${binBytes.length} байт).`);
      log(`      Заголовок: адрес загрузки 0o${loadAddr.toString(8)}, длина: ${binLen} байт.`);

      return {
        success: true,
        bin: new Uint8Array(binBytes),
        listing: combinedListing.trim(),
        map: mapContent,
        symbols,
        diagnostics,
        stdout: stdoutArr.join('\n'),
        stderr: stderrArr.join('\n')
      };

    } catch (err) {
      logErr(`Критическая ошибка сборщика: ${err.message}`);
      return {
        success: false,
        bin: null,
        listing: '',
        map: '',
        symbols: [],
        diagnostics: [{
          file: 'system',
          line: 1,
          column: 1,
          severity: 'error',
          message: err.message
        }],
        stdout: stdoutArr.join('\n'),
        stderr: stderrArr.join('\n')
      };
    }
  }
}

export default BKCToolchain;
