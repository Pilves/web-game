/**
 * geometry.js - Shared geometry utilities for collision and visibility
 *
 * UMD pattern for Node.js (server) and browser (client) compatibility
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GEOMETRY = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  /**
   * Check if two axis-aligned bounding boxes collide
   * @param {Object} a - First rectangle { x, y, width, height }
   * @param {Object} b - Second rectangle { x, y, width, height }
   * @returns {boolean} True if rectangles overlap
   */
  function rectsCollide(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  /**
   * Check if a point is inside a rectangle
   * @param {number} x - Point x coordinate
   * @param {number} y - Point y coordinate
   * @param {Object} rect - Rectangle { x, y, width, height }
   * @returns {boolean} True if point is inside rectangle
   */
  function pointInRect(x, y, rect) {
    return (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    );
  }

  /**
   * Normalize angle to range [-PI, PI]
   * @param {number} angle - Angle in radians
   * @returns {number} Normalized angle
   */
  function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Check if there's a clear line of sight between two points
   * @param {number} x1 - Start X coordinate
   * @param {number} y1 - Start Y coordinate
   * @param {number} x2 - End X coordinate
   * @param {number} y2 - End Y coordinate
   * @param {Array} obstacles - Array of obstacle rectangles
   * @returns {boolean} True if line of sight is clear
   */
  function hasLineOfSight(x1, y1, x2, y2, obstacles) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);

    // Step through line every 10px
    const steps = Math.ceil(distance / 10);

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;

      for (const obstacle of obstacles) {
        if (pointInRect(x, y, obstacle)) {
          return false; // Blocked by obstacle
        }
      }
    }

    return true; // Clear line of sight
  }

  return {
    rectsCollide,
    pointInRect,
    normalizeAngle,
    hasLineOfSight,
  };
}));
