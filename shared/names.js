// shared/names.js - Player name generator (works in both Node.js and browser)
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PLAYER_NAMES = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  // Generate next available sequential name not already taken in the room
  function generateName(existingNames) {
    const taken = new Set((existingNames || []).map(n => n.toLowerCase()));
    for (let i = 1; i <= 100; i++) {
      const name = `Player ${i}`;
      if (!taken.has(name.toLowerCase())) {
        return name;
      }
    }
    return `Player ${Date.now() % 10000}`;
  }

  return { generateName };
}));
