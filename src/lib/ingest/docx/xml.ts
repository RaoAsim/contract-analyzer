import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";

export type { XmlElement, XmlNode };

export function parseXml(xml: string): XmlElement | null {
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, "text/xml");
  return doc.documentElement ?? null;
}

/** Element children (prefix-agnostic: compare `localName`). */
export function childElements(el: XmlNode): XmlElement[] {
  const out: XmlElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as XmlElement);
  return out;
}

export function child(el: XmlNode, name: string): XmlElement | undefined {
  return childElements(el).find((c) => c.localName === name);
}

export function children(el: XmlNode, name: string): XmlElement[] {
  return childElements(el).filter((c) => c.localName === name);
}

/** `w:val`-style attribute by local name. */
export function attr(el: XmlElement | undefined, name: string): string | undefined {
  if (!el) return undefined;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i);
    if (a && (a.localName === name || a.name === name)) return a.value;
  }
  return undefined;
}

export function intAttr(el: XmlElement | undefined, name: string): number | undefined {
  const v = attr(el, name);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** OOXML on/off property: present and not "0"/"false"/"off". */
export function isOn(el: XmlElement | undefined): boolean {
  if (!el) return false;
  const v = attr(el, "val");
  return v === undefined || !/^(0|false|off|none)$/i.test(v);
}
