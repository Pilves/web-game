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
    if (!Number.isFinite(angle)) return 0;
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /**
   * Check if a line segment intersects an axis-aligned bounding box
   * Uses Liang-Barsky algorithm for efficient segment-AABB intersection
   * @param {number} x1 - Start X coordinate
   * @param {number} y1 - Start Y coordinate
   * @param {number} x2 - End X coordinate
   * @param {number} y2 - End Y coordinate
   * @param {Object} rect - Rectangle { x, y, width, height }
   * @returns {boolean} True if segment intersects rectangle
   */
  function segmentIntersectsRect(x1, y1, x2, y2, rect) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    // Rectangle bounds
    const minX = rect.x;
    const maxX = rect.x + rect.width;
    const minY = rect.y;
    const maxY = rect.y + rect.height;

    let tMin = 0;
    let tMax = 1;

    // Check X slab
    if (dx === 0) {
      // Line is vertical, check if within X bounds
      if (x1 < minX || x1 > maxX) return false;
    } else {
      const t1 = (minX - x1) / dx;
      const t2 = (maxX - x1) / dx;
      const tEnter = Math.min(t1, t2);
      const tExit = Math.max(t1, t2);
      tMin = Math.max(tMin, tEnter);
      tMax = Math.min(tMax, tExit);
      if (tMin > tMax) return false;
    }

    // Check Y slab
    if (dy === 0) {
      // Line is horizontal, check if within Y bounds
      if (y1 < minY || y1 > maxY) return false;
    } else {
      const t1 = (minY - y1) / dy;
      const t2 = (maxY - y1) / dy;
      const tEnter = Math.min(t1, t2);
      const tExit = Math.max(t1, t2);
      tMin = Math.max(tMin, tEnter);
      tMax = Math.min(tMax, tExit);
      if (tMin > tMax) return false;
    }

    return true;
  }

  /**
   * Check if there's a clear line of sight between two points
   * Uses segment-AABB intersection for O(obstacles) complexity
   * @param {number} x1 - Start X coordinate
   * @param {number} y1 - Start Y coordinate
   * @param {number} x2 - End X coordinate
   * @param {number} y2 - End Y coordinate
   * @param {Array} obstacles - Array of obstacle rectangles
   * @returns {boolean} True if line of sight is clear
   */
  function hasLineOfSight(x1, y1, x2, y2, obstacles) {
    for (const obstacle of obstacles) {
      if (segmentIntersectsRect(x1, y1, x2, y2, obstacle)) {
        return false; // Blocked by obstacle
      }
    }
    return true; // Clear line of sight
  }

  return {
    rectsCollide,
    pointInRect,
    normalizeAngle,
    segmentIntersectsRect,
    hasLineOfSight,
  };
}));
