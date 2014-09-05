// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

editing.defineCommand('CreateLink', (function() {

  /**
   * @param {!editing.ReadOnlySelection} selection
   * @return {!Array.<!Node>}
   *
   * Computes effective nodes for inline formatting commands. |selection|
   * should be normalized.
   */
  function setUpEffectiveNodes(selection) {
    console.assert(!editing.nodes.isText(selection.anchorNode));
    console.assert(!editing.nodes.isText(selection.focusNode));
    var selectedNodes = editing.nodes.computeSelectedNodes(selection);
    if (!selectedNodes.length)
      return selectedNodes;
    var nodeSet = editing.newSet(selectedNodes);
    // Add ancestors of start node of selected nodes if all descendant nodes
    // in selected range, e.g. <a>^foo<b>bar</b>|</a>.
    // Note: selection doesn't need to end beyond end tag.
    var startNode = selectedNodes[0];
    for (var ancestor = startNode.parentNode; ancestor;
         ancestor = ancestor.parentNode) {
      if (!editing.nodes.isEditable(ancestor))
        break;
      if (ancestor.firstChild !== startNode)
        break;
      if (!nodeSet.has(editing.nodes.lastWithIn(ancestor)))
        break;
      selectedNodes.unshift(ancestor);
      nodeSet.add(ancestor);
      startNode = ancestor;
    }
    return selectedNodes;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {string} url
   * @return {boolean}
   */
  function createLinkForRange(context, url) {
    console.assert(url !== '');

    function canMerge(node){
      return node && node.nodeName === 'A' &&
             node.getAttribute('href') === url &&
             node.attributes.length === 1;
    }

    function insertNewAnchorElement(anchorPhraseNode) {
      if (editing.nodes.isWhitespaceNode(anchorPhraseNode))
        return null;
      var anchorElement = context.createElement('a');
      context.setAttribute(anchorElement, 'href', url);
      context.replaceChild(anchorPhraseNode.parentNode, anchorElement,
                           anchorPhraseNode);
      context.appendChild(anchorElement, anchorPhraseNode);
      return anchorElement;
    }

    /**
     * @param {Node} node
     * @param {!Node} other
     * @return boolean
     */
    function isStartOf(node, other) {
      for (var runner = node; runner; runner = runner.parentNode) {
        if (runner.previousSibling)
          return false;
        if (runner === other)
          return true;
      }
      return false;
    }

    /**
     * @template T
     * @param {!Array.<T>} array
     * @return {?T}
     */
    function lastOf(array) {
      return array.length ? array[array.length - 1] : null;
    }

    var anchorElement = null;
    function wrapByAnchor(node) {
      if (!anchorElement) {
        if (!editing.nodes.isVisibleNode(node)) {
          // We don't have leading whitespaces in anchor element.
          return;
        }
        var nextSibling = node.nextSibling;
        if (canMerge(nextSibling)) {
          // See w3c.26, w3c.30
          anchorElement = nextSibling;
          context.insertBefore(anchorElement, node, anchorElement.firstChild);
          return;
        }
        var previousSibling = node.previousSibling;
        if (canMerge(previousSibling)) {
          // See w3c.27
          anchorElement = previousSibling;
          context.appendChild(anchorElement, node);
          return;
        }
        anchorElement = insertNewAnchorElement(node);
        return;
      }
      if (editing.nodes.isDescendantOf(node, anchorElement)) {
        // See w3c.44
        return;
      }
      if (node.parentNode === anchorElement.parentNode) {
        context.appendChild(anchorElement, node);
        return;
      }
      endAnchorElement();
      wrapByAnchor(node);
    }

    function endAnchorElement() {
      if (!anchorElement)
        return;
      anchorElement = null;
    }

    var selection = editing.nodes.normalizeSelection(
        context, context.startingSelection);
    if (selection.isCaret) {
      // If selection is caret, we insert |url| before caret and select it,
      // then apply "createLink" command.
      var textNode = context.createTextNode(url);
      var refChild = selection.anchorNode.childNodes[selection.anchorOffset];
      if (refChild)
        context.insertBefore(selection.anchorNode, textNode, refChild);
      else
        context.appendChild(selection.anchorNode, textNode);
      selection = new editing.ReadOnlySelection(
        selection.anchorNode, selection.anchorOffset,
        selection.anchorNode, selection.anchorOffset + 1,
        editing.SelectionDirection.ANCHOR_IS_START);
    }
    var effectiveNodes = setUpEffectiveNodes(selection);
    if (!effectiveNodes.length) {
      context.setEndingSelection(context.startingSelection);
      return true;
    }

    var pendingContainers = [];
    var pendingContents = [];

    function moveLastContainerToContents() {
      // All descendant of |lastPendingContainer| can be contents of anchor.
      var lastContainer = pendingContainers.pop();
      while (pendingContents.length &&
             lastOf(pendingContents).parentNode === lastContainer) {
        pendingContents.pop();
      }
      if (pendingContainers.length) {
        pendingContents.push(lastContainer);
        return;
      }
      wrapByAnchor(lastContainer);
    }

    // Wrap pending contents which are sibling of |stopNode|
    function processPendingContents() {
      pendingContents.forEach(wrapByAnchor);
      endAnchorElement();
      pendingContainers = [];
      pendingContents = [];
    }

    var selectionTracker = new editing.SelectionTracker(context, selection);

    // Special handling of start node, see w3c.30, w3c.40.
    var startNode = effectiveNodes[0];
    var endNode = lastOf(effectiveNodes);

    var outerAnchorElement = startNode.parentNode;
    while (outerAnchorElement) {
      if (outerAnchorElement.nodeName === 'A')
        break;
      outerAnchorElement = outerAnchorElement.parentNode;
    }

    if (outerAnchorElement) {
      var isStartOfContents = isStartOf(startNode, outerAnchorElement);
      if (outerAnchorElement.getAttribute('href') === url) {
        anchorElement = outerAnchorElement;
      } else if (editing.nodes.isDescendantOf(endNode, outerAnchorElement)) {
        // All selected nodes are in |outerAnchorElement|.
        var isEndOfContents = editing.nodes.lastWithIn(outerAnchorElement) ==
            endNode;
        if (isStartOfContents && isEndOfContents) {
          // Selected nodes === all children of |outerAnchorElement|.
          anchorElement = outerAnchorElement;
        } else if (isStartOfContents) {
          // Move |startNode| to |endNode| before |outerAnchorElement|.
          for (var child = startNode; child; child = child.nextSibling) {
            context.insertBefore(outerAnchorElement.parentNode, child,
                                 outerAnchorElement);
            if (endNode === child ||
                editing.nodes.isDescendantOf(endNode, child))
              break;
          }
        } else if (isEndOfContents) {
          // Move |startNode| and child nodes after |startNode| after
          // |outerAnchorElement|. See w3c.37.
          var child = startNode;
          while (child) {
            var next = child.nextSibling;
            context.insertAfter(outerAnchorElement.parentNode, child,
                                outerAnchorElement);
            child = next;
          }
        } else {
           // See w3c.34
          var newAnchor = context.splitTree(outerAnchorElement, startNode);
          var nextNode = editing.nodes.nextNodeSkippingChildren(endNode);
          if (nextNode)
            context.splitTree(newAnchor, nextNode);
          // Remove attribute from new A element created by |splitTree()|.
          // See w3c.46 and w3c.47.
          [].forEach.call(newAnchor.attributes, function(attrNode) {
            newAnchor.removeAttribute(attrNode.name);
          });
          newAnchor.setAttribute('href', url);
          anchorElement = newAnchor;
        }
      } else if (isStartOfContents) {
        anchorElement = outerAnchorElement;
      } else {
        // Move |startNode| and child nodes after |startNode| after
        // |outerAnchorElement|.
        var child = startNode;
        while (child) {
          var next = child.nextSibling;
          context.insertAfter(outerAnchorElement.parentNode, child,
                              outerAnchorElement);
          child = next;
        }
      }
    }

    effectiveNodes.forEach(function(currentNode) {
      if (currentNode === anchorElement)
        return;

      var lastPendingContainer = lastOf(pendingContainers);
      if (lastPendingContainer &&
          lastPendingContainer === currentNode.previousSibling) {
        moveLastContainerToContents();
      }

      if (!editing.nodes.isEditable(currentNode) ||
          !editing.nodes.isPhrasing(currentNode)) {
        processPendingContents();
        return;
      }

      if (currentNode.nodeName === 'A') {
        if (!anchorElement) {
          processPendingContents();
          anchorElement = currentNode;
          context.setAttribute(anchorElement, 'href', url);
          return;
        }
        console.assert(anchorElement.getAttribute('href') === url);
        context.setAttribute(currentNode, 'href', url);
        if (canMerge(currentNode)) {
          var child = currentNode.firstChild;
          while (child) {
            var next = child.nextSibling;
            context.insertBefore(currentNode.parentNode, child, currentNode);
            child = next;
          }
          selectionTracker.willRemoveNode(currentNode);
          context.removeChild(currentNode.parentNode, currentNode);
          return;
        }
        processPendingContents();
        anchorElement = currentNode;
      }

      if (editing.nodes.isInteractive(currentNode)) {
        processPendingContents();
        return;
      }

      if (currentNode.hasChildNodes()) {
        pendingContainers.push(currentNode);
        return;
      }

      if (pendingContainers.length) {
        pendingContents.push(currentNode);
        if (!currentNode.nextSibling)
          moveLastContainerToContents();
        return;
      }
      wrapByAnchor(currentNode);
    });

    // The last effective node is descendant of pending container.
    // Example: foo<b>^bar<i>baz quux</i></b>|mox
    // where the last effective node is "baz quux".
    processPendingContents();
    selectionTracker.finishWithStartAsAnchor();
    return true;
  }

  /**
   * @param {!editing.EditingContext} context
   * @param {boolean} userInterface
   * @param {string} url
   * @return {boolean}
   */
  function createLinkCommand(context, userInterface, url) {
    if (url === '') {
      context.setEndingSelection(context.startingSelection);
      return false;
    }
    if (context.startingSelection.isEmpty) {
      context.setEndingSelection(context.startingSelection);
      return true;
    }
    return createLinkForRange(context, url);
  }

  return createLinkCommand;
})());
