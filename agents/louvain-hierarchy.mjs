/**
 * Louvain Community Detection → Concept Hierarchy
 *
 * Replaces GPT-based hierarchy generation with deterministic graph community detection.
 * Louvain modularity maximization finds groups of concepts that are densely connected
 * to each other and sparsely connected to other groups — pure graph theory, no LLM.
 *
 * Within each cluster, containment-verb edges ("contains", "part of") create sub-hierarchy.
 * Highest-degree node in each cluster becomes the container label.
 *
 * Output format matches the existing tree format consumed by buildHierarchy():
 *   { tree: [{ id, label, children: [{ id, label, children: [] }] }] }
 */

// ─── Containment verb detection ───
const CONTAINMENT_RE = /\b(contains?|part.?of|includes?|has|compris|component|consist|made.?of|composed)\b/i;

function isContainmentVerb(verb) {
  return CONTAINMENT_RE.test(verb || '');
}

// ─── Louvain modularity maximization ───
// Finds communities by maximizing Q = Σ[A_ij - γ·k_i·k_j/(2m)] · δ(c_i,c_j) / (2m)

function louvain(nodeIds, edges, gamma) {
  if (nodeIds.length === 0) return {};

  // Build adjacency with weights
  const adj = {};    // nodeId → Map<nodeId, weight>
  for (const id of nodeIds) adj[id] = new Map();

  for (const e of edges) {
    if (!adj[e.from] || !adj[e.to]) continue;
    // Containment verbs get boosted weight — they signal semantic grouping
    const w = isContainmentVerb(e.verb) ? 2.0 : 1.0;
    adj[e.from].set(e.to, (adj[e.from].get(e.to) || 0) + w);
    adj[e.to].set(e.from, (adj[e.to].get(e.from) || 0) + w);
  }

  // Total edge weight
  let m2 = 0; // 2m
  for (const id of nodeIds) {
    for (const w of adj[id].values()) m2 += w;
  }
  if (m2 === 0) return Object.fromEntries(nodeIds.map((id, i) => [id, i]));

  // Weighted degree of each node
  const k = {};
  for (const id of nodeIds) {
    let deg = 0;
    for (const w of adj[id].values()) deg += w;
    k[id] = deg;
  }

  // Initialize: each node in its own community
  const community = {};
  for (const id of nodeIds) community[id] = id;

  // Phase 1: local node moves
  let improved = true;
  let iterations = 0;
  const MAX_ITER = 20;

  while (improved && iterations < MAX_ITER) {
    improved = false;
    iterations++;

    // Deterministic order: sort by ID
    const sortedNodes = [...nodeIds].sort();

    for (const i of sortedNodes) {
      const currentComm = community[i];

      // Compute weights from i to each neighboring community
      const commWeights = new Map(); // communityId → weight from i to that community
      for (const [neighbor, w] of adj[i]) {
        const nc = community[neighbor];
        commWeights.set(nc, (commWeights.get(nc) || 0) + w);
      }

      // Compute sum_tot for each candidate community (sum of degrees of nodes in that community)
      // and sum_in (internal edge weight of that community)
      // For efficiency, compute on the fly from commWeights keys
      const candidateComms = new Set(commWeights.keys());
      candidateComms.add(currentComm);

      let bestComm = currentComm;
      let bestDeltaQ = 0;

      for (const C of candidateComms) {
        if (C === currentComm) continue;

        // k_i_C = sum of weights from i to nodes in community C
        const k_i_C = commWeights.get(C) || 0;

        // sum_tot_C = sum of degrees of all nodes in C
        let sum_tot_C = 0;
        for (const id of nodeIds) {
          if (community[id] === C) sum_tot_C += k[id];
        }

        // k_i_old = sum of weights from i to nodes in its current community (excluding self)
        const k_i_old = commWeights.get(currentComm) || 0;

        // sum_tot_old = sum of degrees of all nodes in current community (excluding i)
        let sum_tot_old = 0;
        for (const id of nodeIds) {
          if (community[id] === currentComm && id !== i) sum_tot_old += k[id];
        }

        // ΔQ = [k_i_C - k_i_old] / m - γ * k_i * [sum_tot_C - sum_tot_old] / (2m²)
        const deltaQ = (k_i_C - k_i_old) / (m2 / 2)
          - gamma * k[i] * (sum_tot_C - sum_tot_old) / (m2 * m2 / 4);

        if (deltaQ > bestDeltaQ) {
          bestDeltaQ = deltaQ;
          bestComm = C;
        }
      }

      if (bestComm !== currentComm) {
        community[i] = bestComm;
        improved = true;
      }
    }
  }

  return community;
}

// ─── Resolution tuning + cluster merging for 3-8 clusters ───
function louvainWithResolution(nodeIds, edges, targetMin, targetMax) {
  // Build adjacency for inter-cluster edge counting
  const adj = {};
  for (const id of nodeIds) adj[id] = new Map();
  for (const e of edges) {
    if (!adj[e.from] || !adj[e.to]) continue;
    adj[e.from].set(e.to, (adj[e.from].get(e.to) || 0) + 1);
    adj[e.to].set(e.from, (adj[e.to].get(e.from) || 0) + 1);
  }

  // Run Louvain at fine resolution to get many small communities
  // Then merge bottom-up with a max-size constraint for balanced clusters
  let best = louvain(nodeIds, edges, 1.5);

  // Max nodes per cluster — prevents one cluster swallowing everything
  var maxClusterSize = Math.max(15, Math.ceil(nodeIds.length / targetMin));

  // Iteratively merge the two most-connected clusters until within target range
  let count = countCommunities(best);
  while (count > targetMax) {
    best = mergeMostConnectedPair(best, adj, maxClusterSize);
    var newCount = countCommunities(best);
    if (newCount === count) break; // can't merge further without exceeding max size
    count = newCount;
  }

  // Merge remaining singletons (1 node) into nearest cluster
  best = mergeSmallClusters(best, adj, 2);

  return best;
}

function mergeSmallClusters(community, adj, minSize) {
  const result = { ...community };
  const clusters = {};
  for (const id in result) {
    const c = result[id];
    if (!clusters[c]) clusters[c] = [];
    clusters[c].push(id);
  }

  // Find small clusters and merge each into the large cluster they're most connected to
  for (const c in clusters) {
    if (clusters[c].length >= minSize) continue;

    // Count edges from this cluster's nodes to each other cluster
    const crossEdges = {};
    for (const nodeId of clusters[c]) {
      for (const [neighbor, w] of (adj[nodeId] || new Map())) {
        const nc = result[neighbor];
        if (nc === c) continue; // same cluster
        if (!clusters[nc] || clusters[nc].length < minSize) continue; // don't merge into another small cluster
        crossEdges[nc] = (crossEdges[nc] || 0) + w;
      }
    }

    // Find the most-connected large cluster
    let bestTarget = null, bestWeight = 0;
    for (const tc in crossEdges) {
      if (crossEdges[tc] > bestWeight) {
        bestWeight = crossEdges[tc];
        bestTarget = tc;
      }
    }

    if (bestTarget) {
      for (const nodeId of clusters[c]) result[nodeId] = bestTarget;
      if (!clusters[bestTarget]) clusters[bestTarget] = [];
      clusters[bestTarget].push(...clusters[c]);
      delete clusters[c];
    }
  }

  return result;
}

function mergeMostConnectedPair(community, adj, maxSize) {
  const result = { ...community };
  const clusters = {};
  for (const id in result) {
    const c = result[id];
    if (!clusters[c]) clusters[c] = [];
    clusters[c].push(id);
  }

  // Count cross-cluster edge weights, skip pairs that would exceed maxSize
  const clusterIds = Object.keys(clusters);
  let bestA = null, bestB = null, bestWeight = -1;

  for (let i = 0; i < clusterIds.length; i++) {
    for (let j = i + 1; j < clusterIds.length; j++) {
      // Skip if merged cluster would be too large
      if (maxSize && clusters[clusterIds[i]].length + clusters[clusterIds[j]].length > maxSize) continue;

      let w = 0;
      for (const nodeId of clusters[clusterIds[i]]) {
        for (const [neighbor, ew] of (adj[nodeId] || new Map())) {
          if (result[neighbor] === clusterIds[j]) w += ew;
        }
      }
      if (w > bestWeight) {
        bestWeight = w;
        bestA = clusterIds[i];
        bestB = clusterIds[j];
      }
    }
  }

  // Merge B into A (keep the larger one's ID)
  if (bestA && bestB) {
    const keepId = clusters[bestA].length >= clusters[bestB].length ? bestA : bestB;
    const mergeId = keepId === bestA ? bestB : bestA;
    for (const nodeId of clusters[mergeId]) result[nodeId] = keepId;
  }

  return result;
}

function countCommunities(community) {
  return new Set(Object.values(community)).size;
}

// ─── Build sub-hierarchy within a cluster using containment verbs ───
function buildIntraClusterHierarchy(clusterNodeIds, edges, degree) {
  // Find containment edges within this cluster
  const clusterSet = new Set(clusterNodeIds);
  const childOf = {}; // childId → parentId

  for (const e of edges) {
    if (!clusterSet.has(e.from) || !clusterSet.has(e.to)) continue;
    if (!isContainmentVerb(e.verb)) continue;

    // "A contains B" → B is child of A
    const verb = (e.verb || '').toLowerCase();
    let parent, child;
    if (/\b(part.?of|component)\b/.test(verb)) {
      // "B is part of A" → B is child of A
      parent = e.to;
      child = e.from;
    } else {
      // "A contains B" → B is child of A
      parent = e.from;
      child = e.to;
    }

    // Don't override if child already has a parent, prefer higher-degree parent
    if (childOf[child] && (degree[childOf[child]] || 0) >= (degree[parent] || 0)) continue;
    // Don't create cycles
    if (childOf[parent] === child) continue;
    childOf[child] = parent;
  }

  // Break any remaining cycles (shouldn't happen but safety)
  for (const child in childOf) {
    const visited = new Set();
    let cur = child;
    while (childOf[cur]) {
      if (visited.has(cur)) { delete childOf[cur]; break; }
      visited.add(cur);
      cur = childOf[cur];
    }
  }

  return childOf;
}

// ─── Main export: generate hierarchy from graph structure ───
export function generateConceptHierarchyLouvain(nodeList, edgeList) {
  if (!nodeList || nodeList.length < 6) return null;

  const nodeIds = nodeList.map(n => n.id);
  const nodeMap = {};
  for (const n of nodeList) nodeMap[n.id] = n;

  // Compute degree
  const degree = {};
  for (const id of nodeIds) degree[id] = 0;
  for (const e of edgeList) {
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to] = (degree[e.to] || 0) + 1;
  }

  // Only cluster nodes that have edges
  const connectedIds = nodeIds.filter(id => (degree[id] || 0) > 0);
  if (connectedIds.length < 4) return null;

  // Run Louvain with resolution tuning for 3-8 clusters
  const community = louvainWithResolution(connectedIds, edgeList, 3, 8);

  // Group nodes by community
  const clusters = {}; // communityId → [nodeId, ...]
  for (const id of connectedIds) {
    const c = community[id];
    if (!clusters[c]) clusters[c] = [];
    clusters[c].push(id);
  }

  // Remove singleton clusters (those nodes become orphans)
  for (const c in clusters) {
    if (clusters[c].length < 2) delete clusters[c];
  }

  // Build tree
  const tree = [];
  const usedIds = new Set();

  for (const c in clusters) {
    const members = clusters[c];

    // Find root: highest-degree node in the cluster
    let rootId = members[0];
    let rootDeg = degree[rootId] || 0;
    for (const id of members) {
      if ((degree[id] || 0) > rootDeg) {
        rootDeg = degree[id] || 0;
        rootId = id;
      }
    }

    // Build intra-cluster containment hierarchy
    const childOf = buildIntraClusterHierarchy(members, edgeList, degree);

    // Build tree node recursively (max depth 3)
    function buildNode(id, depth) {
      if (usedIds.has(id)) return null;
      usedIds.add(id);
      const n = nodeMap[id];
      const node = { id, label: n ? n.label : id };

      if (depth < 3) {
        // Find children: nodes whose parent is this node
        const children = members.filter(kid =>
          childOf[kid] === id && !usedIds.has(kid)
        );
        if (children.length > 0) {
          node.children = children
            .map(kid => buildNode(kid, depth + 1))
            .filter(Boolean);
        }
      }
      return node;
    }

    // Start tree from root
    const rootNode = buildNode(rootId, 0);
    if (!rootNode) continue;

    // Attach remaining unparented members as direct children of root
    const remainingMembers = members.filter(id => !usedIds.has(id));
    if (!rootNode.children) rootNode.children = [];
    for (const id of remainingMembers) {
      const child = buildNode(id, 1);
      if (child) rootNode.children.push(child);
    }

    // Only add containers with children
    if (rootNode.children && rootNode.children.length > 0) {
      tree.push(rootNode);
    }
  }

  // Sort containers by size (largest first)
  tree.sort((a, b) => {
    const sizeA = (a.children ? a.children.length : 0);
    const sizeB = (b.children ? b.children.length : 0);
    return sizeB - sizeA;
  });

  if (tree.length === 0) return null;

  // Log cluster info
  console.log('  Louvain clusters: ' + tree.length + ' containers');
  for (const t of tree) {
    const childCount = t.children ? t.children.length : 0;
    const grandchildren = (t.children || []).reduce((sum, c) => sum + (c.children ? c.children.length : 0), 0);
    const info = grandchildren > 0 ? childCount + ' children, ' + grandchildren + ' grandchildren' : childCount + ' children';
    console.log('    ' + t.label + ': ' + info);
  }

  return { tree };
}
