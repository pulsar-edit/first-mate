const _ = require("underscore-plus");
const Scanner = require("./scanner.js");

let __slice = [].slice;

class Rule {
  constructor(grammar, registry, _arg) {
    let args = _arg != null ? _arg : {};
    this.grammar = grammar;
    this.registry = registry;
    this.patterns = [];
    this.scopeName = args.scopeName;
    this.contentScopeName = args.contentScopeName;
    this.endPattern = args.endPattern;
    this.applyEndPatternLast = args.applyEndPatternLast;

    let patterns = args.patterns;
    let pattern;

    let ref1 = patterns != null ? patterns : [];
    for (let i = 0; i < ref1.length; i++) {
      pattern = ref1[i];
      if (!pattern.disabled) {
        this.patterns.push(this.grammar.createPattern(pattern));
      }
    }
    if (this.endPattern && !this.endPattern.hasBackReferences) {
      if (this.applyEndPatternLast) {
        this.patterns.push(this.endPattern);
      } else {
        this.patterns.unshift(this.endPattern);
      }
    }
    this.scannersByBaseGrammarName = {};
    this.createEndPattern = null;
    this.anchorPosition = -1;
  }

  getIncludedPatterns(baseGrammar, included) {
    if (included == null) {
      included = [];
    }
    if (_.include(included, this)) {
      return [];
    }
    included = included.concat([this]);
    let allPatterns = [];
    for (let i = 0; i < this.patterns.length; i++) {
      let pattern = this.patterns[i];
      allPatterns.push.apply(allPatterns, pattern.getIncludedPatterns(baseGrammar, included));
    }
    return allPatterns;
  }

  clearAnchorPosition() {
    return this.anchorPosition = -1;
  }

  getScanner(baseGrammar) {
    let scanner = this.scannersByBaseGrammarName[baseGrammar.name]
    if (scanner) {
      return scanner;
    }
    let patterns = this.getIncludedPatterns(baseGrammar);
    scanner = new Scanner(patterns);
    this.scannersByBaseGrammarName[baseGrammar.name] = scanner;
    return scanner;
  }

  scanInjections(ruleStack, line, position, firstLine) {
    let baseGrammar = ruleStack[0].rule.grammar;
    let injections = baseGrammar.injections;
    if (baseGrammar.injections) {
      let ref = injections.getScanners(ruleStack);
      for (let i = 0; i < ref.length; i++) {
        let scanner = ref[i];
        let result = scanner.findNextMatch(line, firstLine, position, this.anchorPosition);
        if (result != null) {
          return result;
        }
      }
    }
  }

  normalizeCaptureIndices(line, captureIndices) {
    let lineLength = line.length;
    for (let i = 0; i < captureIndices.length; i++) {
      let capture = captureIndices[i];
      capture.end = Math.min(capture.end, lineLength);
      capture.start = Math.min(capture.start, lineLength);
    }
  }

  findNextMatch(ruleStack, lineWithNewline, position, firstLine) {
    let baseGrammar = ruleStack[0].rule.grammar;
    let results = [];
    let scanner = this.getScanner(baseGrammar);
    if (scanner.findNextMatch(lineWithNewline, firstLine, position, this.anchorPosition)) {
      results.push(scanner.findNextMatch(lineWithNewline, firstLine, position, this.anchorPosition));
    }
    let result = this.scanInjections(ruleStack, lineWithNewline, position, firstLine);
    if (result) {
      for (let i = 0; i < baseGrammar.injections.injections.length; i++) {
        let injection = baseGrammar.injections.injections[i];
        if (injection.scanner === result.scanner) {
          if (injection.selector.getPrefix(this.grammar.scopesFromStack(ruleStack)) === 'L') {
            results.unshift(result);
          } else {
            // TODO: Prefixes can either be L, B, or R.
            // R is assumed to mean "right", which is the default (add to end of stack).
            // There's no documentation on B, however.
            results.push(result);
          }
        }
      }
    }
    let scopes = null;
    for (let j = 0; j < this.registry.injectionGrammars.length; j++) {
      let injectionGrammar = this.registry.injectionGrammars[j];
      if (injectionGrammar === this.grammar) {
        continue;
      }
      if (injectionGrammar === baseGrammar) {
        continue;
      }
      if (scopes == null) {
        scopes = this.grammar.scopesFromStack(ruleStack);
      }
      if (injectionGrammar.injectionSelector.matches(scopes)) {
        scanner = injectionGrammar.getInitialRule().getScanner(injectionGrammar, position, firstLine);
        result = scanner.findNextMatch(lineWithNewline, firstLine, position, this.anchorPosition);
        if (result) {
          if (injectionGrammar.injectionSelector.getPrefix(scopes) === 'L') {
            results.unshift(result);
          } else {
            // TODO: Prefixes can either be L, B, or R.
            // R is assumed to mean "right", which is the default (add to end of stack).
            // There's no documentation on B, however.
            results.push(result);
          }
        }
      }
    }
    if (results.length > 1) {
      return _.min(results, (function(_this) {
        return function(result) {
          _this.normalizeCaptureIndices(lineWithNewline, result.captureIndices);
          return result.captureIndices[0].start;
        };
      })(this));
    } else if (results.length === 1) {
      result = results[0];
      this.normalizeCaptureIndices(lineWithNewline, result.captureIndices);
      return result;
    }
  }

  getNextTags(ruleStack, line, lineWithNewline, position, firstLine) {
    let result = this.findNextMatch(ruleStack, lineWithNewline, position, firstLine);
    if (result == null) {
      return null;
    }
    let index = result.index;
    let captureIndices = result.captureIndices;
    let scanner = result.scanner;
    let firstCapture = captureIndices[0];
    let endPatternMatch = this.endPattern === scanner.patterns[index];
    let nextTags = scanner.handleMatch(result, ruleStack, line, this, endPatternMatch);
    if (nextTags) {
      return {
        nextTags: nextTags,
        tagsStart: firstCapture.start,
        tagsEnd: firstCapture.end
      };
    }
  }

  getRuleToPush(line, beginPatternCaptureIndices) {
    if (this.endPattern.hasBackReferences) {
      let rule = this.grammar.createRule({
        scopeName: this.scopeName,
        contentScopeName: this.contentScopeName
      });
      rule.endPattern = this.endPattern.resolveBackReferences(line, beginPatternCaptureIndices);
      rule.patterns = [rule.endPattern].concat(__slice.call(this.patterns));
      return rule;
    } else {
      return this;
    }
  }

}

module.exports = Rule;
