/**
 * BKStudio - Web Worker for PDPy11 Assembler (Pyodide CPython WASM)
 * 
 * (c) 2025-2026 - by Ivan "VDM" Kalininskiy <https://t.me/VanDamM>
 */
'use strict';

let pyodide = null;
let initPromise = null;

/**
 * Инициализация Pyodide и монтирование архива pdpy11.zip
 */
async function initPyodideWorker(zipUrl) {
  if (pyodide) return pyodide;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    self.postMessage({ type: 'status', message: 'Загрузка среды Python (Pyodide WASM)...' });

    const pyodideBaseUrl = (self.location && self.location.href)
      ? new URL('../libs/pyodide/', self.location.href).href
      : '../libs/pyodide/';

    if (typeof loadPyodide === 'undefined') {
      importScripts(pyodideBaseUrl + 'pyodide.js');
    }

    self.postMessage({ type: 'status', message: 'Инициализация CPython WebAssembly...' });
    pyodide = await loadPyodide({
      indexURL: pyodideBaseUrl
    });

    self.postMessage({ type: 'status', message: 'Подключение ассемблера PDPy11...' });

    // Загрузка архива pdpy11.zip
    const fetchUrl = zipUrl || '../wasm/pdpy11.zip';
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Не удалось загрузить pdpy11.zip: HTTP ${response.status}`);
    }
    const zipBuffer = await response.arrayBuffer();
    pyodide.FS.writeFile('/pdpy11.zip', new Uint8Array(zipBuffer));

    // Настройка окружения Python
    await pyodide.runPythonAsync(`
import sys
import os

if '/pdpy11.zip' not in sys.path:
    sys.path.insert(0, '/pdpy11.zip')

import pdpy11
import pdpy11.bk_encoding
from pdpy11.compiler import Compiler
from pdpy11 import parser, formats, reports

class JsonReportHandler:
    def __init__(self):
        self.reports = []
    def __call__(self, priority, identifier, *items):
        for ctx_start, ctx_end, text in items:
            idx_line_start = ctx_start.code.rfind("\\n", 0, ctx_start.pos) + 1
            line_no = ctx_start.code[:idx_line_start].count("\\n") + 1
            col_no = (ctx_start.pos - idx_line_start) + 1
            filename = os.path.basename(ctx_start.filename) if ctx_start.filename else "code.mac"
            self.reports.append({
                "severity": priority.raw_text,
                "line": line_no,
                "column": col_no,
                "file": filename,
                "message": text.replace("\\n", " "),
                "code": identifier
            })
    `);

    self.postMessage({ type: 'status', message: 'Компилятор PDPy11 готов к работе.' });
    return pyodide;
  })();

  return initPromise;
}

self.onmessage = async (e) => {
  const { id, action, mainFile, files, zipUrl } = e.data;

  if (action === 'init') {
    try {
      await initPyodideWorker(zipUrl);
      self.postMessage({ id, type: 'init_done', success: true });
    } catch (err) {
      self.postMessage({ id, type: 'init_done', success: false, error: err.message });
    }
    return;
  }

  if (action === 'compile') {
    try {
      const py = await initPyodideWorker(zipUrl);

      // Подготавливаем виртуальную директорию /workspace
      try {
        py.FS.mkdir('/workspace');
      } catch (e) {
        // Уже создана
      }

      if (files) {
        for (const [filename, content] of Object.entries(files)) {
          const filePath = '/workspace/' + filename;
          if (typeof content === 'string') {
            py.FS.writeFile(filePath, content, { encoding: 'utf8' });
          } else {
            py.FS.writeFile(filePath, new Uint8Array(content));
          }
        }
      }

      const entryFile = mainFile || 'main.mac';
      py.globals.set('entry_file', entryFile);

      const compilePy = `
import os
os.chdir('/workspace')

report_handler = JsonReportHandler()
success = False
base_addr = 0o1000
bin_bytes = b''
lst_text = ''
error_list = []

try:
    with reports.handle_reports(report_handler):
        file_path = os.path.join('/workspace', entry_file)
        with open(file_path, 'r', encoding='utf-8') as f:
            source = f.read()

        parsed = [parser.parse(entry_file, source)]
        comp = Compiler(output_charset="bk")
        base, code = comp.compile_and_link_files(parsed)
        base_addr = base
        
        # 1. Эмиссия файлов, объявленных директивами make_bin, make_raw, make_wav, etc.
        was_emitted, emitted_file = comp.emit_files(base, code)
        
        # 2. Если явных make_* директив не было, генерируем стандартный .bin
        entry_base = os.path.splitext(entry_file)[0]
        bin_bytes = formats.file_formats["bin"](base, code)
        if not was_emitted:
            def_bin_path = entry_base + ".bin"
            with open(def_bin_path, "wb") as f:
                f.write(bin_bytes)
        
        # 3. Формирование листинга .lst
        try:
            lst_text = comp.generate_listing()
            if lst_text:
                with open(entry_base + ".lst", "w", encoding="utf-8") as f:
                    f.write(lst_text)
        except Exception:
            lst_text = ''
            
        success = True
except reports.UnrecoverableError:
    success = False
except Exception as ex:
    success = False
    report_handler.reports.append({
        "severity": "Error",
        "line": 1,
        "column": 1,
        "file": entry_file,
        "message": str(ex),
        "code": "exception"
    })

import json
error_json = json.dumps(report_handler.reports)
      `;

      await py.runPythonAsync(compilePy);

      const success = py.globals.get('success');
      const baseAddr = py.globals.get('base_addr');
      const binBytes = py.globals.get('bin_bytes');
      const lstText = py.globals.get('lst_text');
      const errorJson = py.globals.get('error_json');
      let errorList = [];
      try {
        errorList = errorJson ? JSON.parse(errorJson) : [];
      } catch (e) {
        errorList = [];
      }

      // Сбор сгенерированных файлов-артефактов из виртуального каталога /workspace
      const artifacts = {};
      if (success) {
        try {
          const workspaceFiles = py.FS.readdir('/workspace');
          for (const fname of workspaceFiles) {
            if (fname === '.' || fname === '..') continue;
            const lower = fname.toLowerCase();
            if (/\.(asm|mac|s|inc)$/i.test(lower)) continue;
            if (/\.(bin|raw|wav|lst|sav|rom)$/i.test(lower)) {
              const fullPath = '/workspace/' + fname;
              try {
                if (lower.endsWith('.lst')) {
                  artifacts[fname] = py.FS.readFile(fullPath, { encoding: 'utf8' });
                } else {
                  const rawData = py.FS.readFile(fullPath, { encoding: 'binary' });
                  artifacts[fname] = (rawData instanceof Uint8Array) ? rawData : new Uint8Array(rawData);
                }
              } catch (e) {
                console.warn('[PDPy11 Worker] Не удалось прочитать артефакт:', fname, e);
              }
            }
          }
        } catch (e) {
          console.warn('[PDPy11 Worker] Ошибка сканирования /workspace:', e);
        }
      }

      let binArray = null;
      if (success && binBytes) {
        const rawBytes = binBytes.toJs ? binBytes.toJs() : binBytes;
        binArray = (rawBytes instanceof Uint8Array) ? rawBytes : new Uint8Array(rawBytes);
      }
      // Если binArray не был получен напрямую, но среди артефактов есть .bin
      if (!binArray && artifacts) {
        for (const [artName, artData] of Object.entries(artifacts)) {
          if (artName.toLowerCase().endsWith('.bin')) {
            binArray = artData;
            break;
          }
        }
      }

      self.postMessage({
        id,
        type: 'compile_done',
        success,
        baseAddress: baseAddr,
        bin: binArray,
        listing: lstText || '',
        artifacts: artifacts,
        errors: errorList || [],
        compiler: 'pdpy11'
      });

    } catch (err) {
      self.postMessage({
        id,
        type: 'compile_done',
        success: false,
        error: err.message,
        errors: [{
          severity: 'Error',
          line: 1,
          column: 1,
          message: err.message,
          code: 'worker_error'
        }],
        compiler: 'pdpy11'
      });
    }
  }
};
