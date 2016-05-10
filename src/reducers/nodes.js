const config = require('config').default;

import R from 'ramda';

import logError from './../_utils/logError';

import {
  ADD_CHILD,
  ADD_CHILDREN,
  ADD_CONTOUR,
  ADD_CURVE,
  ADD_FONT,
  ADD_GLYPH,
  ADD_OFFCURVE,
  ADD_ONCURVE,
  ADD_PARAM,
  ADD_PATH,
  CREATE_CONTOUR,
  CREATE_CURVE,
  CREATE_FONT,
  CREATE_GLYPH,
  CREATE_NODE,
  CREATE_OFFCURVE,
  CREATE_ONCURVE,
  CREATE_PATH,
  DELETE_NODE,
  DELETE_PROPS_META,
  LOAD_NODES,
  MOVE_NODE,
  REMOVE_CHILD,
  // SET_COORDS,
  // SET_MOUSE_STATE,
  // SET_NODE_HOVERED,
  // SET_NODE_SELECTED,
  // SET_PATH_HOVERED,
  // SET_PATH_SELECTED,
  UPDATE_COORDS,
  UPDATE_PARAM,
  UPDATE_PARAM_META,
  // UPDATE_PARAM_VALUE,
  UPDATE_PROP,
  UPDATE_PROP_META,
  // UPDATE_PROP_VALUE,
  UPDATE_PROPS,
  // UPDATE_PROPS_VALUES,
  UPDATE_X,
  UPDATE_Y,

  ONCURVE_SMOOTH
} from './../actions/const';

import {
  validateAddChildren,
  validateUpdateProps,
  validateGraph,
  validateAddParam
} from './_nodesValidateActions';

import {
  getNode,
  getNextNode,
  getPreviousNode,
  getCorrespondingHandles
} from '../_utils/path';

import {
  getAllDescendants
} from '../_utils/graph';

/* Define your initial state here.
 *
 * If you change the type from object to something else, do not forget to update
 * src/container/App.js accordingly.
 */
const initialState = {};
const initialNode = {};

function createNode(action) {
  const { nodeId, nodeType, props } = action;

  return {
    id: nodeId,
    type: nodeType,
    childIds: [],
    ...props
  }
}

function initParams(node) {
  return {
    ...node,
    params: {},
    paramsMeta: { _order: [] }
  }
}

function childIds(state, action) {
  switch(action.type.split('_')[0]) {
    case 'ADD':
      return action.childIds ?
        [...state, ...action.childIds ] :
        [...state, action.childId ];

    case 'REMOVE':
      return action.childIds ?
        state.filter((id) => !(action.childIds.includes(id))) :
        state.filter((id) => id !== action.childId);

    default:
      return state;
  }
}

function node(state = initialNode, action) {
  const { type } = action;

  switch(type) {
    case CREATE_NODE:
    case CREATE_CONTOUR:
    case CREATE_PATH:
    case CREATE_ONCURVE:
    case CREATE_OFFCURVE:
      return createNode(action);
    case CREATE_FONT:
    case CREATE_GLYPH:
      return initParams(createNode(action));

    case ADD_CHILD:
    case ADD_CHILDREN:
    case REMOVE_CHILD:
    case ADD_FONT:
    case ADD_GLYPH:
    case ADD_CONTOUR:
    case ADD_PATH:
    case ADD_CURVE:
    case ADD_ONCURVE:
    case ADD_OFFCURVE:
      return { ...state, childIds: childIds(state.childIds, action) };

    case ADD_PARAM:
      // do nothing if a param with the same name already exists
      return state.paramsMeta && action.name in state.paramsMeta ? state : {
        ...state,
        params: {
          ...state.params,
          [action.name]: action.value
        },
        paramsMeta: {
          ...state.paramsMeta,
          _order: [ ...state.paramsMeta._order, action.name ],
          // We remove the updater function from state.nodes, but note that
          // .params and .refs are duplicated in state.updaters
          [action.name]: R.dissoc('updater', action.meta)
        }
      };
    case UPDATE_PARAM:
      return { ...state, params: { ...state.params, [action.name]: action.value } };
    case UPDATE_PARAM_META:
      return {
        ...state,
        paramsMeta: {
          ...state.paramsMeta,
          [action.name]: {
            ...state.paramsMeta[action.name],
            // We remove the updater function from state.nodes, but note that
            // .params and .refs are duplicated in state.updaters
            ...R.dissoc('updater', action.meta)
          }
        }
      };

    case UPDATE_X:
      return { ...state, x: action.value };
    case UPDATE_Y:
      return { ...state, y: action.value };
    case UPDATE_COORDS:
      return { ...state, x: action.coords.x, y: action.coords.y };
    case UPDATE_PROP:
      return { ...state, [action.propNames[0]]: action.value };
    case UPDATE_PROPS:
      return { ...state, ...action.props };
    case UPDATE_PROP_META:
      return {
        ...state,
        [action.propNames[0] + 'Meta']: {
          _for: action.propNames[0],
          ...state[action.propNames[0] + 'Meta'],
          // We remove the updater function from state.nodes, but note that
          // .params and .refs are duplicated in state.updaters
          ...R.dissoc('updater', action.meta)
        }
      };
    // TODO: is this reducer really used? Is it tested? It's badly named anyway
    // it should be DELETE_PROP_META
    case DELETE_PROPS_META:
      return R.dissoc(action.propNames[0] + 'Meta', state);
    // case UPDATE_PROP_VALUE:
    //   return R.mergeWith(R.merge, state, { [action.propNames[0]]: { value: action.value } });
    // case UPDATE_PROPS_VALUES:
    //   return R.mergeWith(R.merge,
    //     state,
    //     R.mapObjIndexed((value) => { return {value}; }, action.values)
    //   );
    default:
      return state;
  }
}

function deleteMany(state, ids) {
  state = Object.assign({}, state);
  ids.forEach(id => delete state[id]);
  return state;
}

function deepPositionUpdate(node, nodes, x=0, y=0, result) {
  const type = node.type;

  if (type === 'oncurve' || type === 'offcurve') {
    result[node.id] = {
      ...node,
      x: node.x + x,
      y: node.y + y
    }
  } else {
    node.childIds.forEach((childId) => {
      const target = nodes[childId];
      deepPositionUpdate(target, nodes, x, y, result);
    });
  }
}

export default function(state = initialState, action) {
  const { type, nodeId, parentId, nodeIds } = action;

  if (
    typeof type === 'undefined' ||
    (type !== 'LOAD_NODES' &&
    ( typeof nodeId === 'undefined' && typeof nodeIds === 'undefined' ))
  ) {
    return state;
  }

  // During dev, we're verifying that the UI prevents impossible actions
  // such as adding a font to a glyph or updating the coordinates of a non-point
  if ( config.appEnv === 'dev' ) {
    if ( /^ADD_/.test(type) && ( 'childId' in action || 'childIds' in action ) ) {
      logError( validateAddChildren(state, action) );
      logError( validateGraph(state, action) );
    }

    if ( /^UPDATE_/.test(type) && 'propNames' in action ) {
      logError( validateUpdateProps(state, action) );
    }

    if ( /^ADD_PARAM$/.test(type) ) {
      logError( validateAddParam(state, action) );
    }
  }

  switch (type) {
    case DELETE_NODE:
      const descendantIds = Object.keys(getAllDescendants(state, nodeId));
      return deleteMany(state, [ nodeId, ...descendantIds ]);

    case CREATE_CURVE:
      const nodes = {};
      nodeIds.forEach((nodeId, i) => {
        nodes[nodeId] = createNode({
          nodeId,
          nodeType: i === 2 ? 'oncurve' : 'offcurve'
        });
      });
      return R.merge(state, nodes);

    case MOVE_NODE:
      const path = state[nodeId];
      const type = path.type;
      if ( type === 'oncurve') {
        const nodesToMove = getNode(parentId, nodeId, state);
        const resultNode = {};
        nodesToMove.forEach((node) => {
          if (node !== null) {
            const newNode = { ...node };
            newNode.x = (newNode.x || 0) + action.dx;
            newNode.y = (newNode.y || 0) + action.dy;
            if (newNode._isGhost) {
              newNode._isGhost = false;
            }
            resultNode[newNode.id] = newNode;
          }
        });

        const [nextOn, nextIn] = getNextNode(parentId, nodeId, state);
        if (nextIn) {
          resultNode[nextIn.id] = { ...nextIn, _isGhost: false};
        }

        const [prevOn, prevIn , prevOut] = getPreviousNode(parentId, nodeId, state);
        if (prevOut) {
          resultNode[prevOut.id] = { ...prevOut, _isGhost: false};
        }
        return {...state, ...resultNode};
      } else if ( type === 'offcurve') {
        const nodesToMove = getCorrespondingHandles(parentId, nodeId, state);
        const result = {...state,
          [nodeId]: {...state[nodeId], x: path.x + action.dx, y: path.y + action.dy}
        };
        if (nodesToMove[2].state === ONCURVE_SMOOTH) {
          const oppositeNode = nodeId === nodesToMove[1].id ? nodesToMove[0] : nodesToMove[1];
          if (oppositeNode) {
            result[oppositeNode.id] = {...state[oppositeNode.id], x: oppositeNode.x - action.dx, y: oppositeNode.y - action.dy, _isGhost: false};
          }
        }
        return result;
      } else {
        const result = {};
        deepPositionUpdate(path, state, action.dx, action.dy, result);
        return {...state, ...result};
      }

    case LOAD_NODES:
        return action.nodes;

    default:
      return R.merge(state, { [nodeId]: node( state[nodeId], action ) });
  }
}
