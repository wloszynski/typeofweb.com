/* eslint-disable @typescript-eslint/consistent-type-assertions, functional/prefer-readonly-type -- ok */
// import RehypeToc from '@jsdevtools/rehype-toc';
import RehypePrism from '@mapbox/rehype-prism';
import Bluebird from 'bluebird';
import * as HastUtilToString from 'hast-util-to-string';
import { serialize } from 'next-mdx-remote/serialize';
import RehypeAutolinkHeadings from 'rehype-autolink-headings';
import RehypeKatex from 'rehype-katex';
import RehypeParse from 'rehype-parse';
import RehypeRaw from 'rehype-raw';
import RehypeSlug from 'rehype-slug';
import RehypeStringify from 'rehype-stringify';
import RemarkFootnotes from 'remark-footnotes';
import RemarkFrontmatter from 'remark-frontmatter';
import RemarkGfm from 'remark-gfm';
import RemarkMath from 'remark-math';
import RemarkParse from 'remark-parse';
import RemarkRehype from 'remark-rehype';
import * as Unified from 'unified';
import { visit } from 'unist-util-visit';

import { tryCatch } from './fns';
import { getOEmbed } from './oEmbedCache';
import { imageToJsx, remarkImgToJsx } from './remark-img-to-jsx';

import type { RootContent } from 'hast';
import type { Root } from 'hast-util-to-string';
import type { MDXRemoteSerializeResult } from 'next-mdx-remote';
import type { Node, Parent } from 'unist';

interface HtmlNode extends Node {
  tagName: string;
  type: 'element';
  children?: (HtmlNode | TextNode)[];
  properties?: {
    [prop: string]: string[] | string | undefined;
  };
}
interface MdxNode extends Node {
  type: 'mdxJsxTextElement';
  name: string;
  children?: (MdxNode | HtmlNode)[];
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
interface ImgNode extends HtmlNode {
  tagName: 'img';
}
interface FigureNode extends HtmlNode {
  tagName: 'figure';
}
interface MdxPNode extends MdxNode {
  name: 'p';
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

interface TextNode extends Node {
  type: 'text';
  value: string;
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
function isImgNode(node: Node): node is ImgNode {
  return node && node.type === 'element' && (node as ImgNode).tagName === 'img';
}
function isMdxPNode(node: Node): node is MdxPNode {
  return node && node.type === 'mdxJsxTextElement' && (node as MdxPNode).name === 'p';
}
function isPathNode(node: Node): node is PathNode {
  return node && node.type === 'element' && (node as PathNode).tagName === 'path';
}
function isTextNode(node: Node): node is TextNode {
  return node && node.type === 'text';
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

function replaceFreeLinkWithOEmbed(): import('unified').Transformer {
  return function transformer(tree) {
    const preorder = async (node: Node): Promise<HtmlNode | Node> => {
      if (isParentNode(node) && node.type === 'root') {
        node.children = await Bluebird.mapSeries(node.children, (child) => preorder(child));
        return node;
      }
      if (!isPNode(node) || node.children?.length !== 1 || !isAnchorNode(node.children[0])) {
        return node;
      }

      const anchorNode = node.children[0];
      const href = anchorNode.properties?.href;
      if (!href || (anchorNode.children?.[0] as unknown as TextNode)?.value !== href) {
        return node;
      }

      const oEmbed = await getOEmbed(href, {
        updateCache: !!process.env.UPDATE_OEMBED,
        force: !!process.env.FORCE_OEMBED,
      });

      if (!oEmbed) {
        return node;
      }

      const errorOrRoot =
        oEmbed.type === 'video' || oEmbed.type === 'rich'
          ? tryCatch(() =>
              Unified.unified()
                .use(RehypeParse as any)
                .parse(oEmbed.html),
            )
          : null;
      const isError = errorOrRoot instanceof Error;
      if (isError) {
        console.error(errorOrRoot);
      }
      const rest = isError ? null : (errorOrRoot as unknown as { children: RootContent[] });

      const findBody = (c: RootContent): RootContent[] =>
        c.type === 'element' && c.tagName === 'body' ? c.children : isParentNode(c) ? c.children.flatMap(findBody) : [];

      const cover: HtmlNode = {
        type: 'element',
        tagName: 'img',
        properties: {
          src: oEmbed.thumbnail_url,
          width: String(oEmbed.thumbnail_width),
          height: String(oEmbed.thumbnail_height),
          title: `Otwórz ${oEmbed.title}`,
        },
      };

      const elements = rest?.children.flatMap(findBody).map((n) => {
        if (n.type === 'element' && n.tagName === 'iframe') {
          const aspect = Number(n.properties?.width) / Number(n.properties?.height) || 1.69;
          return {
            type: 'element',
            tagName: 'div',
            properties: { style: `aspect-ratio: ${aspect};` },
            children: [n],
          };
        }
        return n;
      }) as HtmlNode[] | null;

      const shouldLinkWholeCard = oEmbed.type === 'rich' && oEmbed.html;

      const replacement: FigureNode = {
        tagName: 'figure',
        type: 'element',
        properties: { class: 'oembed' },
        children: [
          ...(oEmbed.type === 'rich' ? [cover] : []),
          ...(elements && elements.length > 0 && oEmbed.type !== 'rich' ? elements : []),
          {
            type: 'element',
            tagName: 'figcaption',
            children: [
              {
                type: 'element',
                tagName: 'cite',
                children: [
                  shouldLinkWholeCard
                    ? {
                        type: 'text',
                        value: href,
                      }
                    : {
                        type: 'element',
                        tagName: 'a',
                        properties: {
                          href,
                          title: oEmbed.title,
                        },
                        children: [
                          {
                            type: 'text',
                            value: href,
                          },
                        ],
                      },
                ],
              },
              {
                type: 'element',
                tagName: 'p',
                properties: { class: 'title' },
                children: oEmbed.title ? [{ type: 'text', value: oEmbed.title }] : [],
              },
              ...(elements && elements.length > 0 && oEmbed.type === 'rich' ? elements : []),
            ],
          },
        ],
      };

      if (shouldLinkWholeCard) {
        return {
          type: 'element',
          tagName: 'a',
          properties: {
            href,
            title: oEmbed.title,
          },
          children: [replacement],
        };
      }

      return replacement;
    };

    return preorder(tree);
  };
}

function fixSvgPaths(): import('unified').Transformer {
  return function transformer(tree) {
    const run = (node: Node) => {
      if (isPathNode(node)) {
        if (node.properties?.d) {
          node.properties.d = node.properties.d.replace(/\s+/g, ' ');
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

function imageAttributes(): import('unified').Transformer {
  return function transformer(tree) {
    visit(tree, isImgNode, (node: ImgNode) => {
      const title = node.properties?.title;
      if (typeof title === 'string' && title.startsWith('#')) {
        const properties = Object.fromEntries(
          title
            .slice(1)
            .split(';')
            .map((p) => p.split('='))
            .map(([key, val]) => [key.trim(), val.trim()])
            .filter(([key]) => key),
        );
        node.properties = { ...node.properties, ...properties };
      }
    });
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

export function collapseParagraphs(): import('unified').Transformer {
  return function transformer(tree) {
    const run = (node: Node): HtmlNode | MdxNode | Node => {
      if (isPNode(node)) {
        if (
          node.children?.length === 1 &&
          node.children[0] &&
          (isPNode(node.children[0]) || isMdxPNode(node.children[0]))
        ) {
          return node.children[0];
        } else {
          // what to do with multiple paragraphs?
          return node;
        }
      } else if (isParentNode(node)) {
        node.children = node.children.map(run);
      }
      return node;
    };
    return run(tree);
  };
}

export function normalizeHeaders(): import('unified').Transformer {
  return function transformer(tree) {
    const desiredHeading = 2;

    let mostImportantHeading = Infinity;
    visit(tree, 'element', (node: HtmlNode) => {
      if (node.tagName.length === 2 && node.tagName.toLowerCase().startsWith('h')) {
        const level = parseInt(node.tagName.substr(1), 10);
        if (level < mostImportantHeading) {
          mostImportantHeading = level;
        }
      }
    });
    if (mostImportantHeading === Infinity) {
      return tree;
    }

    visit(tree, 'element', (node: HtmlNode) => {
      if (node.tagName.length === 2 && node.tagName.toLowerCase().startsWith('h')) {
        const level = parseInt(node.tagName.substr(1), 10);
        if (isNaN(level)) {
          return;
        }
        const newLevel = desiredHeading - mostImportantHeading + level;
        node.tagName = `h${newLevel}`;
      }
    });
  };
}

export function addDataToCodeBlocks(): import('unified').Transformer {
  return (tree) => {
    visit(tree, 'element', (node: Node) => {
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

export const commonRemarkPlugins = [
  RemarkFrontmatter,
  RemarkMath,
  RemarkGfm,
  RemarkFootnotes,
  imageToJsx,
  remarkImgToJsx,
];
const commonRehypePlugins = [
  normalizeHeaders,
  [RehypeKatex, { strict: 'ignore' }],
  collapseParagraphs,
  RehypeSlug,
  RehypeAutolinkHeadings,
  RehypePrism,
  addDataToCodeBlocks,
  imageAttributes,
];

export function toMdx(
  source: string,
  frontmatter: object,
  options: { parseOembed: boolean },
): Promise<MDXRemoteSerializeResult<Record<string, unknown>>> {
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
        remarkPlugins: [...(commonRemarkPlugins as any)],
        rehypePlugins: [
          ...commonRehypePlugins,
          ...(options.parseOembed ? [replaceFreeLinkWithOEmbed] : []),
          wrapLinksInSpans,
          fixSvgPaths as any,
        ],
      },
    },
  );
}

export async function toHtml(
  source: string,
  options: { excerpt: false; readonly parseOembed: boolean },
): Promise<ReturnType<import('unified').Processor['process']>>;
export async function toHtml(
  source: string,
  options: { excerpt: true; readonly parseOembed: boolean },
): Promise<string>;
export async function toHtml(
  source: string,
  options: { excerpt: boolean; readonly parseOembed: boolean },
): Promise<string | ReturnType<import('unified').Processor['process']>> {
  const plugins = [
    RemarkParse,
    ...commonRemarkPlugins,
    [RemarkRehype, { allowDangerousHtml: true }],
    RehypeRaw,
    ...(options.excerpt ? [getOnlyFirstPara, addLeadToFirstParagraph] : []),
    ...commonRehypePlugins,
    ...(options.parseOembed ? [replaceFreeLinkWithOEmbed] : []),
    wrapLinksInSpans,
  ];

  const processor: Unified.Processor = plugins.reduce<Unified.Processor>((processor, plugin) => {
    return Array.isArray(plugin) ? processor.use(...(plugin as [any, any])) : processor.use(plugin as any);
  }, Unified.unified());

  if (options.excerpt) {
    const parsed = processor.parse(source);
    const result = await processor.run(parsed);
    return HastUtilToString.toString(result as Root);
  }

  // @ts-ignore
  return processor.use(RehypeStringify).process(source);
}
// snake case to camel case
function toCamelCase(str: string): any {
  return str.replace(/-([a-z])/gi, ([_, g]) => (g ? g.toUpperCase() : ''));
}
