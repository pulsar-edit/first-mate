const path = require("path");
const _ = require("underscore-plus");
const fs = require("fs-plus");
const {OnigRegExp, OnigString} = require("oniguruma");
const {Emitter} = require("event-kit");
const Grim = require("grim");
const Injections = require("./injections.js");
const Pattern = require("./pattern.js");
const Rule = require("./rule.js");
const ScopeSelector = require("./scope-selector.js");

// Extended: Grammar that tokenizes lines of text.
//
// This class should not be instantiated directly but instead obtained from
// a {GrammarRegistry} by calling {GrammarRegistry::loadGrammar}.
class Grammar {
  constructor(registry, options) {
    this.registry = registry;
    if (options == null) {
      options = {};
    }
    this.name = options.name;
    this.fileTypes = options.fileTypes;
    this.scopeName = options.scopeName;
    this.foldingStopMarker = options.folderingStopMarker;
    this.maxTokensPerLine = options.maxTokensPerLine;
    this.maxLineLength = options.maxLineLength;

    let injections = options.injections;
    let injectionSelector = options.injectionSelector;
    let patterns = options.patterns;
    let repository = options.repository;
    let firstLineMatch = options.firstLineMatch;
    let contentRegex = options.contentRegex;

    this.emitter = new Emitter;
    this.repository = null;
    this.initialRule = null;

    if (injectionSelector != null) {
      this.injectionSelector = new ScopeSelector(injectionSelector);
    } else {
      this.injectionSelector = null;
    }
    if (firstLineMatch) {
      this.firstLineRegex = new OnigRegExp(firstLineMatch);
    } else {
      this.firstLineRegex = null;
    }
    if (contentRegex) {
      this.contentRegex = new OnigRegExp(contentRegex);
    } else {
      this.contentRegex = null;
    }
    if (this.fileTypes == null) {
      this.fileTypes = [];
    }

    this.includedGrammarScopes = [];
    this.rawPatterns = patterns;
    this.rawRepository = repository;
    this.rawInjections = injections;
    this.updateRules();
  }

  // ###
  // Section: Event Subscription
  // ###

  // Public: Invoke the given callback when this grammar is updated due to a
  // grammar it depends on being added or removed from the registry.
  //
  // * `callback` {Function} to call when this grammar is updated.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidUpdate(callback) {
    return this.emitter.on('did-update', callback);
  }

  // ###
  // Section: Tokenizing
  // ###

  // Public: Tokenize all lines in the given text.
  //
  // * `text` A {String} containing one or more lines.
  //
  // Returns an {Array} of token arrays for each line tokenizied.
  tokenizeLines(text, compatibilityMode) {
    if (compatibilityMode == null) {
      compatibilityMode = true;
    }
    let lines = text.split('\n');
    let lastLine = lines.length - 1;
    let ruleStack = null;
    let scopes = [];
    let _results = [];
    for (let i = 0; i < lines.length; ++i) {
      let line = lines[i];
      let _ref1 = this.tokenizeLine(line, ruleStack, i === 0, compatibilityMode, i !== lastLine);
      let tags = _ref1.tags;
      ruleStack = _ref1.ruleStack;
      _results.push(this.registry.decodeTokens(line, tags, scopes));
    }
    return _results;
  }

 //Public: Tokenize the line of text.
 //
 //* `line` A {String} of text to tokenize.
 //* `ruleStack` An optional {Array} of rules previously returned from this
 //  method. This should be null when tokenizing the first line in the file.
 //* `firstLine` A optional {Boolean} denoting whether this is the first line
 //  in the file which defaults to `false`. This should be `true`
 //  when tokenizing the first line in the file.
 //
 //Returns an {Object} containing the following properties:
 //* `line` The {String} of text that was tokenized.
 //* `tags` An {Array} of integer scope ids and strings. Positive ids
 //  indicate the beginning of a scope, and negative tags indicate the end.
 //  To resolve ids to scope names, call {GrammarRegistry::scopeForId} with the
 //  absolute value of the id.
 //* `tokens` This is a dynamic property. Invoking it will incur additional
 //  overhead, but will automatically translate the `tags` into token objects
 //  with `value` and `scopes` properties.
 //* `ruleStack` An {Array} of rules representing the tokenized state at the
 //  end of the line. These should be passed back into this method when
 //  tokenizing the next line in the file.
  tokenizeLine(inputLine, ruleStack, firstLine, compatibilityMode, appendNewLine) { // todo
    let line, openScopeTags;
    if (firstLine == null) {
      firstLine = false;
    }
    if (compatibilityMode == null) {
      compatibilityMode = true;
    }
    if (appendNewLine == null) {
      appendNewLine = true;
    }
    let tags = [];
    let truncatedLine = false;
    if (inputLine.length > this.maxLineLength) {
      line = inputLine.slice(0, this.maxLineLength);
      truncatedLine = true;
    } else {
      line = inputLine;
    }
    let string = new OnigString(line);
    let stringWithNewLine = appendNewLine ? new OnigString(line + '\n') : string;
    if (ruleStack != null) {
      ruleStack = ruleStack.slice();
      if (compatibilityMode) {
        openScopeTags = [];
        for (let i = 0; i < ruleStack.length; i++) {
          if (ruleStack[i].scopeName) {
            openScopeTags.push(this.registry.startIdForScope(ruleStack[i].scopeName));
          }
          if (ruleStack[i].contentScopeName) {
            openScopeTags.push(this.registry.startIdForScope(ruleStack[i].contentScopeName));
          }
        }
      }
    } else {
      if (compatibilityMode) {
        openScopeTags = [];
      }
      ruleStack = [
        {
          rule: this.initialRule,
          scopeName: this.initialRule.scopeName,
          contentScopeName: this.initialRule.contentScopeName
        }
      ];
      if (this.initialRule.scopeName) {
        tags.push(this.startIdForScope(this.initialRule.scopeName));
      }
      if (this.initialRule.contentScopeName) {
        tags.push(this.startIdForScope(this.initialRule.contentScopeName));
      }
    }
    let initialRuleStackLength = ruleStack.length;
    let position = 0;
    let tokenCount = 0;
    while (true) {
      let previousRuleStackLength = ruleStack.length;
      let previousPosition = position;

      if (position > line.length) {
        break;
      }
      if (tokenCount >= this.getMaxTokensPerLine() - 1) {
        truncatedLine = true;
        break;
      }

      let match = _.last(ruleStack).rule.getNextTags(ruleStack, string, stringWithNewLine, position, firstLine);
      if (match) {
        // Unmatched text before next tags

        if (position < match.tagsStart) {
          tags.push(match.tagsStart - position);
          tokenCount++;
        }
        tags.push.apply(tags, match.nextTags);
        for (let j = 0; j < match.nextTags.length; j++) {
          if (match.nextTags[j] >= 0) {
            tokenCount++;
          }
        }
        position = match.tagsEnd;
      } else {
        // Push filler token for unmatched text at end of line.
        if (position < line.length || line.length === 0) {
          tags.push(line.length - position);
        }
        break;
      }
      if (position === previousPosition) {
        if (ruleStack.length === previousRuleStackLength) {
          console.error(`Popping rule because it loops at column ${position} of line ${line}`, _.clone(ruleStack));

          if (ruleStack.length > 1) {
            let poppedStack = ruleStack.pop();
            let contentScopeName = poppedStack.contentScopeName;
            let scopeName = poppedStack.scopeName;
            if (contentScopeName) {
              tags.push(this.endIdForScope(contentScopeName));
            }
            if (scopeName) {
              tags.push(this.endIdForScope(scopeName));
            }
          } else {
            if (position < line.length || (line.length === 0 && tags.length === 0)) {
              tags.push(line.length - position);
            }
            break;
          }
        } else if (ruleStack.length > previousRuleStackLength) { // Stack size increased with zero length match
          let slicedStack = ruleStack.slice(-2);
          let penultimateRule = slicedStack[0].rule;
          let lastRule = slicedStack[1].rule;
          let popStack;

          if ((lastRule != null) && lastRule === penultimateRule) {
            popStack = true;
          }
          // Same exact rule was pushed but position wasn't advanced
          if (((lastRule != null ? lastRule.scopeName : void 0) != null) && penultimateRule.scopeName === lastRule.scopeName) {
            popStack = true;
          }
          // Rule with same scope name as previous rule was pushed but position wasn't advanced.
          if (popStack) {
            ruleStack.pop();
            let lastSymbol = _.last(tags);
            if (lastSymbol < 0 && lastSymbol === this.startIdForScope(lastRule.scopeName)) {
              tags.pop(); // also pop the duplicated start scope if it was pushed
            }
            tags.push(line.length - position);
            break;
          }
        }
      }
    }
    if (truncatedLine) {
      let tagCount = tags.length;
      if (tags[tagCount - 1] > 0) {
        tags[tagCount - 1] += inputLine.length - position;
      } else {
        tags.push(inputLine.length - position);
      }
      while (ruleStack.length > initialRuleStackLength) {
        let poppedStack = ruleStack.pop();
        let scopeName = poppedStack.scopeName;
        let contentScopeName = poppedStack.contentScopeName;

        if (contentScopeName) {
          tags.push(this.endIdForScope(contentScopeName));
        }
        if (scopeName) {
          tags.push(this.endIdForScope(scopeName));
        }
      }
    }
    for (let k = 0; k < ruleStack.length; k++) {
      let rule = ruleStack[k].rule;
      rule.clearAnchorPosition();
    }
    if (compatibilityMode) {
      return new TokenizeLineResult(inputLine, openScopeTags, tags, ruleStack, this.registry);
    } else {
      return {
        line: inputLine,
        tags: tags,
        ruleStack: ruleStack
      };
    }
  }

  activate() {
    return this.registration = this.registry.addGrammar(this);
  }

  deactivate() {
    this.emitter = new Emitter;
    if (this.registration != null) {
      this.registration.dispose();
    }
    return this.registration = null;
  }

  updateRules() {
    this.initialRule = this.createRule({
      scopeName: this.scopeName,
      patterns: this.rawPatterns
    });
    this.repository = this.createRepository();
    return this.injections = new Injections(this, this.rawInjections);
  }

  getInitialRule() {
    return this.initialRule;
  }

  getRepository() {
    return this.repository;
  }

  createRepository() {
    let repository = {};
    for (const name in this.rawRepository) {
      let data = this.rawRepository[name];
      if ((data.begin != null) || (data.match != null)) {
        data = {
          patterns: [data],
          tempName: name
        };
      }
      repository[name] = this.createRule(data);
    }
    return repository;
  }

  addIncludedGrammarScope(scope) {
    if (!_.include(this.includedGrammarScopes, scope)) {
      return this.includedGrammarScopes.push(scope);
    }
  }

  grammarUpdated(scopeName) {
    if (!_.include(this.includedGrammarScopes, scopeName)) {
      return false;
    }
    this.updateRules();
    this.registry.grammarUpdated(this.scopeName);
    if (Grim.includeDeprecatedAPIs) {
      this.emit('grammar-updated');
    }
    this.emitter.emit('did-update');
    return true;
  }

  startIdForScope(scope) {
    return this.registry.startIdForScope(scope);
  }

  endIdForScope(scope) {
    return this.registry.endIdForScope(scope);
  }

  scopeForId(id) {
    return this.registry.scopeForId(id);
  }

  createRule(options) {
    return new Rule(this, this.registry, options);
  }

  createPattern(options) {
    return new Pattern(this, this.registry, options);
  }

  getMaxTokensPerLine() {
    return this.maxTokensPerLine;
  }

  scopesFromStack(stack, rule, endPatternMatch) {
    let scopes = [];
    for (let i = 0; i < stack.length; i++) {
      if (stack[i].scopeName) {
        scopes.push(stack[i].scopeName);
      }
      if (stack[i].contentScopeName) {
        scopes.push(stack[i].contentScopeName);
      }
    }
    // Pop the last content name scope if the end pattern at the top of the stack
    // was matched since only text between the begin/end patterns should have the content name scope.
    if (endPatternMatch && (rule != null ? rule.contentScopeName : void 0) && rule === stack[stack.length -1]) {
      scopes.pop();
    }
    return scopes;
  }
}

Grammar.prototype.registration = null; // todo - find most exact way to implement this. Likely could be this.variable


if (Grim.includeDeprecatedAPIs) {
  EmitterMixin = require('emissary').Emitter;
  EmitterMixin.includeInto(Grammar);
  Grammar.prototype.on = function(eventName) {
    if (eventName === 'did-update') {
      Grim.deprecate("Call Grammar::onDidUpdate instead");
    } else {
      Grim.deprecate("Call explicit event subscription methods instead");
    }
    return EmitterMixin.prototype.on.apply(this, arguments);
  };
}

class TokenizeLineResult {
  constructor(line, openScopeTags, tags, ruleStack, registry) {
    this.line = line;
    this.openScopeTags = openScopeTags;
    this.tags = tags;
    this.ruleStack = ruleStack;
    this.registry = registry;
  }

}

Object.defineProperty(TokenizeLineResult.prototype, 'tokens', {
  get: function() {
    return this.registry.decodeTokens(this.line, this.tags, this.openScopeTags);
  }
});

module.exports = Grammar;
