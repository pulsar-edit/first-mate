const Grammar = require("./grammar.js");

// A grammar with no patterns that is always available from a {GrammarRegistry}
// even when it is completely empty.
class NullGrammar extends Grammar {
  constructor(registry) {
    super(registry, { name: "Null Grammar", scopeName: "text.plain.null-grammar" });
  }

  getScore() {
    return 0;
  }
}

module.exports = NullGrammar;
