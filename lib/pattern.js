const _ = require("underscore-plus");
const AllCustomCaptureIndicesRegex = /\$(\d+)|\${(\d+):\/(downcase|upcase)}/g;
const AllDigitsRegex = /\\\d+/g;
const DigitRegex = /\\\d+/;
let __slice = [].slice;

class Pattern {
  constructor(grammar, registry, options) {
    this.grammar = grammar;
    this.registry = registry;
    if (options == null) {
      options = {};
    }
    let { patterns, name, contentName, match, begin, end, captures, beginCaptures, endCaptures, applyEndPatternLast } = options;
    this.include = options.include;
    this.popRule = options.popRule;
    this.hasBackReferences = options.hasBackReferences;
    this.pushRule = null;
    this.backReferences = null;
    this.scopeName = name;
    this.contentScopeName = contentName;

    if (match) {
      if ((end || this.popRule) && (this.hasBackReferences != null ? this.hasBackReferences : this.hasBackReferences = DigitRegex.test(match))) {
        this.match = match;
      } else {
        this.regexSource = match;
      }
      this.captures = captures;
    } else if (begin) {
      this.regexSource = begin;
      this.captures = beginCaptures != null ? beginCaptures : captures;
      let endPattern = this.grammar.createPattern({
        match: end,
        captures: endCaptures != null ? endCaptures : captures,
        popRule: true
      });
      this.pushRule = this.grammar.createRule({
        scopeName: this.scopeName,
        contentScopeName: this.contentScopeName,
        patterns: patterns,
        endPattern: endPattern,
        applyEndPatternLast: applyEndPatternLast
      });
    }

    if (this.captures != null) {
      for (const group in this.captures) {
        let capture = this.captures[group];
        if ((capture.patterns != null ? capture.patterns.length : void 0) > 0 && !capture.rule) {
          capture.scopeName = this.scopeName;
          capture.rule = this.grammar.createRule(capture);
        }
      }
    }
    this.anchored = this.hasAnchor();
  }

  getRegex(firstLine, position, anchorPosition) {
    if (this.anchored) {
      return this.replaceAnchor(firstLine, position, anchorPosition);
    } else {
      return this.regexSource;
    }
  }

  hasAnchor() {
    if (!this.regexSource) {
      return false;
    }
    let escape = false;
    for (let i = 0; i < this.regexSource.length; i++) {
      let character = this.regexSource[i];
      if (escape && (character === 'A' || character === 'G' || character === 'z')) {
        return true;
      }
      escape = !escape && character === '\\';
    }
    return false;
  }

  replaceAnchor(firstLine, offset, anchor) {
    let escaped = [];
    let placeholder = '\uFFFF';
    let escape = false;
    for (let i = 0; i < this.regexSource.length; i++) {
      let character = this.regexSource[i];
      if (escape) {
        switch (character) {
          case 'A':
            if (firstLine) {
              escaped.push("\\" + character);
            } else {
              escaped.push(placeholder);
            }
            break;
          case 'G':
            if (offset === anchor) {
              escaped.push("\\" + character);
            } else {
              escaped.push(placeholder);
            }
            break;
          case 'z':
            escaped.push('$(?!\n)(?<!\n)');
            break;
          default:
            escaped.push("\\" + character);
        }
        escape = false;
      } else if (character === '\\') {
        escape = true;
      } else {
        escaped.push(character);
      }
    }
    return escaped.join('');
  }

  resolveBackReferences(line, beginCaptureIndices) {
    let beginCaptures = [];
    for (let i = 0; i < beginCaptureIndices.length; i++) {
      beginCaptures.push(line.substring(beginCaptureIndices[i].start, beginCaptureIndices[i].end));
    }
    let resolvedMatch = this.match.replace(AllDigitsRegex, (match) => {
      let index = parseInt(match.slice(1));
      if (beginCaptures[index] != null) {
        return _.escapeRegExp(beginCaptures[index]);
      } else {
        return "\\" + index;
      }
    });
    return this.grammar.createPattern({
      hasBackReferences: false,
      match: resolvedMatch,
      captures: this.captures,
      popRule: this.popRule
    });
  }

  ruleForInclude(baseGrammar, name) {
    let hashIndex = name.indexOf("#");
    if (hashIndex === 0) {
      return this.grammar.getRepository()[name.slice(1)];
    } else if (hashIndex >= 1) {
      let grammarName = name.slice(0, +(hashIndex - 1) + 1 || 9e9);
      let ruleName = name.slice(hashIndex + 1);
      this.grammar.addIncludedGrammarScope(grammarName);
      let _ref = this.registry.grammarForScopeName(grammarName);
      return _ref != null ? _ref.getRepository()[ruleName] : void 0;
    } else if (name === '$self') {
      return this.grammar.getInitialRule();
    } else if (name === '$base') {
      return baseGrammar.getInitialRule();
    } else {
      this.grammar.addIncludedGrammarScope(name);
      let _ref = this.registry.grammarForScopeName(name);
      return _ref != null ? _ref.getInitialRule() : void 0;
    }
  }

  getIncludedPatterns(baseGrammar, included) {
    if (this.include) {
      let rule = this.ruleForInclude(baseGrammar, this.include);
      let _ref = rule != null ? rule.getIncludedPatterns(baseGrammar, included) : void 0;
      return _ref != null ? _ref : [];
    } else {
      return [this];
    }
  }

  resolveScopeName(scopeName, line, captureIndices) {
    return scopeName.replace(AllCustomCaptureIndicesRegex, (match, index, commandIndex, command) => {
      let capture = captureIndices[parseInt(index != null ? index : commandIndex)];
      if (capture != null) {
        let replacement = line.substring(capture.start, capture.end);
        // Remove leading dots that would make the selector invalid
        while(replacement[0] === '.') {
          replacement = replacement.substring(1);
        }
        switch(command) {
          case 'downcase':
            return replacement.toLowerCase();
          case 'upcase':
            return replacement.toUpperCase();
          default:
            return replacement;
        }
      } else {
        return match;
      }
    });
  }

  handleMatch(stack, line, captureIndices, rule, endPatternMatch) {
    let scopeName, contentScopeName;
    let tags = [];
    let zeroWidthMatch = captureIndices[0].start === captureIndices[0].end;
    if (this.popRule) {
      // Pushing and popping a rule based on zero width matches at the same index
      // leads to an infinite loop. We bail on parsing if we detect that case here.
      if (zeroWidthMatch && _.last(stack).zeroWidthMatch && _.last(stack).rule.anchorPosition === captureIndices[0].end) {
        return false;
      }
      contentScopeName = _.last(stack).contentScopeName;
      if (contentScopeName) {
        tags.push(this.grammar.endIdForScope(contentScopeName));
      }
    } else if (this.scopeName) {
      scopeName = this.resolveScopeName(this.scopeName, line, captureIndices);
      tags.push(this.grammar.startIdForScope(scopeName));
    }
    if (this.captures) {
      tags.push.apply(tags, this.tagsForCaptureIndices(line, captureIndices.slice(), captureIndices, stack));
    } else {
      if (captureIndices[0].end !== captureIndices[0].start) {
        tags.push(captureIndices[0].end - captureIndices[0].start);
      }
    }
    if (this.pushRule) {
      let ruleToPush = this.pushRule.getRuleToPush(line, captureIndices);
      ruleToPush.anchorPosition = captureIndices[0].end;
      contentScopeName = ruleToPush.contentScopeName;
      if (contentScopeName) {
        contentScopeName = this.resolveScopeName(contentScopeName, line, captureIndices);
        tags.push(this.grammar.startIdForScope(contentScopeName));
      }
      stack.push({
        rule: ruleToPush,
        scopeName: scopeName,
        contentScopeName: contentScopeName,
        zeroWidthMatch: zeroWidthMatch
      });
    } else {
      if (this.popRule) {
        scopeName = stack.pop().scopeName;
      }
      if (scopeName) {
        tags.push(this.grammar.endIdForScope(scopeName));
      }
    }
    return tags;
  }

  tagsForCaptureRule(rule, line, captureStart, captureEnd, stack) {
    let captureText = line.substring(captureStart, captureEnd);
    let tags = rule.grammar.tokenizeLine(captureText, __slice.call(stack).concat([{
      rule: rule
    }]), false, true, false).tags;

    // only accept non empty tokens that don't exceed the capture end
    let openScopes = [];
    let captureTags = [];
    let offset = 0;

    for (let i = 0; i < tags.length; i++) {
      let tag = tags[i];
      if (!(tag < 0 || (tag > 0 && offset < captureEnd))) {
        continue;
      }
      captureTags.push(tag);
      if (tag >= 0) {
        offset += tag;
      } else {
        if (tag % 2 === 0) {
          openScopes.pop();
        } else {
          openScopes.push(tag);
        }
      }
    }
    // close any scopes left open by matching this rule since we don't pass our stack
    while (openScopes.length > 0) {
      captureTags.push(openScopes.pop() -1);
    }
    return captureTags;
  }

  // Get the tokens for the capture indices.
  //
  // line - The string being tokenized.
  // currentCaptureIndices - The current array of capture indices being
  //                         processed into tokens. This method is called
  //                         recursively and this array will be modified inside
  //                         this method.
  // allCaptureIndices - The array of all capture indices, this array will not
  //                     be modified.
  // stack - An array of rules.
  //
  // Returns a non-null but possibly empty array of tokens.
  tagsForCaptureIndices(line, currentCaptureIndices, allCaptureIndices, stack) {
    let parentCapture = currentCaptureIndices.shift();
    let tags = [];
    let scope = this.captures[parentCapture.index] != null ? this.captures[parentCapture.index].name : void 0;
    let captureTags, parentCaptureScope;
    if (scope) {
      parentCaptureScope = this.resolveScopeName(scope, line, allCaptureIndices);
      tags.push(this.grammar.startIdForScope(parentCaptureScope));
    }
    let captureRule = this.captures[parentCapture.index] != null ? this.captures[parentCapture.index].rule : void 0;
    if (captureRule) {
      captureTags = this.tagsForCaptureRule(captureRule, line, parentCapture.start, parentCapture.end, stack);
      tags.push.apply(tags, captureTags);
      // Consume child captures 
      while (currentCaptureIndices.length && currentCaptureIndices[0].start < parentCapture.end) {
        currentCaptureIndices.shift();
      }
    } else {
      let previousChildCaptureEnd = parentCapture.start;
      while (currentCaptureIndices.length && currentCaptureIndices[0].start < parentCapture.end) {
        let childCapture = currentCaptureIndices[0];
        let emptyCapture = childCapture.end - childCapture.start === 0;
        let captureHasNoScope = !this.captures[childCapture.index];
        if (emptyCapture || captureHasNoScope) {
          currentCaptureIndices.shift();
          continue;
        }
        if (childCapture.start > previousChildCaptureEnd) {
          tags.push(childCapture.start - previousChildCaptureEnd);
        }
        captureTags = this.tagsForCaptureIndices(line, currentCaptureIndices, allCaptureIndices, stack);
        tags.push.apply(tags, captureTags);
        previousChildCaptureEnd = childCapture.end;
      }
      if (parentCapture.end > previousChildCaptureEnd) {
        tags.push(parentCapture.end - previousChildCaptureEnd);
      }
    }
    if (parentCaptureScope) {
      if (tags.length > 1) {
        tags.push(this.grammar.endIdForScope(parentCaptureScope));
      } else {
        tags.pop();
      }
    }
    return tags;
  }

}

module.exports = Pattern;
