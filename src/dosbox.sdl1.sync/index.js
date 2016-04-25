module.exports = function(Module) {
  Module['screenIsReadOnly'] = true;

  var canvasStyle = Module['canvas'].style;
  canvasStyle.imageRendering = 'optimizeSpeed';
  canvasStyle.imageRendering = '-webkit-optimize-contrast';
  canvasStyle.imageRendering = 'optimize-contrast';
  canvasStyle.imageRendering = 'crisp-edges';
  canvasStyle.imageRendering = 'pixelated';

  // var Module;
  if (!Module) Module = (typeof Module !== 'undefined' ? Module : null) || {};
  var moduleOverrides = {};
  for (var key in Module) {
    if (Module.hasOwnProperty(key)) {
      moduleOverrides[key] = Module[key];
    }
  }

  var ENVIRONMENT_IS_WEB = typeof window === 'object';
  var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';

  var nodeFS = require('fs');
  var nodePath = require('path');
  Module['read'] = function read(filename, binary) {
    filename = nodePath['normalize'](filename);
    var ret = nodeFS['readFileSync'](filename);
    if (!ret && filename != nodePath['resolve'](filename)) {
      filename = path.join(__dirname, '..', 'src', filename);
      ret = nodeFS['readFileSync'](filename);
    }

    if (ret && !binary) ret = ret.toString();
    return ret;
  };

  Module['readBinary'] = function readBinary(filename) {
    return Module['read'](filename, true);
  };

  Module['load'] = Module['read'];
  if (!Module['thisProgram']) {
    if (process['argv'].length > 1) {
      Module['thisProgram'] = process['argv'][1].replace(/\\/g, '/');
    } else {
      Module['thisProgram'] = 'unknown-program';
    }
  }

  if (!Module['print']) Module['print'] = function print(x) {
    console.log(x);
  };

  if (!Module['printErr']) Module['printErr'] = function printErr(x) {
    console.log(x);
  };
  if (ENVIRONMENT_IS_WORKER) {
    Module['load'] = importScripts;
  }

  // FIXME Module.setWindowTitle이 헨들 안됨
  if (typeof Module.setWindowTitle === 'undefined') {
    Module.setWindowTitle = function(title) {
      document.title = title;
    };
  }

  if (!Module['thisProgram']) {
    Module['thisProgram'] = './this.program';
  }

  for (var key in moduleOverrides) {
    if (moduleOverrides.hasOwnProperty(key)) {
      Module[key] = moduleOverrides[key];
    }
  }

  var Runtime = {
    setTempRet0: (function(value) {
      tempRet0 = value;
    }),

    getTempRet0: (function() {
      return tempRet0;
    }),

    stackSave: (function() {
      return STACKTOP;
    }),

    stackRestore: (function(stackTop) {
      STACKTOP = stackTop;
    }),

    getNativeTypeSize: (function(type) {
      switch (type) {
        case 'i1':
        case 'i8':
          return 1;
        case 'i16':
          return 2;
        case 'i32':
          return 4;
        case 'i64':
          return 8;
        case 'float':
          return 4;
        case 'double':
          return 8;
        default:
          {
            if (type[type.length - 1] === '*') {
              return Runtime.QUANTUM_SIZE;
            } else if (type[0] === 'i') {
              var bits = parseInt(type.substr(1));
              assert(bits % 8 === 0);
              return bits / 8;
            } else {
              return 0;
            }
          }
      }
    }),

    getNativeFieldSize: (function(type) {
      return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
    }),

    STACK_ALIGN: 16,
    getAlignSize: (function(type, size, vararg) {
      if (!vararg && (type == 'i64' || type == 'double')) return 8;
      if (!type) return Math.min(size, 8);
      return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
    }),

    dynCall: (function(sig, ptr, args) {
      if (args && args.length) {
        if (!args.splice) args = Array.prototype.slice.call(args);
        args.splice(0, 0, ptr);
        return Module['dynCall_' + sig].apply(null, args);
      } else {
        return Module['dynCall_' + sig].call(null, ptr);
      }
    }),

    functionPointers: [],
    addFunction: (function(func) {
      for (var i = 0; i < Runtime.functionPointers.length; i++) {
        if (!Runtime.functionPointers[i]) {
          Runtime.functionPointers[i] = func;
          return 2 * (1 + i);
        }
      }

      throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';
    }),

    removeFunction: (function(index) {
      Runtime.functionPointers[(index - 2) / 2] = null;
    }),

    getAsmConst: (function(code, numArgs) {
      if (!Runtime.asmConstCache) Runtime.asmConstCache = {};
      var func = Runtime.asmConstCache[code];
      if (func) return func;
      var args = [];
      for (var i = 0; i < numArgs; i++) {
        args.push(String.fromCharCode(36) + i);
      }

      var source = Pointer_stringify(code);
      if (source[0] === '"') {
        if (source.indexOf('"', 1) === source.length - 1) {
          source = source.substr(1, source.length - 2);
        } else {
          abort('invalid EM_ASM input |' + source + '|. Please use EM_ASM(..code..) (no quotes) or EM_ASM({ ..code($0).. }, input) (to input values)');
        }
      }

      try {
        var evalled = eval('(function(Module, FS) { return function(' + args.join(',') + '){ ' + source + ' } })')(Module, typeof FS !== 'undefined' ? FS : null);
      } catch (e) {
        Module.printErr('error in executing inline EM_ASM code: ' + e + ' on: \n\n' + source + '\n\nwith args |' + args + '| (make sure to use the right one out of EM_ASM, EM_ASM_ARGS, etc.)');
        throw e;
      }
      return Runtime.asmConstCache[code] = evalled;
    }),

    warnOnce: (function(text) {
      if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
      if (!Runtime.warnOnce.shown[text]) {
        Runtime.warnOnce.shown[text] = 1;
        Module.printErr(text);
      }
    }),

    funcWrappers: {},
    getFuncWrapper: (function(func, sig) {
      assert(sig);
      if (!Runtime.funcWrappers[sig]) {
        Runtime.funcWrappers[sig] = {};
      }

      var sigCache = Runtime.funcWrappers[sig];
      if (!sigCache[func]) {
        sigCache[func] = function dynCall_wrapper() {
          return Runtime.dynCall(sig, func, arguments);
        };
      }

      return sigCache[func];
    }),

    getCompilerSetting: (function(name) {
      throw 'You must build with -s RETAIN_COMPILER_SETTINGS=1 for Runtime.getCompilerSetting or emscripten_get_compiler_setting to work';
    }),

    stackAlloc: (function(size) {
      var ret = STACKTOP;
      STACKTOP = STACKTOP + size | 0;
      STACKTOP = STACKTOP + 15 & -16;
      return ret;
    }),

    staticAlloc: (function(size) {
      var ret = STATICTOP;
      STATICTOP = STATICTOP + size | 0;
      STATICTOP = STATICTOP + 15 & -16;
      return ret;
    }),

    dynamicAlloc: (function(size) {
      var ret = DYNAMICTOP;
      DYNAMICTOP = DYNAMICTOP + size | 0;
      DYNAMICTOP = DYNAMICTOP + 15 & -16;
      if (DYNAMICTOP >= TOTAL_MEMORY) enlargeMemory();
      return ret;
    }),

    alignMemory: (function(size, quantum) {
      var ret = size = Math.ceil(size / (quantum ? quantum : 16)) * (quantum ? quantum : 16);
      return ret;
    }),

    makeBigInt: (function(low, high, unsigned) {
      var ret = unsigned ? +(low >>> 0) + +(high >>> 0) * +4294967296 : +(low >>> 0) + +(high | 0) * +4294967296;
      return ret;
    }),

    GLOBAL_BASE: 2048,
    QUANTUM_SIZE: 4,
    __dummy__: 0
  };
  Module['Runtime'] = Runtime;
  var __THREW__ = 0;
  var ABORT = false;
  var EXITSTATUS = 0;
  var undef = 0;
  var tempValue, tempInt, tempBigInt, tempInt2, tempBigInt2, tempPair, tempBigIntI, tempBigIntR, tempBigIntS, tempBigIntP, tempBigIntD, tempDouble, tempFloat;
  var tempI64, tempI64b;
  var tempRet0, tempRet1, tempRet2, tempRet3, tempRet4, tempRet5, tempRet6, tempRet7, tempRet8, tempRet9;

  function assert(condition, text) {
    if (!condition) {
      abort('Assertion failed: ' + text);
    }
  }

  var globalScope = this;

  function getCFunc(ident) {
    var func = Module['_' + ident];
    if (!func) {
      try {
        func = eval('_' + ident);
      } catch (e) {}
    }

    assert(func, 'Cannot call unknown function ' + ident + ' (perhaps LLVM optimizations or closure removed it?)');
    return func;
  }

  var cwrap, ccall;
  ((function() {
    var JSfuncs = {
      stackSave: (function() {
        Runtime.stackSave();
      }),

      stackRestore: (function() {
        Runtime.stackRestore();
      }),

      arrayToC: (function(arr) {
        var ret = Runtime.stackAlloc(arr.length);
        writeArrayToMemory(arr, ret);
        return ret;
      }),

      stringToC: (function(str) {
        var ret = 0;
        if (str !== null && str !== undefined && str !== 0) {
          ret = Runtime.stackAlloc((str.length << 2) + 1);
          writeStringToMemory(str, ret);
        }

        return ret;
      })
    };
    var toC = {
      string: JSfuncs['stringToC'],
      array: JSfuncs['arrayToC']
    };
    ccall = function ccallFunc(ident, returnType, argTypes, args) {
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0) stack = Runtime.stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }

      var ret = func.apply(null, cArgs);
      if (returnType === 'string') ret = Pointer_stringify(ret);
      if (stack !== 0) Runtime.stackRestore(stack);
      return ret;
    };

    var sourceRegex = /^function\s*\(([^)]*)\)\s*{\s*([^*]*?)[\s;]*(?:return\s*(.*?)[;\s]*)?}$/;

    function parseJSFunc(jsfunc) {
      var parsed = jsfunc.toString().match(sourceRegex).slice(1);
      return {
        arguments: parsed[0],
        body: parsed[1],
        returnValue: parsed[2]
      };
    }

    var JSsource = {};
    for (var fun in JSfuncs) {
      if (JSfuncs.hasOwnProperty(fun)) {
        JSsource[fun] = parseJSFunc(JSfuncs[fun]);
      }
    }

    cwrap = function cwrap(ident, returnType, argTypes) {
      argTypes = argTypes || [];
      var cfunc = getCFunc(ident);
      var numericArgs = argTypes.every((function(type) {
        return type === 'number';
      }));

      var numericRet = returnType !== 'string';
      if (numericRet && numericArgs) {
        return cfunc;
      }

      var argNames = argTypes.map((function(x, i) {
        return '$' + i;
      }));

      var funcstr = '(function(' + argNames.join(',') + ') {';
      var nargs = argTypes.length;
      if (!numericArgs) {
        funcstr += 'var stack = ' + JSsource['stackSave'].body + ';';
        for (var i = 0; i < nargs; i++) {
          var arg = argNames[i],
            type = argTypes[i];
          if (type === 'number') continue;
          var convertCode = JSsource[type + 'ToC'];
          funcstr += 'var ' + convertCode.arguments + ' = ' + arg + ';';
          funcstr += convertCode.body + ';';
          funcstr += arg + '=' + convertCode.returnValue + ';';
        }
      }

      var cfuncname = parseJSFunc((function() {
        return cfunc;
      })).returnValue;
      funcstr += 'var ret = ' + cfuncname + '(' + argNames.join(',') + ');';
      if (!numericRet) {
        var strgfy = parseJSFunc((function() {
          return Pointer_stringify;
        })).returnValue;
        funcstr += 'ret = ' + strgfy + '(ret);';
      }

      if (!numericArgs) {
        funcstr += JSsource['stackRestore'].body.replace('()', '(stack)') + ';';
      }

      funcstr += 'return ret})';
      return eval(funcstr);
    };
  }))();

  Module['cwrap'] = cwrap;
  Module['ccall'] = ccall;

  function setValue(ptr, value, type, noSafe) {
    type = type || 'i8';
    if (type.charAt(type.length - 1) === '*') type = 'i32';
    switch (type) {
      case 'i1':
        HEAP8[ptr >> 0] = value;
        break;
      case 'i8':
        HEAP8[ptr >> 0] = value;
        break;
      case 'i16':
        HEAP16[ptr >> 1] = value;
        break;
      case 'i32':
        HEAP32[ptr >> 2] = value;
        break;
      case 'i64':
        tempI64 = [value >>> 0, (tempDouble = value, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0)], HEAP32[ptr >> 2] = tempI64[0], HEAP32[ptr + 4 >> 2] = tempI64[1];
        break;
      case 'float':
        HEAPF32[ptr >> 2] = value;
        break;
      case 'double':
        HEAPF64[ptr >> 3] = value;
        break;
      default:
        abort('invalid type for setValue: ' + type);
    }
  }

  Module['setValue'] = setValue;

  function getValue(ptr, type, noSafe) {
    type = type || 'i8';
    if (type.charAt(type.length - 1) === '*') type = 'i32';
    switch (type) {
      case 'i1':
        return HEAP8[ptr >> 0];
      case 'i8':
        return HEAP8[ptr >> 0];
      case 'i16':
        return HEAP16[ptr >> 1];
      case 'i32':
        return HEAP32[ptr >> 2];
      case 'i64':
        return HEAP32[ptr >> 2];
      case 'float':
        return HEAPF32[ptr >> 2];
      case 'double':
        return HEAPF64[ptr >> 3];
      default:
        abort('invalid type for setValue: ' + type);
    }
    return null;
  }

  Module['getValue'] = getValue;
  var ALLOC_NORMAL = 0;
  var ALLOC_STACK = 1;
  var ALLOC_STATIC = 2;
  var ALLOC_DYNAMIC = 3;
  var ALLOC_NONE = 4;
  Module['ALLOC_NORMAL'] = ALLOC_NORMAL;
  Module['ALLOC_STACK'] = ALLOC_STACK;
  Module['ALLOC_STATIC'] = ALLOC_STATIC;
  Module['ALLOC_DYNAMIC'] = ALLOC_DYNAMIC;
  Module['ALLOC_NONE'] = ALLOC_NONE;

  function allocate(slab, types, allocator, ptr) {
    var zeroinit, size;
    if (typeof slab === 'number') {
      zeroinit = true;
      size = slab;
    } else {
      zeroinit = false;
      size = slab.length;
    }

    var singleType = typeof types === 'string' ? types : null;
    var ret;
    if (allocator == ALLOC_NONE) {
      ret = ptr;
    } else {
      ret = [_malloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
    }

    if (zeroinit) {
      var ptr = ret,
        stop;
      assert((ret & 3) == 0);
      stop = ret + (size & ~3);
      for (; ptr < stop; ptr += 4) {
        HEAP32[ptr >> 2] = 0;
      }

      stop = ret + size;
      while (ptr < stop) {
        HEAP8[ptr++ >> 0] = 0;
      }

      return ret;
    }

    if (singleType === 'i8') {
      if (slab.subarray || slab.slice) {
        HEAPU8.set(slab, ret);
      } else {
        HEAPU8.set(new Uint8Array(slab), ret);
      }

      return ret;
    }

    var i = 0,
      type, typeSize, previousType;
    while (i < size) {
      var curr = slab[i];
      if (typeof curr === 'function') {
        curr = Runtime.getFunctionIndex(curr);
      }

      type = singleType || types[i];
      if (type === 0) {
        i++;
        continue;
      }

      if (type == 'i64') type = 'i32';
      setValue(ret + i, curr, type);
      if (previousType !== type) {
        typeSize = Runtime.getNativeTypeSize(type);
        previousType = type;
      }

      i += typeSize;
    }

    return ret;
  }

  Module['allocate'] = allocate;

  function Pointer_stringify(ptr, length) {
    if (length === 0 || !ptr) return '';
    var hasUtf = 0;
    var t;
    var i = 0;
    while (1) {
      t = HEAPU8[ptr + i >> 0];
      hasUtf |= t;
      if (t == 0 && !length) break;
      i++;
      if (length && i == length) break;
    }

    if (!length) length = i;
    var ret = '';
    if (hasUtf < 128) {
      var MAX_CHUNK = 1024;
      var curr;
      while (length > 0) {
        curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
        ret = ret ? ret + curr : curr;
        ptr += MAX_CHUNK;
        length -= MAX_CHUNK;
      }

      return ret;
    }

    return Module['UTF8ToString'](ptr);
  }

  Module['Pointer_stringify'] = Pointer_stringify;

  function AsciiToString(ptr) {
    var str = '';
    while (1) {
      var ch = HEAP8[ptr++ >> 0];
      if (!ch) return str;
      str += String.fromCharCode(ch);
    }
  }

  Module['AsciiToString'] = AsciiToString;

  function stringToAscii(str, outPtr) {
    return writeAsciiToMemory(str, outPtr, false);
  }

  Module['stringToAscii'] = stringToAscii;

  function UTF8ArrayToString(u8Array, idx) {
    var u0, u1, u2, u3, u4, u5;
    var str = '';
    while (1) {
      u0 = u8Array[idx++];
      if (!u0) return str;
      if (!(u0 & 128)) {
        str += String.fromCharCode(u0);
        continue;
      }

      u1 = u8Array[idx++] & 63;
      if ((u0 & 224) == 192) {
        str += String.fromCharCode((u0 & 31) << 6 | u1);
        continue;
      }

      u2 = u8Array[idx++] & 63;
      if ((u0 & 240) == 224) {
        u0 = (u0 & 15) << 12 | u1 << 6 | u2;
      } else {
        u3 = u8Array[idx++] & 63;
        if ((u0 & 248) == 240) {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | u3;
        } else {
          u4 = u8Array[idx++] & 63;
          if ((u0 & 252) == 248) {
            u0 = (u0 & 3) << 24 | u1 << 18 | u2 << 12 | u3 << 6 | u4;
          } else {
            u5 = u8Array[idx++] & 63;
            u0 = (u0 & 1) << 30 | u1 << 24 | u2 << 18 | u3 << 12 | u4 << 6 | u5;
          }
        }
      }

      if (u0 < 65536) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      }
    }
  }

  Module['UTF8ArrayToString'] = UTF8ArrayToString;

  function UTF8ToString(ptr) {
    return UTF8ArrayToString(HEAPU8, ptr);
  }

  Module['UTF8ToString'] = UTF8ToString;

  function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
    if (!(maxBytesToWrite > 0)) return 0;
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1;
    for (var i = 0; i < str.length; ++i) {
      var u = str.charCodeAt(i);
      if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
      if (u <= 127) {
        if (outIdx >= endIdx) break;
        outU8Array[outIdx++] = u;
      } else if (u <= 2047) {
        if (outIdx + 1 >= endIdx) break;
        outU8Array[outIdx++] = 192 | u >> 6;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 65535) {
        if (outIdx + 2 >= endIdx) break;
        outU8Array[outIdx++] = 224 | u >> 12;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 2097151) {
        if (outIdx + 3 >= endIdx) break;
        outU8Array[outIdx++] = 240 | u >> 18;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else if (u <= 67108863) {
        if (outIdx + 4 >= endIdx) break;
        outU8Array[outIdx++] = 248 | u >> 24;
        outU8Array[outIdx++] = 128 | u >> 18 & 63;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      } else {
        if (outIdx + 5 >= endIdx) break;
        outU8Array[outIdx++] = 252 | u >> 30;
        outU8Array[outIdx++] = 128 | u >> 24 & 63;
        outU8Array[outIdx++] = 128 | u >> 18 & 63;
        outU8Array[outIdx++] = 128 | u >> 12 & 63;
        outU8Array[outIdx++] = 128 | u >> 6 & 63;
        outU8Array[outIdx++] = 128 | u & 63;
      }
    }

    outU8Array[outIdx] = 0;
    return outIdx - startIdx;
  }

  Module['stringToUTF8Array'] = stringToUTF8Array;

  function stringToUTF8(str, outPtr, maxBytesToWrite) {
    return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
  }

  Module['stringToUTF8'] = stringToUTF8;

  function lengthBytesUTF8(str) {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var u = str.charCodeAt(i);
      if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
      if (u <= 127) {
        ++len;
      } else if (u <= 2047) {
        len += 2;
      } else if (u <= 65535) {
        len += 3;
      } else if (u <= 2097151) {
        len += 4;
      } else if (u <= 67108863) {
        len += 5;
      } else {
        len += 6;
      }
    }

    return len;
  }

  Module['lengthBytesUTF8'] = lengthBytesUTF8;

  function UTF16ToString(ptr) {
    var i = 0;
    var str = '';
    while (1) {
      var codeUnit = HEAP16[ptr + i * 2 >> 1];
      if (codeUnit == 0) return str;
      ++i;
      str += String.fromCharCode(codeUnit);
    }
  }

  Module['UTF16ToString'] = UTF16ToString;

  function stringToUTF16(str, outPtr, maxBytesToWrite) {
    if (maxBytesToWrite === undefined) {
      maxBytesToWrite = 2147483647;
    }

    if (maxBytesToWrite < 2) return 0;
    maxBytesToWrite -= 2;
    var startPtr = outPtr;
    var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
    for (var i = 0; i < numCharsToWrite; ++i) {
      var codeUnit = str.charCodeAt(i);
      HEAP16[outPtr >> 1] = codeUnit;
      outPtr += 2;
    }

    HEAP16[outPtr >> 1] = 0;
    return outPtr - startPtr;
  }

  Module['stringToUTF16'] = stringToUTF16;

  function lengthBytesUTF16(str) {
    return str.length * 2;
  }

  Module['lengthBytesUTF16'] = lengthBytesUTF16;

  function UTF32ToString(ptr) {
    var i = 0;
    var str = '';
    while (1) {
      var utf32 = HEAP32[ptr + i * 4 >> 2];
      if (utf32 == 0) return str;
      ++i;
      if (utf32 >= 65536) {
        var ch = utf32 - 65536;
        str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
      } else {
        str += String.fromCharCode(utf32);
      }
    }
  }

  Module['UTF32ToString'] = UTF32ToString;

  function stringToUTF32(str, outPtr, maxBytesToWrite) {
    if (maxBytesToWrite === undefined) {
      maxBytesToWrite = 2147483647;
    }

    if (maxBytesToWrite < 4) return 0;
    var startPtr = outPtr;
    var endPtr = startPtr + maxBytesToWrite - 4;
    for (var i = 0; i < str.length; ++i) {
      var codeUnit = str.charCodeAt(i);
      if (codeUnit >= 55296 && codeUnit <= 57343) {
        var trailSurrogate = str.charCodeAt(++i);
        codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
      }

      HEAP32[outPtr >> 2] = codeUnit;
      outPtr += 4;
      if (outPtr + 4 > endPtr) break;
    }

    HEAP32[outPtr >> 2] = 0;
    return outPtr - startPtr;
  }

  Module['stringToUTF32'] = stringToUTF32;

  function lengthBytesUTF32(str) {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      var codeUnit = str.charCodeAt(i);
      if (codeUnit >= 55296 && codeUnit <= 57343) ++i;
      len += 4;
    }

    return len;
  }

  Module['lengthBytesUTF32'] = lengthBytesUTF32;

  function demangle(func) {
    var hasLibcxxabi = !!Module['___cxa_demangle'];
    if (hasLibcxxabi) {
      try {
        var buf = _malloc(func.length);
        writeStringToMemory(func.substr(1), buf);
        var status = _malloc(4);
        var ret = Module['___cxa_demangle'](buf, 0, 0, status);
        if (getValue(status, 'i32') === 0 && ret) {
          return Pointer_stringify(ret);
        }
      } catch (e) {} finally {
        if (buf) _free(buf);
        if (status) _free(status);
        if (ret) _free(ret);
      }
    }

    var i = 3;
    var basicTypes = {
      v: 'void',
      b: 'bool',
      c: 'char',
      s: 'short',
      i: 'int',
      l: 'long',
      f: 'float',
      d: 'double',
      w: 'wchar_t',
      a: 'signed char',
      h: 'unsigned char',
      t: 'unsigned short',
      j: 'unsigned int',
      m: 'unsigned long',
      x: 'long long',
      y: 'unsigned long long',
      z: '...'
    };
    var subs = [];
    var first = true;

    function dump(x) {
      if (x) Module.print(x);
      Module.print(func);
      var pre = '';
      for (var a = 0; a < i; a++) pre += ' ';
      Module.print(pre + '^');
    }

    function parseNested() {
      i++;
      if (func[i] === 'K') i++;
      var parts = [];
      while (func[i] !== 'E') {
        if (func[i] === 'S') {
          i++;
          var next = func.indexOf('_', i);
          var num = func.substring(i, next) || 0;
          parts.push(subs[num] || '?');
          i = next + 1;
          continue;
        }

        if (func[i] === 'C') {
          parts.push(parts[parts.length - 1]);
          i += 2;
          continue;
        }

        var size = parseInt(func.substr(i));
        var pre = size.toString().length;
        if (!size || !pre) {
          i--;
          break;
        }

        var curr = func.substr(i + pre, size);
        parts.push(curr);
        subs.push(curr);
        i += pre + size;
      }

      i++;
      return parts;
    }

    function parse(rawList, limit, allowVoid) {
      limit = limit || Infinity;
      var ret = '',
        list = [];

      function flushList() {
        return '(' + list.join(', ') + ')';
      }

      var name;
      if (func[i] === 'N') {
        name = parseNested().join('::');
        limit--;
        if (limit === 0) return rawList ? [name] : name;
      } else {
        if (func[i] === 'K' || first && func[i] === 'L') i++;
        var size = parseInt(func.substr(i));
        if (size) {
          var pre = size.toString().length;
          name = func.substr(i + pre, size);
          i += pre + size;
        }
      }

      first = false;
      if (func[i] === 'I') {
        i++;
        var iList = parse(true);
        var iRet = parse(true, 1, true);
        ret += iRet[0] + ' ' + name + '<' + iList.join(', ') + '>';
      } else {
        ret = name;
      }

      paramLoop: while (i < func.length && limit-- > 0) {
        var c = func[i++];
        if (c in basicTypes) {
          list.push(basicTypes[c]);
        } else {
          switch (c) {
            case 'P':
              list.push(parse(true, 1, true)[0] + '*');
              break;
            case 'R':
              list.push(parse(true, 1, true)[0] + '&');
              break;
            case 'L':
              {
                i++;
                var end = func.indexOf('E', i);
                var size = end - i; list.push(func.substr(i, size)); i += size + 2;
                break;
              }

            case 'A':
              {
                var size = parseInt(func.substr(i)); i += size.toString().length;
                if (func[i] !== '_') throw '?'; i++; list.push(parse(true, 1, true)[0] + ' [' + size + ']');
                break;
              }

            case 'E':
              break paramLoop;
            default:
              ret += '?' + c;
              break paramLoop;
          }
        }
      }

      if (!allowVoid && list.length === 1 && list[0] === 'void') list = [];
      if (rawList) {
        if (ret) {
          list.push(ret + '?');
        }

        return list;
      } else {
        return ret + flushList();
      }
    }

    var parsed = func;
    try {
      if (func == 'Object._main' || func == '_main') {
        return 'main()';
      }

      if (typeof func === 'number') func = Pointer_stringify(func);
      if (func[0] !== '_') return func;
      if (func[1] !== '_') return func;
      if (func[2] !== 'Z') return func;
      switch (func[3]) {
        case 'n':
          return 'operator new()';
        case 'd':
          return 'operator delete()';
      }
      parsed = parse();
    } catch (e) {
      parsed += '?';
    }
    if (parsed.indexOf('?') >= 0 && !hasLibcxxabi) {
      Runtime.warnOnce('warning: a problem occurred in builtin C++ name demangling; build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling');
    }

    return parsed;
  }

  function demangleAll(text) {
    return text.replace(/__Z[\w\d_]+/g, (function(x) {
      var y = demangle(x);
      return x === y ? x : x + ' [' + y + ']';
    }));
  }

  function jsStackTrace() {
    var err = new Error;
    if (!err.stack) {
      try {
        throw new Error(0);
      } catch (e) {
        err = e;
      }
      if (!err.stack) {
        return '(no stack trace available)';
      }
    }

    return err.stack.toString();
  }

  function stackTrace() {
    return demangleAll(jsStackTrace());
  }

  Module['stackTrace'] = stackTrace;
  var PAGE_SIZE = 4096;

  function alignMemoryPage(x) {
    return x + 4095 & -4096;
  }

  var HEAP;
  var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
  var STATIC_BASE = 0,
    STATICTOP = 0,
    staticSealed = false;
  var STACK_BASE = 0,
    STACKTOP = 0,
    STACK_MAX = 0;
  var DYNAMIC_BASE = 0,
    DYNAMICTOP = 0;

  function enlargeMemory() {
    abort('Cannot enlarge memory arrays. Either (1) compile with -s TOTAL_MEMORY=X with X higher than the current value ' + TOTAL_MEMORY + ', (2) compile with ALLOW_MEMORY_GROWTH which adjusts the size at runtime but prevents some optimizations, or (3) set Module.TOTAL_MEMORY before the program runs.');
  }

  var TOTAL_STACK = Module['TOTAL_STACK'] || 5242880;
  var TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 134217728;
  var FAST_MEMORY = Module['FAST_MEMORY'] || 2097152;
  var totalMemory = 64 * 1024;
  while (totalMemory < TOTAL_MEMORY || totalMemory < 2 * TOTAL_STACK) {
    if (totalMemory < 16 * 1024 * 1024) {
      totalMemory *= 2;
    } else {
      totalMemory += 16 * 1024 * 1024;
    }
  }

  if (totalMemory !== TOTAL_MEMORY) {
    Module.printErr('increasing TOTAL_MEMORY to ' + totalMemory + ' to be compliant with the asm.js spec (and given that TOTAL_STACK=' + TOTAL_STACK + ')');
    TOTAL_MEMORY = totalMemory;
  }

  assert(typeof Int32Array !== 'undefined' && typeof Float64Array !== 'undefined' && !!(new Int32Array(1))['subarray'] && !!(new Int32Array(1))['set'], 'JS engine does not provide full typed array support');
  var buffer = new ArrayBuffer(TOTAL_MEMORY);
  HEAP8 = new Int8Array(buffer);
  HEAP16 = new Int16Array(buffer);
  HEAP32 = new Int32Array(buffer);
  HEAPU8 = new Uint8Array(buffer);
  HEAPU16 = new Uint16Array(buffer);
  HEAPU32 = new Uint32Array(buffer);
  HEAPF32 = new Float32Array(buffer);
  HEAPF64 = new Float64Array(buffer);
  HEAP32[0] = 255;
  assert(HEAPU8[0] === 255 && HEAPU8[3] === 0, 'Typed arrays 2 must be run on a little-endian system');
  Module['HEAP'] = HEAP;
  Module['buffer'] = buffer;
  Module['HEAP8'] = HEAP8;
  Module['HEAP16'] = HEAP16;
  Module['HEAP32'] = HEAP32;
  Module['HEAPU8'] = HEAPU8;
  Module['HEAPU16'] = HEAPU16;
  Module['HEAPU32'] = HEAPU32;
  Module['HEAPF32'] = HEAPF32;
  Module['HEAPF64'] = HEAPF64;

  function callRuntimeCallbacks(callbacks) {
    while (callbacks.length > 0) {
      var callback = callbacks.shift();
      if (typeof callback == 'function') {
        callback();
        continue;
      }

      var func = callback.func;
      if (typeof func === 'number') {
        if (callback.arg === undefined) {
          Runtime.dynCall('v', func);
        } else {
          Runtime.dynCall('vi', func, [callback.arg]);
        }
      } else {
        func(callback.arg === undefined ? null : callback.arg);
      }
    }
  }

  var __ATPRERUN__ = [];
  var __ATINIT__ = [];
  var __ATMAIN__ = [];
  var __ATEXIT__ = [];
  var __ATPOSTRUN__ = [];
  var runtimeInitialized = false;
  var runtimeExited = false;

  function preRun() {
    if (Module['preRun']) {
      if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
      while (Module['preRun'].length) {
        addOnPreRun(Module['preRun'].shift());
      }
    }

    callRuntimeCallbacks(__ATPRERUN__);
  }

  function ensureInitRuntime() {
    if (runtimeInitialized) return;
    runtimeInitialized = true;
    callRuntimeCallbacks(__ATINIT__);
  }

  function preMain() {
    callRuntimeCallbacks(__ATMAIN__);
  }

  function exitRuntime() {
    callRuntimeCallbacks(__ATEXIT__);
    runtimeExited = true;
  }

  function postRun() {
    if (Module['postRun']) {
      if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
      while (Module['postRun'].length) {
        addOnPostRun(Module['postRun'].shift());
      }
    }

    callRuntimeCallbacks(__ATPOSTRUN__);
  }

  function addOnPreRun(cb) {
    __ATPRERUN__.unshift(cb);
  }

  Module['addOnPreRun'] = Module.addOnPreRun = addOnPreRun;

  function addOnInit(cb) {
    __ATINIT__.unshift(cb);
  }

  Module['addOnInit'] = Module.addOnInit = addOnInit;

  function addOnPreMain(cb) {
    __ATMAIN__.unshift(cb);
  }

  Module['addOnPreMain'] = Module.addOnPreMain = addOnPreMain;

  function addOnExit(cb) {
    __ATEXIT__.unshift(cb);
  }

  Module['addOnExit'] = Module.addOnExit = addOnExit;

  function addOnPostRun(cb) {
    __ATPOSTRUN__.unshift(cb);
  }

  Module['addOnPostRun'] = Module.addOnPostRun = addOnPostRun;

  function intArrayFromString(stringy, dontAddNull, length) {
    var len = length > 0 ? length : lengthBytesUTF8(stringy) + 1;
    var u8array = new Array(len);
    var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
    if (dontAddNull) u8array.length = numBytesWritten;
    return u8array;
  }

  Module['intArrayFromString'] = intArrayFromString;

  function intArrayToString(array) {
    var ret = [];
    for (var i = 0; i < array.length; i++) {
      var chr = array[i];
      if (chr > 255) {
        chr &= 255;
      }

      ret.push(String.fromCharCode(chr));
    }

    return ret.join('');
  }

  Module['intArrayToString'] = intArrayToString;

  function writeStringToMemory(string, buffer, dontAddNull) {
    var array = intArrayFromString(string, dontAddNull);
    var i = 0;
    while (i < array.length) {
      var chr = array[i];
      HEAP8[buffer + i >> 0] = chr;
      i = i + 1;
    }
  }

  Module['writeStringToMemory'] = writeStringToMemory;

  function writeArrayToMemory(array, buffer) {
    for (var i = 0; i < array.length; i++) {
      HEAP8[buffer++ >> 0] = array[i];
    }
  }

  Module['writeArrayToMemory'] = writeArrayToMemory;

  function writeAsciiToMemory(str, buffer, dontAddNull) {
    for (var i = 0; i < str.length; ++i) {
      HEAP8[buffer++ >> 0] = str.charCodeAt(i);
    }

    if (!dontAddNull) HEAP8[buffer >> 0] = 0;
  }

  Module['writeAsciiToMemory'] = writeAsciiToMemory;

  function unSign(value, bits, ignore) {
    if (value >= 0) {
      return value;
    }

    return bits <= 32 ? 2 * Math.abs(1 << bits - 1) + value : Math.pow(2, bits) + value;
  }

  function reSign(value, bits, ignore) {
    if (value <= 0) {
      return value;
    }

    var half = bits <= 32 ? Math.abs(1 << bits - 1) : Math.pow(2, bits - 1);
    if (value >= half && (bits <= 32 || value > half)) {
      value = -2 * half + value;
    }

    return value;
  }

  if (!Math['imul'] || Math['imul'](4294967295, 5) !== -5) Math['imul'] = function imul(a, b) {
    var ah = a >>> 16;
    var al = a & 65535;
    var bh = b >>> 16;
    var bl = b & 65535;
    return al * bl + (ah * bl + al * bh << 16) | 0;
  };

  Math.imul = Math['imul'];
  if (!Math['clz32']) Math['clz32'] = (function(x) {
    x = x >>> 0;
    for (var i = 0; i < 32; i++) {
      if (x & 1 << 31 - i) return i;
    }

    return 32;
  });

  Math.clz32 = Math['clz32'];
  var Math_abs = Math.abs;
  var Math_cos = Math.cos;
  var Math_sin = Math.sin;
  var Math_tan = Math.tan;
  var Math_acos = Math.acos;
  var Math_asin = Math.asin;
  var Math_atan = Math.atan;
  var Math_atan2 = Math.atan2;
  var Math_exp = Math.exp;
  var Math_log = Math.log;
  var Math_sqrt = Math.sqrt;
  var Math_ceil = Math.ceil;
  var Math_floor = Math.floor;
  var Math_pow = Math.pow;
  var Math_imul = Math.imul;
  var Math_fround = Math.fround;
  var Math_min = Math.min;
  var Math_clz32 = Math.clz32;
  var runDependencies = 0;
  var runDependencyWatcher = null;
  var dependenciesFulfilled = null;

  function addRunDependency(id) {
    runDependencies++;
    if (Module['monitorRunDependencies']) {
      Module['monitorRunDependencies'](runDependencies);
    }
  }

  Module['addRunDependency'] = addRunDependency;

  function removeRunDependency(id) {
    runDependencies--;
    if (Module['monitorRunDependencies']) {
      Module['monitorRunDependencies'](runDependencies);
    }

    if (runDependencies == 0) {
      if (runDependencyWatcher !== null) {
        clearInterval(runDependencyWatcher);
        runDependencyWatcher = null;
      }

      if (dependenciesFulfilled) {
        var callback = dependenciesFulfilled;
        dependenciesFulfilled = null;
        callback();
      }
    }
  }

  Module['removeRunDependency'] = removeRunDependency;
  Module['preloadedImages'] = {};
  Module['preloadedAudios'] = {};
  var memoryInitializer = null;
  STATIC_BASE = 2048;
  STATICTOP = STATIC_BASE + 31232824;
  var EMTSTACKTOP = STATIC_BASE + 30184232,
    EMT_STACK_MAX = EMTSTACKTOP + 1048576;
  __ATINIT__.push({
    func: (function() {
      __GLOBAL__sub_I_cpu_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_dos_memory_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_dos_misc_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_drives_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_hardware_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_vga_memory_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_sdl_mapper_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_messages_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_programs_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_setup_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_shell_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_shell_misc_cpp();
    })
  }, {
    func: (function() {
      __GLOBAL__sub_I_iostream_cpp();
    })
  });

  var memoryInitializer = 'dosbox.html.mem';
  var tempDoublePtr = Runtime.alignMemory(allocate(12, 'i8', ALLOC_STATIC), 8);
  assert(tempDoublePtr % 8 == 0);

  function copyTempFloat(ptr) {
    HEAP8[tempDoublePtr] = HEAP8[ptr];
    HEAP8[tempDoublePtr + 1] = HEAP8[ptr + 1];
    HEAP8[tempDoublePtr + 2] = HEAP8[ptr + 2];
    HEAP8[tempDoublePtr + 3] = HEAP8[ptr + 3];
  }

  function copyTempDouble(ptr) {
    HEAP8[tempDoublePtr] = HEAP8[ptr];
    HEAP8[tempDoublePtr + 1] = HEAP8[ptr + 1];
    HEAP8[tempDoublePtr + 2] = HEAP8[ptr + 2];
    HEAP8[tempDoublePtr + 3] = HEAP8[ptr + 3];
    HEAP8[tempDoublePtr + 4] = HEAP8[ptr + 4];
    HEAP8[tempDoublePtr + 5] = HEAP8[ptr + 5];
    HEAP8[tempDoublePtr + 6] = HEAP8[ptr + 6];
    HEAP8[tempDoublePtr + 7] = HEAP8[ptr + 7];
  }

  var JSEvents = {
    keyEvent: 0,
    mouseEvent: 0,
    wheelEvent: 0,
    uiEvent: 0,
    focusEvent: 0,
    deviceOrientationEvent: 0,
    deviceMotionEvent: 0,
    fullscreenChangeEvent: 0,
    pointerlockChangeEvent: 0,
    visibilityChangeEvent: 0,
    touchEvent: 0,
    previousFullscreenElement: null,
    previousScreenX: null,
    previousScreenY: null,
    removeEventListenersRegistered: false,
    registerRemoveEventListeners: (function() {
      if (!JSEvents.removeEventListenersRegistered) {
        __ATEXIT__.push({
          func: (function() {
            for (var i = JSEvents.eventHandlers.length - 1; i >= 0; --i) {
              JSEvents._removeHandler(i);
            }
          })
        });
        JSEvents.removeEventListenersRegistered = true;
      }
    }),

    findEventTarget: (function(target) {
      if (target) {
        if (typeof target == 'number') {
          target = Pointer_stringify(target);
        }

        if (target == '#window') return window;
        else if (target == '#document') return document;
        else if (target == '#screen') return window.screen;
        else if (target == '#canvas') return Module['canvas'];
        if (typeof target == 'string') return document.getElementById(target);
        else return target;
      } else {
        return window;
      }
    }),

    deferredCalls: [],
    deferCall: (function(targetFunction, precedence, argsList) {
      function arraysHaveEqualContent(arrA, arrB) {
        if (arrA.length != arrB.length) return false;
        for (var i in arrA) {
          if (arrA[i] != arrB[i]) return false;
        }

        return true;
      }

      for (var i in JSEvents.deferredCalls) {
        var call = JSEvents.deferredCalls[i];
        if (call.targetFunction == targetFunction && arraysHaveEqualContent(call.argsList, argsList)) {
          return;
        }
      }

      JSEvents.deferredCalls.push({
        targetFunction: targetFunction,
        precedence: precedence,
        argsList: argsList
      });
      JSEvents.deferredCalls.sort((function(x, y) {
        return x.precedence < y.precedence;
      }));
    }),

    removeDeferredCalls: (function(targetFunction) {
      for (var i = 0; i < JSEvents.deferredCalls.length; ++i) {
        if (JSEvents.deferredCalls[i].targetFunction == targetFunction) {
          JSEvents.deferredCalls.splice(i, 1);
          --i;
        }
      }
    }),

    canPerformEventHandlerRequests: (function() {
      return JSEvents.inEventHandler && JSEvents.currentEventHandler.allowsDeferredCalls;
    }),

    runDeferredCalls: (function() {
      if (!JSEvents.canPerformEventHandlerRequests()) {
        return;
      }

      for (var i = 0; i < JSEvents.deferredCalls.length; ++i) {
        var call = JSEvents.deferredCalls[i];
        JSEvents.deferredCalls.splice(i, 1);
        --i;
        call.targetFunction.apply(this, call.argsList);
      }
    }),

    inEventHandler: 0,
    currentEventHandler: null,
    eventHandlers: [],
    isInternetExplorer: (function() {
      return navigator.userAgent.indexOf('MSIE') !== -1 || navigator.appVersion.indexOf('Trident/') > 0;
    }),

    removeAllHandlersOnTarget: (function(target, eventTypeString) {
      for (var i = 0; i < JSEvents.eventHandlers.length; ++i) {
        if (JSEvents.eventHandlers[i].target == target && (!eventType || eventTypeString == JSEvents.eventHandlers[i].eventTypeString)) {
          JSEvents._removeHandler(i--);
        }
      }
    }),

    _removeHandler: (function(i) {
      var h = JSEvents.eventHandlers[i];
      h.target.removeEventListener(h.eventTypeString, h.eventListenerFunc, h.useCapture);
      JSEvents.eventHandlers.splice(i, 1);
    }),

    registerOrRemoveHandler: (function(eventHandler) {
      var jsEventHandler = function jsEventHandler(event) {
        ++JSEvents.inEventHandler;
        JSEvents.currentEventHandler = eventHandler;
        JSEvents.runDeferredCalls();
        eventHandler.handlerFunc(event);
        JSEvents.runDeferredCalls();
        --JSEvents.inEventHandler;
      };

      if (eventHandler.callbackfunc) {
        eventHandler.eventListenerFunc = jsEventHandler;
        eventHandler.target.addEventListener(eventHandler.eventTypeString, jsEventHandler, eventHandler.useCapture);
        JSEvents.eventHandlers.push(eventHandler);
        JSEvents.registerRemoveEventListeners();
      } else {
        for (var i = 0; i < JSEvents.eventHandlers.length; ++i) {
          if (JSEvents.eventHandlers[i].target == eventHandler.target && JSEvents.eventHandlers[i].eventTypeString == eventHandler.eventTypeString) {
            JSEvents._removeHandler(i--);
          }
        }
      }
    }),

    registerKeyEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.keyEvent) {
        JSEvents.keyEvent = _malloc(164);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        writeStringToMemory(e.key ? e.key : '', JSEvents.keyEvent + 0);
        writeStringToMemory(e.code ? e.code : '', JSEvents.keyEvent + 32);
        HEAP32[JSEvents.keyEvent + 64 >> 2] = e.location;
        HEAP32[JSEvents.keyEvent + 68 >> 2] = e.ctrlKey;
        HEAP32[JSEvents.keyEvent + 72 >> 2] = e.shiftKey;
        HEAP32[JSEvents.keyEvent + 76 >> 2] = e.altKey;
        HEAP32[JSEvents.keyEvent + 80 >> 2] = e.metaKey;
        HEAP32[JSEvents.keyEvent + 84 >> 2] = e.repeat;
        writeStringToMemory(e.locale ? e.locale : '', JSEvents.keyEvent + 88);
        writeStringToMemory(e.char ? e.char : '', JSEvents.keyEvent + 120);
        HEAP32[JSEvents.keyEvent + 152 >> 2] = e.charCode;
        HEAP32[JSEvents.keyEvent + 156 >> 2] = e.keyCode;
        HEAP32[JSEvents.keyEvent + 160 >> 2] = e.which;
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.keyEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: JSEvents.isInternetExplorer() ? false : true,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    getBoundingClientRectOrZeros: (function(target) {
      return target.getBoundingClientRect ? target.getBoundingClientRect() : {
        left: 0,
        top: 0
      };
    }),

    fillMouseEventData: (function(eventStruct, e, target) {
      HEAPF64[eventStruct >> 3] = JSEvents.tick();
      HEAP32[eventStruct + 8 >> 2] = e.screenX;
      HEAP32[eventStruct + 12 >> 2] = e.screenY;
      HEAP32[eventStruct + 16 >> 2] = e.clientX;
      HEAP32[eventStruct + 20 >> 2] = e.clientY;
      HEAP32[eventStruct + 24 >> 2] = e.ctrlKey;
      HEAP32[eventStruct + 28 >> 2] = e.shiftKey;
      HEAP32[eventStruct + 32 >> 2] = e.altKey;
      HEAP32[eventStruct + 36 >> 2] = e.metaKey;
      HEAP16[eventStruct + 40 >> 1] = e.button;
      HEAP16[eventStruct + 42 >> 1] = e.buttons;
      HEAP32[eventStruct + 44 >> 2] = e['movementX'] || e.screenX - JSEvents.previousScreenX;
      HEAP32[eventStruct + 48 >> 2] = e['movementY'] || e.screenY - JSEvents.previousScreenY;
      if (Module['canvas']) {
        var rect = Module['canvas'].getBoundingClientRect();
        HEAP32[eventStruct + 60 >> 2] = e.clientX - rect.left;
        HEAP32[eventStruct + 64 >> 2] = e.clientY - rect.top;
      } else {
        HEAP32[eventStruct + 60 >> 2] = 0;
        HEAP32[eventStruct + 64 >> 2] = 0;
      }

      if (target) {
        var rect = JSEvents.getBoundingClientRectOrZeros(target);
        HEAP32[eventStruct + 52 >> 2] = e.clientX - rect.left;
        HEAP32[eventStruct + 56 >> 2] = e.clientY - rect.top;
      } else {
        HEAP32[eventStruct + 52 >> 2] = 0;
        HEAP32[eventStruct + 56 >> 2] = 0;
      }

      JSEvents.previousScreenX = e.screenX;
      JSEvents.previousScreenY = e.screenY;
    }),

    registerMouseEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.mouseEvent) {
        JSEvents.mouseEvent = _malloc(72);
      }

      target = JSEvents.findEventTarget(target);
      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillMouseEventData(JSEvents.mouseEvent, e, target);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.mouseEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: eventTypeString != 'mousemove',
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      if (JSEvents.isInternetExplorer() && eventTypeString == 'mousedown') eventHandler.allowsDeferredCalls = false;
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    registerWheelEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.wheelEvent) {
        JSEvents.wheelEvent = _malloc(104);
      }

      target = JSEvents.findEventTarget(target);
      var wheelHandlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillMouseEventData(JSEvents.wheelEvent, e, target);
        HEAPF64[JSEvents.wheelEvent + 72 >> 3] = e['deltaX'];
        HEAPF64[JSEvents.wheelEvent + 80 >> 3] = e['deltaY'];
        HEAPF64[JSEvents.wheelEvent + 88 >> 3] = e['deltaZ'];
        HEAP32[JSEvents.wheelEvent + 96 >> 2] = e['deltaMode'];
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.wheelEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var mouseWheelHandlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillMouseEventData(JSEvents.wheelEvent, e, target);
        HEAPF64[JSEvents.wheelEvent + 72 >> 3] = e['wheelDeltaX'];
        HEAPF64[JSEvents.wheelEvent + 80 >> 3] = -e['wheelDeltaY'];
        HEAPF64[JSEvents.wheelEvent + 88 >> 3] = 0;
        HEAP32[JSEvents.wheelEvent + 96 >> 2] = 0;
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.wheelEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: true,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: eventTypeString == 'wheel' ? wheelHandlerFunc : mouseWheelHandlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    pageScrollPos: (function() {
      if (window.pageXOffset > 0 || window.pageYOffset > 0) {
        return [window.pageXOffset, window.pageYOffset];
      }

      if (typeof document.documentElement.scrollLeft !== 'undefined' || typeof document.documentElement.scrollTop !== 'undefined') {
        return [document.documentElement.scrollLeft, document.documentElement.scrollTop];
      }

      return [document.body.scrollLeft | 0, document.body.scrollTop | 0];
    }),

    registerUiEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.uiEvent) {
        JSEvents.uiEvent = _malloc(36);
      }

      if (eventTypeString == 'scroll' && !target) {
        target = document;
      } else {
        target = JSEvents.findEventTarget(target);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        if (e.target != target) {
          return;
        }

        var scrollPos = JSEvents.pageScrollPos();
        HEAP32[JSEvents.uiEvent >> 2] = e.detail;
        HEAP32[JSEvents.uiEvent + 4 >> 2] = document.body.clientWidth;
        HEAP32[JSEvents.uiEvent + 8 >> 2] = document.body.clientHeight;
        HEAP32[JSEvents.uiEvent + 12 >> 2] = window.innerWidth;
        HEAP32[JSEvents.uiEvent + 16 >> 2] = window.innerHeight;
        HEAP32[JSEvents.uiEvent + 20 >> 2] = window.outerWidth;
        HEAP32[JSEvents.uiEvent + 24 >> 2] = window.outerHeight;
        HEAP32[JSEvents.uiEvent + 28 >> 2] = scrollPos[0];
        HEAP32[JSEvents.uiEvent + 32 >> 2] = scrollPos[1];
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.uiEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    getNodeNameForTarget: (function(target) {
      if (!target) return '';
      if (target == window) return '#window';
      if (target == window.screen) return '#screen';
      return target && target.nodeName ? target.nodeName : '';
    }),

    registerFocusEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.focusEvent) {
        JSEvents.focusEvent = _malloc(256);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        var nodeName = JSEvents.getNodeNameForTarget(e.target);
        var id = e.target.id ? e.target.id : '';
        writeStringToMemory(nodeName, JSEvents.focusEvent + 0);
        writeStringToMemory(id, JSEvents.focusEvent + 128);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.focusEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    tick: (function() {
      if (window['performance'] && window['performance']['now']) return window['performance']['now']();
      else return Date.now();
    }),

    registerDeviceOrientationEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.deviceOrientationEvent) {
        JSEvents.deviceOrientationEvent = _malloc(40);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        HEAPF64[JSEvents.deviceOrientationEvent >> 3] = JSEvents.tick();
        HEAPF64[JSEvents.deviceOrientationEvent + 8 >> 3] = e.alpha;
        HEAPF64[JSEvents.deviceOrientationEvent + 16 >> 3] = e.beta;
        HEAPF64[JSEvents.deviceOrientationEvent + 24 >> 3] = e.gamma;
        HEAP32[JSEvents.deviceOrientationEvent + 32 >> 2] = e.absolute;
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.deviceOrientationEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    registerDeviceMotionEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.deviceMotionEvent) {
        JSEvents.deviceMotionEvent = _malloc(80);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        HEAPF64[JSEvents.deviceOrientationEvent >> 3] = JSEvents.tick();
        HEAPF64[JSEvents.deviceMotionEvent + 8 >> 3] = e.acceleration.x;
        HEAPF64[JSEvents.deviceMotionEvent + 16 >> 3] = e.acceleration.y;
        HEAPF64[JSEvents.deviceMotionEvent + 24 >> 3] = e.acceleration.z;
        HEAPF64[JSEvents.deviceMotionEvent + 32 >> 3] = e.accelerationIncludingGravity.x;
        HEAPF64[JSEvents.deviceMotionEvent + 40 >> 3] = e.accelerationIncludingGravity.y;
        HEAPF64[JSEvents.deviceMotionEvent + 48 >> 3] = e.accelerationIncludingGravity.z;
        HEAPF64[JSEvents.deviceMotionEvent + 56 >> 3] = e.rotationRate.alpha;
        HEAPF64[JSEvents.deviceMotionEvent + 64 >> 3] = e.rotationRate.beta;
        HEAPF64[JSEvents.deviceMotionEvent + 72 >> 3] = e.rotationRate.gamma;
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.deviceMotionEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    screenOrientation: (function() {
      if (!window.screen) return undefined;
      return window.screen.orientation || window.screen.webkitOrientation;
    }),

    fillOrientationChangeEventData: (function(eventStruct, e) {
      var orientations = ['portrait-primary', 'portrait-secondary', 'landscape-primary', 'landscape-secondary'];
      var orientations2 = ['portrait', 'portrait', 'landscape', 'landscape'];
      var orientationString = JSEvents.screenOrientation();
      var orientation = orientations.indexOf(orientationString);
      if (orientation == -1) {
        orientation = orientations2.indexOf(orientationString);
      }

      HEAP32[eventStruct >> 2] = 1 << orientation;
      HEAP32[eventStruct + 4 >> 2] = window.orientation;
    }),

    registerOrientationChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.orientationChangeEvent) {
        JSEvents.orientationChangeEvent = _malloc(8);
      }

      if (!target) {
        target = window.screen;
      } else {
        target = JSEvents.findEventTarget(target);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillOrientationChangeEventData(JSEvents.orientationChangeEvent, e);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.orientationChangeEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    fullscreenEnabled: (function() {
      return document.fullscreenEnabled || document.webkitFullscreenEnabled;
    }),

    fillFullscreenChangeEventData: (function(eventStruct, e) {
      var fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      var isFullscreen = !!fullscreenElement;
      HEAP32[eventStruct >> 2] = isFullscreen;
      HEAP32[eventStruct + 4 >> 2] = JSEvents.fullscreenEnabled();
      var reportedElement = isFullscreen ? fullscreenElement : JSEvents.previousFullscreenElement;
      var nodeName = JSEvents.getNodeNameForTarget(reportedElement);
      var id = reportedElement && reportedElement.id ? reportedElement.id : '';
      writeStringToMemory(nodeName, eventStruct + 8);
      writeStringToMemory(id, eventStruct + 136);
      HEAP32[eventStruct + 264 >> 2] = reportedElement ? reportedElement.clientWidth : 0;
      HEAP32[eventStruct + 268 >> 2] = reportedElement ? reportedElement.clientHeight : 0;
      HEAP32[eventStruct + 272 >> 2] = screen.width;
      HEAP32[eventStruct + 276 >> 2] = screen.height;
      if (isFullscreen) {
        JSEvents.previousFullscreenElement = fullscreenElement;
      }
    }),

    registerFullscreenChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.fullscreenChangeEvent) {
        JSEvents.fullscreenChangeEvent = _malloc(280);
      }

      if (!target) {
        target = document;
      } else {
        target = JSEvents.findEventTarget(target);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillFullscreenChangeEventData(JSEvents.fullscreenChangeEvent, e);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.fullscreenChangeEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    resizeCanvasForFullscreen: (function(target, strategy) {
      var restoreOldStyle = __registerRestoreOldStyle(target);
      var cssWidth = strategy.softFullscreen ? window.innerWidth : screen.width;
      var cssHeight = strategy.softFullscreen ? window.innerHeight : screen.height;
      var rect = target.getBoundingClientRect();
      var windowedCssWidth = rect.right - rect.left;
      var windowedCssHeight = rect.bottom - rect.top;
      var windowedRttWidth = target.width;
      var windowedRttHeight = target.height;
      if (strategy.scaleMode == 3) {
        __setLetterbox(target, (cssHeight - windowedCssHeight) / 2, (cssWidth - windowedCssWidth) / 2);
        cssWidth = windowedCssWidth;
        cssHeight = windowedCssHeight;
      } else if (strategy.scaleMode == 2) {
        if (cssWidth * windowedRttHeight < windowedRttWidth * cssHeight) {
          var desiredCssHeight = windowedRttHeight * cssWidth / windowedRttWidth;
          __setLetterbox(target, (cssHeight - desiredCssHeight) / 2, 0);
          cssHeight = desiredCssHeight;
        } else {
          var desiredCssWidth = windowedRttWidth * cssHeight / windowedRttHeight;
          __setLetterbox(target, 0, (cssWidth - desiredCssWidth) / 2);
          cssWidth = desiredCssWidth;
        }
      }

      if (!target.style.backgroundColor) target.style.backgroundColor = 'black';
      if (!document.body.style.backgroundColor) document.body.style.backgroundColor = 'black';
      target.style.width = cssWidth + 'px';
      target.style.height = cssHeight + 'px';
      if (strategy.filteringMode == 1) {
        target.style.imageRendering = 'optimizeSpeed';
        target.style.imageRendering = '-webkit-optimize-contrast';
        target.style.imageRendering = 'optimize-contrast';
        target.style.imageRendering = 'crisp-edges';
        target.style.imageRendering = 'pixelated';
      }

      var dpiScale = strategy.canvasResolutionScaleMode == 2 ? window.devicePixelRatio : 1;
      if (strategy.canvasResolutionScaleMode != 0) {
        target.width = cssWidth * dpiScale;
        target.height = cssHeight * dpiScale;
        if (target.GLctxObject) target.GLctxObject.GLctx.viewport(0, 0, target.width, target.height);
      }

      return restoreOldStyle;
    }),

    requestFullscreen: (function(target, strategy) {
      if (strategy.scaleMode != 0 || strategy.canvasResolutionScaleMode != 0) {
        JSEvents.resizeCanvasForFullscreen(target, strategy);
      }

      if (target.requestFullscreen) {
        target.requestFullscreen();
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
      } else {
        if (typeof JSEvents.fullscreenEnabled() === 'undefined') {
          return -1;
        } else {
          return -3;
        }
      }

      if (strategy.canvasResizedCallback) {
        Runtime.dynCall('iiii', strategy.canvasResizedCallback, [37, 0, strategy.canvasResizedCallbackUserData]);
      }

      return 0;
    }),

    fillPointerlockChangeEventData: (function(eventStruct, e) {
      var pointerLockElement = document.pointerLockElement || document.webkitPointerLockElement;
      var isPointerlocked = !!pointerLockElement;
      HEAP32[eventStruct >> 2] = isPointerlocked;
      var nodeName = JSEvents.getNodeNameForTarget(pointerLockElement);
      var id = pointerLockElement && pointerLockElement.id ? pointerLockElement.id : '';
      writeStringToMemory(nodeName, eventStruct + 4);
      writeStringToMemory(id, eventStruct + 132);
    }),

    registerPointerlockChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.pointerlockChangeEvent) {
        JSEvents.pointerlockChangeEvent = _malloc(260);
      }

      if (!target) {
        target = document;
      } else {
        target = JSEvents.findEventTarget(target);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillPointerlockChangeEventData(JSEvents.pointerlockChangeEvent, e);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.pointerlockChangeEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    requestPointerLock: (function(target) {
      if (target.requestPointerLock) {
        target.requestPointerLock();
      } else if (target.webkitRequestPointerLock) {
        target.webkitRequestPointerLock();
      } else {
        if (document.body.requestPointerLock || document.body.webkitRequestPointerLock) {
          return -3;
        } else {
          return -1;
        }
      }

      return 0;
    }),

    fillVisibilityChangeEventData: (function(eventStruct, e) {
      var visibilityStates = ['hidden', 'visible', 'prerender', 'unloaded'];
      var visibilityState = visibilityStates.indexOf(document.visibilityState);
      HEAP32[eventStruct >> 2] = document.hidden;
      HEAP32[eventStruct + 4 >> 2] = visibilityState;
    }),

    registerVisibilityChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.visibilityChangeEvent) {
        JSEvents.visibilityChangeEvent = _malloc(8);
      }

      if (!target) {
        target = document;
      } else {
        target = JSEvents.findEventTarget(target);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillVisibilityChangeEventData(JSEvents.visibilityChangeEvent, e);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.visibilityChangeEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    registerTouchEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.touchEvent) {
        JSEvents.touchEvent = _malloc(1684);
      }

      target = JSEvents.findEventTarget(target);
      var handlerFunc = (function(event) {
        var e = event || window.event;
        var touches = {};
        for (var i = 0; i < e.touches.length; ++i) {
          var touch = e.touches[i];
          touches[touch.identifier] = touch;
        }

        for (var i = 0; i < e.changedTouches.length; ++i) {
          var touch = e.changedTouches[i];
          touches[touch.identifier] = touch;
          touch.changed = true;
        }

        for (var i = 0; i < e.targetTouches.length; ++i) {
          var touch = e.targetTouches[i];
          touches[touch.identifier].onTarget = true;
        }

        var ptr = JSEvents.touchEvent;
        HEAP32[ptr + 4 >> 2] = e.ctrlKey;
        HEAP32[ptr + 8 >> 2] = e.shiftKey;
        HEAP32[ptr + 12 >> 2] = e.altKey;
        HEAP32[ptr + 16 >> 2] = e.metaKey;
        ptr += 20;
        var canvasRect = Module['canvas'] ? Module['canvas'].getBoundingClientRect() : undefined;
        var targetRect = JSEvents.getBoundingClientRectOrZeros(target);
        var numTouches = 0;
        for (var i in touches) {
          var t = touches[i];
          HEAP32[ptr >> 2] = t.identifier;
          HEAP32[ptr + 4 >> 2] = t.screenX;
          HEAP32[ptr + 8 >> 2] = t.screenY;
          HEAP32[ptr + 12 >> 2] = t.clientX;
          HEAP32[ptr + 16 >> 2] = t.clientY;
          HEAP32[ptr + 20 >> 2] = t.pageX;
          HEAP32[ptr + 24 >> 2] = t.pageY;
          HEAP32[ptr + 28 >> 2] = t.changed;
          HEAP32[ptr + 32 >> 2] = t.onTarget;
          if (canvasRect) {
            HEAP32[ptr + 44 >> 2] = t.clientX - canvasRect.left;
            HEAP32[ptr + 48 >> 2] = t.clientY - canvasRect.top;
          } else {
            HEAP32[ptr + 44 >> 2] = 0;
            HEAP32[ptr + 48 >> 2] = 0;
          }

          HEAP32[ptr + 36 >> 2] = t.clientX - targetRect.left;
          HEAP32[ptr + 40 >> 2] = t.clientY - targetRect.top;
          ptr += 52;
          if (++numTouches >= 32) {
            break;
          }
        }

        HEAP32[JSEvents.touchEvent >> 2] = numTouches;
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.touchEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: target,
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    fillGamepadEventData: (function(eventStruct, e) {
      HEAPF64[eventStruct >> 3] = e.timestamp;
      for (var i = 0; i < e.axes.length; ++i) {
        HEAPF64[eventStruct + i * 8 + 16 >> 3] = e.axes[i];
      }

      for (var i = 0; i < e.buttons.length; ++i) {
        if (typeof e.buttons[i] === 'object') {
          HEAPF64[eventStruct + i * 8 + 528 >> 3] = e.buttons[i].value;
        } else {
          HEAPF64[eventStruct + i * 8 + 528 >> 3] = e.buttons[i];
        }
      }

      for (var i = 0; i < e.buttons.length; ++i) {
        if (typeof e.buttons[i] === 'object') {
          HEAP32[eventStruct + i * 4 + 1040 >> 2] = e.buttons[i].pressed;
        } else {
          HEAP32[eventStruct + i * 4 + 1040 >> 2] = e.buttons[i] == 1;
        }
      }

      HEAP32[eventStruct + 1296 >> 2] = e.connected;
      HEAP32[eventStruct + 1300 >> 2] = e.index;
      HEAP32[eventStruct + 8 >> 2] = e.axes.length;
      HEAP32[eventStruct + 12 >> 2] = e.buttons.length;
      writeStringToMemory(e.id, eventStruct + 1304);
      writeStringToMemory(e.mapping, eventStruct + 1368);
    }),

    registerGamepadEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.gamepadEvent) {
        JSEvents.gamepadEvent = _malloc(1432);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillGamepadEventData(JSEvents.gamepadEvent, e.gamepad);
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.gamepadEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: true,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    registerBeforeUnloadEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      var handlerFunc = (function(event) {
        var e = event || window.event;
        var confirmationMessage = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, 0, userData]);
        if (confirmationMessage) {
          confirmationMessage = Pointer_stringify(confirmationMessage);
        }

        if (confirmationMessage) {
          e.preventDefault();
          e.returnValue = confirmationMessage;
          return confirmationMessage;
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    battery: (function() {
      return navigator.battery || navigator.webkitBattery;
    }),

    fillBatteryEventData: (function(eventStruct, e) {
      HEAPF64[eventStruct >> 3] = e.chargingTime;
      HEAPF64[eventStruct + 8 >> 3] = e.dischargingTime;
      HEAPF64[eventStruct + 16 >> 3] = e.level;
      HEAP32[eventStruct + 24 >> 2] = e.charging;
    }),

    registerBatteryEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!JSEvents.batteryEvent) {
        JSEvents.batteryEvent = _malloc(32);
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        JSEvents.fillBatteryEventData(JSEvents.batteryEvent, JSEvents.battery());
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, JSEvents.batteryEvent, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    }),

    registerWebGlEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
      if (!target) {
        target = Module['canvas'];
      }

      var handlerFunc = (function(event) {
        var e = event || window.event;
        var shouldCancel = Runtime.dynCall('iiii', callbackfunc, [eventTypeId, 0, userData]);
        if (shouldCancel) {
          e.preventDefault();
        }
      });

      var eventHandler = {
        target: JSEvents.findEventTarget(target),
        allowsDeferredCalls: false,
        eventTypeString: eventTypeString,
        callbackfunc: callbackfunc,
        handlerFunc: handlerFunc,
        useCapture: useCapture
      };
      JSEvents.registerOrRemoveHandler(eventHandler);
    })
  };

  function _emscripten_set_visibilitychange_callback(userData, useCapture, callbackfunc) {
    JSEvents.registerVisibilityChangeEventCallback(document, userData, useCapture, callbackfunc, 21, 'visibilitychange');
    return 0;
  }

  var GL = {
    counter: 1,
    lastError: 0,
    buffers: [],
    mappedBuffers: {},
    programs: [],
    framebuffers: [],
    renderbuffers: [],
    textures: [],
    uniforms: [],
    shaders: [],
    vaos: [],
    contexts: [],
    byteSizeByTypeRoot: 5120,
    byteSizeByType: [1, 1, 2, 2, 4, 4, 4, 2, 3, 4, 8],
    programInfos: {},
    stringCache: {},
    packAlignment: 4,
    unpackAlignment: 4,
    init: (function() {
      GL.miniTempBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
      for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
        GL.miniTempBufferViews[i] = GL.miniTempBuffer.subarray(0, i + 1);
      }
    }),

    recordError: function recordError(errorCode) {
      if (!GL.lastError) {
        GL.lastError = errorCode;
      }
    },

    getNewId: (function(table) {
      var ret = GL.counter++;
      for (var i = table.length; i < ret; i++) {
        table[i] = null;
      }

      return ret;
    }),

    MINI_TEMP_BUFFER_SIZE: 16,
    miniTempBuffer: null,
    miniTempBufferViews: [0],
    getSource: (function(shader, count, string, length) {
      var source = '';
      for (var i = 0; i < count; ++i) {
        var frag;
        if (length) {
          var len = HEAP32[length + i * 4 >> 2];
          if (len < 0) {
            frag = Pointer_stringify(HEAP32[string + i * 4 >> 2]);
          } else {
            frag = Pointer_stringify(HEAP32[string + i * 4 >> 2], len);
          }
        } else {
          frag = Pointer_stringify(HEAP32[string + i * 4 >> 2]);
        }

        source += frag;
      }

      return source;
    }),

    computeImageSize: (function(width, height, sizePerPixel, alignment) {
      function roundedToNextMultipleOf(x, y) {
        return Math.floor((x + y - 1) / y) * y;
      }

      var plainRowSize = width * sizePerPixel;
      var alignedRowSize = roundedToNextMultipleOf(plainRowSize, alignment);
      return height <= 0 ? 0 : (height - 1) * alignedRowSize + plainRowSize;
    }),

    get: (function(name_, p, type) {
      if (!p) {
        GL.recordError(1281);
        return;
      }

      var ret = undefined;
      switch (name_) {
        case 36346:
          ret = 1;
          break;
        case 36344:
          if (type !== 'Integer') {
            GL.recordError(1280);
          }

          return;
        case 36345:
          ret = 0;
          break;
        case 34466:
          var formats = GLctx.getParameter(34467);
          ret = formats.length;
          break;
        case 35738:
          ret = 5121;
          break;
        case 35739:
          ret = 6408;
          break;
      }
      if (ret === undefined) {
        var result = GLctx.getParameter(name_);
        switch (typeof result) {
          case 'number':
            ret = result;
            break;
          case 'boolean':
            ret = result ? 1 : 0;
            break;
          case 'string':
            GL.recordError(1280);
            return;
          case 'object':
            if (result === null) {
              switch (name_) {
                case 34964:
                case 35725:
                case 34965:
                case 36006:
                case 36007:
                case 32873:
                case 34068:
                  {
                    ret = 0;
                    break;
                  }

                default:
                  {
                    GL.recordError(1280);
                    return;
                  }
              }
            } else if (result instanceof Float32Array || result instanceof Uint32Array || result instanceof Int32Array || result instanceof Array) {
              for (var i = 0; i < result.length; ++i) {
                switch (type) {
                  case 'Integer':
                    HEAP32[p + i * 4 >> 2] = result[i];
                    break;
                  case 'Float':
                    HEAPF32[p + i * 4 >> 2] = result[i];
                    break;
                  case 'Boolean':
                    HEAP8[p + i >> 0] = result[i] ? 1 : 0;
                    break;
                  default:
                    throw 'internal glGet error, bad type: ' + type;
                }
              }

              return;
            } else if (result instanceof WebGLBuffer || result instanceof WebGLProgram || result instanceof WebGLFramebuffer || result instanceof WebGLRenderbuffer || result instanceof WebGLTexture) {
              ret = result.name | 0;
            } else {
              GL.recordError(1280);
              return;
            }

            break;
          default:
            GL.recordError(1280);
            return;
        }
      }

      switch (type) {
        case 'Integer':
          HEAP32[p >> 2] = ret;
          break;
        case 'Float':
          HEAPF32[p >> 2] = ret;
          break;
        case 'Boolean':
          HEAP8[p >> 0] = ret ? 1 : 0;
          break;
        default:
          throw 'internal glGet error, bad type: ' + type;
      }
    }),

    getTexPixelData: (function(type, format, width, height, pixels, internalFormat) {
      var sizePerPixel;
      var numChannels;
      switch (format) {
        case 6406:
        case 6409:
        case 6402:
          numChannels = 1;
          break;
        case 6410:
        case 33319:
          numChannels = 2;
          break;
        case 6407:
          numChannels = 3;
          break;
        case 6408:
          numChannels = 4;
          break;
        default:
          GL.recordError(1280);
          return {
            pixels: null,
            internalFormat: 0
          };
      }
      switch (type) {
        case 5121:
          sizePerPixel = numChannels * 1;
          break;
        case 5123:
        case 36193:
          sizePerPixel = numChannels * 2;
          break;
        case 5125:
        case 5126:
          sizePerPixel = numChannels * 4;
          break;
        case 34042:
          sizePerPixel = 4;
          break;
        case 33635:
        case 32819:
        case 32820:
          sizePerPixel = 2;
          break;
        default:
          GL.recordError(1280);
          return {
            pixels: null,
            internalFormat: 0
          };
      }
      var bytes = GL.computeImageSize(width, height, sizePerPixel, GL.unpackAlignment);
      if (type == 5121) {
        pixels = HEAPU8.subarray(pixels, pixels + bytes);
      } else if (type == 5126) {
        pixels = HEAPF32.subarray(pixels >> 2, pixels + bytes >> 2);
      } else if (type == 5125 || type == 34042) {
        pixels = HEAPU32.subarray(pixels >> 2, pixels + bytes >> 2);
      } else {
        pixels = HEAPU16.subarray(pixels >> 1, pixels + bytes >> 1);
      }

      return {
        pixels: pixels,
        internalFormat: internalFormat
      };
    }),

    validateBufferTarget: (function(target) {
      switch (target) {
        case 34962:
        case 34963:
        case 36662:
        case 36663:
        case 35051:
        case 35052:
        case 35882:
        case 35982:
        case 35345:
          return true;
        default:
          return false;
      }
    }),

    createContext: (function(canvas, webGLContextAttributes) {
      if (typeof webGLContextAttributes.majorVersion === 'undefined' && typeof webGLContextAttributes.minorVersion === 'undefined') {
        webGLContextAttributes.majorVersion = 1;
        webGLContextAttributes.minorVersion = 0;
      }

      var ctx;
      var errorInfo = '?';

      function onContextCreationError(event) {
        errorInfo = event.statusMessage || errorInfo;
      }

      try {
        canvas.addEventListener('webglcontextcreationerror', onContextCreationError, false);
        try {
          if (webGLContextAttributes.majorVersion == 1 && webGLContextAttributes.minorVersion == 0) {
            ctx = canvas.getContext('webgl', webGLContextAttributes) || canvas.getContext('experimental-webgl', webGLContextAttributes);
          } else if (webGLContextAttributes.majorVersion == 2 && webGLContextAttributes.minorVersion == 0) {
            ctx = canvas.getContext('webgl2', webGLContextAttributes) || canvas.getContext('experimental-webgl2', webGLContextAttributes);
          } else {
            throw 'Unsupported WebGL context version ' + majorVersion + '.' + minorVersion + '!';
          }
        } finally {
          canvas.removeEventListener('webglcontextcreationerror', onContextCreationError, false);
        }

        if (!ctx) throw ':(';
      } catch (e) {
        Module.print('Could not create canvas: ' + [errorInfo, e, JSON.stringify(webGLContextAttributes)]);
        return 0;
      }
      if (!ctx) return 0;
      return GL.registerContext(ctx, webGLContextAttributes);
    }),

    registerContext: (function(ctx, webGLContextAttributes) {
      var handle = GL.getNewId(GL.contexts);
      var context = {
        handle: handle,
        version: webGLContextAttributes.majorVersion,
        GLctx: ctx
      };
      if (ctx.canvas) ctx.canvas.GLctxObject = context;
      GL.contexts[handle] = context;
      if (typeof webGLContextAttributes['enableExtensionsByDefault'] === 'undefined' || webGLContextAttributes.enableExtensionsByDefault) {
        GL.initExtensions(context);
      }

      return handle;
    }),

    makeContextCurrent: (function(contextHandle) {
      var context = GL.contexts[contextHandle];
      if (!context) return false;
      GLctx = Module.ctx = context.GLctx;
      GL.currentContext = context;
      return true;
    }),

    getContext: (function(contextHandle) {
      return GL.contexts[contextHandle];
    }),

    deleteContext: (function(contextHandle) {
      if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = 0;
      if (typeof JSEvents === 'object') JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].canvas);
      if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined;
      GL.contexts[contextHandle] = null;
    }),

    initExtensions: (function(context) {
      if (!context) context = GL.currentContext;
      if (context.initExtensionsDone) return;
      context.initExtensionsDone = true;
      var GLctx = context.GLctx;
      context.maxVertexAttribs = GLctx.getParameter(GLctx.MAX_VERTEX_ATTRIBS);
      context.compressionExt = GLctx.getExtension('WEBGL_compressed_texture_s3tc') || GLctx.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc');
      context.anisotropicExt = GLctx.getExtension('EXT_texture_filter_anisotropic') || GLctx.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      context.floatExt = GLctx.getExtension('OES_texture_float');
      context.instancedArraysExt = GLctx.getExtension('ANGLE_instanced_arrays');
      context.vaoExt = GLctx.getExtension('OES_vertex_array_object');
      if (context.version === 2) {
        context.drawBuffersExt = (function(n, bufs) {
          GLctx.drawBuffers(n, bufs);
        });
      } else {
        var ext = GLctx.getExtension('WEBGL_draw_buffers');
        if (ext) {
          context.drawBuffersExt = (function(n, bufs) {
            ext.drawBuffersWEBGL(n, bufs);
          });
        }
      }

      var automaticallyEnabledExtensions = ['OES_texture_float', 'OES_texture_half_float', 'OES_standard_derivatives', 'OES_vertex_array_object', 'WEBGL_compressed_texture_s3tc', 'WEBGL_depth_texture', 'OES_element_index_uint', 'EXT_texture_filter_anisotropic', 'ANGLE_instanced_arrays', 'OES_texture_float_linear', 'OES_texture_half_float_linear', 'WEBGL_compressed_texture_atc', 'WEBGL_compressed_texture_pvrtc', 'EXT_color_buffer_half_float', 'WEBGL_color_buffer_float', 'EXT_frag_depth', 'EXT_sRGB', 'WEBGL_draw_buffers', 'WEBGL_shared_resources', 'EXT_shader_texture_lod'];

      function shouldEnableAutomatically(extension) {
        var ret = false;
        automaticallyEnabledExtensions.forEach((function(include) {
          if (ext.indexOf(include) != -1) {
            ret = true;
          }
        }));

        return ret;
      }

      GLctx.getSupportedExtensions().forEach((function(ext) {
        ext = ext.replace('MOZ_', '').replace('WEBKIT_', '');
        if (automaticallyEnabledExtensions.indexOf(ext) != -1) {
          GLctx.getExtension(ext);
        }
      }));
    }),

    populateUniformTable: (function(program) {
      var p = GL.programs[program];
      GL.programInfos[program] = {
        uniforms: {},
        maxUniformLength: 0,
        maxAttributeLength: -1
      };
      var ptable = GL.programInfos[program];
      var utable = ptable.uniforms;
      var numUniforms = GLctx.getProgramParameter(p, GLctx.ACTIVE_UNIFORMS);
      for (var i = 0; i < numUniforms; ++i) {
        var u = GLctx.getActiveUniform(p, i);
        var name = u.name;
        ptable.maxUniformLength = Math.max(ptable.maxUniformLength, name.length + 1);
        if (name.indexOf(']', name.length - 1) !== -1) {
          var ls = name.lastIndexOf('[');
          name = name.slice(0, ls);
        }

        var loc = GLctx.getUniformLocation(p, name);
        var id = GL.getNewId(GL.uniforms);
        utable[name] = [u.size, id];
        GL.uniforms[id] = loc;
        for (var j = 1; j < u.size; ++j) {
          var n = name + '[' + j + ']';
          loc = GLctx.getUniformLocation(p, n);
          id = GL.getNewId(GL.uniforms);
          GL.uniforms[id] = loc;
        }
      }
    })
  };

  function _emscripten_glIsRenderbuffer(renderbuffer) {
    var rb = GL.renderbuffers[renderbuffer];
    if (!rb) return 0;
    return GLctx.isRenderbuffer(rb);
  }

  var DLFCN = {
    error: null,
    errorMsg: null,
    loadedLibs: {},
    loadedLibNames: {}
  };

  function _dlsym(handle, symbol) {
    symbol = '_' + Pointer_stringify(symbol);
    if (!DLFCN.loadedLibs[handle]) {
      DLFCN.errorMsg = 'Tried to dlsym() from an unopened handle: ' + handle;
      return 0;
    } else {
      var lib = DLFCN.loadedLibs[handle];
      if (lib.cached_functions.hasOwnProperty(symbol)) {
        return lib.cached_functions[symbol];
      } else {
        if (!lib.module.hasOwnProperty(symbol)) {
          DLFCN.errorMsg = 'Tried to lookup unknown symbol "' + symbol + '" in dynamic lib: ' + lib.name;
          return 0;
        } else {
          var result = lib.module[symbol];
          if (typeof result == 'function') {
            result = lib.module.SYMBOL_TABLE[symbol];
            assert(result);
            lib.cached_functions = result;
          }

          return result;
        }
      }
    }
  }

  var _DtoILow = true;
  var _UItoD = true;

  function _emscripten_glStencilMaskSeparate(x0, x1) {
    GLctx.stencilMaskSeparate(x0, x1);
  }

  var ERRNO_CODES = require('./error');
  var ERRNO_MESSAGES = require('./message');
  var ___errno_state = 0;

  function ___setErrNo(value) {
    HEAP32[___errno_state >> 2] = value;
    return value;
  }

  var PATH = {
    splitPath: (function(filename) {
      var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
      return splitPathRe.exec(filename).slice(1);
    }),

    normalizeArray: (function(parts, allowAboveRoot) {
      var up = 0;
      for (var i = parts.length - 1; i >= 0; i--) {
        var last = parts[i];
        if (last === '.') {
          parts.splice(i, 1);
        } else if (last === '..') {
          parts.splice(i, 1);
          up++;
        } else if (up) {
          parts.splice(i, 1);
          up--;
        }
      }

      if (allowAboveRoot) {
        for (; up--; up) {
          parts.unshift('..');
        }
      }

      return parts;
    }),

    normalize: (function(path) {
      var isAbsolute = path.charAt(0) === '/',
        trailingSlash = path.substr(-1) === '/';
      path = PATH.normalizeArray(path.split('/').filter((function(p) {
        return !!p;
      })), !isAbsolute).join('/');
      if (!path && !isAbsolute) {
        path = '.';
      }

      if (path && trailingSlash) {
        path += '/';
      }

      return (isAbsolute ? '/' : '') + path;
    }),

    dirname: (function(path) {
      var result = PATH.splitPath(path),
        root = result[0],
        dir = result[1];
      if (!root && !dir) {
        return '.';
      }

      if (dir) {
        dir = dir.substr(0, dir.length - 1);
      }

      return root + dir;
    }),

    basename: (function(path) {
      if (path === '/') return '/';
      var lastSlash = path.lastIndexOf('/');
      if (lastSlash === -1) return path;
      return path.substr(lastSlash + 1);
    }),

    extname: (function(path) {
      return PATH.splitPath(path)[3];
    }),

    join: (function() {
      var paths = Array.prototype.slice.call(arguments, 0);
      return PATH.normalize(paths.join('/'));
    }),

    join2: (function(l, r) {
      return PATH.normalize(l + '/' + r);
    }),

    resolve: (function() {
      var resolvedPath = '',
        resolvedAbsolute = false;
      for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path = i >= 0 ? arguments[i] : FS.cwd();
        if (typeof path !== 'string') {
          throw new TypeError('Arguments to path.resolve must be strings');
        } else if (!path) {
          return '';
        }

        resolvedPath = path + '/' + resolvedPath;
        resolvedAbsolute = path.charAt(0) === '/';
      }

      resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter((function(p) {
        return !!p;
      })), !resolvedAbsolute).join('/');
      return (resolvedAbsolute ? '/' : '') + resolvedPath || '.';
    }),

    relative: (function(from, to) {
      from = PATH.resolve(from).substr(1);
      to = PATH.resolve(to).substr(1);

      function trim(arr) {
        var start = 0;
        for (; start < arr.length; start++) {
          if (arr[start] !== '') break;
        }

        var end = arr.length - 1;
        for (; end >= 0; end--) {
          if (arr[end] !== '') break;
        }

        if (start > end) return [];
        return arr.slice(start, end - start + 1);
      }

      var fromParts = trim(from.split('/'));
      var toParts = trim(to.split('/'));
      var length = Math.min(fromParts.length, toParts.length);
      var samePartsLength = length;
      for (var i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i;
          break;
        }
      }

      var outputParts = [];
      for (var i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..');
      }

      outputParts = outputParts.concat(toParts.slice(samePartsLength));
      return outputParts.join('/');
    })
  };
  var TTY = {
    ttys: [],
    init: (function() {}),

    shutdown: (function() {}),

    register: (function(dev, ops) {
      TTY.ttys[dev] = {
        input: [],
        output: [],
        ops: ops
      };
      FS.registerDevice(dev, TTY.stream_ops);
    }),

    stream_ops: {
      open: (function(stream) {
        var tty = TTY.ttys[stream.node.rdev];
        if (!tty) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }

        stream.tty = tty;
        stream.seekable = false;
      }),

      close: (function(stream) {
        stream.tty.ops.flush(stream.tty);
      }),

      flush: (function(stream) {
        stream.tty.ops.flush(stream.tty);
      }),

      read: (function(stream, buffer, offset, length, pos) {
        if (!stream.tty || !stream.tty.ops.get_char) {
          throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
        }

        var bytesRead = 0;
        for (var i = 0; i < length; i++) {
          var result;
          try {
            result = stream.tty.ops.get_char(stream.tty);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }
          if (result === undefined && bytesRead === 0) {
            throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
          }

          if (result === null || result === undefined) break;
          bytesRead++;
          buffer[offset + i] = result;
        }

        if (bytesRead) {
          stream.node.timestamp = Date.now();
        }

        return bytesRead;
      }),

      write: (function(stream, buffer, offset, length, pos) {
        if (!stream.tty || !stream.tty.ops.put_char) {
          throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
        }

        for (var i = 0; i < length; i++) {
          try {
            stream.tty.ops.put_char(stream.tty, buffer[offset + i]);
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }
        }

        if (length) {
          stream.node.timestamp = Date.now();
        }

        return i;
      })
    },
    default_tty_ops: {
      get_char: (function(tty) {
        if (!tty.input.length) {
          var result = null;
          result = window.prompt('Input: ');
          if (result !== null) {
            result += '\n';
          }

          if (!result) {
            return null;
          }

          tty.input = intArrayFromString(result, true);
        }

        return tty.input.shift();
      }),

      put_char: (function(tty, val) {
        if (val === null || val === 10) {
          Module['print'](UTF8ArrayToString(tty.output, 0));
          tty.output = [];
        } else {
          if (val != 0) tty.output.push(val);
        }
      }),

      flush: (function(tty) {
        if (tty.output && tty.output.length > 0) {
          Module['print'](UTF8ArrayToString(tty.output, 0));
          tty.output = [];
        }
      })
    },
    default_tty1_ops: {
      put_char: (function(tty, val) {
        if (val === null || val === 10) {
          Module['printErr'](UTF8ArrayToString(tty.output, 0));
          tty.output = [];
        } else {
          if (val != 0) tty.output.push(val);
        }
      }),

      flush: (function(tty) {
        if (tty.output && tty.output.length > 0) {
          Module['printErr'](UTF8ArrayToString(tty.output, 0));
          tty.output = [];
        }
      })
    }
  };
  var MEMFS = {
    ops_table: null,
    mount: (function(mount) {
      return MEMFS.createNode(null, '/', 16384 | 511, 0);
    }),

    createNode: (function(parent, name, mode, dev) {
      if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (!MEMFS.ops_table) {
        MEMFS.ops_table = {
          dir: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              lookup: MEMFS.node_ops.lookup,
              mknod: MEMFS.node_ops.mknod,
              rename: MEMFS.node_ops.rename,
              unlink: MEMFS.node_ops.unlink,
              rmdir: MEMFS.node_ops.rmdir,
              readdir: MEMFS.node_ops.readdir,
              symlink: MEMFS.node_ops.symlink
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek
            }
          },
          file: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek,
              read: MEMFS.stream_ops.read,
              write: MEMFS.stream_ops.write,
              allocate: MEMFS.stream_ops.allocate,
              mmap: MEMFS.stream_ops.mmap
            }
          },
          link: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              readlink: MEMFS.node_ops.readlink
            },
            stream: {}
          },
          chrdev: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: FS.chrdev_stream_ops
          }
        };
      }

      var node = FS.createNode(parent, name, mode, dev);
      if (FS.isDir(node.mode)) {
        node.node_ops = MEMFS.ops_table.dir.node;
        node.stream_ops = MEMFS.ops_table.dir.stream;
        node.contents = {};
      } else if (FS.isFile(node.mode)) {
        node.node_ops = MEMFS.ops_table.file.node;
        node.stream_ops = MEMFS.ops_table.file.stream;
        node.usedBytes = 0;
        node.contents = null;
      } else if (FS.isLink(node.mode)) {
        node.node_ops = MEMFS.ops_table.link.node;
        node.stream_ops = MEMFS.ops_table.link.stream;
      } else if (FS.isChrdev(node.mode)) {
        node.node_ops = MEMFS.ops_table.chrdev.node;
        node.stream_ops = MEMFS.ops_table.chrdev.stream;
      }

      node.timestamp = Date.now();
      if (parent) {
        parent.contents[name] = node;
      }

      return node;
    }),

    getFileDataAsRegularArray: (function(node) {
      if (node.contents && node.contents.subarray) {
        var arr = [];
        for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
        return arr;
      }

      return node.contents;
    }),

    getFileDataAsTypedArray: (function(node) {
      if (!node.contents) return new Uint8Array;
      if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes);
      return new Uint8Array(node.contents);
    }),

    expandFileStorage: (function(node, newCapacity) {
      if (node.contents && node.contents.subarray && newCapacity > node.contents.length) {
        node.contents = MEMFS.getFileDataAsRegularArray(node);
        node.usedBytes = node.contents.length;
      }

      if (!node.contents || node.contents.subarray) {
        var prevCapacity = node.contents ? node.contents.buffer.byteLength : 0;
        if (prevCapacity >= newCapacity) return;
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) | 0);
        if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256);
        var oldContents = node.contents;
        node.contents = new Uint8Array(newCapacity);
        if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
        return;
      }

      if (!node.contents && newCapacity > 0) node.contents = [];
      while (node.contents.length < newCapacity) node.contents.push(0);
    }),

    resizeFileStorage: (function(node, newSize) {
      if (node.usedBytes == newSize) return;
      if (newSize == 0) {
        node.contents = null;
        node.usedBytes = 0;
        return;
      }

      if (!node.contents || node.contents.subarray) {
        var oldContents = node.contents;
        node.contents = new Uint8Array(new ArrayBuffer(newSize));
        if (oldContents) {
          node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
        }

        node.usedBytes = newSize;
        return;
      }

      if (!node.contents) node.contents = [];
      if (node.contents.length > newSize) node.contents.length = newSize;
      else
        while (node.contents.length < newSize) node.contents.push(0);
      node.usedBytes = newSize;
    }),

    node_ops: {
      getattr: (function(node) {
        var attr = {};
        attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
        attr.ino = node.id;
        attr.mode = node.mode;
        attr.nlink = 1;
        attr.uid = 0;
        attr.gid = 0;
        attr.rdev = node.rdev;
        if (FS.isDir(node.mode)) {
          attr.size = 4096;
        } else if (FS.isFile(node.mode)) {
          attr.size = node.usedBytes;
        } else if (FS.isLink(node.mode)) {
          attr.size = node.link.length;
        } else {
          attr.size = 0;
        }

        attr.atime = new Date(node.timestamp);
        attr.mtime = new Date(node.timestamp);
        attr.ctime = new Date(node.timestamp);
        attr.blksize = 4096;
        attr.blocks = Math.ceil(attr.size / attr.blksize);
        return attr;
      }),

      setattr: (function(node, attr) {
        if (attr.mode !== undefined) {
          node.mode = attr.mode;
        }

        if (attr.timestamp !== undefined) {
          node.timestamp = attr.timestamp;
        }

        if (attr.size !== undefined) {
          MEMFS.resizeFileStorage(node, attr.size);
        }
      }),

      lookup: (function(parent, name) {
        throw FS.genericErrors[ERRNO_CODES.ENOENT];
      }),

      mknod: (function(parent, name, mode, dev) {
        return MEMFS.createNode(parent, name, mode, dev);
      }),

      rename: (function(old_node, new_dir, new_name) {
        if (FS.isDir(old_node.mode)) {
          var new_node;
          try {
            new_node = FS.lookupNode(new_dir, new_name);
          } catch (e) {}
          if (new_node) {
            for (var i in new_node.contents) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
            }
          }
        }

        delete old_node.parent.contents[old_node.name];
        old_node.name = new_name;
        new_dir.contents[new_name] = old_node;
        old_node.parent = new_dir;
      }),

      unlink: (function(parent, name) {
        delete parent.contents[name];
      }),

      rmdir: (function(parent, name) {
        var node = FS.lookupNode(parent, name);
        for (var i in node.contents) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
        }

        delete parent.contents[name];
      }),

      readdir: (function(node) {
        var entries = ['.', '..'];
        for (var key in node.contents) {
          if (!node.contents.hasOwnProperty(key)) {
            continue;
          }

          entries.push(key);
        }

        return entries;
      }),

      symlink: (function(parent, newname, oldpath) {
        var node = MEMFS.createNode(parent, newname, 511 | 40960, 0);
        node.link = oldpath;
        return node;
      }),

      readlink: (function(node) {
        if (!FS.isLink(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        return node.link;
      })
    },
    stream_ops: {
      read: (function(stream, buffer, offset, length, position) {
        var contents = stream.node.contents;
        if (position >= stream.node.usedBytes) return 0;
        var size = Math.min(stream.node.usedBytes - position, length);
        assert(size >= 0);
        if (size > 8 && contents.subarray) {
          buffer.set(contents.subarray(position, position + size), offset);
        } else {
          for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
        }

        return size;
      }),

      write: (function(stream, buffer, offset, length, position, canOwn) {
        if (!length) return 0;
        var node = stream.node;
        node.timestamp = Date.now();
        if (buffer.subarray && (!node.contents || node.contents.subarray)) {
          if (canOwn) {
            node.contents = buffer.subarray(offset, offset + length);
            node.usedBytes = length;
            return length;
          } else if (node.usedBytes === 0 && position === 0) {
            node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
            node.usedBytes = length;
            return length;
          } else if (position + length <= node.usedBytes) {
            node.contents.set(buffer.subarray(offset, offset + length), position);
            return length;
          }
        }

        MEMFS.expandFileStorage(node, position + length);
        if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position);
        else
          for (var i = 0; i < length; i++) {
            node.contents[position + i] = buffer[offset + i];
          }

        node.usedBytes = Math.max(node.usedBytes, position + length);
        return length;
      }),

      llseek: (function(stream, offset, whence) {
        var position = offset;
        if (whence === 1) {
          position += stream.position;
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            position += stream.node.usedBytes;
          }
        }

        if (position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        return position;
      }),

      allocate: (function(stream, offset, length) {
        MEMFS.expandFileStorage(stream.node, offset + length);
        stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
      }),

      mmap: (function(stream, buffer, offset, length, position, prot, flags) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }

        var ptr;
        var allocated;
        var contents = stream.node.contents;
        if (!(flags & 2) && (contents.buffer === buffer || contents.buffer === buffer.buffer)) {
          allocated = false;
          ptr = contents.byteOffset;
        } else {
          if (position > 0 || position + length < stream.node.usedBytes) {
            if (contents.subarray) {
              contents = contents.subarray(position, position + length);
            } else {
              contents = Array.prototype.slice.call(contents, position, position + length);
            }
          }

          allocated = true;
          ptr = _malloc(length);
          if (!ptr) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
          }

          buffer.set(contents, ptr);
        }

        return {
          ptr: ptr,
          allocated: allocated
        };
      })
    }
  };
  var IDBFS = {
    dbs: {},
    indexedDB: (function() {
      if (typeof indexedDB !== 'undefined') return indexedDB;
      var ret = null;
      if (typeof window === 'object') ret = window.indexedDB || window.webkitIndexedDB;
      assert(ret, 'IDBFS used, but indexedDB not supported');
      return ret;
    }),

    DB_VERSION: 21,
    DB_STORE_NAME: 'FILE_DATA',
    mount: (function(mount) {
      return MEMFS.mount.apply(null, arguments);
    }),

    syncfs: (function(mount, populate, callback) {
      IDBFS.getLocalSet(mount, (function(err, local) {
        if (err) return callback(err);
        IDBFS.getRemoteSet(mount, (function(err, remote) {
          if (err) return callback(err);
          var src = populate ? remote : local;
          var dst = populate ? local : remote;
          IDBFS.reconcile(src, dst, callback);
        }));
      }));
    }),

    getDB: (function(name, callback) {
      var db = IDBFS.dbs[name];
      if (db) {
        return callback(null, db);
      }

      var req;
      try {
        req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
      } catch (e) {
        return callback(e);
      }
      req.onupgradeneeded = (function(e) {
        var db = e.target.result;
        var transaction = e.target.transaction;
        var fileStore;
        if (db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
          fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
        } else {
          fileStore = db.createObjectStore(IDBFS.DB_STORE_NAME);
        }

        if (!fileStore.indexNames.contains('timestamp')) {
          fileStore.createIndex('timestamp', 'timestamp', {
            unique: false
          });
        }
      });

      req.onsuccess = (function() {
        db = req.result;
        IDBFS.dbs[name] = db;
        callback(null, db);
      });

      req.onerror = (function(e) {
        callback(this.error);
        e.preventDefault();
      });
    }),

    getLocalSet: (function(mount, callback) {
      var entries = {};

      function isRealDir(p) {
        return p !== '.' && p !== '..';
      }

      function toAbsolute(root) {
        return (function(p) {
          return PATH.join2(root, p);
        });
      }

      var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));
      while (check.length) {
        var path = check.pop();
        var stat;
        try {
          stat = FS.stat(path);
        } catch (e) {
          return callback(e);
        }
        if (FS.isDir(stat.mode)) {
          check.push.apply(check, FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
        }

        entries[path] = {
          timestamp: stat.mtime
        };
      }

      return callback(null, {
        type: 'local',
        entries: entries
      });
    }),

    getRemoteSet: (function(mount, callback) {
      var entries = {};
      IDBFS.getDB(mount.mountpoint, (function(err, db) {
        if (err) return callback(err);
        var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readonly');
        transaction.onerror = (function(e) {
          callback(this.error);
          e.preventDefault();
        });

        var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
        var index = store.index('timestamp');
        index.openKeyCursor().onsuccess = (function(event) {
          var cursor = event.target.result;
          if (!cursor) {
            return callback(null, {
              type: 'remote',
              db: db,
              entries: entries
            });
          }

          entries[cursor.primaryKey] = {
            timestamp: cursor.key
          };
          cursor.continue();
        });
      }));
    }),

    loadLocalEntry: (function(path, callback) {
      var stat, node;
      try {
        var lookup = FS.lookupPath(path);
        node = lookup.node;
        stat = FS.stat(path);
      } catch (e) {
        return callback(e);
      }
      if (FS.isDir(stat.mode)) {
        return callback(null, {
          timestamp: stat.mtime,
          mode: stat.mode
        });
      } else if (FS.isFile(stat.mode)) {
        node.contents = MEMFS.getFileDataAsTypedArray(node);
        return callback(null, {
          timestamp: stat.mtime,
          mode: stat.mode,
          contents: node.contents
        });
      } else {
        return callback(new Error('node type not supported'));
      }
    }),

    storeLocalEntry: (function(path, entry, callback) {
      try {
        if (FS.isDir(entry.mode)) {
          FS.mkdir(path, entry.mode);
        } else if (FS.isFile(entry.mode)) {
          FS.writeFile(path, entry.contents, {
            encoding: 'binary',
            canOwn: true
          });
        } else {
          return callback(new Error('node type not supported'));
        }

        FS.chmod(path, entry.mode);
        FS.utime(path, entry.timestamp, entry.timestamp);
      } catch (e) {
        return callback(e);
      }
      callback(null);
    }),

    removeLocalEntry: (function(path, callback) {
      try {
        var lookup = FS.lookupPath(path);
        var stat = FS.stat(path);
        if (FS.isDir(stat.mode)) {
          FS.rmdir(path);
        } else if (FS.isFile(stat.mode)) {
          FS.unlink(path);
        }
      } catch (e) {
        return callback(e);
      }
      callback(null);
    }),

    loadRemoteEntry: (function(store, path, callback) {
      var req = store.get(path);
      req.onsuccess = (function(event) {
        callback(null, event.target.result);
      });

      req.onerror = (function(e) {
        callback(this.error);
        e.preventDefault();
      });
    }),

    storeRemoteEntry: (function(store, path, entry, callback) {
      var req = store.put(entry, path);
      req.onsuccess = (function() {
        callback(null);
      });

      req.onerror = (function(e) {
        callback(this.error);
        e.preventDefault();
      });
    }),

    removeRemoteEntry: (function(store, path, callback) {
      var req = store.delete(path);
      req.onsuccess = (function() {
        callback(null);
      });

      req.onerror = (function(e) {
        callback(this.error);
        e.preventDefault();
      });
    }),

    reconcile: (function(src, dst, callback) {
      var total = 0;
      var create = [];
      Object.keys(src.entries).forEach((function(key) {
        var e = src.entries[key];
        var e2 = dst.entries[key];
        if (!e2 || e.timestamp > e2.timestamp) {
          create.push(key);
          total++;
        }
      }));

      var remove = [];
      Object.keys(dst.entries).forEach((function(key) {
        var e = dst.entries[key];
        var e2 = src.entries[key];
        if (!e2) {
          remove.push(key);
          total++;
        }
      }));

      if (!total) {
        return callback(null);
      }

      var errored = false;
      var completed = 0;
      var db = src.type === 'remote' ? src.db : dst.db;
      var transaction = db.transaction([IDBFS.DB_STORE_NAME], 'readwrite');
      var store = transaction.objectStore(IDBFS.DB_STORE_NAME);

      function done(err) {
        if (err) {
          if (!done.errored) {
            done.errored = true;
            return callback(err);
          }

          return;
        }

        if (++completed >= total) {
          return callback(null);
        }
      }

      transaction.onerror = (function(e) {
        done(this.error);
        e.preventDefault();
      });

      create.sort().forEach((function(path) {
        if (dst.type === 'local') {
          IDBFS.loadRemoteEntry(store, path, (function(err, entry) {
            if (err) return done(err);
            IDBFS.storeLocalEntry(path, entry, done);
          }));
        } else {
          IDBFS.loadLocalEntry(path, (function(err, entry) {
            if (err) return done(err);
            IDBFS.storeRemoteEntry(store, path, entry, done);
          }));
        }
      }));

      remove.sort().reverse().forEach((function(path) {
        if (dst.type === 'local') {
          IDBFS.removeLocalEntry(path, done);
        } else {
          IDBFS.removeRemoteEntry(store, path, done);
        }
      }));
    })
  };
  var NODEFS = {
    isWindows: false,
    staticInit: (function() {
      NODEFS.isWindows = !!process.platform.match(/^win/);
    }),

    mount: (function(mount) {
      // assert(ENVIRONMENT_IS_NODE);
      return NODEFS.createNode(null, '/', NODEFS.getMode(mount.opts.root), 0);
    }),

    createNode: (function(parent, name, mode, dev) {
      if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      var node = FS.createNode(parent, name, mode);
      node.node_ops = NODEFS.node_ops;
      node.stream_ops = NODEFS.stream_ops;
      return node;
    }),

    getMode: (function(path) {
      var stat;
      try {
        stat = fs.lstatSync(path);
        if (NODEFS.isWindows) {
          stat.mode = stat.mode | (stat.mode & 146) >> 1;
        }
      } catch (e) {
        if (!e.code) throw e;
        throw new FS.ErrnoError(ERRNO_CODES[e.code]);
      }
      return stat.mode;
    }),

    realPath: (function(node) {
      var parts = [];
      while (node.parent !== node) {
        parts.push(node.name);
        node = node.parent;
      }

      parts.push(node.mount.opts.root);
      parts.reverse();
      return PATH.join.apply(null, parts);
    }),

    flagsToPermissionStringMap: {
      0: 'r',
      1: 'r+',
      2: 'r+',
      64: 'r',
      65: 'r+',
      66: 'r+',
      129: 'rx+',
      193: 'rx+',
      514: 'w+',
      577: 'w',
      578: 'w+',
      705: 'wx',
      706: 'wx+',
      1024: 'a',
      1025: 'a',
      1026: 'a+',
      1089: 'a',
      1090: 'a+',
      1153: 'ax',
      1154: 'ax+',
      1217: 'ax',
      1218: 'ax+',
      4096: 'rs',
      4098: 'rs+'
    },
    flagsToPermissionString: (function(flags) {
      if (flags in NODEFS.flagsToPermissionStringMap) {
        return NODEFS.flagsToPermissionStringMap[flags];
      } else {
        return flags;
      }
    }),

    node_ops: {
      getattr: (function(node) {
        var path = NODEFS.realPath(node);
        var stat;
        try {
          stat = fs.lstatSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        if (NODEFS.isWindows && !stat.blksize) {
          stat.blksize = 4096;
        }

        if (NODEFS.isWindows && !stat.blocks) {
          stat.blocks = (stat.size + stat.blksize - 1) / stat.blksize | 0;
        }

        return {
          dev: stat.dev,
          ino: stat.ino,
          mode: stat.mode,
          nlink: stat.nlink,
          uid: stat.uid,
          gid: stat.gid,
          rdev: stat.rdev,
          size: stat.size,
          atime: stat.atime,
          mtime: stat.mtime,
          ctime: stat.ctime,
          blksize: stat.blksize,
          blocks: stat.blocks
        };
      }),

      setattr: (function(node, attr) {
        var path = NODEFS.realPath(node);
        try {
          if (attr.mode !== undefined) {
            fs.chmodSync(path, attr.mode);
            node.mode = attr.mode;
          }

          if (attr.timestamp !== undefined) {
            var date = new Date(attr.timestamp);
            fs.utimesSync(path, date, date);
          }

          if (attr.size !== undefined) {
            fs.truncateSync(path, attr.size);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      lookup: (function(parent, name) {
        var path = PATH.join2(NODEFS.realPath(parent), name);
        var mode = NODEFS.getMode(path);
        return NODEFS.createNode(parent, name, mode);
      }),

      mknod: (function(parent, name, mode, dev) {
        var node = NODEFS.createNode(parent, name, mode, dev);
        var path = NODEFS.realPath(node);
        try {
          if (FS.isDir(node.mode)) {
            fs.mkdirSync(path, node.mode);
          } else {
            fs.writeFileSync(path, '', {
              mode: node.mode
            });
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return node;
      }),

      rename: (function(oldNode, newDir, newName) {
        var oldPath = NODEFS.realPath(oldNode);
        var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
        try {
          fs.renameSync(oldPath, newPath);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      unlink: (function(parent, name) {
        var path = PATH.join2(NODEFS.realPath(parent), name);
        try {
          fs.unlinkSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      rmdir: (function(parent, name) {
        var path = PATH.join2(NODEFS.realPath(parent), name);
        try {
          fs.rmdirSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      readdir: (function(node) {
        var path = NODEFS.realPath(node);
        try {
          return fs.readdirSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      symlink: (function(parent, newName, oldPath) {
        var newPath = PATH.join2(NODEFS.realPath(parent), newName);
        try {
          fs.symlinkSync(oldPath, newPath);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      readlink: (function(node) {
        var path = NODEFS.realPath(node);
        try {
          return fs.readlinkSync(path);
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      })
    },
    stream_ops: {
      open: (function(stream) {
        var path = NODEFS.realPath(stream.node);
        try {
          if (FS.isFile(stream.node.mode)) {
            stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      close: (function(stream) {
        try {
          if (FS.isFile(stream.node.mode) && stream.nfd) {
            fs.closeSync(stream.nfd);
          }
        } catch (e) {
          if (!e.code) throw e;
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
      }),

      read: (function(stream, buffer, offset, length, position) {
        if (length === 0) return 0;
        var nbuffer = new Buffer(length);
        var res;
        try {
          res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
        } catch (e) {
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        if (res > 0) {
          for (var i = 0; i < res; i++) {
            buffer[offset + i] = nbuffer[i];
          }
        }

        return res;
      }),

      write: (function(stream, buffer, offset, length, position) {
        var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
        var res;
        try {
          res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
        } catch (e) {
          throw new FS.ErrnoError(ERRNO_CODES[e.code]);
        }
        return res;
      }),

      llseek: (function(stream, offset, whence) {
        var position = offset;
        if (whence === 1) {
          position += stream.position;
        } else if (whence === 2) {
          if (FS.isFile(stream.node.mode)) {
            try {
              var stat = fs.fstatSync(stream.nfd);
              position += stat.size;
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES[e.code]);
            }
          }
        }

        if (position < 0) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        return position;
      })
    }
  };
  var _stdin = allocate(1, 'i32*', ALLOC_STATIC);
  var _stdout = allocate(1, 'i32*', ALLOC_STATIC);
  var _stderr = allocate(1, 'i32*', ALLOC_STATIC);

  function _fflush(stream) {}

  var FS = {
    root: null,
    mounts: [],
    devices: [null],
    streams: [],
    nextInode: 1,
    nameTable: null,
    currentPath: '/',
    initialized: false,
    ignorePermissions: true,
    trackingDelegate: {},
    tracking: {
      openFlags: {
        READ: 1,
        WRITE: 2
      }
    },
    ErrnoError: null,
    genericErrors: {},
    handleFSError: (function(e) {
      if (!(e instanceof FS.ErrnoError)) throw e + ' : ' + stackTrace();
      return ___setErrNo(e.errno);
    }),

    lookupPath: (function(path, opts) {
      path = PATH.resolve(FS.cwd(), path);
      opts = opts || {};
      if (!path) return {
        path: '',
        node: null
      };
      var defaults = {
        follow_mount: true,
        recurse_count: 0
      };
      for (var key in defaults) {
        if (opts[key] === undefined) {
          opts[key] = defaults[key];
        }
      }

      if (opts.recurse_count > 8) {
        throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
      }

      var parts = PATH.normalizeArray(path.split('/').filter((function(p) {
        return !!p;
      })), false);

      var current = FS.root;
      var current_path = '/';
      for (var i = 0; i < parts.length; i++) {
        var islast = i === parts.length - 1;
        if (islast && opts.parent) {
          break;
        }

        current = FS.lookupNode(current, parts[i]);
        current_path = PATH.join2(current_path, parts[i]);
        if (FS.isMountpoint(current)) {
          if (!islast || islast && opts.follow_mount) {
            current = current.mounted.root;
          }
        }

        if (!islast || opts.follow) {
          var count = 0;
          while (FS.isLink(current.mode)) {
            var link = FS.readlink(current_path);
            current_path = PATH.resolve(PATH.dirname(current_path), link);
            var lookup = FS.lookupPath(current_path, {
              recurse_count: opts.recurse_count
            });
            current = lookup.node;
            if (count++ > 40) {
              throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
            }
          }
        }
      }

      return {
        path: current_path,
        node: current
      };
    }),

    getPath: (function(node) {
      var path;
      while (true) {
        if (FS.isRoot(node)) {
          var mount = node.mount.mountpoint;
          if (!path) return mount;
          return mount[mount.length - 1] !== '/' ? mount + '/' + path : mount + path;
        }

        path = path ? node.name + '/' + path : node.name;
        node = node.parent;
      }
    }),

    hashName: (function(parentid, name) {
      var hash = 0;
      for (var i = 0; i < name.length; i++) {
        hash = (hash << 5) - hash + name.charCodeAt(i) | 0;
      }

      return (parentid + hash >>> 0) % FS.nameTable.length;
    }),

    hashAddNode: (function(node) {
      var hash = FS.hashName(node.parent.id, node.name);
      node.name_next = FS.nameTable[hash];
      FS.nameTable[hash] = node;
    }),

    hashRemoveNode: (function(node) {
      var hash = FS.hashName(node.parent.id, node.name);
      if (FS.nameTable[hash] === node) {
        FS.nameTable[hash] = node.name_next;
      } else {
        var current = FS.nameTable[hash];
        while (current) {
          if (current.name_next === node) {
            current.name_next = node.name_next;
            break;
          }

          current = current.name_next;
        }
      }
    }),

    lookupNode: (function(parent, name) {
      var err = FS.mayLookup(parent);
      if (err) {
        throw new FS.ErrnoError(err, parent);
      }

      var hash = FS.hashName(parent.id, name);
      for (var node = FS.nameTable[hash]; node; node = node.name_next) {
        var nodeName = node.name;
        if (node.parent.id === parent.id && nodeName === name) {
          return node;
        }
      }

      return FS.lookup(parent, name);
    }),

    createNode: (function(parent, name, mode, rdev) {
      if (!FS.FSNode) {
        FS.FSNode = (function(parent, name, mode, rdev) {
          if (!parent) {
            parent = this;
          }

          this.parent = parent;
          this.mount = parent.mount;
          this.mounted = null;
          this.id = FS.nextInode++;
          this.name = name;
          this.mode = mode;
          this.node_ops = {};
          this.stream_ops = {};
          this.rdev = rdev;
        });

        FS.FSNode.prototype = {};
        var readMode = 292 | 73;
        var writeMode = 146;
        Object.defineProperties(FS.FSNode.prototype, {
          read: {
            get: (function() {
              return (this.mode & readMode) === readMode;
            }),

            set: (function(val) {
              val ? this.mode |= readMode : this.mode &= ~readMode;
            })
          },
          write: {
            get: (function() {
              return (this.mode & writeMode) === writeMode;
            }),

            set: (function(val) {
              val ? this.mode |= writeMode : this.mode &= ~writeMode;
            })
          },
          isFolder: {
            get: (function() {
              return FS.isDir(this.mode);
            })
          },
          isDevice: {
            get: (function() {
              return FS.isChrdev(this.mode);
            })
          }
        });
      }

      var node = new FS.FSNode(parent, name, mode, rdev);
      FS.hashAddNode(node);
      return node;
    }),

    destroyNode: (function(node) {
      FS.hashRemoveNode(node);
    }),

    isRoot: (function(node) {
      return node === node.parent;
    }),

    isMountpoint: (function(node) {
      return !!node.mounted;
    }),

    isFile: (function(mode) {
      return (mode & 61440) === 32768;
    }),

    isDir: (function(mode) {
      return (mode & 61440) === 16384;
    }),

    isLink: (function(mode) {
      return (mode & 61440) === 40960;
    }),

    isChrdev: (function(mode) {
      return (mode & 61440) === 8192;
    }),

    isBlkdev: (function(mode) {
      return (mode & 61440) === 24576;
    }),

    isFIFO: (function(mode) {
      return (mode & 61440) === 4096;
    }),

    isSocket: (function(mode) {
      return (mode & 49152) === 49152;
    }),

    flagModes: {
      r: 0,
      rs: 1052672,
      'r+': 2,
      w: 577,
      wx: 705,
      xw: 705,
      'w+': 578,
      'wx+': 706,
      'xw+': 706,
      a: 1089,
      ax: 1217,
      xa: 1217,
      'a+': 1090,
      'ax+': 1218,
      'xa+': 1218
    },
    modeStringToFlags: (function(str) {
      var flags = FS.flagModes[str];
      if (typeof flags === 'undefined') {
        throw new Error('Unknown file open mode: ' + str);
      }

      return flags;
    }),

    flagsToPermissionString: (function(flag) {
      var accmode = flag & 2097155;
      var perms = ['r', 'w', 'rw'][accmode];
      if (flag & 512) {
        perms += 'w';
      }

      return perms;
    }),

    nodePermissions: (function(node, perms) {
      if (FS.ignorePermissions) {
        return 0;
      }

      if (perms.indexOf('r') !== -1 && !(node.mode & 292)) {
        return ERRNO_CODES.EACCES;
      } else if (perms.indexOf('w') !== -1 && !(node.mode & 146)) {
        return ERRNO_CODES.EACCES;
      } else if (perms.indexOf('x') !== -1 && !(node.mode & 73)) {
        return ERRNO_CODES.EACCES;
      }

      return 0;
    }),

    mayLookup: (function(dir) {
      var err = FS.nodePermissions(dir, 'x');
      if (err) return err;
      if (!dir.node_ops.lookup) return ERRNO_CODES.EACCES;
      return 0;
    }),

    mayCreate: (function(dir, name) {
      try {
        var node = FS.lookupNode(dir, name);
        return ERRNO_CODES.EEXIST;
      } catch (e) {}
      return FS.nodePermissions(dir, 'wx');
    }),

    mayDelete: (function(dir, name, isdir) {
      var node;
      try {
        node = FS.lookupNode(dir, name);
      } catch (e) {
        return e.errno;
      }
      var err = FS.nodePermissions(dir, 'wx');
      if (err) {
        return err;
      }

      if (isdir) {
        if (!FS.isDir(node.mode)) {
          return ERRNO_CODES.ENOTDIR;
        }

        if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
          return ERRNO_CODES.EBUSY;
        }
      } else {
        if (FS.isDir(node.mode)) {
          return ERRNO_CODES.EISDIR;
        }
      }

      return 0;
    }),

    mayOpen: (function(node, flags) {
      if (!node) {
        return ERRNO_CODES.ENOENT;
      }

      if (FS.isLink(node.mode)) {
        return ERRNO_CODES.ELOOP;
      } else if (FS.isDir(node.mode)) {
        if ((flags & 2097155) !== 0 || flags & 512) {
          return ERRNO_CODES.EISDIR;
        }
      }

      return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
    }),

    MAX_OPEN_FDS: 4096,
    nextfd: (function(fd_start, fd_end) {
      fd_start = fd_start || 0;
      fd_end = fd_end || FS.MAX_OPEN_FDS;
      for (var fd = fd_start; fd <= fd_end; fd++) {
        if (!FS.streams[fd]) {
          return fd;
        }
      }

      throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
    }),

    getStream: (function(fd) {
      return FS.streams[fd];
    }),

    createStream: (function(stream, fd_start, fd_end) {
      if (!FS.FSStream) {
        FS.FSStream = (function() {});

        FS.FSStream.prototype = {};
        Object.defineProperties(FS.FSStream.prototype, {
          object: {
            get: (function() {
              return this.node;
            }),

            set: (function(val) {
              this.node = val;
            })
          },
          isRead: {
            get: (function() {
              return (this.flags & 2097155) !== 1;
            })
          },
          isWrite: {
            get: (function() {
              return (this.flags & 2097155) !== 0;
            })
          },
          isAppend: {
            get: (function() {
              return this.flags & 1024;
            })
          }
        });
      }

      var newStream = new FS.FSStream;
      for (var p in stream) {
        newStream[p] = stream[p];
      }

      stream = newStream;
      var fd = FS.nextfd(fd_start, fd_end);
      stream.fd = fd;
      FS.streams[fd] = stream;
      return stream;
    }),

    closeStream: (function(fd) {
      FS.streams[fd] = null;
    }),

    getStreamFromPtr: (function(ptr) {
      return FS.streams[ptr - 1];
    }),

    getPtrForStream: (function(stream) {
      return stream ? stream.fd + 1 : 0;
    }),

    chrdev_stream_ops: {
      open: (function(stream) {
        var device = FS.getDevice(stream.node.rdev);
        stream.stream_ops = device.stream_ops;
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
      }),

      llseek: (function() {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      })
    },
    major: (function(dev) {
      return dev >> 8;
    }),

    minor: (function(dev) {
      return dev & 255;
    }),

    makedev: (function(ma, mi) {
      return ma << 8 | mi;
    }),

    registerDevice: (function(dev, ops) {
      FS.devices[dev] = {
        stream_ops: ops
      };
    }),

    getDevice: (function(dev) {
      return FS.devices[dev];
    }),

    getMounts: (function(mount) {
      var mounts = [];
      var check = [mount];
      while (check.length) {
        var m = check.pop();
        mounts.push(m);
        check.push.apply(check, m.mounts);
      }

      return mounts;
    }),

    syncfs: (function(populate, callback) {
      if (typeof populate === 'function') {
        callback = populate;
        populate = false;
      }

      var mounts = FS.getMounts(FS.root.mount);
      var completed = 0;

      function done(err) {
        if (err) {
          if (!done.errored) {
            done.errored = true;
            return callback(err);
          }

          return;
        }

        if (++completed >= mounts.length) {
          callback(null);
        }
      }

      mounts.forEach((function(mount) {
        if (!mount.type.syncfs) {
          return done(null);
        }

        mount.type.syncfs(mount, populate, done);
      }));
    }),

    mount: (function(type, opts, mountpoint) {
      var root = mountpoint === '/';
      var pseudo = !mountpoint;
      var node;
      if (root && FS.root) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      } else if (!root && !pseudo) {
        var lookup = FS.lookupPath(mountpoint, {
          follow_mount: false
        });
        mountpoint = lookup.path;
        node = lookup.node;
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
        }

        if (!FS.isDir(node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
        }
      }

      var mount = {
        type: type,
        opts: opts,
        mountpoint: mountpoint,
        mounts: []
      };
      var mountRoot = type.mount(mount);
      mountRoot.mount = mount;
      mount.root = mountRoot;
      if (root) {
        FS.root = mountRoot;
      } else if (node) {
        node.mounted = mount;
        if (node.mount) {
          node.mount.mounts.push(mount);
        }
      }

      return mountRoot;
    }),

    unmount: (function(mountpoint) {
      var lookup = FS.lookupPath(mountpoint, {
        follow_mount: false
      });
      if (!FS.isMountpoint(lookup.node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      var node = lookup.node;
      var mount = node.mounted;
      var mounts = FS.getMounts(mount);
      Object.keys(FS.nameTable).forEach((function(hash) {
        var current = FS.nameTable[hash];
        while (current) {
          var next = current.name_next;
          if (mounts.indexOf(current.mount) !== -1) {
            FS.destroyNode(current);
          }

          current = next;
        }
      }));

      node.mounted = null;
      var idx = node.mount.mounts.indexOf(mount);
      assert(idx !== -1);
      node.mount.mounts.splice(idx, 1);
    }),

    lookup: (function(parent, name) {
      return parent.node_ops.lookup(parent, name);
    }),

    mknod: (function(path, mode, dev) {
      var lookup = FS.lookupPath(path, {
        parent: true
      });
      var parent = lookup.node;
      var name = PATH.basename(path);
      if (!name || name === '.' || name === '..') {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      var err = FS.mayCreate(parent, name);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.mknod) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      return parent.node_ops.mknod(parent, name, mode, dev);
    }),

    create: (function(path, mode) {
      mode = mode !== undefined ? mode : 438;
      mode &= 4095;
      mode |= 32768;
      return FS.mknod(path, mode, 0);
    }),

    mkdir: (function(path, mode) {
      mode = mode !== undefined ? mode : 511;
      mode &= 511 | 512;
      mode |= 16384;
      return FS.mknod(path, mode, 0);
    }),

    mkdev: (function(path, mode, dev) {
      if (typeof dev === 'undefined') {
        dev = mode;
        mode = 438;
      }

      mode |= 8192;
      return FS.mknod(path, mode, dev);
    }),

    symlink: (function(oldpath, newpath) {
      if (!PATH.resolve(oldpath)) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      var lookup = FS.lookupPath(newpath, {
        parent: true
      });
      var parent = lookup.node;
      if (!parent) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      var newname = PATH.basename(newpath);
      var err = FS.mayCreate(parent, newname);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.symlink) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      return parent.node_ops.symlink(parent, newname, oldpath);
    }),

    rename: (function(old_path, new_path) {
      var old_dirname = PATH.dirname(old_path);
      var new_dirname = PATH.dirname(new_path);
      var old_name = PATH.basename(old_path);
      var new_name = PATH.basename(new_path);
      var lookup, old_dir, new_dir;
      try {
        lookup = FS.lookupPath(old_path, {
          parent: true
        });
        old_dir = lookup.node;
        lookup = FS.lookupPath(new_path, {
          parent: true
        });
        new_dir = lookup.node;
      } catch (e) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }
      if (!old_dir || !new_dir) throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      if (old_dir.mount !== new_dir.mount) {
        throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
      }

      var old_node = FS.lookupNode(old_dir, old_name);
      var relative = PATH.relative(old_path, new_dirname);
      if (relative.charAt(0) !== '.') {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      relative = PATH.relative(new_path, old_dirname);
      if (relative.charAt(0) !== '.') {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
      }

      var new_node;
      try {
        new_node = FS.lookupNode(new_dir, new_name);
      } catch (e) {}
      if (old_node === new_node) {
        return;
      }

      var isdir = FS.isDir(old_node.mode);
      var err = FS.mayDelete(old_dir, old_name, isdir);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      err = new_node ? FS.mayDelete(new_dir, new_name, isdir) : FS.mayCreate(new_dir, new_name);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!old_dir.node_ops.rename) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isMountpoint(old_node) || new_node && FS.isMountpoint(new_node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }

      if (new_dir !== old_dir) {
        err = FS.nodePermissions(old_dir, 'w');
        if (err) {
          throw new FS.ErrnoError(err);
        }
      }

      try {
        if (FS.trackingDelegate['willMovePath']) {
          FS.trackingDelegate['willMovePath'](old_path, new_path);
        }
      } catch (e) {
        console.log("FS.trackingDelegate['willMovePath']('" + old_path + "', '" + new_path + "') threw an exception: " + e.message);
      }
      FS.hashRemoveNode(old_node);
      try {
        old_dir.node_ops.rename(old_node, new_dir, new_name);
      } catch (e) {
        throw e;
      } finally {
        FS.hashAddNode(old_node);
      }

      try {
        if (FS.trackingDelegate['onMovePath']) FS.trackingDelegate['onMovePath'](old_path, new_path);
      } catch (e) {
        console.log("FS.trackingDelegate['onMovePath']('" + old_path + "', '" + new_path + "') threw an exception: " + e.message);
      }
    }),

    rmdir: (function(path) {
      var lookup = FS.lookupPath(path, {
        parent: true
      });
      var parent = lookup.node;
      var name = PATH.basename(path);
      var node = FS.lookupNode(parent, name);
      var err = FS.mayDelete(parent, name, true);
      if (err) {
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.rmdir) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }

      try {
        if (FS.trackingDelegate['willDeletePath']) {
          FS.trackingDelegate['willDeletePath'](path);
        }
      } catch (e) {
        console.log("FS.trackingDelegate['willDeletePath']('" + path + "') threw an exception: " + e.message);
      }
      parent.node_ops.rmdir(parent, name);
      FS.destroyNode(node);
      try {
        if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
      } catch (e) {
        console.log("FS.trackingDelegate['onDeletePath']('" + path + "') threw an exception: " + e.message);
      }
    }),

    readdir: (function(path) {
      var lookup = FS.lookupPath(path, {
        follow: true
      });
      var node = lookup.node;
      if (!node.node_ops.readdir) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
      }

      return node.node_ops.readdir(node);
    }),

    unlink: (function(path) {
      var lookup = FS.lookupPath(path, {
        parent: true
      });
      var parent = lookup.node;
      var name = PATH.basename(path);
      var node = FS.lookupNode(parent, name);
      var err = FS.mayDelete(parent, name, false);
      if (err) {
        if (err === ERRNO_CODES.EISDIR) err = ERRNO_CODES.EPERM;
        throw new FS.ErrnoError(err);
      }

      if (!parent.node_ops.unlink) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
      }

      try {
        if (FS.trackingDelegate['willDeletePath']) {
          FS.trackingDelegate['willDeletePath'](path);
        }
      } catch (e) {
        console.log("FS.trackingDelegate['willDeletePath']('" + path + "') threw an exception: " + e.message);
      }
      parent.node_ops.unlink(parent, name);
      FS.destroyNode(node);
      try {
        if (FS.trackingDelegate['onDeletePath']) FS.trackingDelegate['onDeletePath'](path);
      } catch (e) {
        console.log("FS.trackingDelegate['onDeletePath']('" + path + "') threw an exception: " + e.message);
      }
    }),

    readlink: (function(path) {
      var lookup = FS.lookupPath(path);
      var link = lookup.node;
      if (!link) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      if (!link.node_ops.readlink) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      return link.node_ops.readlink(link);
    }),

    stat: (function(path, dontFollow) {
      var lookup = FS.lookupPath(path, {
        follow: !dontFollow
      });
      var node = lookup.node;
      if (!node) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      if (!node.node_ops.getattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      return node.node_ops.getattr(node);
    }),

    lstat: (function(path) {
      return FS.stat(path, true);
    }),

    chmod: (function(path, mode, dontFollow) {
      var node;
      if (typeof path === 'string') {
        var lookup = FS.lookupPath(path, {
          follow: !dontFollow
        });
        node = lookup.node;
      } else {
        node = path;
      }

      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      node.node_ops.setattr(node, {
        mode: mode & 4095 | node.mode & ~4095,
        timestamp: Date.now()
      });
    }),

    lchmod: (function(path, mode) {
      FS.chmod(path, mode, true);
    }),

    fchmod: (function(fd, mode) {
      var stream = FS.getStream(fd);
      if (!stream) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      FS.chmod(stream.node, mode);
    }),

    chown: (function(path, uid, gid, dontFollow) {
      var node;
      if (typeof path === 'string') {
        var lookup = FS.lookupPath(path, {
          follow: !dontFollow
        });
        node = lookup.node;
      } else {
        node = path;
      }

      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      node.node_ops.setattr(node, {
        timestamp: Date.now()
      });
    }),

    lchown: (function(path, uid, gid) {
      FS.chown(path, uid, gid, true);
    }),

    fchown: (function(fd, uid, gid) {
      var stream = FS.getStream(fd);
      if (!stream) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      FS.chown(stream.node, uid, gid);
    }),

    truncate: (function(path, len) {
      if (len < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      var node;
      if (typeof path === 'string') {
        var lookup = FS.lookupPath(path, {
          follow: true
        });
        node = lookup.node;
      } else {
        node = path;
      }

      if (!node.node_ops.setattr) {
        throw new FS.ErrnoError(ERRNO_CODES.EPERM);
      }

      if (FS.isDir(node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
      }

      if (!FS.isFile(node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      var err = FS.nodePermissions(node, 'w');
      if (err) {
        throw new FS.ErrnoError(err);
      }

      node.node_ops.setattr(node, {
        size: len,
        timestamp: Date.now()
      });
    }),

    ftruncate: (function(fd, len) {
      var stream = FS.getStream(fd);
      if (!stream) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      FS.truncate(stream.node, len);
    }),

    utime: (function(path, atime, mtime) {
      var lookup = FS.lookupPath(path, {
        follow: true
      });
      var node = lookup.node;
      node.node_ops.setattr(node, {
        timestamp: Math.max(atime, mtime)
      });
    }),

    open: (function(path, flags, mode, fd_start, fd_end) {
      if (path === '') {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      flags = typeof flags === 'string' ? FS.modeStringToFlags(flags) : flags;
      mode = typeof mode === 'undefined' ? 438 : mode;
      if (flags & 64) {
        mode = mode & 4095 | 32768;
      } else {
        mode = 0;
      }

      var node;
      if (typeof path === 'object') {
        node = path;
      } else {
        path = PATH.normalize(path);
        try {
          var lookup = FS.lookupPath(path, {
            follow: !(flags & 131072)
          });
          node = lookup.node;
        } catch (e) {}
      }

      var created = false;
      if (flags & 64) {
        if (node) {
          if (flags & 128) {
            throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
          }
        } else {
          node = FS.mknod(path, mode, 0);
          created = true;
        }
      }

      if (!node) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
      }

      if (FS.isChrdev(node.mode)) {
        flags &= ~512;
      }

      if (!created) {
        var err = FS.mayOpen(node, flags);
        if (err) {
          throw new FS.ErrnoError(err);
        }
      }

      if (flags & 512) {
        FS.truncate(node, 0);
      }

      flags &= ~(128 | 512);
      var stream = FS.createStream({
        node: node,
        path: FS.getPath(node),
        flags: flags,
        seekable: true,
        position: 0,
        stream_ops: node.stream_ops,
        ungotten: [],
        error: false
      }, fd_start, fd_end);
      if (stream.stream_ops.open) {
        stream.stream_ops.open(stream);
      }

      if (Module['logReadFiles'] && !(flags & 1)) {
        if (!FS.readFiles) FS.readFiles = {};
        if (!(path in FS.readFiles)) {
          FS.readFiles[path] = 1;
          Module['printErr']('read file: ' + path);
        }
      }

      try {
        if (FS.trackingDelegate['onOpenFile']) {
          var trackingFlags = 0;
          if ((flags & 2097155) !== 1) {
            trackingFlags |= FS.tracking.openFlags.READ;
          }

          if ((flags & 2097155) !== 0) {
            trackingFlags |= FS.tracking.openFlags.WRITE;
          }

          FS.trackingDelegate['onOpenFile'](path, trackingFlags);
        }
      } catch (e) {
        console.log("FS.trackingDelegate['onOpenFile']('" + path + "', flags) threw an exception: " + e.message);
      }
      return stream;
    }),

    close: (function(stream) {
      try {
        if (stream.stream_ops.close) {
          stream.stream_ops.close(stream);
        }
      } catch (e) {
        throw e;
      } finally {
        FS.closeStream(stream.fd);
      }
    }),

    llseek: (function(stream, offset, whence) {
      if (!stream.seekable || !stream.stream_ops.llseek) {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }

      stream.position = stream.stream_ops.llseek(stream, offset, whence);
      stream.ungotten = [];
      return stream.position;
    }),

    read: (function(stream, buffer, offset, length, position) {
      if (length < 0 || position < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if ((stream.flags & 2097155) === 1) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if (FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
      }

      if (!stream.stream_ops.read) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      var seeking = true;
      if (typeof position === 'undefined') {
        position = stream.position;
        seeking = false;
      } else if (!stream.seekable) {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }

      var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
      if (!seeking) stream.position += bytesRead;
      return bytesRead;
    }),

    write: (function(stream, buffer, offset, length, position, canOwn) {
      if (length < 0 || position < 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if (FS.isDir(stream.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
      }

      if (!stream.stream_ops.write) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if (stream.flags & 1024) {
        FS.llseek(stream, 0, 2);
      }

      var seeking = true;
      if (typeof position === 'undefined') {
        position = stream.position;
        seeking = false;
      } else if (!stream.seekable) {
        throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
      }

      var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
      if (!seeking) stream.position += bytesWritten;
      try {
        if (stream.path && FS.trackingDelegate['onWriteToFile']) FS.trackingDelegate['onWriteToFile'](stream.path);
      } catch (e) {
        console.log("FS.trackingDelegate['onWriteToFile']('" + path + "') threw an exception: " + e.message);
      }
      return bytesWritten;
    }),

    allocate: (function(stream, offset, length) {
      if (offset < 0 || length <= 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
      }

      if ((stream.flags & 2097155) === 0) {
        throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      }

      if (!FS.isFile(stream.node.mode) && !FS.isDir(node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
      }

      if (!stream.stream_ops.allocate) {
        throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
      }

      stream.stream_ops.allocate(stream, offset, length);
    }),

    mmap: (function(stream, buffer, offset, length, position, prot, flags) {
      if ((stream.flags & 2097155) === 1) {
        throw new FS.ErrnoError(ERRNO_CODES.EACCES);
      }

      if (!stream.stream_ops.mmap) {
        throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
      }

      return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
    }),

    ioctl: (function(stream, cmd, arg) {
      if (!stream.stream_ops.ioctl) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
      }

      return stream.stream_ops.ioctl(stream, cmd, arg);
    }),

    readFile: (function(path, opts) {
      opts = opts || {};
      opts.flags = opts.flags || 'r';
      opts.encoding = opts.encoding || 'binary';
      if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
        throw new Error('Invalid encoding type "' + opts.encoding + '"');
      }

      var ret;
      var stream = FS.open(path, opts.flags);
      var stat = FS.stat(path);
      var length = stat.size;
      var buf = new Uint8Array(length);
      FS.read(stream, buf, 0, length, 0);
      if (opts.encoding === 'utf8') {
        ret = UTF8ArrayToString(buf, 0);
      } else if (opts.encoding === 'binary') {
        ret = buf;
      }

      FS.close(stream);
      return ret;
    }),

    writeFile: (function(path, data, opts) {
      opts = opts || {};
      opts.flags = opts.flags || 'w';
      opts.encoding = opts.encoding || 'utf8';
      if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
        throw new Error('Invalid encoding type "' + opts.encoding + '"');
      }

      var stream = FS.open(path, opts.flags, opts.mode);
      if (opts.encoding === 'utf8') {
        var buf = new Uint8Array(lengthBytesUTF8(data) + 1);
        var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
        FS.write(stream, buf, 0, actualNumBytes, 0, opts.canOwn);
      } else if (opts.encoding === 'binary') {
        FS.write(stream, data, 0, data.length, 0, opts.canOwn);
      }

      FS.close(stream);
    }),

    cwd: (function() {
      return FS.currentPath;
    }),

    chdir: (function(path) {
      var lookup = FS.lookupPath(path, {
        follow: true
      });
      if (!FS.isDir(lookup.node.mode)) {
        throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
      }

      var err = FS.nodePermissions(lookup.node, 'x');
      if (err) {
        throw new FS.ErrnoError(err);
      }

      FS.currentPath = lookup.path;
    }),

    createDefaultDirectories: (function() {
      FS.mkdir('/tmp');
      FS.mkdir('/home');
      FS.mkdir('/home/web_user');
    }),

    createDefaultDevices: (function() {
      FS.mkdir('/dev');
      FS.registerDevice(FS.makedev(1, 3), {
        read: (function() {
          return 0;
        }),

        write: (function() {
          return 0;
        })
      });
      FS.mkdev('/dev/null', FS.makedev(1, 3));
      TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
      TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
      FS.mkdev('/dev/tty', FS.makedev(5, 0));
      FS.mkdev('/dev/tty1', FS.makedev(6, 0));
      var random_device;
      random_device = (function() {
        return require('crypto').randomBytes(1)[0];
      });

      FS.createDevice('/dev', 'random', random_device);
      FS.createDevice('/dev', 'urandom', random_device);
      FS.mkdir('/dev/shm');
      FS.mkdir('/dev/shm/tmp');
    }),

    createStandardStreams: (function() {
      if (Module['stdin']) {
        FS.createDevice('/dev', 'stdin', Module['stdin']);
      } else {
        FS.symlink('/dev/tty', '/dev/stdin');
      }

      if (Module['stdout']) {
        FS.createDevice('/dev', 'stdout', null, Module['stdout']);
      } else {
        FS.symlink('/dev/tty', '/dev/stdout');
      }

      if (Module['stderr']) {
        FS.createDevice('/dev', 'stderr', null, Module['stderr']);
      } else {
        FS.symlink('/dev/tty1', '/dev/stderr');
      }

      var stdin = FS.open('/dev/stdin', 'r');
      HEAP32[_stdin >> 2] = FS.getPtrForStream(stdin);
      assert(stdin.fd === 0, 'invalid handle for stdin (' + stdin.fd + ')');
      var stdout = FS.open('/dev/stdout', 'w');
      HEAP32[_stdout >> 2] = FS.getPtrForStream(stdout);
      assert(stdout.fd === 1, 'invalid handle for stdout (' + stdout.fd + ')');
      var stderr = FS.open('/dev/stderr', 'w');
      HEAP32[_stderr >> 2] = FS.getPtrForStream(stderr);
      assert(stderr.fd === 2, 'invalid handle for stderr (' + stderr.fd + ')');
    }),

    ensureErrnoError: (function() {
      if (FS.ErrnoError) return;
      FS.ErrnoError = function ErrnoError(errno, node) {
        this.node = node;
        this.setErrno = (function(errno) {
          this.errno = errno;
          for (var key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === errno) {
              this.code = key;
              break;
            }
          }
        });

        this.setErrno(errno);
        this.message = ERRNO_MESSAGES[errno];
      };

      FS.ErrnoError.prototype = new Error;
      FS.ErrnoError.prototype.constructor = FS.ErrnoError;
      [ERRNO_CODES.ENOENT].forEach((function(code) {
        FS.genericErrors[code] = new FS.ErrnoError(code);
        FS.genericErrors[code].stack = '<generic error, no stack>';
      }));
    }),

    staticInit: (function() {
      FS.ensureErrnoError();
      FS.nameTable = new Array(4096);
      FS.mount(MEMFS, {}, '/');
      FS.createDefaultDirectories();
      FS.createDefaultDevices();
    }),

    init: (function(input, output, error) {
      assert(!FS.init.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
      FS.init.initialized = true;
      FS.ensureErrnoError();
      Module['stdin'] = input || Module['stdin'];
      Module['stdout'] = output || Module['stdout'];
      Module['stderr'] = error || Module['stderr'];
      FS.createStandardStreams();
    }),

    quit: (function() {
      FS.init.initialized = false;
      for (var i = 0; i < FS.streams.length; i++) {
        var stream = FS.streams[i];
        if (!stream) {
          continue;
        }

        FS.close(stream);
      }
    }),

    getMode: (function(canRead, canWrite) {
      var mode = 0;
      if (canRead) mode |= 292 | 73;
      if (canWrite) mode |= 146;
      return mode;
    }),

    joinPath: (function(parts, forceRelative) {
      var path = PATH.join.apply(null, parts);
      if (forceRelative && path[0] == '/') path = path.substr(1);
      return path;
    }),

    absolutePath: (function(relative, base) {
      return PATH.resolve(base, relative);
    }),

    standardizePath: (function(path) {
      return PATH.normalize(path);
    }),

    findObject: (function(path, dontResolveLastLink) {
      var ret = FS.analyzePath(path, dontResolveLastLink);
      if (ret.exists) {
        return ret.object;
      } else {
        ___setErrNo(ret.error);
        return null;
      }
    }),

    analyzePath: (function(path, dontResolveLastLink) {
      try {
        var lookup = FS.lookupPath(path, {
          follow: !dontResolveLastLink
        });
        path = lookup.path;
      } catch (e) {}
      var ret = {
        isRoot: false,
        exists: false,
        error: 0,
        name: null,
        path: null,
        object: null,
        parentExists: false,
        parentPath: null,
        parentObject: null
      };
      try {
        var lookup = FS.lookupPath(path, {
          parent: true
        });
        ret.parentExists = true;
        ret.parentPath = lookup.path;
        ret.parentObject = lookup.node;
        ret.name = PATH.basename(path);
        lookup = FS.lookupPath(path, {
          follow: !dontResolveLastLink
        });
        ret.exists = true;
        ret.path = lookup.path;
        ret.object = lookup.node;
        ret.name = lookup.node.name;
        ret.isRoot = lookup.path === '/';
      } catch (e) {
        ret.error = e.errno;
      }
      return ret;
    }),

    createFolder: (function(parent, name, canRead, canWrite) {
      var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      var mode = FS.getMode(canRead, canWrite);
      return FS.mkdir(path, mode);
    }),

    createPath: (function(parent, path, canRead, canWrite) {
      parent = typeof parent === 'string' ? parent : FS.getPath(parent);
      var parts = path.split('/').reverse();
      while (parts.length) {
        var part = parts.pop();
        if (!part) continue;
        var current = PATH.join2(parent, part);
        try {
          FS.mkdir(current);
        } catch (e) {}
        parent = current;
      }

      return current;
    }),

    createFile: (function(parent, name, properties, canRead, canWrite) {
      var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      var mode = FS.getMode(canRead, canWrite);
      return FS.create(path, mode);
    }),

    createDataFile: (function(parent, name, data, canRead, canWrite, canOwn) {
      var path = name ? PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name) : parent;
      var mode = FS.getMode(canRead, canWrite);
      var node = FS.create(path, mode);
      if (data) {
        if (typeof data === 'string') {
          var arr = new Array(data.length);
          for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
          data = arr;
        }

        FS.chmod(node, mode | 146);
        var stream = FS.open(node, 'w');
        FS.write(stream, data, 0, data.length, 0, canOwn);
        FS.close(stream);
        FS.chmod(node, mode);
      }

      return node;
    }),

    createDevice: (function(parent, name, input, output) {
      var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      var mode = FS.getMode(!!input, !!output);
      if (!FS.createDevice.major) FS.createDevice.major = 64;
      var dev = FS.makedev(FS.createDevice.major++, 0);
      FS.registerDevice(dev, {
        open: (function(stream) {
          stream.seekable = false;
        }),

        close: (function(stream) {
          if (output && output.buffer && output.buffer.length) {
            output(10);
          }
        }),

        read: (function(stream, buffer, offset, length, pos) {
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = input();
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }

            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset + i] = result;
          }

          if (bytesRead) {
            stream.node.timestamp = Date.now();
          }

          return bytesRead;
        }),

        write: (function(stream, buffer, offset, length, pos) {
          for (var i = 0; i < length; i++) {
            try {
              output(buffer[offset + i]);
            } catch (e) {
              throw new FS.ErrnoError(ERRNO_CODES.EIO);
            }
          }

          if (length) {
            stream.node.timestamp = Date.now();
          }

          return i;
        })
      });
      return FS.mkdev(path, mode, dev);
    }),

    createLink: (function(parent, name, target, canRead, canWrite) {
      var path = PATH.join2(typeof parent === 'string' ? parent : FS.getPath(parent), name);
      return FS.symlink(target, path);
    }),

    forceLoadFile: (function(obj) {
      if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
      var success = true;
      if (typeof XMLHttpRequest !== 'undefined') {
        throw new Error('Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.');
      } else if (Module['read']) {
        try {
          obj.contents = intArrayFromString(Module['read'](obj.url), true);
          obj.usedBytes = obj.contents.length;
        } catch (e) {
          success = false;
        }
      } else {
        throw new Error('Cannot load without read() or XMLHttpRequest.');
      }

      if (!success) ___setErrNo(ERRNO_CODES.EIO);
      return success;
    }),

    createLazyFile: (function(parent, name, url, canRead, canWrite) {
      function LazyUint8Array() {
        this.lengthKnown = false;
        this.chunks = [];
      }

      LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
        if (idx > this.length - 1 || idx < 0) {
          return undefined;
        }

        var chunkOffset = idx % this.chunkSize;
        var chunkNum = idx / this.chunkSize | 0;
        return this.getter(chunkNum)[chunkOffset];
      };

      LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
        this.getter = getter;
      };

      LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
        var xhr = new XMLHttpRequest;
        xhr.open('HEAD', url, false);
        xhr.send(null);
        if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + '. Status: ' + xhr.status);
        var datalength = Number(xhr.getResponseHeader('Content-length'));
        var header;
        var hasByteServing = (header = xhr.getResponseHeader('Accept-Ranges')) && header === 'bytes';
        var chunkSize = 1024 * 1024;
        if (!hasByteServing) chunkSize = datalength;
        var doXHR = (function(from, to) {
          if (from > to) throw new Error('invalid range (' + from + ', ' + to + ') or no bytes requested!');
          if (to > datalength - 1) throw new Error('only ' + datalength + ' bytes available! programmer error!');
          var xhr = new XMLHttpRequest;
          xhr.open('GET', url, false);
          if (datalength !== chunkSize) xhr.setRequestHeader('Range', 'bytes=' + from + '-' + to);
          if (typeof Uint8Array != 'undefined') xhr.responseType = 'arraybuffer';
          if (xhr.overrideMimeType) {
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
          }

          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + '. Status: ' + xhr.status);
          if (xhr.response !== undefined) {
            return new Uint8Array(xhr.response || []);
          } else {
            return intArrayFromString(xhr.responseText || '', true);
          }
        });

        var lazyArray = this;
        lazyArray.setDataGetter((function(chunkNum) {
          var start = chunkNum * chunkSize;
          var end = (chunkNum + 1) * chunkSize - 1;
          end = Math.min(end, datalength - 1);
          if (typeof lazyArray.chunks[chunkNum] === 'undefined') {
            lazyArray.chunks[chunkNum] = doXHR(start, end);
          }

          if (typeof lazyArray.chunks[chunkNum] === 'undefined') throw new Error('doXHR failed!');
          return lazyArray.chunks[chunkNum];
        }));

        this._length = datalength;
        this._chunkSize = chunkSize;
        this.lengthKnown = true;
      };

      if (typeof XMLHttpRequest !== 'undefined') {
        if (!ENVIRONMENT_IS_WORKER) throw 'Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc';
        var lazyArray = new LazyUint8Array;
        Object.defineProperty(lazyArray, 'length', {
          get: (function() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }

            return this._length;
          })
        });
        Object.defineProperty(lazyArray, 'chunkSize', {
          get: (function() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }

            return this._chunkSize;
          })
        });
        var properties = {
          isDevice: false,
          contents: lazyArray
        };
      } else {
        var properties = {
          isDevice: false,
          url: url
        };
      }

      var node = FS.createFile(parent, name, properties, canRead, canWrite);
      if (properties.contents) {
        node.contents = properties.contents;
      } else if (properties.url) {
        node.contents = null;
        node.url = properties.url;
      }

      Object.defineProperty(node, 'usedBytes', {
        get: (function() {
          return this.contents.length;
        })
      });
      var stream_ops = {};
      var keys = Object.keys(node.stream_ops);
      keys.forEach((function(key) {
        var fn = node.stream_ops[key];
        stream_ops[key] = function forceLoadLazyFile() {
          if (!FS.forceLoadFile(node)) {
            throw new FS.ErrnoError(ERRNO_CODES.EIO);
          }

          return fn.apply(null, arguments);
        };
      }));

      stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
        if (!FS.forceLoadFile(node)) {
          throw new FS.ErrnoError(ERRNO_CODES.EIO);
        }

        var contents = stream.node.contents;
        if (position >= contents.length) return 0;
        var size = Math.min(contents.length - position, length);
        assert(size >= 0);
        if (contents.slice) {
          for (var i = 0; i < size; i++) {
            buffer[offset + i] = contents[position + i];
          }
        } else {
          for (var i = 0; i < size; i++) {
            buffer[offset + i] = contents.get(position + i);
          }
        }

        return size;
      };

      node.stream_ops = stream_ops;
      return node;
    }),

    createPreloadedFile: (function(parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn) {
      Browser.init();
      var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;

      function processData(byteArray) {
        function finish(byteArray) {
          if (!dontCreateFile) {
            FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
          }

          if (onload) onload();
          removeRunDependency('cp ' + fullname);
        }

        var handled = false;
        Module['preloadPlugins'].forEach((function(plugin) {
          if (handled) return;
          if (plugin['canHandle'](fullname)) {
            plugin['handle'](byteArray, fullname, finish, (function() {
              if (onerror) onerror();
              removeRunDependency('cp ' + fullname);
            }));

            handled = true;
          }
        }));

        if (!handled) finish(byteArray);
      }

      addRunDependency('cp ' + fullname);
      if (typeof url == 'string') {
        Browser.asyncLoad(url, (function(byteArray) {
          processData(byteArray);
        }), onerror);
      } else {
        processData(url);
      }
    }),

    indexedDB: (function() {
      return window.indexedDB || window.webkitIndexedDB;
    }),

    DB_NAME: (function() {
      return 'EM_FS_' + window.location.pathname;
    }),

    DB_VERSION: 20,
    DB_STORE_NAME: 'FILE_DATA',
    saveFilesToDB: (function(paths, onload, onerror) {
      onload = onload || (function() {});

      onerror = onerror || (function() {});

      var indexedDB = FS.indexedDB();
      try {
        var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
      } catch (e) {
        return onerror(e);
      }
      openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
        console.log('creating db');
        var db = openRequest.result;
        db.createObjectStore(FS.DB_STORE_NAME);
      };

      openRequest.onsuccess = function openRequest_onsuccess() {
        var db = openRequest.result;
        var transaction = db.transaction([FS.DB_STORE_NAME], 'readwrite');
        var files = transaction.objectStore(FS.DB_STORE_NAME);
        var ok = 0,
          fail = 0,
          total = paths.length;

        function finish() {
          if (fail == 0) onload();
          else onerror();
        }

        paths.forEach((function(path) {
          var putRequest = files.put(FS.analyzePath(path).object.contents, path);
          putRequest.onsuccess = function putRequest_onsuccess() {
            ok++;
            if (ok + fail == total) finish();
          };

          putRequest.onerror = function putRequest_onerror() {
            fail++;
            if (ok + fail == total) finish();
          };
        }));

        transaction.onerror = onerror;
      };

      openRequest.onerror = onerror;
    }),

    loadFilesFromDB: (function(paths, onload, onerror) {
      onload = onload || (function() {});

      onerror = onerror || (function() {});

      var indexedDB = FS.indexedDB();
      try {
        var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
      } catch (e) {
        return onerror(e);
      }
      openRequest.onupgradeneeded = onerror;
      openRequest.onsuccess = function openRequest_onsuccess() {
        var db = openRequest.result;
        try {
          var transaction = db.transaction([FS.DB_STORE_NAME], 'readonly');
        } catch (e) {
          onerror(e);
          return;
        }
        var files = transaction.objectStore(FS.DB_STORE_NAME);
        var ok = 0,
          fail = 0,
          total = paths.length;

        function finish() {
          if (fail == 0) onload();
          else onerror();
        }

        paths.forEach((function(path) {
          var getRequest = files.get(path);
          getRequest.onsuccess = function getRequest_onsuccess() {
            if (FS.analyzePath(path).exists) {
              FS.unlink(path);
            }

            FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
            ok++;
            if (ok + fail == total) finish();
          };

          getRequest.onerror = function getRequest_onerror() {
            fail++;
            if (ok + fail == total) finish();
          };
        }));

        transaction.onerror = onerror;
      };

      openRequest.onerror = onerror;
    })
  };

  function _close(fildes) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      FS.close(stream);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fsync(fildes) {
    var stream = FS.getStream(fildes);
    if (stream) {
      return 0;
    } else {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }
  }

  function _fileno(stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) return -1;
    return stream.fd;
  }

  function _fclose(stream) {
    var fd = _fileno(stream);
    _fsync(fd);
    return _close(fd);
  }

  function _eglWaitClient() {
    EGL.setErrorCode(12288);
    return 1;
  }

  var EGL = {
    errorCode: 12288,
    defaultDisplayInitialized: false,
    currentContext: 0,
    currentReadSurface: 0,
    currentDrawSurface: 0,
    stringCache: {},
    setErrorCode: (function(code) {
      EGL.errorCode = code;
    }),

    chooseConfig: (function(display, attribList, config, config_size, numConfigs) {
      if (display != 62e3) {
        EGL.setErrorCode(12296);
        return 0;
      }

      if ((!config || !config_size) && !numConfigs) {
        EGL.setErrorCode(12300);
        return 0;
      }

      if (numConfigs) {
        HEAP32[numConfigs >> 2] = 1;
      }

      if (config && config_size > 0) {
        HEAP32[config >> 2] = 62002;
      }

      EGL.setErrorCode(12288);
      return 1;
    })
  };

  function _eglTerminate(display) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    EGL.currentContext = 0;
    EGL.currentReadSurface = 0;
    EGL.currentDrawSurface = 0;
    EGL.defaultDisplayInitialized = false;
    EGL.setErrorCode(12288);
    return 1;
  }

  function _emscripten_glStencilMask(x0) {
    GLctx.stencilMask(x0);
  }

  function _pthread_mutex_lock() {}

  function _emscripten_set_mouseleave_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 34, 'mouseleave');
    return 0;
  }

  function _emscripten_glStencilFunc(x0, x1, x2) {
    GLctx.stencilFunc(x0, x1, x2);
  }

  function _mkport() {
    throw 'TODO';
  }

  var SOCKFS = {
    mount: (function(mount) {
      Module['websocket'] = Module['websocket'] && 'object' === typeof Module['websocket'] ? Module['websocket'] : {};
      Module['websocket']._callbacks = {};
      Module['websocket']['on'] = (function(event, callback) {
        if ('function' === typeof callback) {
          this._callbacks[event] = callback;
        }

        return this;
      });

      Module['websocket'].emit = (function(event, param) {
        if ('function' === typeof this._callbacks[event]) {
          this._callbacks[event].call(this, param);
        }
      });

      return FS.createNode(null, '/', 16384 | 511, 0);
    }),

    createSocket: (function(family, type, protocol) {
      var streaming = type == 1;
      if (protocol) {
        assert(streaming == (protocol == 6));
      }

      var sock = {
        family: family,
        type: type,
        protocol: protocol,
        server: null,
        error: null,
        peers: {},
        pending: [],
        recv_queue: [],
        sock_ops: SOCKFS.websocket_sock_ops
      };
      var name = SOCKFS.nextname();
      var node = FS.createNode(SOCKFS.root, name, 49152, 0);
      node.sock = sock;
      var stream = FS.createStream({
        path: name,
        node: node,
        flags: FS.modeStringToFlags('r+'),
        seekable: false,
        stream_ops: SOCKFS.stream_ops
      });
      sock.stream = stream;
      return sock;
    }),

    getSocket: (function(fd) {
      var stream = FS.getStream(fd);
      if (!stream || !FS.isSocket(stream.node.mode)) {
        return null;
      }

      return stream.node.sock;
    }),

    stream_ops: {
      poll: (function(stream) {
        var sock = stream.node.sock;
        return sock.sock_ops.poll(sock);
      }),

      ioctl: (function(stream, request, varargs) {
        var sock = stream.node.sock;
        return sock.sock_ops.ioctl(sock, request, varargs);
      }),

      read: (function(stream, buffer, offset, length, position) {
        var sock = stream.node.sock;
        var msg = sock.sock_ops.recvmsg(sock, length);
        if (!msg) {
          return 0;
        }

        buffer.set(msg.buffer, offset);
        return msg.buffer.length;
      }),

      write: (function(stream, buffer, offset, length, position) {
        var sock = stream.node.sock;
        return sock.sock_ops.sendmsg(sock, buffer, offset, length);
      }),

      close: (function(stream) {
        var sock = stream.node.sock;
        sock.sock_ops.close(sock);
      })
    },
    nextname: (function() {
      if (!SOCKFS.nextname.current) {
        SOCKFS.nextname.current = 0;
      }

      return 'socket[' + SOCKFS.nextname.current++ + ']';
    }),

    websocket_sock_ops: {
      createPeer: (function(sock, addr, port) {
        var ws;
        if (typeof addr === 'object') {
          ws = addr;
          addr = null;
          port = null;
        }

        if (ws) {
          if (ws._socket) {
            addr = ws._socket.remoteAddress;
            port = ws._socket.remotePort;
          } else {
            var result = /ws[s]?:\/\/([^:]+):(\d+)/.exec(ws.url);
            if (!result) {
              throw new Error('WebSocket URL must be in the format ws(s)://address:port');
            }

            addr = result[1];
            port = parseInt(result[2], 10);
          }
        } else {
          try {
            var runtimeConfig = Module['websocket'] && 'object' === typeof Module['websocket'];
            var url = 'ws:#'.replace('#', '//');
            if (runtimeConfig) {
              if ('string' === typeof Module['websocket']['url']) {
                url = Module['websocket']['url'];
              }
            }

            if (url === 'ws://' || url === 'wss://') {
              var parts = addr.split('/');
              url = url + parts[0] + ':' + port + '/' + parts.slice(1).join('/');
            }

            var subProtocols = 'binary';
            if (runtimeConfig) {
              if ('string' === typeof Module['websocket']['subprotocol']) {
                subProtocols = Module['websocket']['subprotocol'];
              }
            }

            subProtocols = subProtocols.replace(/^ +| +$/g, '').split(/ *, */);
            var opts = {
              protocol: subProtocols.toString()
            };
            var WebSocket = require('ws');
            ws = new WebSocket(url, opts);
            ws.binaryType = 'arraybuffer';
          } catch (e) {
            throw new FS.ErrnoError(ERRNO_CODES.EHOSTUNREACH);
          }
        }

        var peer = {
          addr: addr,
          port: port,
          socket: ws,
          dgram_send_queue: []
        };
        SOCKFS.websocket_sock_ops.addPeer(sock, peer);
        SOCKFS.websocket_sock_ops.handlePeerEvents(sock, peer);
        if (sock.type === 2 && typeof sock.sport !== 'undefined') {
          peer.dgram_send_queue.push(new Uint8Array([255, 255, 255, 255, 'p'.charCodeAt(0), 'o'.charCodeAt(0), 'r'.charCodeAt(0), 't'.charCodeAt(0), (sock.sport & 65280) >> 8, sock.sport & 255]));
        }

        return peer;
      }),

      getPeer: (function(sock, addr, port) {
        return sock.peers[addr + ':' + port];
      }),

      addPeer: (function(sock, peer) {
        sock.peers[peer.addr + ':' + peer.port] = peer;
      }),

      removePeer: (function(sock, peer) {
        delete sock.peers[peer.addr + ':' + peer.port];
      }),

      handlePeerEvents: (function(sock, peer) {
        var first = true;
        var handleOpen = (function() {
          Module['websocket'].emit('open', sock.stream.fd);
          try {
            var queued = peer.dgram_send_queue.shift();
            while (queued) {
              peer.socket.send(queued);
              queued = peer.dgram_send_queue.shift();
            }
          } catch (e) {
            peer.socket.close();
          }
        });

        function handleMessage(data) {
          assert(typeof data !== 'string' && data.byteLength !== undefined);
          data = new Uint8Array(data);
          var wasfirst = first;
          first = false;
          if (wasfirst && data.length === 10 && data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255 && data[4] === 'p'.charCodeAt(0) && data[5] === 'o'.charCodeAt(0) && data[6] === 'r'.charCodeAt(0) && data[7] === 't'.charCodeAt(0)) {
            var newport = data[8] << 8 | data[9];
            SOCKFS.websocket_sock_ops.removePeer(sock, peer);
            peer.port = newport;
            SOCKFS.websocket_sock_ops.addPeer(sock, peer);
            return;
          }

          sock.recv_queue.push({
            addr: peer.addr,
            port: peer.port,
            data: data
          });
          Module['websocket'].emit('message', sock.stream.fd);
        }

        peer.socket.on('open', handleOpen);
        peer.socket.on('message', (function(data, flags) {
          if (!flags.binary) {
            return;
          }

          handleMessage((new Uint8Array(data)).buffer);
        }));

        peer.socket.on('close', (function() {
          Module['websocket'].emit('close', sock.stream.fd);
        }));

        peer.socket.on('error', (function(error) {
          sock.error = ERRNO_CODES.ECONNREFUSED;
          Module['websocket'].emit('error', [sock.stream.fd, sock.error, 'ECONNREFUSED: Connection refused']);
        }));
      }),

      poll: (function(sock) {
        if (sock.type === 1 && sock.server) {
          return sock.pending.length ? 64 | 1 : 0;
        }

        var mask = 0;
        var dest = sock.type === 1 ? SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport) : null;
        if (sock.recv_queue.length || !dest || dest && dest.socket.readyState === dest.socket.CLOSING || dest && dest.socket.readyState === dest.socket.CLOSED) {
          mask |= 64 | 1;
        }

        if (!dest || dest && dest.socket.readyState === dest.socket.OPEN) {
          mask |= 4;
        }

        if (dest && dest.socket.readyState === dest.socket.CLOSING || dest && dest.socket.readyState === dest.socket.CLOSED) {
          mask |= 16;
        }

        return mask;
      }),

      ioctl: (function(sock, request, arg) {
        switch (request) {
          case 21531:
            var bytes = 0;
            if (sock.recv_queue.length) {
              bytes = sock.recv_queue[0].data.length;
            }

            HEAP32[arg >> 2] = bytes;
            return 0;
          default:
            return ERRNO_CODES.EINVAL;
        }
      }),

      close: (function(sock) {
        if (sock.server) {
          try {
            sock.server.close();
          } catch (e) {}
          sock.server = null;
        }

        var peers = Object.keys(sock.peers);
        for (var i = 0; i < peers.length; i++) {
          var peer = sock.peers[peers[i]];
          try {
            peer.socket.close();
          } catch (e) {}
          SOCKFS.websocket_sock_ops.removePeer(sock, peer);
        }

        return 0;
      }),

      bind: (function(sock, addr, port) {
        if (typeof sock.saddr !== 'undefined' || typeof sock.sport !== 'undefined') {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        sock.saddr = addr;
        sock.sport = port || _mkport();
        if (sock.type === 2) {
          if (sock.server) {
            sock.server.close();
            sock.server = null;
          }

          try {
            sock.sock_ops.listen(sock, 0);
          } catch (e) {
            if (!(e instanceof FS.ErrnoError)) throw e;
            if (e.errno !== ERRNO_CODES.EOPNOTSUPP) throw e;
          }
        }
      }),

      connect: (function(sock, addr, port) {
        if (sock.server) {
          throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
        }

        if (typeof sock.daddr !== 'undefined' && typeof sock.dport !== 'undefined') {
          var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
          if (dest) {
            if (dest.socket.readyState === dest.socket.CONNECTING) {
              throw new FS.ErrnoError(ERRNO_CODES.EALREADY);
            } else {
              throw new FS.ErrnoError(ERRNO_CODES.EISCONN);
            }
          }
        }

        var peer = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
        sock.daddr = peer.addr;
        sock.dport = peer.port;
        throw new FS.ErrnoError(ERRNO_CODES.EINPROGRESS);
      }),

      listen: (function(sock, backlog) {
        if (sock.server) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        var WebSocketServer = require('ws').Server;
        var host = sock.saddr;
        sock.server = new WebSocketServer({
          host: host,
          port: sock.sport
        });
        Module['websocket'].emit('listen', sock.stream.fd);
        sock.server.on('connection', (function(ws) {
          if (sock.type === 1) {
            var newsock = SOCKFS.createSocket(sock.family, sock.type, sock.protocol);
            var peer = SOCKFS.websocket_sock_ops.createPeer(newsock, ws);
            newsock.daddr = peer.addr;
            newsock.dport = peer.port;
            sock.pending.push(newsock);
            Module['websocket'].emit('connection', newsock.stream.fd);
          } else {
            SOCKFS.websocket_sock_ops.createPeer(sock, ws);
            Module['websocket'].emit('connection', sock.stream.fd);
          }
        }));

        sock.server.on('closed', (function() {
          Module['websocket'].emit('close', sock.stream.fd);
          sock.server = null;
        }));

        sock.server.on('error', (function(error) {
          sock.error = ERRNO_CODES.EHOSTUNREACH;
          Module['websocket'].emit('error', [sock.stream.fd, sock.error, 'EHOSTUNREACH: Host is unreachable']);
        }));
      }),

      accept: (function(listensock) {
        if (!listensock.server) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }

        var newsock = listensock.pending.shift();
        newsock.stream.flags = listensock.stream.flags;
        return newsock;
      }),

      getname: (function(sock, peer) {
        var addr, port;
        if (peer) {
          if (sock.daddr === undefined || sock.dport === undefined) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
          }

          addr = sock.daddr;
          port = sock.dport;
        } else {
          addr = sock.saddr || 0;
          port = sock.sport || 0;
        }

        return {
          addr: addr,
          port: port
        };
      }),

      sendmsg: (function(sock, buffer, offset, length, addr, port) {
        if (sock.type === 2) {
          if (addr === undefined || port === undefined) {
            addr = sock.daddr;
            port = sock.dport;
          }

          if (addr === undefined || port === undefined) {
            throw new FS.ErrnoError(ERRNO_CODES.EDESTADDRREQ);
          }
        } else {
          addr = sock.daddr;
          port = sock.dport;
        }

        var dest = SOCKFS.websocket_sock_ops.getPeer(sock, addr, port);
        if (sock.type === 1) {
          if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
            throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
          } else if (dest.socket.readyState === dest.socket.CONNECTING) {
            throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
          }
        }

        var data;
        if (buffer instanceof Array || buffer instanceof ArrayBuffer) {
          data = buffer.slice(offset, offset + length);
        } else {
          data = buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length);
        }

        if (sock.type === 2) {
          if (!dest || dest.socket.readyState !== dest.socket.OPEN) {
            if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
              dest = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
            }

            dest.dgram_send_queue.push(data);
            return length;
          }
        }

        try {
          dest.socket.send(data);
          return length;
        } catch (e) {
          throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        }
      }),

      recvmsg: (function(sock, length) {
        if (sock.type === 1 && sock.server) {
          throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
        }

        var queued = sock.recv_queue.shift();
        if (!queued) {
          if (sock.type === 1) {
            var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
            if (!dest) {
              throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
            } else if (dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
              return null;
            } else {
              throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
            }
          } else {
            throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
          }
        }

        var queuedLength = queued.data.byteLength || queued.data.length;
        var queuedOffset = queued.data.byteOffset || 0;
        var queuedBuffer = queued.data.buffer || queued.data;
        var bytesRead = Math.min(length, queuedLength);
        var res = {
          buffer: new Uint8Array(queuedBuffer, queuedOffset, bytesRead),
          addr: queued.addr,
          port: queued.port
        };
        if (sock.type === 1 && bytesRead < queuedLength) {
          var bytesRemaining = queuedLength - bytesRead;
          queued.data = new Uint8Array(queuedBuffer, queuedOffset + bytesRead, bytesRemaining);
          sock.recv_queue.unshift(queued);
        }

        return res;
      })
    }
  };

  function _send(fd, buf, len, flags) {
    var sock = SOCKFS.getSocket(fd);
    if (!sock) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    return _write(fd, buf, len);
  }

  function _pwrite(fildes, buf, nbyte, offset) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      var slab = HEAP8;
      return FS.write(stream, slab, buf, nbyte, offset);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _write(fildes, buf, nbyte) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      var slab = HEAP8;
      return FS.write(stream, slab, buf, nbyte);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fputc(c, stream) {
    var chr = unSign(c & 255);
    HEAP8[_fputc.ret >> 0] = chr;
    var fd = _fileno(stream);
    var ret = _write(fd, _fputc.ret, 1);
    if (ret == -1) {
      var streamObj = FS.getStreamFromPtr(stream);
      if (streamObj) streamObj.error = true;
      return -1;
    } else {
      return chr;
    }
  }

  function _emscripten_glVertexPointer() {
    throw 'Legacy GL function(glVertexPointer) called. If you want legacy GL emulation, you need to compile with -s LEGACY_GL_EMULATION=1 to enable legacy GL emulation.';
  }

  function _emscripten_glUniform3iv(location, count, value) {
    location = GL.uniforms[location];
    count *= 3;
    value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
    GLctx.uniform3iv(location, value);
  }

  function _emscripten_glShaderSource(shader, count, string, length) {
    var source = GL.getSource(shader, count, string, length);
    GLctx.shaderSource(GL.shaders[shader], source);
  }

  var _llvm_pow_f32 = Math_pow;
  Module['_strlen'] = _strlen;

  function _fputs(s, stream) {
    var fd = _fileno(stream);
    return _write(fd, s, _strlen(s));
  }

  function _emscripten_glIsTexture(texture) {
    var texture = GL.textures[texture];
    if (!texture) return 0;
    return GLctx.isTexture(texture);
  }

  function _emscripten_glTexParameterf(x0, x1, x2) {
    GLctx.texParameterf(x0, x1, x2);
  }

  function _dlerror() {
    if (DLFCN.errorMsg === null) {
      return 0;
    } else {
      if (DLFCN.error) _free(DLFCN.error);
      var msgArr = intArrayFromString(DLFCN.errorMsg);
      DLFCN.error = allocate(msgArr, 'i8', ALLOC_NORMAL);
      DLFCN.errorMsg = null;
      return DLFCN.error;
    }
  }

  function _ftime(p) {
    var millis = Date.now();
    HEAP32[p >> 2] = millis / 1e3 | 0;
    HEAP16[p + 4 >> 1] = millis % 1e3;
    HEAP16[p + 6 >> 1] = 0;
    HEAP16[p + 8 >> 1] = 0;
    return 0;
  }

  function _eglWaitGL() {
    return _eglWaitClient.apply(null, arguments);
  }

  function _stat(path, buf, dontResolveLastLink) {
    path = typeof path !== 'string' ? Pointer_stringify(path) : path;
    try {
      var stat = dontResolveLastLink ? FS.lstat(path) : FS.stat(path);
      HEAP32[buf >> 2] = stat.dev;
      HEAP32[buf + 4 >> 2] = 0;
      HEAP32[buf + 8 >> 2] = stat.ino;
      HEAP32[buf + 12 >> 2] = stat.mode;
      HEAP32[buf + 16 >> 2] = stat.nlink;
      HEAP32[buf + 20 >> 2] = stat.uid;
      HEAP32[buf + 24 >> 2] = stat.gid;
      HEAP32[buf + 28 >> 2] = stat.rdev;
      HEAP32[buf + 32 >> 2] = 0;
      HEAP32[buf + 36 >> 2] = stat.size;
      HEAP32[buf + 40 >> 2] = 4096;
      HEAP32[buf + 44 >> 2] = stat.blocks;
      HEAP32[buf + 48 >> 2] = stat.atime.getTime() / 1e3 | 0;
      HEAP32[buf + 52 >> 2] = 0;
      HEAP32[buf + 56 >> 2] = stat.mtime.getTime() / 1e3 | 0;
      HEAP32[buf + 60 >> 2] = 0;
      HEAP32[buf + 64 >> 2] = stat.ctime.getTime() / 1e3 | 0;
      HEAP32[buf + 68 >> 2] = 0;
      HEAP32[buf + 72 >> 2] = stat.ino;
      return 0;
    } catch (e) {
      if (e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
        e.setErrno(ERRNO_CODES.ENOTDIR);
      }
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fstat(fildes, buf) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    return _stat(stream.path, buf);
  }

  var ___tm_current = allocate(44, 'i8', ALLOC_STATIC);
  var ___tm_timezone = allocate(intArrayFromString('GMT'), 'i8', ALLOC_STATIC);
  var _tzname = allocate(8, 'i32*', ALLOC_STATIC);
  var _daylight = allocate(1, 'i32*', ALLOC_STATIC);
  var _timezone = allocate(1, 'i32*', ALLOC_STATIC);

  function _tzset() {
    if (_tzset.called) return;
    _tzset.called = true;
    HEAP32[_timezone >> 2] = -(new Date).getTimezoneOffset() * 60;
    var winter = new Date(2e3, 0, 1);
    var summer = new Date(2e3, 6, 1);
    HEAP32[_daylight >> 2] = Number(winter.getTimezoneOffset() != summer.getTimezoneOffset());

    function extractZone(date) {
      var match = date.toTimeString().match(/\(([A-Za-z ]+)\)$/);
      return match ? match[1] : 'GMT';
    }

    var winterName = extractZone(winter);
    var summerName = extractZone(summer);
    var winterNamePtr = allocate(intArrayFromString(winterName), 'i8', ALLOC_NORMAL);
    var summerNamePtr = allocate(intArrayFromString(summerName), 'i8', ALLOC_NORMAL);
    if (summer.getTimezoneOffset() < winter.getTimezoneOffset()) {
      HEAP32[_tzname >> 2] = winterNamePtr;
      HEAP32[_tzname + 4 >> 2] = summerNamePtr;
    } else {
      HEAP32[_tzname >> 2] = summerNamePtr;
      HEAP32[_tzname + 4 >> 2] = winterNamePtr;
    }
  }

  function _localtime_r(time, tmPtr) {
    _tzset();
    var date = new Date(HEAP32[time >> 2] * 1e3);
    HEAP32[tmPtr >> 2] = date.getSeconds();
    HEAP32[tmPtr + 4 >> 2] = date.getMinutes();
    HEAP32[tmPtr + 8 >> 2] = date.getHours();
    HEAP32[tmPtr + 12 >> 2] = date.getDate();
    HEAP32[tmPtr + 16 >> 2] = date.getMonth();
    HEAP32[tmPtr + 20 >> 2] = date.getFullYear() - 1900;
    HEAP32[tmPtr + 24 >> 2] = date.getDay();
    var start = new Date(date.getFullYear(), 0, 1);
    var yday = (date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24) | 0;
    HEAP32[tmPtr + 28 >> 2] = yday;
    HEAP32[tmPtr + 36 >> 2] = -(date.getTimezoneOffset() * 60);
    var summerOffset = (new Date(2e3, 6, 1)).getTimezoneOffset();
    var winterOffset = start.getTimezoneOffset();
    var dst = date.getTimezoneOffset() == Math.min(winterOffset, summerOffset) | 0;
    HEAP32[tmPtr + 32 >> 2] = dst;
    var zonePtr = HEAP32[_tzname + (dst ? Runtime.QUANTUM_SIZE : 0) >> 2];
    HEAP32[tmPtr + 40 >> 2] = zonePtr;
    return tmPtr;
  }

  function _localtime(time) {
    return _localtime_r(time, ___tm_current);
  }

  function _emscripten_glUniform4f(location, v0, v1, v2, v3) {
    location = GL.uniforms[location];
    GLctx.uniform4f(location, v0, v1, v2, v3);
  }

  function _sysconf(name) {
    switch (name) {
      case 30:
        return PAGE_SIZE;
      case 132:
      case 133:
      case 12:
      case 137:
      case 138:
      case 15:
      case 235:
      case 16:
      case 17:
      case 18:
      case 19:
      case 20:
      case 149:
      case 13:
      case 10:
      case 236:
      case 153:
      case 9:
      case 21:
      case 22:
      case 159:
      case 154:
      case 14:
      case 77:
      case 78:
      case 139:
      case 80:
      case 81:
      case 79:
      case 82:
      case 68:
      case 67:
      case 164:
      case 11:
      case 29:
      case 47:
      case 48:
      case 95:
      case 52:
      case 51:
      case 46:
        return 200809;
      case 27:
      case 246:
      case 127:
      case 128:
      case 23:
      case 24:
      case 160:
      case 161:
      case 181:
      case 182:
      case 242:
      case 183:
      case 184:
      case 243:
      case 244:
      case 245:
      case 165:
      case 178:
      case 179:
      case 49:
      case 50:
      case 168:
      case 169:
      case 175:
      case 170:
      case 171:
      case 172:
      case 97:
      case 76:
      case 32:
      case 173:
      case 35:
        return -1;
      case 176:
      case 177:
      case 7:
      case 155:
      case 8:
      case 157:
      case 125:
      case 126:
      case 92:
      case 93:
      case 129:
      case 130:
      case 131:
      case 94:
      case 91:
        return 1;
      case 74:
      case 60:
      case 69:
      case 70:
      case 4:
        return 1024;
      case 31:
      case 42:
      case 72:
        return 32;
      case 87:
      case 26:
      case 33:
        return 2147483647;
      case 34:
      case 1:
        return 47839;
      case 38:
      case 36:
        return 99;
      case 43:
      case 37:
        return 2048;
      case 0:
        return 2097152;
      case 3:
        return 65536;
      case 28:
        return 32768;
      case 44:
        return 32767;
      case 75:
        return 16384;
      case 39:
        return 1e3;
      case 89:
        return 700;
      case 71:
        return 256;
      case 40:
        return 255;
      case 2:
        return 100;
      case 180:
        return 64;
      case 25:
        return 20;
      case 5:
        return 16;
      case 6:
        return 6;
      case 73:
        return 4;
      case 84:
        {
          if (typeof navigator === 'object') return navigator['hardwareConcurrency'] || 1;
          return 1;
        }
    }
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  }

  function _emscripten_glFrustum() {
    Module['printErr']('missing function: emscripten_glFrustum');
    abort(-1);
  }

  function _emscripten_glGetTexParameterfv(target, pname, params) {
    HEAPF32[params >> 2] = GLctx.getTexParameter(target, pname);
  }

  var _ceil = Math_ceil;

  function _emscripten_glBindRenderbuffer(target, renderbuffer) {
    GLctx.bindRenderbuffer(target, renderbuffer ? GL.renderbuffers[renderbuffer] : null);
  }

  var _sqrt = Math_sqrt;

  function _dlclose(handle) {
    if (!DLFCN.loadedLibs[handle]) {
      DLFCN.errorMsg = 'Tried to dlclose() unopened handle: ' + handle;
      return 1;
    } else {
      var lib_record = DLFCN.loadedLibs[handle];
      if (--lib_record.refcount == 0) {
        if (lib_record.module.cleanups) {
          lib_record.module.cleanups.forEach((function(cleanup) {
            cleanup();
          }));
        }

        delete DLFCN.loadedLibNames[lib_record.name];
        delete DLFCN.loadedLibs[handle];
      }

      return 0;
    }
  }

  function _emscripten_get_gamepad_status(index, gamepadState) {
    if (!navigator.getGamepads && !navigator.webkitGetGamepads) return -1;
    var gamepads;
    if (navigator.getGamepads) {
      gamepads = navigator.getGamepads();
    } else if (navigator.webkitGetGamepads) {
      gamepads = navigator.webkitGetGamepads();
    }

    if (index < 0 || index >= gamepads.length) {
      return -5;
    }

    if (typeof gamepads[index] === 'undefined') {
      return -7;
    }

    JSEvents.fillGamepadEventData(gamepadState, gamepads[index]);
    return 0;
  }

  var _llvm_pow_f64 = Math_pow;

  function _emscripten_glCopyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7) {
    GLctx.copyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7);
  }

  function _emscripten_glTexParameterfv(target, pname, params) {
    var param = HEAPF32[params >> 2];
    GLctx.texParameterf(target, pname, param);
  }

  function _pthread_cond_wait() {
    return 0;
  }

  function _open(path, oflag, varargs) {
    var mode = HEAP32[varargs >> 2];
    path = Pointer_stringify(path);
    try {
      var stream = FS.open(path, oflag, mode);
      return stream.fd;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _opendir(dirname) {
    var path = Pointer_stringify(dirname);
    if (!path) {
      ___setErrNo(ERRNO_CODES.ENOENT);
      return 0;
    }

    var node;
    try {
      var lookup = FS.lookupPath(path, {
        follow: true
      });
      node = lookup.node;
    } catch (e) {
      FS.handleFSError(e);
      return 0;
    }
    if (!FS.isDir(node.mode)) {
      ___setErrNo(ERRNO_CODES.ENOTDIR);
      return 0;
    }

    var fd = _open(dirname, 0, allocate([0, 0, 0, 0], 'i32', ALLOC_STACK));
    return fd === -1 ? 0 : FS.getPtrForStream(FS.getStream(fd));
  }

  function _emscripten_glUniform3f(location, v0, v1, v2) {
    location = GL.uniforms[location];
    GLctx.uniform3f(location, v0, v1, v2);
  }

  function _emscripten_glGetObjectParameterivARB() {
    Module['printErr']('missing function: emscripten_glGetObjectParameterivARB');
    abort(-1);
  }

  function _emscripten_glBlendFunc(x0, x1) {
    GLctx.blendFunc(x0, x1);
  }

  function _emscripten_glUniform3i(location, v0, v1, v2) {
    location = GL.uniforms[location];
    GLctx.uniform3i(location, v0, v1, v2);
  }

  function _emscripten_glStencilOp(x0, x1, x2) {
    GLctx.stencilOp(x0, x1, x2);
  }

  function _emscripten_glBindAttribLocation(program, index, name) {
    name = Pointer_stringify(name);
    GLctx.bindAttribLocation(GL.programs[program], index, name);
  }

  function _eglGetConfigAttrib(display, config, attribute, value) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    if (config != 62002) {
      EGL.setErrorCode(12293);
      return 0;
    }

    if (!value) {
      EGL.setErrorCode(12300);
      return 0;
    }

    EGL.setErrorCode(12288);
    switch (attribute) {
      case 12320:
        HEAP32[value >> 2] = 32;
        return 1;
      case 12321:
        HEAP32[value >> 2] = 8;
        return 1;
      case 12322:
        HEAP32[value >> 2] = 8;
        return 1;
      case 12323:
        HEAP32[value >> 2] = 8;
        return 1;
      case 12324:
        HEAP32[value >> 2] = 8;
        return 1;
      case 12325:
        HEAP32[value >> 2] = 24;
        return 1;
      case 12326:
        HEAP32[value >> 2] = 8;
        return 1;
      case 12327:
        HEAP32[value >> 2] = 12344;
        return 1;
      case 12328:
        HEAP32[value >> 2] = 62002;
        return 1;
      case 12329:
        HEAP32[value >> 2] = 0;
        return 1;
      case 12330:
        HEAP32[value >> 2] = 4096;
        return 1;
      case 12331:
        HEAP32[value >> 2] = 16777216;
        return 1;
      case 12332:
        HEAP32[value >> 2] = 4096;
        return 1;
      case 12333:
        HEAP32[value >> 2] = 0;
        return 1;
      case 12334:
        HEAP32[value >> 2] = 0;
        return 1;
      case 12335:
        HEAP32[value >> 2] = 12344;
        return 1;
      case 12337:
        HEAP32[value >> 2] = 4;
        return 1;
      case 12338:
        HEAP32[value >> 2] = 1;
        return 1;
      case 12339:
        HEAP32[value >> 2] = 4;
        return 1;
      case 12340:
        HEAP32[value >> 2] = 12344;
        return 1;
      case 12341:
      case 12342:
      case 12343:
        HEAP32[value >> 2] = -1;
        return 1;
      case 12345:
      case 12346:
        HEAP32[value >> 2] = 0;
        return 1;
      case 12347:
      case 12348:
        HEAP32[value >> 2] = 1;
        return 1;
      case 12349:
      case 12350:
        HEAP32[value >> 2] = 0;
        return 1;
      case 12351:
        HEAP32[value >> 2] = 12430;
        return 1;
      case 12352:
        HEAP32[value >> 2] = 4;
        return 1;
      case 12354:
        HEAP32[value >> 2] = 0;
        return 1;
      default:
        EGL.setErrorCode(12292);
        return 0;
    }
  }

  function _emscripten_glEnableVertexAttribArray(index) {
    GLctx.enableVertexAttribArray(index);
  }

  Module['_memset'] = _memset;
  var _BDtoILow = true;
  Module['_strcat'] = _strcat;

  function _emscripten_glRotatef() {
    Module['printErr']('missing function: emscripten_glRotatef');
    abort(-1);
  }

  function _emscripten_set_touchcancel_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 25, 'touchcancel');
    return 0;
  }

  function _emscripten_glBlendFuncSeparate(x0, x1, x2, x3) {
    GLctx.blendFuncSeparate(x0, x1, x2, x3);
  }

  function _emscripten_glGetVertexAttribPointerv(index, pname, pointer) {
    HEAP32[pointer >> 2] = GLctx.getVertexAttribOffset(index, pname);
  }

  function _emscripten_glVertexAttrib3f(x0, x1, x2, x3) {
    GLctx.vertexAttrib3f(x0, x1, x2, x3);
  }

  var _llvm_ctlz_i32 = true;

  function _emscripten_glNormalPointer() {
    Module['printErr']('missing function: emscripten_glNormalPointer');
    abort(-1);
  }

  function _access(path, amode) {
    path = Pointer_stringify(path);
    if (amode & ~7) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

    var node;
    try {
      var lookup = FS.lookupPath(path, {
        follow: true
      });
      node = lookup.node;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
    var perms = '';
    if (amode & 4) perms += 'r';
    if (amode & 2) perms += 'w';
    if (amode & 1) perms += 'x';
    if (perms && FS.nodePermissions(node, perms)) {
      ___setErrNo(ERRNO_CODES.EACCES);
      return -1;
    }

    return 0;
  }

  var _emscripten_GetProcAddress = undefined;
  Module['_emscripten_GetProcAddress'] = _emscripten_GetProcAddress;

  function _eglGetProcAddress(name_) {
    return _emscripten_GetProcAddress(name_);
  }

  function _emscripten_set_main_loop_timing(mode, value) {
    Browser.mainLoop.timingMode = mode;
    Browser.mainLoop.timingValue = value;
    if (!Browser.mainLoop.func) {
      return 1;
    }

    if (mode == 0) {
      Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler() {
        setTimeout(Browser.mainLoop.runner, value);
      };

      Browser.mainLoop.method = 'timeout';
    } else if (mode == 1) {
      Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler() {
        Browser.requestAnimationFrame(Browser.mainLoop.runner);
      };

      Browser.mainLoop.method = 'rAF';
    }

    return 0;
  }

  function _emscripten_set_main_loop(func, fps, simulateInfiniteLoop, arg) {
    Module['noExitRuntime'] = true;
    assert(!Browser.mainLoop.func, 'emscripten_set_main_loop: there can only be one main loop function at once: call emscripten_cancel_main_loop to cancel the previous one before setting a new one with different parameters.');
    Browser.mainLoop.func = func;
    Browser.mainLoop.arg = arg;
    var thisMainLoopId = Browser.mainLoop.currentlyRunningMainloop;
    Browser.mainLoop.runner = function Browser_mainLoop_runner() {
      if (ABORT) return;
      if (Browser.mainLoop.queue.length > 0) {
        var start = Date.now();
        var blocker = Browser.mainLoop.queue.shift();
        blocker.func(blocker.arg);
        if (Browser.mainLoop.remainingBlockers) {
          var remaining = Browser.mainLoop.remainingBlockers;
          var next = remaining % 1 == 0 ? remaining - 1 : Math.floor(remaining);
          if (blocker.counted) {
            Browser.mainLoop.remainingBlockers = next;
          } else {
            next = next + .5;
            Browser.mainLoop.remainingBlockers = (8 * remaining + next) / 9;
          }
        }

        console.log('main loop blocker "' + blocker.name + '" took ' + (Date.now() - start) + ' ms');
        Browser.mainLoop.updateStatus();
        setTimeout(Browser.mainLoop.runner, 0);
        return;
      }

      if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
      Browser.mainLoop.currentFrameNumber = Browser.mainLoop.currentFrameNumber + 1 | 0;
      if (Browser.mainLoop.timingMode == 1 && Browser.mainLoop.timingValue > 1 && Browser.mainLoop.currentFrameNumber % Browser.mainLoop.timingValue != 0) {
        Browser.mainLoop.scheduler();
        return;
      }

      if (Browser.mainLoop.method === 'timeout' && Module.ctx) {
        Module.printErr('Looks like you are rendering without using requestAnimationFrame for the main loop. You should use 0 for the frame rate in emscripten_set_main_loop in order to use requestAnimationFrame, as that can greatly improve your frame rates!');
        Browser.mainLoop.method = '';
      }

      Browser.mainLoop.runIter((function() {
        if (typeof arg !== 'undefined') {
          Runtime.dynCall('vi', func, [arg]);
        } else {
          Runtime.dynCall('v', func);
        }
      }));

      if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
      if (typeof SDL === 'object' && SDL.audio && SDL.audio.queueNewAudioData) SDL.audio.queueNewAudioData();
      Browser.mainLoop.scheduler();
    };

    if (fps && fps > 0) _emscripten_set_main_loop_timing(0, 1e3 / fps);
    else _emscripten_set_main_loop_timing(1, 1);
    Browser.mainLoop.scheduler();
    if (simulateInfiniteLoop) {
      throw 'SimulateInfiniteLoop';
    }
  }

  var Browser = {
    mainLoop: {
      scheduler: null,
      method: '',
      currentlyRunningMainloop: 0,
      func: null,
      arg: 0,
      timingMode: 0,
      timingValue: 0,
      currentFrameNumber: 0,
      queue: [],
      pause: (function() {
        Browser.mainLoop.scheduler = null;
        Browser.mainLoop.currentlyRunningMainloop++;
      }),

      resume: (function() {
        Browser.mainLoop.currentlyRunningMainloop++;
        var timingMode = Browser.mainLoop.timingMode;
        var timingValue = Browser.mainLoop.timingValue;
        var func = Browser.mainLoop.func;
        Browser.mainLoop.func = null;
        _emscripten_set_main_loop(func, 0, false, Browser.mainLoop.arg);
        _emscripten_set_main_loop_timing(timingMode, timingValue);
      }),

      updateStatus: (function() {
        if (Module['setStatus']) {
          var message = Module['statusMessage'] || 'Please wait...';
          var remaining = Browser.mainLoop.remainingBlockers;
          var expected = Browser.mainLoop.expectedBlockers;
          if (remaining) {
            if (remaining < expected) {
              Module['setStatus'](message + ' (' + (expected - remaining) + '/' + expected + ')');
            } else {
              Module['setStatus'](message);
            }
          } else {
            Module['setStatus']('');
          }
        }
      }),

      runIter: (function(func) {
        if (ABORT) return;
        if (Module['preMainLoop']) {
          var preRet = Module['preMainLoop']();
          if (preRet === false) {
            return;
          }
        }

        try {
          func();
        } catch (e) {
          if (e instanceof ExitStatus) {
            return;
          } else {
            if (e && typeof e === 'object' && e.stack) Module.printErr('exception thrown: ' + [e, e.stack]);
            throw e;
          }
        }
        if (Module['postMainLoop']) Module['postMainLoop']();
      })
    },
    isFullScreen: false,
    pointerLock: false,
    moduleContextCreatedCallbacks: [],
    workers: [],
    init: (function() {
      if (!Module['preloadPlugins']) Module['preloadPlugins'] = [];
      if (Browser.initted) return;
      Browser.initted = true;
      try {
        new Blob;
        Browser.hasBlobConstructor = true;
      } catch (e) {
        Browser.hasBlobConstructor = false;
        console.log('warning: no blob constructor, cannot create blobs with mimetypes');
      }
      Browser.BlobBuilder = typeof WebKitBlobBuilder != 'undefined' ? WebKitBlobBuilder : !Browser.hasBlobConstructor ? console.log('warning: no BlobBuilder') : null;
      Browser.URLObject = typeof window != 'undefined' ? window.URL ? window.URL : window.webkitURL : undefined;
      if (!Module.noImageDecoding && typeof Browser.URLObject === 'undefined') {
        console.log('warning: Browser does not support creating object URLs. Built-in browser image decoding will not be available.');
        Module.noImageDecoding = true;
      }

      var imagePlugin = {};
      imagePlugin['canHandle'] = function imagePlugin_canHandle(name) {
        return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
      };

      imagePlugin['handle'] = function imagePlugin_handle(byteArray, name, onload, onerror) {
        var b = null;
        if (Browser.hasBlobConstructor) {
          try {
            b = new Blob([byteArray], {
              type: Browser.getMimetype(name)
            });
            if (b.size !== byteArray.length) {
              b = new Blob([(new Uint8Array(byteArray)).buffer], {
                type: Browser.getMimetype(name)
              });
            }
          } catch (e) {
            Runtime.warnOnce('Blob constructor present but fails: ' + e + '; falling back to blob builder');
          }
        }

        if (!b) {
          var bb = new Browser.BlobBuilder;
          bb.append((new Uint8Array(byteArray)).buffer);
          b = bb.getBlob();
        }

        var url = Browser.URLObject.createObjectURL(b);
        var img = new Image;
        img.onload = function img_onload() {
          assert(img.complete, 'Image ' + name + ' could not be decoded');
          var canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          Module['preloadedImages'][name] = canvas;
          Browser.URLObject.revokeObjectURL(url);
          if (onload) onload(byteArray);
        };

        img.onerror = function img_onerror(event) {
          console.log('Image ' + url + ' could not be decoded');
          if (onerror) onerror();
        };

        img.src = url;
      };

      Module['preloadPlugins'].push(imagePlugin);
      var audioPlugin = {};
      audioPlugin['canHandle'] = function audioPlugin_canHandle(name) {
        return !Module.noAudioDecoding && name.substr(-4) in {
          '.ogg': 1,
          '.wav': 1,
          '.mp3': 1
        };
      };

      audioPlugin['handle'] = function audioPlugin_handle(byteArray, name, onload, onerror) {
        var done = false;

        function finish(audio) {
          if (done) return;
          done = true;
          Module['preloadedAudios'][name] = audio;
          if (onload) onload(byteArray);
        }

        function fail() {
          if (done) return;
          done = true;
          Module['preloadedAudios'][name] = new Audio;
          if (onerror) onerror();
        }

        if (Browser.hasBlobConstructor) {
          try {
            var b = new Blob([byteArray], {
              type: Browser.getMimetype(name)
            });
          } catch (e) {
            return fail();
          }
          var url = Browser.URLObject.createObjectURL(b);
          var audio = new Audio;
          audio.addEventListener('canplaythrough', (function() {
            finish(audio);
          }), false);

          audio.onerror = function audio_onerror(event) {
            if (done) return;
            console.log('warning: browser could not fully decode audio ' + name + ', trying slower base64 approach');

            function encode64(data) {
              var BASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
              var PAD = '=';
              var ret = '';
              var leftchar = 0;
              var leftbits = 0;
              for (var i = 0; i < data.length; i++) {
                leftchar = leftchar << 8 | data[i];
                leftbits += 8;
                while (leftbits >= 6) {
                  var curr = leftchar >> leftbits - 6 & 63;
                  leftbits -= 6;
                  ret += BASE[curr];
                }
              }

              if (leftbits == 2) {
                ret += BASE[(leftchar & 3) << 4];
                ret += PAD + PAD;
              } else if (leftbits == 4) {
                ret += BASE[(leftchar & 15) << 2];
                ret += PAD;
              }

              return ret;
            }

            audio.src = 'data:audio/x-' + name.substr(-3) + ';base64,' + encode64(byteArray);
            finish(audio);
          };

          audio.src = url;
          Browser.safeSetTimeout((function() {
            finish(audio);
          }), 1e4);
        } else {
          return fail();
        }
      };

      Module['preloadPlugins'].push(audioPlugin);
      var canvas = Module['canvas'];

      function pointerLockChange() {
        Browser.pointerLock = document['pointerLockElement'] === canvas || document['webkitPointerLockElement'] === canvas;
      }

      if (canvas) {
        canvas.requestPointerLock = canvas['requestPointerLock'] || canvas['webkitRequestPointerLock'] || (function() {});

        canvas.exitPointerLock = document['exitPointerLock'] || document['webkitExitPointerLock'] || (function() {});

        canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
        document.addEventListener('pointerlockchange', pointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', pointerLockChange, false);
        if (Module['elementPointerLock']) {
          canvas.addEventListener('click', (function(ev) {
            if (!Browser.pointerLock && canvas.requestPointerLock) {
              canvas.requestPointerLock();
              ev.preventDefault();
            }
          }), false);
        }
      }
    }),

    createContext: (function(canvas, useWebGL, setInModule, webGLContextAttributes) {
      if (useWebGL && Module.ctx && canvas == Module.canvas) return Module.ctx;
      var ctx;
      var contextHandle;
      if (useWebGL) {
        var contextAttributes = {
          antialias: false,
          alpha: false
        };
        if (webGLContextAttributes) {
          for (var attribute in webGLContextAttributes) {
            contextAttributes[attribute] = webGLContextAttributes[attribute];
          }
        }

        contextHandle = GL.createContext(canvas, contextAttributes);
        if (contextHandle) {
          ctx = GL.getContext(contextHandle).GLctx;
        }

        canvas.style.backgroundColor = 'black';
      } else {
        ctx = canvas.getContext('2d');
      }

      if (!ctx) return null;
      if (setInModule) {
        if (!useWebGL) assert(typeof GLctx === 'undefined', 'cannot set in module if GLctx is used, but we are a non-GL context that would replace it');
        Module.ctx = ctx;
        if (useWebGL) GL.makeContextCurrent(contextHandle);
        Module.useWebGL = useWebGL;
        Browser.moduleContextCreatedCallbacks.forEach((function(callback) {
          callback();
        }));

        Browser.init();
      }

      return ctx;
    }),

    destroyContext: (function(canvas, useWebGL, setInModule) {}),

    fullScreenHandlersInstalled: false,
    lockPointer: undefined,
    resizeCanvas: undefined,
    requestFullScreen: (function(lockPointer, resizeCanvas) {
      Browser.lockPointer = lockPointer;
      Browser.resizeCanvas = resizeCanvas;
      if (typeof Browser.lockPointer === 'undefined') Browser.lockPointer = true;
      if (typeof Browser.resizeCanvas === 'undefined') Browser.resizeCanvas = false;
      var canvas = Module['canvas'];

      function fullScreenChange() {
        Browser.isFullScreen = false;
        var canvasContainer = canvas.parentNode;
        if ((document['webkitFullScreenElement'] || document['fullscreenElement'] || document['webkitCurrentFullScreenElement']) === canvasContainer) {
          canvas.cancelFullScreen = document['cancelFullScreen'] || document['webkitCancelFullScreen'] || document['exitFullscreen'] || (function() {});

          canvas.cancelFullScreen = canvas.cancelFullScreen.bind(document);
          if (Browser.lockPointer) canvas.requestPointerLock();
          Browser.isFullScreen = true;
          if (Browser.resizeCanvas) Browser.setFullScreenCanvasSize();
        } else {
          canvasContainer.parentNode.insertBefore(canvas, canvasContainer);
          canvasContainer.parentNode.removeChild(canvasContainer);
          if (Browser.resizeCanvas) Browser.setWindowedCanvasSize();
        }

        if (Module['onFullScreen']) Module['onFullScreen'](Browser.isFullScreen);
        Browser.updateCanvasDimensions(canvas);
      }

      if (!Browser.fullScreenHandlersInstalled) {
        Browser.fullScreenHandlersInstalled = true;
        document.addEventListener('fullscreenchange', fullScreenChange, false);
        document.addEventListener('webkitfullscreenchange', fullScreenChange, false);
      }

      var canvasContainer = document.createElement('div');
      canvas.parentNode.insertBefore(canvasContainer, canvas);
      canvasContainer.appendChild(canvas);
      canvasContainer.requestFullScreen = canvasContainer['requestFullScreen'] || (canvasContainer['webkitRequestFullScreen'] ? (function() {
        canvasContainer['webkitRequestFullScreen'](Element['ALLOW_KEYBOARD_INPUT']);
      }) : null);

      canvasContainer.requestFullScreen();
    }),

    nextRAF: 0,
    fakeRequestAnimationFrame: (function(func) {
      var now = Date.now();
      if (Browser.nextRAF === 0) {
        Browser.nextRAF = now + 1e3 / 60;
      } else {
        while (now + 2 >= Browser.nextRAF) {
          Browser.nextRAF += 1e3 / 60;
        }
      }

      var delay = Math.max(Browser.nextRAF - now, 0);
      setTimeout(func, delay);
    }),

    requestAnimationFrame: function requestAnimationFrame(func) {
      if (typeof window === 'undefined') {
        Browser.fakeRequestAnimationFrame(func);
      } else {
        if (!window.requestAnimationFrame) {
          window.requestAnimationFrame = window['requestAnimationFrame'] || window['webkitRequestAnimationFrame'] || Browser.fakeRequestAnimationFrame;
        }

        window.requestAnimationFrame(func);
      }
    },

    safeCallback: (function(func) {
      return (function() {
        if (!ABORT) return func.apply(null, arguments);
      });
    }),

    safeRequestAnimationFrame: (function(func) {
      return Browser.requestAnimationFrame((function() {
        if (!ABORT) func();
      }));
    }),

    safeSetTimeout: (function(func, timeout) {
      Module['noExitRuntime'] = true;
      return setTimeout((function() {
        if (!ABORT) func();
      }), timeout);
    }),

    safeSetInterval: (function(func, timeout) {
      Module['noExitRuntime'] = true;
      return setInterval((function() {
        if (!ABORT) func();
      }), timeout);
    }),

    getMimetype: (function(name) {
      return {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        bmp: 'image/bmp',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
        mp3: 'audio/mpeg'
      }[name.substr(name.lastIndexOf('.') + 1)];
    }),

    getUserMedia: (function(func) {
      if (!window.getUserMedia) {
        window.getUserMedia = navigator['getUserMedia'];
      }

      window.getUserMedia(func);
    }),

    getMovementX: (function(event) {
      return event['movementX'] || 0;
    }),

    getMovementY: (function(event) {
      return event['movementY'] || 0;
    }),

    getMouseWheelDelta: (function(event) {
      var delta = 0;
      switch (event.type) {
        case 'DOMMouseScroll':
          delta = event.detail;
          break;
        case 'mousewheel':
          delta = event.wheelDelta;
          break;
        case 'wheel':
          delta = event['deltaY'];
          break;
        default:
          throw 'unrecognized mouse wheel event: ' + event.type;
      }
      return delta;
    }),

    mouseX: 0,
    mouseY: 0,
    mouseMovementX: 0,
    mouseMovementY: 0,
    touches: {},
    lastTouches: {},
    calculateMouseEvent: (function(event) {
      if (Browser.pointerLock) {
        Browser.mouseMovementX = Browser.getMovementX(event);
        Browser.mouseMovementY = Browser.getMovementY(event);

        if (typeof SDL != 'undefined') {
          Browser.mouseX = SDL.mouseX + Browser.mouseMovementX;
          Browser.mouseY = SDL.mouseY + Browser.mouseMovementY;
        } else {
          Browser.mouseX += Browser.mouseMovementX;
          Browser.mouseY += Browser.mouseMovementY;
        }
      } else {
        var rect = Module['canvas'].getBoundingClientRect();
        var cw = Module['canvas'].width;
        var ch = Module['canvas'].height;
        var scrollX = typeof window.scrollX !== 'undefined' ? window.scrollX : window.pageXOffset;
        var scrollY = typeof window.scrollY !== 'undefined' ? window.scrollY : window.pageYOffset;
        if (event.type === 'touchstart' || event.type === 'touchend' || event.type === 'touchmove') {
          var touch = event.touch;
          if (touch === undefined) {
            return;
          }

          var adjustedX = touch.pageX - (scrollX + rect.left);
          var adjustedY = touch.pageY - (scrollY + rect.top);
          adjustedX = adjustedX * (cw / rect.width);
          adjustedY = adjustedY * (ch / rect.height);
          var coords = {
            x: adjustedX,
            y: adjustedY
          };
          if (event.type === 'touchstart') {
            Browser.lastTouches[touch.identifier] = coords;
            Browser.touches[touch.identifier] = coords;
          } else if (event.type === 'touchend' || event.type === 'touchmove') {
            Browser.lastTouches[touch.identifier] = Browser.touches[touch.identifier];
            Browser.touches[touch.identifier] = {
              x: adjustedX,
              y: adjustedY
            };
          }

          return;
        }

        var x = event.pageX - (scrollX + rect.left);
        var y = event.pageY - (scrollY + rect.top);
        x = x * (cw / rect.width);
        y = y * (ch / rect.height);
        Browser.mouseMovementX = x - Browser.mouseX;
        Browser.mouseMovementY = y - Browser.mouseY;
        Browser.mouseX = x;
        Browser.mouseY = y;
      }
    }),

    xhrLoad: (function(url, onload, onerror) {
      var xhr = new XMLHttpRequest;
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function xhr_onload() {
        if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
          onload(xhr.response);
        } else {
          onerror();
        }
      };

      xhr.onerror = onerror;
      xhr.send(null);
    }),

    asyncLoad: (function(url, onload, onerror, noRunDep) {
      Browser.xhrLoad(url, (function(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
        onload(new Uint8Array(arrayBuffer));
        if (!noRunDep) removeRunDependency('al ' + url);
      }), (function(event) {

        if (onerror) {
          onerror();
        } else {
          throw 'Loading data file "' + url + '" failed.';
        }
      }));

      if (!noRunDep) addRunDependency('al ' + url);
    }),

    resizeListeners: [],
    updateResizeListeners: (function() {
      var canvas = Module['canvas'];
      Browser.resizeListeners.forEach((function(listener) {
        listener(canvas.width, canvas.height);
      }));
    }),

    setCanvasSize: (function(width, height, noUpdates) {
      var canvas = Module['canvas'];
      Browser.updateCanvasDimensions(canvas, width, height);
      if (!noUpdates) Browser.updateResizeListeners();
    }),

    windowedWidth: 0,
    windowedHeight: 0,
    setFullScreenCanvasSize: (function() {
      if (typeof SDL != 'undefined') {
        var flags = HEAPU32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2];
        flags = flags | 8388608;
        HEAP32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
      }

      Browser.updateResizeListeners();
    }),

    setWindowedCanvasSize: (function() {
      if (typeof SDL != 'undefined') {
        var flags = HEAPU32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2];
        flags = flags & ~8388608;
        HEAP32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
      }

      Browser.updateResizeListeners();
    }),

    updateCanvasDimensions: (function(canvas, wNative, hNative) {
      if (wNative && hNative) {
        canvas.widthNative = wNative;
        canvas.heightNative = hNative;
      } else {
        wNative = canvas.widthNative;
        hNative = canvas.heightNative;
      }

      var w = wNative;
      var h = hNative;
      if (Module['forcedAspectRatio'] && Module['forcedAspectRatio'] > 0) {
        if (w / h < Module['forcedAspectRatio']) {
          w = Math.round(h * Module['forcedAspectRatio']);
        } else {
          h = Math.round(w / Module['forcedAspectRatio']);
        }
      }

      if ((document['webkitFullScreenElement'] || document['fullScreenElement'] || document['webkitCurrentFullScreenElement']) === canvas.parentNode && typeof screen != 'undefined') {
        var factor = Math.min(screen.width / w, screen.height / h);
        w = Math.round(w * factor);
        h = Math.round(h * factor);
      }

      if (Browser.resizeCanvas) {
        if (canvas.width != w) canvas.width = w;
        if (canvas.height != h) canvas.height = h;
        if (typeof canvas.style != 'undefined') {
          canvas.style.removeProperty('width');
          canvas.style.removeProperty('height');
        }
      } else {
        if (canvas.width != wNative) canvas.width = wNative;
        if (canvas.height != hNative) canvas.height = hNative;
        if (typeof canvas.style != 'undefined') {
          if (w != wNative || h != hNative) {
            canvas.style.setProperty('width', w + 'px', 'important');
            canvas.style.setProperty('height', h + 'px', 'important');
          } else {
            canvas.style.removeProperty('width');
            canvas.style.removeProperty('height');
          }
        }
      }

      // ADDED for update UI when change canvas size
      Module.dimensionsUpdate && Module.dimensionsUpdate(w, h);
    }),

    wgetRequests: {},
    nextWgetRequestHandle: 0,
    getNextWgetRequestHandle: (function() {
      var handle = Browser.nextWgetRequestHandle;
      Browser.nextWgetRequestHandle++;
      return handle;
    })
  };

  function _emscripten_get_pointerlock_status(pointerlockStatus) {
    if (pointerlockStatus) JSEvents.fillPointerlockChangeEventData(pointerlockStatus);
    if (!document.body.requestPointerLock && !document.body.webkitRequestPointerLock) {
      return -1;
    }

    return 0;
  }

  var LOCALE = {
    curr: 0,
    check: (function(locale) {
      if (locale) locale = Pointer_stringify(locale);
      return locale === 'C' || locale === 'POSIX' || !locale;
    })
  };

  function _free() {}

  Module['_free'] = _free;

  function _freelocale(locale) {
    _free(locale);
  }

  function _eglSwapInterval(display, interval) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    if (interval == 0) _emscripten_set_main_loop_timing(0, 0);
    else _emscripten_set_main_loop_timing(1, interval);
    EGL.setErrorCode(12288);
    return 1;
  }

  function _emscripten_glGetVertexAttribfv(index, pname, params) {
    var data = GLctx.getVertexAttrib(index, pname);
    if (typeof data == 'number') {
      HEAPF32[params >> 2] = data;
    } else {
      for (var i = 0; i < data.length; i++) {
        HEAPF32[params + i >> 2] = data[i];
      }
    }
  }

  function _emscripten_set_keyup_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerKeyEventCallback(target, userData, useCapture, callbackfunc, 3, 'keyup');
    return 0;
  }

  function _emscripten_set_pointerlockchange_callback(target, userData, useCapture, callbackfunc) {
    if (!document.body.requestPointerLock && !document.body.webkitRequestPointerLock) {
      return -1;
    }

    if (!target) target = document;
    else {
      target = JSEvents.findEventTarget(target);
      if (!target) return -4;
    }

    JSEvents.registerPointerlockChangeEventCallback(target, userData, useCapture, callbackfunc, 20, 'pointerlockchange');
    JSEvents.registerPointerlockChangeEventCallback(target, userData, useCapture, callbackfunc, 20, 'webkitpointerlockchange');
    return 0;
  }

  function _emscripten_glDeleteShader(id) {
    if (!id) return;
    var shader = GL.shaders[id];
    if (!shader) {
      GL.recordError(1281);
      return;
    }

    GLctx.deleteShader(shader);
    GL.shaders[id] = null;
  }

  function ___cxa_guard_acquire(variable) {
    if (!HEAP8[variable >> 0]) {
      HEAP8[variable >> 0] = 1;
      return 1;
    }

    return 0;
  }

  function _emscripten_glDrawArraysInstanced(mode, first, count, primcount) {
    GL.currentContext.instancedArraysExt.drawArraysInstancedANGLE(mode, first, count, primcount);
  }

  function _emscripten_glDeleteBuffers(n, buffers) {
    for (var i = 0; i < n; i++) {
      var id = HEAP32[buffers + i * 4 >> 2];
      var buffer = GL.buffers[id];
      if (!buffer) continue;
      GLctx.deleteBuffer(buffer);
      buffer.name = 0;
      GL.buffers[id] = null;
      if (id == GL.currArrayBuffer) GL.currArrayBuffer = 0;
      if (id == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
    }
  }

  function _emscripten_glTexParameteriv(target, pname, params) {
    var param = HEAP32[params >> 2];
    GLctx.texParameteri(target, pname, param);
  }

  function _emscripten_glUniformMatrix2fv(location, count, transpose, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[3];
      for (var i = 0; i < 4; i++) {
        view[i] = HEAPF32[value + i * 4 >> 2];
      }
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 16 >> 2);
    }

    GLctx.uniformMatrix2fv(location, transpose, view);
  }

  function _sigaction(signum, act, oldact) {
    Module.printErr('Calling stub instead of sigaction()');
    return 0;
  }

  var _cos = Math_cos;

  function _emscripten_glGetVertexAttribiv(index, pname, params) {
    var data = GLctx.getVertexAttrib(index, pname);
    if (typeof data == 'number' || typeof data == 'boolean') {
      HEAP32[params >> 2] = data;
    } else {
      for (var i = 0; i < data.length; i++) {
        HEAP32[params + i >> 2] = data[i];
      }
    }
  }

  function _emscripten_glUniformMatrix4fv(location, count, transpose, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[15];
      for (var i = 0; i < 16; i++) {
        view[i] = HEAPF32[value + i * 4 >> 2];
      }
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 64 >> 2);
    }

    GLctx.uniformMatrix4fv(location, transpose, view);
  }

  function _emscripten_set_gamepadconnected_callback(userData, useCapture, callbackfunc) {
    if (!navigator.getGamepads && !navigator.webkitGetGamepads) return -1;
    JSEvents.registerGamepadEventCallback(window, userData, useCapture, callbackfunc, 26, 'gamepadconnected');
    return 0;
  }

  function _emscripten_glGetPointerv() {
    Module['printErr']('missing function: emscripten_glGetPointerv');
    abort(-1);
  }

  function _eglChooseConfig(display, attrib_list, configs, config_size, numConfigs) {
    return EGL.chooseConfig(display, attrib_list, configs, config_size, numConfigs);
  }

  function _emscripten_glUniform1i(location, v0) {
    location = GL.uniforms[location];
    GLctx.uniform1i(location, v0);
  }

  function _atexit(func, arg) {
    __ATEXIT__.unshift({
      func: func,
      arg: arg
    });
  }

  function ___cxa_atexit() {
    return _atexit.apply(null, arguments);
  }

  function _emscripten_glStencilFuncSeparate(x0, x1, x2, x3) {
    GLctx.stencilFuncSeparate(x0, x1, x2, x3);
  }

  Module['_i64Subtract'] = _i64Subtract;
  var _fabsf = Math_abs;
  Module['_i64Add'] = _i64Add;

  function __ZSt18uncaught_exceptionv() {
    return !!__ZSt18uncaught_exceptionv.uncaught_exception;
  }

  var EXCEPTIONS = {
    last: 0,
    caught: [],
    infos: {},
    deAdjust: (function(adjusted) {
      if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
      for (var ptr in EXCEPTIONS.infos) {
        var info = EXCEPTIONS.infos[ptr];
        if (info.adjusted === adjusted) {
          return ptr;
        }
      }

      return adjusted;
    }),

    addRef: (function(ptr) {
      if (!ptr) return;
      var info = EXCEPTIONS.infos[ptr];
      info.refcount++;
    }),

    decRef: (function(ptr) {
      if (!ptr) return;
      var info = EXCEPTIONS.infos[ptr];
      assert(info.refcount > 0);
      info.refcount--;
      if (info.refcount === 0) {
        if (info.destructor) {
          Runtime.dynCall('vi', info.destructor, [ptr]);
        }

        delete EXCEPTIONS.infos[ptr];
        ___cxa_free_exception(ptr);
      }
    }),

    clearRef: (function(ptr) {
      if (!ptr) return;
      var info = EXCEPTIONS.infos[ptr];
      info.refcount = 0;
    })
  };

  function ___resumeException(ptr) {
    if (!EXCEPTIONS.last) {
      EXCEPTIONS.last = ptr;
    }

    EXCEPTIONS.clearRef(EXCEPTIONS.deAdjust(ptr));
    throw ptr + ' - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.';
  }

  function ___cxa_find_matching_catch() {
    var thrown = EXCEPTIONS.last;
    if (!thrown) {
      return (asm['setTempRet0'](0), 0) | 0;
    }

    var info = EXCEPTIONS.infos[thrown];
    var throwntype = info.type;
    if (!throwntype) {
      return (asm['setTempRet0'](0), thrown) | 0;
    }

    var typeArray = Array.prototype.slice.call(arguments);
    var pointer = Module['___cxa_is_pointer_type'](throwntype);
    if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = _malloc(4);
    HEAP32[___cxa_find_matching_catch.buffer >> 2] = thrown;
    thrown = ___cxa_find_matching_catch.buffer;
    for (var i = 0; i < typeArray.length; i++) {
      if (typeArray[i] && Module['___cxa_can_catch'](typeArray[i], throwntype, thrown)) {
        thrown = HEAP32[thrown >> 2];
        info.adjusted = thrown;
        return (asm['setTempRet0'](typeArray[i]), thrown) | 0;
      }
    }

    thrown = HEAP32[thrown >> 2];
    return (asm['setTempRet0'](throwntype), thrown) | 0;
  }

  function ___cxa_throw(ptr, type, destructor) {
    EXCEPTIONS.infos[ptr] = {
      ptr: ptr,
      adjusted: ptr,
      type: type,
      destructor: destructor,
      refcount: 0
    };
    EXCEPTIONS.last = ptr;
    if (!('uncaught_exception' in __ZSt18uncaught_exceptionv)) {
      __ZSt18uncaught_exceptionv.uncaught_exception = 1;
    } else {
      __ZSt18uncaught_exceptionv.uncaught_exception++;
    }

    throw ptr + ' - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.';
  }

  function _emscripten_set_touchend_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 23, 'touchend');
    return 0;
  }

  function __setLetterbox(element, topBottom, leftRight) {
    if (JSEvents.isInternetExplorer()) {
      element.style.marginLeft = element.style.marginRight = leftRight + 'px';
      element.style.marginTop = element.style.marginBottom = topBottom + 'px';
    } else {
      element.style.paddingLeft = element.style.paddingRight = leftRight + 'px';
      element.style.paddingTop = element.style.paddingBottom = topBottom + 'px';
    }
  }

  function _emscripten_do_request_fullscreen(target, strategy) {
    if (typeof JSEvents.fullscreenEnabled() === 'undefined') return -1;
    if (!JSEvents.fullscreenEnabled()) return -3;
    if (!target) target = '#canvas';
    target = JSEvents.findEventTarget(target);
    if (!target) return -4;
    if (!target.requestFullscreen && !target.webkitRequestFullscreen) {
      return -3;
    }

    var canPerformRequests = JSEvents.canPerformEventHandlerRequests();
    if (!canPerformRequests) {
      if (strategy.deferUntilInEventHandler) {
        JSEvents.deferCall(JSEvents.requestFullscreen, 1, [target, strategy]);
        return 1;
      } else {
        return -2;
      }
    }

    return JSEvents.requestFullscreen(target, strategy);
  }

  var __currentFullscreenStrategy = {};

  function __registerRestoreOldStyle(canvas) {
    var oldWidth = canvas.width;
    var oldHeight = canvas.height;
    var oldCssWidth = canvas.style.width;
    var oldCssHeight = canvas.style.height;
    var oldBackgroundColor = canvas.style.backgroundColor;
    var oldDocumentBackgroundColor = document.body.style.backgroundColor;
    var oldPaddingLeft = canvas.style.paddingLeft;
    var oldPaddingRight = canvas.style.paddingRight;
    var oldPaddingTop = canvas.style.paddingTop;
    var oldPaddingBottom = canvas.style.paddingBottom;
    var oldMarginLeft = canvas.style.marginLeft;
    var oldMarginRight = canvas.style.marginRight;
    var oldMarginTop = canvas.style.marginTop;
    var oldMarginBottom = canvas.style.marginBottom;
    var oldDocumentBodyMargin = document.body.style.margin;
    var oldDocumentOverflow = document.documentElement.style.overflow;
    var oldDocumentScroll = document.body.scroll;
    var oldImageRendering = canvas.style.imageRendering;

    function restoreOldStyle() {
      var fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fullscreenElement) {
        document.removeEventListener('fullscreenchange', restoreOldStyle);
        document.removeEventListener('webkitfullscreenchange', restoreOldStyle);
        canvas.width = oldWidth;
        canvas.height = oldHeight;
        canvas.style.width = oldCssWidth;
        canvas.style.height = oldCssHeight;
        canvas.style.backgroundColor = oldBackgroundColor;
        if (!oldDocumentBackgroundColor) document.body.style.backgroundColor = 'white';
        document.body.style.backgroundColor = oldDocumentBackgroundColor;
        canvas.style.paddingLeft = oldPaddingLeft;
        canvas.style.paddingRight = oldPaddingRight;
        canvas.style.paddingTop = oldPaddingTop;
        canvas.style.paddingBottom = oldPaddingBottom;
        canvas.style.marginLeft = oldMarginLeft;
        canvas.style.marginRight = oldMarginRight;
        canvas.style.marginTop = oldMarginTop;
        canvas.style.marginBottom = oldMarginBottom;
        document.body.style.margin = oldDocumentBodyMargin;
        document.documentElement.style.overflow = oldDocumentOverflow;
        document.body.scroll = oldDocumentScroll;
        canvas.style.imageRendering = oldImageRendering;
        if (canvas.GLctxObject) canvas.GLctxObject.GLctx.viewport(0, 0, oldWidth, oldHeight);
        if (__currentFullscreenStrategy.canvasResizedCallback) {
          Runtime.dynCall('iiii', __currentFullscreenStrategy.canvasResizedCallback, [37, 0, __currentFullscreenStrategy.canvasResizedCallbackUserData]);
        }
      }
    }

    document.addEventListener('fullscreenchange', restoreOldStyle);
    document.addEventListener('webkitfullscreenchange', restoreOldStyle);
    return restoreOldStyle;
  }

  function _emscripten_request_fullscreen_strategy(target, deferUntilInEventHandler, fullscreenStrategy) {
    var strategy = {};
    strategy.scaleMode = HEAP32[fullscreenStrategy >> 2];
    strategy.canvasResolutionScaleMode = HEAP32[fullscreenStrategy + 4 >> 2];
    strategy.filteringMode = HEAP32[fullscreenStrategy + 8 >> 2];
    strategy.deferUntilInEventHandler = deferUntilInEventHandler;
    strategy.canvasResizedCallback = HEAP32[fullscreenStrategy + 12 >> 2];
    strategy.canvasResizedCallbackUserData = HEAP32[fullscreenStrategy + 16 >> 2];
    __currentFullscreenStrategy = strategy;
    return _emscripten_do_request_fullscreen(target, strategy);
  }

  function _emscripten_glDisableVertexAttribArray(index) {
    GLctx.disableVertexAttribArray(index);
  }

  function _fwrite(ptr, size, nitems, stream) {
    var bytesToWrite = nitems * size;
    if (bytesToWrite == 0) return 0;
    var fd = _fileno(stream);
    var bytesWritten = _write(fd, ptr, bytesToWrite);
    if (bytesWritten == -1) {
      var streamObj = FS.getStreamFromPtr(stream);
      if (streamObj) streamObj.error = true;
      return 0;
    } else {
      return bytesWritten / size | 0;
    }
  }

  function __reallyNegative(x) {
    return x < 0 || x === 0 && 1 / x === -Infinity;
  }

  function __formatString(format, varargs) {
    var textIndex = format;
    var argIndex = 0;

    function getNextArg(type) {
      var ret;
      if (type === 'double') {
        ret = (HEAP32[tempDoublePtr >> 2] = HEAP32[varargs + argIndex >> 2], HEAP32[tempDoublePtr + 4 >> 2] = HEAP32[varargs + (argIndex + 4) >> 2], +HEAPF64[tempDoublePtr >> 3]);
      } else if (type == 'i64') {
        ret = [HEAP32[varargs + argIndex >> 2], HEAP32[varargs + (argIndex + 4) >> 2]];
      } else {
        type = 'i32';
        ret = HEAP32[varargs + argIndex >> 2];
      }

      argIndex += Runtime.getNativeFieldSize(type);
      return ret;
    }

    var ret = [];
    var curr, next, currArg;
    while (1) {
      var startTextIndex = textIndex;
      curr = HEAP8[textIndex >> 0];
      if (curr === 0) break;
      next = HEAP8[textIndex + 1 >> 0];
      if (curr == 37) {
        var flagAlwaysSigned = false;
        var flagLeftAlign = false;
        var flagAlternative = false;
        var flagZeroPad = false;
        var flagPadSign = false;
        flagsLoop: while (1) {
          switch (next) {
            case 43:
              flagAlwaysSigned = true;
              break;
            case 45:
              flagLeftAlign = true;
              break;
            case 35:
              flagAlternative = true;
              break;
            case 48:
              if (flagZeroPad) {
                break flagsLoop;
              } else {
                flagZeroPad = true;
                break;
              }

            case 32:
              flagPadSign = true;
              break;
            default:
              break flagsLoop;
          }
          textIndex++;
          next = HEAP8[textIndex + 1 >> 0];
        }

        var width = 0;
        if (next == 42) {
          width = getNextArg('i32');
          textIndex++;
          next = HEAP8[textIndex + 1 >> 0];
        } else {
          while (next >= 48 && next <= 57) {
            width = width * 10 + (next - 48);
            textIndex++;
            next = HEAP8[textIndex + 1 >> 0];
          }
        }

        var precisionSet = false,
          precision = -1;
        if (next == 46) {
          precision = 0;
          precisionSet = true;
          textIndex++;
          next = HEAP8[textIndex + 1 >> 0];
          if (next == 42) {
            precision = getNextArg('i32');
            textIndex++;
          } else {
            while (1) {
              var precisionChr = HEAP8[textIndex + 1 >> 0];
              if (precisionChr < 48 || precisionChr > 57) break;
              precision = precision * 10 + (precisionChr - 48);
              textIndex++;
            }
          }

          next = HEAP8[textIndex + 1 >> 0];
        }

        if (precision < 0) {
          precision = 6;
          precisionSet = false;
        }

        var argSize;
        switch (String.fromCharCode(next)) {
          case 'h':
            var nextNext = HEAP8[textIndex + 2 >> 0];
            if (nextNext == 104) {
              textIndex++;
              argSize = 1;
            } else {
              argSize = 2;
            }

            break;
          case 'l':
            var nextNext = HEAP8[textIndex + 2 >> 0];
            if (nextNext == 108) {
              textIndex++;
              argSize = 8;
            } else {
              argSize = 4;
            }

            break;
          case 'L':
          case 'q':
          case 'j':
            argSize = 8;
            break;
          case 'z':
          case 't':
          case 'I':
            argSize = 4;
            break;
          default:
            argSize = null;
        }
        if (argSize) textIndex++;
        next = HEAP8[textIndex + 1 >> 0];
        switch (String.fromCharCode(next)) {
          case 'd':
          case 'i':
          case 'u':
          case 'o':
          case 'x':
          case 'X':
          case 'p':
            {
              var signed = next == 100 || next == 105; argSize = argSize || 4;
              var currArg = getNextArg('i' + argSize * 8);
              var origArg = currArg;
              var argText;
              if (argSize == 8) {
                currArg = Runtime.makeBigInt(currArg[0], currArg[1], next == 117);
              }

              if (argSize <= 4) {
                var limit = Math.pow(256, argSize) - 1;
                currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
              }

              var currAbsArg = Math.abs(currArg);
              var prefix = '';
              if (next == 100 || next == 105) {
                if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], null);
                else argText = reSign(currArg, 8 * argSize, 1).toString(10);
              } else if (next == 117) {
                if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], true);
                else argText = unSign(currArg, 8 * argSize, 1).toString(10);
                currArg = Math.abs(currArg);
              } else if (next == 111) {
                argText = (flagAlternative ? '0' : '') + currAbsArg.toString(8);
              } else if (next == 120 || next == 88) {
                prefix = flagAlternative && currArg != 0 ? '0x' : '';
                if (argSize == 8 && i64Math) {
                  if (origArg[1]) {
                    argText = (origArg[1] >>> 0).toString(16);
                    var lower = (origArg[0] >>> 0).toString(16);
                    while (lower.length < 8) lower = '0' + lower;
                    argText += lower;
                  } else {
                    argText = (origArg[0] >>> 0).toString(16);
                  }
                } else if (currArg < 0) {
                  currArg = -currArg;
                  argText = (currAbsArg - 1).toString(16);
                  var buffer = [];
                  for (var i = 0; i < argText.length; i++) {
                    buffer.push((15 - parseInt(argText[i], 16)).toString(16));
                  }

                  argText = buffer.join('');
                  while (argText.length < argSize * 2) argText = 'f' + argText;
                } else {
                  argText = currAbsArg.toString(16);
                }

                if (next == 88) {
                  prefix = prefix.toUpperCase();
                  argText = argText.toUpperCase();
                }
              } else if (next == 112) {
                if (currAbsArg === 0) {
                  argText = '(nil)';
                } else {
                  prefix = '0x';
                  argText = currAbsArg.toString(16);
                }
              }

              if (precisionSet) {
                while (argText.length < precision) {
                  argText = '0' + argText;
                }
              }

              if (currArg >= 0) {
                if (flagAlwaysSigned) {
                  prefix = '+' + prefix;
                } else if (flagPadSign) {
                  prefix = ' ' + prefix;
                }
              }

              if (argText.charAt(0) == '-') {
                prefix = '-' + prefix;
                argText = argText.substr(1);
              }

              while (prefix.length + argText.length < width) {
                if (flagLeftAlign) {
                  argText += ' ';
                } else {
                  if (flagZeroPad) {
                    argText = '0' + argText;
                  } else {
                    prefix = ' ' + prefix;
                  }
                }
              }

              argText = prefix + argText; argText.split('').forEach((function(chr) {
                ret.push(chr.charCodeAt(0));
              }));

              break;
            }

          case 'f':
          case 'F':
          case 'e':
          case 'E':
          case 'g':
          case 'G':
            {
              var currArg = getNextArg('double');
              var argText;
              if (isNaN(currArg)) {
                argText = 'nan';
                flagZeroPad = false;
              } else if (!isFinite(currArg)) {
                argText = (currArg < 0 ? '-' : '') + 'inf';
                flagZeroPad = false;
              } else {
                var isGeneral = false;
                var effectivePrecision = Math.min(precision, 20);
                if (next == 103 || next == 71) {
                  isGeneral = true;
                  precision = precision || 1;
                  var exponent = parseInt(currArg.toExponential(effectivePrecision).split('e')[1], 10);
                  if (precision > exponent && exponent >= -4) {
                    next = (next == 103 ? 'f' : 'F').charCodeAt(0);
                    precision -= exponent + 1;
                  } else {
                    next = (next == 103 ? 'e' : 'E').charCodeAt(0);
                    precision--;
                  }

                  effectivePrecision = Math.min(precision, 20);
                }

                if (next == 101 || next == 69) {
                  argText = currArg.toExponential(effectivePrecision);
                  if (/[eE][-+]\d$/.test(argText)) {
                    argText = argText.slice(0, -1) + '0' + argText.slice(-1);
                  }
                } else if (next == 102 || next == 70) {
                  argText = currArg.toFixed(effectivePrecision);
                  if (currArg === 0 && __reallyNegative(currArg)) {
                    argText = '-' + argText;
                  }
                }

                var parts = argText.split('e');
                if (isGeneral && !flagAlternative) {
                  while (parts[0].length > 1 && parts[0].indexOf('.') != -1 && (parts[0].slice(-1) == '0' || parts[0].slice(-1) == '.')) {
                    parts[0] = parts[0].slice(0, -1);
                  }
                } else {
                  if (flagAlternative && argText.indexOf('.') == -1) parts[0] += '.';
                  while (precision > effectivePrecision++) parts[0] += '0';
                }

                argText = parts[0] + (parts.length > 1 ? 'e' + parts[1] : '');
                if (next == 69) argText = argText.toUpperCase();
                if (currArg >= 0) {
                  if (flagAlwaysSigned) {
                    argText = '+' + argText;
                  } else if (flagPadSign) {
                    argText = ' ' + argText;
                  }
                }
              }

              while (argText.length < width) {
                if (flagLeftAlign) {
                  argText += ' ';
                } else {
                  if (flagZeroPad && (argText[0] == '-' || argText[0] == '+')) {
                    argText = argText[0] + '0' + argText.slice(1);
                  } else {
                    argText = (flagZeroPad ? '0' : ' ') + argText;
                  }
                }
              }

              if (next < 97) argText = argText.toUpperCase(); argText.split('').forEach((function(chr) {
                ret.push(chr.charCodeAt(0));
              }));

              break;
            }

          case 's':
            {
              var arg = getNextArg('i8*');
              var argLength = arg ? _strlen(arg) : '(null)'.length;
              if (precisionSet) argLength = Math.min(argLength, precision);
              if (!flagLeftAlign) {
                while (argLength < width--) {
                  ret.push(32);
                }
              }

              if (arg) {
                for (var i = 0; i < argLength; i++) {
                  ret.push(HEAPU8[arg++ >> 0]);
                }
              } else {
                ret = ret.concat(intArrayFromString('(null)'.substr(0, argLength), true));
              }

              if (flagLeftAlign) {
                while (argLength < width--) {
                  ret.push(32);
                }
              }

              break;
            }

          case 'c':
            {
              if (flagLeftAlign) ret.push(getNextArg('i8'));
              while (--width > 0) {
                ret.push(32);
              }

              if (!flagLeftAlign) ret.push(getNextArg('i8'));
              break;
            }

          case 'n':
            {
              var ptr = getNextArg('i32*'); HEAP32[ptr >> 2] = ret.length;
              break;
            }

          case '%':
            {
              ret.push(curr);
              break;
            }

          default:
            {
              for (var i = startTextIndex; i < textIndex + 2; i++) {
                ret.push(HEAP8[i >> 0]);
              }
            }
        }
        textIndex += 2;
      } else {
        ret.push(curr);
        textIndex += 1;
      }
    }

    return ret;
  }

  function _fprintf(stream, format, varargs) {
    var result = __formatString(format, varargs);
    var stack = Runtime.stackSave();
    var ret = _fwrite(allocate(result, 'i8', ALLOC_STACK), 1, result.length, stream);
    Runtime.stackRestore(stack);
    return ret;
  }

  function _printf(format, varargs) {
    var stdout = HEAP32[_stdout >> 2];
    return _fprintf(stdout, format, varargs);
  }

  function _emscripten_glGetProgramiv(program, pname, p) {
    if (pname == 35716) {
      HEAP32[p >> 2] = GLctx.getProgramInfoLog(GL.programs[program]).length + 1;
    } else if (pname == 35719) {
      var ptable = GL.programInfos[program];
      if (ptable) {
        HEAP32[p >> 2] = ptable.maxUniformLength;
        return;
      } else if (program < GL.counter) {
        GL.recordError(1282);
      } else {
        GL.recordError(1281);
      }
    } else if (pname == 35722) {
      var ptable = GL.programInfos[program];
      if (ptable) {
        if (ptable.maxAttributeLength == -1) {
          var program = GL.programs[program];
          var numAttribs = GLctx.getProgramParameter(program, GLctx.ACTIVE_ATTRIBUTES);
          ptable.maxAttributeLength = 0;
          for (var i = 0; i < numAttribs; ++i) {
            var activeAttrib = GLctx.getActiveAttrib(program, i);
            ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length + 1);
          }
        }

        HEAP32[p >> 2] = ptable.maxAttributeLength;
        return;
      } else if (program < GL.counter) {
        GL.recordError(1282);
      } else {
        GL.recordError(1281);
      }
    } else {
      HEAP32[p >> 2] = GLctx.getProgramParameter(GL.programs[program], pname);
    }
  }

  function _emscripten_glFinish() {
    GLctx.finish();
  }

  function _emscripten_set_touchstart_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 22, 'touchstart');
    return 0;
  }

  function _emscripten_glDepthFunc(x0) {
    GLctx.depthFunc(x0);
  }

  function _emscripten_get_num_gamepads() {
    if (!navigator.getGamepads && !navigator.webkitGetGamepads) return -1;
    if (navigator.getGamepads) {
      return navigator.getGamepads().length;
    } else if (navigator.webkitGetGamepads) {
      return navigator.webkitGetGamepads().length;
    }
  }

  function _emscripten_set_blur_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerFocusEventCallback(target, userData, useCapture, callbackfunc, 12, 'blur');
    return 0;
  }

  function _puts(s) {
    var stdout = HEAP32[_stdout >> 2];
    var ret = _fputs(s, stdout);
    if (ret < 0) {
      return ret;
    } else {
      var newlineRet = _fputc(10, stdout);
      return newlineRet < 0 ? -1 : ret + 1;
    }
  }

  function _emscripten_glReleaseShaderCompiler() {}

  function _emscripten_glUniform4iv(location, count, value) {
    location = GL.uniforms[location];
    count *= 4;
    value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
    GLctx.uniform4iv(location, value);
  }

  function _glClear(x0) {
    GLctx.clear(x0);
  }

  function _emscripten_set_resize_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerUiEventCallback(target, userData, useCapture, callbackfunc, 10, 'resize');
    return 0;
  }

  function _emscripten_glLoadIdentity() {
    throw 'Legacy GL function(glLoadIdentity) called. If you want legacy GL emulation, you need to compile with -s LEGACY_GL_EMULATION=1 to enable legacy GL emulation.';
  }

  function _emscripten_set_element_css_size(target, width, height) {
    if (!target) {
      target = Module['canvas'];
    } else {
      target = JSEvents.findEventTarget(target);
    }

    if (!target) return -4;
    target.style.setProperty('width', width + 'px');
    target.style.setProperty('height', height + 'px');
    return 0;
  }

  function _emscripten_glColorPointer() {
    Module['printErr']('missing function: emscripten_glColorPointer');
    abort(-1);
  }

  function _emscripten_glAttachShader(program, shader) {
    GLctx.attachShader(GL.programs[program], GL.shaders[shader]);
  }

  function _emscripten_glEnable(x0) {
    GLctx.enable(x0);
  }

  function _emscripten_glGetRenderbufferParameteriv(target, pname, params) {
    HEAP32[params >> 2] = GLctx.getRenderbufferParameter(target, pname);
  }

  function _emscripten_request_pointerlock(target, deferUntilInEventHandler) {
    if (!target) target = '#canvas';
    target = JSEvents.findEventTarget(target);
    if (!target) return -4;
    if (!target.requestPointerLock && !target.webkitRequestPointerLock) {
      return -1;
    }

    var canPerformRequests = JSEvents.canPerformEventHandlerRequests();
    if (!canPerformRequests) {
      if (deferUntilInEventHandler) {
        JSEvents.deferCall(JSEvents.requestPointerLock, 2, [target]);
        return 1;
      } else {
        return -2;
      }
    }

    return JSEvents.requestPointerLock(target);
  }

  function _eglCreateWindowSurface(display, config, win, attrib_list) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    if (config != 62002) {
      EGL.setErrorCode(12293);
      return 0;
    }

    EGL.setErrorCode(12288);
    return 62006;
  }

  function _emscripten_glVertexAttrib2f(x0, x1, x2) {
    GLctx.vertexAttrib2f(x0, x1, x2);
  }

  function _ftell(stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    if (FS.isChrdev(stream.node.mode)) {
      ___setErrNo(ERRNO_CODES.ESPIPE);
      return -1;
    } else {
      return stream.position;
    }
  }

  function _ftello() {
    return _ftell.apply(null, arguments);
  }

  function _execl() {
    ___setErrNo(ERRNO_CODES.ENOEXEC);
    return -1;
  }

  function _execvp() {
    return _execl.apply(null, arguments);
  }

  function _pthread_cond_broadcast() {
    return 0;
  }

  function _gettimeofday(ptr) {
    var now = Date.now();
    HEAP32[ptr >> 2] = now / 1e3 | 0;
    HEAP32[ptr + 4 >> 2] = now % 1e3 * 1e3 | 0;
    return 0;
  }

  function _lseek(fildes, offset, whence) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      return FS.llseek(stream, offset, whence);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fseek(stream, offset, whence) {
    var fd = _fileno(stream);
    var ret = _lseek(fd, offset, whence);
    if (ret == -1) {
      return -1;
    }

    stream = FS.getStreamFromPtr(stream);
    stream.eof = false;
    return 0;
  }

  function _fseeko() {
    return _fseek.apply(null, arguments);
  }

  function _emscripten_glClearStencil(x0) {
    GLctx.clearStencil(x0);
  }

  function _emscripten_glDetachShader(program, shader) {
    GLctx.detachShader(GL.programs[program], GL.shaders[shader]);
  }

  function _emscripten_get_device_pixel_ratio() {
    return window.devicePixelRatio || 1;
  }

  function _emscripten_glDeleteVertexArrays(n, vaos) {
    for (var i = 0; i < n; i++) {
      var id = HEAP32[vaos + i * 4 >> 2];
      GL.currentContext.vaoExt.deleteVertexArrayOES(GL.vaos[id]);
      GL.vaos[id] = null;
    }
  }

  function _emscripten_glTexParameteri(x0, x1, x2) {
    GLctx.texParameteri(x0, x1, x2);
  }

  function _emscripten_get_element_css_size(target, width, height) {
    if (!target) {
      target = Module['canvas'];
    } else {
      target = JSEvents.findEventTarget(target);
    }

    if (!target) return -4;
    if (target.getBoundingClientRect) {
      var rect = target.getBoundingClientRect();
      HEAPF64[width >> 3] = rect.right - rect.left;
      HEAPF64[height >> 3] = rect.bottom - rect.top;
    } else {
      HEAPF64[width >> 3] = target.clientWidth;
      HEAPF64[height >> 3] = target.clientHeight;
    }

    return 0;
  }

  function __isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function __arraySum(array, index) {
    var sum = 0;
    for (var i = 0; i <= index; sum += array[i++]);
    return sum;
  }

  var __MONTH_DAYS_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var __MONTH_DAYS_REGULAR = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function __addDays(date, days) {
    var newDate = new Date(date.getTime());
    while (days > 0) {
      var leap = __isLeapYear(newDate.getFullYear());
      var currentMonth = newDate.getMonth();
      var daysInCurrentMonth = (leap ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR)[currentMonth];
      if (days > daysInCurrentMonth - newDate.getDate()) {
        days -= daysInCurrentMonth - newDate.getDate() + 1;
        newDate.setDate(1);
        if (currentMonth < 11) {
          newDate.setMonth(currentMonth + 1);
        } else {
          newDate.setMonth(0);
          newDate.setFullYear(newDate.getFullYear() + 1);
        }
      } else {
        newDate.setDate(newDate.getDate() + days);
        return newDate;
      }
    }

    return newDate;
  }

  function _strftime(s, maxsize, format, tm) {
    var tm_zone = HEAP32[tm + 40 >> 2];
    var date = {
      tm_sec: HEAP32[tm >> 2],
      tm_min: HEAP32[tm + 4 >> 2],
      tm_hour: HEAP32[tm + 8 >> 2],
      tm_mday: HEAP32[tm + 12 >> 2],
      tm_mon: HEAP32[tm + 16 >> 2],
      tm_year: HEAP32[tm + 20 >> 2],
      tm_wday: HEAP32[tm + 24 >> 2],
      tm_yday: HEAP32[tm + 28 >> 2],
      tm_isdst: HEAP32[tm + 32 >> 2],
      tm_gmtoff: HEAP32[tm + 36 >> 2],
      tm_zone: tm_zone ? Pointer_stringify(tm_zone) : ''
    };
    var pattern = Pointer_stringify(format);
    var EXPANSION_RULES_1 = {
      '%c': '%a %b %d %H:%M:%S %Y',
      '%D': '%m/%d/%y',
      '%F': '%Y-%m-%d',
      '%h': '%b',
      '%r': '%I:%M:%S %p',
      '%R': '%H:%M',
      '%T': '%H:%M:%S',
      '%x': '%m/%d/%y',
      '%X': '%H:%M:%S'
    };
    for (var rule in EXPANSION_RULES_1) {
      pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_1[rule]);
    }

    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    function leadingSomething(value, digits, character) {
      var str = typeof value === 'number' ? value.toString() : value || '';
      while (str.length < digits) {
        str = character[0] + str;
      }

      return str;
    }

    function leadingNulls(value, digits) {
      return leadingSomething(value, digits, '0');
    }

    function compareByDay(date1, date2) {
      function sgn(value) {
        return value < 0 ? -1 : value > 0 ? 1 : 0;
      }

      var compare;
      if ((compare = sgn(date1.getFullYear() - date2.getFullYear())) === 0) {
        if ((compare = sgn(date1.getMonth() - date2.getMonth())) === 0) {
          compare = sgn(date1.getDate() - date2.getDate());
        }
      }

      return compare;
    }

    function getFirstWeekStartDate(janFourth) {
      switch (janFourth.getDay()) {
        case 0:
          return new Date(janFourth.getFullYear() - 1, 11, 29);
        case 1:
          return janFourth;
        case 2:
          return new Date(janFourth.getFullYear(), 0, 3);
        case 3:
          return new Date(janFourth.getFullYear(), 0, 2);
        case 4:
          return new Date(janFourth.getFullYear(), 0, 1);
        case 5:
          return new Date(janFourth.getFullYear() - 1, 11, 31);
        case 6:
          return new Date(janFourth.getFullYear() - 1, 11, 30);
      }
    }

    function getWeekBasedYear(date) {
      var thisDate = __addDays(new Date(date.tm_year + 1900, 0, 1), date.tm_yday);
      var janFourthThisYear = new Date(thisDate.getFullYear(), 0, 4);
      var janFourthNextYear = new Date(thisDate.getFullYear() + 1, 0, 4);
      var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
      var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
      if (compareByDay(firstWeekStartThisYear, thisDate) <= 0) {
        if (compareByDay(firstWeekStartNextYear, thisDate) <= 0) {
          return thisDate.getFullYear() + 1;
        } else {
          return thisDate.getFullYear();
        }
      } else {
        return thisDate.getFullYear() - 1;
      }
    }

    var EXPANSION_RULES_2 = {
      '%a': (function(date) {
        return WEEKDAYS[date.tm_wday].substring(0, 3);
      }),

      '%A': (function(date) {
        return WEEKDAYS[date.tm_wday];
      }),

      '%b': (function(date) {
        return MONTHS[date.tm_mon].substring(0, 3);
      }),

      '%B': (function(date) {
        return MONTHS[date.tm_mon];
      }),

      '%C': (function(date) {
        var year = date.tm_year + 1900;
        return leadingNulls(year / 100 | 0, 2);
      }),

      '%d': (function(date) {
        return leadingNulls(date.tm_mday, 2);
      }),

      '%e': (function(date) {
        return leadingSomething(date.tm_mday, 2, ' ');
      }),

      '%g': (function(date) {
        return getWeekBasedYear(date).toString().substring(2);
      }),

      '%G': (function(date) {
        return getWeekBasedYear(date);
      }),

      '%H': (function(date) {
        return leadingNulls(date.tm_hour, 2);
      }),

      '%I': (function(date) {
        return leadingNulls(date.tm_hour < 13 ? date.tm_hour : date.tm_hour - 12, 2);
      }),

      '%j': (function(date) {
        return leadingNulls(date.tm_mday + __arraySum(__isLeapYear(date.tm_year + 1900) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, date.tm_mon - 1), 3);
      }),

      '%m': (function(date) {
        return leadingNulls(date.tm_mon + 1, 2);
      }),

      '%M': (function(date) {
        return leadingNulls(date.tm_min, 2);
      }),

      '%n': (function() {
        return '\n';
      }),

      '%p': (function(date) {
        if (date.tm_hour > 0 && date.tm_hour < 13) {
          return 'AM';
        } else {
          return 'PM';
        }
      }),

      '%S': (function(date) {
        return leadingNulls(date.tm_sec, 2);
      }),

      '%t': (function() {
        return '\t';
      }),

      '%u': (function(date) {
        var day = new Date(date.tm_year + 1900, date.tm_mon + 1, date.tm_mday, 0, 0, 0, 0);
        return day.getDay() || 7;
      }),

      '%U': (function(date) {
        var janFirst = new Date(date.tm_year + 1900, 0, 1);
        var firstSunday = janFirst.getDay() === 0 ? janFirst : __addDays(janFirst, 7 - janFirst.getDay());
        var endDate = new Date(date.tm_year + 1900, date.tm_mon, date.tm_mday);
        if (compareByDay(firstSunday, endDate) < 0) {
          var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth() - 1) - 31;
          var firstSundayUntilEndJanuary = 31 - firstSunday.getDate();
          var days = firstSundayUntilEndJanuary + februaryFirstUntilEndMonth + endDate.getDate();
          return leadingNulls(Math.ceil(days / 7), 2);
        }

        return compareByDay(firstSunday, janFirst) === 0 ? '01' : '00';
      }),

      '%V': (function(date) {
        var janFourthThisYear = new Date(date.tm_year + 1900, 0, 4);
        var janFourthNextYear = new Date(date.tm_year + 1901, 0, 4);
        var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
        var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
        var endDate = __addDays(new Date(date.tm_year + 1900, 0, 1), date.tm_yday);
        if (compareByDay(endDate, firstWeekStartThisYear) < 0) {
          return '53';
        }

        if (compareByDay(firstWeekStartNextYear, endDate) <= 0) {
          return '01';
        }

        var daysDifference;
        if (firstWeekStartThisYear.getFullYear() < date.tm_year + 1900) {
          daysDifference = date.tm_yday + 32 - firstWeekStartThisYear.getDate();
        } else {
          daysDifference = date.tm_yday + 1 - firstWeekStartThisYear.getDate();
        }

        return leadingNulls(Math.ceil(daysDifference / 7), 2);
      }),

      '%w': (function(date) {
        var day = new Date(date.tm_year + 1900, date.tm_mon + 1, date.tm_mday, 0, 0, 0, 0);
        return day.getDay();
      }),

      '%W': (function(date) {
        var janFirst = new Date(date.tm_year, 0, 1);
        var firstMonday = janFirst.getDay() === 1 ? janFirst : __addDays(janFirst, janFirst.getDay() === 0 ? 1 : 7 - janFirst.getDay() + 1);
        var endDate = new Date(date.tm_year + 1900, date.tm_mon, date.tm_mday);
        if (compareByDay(firstMonday, endDate) < 0) {
          var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth() - 1) - 31;
          var firstMondayUntilEndJanuary = 31 - firstMonday.getDate();
          var days = firstMondayUntilEndJanuary + februaryFirstUntilEndMonth + endDate.getDate();
          return leadingNulls(Math.ceil(days / 7), 2);
        }

        return compareByDay(firstMonday, janFirst) === 0 ? '01' : '00';
      }),

      '%y': (function(date) {
        return (date.tm_year + 1900).toString().substring(2);
      }),

      '%Y': (function(date) {
        return date.tm_year + 1900;
      }),

      '%z': (function(date) {
        var off = date.tm_gmtoff;
        var ahead = off >= 0;
        off = Math.abs(off) / 60;
        off = off / 60 * 100 + off % 60;
        return (ahead ? '+' : '-') + String('0000' + off).slice(-4);
      }),

      '%Z': (function(date) {
        return date.tm_zone;
      }),

      '%%': (function() {
        return '%';
      })
    };
    for (var rule in EXPANSION_RULES_2) {
      if (pattern.indexOf(rule) >= 0) {
        pattern = pattern.replace(new RegExp(rule, 'g'), EXPANSION_RULES_2[rule](date));
      }
    }

    var bytes = intArrayFromString(pattern, false);
    if (bytes.length > maxsize) {
      return 0;
    }

    writeArrayToMemory(bytes, s);
    return bytes.length - 1;
  }

  function _strftime_l(s, maxsize, format, tm) {
    return _strftime(s, maxsize, format, tm);
  }

  function ___errno_location() {
    return ___errno_state;
  }

  function _strerror_r(errnum, strerrbuf, buflen) {
    if (errnum in ERRNO_MESSAGES) {
      if (ERRNO_MESSAGES[errnum].length > buflen - 1) {
        return ___setErrNo(ERRNO_CODES.ERANGE);
      } else {
        var msg = ERRNO_MESSAGES[errnum];
        writeAsciiToMemory(msg, strerrbuf);
        return 0;
      }
    } else {
      return ___setErrNo(ERRNO_CODES.EINVAL);
    }
  }

  function _strerror(errnum) {
    if (!_strerror.buffer) _strerror.buffer = _malloc(256);
    _strerror_r(errnum, _strerror.buffer, 256);
    return _strerror.buffer;
  }

  function _emscripten_glGetTexParameteriv(target, pname, params) {
    HEAP32[params >> 2] = GLctx.getTexParameter(target, pname);
  }

  function _catclose(catd) {
    return 0;
  }

  function _truncate(path, length) {
    if (typeof path !== 'string') path = Pointer_stringify(path);
    try {
      FS.truncate(path, length);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _ftruncate(fildes, length) {
    try {
      FS.ftruncate(fildes, length);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _emscripten_glGenerateMipmap(x0) {
    GLctx.generateMipmap(x0);
  }

  function _emscripten_glSampleCoverage(x0, x1) {
    GLctx.sampleCoverage(x0, x1);
  }

  function _emscripten_glCullFace(x0) {
    GLctx.cullFace(x0);
  }

  function _rename(old_path, new_path) {
    old_path = Pointer_stringify(old_path);
    new_path = Pointer_stringify(new_path);
    try {
      FS.rename(old_path, new_path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _eglSwapBuffers() {
    if (!EGL.defaultDisplayInitialized) {
      EGL.setErrorCode(12289);
    } else if (!Module.ctx) {
      EGL.setErrorCode(12290);
    } else if (Module.ctx.isContextLost()) {
      EGL.setErrorCode(12302);
    } else {
      EGL.setErrorCode(12288);
      return 1;
    }

    return 0;
  }

  function _emscripten_glUseProgram(program) {
    GLctx.useProgram(program ? GL.programs[program] : null);
  }

  var EmterpreterAsync = {
    state: 0,
    setState: (function(s) {
      this.state = s;
      asm.setAsyncState(s);
    })
  };

  function _emscripten_sleep(ms) {
    if (EmterpreterAsync.state === 0) {
      var stack = new Int32Array(HEAP32.subarray(EMTSTACKTOP >> 2, asm.emtStackSave() >> 2));
      var stacktop = asm.stackSave();
      Browser.safeSetTimeout(function resume() {
        assert(EmterpreterAsync.state === 1);
        HEAP32.set(stack, EMTSTACKTOP >> 2);
        EmterpreterAsync.setState(2);
        assert(stacktop === asm.stackSave());
        asm.emterpret(stack[0]);
      }, ms);

      EmterpreterAsync.setState(1);
    } else {
      assert(EmterpreterAsync.state === 2);
      EmterpreterAsync.setState(0);
    }
  }

  function _emscripten_glHint(x0, x1) {
    GLctx.hint(x0, x1);
  }

  function _emscripten_glFramebufferTexture2D(target, attachment, textarget, texture, level) {
    GLctx.framebufferTexture2D(target, attachment, textarget, GL.textures[texture], level);
  }

  var _SItoD = true;

  function _emscripten_glUniform2fv(location, count, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[1];
      view[0] = HEAPF32[value >> 2];
      view[1] = HEAPF32[value + 4 >> 2];
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 8 >> 2);
    }

    GLctx.uniform2fv(location, view);
  }

  var PTHREAD_SPECIFIC = {};

  function _pthread_getspecific(key) {
    return PTHREAD_SPECIFIC[key] || 0;
  }

  function _emscripten_glMatrixMode() {
    throw 'Legacy GL function(glMatrixMode) called. If you want legacy GL emulation, you need to compile with -s LEGACY_GL_EMULATION=1 to enable legacy GL emulation.';
  }

  function _abort() {
    Module['abort']();
  }

  function _emscripten_glVertexAttribDivisor(index, divisor) {
    GL.currentContext.instancedArraysExt.vertexAttribDivisorANGLE(index, divisor);
  }

  function _emscripten_glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer) {
    GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget, GL.renderbuffers[renderbuffer]);
  }

  var _tan = Math_tan;

  function _emscripten_glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
    if (data) {
      data = HEAPU8.subarray(data, data + imageSize);
    } else {
      data = null;
    }

    GLctx['compressedTexImage2D'](target, level, internalFormat, width, height, border, data);
  }

  function _emscripten_glIsBuffer(buffer) {
    var b = GL.buffers[buffer];
    if (!b) return 0;
    return GLctx.isBuffer(b);
  }

  function _emscripten_glUniform2iv(location, count, value) {
    location = GL.uniforms[location];
    count *= 2;
    value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
    GLctx.uniform2iv(location, value);
  }

  function _emscripten_asm_const(code) {
    Runtime.getAsmConst(code, 0)();
  }

  function _emscripten_glVertexAttrib1fv(index, v) {
    v = HEAPF32.subarray(v >> 2, v + 4 >> 2);
    GLctx.vertexAttrib1fv(index, v);
  }

  var _fabs = Math_abs;

  function _recv(fd, buf, len, flags) {
    var sock = SOCKFS.getSocket(fd);
    if (!sock) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    return _read(fd, buf, len);
  }

  function _pread(fildes, buf, nbyte, offset) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      var slab = HEAP8;
      return FS.read(stream, slab, buf, nbyte, offset);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _read(fildes, buf, nbyte) {
    var stream = FS.getStream(fildes);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return -1;
    }

    try {
      var slab = HEAP8;
      return FS.read(stream, slab, buf, nbyte);
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _fread(ptr, size, nitems, stream) {
    var bytesToRead = nitems * size;
    if (bytesToRead == 0) {
      return 0;
    }

    var bytesRead = 0;
    var streamObj = FS.getStreamFromPtr(stream);
    if (!streamObj) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }

    while (streamObj.ungotten.length && bytesToRead > 0) {
      HEAP8[ptr++ >> 0] = streamObj.ungotten.pop();
      bytesToRead--;
      bytesRead++;
    }

    var err = _read(streamObj.fd, ptr, bytesToRead);
    if (err == -1) {
      if (streamObj) streamObj.error = true;
      return 0;
    }

    bytesRead += err;
    if (bytesRead < bytesToRead) streamObj.eof = true;
    return bytesRead / size | 0;
  }

  function _fgetc(stream) {
    var streamObj = FS.getStreamFromPtr(stream);
    if (!streamObj) return -1;
    if (streamObj.eof || streamObj.error) return -1;
    var ret = _fread(_fgetc.ret, 1, 1, stream);
    if (ret == 0) {
      return -1;
    } else if (ret == -1) {
      streamObj.error = true;
      return -1;
    } else {
      return HEAPU8[_fgetc.ret >> 0];
    }
  }

  function _getc() {
    return _fgetc.apply(null, arguments);
  }

  function _eglDestroySurface(display, surface) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    if (surface != 62006) {
      EGL.setErrorCode(12301);
      return 1;
    }

    if (EGL.currentReadSurface == surface) {
      EGL.currentReadSurface = 0;
    }

    if (EGL.currentDrawSurface == surface) {
      EGL.currentDrawSurface = 0;
    }

    EGL.setErrorCode(12288);
    return 1;
  }

  function _emscripten_glPolygonOffset(x0, x1) {
    GLctx.polygonOffset(x0, x1);
  }

  function _emscripten_asm_const_int(code) {
    var args = Array.prototype.slice.call(arguments, 1);
    return Runtime.getAsmConst(code, args.length).apply(null, args) | 0;
  }

  function _emscripten_glUniform2f(location, v0, v1) {
    location = GL.uniforms[location];
    GLctx.uniform2f(location, v0, v1);
  }

  function _emscripten_glUniform2i(location, v0, v1) {
    location = GL.uniforms[location];
    GLctx.uniform2i(location, v0, v1);
  }

  function _emscripten_glEnableClientState() {
    Module['printErr']('missing function: emscripten_glEnableClientState');
    abort(-1);
  }

  function _emscripten_glDeleteRenderbuffers(n, renderbuffers) {
    for (var i = 0; i < n; i++) {
      var id = HEAP32[renderbuffers + i * 4 >> 2];
      var renderbuffer = GL.renderbuffers[id];
      if (!renderbuffer) continue;
      GLctx.deleteRenderbuffer(renderbuffer);
      renderbuffer.name = 0;
      GL.renderbuffers[id] = null;
    }
  }

  function _emscripten_glGetBufferParameteriv(target, value, data) {
    HEAP32[data >> 2] = GLctx.getBufferParameter(target, value);
  }

  function _emscripten_glGetUniformiv(program, location, params) {
    var data = GLctx.getUniform(GL.programs[program], GL.uniforms[location]);
    if (typeof data == 'number' || typeof data == 'boolean') {
      HEAP32[params >> 2] = data;
    } else {
      for (var i = 0; i < data.length; i++) {
        HEAP32[params + i >> 2] = data[i];
      }
    }
  }

  function _emscripten_glDepthMask(x0) {
    GLctx.depthMask(x0);
  }

  function _emscripten_set_mousedown_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 5, 'mousedown');
    return 0;
  }

  function _emscripten_glDepthRangef(x0, x1) {
    GLctx.depthRange(x0, x1);
  }

  function _emscripten_glDepthRange(x0, x1) {
    GLctx.depthRange(x0, x1);
  }

  function _emscripten_exit_fullscreen() {
    if (typeof JSEvents.fullscreenEnabled() === 'undefined') return -1;
    JSEvents.removeDeferredCalls(JSEvents.requestFullscreen);
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else {
      return -1;
    }

    if (__currentFullscreenStrategy.canvasResizedCallback) {
      Runtime.dynCall('iiii', __currentFullscreenStrategy.canvasResizedCallback, [37, 0, __currentFullscreenStrategy.canvasResizedCallbackUserData]);
    }

    return 0;
  }

  function ___ctype_tolower_loc() {
    var me = ___ctype_tolower_loc;
    if (!me.ret) {
      var values = [128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255];
      var i32size = 4;
      var arr = _malloc(values.length * i32size);
      for (var i = 0; i < values.length; i++) {
        HEAP32[arr + i * i32size >> 2] = values[i];
      }

      me.ret = allocate([arr + 128 * i32size], 'i32*', ALLOC_NORMAL);
    }

    return me.ret;
  }

  function _unlink(path) {
    path = Pointer_stringify(path);
    try {
      FS.unlink(path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _emscripten_glVertexAttrib1f(x0, x1) {
    GLctx.vertexAttrib1f(x0, x1);
  }

  function _emscripten_glGetShaderPrecisionFormat(shaderType, precisionType, range, precision) {
    var result = GLctx.getShaderPrecisionFormat(shaderType, precisionType);
    HEAP32[range >> 2] = result.rangeMin;
    HEAP32[range + 4 >> 2] = result.rangeMax;
    HEAP32[precision >> 2] = result.precision;
  }

  function _emscripten_glUniform1fv(location, count, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[0];
      view[0] = HEAPF32[value >> 2];
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 4 >> 2);
    }

    GLctx.uniform1fv(location, view);
  }

  function _emscripten_set_wheel_callback(target, userData, useCapture, callbackfunc) {
    target = JSEvents.findEventTarget(target);
    if (typeof target.onwheel !== 'undefined') {
      JSEvents.registerWheelEventCallback(target, userData, useCapture, callbackfunc, 9, 'wheel');
      return 0;
    } else if (typeof target.onmousewheel !== 'undefined') {
      JSEvents.registerWheelEventCallback(target, userData, useCapture, callbackfunc, 9, 'mousewheel');
      return 0;
    } else {
      return -1;
    }
  }

  function _emscripten_set_gamepaddisconnected_callback(userData, useCapture, callbackfunc) {
    if (!navigator.getGamepads && !navigator.webkitGetGamepads) return -1;
    JSEvents.registerGamepadEventCallback(window, userData, useCapture, callbackfunc, 27, 'gamepaddisconnected');
    return 0;
  }

  function _emscripten_set_mouseenter_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 33, 'mouseenter');
    return 0;
  }

  function _emscripten_glBindProgramARB() {
    Module['printErr']('missing function: emscripten_glBindProgramARB');
    abort(-1);
  }

  function _emscripten_glCheckFramebufferStatus(x0) {
    return GLctx.checkFramebufferStatus(x0);
  }

  function _emscripten_glDeleteProgram(id) {
    if (!id) return;
    var program = GL.programs[id];
    if (!program) {
      GL.recordError(1281);
      return;
    }

    GLctx.deleteProgram(program);
    program.name = 0;
    GL.programs[id] = null;
    GL.programInfos[id] = null;
  }

  function _emscripten_glDisable(x0) {
    GLctx.disable(x0);
  }

  function _emscripten_glVertexAttrib3fv(index, v) {
    v = HEAPF32.subarray(v >> 2, v + 12 >> 2);
    GLctx.vertexAttrib3fv(index, v);
  }

  function _emscripten_glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
    program = GL.programs[program];
    var info = GLctx.getActiveAttrib(program, index);
    if (!info) return;
    var infoname = info.name.slice(0, Math.max(0, bufSize - 1));
    if (bufSize > 0 && name) {
      writeStringToMemory(infoname, name);
      if (length) HEAP32[length >> 2] = infoname.length;
    } else {
      if (length) HEAP32[length >> 2] = 0;
    }

    if (size) HEAP32[size >> 2] = info.size;
    if (type) HEAP32[type >> 2] = info.type;
  }

  function _emscripten_glIsFramebuffer(framebuffer) {
    var fb = GL.framebuffers[framebuffer];
    if (!fb) return 0;
    return GLctx.isFramebuffer(fb);
  }

  function _emscripten_glLineWidth(x0) {
    GLctx.lineWidth(x0);
  }

  function _emscripten_glViewport(x0, x1, x2, x3) {
    GLctx.viewport(x0, x1, x2, x3);
  }

  function _emscripten_glGetString(name_) {
    if (GL.stringCache[name_]) return GL.stringCache[name_];
    var ret;
    switch (name_) {
      case 7936:
      case 7937:
      case 7938:
        ret = allocate(intArrayFromString(GLctx.getParameter(name_)), 'i8', ALLOC_NORMAL);
        break;
      case 7939:
        var exts = GLctx.getSupportedExtensions();
        var gl_exts = [];
        for (i in exts) {
          gl_exts.push(exts[i]);
          gl_exts.push('GL_' + exts[i]);
        }

        ret = allocate(intArrayFromString(gl_exts.join(' ')), 'i8', ALLOC_NORMAL);
        break;
      case 35724:
        ret = allocate(intArrayFromString('OpenGL ES GLSL 1.00 (WebGL)'), 'i8', ALLOC_NORMAL);
        break;
      default:
        GL.recordError(1280);
        return 0;
    }
    GL.stringCache[name_] = ret;
    return ret;
  }

  function _emscripten_glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels) {
    if (pixels) {
      var data = GL.getTexPixelData(type, format, width, height, pixels, -1);
      pixels = data.pixels;
    } else {
      pixels = null;
    }

    GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels);
  }

  function _emscripten_glGetAttribLocation(program, name) {
    program = GL.programs[program];
    name = Pointer_stringify(name);
    return GLctx.getAttribLocation(program, name);
  }

  function _emscripten_glUniform4i(location, v0, v1, v2, v3) {
    location = GL.uniforms[location];
    GLctx.uniform4i(location, v0, v1, v2, v3);
  }

  function _execlp() {
    return _execl.apply(null, arguments);
  }

  function _emscripten_glGetIntegerv(name_, p) {
    return GL.get(name_, p, 'Integer');
  }

  function _emscripten_glGetFramebufferAttachmentParameteriv(target, attachment, pname, params) {
    var result = GLctx.getFramebufferAttachmentParameter(target, attachment, pname);
    HEAP32[params >> 2] = result;
  }

  function _emscripten_glClientActiveTexture() {
    Module['printErr']('missing function: emscripten_glClientActiveTexture');
    abort(-1);
  }

  function _emscripten_set_focus_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerFocusEventCallback(target, userData, useCapture, callbackfunc, 13, 'focus');
    return 0;
  }

  function _emscripten_memcpy_big(dest, src, num) {
    HEAPU8.set(HEAPU8.subarray(src, src + num), dest);
    return dest;
  }

  Module['_memcpy'] = _memcpy;

  function _emscripten_glGetShaderInfoLog(shader, maxLength, length, infoLog) {
    var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
    if (!log) log = '(unknown error)';
    log = log.substr(0, maxLength - 1);
    if (maxLength > 0 && infoLog) {
      writeStringToMemory(log, infoLog);
      if (length) HEAP32[length >> 2] = log.length;
    } else {
      if (length) HEAP32[length >> 2] = 0;
    }
  }

  function _emscripten_set_mouseup_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 6, 'mouseup');
    return 0;
  }

  function _emscripten_glStencilOpSeparate(x0, x1, x2, x3) {
    GLctx.stencilOpSeparate(x0, x1, x2, x3);
  }

  var GLUT = {
    initTime: null,
    idleFunc: null,
    displayFunc: null,
    keyboardFunc: null,
    keyboardUpFunc: null,
    specialFunc: null,
    specialUpFunc: null,
    reshapeFunc: null,
    motionFunc: null,
    passiveMotionFunc: null,
    mouseFunc: null,
    buttons: 0,
    modifiers: 0,
    initWindowWidth: 256,
    initWindowHeight: 256,
    initDisplayMode: 18,
    windowX: 0,
    windowY: 0,
    windowWidth: 0,
    windowHeight: 0,
    requestedAnimationFrame: false,
    saveModifiers: (function(event) {
      GLUT.modifiers = 0;
      if (event['shiftKey']) GLUT.modifiers += 1;
      if (event['ctrlKey']) GLUT.modifiers += 2;
      if (event['altKey']) GLUT.modifiers += 4;
    }),

    onMousemove: (function(event) {
      var lastX = Browser.mouseX;
      var lastY = Browser.mouseY;
      Browser.calculateMouseEvent(event);
      var newX = Browser.mouseX;
      var newY = Browser.mouseY;
      if (newX == lastX && newY == lastY) return;
      if (GLUT.buttons == 0 && event.target == Module['canvas'] && GLUT.passiveMotionFunc) {
        event.preventDefault();
        GLUT.saveModifiers(event);
        Runtime.dynCall('vii', GLUT.passiveMotionFunc, [lastX, lastY]);
      } else if (GLUT.buttons != 0 && GLUT.motionFunc) {
        event.preventDefault();
        GLUT.saveModifiers(event);
        Runtime.dynCall('vii', GLUT.motionFunc, [lastX, lastY]);
      }
    }),

    getSpecialKey: (function(keycode) {
      var key = null;
      switch (keycode) {
        case 8:
          key = 120;
          break;
        case 46:
          key = 111;
          break;
        case 112:
          key = 1;
          break;
        case 113:
          key = 2;
          break;
        case 114:
          key = 3;
          break;
        case 115:
          key = 4;
          break;
        case 116:
          key = 5;
          break;
        case 117:
          key = 6;
          break;
        case 118:
          key = 7;
          break;
        case 119:
          key = 8;
          break;
        case 120:
          key = 9;
          break;
        case 121:
          key = 10;
          break;
        case 122:
          key = 11;
          break;
        case 123:
          key = 12;
          break;
        case 37:
          key = 100;
          break;
        case 38:
          key = 101;
          break;
        case 39:
          key = 102;
          break;
        case 40:
          key = 103;
          break;
        case 33:
          key = 104;
          break;
        case 34:
          key = 105;
          break;
        case 36:
          key = 106;
          break;
        case 35:
          key = 107;
          break;
        case 45:
          key = 108;
          break;
        case 16:
        case 5:
          key = 112;
          break;
        case 6:
          key = 113;
          break;
        case 17:
        case 3:
          key = 114;
          break;
        case 4:
          key = 115;
          break;
        case 18:
        case 2:
          key = 116;
          break;
        case 1:
          key = 117;
          break;
      }
      return key;
    }),

    getASCIIKey: (function(event) {
      if (event['ctrlKey'] || event['altKey'] || event['metaKey']) return null;
      var keycode = event['keyCode'];
      if (48 <= keycode && keycode <= 57) return keycode;
      if (65 <= keycode && keycode <= 90) return event['shiftKey'] ? keycode : keycode + 32;
      if (96 <= keycode && keycode <= 105) return keycode - 48;
      if (106 <= keycode && keycode <= 111) return keycode - 106 + 42;
      switch (keycode) {
        case 9:
        case 13:
        case 27:
        case 32:
        case 61:
          return keycode;
      }
      var s = event['shiftKey'];
      switch (keycode) {
        case 186:
          return s ? 58 : 59;
        case 187:
          return s ? 43 : 61;
        case 188:
          return s ? 60 : 44;
        case 189:
          return s ? 95 : 45;
        case 190:
          return s ? 62 : 46;
        case 191:
          return s ? 63 : 47;
        case 219:
          return s ? 123 : 91;
        case 220:
          return s ? 124 : 47;
        case 221:
          return s ? 125 : 93;
        case 222:
          return s ? 34 : 39;
      }
      return null;
    }),

    onKeydown: (function(event) {
      if (GLUT.specialFunc || GLUT.keyboardFunc) {
        var key = GLUT.getSpecialKey(event['keyCode']);
        if (key !== null) {
          if (GLUT.specialFunc) {
            event.preventDefault();
            GLUT.saveModifiers(event);
            Runtime.dynCall('viii', GLUT.specialFunc, [key, Browser.mouseX, Browser.mouseY]);
          }
        } else {
          key = GLUT.getASCIIKey(event);
          if (key !== null && GLUT.keyboardFunc) {
            event.preventDefault();
            GLUT.saveModifiers(event);
            Runtime.dynCall('viii', GLUT.keyboardFunc, [key, Browser.mouseX, Browser.mouseY]);
          }
        }
      }
    }),

    onKeyup: (function(event) {
      if (GLUT.specialUpFunc || GLUT.keyboardUpFunc) {
        var key = GLUT.getSpecialKey(event['keyCode']);
        if (key !== null) {
          if (GLUT.specialUpFunc) {
            event.preventDefault();
            GLUT.saveModifiers(event);
            Runtime.dynCall('viii', GLUT.specialUpFunc, [key, Browser.mouseX, Browser.mouseY]);
          }
        } else {
          key = GLUT.getASCIIKey(event);
          if (key !== null && GLUT.keyboardUpFunc) {
            event.preventDefault();
            GLUT.saveModifiers(event);
            Runtime.dynCall('viii', GLUT.keyboardUpFunc, [key, Browser.mouseX, Browser.mouseY]);
          }
        }
      }
    }),

    onMouseButtonDown: (function(event) {
      Browser.calculateMouseEvent(event);
      GLUT.buttons |= 1 << event['button'];
      if (event.target == Module['canvas'] && GLUT.mouseFunc) {
        try {
          event.target.setCapture();
        } catch (e) {}
        event.preventDefault();
        GLUT.saveModifiers(event);
        Runtime.dynCall('viiii', GLUT.mouseFunc, [event['button'], 0, Browser.mouseX, Browser.mouseY]);
      }
    }),

    onMouseButtonUp: (function(event) {
      Browser.calculateMouseEvent(event);
      GLUT.buttons &= ~(1 << event['button']);
      if (GLUT.mouseFunc) {
        event.preventDefault();
        GLUT.saveModifiers(event);
        Runtime.dynCall('viiii', GLUT.mouseFunc, [event['button'], 1, Browser.mouseX, Browser.mouseY]);
      }
    }),

    onMouseWheel: (function(event) {
      Browser.calculateMouseEvent(event);
      var e = window.event || event;
      var delta = -Browser.getMouseWheelDelta(event);
      delta = delta == 0 ? 0 : delta > 0 ? Math.max(delta, 1) : Math.min(delta, -1);
      var button = 3;
      if (delta < 0) {
        button = 4;
      }

      if (GLUT.mouseFunc) {
        event.preventDefault();
        GLUT.saveModifiers(event);
        Runtime.dynCall('viiii', GLUT.mouseFunc, [button, 0, Browser.mouseX, Browser.mouseY]);
      }
    }),

    onFullScreenEventChange: (function(event) {
      var width;
      var height;
      if (document['fullScreen'] || document['webkitIsFullScreen']) {
        width = screen['width'];
        height = screen['height'];
      } else {
        width = GLUT.windowWidth;
        height = GLUT.windowHeight;
        document.removeEventListener('fullscreenchange', GLUT.onFullScreenEventChange, true);
        document.removeEventListener('webkitfullscreenchange', GLUT.onFullScreenEventChange, true);
      }

      Browser.setCanvasSize(width, height);
      if (GLUT.reshapeFunc) {
        Runtime.dynCall('vii', GLUT.reshapeFunc, [width, height]);
      }

      _glutPostRedisplay();
    }),

    requestFullScreen: (function() {
      var RFS = Module['canvas']['requestFullscreen'] || Module['canvas']['requestFullScreen'] || Module['canvas']['webkitRequestFullScreen'] || (function() {});

      RFS.apply(Module['canvas'], []);
    }),

    cancelFullScreen: (function() {
      var CFS = document['exitFullscreen'] || document['cancelFullScreen'] || document['webkitCancelFullScreen'] || (function() {});

      CFS.apply(document, []);
    })
  };

  function _glutInitDisplayMode(mode) {
    GLUT.initDisplayMode = mode;
  }

  function _glutCreateWindow(name) {
    var contextAttributes = {
      antialias: (GLUT.initDisplayMode & 128) != 0,
      depth: (GLUT.initDisplayMode & 16) != 0,
      stencil: (GLUT.initDisplayMode & 32) != 0
    };
    Module.ctx = Browser.createContext(Module['canvas'], true, true, contextAttributes);
    return Module.ctx ? 1 : 0;
  }

  function _eglCreateContext(display, config, hmm, contextAttribs) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    var glesContextVersion = 1;
    for (;;) {
      var param = HEAP32[contextAttribs >> 2];
      if (param == 12440) {
        glesContextVersion = HEAP32[contextAttribs + 4 >> 2];
      } else if (param == 12344) {
        break;
      } else {
        EGL.setErrorCode(12292);
        return 0;
      }

      contextAttribs += 8;
    }

    if (glesContextVersion != 2) {
      EGL.setErrorCode(12293);
      return 0;
    }

    _glutInitDisplayMode(178);
    EGL.windowID = _glutCreateWindow();
    if (EGL.windowID != 0) {
      EGL.setErrorCode(12288);
      return 62004;
    } else {
      EGL.setErrorCode(12297);
      return 0;
    }
  }

  function _emscripten_glReadPixels(x, y, width, height, format, type, pixels) {
    var data = GL.getTexPixelData(type, format, width, height, pixels, format);
    if (!data.pixels) {
      GL.recordError(1280);
      return;
    }

    GLctx.readPixels(x, y, width, height, format, type, data.pixels);
  }

  function _emscripten_cancel_main_loop() {
    Browser.mainLoop.pause();
    Browser.mainLoop.func = null;
  }

  function _emscripten_glGetError() {
    if (GL.lastError) {
      var error = GL.lastError;
      GL.lastError = 0;
      return error;
    } else {
      return GLctx.getError();
    }
  }

  function _eglBindAPI(api) {
    if (api == 12448) {
      EGL.setErrorCode(12288);
      return 1;
    } else {
      EGL.setErrorCode(12300);
      return 0;
    }
  }

  function _emscripten_glIsEnabled(x0) {
    return GLctx.isEnabled(x0);
  }

  function _getpwnam() {
    throw 'getpwnam: TODO';
  }

  Module['_memmove'] = _memmove;

  function _emscripten_glClearDepthf(x0) {
    GLctx.clearDepth(x0);
  }

  function _calloc(n, s) {
    var ret = _malloc(n * s);
    _memset(ret, 0, n * s);
    return ret;
  }

  Module['_calloc'] = _calloc;

  function _newlocale(mask, locale, base) {
    if (!LOCALE.check(locale)) {
      ___setErrNo(ERRNO_CODES.ENOENT);
      return 0;
    }

    if (!base) base = _calloc(1, 4);
    return base;
  }

  function _signal(sig, func) {
    Module.printErr('Calling stub instead of signal()');
    return 0;
  }

  function _emscripten_glVertexAttrib4f(x0, x1, x2, x3, x4) {
    GLctx.vertexAttrib4f(x0, x1, x2, x3, x4);
  }

  var _sin = Math_sin;

  function ___cxa_free_exception(ptr) {
    try {
      return _free(ptr);
    } catch (e) {}
  }

  function ___cxa_end_catch() {
    if (___cxa_end_catch.rethrown) {
      ___cxa_end_catch.rethrown = false;
      return;
    }

    asm['setThrew'](0);
    var ptr = EXCEPTIONS.caught.pop();
    if (ptr) {
      EXCEPTIONS.decRef(EXCEPTIONS.deAdjust(ptr));
      EXCEPTIONS.last = 0;
    }
  }

  function ___cxa_rethrow() {
    ___cxa_end_catch.rethrown = true;
    var ptr = EXCEPTIONS.caught.pop();
    EXCEPTIONS.last = ptr;
    throw ptr + ' - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.';
  }

  function _emscripten_glClear(x0) {
    GLctx.clear(x0);
  }

  function _emscripten_get_now() {
    if (!_emscripten_get_now.actual) {
      _emscripten_get_now.actual = function _emscripten_get_now_actual() {
        var t = process['hrtime']();
        return t[0] * 1e3 + t[1] / 1e6;
      };
    }

    return _emscripten_get_now.actual();
  }

  function _emscripten_get_now_is_monotonic() {
    // return ENVIRONMENT_IS_NODE || typeof dateNow !== "undefined" || (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && self["performance"] && self["performance"]["now"]
    return true;
  }

  function _clock_gettime(clk_id, tp) {
    var now;
    if (clk_id === 0) {
      now = Date.now();
    } else if (clk_id === 1 && _emscripten_get_now_is_monotonic()) {
      now = _emscripten_get_now();
    } else {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

    HEAP32[tp >> 2] = now / 1e3 | 0;
    HEAP32[tp + 4 >> 2] = now % 1e3 * 1e3 * 1e3 | 0;
    return 0;
  }

  function _emscripten_glBindBuffer(target, buffer) {
    var bufferObj = buffer ? GL.buffers[buffer] : null;
    GLctx.bindBuffer(target, bufferObj);
  }

  function _emscripten_glGetUniformfv(program, location, params) {
    var data = GLctx.getUniform(GL.programs[program], GL.uniforms[location]);
    if (typeof data == 'number') {
      HEAPF32[params >> 2] = data;
    } else {
      for (var i = 0; i < data.length; i++) {
        HEAPF32[params + i >> 2] = data[i];
      }
    }
  }

  function _readdir_r(dirp, entry, result) {
    var stream = FS.getStreamFromPtr(dirp);
    if (!stream) {
      return ___setErrNo(ERRNO_CODES.EBADF);
    }

    if (!stream.currReading) {
      try {
        stream.currReading = FS.readdir(stream.path);
      } catch (e) {
        return FS.handleFSError(e);
      }
    }

    if (stream.position < 0 || stream.position >= stream.currReading.length) {
      HEAP32[result >> 2] = 0;
      return 0;
    }

    var id;
    var type;
    var name = stream.currReading[stream.position++];
    if (!name.indexOf('.')) {
      id = 1;
      type = 4;
    } else {
      try {
        var child = FS.lookupNode(stream.node, name);
      } catch (e) {
        return _readdir_r(dirp, entry, result);
      }
      id = child.id;
      type = FS.isChrdev(child.mode) ? 2 : FS.isDir(child.mode) ? 4 : FS.isLink(child.mode) ? 10 : 8;
    }

    HEAP32[entry >> 2] = id;
    HEAP32[entry + 4 >> 2] = stream.position;
    HEAP32[entry + 8 >> 2] = 268;
    for (var i = 0; i < name.length; i++) {
      HEAP8[entry + 11 + i >> 0] = name.charCodeAt(i);
    }

    HEAP8[entry + 11 + i >> 0] = 0;
    HEAP8[entry + 10 >> 0] = type;
    HEAP32[result >> 2] = entry;
    return 0;
  }

  function _readdir(dirp) {
    var stream = FS.getStreamFromPtr(dirp);
    if (!stream) {
      ___setErrNo(ERRNO_CODES.EBADF);
      return 0;
    }

    if (!_readdir.entry) _readdir.entry = _malloc(268);
    if (!_readdir.result) _readdir.result = _malloc(4);
    var err = _readdir_r(dirp, _readdir.entry, _readdir.result);
    if (err) {
      ___setErrNo(err);
      return 0;
    }

    return HEAP32[_readdir.result >> 2];
  }

  function _emscripten_exit_pointerlock() {
    JSEvents.removeDeferredCalls(JSEvents.requestPointerLock);
    if (document.exitPointerLock) {
      document.exitPointerLock();
    } else if (document.webkitExitPointerLock) {
      document.webkitExitPointerLock();
    } else {
      return -1;
    }

    return 0;
  }

  function ___cxa_pure_virtual() {
    ABORT = true;
    throw 'Pure virtual function called!';
  }

  function _fgets(s, n, stream) {
    var streamObj = FS.getStreamFromPtr(stream);
    if (!streamObj) return 0;
    if (streamObj.error || streamObj.eof) return 0;
    var byte_;
    for (var i = 0; i < n - 1 && byte_ != 10; i++) {
      byte_ = _fgetc(stream);
      if (byte_ == -1) {
        if (streamObj.error || streamObj.eof && i == 0) return 0;
        else if (streamObj.eof) break;
      }

      HEAP8[s + i >> 0] = byte_;
    }

    HEAP8[s + i >> 0] = 0;
    return s;
  }

  function _emscripten_glGetAttachedShaders(program, maxCount, count, shaders) {
    var result = GLctx.getAttachedShaders(GL.programs[program]);
    var len = result.length;
    if (len > maxCount) {
      len = maxCount;
    }

    HEAP32[count >> 2] = len;
    for (var i = 0; i < len; ++i) {
      var id = GL.shaders.indexOf(result[i]);
      HEAP32[shaders + i * 4 >> 2] = id;
    }
  }

  function _emscripten_glGenRenderbuffers(n, renderbuffers) {
    for (var i = 0; i < n; i++) {
      var renderbuffer = GLctx.createRenderbuffer();
      if (!renderbuffer) {
        GL.recordError(1282);
        while (i < n) HEAP32[renderbuffers + i++ * 4 >> 2] = 0;
        return;
      }

      var id = GL.getNewId(GL.renderbuffers);
      renderbuffer.name = id;
      GL.renderbuffers[id] = renderbuffer;
      HEAP32[renderbuffers + i * 4 >> 2] = id;
    }
  }

  function _emscripten_force_exit(status) {
    Module['noExitRuntime'] = false;
    Module['exit'](status);
  }

  function _emscripten_glLinkProgram(program) {
    GLctx.linkProgram(GL.programs[program]);
    GL.programInfos[program] = null;
    GL.populateUniformTable(program);
  }

  function _emscripten_glUniform1iv(location, count, value) {
    location = GL.uniforms[location];
    value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
    GLctx.uniform1iv(location, value);
  }

  function _emscripten_glTexCoordPointer() {
    Module['printErr']('missing function: emscripten_glTexCoordPointer');
    abort(-1);
  }

  function _emscripten_glGetInfoLogARB() {
    Module['printErr']('missing function: emscripten_glGetInfoLogARB');
    abort(-1);
  }

  function __exit(status) {
    Module['exit'](status);
  }

  function _exit(status) {
    __exit(status);
  }

  function _pthread_setspecific(key, value) {
    if (!(key in PTHREAD_SPECIFIC)) {
      return ERRNO_CODES.EINVAL;
    }

    PTHREAD_SPECIFIC[key] = value;
    return 0;
  }

  function ___ctype_b_loc() {
    var me = ___ctype_b_loc;
    if (!me.ret) {
      var values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 8195, 8194, 8194, 8194, 8194, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 24577, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 55304, 55304, 55304, 55304, 55304, 55304, 55304, 55304, 55304, 55304, 49156, 49156, 49156, 49156, 49156, 49156, 49156, 54536, 54536, 54536, 54536, 54536, 54536, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 50440, 49156, 49156, 49156, 49156, 49156, 49156, 54792, 54792, 54792, 54792, 54792, 54792, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 50696, 49156, 49156, 49156, 49156, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      var i16size = 2;
      var arr = _malloc(values.length * i16size);
      for (var i = 0; i < values.length; i++) {
        HEAP16[arr + i * i16size >> 1] = values[i];
      }

      me.ret = allocate([arr + 128 * i16size], 'i16*', ALLOC_NORMAL);
    }

    return me.ret;
  }

  function _emscripten_glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
    if (data) {
      data = HEAPU8.subarray(data, data + imageSize);
    } else {
      data = null;
    }

    GLctx['compressedTexSubImage2D'](target, level, xoffset, yoffset, width, height, format, data);
  }

  function _emscripten_glRenderbufferStorage(x0, x1, x2, x3) {
    GLctx.renderbufferStorage(x0, x1, x2, x3);
  }

  function _catgets(catd, set_id, msg_id, s) {
    return s;
  }

  function _emscripten_set_mousemove_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 8, 'mousemove');
    return 0;
  }

  function _getcwd(buf, size) {
    if (size == 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    }

    var cwd = FS.cwd();
    if (size < cwd.length + 1) {
      ___setErrNo(ERRNO_CODES.ERANGE);
      return 0;
    } else {
      writeAsciiToMemory(cwd, buf);
      return buf;
    }
  }

  var _atan2 = Math_atan2;

  function _emscripten_glShaderBinary() {
    GL.recordError(1280);
  }

  function _emscripten_glIsProgram(program) {
    var program = GL.programs[program];
    if (!program) return 0;
    return GLctx.isProgram(program);
  }

  function ___cxa_begin_catch(ptr) {
    __ZSt18uncaught_exceptionv.uncaught_exception--;
    EXCEPTIONS.caught.push(ptr);
    EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
    return ptr;
  }

  function _eglInitialize(display, majorVersion, minorVersion) {
    if (display == 62e3) {
      if (majorVersion) {
        HEAP32[majorVersion >> 2] = 1;
      }

      if (minorVersion) {
        HEAP32[minorVersion >> 2] = 4;
      }

      EGL.defaultDisplayInitialized = true;
      EGL.setErrorCode(12288);
      return 1;
    } else {
      EGL.setErrorCode(12296);
      return 0;
    }
  }

  function _emscripten_glBlendColor(x0, x1, x2, x3) {
    GLctx.blendColor(x0, x1, x2, x3);
  }

  function _emscripten_glGetShaderiv(shader, pname, p) {
    if (pname == 35716) {
      var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
      if (!log) log = '(unknown error)';
      HEAP32[p >> 2] = log.length + 1;
    } else {
      HEAP32[p >> 2] = GLctx.getShaderParameter(GL.shaders[shader], pname);
    }
  }

  function _emscripten_glUniformMatrix3fv(location, count, transpose, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[8];
      for (var i = 0; i < 9; i++) {
        view[i] = HEAPF32[value + i * 4 >> 2];
      }
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 36 >> 2);
    }

    GLctx.uniformMatrix3fv(location, transpose, view);
  }

  function _emscripten_glUniform4fv(location, count, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[3];
      view[0] = HEAPF32[value >> 2];
      view[1] = HEAPF32[value + 4 >> 2];
      view[2] = HEAPF32[value + 8 >> 2];
      view[3] = HEAPF32[value + 12 >> 2];
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 16 >> 2);
    }

    GLctx.uniform4fv(location, view);
  }

  var _environ = allocate(1, 'i32*', ALLOC_STATIC);
  var ___environ = _environ;

  function ___buildEnvironment(env) {
    var MAX_ENV_VALUES = 64;
    var TOTAL_ENV_SIZE = 1024;
    var poolPtr;
    var envPtr;
    if (!___buildEnvironment.called) {
      ___buildEnvironment.called = true;
      ENV['USER'] = 'web_user';
      ENV['PATH'] = '/';
      ENV['PWD'] = '/';
      ENV['HOME'] = '/home/web_user';
      ENV['LANG'] = 'C';
      ENV['_'] = Module['thisProgram'];
      poolPtr = allocate(TOTAL_ENV_SIZE, 'i8', ALLOC_STATIC);
      envPtr = allocate(MAX_ENV_VALUES * 4, 'i8*', ALLOC_STATIC);
      HEAP32[envPtr >> 2] = poolPtr;
      HEAP32[_environ >> 2] = envPtr;
    } else {
      envPtr = HEAP32[_environ >> 2];
      poolPtr = HEAP32[envPtr >> 2];
    }

    var strings = [];
    var totalSize = 0;
    for (var key in env) {
      if (typeof env[key] === 'string') {
        var line = key + '=' + env[key];
        strings.push(line);
        totalSize += line.length;
      }
    }

    if (totalSize > TOTAL_ENV_SIZE) {
      throw new Error('Environment size exceeded TOTAL_ENV_SIZE!');
    }

    var ptrSize = 4;
    for (var i = 0; i < strings.length; i++) {
      var line = strings[i];
      writeAsciiToMemory(line, poolPtr);
      HEAP32[envPtr + i * ptrSize >> 2] = poolPtr;
      poolPtr += line.length + 1;
    }

    HEAP32[envPtr + strings.length * ptrSize >> 2] = 0;
  }

  var ENV = {};

  function _putenv(string) {
    if (string === 0) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

    string = Pointer_stringify(string);
    var splitPoint = string.indexOf('=');
    if (string === '' || string.indexOf('=') === -1) {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return -1;
    }

    var name = string.slice(0, splitPoint);
    var value = string.slice(splitPoint + 1);
    if (!(name in ENV) || ENV[name] !== value) {
      ENV[name] = value;
      ___buildEnvironment(ENV);
    }

    return 0;
  }

  function _emscripten_set_fullscreenchange_callback(target, userData, useCapture, callbackfunc) {
    if (typeof JSEvents.fullscreenEnabled() === 'undefined') return -1;
    if (!target) target = document;
    else {
      target = JSEvents.findEventTarget(target);
      if (!target) return -4;
    }

    JSEvents.registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, 'fullscreenchange');
    JSEvents.registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, 'webkitfullscreenchange');
    return 0;
  }

  function _emscripten_glGenFramebuffers(n, ids) {
    for (var i = 0; i < n; ++i) {
      var framebuffer = GLctx.createFramebuffer();
      if (!framebuffer) {
        GL.recordError(1282);
        while (i < n) HEAP32[ids + i++ * 4 >> 2] = 0;
        return;
      }

      var id = GL.getNewId(GL.framebuffers);
      framebuffer.name = id;
      GL.framebuffers[id] = framebuffer;
      HEAP32[ids + i * 4 >> 2] = id;
    }
  }

  Module['_strcpy'] = _strcpy;

  function _emscripten_glBlendEquationSeparate(x0, x1) {
    GLctx.blendEquationSeparate(x0, x1);
  }

  function _eglWaitNative(nativeEngineId) {
    EGL.setErrorCode(12288);
    return 1;
  }

  function _usleep(useconds) {
    var msec = useconds / 1e3;
    if ((ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && self['performance'] && self['performance']['now']) {
      var start = self['performance']['now']();
      while (self['performance']['now']() - start < msec) {}
    } else {
      var start = Date.now();
      while (Date.now() - start < msec) {}
    }

    return 0;
  }

  function _nanosleep(rqtp, rmtp) {
    var seconds = HEAP32[rqtp >> 2];
    var nanoseconds = HEAP32[rqtp + 4 >> 2];
    if (rmtp !== 0) {
      HEAP32[rmtp >> 2] = 0;
      HEAP32[rmtp + 4 >> 2] = 0;
    }

    return _usleep(seconds * 1e6 + nanoseconds / 1e3);
  }

  function _emscripten_glBindTexture(target, texture) {
    GLctx.bindTexture(target, texture ? GL.textures[texture] : null);
  }

  function _emscripten_glDrawRangeElements() {
    Module['printErr']('missing function: emscripten_glDrawRangeElements');
    abort(-1);
  }

  function _emscripten_glGenTextures(n, textures) {
    for (var i = 0; i < n; i++) {
      var texture = GLctx.createTexture();
      if (!texture) {
        GL.recordError(1282);
        while (i < n) HEAP32[textures + i++ * 4 >> 2] = 0;
        return;
      }

      var id = GL.getNewId(GL.textures);
      texture.name = id;
      GL.textures[id] = texture;
      HEAP32[textures + i * 4 >> 2] = id;
    }
  }

  function _emscripten_glVertexAttrib2fv(index, v) {
    v = HEAPF32.subarray(v >> 2, v + 8 >> 2);
    GLctx.vertexAttrib2fv(index, v);
  }

  function _emscripten_glGetActiveUniform(program, index, bufSize, length, size, type, name) {
    program = GL.programs[program];
    var info = GLctx.getActiveUniform(program, index);
    if (!info) return;
    var infoname = info.name.slice(0, Math.max(0, bufSize - 1));
    if (bufSize > 0 && name) {
      writeStringToMemory(infoname, name);
      if (length) HEAP32[length >> 2] = infoname.length;
    } else {
      if (length) HEAP32[length >> 2] = 0;
    }

    if (size) HEAP32[size >> 2] = info.size;
    if (type) HEAP32[type >> 2] = info.type;
  }

  function _emscripten_glDeleteObjectARB() {
    Module['printErr']('missing function: emscripten_glDeleteObjectARB');
    abort(-1);
  }

  function _emscripten_set_touchmove_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 24, 'touchmove');
    return 0;
  }

  function _emscripten_glUniform1f(location, v0) {
    location = GL.uniforms[location];
    GLctx.uniform1f(location, v0);
  }

  function _emscripten_glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
    GLctx.vertexAttribPointer(index, size, type, normalized, stride, ptr);
  }

  function _fopen(filename, mode) {
    var flags;
    mode = Pointer_stringify(mode);
    if (mode[0] == 'r') {
      if (mode.indexOf('+') != -1) {
        flags = 2;
      } else {
        flags = 0;
      }
    } else if (mode[0] == 'w') {
      if (mode.indexOf('+') != -1) {
        flags = 2;
      } else {
        flags = 1;
      }

      flags |= 64;
      flags |= 512;
    } else if (mode[0] == 'a') {
      if (mode.indexOf('+') != -1) {
        flags = 2;
      } else {
        flags = 1;
      }

      flags |= 64;
      flags |= 1024;
    } else {
      ___setErrNo(ERRNO_CODES.EINVAL);
      return 0;
    }

    var fd = _open(filename, flags, allocate([511, 0, 0, 0], 'i32', ALLOC_STACK));
    return fd === -1 ? 0 : FS.getPtrForStream(FS.getStream(fd));
  }

  Module['_strncpy'] = _strncpy;

  function _emscripten_glDrawArrays(mode, first, count) {
    GLctx.drawArrays(mode, first, count);
  }

  function _emscripten_glGenBuffers(n, buffers) {
    for (var i = 0; i < n; i++) {
      var buffer = GLctx.createBuffer();
      if (!buffer) {
        GL.recordError(1282);
        while (i < n) HEAP32[buffers + i++ * 4 >> 2] = 0;
        return;
      }

      var id = GL.getNewId(GL.buffers);
      buffer.name = id;
      GL.buffers[id] = buffer;
      HEAP32[buffers + i * 4 >> 2] = id;
    }
  }

  var _log = Math_log;

  function _emscripten_set_keypress_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerKeyEventCallback(target, userData, useCapture, callbackfunc, 1, 'keypress');
    return 0;
  }

  var PTHREAD_SPECIFIC_NEXT_KEY = 1;

  function _pthread_key_create(key, destructor) {
    if (key == 0) {
      return ERRNO_CODES.EINVAL;
    }

    HEAP32[key >> 2] = PTHREAD_SPECIFIC_NEXT_KEY;
    PTHREAD_SPECIFIC[PTHREAD_SPECIFIC_NEXT_KEY] = 0;
    PTHREAD_SPECIFIC_NEXT_KEY++;
    return 0;
  }

  function _mknod(path, mode, dev) {
    path = Pointer_stringify(path);
    switch (mode & 61440) {
      case 32768:
      case 8192:
      case 24576:
      case 4096:
      case 49152:
        break;
      default:
        ___setErrNo(ERRNO_CODES.EINVAL);
        return -1;
    }
    try {
      FS.mknod(path, mode, dev);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _mkdir(path, mode) {
    path = Pointer_stringify(path);
    path = PATH.normalize(path);
    if (path[path.length - 1] === '/') path = path.substr(0, path.length - 1);
    try {
      FS.mkdir(path, mode, 0);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _glutDestroyWindow(name) {
    Module.ctx = Browser.destroyContext(Module['canvas'], true, true);
    return 1;
  }

  function _eglDestroyContext(display, context) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    if (context != 62004) {
      EGL.setErrorCode(12294);
      return 0;
    }

    EGL.setErrorCode(12288);
    return 1;
  }

  function _emscripten_glGetUniformLocation(program, name) {
    name = Pointer_stringify(name);
    var arrayOffset = 0;
    if (name.indexOf(']', name.length - 1) !== -1) {
      var ls = name.lastIndexOf('[');
      var arrayIndex = name.slice(ls + 1, -1);
      if (arrayIndex.length > 0) {
        arrayOffset = parseInt(arrayIndex);
        if (arrayOffset < 0) {
          return -1;
        }
      }

      name = name.slice(0, ls);
    }

    var ptable = GL.programInfos[program];
    if (!ptable) {
      return -1;
    }

    var utable = ptable.uniforms;
    var uniformInfo = utable[name];
    if (uniformInfo && arrayOffset < uniformInfo[0]) {
      return uniformInfo[1] + arrayOffset;
    } else {
      return -1;
    }
  }

  function _rmdir(path) {
    path = Pointer_stringify(path);
    try {
      FS.rmdir(path);
      return 0;
    } catch (e) {
      FS.handleFSError(e);
      return -1;
    }
  }

  function _emscripten_glVertexAttrib4fv(index, v) {
    v = HEAPF32.subarray(v >> 2, v + 16 >> 2);
    GLctx.vertexAttrib4fv(index, v);
  }

  function _emscripten_glScissor(x0, x1, x2, x3) {
    GLctx.scissor(x0, x1, x2, x3);
  }

  Module['_bitshift64Lshr'] = _bitshift64Lshr;
  var _BDtoIHigh = true;

  function _emscripten_glIsShader(shader) {
    var s = GL.shaders[shader];
    if (!s) return 0;
    return GLctx.isShader(s);
  }

  function _getenv(name) {
    if (name === 0) return 0;
    name = Pointer_stringify(name);
    if (!ENV.hasOwnProperty(name)) return 0;
    if (_getenv.ret) _free(_getenv.ret);
    _getenv.ret = allocate(intArrayFromString(ENV[name]), 'i8', ALLOC_NORMAL);
    return _getenv.ret;
  }

  function _emscripten_glDrawBuffers(n, bufs) {
    var bufArray = [];
    for (var i = 0; i < n; i++) bufArray.push(HEAP32[bufs + i * 4 >> 2]);
    GL.currentContext.drawBuffersExt(bufArray);
  }

  function _vfprintf(s, f, va_arg) {
    return _fprintf(s, f, HEAP32[va_arg >> 2]);
  }

  function _pthread_mutex_unlock() {}

  function _emscripten_glBindFramebuffer(target, framebuffer) {
    GLctx.bindFramebuffer(target, framebuffer ? GL.framebuffers[framebuffer] : null);
  }

  function _emscripten_glBlendEquation(x0) {
    GLctx.blendEquation(x0);
  }

  function _emscripten_glBufferSubData(target, offset, size, data) {
    GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data + size));
  }

  function _emscripten_set_keydown_callback(target, userData, useCapture, callbackfunc) {
    JSEvents.registerKeyEventCallback(target, userData, useCapture, callbackfunc, 2, 'keydown');
    return 0;
  }

  function _emscripten_glBufferData(target, size, data, usage) {
    switch (usage) {
      case 35041:
      case 35042:
        usage = 35040;
        break;
      case 35045:
      case 35046:
        usage = 35044;
        break;
      case 35049:
      case 35050:
        usage = 35048;
        break;
    }
    if (!data) {
      GLctx.bufferData(target, size, usage);
    } else {
      GLctx.bufferData(target, HEAPU8.subarray(data, data + size), usage);
    }
  }

  function _sbrk(bytes) {
    var self = _sbrk;
    if (!self.called) {
      DYNAMICTOP = alignMemoryPage(DYNAMICTOP);
      self.called = true;
      assert(Runtime.dynamicAlloc);
      self.alloc = Runtime.dynamicAlloc;
      Runtime.dynamicAlloc = (function() {
        abort('cannot dynamically allocate, sbrk now has control');
      });
    }

    var ret = DYNAMICTOP;
    if (bytes != 0) self.alloc(bytes);
    return ret;
  }

  Module['_bitshift64Shl'] = _bitshift64Shl;
  var _BItoD = true;

  function _emscripten_glGetShaderSource(shader, bufSize, length, source) {
    var result = GLctx.getShaderSource(GL.shaders[shader]);
    if (!result) return;
    result = result.slice(0, Math.max(0, bufSize - 1));
    if (bufSize > 0 && source) {
      writeStringToMemory(result, source);
      if (length) HEAP32[length >> 2] = result.length;
    } else {
      if (length) HEAP32[length >> 2] = 0;
    }
  }

  Module['_llvm_bswap_i32'] = _llvm_bswap_i32;

  function _emscripten_glClearDepth(x0) {
    GLctx.clearDepth(x0);
  }

  function ___cxa_guard_release() {}

  function _ungetc(c, stream) {
    stream = FS.getStreamFromPtr(stream);
    if (!stream) {
      return -1;
    }

    if (c === -1) {
      return c;
    }

    c = unSign(c & 255);
    stream.ungotten.push(c);
    stream.eof = false;
    return c;
  }

  function _uselocale(locale) {
    var old = LOCALE.curr;
    if (locale) LOCALE.curr = locale;
    return old;
  }

  function _emscripten_glGetFloatv(name_, p) {
    return GL.get(name_, p, 'Float');
  }

  function _emscripten_glUniform3fv(location, count, value) {
    location = GL.uniforms[location];
    var view;
    if (count === 1) {
      view = GL.miniTempBufferViews[2];
      view[0] = HEAPF32[value >> 2];
      view[1] = HEAPF32[value + 4 >> 2];
      view[2] = HEAPF32[value + 8 >> 2];
    } else {
      view = HEAPF32.subarray(value >> 2, value + count * 12 >> 2);
    }

    GLctx.uniform3fv(location, view);
  }

  function _emscripten_glDrawElementsInstanced(mode, count, type, indices, primcount) {
    GL.currentContext.instancedArraysExt.drawElementsInstancedANGLE(mode, count, type, indices, primcount);
  }

  function _eglMakeCurrent(display, draw, read, context) {
    if (display != 62e3) {
      EGL.setErrorCode(12296);
      return 0;
    }

    if (context != 0 && context != 62004) {
      EGL.setErrorCode(12294);
      return 0;
    }

    if (read != 0 && read != 62006 || draw != 0 && draw != 62006) {
      EGL.setErrorCode(12301);
      return 0;
    }

    EGL.currentContext = context;
    EGL.currentDrawSurface = draw;
    EGL.currentReadSurface = read;
    EGL.setErrorCode(12288);
    return 1;
  }

  function _emscripten_glDrawElements(mode, count, type, indices) {
    GLctx.drawElements(mode, count, type, indices);
  }

  var _DtoIHigh = true;

  function _emscripten_glCreateProgram() {
    var id = GL.getNewId(GL.programs);
    var program = GLctx.createProgram();
    program.name = id;
    GL.programs[id] = program;
    return id;
  }

  function _pthread_once(ptr, func) {
    if (!_pthread_once.seen) _pthread_once.seen = {};
    if (ptr in _pthread_once.seen) return;
    Runtime.dynCall('v', func);
    _pthread_once.seen[ptr] = 1;
  }

  function _emscripten_glDeleteFramebuffers(n, framebuffers) {
    for (var i = 0; i < n; ++i) {
      var id = HEAP32[framebuffers + i * 4 >> 2];
      var framebuffer = GL.framebuffers[id];
      if (!framebuffer) continue;
      GLctx.deleteFramebuffer(framebuffer);
      framebuffer.name = 0;
      GL.framebuffers[id] = null;
    }
  }

  function _emscripten_glClearColor(x0, x1, x2, x3) {
    GLctx.clearColor(x0, x1, x2, x3);
  }

  function _emscripten_glBindVertexArray(vao) {
    GL.currentContext.vaoExt.bindVertexArrayOES(GL.vaos[vao]);
  }

  var _floor = Math_floor;

  function _emscripten_glLoadMatrixf() {
    Module['printErr']('missing function: emscripten_glLoadMatrixf');
    abort(-1);
  }

  function _malloc(bytes) {
    var ptr = Runtime.dynamicAlloc(bytes + 8);
    return ptr + 8 & 4294967288;
  }

  Module['_malloc'] = _malloc;

  function ___cxa_allocate_exception(size) {
    return _malloc(size);
  }

  function _emscripten_glGetProgramInfoLog(program, maxLength, length, infoLog) {
    var log = GLctx.getProgramInfoLog(GL.programs[program]);
    if (!log) log = '';
    log = log.substr(0, maxLength - 1);
    if (maxLength > 0 && infoLog) {
      writeStringToMemory(log, infoLog);
      if (length) HEAP32[length >> 2] = log.length;
    } else {
      if (length) HEAP32[length >> 2] = 0;
    }
  }

  function _emscripten_glFrontFace(x0) {
    GLctx.frontFace(x0);
  }

  function _emscripten_glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
    if (pixels) {
      var data = GL.getTexPixelData(type, format, width, height, pixels, internalFormat);
      pixels = data.pixels;
      internalFormat = data.internalFormat;
    } else {
      pixels = null;
    }

    GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixels);
  }

  function _emscripten_glActiveTexture(x0) {
    GLctx.activeTexture(x0);
  }

  function _catopen(name, oflag) {
    return -1;
  }

  function ___ctype_toupper_loc() {
    var me = ___ctype_toupper_loc;
    if (!me.ret) {
      var values = [128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255];
      var i32size = 4;
      var arr = _malloc(values.length * i32size);
      for (var i = 0; i < values.length; i++) {
        HEAP32[arr + i * i32size >> 2] = values[i];
      }

      me.ret = allocate([arr + 128 * i32size], 'i32*', ALLOC_NORMAL);
    }

    return me.ret;
  }

  function _closedir(dirp) {
    var fd = _fileno(dirp);
    var stream = FS.getStream(fd);
    if (stream.currReading) stream.currReading = null;
    return _close(fd);
  }

  function _emscripten_glFlush() {
    GLctx.flush();
  }

  function _emscripten_glCreateShader(shaderType) {
    var id = GL.getNewId(GL.shaders);
    GL.shaders[id] = GLctx.createShader(shaderType);
    return id;
  }

  function _emscripten_glCopyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7) {
    GLctx.copyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7);
  }

  function _emscripten_glValidateProgram(program) {
    GLctx.validateProgram(GL.programs[program]);
  }

  function _emscripten_glColorMask(x0, x1, x2, x3) {
    GLctx.colorMask(x0, x1, x2, x3);
  }

  function _emscripten_glPixelStorei(pname, param) {
    if (pname == 3333) {
      GL.packAlignment = param;
    } else if (pname == 3317) {
      GL.unpackAlignment = param;
    }

    GLctx.pixelStorei(pname, param);
  }

  function _emscripten_glDeleteTextures(n, textures) {
    for (var i = 0; i < n; i++) {
      var id = HEAP32[textures + i * 4 >> 2];
      var texture = GL.textures[id];
      if (!texture) continue;
      GLctx.deleteTexture(texture);
      texture.name = 0;
      GL.textures[id] = null;
    }
  }

  function _eglGetDisplay(nativeDisplayType) {
    EGL.setErrorCode(12288);
    return 62e3;
  }

  function _emscripten_set_canvas_size(width, height) {
    Browser.setCanvasSize(width, height);
  }

  function _emscripten_glGenVertexArrays(n, arrays) {
    for (var i = 0; i < n; i++) {
      var vao = GL.currentContext.vaoExt.createVertexArrayOES();
      if (!vao) {
        GL.recordError(1282);
        while (i < n) HEAP32[arrays + i++ * 4 >> 2] = 0;
        return;
      }

      var id = GL.getNewId(GL.vaos);
      vao.name = id;
      GL.vaos[id] = vao;
      HEAP32[arrays + i * 4 >> 2] = id;
    }
  }

  function _time(ptr) {
    var ret = Date.now() / 1e3 | 0;
    if (ptr) {
      HEAP32[ptr >> 2] = ret;
    }

    return ret;
  }

  function _emscripten_glGetBooleanv(name_, p) {
    return GL.get(name_, p, 'Boolean');
  }

  function _emscripten_glCompileShader(shader) {
    GLctx.compileShader(GL.shaders[shader]);
  }

  var ___dso_handle = allocate(1, 'i32*', ALLOC_STATIC);
  var GLctx;
  GL.init();
  FS.staticInit();
  __ATINIT__.unshift({
    func: (function() {
      if (!Module['noFSInit'] && !FS.init.initialized) FS.init();
    })
  });
  __ATMAIN__.push({
    func: (function() {
      FS.ignorePermissions = false;
    })
  });
  __ATEXIT__.push({
    func: (function() {
      FS.quit();
    })
  });
  Module['FS_createFolder'] = FS.createFolder;
  Module['FS_createPath'] = FS.createPath;
  Module['FS_createDataFile'] = FS.createDataFile;
  Module['FS_createPreloadedFile'] = FS.createPreloadedFile;
  Module['FS_createLazyFile'] = FS.createLazyFile;
  Module['FS_createLink'] = FS.createLink;
  Module['FS_createDevice'] = FS.createDevice;
  ___errno_state = Runtime.staticAlloc(4);
  HEAP32[___errno_state >> 2] = 0;
  __ATINIT__.unshift({
    func: (function() {
      TTY.init();
    })
  });
  __ATEXIT__.push({
    func: (function() {
      TTY.shutdown();
    })
  });

  var fs = require('fs');
  NODEFS.staticInit();

  _fputc.ret = allocate([0], 'i8', ALLOC_STATIC);
  __ATINIT__.push({
    func: (function() {
      SOCKFS.root = FS.mount(SOCKFS, {}, null);
    })
  });
  Module['requestFullScreen'] = function Module_requestFullScreen(lockPointer, resizeCanvas) {
    Browser.requestFullScreen(lockPointer, resizeCanvas);
  };

  Module['requestAnimationFrame'] = function Module_requestAnimationFrame(func) {
    Browser.requestAnimationFrame(func);
  };

  Module['setCanvasSize'] = function Module_setCanvasSize(width, height, noUpdates) {
    Browser.setCanvasSize(width, height, noUpdates);
  };

  Module['pauseMainLoop'] = function Module_pauseMainLoop() {
    Browser.mainLoop.pause();
  };

  Module['resumeMainLoop'] = function Module_resumeMainLoop() {
    Browser.mainLoop.resume();
  };

  Module['getUserMedia'] = function Module_getUserMedia() {
    Browser.getUserMedia();
  };

  _fgetc.ret = allocate([0], 'i8', ALLOC_STATIC);
  ___buildEnvironment(ENV);
  STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);
  staticSealed = true;
  STACK_MAX = STACK_BASE + TOTAL_STACK;
  DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);
  assert(DYNAMIC_BASE < TOTAL_MEMORY, 'TOTAL_MEMORY not big enough for stack');
  var cttz_i8 = allocate([8, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 7, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0], 'i8', ALLOC_DYNAMIC);

  function invoke_iiiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      return Module['dynCall_iiiiiiii'](index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiii(index, a1, a2, a3, a4, a5) {
    try {
      Module['dynCall_viiiii'](index, a1, a2, a3, a4, a5);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vd(index, a1) {
    try {
      Module['dynCall_vd'](index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vid(index, a1, a2) {
    try {
      Module['dynCall_vid'](index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vi(index, a1) {
    try {
      Module['dynCall_vi'](index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vii(index, a1, a2) {
    try {
      Module['dynCall_vii'](index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiiiiii(index, a1, a2, a3, a4, a5, a6) {
    try {
      return Module['dynCall_iiiiiii'](index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_ii(index, a1) {
    try {
      return Module['dynCall_ii'](index, a1);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
    try {
      Module['dynCall_viiiiiiiiiii'](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viddd(index, a1, a2, a3, a4) {
    try {
      Module['dynCall_viddd'](index, a1, a2, a3, a4);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiiii(index, a1, a2, a3, a4) {
    try {
      return Module['dynCall_iiiii'](index, a1, a2, a3, a4);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vidd(index, a1, a2, a3) {
    try {
      Module['dynCall_vidd'](index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiii(index, a1, a2, a3) {
    try {
      return Module['dynCall_iiii'](index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiid(index, a1, a2, a3, a4, a5, a6) {
    try {
      Module['dynCall_viiiiid'](index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
    try {
      Module['dynCall_viiiiiiii'](index, a1, a2, a3, a4, a5, a6, a7, a8);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiii(index, a1, a2, a3, a4, a5, a6) {
    try {
      Module['dynCall_viiiiii'](index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viii(index, a1, a2, a3) {
    try {
      Module['dynCall_viii'](index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viid(index, a1, a2, a3) {
    try {
      Module['dynCall_viid'](index, a1, a2, a3);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vidddd(index, a1, a2, a3, a4, a5) {
    try {
      Module['dynCall_vidddd'](index, a1, a2, a3, a4, a5);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vdi(index, a1, a2) {
    try {
      Module['dynCall_vdi'](index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      Module['dynCall_viiiiiii'](index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiiid(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      Module['dynCall_viiiiiid'](index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
    try {
      Module['dynCall_viiiiiiiii'](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iii(index, a1, a2) {
    try {
      return Module['dynCall_iii'](index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiiiii(index, a1, a2, a3, a4, a5) {
    try {
      return Module['dynCall_iiiiii'](index, a1, a2, a3, a4, a5);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_i(index) {
    try {
      return Module['dynCall_i'](index);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiiiidii(index, a1, a2, a3, a4, a5, a6, a7) {
    try {
      return Module['dynCall_iiiiidii'](index, a1, a2, a3, a4, a5, a6, a7);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
    try {
      return Module['dynCall_iiiiiiiiii'](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vdddddd(index, a1, a2, a3, a4, a5, a6) {
    try {
      Module['dynCall_vdddddd'](index, a1, a2, a3, a4, a5, a6);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vdddd(index, a1, a2, a3, a4) {
    try {
      Module['dynCall_vdddd'](index, a1, a2, a3, a4);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_vdd(index, a1, a2) {
    try {
      Module['dynCall_vdd'](index, a1, a2);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_v(index) {
    try {
      Module['dynCall_v'](index);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_iiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
    try {
      return Module['dynCall_iiiiiiiii'](index, a1, a2, a3, a4, a5, a6, a7, a8);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  function invoke_viiii(index, a1, a2, a3, a4) {
    try {
      Module['dynCall_viiii'](index, a1, a2, a3, a4);
    } catch (e) {
      if (typeof e !== 'number' && e !== 'longjmp') throw e;
      asm['setThrew'](1, 0);
    }
  }

  Module.asmGlobalArg = {
    Math: Math,
    Int8Array: Int8Array,
    Int16Array: Int16Array,
    Int32Array: Int32Array,
    Uint8Array: Uint8Array,
    Uint16Array: Uint16Array,
    Uint32Array: Uint32Array,
    Float32Array: Float32Array,
    Float64Array: Float64Array,
    NaN: NaN,
    Infinity: Infinity
  };
  Module.asmLibraryArg = {
    abort: abort,
    assert: assert,
    invoke_iiiiiiii: invoke_iiiiiiii,
    invoke_viiiii: invoke_viiiii,
    invoke_vd: invoke_vd,
    invoke_vid: invoke_vid,
    invoke_vi: invoke_vi,
    invoke_vii: invoke_vii,
    invoke_iiiiiii: invoke_iiiiiii,
    invoke_ii: invoke_ii,
    invoke_viiiiiiiiiii: invoke_viiiiiiiiiii,
    invoke_viddd: invoke_viddd,
    invoke_iiiii: invoke_iiiii,
    invoke_vidd: invoke_vidd,
    invoke_iiii: invoke_iiii,
    invoke_viiiiid: invoke_viiiiid,
    invoke_viiiiiiii: invoke_viiiiiiii,
    invoke_viiiiii: invoke_viiiiii,
    invoke_viii: invoke_viii,
    invoke_viid: invoke_viid,
    invoke_vidddd: invoke_vidddd,
    invoke_vdi: invoke_vdi,
    invoke_viiiiiii: invoke_viiiiiii,
    invoke_viiiiiid: invoke_viiiiiid,
    invoke_viiiiiiiii: invoke_viiiiiiiii,
    invoke_iii: invoke_iii,
    invoke_iiiiii: invoke_iiiiii,
    invoke_i: invoke_i,
    invoke_iiiiidii: invoke_iiiiidii,
    invoke_iiiiiiiiii: invoke_iiiiiiiiii,
    invoke_vdddddd: invoke_vdddddd,
    invoke_vdddd: invoke_vdddd,
    invoke_vdd: invoke_vdd,
    invoke_v: invoke_v,
    invoke_iiiiiiiii: invoke_iiiiiiiii,
    invoke_viiii: invoke_viiii,
    _emscripten_glGetTexParameterfv: _emscripten_glGetTexParameterfv,
    _fabs: _fabs,
    _emscripten_glBlendFuncSeparate: _emscripten_glBlendFuncSeparate,
    _emscripten_glGetIntegerv: _emscripten_glGetIntegerv,
    _emscripten_glDepthFunc: _emscripten_glDepthFunc,
    _emscripten_memcpy_big: _emscripten_memcpy_big,
    _emscripten_glUniform1f: _emscripten_glUniform1f,
    _emscripten_glUniform1i: _emscripten_glUniform1i,
    _puts: _puts,
    _emscripten_glIsProgram: _emscripten_glIsProgram,
    _ftell: _ftell,
    ___cxa_rethrow: ___cxa_rethrow,
    _emscripten_glTexParameteriv: _emscripten_glTexParameteriv,
    _catclose: _catclose,
    _emscripten_glAttachShader: _emscripten_glAttachShader,
    _emscripten_get_now_is_monotonic: _emscripten_get_now_is_monotonic,
    _emscripten_glTexParameterfv: _emscripten_glTexParameterfv,
    _emscripten_glUniformMatrix2fv: _emscripten_glUniformMatrix2fv,
    _emscripten_glDrawArraysInstanced: _emscripten_glDrawArraysInstanced,
    _strerror_r: _strerror_r,
    _newlocale: _newlocale,
    _emscripten_glFlush: _emscripten_glFlush,
    _nanosleep: _nanosleep,
    _pthread_once: _pthread_once,
    _fopen: _fopen,
    _eglWaitClient: _eglWaitClient,
    _execlp: _execlp,
    _stat: _stat,
    _emscripten_glTexCoordPointer: _emscripten_glTexCoordPointer,
    _fgets: _fgets,
    __addDays: __addDays,
    _emscripten_glLoadMatrixf: _emscripten_glLoadMatrixf,
    _emscripten_glStencilFuncSeparate: _emscripten_glStencilFuncSeparate,
    _emscripten_glVertexAttrib3f: _emscripten_glVertexAttrib3f,
    _pthread_mutex_lock: _pthread_mutex_lock,
    _readdir_r: _readdir_r,
    _dlerror: _dlerror,
    _getcwd: _getcwd,
    _emscripten_get_gamepad_status: _emscripten_get_gamepad_status,
    _lseek: _lseek,
    _emscripten_glUniform1iv: _emscripten_glUniform1iv,
    _emscripten_glGetBufferParameteriv: _emscripten_glGetBufferParameteriv,
    _emscripten_glVertexAttrib4fv: _emscripten_glVertexAttrib4fv,
    _pthread_getspecific: _pthread_getspecific,
    _emscripten_glDepthRange: _emscripten_glDepthRange,
    _eglMakeCurrent: _eglMakeCurrent,
    _emscripten_glCopyTexImage2D: _emscripten_glCopyTexImage2D,
    _emscripten_glFramebufferTexture2D: _emscripten_glFramebufferTexture2D,
    _emscripten_glStencilFunc: _emscripten_glStencilFunc,
    _localtime: _localtime,
    _sin: _sin,
    _emscripten_glRenderbufferStorage: _emscripten_glRenderbufferStorage,
    _emscripten_set_keydown_callback: _emscripten_set_keydown_callback,
    _emscripten_glVertexPointer: _emscripten_glVertexPointer,
    _eglInitialize: _eglInitialize,
    _emscripten_glBufferSubData: _emscripten_glBufferSubData,
    _emscripten_glGetUniformfv: _emscripten_glGetUniformfv,
    _fileno: _fileno,
    _emscripten_glStencilOp: _emscripten_glStencilOp,
    _emscripten_glBlendEquation: _emscripten_glBlendEquation,
    ___ctype_tolower_loc: ___ctype_tolower_loc,
    _emscripten_glVertexAttrib1fv: _emscripten_glVertexAttrib1fv,
    _dlclose: _dlclose,
    _emscripten_glGetProgramInfoLog: _emscripten_glGetProgramInfoLog,
    _emscripten_glUniform4fv: _emscripten_glUniform4fv,
    _fgetc: _fgetc,
    ___cxa_throw: ___cxa_throw,
    _emscripten_glUniform2fv: _emscripten_glUniform2fv,
    _emscripten_glBindBuffer: _emscripten_glBindBuffer,
    _emscripten_glGetFloatv: _emscripten_glGetFloatv,
    _emscripten_glGenRenderbuffers: _emscripten_glGenRenderbuffers,
    _emscripten_glUniform4i: _emscripten_glUniform4i,
    _fread: _fread,
    _emscripten_glCullFace: _emscripten_glCullFace,
    _emscripten_glStencilMaskSeparate: _emscripten_glStencilMaskSeparate,
    _fstat: _fstat,
    _emscripten_glUniform3fv: _emscripten_glUniform3fv,
    _rename: _rename,
    _emscripten_glDisableVertexAttribArray: _emscripten_glDisableVertexAttribArray,
    _eglBindAPI: _eglBindAPI,
    _eglCreateContext: _eglCreateContext,
    _emscripten_set_touchstart_callback: _emscripten_set_touchstart_callback,
    _emscripten_glGetBooleanv: _emscripten_glGetBooleanv,
    _emscripten_glVertexAttribDivisor: _emscripten_glVertexAttribDivisor,
    _readdir: _readdir,
    _emscripten_glGenBuffers: _emscripten_glGenBuffers,
    _emscripten_glDeleteObjectARB: _emscripten_glDeleteObjectARB,
    _emscripten_glUniform4f: _emscripten_glUniform4f,
    _emscripten_glGetShaderPrecisionFormat: _emscripten_glGetShaderPrecisionFormat,
    _write: _write,
    _fsync: _fsync,
    _emscripten_glIsEnabled: _emscripten_glIsEnabled,
    _emscripten_glStencilOpSeparate: _emscripten_glStencilOpSeparate,
    _emscripten_glGetActiveAttrib: _emscripten_glGetActiveAttrib,
    _uselocale: _uselocale,
    ___cxa_free_exception: ___cxa_free_exception,
    ___cxa_find_matching_catch: ___cxa_find_matching_catch,
    _emscripten_glClear: _emscripten_glClear,
    ___cxa_guard_release: ___cxa_guard_release,
    _emscripten_glValidateProgram: _emscripten_glValidateProgram,
    _emscripten_glUniform4iv: _emscripten_glUniform4iv,
    ___setErrNo: ___setErrNo,
    _eglSwapBuffers: _eglSwapBuffers,
    _emscripten_glVertexAttrib2f: _emscripten_glVertexAttrib2f,
    ___resumeException: ___resumeException,
    _emscripten_glGetError: _emscripten_glGetError,
    _emscripten_force_exit: _emscripten_force_exit,
    _emscripten_glBufferData: _emscripten_glBufferData,
    _emscripten_glReadPixels: _emscripten_glReadPixels,
    _eglCreateWindowSurface: _eglCreateWindowSurface,
    _emscripten_glClearStencil: _emscripten_glClearStencil,
    _emscripten_get_device_pixel_ratio: _emscripten_get_device_pixel_ratio,
    _emscripten_set_mouseup_callback: _emscripten_set_mouseup_callback,
    _emscripten_glFinish: _emscripten_glFinish,
    _emscripten_glClearDepth: _emscripten_glClearDepth,
    _emscripten_glGenVertexArrays: _emscripten_glGenVertexArrays,
    _emscripten_glUniform1fv: _emscripten_glUniform1fv,
    _fwrite: _fwrite,
    _emscripten_set_resize_callback: _emscripten_set_resize_callback,
    _ftime: _ftime,
    _eglGetDisplay: _eglGetDisplay,
    _llvm_pow_f64: _llvm_pow_f64,
    ___ctype_b_loc: ___ctype_b_loc,
    _vfprintf: _vfprintf,
    _emscripten_glBlendFunc: _emscripten_glBlendFunc,
    _floor: _floor,
    _emscripten_glStencilMask: _emscripten_glStencilMask,
    _localtime_r: _localtime_r,
    _fabsf: _fabsf,
    _strftime: _strftime,
    _emscripten_glGetVertexAttribiv: _emscripten_glGetVertexAttribiv,
    _fseek: _fseek,
    _emscripten_glUniformMatrix3fv: _emscripten_glUniformMatrix3fv,
    _pthread_key_create: _pthread_key_create,
    _emscripten_glDeleteFramebuffers: _emscripten_glDeleteFramebuffers,
    __setLetterbox: __setLetterbox,
    _recv: _recv,
    _tan: _tan,
    _emscripten_glGetObjectParameterivARB: _emscripten_glGetObjectParameterivARB,
    _send: _send,
    _emscripten_glGetUniformiv: _emscripten_glGetUniformiv,
    _ceil: _ceil,
    _emscripten_asm_const: _emscripten_asm_const,
    _eglDestroySurface: _eglDestroySurface,
    _sigaction: _sigaction,
    _emscripten_glCreateShader: _emscripten_glCreateShader,
    _ungetc: _ungetc,
    _emscripten_glDeleteTextures: _emscripten_glDeleteTextures,
    _eglDestroyContext: _eglDestroyContext,
    _emscripten_exit_fullscreen: _emscripten_exit_fullscreen,
    _emscripten_get_element_css_size: _emscripten_get_element_css_size,
    _catgets: _catgets,
    __exit: __exit,
    _fseeko: _fseeko,
    _pthread_mutex_unlock: _pthread_mutex_unlock,
    _emscripten_glBindTexture: _emscripten_glBindTexture,
    _emscripten_set_main_loop: _emscripten_set_main_loop,
    ___errno_location: ___errno_location,
    _emscripten_glIsShader: _emscripten_glIsShader,
    _ftello: _ftello,
    _fputc: _fputc,
    _emscripten_glCompressedTexImage2D: _emscripten_glCompressedTexImage2D,
    _emscripten_glGetInfoLogARB: _emscripten_glGetInfoLogARB,
    __formatString: __formatString,
    _atexit: _atexit,
    _emscripten_glVertexAttrib2fv: _emscripten_glVertexAttrib2fv,
    _emscripten_glDeleteVertexArrays: _emscripten_glDeleteVertexArrays,
    _emscripten_glReleaseShaderCompiler: _emscripten_glReleaseShaderCompiler,
    _dlsym: _dlsym,
    ___cxa_guard_acquire: ___cxa_guard_acquire,
    _emscripten_glFrontFace: _emscripten_glFrontFace,
    _truncate: _truncate,
    __ZSt18uncaught_exceptionv: __ZSt18uncaught_exceptionv,
    _emscripten_glUseProgram: _emscripten_glUseProgram,
    ___ctype_toupper_loc: ___ctype_toupper_loc,
    _clock_gettime: _clock_gettime,
    _emscripten_set_touchmove_callback: _emscripten_set_touchmove_callback,
    _emscripten_glUniform3iv: _emscripten_glUniform3iv,
    _sysconf: _sysconf,
    _emscripten_sleep: _emscripten_sleep,
    ___cxa_atexit: ___cxa_atexit,
    _emscripten_glScissor: _emscripten_glScissor,
    _emscripten_set_element_css_size: _emscripten_set_element_css_size,
    _mkdir: _mkdir,
    _closedir: _closedir,
    _emscripten_glIsBuffer: _emscripten_glIsBuffer,
    _emscripten_glVertexAttrib1f: _emscripten_glVertexAttrib1f,
    _emscripten_set_keyup_callback: _emscripten_set_keyup_callback,
    _emscripten_glCompressedTexSubImage2D: _emscripten_glCompressedTexSubImage2D,
    _emscripten_glGetAttachedShaders: _emscripten_glGetAttachedShaders,
    _emscripten_glGenTextures: _emscripten_glGenTextures,
    _eglGetConfigAttrib: _eglGetConfigAttrib,
    _emscripten_glGetTexParameteriv: _emscripten_glGetTexParameteriv,
    _emscripten_set_mousedown_callback: _emscripten_set_mousedown_callback,
    _emscripten_glClientActiveTexture: _emscripten_glClientActiveTexture,
    _emscripten_glCheckFramebufferStatus: _emscripten_glCheckFramebufferStatus,
    _eglWaitGL: _eglWaitGL,
    _emscripten_glUniform3f: _emscripten_glUniform3f,
    _emscripten_glUniform3i: _emscripten_glUniform3i,
    _emscripten_glDeleteShader: _emscripten_glDeleteShader,
    _emscripten_glGetUniformLocation: _emscripten_glGetUniformLocation,
    _emscripten_glEnableVertexAttribArray: _emscripten_glEnableVertexAttribArray,
    _emscripten_get_now: _emscripten_get_now,
    __registerRestoreOldStyle: __registerRestoreOldStyle,
    _fprintf: _fprintf,
    _gettimeofday: _gettimeofday,
    _eglWaitNative: _eglWaitNative,
    _emscripten_set_pointerlockchange_callback: _emscripten_set_pointerlockchange_callback,
    _emscripten_glEnableClientState: _emscripten_glEnableClientState,
    _eglChooseConfig: _eglChooseConfig,
    ___cxa_allocate_exception: ___cxa_allocate_exception,
    _emscripten_get_num_gamepads: _emscripten_get_num_gamepads,
    ___buildEnvironment: ___buildEnvironment,
    _tzset: _tzset,
    _emscripten_glGetAttribLocation: _emscripten_glGetAttribLocation,
    _emscripten_glDisable: _emscripten_glDisable,
    ___cxa_end_catch: ___cxa_end_catch,
    _emscripten_glDeleteRenderbuffers: _emscripten_glDeleteRenderbuffers,
    _emscripten_glDrawElementsInstanced: _emscripten_glDrawElementsInstanced,
    _emscripten_glVertexAttrib4f: _emscripten_glVertexAttrib4f,
    _emscripten_glPixelStorei: _emscripten_glPixelStorei,
    _getenv: _getenv,
    _fclose: _fclose,
    _log: _log,
    _emscripten_set_gamepaddisconnected_callback: _emscripten_set_gamepaddisconnected_callback,
    _emscripten_glFramebufferRenderbuffer: _emscripten_glFramebufferRenderbuffer,
    _emscripten_glRotatef: _emscripten_glRotatef,
    _emscripten_glGetShaderiv: _emscripten_glGetShaderiv,
    ___cxa_pure_virtual: ___cxa_pure_virtual,
    _emscripten_glUniformMatrix4fv: _emscripten_glUniformMatrix4fv,
    _emscripten_glGetPointerv: _emscripten_glGetPointerv,
    _pthread_cond_wait: _pthread_cond_wait,
    _emscripten_set_blur_callback: _emscripten_set_blur_callback,
    _emscripten_glIsRenderbuffer: _emscripten_glIsRenderbuffer,
    _emscripten_request_pointerlock: _emscripten_request_pointerlock,
    _emscripten_set_mousemove_callback: _emscripten_set_mousemove_callback,
    _emscripten_set_touchcancel_callback: _emscripten_set_touchcancel_callback,
    _emscripten_set_focus_callback: _emscripten_set_focus_callback,
    _emscripten_glGetVertexAttribfv: _emscripten_glGetVertexAttribfv,
    __reallyNegative: __reallyNegative,
    _emscripten_glVertexAttrib3fv: _emscripten_glVertexAttrib3fv,
    _emscripten_glCompileShader: _emscripten_glCompileShader,
    _glClear: _glClear,
    __arraySum: __arraySum,
    _emscripten_glLinkProgram: _emscripten_glLinkProgram,
    _pread: _pread,
    _mkport: _mkport,
    _emscripten_get_pointerlock_status: _emscripten_get_pointerlock_status,
    _emscripten_glDrawRangeElements: _emscripten_glDrawRangeElements,
    _catopen: _catopen,
    _getc: _getc,
    _pthread_setspecific: _pthread_setspecific,
    _emscripten_glClearColor: _emscripten_glClearColor,
    _emscripten_glCreateProgram: _emscripten_glCreateProgram,
    _emscripten_cancel_main_loop: _emscripten_cancel_main_loop,
    _emscripten_glDetachShader: _emscripten_glDetachShader,
    _emscripten_do_request_fullscreen: _emscripten_do_request_fullscreen,
    _emscripten_set_mouseleave_callback: _emscripten_set_mouseleave_callback,
    _strftime_l: _strftime_l,
    _emscripten_set_fullscreenchange_callback: _emscripten_set_fullscreenchange_callback,
    _emscripten_glVertexAttribPointer: _emscripten_glVertexAttribPointer,
    _emscripten_glDrawArrays: _emscripten_glDrawArrays,
    _emscripten_glPolygonOffset: _emscripten_glPolygonOffset,
    _emscripten_glBlendColor: _emscripten_glBlendColor,
    _emscripten_request_fullscreen_strategy: _emscripten_request_fullscreen_strategy,
    _signal: _signal,
    _emscripten_set_main_loop_timing: _emscripten_set_main_loop_timing,
    _sbrk: _sbrk,
    ___cxa_begin_catch: ___cxa_begin_catch,
    _emscripten_glGetProgramiv: _emscripten_glGetProgramiv,
    _execl: _execl,
    _close: _close,
    _emscripten_glGetShaderSource: _emscripten_glGetShaderSource,
    _cos: _cos,
    _emscripten_glTexImage2D: _emscripten_glTexImage2D,
    __isLeapYear: __isLeapYear,
    _emscripten_glBlendEquationSeparate: _emscripten_glBlendEquationSeparate,
    _emscripten_glGetString: _emscripten_glGetString,
    _emscripten_glIsFramebuffer: _emscripten_glIsFramebuffer,
    _emscripten_glBindProgramARB: _emscripten_glBindProgramARB,
    _mknod: _mknod,
    _emscripten_glUniform2i: _emscripten_glUniform2i,
    _emscripten_glUniform2f: _emscripten_glUniform2f,
    _execvp: _execvp,
    _atan2: _atan2,
    _emscripten_glTexParameterf: _emscripten_glTexParameterf,
    _emscripten_glTexParameteri: _emscripten_glTexParameteri,
    _emscripten_glColorMask: _emscripten_glColorMask,
    _glutInitDisplayMode: _glutInitDisplayMode,
    _emscripten_glShaderBinary: _emscripten_glShaderBinary,
    _emscripten_set_visibilitychange_callback: _emscripten_set_visibilitychange_callback,
    _eglGetProcAddress: _eglGetProcAddress,
    _emscripten_glBindAttribLocation: _emscripten_glBindAttribLocation,
    _llvm_pow_f32: _llvm_pow_f32,
    _emscripten_glDrawElements: _emscripten_glDrawElements,
    _emscripten_set_canvas_size: _emscripten_set_canvas_size,
    _unlink: _unlink,
    _freelocale: _freelocale,
    _emscripten_glClearDepthf: _emscripten_glClearDepthf,
    _emscripten_set_mouseenter_callback: _emscripten_set_mouseenter_callback,
    _printf: _printf,
    _emscripten_glMatrixMode: _emscripten_glMatrixMode,
    _emscripten_glNormalPointer: _emscripten_glNormalPointer,
    _emscripten_glHint: _emscripten_glHint,
    _emscripten_glEnable: _emscripten_glEnable,
    _getpwnam: _getpwnam,
    _read: _read,
    _emscripten_glBindFramebuffer: _emscripten_glBindFramebuffer,
    _emscripten_glBindRenderbuffer: _emscripten_glBindRenderbuffer,
    _time: _time,
    _emscripten_glGetFramebufferAttachmentParameteriv: _emscripten_glGetFramebufferAttachmentParameteriv,
    _exit: _exit,
    _putenv: _putenv,
    _emscripten_set_keypress_callback: _emscripten_set_keypress_callback,
    _access: _access,
    _rmdir: _rmdir,
    _emscripten_glGetShaderInfoLog: _emscripten_glGetShaderInfoLog,
    _emscripten_glGetVertexAttribPointerv: _emscripten_glGetVertexAttribPointerv,
    _pwrite: _pwrite,
    _open: _open,
    _emscripten_glGetActiveUniform: _emscripten_glGetActiveUniform,
    _eglSwapInterval: _eglSwapInterval,
    _emscripten_glDeleteProgram: _emscripten_glDeleteProgram,
    _glutDestroyWindow: _glutDestroyWindow,
    _ftruncate: _ftruncate,
    _emscripten_glTexSubImage2D: _emscripten_glTexSubImage2D,
    _emscripten_glColorPointer: _emscripten_glColorPointer,
    _emscripten_glViewport: _emscripten_glViewport,
    _pthread_cond_broadcast: _pthread_cond_broadcast,
    _emscripten_glDepthMask: _emscripten_glDepthMask,
    _emscripten_glDrawBuffers: _emscripten_glDrawBuffers,
    _emscripten_glLineWidth: _emscripten_glLineWidth,
    _emscripten_exit_pointerlock: _emscripten_exit_pointerlock,
    _emscripten_set_gamepadconnected_callback: _emscripten_set_gamepadconnected_callback,
    _abort: _abort,
    _emscripten_glGenFramebuffers: _emscripten_glGenFramebuffers,
    _emscripten_glLoadIdentity: _emscripten_glLoadIdentity,
    _emscripten_glShaderSource: _emscripten_glShaderSource,
    _emscripten_asm_const_int: _emscripten_asm_const_int,
    _usleep: _usleep,
    _emscripten_set_touchend_callback: _emscripten_set_touchend_callback,
    _emscripten_glCopyTexSubImage2D: _emscripten_glCopyTexSubImage2D,
    _emscripten_glGetRenderbufferParameteriv: _emscripten_glGetRenderbufferParameteriv,
    _eglTerminate: _eglTerminate,
    _strerror: _strerror,
    _emscripten_glSampleCoverage: _emscripten_glSampleCoverage,
    _glutCreateWindow: _glutCreateWindow,
    _emscripten_glFrustum: _emscripten_glFrustum,
    _emscripten_glDepthRangef: _emscripten_glDepthRangef,
    _emscripten_glGenerateMipmap: _emscripten_glGenerateMipmap,
    _emscripten_glIsTexture: _emscripten_glIsTexture,
    _fputs: _fputs,
    _emscripten_glBindVertexArray: _emscripten_glBindVertexArray,
    _emscripten_glActiveTexture: _emscripten_glActiveTexture,
    _emscripten_set_wheel_callback: _emscripten_set_wheel_callback,
    _emscripten_glDeleteBuffers: _emscripten_glDeleteBuffers,
    _fflush: _fflush,
    _emscripten_glUniform2iv: _emscripten_glUniform2iv,
    _opendir: _opendir,
    _sqrt: _sqrt,
    STACKTOP: STACKTOP,
    STACK_MAX: STACK_MAX,
    tempDoublePtr: tempDoublePtr,
    ABORT: ABORT,
    cttz_i8: cttz_i8,
    ___dso_handle: ___dso_handle,
    _environ: _environ,
    _stderr: _stderr,
    _stdin: _stdin,
    _stdout: _stdout
  };
  Module.asmLibraryArg.EMTSTACKTOP = EMTSTACKTOP;
  Module.asmLibraryArg.EMT_STACK_MAX = EMT_STACK_MAX; // EMSCRIPTEN_START_ASM

  var asm = require('./asm')(Module.asmGlobalArg, Module.asmLibraryArg, buffer);

  // EMSCRIPTEN_END_ASM
  var ___cxa_can_catch = Module['___cxa_can_catch'] = asm['___cxa_can_catch'];
  var _strcat = Module['_strcat'] = asm['_strcat'];
  var _free = Module['_free'] = asm['_free'];
  var _main = Module['_main'] = asm['_main'];
  var ___cxa_is_pointer_type = Module['___cxa_is_pointer_type'] = asm['___cxa_is_pointer_type'];
  var _i64Add = Module['_i64Add'] = asm['_i64Add'];
  var _memmove = Module['_memmove'] = asm['_memmove'];
  var _strstr = Module['_strstr'] = asm['_strstr'];
  var _realloc = Module['_realloc'] = asm['_realloc'];
  var _strlen = Module['_strlen'] = asm['_strlen'];
  var _memset = Module['_memset'] = asm['_memset'];
  var _malloc = Module['_malloc'] = asm['_malloc'];
  var _strncpy = Module['_strncpy'] = asm['_strncpy'];
  var _memcpy = Module['_memcpy'] = asm['_memcpy'];
  var _llvm_bswap_i32 = Module['_llvm_bswap_i32'] = asm['_llvm_bswap_i32'];
  var _bitshift64Lshr = Module['_bitshift64Lshr'] = asm['_bitshift64Lshr'];
  var _emscripten_GetProcAddress = Module['_emscripten_GetProcAddress'] = asm['_emscripten_GetProcAddress'];
  var _i64Subtract = Module['_i64Subtract'] = asm['_i64Subtract'];
  var _strcpy = Module['_strcpy'] = asm['_strcpy'];
  var _calloc = Module['_calloc'] = asm['_calloc'];
  var _bitshift64Shl = Module['_bitshift64Shl'] = asm['_bitshift64Shl'];
  var __GLOBAL__sub_I_cpu_cpp = Module['__GLOBAL__sub_I_cpu_cpp'] = asm['__GLOBAL__sub_I_cpu_cpp'];
  var __GLOBAL__sub_I_dos_memory_cpp = Module['__GLOBAL__sub_I_dos_memory_cpp'] = asm['__GLOBAL__sub_I_dos_memory_cpp'];
  var __GLOBAL__sub_I_dos_misc_cpp = Module['__GLOBAL__sub_I_dos_misc_cpp'] = asm['__GLOBAL__sub_I_dos_misc_cpp'];
  var __GLOBAL__sub_I_drives_cpp = Module['__GLOBAL__sub_I_drives_cpp'] = asm['__GLOBAL__sub_I_drives_cpp'];
  var __GLOBAL__sub_I_hardware_cpp = Module['__GLOBAL__sub_I_hardware_cpp'] = asm['__GLOBAL__sub_I_hardware_cpp'];
  var __GLOBAL__sub_I_vga_memory_cpp = Module['__GLOBAL__sub_I_vga_memory_cpp'] = asm['__GLOBAL__sub_I_vga_memory_cpp'];
  var __GLOBAL__sub_I_sdl_mapper_cpp = Module['__GLOBAL__sub_I_sdl_mapper_cpp'] = asm['__GLOBAL__sub_I_sdl_mapper_cpp'];
  var __GLOBAL__sub_I_messages_cpp = Module['__GLOBAL__sub_I_messages_cpp'] = asm['__GLOBAL__sub_I_messages_cpp'];
  var __GLOBAL__sub_I_programs_cpp = Module['__GLOBAL__sub_I_programs_cpp'] = asm['__GLOBAL__sub_I_programs_cpp'];
  var __GLOBAL__sub_I_setup_cpp = Module['__GLOBAL__sub_I_setup_cpp'] = asm['__GLOBAL__sub_I_setup_cpp'];
  var __GLOBAL__sub_I_shell_cpp = Module['__GLOBAL__sub_I_shell_cpp'] = asm['__GLOBAL__sub_I_shell_cpp'];
  var __GLOBAL__sub_I_shell_misc_cpp = Module['__GLOBAL__sub_I_shell_misc_cpp'] = asm['__GLOBAL__sub_I_shell_misc_cpp'];
  var __GLOBAL__sub_I_iostream_cpp = Module['__GLOBAL__sub_I_iostream_cpp'] = asm['__GLOBAL__sub_I_iostream_cpp'];
  var runPostSets = Module['runPostSets'] = asm['runPostSets'];
  var dynCall_iiiiiiii = Module['dynCall_iiiiiiii'] = asm['dynCall_iiiiiiii'];
  var dynCall_viiiii = Module['dynCall_viiiii'] = asm['dynCall_viiiii'];
  var dynCall_vd = Module['dynCall_vd'] = asm['dynCall_vd'];
  var dynCall_vid = Module['dynCall_vid'] = asm['dynCall_vid'];
  var dynCall_vi = Module['dynCall_vi'] = asm['dynCall_vi'];
  var dynCall_vii = Module['dynCall_vii'] = asm['dynCall_vii'];
  var dynCall_iiiiiii = Module['dynCall_iiiiiii'] = asm['dynCall_iiiiiii'];
  var dynCall_ii = Module['dynCall_ii'] = asm['dynCall_ii'];
  var dynCall_viiiiiiiiiii = Module['dynCall_viiiiiiiiiii'] = asm['dynCall_viiiiiiiiiii'];
  var dynCall_viddd = Module['dynCall_viddd'] = asm['dynCall_viddd'];
  var dynCall_iiiii = Module['dynCall_iiiii'] = asm['dynCall_iiiii'];
  var dynCall_vidd = Module['dynCall_vidd'] = asm['dynCall_vidd'];
  var dynCall_iiii = Module['dynCall_iiii'] = asm['dynCall_iiii'];
  var dynCall_viiiiid = Module['dynCall_viiiiid'] = asm['dynCall_viiiiid'];
  var dynCall_viiiiiiii = Module['dynCall_viiiiiiii'] = asm['dynCall_viiiiiiii'];
  var dynCall_viiiiii = Module['dynCall_viiiiii'] = asm['dynCall_viiiiii'];
  var dynCall_viii = Module['dynCall_viii'] = asm['dynCall_viii'];
  var dynCall_viid = Module['dynCall_viid'] = asm['dynCall_viid'];
  var dynCall_vidddd = Module['dynCall_vidddd'] = asm['dynCall_vidddd'];
  var dynCall_vdi = Module['dynCall_vdi'] = asm['dynCall_vdi'];
  var dynCall_viiiiiii = Module['dynCall_viiiiiii'] = asm['dynCall_viiiiiii'];
  var dynCall_viiiiiid = Module['dynCall_viiiiiid'] = asm['dynCall_viiiiiid'];
  var dynCall_viiiiiiiii = Module['dynCall_viiiiiiiii'] = asm['dynCall_viiiiiiiii'];
  var dynCall_iii = Module['dynCall_iii'] = asm['dynCall_iii'];
  var dynCall_iiiiii = Module['dynCall_iiiiii'] = asm['dynCall_iiiiii'];
  var dynCall_i = Module['dynCall_i'] = asm['dynCall_i'];
  var dynCall_iiiiidii = Module['dynCall_iiiiidii'] = asm['dynCall_iiiiidii'];
  var dynCall_iiiiiiiiii = Module['dynCall_iiiiiiiiii'] = asm['dynCall_iiiiiiiiii'];
  var dynCall_vdddddd = Module['dynCall_vdddddd'] = asm['dynCall_vdddddd'];
  var dynCall_vdddd = Module['dynCall_vdddd'] = asm['dynCall_vdddd'];
  var dynCall_vdd = Module['dynCall_vdd'] = asm['dynCall_vdd'];
  var dynCall_v = Module['dynCall_v'] = asm['dynCall_v'];
  var dynCall_iiiiiiiii = Module['dynCall_iiiiiiiii'] = asm['dynCall_iiiiiiiii'];
  var dynCall_viiii = Module['dynCall_viiii'] = asm['dynCall_viiii'];
  Runtime.stackAlloc = asm['stackAlloc'];
  Runtime.stackSave = asm['stackSave'];
  Runtime.stackRestore = asm['stackRestore'];
  Runtime.setTempRet0 = asm['setTempRet0'];
  Runtime.getTempRet0 = asm['getTempRet0'];
  var i64Math = (function() {
    var goog = {
      math: {}
    };
    goog.math.Long = (function(low, high) {
      this.low_ = low | 0;
      this.high_ = high | 0;
    });

    goog.math.Long.IntCache_ = {};
    goog.math.Long.fromInt = (function(value) {
      if (-128 <= value && value < 128) {
        var cachedObj = goog.math.Long.IntCache_[value];
        if (cachedObj) {
          return cachedObj;
        }
      }

      var obj = new goog.math.Long(value | 0, value < 0 ? -1 : 0);
      if (-128 <= value && value < 128) {
        goog.math.Long.IntCache_[value] = obj;
      }

      return obj;
    });

    goog.math.Long.fromNumber = (function(value) {
      if (isNaN(value) || !isFinite(value)) {
        return goog.math.Long.ZERO;
      } else if (value <= -goog.math.Long.TWO_PWR_63_DBL_) {
        return goog.math.Long.MIN_VALUE;
      } else if (value + 1 >= goog.math.Long.TWO_PWR_63_DBL_) {
        return goog.math.Long.MAX_VALUE;
      } else if (value < 0) {
        return goog.math.Long.fromNumber(-value).negate();
      } else {
        return new goog.math.Long(value % goog.math.Long.TWO_PWR_32_DBL_ | 0, value / goog.math.Long.TWO_PWR_32_DBL_ | 0);
      }
    });

    goog.math.Long.fromBits = (function(lowBits, highBits) {
      return new goog.math.Long(lowBits, highBits);
    });

    goog.math.Long.fromString = (function(str, opt_radix) {
      if (str.length == 0) {
        throw Error('number format error: empty string');
      }

      var radix = opt_radix || 10;
      if (radix < 2 || 36 < radix) {
        throw Error('radix out of range: ' + radix);
      }

      if (str.charAt(0) == '-') {
        return goog.math.Long.fromString(str.substring(1), radix).negate();
      } else if (str.indexOf('-') >= 0) {
        throw Error('number format error: interior "-" character: ' + str);
      }

      var radixToPower = goog.math.Long.fromNumber(Math.pow(radix, 8));
      var result = goog.math.Long.ZERO;
      for (var i = 0; i < str.length; i += 8) {
        var size = Math.min(8, str.length - i);
        var value = parseInt(str.substring(i, i + size), radix);
        if (size < 8) {
          var power = goog.math.Long.fromNumber(Math.pow(radix, size));
          result = result.multiply(power).add(goog.math.Long.fromNumber(value));
        } else {
          result = result.multiply(radixToPower);
          result = result.add(goog.math.Long.fromNumber(value));
        }
      }

      return result;
    });

    goog.math.Long.TWO_PWR_16_DBL_ = 1 << 16;
    goog.math.Long.TWO_PWR_24_DBL_ = 1 << 24;
    goog.math.Long.TWO_PWR_32_DBL_ = goog.math.Long.TWO_PWR_16_DBL_ * goog.math.Long.TWO_PWR_16_DBL_;
    goog.math.Long.TWO_PWR_31_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ / 2;
    goog.math.Long.TWO_PWR_48_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ * goog.math.Long.TWO_PWR_16_DBL_;
    goog.math.Long.TWO_PWR_64_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ * goog.math.Long.TWO_PWR_32_DBL_;
    goog.math.Long.TWO_PWR_63_DBL_ = goog.math.Long.TWO_PWR_64_DBL_ / 2;
    goog.math.Long.ZERO = goog.math.Long.fromInt(0);
    goog.math.Long.ONE = goog.math.Long.fromInt(1);
    goog.math.Long.NEG_ONE = goog.math.Long.fromInt(-1);
    goog.math.Long.MAX_VALUE = goog.math.Long.fromBits(4294967295 | 0, 2147483647 | 0);
    goog.math.Long.MIN_VALUE = goog.math.Long.fromBits(0, 2147483648 | 0);
    goog.math.Long.TWO_PWR_24_ = goog.math.Long.fromInt(1 << 24);
    goog.math.Long.prototype.toInt = (function() {
      return this.low_;
    });

    goog.math.Long.prototype.toNumber = (function() {
      return this.high_ * goog.math.Long.TWO_PWR_32_DBL_ + this.getLowBitsUnsigned();
    });

    goog.math.Long.prototype.toString = (function(opt_radix) {
      var radix = opt_radix || 10;
      if (radix < 2 || 36 < radix) {
        throw Error('radix out of range: ' + radix);
      }

      if (this.isZero()) {
        return '0';
      }

      if (this.isNegative()) {
        if (this.equals(goog.math.Long.MIN_VALUE)) {
          var radixLong = goog.math.Long.fromNumber(radix);
          var div = this.div(radixLong);
          var rem = div.multiply(radixLong).subtract(this);
          return div.toString(radix) + rem.toInt().toString(radix);
        } else {
          return '-' + this.negate().toString(radix);
        }
      }

      var radixToPower = goog.math.Long.fromNumber(Math.pow(radix, 6));
      var rem = this;
      var result = '';
      while (true) {
        var remDiv = rem.div(radixToPower);
        var intval = rem.subtract(remDiv.multiply(radixToPower)).toInt();
        var digits = intval.toString(radix);
        rem = remDiv;
        if (rem.isZero()) {
          return digits + result;
        } else {
          while (digits.length < 6) {
            digits = '0' + digits;
          }

          result = '' + digits + result;
        }
      }
    });

    goog.math.Long.prototype.getHighBits = (function() {
      return this.high_;
    });

    goog.math.Long.prototype.getLowBits = (function() {
      return this.low_;
    });

    goog.math.Long.prototype.getLowBitsUnsigned = (function() {
      return this.low_ >= 0 ? this.low_ : goog.math.Long.TWO_PWR_32_DBL_ + this.low_;
    });

    goog.math.Long.prototype.getNumBitsAbs = (function() {
      if (this.isNegative()) {
        if (this.equals(goog.math.Long.MIN_VALUE)) {
          return 64;
        } else {
          return this.negate().getNumBitsAbs();
        }
      } else {
        var val = this.high_ != 0 ? this.high_ : this.low_;
        for (var bit = 31; bit > 0; bit--) {
          if ((val & 1 << bit) != 0) {
            break;
          }
        }

        return this.high_ != 0 ? bit + 33 : bit + 1;
      }
    });

    goog.math.Long.prototype.isZero = (function() {
      return this.high_ == 0 && this.low_ == 0;
    });

    goog.math.Long.prototype.isNegative = (function() {
      return this.high_ < 0;
    });

    goog.math.Long.prototype.isOdd = (function() {
      return (this.low_ & 1) == 1;
    });

    goog.math.Long.prototype.equals = (function(other) {
      return this.high_ == other.high_ && this.low_ == other.low_;
    });

    goog.math.Long.prototype.notEquals = (function(other) {
      return this.high_ != other.high_ || this.low_ != other.low_;
    });

    goog.math.Long.prototype.lessThan = (function(other) {
      return this.compare(other) < 0;
    });

    goog.math.Long.prototype.lessThanOrEqual = (function(other) {
      return this.compare(other) <= 0;
    });

    goog.math.Long.prototype.greaterThan = (function(other) {
      return this.compare(other) > 0;
    });

    goog.math.Long.prototype.greaterThanOrEqual = (function(other) {
      return this.compare(other) >= 0;
    });

    goog.math.Long.prototype.compare = (function(other) {
      if (this.equals(other)) {
        return 0;
      }

      var thisNeg = this.isNegative();
      var otherNeg = other.isNegative();
      if (thisNeg && !otherNeg) {
        return -1;
      }

      if (!thisNeg && otherNeg) {
        return 1;
      }

      if (this.subtract(other).isNegative()) {
        return -1;
      } else {
        return 1;
      }
    });

    goog.math.Long.prototype.negate = (function() {
      if (this.equals(goog.math.Long.MIN_VALUE)) {
        return goog.math.Long.MIN_VALUE;
      } else {
        return this.not().add(goog.math.Long.ONE);
      }
    });

    goog.math.Long.prototype.add = (function(other) {
      var a48 = this.high_ >>> 16;
      var a32 = this.high_ & 65535;
      var a16 = this.low_ >>> 16;
      var a00 = this.low_ & 65535;
      var b48 = other.high_ >>> 16;
      var b32 = other.high_ & 65535;
      var b16 = other.low_ >>> 16;
      var b00 = other.low_ & 65535;
      var c48 = 0,
        c32 = 0,
        c16 = 0,
        c00 = 0;
      c00 += a00 + b00;
      c16 += c00 >>> 16;
      c00 &= 65535;
      c16 += a16 + b16;
      c32 += c16 >>> 16;
      c16 &= 65535;
      c32 += a32 + b32;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c48 += a48 + b48;
      c48 &= 65535;
      return goog.math.Long.fromBits(c16 << 16 | c00, c48 << 16 | c32);
    });

    goog.math.Long.prototype.subtract = (function(other) {
      return this.add(other.negate());
    });

    goog.math.Long.prototype.multiply = (function(other) {
      if (this.isZero()) {
        return goog.math.Long.ZERO;
      } else if (other.isZero()) {
        return goog.math.Long.ZERO;
      }

      if (this.equals(goog.math.Long.MIN_VALUE)) {
        return other.isOdd() ? goog.math.Long.MIN_VALUE : goog.math.Long.ZERO;
      } else if (other.equals(goog.math.Long.MIN_VALUE)) {
        return this.isOdd() ? goog.math.Long.MIN_VALUE : goog.math.Long.ZERO;
      }

      if (this.isNegative()) {
        if (other.isNegative()) {
          return this.negate().multiply(other.negate());
        } else {
          return this.negate().multiply(other).negate();
        }
      } else if (other.isNegative()) {
        return this.multiply(other.negate()).negate();
      }

      if (this.lessThan(goog.math.Long.TWO_PWR_24_) && other.lessThan(goog.math.Long.TWO_PWR_24_)) {
        return goog.math.Long.fromNumber(this.toNumber() * other.toNumber());
      }

      var a48 = this.high_ >>> 16;
      var a32 = this.high_ & 65535;
      var a16 = this.low_ >>> 16;
      var a00 = this.low_ & 65535;
      var b48 = other.high_ >>> 16;
      var b32 = other.high_ & 65535;
      var b16 = other.low_ >>> 16;
      var b00 = other.low_ & 65535;
      var c48 = 0,
        c32 = 0,
        c16 = 0,
        c00 = 0;
      c00 += a00 * b00;
      c16 += c00 >>> 16;
      c00 &= 65535;
      c16 += a16 * b00;
      c32 += c16 >>> 16;
      c16 &= 65535;
      c16 += a00 * b16;
      c32 += c16 >>> 16;
      c16 &= 65535;
      c32 += a32 * b00;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c32 += a16 * b16;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c32 += a00 * b32;
      c48 += c32 >>> 16;
      c32 &= 65535;
      c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
      c48 &= 65535;
      return goog.math.Long.fromBits(c16 << 16 | c00, c48 << 16 | c32);
    });

    goog.math.Long.prototype.div = (function(other) {
      if (other.isZero()) {
        throw Error('division by zero');
      } else if (this.isZero()) {
        return goog.math.Long.ZERO;
      }

      if (this.equals(goog.math.Long.MIN_VALUE)) {
        if (other.equals(goog.math.Long.ONE) || other.equals(goog.math.Long.NEG_ONE)) {
          return goog.math.Long.MIN_VALUE;
        } else if (other.equals(goog.math.Long.MIN_VALUE)) {
          return goog.math.Long.ONE;
        } else {
          var halfThis = this.shiftRight(1);
          var approx = halfThis.div(other).shiftLeft(1);
          if (approx.equals(goog.math.Long.ZERO)) {
            return other.isNegative() ? goog.math.Long.ONE : goog.math.Long.NEG_ONE;
          } else {
            var rem = this.subtract(other.multiply(approx));
            var result = approx.add(rem.div(other));
            return result;
          }
        }
      } else if (other.equals(goog.math.Long.MIN_VALUE)) {
        return goog.math.Long.ZERO;
      }

      if (this.isNegative()) {
        if (other.isNegative()) {
          return this.negate().div(other.negate());
        } else {
          return this.negate().div(other).negate();
        }
      } else if (other.isNegative()) {
        return this.div(other.negate()).negate();
      }

      var res = goog.math.Long.ZERO;
      var rem = this;
      while (rem.greaterThanOrEqual(other)) {
        var approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));
        var log2 = Math.ceil(Math.log(approx) / Math.LN2);
        var delta = log2 <= 48 ? 1 : Math.pow(2, log2 - 48);
        var approxRes = goog.math.Long.fromNumber(approx);
        var approxRem = approxRes.multiply(other);
        while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
          approx -= delta;
          approxRes = goog.math.Long.fromNumber(approx);
          approxRem = approxRes.multiply(other);
        }

        if (approxRes.isZero()) {
          approxRes = goog.math.Long.ONE;
        }

        res = res.add(approxRes);
        rem = rem.subtract(approxRem);
      }

      return res;
    });

    goog.math.Long.prototype.modulo = (function(other) {
      return this.subtract(this.div(other).multiply(other));
    });

    goog.math.Long.prototype.not = (function() {
      return goog.math.Long.fromBits(~this.low_, ~this.high_);
    });

    goog.math.Long.prototype.and = (function(other) {
      return goog.math.Long.fromBits(this.low_ & other.low_, this.high_ & other.high_);
    });

    goog.math.Long.prototype.or = (function(other) {
      return goog.math.Long.fromBits(this.low_ | other.low_, this.high_ | other.high_);
    });

    goog.math.Long.prototype.xor = (function(other) {
      return goog.math.Long.fromBits(this.low_ ^ other.low_, this.high_ ^ other.high_);
    });

    goog.math.Long.prototype.shiftLeft = (function(numBits) {
      numBits &= 63;
      if (numBits == 0) {
        return this;
      } else {
        var low = this.low_;
        if (numBits < 32) {
          var high = this.high_;
          return goog.math.Long.fromBits(low << numBits, high << numBits | low >>> 32 - numBits);
        } else {
          return goog.math.Long.fromBits(0, low << numBits - 32);
        }
      }
    });

    goog.math.Long.prototype.shiftRight = (function(numBits) {
      numBits &= 63;
      if (numBits == 0) {
        return this;
      } else {
        var high = this.high_;
        if (numBits < 32) {
          var low = this.low_;
          return goog.math.Long.fromBits(low >>> numBits | high << 32 - numBits, high >> numBits);
        } else {
          return goog.math.Long.fromBits(high >> numBits - 32, high >= 0 ? 0 : -1);
        }
      }
    });

    goog.math.Long.prototype.shiftRightUnsigned = (function(numBits) {
      numBits &= 63;
      if (numBits == 0) {
        return this;
      } else {
        var high = this.high_;
        if (numBits < 32) {
          var low = this.low_;
          return goog.math.Long.fromBits(low >>> numBits | high << 32 - numBits, high >>> numBits);
        } else if (numBits == 32) {
          return goog.math.Long.fromBits(high, 0);
        } else {
          return goog.math.Long.fromBits(high >>> numBits - 32, 0);
        }
      }
    });

    var navigator = {
      appName: 'Modern Browser'
    };
    var dbits;
    var canary = 0xdeadbeefcafe;
    var j_lm = (canary & 16777215) == 15715070;

    function BigInteger(a, b, c) {
      if (a != null)
        if ('number' == typeof a) this.fromNumber(a, b, c);
      else if (b == null && 'string' != typeof a) this.fromString(a, 256);
      else this.fromString(a, b);
    }

    function nbi() {
      return new BigInteger(null);
    }

    function am1(i, x, w, j, c, n) {
      while (--n >= 0) {
        var v = x * this[i++] + w[j] + c;
        c = Math.floor(v / 67108864);
        w[j++] = v & 67108863;
      }

      return c;
    }

    function am2(i, x, w, j, c, n) {
      var xl = x & 32767,
        xh = x >> 15;
      while (--n >= 0) {
        var l = this[i] & 32767;
        var h = this[i++] >> 15;
        var m = xh * l + h * xl;
        l = xl * l + ((m & 32767) << 15) + w[j] + (c & 1073741823);
        c = (l >>> 30) + (m >>> 15) + xh * h + (c >>> 30);
        w[j++] = l & 1073741823;
      }

      return c;
    }

    function am3(i, x, w, j, c, n) {
      var xl = x & 16383,
        xh = x >> 14;
      while (--n >= 0) {
        var l = this[i] & 16383;
        var h = this[i++] >> 14;
        var m = xh * l + h * xl;
        l = xl * l + ((m & 16383) << 14) + w[j] + c;
        c = (l >> 28) + (m >> 14) + xh * h;
        w[j++] = l & 268435455;
      }

      return c;
    }

    if (j_lm && navigator.appName == 'Microsoft Internet Explorer') {
      BigInteger.prototype.am = am2;
      dbits = 30;
    } else if (j_lm && navigator.appName != 'Netscape') {
      BigInteger.prototype.am = am1;
      dbits = 26;
    } else {
      BigInteger.prototype.am = am3;
      dbits = 28;
    }

    BigInteger.prototype.DB = dbits;
    BigInteger.prototype.DM = (1 << dbits) - 1;
    BigInteger.prototype.DV = 1 << dbits;
    var BI_FP = 52;
    BigInteger.prototype.FV = Math.pow(2, BI_FP);
    BigInteger.prototype.F1 = BI_FP - dbits;
    BigInteger.prototype.F2 = 2 * dbits - BI_FP;
    var BI_RM = '0123456789abcdefghijklmnopqrstuvwxyz';
    var BI_RC = new Array;
    var rr, vv;
    rr = '0'.charCodeAt(0);
    for (vv = 0; vv <= 9; ++vv) BI_RC[rr++] = vv;
    rr = 'a'.charCodeAt(0);
    for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
    rr = 'A'.charCodeAt(0);
    for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;

    function int2char(n) {
      return BI_RM.charAt(n);
    }

    function intAt(s, i) {
      var c = BI_RC[s.charCodeAt(i)];
      return c == null ? -1 : c;
    }

    function bnpCopyTo(r) {
      for (var i = this.t - 1; i >= 0; --i) r[i] = this[i];
      r.t = this.t;
      r.s = this.s;
    }

    function bnpFromInt(x) {
      this.t = 1;
      this.s = x < 0 ? -1 : 0;
      if (x > 0) this[0] = x;
      else if (x < -1) this[0] = x + DV;
      else this.t = 0;
    }

    function nbv(i) {
      var r = nbi();
      r.fromInt(i);
      return r;
    }

    function bnpFromString(s, b) {
      var k;
      if (b == 16) k = 4;
      else if (b == 8) k = 3;
      else if (b == 256) k = 8;
      else if (b == 2) k = 1;
      else if (b == 32) k = 5;
      else if (b == 4) k = 2;
      else {
        this.fromRadix(s, b);
        return;
      }

      this.t = 0;
      this.s = 0;
      var i = s.length,
        mi = false,
        sh = 0;
      while (--i >= 0) {
        var x = k == 8 ? s[i] & 255 : intAt(s, i);
        if (x < 0) {
          if (s.charAt(i) == '-') mi = true;
          continue;
        }

        mi = false;
        if (sh == 0) this[this.t++] = x;
        else if (sh + k > this.DB) {
          this[this.t - 1] |= (x & (1 << this.DB - sh) - 1) << sh;
          this[this.t++] = x >> this.DB - sh;
        } else this[this.t - 1] |= x << sh;
        sh += k;
        if (sh >= this.DB) sh -= this.DB;
      }

      if (k == 8 && (s[0] & 128) != 0) {
        this.s = -1;
        if (sh > 0) this[this.t - 1] |= (1 << this.DB - sh) - 1 << sh;
      }

      this.clamp();
      if (mi) BigInteger.ZERO.subTo(this, this);
    }

    function bnpClamp() {
      var c = this.s & this.DM;
      while (this.t > 0 && this[this.t - 1] == c) --this.t;
    }

    function bnToString(b) {
      if (this.s < 0) return '-' + this.negate().toString(b);
      var k;
      if (b == 16) k = 4;
      else if (b == 8) k = 3;
      else if (b == 2) k = 1;
      else if (b == 32) k = 5;
      else if (b == 4) k = 2;
      else return this.toRadix(b);
      var km = (1 << k) - 1,
        d, m = false,
        r = '',
        i = this.t;
      var p = this.DB - i * this.DB % k;
      if (i-- > 0) {
        if (p < this.DB && (d = this[i] >> p) > 0) {
          m = true;
          r = int2char(d);
        }

        while (i >= 0) {
          if (p < k) {
            d = (this[i] & (1 << p) - 1) << k - p;
            d |= this[--i] >> (p += this.DB - k);
          } else {
            d = this[i] >> (p -= k) & km;
            if (p <= 0) {
              p += this.DB;
              --i;
            }
          }

          if (d > 0) m = true;
          if (m) r += int2char(d);
        }
      }

      return m ? r : '0';
    }

    function bnNegate() {
      var r = nbi();
      BigInteger.ZERO.subTo(this, r);
      return r;
    }

    function bnAbs() {
      return this.s < 0 ? this.negate() : this;
    }

    function bnCompareTo(a) {
      var r = this.s - a.s;
      if (r != 0) return r;
      var i = this.t;
      r = i - a.t;
      if (r != 0) return this.s < 0 ? -r : r;
      while (--i >= 0)
        if ((r = this[i] - a[i]) != 0) return r;
      return 0;
    }

    function nbits(x) {
      var r = 1,
        t;
      if ((t = x >>> 16) != 0) {
        x = t;
        r += 16;
      }

      if ((t = x >> 8) != 0) {
        x = t;
        r += 8;
      }

      if ((t = x >> 4) != 0) {
        x = t;
        r += 4;
      }

      if ((t = x >> 2) != 0) {
        x = t;
        r += 2;
      }

      if ((t = x >> 1) != 0) {
        x = t;
        r += 1;
      }

      return r;
    }

    function bnBitLength() {
      if (this.t <= 0) return 0;
      return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ this.s & this.DM);
    }

    function bnpDLShiftTo(n, r) {
      var i;
      for (i = this.t - 1; i >= 0; --i) r[i + n] = this[i];
      for (i = n - 1; i >= 0; --i) r[i] = 0;
      r.t = this.t + n;
      r.s = this.s;
    }

    function bnpDRShiftTo(n, r) {
      for (var i = n; i < this.t; ++i) r[i - n] = this[i];
      r.t = Math.max(this.t - n, 0);
      r.s = this.s;
    }

    function bnpLShiftTo(n, r) {
      var bs = n % this.DB;
      var cbs = this.DB - bs;
      var bm = (1 << cbs) - 1;
      var ds = Math.floor(n / this.DB),
        c = this.s << bs & this.DM,
        i;
      for (i = this.t - 1; i >= 0; --i) {
        r[i + ds + 1] = this[i] >> cbs | c;
        c = (this[i] & bm) << bs;
      }

      for (i = ds - 1; i >= 0; --i) r[i] = 0;
      r[ds] = c;
      r.t = this.t + ds + 1;
      r.s = this.s;
      r.clamp();
    }

    function bnpRShiftTo(n, r) {
      r.s = this.s;
      var ds = Math.floor(n / this.DB);
      if (ds >= this.t) {
        r.t = 0;
        return;
      }

      var bs = n % this.DB;
      var cbs = this.DB - bs;
      var bm = (1 << bs) - 1;
      r[0] = this[ds] >> bs;
      for (var i = ds + 1; i < this.t; ++i) {
        r[i - ds - 1] |= (this[i] & bm) << cbs;
        r[i - ds] = this[i] >> bs;
      }

      if (bs > 0) r[this.t - ds - 1] |= (this.s & bm) << cbs;
      r.t = this.t - ds;
      r.clamp();
    }

    function bnpSubTo(a, r) {
      var i = 0,
        c = 0,
        m = Math.min(a.t, this.t);
      while (i < m) {
        c += this[i] - a[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }

      if (a.t < this.t) {
        c -= a.s;
        while (i < this.t) {
          c += this[i];
          r[i++] = c & this.DM;
          c >>= this.DB;
        }

        c += this.s;
      } else {
        c += this.s;
        while (i < a.t) {
          c -= a[i];
          r[i++] = c & this.DM;
          c >>= this.DB;
        }

        c -= a.s;
      }

      r.s = c < 0 ? -1 : 0;
      if (c < -1) r[i++] = this.DV + c;
      else if (c > 0) r[i++] = c;
      r.t = i;
      r.clamp();
    }

    function bnpMultiplyTo(a, r) {
      var x = this.abs(),
        y = a.abs();
      var i = x.t;
      r.t = i + y.t;
      while (--i >= 0) r[i] = 0;
      for (i = 0; i < y.t; ++i) r[i + x.t] = x.am(0, y[i], r, i, 0, x.t);
      r.s = 0;
      r.clamp();
      if (this.s != a.s) BigInteger.ZERO.subTo(r, r);
    }

    function bnpSquareTo(r) {
      var x = this.abs();
      var i = r.t = 2 * x.t;
      while (--i >= 0) r[i] = 0;
      for (i = 0; i < x.t - 1; ++i) {
        var c = x.am(i, x[i], r, 2 * i, 0, 1);
        if ((r[i + x.t] += x.am(i + 1, 2 * x[i], r, 2 * i + 1, c, x.t - i - 1)) >= x.DV) {
          r[i + x.t] -= x.DV;
          r[i + x.t + 1] = 1;
        }
      }

      if (r.t > 0) r[r.t - 1] += x.am(i, x[i], r, 2 * i, 0, 1);
      r.s = 0;
      r.clamp();
    }

    function bnpDivRemTo(m, q, r) {
      var pm = m.abs();
      if (pm.t <= 0) return;
      var pt = this.abs();
      if (pt.t < pm.t) {
        if (q != null) q.fromInt(0);
        if (r != null) this.copyTo(r);
        return;
      }

      if (r == null) r = nbi();
      var y = nbi(),
        ts = this.s,
        ms = m.s;
      var nsh = this.DB - nbits(pm[pm.t - 1]);
      if (nsh > 0) {
        pm.lShiftTo(nsh, y);
        pt.lShiftTo(nsh, r);
      } else {
        pm.copyTo(y);
        pt.copyTo(r);
      }

      var ys = y.t;
      var y0 = y[ys - 1];
      if (y0 == 0) return;
      var yt = y0 * (1 << this.F1) + (ys > 1 ? y[ys - 2] >> this.F2 : 0);
      var d1 = this.FV / yt,
        d2 = (1 << this.F1) / yt,
        e = 1 << this.F2;
      var i = r.t,
        j = i - ys,
        t = q == null ? nbi() : q;
      y.dlShiftTo(j, t);
      if (r.compareTo(t) >= 0) {
        r[r.t++] = 1;
        r.subTo(t, r);
      }

      BigInteger.ONE.dlShiftTo(ys, t);
      t.subTo(y, y);
      while (y.t < ys) y[y.t++] = 0;
      while (--j >= 0) {
        var qd = r[--i] == y0 ? this.DM : Math.floor(r[i] * d1 + (r[i - 1] + e) * d2);
        if ((r[i] += y.am(0, qd, r, j, 0, ys)) < qd) {
          y.dlShiftTo(j, t);
          r.subTo(t, r);
          while (r[i] < --qd) r.subTo(t, r);
        }
      }

      if (q != null) {
        r.drShiftTo(ys, q);
        if (ts != ms) BigInteger.ZERO.subTo(q, q);
      }

      r.t = ys;
      r.clamp();
      if (nsh > 0) r.rShiftTo(nsh, r);
      if (ts < 0) BigInteger.ZERO.subTo(r, r);
    }

    function bnMod(a) {
      var r = nbi();
      this.abs().divRemTo(a, null, r);
      if (this.s < 0 && r.compareTo(BigInteger.ZERO) > 0) a.subTo(r, r);
      return r;
    }

    function Classic(m) {
      this.m = m;
    }

    function cConvert(x) {
      if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m);
      else return x;
    }

    function cRevert(x) {
      return x;
    }

    function cReduce(x) {
      x.divRemTo(this.m, null, x);
    }

    function cMulTo(x, y, r) {
      x.multiplyTo(y, r);
      this.reduce(r);
    }

    function cSqrTo(x, r) {
      x.squareTo(r);
      this.reduce(r);
    }

    Classic.prototype.convert = cConvert;
    Classic.prototype.revert = cRevert;
    Classic.prototype.reduce = cReduce;
    Classic.prototype.mulTo = cMulTo;
    Classic.prototype.sqrTo = cSqrTo;

    function bnpInvDigit() {
      if (this.t < 1) return 0;
      var x = this[0];
      if ((x & 1) == 0) return 0;
      var y = x & 3;
      y = y * (2 - (x & 15) * y) & 15;
      y = y * (2 - (x & 255) * y) & 255;
      y = y * (2 - ((x & 65535) * y & 65535)) & 65535;
      y = y * (2 - x * y % this.DV) % this.DV;
      return y > 0 ? this.DV - y : -y;
    }

    function Montgomery(m) {
      this.m = m;
      this.mp = m.invDigit();
      this.mpl = this.mp & 32767;
      this.mph = this.mp >> 15;
      this.um = (1 << m.DB - 15) - 1;
      this.mt2 = 2 * m.t;
    }

    function montConvert(x) {
      var r = nbi();
      x.abs().dlShiftTo(this.m.t, r);
      r.divRemTo(this.m, null, r);
      if (x.s < 0 && r.compareTo(BigInteger.ZERO) > 0) this.m.subTo(r, r);
      return r;
    }

    function montRevert(x) {
      var r = nbi();
      x.copyTo(r);
      this.reduce(r);
      return r;
    }

    function montReduce(x) {
      while (x.t <= this.mt2) x[x.t++] = 0;
      for (var i = 0; i < this.m.t; ++i) {
        var j = x[i] & 32767;
        var u0 = j * this.mpl + ((j * this.mph + (x[i] >> 15) * this.mpl & this.um) << 15) & x.DM;
        j = i + this.m.t;
        x[j] += this.m.am(0, u0, x, i, 0, this.m.t);
        while (x[j] >= x.DV) {
          x[j] -= x.DV;
          x[++j]++;
        }
      }

      x.clamp();
      x.drShiftTo(this.m.t, x);
      if (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
    }

    function montSqrTo(x, r) {
      x.squareTo(r);
      this.reduce(r);
    }

    function montMulTo(x, y, r) {
      x.multiplyTo(y, r);
      this.reduce(r);
    }

    Montgomery.prototype.convert = montConvert;
    Montgomery.prototype.revert = montRevert;
    Montgomery.prototype.reduce = montReduce;
    Montgomery.prototype.mulTo = montMulTo;
    Montgomery.prototype.sqrTo = montSqrTo;

    function bnpIsEven() {
      return (this.t > 0 ? this[0] & 1 : this.s) == 0;
    }

    function bnpExp(e, z) {
      if (e > 4294967295 || e < 1) return BigInteger.ONE;
      var r = nbi(),
        r2 = nbi(),
        g = z.convert(this),
        i = nbits(e) - 1;
      g.copyTo(r);
      while (--i >= 0) {
        z.sqrTo(r, r2);
        if ((e & 1 << i) > 0) z.mulTo(r2, g, r);
        else {
          var t = r;
          r = r2;
          r2 = t;
        }
      }

      return z.revert(r);
    }

    function bnModPowInt(e, m) {
      var z;
      if (e < 256 || m.isEven()) z = new Classic(m);
      else z = new Montgomery(m);
      return this.exp(e, z);
    }

    BigInteger.prototype.copyTo = bnpCopyTo;
    BigInteger.prototype.fromInt = bnpFromInt;
    BigInteger.prototype.fromString = bnpFromString;
    BigInteger.prototype.clamp = bnpClamp;
    BigInteger.prototype.dlShiftTo = bnpDLShiftTo;
    BigInteger.prototype.drShiftTo = bnpDRShiftTo;
    BigInteger.prototype.lShiftTo = bnpLShiftTo;
    BigInteger.prototype.rShiftTo = bnpRShiftTo;
    BigInteger.prototype.subTo = bnpSubTo;
    BigInteger.prototype.multiplyTo = bnpMultiplyTo;
    BigInteger.prototype.squareTo = bnpSquareTo;
    BigInteger.prototype.divRemTo = bnpDivRemTo;
    BigInteger.prototype.invDigit = bnpInvDigit;
    BigInteger.prototype.isEven = bnpIsEven;
    BigInteger.prototype.exp = bnpExp;
    BigInteger.prototype.toString = bnToString;
    BigInteger.prototype.negate = bnNegate;
    BigInteger.prototype.abs = bnAbs;
    BigInteger.prototype.compareTo = bnCompareTo;
    BigInteger.prototype.bitLength = bnBitLength;
    BigInteger.prototype.mod = bnMod;
    BigInteger.prototype.modPowInt = bnModPowInt;
    BigInteger.ZERO = nbv(0);
    BigInteger.ONE = nbv(1);

    function bnpFromRadix(s, b) {
      this.fromInt(0);
      if (b == null) b = 10;
      var cs = this.chunkSize(b);
      var d = Math.pow(b, cs),
        mi = false,
        j = 0,
        w = 0;
      for (var i = 0; i < s.length; ++i) {
        var x = intAt(s, i);
        if (x < 0) {
          if (s.charAt(i) == '-' && this.signum() == 0) mi = true;
          continue;
        }

        w = b * w + x;
        if (++j >= cs) {
          this.dMultiply(d);
          this.dAddOffset(w, 0);
          j = 0;
          w = 0;
        }
      }

      if (j > 0) {
        this.dMultiply(Math.pow(b, j));
        this.dAddOffset(w, 0);
      }

      if (mi) BigInteger.ZERO.subTo(this, this);
    }

    function bnpChunkSize(r) {
      return Math.floor(Math.LN2 * this.DB / Math.log(r));
    }

    function bnSigNum() {
      if (this.s < 0) return -1;
      else if (this.t <= 0 || this.t == 1 && this[0] <= 0) return 0;
      else return 1;
    }

    function bnpDMultiply(n) {
      this[this.t] = this.am(0, n - 1, this, 0, 0, this.t);
      ++this.t;
      this.clamp();
    }

    function bnpDAddOffset(n, w) {
      if (n == 0) return;
      while (this.t <= w) this[this.t++] = 0;
      this[w] += n;
      while (this[w] >= this.DV) {
        this[w] -= this.DV;
        if (++w >= this.t) this[this.t++] = 0;
        ++this[w];
      }
    }

    function bnpToRadix(b) {
      if (b == null) b = 10;
      if (this.signum() == 0 || b < 2 || b > 36) return '0';
      var cs = this.chunkSize(b);
      var a = Math.pow(b, cs);
      var d = nbv(a),
        y = nbi(),
        z = nbi(),
        r = '';
      this.divRemTo(d, y, z);
      while (y.signum() > 0) {
        r = (a + z.intValue()).toString(b).substr(1) + r;
        y.divRemTo(d, y, z);
      }

      return z.intValue().toString(b) + r;
    }

    function bnIntValue() {
      if (this.s < 0) {
        if (this.t == 1) return this[0] - this.DV;
        else if (this.t == 0) return -1;
      } else if (this.t == 1) return this[0];
      else if (this.t == 0) return 0;
      return (this[1] & (1 << 32 - this.DB) - 1) << this.DB | this[0];
    }

    function bnpAddTo(a, r) {
      var i = 0,
        c = 0,
        m = Math.min(a.t, this.t);
      while (i < m) {
        c += this[i] + a[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }

      if (a.t < this.t) {
        c += a.s;
        while (i < this.t) {
          c += this[i];
          r[i++] = c & this.DM;
          c >>= this.DB;
        }

        c += this.s;
      } else {
        c += this.s;
        while (i < a.t) {
          c += a[i];
          r[i++] = c & this.DM;
          c >>= this.DB;
        }

        c += a.s;
      }

      r.s = c < 0 ? -1 : 0;
      if (c > 0) r[i++] = c;
      else if (c < -1) r[i++] = this.DV + c;
      r.t = i;
      r.clamp();
    }

    BigInteger.prototype.fromRadix = bnpFromRadix;
    BigInteger.prototype.chunkSize = bnpChunkSize;
    BigInteger.prototype.signum = bnSigNum;
    BigInteger.prototype.dMultiply = bnpDMultiply;
    BigInteger.prototype.dAddOffset = bnpDAddOffset;
    BigInteger.prototype.toRadix = bnpToRadix;
    BigInteger.prototype.intValue = bnIntValue;
    BigInteger.prototype.addTo = bnpAddTo;
    var Wrapper = {
      abs: (function(l, h) {
        var x = new goog.math.Long(l, h);
        var ret;
        if (x.isNegative()) {
          ret = x.negate();
        } else {
          ret = x;
        }

        HEAP32[tempDoublePtr >> 2] = ret.low_;
        HEAP32[tempDoublePtr + 4 >> 2] = ret.high_;
      }),

      ensureTemps: (function() {
        if (Wrapper.ensuredTemps) return;
        Wrapper.ensuredTemps = true;
        Wrapper.two32 = new BigInteger;
        Wrapper.two32.fromString('4294967296', 10);
        Wrapper.two64 = new BigInteger;
        Wrapper.two64.fromString('18446744073709551616', 10);
        Wrapper.temp1 = new BigInteger;
        Wrapper.temp2 = new BigInteger;
      }),

      lh2bignum: (function(l, h) {
        var a = new BigInteger;
        a.fromString(h.toString(), 10);
        var b = new BigInteger;
        a.multiplyTo(Wrapper.two32, b);
        var c = new BigInteger;
        c.fromString(l.toString(), 10);
        var d = new BigInteger;
        c.addTo(b, d);
        return d;
      }),

      stringify: (function(l, h, unsigned) {
        var ret = (new goog.math.Long(l, h)).toString();
        if (unsigned && ret[0] == '-') {
          Wrapper.ensureTemps();
          var bignum = new BigInteger;
          bignum.fromString(ret, 10);
          ret = new BigInteger;
          Wrapper.two64.addTo(bignum, ret);
          ret = ret.toString(10);
        }

        return ret;
      }),

      fromString: (function(str, base, min, max, unsigned) {
        Wrapper.ensureTemps();
        var bignum = new BigInteger;
        bignum.fromString(str, base);
        var bigmin = new BigInteger;
        bigmin.fromString(min, 10);
        var bigmax = new BigInteger;
        bigmax.fromString(max, 10);
        if (unsigned && bignum.compareTo(BigInteger.ZERO) < 0) {
          var temp = new BigInteger;
          bignum.addTo(Wrapper.two64, temp);
          bignum = temp;
        }

        var error = false;
        if (bignum.compareTo(bigmin) < 0) {
          bignum = bigmin;
          error = true;
        } else if (bignum.compareTo(bigmax) > 0) {
          bignum = bigmax;
          error = true;
        }

        var ret = goog.math.Long.fromString(bignum.toString());
        HEAP32[tempDoublePtr >> 2] = ret.low_;
        HEAP32[tempDoublePtr + 4 >> 2] = ret.high_;
        if (error) throw 'range error';
      })
    };
    return Wrapper;
  })();

  if (memoryInitializer) {
    if (typeof Module['locateFile'] === 'function') {
      memoryInitializer = Module['locateFile'](memoryInitializer);
    } else if (Module['memoryInitializerPrefixURL']) {
      memoryInitializer = Module['memoryInitializerPrefixURL'] + memoryInitializer;
    }

    var data = Module['readBinary'](memoryInitializer);
    HEAPU8.set(data, STATIC_BASE);
  }

  function ExitStatus(status) {
    this.name = 'ExitStatus';
    this.message = 'Program terminated with exit(' + status + ')';
    this.status = status;
  }

  ExitStatus.prototype = new Error;
  ExitStatus.prototype.constructor = ExitStatus;
  var initialStackTop;
  var preloadStartTime = null;
  var calledMain = false;
  dependenciesFulfilled = function runCaller() {
    if (!Module['calledRun']) run();
    if (!Module['calledRun']) dependenciesFulfilled = runCaller;
  };

  Module.callMain = function callMain(args) {
    assert(runDependencies == 0, 'cannot call main when async dependencies remain! (listen on __ATMAIN__)');
    assert(__ATPRERUN__.length == 0, 'cannot call main when preRun functions remain to be called');
    args = args || [];
    ensureInitRuntime();

    var argc = args.length + 1;
    function pad() {
      for (var i = 0; i < 4 - 1; i++) {
        argv.push(0);
      }
    }

    var argv = [allocate(intArrayFromString(Module['thisProgram']), 'i8', ALLOC_NORMAL)];
    pad();
    for (var i = 0; i < argc - 1; i = i + 1) {
      argv.push(allocate(intArrayFromString(args[i]), 'i8', ALLOC_NORMAL));
      pad();
    }

    argv.push(0);
    argv = allocate(argv, 'i32', ALLOC_NORMAL);
    initialStackTop = STACKTOP;
    try {
      var ret = Module['_main'](argc, argv, 0);
      exit(ret);
    } catch (e) {
      if (e instanceof ExitStatus) {
        return;
      } else if (e == 'SimulateInfiniteLoop') {
        Module['noExitRuntime'] = true;
        return;
      } else {
        if (e && typeof e === 'object' && e.stack) Module.printErr('exception thrown: ' + [e, e.stack]);
        throw e;
      }
    } finally {
      calledMain = true;
    }
  };

  function run(args) {
    args = args || Module['arguments'];
    if (preloadStartTime === null) preloadStartTime = Date.now();
    if (runDependencies > 0) {
      return;
    }

    preRun();
    if (runDependencies > 0) return;
    if (Module['calledRun']) return;

    function doRun() {
      if (Module['calledRun']) return;
      Module['calledRun'] = true;
      if (ABORT) return;
      ensureInitRuntime();
      preMain();
      if (ENVIRONMENT_IS_WEB && preloadStartTime !== null) {
        Module.printErr('pre-main prep time: ' + (Date.now() - preloadStartTime) + ' ms');
      }

      if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();
      if (Module['_main'] && shouldRunNow) Module['callMain'](args);
      postRun();
    }

    if (Module['setStatus']) {
      Module['setStatus']('Running...');
      setTimeout((function() {
        setTimeout((function() {
          Module['setStatus']('');
        }), 1);

        doRun();
      }), 1);
    } else {
      doRun();
    }
  }

  Module.run = run;

  function exit(status) {
    if (Module['noExitRuntime']) {
      return;
    }

    ABORT = true;
    EXITSTATUS = status;
    STACKTOP = initialStackTop;
    exitRuntime();
    throw new ExitStatus(status);
  }

  Module.exit = exit;

  function abort(text) {
    if (text) {
      Module.print(text);
      Module.printErr(text);
    }

    ABORT = true;
    EXITSTATUS = 1;
    var extra = '\nIf this abort() is unexpected, build with -s ASSERTIONS=1 which can give more information.';
    throw 'abort() at ' + stackTrace() + extra;
  }

  Module.abort = abort;
  if (Module['preInit']) {
    if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
    while (Module['preInit'].length > 0) {
      Module['preInit'].pop()();
    }
  }

  var shouldRunNow = true;
  if (Module['noInitialRun']) {
    shouldRunNow = false;
  }

  run();

  return Module;
};
