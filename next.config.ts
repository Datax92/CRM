import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // firebase-admin pulls in google-auth-library -> jwks-rsa -> jose, and
  // jose's "webapi" build is ESM-only. next dev loads node_modules natively
  // via Node's resolver, which handles that fine — but `next build` bundles
  // server code into a single chunk and forces it through require(), which
  // breaks on jose's ESM-only entry (ERR_REQUIRE_ESM) once deployed to
  // Vercel. Listing these here keeps them unbundled on the server so they're
  // loaded natively at runtime instead, matching local dev behavior.
  serverExternalPackages: ["firebase-admin", "google-auth-library", "jwks-rsa", "jose"],

  experimental: {
    serverActions: {
      // The Data Bank importer posts rows in chunks. Next's default Server
      // Action body limit is 1 MB, which a 500-row chunk of a wide sheet (a
      // society transfer list runs to 40 columns, several of them addresses)
      // exceeds — and the request is then rejected mid-import with an opaque
      // error, after half the file has already been written.
      //
      // `MAX_CHUNK_BYTES` in `lib/dataBank.ts` keeps a chunk under 1 MB; this
      // is the headroom above it for the token, the ids and the JSON envelope.
      // Raise both together, never just one.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;