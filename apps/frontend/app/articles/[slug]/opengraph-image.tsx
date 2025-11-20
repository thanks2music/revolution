import { ImageResponse } from '@vercel/og';
import { getArticleBySlug } from '@/lib/mdx/articles';

// Image metadata
export const runtime = 'edge';
export const alt = 'Article OG Image';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

/**
 * Dynamic OG Image Generation for Articles
 *
 * @description
 * Generates Open Graph images dynamically for each article using @vercel/og.
 * Displays title, author, date, and categories with Revolution branding.
 *
 * @see https://vercel.com/docs/functions/og-image-generation
 */
export default async function Image({ params }: { params: { slug: string } }) {
  const article = getArticleBySlug(params.slug);

  // Fallback if article not found
  if (!article) {
    return new ImageResponse(
      (
        <div
          style={{
            fontSize: 48,
            background: 'linear-gradient(to bottom, #1e3a8a, #3b82f6)',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontFamily: 'sans-serif',
          }}
        >
          Article Not Found
        </div>
      ),
      {
        ...size,
      }
    );
  }

  // Format date
  const formattedDate = new Date(article.date).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Truncate title if too long
  const displayTitle =
    article.title.length > 60
      ? article.title.substring(0, 57) + '...'
      : article.title;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          padding: '60px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '40px',
          }}
        >
          <div
            style={{
              fontSize: 32,
              fontWeight: 'bold',
              color: 'white',
              fontFamily: 'sans-serif',
            }}
          >
            Revolution Platform
          </div>
        </div>

        {/* Main Content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 64,
              fontWeight: 'bold',
              color: 'white',
              lineHeight: 1.2,
              marginBottom: '30px',
              fontFamily: 'sans-serif',
            }}
          >
            {displayTitle}
          </div>

          {/* Metadata */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: 24,
              color: 'rgba(255, 255, 255, 0.9)',
              marginBottom: '20px',
              fontFamily: 'sans-serif',
            }}
          >
            <span>{article.author}</span>
            <span style={{ margin: '0 15px' }}>·</span>
            <span>{formattedDate}</span>
          </div>

          {/* Categories */}
          {article.categories.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
              }}
            >
              {article.categories.slice(0, 3).map((category) => (
                <div
                  key={category}
                  style={{
                    padding: '8px 20px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    borderRadius: '20px',
                    fontSize: 20,
                    color: 'white',
                    fontFamily: 'sans-serif',
                  }}
                >
                  {category}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
