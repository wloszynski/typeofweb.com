import Head from 'next/head';
import { useRouter } from 'next/router';

interface RouterQuery {
  readonly page?: string;
  readonly permalink?: string;
}

const siteName = `Type of Web`;
const shortDescription = `Blog o programowaniu`;
const defaultDescription = `Blog o programowaniu. Dla front-end i back-end developerów. Trochę o urokach pracy zdalnej, ale przede wszystkim o: JavaScript, React, Vue, Angular, node.js, TypeScript, HapiJS…`;
const SEP = ' • ';
const origin = process.env.NEXT_PUBLIC_VERCEL_URL || 'typeofweb.com';
const MAX_TITLE_LEN = 50;
const robots = `index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1`;

interface SeoProps {
  readonly title?: string | null;
  readonly description?: string | null;
  readonly author?: string | null;
}

export const Seo = ({ title = '', description = defaultDescription, author }: SeoProps) => {
  const { query: _query, asPath } = useRouter();
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- RouterQuery
  const query = _query as RouterQuery;

  const page = Number(query.page);
  const pageTitle = query.page ? `Strona ${query.page}` : ``;

  const next = query.page ? page + 1 : null;
  const prev = query.page ? page - 1 : null;

  let fullTitle = [title, pageTitle, siteName].filter((x) => !!x.trim()).join(SEP);
  if (fullTitle.length < MAX_TITLE_LEN) {
    fullTitle += ` ${SEP} ${shortDescription}`;
  }

  const type = query.permalink ? 'article' : 'website';

  return (
    <Head>
      <title>{fullTitle}</title>
      {description && <meta key="description" name="description" content={description} />}
      <meta key="robots" name="robots" content={robots} />
      <meta key="googlebot" name="googlebot" content={robots} />
      <meta key="bingbot" name="bingbot" content={robots} />
      <link key="profile" rel="profile" href="https://gmpg.org/xfn/11" />
      <link key="canonical" rel="canonical" href={`https://${origin}${asPath}`} />
      {next && <link key="next" rel="next" href={`https://${origin}/strona/${next}/`} />}
      {prev && prev > 0 && <link key="prev" rel="prev" href={`https://${origin}/strona/${prev}/`} />}
      <meta key="og:locale" property="og:locale" content="pl_PL" />
      <meta key="og:type" property="og:type" content={type} />
      <meta key="og:title" property="og:title" content={fullTitle} />
      {description && <meta key="og:description" property="og:description" content={description} />}
      <meta key="og:url" property="og:url" content={`https://${origin}${asPath}`} />
      <meta key="og:site_name" property="og:site_name" content={siteName} />
      {type === 'article' && (
        <meta key="article:publisher" property="article:publisher" content="https://www.facebook.com/typeofweb" />
      )}
      {type === 'article' && author && <meta key="article:author" property="article:author" content={author} />}
      <meta key="fb:app_id" property="fb:app_id" content="1709793622637583" />
      <meta key="twitter:card" name="twitter:card" content="summary_large_image" />
      <meta key="twitter:site" name="twitter:site" content="@mmiszy" />

      {/* <link
        rel="alternate"
        type="application/rss+xml"
        title="Type of Web &raquo; Kanał z wpisami"
        href="https://${baseUrl}/feed/"
      /> */}
    </Head>
  );
};