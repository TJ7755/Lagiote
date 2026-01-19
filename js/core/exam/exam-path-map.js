/**
 * Exam Path Map - Topic Navigation Component
 * 
 * Provides a Duolingo-style path map for navigating topics and tracking progress.
 * Shows cluster nodes representing topics/techniques with readiness, coverage,
 * and fragility indicators.
 */

import { computeEffectiveMasteryMap, clamp01 } from './atom-dynamics.js';

/**
 * Creates a path node from a cluster of atoms.
 * @param {Object} params Node parameters
 * @returns {Object} Path node
 */
export function createPathNode({
    id,
    name,
    type = 'topic',
    atomIds = [],
    prerequisites = [],
    position = { x: 0, y: 0 },
    metadata = {}
} = {}) {
    return {
        id: id || crypto.randomUUID(),
        name,
        type, // 'topic', 'technique', 'representation', 'checkpoint'
        atomIds: Array.isArray(atomIds) ? atomIds : [],
        prerequisites: Array.isArray(prerequisites) ? prerequisites : [],
        position: {
            x: Number(position?.x) || 0,
            y: Number(position?.y) || 0
        },
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        isLocked: false,
        isCompleted: false
    };
}

/**
 * Computes readiness and progress metrics for a path node.
 * @param {Object} node The path node
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} targetDate Target exam date
 * @returns {Object} Node metrics
 */
export function computeNodeMetrics(node, atomsById, nowDate, targetDate) {
    const atomIds = node.atomIds || [];
    
    if (!atomIds.length) {
        return {
            readiness: 0,
            coverage: 0,
            fragility: 0,
            averageMastery: 0,
            atomCount: 0,
            weakAtomCount: 0,
            strongAtomCount: 0
        };
    }
    
    const masteryMap = computeEffectiveMasteryMap(atomsById, nowDate, targetDate);
    
    let totalMastery = 0;
    let totalFragility = 0;
    let coveredCount = 0;
    let weakCount = 0;
    let strongCount = 0;
    
    for (const atomId of atomIds) {
        const atom = atomsById instanceof Map
            ? atomsById.get(atomId)
            : atomsById?.[atomId];
        
        if (!atom) continue;
        
        const result = masteryMap.get(atomId);
        const effective = result?.effective ?? 0;
        
        totalMastery += effective;
        totalFragility += atom.fragility ?? 0.5;
        
        if (effective > 0.2) coveredCount++;
        if (effective < 0.4) weakCount++;
        if (effective >= 0.7) strongCount++;
    }
    
    const atomCount = atomIds.length;
    const averageMastery = atomCount > 0 ? totalMastery / atomCount : 0;
    const averageFragility = atomCount > 0 ? totalFragility / atomCount : 0;
    const coverage = atomCount > 0 ? coveredCount / atomCount : 0;
    
    // Readiness is mastery adjusted for fragility
    const readiness = clamp01(averageMastery * (1 - averageFragility * 0.3));
    
    return {
        readiness,
        coverage,
        fragility: averageFragility,
        averageMastery,
        atomCount,
        weakAtomCount: weakCount,
        strongAtomCount: strongCount
    };
}

/**
 * Checks if a node's prerequisites are met.
 * @param {Object} node The path node
 * @param {Array} allNodes All path nodes
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} targetDate Target exam date
 * @param {number} threshold Minimum readiness to unlock
 * @returns {Object} Lock status
 */
export function checkNodeLocked(node, allNodes, atomsById, nowDate, targetDate, threshold = 0.3) {
    const prereqs = node.prerequisites || [];
    
    if (!prereqs.length) {
        return { locked: false, reason: null, unmetPrereqs: [] };
    }
    
    const unmet = [];
    
    for (const prereqId of prereqs) {
        const prereqNode = allNodes.find(n => n.id === prereqId);
        if (!prereqNode) continue;
        
        const metrics = computeNodeMetrics(prereqNode, atomsById, nowDate, targetDate);
        if (metrics.readiness < threshold) {
            unmet.push({
                nodeId: prereqId,
                nodeName: prereqNode.name,
                readiness: metrics.readiness,
                required: threshold
            });
        }
    }
    
    return {
        locked: unmet.length > 0,
        reason: unmet.length > 0 ? 'prerequisites_not_met' : null,
        unmetPrereqs: unmet
    };
}

/**
 * Creates a complete path map from topics/atoms.
 * @param {Object} params Map parameters
 * @returns {Object} Path map
 */
export function createPathMap({
    id,
    name = 'Learning Path',
    nodes = [],
    layout = 'vertical',
    metadata = {}
} = {}) {
    return {
        id: id || crypto.randomUUID(),
        name,
        nodes: Array.isArray(nodes) ? nodes : [],
        layout, // 'vertical', 'horizontal', 'graph'
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Generates a path map from atom groupings.
 * Groups atoms by their tags or type to create nodes.
 * 
 * @param {Array} atoms Array of atoms
 * @param {Object} options Generation options
 * @returns {Object} Generated path map
 */
export function generatePathMapFromAtoms(atoms, options = {}) {
    const groupBy = options.groupBy || 'tags';
    const groups = new Map();
    
    for (const atom of atoms) {
        if (atom?.isDeleted) continue;
        
        let groupKey;
        if (groupBy === 'tags') {
            const tags = atom.tags || [];
            groupKey = tags[0] || 'Uncategorised';
        } else if (groupBy === 'type') {
            groupKey = atom.type || 'knowledge';
        } else {
            groupKey = 'All';
        }
        
        if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
        }
        groups.get(groupKey).push(atom.id);
    }
    
    const nodes = [];
    let yPosition = 0;
    
    for (const [groupName, atomIds] of groups) {
        nodes.push(createPathNode({
            name: groupName,
            type: 'topic',
            atomIds,
            position: { x: 0, y: yPosition }
        }));
        yPosition += 100;
    }
    
    return createPathMap({
        name: options.name || 'Learning Path',
        nodes,
        layout: 'vertical'
    });
}

/**
 * Computes metrics for all nodes in a path map.
 * @param {Object} pathMap The path map
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} targetDate Target exam date
 * @returns {Map} Map of node ID to metrics
 */
export function computePathMapMetrics(pathMap, atomsById, nowDate, targetDate) {
    const metricsMap = new Map();
    const nodes = pathMap.nodes || [];
    
    for (const node of nodes) {
        const metrics = computeNodeMetrics(node, atomsById, nowDate, targetDate);
        const lockStatus = checkNodeLocked(node, nodes, atomsById, nowDate, targetDate);
        
        metricsMap.set(node.id, {
            ...metrics,
            ...lockStatus,
            isCompleted: metrics.readiness >= 0.8
        });
    }
    
    return metricsMap;
}

/**
 * Gets recommended next nodes to practice.
 * @param {Object} pathMap The path map
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} targetDate Target exam date
 * @param {number} count Number of recommendations
 * @returns {Array} Recommended nodes with reasons
 */
export function getRecommendedNodes(pathMap, atomsById, nowDate, targetDate, count = 3) {
    const metricsMap = computePathMapMetrics(pathMap, atomsById, nowDate, targetDate);
    const nodes = pathMap.nodes || [];
    
    // Score each node
    const scored = nodes
        .filter(node => {
            const m = metricsMap.get(node.id);
            return !m?.locked && !m?.isCompleted;
        })
        .map(node => {
            const m = metricsMap.get(node.id);
            
            // Value = gap to mastery * fragility penalty * coverage bonus
            const masteryGap = 1 - (m?.readiness || 0);
            const fragilityPenalty = 1 + (m?.fragility || 0) * 0.5;
            const coverageBonus = 1 + (1 - (m?.coverage || 0)) * 0.3;
            
            const value = masteryGap * fragilityPenalty * coverageBonus;
            
            let reason;
            if (m?.fragility > 0.6) {
                reason = 'High fragility - needs varied practice';
            } else if (m?.coverage < 0.5) {
                reason = 'Low coverage - needs more exposure';
            } else if (m?.readiness < 0.4) {
                reason = 'Low readiness - needs strengthening';
            } else {
                reason = 'Good candidate for progress';
            }
            
            return {
                node,
                metrics: m,
                value,
                reason
            };
        });
    
    scored.sort((a, b) => b.value - a.value);
    
    return scored.slice(0, count);
}

/**
 * Renders the path map as HTML.
 * @param {Object} pathMap The path map
 * @param {Map} metricsMap Node metrics map
 * @returns {string} HTML string
 */
export function renderPathMapHTML(pathMap, metricsMap) {
    const nodes = pathMap.nodes || [];
    
    return `
        <div class="path-map" data-layout="${pathMap.layout || 'vertical'}">
            <header class="path-map-header">
                <h2>${pathMap.name}</h2>
            </header>
            <div class="path-map-nodes">
                ${nodes.map(node => {
                    const m = metricsMap?.get(node.id) || {};
                    const statusClass = m.locked ? 'locked' : (m.isCompleted ? 'completed' : 'active');
                    const readinessPercent = Math.round((m.readiness || 0) * 100);
                    
                    return `
                        <div class="path-node ${statusClass}" 
                             data-node-id="${node.id}"
                             style="--node-x: ${node.position?.x || 0}px; --node-y: ${node.position?.y || 0}px;">
                            <div class="path-node-icon">
                                ${getNodeIcon(node.type, statusClass)}
                            </div>
                            <div class="path-node-content">
                                <span class="path-node-name">${node.name}</span>
                                <div class="path-node-progress">
                                    <div class="progress-bar">
                                        <div class="progress-fill" style="width: ${readinessPercent}%"></div>
                                    </div>
                                    <span class="progress-text">${readinessPercent}%</span>
                                </div>
                                ${m.fragility > 0.6 ? '<span class="fragility-warning">Needs practice</span>' : ''}
                            </div>
                            ${m.locked ? `
                                <div class="path-node-lock">
                                    <span class="lock-icon">Locked</span>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function getNodeIcon(type, status) {
    const icons = {
        topic: 'T',
        technique: 'X',
        representation: 'R',
        checkpoint: 'C'
    };
    
    const statusIndicator = status === 'completed' ? '[Done]' : (status === 'locked' ? '[Locked]' : '');
    return `<span class="node-icon-letter">${icons[type] || 'T'}</span>${statusIndicator}`;
}

/**
 * Gets the CSS styles for the path map.
 * @returns {string} CSS styles
 */
export function getPathMapStyles() {
    return `
        .path-map {
            padding: 20px;
        }
        
        .path-map-header {
            margin-bottom: 20px;
        }
        
        .path-map-header h2 {
            margin: 0;
            font-size: 1.5rem;
        }
        
        .path-map-nodes {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        
        .path-map[data-layout="horizontal"] .path-map-nodes {
            flex-direction: row;
            flex-wrap: wrap;
        }
        
        .path-node {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px;
            background: var(--card-bg);
            border-radius: 12px;
            box-shadow: 0 2px 4px var(--shadow-color);
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: pointer;
        }
        
        .path-node:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px var(--shadow-color);
        }
        
        .path-node.locked {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .path-node.completed {
            border-left: 4px solid var(--success-color);
        }
        
        .path-node.active {
            border-left: 4px solid var(--primary-color);
        }
        
        .path-node-icon {
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--input-bg);
            border-radius: 50%;
            font-weight: 600;
            font-size: 1.25rem;
            color: var(--primary-color);
        }
        
        .path-node.completed .path-node-icon {
            background: var(--success-color);
            color: white;
        }
        
        .path-node.locked .path-node-icon {
            background: var(--border-color);
            color: var(--secondary-text);
        }
        
        .path-node-content {
            flex: 1;
        }
        
        .path-node-name {
            display: block;
            font-weight: 500;
            margin-bottom: 8px;
        }
        
        .path-node-progress {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .progress-bar {
            flex: 1;
            height: 8px;
            background: var(--input-bg);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: var(--primary-color);
            transition: width 0.3s ease;
        }
        
        .path-node.completed .progress-fill {
            background: var(--success-color);
        }
        
        .progress-text {
            font-size: 0.875rem;
            color: var(--secondary-text);
            min-width: 40px;
        }
        
        .fragility-warning {
            display: inline-block;
            margin-top: 5px;
            font-size: 0.75rem;
            color: var(--danger-color);
        }
        
        .path-node-lock {
            display: flex;
            align-items: center;
            padding: 5px 10px;
            background: var(--border-color);
            border-radius: 4px;
            font-size: 0.75rem;
            color: var(--secondary-text);
        }
    `;
}

export default {
    createPathNode,
    computeNodeMetrics,
    checkNodeLocked,
    createPathMap,
    generatePathMapFromAtoms,
    computePathMapMetrics,
    getRecommendedNodes,
    renderPathMapHTML,
    getPathMapStyles
};
