import { Fragment } from 'react';
import { parseArticleBody, type ArticleInlineNode } from '@platform/shared';

/**
 * Renders an article body (the markup subset of packages/shared/src/sites/article-markup.ts) as React
 * elements. Every piece of text is a React text child, so it is always escaped; there is no
 * dangerouslySetInnerHTML and no HTML passthrough. Links are https only (the parser drops anything else)
 * and open in a new tab with rel="noopener noreferrer". Server component, no client JS.
 */
function Inline({ nodes }: { nodes: readonly ArticleInlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.type === 'text') return <Fragment key={i}>{node.value}</Fragment>;
        if (node.type === 'strong')
          return (
            <strong key={i} className="ui-strong">
              <Inline nodes={node.children} />
            </strong>
          );
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer" className="pui-link">
            <Inline nodes={node.children} />
          </a>
        );
      })}
    </>
  );
}

export function ArticleBody({ body }: { body: string }) {
  const blocks = parseArticleBody(body);
  return (
    <div className="grid gap-4" data-testid="article-body">
      {blocks.map((block, i) => {
        if (block.type === 'heading')
          return (
            <h2 key={i} className="ui-heading">
              <Inline nodes={block.children} />
            </h2>
          );
        if (block.type === 'list')
          return (
            <ul key={i} className="grid gap-1 list-disc pl-6">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline nodes={item} />
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline nodes={line} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
