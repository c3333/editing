// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

editing.defineCommand('InsertOrderedList', (function() {
  'use strict';

  /**
   * @param {!Node} node
   * @return boolean
   */
  function isBreakElement(node) {
    return node.nodeType === Node.ELEMENT_NODE &&
      (node.nodeName === 'BR' || node.nodeName === 'WBR');
  }

  /**
   * @param {!Node} node
   * @return boolean
   */
  function isPhrasingElement(node) {
    // TODO(hajimehoshi)
    return node.nodeType === Node.ELEMENT_NODE &&
      editing.dom.isPhrasing(node);
  }

  /**
   * @param {!Node} node
   * @return boolean
   */
  function isListMergeableContainer(node) {
    // TODO(hajimehoshi): Add grouping tags here
    var name = node.nodeName;
    return name === 'P' || name === 'BLOCKQUOTE';
  }

  /**
   * @param {!Node} node
   * @return boolean
   */
  function isTableCell(node) {
    var name = node.nodeName;
    return name === 'TR' || name === 'TD' || name === 'TH' ||
      name === 'COLGROUP' || name === 'TBODY' || name === 'THEAD';
  }

  /**
   * @param {!Node} node
   * @return boolean
   */
  function isContainer(node) {
    return isTableCell(node) || isListMergeableContainer(node);
  }

  /**
   * @param {!NodeList|!Array.<!Node>} nodes
   * @return {!Array.<!Node>}
   */
  function getListItemCandidates(nodes) {
    /**
     * @param {!Node} node
     * @return {!Array.<!Node>}
     */
    function getChildListItemCandidates(node) {
      if (!isContainer(node))
        return [node];
      return Array.prototype.reduce.call(
        node.childNodes, function(nodes, node) {
          return nodes.concat(getChildListItemCandidates(node));
        }, []);
    }

    if (!nodes.length)
      return [];
    return Array.prototype.filter.call(nodes, function(node) {
      for (var ancestor of editing.dom.ancestors(node)) {
        if (Array.prototype.indexOf.call(nodes, ancestor) !== -1)
          return false;
      }
      return true;
    }).reduce(function(nodes, node) {
      return nodes.concat(getChildListItemCandidates(node));
    }, []);
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Node} parent
   * @param {!Node} node
   * @param {Node} ref
   */
  function insertChildNodesBefore(context, parent, node, ref) {
    var child = null;
    while (child = node.firstChild)
      context.insertBefore(parent, child, ref);
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Node} node
   * @param {string} name
   * @return {!Node}
   */
  function replaceNodeName(context, node, name) {
    console.assert(node.parentNode);
    var newNode = context.createElement(name);
    insertChildNodesBefore(context, newNode, node, null);
    // TODO(hajimehoshi): Copy attributes?
    var parent = /** @type {!Node} */(node.parentNode);
    context.replaceChild(parent, newNode, node);
    return newNode;
  }

  /**
   * @param {!Node} node
   * @return {boolean}
   */
  function isList(node) {
    var name = node.nodeName;
    return editing.dom.isElement(node) && (name === 'OL' || name === 'UL');
  }

  /**
   * @param {!Node} node
   * @return {boolean}
   */
  function isListItem(node) {
    return node.nodeName === 'LI';
  }

  /**
   * @param {!Node} node
   * @return {boolean}
   *
   * Returns true if |node| can be treated as a list item even if |node| is not
   * a <li>. See w3c.24 and w3c.25.
   */
  function canContentOfDL(node) {
    var name = node.nodeName;
    return name === 'DD' || name === 'DT';
  }

  /**
   * @param {!Node} node
   * @return {boolean}
   */
  function isInList(node) {
    for (var currentNode = node.parentNode; currentNode;
         currentNode = currentNode.parentNode) {
      if (isList(currentNode))
        return true;
    }
    return false;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Array.<!Node>} nodes
   * @return {Element} list
   *
   * Creates a new list and makes |nodes| a list item belonging to the list.
   */
  function listify(context, nodes) {
    if (!nodes.length)
      return null;

    var list = context.createElement('OL');
    var listItem = context.createElement('LI');

    context.appendChild(list, listItem);
    var firstNode = nodes[0];
    var parentNode = /** @type {!Element} */(firstNode.parentNode);
    console.assert(parentNode);
    context.replaceChild(parentNode, list, firstNode);

    for (var node of nodes)
      context.appendChild(listItem, node);

    return list;
  }

  /**
   * @param {!Node} node
   * @param {function(!Node):boolean} predicate
   * @return {Node}
   */
  function firstSelfOrAncestor(node, predicate) {
    if (predicate(node))
      return node;
    var ancestors = editing.dom.ancestorsWhile(node, function(node) {
      return !predicate(node)
    });
    if (!ancestors.length)
      return node.parentNode;
    return ancestors[ancestors.length - 1].parentNode;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Element} listItemNode
   * @return {{first: !Element, second: !Element}}
   *
   * Splits the list at |listItemNode| and returns the two lists.
   */
  function splitList(context, listItemNode) {
    console.assert(isListItem(listItemNode));
    var listNode = listItemNode.parentNode;
    console.assert(listNode && isList(listNode));

    // Separate |listNode| into |firstList| and |secondList|.
    var firstList = /** @type {!Element} */(listNode);
    var secondList = context.createElement(listNode.nodeName);
    // TODO(hajimehoshi): Copy other attributes?
    if (firstList.hasAttribute('style')) {
      context.setAttribute(secondList, 'style',
                           firstList.getAttribute('style'));
    }
    context.insertAfter(listNode.parentNode, secondList, firstList);
    
    // TOOD(hajimehoshi): Use nextSiblingsWhile in the future.
    var siblings = [];
    for (var node = listItemNode.nextSibling; node; node = node.nextSibling)
      siblings.push(node);
    for (var node of siblings)
      context.appendChild(secondList, node);
    context.insertBefore(secondList.parentNode, listItemNode, secondList);

    return {
      first: firstList,
      second: secondList,
    };
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Node} originalNode
   * @param {!Array.<!Node>} effectiveNodes
   */
  function unlistify(context, originalNode, effectiveNodes) {
    var listItemNode = /** @type {!Element} */(
      firstSelfOrAncestor(originalNode, function(node) {
        return isListItem(node);
      }));
    if (!listItemNode)
      return;

    // Unlistify the inner lists recursively. See w3c.58. Actual unlistifying
    // the child lists will be executed after unlistifying |listItemNode|.
    var childLists = Array.prototype.filter.call(
      listItemNode.childNodes, function(node) {
        // TODO(hajimehoshi): Consider the case when |node| is <ul>.
        if (node.nodeName !== 'OL')
          return false;
        return effectiveNodes.indexOf(node) !== -1;
      });

    var lists = splitList(context, listItemNode);
    var firstList = lists.first;
    var secondList = lists.second;

    // If the new list item is NOT in the outer list, get the content out of
    // the <li> and remove the <li>.
    //
    // NOTE: Even when the new list item's parent is a <li>, that is, the <li>
    // is in a <li>, it is treated as if it was in a list. See w3c.40.
    if (!listItemNode.parentNode || (!isList(listItemNode.parentNode) &&
                                     !isListItem(listItemNode.parentNode))) {
      var isListItemLastChildText = false;
      if (listItemNode.hasChildNodes()) {
        var childNodes = listItemNode.childNodes;
        isListItemLastChildText =
          editing.dom.isText(childNodes[childNodes.length - 1]);
      }
      insertChildNodesBefore(context,
                             /** @type {!Node} */(secondList.parentNode),
                             listItemNode, secondList);
      if (isListItemLastChildText &&
          (secondList.parentNode.lastChild !== secondList ||
           secondList.hasChildNodes())) {
        var br = context.createElement('BR');
        context.insertBefore(secondList.parentNode, br, secondList);
      }
      context.removeChild(listItemNode.parentNode, listItemNode);
      if (!firstList.childNodes.length && firstList.previousSibling &&
          editing.dom.isText(firstList.previousSibling)) {
        var br = context.createElement('BR');
        context.insertBefore(firstList.parentNode, br, firstList);
      }
    }

    if (!firstList.hasChildNodes())
      context.removeChild(firstList.parentNode, firstList);
    if (!secondList.hasChildNodes())
      context.removeChild(secondList.parentNode, secondList);

    // Unlistify recursively.
    for (var listNode of childLists) {
      for (var listItem of Array.prototype.slice.call(listNode.childNodes)) {
        console.assert(isListItem(listItem));
        unlistify(context, listItem, effectiveNodes);
      }
    }
  }

  /**
   * @param {!Element} list
   * @return {!Array.<!Element>}
   */
  function getListsToBeMerged(list) {
    /**
     * @param {!Node} node
     * @return {Node}
     */
    function getPreviousNode(node) {
      if (!node.previousSibling)
        return node.parentNode;
      for (var child = node.previousSibling; child; child = child.lastChild) {
        if (child.nodeName === 'OL')
          return child;
        if (editing.dom.isText(child))
          return child;
        if (!isListMergeableContainer(child) && !canContentOfDL(child))
          return null;
        if (!child.lastChild)
          return child;
      }
      return null;
    }

    /**
     * @param {!Node} node
     * @return {Node}
     */
    function getNextNode(node) {
      if (node !== list && node.firstChild)
        return node.firstChild;
      if (node.nextSibling)
        return node.nextSibling;
      for (var parent of editing.dom.ancestors(node)) {
        if (!isListMergeableContainer(parent) && !canContentOfDL(parent))
          return null;
        if (parent.nextSibling)
          return parent.nextSibling
      }
      return null;
    }

    /**
     * @param {!Node} node
     * @param {function(!Node):Node} getNextNode
     * @return {Node}
     */
    function getNearestNode(node, getNextNode) {
      var runner = node;
      while (runner = getNextNode(runner)) {
        if (runner.nodeName === 'OL')
          return runner;
        if (editing.dom.isText(runner)) {
          // TODO(hajimehoshi): Check the cases when (1) xml:space='preserve' is
          // used or (2) CSS white-space is pre.
          if (editing.dom.isWhitespaceNode(runner))
            continue;
          break;
        }
      }
      return null;
    }

    var result = [list];
    var node = list;

    var previousNode = getNearestNode(node, getPreviousNode);
    if (previousNode)
      result.unshift(previousNode);

    var nextNode = getNearestNode(node, getNextNode);
    if (nextNode)
      result.push(nextNode);

    return result;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!editing.ImmutableSelection} selection
   * @return {!Array.<!Array.<!Node>>}
   */
  function getListItemCandidateGroups(context, selection, effectiveNodes) {
    // If the selection is a caret, select nodes around the caret.
    if (!effectiveNodes.length) {
      var childNodes = selection.startContainer.childNodes;
      if (Array.prototype.every.call(childNodes, function(node) {
        return editing.dom.isText(node) || isPhrasingElement(node);
      })) {
        effectiveNodes = Array.prototype.map.call(childNodes, function(node) {
          return node;
        });
      } else {
        return [];
      }
    }

    // Extend the heading text nodes.
    if (editing.dom.isText(effectiveNodes[0])) {
      for (var sibling = effectiveNodes[0].previousSibling;
           sibling && editing.dom.isText(sibling);
           sibling = sibling.previousSibling) {
        effectiveNodes.unshift(sibling);
      }
    }

    // Extend the tailing text nodes.
    var lastEffectiveNode = effectiveNodes[effectiveNodes.length - 1];
    if (editing.dom.isText(lastEffectiveNode)) {
      for (var sibling = lastEffectiveNode.nextSibling;
           sibling && editing.dom.isText(sibling);
           sibling = sibling.nextSibling) {
        effectiveNodes.push(sibling);
      }
    }

    var lastEffectiveNode = effectiveNodes[effectiveNodes.length - 1];
    if (lastEffectiveNode.nextSibling) {
      effectiveNodes = effectiveNodes.filter(function(node) {
        return !editing.dom.isDescendantOf(lastEffectiveNode, node);
      });
    }

    // Devide the top nodes into groups: the successive text nodes should be in
    // the same group. Otherwise, the node is in a single group.
    var listItemCandidates = getListItemCandidates(effectiveNodes);
    var listItemCandidateGroups = [];
    // TODO(hajimehoshi): Replace for-of after google/closure-compiler#643 is
    // fixed.
    listItemCandidates.forEach(function(node) {
      if (!listItemCandidateGroups.length) {
        listItemCandidateGroups.push([node]);
        return;
      }
      var lastGroup =
        listItemCandidateGroups[listItemCandidateGroups.length - 1];
      if (editing.dom.isText(node)) {
        var lastNode = lastGroup[lastGroup.length - 1];
        if (editing.dom.isText(lastNode) &&
            lastNode === node.previousSibling) {
          lastGroup.push(node);
          return;
        }
      }
      listItemCandidateGroups.push([node]);
    });

    return listItemCandidateGroups;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Element} list
   * @param {!Array.<!Node>} effectiveNodes
   * @return Node
   */
  function processList(context, list, effectiveNodes) {
    /**
     * @param {!Element} list
     * @return boolean
     */
    function isListToBeReplaced(list) {
      if (list.nodeName === 'OL')
        return false;

      // In some special cases, the list is not replaced. See w3c.90,
      // w3c.90.1, w3c.90.2, w3c.92, w3c.96.
      if (list.parentNode && isInList(list.parentNode)) {
        var next = editing.dom.nextNodeSkippingChildren(list);
        if (!next)
          return true;
        if (effectiveNodes.indexOf(next) !== -1)
          return true;
        // |next| can be a generated list by listifying (w3c.92).
        if (isList(next) &&
            Array.prototype.some.call(next.childNodes, function(listItem) {
              return effectiveNodes.indexOf(listItem) !== -1;
            })) {
          return true;
        }
        return false;
      }

      return true;
    }

    if (isListToBeReplaced(list))
      return replaceNodeName(context, list, 'OL'); 
    
    // If |list| is in another list but it is not replaced with another
    // type of list for some reasons, the selected items will be
    // extracted. See w3c.90, w3c.96.
    if (list.parentNode && isInList(list.parentNode)) {
      context.splitTree(/** @type {!Element} */(list.parentNode), list);
      for (var listItem of effectiveNodes.filter(function(node) {
        return Array.prototype.indexOf.call(list.childNodes, node) !== -1;
      })) {
        var insertBefore = list.parentNode;
        context.insertBefore(insertBefore.parentNode, listItem,
                             insertBefore);
      }
      // See w3c.96.
      var followingNodes = [];
      for (var node = list.nextSibling; node; node = node.nextSibling)
        followingNodes.push(node);
      for (var node of followingNodes.reverse()) {
        var outerList = list.parentNode.parentNode;
        context.insertAfter(outerList.parentNode, node, outerList);
      }

      if (!list.hasChildNodes()) {
        var listItem = list.parentNode;
        context.removeChild(list.parentNode, list);
        if (!listItem.hasChildNodes())
          context.removeChild(listItem.parentNode, listItem);
      }
    }
    return null;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Array.<!Node>} nodes
   * @param {!Array.<!Node>} effectiveNodes
   * @return Node
   */
  function processNodeInList(context, nodes, effectiveNodes) {
    // TODO: Refactoring
    var originalNode = nodes[0];
    var listItemNode = /** @type {!Element} */(
      firstSelfOrAncestor(originalNode, function(node) {
        return isListItem(node);
      }));
    var listNode = listItemNode.parentNode;
    if (listNode.nodeName === 'OL') {
      unlistify(context, originalNode, effectiveNodes);
      return null;
    }
    console.assert(listNode.nodeName === 'UL');

    var newList = context.createElement('OL');

    var lists = splitList(context, listItemNode);
    context.appendChild(newList, listItemNode);
    context.insertBefore(lists.second.parentNode, newList, lists.second);

    for (var list of [lists.first, lists.second]) {
      if (!list.hasChildNodes())
        context.removeChild(list.parentNode, list);
    }

    // Copy the ID to the second list if the first list has gone. See
    // w3c.122.
    if (lists.first.id && !lists.first.parentNode &&
        lists.second.parentNode) {
      lists.second.id = lists.first.id;
    }

    // Copy the styles. See w3c.118.
    if (listNode.hasAttribute('style')) {
      var firstItemChanged = !lists.first.parentNode;
      var span = context.createElement('SPAN');
      context.setAttribute(span, 'style', listNode.getAttribute('style'));
      if (firstItemChanged) {
        // If the first item is changed to the list, <span> is applied for
        // the list items. See w3c.123, w3c.124, w3c.125.
        context.insertBefore(originalNode.parentNode, span, originalNode);
        for (var node of nodes)
          context.appendChild(span, node);
      } else {
        context.insertBefore(newList.parentNode, span, newList);
        context.appendChild(span, newList);
      }

      // A <span> for 'text-indent' is specially created. See w3c.120,
      // w3c.120.1, w3c.121.
      if (!firstItemChanged && listNode.style.textIndent) {
        span = context.createElement('SPAN');
        context.setAttribute(span, 'style',
                             'text-indent: ' + listNode.style.textIndent);
        context.insertBefore(originalNode.parentNode, span, originalNode);
        for (var node of nodes)
          context.appendChild(span, node);
      }
    }

    if (isListItem(originalNode))
      return newList;

    // Split the list item and extract outside the selection. See w3c.76.
    if (originalNode.previousSibling &&
        effectiveNodes.indexOf(originalNode.previousSibling) === -1) {
      context.splitTree(listItemNode, originalNode);
      var newListItem = listItemNode;
      insertChildNodesBefore(
        context, /** @type {!Element} */(newList.parentNode), newListItem,
        newList);
      context.removeChild(newList, newListItem);
    }
    var lastNode = nodes[nodes.length - 1];
    if (lastNode.nextSibling &&
        effectiveNodes.indexOf(lastNode.nextSibling) === -1) {
      context.splitTree(listItemNode, lastNode.nextSibling);
      var newListItem = listItemNode.nextSibling;
      var insertAfter = newList;
      var br = null;
      var child = null;
      while (child = newListItem.firstChild) {
        var node = newListItem.firstChild;
        context.insertAfter(newList.parentNode, child, insertAfter);
        insertAfter = node;
        // Insert <br> after the text node. See w3c.76.
        if (node && editing.dom.isText(node)) {
          br = context.createElement('BR');
          context.insertAfter(newList.parentNode, br, insertAfter);
          insertAfter = br;
        }
      }
      // <br> is not needed when it is at the end. See w3c.93.
      if (br && br.parentNode.lastChild === br)
        context.removeChild(br.parentNode, br);
      context.removeChild(newList, newListItem);
    }
    return newList;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!Array.<!Element>} lists
   * @param {!Array.<!Element>} newLists
   * @return {void}
   */
  function mergeLists(context, lists, newLists) {
    /**
     * @param {!editing.EditingContext} context
     * @param {!Array.<!Element>} listNodes
     * @param {number} mainListIndex
     * @return {Element}
     */
    function doMergeLists(context, listNodes, mainListIndex) {
      console.assert(0 <= mainListIndex);
      console.assert(mainListIndex < listNodes.length);

      if (!listNodes.length)
        return null;
      if (listNodes.length === 1)
        return listNodes[0];

      var mainList = listNodes[mainListIndex];
      var mainListFirstChild = mainList.firstChild;
      var parent = mainList.parentNode;
      listNodes.forEach(function(listNode, i) {
        if (i === mainListIndex)
          return;

        console.assert(listNode.nodeName === 'OL');
        // A list item can be <dt> or <dd>. See w3c.24.
        console.assert(Array.prototype.every.call(
          listNode.childNodes, function(node) {
            return isListItem(node) || canContentOfDL(node);
          }));

        if (i < mainListIndex) {
          insertChildNodesBefore(context, mainList, listNode,
                                 mainListFirstChild);
        } else {
          insertChildNodesBefore(context, mainList, listNode, null);
        }
        context.removeChild(listNode.parentNode, listNode);
      });

      return mainList;
    }

    // TODO(hajimehoshi): Replace for-of after google/closure-compiler#643 is
    // fixed.
    lists.forEach(function(node) {
      console.assert(node.nodeName === 'OL');

      // Already merged with its siblings.
      if (!node.parentNode)
        return;

      var listsToBeMerged = getListsToBeMerged(node);

      // TODO(hajimehoshi): comment
      // See w3c.100.
      for (var list of listsToBeMerged.filter(function(list) {
        return lists.indexOf(list) !== -1
      })) {
        var additionalLists = getListsToBeMerged(list);
        for (var list of additionalLists) {
          if (listsToBeMerged.indexOf(list) === -1)
            listsToBeMerged.push(list);
        }
      }

      // Determine the main list. The main list should be the first list which
      // exists before listifying.
      var mainListIndex = 0;
      for (var i = 0; i < listsToBeMerged.length; i++) {
        var list = listsToBeMerged[i];
        if (newLists.indexOf(list) === -1) {
          mainListIndex = i;
          break;
        }
      }

      var listParents = listsToBeMerged.map(function(node) {
        return node.parentNode;
      });

      var newList = doMergeLists(context, listsToBeMerged, mainListIndex);
      console.assert(newList);

      // If a parent of a list is empty, remove this.
      for (var listParent of listParents.filter(function(listParent) {
        return !listParent.hasChildNodes() && listParent.parentNode &&
          newList.parentNode !== listParent;
      })) {
        var ancestors = editing.dom.ancestorsWhile(
          listParent, function(node) {
            return node.childNodes.length === 1;
          });
        context.removeChild(listParent.parentNode, listParent);
        for (var ancestor of ancestors) {
          if (ancestor.parentNode)
            context.removeChild(ancestor.parentNode, ancestor);
        }
      }

      // Remove <br> just after the new list.
      if (newList.nextSibling && isBreakElement(newList.nextSibling)) {
        var breakElement = newList.nextSibling;
        context.removeChild(breakElement.parentNode, breakElement);
      }

      // In definition list, the new list can be a sibling to other items.
      var parent = /** @type {!Element} */(newList.parentElement);
      if (canContentOfDL(parent)) {
        var definitionListItem = newList.parentElement;
        var parentNode = /** @type {!Element} */(definitionListItem.parentNode);
        console.assert(parentNode);
        context.replaceChild(parentNode, newList, definitionListItem);
      }
    });
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {!editing.ImmutableSelection} selection
   */
  function execInsertListCommand(context, selection) {
    var effectiveNodes = context.setUpEffectiveNodes(selection, function(node) {
      return editing.dom.isText(node) || isPhrasingElement(node);
    });

    // The outermost node is a container node or null. Remove that.
    if (effectiveNodes.length)
      effectiveNodes.shift();

    var listItemCandidateGroups =
      getListItemCandidateGroups(context, selection, effectiveNodes);

    console.assert(listItemCandidateGroups.every(function(nodes) {
      return !editing.dom.isText(nodes[0]) || nodes.every(function(node) {
        return editing.dom.isText(node);
      })
    }));

    var newLists = [];
    var mergeableListCandidates = [];

    listItemCandidateGroups.filter(function(nodes) {
      return !isBreakElement(nodes[0]);

      // TODO(hajimehoshi): Replace for-of after google/closure-compiler#643 is
      // fixed.
    }).forEach(function(nodes) {
      if (isList(nodes[0])) {
        var list = processList(context, /** @type {!Element} */(nodes[0]),
                               effectiveNodes);
        if (list)
          mergeableListCandidates.push(list);
        return;
      }

      if (isInList(nodes[0])) {
        var list = processNodeInList(context, nodes, effectiveNodes);
        if (list)
          mergeableListCandidates.push(list);
        return;
      }

      // <dt>, <dd> can be content of a list according to Chrome behavior. See
      // w3c.18, w3c.24.
      if (nodes.length === 1 && canContentOfDL(nodes[0])) {
        var listItem = nodes[0];
        var list = context.createElement('OL');
        context.replaceChild(/** @type {!Element} */(listItem.parentNode),
          list, listItem);
        context.appendChild(list, listItem);
        mergeableListCandidates.push(list);
        return;
      }

      // Listify |nodes|.
      var newNode = listify(context, nodes);
      console.assert(newNode);
      console.assert(newNode.nodeName === 'OL');
      mergeableListCandidates.push(newNode);
      newLists.push(newNode);

      // See w3c.107.
      if (newNode.nextSibling && newNode.nextSibling.nodeName === 'BR') {
        var br = newNode.nextSibling;
        context.removeChild(br.parentNode, br);
      }
    });

    mergeLists(context, mergeableListCandidates, newLists);
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {boolean} userInterface Not used.
   * @param {string} value Not used.
   * @return {boolean}
   */
  function createInsertOrderedListCommand(context, userInterface, value) {
    /** @const */ var selection = context.normalizeSelection(
        context.startingSelection);
    /** @const */ var selectionTracker = new editing.SelectionTracker(
        context, selection);

    execInsertListCommand(context, selection);

    selectionTracker.finishWithStartAsAnchor();

    return true;
  }

  return createInsertOrderedListCommand;
})());
