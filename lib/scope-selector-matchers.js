class SegmentMatcher {
  constructor(segments) {
    this.segment = segments[0].join('') + segments[1].join('');
  }

  matches(scope) {
    return scope === this.segment;
  }

  getPrefix(scope) {

  }

  toCssSelector() {
    return this.segment.split('.').map((dotFragment) => {
      return '.' + dotFragment.replace(/\+/g, '\\+');
    }).join('');
  }

  toCssSyntaxSelector() {
    return this.segment.split('.').map((dotFragment) => {
      return '.syntax--' + dotFragment.replace(/\+/g, '\\+');
    }).join('');
  }
}

class TrueMatcher {
  constructor() {

  }

  matches() {
    return true;
  }

  getPrefix(scopes) {

  }

  toCssSelector() {
    return '*';
  }

  toCssSyntaxSelector() {
    return '*';
  }
}

class ScopeMatcher {
  constructor(first, others) {
    this.segments = [first];

    for(let i = 0; i < others.length; i++) {
      this.segments.push(others[i][1]);
    }
  }

  matches(scope) {
    // This should be further worked on, but any logical changes caused failing tests.
    let matcherSegment, matcherSegmentIndex, _i;
    let lastDotIndex = 0;
    for (matcherSegmentIndex = _i = 0; _i < this.segments.length; matcherSegmentIndex = ++_i) {
      matcherSegment = this.segments[matcherSegmentIndex];
      if (lastDotIndex > scope.length) {
        break;
      }
      let nextDotIndex = scope.indexOf('.', lastDotIndex);
      if (nextDotIndex === -1) {
        nextDotIndex = scope.length;
      }
      let scopeSegment = scope.substring(lastDotIndex, nextDotIndex);
      if (!matcherSegment.matches(scopeSegment)) {
        return false;
      }
      lastDotIndex = nextDotIndex + 1;
    }
    return matcherSegmentIndex === this.segments.length;
  }

  getPrefix(scope) {
    let scopeSegments = scope.split('.');
    if (scopeSegments.length < this.segments.length) {
      return false;
    }

    for (let i = 0; i < this.segments.length; i++) {
      if (this.segments[i].matches(scopeSegments[i])) {
        if (this.segments[i].prefix != null) {
          return this.segments[i].prefix;
        }
      }
    }
  }

  toCssSelector() {
    return this.segments.map((matcher) => {
      return matcher.toCssSelector();
    }).join('');
  }

  toCssSyntaxSelector() {
    return this.segments.map((matcher) => {
      return matcher.toCssSyntaxSelector();
    }).join('');
  }
}

class GroupMatcher {
  constructor(prefix, selector) {
    this.prefix = prefix != null ? prefix[0] : void 0;
    this.selector = selector;
  }

  matches(scopes) {
    return this.selector.matches(scopes);
  }

  getPrefix(scopes) {
    if (this.selector.matches(scopes)) {
      return this.prefix;
    }
  }

  toCssSelector() {
    return this.selector.toCssSelector();
  }

  toCssSyntaxSelector() {
    return this.selector.toCssSyntaxSelector();
  }
}

class PathMatcher {
  constructor(prefix, first, others) {
    this.prefix = prefix != null ? prefix[0] : void 0;
    this.matchers = [first];

    for (let i = 0; i < others.length; i++) {
      this.matchers.push(others[i][1]);
    }
  }

  matches(scopes) {
    // This could likely be reduced further, but additional changes
    // caused inconsistent tests.
    let index = 0;
    let matcher = this.matchers[index];
    for (let i = 0; i < scopes.length; i++) {
      let scope = scopes[i];

      if (matcher.matches(scope)) {
        matcher = this.matchers[++index];
      }
      if (matcher == null) {
        return true;
      }
    }
    return false;
  }

  getPrefix(scopes) {
    if (this.matches(scopes)) {
      return this.prefix;
    }
  }

  toCssSelector() {
    return this.matchers.map((matcher) => {
      return matcher.toCssSelector();
    }).join(' ');
  }

  toCssSyntaxSelector() {
    return this.matchers.map((matcher) => {
      return matcher.toCssSyntaxSelector();
    }).join(' ');
  }

}

class OrMatcher {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }

  matches(scopes) {
    return this.left.matches(scopes) || this.right.matches(scopes);
  }

  getPrefix(scopes) {
    return this.left.getPrefix(scopes) || this.right.getPrefix(scopes);
  }

  toCssSelector() {
    return `${this.left.toCssSelector()}, ${this.right.toCssSelector()}`;
  }

  toCssSyntaxSelector() {
    return `${this.left.toCssSyntaxSelector()}, ${this.right.toCssSyntaxSelector()}`;
  }
}

class AndMatcher {
  constructor(left, right) {
    this.left = left;
    this.right = right;
  }

  matches(scopes) {
    return this.left.matches(scopes) && this.right.matches(scopes);
  }

  getPrefix(scopes) {
    if (this.left.matches(scopes) && this.right.matches(scopes)) {
      return this.left.getPrefix(scopes);
    }
  }

  toCssSelector() {
    if (this.right instanceof NegateMatcher) {
      return `${this.left.toCssSelector()}${this.right.toCssSelector()}`;
    } else {
      return `${this.left.toCssSelector()} ${this.right.toCssSelector()}`;
    }
  }

  toCssSyntaxSelector() {
    if (this.right instanceof NegateMatcher) {
      return `${this.left.toCssSyntaxSelector()}${this.right.toCssSyntaxSelector()}`;
    } else {
      return `${this.left.toCssSyntaxSelector()} ${this.right.toCssSyntaxSelector()}`;
    }
  }
}

class NegateMatcher {
  constructor(matcher) {
    this.matcher = matcher;
  }

  matches(scopes) {
    return !this.matcher.matches(scopes);
  }

  getPrefix(scopes) {

  }

  toCssSelector() {
    return `:not(${this.matcher.toCssSelector()})`;
  }

  toCssSyntaxSelector() {
    return `:not(${this.matcher.toCssSyntaxSelector()})`;
  }
}

class CompositeMatcher {
  constructor(left, operator, right) {
    switch(operator) {
      case '|':
        this.matcher = new OrMatcher(left, right);
        break;
      case '&':
        this.matcher = new AndMatcher(left, right);
        break;
      case '-':
        this.matcher = new AndMatcher(left, new NegateMatcher(right));
        break;
    }
  }

  matches(scopes) {
    return this.matcher.matches(scopes);
  }

  getPrefix(scopes) {
    return this.matcher.getPrefix(scopes);
  }

  toCssSelector() {
    return this.matcher.toCssSelector();
  }

  toCssSyntaxSelector() {
    return this.matcher.toCssSyntaxSelector();
  }
}

module.exports = {
  AndMatcher: AndMatcher,
  CompositeMatcher: CompositeMatcher,
  GroupMatcher: GroupMatcher,
  NegateMatcher: NegateMatcher,
  OrMatcher: OrMatcher,
  PathMatcher: PathMatcher,
  ScopeMatcher: ScopeMatcher,
  SegmentMatcher: SegmentMatcher,
  TrueMatcher: TrueMatcher
};
