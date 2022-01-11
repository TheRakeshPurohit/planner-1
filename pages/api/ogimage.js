import { createReadStream } from "fs";
import { createServer } from "http";
import { join } from "path";
import { parse } from "url";
import { loadEnvConfig } from "@next/env";
import { launchChromium } from "playwright-aws-lambda";

let protocol = null;
if (typeof window !== "undefined") {
  protocol = window.location.protocol;
} else if (process.env.ENV_PROTOCOL) {
  protocol = process.env.ENV_PROTOCOL;
} else {
  protocol = process.env.NODE_ENV === "development" ? "http" : "https";
}

const NEXT_PUBLIC_VERCEL_URL = process.env.NEXT_PUBLIC_VERCEL_URL;
const URL = `${protocol}://${NEXT_PUBLIC_VERCEL_URL}`;

let browserContext = null;

export default async function handler(req, res) {
  const parsedUrl = parse(req.url, true);
  const { pathname, search } = parsedUrl;

  if (browserContext === null) {
    // There's some overhead to creating a browser instance;
    // we can save that time by reusing browsers between requests.
    const browser = await launchChromium({ headless: true });
    browserContext = await browser.newContext({
      userAgent: "Googlebot",
      viewport: {
        width: 1200,
        height: 627,
      },
    });
  }

  // There's some overhead in creating a page as well,
  // but pages seem less safe to re-use.
  const page = await browserContext.newPage();
  page.setExtraHTTPHeaders({
    // TODO Remove this header once 304 status is supported.
    "Cache-Control": "no-cache",
  });

  const url = `${URL}/headless${search}`;
  console.log(`Requesting URL "${url}"`);

  const [_, response] = await Promise.all([
    page.goto(url),
    page.waitForEvent("response", (response) => {
      return response.request().resourceType() === "document";
    }),
  ]);

  const status = response.status();
  console.log(`Response status ${status}`);

  // TODO Handle status 304 and implement caching:
  // https://nextjs.org/docs/api-reference/next/image#caching-behavior
  if (status >= 200 && status < 400) {
    const buffer = await page.locator("#ogImageContainer").screenshot();

    res.writeHead(200, { "Content-Type": "image/png" });
    res.write(buffer, "binary");
    res.end(null, "binary");
  } else {
    const path = join(process.cwd(), "public", "og-image.png");

    // If the chart didn't generate correctly for any reason, serve a default fallback og:image.
    res.writeHead(200, { "Content-Type": "image/png" });
    createReadStream(path).pipe(res);
  }
}
