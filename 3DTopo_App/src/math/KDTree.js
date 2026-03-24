// A lightweight, bespoke 3D KD-Tree implementation for O(N log N) spatial queries
// Adapted for PCF Point Geometry

class KDNode {
  constructor(point, element, axis) {
    this.point = point;       // { x, y, z }
    this.element = element;   // The original PCF row/element
    this.axis = axis;         // 0 for x, 1 for y, 2 for z
    this.left = null;
    this.right = null;
  }
}

export class KDTree {
  constructor(points) {
    // points should be an array of objects containing a 'coord' and an 'element'
    // e.g., [{ coord: {x,y,z}, element: rowData }]
    this.root = this.buildTree(points, 0);
  }

  buildTree(points, depth) {
    if (!points || points.length === 0) return null;

    const axis = depth % 3;
    const axisKey = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';

    points.sort((a, b) => a.coord[axisKey] - b.coord[axisKey]);

    const medianIndex = Math.floor(points.length / 2);
    const medianNode = new KDNode(points[medianIndex].coord, points[medianIndex].element, axis);

    medianNode.left = this.buildTree(points.slice(0, medianIndex), depth + 1);
    medianNode.right = this.buildTree(points.slice(medianIndex + 1), depth + 1);

    return medianNode;
  }

  // Returns the nearest element (or null) within a specific tolerance
  // excludeRowIndex avoids matching an element to itself
  findNearest(targetCoord, tolerance, excludeRowIndex) {
    let bestDist = tolerance;
    let bestElement = null;

    const search = (node) => {
      if (!node) return;

      const d = Math.sqrt(
        Math.pow(node.point.x - targetCoord.x, 2) +
        Math.pow(node.point.y - targetCoord.y, 2) +
        Math.pow(node.point.z - targetCoord.z, 2)
      );

      // We found a better match that is not the excluded element
      if (d <= bestDist && node.element._rowIndex !== excludeRowIndex) {
        bestDist = d;
        bestElement = node.element;
      }

      const axisKey = node.axis === 0 ? 'x' : node.axis === 1 ? 'y' : 'z';
      const diff = targetCoord[axisKey] - node.point[axisKey];

      // Standard KD-tree search optimization: search the closer branch first
      let first = diff < 0 ? node.left : node.right;
      let second = diff < 0 ? node.right : node.left;

      search(first);
      // Only search the other branch if the hyper-plane boundary is within the current best distance
      if (Math.abs(diff) <= bestDist) {
        search(second);
      }
    };

    search(this.root);
    return bestElement;
  }
}
