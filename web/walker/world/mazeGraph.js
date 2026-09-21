// Circular ("theta") maze: the graph, the generator, and the route.
//
// No geometry and no three.js here -- this is the part that can be reasoned
// about and tested on its own. world/maze.js turns it into walls.
//
// THE THREE ALGORITHMS, which is what the maze is actually for:
//
//   1. GENERATION -- randomised depth-first search (recursive backtracker) over
//      a polar grid. It carves a spanning tree, so the maze is "perfect": every
//      cell reachable, exactly one simple path between any two cells, no loops.
//      That property is what makes step 3 correct.
//
//   2. SHORTEST PATH -- breadth-first search from the entrance to the centre.
//      On a tree this is the only simple path; BFS finds it in O(V+E).
//
//   3. FULL COVERAGE ENDING AT THE CENTRE -- the rule on the puzzle is that
//      every corridor must be walked. A depth-first walk of a tree crosses each
//      edge exactly twice and returns to where it started, which is the wrong
//      place to finish. So the walk is ordered: at every node on the
//      entrance-to-centre path, explore the subtrees that do NOT contain the
//      centre first (each of those returns to the node), and take the branch
//      that does contain the centre LAST. The walk then ends at the centre with
//      every corridor covered. Off-path corridors are walked twice, on-path
//      corridors once, which is the minimum possible for a tree.

/** Cells per ring, innermost ring first. Chosen so arc length stays ~2 m. */
export const RING_CELLS = [8, 8, 16, 16, 16, 32, 32];

export const CENTRE = 0; // node id of the middle

/**
 * Build the node/edge structure of a circular maze.
 * Node 0 is the centre disc; ring r cell i is `nodeId(r, i)`.
 */
export function buildGraph(ringCells = RING_CELLS) {
  const rings = ringCells.length;
  const offset = [];
  let n = 1; // node 0 is the centre
  for (let r = 0; r < rings; r++) {
    offset[r] = n;
    n += ringCells[r];
  }

  const nodes = new Array(n);
  nodes[CENTRE] = { id: CENTRE, r: -1, i: 0 };
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < ringCells[r]; i++) {
      nodes[offset[r] + i] = { id: offset[r] + i, r, i };
    }
  }

  const nodeId = (r, i) => offset[r] + ((i % ringCells[r]) + ringCells[r]) % ringCells[r];

  // Adjacency, as a set of undirected edges keyed low-high.
  const adj = Array.from({ length: n }, () => []);
  const edges = [];
  const link = (a, b, kind) => {
    adj[a].push({ to: b, kind });
    adj[b].push({ to: a, kind });
    edges.push({ a: Math.min(a, b), b: Math.max(a, b), kind });
  };

  // Centre to the innermost ring.
  for (let i = 0; i < ringCells[0]; i++) link(CENTRE, nodeId(0, i), 'radial');

  for (let r = 0; r < rings; r++) {
    // Around the ring. A ring of one cell has no circumferential neighbour.
    if (ringCells[r] > 1) {
      for (let i = 0; i < ringCells[r]; i++) {
        const j = (i + 1) % ringCells[r];
        if (j === i) continue;
        // With two cells, i->j and j->i are the same pair; add it once.
        if (ringCells[r] === 2 && i === 1) continue;
        link(nodeId(r, i), nodeId(r, j), 'circ');
      }
    }
    // Outward. A ring either matches its neighbour or has half as many cells.
    if (r + 1 < rings) {
      const here = ringCells[r];
      const out = ringCells[r + 1];
      const split = out / here;
      for (let i = 0; i < here; i++) {
        for (let k = 0; k < split; k++) link(nodeId(r, i), nodeId(r + 1, i * split + k), 'radial');
      }
    }
  }

  return { n, rings, ringCells, offset, nodes, adj, edges, nodeId };
}

/** Deterministic PRNG, so a seed always gives the same maze. */
function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Carve a perfect maze with a randomised DFS, starting at the centre so the
 * middle is always well connected.
 *
 * @returns {{passages:Set<string>, tree:Array<Array<number>>}}
 */
export function carve(graph, seed = 1) {
  const rand = rngFrom(seed);
  const visited = new Uint8Array(graph.n);
  const passages = new Set();
  const tree = Array.from({ length: graph.n }, () => []);

  // Explicit stack: recursion would blow up on a large maze.
  const stack = [CENTRE];
  visited[CENTRE] = 1;

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = [];
    for (const e of graph.adj[cur]) if (!visited[e.to]) options.push(e.to);

    if (!options.length) {
      stack.pop();
      continue;
    }
    const next = options[Math.floor(rand() * options.length) % options.length];
    visited[next] = 1;
    passages.add(key(cur, next));
    tree[cur].push(next);
    tree[next].push(cur);
    stack.push(next);
  }

  return { passages, tree };
}

/** Shortest path between two nodes, as node ids. BFS over the carved tree. */
export function bfsPath(tree, from, to) {
  const prev = new Int32Array(tree.length).fill(-1);
  const seen = new Uint8Array(tree.length);
  const q = [from];
  seen[from] = 1;

  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (cur === to) break;
    for (const nb of tree[cur]) {
      if (seen[nb]) continue;
      seen[nb] = 1;
      prev[nb] = cur;
      q.push(nb);
    }
  }
  if (!seen[to]) return null;

  const path = [];
  for (let at = to; at !== -1; at = prev[at]) path.push(at);
  return path.reverse();
}

/**
 * A walk from `start` that crosses every corridor at least once and finishes at
 * `goal`. See the header for why the ordering works.
 *
 * @returns {number[]} node ids in visiting order, start first, goal last
 */
export function coverageRoute(tree, start, goal) {
  const spine = bfsPath(tree, start, goal);
  if (!spine) return null;

  // Which node the walk must descend into next, for every node on the spine.
  const nextOnSpine = new Int32Array(tree.length).fill(-1);
  for (let i = 0; i < spine.length - 1; i++) nextOnSpine[spine[i]] = spine[i + 1];
  const onSpine = new Uint8Array(tree.length);
  for (const id of spine) onSpine[id] = 1;

  const route = [start];
  const visited = new Uint8Array(tree.length);
  visited[start] = 1;

  // Iterative DFS with an explicit stack of (node, childIndex, deferred).
  const stack = [{ node: start, k: 0, order: childOrder(start) }];

  function childOrder(node) {
    // Everything except the spine continuation first; the continuation last.
    const others = [];
    let last = -1;
    for (const nb of tree[node]) {
      if (visited[nb]) continue;
      if (onSpine[node] && nb === nextOnSpine[node]) last = nb;
      else others.push(nb);
    }
    if (last !== -1) others.push(last);
    return others;
  }

  while (stack.length) {
    const top = stack[stack.length - 1];

    if (top.k >= top.order.length) {
      stack.pop();
      // Walking back out of a dead end is a real move and belongs in the route.
      if (stack.length) route.push(stack[stack.length - 1].node);
      continue;
    }

    const child = top.order[top.k++];
    if (visited[child]) continue;
    visited[child] = 1;
    route.push(child);
    stack.push({ node: child, k: 0, order: childOrder(child) });
  }

  // The DFS finishes by unwinding all the way back to `start`, so the raw walk
  // ends in the wrong place. Every edge walked after the LAST visit to the goal
  // is a spine edge being retraced on the way out, and each of those was already
  // covered on the way in -- so cutting there loses no coverage and puts the
  // finish exactly where the puzzle wants it.
  let end = route.length - 1;
  while (end > 0 && route[end] !== goal) end--;
  return route.slice(0, end + 1);
}

/** Every edge the route actually traverses, for checking coverage. */
export function routeEdges(route) {
  const used = new Set();
  for (let i = 0; i < route.length - 1; i++) used.add(key(route[i], route[i + 1]));
  return used;
}

export { key as edgeKey };
