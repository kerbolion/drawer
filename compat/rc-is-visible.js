export default function isVisible(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.offsetParent) return true;
  if (typeof element.getBBox === "function") {
    const { width, height } = element.getBBox();
    if (width || height) return true;
  }
  if (typeof element.getBoundingClientRect === "function") {
    const { width, height } = element.getBoundingClientRect();
    return Boolean(width || height);
  }
  return false;
}
