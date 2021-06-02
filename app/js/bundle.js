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

var getData = /*#__PURE__*/function () {
  var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee() {
    var res, parsedRes;
    return regeneratorRuntime.wrap(function _callee$(_context) {
      while (1) {
        switch (_context.prev = _context.next) {
          case 0:
            _context.next = 2;
            return fetch('https://api.themoviedb.org/3/movie/550?api_key=9db8124a79195d07277ab6cc8e55752d');

          case 2:
            res = _context.sent;
            parsedRes = res.json();
            console.log(parsedRes);

          case 5:
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

//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvcmVnZW5lcmF0b3ItcnVudGltZS9ydW50aW1lLmpzIiwicHJvamVjdHMvYWpheC9zcmMvanMvYXBwLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzV1QkE7Ozs7OztBQUVBLElBQU0sT0FBTztBQUFBLHFFQUFHO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsbUJBQ00sS0FBSyxDQUFFLGlGQUFGLENBRFg7O0FBQUE7QUFDTixZQUFBLEdBRE07QUFFTixZQUFBLFNBRk0sR0FFTSxHQUFHLENBQUMsSUFBSixFQUZOO0FBR1osWUFBQSxPQUFPLENBQUMsR0FBUixDQUFhLFNBQWI7O0FBSFk7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsR0FBSDs7QUFBQSxrQkFBUCxPQUFPO0FBQUE7QUFBQTtBQUFBLEdBQWI7O0FBTUEsT0FBTyxHLENBRVAiLCJmaWxlIjoiYnVuZGxlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsIi8qKlxuICogQ29weXJpZ2h0IChjKSAyMDE0LXByZXNlbnQsIEZhY2Vib29rLCBJbmMuXG4gKlxuICogVGhpcyBzb3VyY2UgY29kZSBpcyBsaWNlbnNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2UgZm91bmQgaW4gdGhlXG4gKiBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZGlyZWN0b3J5IG9mIHRoaXMgc291cmNlIHRyZWUuXG4gKi9cblxudmFyIHJ1bnRpbWUgPSAoZnVuY3Rpb24gKGV4cG9ydHMpIHtcbiAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgdmFyIE9wID0gT2JqZWN0LnByb3RvdHlwZTtcbiAgdmFyIGhhc093biA9IE9wLmhhc093blByb3BlcnR5O1xuICB2YXIgdW5kZWZpbmVkOyAvLyBNb3JlIGNvbXByZXNzaWJsZSB0aGFuIHZvaWQgMC5cbiAgdmFyICRTeW1ib2wgPSB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgPyBTeW1ib2wgOiB7fTtcbiAgdmFyIGl0ZXJhdG9yU3ltYm9sID0gJFN5bWJvbC5pdGVyYXRvciB8fCBcIkBAaXRlcmF0b3JcIjtcbiAgdmFyIGFzeW5jSXRlcmF0b3JTeW1ib2wgPSAkU3ltYm9sLmFzeW5jSXRlcmF0b3IgfHwgXCJAQGFzeW5jSXRlcmF0b3JcIjtcbiAgdmFyIHRvU3RyaW5nVGFnU3ltYm9sID0gJFN5bWJvbC50b1N0cmluZ1RhZyB8fCBcIkBAdG9TdHJpbmdUYWdcIjtcblxuICBmdW5jdGlvbiBkZWZpbmUob2JqLCBrZXksIHZhbHVlKSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwga2V5LCB7XG4gICAgICB2YWx1ZTogdmFsdWUsXG4gICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgd3JpdGFibGU6IHRydWVcbiAgICB9KTtcbiAgICByZXR1cm4gb2JqW2tleV07XG4gIH1cbiAgdHJ5IHtcbiAgICAvLyBJRSA4IGhhcyBhIGJyb2tlbiBPYmplY3QuZGVmaW5lUHJvcGVydHkgdGhhdCBvbmx5IHdvcmtzIG9uIERPTSBvYmplY3RzLlxuICAgIGRlZmluZSh7fSwgXCJcIik7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGRlZmluZSA9IGZ1bmN0aW9uKG9iaiwga2V5LCB2YWx1ZSkge1xuICAgICAgcmV0dXJuIG9ialtrZXldID0gdmFsdWU7XG4gICAgfTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHdyYXAoaW5uZXJGbiwgb3V0ZXJGbiwgc2VsZiwgdHJ5TG9jc0xpc3QpIHtcbiAgICAvLyBJZiBvdXRlckZuIHByb3ZpZGVkIGFuZCBvdXRlckZuLnByb3RvdHlwZSBpcyBhIEdlbmVyYXRvciwgdGhlbiBvdXRlckZuLnByb3RvdHlwZSBpbnN0YW5jZW9mIEdlbmVyYXRvci5cbiAgICB2YXIgcHJvdG9HZW5lcmF0b3IgPSBvdXRlckZuICYmIG91dGVyRm4ucHJvdG90eXBlIGluc3RhbmNlb2YgR2VuZXJhdG9yID8gb3V0ZXJGbiA6IEdlbmVyYXRvcjtcbiAgICB2YXIgZ2VuZXJhdG9yID0gT2JqZWN0LmNyZWF0ZShwcm90b0dlbmVyYXRvci5wcm90b3R5cGUpO1xuICAgIHZhciBjb250ZXh0ID0gbmV3IENvbnRleHQodHJ5TG9jc0xpc3QgfHwgW10pO1xuXG4gICAgLy8gVGhlIC5faW52b2tlIG1ldGhvZCB1bmlmaWVzIHRoZSBpbXBsZW1lbnRhdGlvbnMgb2YgdGhlIC5uZXh0LFxuICAgIC8vIC50aHJvdywgYW5kIC5yZXR1cm4gbWV0aG9kcy5cbiAgICBnZW5lcmF0b3IuX2ludm9rZSA9IG1ha2VJbnZva2VNZXRob2QoaW5uZXJGbiwgc2VsZiwgY29udGV4dCk7XG5cbiAgICByZXR1cm4gZ2VuZXJhdG9yO1xuICB9XG4gIGV4cG9ydHMud3JhcCA9IHdyYXA7XG5cbiAgLy8gVHJ5L2NhdGNoIGhlbHBlciB0byBtaW5pbWl6ZSBkZW9wdGltaXphdGlvbnMuIFJldHVybnMgYSBjb21wbGV0aW9uXG4gIC8vIHJlY29yZCBsaWtlIGNvbnRleHQudHJ5RW50cmllc1tpXS5jb21wbGV0aW9uLiBUaGlzIGludGVyZmFjZSBjb3VsZFxuICAvLyBoYXZlIGJlZW4gKGFuZCB3YXMgcHJldmlvdXNseSkgZGVzaWduZWQgdG8gdGFrZSBhIGNsb3N1cmUgdG8gYmVcbiAgLy8gaW52b2tlZCB3aXRob3V0IGFyZ3VtZW50cywgYnV0IGluIGFsbCB0aGUgY2FzZXMgd2UgY2FyZSBhYm91dCB3ZVxuICAvLyBhbHJlYWR5IGhhdmUgYW4gZXhpc3RpbmcgbWV0aG9kIHdlIHdhbnQgdG8gY2FsbCwgc28gdGhlcmUncyBubyBuZWVkXG4gIC8vIHRvIGNyZWF0ZSBhIG5ldyBmdW5jdGlvbiBvYmplY3QuIFdlIGNhbiBldmVuIGdldCBhd2F5IHdpdGggYXNzdW1pbmdcbiAgLy8gdGhlIG1ldGhvZCB0YWtlcyBleGFjdGx5IG9uZSBhcmd1bWVudCwgc2luY2UgdGhhdCBoYXBwZW5zIHRvIGJlIHRydWVcbiAgLy8gaW4gZXZlcnkgY2FzZSwgc28gd2UgZG9uJ3QgaGF2ZSB0byB0b3VjaCB0aGUgYXJndW1lbnRzIG9iamVjdC4gVGhlXG4gIC8vIG9ubHkgYWRkaXRpb25hbCBhbGxvY2F0aW9uIHJlcXVpcmVkIGlzIHRoZSBjb21wbGV0aW9uIHJlY29yZCwgd2hpY2hcbiAgLy8gaGFzIGEgc3RhYmxlIHNoYXBlIGFuZCBzbyBob3BlZnVsbHkgc2hvdWxkIGJlIGNoZWFwIHRvIGFsbG9jYXRlLlxuICBmdW5jdGlvbiB0cnlDYXRjaChmbiwgb2JqLCBhcmcpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHsgdHlwZTogXCJub3JtYWxcIiwgYXJnOiBmbi5jYWxsKG9iaiwgYXJnKSB9O1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgcmV0dXJuIHsgdHlwZTogXCJ0aHJvd1wiLCBhcmc6IGVyciB9O1xuICAgIH1cbiAgfVxuXG4gIHZhciBHZW5TdGF0ZVN1c3BlbmRlZFN0YXJ0ID0gXCJzdXNwZW5kZWRTdGFydFwiO1xuICB2YXIgR2VuU3RhdGVTdXNwZW5kZWRZaWVsZCA9IFwic3VzcGVuZGVkWWllbGRcIjtcbiAgdmFyIEdlblN0YXRlRXhlY3V0aW5nID0gXCJleGVjdXRpbmdcIjtcbiAgdmFyIEdlblN0YXRlQ29tcGxldGVkID0gXCJjb21wbGV0ZWRcIjtcblxuICAvLyBSZXR1cm5pbmcgdGhpcyBvYmplY3QgZnJvbSB0aGUgaW5uZXJGbiBoYXMgdGhlIHNhbWUgZWZmZWN0IGFzXG4gIC8vIGJyZWFraW5nIG91dCBvZiB0aGUgZGlzcGF0Y2ggc3dpdGNoIHN0YXRlbWVudC5cbiAgdmFyIENvbnRpbnVlU2VudGluZWwgPSB7fTtcblxuICAvLyBEdW1teSBjb25zdHJ1Y3RvciBmdW5jdGlvbnMgdGhhdCB3ZSB1c2UgYXMgdGhlIC5jb25zdHJ1Y3RvciBhbmRcbiAgLy8gLmNvbnN0cnVjdG9yLnByb3RvdHlwZSBwcm9wZXJ0aWVzIGZvciBmdW5jdGlvbnMgdGhhdCByZXR1cm4gR2VuZXJhdG9yXG4gIC8vIG9iamVjdHMuIEZvciBmdWxsIHNwZWMgY29tcGxpYW5jZSwgeW91IG1heSB3aXNoIHRvIGNvbmZpZ3VyZSB5b3VyXG4gIC8vIG1pbmlmaWVyIG5vdCB0byBtYW5nbGUgdGhlIG5hbWVzIG9mIHRoZXNlIHR3byBmdW5jdGlvbnMuXG4gIGZ1bmN0aW9uIEdlbmVyYXRvcigpIHt9XG4gIGZ1bmN0aW9uIEdlbmVyYXRvckZ1bmN0aW9uKCkge31cbiAgZnVuY3Rpb24gR2VuZXJhdG9yRnVuY3Rpb25Qcm90b3R5cGUoKSB7fVxuXG4gIC8vIFRoaXMgaXMgYSBwb2x5ZmlsbCBmb3IgJUl0ZXJhdG9yUHJvdG90eXBlJSBmb3IgZW52aXJvbm1lbnRzIHRoYXRcbiAgLy8gZG9uJ3QgbmF0aXZlbHkgc3VwcG9ydCBpdC5cbiAgdmFyIEl0ZXJhdG9yUHJvdG90eXBlID0ge307XG4gIEl0ZXJhdG9yUHJvdG90eXBlW2l0ZXJhdG9yU3ltYm9sXSA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfTtcblxuICB2YXIgZ2V0UHJvdG8gPSBPYmplY3QuZ2V0UHJvdG90eXBlT2Y7XG4gIHZhciBOYXRpdmVJdGVyYXRvclByb3RvdHlwZSA9IGdldFByb3RvICYmIGdldFByb3RvKGdldFByb3RvKHZhbHVlcyhbXSkpKTtcbiAgaWYgKE5hdGl2ZUl0ZXJhdG9yUHJvdG90eXBlICYmXG4gICAgICBOYXRpdmVJdGVyYXRvclByb3RvdHlwZSAhPT0gT3AgJiZcbiAgICAgIGhhc093bi5jYWxsKE5hdGl2ZUl0ZXJhdG9yUHJvdG90eXBlLCBpdGVyYXRvclN5bWJvbCkpIHtcbiAgICAvLyBUaGlzIGVudmlyb25tZW50IGhhcyBhIG5hdGl2ZSAlSXRlcmF0b3JQcm90b3R5cGUlOyB1c2UgaXQgaW5zdGVhZFxuICAgIC8vIG9mIHRoZSBwb2x5ZmlsbC5cbiAgICBJdGVyYXRvclByb3RvdHlwZSA9IE5hdGl2ZUl0ZXJhdG9yUHJvdG90eXBlO1xuICB9XG5cbiAgdmFyIEdwID0gR2VuZXJhdG9yRnVuY3Rpb25Qcm90b3R5cGUucHJvdG90eXBlID1cbiAgICBHZW5lcmF0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShJdGVyYXRvclByb3RvdHlwZSk7XG4gIEdlbmVyYXRvckZ1bmN0aW9uLnByb3RvdHlwZSA9IEdwLmNvbnN0cnVjdG9yID0gR2VuZXJhdG9yRnVuY3Rpb25Qcm90b3R5cGU7XG4gIEdlbmVyYXRvckZ1bmN0aW9uUHJvdG90eXBlLmNvbnN0cnVjdG9yID0gR2VuZXJhdG9yRnVuY3Rpb247XG4gIEdlbmVyYXRvckZ1bmN0aW9uLmRpc3BsYXlOYW1lID0gZGVmaW5lKFxuICAgIEdlbmVyYXRvckZ1bmN0aW9uUHJvdG90eXBlLFxuICAgIHRvU3RyaW5nVGFnU3ltYm9sLFxuICAgIFwiR2VuZXJhdG9yRnVuY3Rpb25cIlxuICApO1xuXG4gIC8vIEhlbHBlciBmb3IgZGVmaW5pbmcgdGhlIC5uZXh0LCAudGhyb3csIGFuZCAucmV0dXJuIG1ldGhvZHMgb2YgdGhlXG4gIC8vIEl0ZXJhdG9yIGludGVyZmFjZSBpbiB0ZXJtcyBvZiBhIHNpbmdsZSAuX2ludm9rZSBtZXRob2QuXG4gIGZ1bmN0aW9uIGRlZmluZUl0ZXJhdG9yTWV0aG9kcyhwcm90b3R5cGUpIHtcbiAgICBbXCJuZXh0XCIsIFwidGhyb3dcIiwgXCJyZXR1cm5cIl0uZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgIGRlZmluZShwcm90b3R5cGUsIG1ldGhvZCwgZnVuY3Rpb24oYXJnKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9pbnZva2UobWV0aG9kLCBhcmcpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBleHBvcnRzLmlzR2VuZXJhdG9yRnVuY3Rpb24gPSBmdW5jdGlvbihnZW5GdW4pIHtcbiAgICB2YXIgY3RvciA9IHR5cGVvZiBnZW5GdW4gPT09IFwiZnVuY3Rpb25cIiAmJiBnZW5GdW4uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGN0b3JcbiAgICAgID8gY3RvciA9PT0gR2VuZXJhdG9yRnVuY3Rpb24gfHxcbiAgICAgICAgLy8gRm9yIHRoZSBuYXRpdmUgR2VuZXJhdG9yRnVuY3Rpb24gY29uc3RydWN0b3IsIHRoZSBiZXN0IHdlIGNhblxuICAgICAgICAvLyBkbyBpcyB0byBjaGVjayBpdHMgLm5hbWUgcHJvcGVydHkuXG4gICAgICAgIChjdG9yLmRpc3BsYXlOYW1lIHx8IGN0b3IubmFtZSkgPT09IFwiR2VuZXJhdG9yRnVuY3Rpb25cIlxuICAgICAgOiBmYWxzZTtcbiAgfTtcblxuICBleHBvcnRzLm1hcmsgPSBmdW5jdGlvbihnZW5GdW4pIHtcbiAgICBpZiAoT2JqZWN0LnNldFByb3RvdHlwZU9mKSB7XG4gICAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YoZ2VuRnVuLCBHZW5lcmF0b3JGdW5jdGlvblByb3RvdHlwZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGdlbkZ1bi5fX3Byb3RvX18gPSBHZW5lcmF0b3JGdW5jdGlvblByb3RvdHlwZTtcbiAgICAgIGRlZmluZShnZW5GdW4sIHRvU3RyaW5nVGFnU3ltYm9sLCBcIkdlbmVyYXRvckZ1bmN0aW9uXCIpO1xuICAgIH1cbiAgICBnZW5GdW4ucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShHcCk7XG4gICAgcmV0dXJuIGdlbkZ1bjtcbiAgfTtcblxuICAvLyBXaXRoaW4gdGhlIGJvZHkgb2YgYW55IGFzeW5jIGZ1bmN0aW9uLCBgYXdhaXQgeGAgaXMgdHJhbnNmb3JtZWQgdG9cbiAgLy8gYHlpZWxkIHJlZ2VuZXJhdG9yUnVudGltZS5hd3JhcCh4KWAsIHNvIHRoYXQgdGhlIHJ1bnRpbWUgY2FuIHRlc3RcbiAgLy8gYGhhc093bi5jYWxsKHZhbHVlLCBcIl9fYXdhaXRcIilgIHRvIGRldGVybWluZSBpZiB0aGUgeWllbGRlZCB2YWx1ZSBpc1xuICAvLyBtZWFudCB0byBiZSBhd2FpdGVkLlxuICBleHBvcnRzLmF3cmFwID0gZnVuY3Rpb24oYXJnKSB7XG4gICAgcmV0dXJuIHsgX19hd2FpdDogYXJnIH07XG4gIH07XG5cbiAgZnVuY3Rpb24gQXN5bmNJdGVyYXRvcihnZW5lcmF0b3IsIFByb21pc2VJbXBsKSB7XG4gICAgZnVuY3Rpb24gaW52b2tlKG1ldGhvZCwgYXJnLCByZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIHZhciByZWNvcmQgPSB0cnlDYXRjaChnZW5lcmF0b3JbbWV0aG9kXSwgZ2VuZXJhdG9yLCBhcmcpO1xuICAgICAgaWYgKHJlY29yZC50eXBlID09PSBcInRocm93XCIpIHtcbiAgICAgICAgcmVqZWN0KHJlY29yZC5hcmcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IHJlY29yZC5hcmc7XG4gICAgICAgIHZhciB2YWx1ZSA9IHJlc3VsdC52YWx1ZTtcbiAgICAgICAgaWYgKHZhbHVlICYmXG4gICAgICAgICAgICB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgICAgIGhhc093bi5jYWxsKHZhbHVlLCBcIl9fYXdhaXRcIikpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZUltcGwucmVzb2x2ZSh2YWx1ZS5fX2F3YWl0KS50aGVuKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgICBpbnZva2UoXCJuZXh0XCIsIHZhbHVlLCByZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgIH0sIGZ1bmN0aW9uKGVycikge1xuICAgICAgICAgICAgaW52b2tlKFwidGhyb3dcIiwgZXJyLCByZXNvbHZlLCByZWplY3QpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFByb21pc2VJbXBsLnJlc29sdmUodmFsdWUpLnRoZW4oZnVuY3Rpb24odW53cmFwcGVkKSB7XG4gICAgICAgICAgLy8gV2hlbiBhIHlpZWxkZWQgUHJvbWlzZSBpcyByZXNvbHZlZCwgaXRzIGZpbmFsIHZhbHVlIGJlY29tZXNcbiAgICAgICAgICAvLyB0aGUgLnZhbHVlIG9mIHRoZSBQcm9taXNlPHt2YWx1ZSxkb25lfT4gcmVzdWx0IGZvciB0aGVcbiAgICAgICAgICAvLyBjdXJyZW50IGl0ZXJhdGlvbi5cbiAgICAgICAgICByZXN1bHQudmFsdWUgPSB1bndyYXBwZWQ7XG4gICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9LCBmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIC8vIElmIGEgcmVqZWN0ZWQgUHJvbWlzZSB3YXMgeWllbGRlZCwgdGhyb3cgdGhlIHJlamVjdGlvbiBiYWNrXG4gICAgICAgICAgLy8gaW50byB0aGUgYXN5bmMgZ2VuZXJhdG9yIGZ1bmN0aW9uIHNvIGl0IGNhbiBiZSBoYW5kbGVkIHRoZXJlLlxuICAgICAgICAgIHJldHVybiBpbnZva2UoXCJ0aHJvd1wiLCBlcnJvciwgcmVzb2x2ZSwgcmVqZWN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHByZXZpb3VzUHJvbWlzZTtcblxuICAgIGZ1bmN0aW9uIGVucXVldWUobWV0aG9kLCBhcmcpIHtcbiAgICAgIGZ1bmN0aW9uIGNhbGxJbnZva2VXaXRoTWV0aG9kQW5kQXJnKCkge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2VJbXBsKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICAgIGludm9rZShtZXRob2QsIGFyZywgcmVzb2x2ZSwgcmVqZWN0KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBwcmV2aW91c1Byb21pc2UgPVxuICAgICAgICAvLyBJZiBlbnF1ZXVlIGhhcyBiZWVuIGNhbGxlZCBiZWZvcmUsIHRoZW4gd2Ugd2FudCB0byB3YWl0IHVudGlsXG4gICAgICAgIC8vIGFsbCBwcmV2aW91cyBQcm9taXNlcyBoYXZlIGJlZW4gcmVzb2x2ZWQgYmVmb3JlIGNhbGxpbmcgaW52b2tlLFxuICAgICAgICAvLyBzbyB0aGF0IHJlc3VsdHMgYXJlIGFsd2F5cyBkZWxpdmVyZWQgaW4gdGhlIGNvcnJlY3Qgb3JkZXIuIElmXG4gICAgICAgIC8vIGVucXVldWUgaGFzIG5vdCBiZWVuIGNhbGxlZCBiZWZvcmUsIHRoZW4gaXQgaXMgaW1wb3J0YW50IHRvXG4gICAgICAgIC8vIGNhbGwgaW52b2tlIGltbWVkaWF0ZWx5LCB3aXRob3V0IHdhaXRpbmcgb24gYSBjYWxsYmFjayB0byBmaXJlLFxuICAgICAgICAvLyBzbyB0aGF0IHRoZSBhc3luYyBnZW5lcmF0b3IgZnVuY3Rpb24gaGFzIHRoZSBvcHBvcnR1bml0eSB0byBkb1xuICAgICAgICAvLyBhbnkgbmVjZXNzYXJ5IHNldHVwIGluIGEgcHJlZGljdGFibGUgd2F5LiBUaGlzIHByZWRpY3RhYmlsaXR5XG4gICAgICAgIC8vIGlzIHdoeSB0aGUgUHJvbWlzZSBjb25zdHJ1Y3RvciBzeW5jaHJvbm91c2x5IGludm9rZXMgaXRzXG4gICAgICAgIC8vIGV4ZWN1dG9yIGNhbGxiYWNrLCBhbmQgd2h5IGFzeW5jIGZ1bmN0aW9ucyBzeW5jaHJvbm91c2x5XG4gICAgICAgIC8vIGV4ZWN1dGUgY29kZSBiZWZvcmUgdGhlIGZpcnN0IGF3YWl0LiBTaW5jZSB3ZSBpbXBsZW1lbnQgc2ltcGxlXG4gICAgICAgIC8vIGFzeW5jIGZ1bmN0aW9ucyBpbiB0ZXJtcyBvZiBhc3luYyBnZW5lcmF0b3JzLCBpdCBpcyBlc3BlY2lhbGx5XG4gICAgICAgIC8vIGltcG9ydGFudCB0byBnZXQgdGhpcyByaWdodCwgZXZlbiB0aG91Z2ggaXQgcmVxdWlyZXMgY2FyZS5cbiAgICAgICAgcHJldmlvdXNQcm9taXNlID8gcHJldmlvdXNQcm9taXNlLnRoZW4oXG4gICAgICAgICAgY2FsbEludm9rZVdpdGhNZXRob2RBbmRBcmcsXG4gICAgICAgICAgLy8gQXZvaWQgcHJvcGFnYXRpbmcgZmFpbHVyZXMgdG8gUHJvbWlzZXMgcmV0dXJuZWQgYnkgbGF0ZXJcbiAgICAgICAgICAvLyBpbnZvY2F0aW9ucyBvZiB0aGUgaXRlcmF0b3IuXG4gICAgICAgICAgY2FsbEludm9rZVdpdGhNZXRob2RBbmRBcmdcbiAgICAgICAgKSA6IGNhbGxJbnZva2VXaXRoTWV0aG9kQW5kQXJnKCk7XG4gICAgfVxuXG4gICAgLy8gRGVmaW5lIHRoZSB1bmlmaWVkIGhlbHBlciBtZXRob2QgdGhhdCBpcyB1c2VkIHRvIGltcGxlbWVudCAubmV4dCxcbiAgICAvLyAudGhyb3csIGFuZCAucmV0dXJuIChzZWUgZGVmaW5lSXRlcmF0b3JNZXRob2RzKS5cbiAgICB0aGlzLl9pbnZva2UgPSBlbnF1ZXVlO1xuICB9XG5cbiAgZGVmaW5lSXRlcmF0b3JNZXRob2RzKEFzeW5jSXRlcmF0b3IucHJvdG90eXBlKTtcbiAgQXN5bmNJdGVyYXRvci5wcm90b3R5cGVbYXN5bmNJdGVyYXRvclN5bWJvbF0gPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH07XG4gIGV4cG9ydHMuQXN5bmNJdGVyYXRvciA9IEFzeW5jSXRlcmF0b3I7XG5cbiAgLy8gTm90ZSB0aGF0IHNpbXBsZSBhc3luYyBmdW5jdGlvbnMgYXJlIGltcGxlbWVudGVkIG9uIHRvcCBvZlxuICAvLyBBc3luY0l0ZXJhdG9yIG9iamVjdHM7IHRoZXkganVzdCByZXR1cm4gYSBQcm9taXNlIGZvciB0aGUgdmFsdWUgb2ZcbiAgLy8gdGhlIGZpbmFsIHJlc3VsdCBwcm9kdWNlZCBieSB0aGUgaXRlcmF0b3IuXG4gIGV4cG9ydHMuYXN5bmMgPSBmdW5jdGlvbihpbm5lckZuLCBvdXRlckZuLCBzZWxmLCB0cnlMb2NzTGlzdCwgUHJvbWlzZUltcGwpIHtcbiAgICBpZiAoUHJvbWlzZUltcGwgPT09IHZvaWQgMCkgUHJvbWlzZUltcGwgPSBQcm9taXNlO1xuXG4gICAgdmFyIGl0ZXIgPSBuZXcgQXN5bmNJdGVyYXRvcihcbiAgICAgIHdyYXAoaW5uZXJGbiwgb3V0ZXJGbiwgc2VsZiwgdHJ5TG9jc0xpc3QpLFxuICAgICAgUHJvbWlzZUltcGxcbiAgICApO1xuXG4gICAgcmV0dXJuIGV4cG9ydHMuaXNHZW5lcmF0b3JGdW5jdGlvbihvdXRlckZuKVxuICAgICAgPyBpdGVyIC8vIElmIG91dGVyRm4gaXMgYSBnZW5lcmF0b3IsIHJldHVybiB0aGUgZnVsbCBpdGVyYXRvci5cbiAgICAgIDogaXRlci5uZXh0KCkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0LmRvbmUgPyByZXN1bHQudmFsdWUgOiBpdGVyLm5leHQoKTtcbiAgICAgICAgfSk7XG4gIH07XG5cbiAgZnVuY3Rpb24gbWFrZUludm9rZU1ldGhvZChpbm5lckZuLCBzZWxmLCBjb250ZXh0KSB7XG4gICAgdmFyIHN0YXRlID0gR2VuU3RhdGVTdXNwZW5kZWRTdGFydDtcblxuICAgIHJldHVybiBmdW5jdGlvbiBpbnZva2UobWV0aG9kLCBhcmcpIHtcbiAgICAgIGlmIChzdGF0ZSA9PT0gR2VuU3RhdGVFeGVjdXRpbmcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiR2VuZXJhdG9yIGlzIGFscmVhZHkgcnVubmluZ1wiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXRlID09PSBHZW5TdGF0ZUNvbXBsZXRlZCkge1xuICAgICAgICBpZiAobWV0aG9kID09PSBcInRocm93XCIpIHtcbiAgICAgICAgICB0aHJvdyBhcmc7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBCZSBmb3JnaXZpbmcsIHBlciAyNS4zLjMuMy4zIG9mIHRoZSBzcGVjOlxuICAgICAgICAvLyBodHRwczovL3Blb3BsZS5tb3ppbGxhLm9yZy9+am9yZW5kb3JmZi9lczYtZHJhZnQuaHRtbCNzZWMtZ2VuZXJhdG9ycmVzdW1lXG4gICAgICAgIHJldHVybiBkb25lUmVzdWx0KCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnRleHQubWV0aG9kID0gbWV0aG9kO1xuICAgICAgY29udGV4dC5hcmcgPSBhcmc7XG5cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIHZhciBkZWxlZ2F0ZSA9IGNvbnRleHQuZGVsZWdhdGU7XG4gICAgICAgIGlmIChkZWxlZ2F0ZSkge1xuICAgICAgICAgIHZhciBkZWxlZ2F0ZVJlc3VsdCA9IG1heWJlSW52b2tlRGVsZWdhdGUoZGVsZWdhdGUsIGNvbnRleHQpO1xuICAgICAgICAgIGlmIChkZWxlZ2F0ZVJlc3VsdCkge1xuICAgICAgICAgICAgaWYgKGRlbGVnYXRlUmVzdWx0ID09PSBDb250aW51ZVNlbnRpbmVsKSBjb250aW51ZTtcbiAgICAgICAgICAgIHJldHVybiBkZWxlZ2F0ZVJlc3VsdDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY29udGV4dC5tZXRob2QgPT09IFwibmV4dFwiKSB7XG4gICAgICAgICAgLy8gU2V0dGluZyBjb250ZXh0Ll9zZW50IGZvciBsZWdhY3kgc3VwcG9ydCBvZiBCYWJlbCdzXG4gICAgICAgICAgLy8gZnVuY3Rpb24uc2VudCBpbXBsZW1lbnRhdGlvbi5cbiAgICAgICAgICBjb250ZXh0LnNlbnQgPSBjb250ZXh0Ll9zZW50ID0gY29udGV4dC5hcmc7XG5cbiAgICAgICAgfSBlbHNlIGlmIChjb250ZXh0Lm1ldGhvZCA9PT0gXCJ0aHJvd1wiKSB7XG4gICAgICAgICAgaWYgKHN0YXRlID09PSBHZW5TdGF0ZVN1c3BlbmRlZFN0YXJ0KSB7XG4gICAgICAgICAgICBzdGF0ZSA9IEdlblN0YXRlQ29tcGxldGVkO1xuICAgICAgICAgICAgdGhyb3cgY29udGV4dC5hcmc7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29udGV4dC5kaXNwYXRjaEV4Y2VwdGlvbihjb250ZXh0LmFyZyk7XG5cbiAgICAgICAgfSBlbHNlIGlmIChjb250ZXh0Lm1ldGhvZCA9PT0gXCJyZXR1cm5cIikge1xuICAgICAgICAgIGNvbnRleHQuYWJydXB0KFwicmV0dXJuXCIsIGNvbnRleHQuYXJnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXRlID0gR2VuU3RhdGVFeGVjdXRpbmc7XG5cbiAgICAgICAgdmFyIHJlY29yZCA9IHRyeUNhdGNoKGlubmVyRm4sIHNlbGYsIGNvbnRleHQpO1xuICAgICAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwibm9ybWFsXCIpIHtcbiAgICAgICAgICAvLyBJZiBhbiBleGNlcHRpb24gaXMgdGhyb3duIGZyb20gaW5uZXJGbiwgd2UgbGVhdmUgc3RhdGUgPT09XG4gICAgICAgICAgLy8gR2VuU3RhdGVFeGVjdXRpbmcgYW5kIGxvb3AgYmFjayBmb3IgYW5vdGhlciBpbnZvY2F0aW9uLlxuICAgICAgICAgIHN0YXRlID0gY29udGV4dC5kb25lXG4gICAgICAgICAgICA/IEdlblN0YXRlQ29tcGxldGVkXG4gICAgICAgICAgICA6IEdlblN0YXRlU3VzcGVuZGVkWWllbGQ7XG5cbiAgICAgICAgICBpZiAocmVjb3JkLmFyZyA9PT0gQ29udGludWVTZW50aW5lbCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHZhbHVlOiByZWNvcmQuYXJnLFxuICAgICAgICAgICAgZG9uZTogY29udGV4dC5kb25lXG4gICAgICAgICAgfTtcblxuICAgICAgICB9IGVsc2UgaWYgKHJlY29yZC50eXBlID09PSBcInRocm93XCIpIHtcbiAgICAgICAgICBzdGF0ZSA9IEdlblN0YXRlQ29tcGxldGVkO1xuICAgICAgICAgIC8vIERpc3BhdGNoIHRoZSBleGNlcHRpb24gYnkgbG9vcGluZyBiYWNrIGFyb3VuZCB0byB0aGVcbiAgICAgICAgICAvLyBjb250ZXh0LmRpc3BhdGNoRXhjZXB0aW9uKGNvbnRleHQuYXJnKSBjYWxsIGFib3ZlLlxuICAgICAgICAgIGNvbnRleHQubWV0aG9kID0gXCJ0aHJvd1wiO1xuICAgICAgICAgIGNvbnRleHQuYXJnID0gcmVjb3JkLmFyZztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBDYWxsIGRlbGVnYXRlLml0ZXJhdG9yW2NvbnRleHQubWV0aG9kXShjb250ZXh0LmFyZykgYW5kIGhhbmRsZSB0aGVcbiAgLy8gcmVzdWx0LCBlaXRoZXIgYnkgcmV0dXJuaW5nIGEgeyB2YWx1ZSwgZG9uZSB9IHJlc3VsdCBmcm9tIHRoZVxuICAvLyBkZWxlZ2F0ZSBpdGVyYXRvciwgb3IgYnkgbW9kaWZ5aW5nIGNvbnRleHQubWV0aG9kIGFuZCBjb250ZXh0LmFyZyxcbiAgLy8gc2V0dGluZyBjb250ZXh0LmRlbGVnYXRlIHRvIG51bGwsIGFuZCByZXR1cm5pbmcgdGhlIENvbnRpbnVlU2VudGluZWwuXG4gIGZ1bmN0aW9uIG1heWJlSW52b2tlRGVsZWdhdGUoZGVsZWdhdGUsIGNvbnRleHQpIHtcbiAgICB2YXIgbWV0aG9kID0gZGVsZWdhdGUuaXRlcmF0b3JbY29udGV4dC5tZXRob2RdO1xuICAgIGlmIChtZXRob2QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gQSAudGhyb3cgb3IgLnJldHVybiB3aGVuIHRoZSBkZWxlZ2F0ZSBpdGVyYXRvciBoYXMgbm8gLnRocm93XG4gICAgICAvLyBtZXRob2QgYWx3YXlzIHRlcm1pbmF0ZXMgdGhlIHlpZWxkKiBsb29wLlxuICAgICAgY29udGV4dC5kZWxlZ2F0ZSA9IG51bGw7XG5cbiAgICAgIGlmIChjb250ZXh0Lm1ldGhvZCA9PT0gXCJ0aHJvd1wiKSB7XG4gICAgICAgIC8vIE5vdGU6IFtcInJldHVyblwiXSBtdXN0IGJlIHVzZWQgZm9yIEVTMyBwYXJzaW5nIGNvbXBhdGliaWxpdHkuXG4gICAgICAgIGlmIChkZWxlZ2F0ZS5pdGVyYXRvcltcInJldHVyblwiXSkge1xuICAgICAgICAgIC8vIElmIHRoZSBkZWxlZ2F0ZSBpdGVyYXRvciBoYXMgYSByZXR1cm4gbWV0aG9kLCBnaXZlIGl0IGFcbiAgICAgICAgICAvLyBjaGFuY2UgdG8gY2xlYW4gdXAuXG4gICAgICAgICAgY29udGV4dC5tZXRob2QgPSBcInJldHVyblwiO1xuICAgICAgICAgIGNvbnRleHQuYXJnID0gdW5kZWZpbmVkO1xuICAgICAgICAgIG1heWJlSW52b2tlRGVsZWdhdGUoZGVsZWdhdGUsIGNvbnRleHQpO1xuXG4gICAgICAgICAgaWYgKGNvbnRleHQubWV0aG9kID09PSBcInRocm93XCIpIHtcbiAgICAgICAgICAgIC8vIElmIG1heWJlSW52b2tlRGVsZWdhdGUoY29udGV4dCkgY2hhbmdlZCBjb250ZXh0Lm1ldGhvZCBmcm9tXG4gICAgICAgICAgICAvLyBcInJldHVyblwiIHRvIFwidGhyb3dcIiwgbGV0IHRoYXQgb3ZlcnJpZGUgdGhlIFR5cGVFcnJvciBiZWxvdy5cbiAgICAgICAgICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRleHQubWV0aG9kID0gXCJ0aHJvd1wiO1xuICAgICAgICBjb250ZXh0LmFyZyA9IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgXCJUaGUgaXRlcmF0b3IgZG9lcyBub3QgcHJvdmlkZSBhICd0aHJvdycgbWV0aG9kXCIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICB9XG5cbiAgICB2YXIgcmVjb3JkID0gdHJ5Q2F0Y2gobWV0aG9kLCBkZWxlZ2F0ZS5pdGVyYXRvciwgY29udGV4dC5hcmcpO1xuXG4gICAgaWYgKHJlY29yZC50eXBlID09PSBcInRocm93XCIpIHtcbiAgICAgIGNvbnRleHQubWV0aG9kID0gXCJ0aHJvd1wiO1xuICAgICAgY29udGV4dC5hcmcgPSByZWNvcmQuYXJnO1xuICAgICAgY29udGV4dC5kZWxlZ2F0ZSA9IG51bGw7XG4gICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICB9XG5cbiAgICB2YXIgaW5mbyA9IHJlY29yZC5hcmc7XG5cbiAgICBpZiAoISBpbmZvKSB7XG4gICAgICBjb250ZXh0Lm1ldGhvZCA9IFwidGhyb3dcIjtcbiAgICAgIGNvbnRleHQuYXJnID0gbmV3IFR5cGVFcnJvcihcIml0ZXJhdG9yIHJlc3VsdCBpcyBub3QgYW4gb2JqZWN0XCIpO1xuICAgICAgY29udGV4dC5kZWxlZ2F0ZSA9IG51bGw7XG4gICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICB9XG5cbiAgICBpZiAoaW5mby5kb25lKSB7XG4gICAgICAvLyBBc3NpZ24gdGhlIHJlc3VsdCBvZiB0aGUgZmluaXNoZWQgZGVsZWdhdGUgdG8gdGhlIHRlbXBvcmFyeVxuICAgICAgLy8gdmFyaWFibGUgc3BlY2lmaWVkIGJ5IGRlbGVnYXRlLnJlc3VsdE5hbWUgKHNlZSBkZWxlZ2F0ZVlpZWxkKS5cbiAgICAgIGNvbnRleHRbZGVsZWdhdGUucmVzdWx0TmFtZV0gPSBpbmZvLnZhbHVlO1xuXG4gICAgICAvLyBSZXN1bWUgZXhlY3V0aW9uIGF0IHRoZSBkZXNpcmVkIGxvY2F0aW9uIChzZWUgZGVsZWdhdGVZaWVsZCkuXG4gICAgICBjb250ZXh0Lm5leHQgPSBkZWxlZ2F0ZS5uZXh0TG9jO1xuXG4gICAgICAvLyBJZiBjb250ZXh0Lm1ldGhvZCB3YXMgXCJ0aHJvd1wiIGJ1dCB0aGUgZGVsZWdhdGUgaGFuZGxlZCB0aGVcbiAgICAgIC8vIGV4Y2VwdGlvbiwgbGV0IHRoZSBvdXRlciBnZW5lcmF0b3IgcHJvY2VlZCBub3JtYWxseS4gSWZcbiAgICAgIC8vIGNvbnRleHQubWV0aG9kIHdhcyBcIm5leHRcIiwgZm9yZ2V0IGNvbnRleHQuYXJnIHNpbmNlIGl0IGhhcyBiZWVuXG4gICAgICAvLyBcImNvbnN1bWVkXCIgYnkgdGhlIGRlbGVnYXRlIGl0ZXJhdG9yLiBJZiBjb250ZXh0Lm1ldGhvZCB3YXNcbiAgICAgIC8vIFwicmV0dXJuXCIsIGFsbG93IHRoZSBvcmlnaW5hbCAucmV0dXJuIGNhbGwgdG8gY29udGludWUgaW4gdGhlXG4gICAgICAvLyBvdXRlciBnZW5lcmF0b3IuXG4gICAgICBpZiAoY29udGV4dC5tZXRob2QgIT09IFwicmV0dXJuXCIpIHtcbiAgICAgICAgY29udGV4dC5tZXRob2QgPSBcIm5leHRcIjtcbiAgICAgICAgY29udGV4dC5hcmcgPSB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gUmUteWllbGQgdGhlIHJlc3VsdCByZXR1cm5lZCBieSB0aGUgZGVsZWdhdGUgbWV0aG9kLlxuICAgICAgcmV0dXJuIGluZm87XG4gICAgfVxuXG4gICAgLy8gVGhlIGRlbGVnYXRlIGl0ZXJhdG9yIGlzIGZpbmlzaGVkLCBzbyBmb3JnZXQgaXQgYW5kIGNvbnRpbnVlIHdpdGhcbiAgICAvLyB0aGUgb3V0ZXIgZ2VuZXJhdG9yLlxuICAgIGNvbnRleHQuZGVsZWdhdGUgPSBudWxsO1xuICAgIHJldHVybiBDb250aW51ZVNlbnRpbmVsO1xuICB9XG5cbiAgLy8gRGVmaW5lIEdlbmVyYXRvci5wcm90b3R5cGUue25leHQsdGhyb3cscmV0dXJufSBpbiB0ZXJtcyBvZiB0aGVcbiAgLy8gdW5pZmllZCAuX2ludm9rZSBoZWxwZXIgbWV0aG9kLlxuICBkZWZpbmVJdGVyYXRvck1ldGhvZHMoR3ApO1xuXG4gIGRlZmluZShHcCwgdG9TdHJpbmdUYWdTeW1ib2wsIFwiR2VuZXJhdG9yXCIpO1xuXG4gIC8vIEEgR2VuZXJhdG9yIHNob3VsZCBhbHdheXMgcmV0dXJuIGl0c2VsZiBhcyB0aGUgaXRlcmF0b3Igb2JqZWN0IHdoZW4gdGhlXG4gIC8vIEBAaXRlcmF0b3IgZnVuY3Rpb24gaXMgY2FsbGVkIG9uIGl0LiBTb21lIGJyb3dzZXJzJyBpbXBsZW1lbnRhdGlvbnMgb2YgdGhlXG4gIC8vIGl0ZXJhdG9yIHByb3RvdHlwZSBjaGFpbiBpbmNvcnJlY3RseSBpbXBsZW1lbnQgdGhpcywgY2F1c2luZyB0aGUgR2VuZXJhdG9yXG4gIC8vIG9iamVjdCB0byBub3QgYmUgcmV0dXJuZWQgZnJvbSB0aGlzIGNhbGwuIFRoaXMgZW5zdXJlcyB0aGF0IGRvZXNuJ3QgaGFwcGVuLlxuICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2ZhY2Vib29rL3JlZ2VuZXJhdG9yL2lzc3Vlcy8yNzQgZm9yIG1vcmUgZGV0YWlscy5cbiAgR3BbaXRlcmF0b3JTeW1ib2xdID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH07XG5cbiAgR3AudG9TdHJpbmcgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gXCJbb2JqZWN0IEdlbmVyYXRvcl1cIjtcbiAgfTtcblxuICBmdW5jdGlvbiBwdXNoVHJ5RW50cnkobG9jcykge1xuICAgIHZhciBlbnRyeSA9IHsgdHJ5TG9jOiBsb2NzWzBdIH07XG5cbiAgICBpZiAoMSBpbiBsb2NzKSB7XG4gICAgICBlbnRyeS5jYXRjaExvYyA9IGxvY3NbMV07XG4gICAgfVxuXG4gICAgaWYgKDIgaW4gbG9jcykge1xuICAgICAgZW50cnkuZmluYWxseUxvYyA9IGxvY3NbMl07XG4gICAgICBlbnRyeS5hZnRlckxvYyA9IGxvY3NbM107XG4gICAgfVxuXG4gICAgdGhpcy50cnlFbnRyaWVzLnB1c2goZW50cnkpO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVzZXRUcnlFbnRyeShlbnRyeSkge1xuICAgIHZhciByZWNvcmQgPSBlbnRyeS5jb21wbGV0aW9uIHx8IHt9O1xuICAgIHJlY29yZC50eXBlID0gXCJub3JtYWxcIjtcbiAgICBkZWxldGUgcmVjb3JkLmFyZztcbiAgICBlbnRyeS5jb21wbGV0aW9uID0gcmVjb3JkO1xuICB9XG5cbiAgZnVuY3Rpb24gQ29udGV4dCh0cnlMb2NzTGlzdCkge1xuICAgIC8vIFRoZSByb290IGVudHJ5IG9iamVjdCAoZWZmZWN0aXZlbHkgYSB0cnkgc3RhdGVtZW50IHdpdGhvdXQgYSBjYXRjaFxuICAgIC8vIG9yIGEgZmluYWxseSBibG9jaykgZ2l2ZXMgdXMgYSBwbGFjZSB0byBzdG9yZSB2YWx1ZXMgdGhyb3duIGZyb21cbiAgICAvLyBsb2NhdGlvbnMgd2hlcmUgdGhlcmUgaXMgbm8gZW5jbG9zaW5nIHRyeSBzdGF0ZW1lbnQuXG4gICAgdGhpcy50cnlFbnRyaWVzID0gW3sgdHJ5TG9jOiBcInJvb3RcIiB9XTtcbiAgICB0cnlMb2NzTGlzdC5mb3JFYWNoKHB1c2hUcnlFbnRyeSwgdGhpcyk7XG4gICAgdGhpcy5yZXNldCh0cnVlKTtcbiAgfVxuXG4gIGV4cG9ydHMua2V5cyA9IGZ1bmN0aW9uKG9iamVjdCkge1xuICAgIHZhciBrZXlzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIG9iamVjdCkge1xuICAgICAga2V5cy5wdXNoKGtleSk7XG4gICAgfVxuICAgIGtleXMucmV2ZXJzZSgpO1xuXG4gICAgLy8gUmF0aGVyIHRoYW4gcmV0dXJuaW5nIGFuIG9iamVjdCB3aXRoIGEgbmV4dCBtZXRob2QsIHdlIGtlZXBcbiAgICAvLyB0aGluZ3Mgc2ltcGxlIGFuZCByZXR1cm4gdGhlIG5leHQgZnVuY3Rpb24gaXRzZWxmLlxuICAgIHJldHVybiBmdW5jdGlvbiBuZXh0KCkge1xuICAgICAgd2hpbGUgKGtleXMubGVuZ3RoKSB7XG4gICAgICAgIHZhciBrZXkgPSBrZXlzLnBvcCgpO1xuICAgICAgICBpZiAoa2V5IGluIG9iamVjdCkge1xuICAgICAgICAgIG5leHQudmFsdWUgPSBrZXk7XG4gICAgICAgICAgbmV4dC5kb25lID0gZmFsc2U7XG4gICAgICAgICAgcmV0dXJuIG5leHQ7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVG8gYXZvaWQgY3JlYXRpbmcgYW4gYWRkaXRpb25hbCBvYmplY3QsIHdlIGp1c3QgaGFuZyB0aGUgLnZhbHVlXG4gICAgICAvLyBhbmQgLmRvbmUgcHJvcGVydGllcyBvZmYgdGhlIG5leHQgZnVuY3Rpb24gb2JqZWN0IGl0c2VsZi4gVGhpc1xuICAgICAgLy8gYWxzbyBlbnN1cmVzIHRoYXQgdGhlIG1pbmlmaWVyIHdpbGwgbm90IGFub255bWl6ZSB0aGUgZnVuY3Rpb24uXG4gICAgICBuZXh0LmRvbmUgPSB0cnVlO1xuICAgICAgcmV0dXJuIG5leHQ7XG4gICAgfTtcbiAgfTtcblxuICBmdW5jdGlvbiB2YWx1ZXMoaXRlcmFibGUpIHtcbiAgICBpZiAoaXRlcmFibGUpIHtcbiAgICAgIHZhciBpdGVyYXRvck1ldGhvZCA9IGl0ZXJhYmxlW2l0ZXJhdG9yU3ltYm9sXTtcbiAgICAgIGlmIChpdGVyYXRvck1ldGhvZCkge1xuICAgICAgICByZXR1cm4gaXRlcmF0b3JNZXRob2QuY2FsbChpdGVyYWJsZSk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlb2YgaXRlcmFibGUubmV4dCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBpdGVyYWJsZTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFpc05hTihpdGVyYWJsZS5sZW5ndGgpKSB7XG4gICAgICAgIHZhciBpID0gLTEsIG5leHQgPSBmdW5jdGlvbiBuZXh0KCkge1xuICAgICAgICAgIHdoaWxlICgrK2kgPCBpdGVyYWJsZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGlmIChoYXNPd24uY2FsbChpdGVyYWJsZSwgaSkpIHtcbiAgICAgICAgICAgICAgbmV4dC52YWx1ZSA9IGl0ZXJhYmxlW2ldO1xuICAgICAgICAgICAgICBuZXh0LmRvbmUgPSBmYWxzZTtcbiAgICAgICAgICAgICAgcmV0dXJuIG5leHQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbmV4dC52YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICBuZXh0LmRvbmUgPSB0cnVlO1xuXG4gICAgICAgICAgcmV0dXJuIG5leHQ7XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIG5leHQubmV4dCA9IG5leHQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIGFuIGl0ZXJhdG9yIHdpdGggbm8gdmFsdWVzLlxuICAgIHJldHVybiB7IG5leHQ6IGRvbmVSZXN1bHQgfTtcbiAgfVxuICBleHBvcnRzLnZhbHVlcyA9IHZhbHVlcztcblxuICBmdW5jdGlvbiBkb25lUmVzdWx0KCkge1xuICAgIHJldHVybiB7IHZhbHVlOiB1bmRlZmluZWQsIGRvbmU6IHRydWUgfTtcbiAgfVxuXG4gIENvbnRleHQucHJvdG90eXBlID0ge1xuICAgIGNvbnN0cnVjdG9yOiBDb250ZXh0LFxuXG4gICAgcmVzZXQ6IGZ1bmN0aW9uKHNraXBUZW1wUmVzZXQpIHtcbiAgICAgIHRoaXMucHJldiA9IDA7XG4gICAgICB0aGlzLm5leHQgPSAwO1xuICAgICAgLy8gUmVzZXR0aW5nIGNvbnRleHQuX3NlbnQgZm9yIGxlZ2FjeSBzdXBwb3J0IG9mIEJhYmVsJ3NcbiAgICAgIC8vIGZ1bmN0aW9uLnNlbnQgaW1wbGVtZW50YXRpb24uXG4gICAgICB0aGlzLnNlbnQgPSB0aGlzLl9zZW50ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5kb25lID0gZmFsc2U7XG4gICAgICB0aGlzLmRlbGVnYXRlID0gbnVsbDtcblxuICAgICAgdGhpcy5tZXRob2QgPSBcIm5leHRcIjtcbiAgICAgIHRoaXMuYXJnID0gdW5kZWZpbmVkO1xuXG4gICAgICB0aGlzLnRyeUVudHJpZXMuZm9yRWFjaChyZXNldFRyeUVudHJ5KTtcblxuICAgICAgaWYgKCFza2lwVGVtcFJlc2V0KSB7XG4gICAgICAgIGZvciAodmFyIG5hbWUgaW4gdGhpcykge1xuICAgICAgICAgIC8vIE5vdCBzdXJlIGFib3V0IHRoZSBvcHRpbWFsIG9yZGVyIG9mIHRoZXNlIGNvbmRpdGlvbnM6XG4gICAgICAgICAgaWYgKG5hbWUuY2hhckF0KDApID09PSBcInRcIiAmJlxuICAgICAgICAgICAgICBoYXNPd24uY2FsbCh0aGlzLCBuYW1lKSAmJlxuICAgICAgICAgICAgICAhaXNOYU4oK25hbWUuc2xpY2UoMSkpKSB7XG4gICAgICAgICAgICB0aGlzW25hbWVdID0gdW5kZWZpbmVkO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuZG9uZSA9IHRydWU7XG5cbiAgICAgIHZhciByb290RW50cnkgPSB0aGlzLnRyeUVudHJpZXNbMF07XG4gICAgICB2YXIgcm9vdFJlY29yZCA9IHJvb3RFbnRyeS5jb21wbGV0aW9uO1xuICAgICAgaWYgKHJvb3RSZWNvcmQudHlwZSA9PT0gXCJ0aHJvd1wiKSB7XG4gICAgICAgIHRocm93IHJvb3RSZWNvcmQuYXJnO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGhpcy5ydmFsO1xuICAgIH0sXG5cbiAgICBkaXNwYXRjaEV4Y2VwdGlvbjogZnVuY3Rpb24oZXhjZXB0aW9uKSB7XG4gICAgICBpZiAodGhpcy5kb25lKSB7XG4gICAgICAgIHRocm93IGV4Y2VwdGlvbjtcbiAgICAgIH1cblxuICAgICAgdmFyIGNvbnRleHQgPSB0aGlzO1xuICAgICAgZnVuY3Rpb24gaGFuZGxlKGxvYywgY2F1Z2h0KSB7XG4gICAgICAgIHJlY29yZC50eXBlID0gXCJ0aHJvd1wiO1xuICAgICAgICByZWNvcmQuYXJnID0gZXhjZXB0aW9uO1xuICAgICAgICBjb250ZXh0Lm5leHQgPSBsb2M7XG5cbiAgICAgICAgaWYgKGNhdWdodCkge1xuICAgICAgICAgIC8vIElmIHRoZSBkaXNwYXRjaGVkIGV4Y2VwdGlvbiB3YXMgY2F1Z2h0IGJ5IGEgY2F0Y2ggYmxvY2ssXG4gICAgICAgICAgLy8gdGhlbiBsZXQgdGhhdCBjYXRjaCBibG9jayBoYW5kbGUgdGhlIGV4Y2VwdGlvbiBub3JtYWxseS5cbiAgICAgICAgICBjb250ZXh0Lm1ldGhvZCA9IFwibmV4dFwiO1xuICAgICAgICAgIGNvbnRleHQuYXJnID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuICEhIGNhdWdodDtcbiAgICAgIH1cblxuICAgICAgZm9yICh2YXIgaSA9IHRoaXMudHJ5RW50cmllcy5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgICAgICB2YXIgZW50cnkgPSB0aGlzLnRyeUVudHJpZXNbaV07XG4gICAgICAgIHZhciByZWNvcmQgPSBlbnRyeS5jb21wbGV0aW9uO1xuXG4gICAgICAgIGlmIChlbnRyeS50cnlMb2MgPT09IFwicm9vdFwiKSB7XG4gICAgICAgICAgLy8gRXhjZXB0aW9uIHRocm93biBvdXRzaWRlIG9mIGFueSB0cnkgYmxvY2sgdGhhdCBjb3VsZCBoYW5kbGVcbiAgICAgICAgICAvLyBpdCwgc28gc2V0IHRoZSBjb21wbGV0aW9uIHZhbHVlIG9mIHRoZSBlbnRpcmUgZnVuY3Rpb24gdG9cbiAgICAgICAgICAvLyB0aHJvdyB0aGUgZXhjZXB0aW9uLlxuICAgICAgICAgIHJldHVybiBoYW5kbGUoXCJlbmRcIik7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoZW50cnkudHJ5TG9jIDw9IHRoaXMucHJldikge1xuICAgICAgICAgIHZhciBoYXNDYXRjaCA9IGhhc093bi5jYWxsKGVudHJ5LCBcImNhdGNoTG9jXCIpO1xuICAgICAgICAgIHZhciBoYXNGaW5hbGx5ID0gaGFzT3duLmNhbGwoZW50cnksIFwiZmluYWxseUxvY1wiKTtcblxuICAgICAgICAgIGlmIChoYXNDYXRjaCAmJiBoYXNGaW5hbGx5KSB7XG4gICAgICAgICAgICBpZiAodGhpcy5wcmV2IDwgZW50cnkuY2F0Y2hMb2MpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGhhbmRsZShlbnRyeS5jYXRjaExvYywgdHJ1ZSk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMucHJldiA8IGVudHJ5LmZpbmFsbHlMb2MpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGhhbmRsZShlbnRyeS5maW5hbGx5TG9jKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgIH0gZWxzZSBpZiAoaGFzQ2F0Y2gpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnByZXYgPCBlbnRyeS5jYXRjaExvYykge1xuICAgICAgICAgICAgICByZXR1cm4gaGFuZGxlKGVudHJ5LmNhdGNoTG9jLCB0cnVlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgIH0gZWxzZSBpZiAoaGFzRmluYWxseSkge1xuICAgICAgICAgICAgaWYgKHRoaXMucHJldiA8IGVudHJ5LmZpbmFsbHlMb2MpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGhhbmRsZShlbnRyeS5maW5hbGx5TG9jKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ0cnkgc3RhdGVtZW50IHdpdGhvdXQgY2F0Y2ggb3IgZmluYWxseVwiKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYWJydXB0OiBmdW5jdGlvbih0eXBlLCBhcmcpIHtcbiAgICAgIGZvciAodmFyIGkgPSB0aGlzLnRyeUVudHJpZXMubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcbiAgICAgICAgdmFyIGVudHJ5ID0gdGhpcy50cnlFbnRyaWVzW2ldO1xuICAgICAgICBpZiAoZW50cnkudHJ5TG9jIDw9IHRoaXMucHJldiAmJlxuICAgICAgICAgICAgaGFzT3duLmNhbGwoZW50cnksIFwiZmluYWxseUxvY1wiKSAmJlxuICAgICAgICAgICAgdGhpcy5wcmV2IDwgZW50cnkuZmluYWxseUxvYykge1xuICAgICAgICAgIHZhciBmaW5hbGx5RW50cnkgPSBlbnRyeTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZmluYWxseUVudHJ5ICYmXG4gICAgICAgICAgKHR5cGUgPT09IFwiYnJlYWtcIiB8fFxuICAgICAgICAgICB0eXBlID09PSBcImNvbnRpbnVlXCIpICYmXG4gICAgICAgICAgZmluYWxseUVudHJ5LnRyeUxvYyA8PSBhcmcgJiZcbiAgICAgICAgICBhcmcgPD0gZmluYWxseUVudHJ5LmZpbmFsbHlMb2MpIHtcbiAgICAgICAgLy8gSWdub3JlIHRoZSBmaW5hbGx5IGVudHJ5IGlmIGNvbnRyb2wgaXMgbm90IGp1bXBpbmcgdG8gYVxuICAgICAgICAvLyBsb2NhdGlvbiBvdXRzaWRlIHRoZSB0cnkvY2F0Y2ggYmxvY2suXG4gICAgICAgIGZpbmFsbHlFbnRyeSA9IG51bGw7XG4gICAgICB9XG5cbiAgICAgIHZhciByZWNvcmQgPSBmaW5hbGx5RW50cnkgPyBmaW5hbGx5RW50cnkuY29tcGxldGlvbiA6IHt9O1xuICAgICAgcmVjb3JkLnR5cGUgPSB0eXBlO1xuICAgICAgcmVjb3JkLmFyZyA9IGFyZztcblxuICAgICAgaWYgKGZpbmFsbHlFbnRyeSkge1xuICAgICAgICB0aGlzLm1ldGhvZCA9IFwibmV4dFwiO1xuICAgICAgICB0aGlzLm5leHQgPSBmaW5hbGx5RW50cnkuZmluYWxseUxvYztcbiAgICAgICAgcmV0dXJuIENvbnRpbnVlU2VudGluZWw7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLmNvbXBsZXRlKHJlY29yZCk7XG4gICAgfSxcblxuICAgIGNvbXBsZXRlOiBmdW5jdGlvbihyZWNvcmQsIGFmdGVyTG9jKSB7XG4gICAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwidGhyb3dcIikge1xuICAgICAgICB0aHJvdyByZWNvcmQuYXJnO1xuICAgICAgfVxuXG4gICAgICBpZiAocmVjb3JkLnR5cGUgPT09IFwiYnJlYWtcIiB8fFxuICAgICAgICAgIHJlY29yZC50eXBlID09PSBcImNvbnRpbnVlXCIpIHtcbiAgICAgICAgdGhpcy5uZXh0ID0gcmVjb3JkLmFyZztcbiAgICAgIH0gZWxzZSBpZiAocmVjb3JkLnR5cGUgPT09IFwicmV0dXJuXCIpIHtcbiAgICAgICAgdGhpcy5ydmFsID0gdGhpcy5hcmcgPSByZWNvcmQuYXJnO1xuICAgICAgICB0aGlzLm1ldGhvZCA9IFwicmV0dXJuXCI7XG4gICAgICAgIHRoaXMubmV4dCA9IFwiZW5kXCI7XG4gICAgICB9IGVsc2UgaWYgKHJlY29yZC50eXBlID09PSBcIm5vcm1hbFwiICYmIGFmdGVyTG9jKSB7XG4gICAgICAgIHRoaXMubmV4dCA9IGFmdGVyTG9jO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICB9LFxuXG4gICAgZmluaXNoOiBmdW5jdGlvbihmaW5hbGx5TG9jKSB7XG4gICAgICBmb3IgKHZhciBpID0gdGhpcy50cnlFbnRyaWVzLmxlbmd0aCAtIDE7IGkgPj0gMDsgLS1pKSB7XG4gICAgICAgIHZhciBlbnRyeSA9IHRoaXMudHJ5RW50cmllc1tpXTtcbiAgICAgICAgaWYgKGVudHJ5LmZpbmFsbHlMb2MgPT09IGZpbmFsbHlMb2MpIHtcbiAgICAgICAgICB0aGlzLmNvbXBsZXRlKGVudHJ5LmNvbXBsZXRpb24sIGVudHJ5LmFmdGVyTG9jKTtcbiAgICAgICAgICByZXNldFRyeUVudHJ5KGVudHJ5KTtcbiAgICAgICAgICByZXR1cm4gQ29udGludWVTZW50aW5lbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBcImNhdGNoXCI6IGZ1bmN0aW9uKHRyeUxvYykge1xuICAgICAgZm9yICh2YXIgaSA9IHRoaXMudHJ5RW50cmllcy5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgICAgICB2YXIgZW50cnkgPSB0aGlzLnRyeUVudHJpZXNbaV07XG4gICAgICAgIGlmIChlbnRyeS50cnlMb2MgPT09IHRyeUxvYykge1xuICAgICAgICAgIHZhciByZWNvcmQgPSBlbnRyeS5jb21wbGV0aW9uO1xuICAgICAgICAgIGlmIChyZWNvcmQudHlwZSA9PT0gXCJ0aHJvd1wiKSB7XG4gICAgICAgICAgICB2YXIgdGhyb3duID0gcmVjb3JkLmFyZztcbiAgICAgICAgICAgIHJlc2V0VHJ5RW50cnkoZW50cnkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhyb3duO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFRoZSBjb250ZXh0LmNhdGNoIG1ldGhvZCBtdXN0IG9ubHkgYmUgY2FsbGVkIHdpdGggYSBsb2NhdGlvblxuICAgICAgLy8gYXJndW1lbnQgdGhhdCBjb3JyZXNwb25kcyB0byBhIGtub3duIGNhdGNoIGJsb2NrLlxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaWxsZWdhbCBjYXRjaCBhdHRlbXB0XCIpO1xuICAgIH0sXG5cbiAgICBkZWxlZ2F0ZVlpZWxkOiBmdW5jdGlvbihpdGVyYWJsZSwgcmVzdWx0TmFtZSwgbmV4dExvYykge1xuICAgICAgdGhpcy5kZWxlZ2F0ZSA9IHtcbiAgICAgICAgaXRlcmF0b3I6IHZhbHVlcyhpdGVyYWJsZSksXG4gICAgICAgIHJlc3VsdE5hbWU6IHJlc3VsdE5hbWUsXG4gICAgICAgIG5leHRMb2M6IG5leHRMb2NcbiAgICAgIH07XG5cbiAgICAgIGlmICh0aGlzLm1ldGhvZCA9PT0gXCJuZXh0XCIpIHtcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IGZvcmdldCB0aGUgbGFzdCBzZW50IHZhbHVlIHNvIHRoYXQgd2UgZG9uJ3RcbiAgICAgICAgLy8gYWNjaWRlbnRhbGx5IHBhc3MgaXQgb24gdG8gdGhlIGRlbGVnYXRlLlxuICAgICAgICB0aGlzLmFyZyA9IHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIENvbnRpbnVlU2VudGluZWw7XG4gICAgfVxuICB9O1xuXG4gIC8vIFJlZ2FyZGxlc3Mgb2Ygd2hldGhlciB0aGlzIHNjcmlwdCBpcyBleGVjdXRpbmcgYXMgYSBDb21tb25KUyBtb2R1bGVcbiAgLy8gb3Igbm90LCByZXR1cm4gdGhlIHJ1bnRpbWUgb2JqZWN0IHNvIHRoYXQgd2UgY2FuIGRlY2xhcmUgdGhlIHZhcmlhYmxlXG4gIC8vIHJlZ2VuZXJhdG9yUnVudGltZSBpbiB0aGUgb3V0ZXIgc2NvcGUsIHdoaWNoIGFsbG93cyB0aGlzIG1vZHVsZSB0byBiZVxuICAvLyBpbmplY3RlZCBlYXNpbHkgYnkgYGJpbi9yZWdlbmVyYXRvciAtLWluY2x1ZGUtcnVudGltZSBzY3JpcHQuanNgLlxuICByZXR1cm4gZXhwb3J0cztcblxufShcbiAgLy8gSWYgdGhpcyBzY3JpcHQgaXMgZXhlY3V0aW5nIGFzIGEgQ29tbW9uSlMgbW9kdWxlLCB1c2UgbW9kdWxlLmV4cG9ydHNcbiAgLy8gYXMgdGhlIHJlZ2VuZXJhdG9yUnVudGltZSBuYW1lc3BhY2UuIE90aGVyd2lzZSBjcmVhdGUgYSBuZXcgZW1wdHlcbiAgLy8gb2JqZWN0LiBFaXRoZXIgd2F5LCB0aGUgcmVzdWx0aW5nIG9iamVjdCB3aWxsIGJlIHVzZWQgdG8gaW5pdGlhbGl6ZVxuICAvLyB0aGUgcmVnZW5lcmF0b3JSdW50aW1lIHZhcmlhYmxlIGF0IHRoZSB0b3Agb2YgdGhpcyBmaWxlLlxuICB0eXBlb2YgbW9kdWxlID09PSBcIm9iamVjdFwiID8gbW9kdWxlLmV4cG9ydHMgOiB7fVxuKSk7XG5cbnRyeSB7XG4gIHJlZ2VuZXJhdG9yUnVudGltZSA9IHJ1bnRpbWU7XG59IGNhdGNoIChhY2NpZGVudGFsU3RyaWN0TW9kZSkge1xuICAvLyBUaGlzIG1vZHVsZSBzaG91bGQgbm90IGJlIHJ1bm5pbmcgaW4gc3RyaWN0IG1vZGUsIHNvIHRoZSBhYm92ZVxuICAvLyBhc3NpZ25tZW50IHNob3VsZCBhbHdheXMgd29yayB1bmxlc3Mgc29tZXRoaW5nIGlzIG1pc2NvbmZpZ3VyZWQuIEp1c3RcbiAgLy8gaW4gY2FzZSBydW50aW1lLmpzIGFjY2lkZW50YWxseSBydW5zIGluIHN0cmljdCBtb2RlLCB3ZSBjYW4gZXNjYXBlXG4gIC8vIHN0cmljdCBtb2RlIHVzaW5nIGEgZ2xvYmFsIEZ1bmN0aW9uIGNhbGwuIFRoaXMgY291bGQgY29uY2VpdmFibHkgZmFpbFxuICAvLyBpZiBhIENvbnRlbnQgU2VjdXJpdHkgUG9saWN5IGZvcmJpZHMgdXNpbmcgRnVuY3Rpb24sIGJ1dCBpbiB0aGF0IGNhc2VcbiAgLy8gdGhlIHByb3BlciBzb2x1dGlvbiBpcyB0byBmaXggdGhlIGFjY2lkZW50YWwgc3RyaWN0IG1vZGUgcHJvYmxlbS4gSWZcbiAgLy8geW91J3ZlIG1pc2NvbmZpZ3VyZWQgeW91ciBidW5kbGVyIHRvIGZvcmNlIHN0cmljdCBtb2RlIGFuZCBhcHBsaWVkIGFcbiAgLy8gQ1NQIHRvIGZvcmJpZCBGdW5jdGlvbiwgYW5kIHlvdSdyZSBub3Qgd2lsbGluZyB0byBmaXggZWl0aGVyIG9mIHRob3NlXG4gIC8vIHByb2JsZW1zLCBwbGVhc2UgZGV0YWlsIHlvdXIgdW5pcXVlIHByZWRpY2FtZW50IGluIGEgR2l0SHViIGlzc3VlLlxuICBGdW5jdGlvbihcInJcIiwgXCJyZWdlbmVyYXRvclJ1bnRpbWUgPSByXCIpKHJ1bnRpbWUpO1xufVxuIiwiaW1wb3J0ICdyZWdlbmVyYXRvci1ydW50aW1lL3J1bnRpbWUnO1xyXG5cclxuY29uc3QgZ2V0RGF0YSA9IGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoICgnaHR0cHM6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy9tb3ZpZS81NTA/YXBpX2tleT05ZGI4MTI0YTc5MTk1ZDA3Mjc3YWI2Y2M4ZTU1NzUyZCcpXHJcbiAgICBjb25zdCBwYXJzZWRSZXMgPSByZXMuanNvbigpO1xyXG4gICAgY29uc29sZS5sb2cgKHBhcnNlZFJlcyk7XHJcbn1cclxuXHJcbmdldERhdGEgKClcclxuXHJcbi8vY29uc29sZS5sb2cgKGdldERhdGEpOyJdLCJwcmVFeGlzdGluZ0NvbW1lbnQiOiIvLyMgc291cmNlTWFwcGluZ1VSTD1kYXRhOmFwcGxpY2F0aW9uL2pzb247Y2hhcnNldD11dGYtODtiYXNlNjQsZXlKMlpYSnphVzl1SWpvekxDSnpiM1Z5WTJWeklqcGJJbTV2WkdWZmJXOWtkV3hsY3k5aWNtOTNjMlZ5TFhCaFkyc3ZYM0J5Wld4MVpHVXVhbk1pTENKdWIyUmxYMjF2WkhWc1pYTXZjbVZuWlc1bGNtRjBiM0l0Y25WdWRHbHRaUzl5ZFc1MGFXMWxMbXB6SWl3aWNISnZhbVZqZEhNdllXcGhlQzl6Y21NdmFuTXZZWEJ3TG1weklsMHNJbTVoYldWeklqcGJYU3dpYldGd2NHbHVaM01pT2lKQlFVRkJPMEZEUVVFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHRCUVVOQk8wRkJRMEU3UVVGRFFUdEJRVU5CTzBGQlEwRTdRVUZEUVR0QlFVTkJPMEZCUTBFN1FVRkRRVHM3T3p0QlF6VjFRa0U3T3pzN096dEJRVVZCTEVsQlFVMHNUMEZCVHp0QlFVRkJMSEZGUVVGSE8wRkJRVUU3UVVGQlFUdEJRVUZCTzBGQlFVRTdRVUZCUVR0QlFVRkJPMEZCUVVFc2JVSkJRMDBzUzBGQlN5eERRVUZGTEdsR1FVRkdMRU5CUkZnN08wRkJRVUU3UVVGRFRpeFpRVUZCTEVkQlJFMDdRVUZGVGl4WlFVRkJMRk5CUmswc1IwRkZUU3hIUVVGSExFTkJRVU1zU1VGQlNpeEZRVVpPTzBGQlIxb3NXVUZCUVN4UFFVRlBMRU5CUVVNc1IwRkJVaXhEUVVGaExGTkJRV0k3TzBGQlNGazdRVUZCUVR0QlFVRkJPMEZCUVVFN1FVRkJRVHRCUVVGQk8wRkJRVUVzUjBGQlNEczdRVUZCUVN4clFrRkJVQ3hQUVVGUE8wRkJRVUU3UVVGQlFUdEJRVUZCTEVkQlFXSTdPMEZCVFVFc1QwRkJUeXhITEVOQlJWQWlMQ0ptYVd4bElqb2laMlZ1WlhKaGRHVmtMbXB6SWl3aWMyOTFjbU5sVW05dmRDSTZJaUlzSW5OdmRYSmpaWE5EYjI1MFpXNTBJanBiSWlobWRXNWpkR2x2YmlncGUyWjFibU4wYVc5dUlISW9aU3h1TEhRcGUyWjFibU4wYVc5dUlHOG9hU3htS1h0cFppZ2hibHRwWFNsN2FXWW9JV1ZiYVYwcGUzWmhjaUJqUFZ3aVpuVnVZM1JwYjI1Y0lqMDlkSGx3Wlc5bUlISmxjWFZwY21VbUpuSmxjWFZwY21VN2FXWW9JV1ltSm1NcGNtVjBkWEp1SUdNb2FTd2hNQ2s3YVdZb2RTbHlaWFIxY200Z2RTaHBMQ0V3S1R0MllYSWdZVDF1WlhjZ1JYSnliM0lvWENKRFlXNXViM1FnWm1sdVpDQnRiMlIxYkdVZ0oxd2lLMmtyWENJblhDSXBPM1JvY205M0lHRXVZMjlrWlQxY0lrMVBSRlZNUlY5T1QxUmZSazlWVGtSY0lpeGhmWFpoY2lCd1BXNWJhVjA5ZTJWNGNHOXlkSE02ZTMxOU8yVmJhVjFiTUYwdVkyRnNiQ2h3TG1WNGNHOXlkSE1zWm5WdVkzUnBiMjRvY2lsN2RtRnlJRzQ5WlZ0cFhWc3hYVnR5WFR0eVpYUjFjbTRnYnlodWZIeHlLWDBzY0N4d0xtVjRjRzl5ZEhNc2NpeGxMRzRzZENsOWNtVjBkWEp1SUc1YmFWMHVaWGh3YjNKMGMzMW1iM0lvZG1GeUlIVTlYQ0ptZFc1amRHbHZibHdpUFQxMGVYQmxiMllnY21WeGRXbHlaU1ltY21WeGRXbHlaU3hwUFRBN2FUeDBMbXhsYm1kMGFEdHBLeXNwYnloMFcybGRLVHR5WlhSMWNtNGdiMzF5WlhSMWNtNGdjbjBwS0NraUxDSXZLaXBjYmlBcUlFTnZjSGx5YVdkb2RDQW9ZeWtnTWpBeE5DMXdjbVZ6Wlc1MExDQkdZV05sWW05dmF5d2dTVzVqTGx4dUlDcGNiaUFxSUZSb2FYTWdjMjkxY21ObElHTnZaR1VnYVhNZ2JHbGpaVzV6WldRZ2RXNWtaWElnZEdobElFMUpWQ0JzYVdObGJuTmxJR1p2ZFc1a0lHbHVJSFJvWlZ4dUlDb2dURWxEUlU1VFJTQm1hV3hsSUdsdUlIUm9aU0J5YjI5MElHUnBjbVZqZEc5eWVTQnZaaUIwYUdseklITnZkWEpqWlNCMGNtVmxMbHh1SUNvdlhHNWNiblpoY2lCeWRXNTBhVzFsSUQwZ0tHWjFibU4wYVc5dUlDaGxlSEJ2Y25SektTQjdYRzRnSUZ3aWRYTmxJSE4wY21samRGd2lPMXh1WEc0Z0lIWmhjaUJQY0NBOUlFOWlhbVZqZEM1d2NtOTBiM1I1Y0dVN1hHNGdJSFpoY2lCb1lYTlBkMjRnUFNCUGNDNW9ZWE5QZDI1UWNtOXdaWEowZVR0Y2JpQWdkbUZ5SUhWdVpHVm1hVzVsWkRzZ0x5OGdUVzl5WlNCamIyMXdjbVZ6YzJsaWJHVWdkR2hoYmlCMmIybGtJREF1WEc0Z0lIWmhjaUFrVTNsdFltOXNJRDBnZEhsd1pXOW1JRk41YldKdmJDQTlQVDBnWENKbWRXNWpkR2x2Ymx3aUlEOGdVM2x0WW05c0lEb2dlMzA3WEc0Z0lIWmhjaUJwZEdWeVlYUnZjbE41YldKdmJDQTlJQ1JUZVcxaWIyd3VhWFJsY21GMGIzSWdmSHdnWENKQVFHbDBaWEpoZEc5eVhDSTdYRzRnSUhaaGNpQmhjM2x1WTBsMFpYSmhkRzl5VTNsdFltOXNJRDBnSkZONWJXSnZiQzVoYzNsdVkwbDBaWEpoZEc5eUlIeDhJRndpUUVCaGMzbHVZMGwwWlhKaGRHOXlYQ0k3WEc0Z0lIWmhjaUIwYjFOMGNtbHVaMVJoWjFONWJXSnZiQ0E5SUNSVGVXMWliMnd1ZEc5VGRISnBibWRVWVdjZ2ZId2dYQ0pBUUhSdlUzUnlhVzVuVkdGblhDSTdYRzVjYmlBZ1puVnVZM1JwYjI0Z1pHVm1hVzVsS0c5aWFpd2dhMlY1TENCMllXeDFaU2tnZTF4dUlDQWdJRTlpYW1WamRDNWtaV1pwYm1WUWNtOXdaWEowZVNodlltb3NJR3RsZVN3Z2UxeHVJQ0FnSUNBZ2RtRnNkV1U2SUhaaGJIVmxMRnh1SUNBZ0lDQWdaVzUxYldWeVlXSnNaVG9nZEhKMVpTeGNiaUFnSUNBZ0lHTnZibVpwWjNWeVlXSnNaVG9nZEhKMVpTeGNiaUFnSUNBZ0lIZHlhWFJoWW14bE9pQjBjblZsWEc0Z0lDQWdmU2s3WEc0Z0lDQWdjbVYwZFhKdUlHOWlhbHRyWlhsZE8xeHVJQ0I5WEc0Z0lIUnllU0I3WEc0Z0lDQWdMeThnU1VVZ09DQm9ZWE1nWVNCaWNtOXJaVzRnVDJKcVpXTjBMbVJsWm1sdVpWQnliM0JsY25SNUlIUm9ZWFFnYjI1c2VTQjNiM0pyY3lCdmJpQkVUMDBnYjJKcVpXTjBjeTVjYmlBZ0lDQmtaV1pwYm1Vb2UzMHNJRndpWENJcE8xeHVJQ0I5SUdOaGRHTm9JQ2hsY25JcElIdGNiaUFnSUNCa1pXWnBibVVnUFNCbWRXNWpkR2x2Ymlodlltb3NJR3RsZVN3Z2RtRnNkV1VwSUh0Y2JpQWdJQ0FnSUhKbGRIVnliaUJ2WW1wYmEyVjVYU0E5SUhaaGJIVmxPMXh1SUNBZ0lIMDdYRzRnSUgxY2JseHVJQ0JtZFc1amRHbHZiaUIzY21Gd0tHbHVibVZ5Um00c0lHOTFkR1Z5Um00c0lITmxiR1lzSUhSeWVVeHZZM05NYVhOMEtTQjdYRzRnSUNBZ0x5OGdTV1lnYjNWMFpYSkdiaUJ3Y205MmFXUmxaQ0JoYm1RZ2IzVjBaWEpHYmk1d2NtOTBiM1I1Y0dVZ2FYTWdZU0JIWlc1bGNtRjBiM0lzSUhSb1pXNGdiM1YwWlhKR2JpNXdjbTkwYjNSNWNHVWdhVzV6ZEdGdVkyVnZaaUJIWlc1bGNtRjBiM0l1WEc0Z0lDQWdkbUZ5SUhCeWIzUnZSMlZ1WlhKaGRHOXlJRDBnYjNWMFpYSkdiaUFtSmlCdmRYUmxja1p1TG5CeWIzUnZkSGx3WlNCcGJuTjBZVzVqWlc5bUlFZGxibVZ5WVhSdmNpQS9JRzkxZEdWeVJtNGdPaUJIWlc1bGNtRjBiM0k3WEc0Z0lDQWdkbUZ5SUdkbGJtVnlZWFJ2Y2lBOUlFOWlhbVZqZEM1amNtVmhkR1VvY0hKdmRHOUhaVzVsY21GMGIzSXVjSEp2ZEc5MGVYQmxLVHRjYmlBZ0lDQjJZWElnWTI5dWRHVjRkQ0E5SUc1bGR5QkRiMjUwWlhoMEtIUnllVXh2WTNOTWFYTjBJSHg4SUZ0ZEtUdGNibHh1SUNBZ0lDOHZJRlJvWlNBdVgybHVkbTlyWlNCdFpYUm9iMlFnZFc1cFptbGxjeUIwYUdVZ2FXMXdiR1Z0Wlc1MFlYUnBiMjV6SUc5bUlIUm9aU0F1Ym1WNGRDeGNiaUFnSUNBdkx5QXVkR2h5YjNjc0lHRnVaQ0F1Y21WMGRYSnVJRzFsZEdodlpITXVYRzRnSUNBZ1oyVnVaWEpoZEc5eUxsOXBiblp2YTJVZ1BTQnRZV3RsU1c1MmIydGxUV1YwYUc5a0tHbHVibVZ5Um00c0lITmxiR1lzSUdOdmJuUmxlSFFwTzF4dVhHNGdJQ0FnY21WMGRYSnVJR2RsYm1WeVlYUnZjanRjYmlBZ2ZWeHVJQ0JsZUhCdmNuUnpMbmR5WVhBZ1BTQjNjbUZ3TzF4dVhHNGdJQzh2SUZSeWVTOWpZWFJqYUNCb1pXeHdaWElnZEc4Z2JXbHVhVzFwZW1VZ1pHVnZjSFJwYldsNllYUnBiMjV6TGlCU1pYUjFjbTV6SUdFZ1kyOXRjR3hsZEdsdmJseHVJQ0F2THlCeVpXTnZjbVFnYkdsclpTQmpiMjUwWlhoMExuUnllVVZ1ZEhKcFpYTmJhVjB1WTI5dGNHeGxkR2x2Ymk0Z1ZHaHBjeUJwYm5SbGNtWmhZMlVnWTI5MWJHUmNiaUFnTHk4Z2FHRjJaU0JpWldWdUlDaGhibVFnZDJGeklIQnlaWFpwYjNWemJIa3BJR1JsYzJsbmJtVmtJSFJ2SUhSaGEyVWdZU0JqYkc5emRYSmxJSFJ2SUdKbFhHNGdJQzh2SUdsdWRtOXJaV1FnZDJsMGFHOTFkQ0JoY21kMWJXVnVkSE1zSUdKMWRDQnBiaUJoYkd3Z2RHaGxJR05oYzJWeklIZGxJR05oY21VZ1lXSnZkWFFnZDJWY2JpQWdMeThnWVd4eVpXRmtlU0JvWVhabElHRnVJR1Y0YVhOMGFXNW5JRzFsZEdodlpDQjNaU0IzWVc1MElIUnZJR05oYkd3c0lITnZJSFJvWlhKbEozTWdibThnYm1WbFpGeHVJQ0F2THlCMGJ5QmpjbVZoZEdVZ1lTQnVaWGNnWm5WdVkzUnBiMjRnYjJKcVpXTjBMaUJYWlNCallXNGdaWFpsYmlCblpYUWdZWGRoZVNCM2FYUm9JR0Z6YzNWdGFXNW5YRzRnSUM4dklIUm9aU0J0WlhSb2IyUWdkR0ZyWlhNZ1pYaGhZM1JzZVNCdmJtVWdZWEpuZFcxbGJuUXNJSE5wYm1ObElIUm9ZWFFnYUdGd2NHVnVjeUIwYnlCaVpTQjBjblZsWEc0Z0lDOHZJR2x1SUdWMlpYSjVJR05oYzJVc0lITnZJSGRsSUdSdmJpZDBJR2hoZG1VZ2RHOGdkRzkxWTJnZ2RHaGxJR0Z5WjNWdFpXNTBjeUJ2WW1wbFkzUXVJRlJvWlZ4dUlDQXZMeUJ2Ym14NUlHRmtaR2wwYVc5dVlXd2dZV3hzYjJOaGRHbHZiaUJ5WlhGMWFYSmxaQ0JwY3lCMGFHVWdZMjl0Y0d4bGRHbHZiaUJ5WldOdmNtUXNJSGRvYVdOb1hHNGdJQzh2SUdoaGN5QmhJSE4wWVdKc1pTQnphR0Z3WlNCaGJtUWdjMjhnYUc5d1pXWjFiR3g1SUhOb2IzVnNaQ0JpWlNCamFHVmhjQ0IwYnlCaGJHeHZZMkYwWlM1Y2JpQWdablZ1WTNScGIyNGdkSEo1UTJGMFkyZ29abTRzSUc5aWFpd2dZWEpuS1NCN1hHNGdJQ0FnZEhKNUlIdGNiaUFnSUNBZ0lISmxkSFZ5YmlCN0lIUjVjR1U2SUZ3aWJtOXliV0ZzWENJc0lHRnlaem9nWm00dVkyRnNiQ2h2WW1vc0lHRnlaeWtnZlR0Y2JpQWdJQ0I5SUdOaGRHTm9JQ2hsY25JcElIdGNiaUFnSUNBZ0lISmxkSFZ5YmlCN0lIUjVjR1U2SUZ3aWRHaHliM2RjSWl3Z1lYSm5PaUJsY25JZ2ZUdGNiaUFnSUNCOVhHNGdJSDFjYmx4dUlDQjJZWElnUjJWdVUzUmhkR1ZUZFhOd1pXNWtaV1JUZEdGeWRDQTlJRndpYzNWemNHVnVaR1ZrVTNSaGNuUmNJanRjYmlBZ2RtRnlJRWRsYmxOMFlYUmxVM1Z6Y0dWdVpHVmtXV2xsYkdRZ1BTQmNJbk4xYzNCbGJtUmxaRmxwWld4a1hDSTdYRzRnSUhaaGNpQkhaVzVUZEdGMFpVVjRaV04xZEdsdVp5QTlJRndpWlhobFkzVjBhVzVuWENJN1hHNGdJSFpoY2lCSFpXNVRkR0YwWlVOdmJYQnNaWFJsWkNBOUlGd2lZMjl0Y0d4bGRHVmtYQ0k3WEc1Y2JpQWdMeThnVW1WMGRYSnVhVzVuSUhSb2FYTWdiMkpxWldOMElHWnliMjBnZEdobElHbHVibVZ5Um00Z2FHRnpJSFJvWlNCellXMWxJR1ZtWm1WamRDQmhjMXh1SUNBdkx5QmljbVZoYTJsdVp5QnZkWFFnYjJZZ2RHaGxJR1JwYzNCaGRHTm9JSE4zYVhSamFDQnpkR0YwWlcxbGJuUXVYRzRnSUhaaGNpQkRiMjUwYVc1MVpWTmxiblJwYm1Wc0lEMGdlMzA3WEc1Y2JpQWdMeThnUkhWdGJYa2dZMjl1YzNSeWRXTjBiM0lnWm5WdVkzUnBiMjV6SUhSb1lYUWdkMlVnZFhObElHRnpJSFJvWlNBdVkyOXVjM1J5ZFdOMGIzSWdZVzVrWEc0Z0lDOHZJQzVqYjI1emRISjFZM1J2Y2k1d2NtOTBiM1I1Y0dVZ2NISnZjR1Z5ZEdsbGN5Qm1iM0lnWm5WdVkzUnBiMjV6SUhSb1lYUWdjbVYwZFhKdUlFZGxibVZ5WVhSdmNseHVJQ0F2THlCdlltcGxZM1J6TGlCR2IzSWdablZzYkNCemNHVmpJR052YlhCc2FXRnVZMlVzSUhsdmRTQnRZWGtnZDJsemFDQjBieUJqYjI1bWFXZDFjbVVnZVc5MWNseHVJQ0F2THlCdGFXNXBabWxsY2lCdWIzUWdkRzhnYldGdVoyeGxJSFJvWlNCdVlXMWxjeUJ2WmlCMGFHVnpaU0IwZDI4Z1puVnVZM1JwYjI1ekxseHVJQ0JtZFc1amRHbHZiaUJIWlc1bGNtRjBiM0lvS1NCN2ZWeHVJQ0JtZFc1amRHbHZiaUJIWlc1bGNtRjBiM0pHZFc1amRHbHZiaWdwSUh0OVhHNGdJR1oxYm1OMGFXOXVJRWRsYm1WeVlYUnZja1oxYm1OMGFXOXVVSEp2ZEc5MGVYQmxLQ2tnZTMxY2JseHVJQ0F2THlCVWFHbHpJR2x6SUdFZ2NHOXNlV1pwYkd3Z1ptOXlJQ1ZKZEdWeVlYUnZjbEJ5YjNSdmRIbHdaU1VnWm05eUlHVnVkbWx5YjI1dFpXNTBjeUIwYUdGMFhHNGdJQzh2SUdSdmJpZDBJRzVoZEdsMlpXeDVJSE4xY0hCdmNuUWdhWFF1WEc0Z0lIWmhjaUJKZEdWeVlYUnZjbEJ5YjNSdmRIbHdaU0E5SUh0OU8xeHVJQ0JKZEdWeVlYUnZjbEJ5YjNSdmRIbHdaVnRwZEdWeVlYUnZjbE41YldKdmJGMGdQU0JtZFc1amRHbHZiaUFvS1NCN1hHNGdJQ0FnY21WMGRYSnVJSFJvYVhNN1hHNGdJSDA3WEc1Y2JpQWdkbUZ5SUdkbGRGQnliM1J2SUQwZ1QySnFaV04wTG1kbGRGQnliM1J2ZEhsd1pVOW1PMXh1SUNCMllYSWdUbUYwYVhabFNYUmxjbUYwYjNKUWNtOTBiM1I1Y0dVZ1BTQm5aWFJRY205MGJ5QW1KaUJuWlhSUWNtOTBieWhuWlhSUWNtOTBieWgyWVd4MVpYTW9XMTBwS1NrN1hHNGdJR2xtSUNoT1lYUnBkbVZKZEdWeVlYUnZjbEJ5YjNSdmRIbHdaU0FtSmx4dUlDQWdJQ0FnVG1GMGFYWmxTWFJsY21GMGIzSlFjbTkwYjNSNWNHVWdJVDA5SUU5d0lDWW1YRzRnSUNBZ0lDQm9ZWE5QZDI0dVkyRnNiQ2hPWVhScGRtVkpkR1Z5WVhSdmNsQnliM1J2ZEhsd1pTd2dhWFJsY21GMGIzSlRlVzFpYjJ3cEtTQjdYRzRnSUNBZ0x5OGdWR2hwY3lCbGJuWnBjbTl1YldWdWRDQm9ZWE1nWVNCdVlYUnBkbVVnSlVsMFpYSmhkRzl5VUhKdmRHOTBlWEJsSlRzZ2RYTmxJR2wwSUdsdWMzUmxZV1JjYmlBZ0lDQXZMeUJ2WmlCMGFHVWdjRzlzZVdacGJHd3VYRzRnSUNBZ1NYUmxjbUYwYjNKUWNtOTBiM1I1Y0dVZ1BTQk9ZWFJwZG1WSmRHVnlZWFJ2Y2xCeWIzUnZkSGx3WlR0Y2JpQWdmVnh1WEc0Z0lIWmhjaUJIY0NBOUlFZGxibVZ5WVhSdmNrWjFibU4wYVc5dVVISnZkRzkwZVhCbExuQnliM1J2ZEhsd1pTQTlYRzRnSUNBZ1IyVnVaWEpoZEc5eUxuQnliM1J2ZEhsd1pTQTlJRTlpYW1WamRDNWpjbVZoZEdVb1NYUmxjbUYwYjNKUWNtOTBiM1I1Y0dVcE8xeHVJQ0JIWlc1bGNtRjBiM0pHZFc1amRHbHZiaTV3Y205MGIzUjVjR1VnUFNCSGNDNWpiMjV6ZEhKMVkzUnZjaUE5SUVkbGJtVnlZWFJ2Y2taMWJtTjBhVzl1VUhKdmRHOTBlWEJsTzF4dUlDQkhaVzVsY21GMGIzSkdkVzVqZEdsdmJsQnliM1J2ZEhsd1pTNWpiMjV6ZEhKMVkzUnZjaUE5SUVkbGJtVnlZWFJ2Y2taMWJtTjBhVzl1TzF4dUlDQkhaVzVsY21GMGIzSkdkVzVqZEdsdmJpNWthWE53YkdGNVRtRnRaU0E5SUdSbFptbHVaU2hjYmlBZ0lDQkhaVzVsY21GMGIzSkdkVzVqZEdsdmJsQnliM1J2ZEhsd1pTeGNiaUFnSUNCMGIxTjBjbWx1WjFSaFoxTjViV0p2YkN4Y2JpQWdJQ0JjSWtkbGJtVnlZWFJ2Y2taMWJtTjBhVzl1WENKY2JpQWdLVHRjYmx4dUlDQXZMeUJJWld4d1pYSWdabTl5SUdSbFptbHVhVzVuSUhSb1pTQXVibVY0ZEN3Z0xuUm9jbTkzTENCaGJtUWdMbkpsZEhWeWJpQnRaWFJvYjJSeklHOW1JSFJvWlZ4dUlDQXZMeUJKZEdWeVlYUnZjaUJwYm5SbGNtWmhZMlVnYVc0Z2RHVnliWE1nYjJZZ1lTQnphVzVuYkdVZ0xsOXBiblp2YTJVZ2JXVjBhRzlrTGx4dUlDQm1kVzVqZEdsdmJpQmtaV1pwYm1WSmRHVnlZWFJ2Y2sxbGRHaHZaSE1vY0hKdmRHOTBlWEJsS1NCN1hHNGdJQ0FnVzF3aWJtVjRkRndpTENCY0luUm9jbTkzWENJc0lGd2ljbVYwZFhKdVhDSmRMbVp2Y2tWaFkyZ29ablZ1WTNScGIyNG9iV1YwYUc5a0tTQjdYRzRnSUNBZ0lDQmtaV1pwYm1Vb2NISnZkRzkwZVhCbExDQnRaWFJvYjJRc0lHWjFibU4wYVc5dUtHRnlaeWtnZTF4dUlDQWdJQ0FnSUNCeVpYUjFjbTRnZEdocGN5NWZhVzUyYjJ0bEtHMWxkR2h2WkN3Z1lYSm5LVHRjYmlBZ0lDQWdJSDBwTzF4dUlDQWdJSDBwTzF4dUlDQjlYRzVjYmlBZ1pYaHdiM0owY3k1cGMwZGxibVZ5WVhSdmNrWjFibU4wYVc5dUlEMGdablZ1WTNScGIyNG9aMlZ1Um5WdUtTQjdYRzRnSUNBZ2RtRnlJR04wYjNJZ1BTQjBlWEJsYjJZZ1oyVnVSblZ1SUQwOVBTQmNJbVoxYm1OMGFXOXVYQ0lnSmlZZ1oyVnVSblZ1TG1OdmJuTjBjblZqZEc5eU8xeHVJQ0FnSUhKbGRIVnliaUJqZEc5eVhHNGdJQ0FnSUNBL0lHTjBiM0lnUFQwOUlFZGxibVZ5WVhSdmNrWjFibU4wYVc5dUlIeDhYRzRnSUNBZ0lDQWdJQzh2SUVadmNpQjBhR1VnYm1GMGFYWmxJRWRsYm1WeVlYUnZja1oxYm1OMGFXOXVJR052Ym5OMGNuVmpkRzl5TENCMGFHVWdZbVZ6ZENCM1pTQmpZVzVjYmlBZ0lDQWdJQ0FnTHk4Z1pHOGdhWE1nZEc4Z1kyaGxZMnNnYVhSeklDNXVZVzFsSUhCeWIzQmxjblI1TGx4dUlDQWdJQ0FnSUNBb1kzUnZjaTVrYVhOd2JHRjVUbUZ0WlNCOGZDQmpkRzl5TG01aGJXVXBJRDA5UFNCY0lrZGxibVZ5WVhSdmNrWjFibU4wYVc5dVhDSmNiaUFnSUNBZ0lEb2dabUZzYzJVN1hHNGdJSDA3WEc1Y2JpQWdaWGh3YjNKMGN5NXRZWEpySUQwZ1puVnVZM1JwYjI0b1oyVnVSblZ1S1NCN1hHNGdJQ0FnYVdZZ0tFOWlhbVZqZEM1elpYUlFjbTkwYjNSNWNHVlBaaWtnZTF4dUlDQWdJQ0FnVDJKcVpXTjBMbk5sZEZCeWIzUnZkSGx3WlU5bUtHZGxia1oxYml3Z1IyVnVaWEpoZEc5eVJuVnVZM1JwYjI1UWNtOTBiM1I1Y0dVcE8xeHVJQ0FnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdJQ0JuWlc1R2RXNHVYMTl3Y205MGIxOWZJRDBnUjJWdVpYSmhkRzl5Um5WdVkzUnBiMjVRY205MGIzUjVjR1U3WEc0Z0lDQWdJQ0JrWldacGJtVW9aMlZ1Um5WdUxDQjBiMU4wY21sdVoxUmhaMU41YldKdmJDd2dYQ0pIWlc1bGNtRjBiM0pHZFc1amRHbHZibHdpS1R0Y2JpQWdJQ0I5WEc0Z0lDQWdaMlZ1Um5WdUxuQnliM1J2ZEhsd1pTQTlJRTlpYW1WamRDNWpjbVZoZEdVb1IzQXBPMXh1SUNBZ0lISmxkSFZ5YmlCblpXNUdkVzQ3WEc0Z0lIMDdYRzVjYmlBZ0x5OGdWMmwwYUdsdUlIUm9aU0JpYjJSNUlHOW1JR0Z1ZVNCaGMzbHVZeUJtZFc1amRHbHZiaXdnWUdGM1lXbDBJSGhnSUdseklIUnlZVzV6Wm05eWJXVmtJSFJ2WEc0Z0lDOHZJR0I1YVdWc1pDQnlaV2RsYm1WeVlYUnZjbEoxYm5ScGJXVXVZWGR5WVhBb2VDbGdMQ0J6YnlCMGFHRjBJSFJvWlNCeWRXNTBhVzFsSUdOaGJpQjBaWE4wWEc0Z0lDOHZJR0JvWVhOUGQyNHVZMkZzYkNoMllXeDFaU3dnWENKZlgyRjNZV2wwWENJcFlDQjBieUJrWlhSbGNtMXBibVVnYVdZZ2RHaGxJSGxwWld4a1pXUWdkbUZzZFdVZ2FYTmNiaUFnTHk4Z2JXVmhiblFnZEc4Z1ltVWdZWGRoYVhSbFpDNWNiaUFnWlhod2IzSjBjeTVoZDNKaGNDQTlJR1oxYm1OMGFXOXVLR0Z5WnlrZ2UxeHVJQ0FnSUhKbGRIVnliaUI3SUY5ZllYZGhhWFE2SUdGeVp5QjlPMXh1SUNCOU8xeHVYRzRnSUdaMWJtTjBhVzl1SUVGemVXNWpTWFJsY21GMGIzSW9aMlZ1WlhKaGRHOXlMQ0JRY205dGFYTmxTVzF3YkNrZ2UxeHVJQ0FnSUdaMWJtTjBhVzl1SUdsdWRtOXJaU2h0WlhSb2IyUXNJR0Z5Wnl3Z2NtVnpiMngyWlN3Z2NtVnFaV04wS1NCN1hHNGdJQ0FnSUNCMllYSWdjbVZqYjNKa0lEMGdkSEo1UTJGMFkyZ29aMlZ1WlhKaGRHOXlXMjFsZEdodlpGMHNJR2RsYm1WeVlYUnZjaXdnWVhKbktUdGNiaUFnSUNBZ0lHbG1JQ2h5WldOdmNtUXVkSGx3WlNBOVBUMGdYQ0owYUhKdmQxd2lLU0I3WEc0Z0lDQWdJQ0FnSUhKbGFtVmpkQ2h5WldOdmNtUXVZWEpuS1R0Y2JpQWdJQ0FnSUgwZ1pXeHpaU0I3WEc0Z0lDQWdJQ0FnSUhaaGNpQnlaWE4xYkhRZ1BTQnlaV052Y21RdVlYSm5PMXh1SUNBZ0lDQWdJQ0IyWVhJZ2RtRnNkV1VnUFNCeVpYTjFiSFF1ZG1Gc2RXVTdYRzRnSUNBZ0lDQWdJR2xtSUNoMllXeDFaU0FtSmx4dUlDQWdJQ0FnSUNBZ0lDQWdkSGx3Wlc5bUlIWmhiSFZsSUQwOVBTQmNJbTlpYW1WamRGd2lJQ1ltWEc0Z0lDQWdJQ0FnSUNBZ0lDQm9ZWE5QZDI0dVkyRnNiQ2gyWVd4MVpTd2dYQ0pmWDJGM1lXbDBYQ0lwS1NCN1hHNGdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlGQnliMjFwYzJWSmJYQnNMbkpsYzI5c2RtVW9kbUZzZFdVdVgxOWhkMkZwZENrdWRHaGxiaWhtZFc1amRHbHZiaWgyWVd4MVpTa2dlMXh1SUNBZ0lDQWdJQ0FnSUNBZ2FXNTJiMnRsS0Z3aWJtVjRkRndpTENCMllXeDFaU3dnY21WemIyeDJaU3dnY21WcVpXTjBLVHRjYmlBZ0lDQWdJQ0FnSUNCOUxDQm1kVzVqZEdsdmJpaGxjbklwSUh0Y2JpQWdJQ0FnSUNBZ0lDQWdJR2x1ZG05clpTaGNJblJvY205M1hDSXNJR1Z5Y2l3Z2NtVnpiMngyWlN3Z2NtVnFaV04wS1R0Y2JpQWdJQ0FnSUNBZ0lDQjlLVHRjYmlBZ0lDQWdJQ0FnZlZ4dVhHNGdJQ0FnSUNBZ0lISmxkSFZ5YmlCUWNtOXRhWE5sU1cxd2JDNXlaWE52YkhabEtIWmhiSFZsS1M1MGFHVnVLR1oxYm1OMGFXOXVLSFZ1ZDNKaGNIQmxaQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lDOHZJRmRvWlc0Z1lTQjVhV1ZzWkdWa0lGQnliMjFwYzJVZ2FYTWdjbVZ6YjJ4MlpXUXNJR2wwY3lCbWFXNWhiQ0IyWVd4MVpTQmlaV052YldWelhHNGdJQ0FnSUNBZ0lDQWdMeThnZEdobElDNTJZV3gxWlNCdlppQjBhR1VnVUhKdmJXbHpaVHg3ZG1Gc2RXVXNaRzl1WlgwK0lISmxjM1ZzZENCbWIzSWdkR2hsWEc0Z0lDQWdJQ0FnSUNBZ0x5OGdZM1Z5Y21WdWRDQnBkR1Z5WVhScGIyNHVYRzRnSUNBZ0lDQWdJQ0FnY21WemRXeDBMblpoYkhWbElEMGdkVzUzY21Gd2NHVmtPMXh1SUNBZ0lDQWdJQ0FnSUhKbGMyOXNkbVVvY21WemRXeDBLVHRjYmlBZ0lDQWdJQ0FnZlN3Z1puVnVZM1JwYjI0b1pYSnliM0lwSUh0Y2JpQWdJQ0FnSUNBZ0lDQXZMeUJKWmlCaElISmxhbVZqZEdWa0lGQnliMjFwYzJVZ2QyRnpJSGxwWld4a1pXUXNJSFJvY205M0lIUm9aU0J5WldwbFkzUnBiMjRnWW1GamExeHVJQ0FnSUNBZ0lDQWdJQzh2SUdsdWRHOGdkR2hsSUdGemVXNWpJR2RsYm1WeVlYUnZjaUJtZFc1amRHbHZiaUJ6YnlCcGRDQmpZVzRnWW1VZ2FHRnVaR3hsWkNCMGFHVnlaUzVjYmlBZ0lDQWdJQ0FnSUNCeVpYUjFjbTRnYVc1MmIydGxLRndpZEdoeWIzZGNJaXdnWlhKeWIzSXNJSEpsYzI5c2RtVXNJSEpsYW1WamRDazdYRzRnSUNBZ0lDQWdJSDBwTzF4dUlDQWdJQ0FnZlZ4dUlDQWdJSDFjYmx4dUlDQWdJSFpoY2lCd2NtVjJhVzkxYzFCeWIyMXBjMlU3WEc1Y2JpQWdJQ0JtZFc1amRHbHZiaUJsYm5GMVpYVmxLRzFsZEdodlpDd2dZWEpuS1NCN1hHNGdJQ0FnSUNCbWRXNWpkR2x2YmlCallXeHNTVzUyYjJ0bFYybDBhRTFsZEdodlpFRnVaRUZ5WnlncElIdGNiaUFnSUNBZ0lDQWdjbVYwZFhKdUlHNWxkeUJRY205dGFYTmxTVzF3YkNobWRXNWpkR2x2YmloeVpYTnZiSFpsTENCeVpXcGxZM1FwSUh0Y2JpQWdJQ0FnSUNBZ0lDQnBiblp2YTJVb2JXVjBhRzlrTENCaGNtY3NJSEpsYzI5c2RtVXNJSEpsYW1WamRDazdYRzRnSUNBZ0lDQWdJSDBwTzF4dUlDQWdJQ0FnZlZ4dVhHNGdJQ0FnSUNCeVpYUjFjbTRnY0hKbGRtbHZkWE5RY205dGFYTmxJRDFjYmlBZ0lDQWdJQ0FnTHk4Z1NXWWdaVzV4ZFdWMVpTQm9ZWE1nWW1WbGJpQmpZV3hzWldRZ1ltVm1iM0psTENCMGFHVnVJSGRsSUhkaGJuUWdkRzhnZDJGcGRDQjFiblJwYkZ4dUlDQWdJQ0FnSUNBdkx5QmhiR3dnY0hKbGRtbHZkWE1nVUhKdmJXbHpaWE1nYUdGMlpTQmlaV1Z1SUhKbGMyOXNkbVZrSUdKbFptOXlaU0JqWVd4c2FXNW5JR2x1ZG05clpTeGNiaUFnSUNBZ0lDQWdMeThnYzI4Z2RHaGhkQ0J5WlhOMWJIUnpJR0Z5WlNCaGJIZGhlWE1nWkdWc2FYWmxjbVZrSUdsdUlIUm9aU0JqYjNKeVpXTjBJRzl5WkdWeUxpQkpabHh1SUNBZ0lDQWdJQ0F2THlCbGJuRjFaWFZsSUdoaGN5QnViM1FnWW1WbGJpQmpZV3hzWldRZ1ltVm1iM0psTENCMGFHVnVJR2wwSUdseklHbHRjRzl5ZEdGdWRDQjBiMXh1SUNBZ0lDQWdJQ0F2THlCallXeHNJR2x1ZG05clpTQnBiVzFsWkdsaGRHVnNlU3dnZDJsMGFHOTFkQ0IzWVdsMGFXNW5JRzl1SUdFZ1kyRnNiR0poWTJzZ2RHOGdabWx5WlN4Y2JpQWdJQ0FnSUNBZ0x5OGdjMjhnZEdoaGRDQjBhR1VnWVhONWJtTWdaMlZ1WlhKaGRHOXlJR1oxYm1OMGFXOXVJR2hoY3lCMGFHVWdiM0J3YjNKMGRXNXBkSGtnZEc4Z1pHOWNiaUFnSUNBZ0lDQWdMeThnWVc1NUlHNWxZMlZ6YzJGeWVTQnpaWFIxY0NCcGJpQmhJSEJ5WldScFkzUmhZbXhsSUhkaGVTNGdWR2hwY3lCd2NtVmthV04wWVdKcGJHbDBlVnh1SUNBZ0lDQWdJQ0F2THlCcGN5QjNhSGtnZEdobElGQnliMjFwYzJVZ1kyOXVjM1J5ZFdOMGIzSWdjM2x1WTJoeWIyNXZkWE5zZVNCcGJuWnZhMlZ6SUdsMGMxeHVJQ0FnSUNBZ0lDQXZMeUJsZUdWamRYUnZjaUJqWVd4c1ltRmpheXdnWVc1a0lIZG9lU0JoYzNsdVl5Qm1kVzVqZEdsdmJuTWdjM2x1WTJoeWIyNXZkWE5zZVZ4dUlDQWdJQ0FnSUNBdkx5QmxlR1ZqZFhSbElHTnZaR1VnWW1WbWIzSmxJSFJvWlNCbWFYSnpkQ0JoZDJGcGRDNGdVMmx1WTJVZ2QyVWdhVzF3YkdWdFpXNTBJSE5wYlhCc1pWeHVJQ0FnSUNBZ0lDQXZMeUJoYzNsdVl5Qm1kVzVqZEdsdmJuTWdhVzRnZEdWeWJYTWdiMllnWVhONWJtTWdaMlZ1WlhKaGRHOXljeXdnYVhRZ2FYTWdaWE53WldOcFlXeHNlVnh1SUNBZ0lDQWdJQ0F2THlCcGJYQnZjblJoYm5RZ2RHOGdaMlYwSUhSb2FYTWdjbWxuYUhRc0lHVjJaVzRnZEdodmRXZG9JR2wwSUhKbGNYVnBjbVZ6SUdOaGNtVXVYRzRnSUNBZ0lDQWdJSEJ5WlhacGIzVnpVSEp2YldselpTQS9JSEJ5WlhacGIzVnpVSEp2YldselpTNTBhR1Z1S0Z4dUlDQWdJQ0FnSUNBZ0lHTmhiR3hKYm5admEyVlhhWFJvVFdWMGFHOWtRVzVrUVhKbkxGeHVJQ0FnSUNBZ0lDQWdJQzh2SUVGMmIybGtJSEJ5YjNCaFoyRjBhVzVuSUdaaGFXeDFjbVZ6SUhSdklGQnliMjFwYzJWeklISmxkSFZ5Ym1Wa0lHSjVJR3hoZEdWeVhHNGdJQ0FnSUNBZ0lDQWdMeThnYVc1MmIyTmhkR2x2Ym5NZ2IyWWdkR2hsSUdsMFpYSmhkRzl5TGx4dUlDQWdJQ0FnSUNBZ0lHTmhiR3hKYm5admEyVlhhWFJvVFdWMGFHOWtRVzVrUVhKblhHNGdJQ0FnSUNBZ0lDa2dPaUJqWVd4c1NXNTJiMnRsVjJsMGFFMWxkR2h2WkVGdVpFRnlaeWdwTzF4dUlDQWdJSDFjYmx4dUlDQWdJQzh2SUVSbFptbHVaU0IwYUdVZ2RXNXBabWxsWkNCb1pXeHdaWElnYldWMGFHOWtJSFJvWVhRZ2FYTWdkWE5sWkNCMGJ5QnBiWEJzWlcxbGJuUWdMbTVsZUhRc1hHNGdJQ0FnTHk4Z0xuUm9jbTkzTENCaGJtUWdMbkpsZEhWeWJpQW9jMlZsSUdSbFptbHVaVWwwWlhKaGRHOXlUV1YwYUc5a2N5a3VYRzRnSUNBZ2RHaHBjeTVmYVc1MmIydGxJRDBnWlc1eGRXVjFaVHRjYmlBZ2ZWeHVYRzRnSUdSbFptbHVaVWwwWlhKaGRHOXlUV1YwYUc5a2N5aEJjM2x1WTBsMFpYSmhkRzl5TG5CeWIzUnZkSGx3WlNrN1hHNGdJRUZ6ZVc1alNYUmxjbUYwYjNJdWNISnZkRzkwZVhCbFcyRnplVzVqU1hSbGNtRjBiM0pUZVcxaWIyeGRJRDBnWm5WdVkzUnBiMjRnS0NrZ2UxeHVJQ0FnSUhKbGRIVnliaUIwYUdsek8xeHVJQ0I5TzF4dUlDQmxlSEJ2Y25SekxrRnplVzVqU1hSbGNtRjBiM0lnUFNCQmMzbHVZMGwwWlhKaGRHOXlPMXh1WEc0Z0lDOHZJRTV2ZEdVZ2RHaGhkQ0J6YVcxd2JHVWdZWE41Ym1NZ1puVnVZM1JwYjI1eklHRnlaU0JwYlhCc1pXMWxiblJsWkNCdmJpQjBiM0FnYjJaY2JpQWdMeThnUVhONWJtTkpkR1Z5WVhSdmNpQnZZbXBsWTNSek95QjBhR1Y1SUdwMWMzUWdjbVYwZFhKdUlHRWdVSEp2YldselpTQm1iM0lnZEdobElIWmhiSFZsSUc5bVhHNGdJQzh2SUhSb1pTQm1hVzVoYkNCeVpYTjFiSFFnY0hKdlpIVmpaV1FnWW5rZ2RHaGxJR2wwWlhKaGRHOXlMbHh1SUNCbGVIQnZjblJ6TG1GemVXNWpJRDBnWm5WdVkzUnBiMjRvYVc1dVpYSkdiaXdnYjNWMFpYSkdiaXdnYzJWc1ppd2dkSEo1VEc5amMweHBjM1FzSUZCeWIyMXBjMlZKYlhCc0tTQjdYRzRnSUNBZ2FXWWdLRkJ5YjIxcGMyVkpiWEJzSUQwOVBTQjJiMmxrSURBcElGQnliMjFwYzJWSmJYQnNJRDBnVUhKdmJXbHpaVHRjYmx4dUlDQWdJSFpoY2lCcGRHVnlJRDBnYm1WM0lFRnplVzVqU1hSbGNtRjBiM0lvWEc0Z0lDQWdJQ0IzY21Gd0tHbHVibVZ5Um00c0lHOTFkR1Z5Um00c0lITmxiR1lzSUhSeWVVeHZZM05NYVhOMEtTeGNiaUFnSUNBZ0lGQnliMjFwYzJWSmJYQnNYRzRnSUNBZ0tUdGNibHh1SUNBZ0lISmxkSFZ5YmlCbGVIQnZjblJ6TG1selIyVnVaWEpoZEc5eVJuVnVZM1JwYjI0b2IzVjBaWEpHYmlsY2JpQWdJQ0FnSUQ4Z2FYUmxjaUF2THlCSlppQnZkWFJsY2tadUlHbHpJR0VnWjJWdVpYSmhkRzl5TENCeVpYUjFjbTRnZEdobElHWjFiR3dnYVhSbGNtRjBiM0l1WEc0Z0lDQWdJQ0E2SUdsMFpYSXVibVY0ZENncExuUm9aVzRvWm5WdVkzUnBiMjRvY21WemRXeDBLU0I3WEc0Z0lDQWdJQ0FnSUNBZ2NtVjBkWEp1SUhKbGMzVnNkQzVrYjI1bElEOGdjbVZ6ZFd4MExuWmhiSFZsSURvZ2FYUmxjaTV1WlhoMEtDazdYRzRnSUNBZ0lDQWdJSDBwTzF4dUlDQjlPMXh1WEc0Z0lHWjFibU4wYVc5dUlHMWhhMlZKYm5admEyVk5aWFJvYjJRb2FXNXVaWEpHYml3Z2MyVnNaaXdnWTI5dWRHVjRkQ2tnZTF4dUlDQWdJSFpoY2lCemRHRjBaU0E5SUVkbGJsTjBZWFJsVTNWemNHVnVaR1ZrVTNSaGNuUTdYRzVjYmlBZ0lDQnlaWFIxY200Z1puVnVZM1JwYjI0Z2FXNTJiMnRsS0cxbGRHaHZaQ3dnWVhKbktTQjdYRzRnSUNBZ0lDQnBaaUFvYzNSaGRHVWdQVDA5SUVkbGJsTjBZWFJsUlhobFkzVjBhVzVuS1NCN1hHNGdJQ0FnSUNBZ0lIUm9jbTkzSUc1bGR5QkZjbkp2Y2loY0lrZGxibVZ5WVhSdmNpQnBjeUJoYkhKbFlXUjVJSEoxYm01cGJtZGNJaWs3WEc0Z0lDQWdJQ0I5WEc1Y2JpQWdJQ0FnSUdsbUlDaHpkR0YwWlNBOVBUMGdSMlZ1VTNSaGRHVkRiMjF3YkdWMFpXUXBJSHRjYmlBZ0lDQWdJQ0FnYVdZZ0tHMWxkR2h2WkNBOVBUMGdYQ0owYUhKdmQxd2lLU0I3WEc0Z0lDQWdJQ0FnSUNBZ2RHaHliM2NnWVhKbk8xeHVJQ0FnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJQ0FnTHk4Z1FtVWdabTl5WjJsMmFXNW5MQ0J3WlhJZ01qVXVNeTR6TGpNdU15QnZaaUIwYUdVZ2MzQmxZenBjYmlBZ0lDQWdJQ0FnTHk4Z2FIUjBjSE02THk5d1pXOXdiR1V1Ylc5NmFXeHNZUzV2Y21jdmZtcHZjbVZ1Wkc5eVptWXZaWE0yTFdSeVlXWjBMbWgwYld3amMyVmpMV2RsYm1WeVlYUnZjbkpsYzNWdFpWeHVJQ0FnSUNBZ0lDQnlaWFIxY200Z1pHOXVaVkpsYzNWc2RDZ3BPMXh1SUNBZ0lDQWdmVnh1WEc0Z0lDQWdJQ0JqYjI1MFpYaDBMbTFsZEdodlpDQTlJRzFsZEdodlpEdGNiaUFnSUNBZ0lHTnZiblJsZUhRdVlYSm5JRDBnWVhKbk8xeHVYRzRnSUNBZ0lDQjNhR2xzWlNBb2RISjFaU2tnZTF4dUlDQWdJQ0FnSUNCMllYSWdaR1ZzWldkaGRHVWdQU0JqYjI1MFpYaDBMbVJsYkdWbllYUmxPMXh1SUNBZ0lDQWdJQ0JwWmlBb1pHVnNaV2RoZEdVcElIdGNiaUFnSUNBZ0lDQWdJQ0IyWVhJZ1pHVnNaV2RoZEdWU1pYTjFiSFFnUFNCdFlYbGlaVWx1ZG05clpVUmxiR1ZuWVhSbEtHUmxiR1ZuWVhSbExDQmpiMjUwWlhoMEtUdGNiaUFnSUNBZ0lDQWdJQ0JwWmlBb1pHVnNaV2RoZEdWU1pYTjFiSFFwSUh0Y2JpQWdJQ0FnSUNBZ0lDQWdJR2xtSUNoa1pXeGxaMkYwWlZKbGMzVnNkQ0E5UFQwZ1EyOXVkR2x1ZFdWVFpXNTBhVzVsYkNrZ1kyOXVkR2x1ZFdVN1hHNGdJQ0FnSUNBZ0lDQWdJQ0J5WlhSMWNtNGdaR1ZzWldkaGRHVlNaWE4xYkhRN1hHNGdJQ0FnSUNBZ0lDQWdmVnh1SUNBZ0lDQWdJQ0I5WEc1Y2JpQWdJQ0FnSUNBZ2FXWWdLR052Ym5SbGVIUXViV1YwYUc5a0lEMDlQU0JjSW01bGVIUmNJaWtnZTF4dUlDQWdJQ0FnSUNBZ0lDOHZJRk5sZEhScGJtY2dZMjl1ZEdWNGRDNWZjMlZ1ZENCbWIzSWdiR1ZuWVdONUlITjFjSEJ2Y25RZ2IyWWdRbUZpWld3bmMxeHVJQ0FnSUNBZ0lDQWdJQzh2SUdaMWJtTjBhVzl1TG5ObGJuUWdhVzF3YkdWdFpXNTBZWFJwYjI0dVhHNGdJQ0FnSUNBZ0lDQWdZMjl1ZEdWNGRDNXpaVzUwSUQwZ1kyOXVkR1Y0ZEM1ZmMyVnVkQ0E5SUdOdmJuUmxlSFF1WVhKbk8xeHVYRzRnSUNBZ0lDQWdJSDBnWld4elpTQnBaaUFvWTI5dWRHVjRkQzV0WlhSb2IyUWdQVDA5SUZ3aWRHaHliM2RjSWlrZ2UxeHVJQ0FnSUNBZ0lDQWdJR2xtSUNoemRHRjBaU0E5UFQwZ1IyVnVVM1JoZEdWVGRYTndaVzVrWldSVGRHRnlkQ2tnZTF4dUlDQWdJQ0FnSUNBZ0lDQWdjM1JoZEdVZ1BTQkhaVzVUZEdGMFpVTnZiWEJzWlhSbFpEdGNiaUFnSUNBZ0lDQWdJQ0FnSUhSb2NtOTNJR052Ym5SbGVIUXVZWEpuTzF4dUlDQWdJQ0FnSUNBZ0lIMWNibHh1SUNBZ0lDQWdJQ0FnSUdOdmJuUmxlSFF1WkdsemNHRjBZMmhGZUdObGNIUnBiMjRvWTI5dWRHVjRkQzVoY21jcE8xeHVYRzRnSUNBZ0lDQWdJSDBnWld4elpTQnBaaUFvWTI5dWRHVjRkQzV0WlhSb2IyUWdQVDA5SUZ3aWNtVjBkWEp1WENJcElIdGNiaUFnSUNBZ0lDQWdJQ0JqYjI1MFpYaDBMbUZpY25Wd2RDaGNJbkpsZEhWeWJsd2lMQ0JqYjI1MFpYaDBMbUZ5WnlrN1hHNGdJQ0FnSUNBZ0lIMWNibHh1SUNBZ0lDQWdJQ0J6ZEdGMFpTQTlJRWRsYmxOMFlYUmxSWGhsWTNWMGFXNW5PMXh1WEc0Z0lDQWdJQ0FnSUhaaGNpQnlaV052Y21RZ1BTQjBjbmxEWVhSamFDaHBibTVsY2tadUxDQnpaV3htTENCamIyNTBaWGgwS1R0Y2JpQWdJQ0FnSUNBZ2FXWWdLSEpsWTI5eVpDNTBlWEJsSUQwOVBTQmNJbTV2Y20xaGJGd2lLU0I3WEc0Z0lDQWdJQ0FnSUNBZ0x5OGdTV1lnWVc0Z1pYaGpaWEIwYVc5dUlHbHpJSFJvY205M2JpQm1jbTl0SUdsdWJtVnlSbTRzSUhkbElHeGxZWFpsSUhOMFlYUmxJRDA5UFZ4dUlDQWdJQ0FnSUNBZ0lDOHZJRWRsYmxOMFlYUmxSWGhsWTNWMGFXNW5JR0Z1WkNCc2IyOXdJR0poWTJzZ1ptOXlJR0Z1YjNSb1pYSWdhVzUyYjJOaGRHbHZiaTVjYmlBZ0lDQWdJQ0FnSUNCemRHRjBaU0E5SUdOdmJuUmxlSFF1Wkc5dVpWeHVJQ0FnSUNBZ0lDQWdJQ0FnUHlCSFpXNVRkR0YwWlVOdmJYQnNaWFJsWkZ4dUlDQWdJQ0FnSUNBZ0lDQWdPaUJIWlc1VGRHRjBaVk4xYzNCbGJtUmxaRmxwWld4a08xeHVYRzRnSUNBZ0lDQWdJQ0FnYVdZZ0tISmxZMjl5WkM1aGNtY2dQVDA5SUVOdmJuUnBiblZsVTJWdWRHbHVaV3dwSUh0Y2JpQWdJQ0FnSUNBZ0lDQWdJR052Ym5ScGJuVmxPMXh1SUNBZ0lDQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ0lDQWdJSEpsZEhWeWJpQjdYRzRnSUNBZ0lDQWdJQ0FnSUNCMllXeDFaVG9nY21WamIzSmtMbUZ5Wnl4Y2JpQWdJQ0FnSUNBZ0lDQWdJR1J2Ym1VNklHTnZiblJsZUhRdVpHOXVaVnh1SUNBZ0lDQWdJQ0FnSUgwN1hHNWNiaUFnSUNBZ0lDQWdmU0JsYkhObElHbG1JQ2h5WldOdmNtUXVkSGx3WlNBOVBUMGdYQ0owYUhKdmQxd2lLU0I3WEc0Z0lDQWdJQ0FnSUNBZ2MzUmhkR1VnUFNCSFpXNVRkR0YwWlVOdmJYQnNaWFJsWkR0Y2JpQWdJQ0FnSUNBZ0lDQXZMeUJFYVhOd1lYUmphQ0IwYUdVZ1pYaGpaWEIwYVc5dUlHSjVJR3h2YjNCcGJtY2dZbUZqYXlCaGNtOTFibVFnZEc4Z2RHaGxYRzRnSUNBZ0lDQWdJQ0FnTHk4Z1kyOXVkR1Y0ZEM1a2FYTndZWFJqYUVWNFkyVndkR2x2YmloamIyNTBaWGgwTG1GeVp5a2dZMkZzYkNCaFltOTJaUzVjYmlBZ0lDQWdJQ0FnSUNCamIyNTBaWGgwTG0xbGRHaHZaQ0E5SUZ3aWRHaHliM2RjSWp0Y2JpQWdJQ0FnSUNBZ0lDQmpiMjUwWlhoMExtRnlaeUE5SUhKbFkyOXlaQzVoY21jN1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lIMWNiaUFnSUNCOU8xeHVJQ0I5WEc1Y2JpQWdMeThnUTJGc2JDQmtaV3hsWjJGMFpTNXBkR1Z5WVhSdmNsdGpiMjUwWlhoMExtMWxkR2h2WkYwb1kyOXVkR1Y0ZEM1aGNtY3BJR0Z1WkNCb1lXNWtiR1VnZEdobFhHNGdJQzh2SUhKbGMzVnNkQ3dnWldsMGFHVnlJR0o1SUhKbGRIVnlibWx1WnlCaElIc2dkbUZzZFdVc0lHUnZibVVnZlNCeVpYTjFiSFFnWm5KdmJTQjBhR1ZjYmlBZ0x5OGdaR1ZzWldkaGRHVWdhWFJsY21GMGIzSXNJRzl5SUdKNUlHMXZaR2xtZVdsdVp5QmpiMjUwWlhoMExtMWxkR2h2WkNCaGJtUWdZMjl1ZEdWNGRDNWhjbWNzWEc0Z0lDOHZJSE5sZEhScGJtY2dZMjl1ZEdWNGRDNWtaV3hsWjJGMFpTQjBieUJ1ZFd4c0xDQmhibVFnY21WMGRYSnVhVzVuSUhSb1pTQkRiMjUwYVc1MVpWTmxiblJwYm1Wc0xseHVJQ0JtZFc1amRHbHZiaUJ0WVhsaVpVbHVkbTlyWlVSbGJHVm5ZWFJsS0dSbGJHVm5ZWFJsTENCamIyNTBaWGgwS1NCN1hHNGdJQ0FnZG1GeUlHMWxkR2h2WkNBOUlHUmxiR1ZuWVhSbExtbDBaWEpoZEc5eVcyTnZiblJsZUhRdWJXVjBhRzlrWFR0Y2JpQWdJQ0JwWmlBb2JXVjBhRzlrSUQwOVBTQjFibVJsWm1sdVpXUXBJSHRjYmlBZ0lDQWdJQzh2SUVFZ0xuUm9jbTkzSUc5eUlDNXlaWFIxY200Z2QyaGxiaUIwYUdVZ1pHVnNaV2RoZEdVZ2FYUmxjbUYwYjNJZ2FHRnpJRzV2SUM1MGFISnZkMXh1SUNBZ0lDQWdMeThnYldWMGFHOWtJR0ZzZDJGNWN5QjBaWEp0YVc1aGRHVnpJSFJvWlNCNWFXVnNaQ29nYkc5dmNDNWNiaUFnSUNBZ0lHTnZiblJsZUhRdVpHVnNaV2RoZEdVZ1BTQnVkV3hzTzF4dVhHNGdJQ0FnSUNCcFppQW9ZMjl1ZEdWNGRDNXRaWFJvYjJRZ1BUMDlJRndpZEdoeWIzZGNJaWtnZTF4dUlDQWdJQ0FnSUNBdkx5Qk9iM1JsT2lCYlhDSnlaWFIxY201Y0lsMGdiWFZ6ZENCaVpTQjFjMlZrSUdadmNpQkZVek1nY0dGeWMybHVaeUJqYjIxd1lYUnBZbWxzYVhSNUxseHVJQ0FnSUNBZ0lDQnBaaUFvWkdWc1pXZGhkR1V1YVhSbGNtRjBiM0piWENKeVpYUjFjbTVjSWwwcElIdGNiaUFnSUNBZ0lDQWdJQ0F2THlCSlppQjBhR1VnWkdWc1pXZGhkR1VnYVhSbGNtRjBiM0lnYUdGeklHRWdjbVYwZFhKdUlHMWxkR2h2WkN3Z1oybDJaU0JwZENCaFhHNGdJQ0FnSUNBZ0lDQWdMeThnWTJoaGJtTmxJSFJ2SUdOc1pXRnVJSFZ3TGx4dUlDQWdJQ0FnSUNBZ0lHTnZiblJsZUhRdWJXVjBhRzlrSUQwZ1hDSnlaWFIxY201Y0lqdGNiaUFnSUNBZ0lDQWdJQ0JqYjI1MFpYaDBMbUZ5WnlBOUlIVnVaR1ZtYVc1bFpEdGNiaUFnSUNBZ0lDQWdJQ0J0WVhsaVpVbHVkbTlyWlVSbGJHVm5ZWFJsS0dSbGJHVm5ZWFJsTENCamIyNTBaWGgwS1R0Y2JseHVJQ0FnSUNBZ0lDQWdJR2xtSUNoamIyNTBaWGgwTG0xbGRHaHZaQ0E5UFQwZ1hDSjBhSEp2ZDF3aUtTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNBdkx5QkpaaUJ0WVhsaVpVbHVkbTlyWlVSbGJHVm5ZWFJsS0dOdmJuUmxlSFFwSUdOb1lXNW5aV1FnWTI5dWRHVjRkQzV0WlhSb2IyUWdabkp2YlZ4dUlDQWdJQ0FnSUNBZ0lDQWdMeThnWENKeVpYUjFjbTVjSWlCMGJ5QmNJblJvY205M1hDSXNJR3hsZENCMGFHRjBJRzkyWlhKeWFXUmxJSFJvWlNCVWVYQmxSWEp5YjNJZ1ltVnNiM2N1WEc0Z0lDQWdJQ0FnSUNBZ0lDQnlaWFIxY200Z1EyOXVkR2x1ZFdWVFpXNTBhVzVsYkR0Y2JpQWdJQ0FnSUNBZ0lDQjlYRzRnSUNBZ0lDQWdJSDFjYmx4dUlDQWdJQ0FnSUNCamIyNTBaWGgwTG0xbGRHaHZaQ0E5SUZ3aWRHaHliM2RjSWp0Y2JpQWdJQ0FnSUNBZ1kyOXVkR1Y0ZEM1aGNtY2dQU0J1WlhjZ1ZIbHdaVVZ5Y205eUtGeHVJQ0FnSUNBZ0lDQWdJRndpVkdobElHbDBaWEpoZEc5eUlHUnZaWE1nYm05MElIQnliM1pwWkdVZ1lTQW5kR2h5YjNjbklHMWxkR2h2WkZ3aUtUdGNiaUFnSUNBZ0lIMWNibHh1SUNBZ0lDQWdjbVYwZFhKdUlFTnZiblJwYm5WbFUyVnVkR2x1Wld3N1hHNGdJQ0FnZlZ4dVhHNGdJQ0FnZG1GeUlISmxZMjl5WkNBOUlIUnllVU5oZEdOb0tHMWxkR2h2WkN3Z1pHVnNaV2RoZEdVdWFYUmxjbUYwYjNJc0lHTnZiblJsZUhRdVlYSm5LVHRjYmx4dUlDQWdJR2xtSUNoeVpXTnZjbVF1ZEhsd1pTQTlQVDBnWENKMGFISnZkMXdpS1NCN1hHNGdJQ0FnSUNCamIyNTBaWGgwTG0xbGRHaHZaQ0E5SUZ3aWRHaHliM2RjSWp0Y2JpQWdJQ0FnSUdOdmJuUmxlSFF1WVhKbklEMGdjbVZqYjNKa0xtRnlaenRjYmlBZ0lDQWdJR052Ym5SbGVIUXVaR1ZzWldkaGRHVWdQU0J1ZFd4c08xeHVJQ0FnSUNBZ2NtVjBkWEp1SUVOdmJuUnBiblZsVTJWdWRHbHVaV3c3WEc0Z0lDQWdmVnh1WEc0Z0lDQWdkbUZ5SUdsdVptOGdQU0J5WldOdmNtUXVZWEpuTzF4dVhHNGdJQ0FnYVdZZ0tDRWdhVzVtYnlrZ2UxeHVJQ0FnSUNBZ1kyOXVkR1Y0ZEM1dFpYUm9iMlFnUFNCY0luUm9jbTkzWENJN1hHNGdJQ0FnSUNCamIyNTBaWGgwTG1GeVp5QTlJRzVsZHlCVWVYQmxSWEp5YjNJb1hDSnBkR1Z5WVhSdmNpQnlaWE4xYkhRZ2FYTWdibTkwSUdGdUlHOWlhbVZqZEZ3aUtUdGNiaUFnSUNBZ0lHTnZiblJsZUhRdVpHVnNaV2RoZEdVZ1BTQnVkV3hzTzF4dUlDQWdJQ0FnY21WMGRYSnVJRU52Ym5ScGJuVmxVMlZ1ZEdsdVpXdzdYRzRnSUNBZ2ZWeHVYRzRnSUNBZ2FXWWdLR2x1Wm04dVpHOXVaU2tnZTF4dUlDQWdJQ0FnTHk4Z1FYTnphV2R1SUhSb1pTQnlaWE4xYkhRZ2IyWWdkR2hsSUdacGJtbHphR1ZrSUdSbGJHVm5ZWFJsSUhSdklIUm9aU0IwWlcxd2IzSmhjbmxjYmlBZ0lDQWdJQzh2SUhaaGNtbGhZbXhsSUhOd1pXTnBabWxsWkNCaWVTQmtaV3hsWjJGMFpTNXlaWE4xYkhST1lXMWxJQ2h6WldVZ1pHVnNaV2RoZEdWWmFXVnNaQ2t1WEc0Z0lDQWdJQ0JqYjI1MFpYaDBXMlJsYkdWbllYUmxMbkpsYzNWc2RFNWhiV1ZkSUQwZ2FXNW1ieTUyWVd4MVpUdGNibHh1SUNBZ0lDQWdMeThnVW1WemRXMWxJR1Y0WldOMWRHbHZiaUJoZENCMGFHVWdaR1Z6YVhKbFpDQnNiMk5oZEdsdmJpQW9jMlZsSUdSbGJHVm5ZWFJsV1dsbGJHUXBMbHh1SUNBZ0lDQWdZMjl1ZEdWNGRDNXVaWGgwSUQwZ1pHVnNaV2RoZEdVdWJtVjRkRXh2WXp0Y2JseHVJQ0FnSUNBZ0x5OGdTV1lnWTI5dWRHVjRkQzV0WlhSb2IyUWdkMkZ6SUZ3aWRHaHliM2RjSWlCaWRYUWdkR2hsSUdSbGJHVm5ZWFJsSUdoaGJtUnNaV1FnZEdobFhHNGdJQ0FnSUNBdkx5QmxlR05sY0hScGIyNHNJR3hsZENCMGFHVWdiM1YwWlhJZ1oyVnVaWEpoZEc5eUlIQnliMk5sWldRZ2JtOXliV0ZzYkhrdUlFbG1YRzRnSUNBZ0lDQXZMeUJqYjI1MFpYaDBMbTFsZEdodlpDQjNZWE1nWENKdVpYaDBYQ0lzSUdadmNtZGxkQ0JqYjI1MFpYaDBMbUZ5WnlCemFXNWpaU0JwZENCb1lYTWdZbVZsYmx4dUlDQWdJQ0FnTHk4Z1hDSmpiMjV6ZFcxbFpGd2lJR0o1SUhSb1pTQmtaV3hsWjJGMFpTQnBkR1Z5WVhSdmNpNGdTV1lnWTI5dWRHVjRkQzV0WlhSb2IyUWdkMkZ6WEc0Z0lDQWdJQ0F2THlCY0luSmxkSFZ5Ymx3aUxDQmhiR3h2ZHlCMGFHVWdiM0pwWjJsdVlXd2dMbkpsZEhWeWJpQmpZV3hzSUhSdklHTnZiblJwYm5WbElHbHVJSFJvWlZ4dUlDQWdJQ0FnTHk4Z2IzVjBaWElnWjJWdVpYSmhkRzl5TGx4dUlDQWdJQ0FnYVdZZ0tHTnZiblJsZUhRdWJXVjBhRzlrSUNFOVBTQmNJbkpsZEhWeWJsd2lLU0I3WEc0Z0lDQWdJQ0FnSUdOdmJuUmxlSFF1YldWMGFHOWtJRDBnWENKdVpYaDBYQ0k3WEc0Z0lDQWdJQ0FnSUdOdmJuUmxlSFF1WVhKbklEMGdkVzVrWldacGJtVmtPMXh1SUNBZ0lDQWdmVnh1WEc0Z0lDQWdmU0JsYkhObElIdGNiaUFnSUNBZ0lDOHZJRkpsTFhscFpXeGtJSFJvWlNCeVpYTjFiSFFnY21WMGRYSnVaV1FnWW5rZ2RHaGxJR1JsYkdWbllYUmxJRzFsZEdodlpDNWNiaUFnSUNBZ0lISmxkSFZ5YmlCcGJtWnZPMXh1SUNBZ0lIMWNibHh1SUNBZ0lDOHZJRlJvWlNCa1pXeGxaMkYwWlNCcGRHVnlZWFJ2Y2lCcGN5Qm1hVzVwYzJobFpDd2djMjhnWm05eVoyVjBJR2wwSUdGdVpDQmpiMjUwYVc1MVpTQjNhWFJvWEc0Z0lDQWdMeThnZEdobElHOTFkR1Z5SUdkbGJtVnlZWFJ2Y2k1Y2JpQWdJQ0JqYjI1MFpYaDBMbVJsYkdWbllYUmxJRDBnYm5Wc2JEdGNiaUFnSUNCeVpYUjFjbTRnUTI5dWRHbHVkV1ZUWlc1MGFXNWxiRHRjYmlBZ2ZWeHVYRzRnSUM4dklFUmxabWx1WlNCSFpXNWxjbUYwYjNJdWNISnZkRzkwZVhCbExudHVaWGgwTEhSb2NtOTNMSEpsZEhWeWJuMGdhVzRnZEdWeWJYTWdiMllnZEdobFhHNGdJQzh2SUhWdWFXWnBaV1FnTGw5cGJuWnZhMlVnYUdWc2NHVnlJRzFsZEdodlpDNWNiaUFnWkdWbWFXNWxTWFJsY21GMGIzSk5aWFJvYjJSektFZHdLVHRjYmx4dUlDQmtaV1pwYm1Vb1IzQXNJSFJ2VTNSeWFXNW5WR0ZuVTNsdFltOXNMQ0JjSWtkbGJtVnlZWFJ2Y2x3aUtUdGNibHh1SUNBdkx5QkJJRWRsYm1WeVlYUnZjaUJ6YUc5MWJHUWdZV3gzWVhseklISmxkSFZ5YmlCcGRITmxiR1lnWVhNZ2RHaGxJR2wwWlhKaGRHOXlJRzlpYW1WamRDQjNhR1Z1SUhSb1pWeHVJQ0F2THlCQVFHbDBaWEpoZEc5eUlHWjFibU4wYVc5dUlHbHpJR05oYkd4bFpDQnZiaUJwZEM0Z1UyOXRaU0JpY205M2MyVnljeWNnYVcxd2JHVnRaVzUwWVhScGIyNXpJRzltSUhSb1pWeHVJQ0F2THlCcGRHVnlZWFJ2Y2lCd2NtOTBiM1I1Y0dVZ1kyaGhhVzRnYVc1amIzSnlaV04wYkhrZ2FXMXdiR1Z0Wlc1MElIUm9hWE1zSUdOaGRYTnBibWNnZEdobElFZGxibVZ5WVhSdmNseHVJQ0F2THlCdlltcGxZM1FnZEc4Z2JtOTBJR0psSUhKbGRIVnlibVZrSUdaeWIyMGdkR2hwY3lCallXeHNMaUJVYUdseklHVnVjM1Z5WlhNZ2RHaGhkQ0JrYjJWemJpZDBJR2hoY0hCbGJpNWNiaUFnTHk4Z1UyVmxJR2gwZEhCek9pOHZaMmwwYUhWaUxtTnZiUzltWVdObFltOXZheTl5WldkbGJtVnlZWFJ2Y2k5cGMzTjFaWE12TWpjMElHWnZjaUJ0YjNKbElHUmxkR0ZwYkhNdVhHNGdJRWR3VzJsMFpYSmhkRzl5VTNsdFltOXNYU0E5SUdaMWJtTjBhVzl1S0NrZ2UxeHVJQ0FnSUhKbGRIVnliaUIwYUdsek8xeHVJQ0I5TzF4dVhHNGdJRWR3TG5SdlUzUnlhVzVuSUQwZ1puVnVZM1JwYjI0b0tTQjdYRzRnSUNBZ2NtVjBkWEp1SUZ3aVcyOWlhbVZqZENCSFpXNWxjbUYwYjNKZFhDSTdYRzRnSUgwN1hHNWNiaUFnWm5WdVkzUnBiMjRnY0hWemFGUnllVVZ1ZEhKNUtHeHZZM01wSUh0Y2JpQWdJQ0IyWVhJZ1pXNTBjbmtnUFNCN0lIUnllVXh2WXpvZ2JHOWpjMXN3WFNCOU8xeHVYRzRnSUNBZ2FXWWdLREVnYVc0Z2JHOWpjeWtnZTF4dUlDQWdJQ0FnWlc1MGNua3VZMkYwWTJoTWIyTWdQU0JzYjJOeld6RmRPMXh1SUNBZ0lIMWNibHh1SUNBZ0lHbG1JQ2d5SUdsdUlHeHZZM01wSUh0Y2JpQWdJQ0FnSUdWdWRISjVMbVpwYm1Gc2JIbE1iMk1nUFNCc2IyTnpXekpkTzF4dUlDQWdJQ0FnWlc1MGNua3VZV1owWlhKTWIyTWdQU0JzYjJOeld6TmRPMXh1SUNBZ0lIMWNibHh1SUNBZ0lIUm9hWE11ZEhKNVJXNTBjbWxsY3k1d2RYTm9LR1Z1ZEhKNUtUdGNiaUFnZlZ4dVhHNGdJR1oxYm1OMGFXOXVJSEpsYzJWMFZISjVSVzUwY25rb1pXNTBjbmtwSUh0Y2JpQWdJQ0IyWVhJZ2NtVmpiM0prSUQwZ1pXNTBjbmt1WTI5dGNHeGxkR2x2YmlCOGZDQjdmVHRjYmlBZ0lDQnlaV052Y21RdWRIbHdaU0E5SUZ3aWJtOXliV0ZzWENJN1hHNGdJQ0FnWkdWc1pYUmxJSEpsWTI5eVpDNWhjbWM3WEc0Z0lDQWdaVzUwY25rdVkyOXRjR3hsZEdsdmJpQTlJSEpsWTI5eVpEdGNiaUFnZlZ4dVhHNGdJR1oxYm1OMGFXOXVJRU52Ym5SbGVIUW9kSEo1VEc5amMweHBjM1FwSUh0Y2JpQWdJQ0F2THlCVWFHVWdjbTl2ZENCbGJuUnllU0J2WW1wbFkzUWdLR1ZtWm1WamRHbDJaV3g1SUdFZ2RISjVJSE4wWVhSbGJXVnVkQ0IzYVhSb2IzVjBJR0VnWTJGMFkyaGNiaUFnSUNBdkx5QnZjaUJoSUdacGJtRnNiSGtnWW14dlkyc3BJR2RwZG1WeklIVnpJR0VnY0d4aFkyVWdkRzhnYzNSdmNtVWdkbUZzZFdWeklIUm9jbTkzYmlCbWNtOXRYRzRnSUNBZ0x5OGdiRzlqWVhScGIyNXpJSGRvWlhKbElIUm9aWEpsSUdseklHNXZJR1Z1WTJ4dmMybHVaeUIwY25rZ2MzUmhkR1Z0Wlc1MExseHVJQ0FnSUhSb2FYTXVkSEo1Ulc1MGNtbGxjeUE5SUZ0N0lIUnllVXh2WXpvZ1hDSnliMjkwWENJZ2ZWMDdYRzRnSUNBZ2RISjVURzlqYzB4cGMzUXVabTl5UldGamFDaHdkWE5vVkhKNVJXNTBjbmtzSUhSb2FYTXBPMXh1SUNBZ0lIUm9hWE11Y21WelpYUW9kSEoxWlNrN1hHNGdJSDFjYmx4dUlDQmxlSEJ2Y25SekxtdGxlWE1nUFNCbWRXNWpkR2x2YmlodlltcGxZM1FwSUh0Y2JpQWdJQ0IyWVhJZ2EyVjVjeUE5SUZ0ZE8xeHVJQ0FnSUdadmNpQW9kbUZ5SUd0bGVTQnBiaUJ2WW1wbFkzUXBJSHRjYmlBZ0lDQWdJR3RsZVhNdWNIVnphQ2hyWlhrcE8xeHVJQ0FnSUgxY2JpQWdJQ0JyWlhsekxuSmxkbVZ5YzJVb0tUdGNibHh1SUNBZ0lDOHZJRkpoZEdobGNpQjBhR0Z1SUhKbGRIVnlibWx1WnlCaGJpQnZZbXBsWTNRZ2QybDBhQ0JoSUc1bGVIUWdiV1YwYUc5a0xDQjNaU0JyWldWd1hHNGdJQ0FnTHk4Z2RHaHBibWR6SUhOcGJYQnNaU0JoYm1RZ2NtVjBkWEp1SUhSb1pTQnVaWGgwSUdaMWJtTjBhVzl1SUdsMGMyVnNaaTVjYmlBZ0lDQnlaWFIxY200Z1puVnVZM1JwYjI0Z2JtVjRkQ2dwSUh0Y2JpQWdJQ0FnSUhkb2FXeGxJQ2hyWlhsekxteGxibWQwYUNrZ2UxeHVJQ0FnSUNBZ0lDQjJZWElnYTJWNUlEMGdhMlY1Y3k1d2IzQW9LVHRjYmlBZ0lDQWdJQ0FnYVdZZ0tHdGxlU0JwYmlCdlltcGxZM1FwSUh0Y2JpQWdJQ0FnSUNBZ0lDQnVaWGgwTG5aaGJIVmxJRDBnYTJWNU8xeHVJQ0FnSUNBZ0lDQWdJRzVsZUhRdVpHOXVaU0E5SUdaaGJITmxPMXh1SUNBZ0lDQWdJQ0FnSUhKbGRIVnliaUJ1WlhoME8xeHVJQ0FnSUNBZ0lDQjlYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJQzh2SUZSdklHRjJiMmxrSUdOeVpXRjBhVzVuSUdGdUlHRmtaR2wwYVc5dVlXd2diMkpxWldOMExDQjNaU0JxZFhOMElHaGhibWNnZEdobElDNTJZV3gxWlZ4dUlDQWdJQ0FnTHk4Z1lXNWtJQzVrYjI1bElIQnliM0JsY25ScFpYTWdiMlptSUhSb1pTQnVaWGgwSUdaMWJtTjBhVzl1SUc5aWFtVmpkQ0JwZEhObGJHWXVJRlJvYVhOY2JpQWdJQ0FnSUM4dklHRnNjMjhnWlc1emRYSmxjeUIwYUdGMElIUm9aU0J0YVc1cFptbGxjaUIzYVd4c0lHNXZkQ0JoYm05dWVXMXBlbVVnZEdobElHWjFibU4wYVc5dUxseHVJQ0FnSUNBZ2JtVjRkQzVrYjI1bElEMGdkSEoxWlR0Y2JpQWdJQ0FnSUhKbGRIVnliaUJ1WlhoME8xeHVJQ0FnSUgwN1hHNGdJSDA3WEc1Y2JpQWdablZ1WTNScGIyNGdkbUZzZFdWektHbDBaWEpoWW14bEtTQjdYRzRnSUNBZ2FXWWdLR2wwWlhKaFlteGxLU0I3WEc0Z0lDQWdJQ0IyWVhJZ2FYUmxjbUYwYjNKTlpYUm9iMlFnUFNCcGRHVnlZV0pzWlZ0cGRHVnlZWFJ2Y2xONWJXSnZiRjA3WEc0Z0lDQWdJQ0JwWmlBb2FYUmxjbUYwYjNKTlpYUm9iMlFwSUh0Y2JpQWdJQ0FnSUNBZ2NtVjBkWEp1SUdsMFpYSmhkRzl5VFdWMGFHOWtMbU5oYkd3b2FYUmxjbUZpYkdVcE8xeHVJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQnBaaUFvZEhsd1pXOW1JR2wwWlhKaFlteGxMbTVsZUhRZ1BUMDlJRndpWm5WdVkzUnBiMjVjSWlrZ2UxeHVJQ0FnSUNBZ0lDQnlaWFIxY200Z2FYUmxjbUZpYkdVN1hHNGdJQ0FnSUNCOVhHNWNiaUFnSUNBZ0lHbG1JQ2doYVhOT1lVNG9hWFJsY21GaWJHVXViR1Z1WjNSb0tTa2dlMXh1SUNBZ0lDQWdJQ0IyWVhJZ2FTQTlJQzB4TENCdVpYaDBJRDBnWm5WdVkzUnBiMjRnYm1WNGRDZ3BJSHRjYmlBZ0lDQWdJQ0FnSUNCM2FHbHNaU0FvS3l0cElEd2dhWFJsY21GaWJHVXViR1Z1WjNSb0tTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNCcFppQW9hR0Z6VDNkdUxtTmhiR3dvYVhSbGNtRmliR1VzSUdrcEtTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNBZ0lHNWxlSFF1ZG1Gc2RXVWdQU0JwZEdWeVlXSnNaVnRwWFR0Y2JpQWdJQ0FnSUNBZ0lDQWdJQ0FnYm1WNGRDNWtiMjVsSUQwZ1ptRnNjMlU3WEc0Z0lDQWdJQ0FnSUNBZ0lDQWdJSEpsZEhWeWJpQnVaWGgwTzF4dUlDQWdJQ0FnSUNBZ0lDQWdmVnh1SUNBZ0lDQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ0lDQWdJRzVsZUhRdWRtRnNkV1VnUFNCMWJtUmxabWx1WldRN1hHNGdJQ0FnSUNBZ0lDQWdibVY0ZEM1a2IyNWxJRDBnZEhKMVpUdGNibHh1SUNBZ0lDQWdJQ0FnSUhKbGRIVnliaUJ1WlhoME8xeHVJQ0FnSUNBZ0lDQjlPMXh1WEc0Z0lDQWdJQ0FnSUhKbGRIVnliaUJ1WlhoMExtNWxlSFFnUFNCdVpYaDBPMXh1SUNBZ0lDQWdmVnh1SUNBZ0lIMWNibHh1SUNBZ0lDOHZJRkpsZEhWeWJpQmhiaUJwZEdWeVlYUnZjaUIzYVhSb0lHNXZJSFpoYkhWbGN5NWNiaUFnSUNCeVpYUjFjbTRnZXlCdVpYaDBPaUJrYjI1bFVtVnpkV3gwSUgwN1hHNGdJSDFjYmlBZ1pYaHdiM0owY3k1MllXeDFaWE1nUFNCMllXeDFaWE03WEc1Y2JpQWdablZ1WTNScGIyNGdaRzl1WlZKbGMzVnNkQ2dwSUh0Y2JpQWdJQ0J5WlhSMWNtNGdleUIyWVd4MVpUb2dkVzVrWldacGJtVmtMQ0JrYjI1bE9pQjBjblZsSUgwN1hHNGdJSDFjYmx4dUlDQkRiMjUwWlhoMExuQnliM1J2ZEhsd1pTQTlJSHRjYmlBZ0lDQmpiMjV6ZEhKMVkzUnZjam9nUTI5dWRHVjRkQ3hjYmx4dUlDQWdJSEpsYzJWME9pQm1kVzVqZEdsdmJpaHphMmx3VkdWdGNGSmxjMlYwS1NCN1hHNGdJQ0FnSUNCMGFHbHpMbkJ5WlhZZ1BTQXdPMXh1SUNBZ0lDQWdkR2hwY3k1dVpYaDBJRDBnTUR0Y2JpQWdJQ0FnSUM4dklGSmxjMlYwZEdsdVp5QmpiMjUwWlhoMExsOXpaVzUwSUdadmNpQnNaV2RoWTNrZ2MzVndjRzl5ZENCdlppQkNZV0psYkNkelhHNGdJQ0FnSUNBdkx5Qm1kVzVqZEdsdmJpNXpaVzUwSUdsdGNHeGxiV1Z1ZEdGMGFXOXVMbHh1SUNBZ0lDQWdkR2hwY3k1elpXNTBJRDBnZEdocGN5NWZjMlZ1ZENBOUlIVnVaR1ZtYVc1bFpEdGNiaUFnSUNBZ0lIUm9hWE11Wkc5dVpTQTlJR1poYkhObE8xeHVJQ0FnSUNBZ2RHaHBjeTVrWld4bFoyRjBaU0E5SUc1MWJHdzdYRzVjYmlBZ0lDQWdJSFJvYVhNdWJXVjBhRzlrSUQwZ1hDSnVaWGgwWENJN1hHNGdJQ0FnSUNCMGFHbHpMbUZ5WnlBOUlIVnVaR1ZtYVc1bFpEdGNibHh1SUNBZ0lDQWdkR2hwY3k1MGNubEZiblJ5YVdWekxtWnZja1ZoWTJnb2NtVnpaWFJVY25sRmJuUnllU2s3WEc1Y2JpQWdJQ0FnSUdsbUlDZ2hjMnRwY0ZSbGJYQlNaWE5sZENrZ2UxeHVJQ0FnSUNBZ0lDQm1iM0lnS0haaGNpQnVZVzFsSUdsdUlIUm9hWE1wSUh0Y2JpQWdJQ0FnSUNBZ0lDQXZMeUJPYjNRZ2MzVnlaU0JoWW05MWRDQjBhR1VnYjNCMGFXMWhiQ0J2Y21SbGNpQnZaaUIwYUdWelpTQmpiMjVrYVhScGIyNXpPbHh1SUNBZ0lDQWdJQ0FnSUdsbUlDaHVZVzFsTG1Ob1lYSkJkQ2d3S1NBOVBUMGdYQ0owWENJZ0ppWmNiaUFnSUNBZ0lDQWdJQ0FnSUNBZ2FHRnpUM2R1TG1OaGJHd29kR2hwY3l3Z2JtRnRaU2tnSmlaY2JpQWdJQ0FnSUNBZ0lDQWdJQ0FnSVdselRtRk9LQ3R1WVcxbExuTnNhV05sS0RFcEtTa2dlMXh1SUNBZ0lDQWdJQ0FnSUNBZ2RHaHBjMXR1WVcxbFhTQTlJSFZ1WkdWbWFXNWxaRHRjYmlBZ0lDQWdJQ0FnSUNCOVhHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lIMWNiaUFnSUNCOUxGeHVYRzRnSUNBZ2MzUnZjRG9nWm5WdVkzUnBiMjRvS1NCN1hHNGdJQ0FnSUNCMGFHbHpMbVJ2Ym1VZ1BTQjBjblZsTzF4dVhHNGdJQ0FnSUNCMllYSWdjbTl2ZEVWdWRISjVJRDBnZEdocGN5NTBjbmxGYm5SeWFXVnpXekJkTzF4dUlDQWdJQ0FnZG1GeUlISnZiM1JTWldOdmNtUWdQU0J5YjI5MFJXNTBjbmt1WTI5dGNHeGxkR2x2Ymp0Y2JpQWdJQ0FnSUdsbUlDaHliMjkwVW1WamIzSmtMblI1Y0dVZ1BUMDlJRndpZEdoeWIzZGNJaWtnZTF4dUlDQWdJQ0FnSUNCMGFISnZkeUJ5YjI5MFVtVmpiM0prTG1GeVp6dGNiaUFnSUNBZ0lIMWNibHh1SUNBZ0lDQWdjbVYwZFhKdUlIUm9hWE11Y25aaGJEdGNiaUFnSUNCOUxGeHVYRzRnSUNBZ1pHbHpjR0YwWTJoRmVHTmxjSFJwYjI0NklHWjFibU4wYVc5dUtHVjRZMlZ3ZEdsdmJpa2dlMXh1SUNBZ0lDQWdhV1lnS0hSb2FYTXVaRzl1WlNrZ2UxeHVJQ0FnSUNBZ0lDQjBhSEp2ZHlCbGVHTmxjSFJwYjI0N1hHNGdJQ0FnSUNCOVhHNWNiaUFnSUNBZ0lIWmhjaUJqYjI1MFpYaDBJRDBnZEdocGN6dGNiaUFnSUNBZ0lHWjFibU4wYVc5dUlHaGhibVJzWlNoc2IyTXNJR05oZFdkb2RDa2dlMXh1SUNBZ0lDQWdJQ0J5WldOdmNtUXVkSGx3WlNBOUlGd2lkR2h5YjNkY0lqdGNiaUFnSUNBZ0lDQWdjbVZqYjNKa0xtRnlaeUE5SUdWNFkyVndkR2x2Ymp0Y2JpQWdJQ0FnSUNBZ1kyOXVkR1Y0ZEM1dVpYaDBJRDBnYkc5ak8xeHVYRzRnSUNBZ0lDQWdJR2xtSUNoallYVm5hSFFwSUh0Y2JpQWdJQ0FnSUNBZ0lDQXZMeUJKWmlCMGFHVWdaR2x6Y0dGMFkyaGxaQ0JsZUdObGNIUnBiMjRnZDJGeklHTmhkV2RvZENCaWVTQmhJR05oZEdOb0lHSnNiMk5yTEZ4dUlDQWdJQ0FnSUNBZ0lDOHZJSFJvWlc0Z2JHVjBJSFJvWVhRZ1kyRjBZMmdnWW14dlkyc2dhR0Z1Wkd4bElIUm9aU0JsZUdObGNIUnBiMjRnYm05eWJXRnNiSGt1WEc0Z0lDQWdJQ0FnSUNBZ1kyOXVkR1Y0ZEM1dFpYUm9iMlFnUFNCY0ltNWxlSFJjSWp0Y2JpQWdJQ0FnSUNBZ0lDQmpiMjUwWlhoMExtRnlaeUE5SUhWdVpHVm1hVzVsWkR0Y2JpQWdJQ0FnSUNBZ2ZWeHVYRzRnSUNBZ0lDQWdJSEpsZEhWeWJpQWhJU0JqWVhWbmFIUTdYRzRnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJR1p2Y2lBb2RtRnlJR2tnUFNCMGFHbHpMblJ5ZVVWdWRISnBaWE11YkdWdVozUm9JQzBnTVRzZ2FTQStQU0F3T3lBdExXa3BJSHRjYmlBZ0lDQWdJQ0FnZG1GeUlHVnVkSEo1SUQwZ2RHaHBjeTUwY25sRmJuUnlhV1Z6VzJsZE8xeHVJQ0FnSUNBZ0lDQjJZWElnY21WamIzSmtJRDBnWlc1MGNua3VZMjl0Y0d4bGRHbHZianRjYmx4dUlDQWdJQ0FnSUNCcFppQW9aVzUwY25rdWRISjVURzlqSUQwOVBTQmNJbkp2YjNSY0lpa2dlMXh1SUNBZ0lDQWdJQ0FnSUM4dklFVjRZMlZ3ZEdsdmJpQjBhSEp2ZDI0Z2IzVjBjMmxrWlNCdlppQmhibmtnZEhKNUlHSnNiMk5ySUhSb1lYUWdZMjkxYkdRZ2FHRnVaR3hsWEc0Z0lDQWdJQ0FnSUNBZ0x5OGdhWFFzSUhOdklITmxkQ0IwYUdVZ1kyOXRjR3hsZEdsdmJpQjJZV3gxWlNCdlppQjBhR1VnWlc1MGFYSmxJR1oxYm1OMGFXOXVJSFJ2WEc0Z0lDQWdJQ0FnSUNBZ0x5OGdkR2h5YjNjZ2RHaGxJR1Y0WTJWd2RHbHZiaTVjYmlBZ0lDQWdJQ0FnSUNCeVpYUjFjbTRnYUdGdVpHeGxLRndpWlc1a1hDSXBPMXh1SUNBZ0lDQWdJQ0I5WEc1Y2JpQWdJQ0FnSUNBZ2FXWWdLR1Z1ZEhKNUxuUnllVXh2WXlBOFBTQjBhR2x6TG5CeVpYWXBJSHRjYmlBZ0lDQWdJQ0FnSUNCMllYSWdhR0Z6UTJGMFkyZ2dQU0JvWVhOUGQyNHVZMkZzYkNobGJuUnllU3dnWENKallYUmphRXh2WTF3aUtUdGNiaUFnSUNBZ0lDQWdJQ0IyWVhJZ2FHRnpSbWx1WVd4c2VTQTlJR2hoYzA5M2JpNWpZV3hzS0dWdWRISjVMQ0JjSW1acGJtRnNiSGxNYjJOY0lpazdYRzVjYmlBZ0lDQWdJQ0FnSUNCcFppQW9hR0Z6UTJGMFkyZ2dKaVlnYUdGelJtbHVZV3hzZVNrZ2UxeHVJQ0FnSUNBZ0lDQWdJQ0FnYVdZZ0tIUm9hWE11Y0hKbGRpQThJR1Z1ZEhKNUxtTmhkR05vVEc5aktTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNBZ0lISmxkSFZ5YmlCb1lXNWtiR1VvWlc1MGNua3VZMkYwWTJoTWIyTXNJSFJ5ZFdVcE8xeHVJQ0FnSUNBZ0lDQWdJQ0FnZlNCbGJITmxJR2xtSUNoMGFHbHpMbkJ5WlhZZ1BDQmxiblJ5ZVM1bWFXNWhiR3g1VEc5aktTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNBZ0lISmxkSFZ5YmlCb1lXNWtiR1VvWlc1MGNua3VabWx1WVd4c2VVeHZZeWs3WEc0Z0lDQWdJQ0FnSUNBZ0lDQjlYRzVjYmlBZ0lDQWdJQ0FnSUNCOUlHVnNjMlVnYVdZZ0tHaGhjME5oZEdOb0tTQjdYRzRnSUNBZ0lDQWdJQ0FnSUNCcFppQW9kR2hwY3k1d2NtVjJJRHdnWlc1MGNua3VZMkYwWTJoTWIyTXBJSHRjYmlBZ0lDQWdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlHaGhibVJzWlNobGJuUnllUzVqWVhSamFFeHZZeXdnZEhKMVpTazdYRzRnSUNBZ0lDQWdJQ0FnSUNCOVhHNWNiaUFnSUNBZ0lDQWdJQ0I5SUdWc2MyVWdhV1lnS0doaGMwWnBibUZzYkhrcElIdGNiaUFnSUNBZ0lDQWdJQ0FnSUdsbUlDaDBhR2x6TG5CeVpYWWdQQ0JsYm5SeWVTNW1hVzVoYkd4NVRHOWpLU0I3WEc0Z0lDQWdJQ0FnSUNBZ0lDQWdJSEpsZEhWeWJpQm9ZVzVrYkdVb1pXNTBjbmt1Wm1sdVlXeHNlVXh2WXlrN1hHNGdJQ0FnSUNBZ0lDQWdJQ0I5WEc1Y2JpQWdJQ0FnSUNBZ0lDQjlJR1ZzYzJVZ2UxeHVJQ0FnSUNBZ0lDQWdJQ0FnZEdoeWIzY2dibVYzSUVWeWNtOXlLRndpZEhKNUlITjBZWFJsYldWdWRDQjNhWFJvYjNWMElHTmhkR05vSUc5eUlHWnBibUZzYkhsY0lpazdYRzRnSUNBZ0lDQWdJQ0FnZlZ4dUlDQWdJQ0FnSUNCOVhHNGdJQ0FnSUNCOVhHNGdJQ0FnZlN4Y2JseHVJQ0FnSUdGaWNuVndkRG9nWm5WdVkzUnBiMjRvZEhsd1pTd2dZWEpuS1NCN1hHNGdJQ0FnSUNCbWIzSWdLSFpoY2lCcElEMGdkR2hwY3k1MGNubEZiblJ5YVdWekxteGxibWQwYUNBdElERTdJR2tnUGowZ01Ec2dMUzFwS1NCN1hHNGdJQ0FnSUNBZ0lIWmhjaUJsYm5SeWVTQTlJSFJvYVhNdWRISjVSVzUwY21sbGMxdHBYVHRjYmlBZ0lDQWdJQ0FnYVdZZ0tHVnVkSEo1TG5SeWVVeHZZeUE4UFNCMGFHbHpMbkJ5WlhZZ0ppWmNiaUFnSUNBZ0lDQWdJQ0FnSUdoaGMwOTNiaTVqWVd4c0tHVnVkSEo1TENCY0ltWnBibUZzYkhsTWIyTmNJaWtnSmlaY2JpQWdJQ0FnSUNBZ0lDQWdJSFJvYVhNdWNISmxkaUE4SUdWdWRISjVMbVpwYm1Gc2JIbE1iMk1wSUh0Y2JpQWdJQ0FnSUNBZ0lDQjJZWElnWm1sdVlXeHNlVVZ1ZEhKNUlEMGdaVzUwY25rN1hHNGdJQ0FnSUNBZ0lDQWdZbkpsWVdzN1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lIMWNibHh1SUNBZ0lDQWdhV1lnS0dacGJtRnNiSGxGYm5SeWVTQW1KbHh1SUNBZ0lDQWdJQ0FnSUNoMGVYQmxJRDA5UFNCY0ltSnlaV0ZyWENJZ2ZIeGNiaUFnSUNBZ0lDQWdJQ0FnZEhsd1pTQTlQVDBnWENKamIyNTBhVzUxWlZ3aUtTQW1KbHh1SUNBZ0lDQWdJQ0FnSUdacGJtRnNiSGxGYm5SeWVTNTBjbmxNYjJNZ1BEMGdZWEpuSUNZbVhHNGdJQ0FnSUNBZ0lDQWdZWEpuSUR3OUlHWnBibUZzYkhsRmJuUnllUzVtYVc1aGJHeDVURzlqS1NCN1hHNGdJQ0FnSUNBZ0lDOHZJRWxuYm05eVpTQjBhR1VnWm1sdVlXeHNlU0JsYm5SeWVTQnBaaUJqYjI1MGNtOXNJR2x6SUc1dmRDQnFkVzF3YVc1bklIUnZJR0ZjYmlBZ0lDQWdJQ0FnTHk4Z2JHOWpZWFJwYjI0Z2IzVjBjMmxrWlNCMGFHVWdkSEo1TDJOaGRHTm9JR0pzYjJOckxseHVJQ0FnSUNBZ0lDQm1hVzVoYkd4NVJXNTBjbmtnUFNCdWRXeHNPMXh1SUNBZ0lDQWdmVnh1WEc0Z0lDQWdJQ0IyWVhJZ2NtVmpiM0prSUQwZ1ptbHVZV3hzZVVWdWRISjVJRDhnWm1sdVlXeHNlVVZ1ZEhKNUxtTnZiWEJzWlhScGIyNGdPaUI3ZlR0Y2JpQWdJQ0FnSUhKbFkyOXlaQzUwZVhCbElEMGdkSGx3WlR0Y2JpQWdJQ0FnSUhKbFkyOXlaQzVoY21jZ1BTQmhjbWM3WEc1Y2JpQWdJQ0FnSUdsbUlDaG1hVzVoYkd4NVJXNTBjbmtwSUh0Y2JpQWdJQ0FnSUNBZ2RHaHBjeTV0WlhSb2IyUWdQU0JjSW01bGVIUmNJanRjYmlBZ0lDQWdJQ0FnZEdocGN5NXVaWGgwSUQwZ1ptbHVZV3hzZVVWdWRISjVMbVpwYm1Gc2JIbE1iMk03WEc0Z0lDQWdJQ0FnSUhKbGRIVnliaUJEYjI1MGFXNTFaVk5sYm5ScGJtVnNPMXh1SUNBZ0lDQWdmVnh1WEc0Z0lDQWdJQ0J5WlhSMWNtNGdkR2hwY3k1amIyMXdiR1YwWlNoeVpXTnZjbVFwTzF4dUlDQWdJSDBzWEc1Y2JpQWdJQ0JqYjIxd2JHVjBaVG9nWm5WdVkzUnBiMjRvY21WamIzSmtMQ0JoWm5SbGNreHZZeWtnZTF4dUlDQWdJQ0FnYVdZZ0tISmxZMjl5WkM1MGVYQmxJRDA5UFNCY0luUm9jbTkzWENJcElIdGNiaUFnSUNBZ0lDQWdkR2h5YjNjZ2NtVmpiM0prTG1GeVp6dGNiaUFnSUNBZ0lIMWNibHh1SUNBZ0lDQWdhV1lnS0hKbFkyOXlaQzUwZVhCbElEMDlQU0JjSW1KeVpXRnJYQ0lnZkh4Y2JpQWdJQ0FnSUNBZ0lDQnlaV052Y21RdWRIbHdaU0E5UFQwZ1hDSmpiMjUwYVc1MVpWd2lLU0I3WEc0Z0lDQWdJQ0FnSUhSb2FYTXVibVY0ZENBOUlISmxZMjl5WkM1aGNtYzdYRzRnSUNBZ0lDQjlJR1ZzYzJVZ2FXWWdLSEpsWTI5eVpDNTBlWEJsSUQwOVBTQmNJbkpsZEhWeWJsd2lLU0I3WEc0Z0lDQWdJQ0FnSUhSb2FYTXVjblpoYkNBOUlIUm9hWE11WVhKbklEMGdjbVZqYjNKa0xtRnlaenRjYmlBZ0lDQWdJQ0FnZEdocGN5NXRaWFJvYjJRZ1BTQmNJbkpsZEhWeWJsd2lPMXh1SUNBZ0lDQWdJQ0IwYUdsekxtNWxlSFFnUFNCY0ltVnVaRndpTzF4dUlDQWdJQ0FnZlNCbGJITmxJR2xtSUNoeVpXTnZjbVF1ZEhsd1pTQTlQVDBnWENKdWIzSnRZV3hjSWlBbUppQmhablJsY2t4dll5a2dlMXh1SUNBZ0lDQWdJQ0IwYUdsekxtNWxlSFFnUFNCaFpuUmxja3h2WXp0Y2JpQWdJQ0FnSUgxY2JseHVJQ0FnSUNBZ2NtVjBkWEp1SUVOdmJuUnBiblZsVTJWdWRHbHVaV3c3WEc0Z0lDQWdmU3hjYmx4dUlDQWdJR1pwYm1semFEb2dablZ1WTNScGIyNG9abWx1WVd4c2VVeHZZeWtnZTF4dUlDQWdJQ0FnWm05eUlDaDJZWElnYVNBOUlIUm9hWE11ZEhKNVJXNTBjbWxsY3k1c1pXNW5kR2dnTFNBeE95QnBJRDQ5SURBN0lDMHRhU2tnZTF4dUlDQWdJQ0FnSUNCMllYSWdaVzUwY25rZ1BTQjBhR2x6TG5SeWVVVnVkSEpwWlhOYmFWMDdYRzRnSUNBZ0lDQWdJR2xtSUNobGJuUnllUzVtYVc1aGJHeDVURzlqSUQwOVBTQm1hVzVoYkd4NVRHOWpLU0I3WEc0Z0lDQWdJQ0FnSUNBZ2RHaHBjeTVqYjIxd2JHVjBaU2hsYm5SeWVTNWpiMjF3YkdWMGFXOXVMQ0JsYm5SeWVTNWhablJsY2t4dll5azdYRzRnSUNBZ0lDQWdJQ0FnY21WelpYUlVjbmxGYm5SeWVTaGxiblJ5ZVNrN1hHNGdJQ0FnSUNBZ0lDQWdjbVYwZFhKdUlFTnZiblJwYm5WbFUyVnVkR2x1Wld3N1hHNGdJQ0FnSUNBZ0lIMWNiaUFnSUNBZ0lIMWNiaUFnSUNCOUxGeHVYRzRnSUNBZ1hDSmpZWFJqYUZ3aU9pQm1kVzVqZEdsdmJpaDBjbmxNYjJNcElIdGNiaUFnSUNBZ0lHWnZjaUFvZG1GeUlHa2dQU0IwYUdsekxuUnllVVZ1ZEhKcFpYTXViR1Z1WjNSb0lDMGdNVHNnYVNBK1BTQXdPeUF0TFdrcElIdGNiaUFnSUNBZ0lDQWdkbUZ5SUdWdWRISjVJRDBnZEdocGN5NTBjbmxGYm5SeWFXVnpXMmxkTzF4dUlDQWdJQ0FnSUNCcFppQW9aVzUwY25rdWRISjVURzlqSUQwOVBTQjBjbmxNYjJNcElIdGNiaUFnSUNBZ0lDQWdJQ0IyWVhJZ2NtVmpiM0prSUQwZ1pXNTBjbmt1WTI5dGNHeGxkR2x2Ymp0Y2JpQWdJQ0FnSUNBZ0lDQnBaaUFvY21WamIzSmtMblI1Y0dVZ1BUMDlJRndpZEdoeWIzZGNJaWtnZTF4dUlDQWdJQ0FnSUNBZ0lDQWdkbUZ5SUhSb2NtOTNiaUE5SUhKbFkyOXlaQzVoY21jN1hHNGdJQ0FnSUNBZ0lDQWdJQ0J5WlhObGRGUnllVVZ1ZEhKNUtHVnVkSEo1S1R0Y2JpQWdJQ0FnSUNBZ0lDQjlYRzRnSUNBZ0lDQWdJQ0FnY21WMGRYSnVJSFJvY205M2JqdGNiaUFnSUNBZ0lDQWdmVnh1SUNBZ0lDQWdmVnh1WEc0Z0lDQWdJQ0F2THlCVWFHVWdZMjl1ZEdWNGRDNWpZWFJqYUNCdFpYUm9iMlFnYlhWemRDQnZibXg1SUdKbElHTmhiR3hsWkNCM2FYUm9JR0VnYkc5allYUnBiMjVjYmlBZ0lDQWdJQzh2SUdGeVozVnRaVzUwSUhSb1lYUWdZMjl5Y21WemNHOXVaSE1nZEc4Z1lTQnJibTkzYmlCallYUmphQ0JpYkc5amF5NWNiaUFnSUNBZ0lIUm9jbTkzSUc1bGR5QkZjbkp2Y2loY0ltbHNiR1ZuWVd3Z1kyRjBZMmdnWVhSMFpXMXdkRndpS1R0Y2JpQWdJQ0I5TEZ4dVhHNGdJQ0FnWkdWc1pXZGhkR1ZaYVdWc1pEb2dablZ1WTNScGIyNG9hWFJsY21GaWJHVXNJSEpsYzNWc2RFNWhiV1VzSUc1bGVIUk1iMk1wSUh0Y2JpQWdJQ0FnSUhSb2FYTXVaR1ZzWldkaGRHVWdQU0I3WEc0Z0lDQWdJQ0FnSUdsMFpYSmhkRzl5T2lCMllXeDFaWE1vYVhSbGNtRmliR1VwTEZ4dUlDQWdJQ0FnSUNCeVpYTjFiSFJPWVcxbE9pQnlaWE4xYkhST1lXMWxMRnh1SUNBZ0lDQWdJQ0J1WlhoMFRHOWpPaUJ1WlhoMFRHOWpYRzRnSUNBZ0lDQjlPMXh1WEc0Z0lDQWdJQ0JwWmlBb2RHaHBjeTV0WlhSb2IyUWdQVDA5SUZ3aWJtVjRkRndpS1NCN1hHNGdJQ0FnSUNBZ0lDOHZJRVJsYkdsaVpYSmhkR1ZzZVNCbWIzSm5aWFFnZEdobElHeGhjM1FnYzJWdWRDQjJZV3gxWlNCemJ5QjBhR0YwSUhkbElHUnZiaWQwWEc0Z0lDQWdJQ0FnSUM4dklHRmpZMmxrWlc1MFlXeHNlU0J3WVhOeklHbDBJRzl1SUhSdklIUm9aU0JrWld4bFoyRjBaUzVjYmlBZ0lDQWdJQ0FnZEdocGN5NWhjbWNnUFNCMWJtUmxabWx1WldRN1hHNGdJQ0FnSUNCOVhHNWNiaUFnSUNBZ0lISmxkSFZ5YmlCRGIyNTBhVzUxWlZObGJuUnBibVZzTzF4dUlDQWdJSDFjYmlBZ2ZUdGNibHh1SUNBdkx5QlNaV2RoY21Sc1pYTnpJRzltSUhkb1pYUm9aWElnZEdocGN5QnpZM0pwY0hRZ2FYTWdaWGhsWTNWMGFXNW5JR0Z6SUdFZ1EyOXRiVzl1U2xNZ2JXOWtkV3hsWEc0Z0lDOHZJRzl5SUc1dmRDd2djbVYwZFhKdUlIUm9aU0J5ZFc1MGFXMWxJRzlpYW1WamRDQnpieUIwYUdGMElIZGxJR05oYmlCa1pXTnNZWEpsSUhSb1pTQjJZWEpwWVdKc1pWeHVJQ0F2THlCeVpXZGxibVZ5WVhSdmNsSjFiblJwYldVZ2FXNGdkR2hsSUc5MWRHVnlJSE5qYjNCbExDQjNhR2xqYUNCaGJHeHZkM01nZEdocGN5QnRiMlIxYkdVZ2RHOGdZbVZjYmlBZ0x5OGdhVzVxWldOMFpXUWdaV0Z6YVd4NUlHSjVJR0JpYVc0dmNtVm5aVzVsY21GMGIzSWdMUzFwYm1Oc2RXUmxMWEoxYm5ScGJXVWdjMk55YVhCMExtcHpZQzVjYmlBZ2NtVjBkWEp1SUdWNGNHOXlkSE03WEc1Y2JuMG9YRzRnSUM4dklFbG1JSFJvYVhNZ2MyTnlhWEIwSUdseklHVjRaV04xZEdsdVp5QmhjeUJoSUVOdmJXMXZia3BUSUcxdlpIVnNaU3dnZFhObElHMXZaSFZzWlM1bGVIQnZjblJ6WEc0Z0lDOHZJR0Z6SUhSb1pTQnlaV2RsYm1WeVlYUnZjbEoxYm5ScGJXVWdibUZ0WlhOd1lXTmxMaUJQZEdobGNuZHBjMlVnWTNKbFlYUmxJR0VnYm1WM0lHVnRjSFI1WEc0Z0lDOHZJRzlpYW1WamRDNGdSV2wwYUdWeUlIZGhlU3dnZEdobElISmxjM1ZzZEdsdVp5QnZZbXBsWTNRZ2QybHNiQ0JpWlNCMWMyVmtJSFJ2SUdsdWFYUnBZV3hwZW1WY2JpQWdMeThnZEdobElISmxaMlZ1WlhKaGRHOXlVblZ1ZEdsdFpTQjJZWEpwWVdKc1pTQmhkQ0IwYUdVZ2RHOXdJRzltSUhSb2FYTWdabWxzWlM1Y2JpQWdkSGx3Wlc5bUlHMXZaSFZzWlNBOVBUMGdYQ0p2WW1wbFkzUmNJaUEvSUcxdlpIVnNaUzVsZUhCdmNuUnpJRG9nZTMxY2Jpa3BPMXh1WEc1MGNua2dlMXh1SUNCeVpXZGxibVZ5WVhSdmNsSjFiblJwYldVZ1BTQnlkVzUwYVcxbE8xeHVmU0JqWVhSamFDQW9ZV05qYVdSbGJuUmhiRk4wY21samRFMXZaR1VwSUh0Y2JpQWdMeThnVkdocGN5QnRiMlIxYkdVZ2MyaHZkV3hrSUc1dmRDQmlaU0J5ZFc1dWFXNW5JR2x1SUhOMGNtbGpkQ0J0YjJSbExDQnpieUIwYUdVZ1lXSnZkbVZjYmlBZ0x5OGdZWE56YVdkdWJXVnVkQ0J6YUc5MWJHUWdZV3gzWVhseklIZHZjbXNnZFc1c1pYTnpJSE52YldWMGFHbHVaeUJwY3lCdGFYTmpiMjVtYVdkMWNtVmtMaUJLZFhOMFhHNGdJQzh2SUdsdUlHTmhjMlVnY25WdWRHbHRaUzVxY3lCaFkyTnBaR1Z1ZEdGc2JIa2djblZ1Y3lCcGJpQnpkSEpwWTNRZ2JXOWtaU3dnZDJVZ1kyRnVJR1Z6WTJGd1pWeHVJQ0F2THlCemRISnBZM1FnYlc5a1pTQjFjMmx1WnlCaElHZHNiMkpoYkNCR2RXNWpkR2x2YmlCallXeHNMaUJVYUdseklHTnZkV3hrSUdOdmJtTmxhWFpoWW14NUlHWmhhV3hjYmlBZ0x5OGdhV1lnWVNCRGIyNTBaVzUwSUZObFkzVnlhWFI1SUZCdmJHbGplU0JtYjNKaWFXUnpJSFZ6YVc1bklFWjFibU4wYVc5dUxDQmlkWFFnYVc0Z2RHaGhkQ0JqWVhObFhHNGdJQzh2SUhSb1pTQndjbTl3WlhJZ2MyOXNkWFJwYjI0Z2FYTWdkRzhnWm1sNElIUm9aU0JoWTJOcFpHVnVkR0ZzSUhOMGNtbGpkQ0J0YjJSbElIQnliMkpzWlcwdUlFbG1YRzRnSUM4dklIbHZkU2QyWlNCdGFYTmpiMjVtYVdkMWNtVmtJSGx2ZFhJZ1luVnVaR3hsY2lCMGJ5Qm1iM0pqWlNCemRISnBZM1FnYlc5a1pTQmhibVFnWVhCd2JHbGxaQ0JoWEc0Z0lDOHZJRU5UVUNCMGJ5Qm1iM0ppYVdRZ1JuVnVZM1JwYjI0c0lHRnVaQ0I1YjNVbmNtVWdibTkwSUhkcGJHeHBibWNnZEc4Z1ptbDRJR1ZwZEdobGNpQnZaaUIwYUc5elpWeHVJQ0F2THlCd2NtOWliR1Z0Y3l3Z2NHeGxZWE5sSUdSbGRHRnBiQ0I1YjNWeUlIVnVhWEYxWlNCd2NtVmthV05oYldWdWRDQnBiaUJoSUVkcGRFaDFZaUJwYzNOMVpTNWNiaUFnUm5WdVkzUnBiMjRvWENKeVhDSXNJRndpY21WblpXNWxjbUYwYjNKU2RXNTBhVzFsSUQwZ2Nsd2lLU2h5ZFc1MGFXMWxLVHRjYm4xY2JpSXNJbWx0Y0c5eWRDQW5jbVZuWlc1bGNtRjBiM0l0Y25WdWRHbHRaUzl5ZFc1MGFXMWxKenRjY2x4dVhISmNibU52Ym5OMElHZGxkRVJoZEdFZ1BTQmhjM2x1WXlBb0tTQTlQaUI3WEhKY2JpQWdJQ0JqYjI1emRDQnlaWE1nUFNCaGQyRnBkQ0JtWlhSamFDQW9KMmgwZEhCek9pOHZZWEJwTG5Sb1pXMXZkbWxsWkdJdWIzSm5Mek12Ylc5MmFXVXZOVFV3UDJGd2FWOXJaWGs5T1dSaU9ERXlOR0UzT1RFNU5XUXdOekkzTjJGaU5tTmpPR1UxTlRjMU1tUW5LVnh5WEc0Z0lDQWdZMjl1YzNRZ2NHRnljMlZrVW1WeklEMGdjbVZ6TG1wemIyNG9LVHRjY2x4dUlDQWdJR052Ym5OdmJHVXViRzluSUNod1lYSnpaV1JTWlhNcE8xeHlYRzU5WEhKY2JseHlYRzVuWlhSRVlYUmhJQ2dwWEhKY2JseHlYRzR2TDJOdmJuTnZiR1V1Ykc5bklDaG5aWFJFWVhSaEtUc2lYWDA9In0=
