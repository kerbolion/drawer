import React from "react";
import ReactDOM from "react-dom";

// rc-util checks DOM nodes with `instanceof HTMLElement`. Controls are mounted
// in the drawer iframe, so their constructors belong to another window. Use a
// realm-independent element check so rc-trigger can retain its target refs.
export function isDOM(node) {
  return Boolean(node && node.nodeType === 1 && typeof node.getBoundingClientRect === "function");
}

export function getDOM(node) {
  if (node && typeof node === "object" && isDOM(node.nativeElement)) return node.nativeElement;
  return isDOM(node) ? node : null;
}

export default function findDOMNode(node) {
  const domNode = getDOM(node);
  if (domNode) return domNode;
  if (node instanceof React.Component) return ReactDOM.findDOMNode?.(node);
  return null;
}
