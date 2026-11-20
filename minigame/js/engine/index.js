(function (root, factory) {
  var mods = {
    Cards: require('./cards.js'), Rules: require('./rules.js'), Hand: require('./hand.js'),
    Camp: require('./camp.js'), Moves: require('./moves.js'), Table: require('./table.js'),
    AI: require('./ai.js'), AI2: require('./ai2.js'), Info: require('./info.js'),
    Settle: require('./settle.js'), Tribute: require('./tribute.js')
  };
  module.exports = mods;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () { return {}; });
