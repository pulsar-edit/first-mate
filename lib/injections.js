const _ = require("underscore-plus");
const Scanner = require("./scanner.js");
const ScopeSelector = require("./scope-selector.js");

class Injections {
  constructor(grammar, injections) {
    this.grammar = grammar;
    if (injections == null) {
      injections = {};
    }
    this.injections = [];
    this.scanners = {};

    for (const selector in injections) {
      let values = injections[selector];
      if (!((values != null ? values.patterns != null ? values.patterns.length : void 0 : void 0) > 0)) {
        continue;
      }
      let patterns = [];
      for (let i = 0; i < values.patterns.length; i++) {
        let pattern = this.grammar.createPattern(values.patterns[i]);
        patterns.push.apply(patterns, pattern.getIncludedPatterns(this.grammar, patterns));
      }
      this.injections.push({
        selector: new ScopeSelector(selector),
        patterns: patterns
      });
    }
  }

  getScanner(injection) {
    if (injection.scanner != null) {
      return injection.scanner;
    }
    injection.scanner = new Scanner(injection.patterns);
    return injection.scanner;
  }

  getScanners(ruleStack) {
    if (this.injections.length === 0) {
      return [];
    }
    let scanners = [];
    let scopes = this.grammar.scopesFromStack(ruleStack);
    for (let i = 0; i < this.injections.length; i++) {
      let injection = this.injections[i];
      if (!(injection.selector.matches(scopes))) {
        continue;
      }
      let scanner = this.getScanner(injection);
      scanners.push(scanner);
    }
    return scanners;
  }

}

module.exports = Injections;
