/**
 * Mini-analyseur XML suffisant pour le GPX et le TCX. Il evite une dependance
 * externe et reste tolerant : espaces de noms ignores, attributs simples,
 * sections CDATA et commentaires sautes.
 */

export interface XmlNode {
  /** Nom local de la balise, sans prefixe d'espace de noms. */
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < source.length) {
    const open = source.indexOf("<", i);
    if (open === -1) break;

    if (open > i) {
      const text = source.slice(i, open).trim();
      if (text) {
        const current = stack[stack.length - 1]!;
        current.text += current.text ? " " + decodeEntities(text) : decodeEntities(text);
      }
    }

    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open);
      const content = source.slice(open + 9, end === -1 ? source.length : end);
      stack[stack.length - 1]!.text += content;
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<?", open) || source.startsWith("<!", open)) {
      const end = source.indexOf(">", open);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const close = findTagEnd(source, open);
    if (close === -1) break;
    const raw = source.slice(open + 1, close).trim();
    i = close + 1;

    if (raw.startsWith("/")) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const node = parseTag(body);
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root;
}

/** Trouve le '>' fermant en ignorant ceux situes dans une valeur d'attribut. */
function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function parseTag(body: string): XmlNode {
  const match = /^([^\s/>]+)/.exec(body);
  const rawName = match ? match[1]! : body;
  const attributes: Record<string, string> = {};
  const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let attr: RegExpExecArray | null;
  while ((attr = attrPattern.exec(body)) !== null) {
    const key = stripNamespace(attr[1]!);
    attributes[key] = decodeEntities(attr[3] ?? attr[4] ?? "");
  }
  return { name: stripNamespace(rawName), attributes, children: [], text: "" };
}

function stripNamespace(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Premier enfant direct portant ce nom. */
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

/** Tous les enfants directs portant ce nom. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/** Tous les descendants portant ce nom, a n'importe quelle profondeur. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (current: XmlNode) => {
    for (const c of current.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Texte du premier descendant portant ce nom. */
export function textOf(node: XmlNode, name: string): string | undefined {
  const found = descendants(node, name)[0];
  return found?.text || undefined;
}

export function numberOf(node: XmlNode, name: string): number | undefined {
  const text = textOf(node, name);
  if (text == null) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}
