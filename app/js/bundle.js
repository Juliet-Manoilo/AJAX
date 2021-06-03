(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

var runtime = (function (exports) {
  "use strict";

  var Op = Object.prototype;
  var hasOwn = Op.hasOwnProperty;
  var undefined; // More compressible than void 0.
  var $Symbol = typeof Symbol === "function" ? Symbol : {};
  var iteratorSymbol = $Symbol.iterator || "@@iterator";
  var asyncIteratorSymbol = $Symbol.asyncIterator || "@@asyncIterator";
  var toStringTagSymbol = $Symbol.toStringTag || "@@toStringTag";

  function define(obj, key, value) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
    return obj[key];
  }
  try {
    // IE 8 has a broken Object.defineProperty that only works on DOM objects.
    define({}, "");
  } catch (err) {
    define = function(obj, key, value) {
      return obj[key] = value;
    };
  }

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided and outerFn.prototype is a Generator, then outerFn.prototype instanceof Generator.
    var protoGenerator = outerFn && outerFn.prototype instanceof Generator ? outerFn : Generator;
    var generator = Object.create(protoGenerator.prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    generator._invoke = makeInvokeMethod(innerFn, self, context);

    return generator;
  }
  exports.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  // This is a polyfill for %IteratorPrototype% for environments that
  // don't natively support it.
  var IteratorPrototype = {};
  IteratorPrototype[iteratorSymbol] = function () {
    return this;
  };

  var getProto = Object.getPrototypeOf;
  var NativeIteratorPrototype = getProto && getProto(getProto(values([])));
  if (NativeIteratorPrototype &&
      NativeIteratorPrototype !== Op &&
      hasOwn.call(NativeIteratorPrototype, iteratorSymbol)) {
    // This environment has a native %IteratorPrototype%; use it instead
    // of the polyfill.
    IteratorPrototype = NativeIteratorPrototype;
  }

  var Gp = GeneratorFunctionPrototype.prototype =
    Generator.prototype = Object.create(IteratorPrototype);
  GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
  GeneratorFunctionPrototype.constructor = GeneratorFunction;
  GeneratorFunction.displayName = define(
    GeneratorFunctionPrototype,
    toStringTagSymbol,
    "GeneratorFunction"
  );

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      define(prototype, method, function(arg) {
        return this._invoke(method, arg);
      });
    });
  }

  exports.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  exports.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
      define(genFun, toStringTagSymbol, "GeneratorFunction");
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `hasOwn.call(value, "__await")` to determine if the yielded value is
  // meant to be awaited.
  exports.awrap = function(arg) {
    return { __await: arg };
  };

  function AsyncIterator(generator, PromiseImpl) {
    function invoke(method, arg, resolve, reject) {
      var record = tryCatch(generator[method], generator, arg);
      if (record.type === "throw") {
        reject(record.arg);
      } else {
        var result = record.arg;
        var value = result.value;
        if (value &&
            typeof value === "object" &&
            hasOwn.call(value, "__await")) {
          return PromiseImpl.resolve(value.__await).then(function(value) {
            invoke("next", value, resolve, reject);
          }, function(err) {
            invoke("throw", err, resolve, reject);
          });
        }

        return PromiseImpl.resolve(value).then(function(unwrapped) {
          // When a yielded Promise is resolved, its final value becomes
          // the .value of the Promise<{value,done}> result for the
          // current iteration.
          result.value = unwrapped;
          resolve(result);
        }, function(error) {
          // If a rejected Promise was yielded, throw the rejection back
          // into the async generator function so it can be handled there.
          return invoke("throw", error, resolve, reject);
        });
      }
    }

    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return new PromiseImpl(function(resolve, reject) {
          invoke(method, arg, resolve, reject);
        });
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : callInvokeWithMethodAndArg();
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    this._invoke = enqueue;
  }

  defineIteratorMethods(AsyncIterator.prototype);
  AsyncIterator.prototype[asyncIteratorSymbol] = function () {
    return this;
  };
  exports.AsyncIterator = AsyncIterator;

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  exports.async = function(innerFn, outerFn, self, tryLocsList, PromiseImpl) {
    if (PromiseImpl === void 0) PromiseImpl = Promise;

    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList),
      PromiseImpl
    );

    return exports.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per 25.3.3.3.3 of the spec:
        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
        return doneResult();
      }

      context.method = method;
      context.arg = arg;

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          var delegateResult = maybeInvokeDelegate(delegate, context);
          if (delegateResult) {
            if (delegateResult === ContinueSentinel) continue;
            return delegateResult;
          }
        }

        if (context.method === "next") {
          // Setting context._sent for legacy support of Babel's
          // function.sent implementation.
          context.sent = context._sent = context.arg;

        } else if (context.method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw context.arg;
          }

          context.dispatchException(context.arg);

        } else if (context.method === "return") {
          context.abrupt("return", context.arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          if (record.arg === ContinueSentinel) {
            continue;
          }

          return {
            value: record.arg,
            done: context.done
          };

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(context.arg) call above.
          context.method = "throw";
          context.arg = record.arg;
        }
      }
    };
  }

  // Call delegate.iterator[context.method](context.arg) and handle the
  // result, either by returning a { value, done } result from the
  // delegate iterator, or by modifying context.method and context.arg,
  // setting context.delegate to null, and returning the ContinueSentinel.
  function maybeInvokeDelegate(delegate, context) {
    var method = delegate.iterator[context.method];
    if (method === undefined) {
      // A .throw or .return when the delegate iterator has no .throw
      // method always terminates the yield* loop.
      context.delegate = null;

      if (context.method === "throw") {
        // Note: ["return"] must be used for ES3 parsing compatibility.
        if (delegate.iterator["return"]) {
          // If the delegate iterator has a return method, give it a
          // chance to clean up.
          context.method = "return";
          context.arg = undefined;
          maybeInvokeDelegate(delegate, context);

          if (context.method === "throw") {
            // If maybeInvokeDelegate(context) changed context.method from
            // "return" to "throw", let that override the TypeError below.
            return ContinueSentinel;
          }
        }

        context.method = "throw";
        context.arg = new TypeError(
          "The iterator does not provide a 'throw' method");
      }

      return ContinueSentinel;
    }

    var record = tryCatch(method, delegate.iterator, context.arg);

    if (record.type === "throw") {
      context.method = "throw";
      context.arg = record.arg;
      context.delegate = null;
      return ContinueSentinel;
    }

    var info = record.arg;

    if (! info) {
      context.method = "throw";
      context.arg = new TypeError("iterator result is not an object");
      context.delegate = null;
      return ContinueSentinel;
    }

    if (info.done) {
      // Assign the result of the finished delegate to the temporary
      // variable specified by delegate.resultName (see delegateYield).
      context[delegate.resultName] = info.value;

      // Resume execution at the desired location (see delegateYield).
      context.next = delegate.nextLoc;

      // If context.method was "throw" but the delegate handled the
      // exception, let the outer generator proceed normally. If
      // context.method was "next", forget context.arg since it has been
      // "consumed" by the delegate iterator. If context.method was
      // "return", allow the original .return call to continue in the
      // outer generator.
      if (context.method !== "return") {
        context.method = "next";
        context.arg = undefined;
      }

    } else {
      // Re-yield the result returned by the delegate method.
      return info;
    }

    // The delegate iterator is finished, so forget it and continue with
    // the outer generator.
    context.delegate = null;
    return ContinueSentinel;
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  define(Gp, toStringTagSymbol, "Generator");

  // A Generator should always return itself as the iterator object when the
  // @@iterator function is called on it. Some browsers' implementations of the
  // iterator prototype chain incorrectly implement this, causing the Generator
  // object to not be returned from this call. This ensures that doesn't happen.
  // See https://github.com/facebook/regenerator/issues/274 for more details.
  Gp[iteratorSymbol] = function() {
    return this;
  };

  Gp.toString = function() {
    return "[object Generator]";
  };

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  exports.keys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    // Return an iterator with no values.
    return { next: doneResult };
  }
  exports.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      // Resetting context._sent for legacy support of Babel's
      // function.sent implementation.
      this.sent = this._sent = undefined;
      this.done = false;
      this.delegate = null;

      this.method = "next";
      this.arg = undefined;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;

        if (caught) {
          // If the dispatched exception was caught by a catch block,
          // then let that catch block handle the exception normally.
          context.method = "next";
          context.arg = undefined;
        }

        return !! caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.method = "next";
        this.next = finallyEntry.finallyLoc;
        return ContinueSentinel;
      }

      return this.complete(record);
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = this.arg = record.arg;
        this.method = "return";
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }

      return ContinueSentinel;
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      if (this.method === "next") {
        // Deliberately forget the last sent value so that we don't
        // accidentally pass it on to the delegate.
        this.arg = undefined;
      }

      return ContinueSentinel;
    }
  };

  // Regardless of whether this script is executing as a CommonJS module
  // or not, return the runtime object so that we can declare the variable
  // regeneratorRuntime in the outer scope, which allows this module to be
  // injected easily by `bin/regenerator --include-runtime script.js`.
  return exports;

}(
  // If this script is executing as a CommonJS module, use module.exports
  // as the regeneratorRuntime namespace. Otherwise create a new empty
  // object. Either way, the resulting object will be used to initialize
  // the regeneratorRuntime variable at the top of this file.
  typeof module === "object" ? module.exports : {}
));

try {
  regeneratorRuntime = runtime;
} catch (accidentalStrictMode) {
  // This module should not be running in strict mode, so the above
  // assignment should always work unless something is misconfigured. Just
  // in case runtime.js accidentally runs in strict mode, we can escape
  // strict mode using a global Function call. This could conceivably fail
  // if a Content Security Policy forbids using Function, but in that case
  // the proper solution is to fix the accidental strict mode problem. If
  // you've misconfigured your bundler to force strict mode and applied a
  // CSP to forbid Function, and you're not willing to fix either of those
  // problems, please detail your unique predicament in a GitHub issue.
  Function("r", "regeneratorRuntime = r")(runtime);
}

},{}],2:[function(require,module,exports){
"use strict";

require("regenerator-runtime/runtime");

function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { Promise.resolve(value).then(_next, _throw); } }

function _asyncToGenerator(fn) { return function () { var self = this, args = arguments; return new Promise(function (resolve, reject) { var gen = fn.apply(self, args); function _next(value) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value); } function _throw(err) { asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err); } _next(undefined); }); }; }

var output = document.getElementById('block');

var getData = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee() {
    var res, parsedRes;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _context.next = 2;
            return fetch('https://jsonplaceholder.typicode.com/todos');

          case 2:
            res = _context.sent;
            _context.next = 5;
            return res.json();

          case 5:
            parsedRes = _context.sent;
            output.innerHTML = parsedRes.map(function (_ref2) {
              var title = _ref2.title,
                  id = _ref2.id;
              return "\n   <div class=\"card\"> ".concat(id, " </div>\n   <p class=\"desc\">").concat(title, "</p>");
            }); //console.log (parsedRes);
            //document.body.innerHTML = `<h2>${parsedRes.original_title}</h2><p>${parsedRes.overview}</p>`

            return _context.abrupt("return", parsedRes);

          case 8:
          case "end":
            return _context.stop();
        }
      }
    }, _callee);
  }));

  return function getData() {
    return _ref.apply(this, arguments);
  };
}();

getData(); //console.log (getData);

},{"regenerator-runtime/runtime":1}]},{},[2])

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvcmVnZW5lcmF0b3ItcnVudGltZS9ydW50aW1lLmpzIiwicHJvamVjdHMvYWpheC9zcmMvanMvYXBwLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzV1QkE7Ozs7OztBQUVBLElBQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQyxjQUFULENBQXdCLE9BQXhCLENBQWY7O0FBR0EsSUFBTSxPQUFPO0FBQUEscUVBQUc7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxtQkFDTSxLQUFLLENBQUUsNENBQUYsQ0FEWDs7QUFBQTtBQUNOLFlBQUEsR0FETTtBQUFBO0FBQUEsbUJBRVksR0FBRyxDQUFDLElBQUosRUFGWjs7QUFBQTtBQUVOLFlBQUEsU0FGTTtBQUliLFlBQUEsTUFBTSxDQUFDLFNBQVAsR0FBbUIsU0FBUyxDQUFDLEdBQVYsQ0FBYyxpQkFDakM7QUFBQSxrQkFEbUMsS0FDbkMsU0FEbUMsS0FDbkM7QUFBQSxrQkFEMEMsRUFDMUMsU0FEMEMsRUFDMUM7QUFBRSx5REFDbUIsRUFEbkIsMkNBRWdCLEtBRmhCO0FBRTRCLGFBSFgsQ0FBbkIsQ0FKYSxDQVVaO0FBQ0E7O0FBWFksNkNBWUwsU0FaSzs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxHQUFIOztBQUFBLGtCQUFQLE9BQU87QUFBQTtBQUFBO0FBQUEsR0FBYjs7QUFlQSxPQUFPLEcsQ0FFUCIsImZpbGUiOiJidW5kbGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiLyoqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTQtcHJlc2VudCwgRmFjZWJvb2ssIEluYy5cbiAqXG4gKiBUaGlzIHNvdXJjZSBjb2RlIGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZSBmb3VuZCBpbiB0aGVcbiAqIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBkaXJlY3Rvcnkgb2YgdGhpcyBzb3VyY2UgdHJlZS5cbiAqL1xuXG52YXIgcnVudGltZSA9IChmdW5jdGlvbiAoZXhwb3J0cykge1xuICBcInVzZSBzdHJpY3RcIjtcblxuICB2YXIgT3AgPSBPYmplY3QucHJvdG90eXBlO1xuICB2YXIgaGFzT3duID0gT3AuaGFzT3duUHJvcGVydHk7XG4gIHZhciB1bmRlZmluZWQ7IC8vIE1vcmUgY29tcHJlc3NpYmxlIHRoYW4gdm9pZCAwLlxuICB2YXIgJFN5bWJvbCA9IHR5cGVvZiBTeW1ib2wgPT09IFwiZnVuY3Rpb25cIiA/IFN5bWJvbCA6IHt9O1xuICB2YXIgaXRlcmF0b3JTeW1ib2wgPSAkU3ltYm9sLml0ZXJhdG9yIHx8IFwiQEBpdGVyYXRvclwiO1xuICB2YXIgYXN5bmNJdGVyYXRvclN5bWJvbCA9ICRTeW1ib2wuYXN5bmNJdGVyYXRvciB8fCBcIkBAYXN5bmNJdGVyYXRvclwiO1xuICB2YXIgdG9TdHJpbmdUYWdTeW1ib2wgPSAkU3ltYm9sLnRvU3RyaW5nVGFnIHx8IFwiQEB0b1N0cmluZ1RhZ1wiO1xuXG4gIGZ1bmN0aW9uIGRlZmluZShvYmosIGtleSwgdmFsdWUpIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBrZXksIHtcbiAgICAgIHZhbHVlOiB2YWx1ZSxcbiAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICB3cml0YWJsZTogdHJ1ZVxuICAgIH0pO1xuICAgIHJldHVybiBvYmpba2V5XTtcbiAgfVxuICB0cnkge1xuICAgIC8vIElFIDggaGFzIGEgYnJva2VuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSB0aGF0IG9ubHkgd29ya3Mgb24gRE9NIG9iamVjdHMuXG4gICAgZGVmaW5lKHt9LCBcIlwiKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgZGVmaW5lID0gZnVuY3Rpb24ob2JqLCBrZXksIHZhbHVlKSB7XG4gICAgICByZXR1cm4gb2JqW2tleV0gPSB2YWx1ZTtcbiAgICB9O1xuICB9XG5cbiAgZnVuY3Rpb24gd3JhcChpbm5lckZuLCBvdXRlckZuLCBzZWxmLCB0cnlMb2NzTGlzdCkge1xuICAgIC8vIElmIG91dGVyRm4gcHJvdmlkZWQgYW5kIG91dGVyRm4ucHJvdG90eXBlIGlzIGEgR2VuZXJhdG9yLCB0aGVuIG91dGVyRm4ucHJvdG90eXBlIGluc3RhbmNlb2YgR2VuZXJhdG9yLlxuICAgIHZhciBwcm90b0dlbmVyYXRvciA9IG91dGVyRm4gJiYgb3V0ZXJGbi5wcm90b3R5cGUgaW5zdGFuY2VvZiBHZW5lcmF0b3IgPyBvdXRlckZuIDogR2VuZXJhdG9yO1xuICAgIHZhciBnZW5lcmF0b3IgPSBPYmplY3QuY3JlYXRlKHByb3RvR2VuZXJhdG9yLnByb3RvdHlwZSk7XG4gICAgdmFyIGNvbnRleHQgPSBuZXcgQ29udGV4dCh0cnlMb2NzTGlzdCB8fCBbXSk7XG5cbiAgICAvLyBUaGUgLl9pbnZva2UgbWV0aG9kIHVuaWZpZXMgdGhlIGltcGxlbWVudGF0aW9ucyBvZiB0aGUgLm5leHQsXG4gICAgLy8gLnRocm93LCBhbmQgLnJldHVybiBtZXRob2RzLlxuICAgIGdlbmVyYXRvci5faW52b2tlID0gbWFrZUludm9rZU1ldGhvZChpbm5lckZuLCBzZWxmLCBjb250ZXh0KTtcblxuICAgIHJldHVybiBnZW5lcmF0b3I7XG4gIH1cbiAgZXhwb3J0cy53cmFwID0gd3JhcDtcblxuICAvLyBUcnkvY2F0Y2ggaGVscGVyIHRvIG1pbmltaXplIGRlb3B0aW1pemF0aW9ucy4gUmV0dXJucyBhIGNvbXBsZXRpb25cbiAgLy8gcmVjb3JkIGxpa2UgY29udGV4dC50cnlFbnRyaWVzW2ldLmNvbXBsZXRpb24uIFRoaXMgaW50ZXJmYWNlIGNvdWxkXG4gIC8vIGhhdmUgYmVlbiAoYW5kIHdhcyBwcmV2aW91c2x5KSBkZXNpZ25lZCB0byB0YWtlIGEgY2xvc3VyZSB0byBiZVxuICAvLyBpbnZva2VkIHdpdGhvdXQgYXJndW1lbnRzLCBidXQgaW4gYWxsIHRoZSBjYXNlcyB3ZSBjYXJlIGFib3V0IHdlXG4gIC8vIGFscmVhZHkgaGF2ZSBhbiBleGlzdGluZyBtZXRob2Qgd2Ugd2FudCB0byBjYWxsLCBzbyB0aGVyZSdzIG5vIG5lZWRcbiAgLy8gdG8gY3JlYXRlIGEgbmV3IGZ1bmN0aW9uIG9iamVjdC4gV2UgY2FuIGV2ZW4gZ2V0IGF3YXkgd2l0aCBhc3N1bWluZ1xuICAvLyB0aGUgbWV0aG9kIHRha2VzIGV4YWN0bHkgb25lIGFyZ3VtZW50LCBzaW5jZSB0aGF0IGhhcHBlbnMgdG8gYmUgdHJ1ZVxuICAvLyBpbiBldmVyeSBjYXNlLCBzbyB3ZSBkb24ndCBoYXZlIHRvIHRvdWNoIHRoZSBhcmd1bWVudHMgb2JqZWN0LiBUaGVcbiAgLy8gb25seSBhZGRpdGlvbmFsIGFsbG9jYXRpb24gcmVxdWlyZWQgaXMgdGhlIGNvbXBsZXRpb24gcmVjb3JkLCB3aGljaFxuICAvLyBoYXMgYSBzdGFibGUgc2hhcGUgYW5kIHNvIGhvcGVmdWxseSBzaG91bGQgYmUgY2hlYXAgdG8gYWxsb2NhdGUuXG4gIGZ1bmN0aW9uIHRyeUNhdGNoKGZuLCBvYmosIGFyZykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4geyB0eXBlOiBcIm5vcm1hbFwiLCBhcmc6IGZuLmNhbGwob2JqLCBhcmcpIH07XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICByZXR1cm4geyB0eXBlOiBcInRocm93XCIsIGFyZzogZXJyIH07XG4gICAgfVxuICB9XG5cbiAgdmFyIEdlblN0YXRlU3VzcGVuZGVkU3RhcnQgPSBcInN1c3BlbmRlZFN0YXJ0XCI7XG4gIHZhciBHZW5TdGF0ZVN1c3BlbmRlZFlpZWxkID0gXCJzdXNwZW5kZWRZaWVsZFwiO1xuICB2YXIgR2VuU3RhdGVFeGVjdXRpbmcgPSBcImV4ZWN1dGluZ1wiO1xuICB2YXIgR2VuU3RhdGVDb21wbGV0ZWQgPSBcImNvbXBsZXRlZFwiO1xuXG4gIC8vIFJldHVybmluZyB0aGlzIG9iamVjdCBmcm9tIHRoZSBpbm5lckZuIGhhcyB0aGUgc2FtZSBlZmZlY3QgYXNcbiAgLy8gYnJlYWtpbmcgb3V0IG9mIHRoZSBkaXNwYXRjaCBzd2l0Y2ggc3RhdGVtZW50LlxuICB2YXIgQ29udGludWVTZW50aW5lbCA9IHt9O1xuXG4gIC8vIER1bW15IGNvbnN0cnVjdG9yIGZ1bmN0aW9ucyB0aGF0IHdlIHVzZSBhcyB0aGUgLmNvbnN0cnVjdG9yIGFuZFxuICAvLyAuY29uc3RydWN0b3IucHJvdG90eXBlIHByb3BlcnRpZXMgZm9yIGZ1bmN0aW9ucyB0aGF0IHJldHVybiBHZW5lcmF0b3JcbiAgLy8gb2JqZWN0cy4gRm9yIGZ1bGwgc3BlYyBjb21wbGlhbmNlLCB5b3UgbWF5IHdpc2ggdG8gY29uZmlndXJlIHlvdXJcbiAgLy8gbWluaWZpZXIgbm90IHRvIG1hbmdsZSB0aGUgbmFtZXMgb2YgdGhlc2UgdHdvIGZ1bmN0aW9ucy5cbiAgZnVuY3Rpb24gR2VuZXJhdG9yKCkge31cbiAgZnVuY3Rpb24gR2VuZXJhdG9yRnVuY3Rpb24oKSB7fVxuICBmdW5jdGlvbiBHZW5lcmF0b3JGdW5jdGlvblByb3RvdHlwZSgpIHt9XG5cbiAgLy8gVGhpcyBpcyBhIHBvbHlmaWxsIGZvciAlSXRlcmF0b3JQcm90b3R5cGUlIGZvciBlbnZpcm9ubWVudHMgdGhhdFxuICAvLyBkb24ndCBuYXRpdmVseSBzdXBwb3J0IGl0LlxuICB2YXIgSXRlcmF0b3JQcm90b3R5cGUgPSB7fTtcbiAgSXRlcmF0b3JQcm90b3R5cGVbaXRlcmF0b3JTeW1ib2xdID0gZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB0aGlzO1xuICB9O1xuXG4gIHZhciBnZXRQcm90byA9IE9iamVjdC5nZXRQcm90b3R5cGVPZjtcbiAgdmFyIE5hdGl2ZUl0ZXJhdG9yUHJvdG90eXBlID0gZ2V0UHJvdG8gJiYgZ2V0UHJvdG8oZ2V0UHJvdG8odmFsdWVzKFtdKSkpO1xuICBpZiAoTmF0aXZlSXRlcmF0b3JQcm90b3R5cGUgJiZcbiAgICAgIE5hdGl2ZUl0ZXJhdG9yUHJvdG90eXBlICE9PSBPcCAmJlxuICAgICAgaGFzT3duLmNhbGwoTmF0aXZlSXRlcmF0b3JQcm90b3R5cGUsIGl0ZXJhdG9yU3ltYm9sKSkge1xuICAgIC8vIFRoaXMgZW52aXJvbm1lbnQgaGFzIGEgbmF0aXZlICVJdGVyYXRvclByb3RvdHlwZSU7IHVzZSBpdCBpbnN0ZWFkXG4gICAgLy8gb2YgdGhlIHBvbHlmaWxsLlxuICAgIEl0ZXJhdG9yUHJvdG90eXBlID0gTmF0aXZlSXRlcmF0b3JQcm90b3R5cGU7XG4gIH1cblxuICB2YXIgR3AgPSBHZW5lcmF0b3JGdW5jdGlvblByb3RvdHlwZS5wcm90b3R5cGUgPVxuICAgIEdlbmVyYXRvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEl0ZXJhdG9yUHJvdG90eXBlKTtcbiAgR2VuZXJhdG9yRnVuY3Rpb24ucHJvdG90eXBlID0gR3AuY29uc3RydWN0b3IgPSBHZW5lcmF0b3JGdW5jdGlvblByb3RvdHlwZTtcbiAgR2VuZXJhdG9yRnVuY3Rpb25Qcm90b3R5cGUuY29uc3RydWN0b3IgPSBHZW5lcmF0b3JGdW5jdGlvbjtcbiAgR2VuZXJhdG9yRnVuY3Rpb24uZGlzcGxheU5hbWUgPSBkZWZpbmUoXG4gICAgR2VuZXJhdG9yRnVuY3Rpb25Qcm90b3R5cGUsXG4gICAgdG9TdHJpbmdUYWdTeW1ib2wsXG4gICAgXCJHZW5lcmF0b3JGdW5jdGlvblwiXG4gICk7XG5cbiAgLy8gSGVscGVyIGZvciBkZWZpbmluZyB0aGUgLm5leHQsIC50aHJvdywgYW5kIC5yZXR1cm4gbWV0aG9kcyBvZiB0aGVcbiAgLy8gSXRlcmF0b3IgaW50ZXJmYWNlIGluIHRlcm1zIG9mIGEgc2luZ2xlIC5faW52b2tlIG1ldGhvZC5cbiAgZnVuY3Rpb24gZGVmaW5lSXRlcmF0b3JNZXRob2RzKHByb3RvdHlwZSkge1xuICAgIFtcIm5leHRcIiwgXCJ0aHJvd1wiLCBcInJldHVyblwiXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgZGVmaW5lKHByb3RvdHlwZSwgbWV0aG9kLCBmdW5jdGlvbihhcmcpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2ludm9rZShtZXRob2QsIGFyZyk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGV4cG9ydHMuaXNHZW5lcmF0b3JGdW5jdGlvbiA9IGZ1bmN0aW9uKGdlbkZ1bikge1xuICAgIHZhciBjdG9yID0gdHlwZW9mIGdlbkZ1biA9PT0gXCJmdW5jdGlvblwiICYmIGdlbkZ1bi5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY3RvclxuICAgICAgPyBjdG9yID09PSBHZW5lcmF0b3JGdW5jdGlvbiB8fFxuICAgICAgICAvLyBGb3IgdGhlIG5hdGl2ZSBHZW5lcmF0b3JGdW5jdGlvbiBjb25zdHJ1Y3RvciwgdGhlIGJlc3Qgd2UgY2FuXG4gICAgICAgIC8vIGRvIGlzIHRvIGNoZWNrIGl0cyAubmFtZSBwcm9wZXJ0eS5cbiAgICAgICAgKGN0b3IuZGlzcGxheU5hbWUgfHwgY3Rvci5uYW1lKSA9PT0gXCJHZW5lcmF0b3JGdW5jdGlvblwiXG4gICAgICA6IGZhbHNlO1xuICB9O1xuXG4gIGV4cG9ydHMubWFyayA9IGZ1bmN0aW9uKGdlbkZ1bikge1xuICAgIGlmIChPYmplY3Quc2V0UHJvdG90eXBlT2YpIHtcbiAgICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZihnZW5GdW4sIEdlbmVyYXRvckZ1bmN0aW9uUHJvdG90eXBlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZ2VuRnVuLl9fcHJvdG9fXyA9IEdlbmVyYXRvckZ1bmN0aW9uUHJvdG90eXBlO1xuICAgICAgZGVmaW5lKGdlbkZ1biwgdG9TdHJpbmdUYWdTeW1ib2wsIFwiR2VuZXJhdG9yRnVuY3Rpb25cIik7XG4gICAgfVxuICAgIGdlbkZ1bi5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKEdwKTtcbiAgICByZXR1cm4gZ2VuRnVuO1xuICB9O1xuXG4gIC8vIFdpdGhpbiB0aGUgYm9keSBvZiBhbnkgYXN5bmMgZnVuY3Rpb24sIGBhd2FpdCB4YCBpcyB0cmFuc2Zvcm1lZCB0b1xuICAvLyBgeWllbGQgcmVnZW5lcmF0b3JSdW50aW1lLmF3cmFwKHgpYCwgc28gdGhhdCB0aGUgcnVudGltZSBjYW4gdGVzdFxuICAvLyBgaGFzT3duLmNhbGwodmFsdWUsIFwiX19hd2FpdFwiKWAgdG8gZGV0ZXJtaW5lIGlmIHRoZSB5aWVsZGVkIHZhbHVlIGlzXG4gIC8vIG1lYW50IHRvIGJlIGF3YWl0ZWQuXG4gIGV4cG9ydHMuYXdyYXAgPSBmdW5jdGlvbihhcmcpIHtcbiAgICByZXR1cm4geyBfX2F3YWl0OiBhcmcgfTtcbiAgfTtcblxuICBmdW5jdGlvbiBBc3luY0l0ZXJhdG9yKGdlbmVyYXRvciwgUHJvbWlzZUltcGwpIHtcbiAgICBmdW5jdGlvbiBpbnZva2UobWV0aG9kLCBhcmcsIHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgdmFyIHJlY29yZCA9IHRyeUNhdGNoKGdlbmVyYXRvclttZXRob2RdLCBnZW5lcmF0b3IsIGFyZyk7XG4gICAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwidGhyb3dcIikge1xuICAgICAgICByZWplY3QocmVjb3JkLmFyZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgcmVzdWx0ID0gcmVjb3JkLmFyZztcbiAgICAgICAgdmFyIHZhbHVlID0gcmVzdWx0LnZhbHVlO1xuICAgICAgICBpZiAodmFsdWUgJiZcbiAgICAgICAgICAgIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICAgICAgaGFzT3duLmNhbGwodmFsdWUsIFwiX19hd2FpdFwiKSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlSW1wbC5yZXNvbHZlKHZhbHVlLl9fYXdhaXQpLnRoZW4oZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICAgIGludm9rZShcIm5leHRcIiwgdmFsdWUsIHJlc29sdmUsIHJlamVjdCk7XG4gICAgICAgICAgfSwgZnVuY3Rpb24oZXJyKSB7XG4gICAgICAgICAgICBpbnZva2UoXCJ0aHJvd1wiLCBlcnIsIHJlc29sdmUsIHJlamVjdCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gUHJvbWlzZUltcGwucmVzb2x2ZSh2YWx1ZSkudGhlbihmdW5jdGlvbih1bndyYXBwZWQpIHtcbiAgICAgICAgICAvLyBXaGVuIGEgeWllbGRlZCBQcm9taXNlIGlzIHJlc29sdmVkLCBpdHMgZmluYWwgdmFsdWUgYmVjb21lc1xuICAgICAgICAgIC8vIHRoZSAudmFsdWUgb2YgdGhlIFByb21pc2U8e3ZhbHVlLGRvbmV9PiByZXN1bHQgZm9yIHRoZVxuICAgICAgICAgIC8vIGN1cnJlbnQgaXRlcmF0aW9uLlxuICAgICAgICAgIHJlc3VsdC52YWx1ZSA9IHVud3JhcHBlZDtcbiAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH0sIGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgLy8gSWYgYSByZWplY3RlZCBQcm9taXNlIHdhcyB5aWVsZGVkLCB0aHJvdyB0aGUgcmVqZWN0aW9uIGJhY2tcbiAgICAgICAgICAvLyBpbnRvIHRoZSBhc3luYyBnZW5lcmF0b3IgZnVuY3Rpb24gc28gaXQgY2FuIGJlIGhhbmRsZWQgdGhlcmUuXG4gICAgICAgICAgcmV0dXJuIGludm9rZShcInRocm93XCIsIGVycm9yLCByZXNvbHZlLCByZWplY3QpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgcHJldmlvdXNQcm9taXNlO1xuXG4gICAgZnVuY3Rpb24gZW5xdWV1ZShtZXRob2QsIGFyZykge1xuICAgICAgZnVuY3Rpb24gY2FsbEludm9rZVdpdGhNZXRob2RBbmRBcmcoKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZUltcGwoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgICAgaW52b2tlKG1ldGhvZCwgYXJnLCByZXNvbHZlLCByZWplY3QpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHByZXZpb3VzUHJvbWlzZSA9XG4gICAgICAgIC8vIElmIGVucXVldWUgaGFzIGJlZW4gY2FsbGVkIGJlZm9yZSwgdGhlbiB3ZSB3YW50IHRvIHdhaXQgdW50aWxcbiAgICAgICAgLy8gYWxsIHByZXZpb3VzIFByb21pc2VzIGhhdmUgYmVlbiByZXNvbHZlZCBiZWZvcmUgY2FsbGluZyBpbnZva2UsXG4gICAgICAgIC8vIHNvIHRoYXQgcmVzdWx0cyBhcmUgYWx3YXlzIGRlbGl2ZXJlZCBpbiB0aGUgY29ycmVjdCBvcmRlci4gSWZcbiAgICAgICAgLy8gZW5xdWV1ZSBoYXMgbm90IGJlZW4gY2FsbGVkIGJlZm9yZSwgdGhlbiBpdCBpcyBpbXBvcnRhbnQgdG9cbiAgICAgICAgLy8gY2FsbCBpbnZva2UgaW1tZWRpYXRlbHksIHdpdGhvdXQgd2FpdGluZyBvbiBhIGNhbGxiYWNrIHRvIGZpcmUsXG4gICAgICAgIC8vIHNvIHRoYXQgdGhlIGFzeW5jIGdlbmVyYXRvciBmdW5jdGlvbiBoYXMgdGhlIG9wcG9ydHVuaXR5IHRvIGRvXG4gICAgICAgIC8vIGFueSBuZWNlc3Nhcnkgc2V0dXAgaW4gYSBwcmVkaWN0YWJsZSB3YXkuIFRoaXMgcHJlZGljdGFiaWxpdHlcbiAgICAgICAgLy8gaXMgd2h5IHRoZSBQcm9taXNlIGNvbnN0cnVjdG9yIHN5bmNocm9ub3VzbHkgaW52b2tlcyBpdHNcbiAgICAgICAgLy8gZXhlY3V0b3IgY2FsbGJhY2ssIGFuZCB3aHkgYXN5bmMgZnVuY3Rpb25zIHN5bmNocm9ub3VzbHlcbiAgICAgICAgLy8gZXhlY3V0ZSBjb2RlIGJlZm9yZSB0aGUgZmlyc3QgYXdhaXQuIFNpbmNlIHdlIGltcGxlbWVudCBzaW1wbGVcbiAgICAgICAgLy8gYXN5bmMgZnVuY3Rpb25zIGluIHRlcm1zIG9mIGFzeW5jIGdlbmVyYXRvcnMsIGl0IGlzIGVzcGVjaWFsbHlcbiAgICAgICAgLy8gaW1wb3J0YW50IHRvIGdldCB0aGlzIHJpZ2h0LCBldmVuIHRob3VnaCBpdCByZXF1aXJlcyBjYXJlLlxuICAgICAgICBwcmV2aW91c1Byb21pc2UgPyBwcmV2aW91c1Byb21pc2UudGhlbihcbiAgICAgICAgICBjYWxsSW52b2tlV2l0aE1ldGhvZEFuZEFyZyxcbiAgICAgICAgICAvLyBBdm9pZCBwcm9wYWdhdGluZyBmYWlsdXJlcyB0byBQcm9taXNlcyByZXR1cm5lZCBieSBsYXRlclxuICAgICAgICAgIC8vIGludm9jYXRpb25zIG9mIHRoZSBpdGVyYXRvci5cbiAgICAgICAgICBjYWxsSW52b2tlV2l0aE1ldGhvZEFuZEFyZ1xuICAgICAgICApIDogY2FsbEludm9rZVdpdGhNZXRob2RBbmRBcmcoKTtcbiAgICB9XG5cbiAgICAvLyBEZWZpbmUgdGhlIHVuaWZpZWQgaGVscGVyIG1ldGhvZCB0aGF0IGlzIHVzZWQgdG8gaW1wbGVtZW50IC5uZXh0LFxuICAgIC8vIC50aHJvdywgYW5kIC5yZXR1cm4gKHNlZSBkZWZpbmVJdGVyYXRvck1ldGhvZHMpLlxuICAgIHRoaXMuX2ludm9rZSA9IGVucXVldWU7XG4gIH1cblxuICBkZWZpbmVJdGVyYXRvck1ldGhvZHMoQXN5bmNJdGVyYXRvci5wcm90b3R5cGUpO1xuICBBc3luY0l0ZXJhdG9yLnByb3RvdHlwZVthc3luY0l0ZXJhdG9yU3ltYm9sXSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcbiAgZXhwb3J0cy5Bc3luY0l0ZXJhdG9yID0gQXN5bmNJdGVyYXRvcjtcblxuICAvLyBOb3RlIHRoYXQgc2ltcGxlIGFzeW5jIGZ1bmN0aW9ucyBhcmUgaW1wbGVtZW50ZWQgb24gdG9wIG9mXG4gIC8vIEFzeW5jSXRlcmF0b3Igb2JqZWN0czsgdGhleSBqdXN0IHJldHVybiBhIFByb21pc2UgZm9yIHRoZSB2YWx1ZSBvZlxuICAvLyB0aGUgZmluYWwgcmVzdWx0IHByb2R1Y2VkIGJ5IHRoZSBpdGVyYXRvci5cbiAgZXhwb3J0cy5hc3luYyA9IGZ1bmN0aW9uKGlubmVyRm4sIG91dGVyRm4sIHNlbGYsIHRyeUxvY3NMaXN0LCBQcm9taXNlSW1wbCkge1xuICAgIGlmIChQcm9taXNlSW1wbCA9PT0gdm9pZCAwKSBQcm9taXNlSW1wbCA9IFByb21pc2U7XG5cbiAgICB2YXIgaXRlciA9IG5ldyBBc3luY0l0ZXJhdG9yKFxuICAgICAgd3JhcChpbm5lckZuLCBvdXRlckZuLCBzZWxmLCB0cnlMb2NzTGlzdCksXG4gICAgICBQcm9taXNlSW1wbFxuICAgICk7XG5cbiAgICByZXR1cm4gZXhwb3J0cy5pc0dlbmVyYXRvckZ1bmN0aW9uKG91dGVyRm4pXG4gICAgICA/IGl0ZXIgLy8gSWYgb3V0ZXJGbiBpcyBhIGdlbmVyYXRvciwgcmV0dXJuIHRoZSBmdWxsIGl0ZXJhdG9yLlxuICAgICAgOiBpdGVyLm5leHQoKS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQuZG9uZSA/IHJlc3VsdC52YWx1ZSA6IGl0ZXIubmV4dCgpO1xuICAgICAgICB9KTtcbiAgfTtcblxuICBmdW5jdGlvbiBtYWtlSW52b2tlTWV0aG9kKGlubmVyRm4sIHNlbGYsIGNvbnRleHQpIHtcbiAgICB2YXIgc3RhdGUgPSBHZW5TdGF0ZVN1c3BlbmRlZFN0YXJ0O1xuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIGludm9rZShtZXRob2QsIGFyZykge1xuICAgICAgaWYgKHN0YXRlID09PSBHZW5TdGF0ZUV4ZWN1dGluZykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJHZW5lcmF0b3IgaXMgYWxyZWFkeSBydW5uaW5nXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoc3RhdGUgPT09IEdlblN0YXRlQ29tcGxldGVkKSB7XG4gICAgICAgIGlmIChtZXRob2QgPT09IFwidGhyb3dcIikge1xuICAgICAgICAgIHRocm93IGFyZztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEJlIGZvcmdpdmluZywgcGVyIDI1LjMuMy4zLjMgb2YgdGhlIHNwZWM6XG4gICAgICAgIC8vIGh0dHBzOi8vcGVvcGxlLm1vemlsbGEub3JnL35qb3JlbmRvcmZmL2VzNi1kcmFmdC5odG1sI3NlYy1nZW5lcmF0b3JyZXN1bWVcbiAgICAgICAgcmV0dXJuIGRvbmVSZXN1bHQoKTtcbiAgICAgIH1cblxuICAgICAgY29udGV4dC5tZXRob2QgPSBtZXRob2Q7XG4gICAgICBjb250ZXh0LmFyZyA9IGFyZztcblxuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgdmFyIGRlbGVnYXRlID0gY29udGV4dC5kZWxlZ2F0ZTtcbiAgICAgICAgaWYgKGRlbGVnYXRlKSB7XG4gICAgICAgICAgdmFyIGRlbGVnYXRlUmVzdWx0ID0gbWF5YmVJbnZva2VEZWxlZ2F0ZShkZWxlZ2F0ZSwgY29udGV4dCk7XG4gICAgICAgICAgaWYgKGRlbGVnYXRlUmVzdWx0KSB7XG4gICAgICAgICAgICBpZiAoZGVsZWdhdGVSZXN1bHQgPT09IENvbnRpbnVlU2VudGluZWwpIGNvbnRpbnVlO1xuICAgICAgICAgICAgcmV0dXJuIGRlbGVnYXRlUmVzdWx0O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChjb250ZXh0Lm1ldGhvZCA9PT0gXCJuZXh0XCIpIHtcbiAgICAgICAgICAvLyBTZXR0aW5nIGNvbnRleHQuX3NlbnQgZm9yIGxlZ2FjeSBzdXBwb3J0IG9mIEJhYmVsJ3NcbiAgICAgICAgICAvLyBmdW5jdGlvbi5zZW50IGltcGxlbWVudGF0aW9uLlxuICAgICAgICAgIGNvbnRleHQuc2VudCA9IGNvbnRleHQuX3NlbnQgPSBjb250ZXh0LmFyZztcblxuICAgICAgICB9IGVsc2UgaWYgKGNvbnRleHQubWV0aG9kID09PSBcInRocm93XCIpIHtcbiAgICAgICAgICBpZiAoc3RhdGUgPT09IEdlblN0YXRlU3VzcGVuZGVkU3RhcnQpIHtcbiAgICAgICAgICAgIHN0YXRlID0gR2VuU3RhdGVDb21wbGV0ZWQ7XG4gICAgICAgICAgICB0aHJvdyBjb250ZXh0LmFyZztcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb250ZXh0LmRpc3BhdGNoRXhjZXB0aW9uKGNvbnRleHQuYXJnKTtcblxuICAgICAgICB9IGVsc2UgaWYgKGNvbnRleHQubWV0aG9kID09PSBcInJldHVyblwiKSB7XG4gICAgICAgICAgY29udGV4dC5hYnJ1cHQoXCJyZXR1cm5cIiwgY29udGV4dC5hcmcpO1xuICAgICAgICB9XG5cbiAgICAgICAgc3RhdGUgPSBHZW5TdGF0ZUV4ZWN1dGluZztcblxuICAgICAgICB2YXIgcmVjb3JkID0gdHJ5Q2F0Y2goaW5uZXJGbiwgc2VsZiwgY29udGV4dCk7XG4gICAgICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJub3JtYWxcIikge1xuICAgICAgICAgIC8vIElmIGFuIGV4Y2VwdGlvbiBpcyB0aHJvd24gZnJvbSBpbm5lckZuLCB3ZSBsZWF2ZSBzdGF0ZSA9PT1cbiAgICAgICAgICAvLyBHZW5TdGF0ZUV4ZWN1dGluZyBhbmQgbG9vcCBiYWNrIGZvciBhbm90aGVyIGludm9jYXRpb24uXG4gICAgICAgICAgc3RhdGUgPSBjb250ZXh0LmRvbmVcbiAgICAgICAgICAgID8gR2VuU3RhdGVDb21wbGV0ZWRcbiAgICAgICAgICAgIDogR2VuU3RhdGVTdXNwZW5kZWRZaWVsZDtcblxuICAgICAgICAgIGlmIChyZWNvcmQuYXJnID09PSBDb250aW51ZVNlbnRpbmVsKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdmFsdWU6IHJlY29yZC5hcmcsXG4gICAgICAgICAgICBkb25lOiBjb250ZXh0LmRvbmVcbiAgICAgICAgICB9O1xuXG4gICAgICAgIH0gZWxzZSBpZiAocmVjb3JkLnR5cGUgPT09IFwidGhyb3dcIikge1xuICAgICAgICAgIHN0YXRlID0gR2VuU3RhdGVDb21wbGV0ZWQ7XG4gICAgICAgICAgLy8gRGlzcGF0Y2ggdGhlIGV4Y2VwdGlvbiBieSBsb29waW5nIGJhY2sgYXJvdW5kIHRvIHRoZVxuICAgICAgICAgIC8vIGNvbnRleHQuZGlzcGF0Y2hFeGNlcHRpb24oY29udGV4dC5hcmcpIGNhbGwgYWJvdmUuXG4gICAgICAgICAgY29udGV4dC5tZXRob2QgPSBcInRocm93XCI7XG4gICAgICAgICAgY29udGV4dC5hcmcgPSByZWNvcmQuYXJnO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIENhbGwgZGVsZWdhdGUuaXRlcmF0b3JbY29udGV4dC5tZXRob2RdKGNvbnRleHQuYXJnKSBhbmQgaGFuZGxlIHRoZVxuICAvLyByZXN1bHQsIGVpdGhlciBieSByZXR1cm5pbmcgYSB7IHZhbHVlLCBkb25lIH0gcmVzdWx0IGZyb20gdGhlXG4gIC8vIGRlbGVnYXRlIGl0ZXJhdG9yLCBvciBieSBtb2RpZnlpbmcgY29udGV4dC5tZXRob2QgYW5kIGNvbnRleHQuYXJnLFxuICAvLyBzZXR0aW5nIGNvbnRleHQuZGVsZWdhdGUgdG8gbnVsbCwgYW5kIHJldHVybmluZyB0aGUgQ29udGludWVTZW50aW5lbC5cbiAgZnVuY3Rpb24gbWF5YmVJbnZva2VEZWxlZ2F0ZShkZWxlZ2F0ZSwgY29udGV4dCkge1xuICAgIHZhciBtZXRob2QgPSBkZWxlZ2F0ZS5pdGVyYXRvcltjb250ZXh0Lm1ldGhvZF07XG4gICAgaWYgKG1ldGhvZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBBIC50aHJvdyBvciAucmV0dXJuIHdoZW4gdGhlIGRlbGVnYXRlIGl0ZXJhdG9yIGhhcyBubyAudGhyb3dcbiAgICAgIC8vIG1ldGhvZCBhbHdheXMgdGVybWluYXRlcyB0aGUgeWllbGQqIGxvb3AuXG4gICAgICBjb250ZXh0LmRlbGVnYXRlID0gbnVsbDtcblxuICAgICAgaWYgKGNvbnRleHQubWV0aG9kID09PSBcInRocm93XCIpIHtcbiAgICAgICAgLy8gTm90ZTogW1wicmV0dXJuXCJdIG11c3QgYmUgdXNlZCBmb3IgRVMzIHBhcnNpbmcgY29tcGF0aWJpbGl0eS5cbiAgICAgICAgaWYgKGRlbGVnYXRlLml0ZXJhdG9yW1wicmV0dXJuXCJdKSB7XG4gICAgICAgICAgLy8gSWYgdGhlIGRlbGVnYXRlIGl0ZXJhdG9yIGhhcyBhIHJldHVybiBtZXRob2QsIGdpdmUgaXQgYVxuICAgICAgICAgIC8vIGNoYW5jZSB0byBjbGVhbiB1cC5cbiAgICAgICAgICBjb250ZXh0Lm1ldGhvZCA9IFwicmV0dXJuXCI7XG4gICAgICAgICAgY29udGV4dC5hcmcgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgbWF5YmVJbnZva2VEZWxlZ2F0ZShkZWxlZ2F0ZSwgY29udGV4dCk7XG5cbiAgICAgICAgICBpZiAoY29udGV4dC5tZXRob2QgPT09IFwidGhyb3dcIikge1xuICAgICAgICAgICAgLy8gSWYgbWF5YmVJbnZva2VEZWxlZ2F0ZShjb250ZXh0KSBjaGFuZ2VkIGNvbnRleHQubWV0aG9kIGZyb21cbiAgICAgICAgICAgIC8vIFwicmV0dXJuXCIgdG8gXCJ0aHJvd1wiLCBsZXQgdGhhdCBvdmVycmlkZSB0aGUgVHlwZUVycm9yIGJlbG93LlxuICAgICAgICAgICAgcmV0dXJuIENvbnRpbnVlU2VudGluZWw7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGV4dC5tZXRob2QgPSBcInRocm93XCI7XG4gICAgICAgIGNvbnRleHQuYXJnID0gbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBcIlRoZSBpdGVyYXRvciBkb2VzIG5vdCBwcm92aWRlIGEgJ3Rocm93JyBtZXRob2RcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICAgIH1cblxuICAgIHZhciByZWNvcmQgPSB0cnlDYXRjaChtZXRob2QsIGRlbGVnYXRlLml0ZXJhdG9yLCBjb250ZXh0LmFyZyk7XG5cbiAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwidGhyb3dcIikge1xuICAgICAgY29udGV4dC5tZXRob2QgPSBcInRocm93XCI7XG4gICAgICBjb250ZXh0LmFyZyA9IHJlY29yZC5hcmc7XG4gICAgICBjb250ZXh0LmRlbGVnYXRlID0gbnVsbDtcbiAgICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICAgIH1cblxuICAgIHZhciBpbmZvID0gcmVjb3JkLmFyZztcblxuICAgIGlmICghIGluZm8pIHtcbiAgICAgIGNvbnRleHQubWV0aG9kID0gXCJ0aHJvd1wiO1xuICAgICAgY29udGV4dC5hcmcgPSBuZXcgVHlwZUVycm9yKFwiaXRlcmF0b3IgcmVzdWx0IGlzIG5vdCBhbiBvYmplY3RcIik7XG4gICAgICBjb250ZXh0LmRlbGVnYXRlID0gbnVsbDtcbiAgICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICAgIH1cblxuICAgIGlmIChpbmZvLmRvbmUpIHtcbiAgICAgIC8vIEFzc2lnbiB0aGUgcmVzdWx0IG9mIHRoZSBmaW5pc2hlZCBkZWxlZ2F0ZSB0byB0aGUgdGVtcG9yYXJ5XG4gICAgICAvLyB2YXJpYWJsZSBzcGVjaWZpZWQgYnkgZGVsZWdhdGUucmVzdWx0TmFtZSAoc2VlIGRlbGVnYXRlWWllbGQpLlxuICAgICAgY29udGV4dFtkZWxlZ2F0ZS5yZXN1bHROYW1lXSA9IGluZm8udmFsdWU7XG5cbiAgICAgIC8vIFJlc3VtZSBleGVjdXRpb24gYXQgdGhlIGRlc2lyZWQgbG9jYXRpb24gKHNlZSBkZWxlZ2F0ZVlpZWxkKS5cbiAgICAgIGNvbnRleHQubmV4dCA9IGRlbGVnYXRlLm5leHRMb2M7XG5cbiAgICAgIC8vIElmIGNvbnRleHQubWV0aG9kIHdhcyBcInRocm93XCIgYnV0IHRoZSBkZWxlZ2F0ZSBoYW5kbGVkIHRoZVxuICAgICAgLy8gZXhjZXB0aW9uLCBsZXQgdGhlIG91dGVyIGdlbmVyYXRvciBwcm9jZWVkIG5vcm1hbGx5LiBJZlxuICAgICAgLy8gY29udGV4dC5tZXRob2Qgd2FzIFwibmV4dFwiLCBmb3JnZXQgY29udGV4dC5hcmcgc2luY2UgaXQgaGFzIGJlZW5cbiAgICAgIC8vIFwiY29uc3VtZWRcIiBieSB0aGUgZGVsZWdhdGUgaXRlcmF0b3IuIElmIGNvbnRleHQubWV0aG9kIHdhc1xuICAgICAgLy8gXCJyZXR1cm5cIiwgYWxsb3cgdGhlIG9yaWdpbmFsIC5yZXR1cm4gY2FsbCB0byBjb250aW51ZSBpbiB0aGVcbiAgICAgIC8vIG91dGVyIGdlbmVyYXRvci5cbiAgICAgIGlmIChjb250ZXh0Lm1ldGhvZCAhPT0gXCJyZXR1cm5cIikge1xuICAgICAgICBjb250ZXh0Lm1ldGhvZCA9IFwibmV4dFwiO1xuICAgICAgICBjb250ZXh0LmFyZyA9IHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZS15aWVsZCB0aGUgcmVzdWx0IHJldHVybmVkIGJ5IHRoZSBkZWxlZ2F0ZSBtZXRob2QuXG4gICAgICByZXR1cm4gaW5mbztcbiAgICB9XG5cbiAgICAvLyBUaGUgZGVsZWdhdGUgaXRlcmF0b3IgaXMgZmluaXNoZWQsIHNvIGZvcmdldCBpdCBhbmQgY29udGludWUgd2l0aFxuICAgIC8vIHRoZSBvdXRlciBnZW5lcmF0b3IuXG4gICAgY29udGV4dC5kZWxlZ2F0ZSA9IG51bGw7XG4gICAgcmV0dXJuIENvbnRpbnVlU2VudGluZWw7XG4gIH1cblxuICAvLyBEZWZpbmUgR2VuZXJhdG9yLnByb3RvdHlwZS57bmV4dCx0aHJvdyxyZXR1cm59IGluIHRlcm1zIG9mIHRoZVxuICAvLyB1bmlmaWVkIC5faW52b2tlIGhlbHBlciBtZXRob2QuXG4gIGRlZmluZUl0ZXJhdG9yTWV0aG9kcyhHcCk7XG5cbiAgZGVmaW5lKEdwLCB0b1N0cmluZ1RhZ1N5bWJvbCwgXCJHZW5lcmF0b3JcIik7XG5cbiAgLy8gQSBHZW5lcmF0b3Igc2hvdWxkIGFsd2F5cyByZXR1cm4gaXRzZWxmIGFzIHRoZSBpdGVyYXRvciBvYmplY3Qgd2hlbiB0aGVcbiAgLy8gQEBpdGVyYXRvciBmdW5jdGlvbiBpcyBjYWxsZWQgb24gaXQuIFNvbWUgYnJvd3NlcnMnIGltcGxlbWVudGF0aW9ucyBvZiB0aGVcbiAgLy8gaXRlcmF0b3IgcHJvdG90eXBlIGNoYWluIGluY29ycmVjdGx5IGltcGxlbWVudCB0aGlzLCBjYXVzaW5nIHRoZSBHZW5lcmF0b3JcbiAgLy8gb2JqZWN0IHRvIG5vdCBiZSByZXR1cm5lZCBmcm9tIHRoaXMgY2FsbC4gVGhpcyBlbnN1cmVzIHRoYXQgZG9lc24ndCBoYXBwZW4uXG4gIC8vIFNlZSBodHRwczovL2dpdGh1Yi5jb20vZmFjZWJvb2svcmVnZW5lcmF0b3IvaXNzdWVzLzI3NCBmb3IgbW9yZSBkZXRhaWxzLlxuICBHcFtpdGVyYXRvclN5bWJvbF0gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcblxuICBHcC50b1N0cmluZyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBcIltvYmplY3QgR2VuZXJhdG9yXVwiO1xuICB9O1xuXG4gIGZ1bmN0aW9uIHB1c2hUcnlFbnRyeShsb2NzKSB7XG4gICAgdmFyIGVudHJ5ID0geyB0cnlMb2M6IGxvY3NbMF0gfTtcblxuICAgIGlmICgxIGluIGxvY3MpIHtcbiAgICAgIGVudHJ5LmNhdGNoTG9jID0gbG9jc1sxXTtcbiAgICB9XG5cbiAgICBpZiAoMiBpbiBsb2NzKSB7XG4gICAgICBlbnRyeS5maW5hbGx5TG9jID0gbG9jc1syXTtcbiAgICAgIGVudHJ5LmFmdGVyTG9jID0gbG9jc1szXTtcbiAgICB9XG5cbiAgICB0aGlzLnRyeUVudHJpZXMucHVzaChlbnRyeSk7XG4gIH1cblxuICBmdW5jdGlvbiByZXNldFRyeUVudHJ5KGVudHJ5KSB7XG4gICAgdmFyIHJlY29yZCA9IGVudHJ5LmNvbXBsZXRpb24gfHwge307XG4gICAgcmVjb3JkLnR5cGUgPSBcIm5vcm1hbFwiO1xuICAgIGRlbGV0ZSByZWNvcmQuYXJnO1xuICAgIGVudHJ5LmNvbXBsZXRpb24gPSByZWNvcmQ7XG4gIH1cblxuICBmdW5jdGlvbiBDb250ZXh0KHRyeUxvY3NMaXN0KSB7XG4gICAgLy8gVGhlIHJvb3QgZW50cnkgb2JqZWN0IChlZmZlY3RpdmVseSBhIHRyeSBzdGF0ZW1lbnQgd2l0aG91dCBhIGNhdGNoXG4gICAgLy8gb3IgYSBmaW5hbGx5IGJsb2NrKSBnaXZlcyB1cyBhIHBsYWNlIHRvIHN0b3JlIHZhbHVlcyB0aHJvd24gZnJvbVxuICAgIC8vIGxvY2F0aW9ucyB3aGVyZSB0aGVyZSBpcyBubyBlbmNsb3NpbmcgdHJ5IHN0YXRlbWVudC5cbiAgICB0aGlzLnRyeUVudHJpZXMgPSBbeyB0cnlMb2M6IFwicm9vdFwiIH1dO1xuICAgIHRyeUxvY3NMaXN0LmZvckVhY2gocHVzaFRyeUVudHJ5LCB0aGlzKTtcbiAgICB0aGlzLnJlc2V0KHRydWUpO1xuICB9XG5cbiAgZXhwb3J0cy5rZXlzID0gZnVuY3Rpb24ob2JqZWN0KSB7XG4gICAgdmFyIGtleXMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqZWN0KSB7XG4gICAgICBrZXlzLnB1c2goa2V5KTtcbiAgICB9XG4gICAga2V5cy5yZXZlcnNlKCk7XG5cbiAgICAvLyBSYXRoZXIgdGhhbiByZXR1cm5pbmcgYW4gb2JqZWN0IHdpdGggYSBuZXh0IG1ldGhvZCwgd2Uga2VlcFxuICAgIC8vIHRoaW5ncyBzaW1wbGUgYW5kIHJldHVybiB0aGUgbmV4dCBmdW5jdGlvbiBpdHNlbGYuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIG5leHQoKSB7XG4gICAgICB3aGlsZSAoa2V5cy5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGtleSA9IGtleXMucG9wKCk7XG4gICAgICAgIGlmIChrZXkgaW4gb2JqZWN0KSB7XG4gICAgICAgICAgbmV4dC52YWx1ZSA9IGtleTtcbiAgICAgICAgICBuZXh0LmRvbmUgPSBmYWxzZTtcbiAgICAgICAgICByZXR1cm4gbmV4dDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBUbyBhdm9pZCBjcmVhdGluZyBhbiBhZGRpdGlvbmFsIG9iamVjdCwgd2UganVzdCBoYW5nIHRoZSAudmFsdWVcbiAgICAgIC8vIGFuZCAuZG9uZSBwcm9wZXJ0aWVzIG9mZiB0aGUgbmV4dCBmdW5jdGlvbiBvYmplY3QgaXRzZWxmLiBUaGlzXG4gICAgICAvLyBhbHNvIGVuc3VyZXMgdGhhdCB0aGUgbWluaWZpZXIgd2lsbCBub3QgYW5vbnltaXplIHRoZSBmdW5jdGlvbi5cbiAgICAgIG5leHQuZG9uZSA9IHRydWU7XG4gICAgICByZXR1cm4gbmV4dDtcbiAgICB9O1xuICB9O1xuXG4gIGZ1bmN0aW9uIHZhbHVlcyhpdGVyYWJsZSkge1xuICAgIGlmIChpdGVyYWJsZSkge1xuICAgICAgdmFyIGl0ZXJhdG9yTWV0aG9kID0gaXRlcmFibGVbaXRlcmF0b3JTeW1ib2xdO1xuICAgICAgaWYgKGl0ZXJhdG9yTWV0aG9kKSB7XG4gICAgICAgIHJldHVybiBpdGVyYXRvck1ldGhvZC5jYWxsKGl0ZXJhYmxlKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVvZiBpdGVyYWJsZS5uZXh0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIGl0ZXJhYmxlO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWlzTmFOKGl0ZXJhYmxlLmxlbmd0aCkpIHtcbiAgICAgICAgdmFyIGkgPSAtMSwgbmV4dCA9IGZ1bmN0aW9uIG5leHQoKSB7XG4gICAgICAgICAgd2hpbGUgKCsraSA8IGl0ZXJhYmxlLmxlbmd0aCkge1xuICAgICAgICAgICAgaWYgKGhhc093bi5jYWxsKGl0ZXJhYmxlLCBpKSkge1xuICAgICAgICAgICAgICBuZXh0LnZhbHVlID0gaXRlcmFibGVbaV07XG4gICAgICAgICAgICAgIG5leHQuZG9uZSA9IGZhbHNlO1xuICAgICAgICAgICAgICByZXR1cm4gbmV4dDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBuZXh0LnZhbHVlID0gdW5kZWZpbmVkO1xuICAgICAgICAgIG5leHQuZG9uZSA9IHRydWU7XG5cbiAgICAgICAgICByZXR1cm4gbmV4dDtcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gbmV4dC5uZXh0ID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXR1cm4gYW4gaXRlcmF0b3Igd2l0aCBubyB2YWx1ZXMuXG4gICAgcmV0dXJuIHsgbmV4dDogZG9uZVJlc3VsdCB9O1xuICB9XG4gIGV4cG9ydHMudmFsdWVzID0gdmFsdWVzO1xuXG4gIGZ1bmN0aW9uIGRvbmVSZXN1bHQoKSB7XG4gICAgcmV0dXJuIHsgdmFsdWU6IHVuZGVmaW5lZCwgZG9uZTogdHJ1ZSB9O1xuICB9XG5cbiAgQ29udGV4dC5wcm90b3R5cGUgPSB7XG4gICAgY29uc3RydWN0b3I6IENvbnRleHQsXG5cbiAgICByZXNldDogZnVuY3Rpb24oc2tpcFRlbXBSZXNldCkge1xuICAgICAgdGhpcy5wcmV2ID0gMDtcbiAgICAgIHRoaXMubmV4dCA9IDA7XG4gICAgICAvLyBSZXNldHRpbmcgY29udGV4dC5fc2VudCBmb3IgbGVnYWN5IHN1cHBvcnQgb2YgQmFiZWwnc1xuICAgICAgLy8gZnVuY3Rpb24uc2VudCBpbXBsZW1lbnRhdGlvbi5cbiAgICAgIHRoaXMuc2VudCA9IHRoaXMuX3NlbnQgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLmRvbmUgPSBmYWxzZTtcbiAgICAgIHRoaXMuZGVsZWdhdGUgPSBudWxsO1xuXG4gICAgICB0aGlzLm1ldGhvZCA9IFwibmV4dFwiO1xuICAgICAgdGhpcy5hcmcgPSB1bmRlZmluZWQ7XG5cbiAgICAgIHRoaXMudHJ5RW50cmllcy5mb3JFYWNoKHJlc2V0VHJ5RW50cnkpO1xuXG4gICAgICBpZiAoIXNraXBUZW1wUmVzZXQpIHtcbiAgICAgICAgZm9yICh2YXIgbmFtZSBpbiB0aGlzKSB7XG4gICAgICAgICAgLy8gTm90IHN1cmUgYWJvdXQgdGhlIG9wdGltYWwgb3JkZXIgb2YgdGhlc2UgY29uZGl0aW9uczpcbiAgICAgICAgICBpZiAobmFtZS5jaGFyQXQoMCkgPT09IFwidFwiICYmXG4gICAgICAgICAgICAgIGhhc093bi5jYWxsKHRoaXMsIG5hbWUpICYmXG4gICAgICAgICAgICAgICFpc05hTigrbmFtZS5zbGljZSgxKSkpIHtcbiAgICAgICAgICAgIHRoaXNbbmFtZV0gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5kb25lID0gdHJ1ZTtcblxuICAgICAgdmFyIHJvb3RFbnRyeSA9IHRoaXMudHJ5RW50cmllc1swXTtcbiAgICAgIHZhciByb290UmVjb3JkID0gcm9vdEVudHJ5LmNvbXBsZXRpb247XG4gICAgICBpZiAocm9vdFJlY29yZC50eXBlID09PSBcInRocm93XCIpIHtcbiAgICAgICAgdGhyb3cgcm9vdFJlY29yZC5hcmc7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLnJ2YWw7XG4gICAgfSxcblxuICAgIGRpc3BhdGNoRXhjZXB0aW9uOiBmdW5jdGlvbihleGNlcHRpb24pIHtcbiAgICAgIGlmICh0aGlzLmRvbmUpIHtcbiAgICAgICAgdGhyb3cgZXhjZXB0aW9uO1xuICAgICAgfVxuXG4gICAgICB2YXIgY29udGV4dCA9IHRoaXM7XG4gICAgICBmdW5jdGlvbiBoYW5kbGUobG9jLCBjYXVnaHQpIHtcbiAgICAgICAgcmVjb3JkLnR5cGUgPSBcInRocm93XCI7XG4gICAgICAgIHJlY29yZC5hcmcgPSBleGNlcHRpb247XG4gICAgICAgIGNvbnRleHQubmV4dCA9IGxvYztcblxuICAgICAgICBpZiAoY2F1Z2h0KSB7XG4gICAgICAgICAgLy8gSWYgdGhlIGRpc3BhdGNoZWQgZXhjZXB0aW9uIHdhcyBjYXVnaHQgYnkgYSBjYXRjaCBibG9jayxcbiAgICAgICAgICAvLyB0aGVuIGxldCB0aGF0IGNhdGNoIGJsb2NrIGhhbmRsZSB0aGUgZXhjZXB0aW9uIG5vcm1hbGx5LlxuICAgICAgICAgIGNvbnRleHQubWV0aG9kID0gXCJuZXh0XCI7XG4gICAgICAgICAgY29udGV4dC5hcmcgPSB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gISEgY2F1Z2h0O1xuICAgICAgfVxuXG4gICAgICBmb3IgKHZhciBpID0gdGhpcy50cnlFbnRyaWVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICAgIHZhciBlbnRyeSA9IHRoaXMudHJ5RW50cmllc1tpXTtcbiAgICAgICAgdmFyIHJlY29yZCA9IGVudHJ5LmNvbXBsZXRpb247XG5cbiAgICAgICAgaWYgKGVudHJ5LnRyeUxvYyA9PT0gXCJyb290XCIpIHtcbiAgICAgICAgICAvLyBFeGNlcHRpb24gdGhyb3duIG91dHNpZGUgb2YgYW55IHRyeSBibG9jayB0aGF0IGNvdWxkIGhhbmRsZVxuICAgICAgICAgIC8vIGl0LCBzbyBzZXQgdGhlIGNvbXBsZXRpb24gdmFsdWUgb2YgdGhlIGVudGlyZSBmdW5jdGlvbiB0b1xuICAgICAgICAgIC8vIHRocm93IHRoZSBleGNlcHRpb24uXG4gICAgICAgICAgcmV0dXJuIGhhbmRsZShcImVuZFwiKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlbnRyeS50cnlMb2MgPD0gdGhpcy5wcmV2KSB7XG4gICAgICAgICAgdmFyIGhhc0NhdGNoID0gaGFzT3duLmNhbGwoZW50cnksIFwiY2F0Y2hMb2NcIik7XG4gICAgICAgICAgdmFyIGhhc0ZpbmFsbHkgPSBoYXNPd24uY2FsbChlbnRyeSwgXCJmaW5hbGx5TG9jXCIpO1xuXG4gICAgICAgICAgaWYgKGhhc0NhdGNoICYmIGhhc0ZpbmFsbHkpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnByZXYgPCBlbnRyeS5jYXRjaExvYykge1xuICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlKGVudHJ5LmNhdGNoTG9jLCB0cnVlKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5wcmV2IDwgZW50cnkuZmluYWxseUxvYykge1xuICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlKGVudHJ5LmZpbmFsbHlMb2MpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgfSBlbHNlIGlmIChoYXNDYXRjaCkge1xuICAgICAgICAgICAgaWYgKHRoaXMucHJldiA8IGVudHJ5LmNhdGNoTG9jKSB7XG4gICAgICAgICAgICAgIHJldHVybiBoYW5kbGUoZW50cnkuY2F0Y2hMb2MsIHRydWUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgfSBlbHNlIGlmIChoYXNGaW5hbGx5KSB7XG4gICAgICAgICAgICBpZiAodGhpcy5wcmV2IDwgZW50cnkuZmluYWxseUxvYykge1xuICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlKGVudHJ5LmZpbmFsbHlMb2MpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInRyeSBzdGF0ZW1lbnQgd2l0aG91dCBjYXRjaCBvciBmaW5hbGx5XCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBhYnJ1cHQ6IGZ1bmN0aW9uKHR5cGUsIGFyZykge1xuICAgICAgZm9yICh2YXIgaSA9IHRoaXMudHJ5RW50cmllcy5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgICAgICB2YXIgZW50cnkgPSB0aGlzLnRyeUVudHJpZXNbaV07XG4gICAgICAgIGlmIChlbnRyeS50cnlMb2MgPD0gdGhpcy5wcmV2ICYmXG4gICAgICAgICAgICBoYXNPd24uY2FsbChlbnRyeSwgXCJmaW5hbGx5TG9jXCIpICYmXG4gICAgICAgICAgICB0aGlzLnByZXYgPCBlbnRyeS5maW5hbGx5TG9jKSB7XG4gICAgICAgICAgdmFyIGZpbmFsbHlFbnRyeSA9IGVudHJ5O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChmaW5hbGx5RW50cnkgJiZcbiAgICAgICAgICAodHlwZSA9PT0gXCJicmVha1wiIHx8XG4gICAgICAgICAgIHR5cGUgPT09IFwiY29udGludWVcIikgJiZcbiAgICAgICAgICBmaW5hbGx5RW50cnkudHJ5TG9jIDw9IGFyZyAmJlxuICAgICAgICAgIGFyZyA8PSBmaW5hbGx5RW50cnkuZmluYWxseUxvYykge1xuICAgICAgICAvLyBJZ25vcmUgdGhlIGZpbmFsbHkgZW50cnkgaWYgY29udHJvbCBpcyBub3QganVtcGluZyB0byBhXG4gICAgICAgIC8vIGxvY2F0aW9uIG91dHNpZGUgdGhlIHRyeS9jYXRjaCBibG9jay5cbiAgICAgICAgZmluYWxseUVudHJ5ID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgdmFyIHJlY29yZCA9IGZpbmFsbHlFbnRyeSA/IGZpbmFsbHlFbnRyeS5jb21wbGV0aW9uIDoge307XG4gICAgICByZWNvcmQudHlwZSA9IHR5cGU7XG4gICAgICByZWNvcmQuYXJnID0gYXJnO1xuXG4gICAgICBpZiAoZmluYWxseUVudHJ5KSB7XG4gICAgICAgIHRoaXMubWV0aG9kID0gXCJuZXh0XCI7XG4gICAgICAgIHRoaXMubmV4dCA9IGZpbmFsbHlFbnRyeS5maW5hbGx5TG9jO1xuICAgICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRoaXMuY29tcGxldGUocmVjb3JkKTtcbiAgICB9LFxuXG4gICAgY29tcGxldGU6IGZ1bmN0aW9uKHJlY29yZCwgYWZ0ZXJMb2MpIHtcbiAgICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJ0aHJvd1wiKSB7XG4gICAgICAgIHRocm93IHJlY29yZC5hcmc7XG4gICAgICB9XG5cbiAgICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJicmVha1wiIHx8XG4gICAgICAgICAgcmVjb3JkLnR5cGUgPT09IFwiY29udGludWVcIikge1xuICAgICAgICB0aGlzLm5leHQgPSByZWNvcmQuYXJnO1xuICAgICAgfSBlbHNlIGlmIChyZWNvcmQudHlwZSA9PT0gXCJyZXR1cm5cIikge1xuICAgICAgICB0aGlzLnJ2YWwgPSB0aGlzLmFyZyA9IHJlY29yZC5hcmc7XG4gICAgICAgIHRoaXMubWV0aG9kID0gXCJyZXR1cm5cIjtcbiAgICAgICAgdGhpcy5uZXh0ID0gXCJlbmRcIjtcbiAgICAgIH0gZWxzZSBpZiAocmVjb3JkLnR5cGUgPT09IFwibm9ybWFsXCIgJiYgYWZ0ZXJMb2MpIHtcbiAgICAgICAgdGhpcy5uZXh0ID0gYWZ0ZXJMb2M7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICAgIH0sXG5cbiAgICBmaW5pc2g6IGZ1bmN0aW9uKGZpbmFsbHlMb2MpIHtcbiAgICAgIGZvciAodmFyIGkgPSB0aGlzLnRyeUVudHJpZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgICAgdmFyIGVudHJ5ID0gdGhpcy50cnlFbnRyaWVzW2ldO1xuICAgICAgICBpZiAoZW50cnkuZmluYWxseUxvYyA9PT0gZmluYWxseUxvYykge1xuICAgICAgICAgIHRoaXMuY29tcGxldGUoZW50cnkuY29tcGxldGlvbiwgZW50cnkuYWZ0ZXJMb2MpO1xuICAgICAgICAgIHJlc2V0VHJ5RW50cnkoZW50cnkpO1xuICAgICAgICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIFwiY2F0Y2hcIjogZnVuY3Rpb24odHJ5TG9jKSB7XG4gICAgICBmb3IgKHZhciBpID0gdGhpcy50cnlFbnRyaWVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICAgIHZhciBlbnRyeSA9IHRoaXMudHJ5RW50cmllc1tpXTtcbiAgICAgICAgaWYgKGVudHJ5LnRyeUxvYyA9PT0gdHJ5TG9jKSB7XG4gICAgICAgICAgdmFyIHJlY29yZCA9IGVudHJ5LmNvbXBsZXRpb247XG4gICAgICAgICAgaWYgKHJlY29yZC50eXBlID09PSBcInRocm93XCIpIHtcbiAgICAgICAgICAgIHZhciB0aHJvd24gPSByZWNvcmQuYXJnO1xuICAgICAgICAgICAgcmVzZXRUcnlFbnRyeShlbnRyeSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aHJvd247XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVGhlIGNvbnRleHQuY2F0Y2ggbWV0aG9kIG11c3Qgb25seSBiZSBjYWxsZWQgd2l0aCBhIGxvY2F0aW9uXG4gICAgICAvLyBhcmd1bWVudCB0aGF0IGNvcnJlc3BvbmRzIHRvIGEga25vd24gY2F0Y2ggYmxvY2suXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJpbGxlZ2FsIGNhdGNoIGF0dGVtcHRcIik7XG4gICAgfSxcblxuICAgIGRlbGVnYXRlWWllbGQ6IGZ1bmN0aW9uKGl0ZXJhYmxlLCByZXN1bHROYW1lLCBuZXh0TG9jKSB7XG4gICAgICB0aGlzLmRlbGVnYXRlID0ge1xuICAgICAgICBpdGVyYXRvcjogdmFsdWVzKGl0ZXJhYmxlKSxcbiAgICAgICAgcmVzdWx0TmFtZTogcmVzdWx0TmFtZSxcbiAgICAgICAgbmV4dExvYzogbmV4dExvY1xuICAgICAgfTtcblxuICAgICAgaWYgKHRoaXMubWV0aG9kID09PSBcIm5leHRcIikge1xuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgZm9yZ2V0IHRoZSBsYXN0IHNlbnQgdmFsdWUgc28gdGhhdCB3ZSBkb24ndFxuICAgICAgICAvLyBhY2NpZGVudGFsbHkgcGFzcyBpdCBvbiB0byB0aGUgZGVsZWdhdGUuXG4gICAgICAgIHRoaXMuYXJnID0gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICB9XG4gIH07XG5cbiAgLy8gUmVnYXJkbGVzcyBvZiB3aGV0aGVyIHRoaXMgc2NyaXB0IGlzIGV4ZWN1dGluZyBhcyBhIENvbW1vbkpTIG1vZHVsZVxuICAvLyBvciBub3QsIHJldHVybiB0aGUgcnVudGltZSBvYmplY3Qgc28gdGhhdCB3ZSBjYW4gZGVjbGFyZSB0aGUgdmFyaWFibGVcbiAgLy8gcmVnZW5lcmF0b3JSdW50aW1lIGluIHRoZSBvdXRlciBzY29wZSwgd2hpY2ggYWxsb3dzIHRoaXMgbW9kdWxlIHRvIGJlXG4gIC8vIGluamVjdGVkIGVhc2lseSBieSBgYmluL3JlZ2VuZXJhdG9yIC0taW5jbHVkZS1ydW50aW1lIHNjcmlwdC5qc2AuXG4gIHJldHVybiBleHBvcnRzO1xuXG59KFxuICAvLyBJZiB0aGlzIHNjcmlwdCBpcyBleGVjdXRpbmcgYXMgYSBDb21tb25KUyBtb2R1bGUsIHVzZSBtb2R1bGUuZXhwb3J0c1xuICAvLyBhcyB0aGUgcmVnZW5lcmF0b3JSdW50aW1lIG5hbWVzcGFjZS4gT3RoZXJ3aXNlIGNyZWF0ZSBhIG5ldyBlbXB0eVxuICAvLyBvYmplY3QuIEVpdGhlciB3YXksIHRoZSByZXN1bHRpbmcgb2JqZWN0IHdpbGwgYmUgdXNlZCB0byBpbml0aWFsaXplXG4gIC8vIHRoZSByZWdlbmVyYXRvclJ1bnRpbWUgdmFyaWFibGUgYXQgdGhlIHRvcCBvZiB0aGlzIGZpbGUuXG4gIHR5cGVvZiBtb2R1bGUgPT09IFwib2JqZWN0XCIgPyBtb2R1bGUuZXhwb3J0cyA6IHt9XG4pKTtcblxudHJ5IHtcbiAgcmVnZW5lcmF0b3JSdW50aW1lID0gcnVudGltZTtcbn0gY2F0Y2ggKGFjY2lkZW50YWxTdHJpY3RNb2RlKSB7XG4gIC8vIFRoaXMgbW9kdWxlIHNob3VsZCBub3QgYmUgcnVubmluZyBpbiBzdHJpY3QgbW9kZSwgc28gdGhlIGFib3ZlXG4gIC8vIGFzc2lnbm1lbnQgc2hvdWxkIGFsd2F5cyB3b3JrIHVubGVzcyBzb21ldGhpbmcgaXMgbWlzY29uZmlndXJlZC4gSnVzdFxuICAvLyBpbiBjYXNlIHJ1bnRpbWUuanMgYWNjaWRlbnRhbGx5IHJ1bnMgaW4gc3RyaWN0IG1vZGUsIHdlIGNhbiBlc2NhcGVcbiAgLy8gc3RyaWN0IG1vZGUgdXNpbmcgYSBnbG9iYWwgRnVuY3Rpb24gY2FsbC4gVGhpcyBjb3VsZCBjb25jZWl2YWJseSBmYWlsXG4gIC8vIGlmIGEgQ29udGVudCBTZWN1cml0eSBQb2xpY3kgZm9yYmlkcyB1c2luZyBGdW5jdGlvbiwgYnV0IGluIHRoYXQgY2FzZVxuICAvLyB0aGUgcHJvcGVyIHNvbHV0aW9uIGlzIHRvIGZpeCB0aGUgYWNjaWRlbnRhbCBzdHJpY3QgbW9kZSBwcm9ibGVtLiBJZlxuICAvLyB5b3UndmUgbWlzY29uZmlndXJlZCB5b3VyIGJ1bmRsZXIgdG8gZm9yY2Ugc3RyaWN0IG1vZGUgYW5kIGFwcGxpZWQgYVxuICAvLyBDU1AgdG8gZm9yYmlkIEZ1bmN0aW9uLCBhbmQgeW91J3JlIG5vdCB3aWxsaW5nIHRvIGZpeCBlaXRoZXIgb2YgdGhvc2VcbiAgLy8gcHJvYmxlbXMsIHBsZWFzZSBkZXRhaWwgeW91ciB1bmlxdWUgcHJlZGljYW1lbnQgaW4gYSBHaXRIdWIgaXNzdWUuXG4gIEZ1bmN0aW9uKFwiclwiLCBcInJlZ2VuZXJhdG9yUnVudGltZSA9IHJcIikocnVudGltZSk7XG59XG4iLCJpbXBvcnQgJ3JlZ2VuZXJhdG9yLXJ1bnRpbWUvcnVudGltZSc7XHJcblxyXG5jb25zdCBvdXRwdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnYmxvY2snKVxyXG5cclxuXHJcbmNvbnN0IGdldERhdGEgPSBhc3luYyAoKSA9PiB7XHJcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCAoJ2h0dHBzOi8vanNvbnBsYWNlaG9sZGVyLnR5cGljb2RlLmNvbS90b2RvcycpXHJcbiAgICBjb25zdCBwYXJzZWRSZXMgPSBhd2FpdCByZXMuanNvbigpO1xyXG4gICBcclxuICAgb3V0cHV0LmlubmVySFRNTCA9IHBhcnNlZFJlcy5tYXAoKHt0aXRsZSwgaWR9KSA9PlxyXG4gICB7IHJldHVybiBgXHJcbiAgIDxkaXYgY2xhc3M9XCJjYXJkXCI+ICR7aWR9IDwvZGl2PlxyXG4gICA8cCBjbGFzcz1cImRlc2NcIj4ke3RpdGxlfTwvcD5gfSlcclxuICAgXHJcbiAgIFxyXG4gICAgLy9jb25zb2xlLmxvZyAocGFyc2VkUmVzKTtcclxuICAgIC8vZG9jdW1lbnQuYm9keS5pbm5lckhUTUwgPSBgPGgyPiR7cGFyc2VkUmVzLm9yaWdpbmFsX3RpdGxlfTwvaDI+PHA+JHtwYXJzZWRSZXMub3ZlcnZpZXd9PC9wPmBcclxuICAgIHJldHVybiBwYXJzZWRSZXM7XHJcbn1cclxuXHJcbmdldERhdGEgKClcclxuXHJcbi8vY29uc29sZS5sb2cgKGdldERhdGEpOyJdLCJwcmVFeGlzdGluZ0NvbW1lbnQiOiIvLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldD11dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJbTV2WkdWZmJXOWtkV3hsY3k5aWNtOTNjMlZ5TFhCaFkyc3ZYM0J5Wld4MVpHVXVhbk1pTENKdWIyUmxYMjF2WkhWc1pYTXZjbVZuWlc1bGNtRjBiM0l0Y25WdWRHbHRaUzl5ZFc1MGFXMWxMbXB6SWl3aWNISnZhbVZqZEhNdllXcGhlQzl6Y21NdmFuTXZZWEJ3TG1weklsMHNJbTVoYldWeklqcGJYU3dpYldGd2NHbHVaM01pT2lKQlFVRkJPMEZEUVVFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHM3T3p0QlF6VjFRa0U3T3pzN096dEJRVVZCTEVsQlFVMHNUVUZCVFN4SFFVRkhMRkZCUVZFc1EwRkJReXhqUVVGVUxFTkJRWGRDTEU5QlFYaENMRU5CUVdZN08wRkJSMEVzU1VGQlRTeFBRVUZQTzBGQlFVRXNjVVZCUVVjN1FVRkJRVHRCUVVGQk8wRkJRVUU3UVVGQlFUdEJRVUZCTzBGQlFVRTdRVUZCUVN4dFFrRkRUU3hMUVVGTExFTkJRVVVzTkVOQlFVWXNRMEZFV0RzN1FVRkJRVHRCUVVOT0xGbEJRVUVzUjBGRVRUdEJRVUZCTzBGQlFVRXNiVUpCUlZrc1IwRkJSeXhEUVVGRExFbEJRVW9zUlVGR1dqczdRVUZCUVR0QlFVVk9MRmxCUVVFc1UwRkdUVHRCUVVsaUxGbEJRVUVzVFVGQlRTeERRVUZETEZOQlFWQXNSMEZCYlVJc1UwRkJVeXhEUVVGRExFZEJRVllzUTBGQll5eHBRa0ZEYWtNN1FVRkJRU3hyUWtGRWJVTXNTMEZEYmtNc1UwRkViVU1zUzBGRGJrTTdRVUZCUVN4clFrRkVNRU1zUlVGRE1VTXNVMEZFTUVNc1JVRkRNVU03UVVGQlJTeDVSRUZEYlVJc1JVRkVia0lzTWtOQlJXZENMRXRCUm1oQ08wRkJSVFJDTEdGQlNGZ3NRMEZCYmtJc1EwRktZU3hEUVZWYU8wRkJRMEU3TzBGQldGa3NOa05CV1V3c1UwRmFTenM3UVVGQlFUdEJRVUZCTzBGQlFVRTdRVUZCUVR0QlFVRkJPMEZCUVVFN1FVRkJRU3hIUVVGSU96dEJRVUZCTEd0Q1FVRlFMRTlCUVU4N1FVRkJRVHRCUVVGQk8wRkJRVUVzUjBGQllqczdRVUZsUVN4UFFVRlBMRWNzUTBGRlVDSXNJbVpwYkdVaU9pSm5aVzVsY21GMFpXUXVhbk1pTENKemIzVnlZMlZTYjI5MElqb2lJaXdpYzI5MWNtTmxjME52Ym5SbGJuUWlPbHNpS0daMWJtTjBhVzl1S0NsN1puVnVZM1JwYjI0Z2NpaGxMRzRzZENsN1puVnVZM1JwYjI0Z2J5aHBMR1lwZTJsbUtDRnVXMmxkS1h0cFppZ2haVnRwWFNsN2RtRnlJR005WENKbWRXNWpkR2x2Ymx3aVBUMTBlWEJsYjJZZ2NtVnhkV2x5WlNZbWNtVnhkV2x5WlR0cFppZ2haaVltWXlseVpYUjFjbTRnWXlocExDRXdLVHRwWmloMUtYSmxkSFZ5YmlCMUtHa3NJVEFwTzNaaGNpQmhQVzVsZHlCRmNuSnZjaWhjSWtOaGJtNXZkQ0JtYVc1a0lHMXZaSFZzWlNBblhDSXJhU3RjSWlkY0lpazdkR2h5YjNjZ1lTNWpiMlJsUFZ3aVRVOUVWVXhGWDA1UFZGOUdUMVZPUkZ3aUxHRjlkbUZ5SUhBOWJsdHBYVDE3Wlhod2IzSjBjenA3ZlgwN1pWdHBYVnN3WFM1allXeHNLSEF1Wlhod2IzSjBjeXhtZFc1amRHbHZiaWh5S1h0MllYSWdiajFsVzJsZFd6RmRXM0pkTzNKbGRIVnliaUJ2S0c1OGZISXBmU3h3TEhBdVpYaHdiM0owY3l4eUxHVXNiaXgwS1gxeVpYUjFjbTRnYmx0cFhTNWxlSEJ2Y25SemZXWnZjaWgyWVhJZ2RUMWNJbVoxYm1OMGFXOXVYQ0k5UFhSNWNHVnZaaUJ5WlhGMWFYSmxKaVp5WlhGMWFYSmxMR2s5TUR0cFBIUXViR1Z1WjNSb08ya3JLeWx2S0hSYmFWMHBPM0psZEhWeWJpQnZmWEpsZEhWeWJpQnlmU2tvS1NJc0lpOHFLbHh1SUNvZ1EyOXdlWEpwWjJoMElDaGpLU0F5TURFMExYQnlaWE5sYm5Rc0lFWmhZMlZpYjI5ckxDQkpibU11WEc0Z0tseHVJQ29nVkdocGN5QnpiM1Z5WTJVZ1kyOWtaU0JwY3lCc2FXTmxibk5sWkNCMWJtUmxjaUIwYUdVZ1RVbFVJR3hwWTJWdWMyVWdabTkxYm1RZ2FXNGdkR2hsWEc0Z0tpQk1TVU5GVGxORklHWnBiR1VnYVc0Z2RHaGxJSEp2YjNRZ1pHbHlaV04wYjNKNUlHOW1JSFJvYVhNZ2MyOTFjbU5sSUhSeVpXVXVYRzRnS2k5Y2JseHVkbUZ5SUhKMWJuUnBiV1VnUFNBb1puVnVZM1JwYjI0Z0tHVjRjRzl5ZEhNcElIdGNiaUFnWENKMWMyVWdjM1J5YVdOMFhDSTdYRzVjYmlBZ2RtRnlJRTl3SUQwZ1QySnFaV04wTG5CeWIzUnZkSGx3WlR0Y2JpQWdkbUZ5SUdoaGMwOTNiaUE5SUU5d0xtaGhjMDkzYmxCeWIzQmxjblI1TzF4dUlDQjJZWElnZFc1a1pXWnBibVZrT3lBdkx5Qk5iM0psSUdOdmJYQnlaWE56YVdKc1pTQjBhR0Z1SUhadmFXUWdNQzVjYmlBZ2RtRnlJQ1JUZVcxaWIyd2dQU0IwZVhCbGIyWWdVM2x0WW05c0lEMDlQU0JjSW1aMWJtTjBhVzl1WENJZ1B5QlRlVzFpYjJ3Z09pQjdmVHRjYmlBZ2RtRnlJR2wwWlhKaGRHOXlVM2x0WW05c0lEMGdKRk41YldKdmJDNXBkR1Z5WVhSdmNpQjhmQ0JjSWtCQWFYUmxjbUYwYjNKY0lqdGNiaUFnZG1GeUlHRnplVzVqU1hSbGNtRjBiM0pUZVcxaWIyd2dQU0FrVTNsdFltOXNMbUZ6ZVc1alNYUmxjbUYwYjNJZ2ZId2dYQ0pBUUdGemVXNWpTWFJsY21GMGIzSmNJanRjYmlBZ2RtRnlJSFJ2VTNSeWFXNW5WR0ZuVTNsdFltOXNJRDBnSkZONWJXSnZiQzUwYjFOMGNtbHVaMVJoWnlCOGZDQmNJa0JBZEc5VGRISnBibWRVWVdkY0lqdGNibHh1SUNCbWRXNWpkR2x2YmlCa1pXWnBibVVvYjJKcUxDQnJaWGtzSUhaaGJIVmxLU0I3WEc0Z0lDQWdUMkpxWldOMExtUmxabWx1WlZCeWIzQmxjblI1S0c5aWFpd2dhMlY1TENCN1hHNGdJQ0FnSUNCMllXeDFaVG9nZG1Gc2RXVXNYRzRnSUNBZ0lDQmxiblZ0WlhKaFlteGxPaUIwY25WbExGeHVJQ0FnSUNBZ1kyOXVabWxuZFhKaFlteGxPaUIwY25WbExGeHVJQ0FnSUNBZ2QzSnBkR0ZpYkdVNklIUnlkV1ZjYmlBZ0lDQjlLVHRjYmlBZ0lDQnlaWFIxY200Z2IySnFXMnRsZVYwN1hHNGdJSDFjYmlBZ2RISjVJSHRjYmlBZ0lDQXZMeUJKUlNBNElHaGhjeUJoSUdKeWIydGxiaUJQWW1wbFkzUXVaR1ZtYVc1bFVISnZjR1Z5ZEhrZ2RHaGhkQ0J2Ym14NUlIZHZjbXR6SUc5dUlFUlBUU0J2WW1wbFkzUnpMbHh1SUNBZ0lHUmxabWx1WlNoN2ZTd2dYQ0pjSWlrN1hHNGdJSDBnWTJGMFkyZ2dLR1Z5Y2lrZ2UxeHVJQ0FnSUdSbFptbHVaU0E5SUdaMWJtTjBhVzl1S0c5aWFpd2dhMlY1TENCMllXeDFaU2tnZTF4dUlDQWdJQ0FnY21WMGRYSnVJRzlpYWx0clpYbGRJRDBnZG1Gc2RXVTdYRzRnSUNBZ2ZUdGNiaUFnZlZ4dVhHNGdJR1oxYm1OMGFXOXVJSGR5WVhBb2FXNXVaWEpHYml3Z2IzVjBaWEpHYml3Z2MyVnNaaXdnZEhKNVRHOWpjMHhwYzNRcElIdGNiaUFnSUNBdkx5QkpaaUJ2ZFhSbGNrWnVJSEJ5YjNacFpHVmtJR0Z1WkNCdmRYUmxja1p1TG5CeWIzUnZkSGx3WlNCcGN5QmhJRWRsYm1WeVlYUnZjaXdnZEdobGJpQnZkWFJsY2tadUxuQnliM1J2ZEhsd1pTQnBibk4wWVc1alpXOW1JRWRsYm1WeVlYUnZjaTVjYmlBZ0lDQjJZWElnY0hKdmRHOUhaVzVsY21GMGIzSWdQU0J2ZFhSbGNrWnVJQ1ltSUc5MWRHVnlSbTR1Y0hKdmRHOTBlWEJsSUdsdWMzUmhibU5sYjJZZ1IyVnVaWEpoZEc5eUlEOGdiM1YwWlhKR2JpQTZJRWRsYm1WeVlYUnZjanRjYmlBZ0lDQjJZWElnWjJWdVpYSmhkRzl5SUQwZ1QySnFaV04wTG1OeVpXRjBaU2h3Y205MGIwZGxibVZ5WVhSdmNpNXdjbTkwYjNSNWNHVXBPMXh1SUNBZ0lIWmhjaUJqYjI1MFpYaDBJRDBnYm1WM0lFTnZiblJsZUhRb2RISjVURzlqYzB4cGMzUWdmSHdnVzEwcE8xeHVYRzRnSUNBZ0x5OGdWR2hsSUM1ZmFXNTJiMnRsSUcxbGRHaHZaQ0IxYm1sbWFXVnpJSFJvWlNCcGJYQnNaVzFsYm5SaGRHbHZibk1nYjJZZ2RHaGxJQzV1WlhoMExGeHVJQ0FnSUM4dklDNTBhSEp2ZHl3Z1lXNWtJQzV5WlhSMWNtNGdiV1YwYUc5a2N5NWNiaUFnSUNCblpXNWxjbUYwYjNJdVgybHVkbTlyWlNBOUlHMWhhMlZKYm5admEyVk5aWFJvYjJRb2FXNXVaWEpHYml3Z2MyVnNaaXdnWTI5dWRHVjRkQ2s3WEc1Y2JpQWdJQ0J5WlhSMWNtNGdaMlZ1WlhKaGRHOXlPMXh1SUNCOVhHNGdJR1Y0Y0c5eWRITXVkM0poY0NBOUlIZHlZWEE3WEc1Y2JpQWdMeThnVkhKNUwyTmhkR05vSUdobGJIQmxjaUIwYnlCdGFXNXBiV2w2WlNCa1pXOXdkR2x0YVhwaGRHbHZibk11SUZKbGRIVnlibk1nWVNCamIyMXdiR1YwYVc5dVhHNGdJQzh2SUhKbFkyOXlaQ0JzYVd0bElHTnZiblJsZUhRdWRISjVSVzUwY21sbGMxdHBYUzVqYjIxd2JHVjBhVzl1TGlCVWFHbHpJR2x1ZEdWeVptRmpaU0JqYjNWc1pGeHVJQ0F2THlCb1lYWmxJR0psWlc0Z0tHRnVaQ0IzWVhNZ2NISmxkbWx2ZFhOc2VTa2daR1Z6YVdkdVpXUWdkRzhnZEdGclpTQmhJR05zYjNOMWNtVWdkRzhnWW1WY2JpQWdMeThnYVc1MmIydGxaQ0IzYVhSb2IzVjBJR0Z5WjNWdFpXNTBjeXdnWW5WMElHbHVJR0ZzYkNCMGFHVWdZMkZ6WlhNZ2QyVWdZMkZ5WlNCaFltOTFkQ0IzWlZ4dUlDQXZMeUJoYkhKbFlXUjVJR2hoZG1VZ1lXNGdaWGhwYzNScGJtY2diV1YwYUc5a0lIZGxJSGRoYm5RZ2RHOGdZMkZzYkN3Z2MyOGdkR2hsY21VbmN5QnVieUJ1WldWa1hHNGdJQzh2SUhSdklHTnlaV0YwWlNCaElHNWxkeUJtZFc1amRHbHZiaUJ2WW1wbFkzUXVJRmRsSUdOaGJpQmxkbVZ1SUdkbGRDQmhkMkY1SUhkcGRHZ2dZWE56ZFcxcGJtZGNiaUFnTHk4Z2RHaGxJRzFsZEdodlpDQjBZV3RsY3lCbGVHRmpkR3g1SUc5dVpTQmhjbWQxYldWdWRDd2djMmx1WTJVZ2RHaGhkQ0JvWVhCd1pXNXpJSFJ2SUdKbElIUnlkV1ZjYmlBZ0x5OGdhVzRnWlhabGNua2dZMkZ6WlN3Z2MyOGdkMlVnWkc5dUozUWdhR0YyWlNCMGJ5QjBiM1ZqYUNCMGFHVWdZWEpuZFcxbGJuUnpJRzlpYW1WamRDNGdWR2hsWEc0Z0lDOHZJRzl1YkhrZ1lXUmthWFJwYjI1aGJDQmhiR3h2WTJGMGFXOXVJSEpsY1hWcGNtVmtJR2x6SUhSb1pTQmpiMjF3YkdWMGFXOXVJSEpsWTI5eVpDd2dkMmhwWTJoY2JpQWdMeThnYUdGeklHRWdjM1JoWW14bElITm9ZWEJsSUdGdVpDQnpieUJvYjNCbFpuVnNiSGtnYzJodmRXeGtJR0psSUdOb1pXRndJSFJ2SUdGc2JHOWpZWFJsTGx4dUlDQm1kVzVqZEdsdmJpQjBjbmxEWVhSamFDaG1iaXdnYjJKcUxDQmhjbWNwSUh0Y2JpQWdJQ0IwY25rZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1SUhzZ2RIbHdaVG9nWENKdWIzSnRZV3hjSWl3Z1lYSm5PaUJtYmk1allXeHNLRzlpYWl3Z1lYSm5LU0I5TzF4dUlDQWdJSDBnWTJGMFkyZ2dLR1Z5Y2lrZ2UxeHVJQ0FnSUNBZ2NtVjBkWEp1SUhzZ2RIbHdaVG9nWENKMGFISnZkMXdpTENCaGNtYzZJR1Z5Y2lCOU8xeHVJQ0FnSUgxY2JpQWdmVnh1WEc0Z0lIWmhjaUJIWlc1VGRHRjBaVk4xYzNCbGJtUmxaRk4wWVhKMElEMGdYQ0p6ZFhOd1pXNWtaV1JUZEdGeWRGd2lPMXh1SUNCMllYSWdSMlZ1VTNSaGRHVlRkWE53Wlc1a1pXUlphV1ZzWkNBOUlGd2ljM1Z6Y0dWdVpHVmtXV2xsYkdSY0lqdGNiaUFnZG1GeUlFZGxibE4wWVhSbFJYaGxZM1YwYVc1bklEMGdYQ0psZUdWamRYUnBibWRjSWp0Y2JpQWdkbUZ5SUVkbGJsTjBZWFJsUTI5dGNHeGxkR1ZrSUQwZ1hDSmpiMjF3YkdWMFpXUmNJanRjYmx4dUlDQXZMeUJTWlhSMWNtNXBibWNnZEdocGN5QnZZbXBsWTNRZ1puSnZiU0IwYUdVZ2FXNXVaWEpHYmlCb1lYTWdkR2hsSUhOaGJXVWdaV1ptWldOMElHRnpYRzRnSUM4dklHSnlaV0ZyYVc1bklHOTFkQ0J2WmlCMGFHVWdaR2x6Y0dGMFkyZ2djM2RwZEdOb0lITjBZWFJsYldWdWRDNWNiaUFnZG1GeUlFTnZiblJwYm5WbFUyVnVkR2x1Wld3Z1BTQjdmVHRjYmx4dUlDQXZMeUJFZFcxdGVTQmpiMjV6ZEhKMVkzUnZjaUJtZFc1amRHbHZibk1nZEdoaGRDQjNaU0IxYzJVZ1lYTWdkR2hsSUM1amIyNXpkSEoxWTNSdmNpQmhibVJjYmlBZ0x5OGdMbU52Ym5OMGNuVmpkRzl5TG5CeWIzUnZkSGx3WlNCd2NtOXdaWEowYVdWeklHWnZjaUJtZFc1amRHbHZibk1nZEdoaGRDQnlaWFIxY200Z1IyVnVaWEpoZEc5eVhHNGdJQzh2SUc5aWFtVmpkSE11SUVadmNpQm1kV3hzSUhOd1pXTWdZMjl0Y0d4cFlXNWpaU3dnZVc5MUlHMWhlU0IzYVhOb0lIUnZJR052Ym1acFozVnlaU0I1YjNWeVhHNGdJQzh2SUcxcGJtbG1hV1Z5SUc1dmRDQjBieUJ0WVc1bmJHVWdkR2hsSUc1aGJXVnpJRzltSUhSb1pYTmxJSFIzYnlCbWRXNWpkR2x2Ym5NdVhHNGdJR1oxYm1OMGFXOXVJRWRsYm1WeVlYUnZjaWdwSUh0OVhHNGdJR1oxYm1OMGFXOXVJRWRsYm1WeVlYUnZja1oxYm1OMGFXOXVLQ2tnZTMxY2JpQWdablZ1WTNScGIyNGdSMlZ1WlhKaGRHOXlSblZ1WTNScGIyNVFjbTkwYjNSNWNHVW9LU0I3ZlZ4dVhHNGdJQzh2SUZSb2FYTWdhWE1nWVNCd2IyeDVabWxzYkNCbWIzSWdKVWwwWlhKaGRHOXlVSEp2ZEc5MGVYQmxKU0JtYjNJZ1pXNTJhWEp2Ym0xbGJuUnpJSFJvWVhSY2JpQWdMeThnWkc5dUozUWdibUYwYVhabGJIa2djM1Z3Y0c5eWRDQnBkQzVjYmlBZ2RtRnlJRWwwWlhKaGRHOXlVSEp2ZEc5MGVYQmxJRDBnZTMwN1hHNGdJRWwwWlhKaGRHOXlVSEp2ZEc5MGVYQmxXMmwwWlhKaGRHOXlVM2x0WW05c1hTQTlJR1oxYm1OMGFXOXVJQ2dwSUh0Y2JpQWdJQ0J5WlhSMWNtNGdkR2hwY3p0Y2JpQWdmVHRjYmx4dUlDQjJZWElnWjJWMFVISnZkRzhnUFNCUFltcGxZM1F1WjJWMFVISnZkRzkwZVhCbFQyWTdYRzRnSUhaaGNpQk9ZWFJwZG1WSmRHVnlZWFJ2Y2xCeWIzUnZkSGx3WlNBOUlHZGxkRkJ5YjNSdklDWW1JR2RsZEZCeWIzUnZLR2RsZEZCeWIzUnZLSFpoYkhWbGN5aGJYU2twS1R0Y2JpQWdhV1lnS0U1aGRHbDJaVWwwWlhKaGRHOXlVSEp2ZEc5MGVYQmxJQ1ltWEc0Z0lDQWdJQ0JPWVhScGRtVkpkR1Z5WVhSdmNsQnliM1J2ZEhsd1pTQWhQVDBnVDNBZ0ppWmNiaUFnSUNBZ0lHaGhjMDkzYmk1allXeHNLRTVoZEdsMlpVbDBaWEpoZEc5eVVISnZkRzkwZVhCbExDQnBkR1Z5WVhSdmNsTjViV0p2YkNrcElIdGNiaUFnSUNBdkx5QlVhR2x6SUdWdWRtbHliMjV0Wlc1MElHaGhjeUJoSUc1aGRHbDJaU0FsU1hSbGNtRjBiM0pRY205MGIzUjVjR1VsT3lCMWMyVWdhWFFnYVc1emRHVmhaRnh1SUNBZ0lDOHZJRzltSUhSb1pTQndiMng1Wm1sc2JDNWNiaUFnSUNCSmRHVnlZWFJ2Y2xCeWIzUnZkSGx3WlNBOUlFNWhkR2wyWlVsMFpYSmhkRzl5VUhKdmRHOTBlWEJsTzF4dUlDQjlYRzVjYmlBZ2RtRnlJRWR3SUQwZ1IyVnVaWEpoZEc5eVJuVnVZM1JwYjI1UWNtOTBiM1I1Y0dVdWNISnZkRzkwZVhCbElEMWNiaUFnSUNCSFpXNWxjbUYwYjNJdWNISnZkRzkwZVhCbElEMGdUMkpxWldOMExtTnlaV0YwWlNoSmRHVnlZWFJ2Y2xCeWIzUnZkSGx3WlNrN1hHNGdJRWRsYm1WeVlYUnZja1oxYm1OMGFXOXVMbkJ5YjNSdmRIbHdaU0E5SUVkd0xtTnZibk4wY25WamRHOXlJRDBnUjJWdVpYSmhkRzl5Um5WdVkzUnBiMjVRY205MGIzUjVjR1U3WEc0Z0lFZGxibVZ5WVhSdmNrWjFibU4wYVc5dVVISnZkRzkwZVhCbExtTnZibk4wY25WamRHOXlJRDBnUjJWdVpYSmhkRzl5Um5WdVkzUnBiMjQ3WEc0Z0lFZGxibVZ5WVhSdmNrWjFibU4wYVc5dUxtUnBjM0JzWVhsT1lXMWxJRDBnWkdWbWFXNWxLRnh1SUNBZ0lFZGxibVZ5WVhSdmNrWjFibU4wYVc5dVVISnZkRzkwZVhCbExGeHVJQ0FnSUhSdlUzUnlhVzVuVkdGblUzbHRZbTlzTEZ4dUlDQWdJRndpUjJWdVpYSmhkRzl5Um5WdVkzUnBiMjVjSWx4dUlDQXBPMXh1WEc0Z0lDOHZJRWhsYkhCbGNpQm1iM0lnWkdWbWFXNXBibWNnZEdobElDNXVaWGgwTENBdWRHaHliM2NzSUdGdVpDQXVjbVYwZFhKdUlHMWxkR2h2WkhNZ2IyWWdkR2hsWEc0Z0lDOHZJRWwwWlhKaGRHOXlJR2x1ZEdWeVptRmpaU0JwYmlCMFpYSnRjeUJ2WmlCaElITnBibWRzWlNBdVgybHVkbTlyWlNCdFpYUm9iMlF1WEc0Z0lHWjFibU4wYVc5dUlHUmxabWx1WlVsMFpYSmhkRzl5VFdWMGFHOWtjeWh3Y205MGIzUjVjR1VwSUh0Y2JpQWdJQ0JiWENKdVpYaDBYQ0lzSUZ3aWRHaHliM2RjSWl3Z1hDSnlaWFIxY201Y0lsMHVabTl5UldGamFDaG1kVzVqZEdsdmJpaHRaWFJvYjJRcElIdGNiaUFnSUNBZ0lHUmxabWx1WlNod2NtOTBiM1I1Y0dVc0lHMWxkR2h2WkN3Z1puVnVZM1JwYjI0b1lYSm5LU0I3WEc0Z0lDQWdJQ0FnSUhKbGRIVnliaUIwYUdsekxsOXBiblp2YTJVb2JXVjBhRzlrTENCaGNtY3BPMXh1SUNBZ0lDQWdmU2s3WEc0Z0lDQWdmU2s3WEc0Z0lIMWNibHh1SUNCbGVIQnZjblJ6TG1selIyVnVaWEpoZEc5eVJuVnVZM1JwYjI0Z1BTQm1kVzVqZEdsdmJpaG5aVzVHZFc0cElIdGNiaUFnSUNCMllYSWdZM1J2Y2lBOUlIUjVjR1Z2WmlCblpXNUdkVzRnUFQwOUlGd2lablZ1WTNScGIyNWNJaUFtSmlCblpXNUdkVzR1WTI5dWMzUnlkV04wYjNJN1hHNGdJQ0FnY21WMGRYSnVJR04wYjNKY2JpQWdJQ0FnSUQ4Z1kzUnZjaUE5UFQwZ1IyVnVaWEpoZEc5eVJuVnVZM1JwYjI0Z2ZIeGNiaUFnSUNBZ0lDQWdMeThnUm05eUlIUm9aU0J1WVhScGRtVWdSMlZ1WlhKaGRHOXlSblZ1WTNScGIyNGdZMjl1YzNSeWRXTjBiM0lzSUhSb1pTQmlaWE4wSUhkbElHTmhibHh1SUNBZ0lDQWdJQ0F2THlCa2J5QnBjeUIwYnlCamFHVmpheUJwZEhNZ0xtNWhiV1VnY0hKdmNHVnlkSGt1WEc0Z0lDQWdJQ0FnSUNoamRHOXlMbVJwYzNCc1lYbE9ZVzFsSUh4OElHTjBiM0l1Ym1GdFpTa2dQVDA5SUZ3aVIyVnVaWEpoZEc5eVJuVnVZM1JwYjI1Y0lseHVJQ0FnSUNBZ09pQm1ZV3h6WlR0Y2JpQWdmVHRjYmx4dUlDQmxlSEJ2Y25SekxtMWhjbXNnUFNCbWRXNWpkR2x2YmloblpXNUdkVzRwSUh0Y2JpQWdJQ0JwWmlBb1QySnFaV04wTG5ObGRGQnliM1J2ZEhsd1pVOW1LU0I3WEc0Z0lDQWdJQ0JQWW1wbFkzUXVjMlYwVUhKdmRHOTBlWEJsVDJZb1oyVnVSblZ1TENCSFpXNWxjbUYwYjNKR2RXNWpkR2x2YmxCeWIzUnZkSGx3WlNrN1hHNGdJQ0FnZlNCbGJITmxJSHRjYmlBZ0lDQWdJR2RsYmtaMWJpNWZYM0J5YjNSdlgxOGdQU0JIWlc1bGNtRjBiM0pHZFc1amRHbHZibEJ5YjNSdmRIbHdaVHRjYmlBZ0lDQWdJR1JsWm1sdVpTaG5aVzVHZFc0c0lIUnZVM1J5YVc1blZHRm5VM2x0WW05c0xDQmNJa2RsYm1WeVlYUnZja1oxYm1OMGFXOXVYQ0lwTzF4dUlDQWdJSDFjYmlBZ0lDQm5aVzVHZFc0dWNISnZkRzkwZVhCbElEMGdUMkpxWldOMExtTnlaV0YwWlNoSGNDazdYRzRnSUNBZ2NtVjBkWEp1SUdkbGJrWjFianRjYmlBZ2ZUdGNibHh1SUNBdkx5QlhhWFJvYVc0Z2RHaGxJR0p2WkhrZ2IyWWdZVzU1SUdGemVXNWpJR1oxYm1OMGFXOXVMQ0JnWVhkaGFYUWdlR0FnYVhNZ2RISmhibk5tYjNKdFpXUWdkRzljYmlBZ0x5OGdZSGxwWld4a0lISmxaMlZ1WlhKaGRHOXlVblZ1ZEdsdFpTNWhkM0poY0NoNEtXQXNJSE52SUhSb1lYUWdkR2hsSUhKMWJuUnBiV1VnWTJGdUlIUmxjM1JjYmlBZ0x5OGdZR2hoYzA5M2JpNWpZV3hzS0haaGJIVmxMQ0JjSWw5ZllYZGhhWFJjSWlsZ0lIUnZJR1JsZEdWeWJXbHVaU0JwWmlCMGFHVWdlV2xsYkdSbFpDQjJZV3gxWlNCcGMxeHVJQ0F2THlCdFpXRnVkQ0IwYnlCaVpTQmhkMkZwZEdWa0xseHVJQ0JsZUhCdmNuUnpMbUYzY21Gd0lEMGdablZ1WTNScGIyNG9ZWEpuS1NCN1hHNGdJQ0FnY21WMGRYSnVJSHNnWDE5aGQyRnBkRG9nWVhKbklIMDdYRzRnSUgwN1hHNWNiaUFnWm5WdVkzUnBiMjRnUVhONWJtTkpkR1Z5WVhSdmNpaG5aVzVsY21GMGIzSXNJRkJ5YjIxcGMyVkpiWEJzS1NCN1hHNGdJQ0FnWm5WdVkzUnBiMjRnYVc1MmIydGxLRzFsZEdodlpDd2dZWEpuTENCeVpYTnZiSFpsTENCeVpXcGxZM1FwSUh0Y2JpQWdJQ0FnSUhaaGNpQnlaV052Y21RZ1BTQjBjbmxEWVhSamFDaG5aVzVsY21GMGIzSmJiV1YwYUc5a1hTd2daMlZ1WlhKaGRHOXlMQ0JoY21jcE8xeHVJQ0FnSUNBZ2FXWWdLSEpsWTI5eVpDNTBlWEJsSUQwOVBTQmNJblJvY205M1hDSXBJSHRjYmlBZ0lDQWdJQ0FnY21WcVpXTjBLSEpsWTI5eVpDNWhjbWNwTzF4dUlDQWdJQ0FnZlNCbGJITmxJSHRjYmlBZ0lDQWdJQ0FnZG1GeUlISmxjM1ZzZENBOUlISmxZMjl5WkM1aGNtYzdYRzRnSUNBZ0lDQWdJSFpoY2lCMllXeDFaU0E5SUhKbGMzVnNkQzUyWVd4MVpUdGNiaUFnSUNBZ0lDQWdhV1lnS0haaGJIVmxJQ1ltWEc0Z0lDQWdJQ0FnSUNBZ0lDQjBlWEJsYjJZZ2RtRnNkV1VnUFQwOUlGd2liMkpxWldOMFhDSWdKaVpjYmlBZ0lDQWdJQ0FnSUNBZ0lHaGhjMDkzYmk1allXeHNLSFpoYkhWbExDQmNJbDlmWVhkaGFYUmNJaWtwSUh0Y2JpQWdJQ0FnSUNBZ0lDQnlaWFIxY200Z1VISnZiV2x6WlVsdGNHd3VjbVZ6YjJ4MlpTaDJZV3gxWlM1ZlgyRjNZV2wwS1M1MGFHVnVLR1oxYm1OMGFXOXVLSFpoYkhWbEtTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNCcGJuWnZhMlVvWENKdVpYaDBYQ0lzSUhaaGJIVmxMQ0J5WlhOdmJIWmxMQ0J5WldwbFkzUXBPMXh1SUNBZ0lDQWdJQ0FnSUgwc0lHWjFibU4wYVc5dUtHVnljaWtnZTF4dUlDQWdJQ0FnSUNBZ0lDQWdhVzUyYjJ0bEtGd2lkR2h5YjNkY0lpd2daWEp5TENCeVpYTnZiSFpsTENCeVpXcGxZM1FwTzF4dUlDQWdJQ0FnSUNBZ0lIMHBPMXh1SUNBZ0lDQWdJQ0I5WEc1Y2JpQWdJQ0FnSUNBZ2NtVjBkWEp1SUZCeWIyMXBjMlZKYlhCc0xuSmxjMjlzZG1Vb2RtRnNkV1VwTG5Sb1pXNG9ablZ1WTNScGIyNG9kVzUzY21Gd2NHVmtLU0I3WEc0Z0lDQWdJQ0FnSUNBZ0x5OGdWMmhsYmlCaElIbHBaV3hrWldRZ1VISnZiV2x6WlNCcGN5QnlaWE52YkhabFpDd2dhWFJ6SUdacGJtRnNJSFpoYkhWbElHSmxZMjl0WlhOY2JpQWdJQ0FnSUNBZ0lDQXZMeUIwYUdVZ0xuWmhiSFZsSUc5bUlIUm9aU0JRY205dGFYTmxQSHQyWVd4MVpTeGtiMjVsZlQ0Z2NtVnpkV3gwSUdadmNpQjBhR1ZjYmlBZ0lDQWdJQ0FnSUNBdkx5QmpkWEp5Wlc1MElHbDBaWEpoZEdsdmJpNWNiaUFnSUNBZ0lDQWdJQ0J5WlhOMWJIUXVkbUZzZFdVZ1BTQjFibmR5WVhCd1pXUTdYRzRnSUNBZ0lDQWdJQ0FnY21WemIyeDJaU2h5WlhOMWJIUXBPMXh1SUNBZ0lDQWdJQ0I5TENCbWRXNWpkR2x2YmlobGNuSnZjaWtnZTF4dUlDQWdJQ0FnSUNBZ0lDOHZJRWxtSUdFZ2NtVnFaV04wWldRZ1VISnZiV2x6WlNCM1lYTWdlV2xsYkdSbFpDd2dkR2h5YjNjZ2RHaGxJSEpsYW1WamRHbHZiaUJpWVdOclhHNGdJQ0FnSUNBZ0lDQWdMeThnYVc1MGJ5QjBhR1VnWVhONWJtTWdaMlZ1WlhKaGRHOXlJR1oxYm1OMGFXOXVJSE52SUdsMElHTmhiaUJpWlNCb1lXNWtiR1ZrSUhSb1pYSmxMbHh1SUNBZ0lDQWdJQ0FnSUhKbGRIVnliaUJwYm5admEyVW9YQ0owYUhKdmQxd2lMQ0JsY25KdmNpd2djbVZ6YjJ4MlpTd2djbVZxWldOMEtUdGNiaUFnSUNBZ0lDQWdmU2s3WEc0Z0lDQWdJQ0I5WEc0Z0lDQWdmVnh1WEc0Z0lDQWdkbUZ5SUhCeVpYWnBiM1Z6VUhKdmJXbHpaVHRjYmx4dUlDQWdJR1oxYm1OMGFXOXVJR1Z1Y1hWbGRXVW9iV1YwYUc5a0xDQmhjbWNwSUh0Y2JpQWdJQ0FnSUdaMWJtTjBhVzl1SUdOaGJHeEpiblp2YTJWWGFYUm9UV1YwYUc5a1FXNWtRWEpuS0NrZ2UxeHVJQ0FnSUNBZ0lDQnlaWFIxY200Z2JtVjNJRkJ5YjIxcGMyVkpiWEJzS0daMWJtTjBhVzl1S0hKbGMyOXNkbVVzSUhKbGFtVmpkQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lHbHVkbTlyWlNodFpYUm9iMlFzSUdGeVp5d2djbVZ6YjJ4MlpTd2djbVZxWldOMEtUdGNiaUFnSUNBZ0lDQWdmU2s3WEc0Z0lDQWdJQ0I5WEc1Y2JpQWdJQ0FnSUhKbGRIVnliaUJ3Y21WMmFXOTFjMUJ5YjIxcGMyVWdQVnh1SUNBZ0lDQWdJQ0F2THlCSlppQmxibkYxWlhWbElHaGhjeUJpWldWdUlHTmhiR3hsWkNCaVpXWnZjbVVzSUhSb1pXNGdkMlVnZDJGdWRDQjBieUIzWVdsMElIVnVkR2xzWEc0Z0lDQWdJQ0FnSUM4dklHRnNiQ0J3Y21WMmFXOTFjeUJRY205dGFYTmxjeUJvWVhabElHSmxaVzRnY21WemIyeDJaV1FnWW1WbWIzSmxJR05oYkd4cGJtY2dhVzUyYjJ0bExGeHVJQ0FnSUNBZ0lDQXZMeUJ6YnlCMGFHRjBJSEpsYzNWc2RITWdZWEpsSUdGc2QyRjVjeUJrWld4cGRtVnlaV1FnYVc0Z2RHaGxJR052Y25KbFkzUWdiM0prWlhJdUlFbG1YRzRnSUNBZ0lDQWdJQzh2SUdWdWNYVmxkV1VnYUdGeklHNXZkQ0JpWldWdUlHTmhiR3hsWkNCaVpXWnZjbVVzSUhSb1pXNGdhWFFnYVhNZ2FXMXdiM0owWVc1MElIUnZYRzRnSUNBZ0lDQWdJQzh2SUdOaGJHd2dhVzUyYjJ0bElHbHRiV1ZrYVdGMFpXeDVMQ0IzYVhSb2IzVjBJSGRoYVhScGJtY2diMjRnWVNCallXeHNZbUZqYXlCMGJ5Qm1hWEpsTEZ4dUlDQWdJQ0FnSUNBdkx5QnpieUIwYUdGMElIUm9aU0JoYzNsdVl5Qm5aVzVsY21GMGIzSWdablZ1WTNScGIyNGdhR0Z6SUhSb1pTQnZjSEJ2Y25SMWJtbDBlU0IwYnlCa2IxeHVJQ0FnSUNBZ0lDQXZMeUJoYm5rZ2JtVmpaWE56WVhKNUlITmxkSFZ3SUdsdUlHRWdjSEpsWkdsamRHRmliR1VnZDJGNUxpQlVhR2x6SUhCeVpXUnBZM1JoWW1sc2FYUjVYRzRnSUNBZ0lDQWdJQzh2SUdseklIZG9lU0IwYUdVZ1VISnZiV2x6WlNCamIyNXpkSEoxWTNSdmNpQnplVzVqYUhKdmJtOTFjMng1SUdsdWRtOXJaWE1nYVhSelhHNGdJQ0FnSUNBZ0lDOHZJR1Y0WldOMWRHOXlJR05oYkd4aVlXTnJMQ0JoYm1RZ2QyaDVJR0Z6ZVc1aklHWjFibU4wYVc5dWN5QnplVzVqYUhKdmJtOTFjMng1WEc0Z0lDQWdJQ0FnSUM4dklHVjRaV04xZEdVZ1kyOWtaU0JpWldadmNtVWdkR2hsSUdacGNuTjBJR0YzWVdsMExpQlRhVzVqWlNCM1pTQnBiWEJzWlcxbGJuUWdjMmx0Y0d4bFhHNGdJQ0FnSUNBZ0lDOHZJR0Z6ZVc1aklHWjFibU4wYVc5dWN5QnBiaUIwWlhKdGN5QnZaaUJoYzNsdVl5Qm5aVzVsY21GMGIzSnpMQ0JwZENCcGN5QmxjM0JsWTJsaGJHeDVYRzRnSUNBZ0lDQWdJQzh2SUdsdGNHOXlkR0Z1ZENCMGJ5Qm5aWFFnZEdocGN5QnlhV2RvZEN3Z1pYWmxiaUIwYUc5MVoyZ2dhWFFnY21WeGRXbHlaWE1nWTJGeVpTNWNiaUFnSUNBZ0lDQWdjSEpsZG1sdmRYTlFjbTl0YVhObElEOGdjSEpsZG1sdmRYTlFjbTl0YVhObExuUm9aVzRvWEc0Z0lDQWdJQ0FnSUNBZ1kyRnNiRWx1ZG05clpWZHBkR2hOWlhSb2IyUkJibVJCY21jc1hHNGdJQ0FnSUNBZ0lDQWdMeThnUVhadmFXUWdjSEp2Y0dGbllYUnBibWNnWm1GcGJIVnlaWE1nZEc4Z1VISnZiV2x6WlhNZ2NtVjBkWEp1WldRZ1lua2diR0YwWlhKY2JpQWdJQ0FnSUNBZ0lDQXZMeUJwYm5adlkyRjBhVzl1Y3lCdlppQjBhR1VnYVhSbGNtRjBiM0l1WEc0Z0lDQWdJQ0FnSUNBZ1kyRnNiRWx1ZG05clpWZHBkR2hOWlhSb2IyUkJibVJCY21kY2JpQWdJQ0FnSUNBZ0tTQTZJR05oYkd4SmJuWnZhMlZYYVhSb1RXVjBhRzlrUVc1a1FYSm5LQ2s3WEc0Z0lDQWdmVnh1WEc0Z0lDQWdMeThnUkdWbWFXNWxJSFJvWlNCMWJtbG1hV1ZrSUdobGJIQmxjaUJ0WlhSb2IyUWdkR2hoZENCcGN5QjFjMlZrSUhSdklHbHRjR3hsYldWdWRDQXVibVY0ZEN4Y2JpQWdJQ0F2THlBdWRHaHliM2NzSUdGdVpDQXVjbVYwZFhKdUlDaHpaV1VnWkdWbWFXNWxTWFJsY21GMGIzSk5aWFJvYjJSektTNWNiaUFnSUNCMGFHbHpMbDlwYm5admEyVWdQU0JsYm5GMVpYVmxPMXh1SUNCOVhHNWNiaUFnWkdWbWFXNWxTWFJsY21GMGIzSk5aWFJvYjJSektFRnplVzVqU1hSbGNtRjBiM0l1Y0hKdmRHOTBlWEJsS1R0Y2JpQWdRWE41Ym1OSmRHVnlZWFJ2Y2k1d2NtOTBiM1I1Y0dWYllYTjVibU5KZEdWeVlYUnZjbE41YldKdmJGMGdQU0JtZFc1amRHbHZiaUFvS1NCN1hHNGdJQ0FnY21WMGRYSnVJSFJvYVhNN1hHNGdJSDA3WEc0Z0lHVjRjRzl5ZEhNdVFYTjVibU5KZEdWeVlYUnZjaUE5SUVGemVXNWpTWFJsY21GMGIzSTdYRzVjYmlBZ0x5OGdUbTkwWlNCMGFHRjBJSE5wYlhCc1pTQmhjM2x1WXlCbWRXNWpkR2x2Ym5NZ1lYSmxJR2x0Y0d4bGJXVnVkR1ZrSUc5dUlIUnZjQ0J2Wmx4dUlDQXZMeUJCYzNsdVkwbDBaWEpoZEc5eUlHOWlhbVZqZEhNN0lIUm9aWGtnYW5WemRDQnlaWFIxY200Z1lTQlFjbTl0YVhObElHWnZjaUIwYUdVZ2RtRnNkV1VnYjJaY2JpQWdMeThnZEdobElHWnBibUZzSUhKbGMzVnNkQ0J3Y205a2RXTmxaQ0JpZVNCMGFHVWdhWFJsY21GMGIzSXVYRzRnSUdWNGNHOXlkSE11WVhONWJtTWdQU0JtZFc1amRHbHZiaWhwYm01bGNrWnVMQ0J2ZFhSbGNrWnVMQ0J6Wld4bUxDQjBjbmxNYjJOelRHbHpkQ3dnVUhKdmJXbHpaVWx0Y0d3cElIdGNiaUFnSUNCcFppQW9VSEp2YldselpVbHRjR3dnUFQwOUlIWnZhV1FnTUNrZ1VISnZiV2x6WlVsdGNHd2dQU0JRY205dGFYTmxPMXh1WEc0Z0lDQWdkbUZ5SUdsMFpYSWdQU0J1WlhjZ1FYTjVibU5KZEdWeVlYUnZjaWhjYmlBZ0lDQWdJSGR5WVhBb2FXNXVaWEpHYml3Z2IzVjBaWEpHYml3Z2MyVnNaaXdnZEhKNVRHOWpjMHhwYzNRcExGeHVJQ0FnSUNBZ1VISnZiV2x6WlVsdGNHeGNiaUFnSUNBcE8xeHVYRzRnSUNBZ2NtVjBkWEp1SUdWNGNHOXlkSE11YVhOSFpXNWxjbUYwYjNKR2RXNWpkR2x2YmlodmRYUmxja1p1S1Z4dUlDQWdJQ0FnUHlCcGRHVnlJQzh2SUVsbUlHOTFkR1Z5Um00Z2FYTWdZU0JuWlc1bGNtRjBiM0lzSUhKbGRIVnliaUIwYUdVZ1puVnNiQ0JwZEdWeVlYUnZjaTVjYmlBZ0lDQWdJRG9nYVhSbGNpNXVaWGgwS0NrdWRHaGxiaWhtZFc1amRHbHZiaWh5WlhOMWJIUXBJSHRjYmlBZ0lDQWdJQ0FnSUNCeVpYUjFjbTRnY21WemRXeDBMbVJ2Ym1VZ1B5QnlaWE4xYkhRdWRtRnNkV1VnT2lCcGRHVnlMbTVsZUhRb0tUdGNiaUFnSUNBZ0lDQWdmU2s3WEc0Z0lIMDdYRzVjYmlBZ1puVnVZM1JwYjI0Z2JXRnJaVWx1ZG05clpVMWxkR2h2WkNocGJtNWxja1p1TENCelpXeG1MQ0JqYjI1MFpYaDBLU0I3WEc0Z0lDQWdkbUZ5SUhOMFlYUmxJRDBnUjJWdVUzUmhkR1ZUZFhOd1pXNWtaV1JUZEdGeWREdGNibHh1SUNBZ0lISmxkSFZ5YmlCbWRXNWpkR2x2YmlCcGJuWnZhMlVvYldWMGFHOWtMQ0JoY21jcElIdGNiaUFnSUNBZ0lHbG1JQ2h6ZEdGMFpTQTlQVDBnUjJWdVUzUmhkR1ZGZUdWamRYUnBibWNwSUh0Y2JpQWdJQ0FnSUNBZ2RHaHliM2NnYm1WM0lFVnljbTl5S0Z3aVIyVnVaWEpoZEc5eUlHbHpJR0ZzY21WaFpIa2djblZ1Ym1sdVoxd2lLVHRjYmlBZ0lDQWdJSDFjYmx4dUlDQWdJQ0FnYVdZZ0tITjBZWFJsSUQwOVBTQkhaVzVUZEdGMFpVTnZiWEJzWlhSbFpDa2dlMXh1SUNBZ0lDQWdJQ0JwWmlBb2JXVjBhRzlrSUQwOVBTQmNJblJvY205M1hDSXBJSHRjYmlBZ0lDQWdJQ0FnSUNCMGFISnZkeUJoY21jN1hHNGdJQ0FnSUNBZ0lIMWNibHh1SUNBZ0lDQWdJQ0F2THlCQ1pTQm1iM0puYVhacGJtY3NJSEJsY2lBeU5TNHpMak11TXk0eklHOW1JSFJvWlNCemNHVmpPbHh1SUNBZ0lDQWdJQ0F2THlCb2RIUndjem92TDNCbGIzQnNaUzV0YjNwcGJHeGhMbTl5Wnk5K2FtOXlaVzVrYjNKbVppOWxjell0WkhKaFpuUXVhSFJ0YkNOelpXTXRaMlZ1WlhKaGRHOXljbVZ6ZFcxbFhHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCa2IyNWxVbVZ6ZFd4MEtDazdYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJR052Ym5SbGVIUXViV1YwYUc5a0lEMGdiV1YwYUc5a08xeHVJQ0FnSUNBZ1kyOXVkR1Y0ZEM1aGNtY2dQU0JoY21jN1hHNWNiaUFnSUNBZ0lIZG9hV3hsSUNoMGNuVmxLU0I3WEc0Z0lDQWdJQ0FnSUhaaGNpQmtaV3hsWjJGMFpTQTlJR052Ym5SbGVIUXVaR1ZzWldkaGRHVTdYRzRnSUNBZ0lDQWdJR2xtSUNoa1pXeGxaMkYwWlNrZ2UxeHVJQ0FnSUNBZ0lDQWdJSFpoY2lCa1pXeGxaMkYwWlZKbGMzVnNkQ0E5SUcxaGVXSmxTVzUyYjJ0bFJHVnNaV2RoZEdVb1pHVnNaV2RoZEdVc0lHTnZiblJsZUhRcE8xeHVJQ0FnSUNBZ0lDQWdJR2xtSUNoa1pXeGxaMkYwWlZKbGMzVnNkQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lDQWdhV1lnS0dSbGJHVm5ZWFJsVW1WemRXeDBJRDA5UFNCRGIyNTBhVzUxWlZObGJuUnBibVZzS1NCamIyNTBhVzUxWlR0Y2JpQWdJQ0FnSUNBZ0lDQWdJSEpsZEhWeWJpQmtaV3hsWjJGMFpWSmxjM1ZzZER0Y2JpQWdJQ0FnSUNBZ0lDQjlYRzRnSUNBZ0lDQWdJSDFjYmx4dUlDQWdJQ0FnSUNCcFppQW9ZMjl1ZEdWNGRDNXRaWFJvYjJRZ1BUMDlJRndpYm1WNGRGd2lLU0I3WEc0Z0lDQWdJQ0FnSUNBZ0x5OGdVMlYwZEdsdVp5QmpiMjUwWlhoMExsOXpaVzUwSUdadmNpQnNaV2RoWTNrZ2MzVndjRzl5ZENCdlppQkNZV0psYkNkelhHNGdJQ0FnSUNBZ0lDQWdMeThnWm5WdVkzUnBiMjR1YzJWdWRDQnBiWEJzWlcxbGJuUmhkR2x2Ymk1Y2JpQWdJQ0FnSUNBZ0lDQmpiMjUwWlhoMExuTmxiblFnUFNCamIyNTBaWGgwTGw5elpXNTBJRDBnWTI5dWRHVjRkQzVoY21jN1hHNWNiaUFnSUNBZ0lDQWdmU0JsYkhObElHbG1JQ2hqYjI1MFpYaDBMbTFsZEdodlpDQTlQVDBnWENKMGFISnZkMXdpS1NCN1hHNGdJQ0FnSUNBZ0lDQWdhV1lnS0hOMFlYUmxJRDA5UFNCSFpXNVRkR0YwWlZOMWMzQmxibVJsWkZOMFlYSjBLU0I3WEc0Z0lDQWdJQ0FnSUNBZ0lDQnpkR0YwWlNBOUlFZGxibE4wWVhSbFEyOXRjR3hsZEdWa08xeHVJQ0FnSUNBZ0lDQWdJQ0FnZEdoeWIzY2dZMjl1ZEdWNGRDNWhjbWM3WEc0Z0lDQWdJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQWdJQ0FnWTI5dWRHVjRkQzVrYVhOd1lYUmphRVY0WTJWd2RHbHZiaWhqYjI1MFpYaDBMbUZ5WnlrN1hHNWNiaUFnSUNBZ0lDQWdmU0JsYkhObElHbG1JQ2hqYjI1MFpYaDBMbTFsZEdodlpDQTlQVDBnWENKeVpYUjFjbTVjSWlrZ2UxeHVJQ0FnSUNBZ0lDQWdJR052Ym5SbGVIUXVZV0p5ZFhCMEtGd2ljbVYwZFhKdVhDSXNJR052Ym5SbGVIUXVZWEpuS1R0Y2JpQWdJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQWdJSE4wWVhSbElEMGdSMlZ1VTNSaGRHVkZlR1ZqZFhScGJtYzdYRzVjYmlBZ0lDQWdJQ0FnZG1GeUlISmxZMjl5WkNBOUlIUnllVU5oZEdOb0tHbHVibVZ5Um00c0lITmxiR1lzSUdOdmJuUmxlSFFwTzF4dUlDQWdJQ0FnSUNCcFppQW9jbVZqYjNKa0xuUjVjR1VnUFQwOUlGd2libTl5YldGc1hDSXBJSHRjYmlBZ0lDQWdJQ0FnSUNBdkx5QkpaaUJoYmlCbGVHTmxjSFJwYjI0Z2FYTWdkR2h5YjNkdUlHWnliMjBnYVc1dVpYSkdiaXdnZDJVZ2JHVmhkbVVnYzNSaGRHVWdQVDA5WEc0Z0lDQWdJQ0FnSUNBZ0x5OGdSMlZ1VTNSaGRHVkZlR1ZqZFhScGJtY2dZVzVrSUd4dmIzQWdZbUZqYXlCbWIzSWdZVzV2ZEdobGNpQnBiblp2WTJGMGFXOXVMbHh1SUNBZ0lDQWdJQ0FnSUhOMFlYUmxJRDBnWTI5dWRHVjRkQzVrYjI1bFhHNGdJQ0FnSUNBZ0lDQWdJQ0EvSUVkbGJsTjBZWFJsUTI5dGNHeGxkR1ZrWEc0Z0lDQWdJQ0FnSUNBZ0lDQTZJRWRsYmxOMFlYUmxVM1Z6Y0dWdVpHVmtXV2xsYkdRN1hHNWNiaUFnSUNBZ0lDQWdJQ0JwWmlBb2NtVmpiM0prTG1GeVp5QTlQVDBnUTI5dWRHbHVkV1ZUWlc1MGFXNWxiQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lDQWdZMjl1ZEdsdWRXVTdYRzRnSUNBZ0lDQWdJQ0FnZlZ4dVhHNGdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlIdGNiaUFnSUNBZ0lDQWdJQ0FnSUhaaGJIVmxPaUJ5WldOdmNtUXVZWEpuTEZ4dUlDQWdJQ0FnSUNBZ0lDQWdaRzl1WlRvZ1kyOXVkR1Y0ZEM1a2IyNWxYRzRnSUNBZ0lDQWdJQ0FnZlR0Y2JseHVJQ0FnSUNBZ0lDQjlJR1ZzYzJVZ2FXWWdLSEpsWTI5eVpDNTBlWEJsSUQwOVBTQmNJblJvY205M1hDSXBJSHRjYmlBZ0lDQWdJQ0FnSUNCemRHRjBaU0E5SUVkbGJsTjBZWFJsUTI5dGNHeGxkR1ZrTzF4dUlDQWdJQ0FnSUNBZ0lDOHZJRVJwYzNCaGRHTm9JSFJvWlNCbGVHTmxjSFJwYjI0Z1lua2diRzl2Y0dsdVp5QmlZV05ySUdGeWIzVnVaQ0IwYnlCMGFHVmNiaUFnSUNBZ0lDQWdJQ0F2THlCamIyNTBaWGgwTG1ScGMzQmhkR05vUlhoalpYQjBhVzl1S0dOdmJuUmxlSFF1WVhKbktTQmpZV3hzSUdGaWIzWmxMbHh1SUNBZ0lDQWdJQ0FnSUdOdmJuUmxlSFF1YldWMGFHOWtJRDBnWENKMGFISnZkMXdpTzF4dUlDQWdJQ0FnSUNBZ0lHTnZiblJsZUhRdVlYSm5JRDBnY21WamIzSmtMbUZ5Wnp0Y2JpQWdJQ0FnSUNBZ2ZWeHVJQ0FnSUNBZ2ZWeHVJQ0FnSUgwN1hHNGdJSDFjYmx4dUlDQXZMeUJEWVd4c0lHUmxiR1ZuWVhSbExtbDBaWEpoZEc5eVcyTnZiblJsZUhRdWJXVjBhRzlrWFNoamIyNTBaWGgwTG1GeVp5a2dZVzVrSUdoaGJtUnNaU0IwYUdWY2JpQWdMeThnY21WemRXeDBMQ0JsYVhSb1pYSWdZbmtnY21WMGRYSnVhVzVuSUdFZ2V5QjJZV3gxWlN3Z1pHOXVaU0I5SUhKbGMzVnNkQ0JtY205dElIUm9aVnh1SUNBdkx5QmtaV3hsWjJGMFpTQnBkR1Z5WVhSdmNpd2diM0lnWW5rZ2JXOWthV1o1YVc1bklHTnZiblJsZUhRdWJXVjBhRzlrSUdGdVpDQmpiMjUwWlhoMExtRnlaeXhjYmlBZ0x5OGdjMlYwZEdsdVp5QmpiMjUwWlhoMExtUmxiR1ZuWVhSbElIUnZJRzUxYkd3c0lHRnVaQ0J5WlhSMWNtNXBibWNnZEdobElFTnZiblJwYm5WbFUyVnVkR2x1Wld3dVhHNGdJR1oxYm1OMGFXOXVJRzFoZVdKbFNXNTJiMnRsUkdWc1pXZGhkR1VvWkdWc1pXZGhkR1VzSUdOdmJuUmxlSFFwSUh0Y2JpQWdJQ0IyWVhJZ2JXVjBhRzlrSUQwZ1pHVnNaV2RoZEdVdWFYUmxjbUYwYjNKYlkyOXVkR1Y0ZEM1dFpYUm9iMlJkTzF4dUlDQWdJR2xtSUNodFpYUm9iMlFnUFQwOUlIVnVaR1ZtYVc1bFpDa2dlMXh1SUNBZ0lDQWdMeThnUVNBdWRHaHliM2NnYjNJZ0xuSmxkSFZ5YmlCM2FHVnVJSFJvWlNCa1pXeGxaMkYwWlNCcGRHVnlZWFJ2Y2lCb1lYTWdibThnTG5Sb2NtOTNYRzRnSUNBZ0lDQXZMeUJ0WlhSb2IyUWdZV3gzWVhseklIUmxjbTFwYm1GMFpYTWdkR2hsSUhscFpXeGtLaUJzYjI5d0xseHVJQ0FnSUNBZ1kyOXVkR1Y0ZEM1a1pXeGxaMkYwWlNBOUlHNTFiR3c3WEc1Y2JpQWdJQ0FnSUdsbUlDaGpiMjUwWlhoMExtMWxkR2h2WkNBOVBUMGdYQ0owYUhKdmQxd2lLU0I3WEc0Z0lDQWdJQ0FnSUM4dklFNXZkR1U2SUZ0Y0luSmxkSFZ5Ymx3aVhTQnRkWE4wSUdKbElIVnpaV1FnWm05eUlFVlRNeUJ3WVhKemFXNW5JR052YlhCaGRHbGlhV3hwZEhrdVhHNGdJQ0FnSUNBZ0lHbG1JQ2hrWld4bFoyRjBaUzVwZEdWeVlYUnZjbHRjSW5KbGRIVnlibHdpWFNrZ2UxeHVJQ0FnSUNBZ0lDQWdJQzh2SUVsbUlIUm9aU0JrWld4bFoyRjBaU0JwZEdWeVlYUnZjaUJvWVhNZ1lTQnlaWFIxY200Z2JXVjBhRzlrTENCbmFYWmxJR2wwSUdGY2JpQWdJQ0FnSUNBZ0lDQXZMeUJqYUdGdVkyVWdkRzhnWTJ4bFlXNGdkWEF1WEc0Z0lDQWdJQ0FnSUNBZ1kyOXVkR1Y0ZEM1dFpYUm9iMlFnUFNCY0luSmxkSFZ5Ymx3aU8xeHVJQ0FnSUNBZ0lDQWdJR052Ym5SbGVIUXVZWEpuSUQwZ2RXNWtaV1pwYm1Wa08xeHVJQ0FnSUNBZ0lDQWdJRzFoZVdKbFNXNTJiMnRsUkdWc1pXZGhkR1VvWkdWc1pXZGhkR1VzSUdOdmJuUmxlSFFwTzF4dVhHNGdJQ0FnSUNBZ0lDQWdhV1lnS0dOdmJuUmxlSFF1YldWMGFHOWtJRDA5UFNCY0luUm9jbTkzWENJcElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUM4dklFbG1JRzFoZVdKbFNXNTJiMnRsUkdWc1pXZGhkR1VvWTI5dWRHVjRkQ2tnWTJoaGJtZGxaQ0JqYjI1MFpYaDBMbTFsZEdodlpDQm1jbTl0WEc0Z0lDQWdJQ0FnSUNBZ0lDQXZMeUJjSW5KbGRIVnlibHdpSUhSdklGd2lkR2h5YjNkY0lpd2diR1YwSUhSb1lYUWdiM1psY25KcFpHVWdkR2hsSUZSNWNHVkZjbkp2Y2lCaVpXeHZkeTVjYmlBZ0lDQWdJQ0FnSUNBZ0lISmxkSFZ5YmlCRGIyNTBhVzUxWlZObGJuUnBibVZzTzF4dUlDQWdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lDQWdmVnh1WEc0Z0lDQWdJQ0FnSUdOdmJuUmxlSFF1YldWMGFHOWtJRDBnWENKMGFISnZkMXdpTzF4dUlDQWdJQ0FnSUNCamIyNTBaWGgwTG1GeVp5QTlJRzVsZHlCVWVYQmxSWEp5YjNJb1hHNGdJQ0FnSUNBZ0lDQWdYQ0pVYUdVZ2FYUmxjbUYwYjNJZ1pHOWxjeUJ1YjNRZ2NISnZkbWxrWlNCaElDZDBhSEp2ZHljZ2JXVjBhRzlrWENJcE8xeHVJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQnlaWFIxY200Z1EyOXVkR2x1ZFdWVFpXNTBhVzVsYkR0Y2JpQWdJQ0I5WEc1Y2JpQWdJQ0IyWVhJZ2NtVmpiM0prSUQwZ2RISjVRMkYwWTJnb2JXVjBhRzlrTENCa1pXeGxaMkYwWlM1cGRHVnlZWFJ2Y2l3Z1kyOXVkR1Y0ZEM1aGNtY3BPMXh1WEc0Z0lDQWdhV1lnS0hKbFkyOXlaQzUwZVhCbElEMDlQU0JjSW5Sb2NtOTNYQ0lwSUh0Y2JpQWdJQ0FnSUdOdmJuUmxlSFF1YldWMGFHOWtJRDBnWENKMGFISnZkMXdpTzF4dUlDQWdJQ0FnWTI5dWRHVjRkQzVoY21jZ1BTQnlaV052Y21RdVlYSm5PMXh1SUNBZ0lDQWdZMjl1ZEdWNGRDNWtaV3hsWjJGMFpTQTlJRzUxYkd3N1hHNGdJQ0FnSUNCeVpYUjFjbTRnUTI5dWRHbHVkV1ZUWlc1MGFXNWxiRHRjYmlBZ0lDQjlYRzVjYmlBZ0lDQjJZWElnYVc1bWJ5QTlJSEpsWTI5eVpDNWhjbWM3WEc1Y2JpQWdJQ0JwWmlBb0lTQnBibVp2S1NCN1hHNGdJQ0FnSUNCamIyNTBaWGgwTG0xbGRHaHZaQ0E5SUZ3aWRHaHliM2RjSWp0Y2JpQWdJQ0FnSUdOdmJuUmxlSFF1WVhKbklEMGdibVYzSUZSNWNHVkZjbkp2Y2loY0ltbDBaWEpoZEc5eUlISmxjM1ZzZENCcGN5QnViM1FnWVc0Z2IySnFaV04wWENJcE8xeHVJQ0FnSUNBZ1kyOXVkR1Y0ZEM1a1pXeGxaMkYwWlNBOUlHNTFiR3c3WEc0Z0lDQWdJQ0J5WlhSMWNtNGdRMjl1ZEdsdWRXVlRaVzUwYVc1bGJEdGNiaUFnSUNCOVhHNWNiaUFnSUNCcFppQW9hVzVtYnk1a2IyNWxLU0I3WEc0Z0lDQWdJQ0F2THlCQmMzTnBaMjRnZEdobElISmxjM1ZzZENCdlppQjBhR1VnWm1sdWFYTm9aV1FnWkdWc1pXZGhkR1VnZEc4Z2RHaGxJSFJsYlhCdmNtRnllVnh1SUNBZ0lDQWdMeThnZG1GeWFXRmliR1VnYzNCbFkybG1hV1ZrSUdKNUlHUmxiR1ZuWVhSbExuSmxjM1ZzZEU1aGJXVWdLSE5sWlNCa1pXeGxaMkYwWlZscFpXeGtLUzVjYmlBZ0lDQWdJR052Ym5SbGVIUmJaR1ZzWldkaGRHVXVjbVZ6ZFd4MFRtRnRaVjBnUFNCcGJtWnZMblpoYkhWbE8xeHVYRzRnSUNBZ0lDQXZMeUJTWlhOMWJXVWdaWGhsWTNWMGFXOXVJR0YwSUhSb1pTQmtaWE5wY21Wa0lHeHZZMkYwYVc5dUlDaHpaV1VnWkdWc1pXZGhkR1ZaYVdWc1pDa3VYRzRnSUNBZ0lDQmpiMjUwWlhoMExtNWxlSFFnUFNCa1pXeGxaMkYwWlM1dVpYaDBURzlqTzF4dVhHNGdJQ0FnSUNBdkx5QkpaaUJqYjI1MFpYaDBMbTFsZEdodlpDQjNZWE1nWENKMGFISnZkMXdpSUdKMWRDQjBhR1VnWkdWc1pXZGhkR1VnYUdGdVpHeGxaQ0IwYUdWY2JpQWdJQ0FnSUM4dklHVjRZMlZ3ZEdsdmJpd2diR1YwSUhSb1pTQnZkWFJsY2lCblpXNWxjbUYwYjNJZ2NISnZZMlZsWkNCdWIzSnRZV3hzZVM0Z1NXWmNiaUFnSUNBZ0lDOHZJR052Ym5SbGVIUXViV1YwYUc5a0lIZGhjeUJjSW01bGVIUmNJaXdnWm05eVoyVjBJR052Ym5SbGVIUXVZWEpuSUhOcGJtTmxJR2wwSUdoaGN5QmlaV1Z1WEc0Z0lDQWdJQ0F2THlCY0ltTnZibk4xYldWa1hDSWdZbmtnZEdobElHUmxiR1ZuWVhSbElHbDBaWEpoZEc5eUxpQkpaaUJqYjI1MFpYaDBMbTFsZEdodlpDQjNZWE5jYmlBZ0lDQWdJQzh2SUZ3aWNtVjBkWEp1WENJc0lHRnNiRzkzSUhSb1pTQnZjbWxuYVc1aGJDQXVjbVYwZFhKdUlHTmhiR3dnZEc4Z1kyOXVkR2x1ZFdVZ2FXNGdkR2hsWEc0Z0lDQWdJQ0F2THlCdmRYUmxjaUJuWlc1bGNtRjBiM0l1WEc0Z0lDQWdJQ0JwWmlBb1kyOXVkR1Y0ZEM1dFpYUm9iMlFnSVQwOUlGd2ljbVYwZFhKdVhDSXBJSHRjYmlBZ0lDQWdJQ0FnWTI5dWRHVjRkQzV0WlhSb2IyUWdQU0JjSW01bGVIUmNJanRjYmlBZ0lDQWdJQ0FnWTI5dWRHVjRkQzVoY21jZ1BTQjFibVJsWm1sdVpXUTdYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUNBZ0x5OGdVbVV0ZVdsbGJHUWdkR2hsSUhKbGMzVnNkQ0J5WlhSMWNtNWxaQ0JpZVNCMGFHVWdaR1ZzWldkaGRHVWdiV1YwYUc5a0xseHVJQ0FnSUNBZ2NtVjBkWEp1SUdsdVptODdYRzRnSUNBZ2ZWeHVYRzRnSUNBZ0x5OGdWR2hsSUdSbGJHVm5ZWFJsSUdsMFpYSmhkRzl5SUdseklHWnBibWx6YUdWa0xDQnpieUJtYjNKblpYUWdhWFFnWVc1a0lHTnZiblJwYm5WbElIZHBkR2hjYmlBZ0lDQXZMeUIwYUdVZ2IzVjBaWElnWjJWdVpYSmhkRzl5TGx4dUlDQWdJR052Ym5SbGVIUXVaR1ZzWldkaGRHVWdQU0J1ZFd4c08xeHVJQ0FnSUhKbGRIVnliaUJEYjI1MGFXNTFaVk5sYm5ScGJtVnNPMXh1SUNCOVhHNWNiaUFnTHk4Z1JHVm1hVzVsSUVkbGJtVnlZWFJ2Y2k1d2NtOTBiM1I1Y0dVdWUyNWxlSFFzZEdoeWIzY3NjbVYwZFhKdWZTQnBiaUIwWlhKdGN5QnZaaUIwYUdWY2JpQWdMeThnZFc1cFptbGxaQ0F1WDJsdWRtOXJaU0JvWld4d1pYSWdiV1YwYUc5a0xseHVJQ0JrWldacGJtVkpkR1Z5WVhSdmNrMWxkR2h2WkhNb1IzQXBPMXh1WEc0Z0lHUmxabWx1WlNoSGNDd2dkRzlUZEhKcGJtZFVZV2RUZVcxaWIyd3NJRndpUjJWdVpYSmhkRzl5WENJcE8xeHVYRzRnSUM4dklFRWdSMlZ1WlhKaGRHOXlJSE5vYjNWc1pDQmhiSGRoZVhNZ2NtVjBkWEp1SUdsMGMyVnNaaUJoY3lCMGFHVWdhWFJsY21GMGIzSWdiMkpxWldOMElIZG9aVzRnZEdobFhHNGdJQzh2SUVCQWFYUmxjbUYwYjNJZ1puVnVZM1JwYjI0Z2FYTWdZMkZzYkdWa0lHOXVJR2wwTGlCVGIyMWxJR0p5YjNkelpYSnpKeUJwYlhCc1pXMWxiblJoZEdsdmJuTWdiMllnZEdobFhHNGdJQzh2SUdsMFpYSmhkRzl5SUhCeWIzUnZkSGx3WlNCamFHRnBiaUJwYm1OdmNuSmxZM1JzZVNCcGJYQnNaVzFsYm5RZ2RHaHBjeXdnWTJGMWMybHVaeUIwYUdVZ1IyVnVaWEpoZEc5eVhHNGdJQzh2SUc5aWFtVmpkQ0IwYnlCdWIzUWdZbVVnY21WMGRYSnVaV1FnWm5KdmJTQjBhR2x6SUdOaGJHd3VJRlJvYVhNZ1pXNXpkWEpsY3lCMGFHRjBJR1J2WlhOdUozUWdhR0Z3Y0dWdUxseHVJQ0F2THlCVFpXVWdhSFIwY0hNNkx5OW5hWFJvZFdJdVkyOXRMMlpoWTJWaWIyOXJMM0psWjJWdVpYSmhkRzl5TDJsemMzVmxjeTh5TnpRZ1ptOXlJRzF2Y21VZ1pHVjBZV2xzY3k1Y2JpQWdSM0JiYVhSbGNtRjBiM0pUZVcxaWIyeGRJRDBnWm5WdVkzUnBiMjRvS1NCN1hHNGdJQ0FnY21WMGRYSnVJSFJvYVhNN1hHNGdJSDA3WEc1Y2JpQWdSM0F1ZEc5VGRISnBibWNnUFNCbWRXNWpkR2x2YmlncElIdGNiaUFnSUNCeVpYUjFjbTRnWENKYmIySnFaV04wSUVkbGJtVnlZWFJ2Y2wxY0lqdGNiaUFnZlR0Y2JseHVJQ0JtZFc1amRHbHZiaUJ3ZFhOb1ZISjVSVzUwY25rb2JHOWpjeWtnZTF4dUlDQWdJSFpoY2lCbGJuUnllU0E5SUhzZ2RISjVURzlqT2lCc2IyTnpXekJkSUgwN1hHNWNiaUFnSUNCcFppQW9NU0JwYmlCc2IyTnpLU0I3WEc0Z0lDQWdJQ0JsYm5SeWVTNWpZWFJqYUV4dll5QTlJR3h2WTNOYk1WMDdYRzRnSUNBZ2ZWeHVYRzRnSUNBZ2FXWWdLRElnYVc0Z2JHOWpjeWtnZTF4dUlDQWdJQ0FnWlc1MGNua3VabWx1WVd4c2VVeHZZeUE5SUd4dlkzTmJNbDA3WEc0Z0lDQWdJQ0JsYm5SeWVTNWhablJsY2t4dll5QTlJR3h2WTNOYk0xMDdYRzRnSUNBZ2ZWeHVYRzRnSUNBZ2RHaHBjeTUwY25sRmJuUnlhV1Z6TG5CMWMyZ29aVzUwY25rcE8xeHVJQ0I5WEc1Y2JpQWdablZ1WTNScGIyNGdjbVZ6WlhSVWNubEZiblJ5ZVNobGJuUnllU2tnZTF4dUlDQWdJSFpoY2lCeVpXTnZjbVFnUFNCbGJuUnllUzVqYjIxd2JHVjBhVzl1SUh4OElIdDlPMXh1SUNBZ0lISmxZMjl5WkM1MGVYQmxJRDBnWENKdWIzSnRZV3hjSWp0Y2JpQWdJQ0JrWld4bGRHVWdjbVZqYjNKa0xtRnlaenRjYmlBZ0lDQmxiblJ5ZVM1amIyMXdiR1YwYVc5dUlEMGdjbVZqYjNKa08xeHVJQ0I5WEc1Y2JpQWdablZ1WTNScGIyNGdRMjl1ZEdWNGRDaDBjbmxNYjJOelRHbHpkQ2tnZTF4dUlDQWdJQzh2SUZSb1pTQnliMjkwSUdWdWRISjVJRzlpYW1WamRDQW9aV1ptWldOMGFYWmxiSGtnWVNCMGNua2djM1JoZEdWdFpXNTBJSGRwZEdodmRYUWdZU0JqWVhSamFGeHVJQ0FnSUM4dklHOXlJR0VnWm1sdVlXeHNlU0JpYkc5amF5a2daMmwyWlhNZ2RYTWdZU0J3YkdGalpTQjBieUJ6ZEc5eVpTQjJZV3gxWlhNZ2RHaHliM2R1SUdaeWIyMWNiaUFnSUNBdkx5QnNiMk5oZEdsdmJuTWdkMmhsY21VZ2RHaGxjbVVnYVhNZ2JtOGdaVzVqYkc5emFXNW5JSFJ5ZVNCemRHRjBaVzFsYm5RdVhHNGdJQ0FnZEdocGN5NTBjbmxGYm5SeWFXVnpJRDBnVzNzZ2RISjVURzlqT2lCY0luSnZiM1JjSWlCOVhUdGNiaUFnSUNCMGNubE1iMk56VEdsemRDNW1iM0pGWVdOb0tIQjFjMmhVY25sRmJuUnllU3dnZEdocGN5azdYRzRnSUNBZ2RHaHBjeTV5WlhObGRDaDBjblZsS1R0Y2JpQWdmVnh1WEc0Z0lHVjRjRzl5ZEhNdWEyVjVjeUE5SUdaMWJtTjBhVzl1S0c5aWFtVmpkQ2tnZTF4dUlDQWdJSFpoY2lCclpYbHpJRDBnVzEwN1hHNGdJQ0FnWm05eUlDaDJZWElnYTJWNUlHbHVJRzlpYW1WamRDa2dlMXh1SUNBZ0lDQWdhMlY1Y3k1d2RYTm9LR3RsZVNrN1hHNGdJQ0FnZlZ4dUlDQWdJR3RsZVhNdWNtVjJaWEp6WlNncE8xeHVYRzRnSUNBZ0x5OGdVbUYwYUdWeUlIUm9ZVzRnY21WMGRYSnVhVzVuSUdGdUlHOWlhbVZqZENCM2FYUm9JR0VnYm1WNGRDQnRaWFJvYjJRc0lIZGxJR3RsWlhCY2JpQWdJQ0F2THlCMGFHbHVaM01nYzJsdGNHeGxJR0Z1WkNCeVpYUjFjbTRnZEdobElHNWxlSFFnWm5WdVkzUnBiMjRnYVhSelpXeG1MbHh1SUNBZ0lISmxkSFZ5YmlCbWRXNWpkR2x2YmlCdVpYaDBLQ2tnZTF4dUlDQWdJQ0FnZDJocGJHVWdLR3RsZVhNdWJHVnVaM1JvS1NCN1hHNGdJQ0FnSUNBZ0lIWmhjaUJyWlhrZ1BTQnJaWGx6TG5CdmNDZ3BPMXh1SUNBZ0lDQWdJQ0JwWmlBb2EyVjVJR2x1SUc5aWFtVmpkQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lHNWxlSFF1ZG1Gc2RXVWdQU0JyWlhrN1hHNGdJQ0FnSUNBZ0lDQWdibVY0ZEM1a2IyNWxJRDBnWm1Gc2MyVTdYRzRnSUNBZ0lDQWdJQ0FnY21WMGRYSnVJRzVsZUhRN1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lIMWNibHh1SUNBZ0lDQWdMeThnVkc4Z1lYWnZhV1FnWTNKbFlYUnBibWNnWVc0Z1lXUmthWFJwYjI1aGJDQnZZbXBsWTNRc0lIZGxJR3AxYzNRZ2FHRnVaeUIwYUdVZ0xuWmhiSFZsWEc0Z0lDQWdJQ0F2THlCaGJtUWdMbVJ2Ym1VZ2NISnZjR1Z5ZEdsbGN5QnZabVlnZEdobElHNWxlSFFnWm5WdVkzUnBiMjRnYjJKcVpXTjBJR2wwYzJWc1ppNGdWR2hwYzF4dUlDQWdJQ0FnTHk4Z1lXeHpieUJsYm5OMWNtVnpJSFJvWVhRZ2RHaGxJRzFwYm1sbWFXVnlJSGRwYkd3Z2JtOTBJR0Z1YjI1NWJXbDZaU0IwYUdVZ1puVnVZM1JwYjI0dVhHNGdJQ0FnSUNCdVpYaDBMbVJ2Ym1VZ1BTQjBjblZsTzF4dUlDQWdJQ0FnY21WMGRYSnVJRzVsZUhRN1hHNGdJQ0FnZlR0Y2JpQWdmVHRjYmx4dUlDQm1kVzVqZEdsdmJpQjJZV3gxWlhNb2FYUmxjbUZpYkdVcElIdGNiaUFnSUNCcFppQW9hWFJsY21GaWJHVXBJSHRjYmlBZ0lDQWdJSFpoY2lCcGRHVnlZWFJ2Y2sxbGRHaHZaQ0E5SUdsMFpYSmhZbXhsVzJsMFpYSmhkRzl5VTNsdFltOXNYVHRjYmlBZ0lDQWdJR2xtSUNocGRHVnlZWFJ2Y2sxbGRHaHZaQ2tnZTF4dUlDQWdJQ0FnSUNCeVpYUjFjbTRnYVhSbGNtRjBiM0pOWlhSb2IyUXVZMkZzYkNocGRHVnlZV0pzWlNrN1hHNGdJQ0FnSUNCOVhHNWNiaUFnSUNBZ0lHbG1JQ2gwZVhCbGIyWWdhWFJsY21GaWJHVXVibVY0ZENBOVBUMGdYQ0ptZFc1amRHbHZibHdpS1NCN1hHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCcGRHVnlZV0pzWlR0Y2JpQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ2FXWWdLQ0ZwYzA1aFRpaHBkR1Z5WVdKc1pTNXNaVzVuZEdncEtTQjdYRzRnSUNBZ0lDQWdJSFpoY2lCcElEMGdMVEVzSUc1bGVIUWdQU0JtZFc1amRHbHZiaUJ1WlhoMEtDa2dlMXh1SUNBZ0lDQWdJQ0FnSUhkb2FXeGxJQ2dySzJrZ1BDQnBkR1Z5WVdKc1pTNXNaVzVuZEdncElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUdsbUlDaG9ZWE5QZDI0dVkyRnNiQ2hwZEdWeVlXSnNaU3dnYVNrcElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUNBZ2JtVjRkQzUyWVd4MVpTQTlJR2wwWlhKaFlteGxXMmxkTzF4dUlDQWdJQ0FnSUNBZ0lDQWdJQ0J1WlhoMExtUnZibVVnUFNCbVlXeHpaVHRjYmlBZ0lDQWdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlHNWxlSFE3WEc0Z0lDQWdJQ0FnSUNBZ0lDQjlYRzRnSUNBZ0lDQWdJQ0FnZlZ4dVhHNGdJQ0FnSUNBZ0lDQWdibVY0ZEM1MllXeDFaU0E5SUhWdVpHVm1hVzVsWkR0Y2JpQWdJQ0FnSUNBZ0lDQnVaWGgwTG1SdmJtVWdQU0IwY25WbE8xeHVYRzRnSUNBZ0lDQWdJQ0FnY21WMGRYSnVJRzVsZUhRN1hHNGdJQ0FnSUNBZ0lIMDdYRzVjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJRzVsZUhRdWJtVjRkQ0E5SUc1bGVIUTdYRzRnSUNBZ0lDQjlYRzRnSUNBZ2ZWeHVYRzRnSUNBZ0x5OGdVbVYwZFhKdUlHRnVJR2wwWlhKaGRHOXlJSGRwZEdnZ2JtOGdkbUZzZFdWekxseHVJQ0FnSUhKbGRIVnliaUI3SUc1bGVIUTZJR1J2Ym1WU1pYTjFiSFFnZlR0Y2JpQWdmVnh1SUNCbGVIQnZjblJ6TG5aaGJIVmxjeUE5SUhaaGJIVmxjenRjYmx4dUlDQm1kVzVqZEdsdmJpQmtiMjVsVW1WemRXeDBLQ2tnZTF4dUlDQWdJSEpsZEhWeWJpQjdJSFpoYkhWbE9pQjFibVJsWm1sdVpXUXNJR1J2Ym1VNklIUnlkV1VnZlR0Y2JpQWdmVnh1WEc0Z0lFTnZiblJsZUhRdWNISnZkRzkwZVhCbElEMGdlMXh1SUNBZ0lHTnZibk4wY25WamRHOXlPaUJEYjI1MFpYaDBMRnh1WEc0Z0lDQWdjbVZ6WlhRNklHWjFibU4wYVc5dUtITnJhWEJVWlcxd1VtVnpaWFFwSUh0Y2JpQWdJQ0FnSUhSb2FYTXVjSEpsZGlBOUlEQTdYRzRnSUNBZ0lDQjBhR2x6TG01bGVIUWdQU0F3TzF4dUlDQWdJQ0FnTHk4Z1VtVnpaWFIwYVc1bklHTnZiblJsZUhRdVgzTmxiblFnWm05eUlHeGxaMkZqZVNCemRYQndiM0owSUc5bUlFSmhZbVZzSjNOY2JpQWdJQ0FnSUM4dklHWjFibU4wYVc5dUxuTmxiblFnYVcxd2JHVnRaVzUwWVhScGIyNHVYRzRnSUNBZ0lDQjBhR2x6TG5ObGJuUWdQU0IwYUdsekxsOXpaVzUwSUQwZ2RXNWtaV1pwYm1Wa08xeHVJQ0FnSUNBZ2RHaHBjeTVrYjI1bElEMGdabUZzYzJVN1hHNGdJQ0FnSUNCMGFHbHpMbVJsYkdWbllYUmxJRDBnYm5Wc2JEdGNibHh1SUNBZ0lDQWdkR2hwY3k1dFpYUm9iMlFnUFNCY0ltNWxlSFJjSWp0Y2JpQWdJQ0FnSUhSb2FYTXVZWEpuSUQwZ2RXNWtaV1pwYm1Wa08xeHVYRzRnSUNBZ0lDQjBhR2x6TG5SeWVVVnVkSEpwWlhNdVptOXlSV0ZqYUNoeVpYTmxkRlJ5ZVVWdWRISjVLVHRjYmx4dUlDQWdJQ0FnYVdZZ0tDRnphMmx3VkdWdGNGSmxjMlYwS1NCN1hHNGdJQ0FnSUNBZ0lHWnZjaUFvZG1GeUlHNWhiV1VnYVc0Z2RHaHBjeWtnZTF4dUlDQWdJQ0FnSUNBZ0lDOHZJRTV2ZENCemRYSmxJR0ZpYjNWMElIUm9aU0J2Y0hScGJXRnNJRzl5WkdWeUlHOW1JSFJvWlhObElHTnZibVJwZEdsdmJuTTZYRzRnSUNBZ0lDQWdJQ0FnYVdZZ0tHNWhiV1V1WTJoaGNrRjBLREFwSUQwOVBTQmNJblJjSWlBbUpseHVJQ0FnSUNBZ0lDQWdJQ0FnSUNCb1lYTlBkMjR1WTJGc2JDaDBhR2x6TENCdVlXMWxLU0FtSmx4dUlDQWdJQ0FnSUNBZ0lDQWdJQ0FoYVhOT1lVNG9LMjVoYldVdWMyeHBZMlVvTVNrcEtTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNCMGFHbHpXMjVoYldWZElEMGdkVzVrWldacGJtVmtPMXh1SUNBZ0lDQWdJQ0FnSUgxY2JpQWdJQ0FnSUNBZ2ZWeHVJQ0FnSUNBZ2ZWeHVJQ0FnSUgwc1hHNWNiaUFnSUNCemRHOXdPaUJtZFc1amRHbHZiaWdwSUh0Y2JpQWdJQ0FnSUhSb2FYTXVaRzl1WlNBOUlIUnlkV1U3WEc1Y2JpQWdJQ0FnSUhaaGNpQnliMjkwUlc1MGNua2dQU0IwYUdsekxuUnllVVZ1ZEhKcFpYTmJNRjA3WEc0Z0lDQWdJQ0IyWVhJZ2NtOXZkRkpsWTI5eVpDQTlJSEp2YjNSRmJuUnllUzVqYjIxd2JHVjBhVzl1TzF4dUlDQWdJQ0FnYVdZZ0tISnZiM1JTWldOdmNtUXVkSGx3WlNBOVBUMGdYQ0owYUhKdmQxd2lLU0I3WEc0Z0lDQWdJQ0FnSUhSb2NtOTNJSEp2YjNSU1pXTnZjbVF1WVhKbk8xeHVJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQnlaWFIxY200Z2RHaHBjeTV5ZG1Gc08xeHVJQ0FnSUgwc1hHNWNiaUFnSUNCa2FYTndZWFJqYUVWNFkyVndkR2x2YmpvZ1puVnVZM1JwYjI0b1pYaGpaWEIwYVc5dUtTQjdYRzRnSUNBZ0lDQnBaaUFvZEdocGN5NWtiMjVsS1NCN1hHNGdJQ0FnSUNBZ0lIUm9jbTkzSUdWNFkyVndkR2x2Ymp0Y2JpQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ2RtRnlJR052Ym5SbGVIUWdQU0IwYUdsek8xeHVJQ0FnSUNBZ1puVnVZM1JwYjI0Z2FHRnVaR3hsS0d4dll5d2dZMkYxWjJoMEtTQjdYRzRnSUNBZ0lDQWdJSEpsWTI5eVpDNTBlWEJsSUQwZ1hDSjBhSEp2ZDF3aU8xeHVJQ0FnSUNBZ0lDQnlaV052Y21RdVlYSm5JRDBnWlhoalpYQjBhVzl1TzF4dUlDQWdJQ0FnSUNCamIyNTBaWGgwTG01bGVIUWdQU0JzYjJNN1hHNWNiaUFnSUNBZ0lDQWdhV1lnS0dOaGRXZG9kQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lDOHZJRWxtSUhSb1pTQmthWE53WVhSamFHVmtJR1Y0WTJWd2RHbHZiaUIzWVhNZ1kyRjFaMmgwSUdKNUlHRWdZMkYwWTJnZ1lteHZZMnNzWEc0Z0lDQWdJQ0FnSUNBZ0x5OGdkR2hsYmlCc1pYUWdkR2hoZENCallYUmphQ0JpYkc5amF5Qm9ZVzVrYkdVZ2RHaGxJR1Y0WTJWd2RHbHZiaUJ1YjNKdFlXeHNlUzVjYmlBZ0lDQWdJQ0FnSUNCamIyNTBaWGgwTG0xbGRHaHZaQ0E5SUZ3aWJtVjRkRndpTzF4dUlDQWdJQ0FnSUNBZ0lHTnZiblJsZUhRdVlYSm5JRDBnZFc1a1pXWnBibVZrTzF4dUlDQWdJQ0FnSUNCOVhHNWNiaUFnSUNBZ0lDQWdjbVYwZFhKdUlDRWhJR05oZFdkb2REdGNiaUFnSUNBZ0lIMWNibHh1SUNBZ0lDQWdabTl5SUNoMllYSWdhU0E5SUhSb2FYTXVkSEo1Ulc1MGNtbGxjeTVzWlc1bmRHZ2dMU0F4T3lCcElENDlJREE3SUMwdGFTa2dlMXh1SUNBZ0lDQWdJQ0IyWVhJZ1pXNTBjbmtnUFNCMGFHbHpMblJ5ZVVWdWRISnBaWE5iYVYwN1hHNGdJQ0FnSUNBZ0lIWmhjaUJ5WldOdmNtUWdQU0JsYm5SeWVTNWpiMjF3YkdWMGFXOXVPMXh1WEc0Z0lDQWdJQ0FnSUdsbUlDaGxiblJ5ZVM1MGNubE1iMk1nUFQwOUlGd2ljbTl2ZEZ3aUtTQjdYRzRnSUNBZ0lDQWdJQ0FnTHk4Z1JYaGpaWEIwYVc5dUlIUm9jbTkzYmlCdmRYUnphV1JsSUc5bUlHRnVlU0IwY25rZ1lteHZZMnNnZEdoaGRDQmpiM1ZzWkNCb1lXNWtiR1ZjYmlBZ0lDQWdJQ0FnSUNBdkx5QnBkQ3dnYzI4Z2MyVjBJSFJvWlNCamIyMXdiR1YwYVc5dUlIWmhiSFZsSUc5bUlIUm9aU0JsYm5ScGNtVWdablZ1WTNScGIyNGdkRzljYmlBZ0lDQWdJQ0FnSUNBdkx5QjBhSEp2ZHlCMGFHVWdaWGhqWlhCMGFXOXVMbHh1SUNBZ0lDQWdJQ0FnSUhKbGRIVnliaUJvWVc1a2JHVW9YQ0psYm1SY0lpazdYRzRnSUNBZ0lDQWdJSDFjYmx4dUlDQWdJQ0FnSUNCcFppQW9aVzUwY25rdWRISjVURzlqSUR3OUlIUm9hWE11Y0hKbGRpa2dlMXh1SUNBZ0lDQWdJQ0FnSUhaaGNpQm9ZWE5EWVhSamFDQTlJR2hoYzA5M2JpNWpZV3hzS0dWdWRISjVMQ0JjSW1OaGRHTm9URzlqWENJcE8xeHVJQ0FnSUNBZ0lDQWdJSFpoY2lCb1lYTkdhVzVoYkd4NUlEMGdhR0Z6VDNkdUxtTmhiR3dvWlc1MGNua3NJRndpWm1sdVlXeHNlVXh2WTF3aUtUdGNibHh1SUNBZ0lDQWdJQ0FnSUdsbUlDaG9ZWE5EWVhSamFDQW1KaUJvWVhOR2FXNWhiR3g1S1NCN1hHNGdJQ0FnSUNBZ0lDQWdJQ0JwWmlBb2RHaHBjeTV3Y21WMklEd2daVzUwY25rdVkyRjBZMmhNYjJNcElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUNBZ2NtVjBkWEp1SUdoaGJtUnNaU2hsYm5SeWVTNWpZWFJqYUV4dll5d2dkSEoxWlNrN1hHNGdJQ0FnSUNBZ0lDQWdJQ0I5SUdWc2MyVWdhV1lnS0hSb2FYTXVjSEpsZGlBOElHVnVkSEo1TG1acGJtRnNiSGxNYjJNcElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUNBZ2NtVjBkWEp1SUdoaGJtUnNaU2hsYm5SeWVTNW1hVzVoYkd4NVRHOWpLVHRjYmlBZ0lDQWdJQ0FnSUNBZ0lIMWNibHh1SUNBZ0lDQWdJQ0FnSUgwZ1pXeHpaU0JwWmlBb2FHRnpRMkYwWTJncElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUdsbUlDaDBhR2x6TG5CeVpYWWdQQ0JsYm5SeWVTNWpZWFJqYUV4dll5a2dlMXh1SUNBZ0lDQWdJQ0FnSUNBZ0lDQnlaWFIxY200Z2FHRnVaR3hsS0dWdWRISjVMbU5oZEdOb1RHOWpMQ0IwY25WbEtUdGNiaUFnSUNBZ0lDQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ0lDQWdJSDBnWld4elpTQnBaaUFvYUdGelJtbHVZV3hzZVNrZ2UxeHVJQ0FnSUNBZ0lDQWdJQ0FnYVdZZ0tIUm9hWE11Y0hKbGRpQThJR1Z1ZEhKNUxtWnBibUZzYkhsTWIyTXBJSHRjYmlBZ0lDQWdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlHaGhibVJzWlNobGJuUnllUzVtYVc1aGJHeDVURzlqS1R0Y2JpQWdJQ0FnSUNBZ0lDQWdJSDFjYmx4dUlDQWdJQ0FnSUNBZ0lIMGdaV3h6WlNCN1hHNGdJQ0FnSUNBZ0lDQWdJQ0IwYUhKdmR5QnVaWGNnUlhKeWIzSW9YQ0owY25rZ2MzUmhkR1Z0Wlc1MElIZHBkR2h2ZFhRZ1kyRjBZMmdnYjNJZ1ptbHVZV3hzZVZ3aUtUdGNiaUFnSUNBZ0lDQWdJQ0I5WEc0Z0lDQWdJQ0FnSUgxY2JpQWdJQ0FnSUgxY2JpQWdJQ0I5TEZ4dVhHNGdJQ0FnWVdKeWRYQjBPaUJtZFc1amRHbHZiaWgwZVhCbExDQmhjbWNwSUh0Y2JpQWdJQ0FnSUdadmNpQW9kbUZ5SUdrZ1BTQjBhR2x6TG5SeWVVVnVkSEpwWlhNdWJHVnVaM1JvSUMwZ01Uc2dhU0ErUFNBd095QXRMV2twSUh0Y2JpQWdJQ0FnSUNBZ2RtRnlJR1Z1ZEhKNUlEMGdkR2hwY3k1MGNubEZiblJ5YVdWelcybGRPMXh1SUNBZ0lDQWdJQ0JwWmlBb1pXNTBjbmt1ZEhKNVRHOWpJRHc5SUhSb2FYTXVjSEpsZGlBbUpseHVJQ0FnSUNBZ0lDQWdJQ0FnYUdGelQzZHVMbU5oYkd3b1pXNTBjbmtzSUZ3aVptbHVZV3hzZVV4dlkxd2lLU0FtSmx4dUlDQWdJQ0FnSUNBZ0lDQWdkR2hwY3k1d2NtVjJJRHdnWlc1MGNua3VabWx1WVd4c2VVeHZZeWtnZTF4dUlDQWdJQ0FnSUNBZ0lIWmhjaUJtYVc1aGJHeDVSVzUwY25rZ1BTQmxiblJ5ZVR0Y2JpQWdJQ0FnSUNBZ0lDQmljbVZoYXp0Y2JpQWdJQ0FnSUNBZ2ZWeHVJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQnBaaUFvWm1sdVlXeHNlVVZ1ZEhKNUlDWW1YRzRnSUNBZ0lDQWdJQ0FnS0hSNWNHVWdQVDA5SUZ3aVluSmxZV3RjSWlCOGZGeHVJQ0FnSUNBZ0lDQWdJQ0IwZVhCbElEMDlQU0JjSW1OdmJuUnBiblZsWENJcElDWW1YRzRnSUNBZ0lDQWdJQ0FnWm1sdVlXeHNlVVZ1ZEhKNUxuUnllVXh2WXlBOFBTQmhjbWNnSmlaY2JpQWdJQ0FnSUNBZ0lDQmhjbWNnUEQwZ1ptbHVZV3hzZVVWdWRISjVMbVpwYm1Gc2JIbE1iMk1wSUh0Y2JpQWdJQ0FnSUNBZ0x5OGdTV2R1YjNKbElIUm9aU0JtYVc1aGJHeDVJR1Z1ZEhKNUlHbG1JR052Ym5SeWIyd2dhWE1nYm05MElHcDFiWEJwYm1jZ2RHOGdZVnh1SUNBZ0lDQWdJQ0F2THlCc2IyTmhkR2x2YmlCdmRYUnphV1JsSUhSb1pTQjBjbmt2WTJGMFkyZ2dZbXh2WTJzdVhHNGdJQ0FnSUNBZ0lHWnBibUZzYkhsRmJuUnllU0E5SUc1MWJHdzdYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJSFpoY2lCeVpXTnZjbVFnUFNCbWFXNWhiR3g1Ulc1MGNua2dQeUJtYVc1aGJHeDVSVzUwY25rdVkyOXRjR3hsZEdsdmJpQTZJSHQ5TzF4dUlDQWdJQ0FnY21WamIzSmtMblI1Y0dVZ1BTQjBlWEJsTzF4dUlDQWdJQ0FnY21WamIzSmtMbUZ5WnlBOUlHRnlaenRjYmx4dUlDQWdJQ0FnYVdZZ0tHWnBibUZzYkhsRmJuUnllU2tnZTF4dUlDQWdJQ0FnSUNCMGFHbHpMbTFsZEdodlpDQTlJRndpYm1WNGRGd2lPMXh1SUNBZ0lDQWdJQ0IwYUdsekxtNWxlSFFnUFNCbWFXNWhiR3g1Ulc1MGNua3VabWx1WVd4c2VVeHZZenRjYmlBZ0lDQWdJQ0FnY21WMGRYSnVJRU52Ym5ScGJuVmxVMlZ1ZEdsdVpXdzdYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJSEpsZEhWeWJpQjBhR2x6TG1OdmJYQnNaWFJsS0hKbFkyOXlaQ2s3WEc0Z0lDQWdmU3hjYmx4dUlDQWdJR052YlhCc1pYUmxPaUJtZFc1amRHbHZiaWh5WldOdmNtUXNJR0ZtZEdWeVRHOWpLU0I3WEc0Z0lDQWdJQ0JwWmlBb2NtVmpiM0prTG5SNWNHVWdQVDA5SUZ3aWRHaHliM2RjSWlrZ2UxeHVJQ0FnSUNBZ0lDQjBhSEp2ZHlCeVpXTnZjbVF1WVhKbk8xeHVJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQnBaaUFvY21WamIzSmtMblI1Y0dVZ1BUMDlJRndpWW5KbFlXdGNJaUI4ZkZ4dUlDQWdJQ0FnSUNBZ0lISmxZMjl5WkM1MGVYQmxJRDA5UFNCY0ltTnZiblJwYm5WbFhDSXBJSHRjYmlBZ0lDQWdJQ0FnZEdocGN5NXVaWGgwSUQwZ2NtVmpiM0prTG1GeVp6dGNiaUFnSUNBZ0lIMGdaV3h6WlNCcFppQW9jbVZqYjNKa0xuUjVjR1VnUFQwOUlGd2ljbVYwZFhKdVhDSXBJSHRjYmlBZ0lDQWdJQ0FnZEdocGN5NXlkbUZzSUQwZ2RHaHBjeTVoY21jZ1BTQnlaV052Y21RdVlYSm5PMXh1SUNBZ0lDQWdJQ0IwYUdsekxtMWxkR2h2WkNBOUlGd2ljbVYwZFhKdVhDSTdYRzRnSUNBZ0lDQWdJSFJvYVhNdWJtVjRkQ0E5SUZ3aVpXNWtYQ0k3WEc0Z0lDQWdJQ0I5SUdWc2MyVWdhV1lnS0hKbFkyOXlaQzUwZVhCbElEMDlQU0JjSW01dmNtMWhiRndpSUNZbUlHRm1kR1Z5VEc5aktTQjdYRzRnSUNBZ0lDQWdJSFJvYVhNdWJtVjRkQ0E5SUdGbWRHVnlURzlqTzF4dUlDQWdJQ0FnZlZ4dVhHNGdJQ0FnSUNCeVpYUjFjbTRnUTI5dWRHbHVkV1ZUWlc1MGFXNWxiRHRjYmlBZ0lDQjlMRnh1WEc0Z0lDQWdabWx1YVhOb09pQm1kVzVqZEdsdmJpaG1hVzVoYkd4NVRHOWpLU0I3WEc0Z0lDQWdJQ0JtYjNJZ0tIWmhjaUJwSUQwZ2RHaHBjeTUwY25sRmJuUnlhV1Z6TG14bGJtZDBhQ0F0SURFN0lHa2dQajBnTURzZ0xTMXBLU0I3WEc0Z0lDQWdJQ0FnSUhaaGNpQmxiblJ5ZVNBOUlIUm9hWE11ZEhKNVJXNTBjbWxsYzF0cFhUdGNiaUFnSUNBZ0lDQWdhV1lnS0dWdWRISjVMbVpwYm1Gc2JIbE1iMk1nUFQwOUlHWnBibUZzYkhsTWIyTXBJSHRjYmlBZ0lDQWdJQ0FnSUNCMGFHbHpMbU52YlhCc1pYUmxLR1Z1ZEhKNUxtTnZiWEJzWlhScGIyNHNJR1Z1ZEhKNUxtRm1kR1Z5VEc5aktUdGNiaUFnSUNBZ0lDQWdJQ0J5WlhObGRGUnllVVZ1ZEhKNUtHVnVkSEo1S1R0Y2JpQWdJQ0FnSUNBZ0lDQnlaWFIxY200Z1EyOXVkR2x1ZFdWVFpXNTBhVzVsYkR0Y2JpQWdJQ0FnSUNBZ2ZWeHVJQ0FnSUNBZ2ZWeHVJQ0FnSUgwc1hHNWNiaUFnSUNCY0ltTmhkR05vWENJNklHWjFibU4wYVc5dUtIUnllVXh2WXlrZ2UxeHVJQ0FnSUNBZ1ptOXlJQ2gyWVhJZ2FTQTlJSFJvYVhNdWRISjVSVzUwY21sbGN5NXNaVzVuZEdnZ0xTQXhPeUJwSUQ0OUlEQTdJQzB0YVNrZ2UxeHVJQ0FnSUNBZ0lDQjJZWElnWlc1MGNua2dQU0IwYUdsekxuUnllVVZ1ZEhKcFpYTmJhVjA3WEc0Z0lDQWdJQ0FnSUdsbUlDaGxiblJ5ZVM1MGNubE1iMk1nUFQwOUlIUnllVXh2WXlrZ2UxeHVJQ0FnSUNBZ0lDQWdJSFpoY2lCeVpXTnZjbVFnUFNCbGJuUnllUzVqYjIxd2JHVjBhVzl1TzF4dUlDQWdJQ0FnSUNBZ0lHbG1JQ2h5WldOdmNtUXVkSGx3WlNBOVBUMGdYQ0owYUhKdmQxd2lLU0I3WEc0Z0lDQWdJQ0FnSUNBZ0lDQjJZWElnZEdoeWIzZHVJRDBnY21WamIzSmtMbUZ5Wnp0Y2JpQWdJQ0FnSUNBZ0lDQWdJSEpsYzJWMFZISjVSVzUwY25rb1pXNTBjbmtwTzF4dUlDQWdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lDQWdJQ0J5WlhSMWNtNGdkR2h5YjNkdU8xeHVJQ0FnSUNBZ0lDQjlYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJQzh2SUZSb1pTQmpiMjUwWlhoMExtTmhkR05vSUcxbGRHaHZaQ0J0ZFhOMElHOXViSGtnWW1VZ1kyRnNiR1ZrSUhkcGRHZ2dZU0JzYjJOaGRHbHZibHh1SUNBZ0lDQWdMeThnWVhKbmRXMWxiblFnZEdoaGRDQmpiM0p5WlhOd2IyNWtjeUIwYnlCaElHdHViM2R1SUdOaGRHTm9JR0pzYjJOckxseHVJQ0FnSUNBZ2RHaHliM2NnYm1WM0lFVnljbTl5S0Z3aWFXeHNaV2RoYkNCallYUmphQ0JoZEhSbGJYQjBYQ0lwTzF4dUlDQWdJSDBzWEc1Y2JpQWdJQ0JrWld4bFoyRjBaVmxwWld4a09pQm1kVzVqZEdsdmJpaHBkR1Z5WVdKc1pTd2djbVZ6ZFd4MFRtRnRaU3dnYm1WNGRFeHZZeWtnZTF4dUlDQWdJQ0FnZEdocGN5NWtaV3hsWjJGMFpTQTlJSHRjYmlBZ0lDQWdJQ0FnYVhSbGNtRjBiM0k2SUhaaGJIVmxjeWhwZEdWeVlXSnNaU2tzWEc0Z0lDQWdJQ0FnSUhKbGMzVnNkRTVoYldVNklISmxjM1ZzZEU1aGJXVXNYRzRnSUNBZ0lDQWdJRzVsZUhSTWIyTTZJRzVsZUhSTWIyTmNiaUFnSUNBZ0lIMDdYRzVjYmlBZ0lDQWdJR2xtSUNoMGFHbHpMbTFsZEdodlpDQTlQVDBnWENKdVpYaDBYQ0lwSUh0Y2JpQWdJQ0FnSUNBZ0x5OGdSR1ZzYVdKbGNtRjBaV3g1SUdadmNtZGxkQ0IwYUdVZ2JHRnpkQ0J6Wlc1MElIWmhiSFZsSUhOdklIUm9ZWFFnZDJVZ1pHOXVKM1JjYmlBZ0lDQWdJQ0FnTHk4Z1lXTmphV1JsYm5SaGJHeDVJSEJoYzNNZ2FYUWdiMjRnZEc4Z2RHaGxJR1JsYkdWbllYUmxMbHh1SUNBZ0lDQWdJQ0IwYUdsekxtRnlaeUE5SUhWdVpHVm1hVzVsWkR0Y2JpQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ2NtVjBkWEp1SUVOdmJuUnBiblZsVTJWdWRHbHVaV3c3WEc0Z0lDQWdmVnh1SUNCOU8xeHVYRzRnSUM4dklGSmxaMkZ5Wkd4bGMzTWdiMllnZDJobGRHaGxjaUIwYUdseklITmpjbWx3ZENCcGN5QmxlR1ZqZFhScGJtY2dZWE1nWVNCRGIyMXRiMjVLVXlCdGIyUjFiR1ZjYmlBZ0x5OGdiM0lnYm05MExDQnlaWFIxY200Z2RHaGxJSEoxYm5ScGJXVWdiMkpxWldOMElITnZJSFJvWVhRZ2QyVWdZMkZ1SUdSbFkyeGhjbVVnZEdobElIWmhjbWxoWW14bFhHNGdJQzh2SUhKbFoyVnVaWEpoZEc5eVVuVnVkR2x0WlNCcGJpQjBhR1VnYjNWMFpYSWdjMk52Y0dVc0lIZG9hV05vSUdGc2JHOTNjeUIwYUdseklHMXZaSFZzWlNCMGJ5QmlaVnh1SUNBdkx5QnBibXBsWTNSbFpDQmxZWE5wYkhrZ1lua2dZR0pwYmk5eVpXZGxibVZ5WVhSdmNpQXRMV2x1WTJ4MVpHVXRjblZ1ZEdsdFpTQnpZM0pwY0hRdWFuTmdMbHh1SUNCeVpYUjFjbTRnWlhod2IzSjBjenRjYmx4dWZTaGNiaUFnTHk4Z1NXWWdkR2hwY3lCelkzSnBjSFFnYVhNZ1pYaGxZM1YwYVc1bklHRnpJR0VnUTI5dGJXOXVTbE1nYlc5a2RXeGxMQ0IxYzJVZ2JXOWtkV3hsTG1WNGNHOXlkSE5jYmlBZ0x5OGdZWE1nZEdobElISmxaMlZ1WlhKaGRHOXlVblZ1ZEdsdFpTQnVZVzFsYzNCaFkyVXVJRTkwYUdWeWQybHpaU0JqY21WaGRHVWdZU0J1WlhjZ1pXMXdkSGxjYmlBZ0x5OGdiMkpxWldOMExpQkZhWFJvWlhJZ2QyRjVMQ0IwYUdVZ2NtVnpkV3gwYVc1bklHOWlhbVZqZENCM2FXeHNJR0psSUhWelpXUWdkRzhnYVc1cGRHbGhiR2w2WlZ4dUlDQXZMeUIwYUdVZ2NtVm5aVzVsY21GMGIzSlNkVzUwYVcxbElIWmhjbWxoWW14bElHRjBJSFJvWlNCMGIzQWdiMllnZEdocGN5Qm1hV3hsTGx4dUlDQjBlWEJsYjJZZ2JXOWtkV3hsSUQwOVBTQmNJbTlpYW1WamRGd2lJRDhnYlc5a2RXeGxMbVY0Y0c5eWRITWdPaUI3ZlZ4dUtTazdYRzVjYm5SeWVTQjdYRzRnSUhKbFoyVnVaWEpoZEc5eVVuVnVkR2x0WlNBOUlISjFiblJwYldVN1hHNTlJR05oZEdOb0lDaGhZMk5wWkdWdWRHRnNVM1J5YVdOMFRXOWtaU2tnZTF4dUlDQXZMeUJVYUdseklHMXZaSFZzWlNCemFHOTFiR1FnYm05MElHSmxJSEoxYm01cGJtY2dhVzRnYzNSeWFXTjBJRzF2WkdVc0lITnZJSFJvWlNCaFltOTJaVnh1SUNBdkx5QmhjM05wWjI1dFpXNTBJSE5vYjNWc1pDQmhiSGRoZVhNZ2QyOXlheUIxYm14bGMzTWdjMjl0WlhSb2FXNW5JR2x6SUcxcGMyTnZibVpwWjNWeVpXUXVJRXAxYzNSY2JpQWdMeThnYVc0Z1kyRnpaU0J5ZFc1MGFXMWxMbXB6SUdGalkybGtaVzUwWVd4c2VTQnlkVzV6SUdsdUlITjBjbWxqZENCdGIyUmxMQ0IzWlNCallXNGdaWE5qWVhCbFhHNGdJQzh2SUhOMGNtbGpkQ0J0YjJSbElIVnphVzVuSUdFZ1oyeHZZbUZzSUVaMWJtTjBhVzl1SUdOaGJHd3VJRlJvYVhNZ1kyOTFiR1FnWTI5dVkyVnBkbUZpYkhrZ1ptRnBiRnh1SUNBdkx5QnBaaUJoSUVOdmJuUmxiblFnVTJWamRYSnBkSGtnVUc5c2FXTjVJR1p2Y21KcFpITWdkWE5wYm1jZ1JuVnVZM1JwYjI0c0lHSjFkQ0JwYmlCMGFHRjBJR05oYzJWY2JpQWdMeThnZEdobElIQnliM0JsY2lCemIyeDFkR2x2YmlCcGN5QjBieUJtYVhnZ2RHaGxJR0ZqWTJsa1pXNTBZV3dnYzNSeWFXTjBJRzF2WkdVZ2NISnZZbXhsYlM0Z1NXWmNiaUFnTHk4Z2VXOTFKM1psSUcxcGMyTnZibVpwWjNWeVpXUWdlVzkxY2lCaWRXNWtiR1Z5SUhSdklHWnZjbU5sSUhOMGNtbGpkQ0J0YjJSbElHRnVaQ0JoY0hCc2FXVmtJR0ZjYmlBZ0x5OGdRMU5RSUhSdklHWnZjbUpwWkNCR2RXNWpkR2x2Yml3Z1lXNWtJSGx2ZFNkeVpTQnViM1FnZDJsc2JHbHVaeUIwYnlCbWFYZ2daV2wwYUdWeUlHOW1JSFJvYjNObFhHNGdJQzh2SUhCeWIySnNaVzF6TENCd2JHVmhjMlVnWkdWMFlXbHNJSGx2ZFhJZ2RXNXBjWFZsSUhCeVpXUnBZMkZ0Wlc1MElHbHVJR0VnUjJsMFNIVmlJR2x6YzNWbExseHVJQ0JHZFc1amRHbHZiaWhjSW5KY0lpd2dYQ0p5WldkbGJtVnlZWFJ2Y2xKMWJuUnBiV1VnUFNCeVhDSXBLSEoxYm5ScGJXVXBPMXh1ZlZ4dUlpd2lhVzF3YjNKMElDZHlaV2RsYm1WeVlYUnZjaTF5ZFc1MGFXMWxMM0oxYm5ScGJXVW5PMXh5WEc1Y2NseHVZMjl1YzNRZ2IzVjBjSFYwSUQwZ1pHOWpkVzFsYm5RdVoyVjBSV3hsYldWdWRFSjVTV1FvSjJKc2IyTnJKeWxjY2x4dVhISmNibHh5WEc1amIyNXpkQ0JuWlhSRVlYUmhJRDBnWVhONWJtTWdLQ2tnUFQ0Z2UxeHlYRzRnSUNBZ1kyOXVjM1FnY21WeklEMGdZWGRoYVhRZ1ptVjBZMmdnS0Nkb2RIUndjem92TDJwemIyNXdiR0ZqWldodmJHUmxjaTUwZVhCcFkyOWtaUzVqYjIwdmRHOWtiM01uS1Z4eVhHNGdJQ0FnWTI5dWMzUWdjR0Z5YzJWa1VtVnpJRDBnWVhkaGFYUWdjbVZ6TG1wemIyNG9LVHRjY2x4dUlDQWdYSEpjYmlBZ0lHOTFkSEIxZEM1cGJtNWxja2hVVFV3Z1BTQndZWEp6WldSU1pYTXViV0Z3S0NoN2RHbDBiR1VzSUdsa2ZTa2dQVDVjY2x4dUlDQWdleUJ5WlhSMWNtNGdZRnh5WEc0Z0lDQThaR2wySUdOc1lYTnpQVndpWTJGeVpGd2lQaUFrZTJsa2ZTQThMMlJwZGo1Y2NseHVJQ0FnUEhBZ1kyeGhjM005WENKa1pYTmpYQ0krSkh0MGFYUnNaWDA4TDNBK1lIMHBYSEpjYmlBZ0lGeHlYRzRnSUNCY2NseHVJQ0FnSUM4dlkyOXVjMjlzWlM1c2IyY2dLSEJoY25ObFpGSmxjeWs3WEhKY2JpQWdJQ0F2TDJSdlkzVnRaVzUwTG1KdlpIa3VhVzV1WlhKSVZFMU1JRDBnWUR4b01qNGtlM0JoY25ObFpGSmxjeTV2Y21sbmFXNWhiRjkwYVhSc1pYMDhMMmd5UGp4d1BpUjdjR0Z5YzJWa1VtVnpMbTkyWlhKMmFXVjNmVHd2Y0Q1Z1hISmNiaUFnSUNCeVpYUjFjbTRnY0dGeWMyVmtVbVZ6TzF4eVhHNTlYSEpjYmx4eVhHNW5aWFJFWVhSaElDZ3BYSEpjYmx4eVhHNHZMMk52Ym5OdmJHVXViRzluSUNoblpYUkVZWFJoS1RzaVhYMD0ifQ==
