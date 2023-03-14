const _ = require("underscore-plus");
const CSON = require("season");
const Grim = require("grim");
const { Emitter, Disposable } = require("event-kit");
const Grammar = require("./grammar.js");
const NullGrammar = require("./null-grammar.js");

// Extended: Registry containing one or more grammars.
class GrammarRegistry {
  constructor(options) {
    if (options == null) {
      options = {};
    }
    this.maxTokensPerLine = options.maxTokensPerLine != null ? options.maxTokensPerLine : Infinity;
    this.maxLineLength = options.maxLineLength != null ? options.maxLineLength : Infinity;
    this.nullGrammar = new NullGrammar(this);
    this.clear();
  }

  clear() {
    this.emitter = new Emitter;
    this.grammars = [];
    this.grammarsByScopeName = {};
    this.injectionGrammars = [];
    this.grammarOverridesByPath = {};
    this.scopeIdCounter = -1;
    this.idsByScope = {};
    this.scopesById = {};
    return this.addGrammar(this.nullGrammar);
  }

  // ###
  // Section: Event Subscription
  // ###

  // Public: Invoke the given callback when a grammar is added to the registry.
  //
  // * `callback` {Function} to call when a grammar is added.
  //    * `grammar` {Grammar} that was added.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidAddGrammar(callback) {
    return this.emitter.on('did-add-grammar', callback);
  }

  // Public: Invoke the given callback when a grammar is updated due to a grammar
  // it depends on being added or removed from the registry.
  //
  // * `callback` {Function} to call when a grammar is updated.
  //   * `grammar` {Grammar} that was updated.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidUpdateGrammar(callback) {
    return this.emitter.on('did-update-grammar', callback);
  }

  // Public: Invoke the given callback when a grammar is removed from the registry.
  //
  // * `callback` {Function} to call when a grammar is removed.
  //   * `grammar` {Grammar} that was removed.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidRemoveGrammar(callback) {
    return this.emitter.on('did-remove-grammar', callback);
  }

  // ###
  // Section: Managing Grammars
  // ###

  // Public: Get all the grammars in this registry.
  //
  // Returns a non-empty {Array} of {Grammar} instances.
  getGrammars() {
    return _.clone(this.grammars);
  }

  // Public: Get a grammar with the given scope name.
  //
  // * `scopeName` A {String} such as `"source.js"`.
  //
  // Returns a {Grammar} or undefined.
  grammarForScopeName(scopeName) {
    return this.grammarsByScopeName[scopeName];
  }

  // Public: Add a grammar to this registry.
  //
  // A 'grammar-added' event is emitted after the grammar is added.
  //
  // * `grammar` The {Grammar} to add. This should be a value previously returned
  //   from {::readGrammar} or {::readGrammarSync}.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to remove the
  // grammar.
  addGrammar(grammar) {
    this.grammars.push(grammar);
    this.grammarsByScopeName[grammar.scopeName] = grammar;
    if (grammar.injectionSelector != null) {
      this.injectionGrammars.push(grammar);
    }
    this.grammarUpdated(grammar.scopeName);
    if (Grammar.includeDeprecatedAPIs) {
      this.emit('grammar-added', grammar);
    }
    this.emitter.emit('did-add-grammar', grammar);
    return new Disposable(() => {
      this.removeGrammar(grammar);
    });
  }

  removeGrammar(grammar) {
    _.remove(this.grammars, grammar);
    delete this.grammarsByScopeName[grammar.scopeName];
    _.remove(this.injectionGrammars, grammar);
    this.grammarUpdated(grammar.scopeName);
    this.emitter.emit('did-remove-grammar', grammar);
    return void 0;
  }

  // Public: Remove the grammar with the given scope name.
  //
  // * `scopeName` A {String} such as `"source.js"`.
  //
  // Returns the removed {Grammar} or undefined.
  removeGrammarForScopeName(scopeName) {
    let grammar = this.grammarForScopeName(scopeName);
    if (grammar != null) {
      this.removeGrammar(grammar);
    }
    return grammar;
  }

  // Public: Read a grammar synchronously but don't add it to the registry.
  //
  // * `grammarPath` A {String} absolute file path to a grammar file.
  //
  // Returns a {Grammar}.
  readGrammarSync(grammarPath) {
    // Adding `grammarFile` to avoid reading from disk twice
    let grammarFile = CSON.readFileSync(grammarPath);
    let grammar = grammarFile != null ? grammarFile : {};
    if (typeof grammar.scopeName === 'string' && grammar.scopeName.length > 0) {
      return this.createGrammar(grammarPath, grammar);
    } else {
      throw new Error(`Grammar missing required scopeName property: ${grammarPath}`);
    }
  }

  // Public: Read a grammar asynchronously but don't add it to the registry.
  //
  // * `grammarPath` A {String} absolute file path to a grammar file.
  // * `callback` A {Function} to call when read with the following arguments:
  //   * `error` An {Error}, may be null.
  //   * `grammar` A {Grammar} or null if an error occured.
  //
  // Returns undefined.
  readGrammar(grammarPath, callback) {
    CSON.readFile(grammarPath, ((_this) => {
      return function(error, grammar) {
        if (grammar == null) {
          grammar = {};
        }
        if (error != null) {
          return typeof callback === "function" ? callback(error) : void 0;
        } else {
          if (typeof grammar.scopeName === 'string' && grammar.scopeName.length > 0) {
            return typeof callback === "function" ? callback(null, _this.createGrammar(grammarPath, grammar)) : void 0;
          } else {
            return typeof callback === "function" ? callback(new Error(`Grammar missing required scopeName property: ${grammarPath}`)) : void 0;
          }
        }
      }
    })(this));
    return void 0;
  }

  // Public: Read a grammar synchronously and add it to this registry.
  //
  // * `grammarPath` A {String} absolute file path to a grammar file.
  //
  // Returns a {Grammar}.
  loadGrammarSync(grammarPath) {
    let grammar = this.readGrammarSync(grammarPath);
    this.addGrammar(grammar);
    return grammar;
  }

  // Public: Read a grammar asynchronously and add it to the registry.
  //
  // * `grammarPath` A {String} absolute file path to a grammar file.
  // * `callback` A {Function} to call when loaded with the following arguments:
  //   * `error` An {Error}, may be null.
  //   * `grammar` A {Grammar} or null if an error occured.
  //
  // Returns undefined.
  loadGrammar(grammarPath, callback) {
    this.readGrammar(grammarPath, ((_this) => {
      return function(error, grammar) {
        if (error != null) {
          return typeof callback === "function" ? callback(error) : void 0;
        } else {
          _this.addGrammar(grammar);
          return typeof callback === "function" ? callback(null, grammar) : void 0;
        }
      };
    })(this));
    return void 0;
  }

  startIdForScope(scope) {
    let id;
    if (!(id = this.idsByScope[scope])) {
      id = this.scopeIdCounter;
      this.scopeIdCounter -= 2;
      this.idsByScope[scope] = id;
      this.scopesById[id] = scope;
    }
    return id;
  }

  endIdForScope(scope) {
    return this.startIdForScope(scope) - 1;
  }

  scopeForId(id) {
    if ((id % 2) === -1) {
      return this.scopesById[id]; // start id
    } else {
      return this.scopesById[id + 1]; // end id
    }
  }

  grammarUpdated(scopeName) {
    for (let i = 0; i < this.grammars.length; i++) {
      if (this.grammars[i].scopeName !== scopeName) {
        if (this.grammars[i].grammarUpdated(scopeName)) {
          if (Grammar.includeDeprecatedAPIs) {
            this.emit("grammar-updated", grammar);
          }
          this.emitter.emit("did-update-grammar");
        }
      }
    }
  }

  createGrammar(grammarPath, object) {
    if (object.maxTokensPerLine == null) {
      object.maxTokensPerLine = this.maxTokensPerLine;
    }
    if (object.maxLineLength == null) {
      object.maxLineLength = this.maxLineLength;
    }
    if (object.limitLineLength === false) {
      object.maxLineLength = Infinity;
    }
    let grammar = new Grammar(this, object);
    grammar.path = grammarPath;
    return grammar;
  }

  decodeTokens(lineText, tags, scopeTags, fn) {
    if (scopeTags == null) {
      scopeTags = [];
    }
    let offset = 0;
    let scopeNames = scopeTags.map(((_this) => {
      return function(tag) {
        return _this.scopeForId(tag);
      };
    })(this));
    let tokens = [];
    for (let i = 0; i < tags.length; ++i) {
      // positive numbers indicate string content with length equaling the number.
      let tag = tags[i];
      if (tag >= 0) {
        let token = {
          value: lineText.substring(offset, offset + tag),
          scopes: scopeNames.slice()
        };
        if (fn != null) {
          token = fn(token, index);
        }
        tokens.push(token);
        offset += tag;
        // odd negative numbers are being scope tags
      } else if ((tag % 2) === -1) {
        scopeTags.push(tag);
        scopeNames.push(this.scopeForId(tag));
        // even negative numbers are end scope tags
      } else {
        scopeTags.pop();
        let expectedScopeName = this.scopeForId(tag + 1);
        let poppedScopeName = scopeNames.pop();
        if (poppedScopeName !== expectedScopeName) {
          throw new Error(`Expected popped scope to be ${expectedScopeName}, but it was ${poppedScopeName}`);
        }
      }
    }
    return tokens;
  }
}

if (Grim.includeDeprecatedAPIs) {
  EmitterMixin = require('emissary').Emitter;
  EmitterMixin.includeInto(GrammarRegistry);
  GrammarRegistry.prototype.on = function(eventName) {
    switch (eventName) {
      case 'grammar-added':
        Grim.deprecate("Call GrammarRegistry::onDidAddGrammar instead");
        break;
      case 'grammar-updated':
        Grim.deprecate("Call GrammarRegistry::onDidUpdateGrammar instead");
        break;
      default:
        Grim.deprecate("Call explicit event subscription methods instead");
    }
    return EmitterMixin.prototype.on.apply(this, arguments);
  };
}

module.exports = GrammarRegistry;
