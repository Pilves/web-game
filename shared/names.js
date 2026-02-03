// shared/names.js - Player name generator (works in both Node.js and browser)
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PLAYER_NAMES = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  const names = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
  let next = 0;

  function generateName() {
    const name = names[next % names.length];
    next++;
    return name;
  }

  return { generateName };
}));
