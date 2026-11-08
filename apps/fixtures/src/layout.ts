import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export const BANNER_TEXT = 'FIXTURE — bukan situs pemerintah';

type Content = HtmlEscapedString | Promise<HtmlEscapedString>;

/** Kerangka halaman: banner wajib + noindex di setiap halaman. Tanpa logo/warna/nama instansi. */
export function page(title: string, body: Content) {
  return html`<!doctype html>
    <html lang="id">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>${title} (fixture)</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            margin: 0;
            color: #111;
            background: #fff;
          }
          #fixture-banner {
            background: #111;
            color: #fff;
            padding: 8px 16px;
            font-weight: 700;
            text-align: center;
          }
          main {
            max-width: 760px;
            margin: 16px auto;
            padding: 0 16px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th,
          td {
            border: 1px solid #888;
            padding: 6px 8px;
            text-align: left;
          }
          label {
            display: block;
            margin: 8px 0 2px;
          }
          .note {
            background: #f3f4f6;
            padding: 8px 12px;
            border-left: 4px solid #555;
            margin: 12px 0;
          }
        </style>
      </head>
      <body>
        <div id="fixture-banner" role="note">${BANNER_TEXT}</div>
        <main>
          <h1>${title}</h1>
          ${body}
        </main>
      </body>
    </html>`;
}

export { html, raw };
