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

  function rectsCollide(a, b) {
    return (
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y
    );
  }

  function pointInRect(x, y, rect) {
    return (
      x >= rect.x &&
      x < rect.x + rect.width &&
      y >= rect.y &&
      y < rect.y + rect.height
    );
  }

  // Normalize angle to [-PI, PI]
  function normalizeAngle(angle) {
    if (!Number.isFinite(angle)) return 0;
    const TWO_PI = 2 * Math.PI;
    const EPSILON = Number.EPSILON;
    angle = angle % TWO_PI;
    if (angle > Math.PI + EPSILON) angle -= TWO_PI;
    else if (angle < -Math.PI - EPSILON) angle += TWO_PI;
    return angle;
  }

  // Liang-Barsky segment-AABB intersection
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
    if (Math.abs(dx) < 0.0001) {
      // Line is vertical, check if within X bounds (exclusive right edge)
      if (x1 < minX || x1 >= maxX) return false;
      // Also check Y range overlap for vertical lines (exclusive bottom edge)
      const segMinY = Math.min(y1, y2);
      const segMaxY = Math.max(y1, y2);
      if (segMaxY < minY || segMinY >= maxY) return false;
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
    if (Math.abs(dy) < 0.0001) {
      // Line is horizontal, check if within Y bounds (exclusive bottom edge)
      if (y1 < minY || y1 >= maxY) return false;
      // Also check X range overlap for horizontal lines (exclusive right edge)
      const segMinX = Math.min(x1, x2);
      const segMaxX = Math.max(x1, x2);
      if (segMaxX < minX || segMinX >= maxX) return false;
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

  function hasLineOfSight(x1, y1, x2, y2, obstacles) {
    if (!Array.isArray(obstacles)) return true;
    for (const obstacle of obstacles) {
      if (segmentIntersectsRect(x1, y1, x2, y2, obstacle)) {
        return false; // Blocked by obstacle
      }
    }
    return true; // Clear line of sight
  }

  function getWrappedDistance(x1, y1, x2, y2, arenaWidth, arenaHeight) {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) ||
        !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return 0;
    }
    if (!Number.isFinite(arenaWidth) || !Number.isFinite(arenaHeight) ||
        arenaWidth <= 0 || arenaHeight <= 0) {
      return Math.hypot(x2 - x1, y2 - y1);
    }
    let dx = Math.abs(x2 - x1);
    let dy = Math.abs(y2 - y1);
    dx = Math.min(dx, arenaWidth - dx);
    dy = Math.min(dy, arenaHeight - dy);
    return Math.hypot(dx, dy);
  }

  function getWrappedDelta(x1, y1, x2, y2, arenaWidth, arenaHeight) {
    if (!Number.isFinite(x1) || !Number.isFinite(y1) ||
        !Number.isFinite(x2) || !Number.isFinite(y2)) {
      return { dx: 0, dy: 0 };
    }
    let dx = x2 - x1;
    let dy = y2 - y1;
    if (!Number.isFinite(arenaWidth) || !Number.isFinite(arenaHeight) ||
        arenaWidth <= 0 || arenaHeight <= 0) {
      return { dx, dy };
    }
    if (Math.abs(dx) > arenaWidth / 2) {
      dx = dx > 0 ? dx - arenaWidth : dx + arenaWidth;
    }
    if (Math.abs(dy) > arenaHeight / 2) {
      dy = dy > 0 ? dy - arenaHeight : dy + arenaHeight;
    }
    return { dx, dy };
  }

  return {
    rectsCollide,
    pointInRect,
    normalizeAngle,
    segmentIntersectsRect,
    hasLineOfSight,
    getWrappedDistance,
    getWrappedDelta,
  };
}));
