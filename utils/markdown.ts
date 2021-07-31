/* eslint-disable @typescript-eslint/consistent-type-assertions, functional/prefer-readonly-type -- ok */
// import RehypeToc from '@jsdevtools/rehype-toc';
import RehypePrism from '@mapbox/rehype-prism';
import HastUtilToString from 'hast-util-to-string';
import { serialize } from 'next-mdx-remote/serialize';
import RehypeAutolinkHeadings from 'rehype-autolink-headings';
import RehypeKatex from 'rehype-katex';
import RehypeRaw from 'rehype-raw';
import RehypeSlug from 'rehype-slug';
import RehypeStringify from 'rehype-stringify';
import RemarkFrontmatter from 'remark-frontmatter';
import RemarkGfm from 'remark-gfm';
import RemarkMath from 'remark-math';
import RemarkParse from 'remark-parse';
import RemarkRehype from 'remark-rehype';
import * as Unified from 'unified';
import { visit } from 'unist-util-visit';

import type { MDXRemoteSerializeResult } from 'next-mdx-remote';
import type { Node, Parent } from 'unist';

interface HtmlNode extends Node {
  type: 'element';
  children?: HtmlNode[];
  properties?: {
    [prop: string]: string[] | string | undefined;
  };
}
interface AnchorNode extends HtmlNode {
  tagName: 'a';
  properties?: {
    href?: string | undefined;
    [prop: string]: string[] | string | undefined;
  };
}
interface PNode extends HtmlNode {
  tagName: 'p';
}
interface PreNode extends HtmlNode {
  tagName: 'pre';
  properties?: {
    className?: string[] | undefined;
    [prop: string]: string[] | string | undefined;
  };
}
interface CodeNode extends HtmlNode {
  tagName: 'code';
  properties?: {
    className?: string[] | undefined;
    [prop: string]: string[] | string | undefined;
  };
}
interface PathNode extends HtmlNode {
  tagName: 'path';
  properties?: {
    d?: string;
    [prop: string]: string[] | string | undefined;
  };
}

function isPreNode(node: Node): node is PreNode {
  return node && node.type === 'element' && (node as PreNode).tagName === 'pre';
}
function isCodeNode(node: Node): node is CodeNode {
  return node && node.type === 'element' && (node as CodeNode).tagName === 'code';
}

function isAnchorNode(node: Node): node is AnchorNode {
  return node && node.type === 'element' && (node as AnchorNode).tagName === 'a';
}

function isPNode(node: Node): node is PNode {
  return node && node.type === 'element' && (node as PNode).tagName === 'p';
}
function isPathNode(node: Node): node is PathNode {
  return node && node.type === 'element' && (node as PathNode).tagName === 'path';
}

function isParentNode(node: Node): node is Parent {
  return node && 'children' in node;
}

function wrapLinksInSpans(): import('unified').Transformer {
  return function transformer(tree) {
    const preorder = (node: Node) => {
      if (isAnchorNode(node)) {
        return {
          type: 'element',
          tagName: 'span',
          properties: { class: 'inner-link' },
          children: [node],
        };
      }
      if (isParentNode(node)) {
        node.children = node.children.map((child) => {
          return preorder(child);
        });
      }
      return node;
    };

    return preorder(tree);
  };
}

function fixSvgPaths(): import('unified').Transformer {
  return function transformer(tree) {
    const run = (node: Node) => {
      if (isPathNode(node)) {
        if (node.properties?.d) {
          node.properties.d = node.properties.d.replaceAll('\n', ' ');
        }
        return node;
      }
      if (isParentNode(node)) {
        node.children = node.children.map((child) => {
          return run(child);
        });
      }
      return node;
    };

    return run(tree);
  };
}

function addLeadToFirstParagraph(): import('unified').Transformer {
  return function transformer(tree) {
    const run = (node: Node): { found: boolean; node: HtmlNode } => {
      if (isPNode(node)) {
        return {
          found: true,
          node: {
            ...node,
            properties: {
              ...node.properties,
              class: 'lead',
            },
          },
        };
      } else if (isParentNode(node)) {
        const c = (node.children as HtmlNode[]).reduce<{
          found: boolean;
          children: HtmlNode[];
        }>(
          ({ found, children }, node) => {
            if (found) {
              return { found, children: [...children, node] };
            } else {
              const result = run(node);
              return { found: result.found, children: [...children, result.node] };
            }
          },
          { found: false, children: [] },
        );
        return {
          found: c.found,
          node: {
            ...(node as HtmlNode),
            children: c.children,
          },
        };
      } else {
        return { found: false, node: node as HtmlNode };
      }
    };

    return run(tree).node;
  };
}

function getOnlyFirstPara(): import('unified').Transformer {
  return function transformer(tree) {
    const run = (node: Node): Node | undefined => {
      if (isPNode(node)) {
        return node;
      }
      if (isParentNode(node)) {
        return node.children.find(isPNode);
      }
    };

    const result = run(tree);
    return result;
  };
}

export function addDataToCodeBlocks(): import('unified').Transformer {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (!isPreNode(node) && !isCodeNode(node)) {
        return;
      }

      const prefix = 'language-';
      const lang = node.properties?.className?.find((className) => className.startsWith(prefix))?.slice(prefix.length);
      if (lang) {
        node.properties = {
          ...node.properties,
          'data-lang': lang,
          ...(isPreNode(node) && { 'aria-label': `Kod w języku programowania ${lang.toUpperCase()}` }),
        };
      }
    });
  };
}

const toCamelCase = (str: string) => str.replace(/-([a-z])/g, (_, l: string) => l.toUpperCase());

export function toMdx(source: string, frontmatter: object): Promise<MDXRemoteSerializeResult<Record<string, unknown>>> {
  return serialize(
    source
      .replace(/style="(.*?)"/g, (match, styles: string) => {
        const jsxStyles = JSON.stringify(
          Object.fromEntries(
            [...styles.trim().matchAll(/(.*?)\s*:\s*(.*)/g)].map(([, property, value]) => {
              if (!property?.trim() || !value?.trim()) {
                return [];
              }
              const trimmedProperty = property.trim();
              const trimmedValue = value.trim();
              return [
                toCamelCase(trimmedProperty),
                trimmedValue.endsWith(';') ? trimmedValue.slice(0, -1) : trimmedValue,
              ];
            }),
          ),
        );
        return `style={${jsxStyles}}`;
      })
      .replace(/class="(.*?)"/g, 'className="$1"'),
    {
      scope: { data: frontmatter },
      mdxOptions: {
        remarkPlugins: [RemarkGfm, RemarkMath as any],
        rehypePlugins: [
          wrapLinksInSpans as any,
          RehypeSlug as any,
          RehypeAutolinkHeadings as any,
          RehypePrism as any,
          [RehypeKatex, { strict: false }],
          fixSvgPaths as any,
        ],
      },
    },
  );
}

export function toHtml(source: string, options: { excerpt: false }): import('vfile').VFile;
export function toHtml(source: string, options: { excerpt: true }): string;
export function toHtml(
  source: string,
  options: { excerpt: boolean } = { excerpt: false },
): string | import('vfile').VFile {
  let processor = Unified.unified()
    .use(RemarkParse)
    .use(RemarkGfm)
    .use(RemarkFrontmatter)
    .use(RemarkMath)
    .use(RemarkRehype, { allowDangerousHtml: true })
    .use(RehypeRaw);

  if (options.excerpt) {
    processor = processor.use(getOnlyFirstPara).use(addLeadToFirstParagraph);
  }

  processor = processor
    .use(RehypeKatex as any, { strict: false })
    .use(wrapLinksInSpans)
    .use(RehypeSlug)
    .use(RehypeAutolinkHeadings)
    .use(RehypePrism)
    .use(addDataToCodeBlocks);

  if (options.excerpt) {
    const parsed = processor.parse(source);
    const result = processor.runSync(parsed);
    return HastUtilToString(result);
  }

  return processor.use(RehypeStringify).processSync(source) as any;
}