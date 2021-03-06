// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

editing.EditingStyle = (function() {
  'use strict';

  /** @const */ var CSS_PROPRTY_DATA = (function() {
    function makeFontCreate(attributeName) {
      if (attributeName === 'face') {
        return function(context, property) {
          var fontElement = context.createElement('font');
          // Remove single quotes for Outlook 2007 compatibility.
          // See http://wkb.ug/79448
          var value = property.value.replace(/\u0027/g, '');
          context.setAttribute(fontElement, attributeName, value);
          return fontElement;
        }
      }
      return function(context, property) {
        var fontElement = context.createElement('font');
        context.setAttribute(fontElement, attributeName, property.value);
        return fontElement;
      }
    }

    function makeSimpleCreator(expectedValue, tagName) {
      return function(context, property) {
        if (property.value === expectedValue)
          return context.createElement(tagName);
        return null;
      };
    }

    function makeSimpleCreator2(expectedValue1, tagName1, expectedValue2,
                               tagName2) {
      return function(context, property) {
        if (property.value === expectedValue1)
          return context.createElement(tagName1);
        if (property.value === expectedValue2)
          return context.createElement(tagName2);
        return null;
      };
    }

    return {
      'color': {
        createStyleElement: makeFontCreate('color')
      },
      'font-family': {
        createStyleElement: makeFontCreate('face')
      },
      'font-size': {
        createStyleElement: makeFontCreate('size')
      },
      'font-style': {
        createStyleElement: makeSimpleCreator('italic', 'i')
      },
      'font-weight': {
        createStyleElement: makeSimpleCreator('bold', 'b')
      },
      'text-decoration': {
        createStyleElement: makeSimpleCreator2('line-through', 's',
                                               'underline', 'u')
      },
      'vertical-align': {
        createStyleElement: makeSimpleCreator2('sub', 'sub', 'super', 'sup')
      }
    };
  })();
  for (var propertyName of Object.keys(CSS_PROPRTY_DATA))
    CSS_PROPRTY_DATA[propertyName].propertyName = propertyName;

  // This order must match with |ApplyStyleCommand::applyInlineStyleChange()|.
  /** @const @type {!Array.<string>} */ var CREATE_ELEMENT_ORDER = [
    'color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-decoration',
    'vertical-align',
  ].reverse();

  /** @const */ var TAG_NAME_DATA = {
    'b': {
      propertyName: 'font-weight',
      propertyValue: 'bold'
    },
    'em': {
      propertyName: 'font-style',
      propertyValue: 'italic'
    },
    'i': {
      propertyName: 'font-style',
      propertyValue: 'italic'
    },
    's': {
      propertyName: 'text-decoration',
      propertyValue: 'line-through'
    },
    'strike': {
      propertyName: 'text-decoration',
      propertyValue: 'line-through'
    },
    'strong': {
      propertyName: 'font-weight',
      propertyValue: 'bold'
    },
    'u': {
      propertyName: 'text-decoration',
      propertyValue: 'underline'
    },
  };

  /**
   * @constructor
   * @final
   * @struct
   * @param {!Element} element
   */
  function EditingStyle(element) {
    /** @private @type {!CSSStyleDeclaration} */
    this.domStyle_ = element.style;
    Object.seal(this);
  }

  // Forward declaration for closure compiler.
  EditingStyle.prototype = /** @struct */ {
    /**
     * @this {!EditingStyle}
     * @param {!editing.EditingContext} context
     * @param {!function(!editing.EditingContext, editing.Property, !Element)}
     *    callback
     */
    createElements: function(context, callback) {},

    /** @type {!Array.<!editing.Property>} */
    get properties() {}
  };

  /**
   * @this {!EditingStyle}
   * @param {!editing.EditingContext} context
   * @param {!Element} element
   */
  function applyInheritedStyle(context, element) {
    this.createElements(context, function(context, property, styleElement) {
      if (element.tagName === styleElement.tagName)
        return;
      if (element.style[property.name] !== '')
        return;
      context.setStyle(element, property.name, property.value);
    });
  }

  /**
   * @this {!EditingStyle}
   * @param {!editing.EditingContext} context
   * @param {!function(!editing.EditingContext, editing.Property, !Element)}
   *    callback
   */
  function createElements(context, callback) {
    var domStyle = this.domStyle_;
    /** @type {!Map.<string, string>} */ var properties = new Map();
    for (var propertyName of Array.prototype.slice.call(domStyle))
      properties.set(propertyName, domStyle[propertyName]);
    for (var propertyName of CREATE_ELEMENT_ORDER) {
      var propertyValue = properties.get(propertyName);
      if (typeof(propertyValue) !== 'string')
        continue;
      var property = {name: propertyName, value: propertyValue};
      var data = CSS_PROPRTY_DATA[propertyName];
      var styleElement = data.createStyleElement(context, property);
      if (!styleElement)
        continue;
      callback(context, property, styleElement);
    }
  }

  /**
   * @param {string} propertyName
   * @return {boolean}
   */
  function isKnownProperty(propertyName) {
    return propertyName in CSS_PROPRTY_DATA;
  };

  /**
   * @this {!EditingStyle}
   * @return {boolean}
   */
  function hasStyle() {
    return this.domStyle_.length >= 1;
  }

  /**
   * @this {!EditingStyle}
   * @return {!Array.<editing.Property>}
   */
  function properties() {
    var domStyle = this.domStyle_;
    return Array.prototype.map.call(domStyle, function(propertyName) {
      return CSS_PROPRTY_DATA[propertyName];
    }).filter(function(data) {
      return data;
    }).map(function(data) {
      var propertyValue = domStyle[data.propertyName];
      return {name: data.propertyName, value: propertyValue}
    }).filter(function(property) {
      return property;
    });
  }

  EditingStyle.prototype = /** @struct */ {
    applyInheritedStyle: applyInheritedStyle,
    constructor: EditingStyle,
    createElements: createElements,
    get hasStyle() { return hasStyle.call(this); },
    get properties() { return properties.call(this); }
  };
  Object.freeze(EditingStyle.prototype);
  return EditingStyle;
})();
