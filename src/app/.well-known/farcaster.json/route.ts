import { PROJECT_TITLE } from "~/lib/constants";

export async function GET() {
  const appUrl =
    process.env.NEXT_PUBLIC_URL ||
    `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;

  const config = {
    accountAssociation: {
      header:
        "eyJmaWQiOjg2OTk5OSwidHlwZSI6ImN1c3RvZHkiLCJrZXkiOiIweDc2ZDUwQjBFMTQ3OWE5QmEyYkQ5MzVGMUU5YTI3QzBjNjQ5QzhDMTIifQ",
      payload:
        "eyJkb21haW4iOiJjcHRiYXNlZC1yb2NrcGFwZXJzY2lzc29ycy52ZXJjZWwuYXBwIn0",
      signature:
        "MHgyM2E4ZmIwODJiMzBjNGM1MDIyM2M5YjEwMDllZTUxYmMyNzg1ZjczNTA3NzE2NmQ5YjA4NTNjYTU4Nzg0ZTc1MTIxZGIyZTM4NTc4NTdhNmZhOTcyNjE3NDcxOWQ1ZGU4NDExMjA2MmExOGJkYzk5YmZhNjBlMTkyYzVlNWM0NDFi",
    },
    miniapp: {
      version: "1",
      name: PROJECT_TITLE,
      iconUrl: `${appUrl}/icon.png`,
      homeUrl: appUrl,
      imageUrl: `${appUrl}/frames/hello/opengraph-image`,
      ogImageUrl: `${appUrl}/frames/hello/opengraph-image`,
      buttonTitle: "Open",
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#f7f7f7",
      webhookUrl: `${appUrl}/api/webhook`,
      primaryCategory: "social",
    },
  };

  return Response.json(config);
}
