
module.exports = {
  ScopeSelector: require("./scope-selector.js"),
  GrammarRegistry: require("./grammar-registry.js"),
  Grammar: require("./grammar.js"),
  get OnigRegExp() {
    return require("oniguruma").OnigRegExp;
  }
};
